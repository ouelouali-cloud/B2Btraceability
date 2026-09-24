// The app's view of the ledger, and the offline outbox.
//
//   base     the last state the server sent (only what this company may see)
//   outbox   commands made on this device that the server has not confirmed
//   view     base with the outbox replayed on top: what the screen shows
//
// Every change goes through send(): it runs the command locally at once, puts
// it in the outbox, and flushes the outbox whenever there is a connection.
// If the server rejects a queued command, it moves to `rejected` for the user.

import { execute } from './engine/commands.js';
import { diff } from './engine/ledgerlog.js';
import { connect, NetworkError, ls } from './transport.js';

let T = null;
let me = null;
let base = null;
let view = null;
let outbox = [];
let rejected = [];
let status = 'online';
let feed = [];
let flushing = null;
let retryTimer = null;
let onlineHooked = false;
const listeners = new Set();

export const today = () => new Date().toISOString().slice(0, 10);
const key = (k) => `threadback.${k}.${T.mode}.${me.orgId}`;
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const db = () => view;
export const actingAs = () => me?.orgId;
export const isTenant = () => !!view && me?.orgId === view.tenantId;
export const session = () => me;
export const mode = () => T?.mode;
export const transport = () => T;
export async function connectOnly() { T = T || await connect(); return T; }
export const uploadFile = (file) => T.uploadFile(file);
export const fileUrl = (f, packToken) => T.fileUrl(f, packToken);
const seenKey = () => `threadback.seen.${T?.mode}.${me?.orgId}`;
export const lastSeen = () => Number(ls.get(seenKey()) || 0);
export function markSeen() { const top = feed[0]?.seq || 0; if (top > lastSeen()) { ls.set(seenKey(), String(top)); emit({}); } }
export const unreadCount = () => feed.filter((e) => e.seq > lastSeen() && e.actor !== me?.orgId && e.actor !== 'system').length;
export const syncStatus = () => ({ status, pending: outbox.length, rejected: rejected.length });
export const pending = () => outbox;
export const rejectedList = () => rejected;
export const liveFeed = () => feed;
export function subscribe(fn) { listeners.add(fn); }
const emit = (evt = {}) => listeners.forEach((fn) => fn(evt));

function ctx() { return { actor: me.orgId, userName: me.name, now: today() }; }

function rebase() {
  let s = base;
  for (const cmd of outbox) {
    try { s = execute(s, cmd.name, cmd.payload, ctx()).next; cmd.error = null; } catch (e) { cmd.error = e.message; }
  }
  view = s;
}

function persist() {
  ls.set(key('outbox'), JSON.stringify(outbox));
  ls.set(key('rejected'), JSON.stringify(rejected));
  if (base) ls.set(key('base'), JSON.stringify(base));
}

// Returns false when the user must sign in first.
export async function init() {
  T = T || await connect();
  me = await T.session();
  if (!me) return false;
  outbox = JSON.parse(ls.get(key('outbox')) || '[]');
  rejected = JSON.parse(ls.get(key('rejected')) || '[]');
  base = JSON.parse(ls.get(key('base')) || 'null');
  feed = [];
  try {
    await refresh();
  } catch (e) {
    if (!(e instanceof NetworkError) || !base) throw e;
    setStatus('offline');
    rebase();
    scheduleRetry();
  }
  T.stream(onEntry, onReset);
  try { feed = (await T.ledger()).slice(0, 40); } catch { /* offline: feed stays empty */ }
  flush();
  if (!onlineHooked) { onlineHooked = true; window.addEventListener('online', () => flush()); }
  return true;
}

async function refresh() {
  const r = await T.fetchState();
  base = r.state;
  rebase();
  persist();
  setStatus(outbox.length ? 'syncing' : 'online');
  emit({});
}

function setStatus(s) {
  if (s === status) return;
  status = s;
  emit({ status: s });
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    try { outbox.length ? await flush() : await refresh(); } catch { scheduleRetry(); }
  }, 8000);
}

let refreshTimer;
function onEntry(entry) {
  feed = [entry, ...feed.filter((e) => e.seq !== entry.seq)].slice(0, 40);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!flushing) refresh().catch(() => {}); }, 120);
  emit({ entry });
}

async function onReset() {
  outbox = [];
  rejected = [];
  persist();
  await refresh();
  feed = (await T.ledger()).slice(0, 40);
  emit({ reset: true });
}

// Run a command: shows at once, reaches the server when it can.
export function send(name, payload) {
  const r = execute(view, name, payload, ctx()); // throws CommandError on invalid input
  if (!diff(view, r.next).length) return { summary: r.summary, closed: [], queued: false, sent: Promise.resolve(null) };
  const cmd = { id: uid(), name, payload, at: new Date().toISOString(), summary: r.summary };
  outbox.push(cmd);
  view = r.next;
  persist();
  emit({});
  const sent = flush();
  const offline = status === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false) || T.offline;
  return { summary: r.summary, closed: r.closed, queued: offline, sent };
}

export function flush() {
  if (!flushing) flushing = drain().finally(() => { flushing = null; });
  return flushing;
}

async function drain() {
  let sent = 0;
  const results = [];
  if (outbox.length && status !== 'offline') setStatus('syncing');
  while (outbox.length) {
    const cmd = outbox[0];
    try {
      results.push(await T.send(cmd));
      outbox.shift();
      sent += 1;
    } catch (e) {
      if (e instanceof NetworkError) { setStatus('offline'); persist(); scheduleRetry(); return { sent, results, offline: true }; }
      rejected.push({ ...cmd, error: e.message });
      outbox.shift();
      emit({ rejected: cmd, error: e.message });
    }
    persist();
  }
  try { await refresh(); } catch (e) { if (e instanceof NetworkError) { setStatus('offline'); scheduleRetry(); } }
  return { sent, results };
}

export function discard(id) {
  outbox = outbox.filter((c) => c.id !== id);
  rejected = rejected.filter((c) => c.id !== id);
  rebase();
  persist();
  emit({});
}

// ---- accounts

export async function login(email, password) { await T.login(email, password); return init(); }
export async function join(token, name, password) { await T.join(token, name, password); return init(); }
export async function logout() { await T.logout(); me = null; base = null; view = null; emit({ loggedOut: true }); }

export async function switchDemoActor(orgId) {
  T.setActor(orgId);
  return init();
}

export async function setSimulatedOffline(on) {
  T.offline = on;
  if (on) setStatus('offline');
  else await flush();
  emit({});
}

export async function resetDemo() {
  await T.reset();
  outbox = [];
  rejected = [];
  persist();
  await refresh();
  feed = (await T.ledger()).slice(0, 40);
  emit({ reset: true });
}
