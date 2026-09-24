// Lookup helpers over the plain data object. The engine never mutates `db`.

export const org = (db, id) => db.orgs.find((o) => o.id === id);
export const lot = (db, id) => db.lots.find((l) => l.id === id);
export const transfer = (db, id) => db.transfers.find((t) => t.id === id);
export const processOf = (db, id) => db.processes.find((p) => p.id === id);
export const claim = (db, id) => db.claims.find((c) => c.id === id);

// Weight in kg of `qty` units of a lot (garments are counted in pieces).
export function kgOf(l, qty) {
  return l.unit === 'pcs' ? qty * (l.kgPerUnit || 0) : qty;
}

// Weight that carries the recycled claim. For garments this is the fibre in the
// body fabric and rib; sewing thread and labels are trims and carry no claim.
export function fibreKgOf(l, qty) {
  return l.unit === 'pcs' ? qty * (l.fibreKgPerUnit ?? l.kgPerUnit ?? 0) : qty;
}

// Recycled share of a transfer, as stated on its TC, falling back to the lot's own figure.
export function transferPct(db, t) {
  if (t.tc && Number.isFinite(t.tc.recycledPct)) return t.tc.recycledPct;
  return lot(db, t.lotId)?.recycledPct ?? 0;
}

// Kg physically received (buyer's goods-in weight, else declared quantity).
export function transferKgIn(db, t) {
  const l = lot(db, t.lotId);
  return kgOf(l, Number.isFinite(t.receivedQty) ? t.receivedQty : t.qty);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function pctDiff(a, b) {
  if (!b) return a ? Infinity : 0;
  return (Math.abs(a - b) / b) * 100;
}

export const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
