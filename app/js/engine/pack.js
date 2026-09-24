// The evidence pack: everything behind one claim, in one object. It is what
// the manufacturer sends its EU buyer and its certification body, and what a
// read-only share link shows. Built from the same state and checks as the app.

import { TIERS, PROCESS_TYPES, DOC_TYPES, MATERIALS, RULES, STANDARD } from './rules.js';
import { org, lot, fibreKgOf, kgOf } from './db.js';
import { processBalance, namedSources, collectionPeriod, worst } from './checks.js';
import { traceLot, chainSteps, claimStatus, treeChecks } from './trace.js';
import { ledger } from './ledger.js';

const orgCard = (o) => (o ? { id: o.id, name: o.name, tier: o.tier, tierLabel: TIERS[o.tier]?.label, city: o.city, country: o.country, sc: o.sc || null } : null);

export function evidencePack(db, claimId, { entries = [], verify = null, generatedAt = new Date().toISOString() } = {}) {
  const c = db.claims.find((x) => x.id === claimId);
  if (!c) return null;
  const l = lot(db, c.lotId);
  const status = claimStatus(db, c);
  const tree = traceLot(db, c.lotId);
  const steps = chainSteps(tree);
  const upstream = treeChecks(tree);

  const chain = steps.map((st) => {
    if (st.kind === 'handoff') {
      const t = st.transfer;
      const tl = lot(db, t.lotId);
      return {
        kind: 'handoff', id: t.id, date: t.date, qty: t.qty, unit: tl.unit, receivedQty: t.receivedQty ?? null,
        seller: orgCard(org(db, t.fromOrg)), buyer: orgCard(org(db, t.toOrg)), lotId: t.lotId, material: MATERIALS[tl.material]?.label,
        tc: t.tc || null,
        documents: Object.entries(t.docs || {}).map(([k, d]) => ({ type: k, label: DOC_TYPES[k]?.label || k, ...d })),
        goodsIn: t.goodsIn || null, countersign: t.countersign || null,
        status: worst(st.checks), checks: st.checks,
      };
    }
    const n = st.node;
    const p = n.process;
    const b = p ? processBalance(db, p) : null;
    return {
      kind: 'node', org: orgCard(n.org),
      lot: { id: n.lot.id, spec: n.lot.spec || MATERIALS[n.lot.material]?.label, qty: n.lot.qty, unit: n.lot.unit, recycledPct: n.lot.recycledPct, recycledType: n.lot.recycledType },
      process: p ? {
        id: p.id, label: PROCESS_TYPES[p.type]?.label, date: p.date, inKg: b.inKg, outKg: b.outKg, lossKg: b.lossKg,
        yieldPct: b.yieldPct, computedPct: b.computedPct, nonClaimed: p.nonClaimed || [], consumption: p.consumption || null,
        rejectsKg: p.rejectsKg ?? null, records: p.records || [],
      } : null,
      origin: n.lot.origin ? {
        ...n.lot.origin, sources: namedSources(n.lot), period: collectionPeriod(n.lot), qty: n.lot.qty,
      } : null,
      status: n.checks.length ? worst(n.checks) : 'pass', checks: n.checks,
    };
  });

  const ids = new Set([c.id, ...steps.flatMap((s) => (s.kind === 'handoff' ? [s.transfer.id, s.transfer.lotId] : [s.node.lot.id, s.node.process?.id].filter(Boolean)))]);
  const related = entries.filter((e) => (e.refs || []).some((r) => ids.has(r.split(':')[1])) || e.command === 'network.seed')
    .map((e) => ({ seq: e.seq, at: e.at, actorName: e.actorName, user: e.user, summary: e.summary, hash: e.hash, prev: e.prev }))
    .sort((a, b) => a.seq - b.seq);

  const maker = org(db, l.orgId);
  const documents = chain.filter((s) => s.kind === 'handoff').flatMap((h) => [
    ...(h.tc ? [{ handoff: h.id, label: 'Transaction certificate', number: h.tc.number, date: h.tc.date, qty: h.tc.qty, issuer: h.seller.name, file: h.tc.file || null }] : []),
    ...h.documents.map((d) => ({ handoff: h.id, label: d.label, number: d.number, date: d.date, qty: d.qty, issuer: d.seller, file: d.file || null })),
  ]);
  const certificates = [...new Map(chain.filter((s) => s.kind === 'node' && s.org.sc).map((s) => [s.org.id, { org: s.org.name, ...s.org.sc }])).values()];

  return {
    generatedAt, standard: STANDARD,
    claim: { id: c.id, text: c.text, pcs: c.pcs, recycledPct: c.recycledPct, buyerPo: c.buyerPo, date: c.date,
      recycledKg: fibreKgOf(l, c.pcs) * c.recycledPct / 100, garmentKg: kgOf(l, c.pcs),
      logoAllowed: c.recycledPct >= RULES.grsLogoMinPct },
    status: status.status, warn: status.warn, claimChecks: status.checks,
    upstreamSummary: { total: upstream.length, pass: upstream.filter((x) => x.status === 'pass').length,
      warn: upstream.filter((x) => x.status === 'warn').length, fail: upstream.filter((x) => x.status === 'fail').length },
    buyer: orgCard(org(db, c.buyer)), maker: orgCard(maker),
    product: l.product ? { ...l.product } : null,
    lot: { id: l.id, spec: l.spec, qty: l.qty, unit: l.unit, kgPerUnit: l.kgPerUnit, fibreKgPerUnit: l.fibreKgPerUnit, recycledPct: l.recycledPct },
    chain, documents, certificates,
    massBalance: ledger(db, maker.id),
    ledger: { entries: related, verify },
  };
}
