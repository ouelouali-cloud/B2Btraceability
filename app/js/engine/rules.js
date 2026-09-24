// Reference data and the tolerances every check uses.
// Kept in one place so a compliance lead can read (and later edit) the rules.

// The chain, most upstream first. `certRequired`: must this tier hold a
// scope certificate and issue transaction certificates for what it ships?
export const TIERS = {
  waste:    { order: 0, label: 'Waste source',   output: 'Cutting waste (jhut)', certRequired: false, icon: 'waste' },
  recycler: { order: 1, label: 'Recycler',       output: 'Recycled fibre',       certRequired: true,  icon: 'recycler' },
  spinner:  { order: 2, label: 'Spinner',        output: 'Blended yarn',         certRequired: true,  icon: 'spinner' },
  mill:     { order: 3, label: 'Fabric mill',    output: 'Knitted fabric',       certRequired: true,  icon: 'mill' },
  garment:  { order: 4, label: 'Garment maker',  output: 'T-shirts',             certRequired: true,  icon: 'garment' },
  buyer:    { order: 5, label: 'EU buyer / brand', output: 'Makes the claim',    certRequired: false, icon: 'buyer' },
};

export const MATERIALS = {
  'cotton-cutting-waste':  { label: 'Pre-consumer cotton cutting waste', unit: 'kg', tier: 'waste' },
  'recycled-cotton-fibre': { label: 'Mechanically recycled cotton fibre', unit: 'kg', tier: 'recycler' },
  'virgin-cotton-fibre':   { label: 'Virgin cotton fibre', unit: 'kg', tier: null },
  'oe-yarn-rco':           { label: 'Open-end yarn, recycled / virgin cotton', unit: 'kg', tier: 'spinner' },
  'single-jersey':         { label: 'Single jersey fabric, dyed', unit: 'kg', tier: 'mill' },
  'tshirt':                { label: 'Crew-neck T-shirt', unit: 'pcs', tier: 'garment' },
};

// Production steps. `yield` is the plausible range of output kg / input kg, in %.
// Outside the range is not proof of fraud, but it is the first thing an auditor asks about.
export const PROCESS_TYPES = {
  sorting:         { label: 'Sorting & shredding', tier: 'recycler', yield: [80, 95] },
  spinning:        { label: 'Blending & spinning', tier: 'spinner',  yield: [80, 92] },
  knitting_dyeing: { label: 'Knitting & dyeing',   tier: 'mill',     yield: [85, 97] },
  cut_sew:         { label: 'Cutting & sewing',    tier: 'garment',  yield: [75, 92] },
};

export const DOC_TYPES = {
  PO:      { label: 'Purchase order',        short: 'PO',   fields: ['qty', 'recycledPct', 'parties', 'date'] },
  INVOICE: { label: 'Invoice',               short: 'Inv.', fields: ['qty', 'parties', 'date'] },
  PACKING: { label: 'Packing list / weighbridge slip', short: 'PL', fields: ['qty', 'parties', 'date'] },
  BL:      { label: 'Bill of lading',        short: 'B/L',  fields: ['qty', 'parties', 'date'] },
};

export const RULES = {
  qtyTolerancePct: 2,          // TC vs invoice vs packing list vs received
  compositionTolerancePts: 0.5, // recycled % points
  docWindowDays: 45,           // commercial docs should sit close to the shipment date
  minClaimPct: 20,             // GRS minimum recycled content for a product claim
  scExpiryWarnDays: 60,
};

// Documents a handoff must carry. Cross-border shipments also need a B/L.
export function requiredDocs(seller, buyer) {
  const docs = ['PO', 'INVOICE', 'PACKING'];
  if (seller && buyer && seller.country !== buyer.country) docs.push('BL');
  return docs;
}
