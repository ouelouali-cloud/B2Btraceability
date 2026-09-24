// The material flow: kg moving tier by tier, built from the same records the
// checks use. Nodes are tiers; edges are shipments between tiers (and claims
// to the buyer). Each edge carries its total kg, the recycled kg inside it,
// and the worst check status of the shipments it groups.

import { TIERS } from './rules.js';
import { org, lot, kgOf, fibreKgOf, transferPct, transferKgIn } from './db.js';
import { checkTransfer, processBalance, consumedByTransfer, worst } from './checks.js';
import { claimStatus } from './trace.js';
import { lotRemaining } from './ledger.js';

export const FLOW_TIERS = ['waste', 'recycler', 'spinner', 'mill', 'garment', 'buyer'];

export function materialFlow(db) {
  const tierOf = (orgId) => org(db, orgId)?.tier;
  const nodes = Object.fromEntries(FLOW_TIERS.map((t) => [t, {
    tier: t, label: TIERS[t].label, orgs: [], inKg: 0, virginKg: 0, producedKg: 0, shippedKg: 0, lossKg: 0, stockKg: 0,
  }]));
  for (const o of db.orgs) if (nodes[o.tier] && o.status !== 'invited') nodes[o.tier].orgs.push(o.name);

  // Waste is "produced" by collection.
  for (const l of db.lots) if (l.origin) nodes.waste.producedKg += l.qty;

  const edges = new Map();
  const edge = (from, to) => {
    const k = `${from}>${to}`;
    if (!edges.has(k)) edges.set(k, { from, to, kg: 0, recKg: 0, statuses: [], ids: [] });
    return edges.get(k);
  };

  for (const t of db.transfers) {
    const from = tierOf(t.fromOrg);
    const to = tierOf(t.toOrg);
    const l = lot(db, t.lotId);
    if (!from || !to || !l) continue;
    const e = edge(from, to);
    const kg = kgOf(l, t.qty);
    e.kg += kg;
    e.recKg += fibreKgOf(l, t.qty) * transferPct(db, t) / 100;
    e.statuses.push(worst(checkTransfer(db, t)));
    e.ids.push(t.id);
    nodes[from].shippedKg += kg;
    nodes[to].inKg += transferKgIn(db, t);
  }
  for (const c of db.claims) {
    const l = lot(db, c.lotId);
    if (!l) continue;
    const e = edge(tierOf(l.orgId), 'buyer');
    const kg = kgOf(l, c.pcs);
    e.kg += kg;
    e.recKg += fibreKgOf(l, c.pcs) * c.recycledPct / 100;
    e.statuses.push(claimStatus(db, c).status === 'ready' ? 'pass' : 'fail');
    e.ids.push(c.id);
    e.claim = true;
    nodes[tierOf(l.orgId)].shippedKg += kg;
    nodes.buyer.inKg += kg;
  }

  const used = consumedByTransfer(db);
  for (const p of db.processes) {
    const n = nodes[tierOf(p.orgId)];
    if (!n) continue;
    const b = processBalance(db, p);
    n.producedKg += b.outKg;
    n.lossKg += b.lossKg;
    n.virginKg += b.otherIn;
  }
  for (const t of db.transfers) {
    const n = nodes[tierOf(t.toOrg)];
    if (n) n.stockKg += Math.max(0, transferKgIn(db, t) - (used[t.id] || 0));
  }
  for (const l of db.lots) {
    const n = nodes[tierOf(l.orgId)];
    if (n) n.stockKg += Math.max(0, kgOf(l, lotRemaining(db, l)));
  }

  const list = [...edges.values()].map((e) => ({ ...e, status: worst(e.statuses.map((s) => ({ status: s }))) }));
  const totals = {
    recycledKg: list.filter((e) => e.from === 'waste').reduce((s, e) => s + e.recKg, 0),
    stockKg: Object.values(nodes).reduce((s, n) => s + n.stockKg, 0),
    lossKg: Object.values(nodes).reduce((s, n) => s + n.lossKg, 0),
  };
  return { nodes: FLOW_TIERS.map((t) => nodes[t]), edges: list, totals };
}
