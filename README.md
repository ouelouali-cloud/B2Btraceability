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

Why this niche: the jhut trade is informal and cash-based, so the evidence breaks at the very first handoff. Mechanically recycled cotton is short-fibre and always blended with virgin cotton, so the spinner is where the recycled % is decided. And garment cutting produces new jhut, so the chain can later close into a loop.

## Your three questions, mapped to the product

1. **Origin: where did the material come from?** The waste lot carries a *reclaimed material declaration*: source factories, collection period, pre- or post-consumer, colour sort, and a signed declaration. The recycler, the first certified tier, needs this for every lot it buys.
2. **Documentation: who handled it?** Every handoff between tiers is a *shipment* with a TC, PO, invoice, packing list (plus B/L if exported) and the buyer's goods-in weight. They are cross-checked line by line against each other.
3. **Mass balance: how can I prove my claim?** Every organisation has a ledger in kg of recycled content. Receipts add input. Production turns input into credit, minus process loss. Shipments and claims draw credit down, and credit can never go below zero. Inside each tier, yield, blend ratio and (for garments) pieces × fabric consumption must reconcile.

A failing check becomes a **gap**, which is an evidence request sent to the supplier who owns the data. The gap **closes itself** when the corrected data makes the check pass. The claim stays held until every check back to the waste source passes.

## Run it

```bash
npm start     # http://localhost:4173, no install needed (Node 18+)
npm test      # engine tests, node:test
```

Use **Viewing as** in the top bar to switch between the manufacturer and each supplier. **Demo guide** walks through closing the three planted gaps:

- `L-W1`: the waste trader's origin declaration is incomplete
- `T3`: the spinner's packing list shows gross weight (cones included): 3,180 kg against a TC of 3,000
- `P4`: the garment maker booked 14,000 pcs, which needs 2,660 kg of fabric; only 2,590 kg was received

Data lives in the browser's localStorage. **Reset demo** restores it.

## Layout

```
app/
  index.html, styles.css
  js/engine/     pure logic, no DOM: rules, checks, ledger, trace (tested in Node)
  js/views/      manufacturer views, supplier portal, detail pages
  js/forms.js    every data-entry form
  js/store.js    persistence (swap for an API later)
  js/seed.js     demo chain with planted gaps
docs/ARCHITECTURE.md   data model, check catalogue, recommendations, roadmap
test/engine.test.js
```
