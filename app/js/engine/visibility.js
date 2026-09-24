// Who sees what. The manufacturer sees its whole chain. A supplier sees its
// own records, its direct trading partners, and nothing further away.
// The server applies this before anything leaves it.

import { COLLECTIONS } from './ledgerlog.js';

export function visibleIds(state, orgId) {
  if (orgId === state.tenantId) return null; // everything
  const me = state.orgs.find((o) => o.id === orgId);
  const transfers = state.transfers.filter((t) => t.fromOrg === orgId || t.toOrg === orgId);
  const partners = new Set([
    ...(me?.suppliesTo || []),
    ...state.orgs.filter((o) => (o.suppliesTo || []).includes(orgId)).map((o) => o.id),
    ...transfers.flatMap((t) => [t.fromOrg, t.toOrg]),
  ]);
  const lots = new Set([
    ...state.lots.filter((l) => l.orgId === orgId).map((l) => l.id),
    ...transfers.map((t) => t.lotId),
    // Waste batches addressed to me (signed or in progress), so a recycler can book goods-in.
    ...state.lots.filter((l) => l.origin && (state.orgs.find((o) => o.id === l.orgId)?.suppliesTo || []).includes(orgId)).map((l) => l.id),
  ]);
  // Also known by name: the manufacturer asking for the data, whoever invited
  // me, and anyone who raised a gap with me.
  const known = [state.tenantId, me?.invitedBy, ...state.gaps.filter((g) => g.owner === orgId).map((g) => g.raisedBy)].filter(Boolean);
  return {
    orgs: new Set([orgId, ...partners, ...known]),
    lots,
    transfers: new Set(transfers.map((t) => t.id)),
    processes: new Set(state.processes.filter((p) => p.orgId === orgId).map((p) => p.id)),
    claims: new Set(state.claims.filter((c) => lots.has(c.lotId)).map((c) => c.id)),
    gaps: new Set(state.gaps.filter((g) => g.owner === orgId || g.raisedBy === orgId).map((g) => g.id)),
  };
}

export function filterState(state, orgId) {
  const ids = visibleIds(state, orgId);
  if (!ids) return state;
  const out = { ...state };
  for (const c of COLLECTIONS) out[c] = state[c].filter((r) => ids[c].has(r.id));
  // Partners are shown by name and tier only.
  out.orgs = out.orgs.map((o) => (o.id === orgId ? o : { id: o.id, name: o.name, tier: o.tier, city: o.city, country: o.country, status: o.status, suppliesTo: o.suppliesTo, sc: o.sc, email: '' }));
  return out;
}

// A ledger entry is visible if it was mine, or touched a record I can see.
export function entryVisible(state, orgId, entry) {
  const ids = visibleIds(state, orgId);
  if (!ids) return true;
  if (entry.actor === orgId) return true;
  return entry.changes.some((ch) => ids[ch.c]?.has(ch.id));
}
