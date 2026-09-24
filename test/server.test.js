import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';

let srv;
let base;
const tokens = {};

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const cmd = (who, name, payload, id) => call('/api/commands', { token: tokens[who], method: 'POST', body: { id, name, payload } });

before(async () => {
  srv = await startServer({ port: 0, file: ':memory:', quiet: true });
  base = `http://localhost:${srv.port}`;
  for (const [who, email] of [['sonar', 'nusrat@sonarapparel.example.com'], ['waste', 'abdur@rahmanjhut.example.com'], ['recy', 'kamal@greenfibre.example.com'], ['spin', 'farhana@meghnaspin.example.com']]) {
    const r = await call('/api/login', { method: 'POST', body: { email, password: 'demo' } });
    assert.equal(r.status, 200, who);
    tokens[who] = r.data.token;
  }
});
after(() => srv.server.close());

test('wrong password and missing session are refused', async () => {
  assert.equal((await call('/api/login', { method: 'POST', body: { email: 'nusrat@sonarapparel.example.com', password: 'nope' } })).status, 401);
  assert.equal((await call('/api/state')).status, 401);
});

test('each company sees only its slice of the chain', async () => {
  const all = (await call('/api/state', { token: tokens.sonar })).data.state;
  const spin = (await call('/api/state', { token: tokens.spin })).data.state;
  assert.equal(all.transfers.length, 4);
  assert.deepEqual(spin.transfers.map((t) => t.id).sort(), ['T2', 'T3']);
  assert.ok(!spin.lots.some((l) => l.id === 'L-W1'), 'spinner cannot see the waste batch');
  assert.equal(spin.claims.length, 0);
  const recy = (await call('/api/state', { token: tokens.recy })).data.state;
  assert.ok(recy.lots.some((l) => l.id === 'L-W2'), 'recycler sees signed batch addressed to it');
});

test('permissions are enforced on the server', async () => {
  const r = await cmd('spin', 'doc.save', { transfer: 'T4', doc: 'PACKING', v: { number: 'X', qty: 1 } });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /Only the seller/);
});

test('recycler goods-in, retried from a phone, is written once', async () => {
  const payload = { id: 'T-TEST1', lot: 'L-W2', v: { date: '2026-09-22', receivedQty: '3760', gateSlip: 'GF-GATE-0922-1', moisturePct: '6', poNumber: 'GF-PO-301', invoiceNumber: 'RJT-0588', countersign: 'on' } };
  const a = await cmd('recy', 'goodsin.record', payload, 'cmd-1');
  const b = await cmd('recy', 'goodsin.record', payload, 'cmd-1');
  assert.equal(a.status, 200);
  assert.equal(b.data.duplicate, true);
  assert.equal(a.data.seq, b.data.seq);
  const t = (await call('/api/state', { token: tokens.recy })).data.state.transfers.find((x) => x.id === 'T-TEST1');
  assert.equal(t.receivedQty, 3760);
  assert.equal(t.countersign.declaration, 'RMD-RJT-2609-W2');
});

test('the ledger is hash-linked and tampering is detected', async () => {
  const v = await call('/api/ledger/verify', { token: tokens.sonar });
  assert.equal(v.data.ok, true);
  srv.ledger.sql.prepare("UPDATE entries SET summary = 'edited' WHERE seq = 1").run();
  const bad = await call('/api/ledger/verify', { token: tokens.sonar });
  assert.equal(bad.data.ok, false);
  assert.equal(bad.data.brokenAt, 1);
  srv.ledger.sql.prepare("UPDATE entries SET summary = 'Demo supply chain loaded' WHERE seq = 1").run();
  assert.equal((await call('/api/ledger/verify', { token: tokens.sonar })).data.ok, true);
});

test('live stream delivers new entries to the companies involved', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream?token=${tokens.sonar}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const got = (async () => {
    let buf = '';
    for (;;) {
      const { value } = await reader.read();
      buf += new TextDecoder().decode(value);
      if (buf.includes('event: entry')) return buf;
    }
  })();
  await cmd('waste', 'batch.create', { id: 'L-WTEST' });
  const text = await got;
  ctrl.abort();
  assert.match(text, /New waste batch L-WTEST/);
});

test('invitation link creates an account for the new supplier', async () => {
  const r = await cmd('sonar', 'org.invite', { id: 'newmill', v: { name: 'Karnaphuli Knit', email: 'ops@karnaphuli.example.com', city: 'Chattogram', country: 'BD', tier: 'mill', suppliesTo: 'sonar' } });
  assert.match(r.data.invite.url, /#join\./);
  const tok = r.data.invite.url.split('#join.')[1];
  assert.equal((await call(`/api/invite/${tok}`)).data.org, 'Karnaphuli Knit');
  const j = await call('/api/join', { method: 'POST', body: { token: tok, name: 'Rafiq Islam', password: 'long-enough-pw' } });
  assert.equal(j.status, 200);
  const me = await call('/api/me', { token: j.data.token });
  assert.equal(me.data.org.id, 'newmill');
  assert.equal((await call('/api/join', { method: 'POST', body: { token: tok, name: 'Again', password: 'long-enough-pw' } })).status, 404);
});
