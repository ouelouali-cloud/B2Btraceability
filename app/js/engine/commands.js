// Every write in Threadback is a command. The same code runs in two places:
//   - in the browser, to show the change at once (and to queue it when offline)
//   - on the server, which re-checks permissions and writes it to the ledger
// A command mutates a copy of the state and returns a one-line summary;
// the ledger then records exactly which records changed.

import { TIERS, MATERIALS, DOC_TYPES, STANDARD, requiredDocs } from './rules.js';
import { org, lot, transfer, transferPct } from './db.js';
import { allChecks, syncGaps } from './trace.js';
import { applyStep, isSigned } from './declaration.js';

export class CommandError extends Error {}
const fail = (msg) => { throw new CommandError(msg); };
const n = (v) => (v === '' || v === undefined || v === null ? undefined : Number(v));
const materialFor = (tier) => Object.entries(MATERIALS).find(([, m]) => m.tier === tier)?.[0];

// Short ids that can be created offline without clashing: T-K4Q2X
export function makeId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 4);
  return `${prefix}-${(Date.now() % 1679616).toString(36).padStart(4, '0')}${rnd}`.toUpperCase();
}

const owns = (db, actor, orgId) => actor === orgId;
const isTenant = (db, actor) => actor === db.tenantId;

export const COMMANDS = {
  'org.invite': {
    allowed: (db, a, p) => (isTenant(db, a) || a === p.v.suppliesTo ? '' : 'You can only invite your own suppliers.'),
    run(db, { v, id }, ctx) {
      if (!v.name?.trim() || !v.email?.trim()) fail('Company name and email are required.');
      const oid = id || makeId('O').toLowerCase();
      db.orgs.push({ id: oid, name: v.name.trim(), tier: v.tier, city: v.city || '', country: (v.country || '').toUpperCase(), email: v.email.trim(),
        status: 'invited', invitedBy: ctx.actor, suppliesTo: [v.suppliesTo], sc: null, note: `Invited ${ctx.now}, not joined yet.` });
      return `Invited ${v.name.trim()} (${TIERS[v.tier].label.toLowerCase()}) to supply ${org(db, v.suppliesTo).name}`;
    },
  },

  'org.accept': {
    allowed: (db, a, p) => (owns(db, a, p.org) ? '' : 'Only the invited company can accept.'),
    run(db, { v, org: oid }) {
      const o = org(db, oid);
      o.status = 'active';
      delete o.note;
      if (TIERS[o.tier].certRequired && v?.number) o.sc = certFrom(v, o);
      return `${o.name} joined`;
    },
  },

  'certificate.save': {
    allowed: (db, a, p) => (owns(db, a, p.org) ? '' : 'You can only update your own certificate.'),
    run(db, { v, org: oid }) {
      const o = org(db, oid);
      if (!v.number?.trim() || !v.validFrom || !v.validTo) fail('Certificate number and validity dates are required.');
      o.sc = certFrom(v, o);
      return `Scope certificate ${o.sc.number} saved`;
    },
  },

  // ---- waste source

  'batch.create': {
    allowed: (db, a) => (org(db, a)?.tier === 'waste' ? '' : 'Only waste sources record waste batches.'),
    run(db, { id, createdAt }, ctx) {
      const lid = id || makeId('L-W');
      db.lots.push({ id: lid, orgId: ctx.actor, material: 'cotton-cutting-waste', qty: 0, unit: 'kg', recycledPct: 100,
        recycledType: 'pre-consumer', createdAt: createdAt || ctx.now, spec: 'Cotton jersey cutting waste',
        origin: { slipNumber: '', bags: null, slipPhoto: null, sources: [], colourSort: '', fibre: '', contamination: {}, declaration: {} } });
      return `New waste batch ${lid}`;
    },
  },

  'batch.step': {
    allowed: (db, a, p) => (lot(db, p.lot)?.orgId === a ? '' : 'You can only edit your own batches.'),
    run(db, { lot: lid, step, v }, ctx) {
      const err = applyStep(db, lid, step, v, ctx.now);
      if (err) fail(err);
      const l = lot(db, lid);
      if (step === 'declare') return `Signed declaration ${l.origin.declaration.number} for ${lid} (${l.qty.toLocaleString('en-GB')} kg)`;
      return `Updated ${lid}: ${step === 'batch' ? 'batch details' : step === 'sources' ? 'source factories' : 'sort and checks'}`;
    },
  },

  // ---- recycler: goods-in of waste, countersigning the declaration

  'goodsin.record': {
    allowed(db, a, p) {
      const l = lot(db, p.lot);
      if (!l) return 'Unknown batch.';
      if (!org(db, l.orgId).suppliesTo?.includes(a)) return 'This batch is not addressed to you.';
      if (db.transfers.some((t) => t.lotId === l.id)) return 'Goods-in already recorded for this batch.';
      return '';
    },
    run(db, { id, lot: lid, v }, ctx) {
      const l = lot(db, lid);
      const seller = org(db, l.orgId);
      const me = org(db, ctx.actor);
      const kg = n(v.receivedQty);
      if (!kg) fail('Enter the weight at your gate.');
      if (!v.poNumber || !v.invoiceNumber) fail('Your purchase order and the seller’s invoice or cash memo number are required.');
      const signed = isSigned(l);
      if (v.countersign === 'on' && !signed) fail('The declaration is not signed yet, so it cannot be countersigned.');
      const d = l.origin.declaration;
      const party = { seller: seller.name, buyer: me.name };
      const tid = id || makeId('T');
      db.transfers.push({
        id: tid, fromOrg: seller.id, toOrg: me.id, lotId: lid, date: v.date, qty: l.qty, receivedQty: kg, tc: null,
        docs: {
          PO: { number: v.poNumber, date: v.date, ...party, qty: l.qty, recycledPct: 100 },
          INVOICE: { number: v.invoiceNumber, date: v.date, ...party, qty: l.qty },
          PACKING: { number: l.origin.slipNumber, date: l.createdAt, ...party, qty: l.qty },
        },
        goodsIn: { slipNumber: v.gateSlip || '', moisturePct: n(v.moisturePct) ?? null, by: ctx.userName || me.name, note: v.note || '' },
        countersign: v.countersign === 'on' ? { by: ctx.userName || me.name, at: ctx.now, declaration: d.number, signedOn: d.signedOn } : null,
      });
      return `Goods-in ${tid}: ${kg.toLocaleString('en-GB')} kg of ${lid} from ${seller.name}${v.countersign === 'on' ? ', declaration countersigned' : ''}`;
    },
  },

  'receipt.countersign': {
    allowed(db, a, p) {
      const t = transfer(db, p.transfer);
      if (!t || t.toOrg !== a) return 'Only the receiving company can countersign.';
      if (!isSigned(lot(db, t.lotId))) return 'The declaration is not signed yet.';
      return '';
    },
    run(db, { transfer: tid }, ctx) {
      const t = transfer(db, tid);
      const d = lot(db, t.lotId).origin.declaration;
      t.countersign = { by: ctx.userName || org(db, ctx.actor).name, at: ctx.now, declaration: d.number, signedOn: d.signedOn };
      return `Countersigned declaration ${d.number} on ${tid}`;
    },
  },

  // ---- handoffs

  'doc.save': {
    allowed: (db, a, p) => (transfer(db, p.transfer)?.fromOrg === a ? '' : 'Only the seller can edit shipment documents.'),
    run(db, { transfer: tid, doc, v }) {
      const t = transfer(db, tid);
      if (!v.number?.trim()) fail('Document number is required.');
      const d = { number: v.number.trim(), date: v.date, seller: (v.seller || '').trim(), buyer: (v.buyer || '').trim(), qty: n(v.qty) };
      if (v.recycledPct !== undefined) d.recycledPct = n(v.recycledPct);
      if (v.file) d.file = v.file;
      if (doc === 'TC') t.tc = { standard: STANDARD, ...t.tc, ...d };
      else t.docs = { ...t.docs, [doc]: { ...t.docs?.[doc], ...d } };
      return `${doc === 'TC' ? 'Transaction certificate' : DOC_TYPES[doc].label} ${d.number} saved on ${tid}`;
    },
  },

  'receipt.save': {
    allowed: (db, a, p) => (transfer(db, p.transfer)?.toOrg === a ? '' : 'Only the buyer records goods received.'),
    run(db, { transfer: tid, v }) {
      const t = transfer(db, tid);
      t.receivedQty = n(v.receivedQty);
      return `Goods received on ${tid}: ${t.receivedQty.toLocaleString('en-GB')}`;
    },
  },

  'shipment.record': {
    allowed: (db, a, p) => (lot(db, p.v.lotId)?.orgId === a ? '' : 'You can only ship your own stock.'),
    run(db, { id, v }, ctx) {
      const me = org(db, ctx.actor);
      const buyer = org(db, v.toOrg);
      const l = lot(db, v.lotId);
      const qty = n(v.qty);
      if (!qty || !buyer) fail('Buyer and quantity are required.');
      const base = { date: v.date, seller: me.name, buyer: buyer.name };
      const docs = {};
      if (v.poNumber) docs.PO = { ...base, number: v.poNumber, qty, recycledPct: l.recycledPct };
      if (v.invNumber) docs.INVOICE = { ...base, number: v.invNumber, qty };
      if (v.plNumber) docs.PACKING = { ...base, number: v.plNumber, qty: n(v.plQty) ?? qty };
      if (v.blNumber) docs.BL = { ...base, number: v.blNumber, qty };
      const tid = id || makeId('T');
      db.transfers.push({ id: tid, fromOrg: me.id, toOrg: buyer.id, lotId: l.id, date: v.date, qty,
        tc: v.tcNumber ? { number: v.tcNumber, date: v.tcDate || v.date, standard: STANDARD, seller: me.name, buyer: buyer.name, qty, recycledPct: l.recycledPct } : null,
        docs });
      const missing = requiredDocs(me, buyer).filter((d) => !docs[d]);
      return `Shipment ${tid}: ${qty.toLocaleString('en-GB')} ${l.unit} of ${l.id} to ${buyer.name}${missing.length ? ` (missing ${missing.map((d) => DOC_TYPES[d].short).join(', ')})` : ''}`;
    },
  },

  // ---- production

  'production.record': {
    allowed: (db, a) => (['recycler', 'spinner', 'mill', 'garment'].includes(org(db, a)?.tier) ? '' : 'Your tier does not record production.'),
    run(db, { id, lotId, v }, ctx) {
      const me = org(db, ctx.actor);
      const inputs = Object.entries(v).filter(([k, val]) => k.startsWith('in_') && n(val) > 0).map(([k, val]) => ({ transferId: k.slice(3), kg: n(val) }));
      if (!inputs.length) fail('Enter the kg used from at least one received shipment.');
      for (const i of inputs) if (transfer(db, i.transferId)?.toOrg !== me.id) fail(`${i.transferId} was not received by you.`);
      if (!n(v.outQty)) fail('Enter the output quantity.');
      const nonClaimed = n(v.otherKg) > 0 ? [{ material: 'virgin-cotton-fibre', kg: n(v.otherKg), note: v.otherNote }] : [];
      const recIn = inputs.reduce((s, i) => s + i.kg * transferPct(db, transfer(db, i.transferId)) / 100, 0);
      const inKg = inputs.reduce((s, i) => s + i.kg, 0) + nonClaimed.reduce((s, i) => s + i.kg, 0);
      const pid = id || makeId('P');
      const lid = lotId || `L-${pid}`;
      const garment = me.tier === 'garment';
      const firstLot = lot(db, transfer(db, inputs[0].transferId).lotId);
      db.lots.push({ id: lid, orgId: me.id, material: v.material, qty: n(v.outQty), unit: garment ? 'pcs' : 'kg',
        kgPerUnit: garment ? n(v.kgPerUnit) : undefined, recycledPct: Math.floor((recIn / inKg) * 1000) / 10,
        recycledType: firstLot.recycledType, producedBy: pid, createdAt: v.date, spec: v.spec || undefined });
      db.processes.push({ id: pid, orgId: me.id, type: v.type, date: v.date, inputs, nonClaimed, outputLotId: lid,
        rejectsKg: n(v.rejectsKg) ?? undefined,
        consumption: garment ? { kgPerPc: n(v.kgPerPc), marker: v.marker } : undefined,
        records: v.records ? v.records.split(',').map((s) => s.trim()).filter(Boolean) : [] });
      return `Production ${pid}: ${inKg.toLocaleString('en-GB')} kg in → ${n(v.outQty).toLocaleString('en-GB')} ${garment ? 'pcs' : 'kg'} out (lot ${lid})`;
    },
  },

  'production.correct': {
    allowed: (db, a, p) => (db.processes.find((x) => x.id === p.process)?.orgId === a ? '' : 'You can only correct your own production records.'),
    run(db, { process: pid, v }) {
      const pr = db.processes.find((x) => x.id === pid);
      const out = lot(db, pr.outputLotId);
      out.qty = n(v.outQty);
      out.recycledPct = n(v.recycledPct);
      if (pr.type === 'cut_sew') { pr.consumption = { ...pr.consumption, kgPerPc: n(v.kgPerPc) }; out.kgPerUnit = n(v.kgPerUnit); }
      pr.records = (v.records || '').split(',').map((s) => s.trim()).filter(Boolean);
      return `Corrected ${pid}: output ${out.qty.toLocaleString('en-GB')} ${out.unit} at ${out.recycledPct}%`;
    },
  },

  'product.photo': {
    allowed: (db, a, p) => (lot(db, p.lot)?.orgId === a ? '' : 'Only the maker can change the product photo.'),
    run(db, { lot: lid, photo }) {
      lot(db, lid).product.photo = photo || null;
      return photo ? `New product photo on ${lid}` : `Product photo removed on ${lid}`;
    },
  },

  // ---- gaps

  'gap.raise': {
    allowed: (db, a) => (isTenant(db, a) ? '' : 'Only the manufacturer raises gaps.'),
    run(db, { id, key, v }, ctx) {
      const c = allChecks(db).find((x) => x.key === key);
      if (!c) fail('That check no longer exists.');
      const gid = id || makeId('G');
      db.gaps.push({ id: gid, key: c.key, owner: c.owner, raisedBy: ctx.actor, raisedAt: ctx.now, status: 'open', title: c.title,
        thread: [{ by: ctx.actor, at: ctx.now, text: v.message }] });
      return `Gap ${gid} raised with ${org(db, c.owner).name}: ${c.title.toLowerCase()} (${c.subject})`;
    },
  },

  'gap.reply': {
    allowed(db, a, p) {
      const g = db.gaps.find((x) => x.id === p.gap);
      return g && (g.owner === a || g.raisedBy === a || isTenant(db, a)) ? '' : 'You are not part of this gap.';
    },
    run(db, { gap, text }, ctx) {
      if (!text?.trim()) fail('Write a reply first.');
      db.gaps.find((x) => x.id === gap).thread.push({ by: ctx.actor, at: ctx.now, text: text.trim() });
      return `Replied on gap ${gap}`;
    },
  },

  'gap.resolve': {
    allowed: (db, a) => (isTenant(db, a) ? '' : 'Only the manufacturer can close a gap by hand.'),
    run(db, { gap }, ctx) {
      const g = db.gaps.find((x) => x.id === gap);
      g.status = 'resolved';
      g.resolvedAt = ctx.now;
      g.thread.push({ by: ctx.actor, at: ctx.now, text: 'Marked resolved by the buyer.' });
      return `Gap ${gap} marked resolved`;
    },
  },
};

function certFrom(v, o) {
  return { number: v.number.trim(), standard: STANDARD, body: v.body || '', validFrom: v.validFrom, validTo: v.validTo, scope: [materialFor(o.tier)] };
}

// Run a command against `db` without touching it. Returns the new state, the
// summary line, and the ids of any gaps that closed because a check now passes.
export function execute(db, name, payload, ctx) {
  const cmd = COMMANDS[name];
  if (!cmd) throw new CommandError(`Unknown command ${name}.`);
  const why = cmd.allowed(db, ctx.actor, payload || {});
  if (why) throw new CommandError(why);
  const next = structuredClone(db);
  const summary = cmd.run(next, payload || {}, ctx);
  const closed = syncGaps(next, ctx.now);
  return { next, summary, closed };
}
