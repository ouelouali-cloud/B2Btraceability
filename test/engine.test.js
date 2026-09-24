import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../app/js/seed.js';
import { checkTransfer, checkProcess, checkOrigin, processBalance } from '../app/js/engine/checks.js';
import { ledger } from '../app/js/engine/ledger.js';
import { traceLot, chainSteps, claimStatus, syncGaps, completeness } from '../app/js/engine/trace.js';

const byId = (checks, id) => checks.find((c) => c.id === id);
const t = (db, id) => db.transfers.find((x) => x.id === id);
const p = (db, id) => db.processes.find((x) => x.id === id);
const l = (db, id) => db.lots.find((x) => x.id === id);

test('seed chain traces from T-shirts back to waste, most upstream first', () => {
  const db = seed();
  const steps = chainSteps(traceLot(db, 'L-G1'));
  const nodes = steps.filter((s) => s.kind === 'node').map((s) => s.node.org.id);
  assert.deepEqual(nodes, ['waste', 'recy', 'spin', 'mill', 'sonar']);
  assert.deepEqual(steps.filter((s) => s.kind === 'handoff').map((s) => s.transfer.id), ['T1', 'T2', 'T3', 'T4']);
});

test('the three planted gaps fail, everything else passes or warns', () => {
  const db = seed();
  assert.equal(byId(checkOrigin(db, l(db, 'L-W1')), 'origin').status, 'fail');
  assert.equal(byId(checkTransfer(db, t(db, 'T3')), 'quantity').status, 'fail');
  assert.equal(byId(checkProcess(db, p(db, 'P4')), 'consumption').status, 'fail');
  assert.equal(byId(checkTransfer(db, t(db, 'T2')), 'parties').status, 'warn');
  assert.equal(byId(checkTransfer(db, t(db, 'T1')), 'tc').status, 'na');
  for (const id of ['T1', 'T2', 'T4']) {
    assert.ok(!checkTransfer(db, t(db, id)).some((c) => c.status === 'fail'), id);
  }
  assert.equal(claimStatus(db, db.claims[0]).status, 'held');
});

test('spinner blend: 3,985 kg recycled in 10,000 kg supports a 40% claim within tolerance', () => {
  const db = seed();
  const b = processBalance(db, p(db, 'P2'));
  assert.equal(Math.round(b.computedPct * 100) / 100, 39.85);
  assert.equal(byId(checkProcess(db, p(db, 'P2')), 'blend').status, 'pass');
  l(db, 'L-Y1').recycledPct = 45;
  assert.equal(byId(checkProcess(db, p(db, 'P2')), 'blend').status, 'fail');
});

test('garment ledger: credit follows fabric in, production, then claim', () => {
  const db = seed();
  const led = ledger(db, 'sonar');
  // 2,590 kg fabric × 40% = 1,036 kg recycled in
  assert.equal(Math.round(led.rows.find((r) => r.kind === 'received').input), 1036);
  // Only fibre carries the claim: 14,000 × 0.158 kg × 40% = 885 kg credited
  // (thread and labels excluded); claim 12,000 pcs = 758 kg
  assert.equal(Math.round(led.rows.find((r) => r.kind === 'produced').credit), 885);
  assert.equal(Math.round(led.credit), 126);
  assert.equal(led.firstNegative, null);
});

test('over-claiming drives the account negative and holds the claim', () => {
  const db = seed();
  db.claims.push({ id: 'C2', lotId: 'L-G1', buyer: 'nordvik', date: '2026-09-20', pcs: 2500, recycledPct: 40, text: 'x' });
  const led = ledger(db, 'sonar');
  assert.equal(led.firstNegative.ref, 'C2');
  assert.equal(claimStatus(db, db.claims[1]).checks.find((c) => c.id === 'stock').status, 'fail');
});

test('fixing the data closes gaps and releases the claim', () => {
  const db = seed();
  db.gaps.push({ id: 'G2', key: 'T3:quantity', owner: 'spin', status: 'open', thread: [] });
  completeWasteDeclaration(db);
  t(db, 'T3').docs.PACKING.qty = 3000;
  l(db, 'L-G1').qty = 13500;
  const closed = syncGaps(db, '2026-09-24');
  assert.deepEqual(closed.sort(), ['G1', 'G2']);
  // Signed, but the recycler has not yet confirmed the delivery against it
  assert.equal(byId(checkTransfer(db, t(db, 'T1')), 'countersign').status, 'fail');
  assert.equal(claimStatus(db, db.claims[0]).status, 'held');
  const d = l(db, 'L-W1').origin.declaration;
  t(db, 'T1').countersign = { by: 'Kamal Hossain', at: '2026-09-24', declaration: d.number, signedOn: d.signedOn };
  const s = claimStatus(db, db.claims[0]);
  assert.equal(s.status, 'ready');
  assert.equal(s.warn, true); // T2 invoice name variant still to tidy
});

function completeWasteDeclaration(db) {
  const o = l(db, 'L-W1').origin;
  o.sources[1].collectedOn = '2026-06-22';
  o.sources.push({ name: 'Siddhirganj Knitwear', kind: 'Cutting waste', city: 'Narayanganj', kg: 1200, collectedOn: '2026-06-27' });
  o.contamination.noPrint = true;
  Object.assign(o.declaration, { signer: 'Abdur Rahman', role: 'Owner', signature: 'data:image/png;base64,x', signedOn: '2026-09-24', number: 'RMD-RJT-2609-W1' });
}

test('waste origin: source weights must add up to the batch', () => {
  const db = seed();
  const src = byId(checkOrigin(db, l(db, 'L-W1')), 'sources');
  assert.equal(src.status, 'fail');
  assert.match(src.detail, /4,000 of 5,200 kg/);
  completeWasteDeclaration(db);
  assert.equal(byId(checkOrigin(db, l(db, 'L-W1')), 'sources').status, 'pass');
  assert.equal(byId(checkOrigin(db, l(db, 'L-W1')), 'origin').status, 'pass');
  // A signed declaration still fails if a factory's weight goes missing
  l(db, 'L-W1').origin.sources[2].kg = 0;
  assert.equal(byId(checkOrigin(db, l(db, 'L-W1')), 'origin').status, 'fail');
});

test('expired scope certificate fails the handoff', () => {
  const db = seed();
  db.orgs.find((o) => o.id === 'mill').sc.validTo = '2026-08-01';
  assert.equal(byId(checkTransfer(db, t(db, 'T4')), 'sc').status, 'fail');
});

test('completeness flags the invited subcontractor and expiring spinner SC', () => {
  const db = seed();
  assert.equal(completeness(db, 'padma', '2026-09-24').items[0].ok, false);
  const spin = completeness(db, 'spin', '2026-09-24');
  assert.ok(spin.items.some((i) => /renewal/.test(i.label) && !i.ok));
});
