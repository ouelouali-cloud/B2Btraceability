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

## The concept

**Read [docs/CONCEPT.md](docs/CONCEPT.md) first.** Also in `docs/`: [GO-TO-MARKET.md](docs/GO-TO-MARKET.md) (who buys it, where to host the pilot), [USER-GUIDE.md](docs/USER-GUIDE.md) (each role, and every document each tier supplies), [ARCHITECTURE.md](docs/ARCHITECTURE.md) (data model, checks, roadmap), and `handbook.html` (all of it on one page).

In short:

1. **Each company enters what it did.** The waste trader declares each batch on a phone, and the form works offline. The recycler books goods-in, countersigns the declaration, records sorting and shredding, and ships fibre with a TC. The spinner, mill and manufacturer record their receipts, production runs and documents.
2. **Every entry becomes a line in an append-only, hash-linked ledger.** Nothing is ever overwritten, and any edit to history is detectable.
3. **The ledger becomes a live material flow:** kg in, out, lost and in stock at every tier, updated on every connected screen as entries land.
4. **Checks decide the claim.** They cover origin, documents and mass balance. A failing check becomes a gap for the company that owns the data. The claim is released only when every check back to the waste passes.

## Run it

```bash
npm start     # real backend on http://localhost:4173 (Node 22.5+, no npm install)
npm test      # engine, command and server tests
```

- **Server mode (`npm start`).** It uses SQLite (`data/threadback.db`), accounts with sessions, and live updates over Server-Sent Events. Demo accounts use the password `demo`: sign in as the manufacturer on a laptop and as the waste trader on a phone to watch data flow. `DEMO=0` disables the demo accounts; `PORT` and `DB_FILE` configure the rest.
- **Offline.** Once opened, the app is cached on the phone. Changes wait in an outbox and are sent in order when the connection returns.
- **Hosted demo (no server).** The same app runs the ledger inside the browser. Open two tabs as two companies to see live updates, and use *Simulate no connection* to try offline.

Planted gaps in the demo data (the **Demo guide** walks through fixing them):

- `L-W1`: the waste trader's declaration is incomplete: one factory missing (1,200 kg unaccounted for), a collection date missing, prints not checked, not signed. Once it is signed, the recycler must countersign it at goods-in.
- `T3`: the spinner's packing list shows gross weight (cones included): 3,180 kg against a TC of 3,000.
- `P4`: the garment maker booked 14,000 pcs, which needs 2,660 kg of fabric; only 2,590 kg was received.
- `L-W2`: a signed batch waiting in the recycler's goods-in queue.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | `{email, password}` → session token |
| GET | `/api/state` | Everything the signed-in company may see |
| POST | `/api/commands` | `{id, name, payload}`: the only way to write. `id` makes retries safe |
| GET | `/api/ledger` · `/api/ledger/verify` | Ledger entries; hash-chain check |
| GET | `/api/stream` | Live entries (Server-Sent Events) |
| GET/POST | `/api/invite/:token` · `/api/join` | Accept an invitation |

## Layout

```
server/            index.js (HTTP, API, live stream) · ledger.js (SQLite, hash chain) · auth.js
app/
  js/engine/       pure logic shared by phone and server:
                   commands, ledgerlog, visibility, flow, checks, ledger, trace, declaration, rules
  js/store.js      the app's state + offline outbox
  js/transport.js  talks to the server, or runs the ledger in the browser (hosted demo)
  js/views/        screens: manufacturer, supplier and recycler portals, waste declaration,
                   product sheet, material flow, ledger, how it works, sign-in
  sw.js            offline app shell
docs/CONCEPT.md    the concept on one page
docs/ARCHITECTURE.md  data model, check catalogue, roadmap
test/              engine, commands, server
```
