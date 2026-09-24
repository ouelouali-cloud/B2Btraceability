import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../app/js/seed.js';
import { execute, CommandError } from '../app/js/engine/commands.js';
import { diff, replay, COLLECTIONS, applyChanges, emptyState } from '../app/js/engine/ledgerlog.js';
import { filterState } from '../app/js/engine/visibility.js';
import { checkTransfer } from '../app/js/engine/checks.js';

const ctx = (actor) => ({ actor, now: '2026-09-24', userName: 'Test' });

test('commands never touch the state they are given', () => {
  const db = seed();
  const before = JSON.stringify(db);
  const r = execute(db, 'batch.create', { id: 'L-WX' }, ctx('waste'));
  assert.equal(JSON.stringify(db), before);
  assert.ok(r.next.lots.some((x) => x.id === 'L-WX'));
});

test('diff + replay rebuilds exactly the same state', () => {
  const db = seed();
  const genesis = [{ changes: COLLECTIONS.flatMap((c) => db[c].map((r) => ({ c, id: r.id, data: r }))) }];
  const { next } = execute(db, 'gap.raise', { id: 'G-X', key: 'T3:quantity', v: { message: 'Please check' } }, ctx('sonar'));
  const entries = [...genesis, { changes: diff(db, next) }];
  const rebuilt = replay(entries, db.tenantId);
  for (const c of COLLECTIONS) assert.deepEqual(rebuilt[c], next[c], c);
});

test('the waste trader cannot edit someone else\'s batch; the recycler cannot sign for them', () => {
  const db = seed();
  assert.throws(() => execute(db, 'batch.step', { lot: 'L-W1', step: 'sort', v: {} }, ctx('recy')), CommandError);
  assert.throws(() => execute(db, 'receipt.countersign', { transfer: 'T1' }, ctx('recy')), /not signed yet/);
});

test('full waste flow: trader signs offline-style, recycler countersigns, check passes', () => {
  let db = seed();
  const steps = [
    ['sources', { src_name_0: 'Anwar Knit Composite', src_kg_0: '2300', src_date_0: '2026-06-16', src_kind_0: 'Cutting waste',
      src_name_1: 'Fatullah Garments', src_kg_1: '1700', src_date_1: '2026-06-22', src_kind_1: 'Cutting waste',
      src_name_2: 'Siddhirganj Knitwear', src_kg_2: '1200', src_date_2: '2026-06-27', src_kind_2: 'Cutting waste' }],
    ['sort', { colourSort: 'White / ecru', fibre: '100% cotton', recycledType: 'pre-consumer', noElastane: 'on', noPrint: 'on' }],
    ['declare', { signer: 'Abdur Rahman', role: 'Owner', signature: 'data:image/png;base64,x' }],
  ];
  for (const [step, v] of steps) db = execute(db, 'batch.step', { lot: 'L-W1', step, v }, ctx('waste')).next;
  const r = execute(db, 'receipt.countersign', { transfer: 'T1' }, ctx('recy'));
  assert.match(r.summary, /Countersigned declaration RMD-RJT-2609-W1/);
  assert.equal(checkTransfer(r.next, r.next.transfers.find((x) => x.id === 'T1')).find((c) => c.id === 'countersign').status, 'pass');
  // Re-signing after a change invalidates the countersignature
  let d2 = execute(r.next, 'batch.step', { lot: 'L-W1', step: 'batch', v: { qty: '5250', slipNumber: 'WB-7781' } }, ctx('waste')).next;
  assert.equal(d2.lots.find((x) => x.id === 'L-W1').origin.declaration.signedOn, '');
  d2 = execute(d2, 'batch.step', { lot: 'L-W1', step: 'declare', v: { signer: 'Abdur Rahman', signature: 'data:image/png;base64,y' } }, ctx('waste')).next;
  d2.lots.find((x) => x.id === 'L-W1').origin.declaration.signedOn = '2026-09-25';
  assert.equal(checkTransfer(d2, d2.transfers.find((x) => x.id === 'T1')).find((c) => c.id === 'countersign').status, 'fail');
});

test('a supplier can run its own commands on its filtered view (offline mode)', () => {
  const view = filterState(seed(), 'waste');
  assert.ok(!view.transfers.some((t) => t.id === 'T3'));
  const r = execute(view, 'batch.step', { lot: 'L-W1', step: 'sort', v: { colourSort: 'White / ecru', fibre: '100% cotton', recycledType: 'pre-consumer', noElastane: 'on', noPrint: 'on' } }, ctx('waste'));
  assert.equal(r.next.lots.find((x) => x.id === 'L-W1').origin.contamination.noPrint, true);
  assert.equal(applyChanges(emptyState('sonar'), diff(emptyState('sonar'), r.next)).lots.length, r.next.lots.length);
});

test('material flow: kg per tier, recycled share, virgin input and failing handoffs', async () => {
  const { materialFlow } = await import('../app/js/engine/flow.js');
  const f = materialFlow(seed());
  const edge = (from, to) => f.edges.find((e) => e.from === from && e.to === to);
  assert.equal(edge('waste', 'recycler').kg, 5200);
  assert.equal(edge('recycler', 'spinner').recKg, 4000);
  assert.equal(edge('spinner', 'mill').recKg, 1200); // 3,000 kg yarn at 40%
  assert.equal(edge('spinner', 'mill').status, 'fail'); // T3 packing list
  const spin = f.nodes.find((n) => n.tier === 'spinner');
  assert.equal(spin.virginKg, 6015);
  assert.equal(f.nodes.find((n) => n.tier === 'recycler').lossKg, 770);
  assert.equal(edge('garment', 'buyer').claim, true);
});
