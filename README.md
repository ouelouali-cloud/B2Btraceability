# Threadback (B2Btraceability)

A chain-of-custody and mass-balance ledger for recycled feedstock. It connects a finished garment to the textile waste it was made from. The manufacturer invites its suppliers. Each supplier files its own data: where the material came from, the documents behind each shipment, and each production run. The ledger then reconciles every handoff and decides whether a recycled content claim can be released.

This is the first prototype. It is deliberately narrow.

## The niche

**Pre-consumer cotton cutting waste (jhut) from Bangladeshi garment factories → mechanically recycled cotton → 40% recycled-cotton T-shirts for an EU brand, under GRS.**

| Tier | Demo company | Output | Evidence |
|---|---|---|---|
| Waste source | Rahman Jhut Traders | Cutting waste, kg | Reclaimed material declaration (no certificate) |
| Recycler | GreenFibre Recycling | Recycled cotton fibre | GRS scope cert + TC |
| Spinner | Meghna Spinning Mills | OE yarn, 40% recycled + 60% virgin | GRS scope cert + TC |
| Fabric mill | Dhaka Knit Fabrics | Dyed single jersey | GRS scope cert + TC |
| Garment maker (**the customer**) | Sonar Apparel | T-shirts, pcs | GRS scope cert, makes the claim |
| EU buyer | Nordvik Basics | Receives the claim | |

Scope decisions:
- **GRS only.** A certified product claim needs at least 20% recycled content. The GRS logo on product needs at least 50%, so the 40% demo tee carries a text claim only, and the product page says so.
- **Knitted fabric only.** Single jersey is traded by kg, so one unit runs from waste to garment. Mechanically recycled cotton has short fibres that suit open-end yarn and jersey tees. Woven fabric would add a metres-to-kg conversion at the mill; that comes later.

Why this niche: the jhut trade is informal and cash-based, so the evidence breaks at the very first handoff. Mechanically recycled cotton is short-fibre and always blended with virgin cotton, so the spinner is where the recycled % is decided. And garment cutting produces new jhut, so the chain can later close into a loop.

## Your three questions, mapped to the product

1. **Origin: where did the material come from?** Each waste batch carries a *reclaimed material declaration*, filled in by the waste trader on a phone in four steps: the batch (weight, bags, a photo of the weighbridge slip), the sources (one card per factory with kg and collection date), the sort (colour, fibre, no elastane, no prints), and a finger signature. Labels are in English and Bangla. Every kg must be traced to a named factory: 4,000 of 5,200 kg is a gap. The recycler, the first certified tier, needs this for every batch it buys.
2. **Documentation: who handled it?** Every handoff between tiers is a *shipment* with a TC, PO, invoice, packing list (plus B/L if exported) and the buyer's goods-in weight. They are cross-checked line by line against each other.
3. **Mass balance: how can I prove my claim?** Every organisation has a ledger in kg of recycled content. Receipts add input. Production turns input into credit, minus process loss. Shipments and claims draw credit down, and credit can never go below zero. Inside each tier, yield, blend ratio and (for garments) pieces × fabric consumption must reconcile.

The finished garment has a **product sheet**: a front sketch in its colourway (or an uploaded photo), spec, size breakdown, bill of materials, and the hang-tag claim with the certification body and licence number. Only the fibre carries the claim. Sewing thread and labels are trims, so the ledger credits 158 g of each 165 g tee, not 165 g.

A failing check becomes a **gap**, which is an evidence request sent to the supplier who owns the data. The gap **closes itself** when the corrected data makes the check pass. The claim stays held until every check back to the waste source passes.

## Run it

```bash
npm start     # http://localhost:4173, no install needed (Node 18+)
npm test      # engine tests, node:test
```

Use **Viewing as** in the top bar to switch between the manufacturer and each supplier. **Demo guide** walks through closing the three planted gaps:

- `L-W1`: the waste trader's declaration is incomplete: one factory missing (1,200 kg unaccounted for), a collection date missing, prints not checked, not signed
- `T3`: the spinner's packing list shows gross weight (cones included): 3,180 kg against a TC of 3,000
- `P4`: the garment maker booked 14,000 pcs, which needs 2,660 kg of fabric; only 2,590 kg was received

Data lives in the browser's localStorage. **Reset demo** restores it.

## Layout

```
app/
  index.html, styles.css
  js/engine/     pure logic, no DOM: rules, checks, ledger, trace (tested in Node)
  js/views/      manufacturer views, supplier portal, detail pages,
                 declare.js (waste declaration wizard), product.js (product sheet + sketch)
  js/forms.js    every data-entry form
  js/store.js    persistence (swap for an API later)
  js/seed.js     demo chain with planted gaps
docs/ARCHITECTURE.md   data model, check catalogue, recommendations, roadmap
test/engine.test.js
```
