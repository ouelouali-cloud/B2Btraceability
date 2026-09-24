// The ledger: an append-only list of entries. Each entry says who did what,
// when, and exactly which records changed. Each entry's hash covers the hash
// of the entry before it, so rewriting history breaks the chain visibly.
// Current state is nothing more than all the changes, replayed in order.

export const COLLECTIONS = ['orgs', 'lots', 'transfers', 'processes', 'claims', 'gaps'];

export function emptyState(tenantId) {
  return { version: 3, tenantId, orgs: [], lots: [], transfers: [], processes: [], claims: [], gaps: [] };
}

// Which records differ between two states: [{ c: collection, id, data | null }]
export function diff(a, b) {
  const out = [];
  for (const c of COLLECTIONS) {
    const before = new Map(a[c].map((r) => [r.id, r]));
    const after = new Map(b[c].map((r) => [r.id, r]));
    for (const [id, r] of after) if (!before.has(id) || JSON.stringify(before.get(id)) !== JSON.stringify(r)) out.push({ c, id, data: r });
    for (const id of before.keys()) if (!after.has(id)) out.push({ c, id, data: null });
  }
  return out;
}

export function applyChanges(state, changes) {
  for (const { c, id, data } of changes) {
    const list = state[c];
    const i = list.findIndex((r) => r.id === id);
    if (data === null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = data; else list.push(data);
  }
  return state;
}

export function replay(entries, tenantId) {
  const s = emptyState(tenantId);
  for (const e of entries) applyChanges(s, e.changes);
  return s;
}

// The exact text that gets hashed. Key order is fixed so every runtime agrees.
export function hashInput(e) {
  return JSON.stringify([e.seq, e.at, e.actor, e.user, e.command, e.summary, e.changes, e.prev]);
}

export const GENESIS = '0'.repeat(64);

// `sha256` may be sync (Node) or async (browser); both are awaited.
export async function verifyChain(entries, sha256) {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev !== prev) return { ok: false, brokenAt: e.seq, reason: 'Entry does not point at the one before it.' };
    const h = await sha256(hashInput(e));
    if (h !== e.hash) return { ok: false, brokenAt: e.seq, reason: 'Entry content does not match its hash.' };
    prev = e.hash;
  }
  return { ok: true, count: entries.length, head: prev };
}
