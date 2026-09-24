// Mass-balance bookkeeping, one account per organisation, kept in kg of
// recycled content. Two columns:
//   input  – recycled kg sitting in received material not yet processed
//   credit – recycled kg in produced output that may still be claimed
// Nothing may leave the credit column that production did not put there.

import { lot, kgOf, transferPct, transferKgIn } from './db.js';
import { processBalance } from './checks.js';

export function ledger(db, orgId) {
  const rows = [];

  for (const l of db.lots) {
    if (l.orgId === orgId && l.origin) {
      rows.push({ date: l.origin.collectionTo || l.createdAt, kind: 'collected', ref: l.id,
        note: `Waste collected, ${kgOf(l, l.qty).toLocaleString('en-GB')} kg`, input: 0, credit: kgOf(l, l.qty) * l.recycledPct / 100 });
    }
  }
  for (const t of db.transfers) {
    if (t.toOrg === orgId) {
      const kg = transferKgIn(db, t);
      rows.push({ date: t.date, kind: 'received', ref: t.id,
        note: `Received ${kg.toLocaleString('en-GB')} kg at ${transferPct(db, t)}%`, input: kg * transferPct(db, t) / 100, credit: 0 });
    }
  }
  for (const p of db.processes) {
    if (p.orgId === orgId) {
      const b = processBalance(db, p);
      rows.push({ date: p.date, kind: 'produced', ref: p.id,
        note: `Consumed ${b.recIn.toFixed(0)} kg recycled, output carries ${b.recOut.toFixed(0)} kg`,
        input: -b.recIn, credit: b.recOut, loss: b.recIn - b.recOut });
    }
  }
  for (const t of db.transfers) {
    if (t.fromOrg === orgId) {
      const l = lot(db, t.lotId);
      const kg = kgOf(l, t.qty);
      rows.push({ date: t.date, kind: 'shipped', ref: t.id,
        note: `Shipped ${t.qty.toLocaleString('en-GB')} ${l.unit} at ${transferPct(db, t)}%`, input: 0, credit: -kg * transferPct(db, t) / 100 });
    }
  }
  for (const c of db.claims) {
    const l = lot(db, c.lotId);
    if (l && l.orgId === orgId) {
      rows.push({ date: c.date, kind: 'claimed', ref: c.id,
        note: `Claim to buyer: ${c.pcs.toLocaleString('en-GB')} pcs at ${c.recycledPct}%`, input: 0, credit: -kgOf(l, c.pcs) * c.recycledPct / 100 });
    }
  }

  const order = { collected: 0, received: 1, produced: 2, shipped: 3, claimed: 4 };
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));

  let input = 0;
  let credit = 0;
  let loss = 0;
  let firstNegative = null;
  for (const r of rows) {
    input += r.input;
    credit += r.credit;
    loss += r.loss || 0;
    r.inputBal = input;
    r.creditBal = credit;
    if (credit < -0.5 && !firstNegative) firstNegative = r;
  }
  return { rows, input, credit, loss, firstNegative };
}

// Stock left on each lot (produced minus shipped/claimed).
export function lotRemaining(db, l) {
  const shipped = db.transfers.filter((t) => t.lotId === l.id).reduce((s, t) => s + t.qty, 0);
  const claimed = db.claims.filter((c) => c.lotId === l.id).reduce((s, c) => s + c.pcs, 0);
  return l.qty - shipped - claimed;
}

