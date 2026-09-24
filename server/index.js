// Threadback server: serves the app, the JSON API and the live stream.
// Zero dependencies (Node 22.5+ for node:sqlite).
//
//   POST /api/login           {email, password}          -> {token, user}
//   GET  /api/me                                          -> {user, org}
//   POST /api/password        {current, next}             -> change password
//   GET  /api/state                                       -> the state this company may see
//   POST /api/commands        {id, name, payload}         -> {seq, summary, closed}
//   POST /api/files           {name, type, data(base64)}  -> {sha, name, type, size}
//   GET  /api/files/:sha                                  -> a document scan you may see
//   GET  /api/ledger                                      -> ledger entries this company may see
//   GET  /api/ledger/verify                               -> {ok, count, head} hash-chain check
//   GET  /api/stream?token=                               -> Server-Sent Events, one per new entry
//   GET  /api/invite/:token   POST /api/join              -> accept an invitation, create an account
//   GET  /api/pack/:token                                 -> a shared evidence pack (no account needed)
//   GET  /api/outbox                                      -> notifications sent (manufacturer only)

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Ledger } from './ledger.js';
import { Auth, DEMO_USERS } from './auth.js';
import { Files, MAX_FILE } from './files.js';
import { Notifier } from './notify.js';
import { CommandError } from '../app/js/engine/commands.js';
import { filterState, entryVisible } from '../app/js/engine/visibility.js';
import { evidencePack } from '../app/js/engine/pack.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..', 'app');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const MAX_BODY = Math.ceil(MAX_FILE * 1.4) + 65536; // base64 file uploads are the largest bodies

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

export async function startServer({
  port = 4173, file = join(here, '..', 'data', 'threadback.db'), demo = true, quiet = false,
  webhook = process.env.NOTIFY_WEBHOOK_URL, publicUrl = process.env.PUBLIC_URL || '',
} = {}) {
  if (file !== ':memory:') await mkdir(dirname(file), { recursive: true });
  const ledger = new Ledger(file);
  const auth = new Auth(ledger);
  const files = new Files(ledger, file === ':memory:' ? join(tmpdir(), `threadback-files-${randomUUID()}`) : join(dirname(file), 'files'));
  const notifier = new Notifier(ledger, { webhook, baseUrl: publicUrl, quiet });
  if (ledger.empty) {
    if (demo) {
      ledger.genesis();
      for (const u of DEMO_USERS) if (!ledger.sql.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) auth.createUser({ ...u, password: 'demo' });
    } else if (!quiet) {
      console.log('Empty ledger and DEMO=0: create your network with `npm run setup` first.');
    }
  }

  // ---- live stream: every client gets the entries its company may see
  const clients = new Set();
  ledger.listeners.add((e) => {
    for (const c of clients) {
      if (!entryVisible(ledger.state, c.orgId, e)) continue;
      c.res.write(`event: entry\ndata: ${JSON.stringify(publicEntry(ledger, e))}\n\n`);
    }
  });
  const beat = setInterval(() => { for (const c of clients) c.res.write(': keep-alive\n\n'); }, 25000);

  const ctx = { ledger, auth, files, notifier, clients, demo, publicUrl, attempts: new Map() };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, ctx);
      return await serveStatic(url.pathname, res);
    } catch (err) {
      const known = err instanceof CommandError || err.userFacing;
      if (!res.headersSent) send(res, known ? 422 : 500, { error: known ? err.message : 'Server error' });
      if (!known && !quiet) console.error(err);
    }
  });
  await new Promise((r) => server.listen(port, r));
  if (!quiet) console.log(`Threadback on http://localhost:${server.address().port}  (ledger: ${file}, ${ledger.seq} entries${webhook ? ', notifications via webhook' : ''})`);
  server.on('close', () => clearInterval(beat));
  return { server, ledger, auth, files, notifier, port: server.address().port };
}

function publicEntry(ledger, e) {
  const org = ledger.state.orgs.find((o) => o.id === e.actor);
  return { seq: e.seq, at: e.at, actor: e.actor, actorName: org?.name || e.actor, user: e.user, command: e.command,
    summary: e.summary, hash: e.hash, prev: e.prev, refs: e.changes.map((c) => `${c.c}:${c.id}`) };
}

const userError = (msg) => Object.assign(new Error(msg), { userFacing: true });

// Ten wrong passwords per address and email in fifteen minutes, then wait.
function throttled(attempts, key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now > a.reset) { attempts.set(key, { n: 0, reset: now + 15 * 60000 }); return false; }
  return a.n >= 10;
}

function sharedClaim(ledger, token) {
  if (!token || token.length < 24) return null;
  return ledger.state.claims.find((c) => c.share?.token === token) || null;
}

async function api(req, res, url, { ledger, auth, files, notifier, clients, demo, publicUrl, attempts }) {
  const path = url.pathname;
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token');
  const user = auth.fromToken(token);

  if (path === '/api/health') return send(res, 200, { ok: true, mode: 'server', seq: ledger.seq, demo });

  if (path === '/api/login' && req.method === 'POST') {
    const b = await body(req);
    const key = `${req.socket.remoteAddress}|${String(b.email || '').toLowerCase()}`;
    if (throttled(attempts, key)) return send(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
    const r = auth.login(b.email, b.password);
    if (!r) { attempts.get(key).n += 1; return send(res, 401, { error: 'Email or password is wrong.' }); }
    attempts.delete(key);
    return send(res, 200, r);
  }
  if (path === '/api/demo-accounts') {
    return send(res, 200, demo ? DEMO_USERS.map((u) => { const o = ledger.state.orgs.find((x) => x.id === u.orgId); return { ...u, org: o?.name, tier: o?.tier }; }) : []);
  }
  if (path.startsWith('/api/invite/')) {
    const inv = auth.invite(path.slice(12));
    if (!inv || inv.usedAt) return send(res, 404, { error: 'This invitation link is not valid or was already used.' });
    const o = ledger.state.orgs.find((x) => x.id === inv.orgId);
    const by = ledger.state.orgs.find((x) => x.id === o?.invitedBy);
    return send(res, 200, { email: inv.email, org: o?.name, invitedBy: by?.name });
  }
  if (path === '/api/join' && req.method === 'POST') {
    const b = await body(req);
    if (!b.name?.trim() || String(b.password || '').length < 8) return send(res, 422, { error: 'Enter your name and a password of at least 8 characters.' });
    const r = auth.useInvite(b.token, b);
    return r ? send(res, 200, r) : send(res, 404, { error: 'This invitation link is not valid or was already used.' });
  }

  // ---- shared evidence packs: readable by anyone holding the link
  const packMatch = path.match(/^\/api\/pack\/([\w-]+)(?:\/files\/([0-9a-f]{64}))?$/);
  if (packMatch) {
    const c = sharedClaim(ledger, packMatch[1]);
    if (!c) return send(res, 404, { error: 'This evidence pack link is not valid or is no longer shared.' });
    const pack = evidencePack(ledger.state, c.id, { entries: ledger.entries({ limit: 100000 }).map((e) => publicEntry(ledger, e)), verify: await ledger.verify() });
    if (packMatch[2]) {
      if (!JSON.stringify(pack).includes(packMatch[2])) return send(res, 404, { error: 'Not found' });
      return sendFile(res, files, packMatch[2]);
    }
    return send(res, 200, pack);
  }

  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const isTenant = user.orgId === ledger.state.tenantId;

  if (path === '/api/logout' && req.method === 'POST') { auth.logout(token); return send(res, 200, { ok: true }); }
  if (path === '/api/me') return send(res, 200, { user, org: ledger.state.orgs.find((o) => o.id === user.orgId) });
  if (path === '/api/password' && req.method === 'POST') {
    const b = await body(req);
    const err = auth.changePassword(user.id, b.current, b.next);
    return err ? send(res, 422, { error: err }) : send(res, 200, { ok: true });
  }
  if (path === '/api/state') return send(res, 200, { seq: ledger.seq, state: filterState(ledger.state, user.orgId) });

  if (path === '/api/commands' && req.method === 'POST') {
    const b = await body(req);
    const r = ledger.run(b.name, b.payload, { actor: user.orgId, userName: user.name, commandId: b.id });
    if (b.name === 'org.invite' && !r.duplicate) {
      const o = ledger.state.orgs.find((x) => x.id === b.payload.id) || [...ledger.state.orgs].reverse().find((x) => x.status === 'invited');
      const link = `/#join.${auth.createInvite(o.id, o.email)}`;
      r.invite = { url: link, email: o.email };
      const from = ledger.state.orgs.find((x) => x.id === user.orgId)?.name;
      notifier.deliver({ to: o.email, subject: `${from} invites you to Threadback`, text: `${from} buys from ${o.name} and needs to show where its recycled material came from. Create your account with this link (it works once):`, url: publicUrl + link, seq: r.seq });
    }
    return send(res, 200, r);
  }

  if (path === '/api/files' && req.method === 'POST') {
    const b = await body(req);
    try { return send(res, 200, files.save(user.orgId, b)); } catch (e) { throw userError(e.message); }
  }
  const fileMatch = path.match(/^\/api\/files\/([0-9a-f]{64})$/);
  if (fileMatch) {
    const m = files.meta(fileMatch[1]);
    const visible = m && (isTenant || m.org_id === user.orgId || JSON.stringify(filterState(ledger.state, user.orgId)).includes(fileMatch[1]));
    return visible ? sendFile(res, files, fileMatch[1]) : send(res, 404, { error: 'Not found' });
  }

  if (path === '/api/ledger') {
    const list = ledger.recent(Number(url.searchParams.get('limit')) || 200).filter((e) => entryVisible(ledger.state, user.orgId, e));
    return send(res, 200, list.map((e) => publicEntry(ledger, e)));
  }
  if (path === '/api/ledger/verify') return send(res, 200, await ledger.verify());
  if (path === '/api/outbox') return isTenant ? send(res, 200, notifier.recent()) : send(res, 403, { error: 'Manufacturer only.' });

  if (path === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ seq: ledger.seq })}\n\n`);
    const c = { res, orgId: user.orgId };
    clients.add(c);
    req.on('close', () => clients.delete(c));
    return undefined;
  }

  if (path === '/api/demo/reset' && req.method === 'POST' && demo && isTenant) {
    ledger.reset();
    for (const c of clients) c.res.write('event: reset\ndata: {}\n\n');
    return send(res, 200, { ok: true, seq: ledger.seq });
  }
  return send(res, 404, { error: 'Not found' });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY });
  res.end(JSON.stringify(data));
}

function sendFile(res, files, sha) {
  const m = files.meta(sha);
  if (!m) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': m.type, 'content-disposition': `inline; filename="${m.name.replace(/[^\w.\- ]/g, '_')}"`, 'cache-control': 'private, max-age=86400', ...SECURITY });
  res.end(files.read(sha));
  return undefined;
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(userError('Upload too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(userError('Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const file = join(APP, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(APP)) { res.writeHead(403).end(); return; }
  try {
    let data = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    // The artifact host adds <!doctype html><html>; the server does it here.
    if (extname(file) === '.html') data = Buffer.from(`<!doctype html><html lang="en"><head>${data.toString('utf8')}</body></html>`.replace('<header class="topbar">', '</head><body><header class="topbar">'));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...SECURITY });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer({ port: Number(process.env.PORT) || 4173, file: process.env.DB_FILE || undefined, demo: process.env.DEMO !== '0' });
}
