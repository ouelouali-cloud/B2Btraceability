import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { setupNetwork } from '../server/setup.js';
import { messagesFor } from '../server/notify.js';
import { seed } from '../app/js/seed.js';
import { execute } from '../app/js/engine/commands.js';
import { evidencePack } from '../app/js/engine/pack.js';

let srv;
let base;
const tokens = {};
const call = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const cmd = (who, name, payload, id) => call('/api/commands', { token: tokens[who], method: 'POST', body: { id, name, payload } });
const login = async (who, email) => { tokens[who] = (await call('/api/login', { method: 'POST', body: { email, password: 'demo' } })).data.token; };

before(async () => {
  srv = await startServer({ port: 0, file: ':memory:', quiet: true });
  base = `http://localhost:${srv.port}`;
  await login('sonar', 'nusrat@sonarapparel.example.com');
  await login('spin', 'farhana@meghnaspin.example.com');
  await login('mill', 'tanvir@dhakaknit.example.com');
  await login('recy', 'kamal@greenfibre.example.com');
});
after(() => srv.server.close());

const PDF = Buffer.from('%PDF-1.4\n% test TC scan\n').toString('base64');

test('document scans: stored by fingerprint, visible only to companies that can see the record', async () => {
  const up = await call('/api/files', { token: tokens.spin, method: 'POST', body: { name: 'packing-list.pdf', type: 'application/pdf', data: PDF } });
  assert.equal(up.status, 200);
  assert.match(up.data.sha, /^[0-9a-f]{64}$/);
  assert.equal((await call('/api/files', { token: tokens.spin, method: 'POST', body: { name: 'x.exe', type: 'application/x-msdownload', data: PDF } })).status, 422);
  // Attach to T3's packing list (seller = spinner)
  const r = await cmd('spin', 'doc.save', { transfer: 'T3', doc: 'PACKING', v: { number: 'MSM-PL-2261', date: '2026-08-05', seller: 'Meghna Spinning Mills Ltd', buyer: 'Dhaka Knit Fabrics Ltd', qty: '3000', file: up.data } });
  assert.equal(r.status, 200);
  assert.equal((await call(`/api/files/${up.data.sha}`, { token: tokens.mill })).status, 200, 'buyer on T3 can open it');
  assert.equal((await call(`/api/files/${up.data.sha}`, { token: tokens.sonar })).status, 200, 'manufacturer can open it');
  assert.equal((await call(`/api/files/${up.data.sha}`, { token: tokens.recy })).status, 404, 'recycler is not on T3');
});

test('claims: add a buyer, create a claim, share the evidence pack by link', async () => {
  assert.equal((await cmd('sonar', 'buyer.add', { id: 'bergen', v: { name: 'Bergen Outdoor AS', city: 'Bergen', country: 'NO', email: 'sourcing@bergen.example.com' } })).status, 200);
  const c = await cmd('sonar', 'claim.create', { id: 'C-TEST', v: { lotId: 'L-G1', buyer: 'bergen', pcs: '1500', recycledPct: '40', buyerPo: 'BO-7781', date: '2026-09-24' } });
  assert.equal(c.status, 200);
  assert.equal((await cmd('spin', 'claim.create', { v: { lotId: 'L-G1', buyer: 'bergen', pcs: '1', recycledPct: '40', buyerPo: 'x' } })).status, 422);

  const token = 'x'.repeat(8) + 'share-token-for-test-0001';
  assert.equal((await cmd('sonar', 'claim.share', { claim: 'C-TEST', token })).status, 200);
  const pack = await call(`/api/pack/${token}`);
  assert.equal(pack.status, 200);
  assert.equal(pack.data.claim.id, 'C-TEST');
  assert.equal(pack.data.buyer.name, 'Bergen Outdoor AS');
  assert.equal(pack.data.ledger.verify.ok, true);
  assert.ok(pack.data.chain.some((s) => s.kind === 'node' && s.origin), 'pack reaches the waste origin');
  assert.ok(pack.data.documents.some((d) => d.file?.sha), 'pack lists the attached scan');
  const sha = pack.data.documents.find((d) => d.file?.sha).file.sha;
  assert.equal((await call(`/api/pack/${token}/files/${sha}`)).status, 200, 'shared scan opens without an account');

  assert.equal((await cmd('sonar', 'claim.unshare', { claim: 'C-TEST' })).status, 200);
  assert.equal((await call(`/api/pack/${token}`)).status, 404);
});

test('notifications: raised gaps and goods-in reach the right company', async () => {
  await cmd('sonar', 'gap.raise', { id: 'G-N1', key: 'P4:consumption', v: { message: 'x' } });
  await cmd('sonar', 'gap.raise', { id: 'G-N2', key: 'T2:parties', v: { message: 'Please reissue the invoice with our registered name.' } });
  const out = (await call('/api/outbox', { token: tokens.sonar })).data;
  assert.ok(out.some((m) => m.to_email === 'kamal@greenfibre.example.com' && /Evidence request/.test(m.subject)));
  assert.equal((await call('/api/outbox', { token: tokens.spin })).status, 403);

  const db = seed();
  const { next } = execute(db, 'goodsin.record', { id: 'T-X', lot: 'L-W2', v: { date: '2026-09-22', receivedQty: '3760', poNumber: 'P', invoiceNumber: 'I', countersign: 'on' } }, { actor: 'recy', now: '2026-09-24', userName: 'K' });
  const t = next.transfers.find((x) => x.id === 'T-X');
  const msgs = messagesFor({ command: 'goodsin.record', actor: 'recy', summary: '', changes: [{ c: 'transfers', id: 'T-X', data: t }] }, next);
  assert.deepEqual(msgs.map((m) => m.orgId), ['waste']);
});

test('security: login throttling, security headers, password change', async () => {
  for (let i = 0; i < 10; i += 1) await call('/api/login', { method: 'POST', body: { email: 'abdur@rahmanjhut.example.com', password: 'wrong' } });
  const r = await call('/api/login', { method: 'POST', body: { email: 'abdur@rahmanjhut.example.com', password: 'demo' } });
  assert.equal(r.status, 429);
  const h = await call('/api/health');
  assert.equal(h.headers.get('x-frame-options'), 'DENY');
  assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await call('/api/password', { token: tokens.mill, method: 'POST', body: { current: 'nope', next: 'longer-password' } })).status, 422);
  assert.equal((await call('/api/password', { token: tokens.mill, method: 'POST', body: { current: 'demo', next: 'longer-password' } })).status, 200);
});

test('setup creates an empty real network with one manufacturer', async () => {
  const { ledger, orgId } = setupNetwork(':memory:', { company: 'Karnaphuli Apparels Ltd', city: 'Chattogram', name: 'Rina Das', email: 'rina@karnaphuli.example.com', password: 'a-long-password' });
  assert.equal(ledger.state.tenantId, orgId);
  assert.equal(ledger.state.orgs.length, 1);
  assert.equal(ledger.state.lots.length, 0);
  assert.throws(() => setupNetwork(':memory:', { company: 'X', name: 'Y', email: 'z', password: 'short' }), /Required/);
});

test('evidence pack on seed data: chain order, documents index, claim status', () => {
  const pack = evidencePack(seed(), 'C1');
  assert.deepEqual(pack.chain.filter((s) => s.kind === 'node').map((s) => s.org.id), ['waste', 'recy', 'spin', 'mill', 'sonar']);
  assert.equal(pack.status, 'held');
  assert.ok(pack.documents.length >= 12);
  assert.equal(pack.certificates.length, 4);
  assert.equal(Math.round(pack.claim.recycledKg), 758);
});
