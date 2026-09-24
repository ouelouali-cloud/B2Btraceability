// How the app reaches the ledger. Two implementations, one interface:
//   ServerTransport  the real backend (`npm start`): accounts, SQLite, live stream
//   DemoTransport    the same ledger simulated in this browser, for the hosted
//                    demo where no server exists. Other tabs see changes live.

import { seed, DEMO_USERS } from './seed.js';
import { execute } from './engine/commands.js';
import { COLLECTIONS, diff, replay, hashInput, GENESIS, verifyChain } from './engine/ledgerlog.js';
import { filterState, entryVisible } from './engine/visibility.js';

export class NetworkError extends Error {}
export class Rejected extends Error {}

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { ls };

async function sha256(text) {
  if (!globalThis.crypto?.subtle) return 'unhashed';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Rejected('That file could not be read.'));
    r.readAsDataURL(file);
  });
}

async function sha256Bytes(buf) {
  if (!globalThis.crypto?.subtle) return 'unhashed';
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- server

class ServerTransport {
  constructor() {
    this.mode = 'server';
    this.token = ls.get('threadback.token');
  }

  async req(path, { method = 'GET', body } = {}) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError('No connection');
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000); // a stalled request counts as offline
    try {
      res = await fetch(path, {
        signal: ctrl.signal,
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new NetworkError('No connection');
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && this.token && path !== '/api/login') { this.token = null; ls.del('threadback.token'); }
    if (!res.ok) throw new Rejected(data.error || `Request failed (${res.status})`);
    return data;
  }

  async session() {
    if (!this.token) return null;
    const cached = JSON.parse(ls.get('threadback.me') || 'null');
    try {
      const me = await this.req('/api/me');
      const s = { orgId: me.user.orgId, name: me.user.name, email: me.user.email };
      ls.set('threadback.me', JSON.stringify(s));
      return s;
    } catch (e) {
      if (e instanceof NetworkError && cached) return cached; // offline: keep working as before
      return null;
    }
  }

  async login(email, password) {
    const r = await this.req('/api/login', { method: 'POST', body: { email, password } });
    this.token = r.token;
    ls.set('threadback.token', r.token);
  }

  async join(token, name, password) {
    const r = await this.req('/api/join', { method: 'POST', body: { token, name, password } });
    this.token = r.token;
    ls.set('threadback.token', r.token);
  }

  inviteInfo(token) { return this.req(`/api/invite/${encodeURIComponent(token)}`); }
  demoAccounts() { return this.req('/api/demo-accounts'); }

  async logout() {
    try { await this.req('/api/logout', { method: 'POST' }); } catch { /* offline logout still clears locally */ }
    this.token = null;
    ls.del('threadback.token');
    ls.del('threadback.me');
  }

  fetchState() { return this.req('/api/state'); }
  fetchPack(token) { return this.req(`/api/pack/${encodeURIComponent(token)}`); }
  changePassword(current, next) { return this.req('/api/password', { method: 'POST', body: { current, next } }); }
  fileUrl(f, packToken) {
    if (!f?.sha) return '#';
    return packToken ? `/api/pack/${encodeURIComponent(packToken)}/files/${f.sha}` : `/api/files/${f.sha}?token=${encodeURIComponent(this.token || '')}`;
  }
  async uploadFile(file) {
    const data = await readAsDataUrl(file);
    return this.req('/api/files', { method: 'POST', body: { name: file.name, type: file.type, data: data.split(',')[1] } });
  }
  send(cmd) { return this.req('/api/commands', { method: 'POST', body: cmd }); }
  ledger() { return this.req('/api/ledger'); }
  verify() { return this.req('/api/ledger/verify'); }
  reset() { return this.req('/api/demo/reset', { method: 'POST' }); }

  stream(onEntry, onReset) {
    if (!this.token || typeof EventSource === 'undefined') return;
    this.es?.close();
    this.es = new EventSource(`/api/stream?token=${encodeURIComponent(this.token)}`);
    this.es.addEventListener('entry', (ev) => onEntry(JSON.parse(ev.data)));
    this.es.addEventListener('reset', () => onReset());
  }
}

// ---------------------------------------------------------------- demo

const DEMO_KEY = 'threadback.demo.v3';

class DemoTransport {
  constructor() {
    this.mode = 'demo';
    this.offline = false; // "simulate offline" switch
    this.actor = ls.get('threadback.demo.actor') || 'sonar';
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('threadback-demo') : null;
    this.listeners = new Set();
    this.channel?.addEventListener('message', (ev) => {
      if (ev.data.type === 'entry') { this.loadFromStorage(); this.emit(ev.data.entry); }
      if (ev.data.type === 'reset') { this.loadFromStorage(); this.onReset?.(); }
    });
  }

  async init() {
    if (!this.loadFromStorage()) await this.genesis();
  }

  loadFromStorage() {
    const raw = ls.get(DEMO_KEY);
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw);
      this.entries = saved.entries;
      this.tenantId = saved.tenantId;
      this.state = replay(this.entries, this.tenantId);
      return true;
    } catch { return false; }
  }

  persist() {
    if (!ls.set(DEMO_KEY, JSON.stringify({ tenantId: this.tenantId, entries: this.entries }))) {
      this.storageFull = true;
    }
  }

  async genesis() {
    const s = seed();
    this.tenantId = s.tenantId;
    this.entries = [];
    this.state = replay([], s.tenantId);
    await this.append({ actor: 'system', user: 'system', command: 'network.seed', summary: 'Demo supply chain loaded',
      changes: COLLECTIONS.flatMap((c) => s[c].map((r) => ({ c, id: r.id, data: r }))) });
  }

  async append({ actor, user, command, commandId, summary, changes }) {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
    const e = { seq: this.entries.length + 1, at: new Date().toISOString(), actor, user, command, commandId, summary, changes, prev };
    e.hash = await sha256(hashInput(e));
    this.entries.push(e);
    this.state = replay(this.entries, this.tenantId);
    this.persist();
    const pub = this.publicEntry(e);
    this.channel?.postMessage({ type: 'entry', entry: pub });
    this.emit(pub);
    return e;
  }

  publicEntry(e) {
    const org = this.state.orgs.find((o) => o.id === e.actor);
    return { seq: e.seq, at: e.at, actor: e.actor, actorName: org?.name || e.actor, user: e.user, command: e.command,
      summary: e.summary, hash: e.hash, prev: e.prev, refs: e.changes.map((c) => `${c.c}:${c.id}`), changes: e.changes };
  }

  emit(entry) {
    for (const fn of this.listeners) if (entryVisible(this.state, this.actor, entry)) fn(entry);
  }

  userName(orgId) { return DEMO_USERS.find((u) => u.orgId === orgId)?.name || this.state.orgs.find((o) => o.id === orgId)?.name || orgId; }

  async session() { return { orgId: this.actor, name: this.userName(this.actor), email: '' }; }
  setActor(orgId) { this.actor = orgId; ls.set('threadback.demo.actor', orgId); }
  async logout() { /* demo: no accounts */ }

  async fetchState() {
    if (this.offline) throw new NetworkError('Offline (simulated)');
    return { seq: this.entries.length, state: filterState(this.state, this.actor) };
  }

  async send(cmd) {
    if (this.offline) throw new NetworkError('Offline (simulated)');
    const prior = this.entries.find((e) => e.commandId && e.commandId === cmd.id);
    if (prior) return { seq: prior.seq, summary: prior.summary, closed: [], duplicate: true };
    let r;
    try {
      r = execute(this.state, cmd.name, cmd.payload, { actor: this.actor, userName: this.userName(this.actor), now: new Date().toISOString().slice(0, 10) });
    } catch (e) { throw new Rejected(e.message); }
    const changes = diff(this.state, r.next);
    if (!changes.length) return { seq: this.entries.length, summary: r.summary, closed: r.closed };
    const e = await this.append({ actor: this.actor, user: this.userName(this.actor), command: cmd.name, commandId: cmd.id, summary: r.summary, changes });
    return { seq: e.seq, summary: r.summary, closed: r.closed };
  }

  async fetchPack(token) {
    const c = this.state.claims.find((x) => x.share?.token === token);
    if (!c) throw new Rejected('This evidence pack link is not valid or is no longer shared.');
    const { evidencePack } = await import('./engine/pack.js');
    return evidencePack(this.state, c.id, { entries: this.entries.map((e) => this.publicEntry(e)), verify: await this.verify() });
  }

  fileUrl(f) { return f?.data || '#'; }

  // The hosted demo keeps files inside the browser, so keep them small.
  async uploadFile(file) {
    if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.type)) throw new Rejected('Only PDF, JPEG, PNG or WebP files can be attached.');
    if (file.size > 1.5 * 1024 * 1024) throw new Rejected('In the hosted demo, files can be at most 1.5 MB. The server accepts up to 8 MB.');
    const data = await readAsDataUrl(file);
    const sha = await sha256Bytes(await file.arrayBuffer());
    return { sha, name: file.name, type: file.type, size: file.size, data };
  }

  async changePassword() { throw new Rejected('The hosted demo has no accounts.'); }

  async ledger() {
    return this.entries.filter((e) => entryVisible(this.state, this.actor, e)).map((e) => this.publicEntry(e)).reverse();
  }

  verify() { return verifyChain(this.entries, sha256); }

  async reset() {
    ls.del(DEMO_KEY);
    await this.genesis();
    this.channel?.postMessage({ type: 'reset' });
  }

  stream(onEntry, onReset) {
    this.listeners.clear();
    this.listeners.add(onEntry);
    this.onReset = onReset;
  }
}

// Real backend if one answers; otherwise the in-browser demo. A phone that
// used the server before keeps using it while offline.
export async function connect() {
  const remembered = ls.get('threadback.mode');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const data = await res.json();
    if (data.mode === 'server') { ls.set('threadback.mode', 'server'); return new ServerTransport(); }
  } catch {
    if (remembered === 'server') return new ServerTransport();
  }
  const t = new DemoTransport();
  await t.init();
  return t;
}
