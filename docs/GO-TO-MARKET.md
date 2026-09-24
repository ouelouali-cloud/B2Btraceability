# Who buys Threadback, and where the pilot runs

Status: working hypothesis, September 2026. Every interview so far was in Bangladesh; none with EU buyers. Treat the EU side as untested.

## The short answer

There are two customers, and they are different people:

| | Bangladeshi manufacturer (Tier 1 exporter) | EU brand |
|---|---|---|
| Role | **User.** Does the work: collects TCs, chases suppliers, assembles the evidence for its buyer and its auditor | **Payer at scale.** Makes the claim to consumers and carries the legal risk for it |
| Pain | Buyers and auditors reject weak upstream evidence; orders and certification are at risk; much of the work is manual | Recycled claims must be substantiated; weak upstream data is a legal and reputational risk |
| Evidence you have | Interviews (Bangladesh) | None yet |
| Budget | Tight, and spent when a buyer requires it | Compliance and sustainability budgets; already pays for traceability tools |

**Recommendation: pilot with Bangladeshi manufacturers, and design the pilot to find out whether their EU buyers will pay.**

- Start where your access and evidence are: 1–2 Bangladeshi garment exporters making recycled-cotton products for EU buyers, each bringing its recycler and waste traders.
- The manufacturer's deliverable is the **evidence pack for one claim**: every TC, document, declaration, ledger line and check behind a shipment, ready to send to the buyer and the certification body. That's what "I need all documentation to export" means in practice.
- In every pilot, ask the manufacturer to introduce you to the EU buyer for that order. Show the buyer the pack and the live chain. Their reaction answers the payer question.

Why not start with EU brands? You would need EU interviews first, brand sales cycles are long, and brands buy from vendors who already have supplier networks, which is exactly what the Bangladesh pilot builds. Why not only manufacturers? They pay when a buyer requires something, so a manufacturer-only business depends on brands asking for it anyway.

Likely end state (to be confirmed): the brand pays and the manufacturer and its suppliers use it for free, or the manufacturer pays a small fee and the brand pays per supplier or per claim for access to the verified chain.

## Why EU rules make this urgent (verify before quoting)

These are the drivers as I understand them; check the current status before using them in a pitch.

- **Empowering Consumers for the Green Transition Directive (EU) 2024/825.** Member states apply it from 27 September 2026. It bans generic environmental claims that can't be substantiated, and sustainability labels not based on a certification scheme. A claim like "made with 40% recycled cotton" must be backed by evidence; GRS certification plus a clean chain of custody is that evidence.
- **Ecodesign for Sustainable Products Regulation (EU) 2024/1781.** Textiles are a priority product group. Requirements, including a Digital Product Passport, are expected in the next few years. A passport needs exactly the upstream data Threadback collects.
- **Textile extended producer responsibility** under the revised Waste Framework Directive: brands will pay fees per product placed on the EU market, likely with eco-modulation that rewards recycled content, which again needs proof.
- **Green Claims Directive:** proposed in 2023; its future was uncertain in 2025. Don't rely on it.

What this means for the pitch: EU brands carry the legal risk and will push it down to suppliers. The Bangladeshi manufacturer who can hand over a complete, checkable evidence pack wins and keeps orders.

## Interviews still missing

Before choosing the payer, speak to at least five EU brands or importers that sell recycled-cotton products (sourcing, compliance or sustainability managers). Suggested questions:

1. When a supplier says "40% recycled cotton", what evidence do you receive today? Who checks it?
2. Has a claim or a shipment ever been held because upstream evidence was missing? What happened?
3. Which tools do you use (TextileGenesis, TrusTrace, spreadsheets, certification bodies' portals)? What do they miss upstream of the spinner?
4. How are you preparing for the 2024/825 rules on environmental claims?
5. Would you pay for a verified chain back to the waste source? Per supplier, per claim, or per year? Who holds that budget?
6. Would you require your Bangladeshi suppliers to use a tool like this? Would you pay for them to use it?

Also ask 2–3 certification bodies (Control Union, OneCert, IDFL) or GRS auditors what evidence they reject most often. They may become a channel.

## Decision rule after the pilot

- If EU buyers ask for access and will pay: **brand-pays model**; suppliers free.
- If EU buyers value it but won't pay, and manufacturers win or keep orders because of it: **manufacturer-pays model** with low per-factory pricing, and the evidence pack as the product.
- If neither side will pay: the value is in certification audits. Test certification bodies as buyers (faster, cheaper audits from clean data).

## Where to host the pilot

Recommendation: **a cloud region in the EU (for example Frankfurt or Ireland).**

- The data is mostly business data (weights, documents, certificates). The personal data is small: names, emails, signatures. An EU region satisfies EU buyers' GDPR expectations from day one.
- Latency from Bangladesh to an EU region (roughly 150–200 ms) is fine for this app, and the offline-first design covers weak connections in waste godowns.
- Bangladesh's data protection law was still being finalised as of my knowledge. Before the pilot, confirm with a local lawyer whether it requires any data to stay in Bangladesh.
- This decision is reversible. The whole state is one ledger in one database file; moving regions later is a copy, not a rebuild.

If the EU brand turns out not to be part of the model, a region closer to Bangladesh (Singapore or Mumbai) is equally valid.
