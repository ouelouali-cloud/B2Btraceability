# Architecture and product notes

## Design reference

The design takes cues from TrusTrace and TextileGenesis. From TrusTrace it takes the supplier invitations that cascade tier by tier and the per-supplier data-completeness scores. From TextileGenesis it takes the idea of a TC-anchored handoff between tiers. The difference is the target: those tools start from the brand. Threadback starts from the **garment manufacturer** and pushes hardest on the tiers they miss, the waste trader and the recycler.

## Data model

The state is one plain JSON object with six collections (`orgs`, `lots`, `transfers`, `processes`, `claims`, `gaps`). It is never stored directly. The server stores the **ledger** (SQLite table `entries`: seq, time, company, user, command, command id, summary, changed records, previous hash, hash) and rebuilds the state by replaying it. Users, sessions and invitations sit in their own tables. See [CONCEPT.md](CONCEPT.md).

| Entity | Key fields | Notes |
|---|---|---|
| `org` | tier, country, status (`invited`/`active`), invitedBy, suppliesTo, `sc` {number, standard, body, validFrom, validTo, scope[]} | Scope certificate is embedded; one per org for now |
| `lot` | orgId, material, qty, unit (`kg`/`pcs`), kgPerUnit, fibreKgPerUnit, recycledPct, recycledType, producedBy, `origin`, `product` | `origin` only on waste lots: slip number and photo, bags, sources[{name, kind, city, kg, collectedOn}], colour and fibre sort, contamination checks, declaration {signer, role, signature, paperPhoto, signedOn, number}. `product` only on garment lots: spec, sizes, BOM, colourway, photo |
| `transfer` | fromOrg, toOrg, lotId, date, qty, receivedQty, `tc`, `docs` {PO, INVOICE, PACKING, BL}, `goodsIn` {gate slip, moisture %}, `countersign` {by, at, declaration, signedOn} | The handoff. Each document stores the values *as printed* so they can be cross-checked. For waste, the recycler creates the transfer at goods-in |
| `process` | orgId, type, inputs[{transferId, kg}], nonClaimed[{material, kg}], outputLotId, consumption, records[] | Inputs point at receipts, so over-consumption is detectable |
| `claim` | lotId, buyer, pcs, recycledPct, text | The outgoing recycled content claim |
| `gap` | key (`subjectId:checkId`), owner, raisedBy, status, thread[] | Linked to a check by key and closed automatically when the check passes |

Checks are **never stored**. They are recomputed from the data on every change, so a corrected document immediately changes the verdict everywhere.

## Check catalogue (`app/js/engine/checks.js`, `trace.js`)

| Group | Check | Rule | Owner if failing |
|---|---|---|---|
| Origin | Reclaimed material declaration | Slip number, sources with kg and date, colour and fibre sort, no elastane or prints, pre/post-consumer, signed | Waste source |
| Origin | Every kg traced to a factory | Sum of source kg = batch weight, ±2% | Waste source |
| Verify | Declaration countersigned at goods-in | Recycler confirmed the delivery against the signed declaration; void if the declaration is re-signed | Recycler |
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
| Claim | Pieces available, composition, ≥20% minimum, ledger credit, upstream chain all green | Credit counts fibre weight only (trims excluded) | Garment maker |

All tolerances live in `app/js/engine/rules.js`.

## Recommendations beyond the brief

1. **Sell to the garment maker, and let each tier invite the next.** The manufacturer usually doesn't know who the recycler is, and the spinner won't reveal it to them. Cascading invitations follow the existing commercial relationships. Each supplier sees only its direct buyer and seller. The manufacturer sees the chain, never prices.
2. **Treat the waste source as a first-class tier even though it is uncertified.** GRS doesn't certify jhut traders, which is exactly why the data is weakest there. The prototype gives them a four-step phone form with Bangla labels, photo capture, and a finger signature. Changing any figure after signing clears the signature, so a signed declaration always matches the data.
3. **Store documents as values, not just as files.** A PDF is proof; the numbers on it are what reconcile. Capture the values (later by OCR on the upload) so checks can run.
4. **Make gaps self-closing.** People don't click "resolve". A gap tied to a check closes itself when the data is fixed, and it leaves an audit trail an auditor can read.
5. **Keep units honest.** Record gross versus net weight, moisture, and cones explicitly. In the demo, the T3 gap is a gross-weight packing list, which is the most common false alarm in yarn.
6. **Plan for the loop.** Sonar's cutting room produces ~280 kg of jhut from this order. Recording it as a new waste lot would make the manufacturer the waste source of the next chain.

## Roadmap

Done (MVP): backend with SQLite and a hash-linked ledger; accounts, sessions, invitation links, password change, login throttling, session expiry, security headers; permissions and visibility enforced on the server; live updates; offline waste form with outbox; recycler goods-in and countersigning; claims to buyers; evidence pack per claim with read-only share links, download and print; document scans stored by SHA-256 fingerprint; product sheets; notifications (stored, and sent through a webhook); in-app inbox; setup for a real network; backups; Docker and deployment guide.

Next:
1. Reading TC and invoice scans automatically (OCR) and checking TC numbers against Textile Exchange's database.
4. Multiple inputs and outputs per production run, lot splitting and merging, metres ↔ kg for woven fabric.
5. An audit pack per claim: all documents, the ledger lines and the hash-chain proof, exported for the certification body.
6. Postgres and multi-tenant hosting once more than one manufacturer uses it (the engine does not change).

## Open questions for you

- Decided: GRS only; knitted fabric only for now.
- Decided: the waste form works offline; the recycler countersigns each declaration at goods-in.
- Who pays, and where the pilot is hosted: see [GO-TO-MARKET.md](GO-TO-MARKET.md).
