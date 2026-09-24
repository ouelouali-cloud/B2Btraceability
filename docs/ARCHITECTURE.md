# Architecture and product notes

## Design reference

The design takes cues from TrusTrace and TextileGenesis. From TrusTrace it takes the supplier invitations that cascade tier by tier and the per-supplier data-completeness scores. From TextileGenesis it takes the idea of a TC-anchored handoff between tiers. The difference is the target: those tools start from the brand. Threadback starts from the **garment manufacturer** and pushes hardest on the tiers they miss, the waste trader and the recycler.

## Data model

Everything is one plain JSON object (`app/js/seed.js`). It maps one-to-one to relational tables when a backend is added.

| Entity | Key fields | Notes |
|---|---|---|
| `org` | tier, country, status (`invited`/`active`), invitedBy, suppliesTo, `sc` {number, standard, body, validFrom, validTo, scope[]} | Scope certificate is embedded; one per org for now |
| `lot` | orgId, material, qty, unit (`kg`/`pcs`), kgPerUnit, recycledPct, recycledType, producedBy, `origin` | `origin` only on waste lots (the reclaimed material declaration) |
| `transfer` | fromOrg, toOrg, lotId, date, qty, receivedQty, `tc`, `docs` {PO, INVOICE, PACKING, BL} | The handoff. Each document stores the values *as printed* so they can be cross-checked |
| `process` | orgId, type, inputs[{transferId, kg}], nonClaimed[{material, kg}], outputLotId, consumption, records[] | Inputs point at receipts, so over-consumption is detectable |
| `claim` | lotId, buyer, pcs, recycledPct, text | The outgoing recycled content claim |
| `gap` | key (`subjectId:checkId`), owner, raisedBy, status, thread[] | Linked to a check by key and closed automatically when the check passes |

Checks are **never stored**. They are recomputed from the data on every change, so a corrected document immediately changes the verdict everywhere.

## Check catalogue (`app/js/engine/checks.js`, `trace.js`)

| Group | Check | Rule | Owner if failing |
|---|---|---|---|
| Origin | Reclaimed material declaration | Sources, collection period, pre/post-consumer, sort, declaration number, signed | Waste source |
| Verify | Transaction certificate | Present for certified tiers, not dated before shipment | Seller |
| Verify | Scope certificate valid | SC covers the shipment date | Seller |
| Verify | Product in scope | Lot material listed on SC | Seller |
| Verify | Documents complete | PO, invoice, packing list; B/L if cross-border | Seller |
| Verify | Seller and buyer match | Names identical on all docs; near-match = warning | Seller |
| Verify | Dates line up | Docs within 45 days of shipment (warning) | Seller |
| Verify | Recycled % consistent | TC = PO spec = lot, ±0.5 pt | Seller |
| Reconcile | Quantities reconcile | TC = invoice = packing list = B/L = received, ±2% | Seller (buyer if only goods-in is off) |
| Reconcile | Inputs covered by receipts | kg consumed ≤ kg received per shipment | Processor |
| Reconcile | Yield plausible | Within range per process type (warning) | Processor |
| Reconcile | Recycled % supported | Declared output % ≤ recycled kg in / total kg in | Processor |
| Reconcile | Fabric consumption | pcs × kg/pc (marker) ≤ fabric kg used | Garment maker |
| Claim | Pieces available, composition, ≥20% minimum, ledger credit, upstream chain all green | | Garment maker |

All tolerances live in `app/js/engine/rules.js`.

## Recommendations beyond the brief

1. **Sell to the garment maker, and let each tier invite the next.** The manufacturer usually doesn't know who the recycler is, and the spinner won't reveal it to them. Cascading invitations follow the existing commercial relationships. Each supplier sees only its direct buyer and seller. The manufacturer sees the chain, never prices.
2. **Treat the waste source as a first-class tier even though it is uncertified.** GRS doesn't certify jhut traders, which is exactly why the data is weakest there. Give them a phone-friendly form: a photo of the weighbridge slip, a list of source factories, a signature. That form should be the most polished screen in the product.
3. **Store documents as values, not just as files.** A PDF is proof; the numbers on it are what reconcile. Capture the values (later by OCR on the upload) so checks can run.
4. **Make gaps self-closing.** People don't click "resolve". A gap tied to a check closes itself when the data is fixed, and it leaves an audit trail an auditor can read.
5. **Keep units honest.** Record gross versus net weight, moisture, and cones explicitly. In the demo, the T3 gap is a gross-weight packing list, which is the most common false alarm in yarn.
6. **Plan for the loop.** Sonar's cutting room produces ~280 kg of jhut from this order. Recording it as a new waste lot would make the manufacturer the waste source of the next chain.

## Roadmap after the prototype

1. Backend: Postgres with the tables above, per-organisation row-level access, append-only event log (the ledger must be immutable; corrections are new entries).
2. Real invitations: email magic links, supplier onboarding, and uploading SC and TC PDFs with OCR of number, dates, quantities.
3. TC authenticity: check TC numbers against Textile Exchange's TC database / certification body registers.
4. Multiple inputs and outputs per production run, partial lots, lot splitting and merging, metres ↔ kg for woven fabric.
5. Claims module: several claims per lot, per-buyer claim documents, export an audit pack (all docs + ledger) per claim.
6. Post-consumer waste (sorted used garments), which needs a different origin declaration.

## Open questions for you

- Who pays? Manufacturer seat licence, or per claim/audit pack?
- GRS only, or RCS too (lower threshold, 5%+)? The rules file supports both, but the claim wording differs.
- Knit only (sold by kg) or woven too (sold by metre)? Woven adds a width × GSM conversion at the mill.
