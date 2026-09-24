// Threadback server: serves the app, the JSON API and the live stream.
// Zero dependencies (Node 22.5+ for node:sqlite).
//
//   POST /api/login           {email, password}          -> {token, user}
//   GET  /api/me                                          -> {user, org}
//   GET  /api/state                                       -> the state this company may see
//   POST /api/commands        {id, name, payload}         -> {seq, summary, closed}
//   GET  /api/ledger                                      -> ledger entries this company may see
//   GET  /api/ledger/verify                               -> {ok, count, head} hash-chain check
//   GET  /api/stream?token=                               -> Server-Sent Events, one per new entry
//   GET  /api/invite/:token   POST /api/join              -> accept an invitation, create an account

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.js';
import { Auth, DEMO_USERS } from './auth.js';
import { CommandError } from '../app/js/engine/commands.js';
import { filterState, entryVisible } from '../app/js/engine/visibility.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..', 'app');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const MAX_BODY = 6 * 1024 * 1024; // photos are resized on the phone, but leave room

export async function startServer({ port = 4173, file = join(here, '..', 'data', 'threadback.db'), demo = true, quiet = false } = {}) {
  if (file !== ':memory:') await mkdir(dirname(file), { recursive: true });
  const ledger = new Ledger(file);
  const auth = new Auth(ledger);
  if (ledger.empty) {
    ledger.genesis();
    if (demo) for (const u of DEMO_USERS) if (!ledger.sql.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) auth.createUser({ ...u, password: 'demo' });
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, { ledger, auth, clients, demo });
      return await serveStatic(url.pathname, res);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof CommandError ? 422 : 500, { error: err instanceof CommandError ? err.message : 'Server error' });
      if (!(err instanceof CommandError) && !quiet) console.error(err);
    }
  });
  await new Promise((r) => server.listen(port, r));
  if (!quiet) console.log(`Threadback on http://localhost:${server.address().port}  (ledger: ${file}, ${ledger.seq} entries)`);
  server.on('close', () => clearInterval(beat));
  return { server, ledger, auth, port: server.address().port };
}

function publicEntry(ledger, e) {
  const org = ledger.state.orgs.find((o) => o.id === e.actor);
  return { seq: e.seq, at: e.at, actor: e.actor, actorName: org?.name || e.actor, user: e.user, command: e.command,
    summary: e.summary, hash: e.hash, prev: e.prev, refs: e.changes.map((c) => `${c.c}:${c.id}`) };
}

async function api(req, res, url, { ledger, auth, clients, demo }) {
  const path = url.pathname;
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token');
  const user = auth.fromToken(token);

  if (path === '/api/health') return send(res, 200, { ok: true, mode: 'server', seq: ledger.seq, demo });

  if (path === '/api/login' && req.method === 'POST') {
    const b = await body(req);
    const r = auth.login(b.email, b.password);
    return r ? send(res, 200, r) : send(res, 401, { error: 'Email or password is wrong.' });
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

  if (!user) return send(res, 401, { error: 'Sign in first.' });

  if (path === '/api/logout' && req.method === 'POST') { auth.logout(token); return send(res, 200, { ok: true }); }
  if (path === '/api/me') return send(res, 200, { user, org: ledger.state.orgs.find((o) => o.id === user.orgId) });
  if (path === '/api/state') return send(res, 200, { seq: ledger.seq, state: filterState(ledger.state, user.orgId) });

  if (path === '/api/commands' && req.method === 'POST') {
    const b = await body(req);
    const r = ledger.run(b.name, b.payload, { actor: user.orgId, userName: user.name, commandId: b.id });
    // Invitations get a join link. Email delivery is out of scope for the prototype.
    if (b.name === 'org.invite' && !r.duplicate) {
      const o = ledger.state.orgs.find((x) => x.id === b.payload.id) || [...ledger.state.orgs].reverse().find((x) => x.status === 'invited');
      r.invite = { url: `/#join.${auth.createInvite(o.id, o.email)}`, email: o.email };
    }
    return send(res, 200, r);
  }

  if (path === '/api/ledger') {
    const list = ledger.recent(Number(url.searchParams.get('limit')) || 200).filter((e) => entryVisible(ledger.state, user.orgId, e));
    return send(res, 200, list.map((e) => publicEntry(ledger, e)));
  }
  if (path === '/api/ledger/verify') return send(res, 200, await ledger.verify());

  if (path === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ seq: ledger.seq })}\n\n`);
    const c = { res, orgId: user.orgId };
    clients.add(c);
    req.on('close', () => clients.delete(c));
    return undefined;
  }

  if (path === '/api/demo/reset' && req.method === 'POST' && demo && user.orgId === ledger.state.tenantId) {
    ledger.reset();
    for (const c of clients) c.res.write('event: reset\ndata: {}\n\n');
    return send(res, 200, { ok: true, seq: ledger.seq });
  }
  return send(res, 404, { error: 'Not found' });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new CommandError('Upload too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new CommandError('Request body is not valid JSON.')); }
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
    let type = TYPES[extname(file)] || 'application/octet-stream';
    // The artifact host adds <!doctype html><html>; the server does it here.
    if (extname(file) === '.html') data = Buffer.from(`<!doctype html><html lang="en"><head>${data.toString('utf8')}</body></html>`.replace('<header class="topbar">', '</head><body><header class="topbar">'));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer({ port: Number(process.env.PORT) || 4173, file: process.env.DB_FILE || undefined, demo: process.env.DEMO !== '0' });
}
