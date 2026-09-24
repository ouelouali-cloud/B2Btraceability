// Every data-entry form. Each entry has `render(db, params)` → { title, intro, body }
// and `submit(db, values, params)` which mutates db (called inside store.mutate).

import { TIERS, MATERIALS, PROCESS_TYPES, DOC_TYPES, requiredDocs } from './engine/rules.js';
import { org, lot, transfer, transferPct, transferKgIn, round } from './engine/db.js';
import { consumedByTransfer, processBalance } from './engine/checks.js';
import { lotRemaining } from './engine/ledger.js';
import { allChecks } from './engine/trace.js';
import { esc, num, field, input, select } from './ui.js';
import { actingAs, today, nextId } from './store.js';

const n = (v) => (v === '' || v === undefined || v === null ? undefined : Number(v));
const tierOptions = Object.entries(TIERS).filter(([k]) => k !== 'buyer' && k !== 'garment').map(([k, t]) => [k, t.label]);
const materialFor = (tier) => Object.entries(MATERIALS).find(([, m]) => m.tier === tier)?.[0];

export const FORMS = {
  invite: {
    render(db, p) {
      const me = org(db, actingAs());
      const buyerId = p.for || me.id;
      const buyer = org(db, buyerId);
      const upstream = Object.entries(TIERS).find(([, t]) => t.order === TIERS[buyer.tier].order - 1)?.[0] || 'waste';
      return {
        title: 'Invite a supplier',
        intro: `The supplier gets an email link to a free portal. They only see requests from ${esc(buyer.name)}, never the rest of your chain.`,
        body: [
          field('name', 'Company name', input('name', '', 'text', 'required')),
          field('email', 'Compliance contact email', input('email', '', 'email', 'required')),
          `<div class="field-row">${field('city', 'City', input('city', ''))}${field('country', 'Country code', input('country', 'BD', 'text', 'maxlength="2"'))}</div>`,
          field('tier', 'What they supply', select('tier', tierOptions, upstream)),
          `<input type="hidden" name="suppliesTo" value="${esc(buyerId)}">`,
          `<p class="field-hint">They will supply <strong>${esc(buyer.name)}</strong>.</p>`,
        ].join(''),
        submit: 'Send invitation',
      };
    },
    submit(db, v) {
      const id = v.name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) + Date.now().toString(36).slice(-3);
      db.orgs.push({ id, name: v.name.trim(), tier: v.tier, city: v.city, country: (v.country || '').toUpperCase(), email: v.email,
        status: 'invited', invitedBy: actingAs(), suppliesTo: [v.suppliesTo], sc: null, note: `Invited ${today()}, not joined yet.` });
      return `Invitation sent to ${v.email}`;
    },
  },

  accept: {
    render(db, p) {
      const o = org(db, p.org);
      const req = TIERS[o.tier].certRequired;
      return {
        title: 'Accept invitation',
        intro: req ? 'Add the scope certificate that covers what you ship. Your certification body issued it; the number is on the first page.' : 'Your tier is not certified. Accept to start recording shipments.',
        body: req ? certFields(o) : '',
        submit: 'Accept and continue',
      };
    },
    submit(db, v, p) {
      const o = org(db, p.org);
      o.status = 'active';
      delete o.note;
      if (TIERS[o.tier].certRequired && v.number) o.sc = certFrom(v, o);
      return 'Welcome. Your buyer can now see your data.';
    },
  },

  certificate: {
    render(db, p) {
      const o = org(db, p.org);
      return { title: 'Scope certificate', intro: 'Update when your certificate is renewed or its scope changes.', body: certFields(o), submit: 'Save certificate' };
    },
    submit(db, v, p) { const o = org(db, p.org); o.sc = certFrom(v, o); return 'Certificate saved'; },
  },

  origin: {
    render(db, p) {
      const l = lot(db, p.lot);
      const o = l.origin || {};
      const sources = (o.sources || []).map((s) => [s.name, s.kind, s.city].filter(Boolean).join(', ')).join('\n');
      return {
        title: `Origin of ${l.id}`,
        intro: 'Where the waste was collected. One source per line: factory, kind of waste point, city.',
        body: [
          field('sources', 'Source factories', `<textarea id="sources" name="sources" rows="4">${esc(sources)}</textarea>`, 'e.g. Anwar Knit Composite, Cutting room, Narayanganj'),
          `<div class="field-row">${field('collectionFrom', 'Collected from', input('collectionFrom', o.collectionFrom, 'date'))}${field('collectionTo', 'Collected to', input('collectionTo', o.collectionTo, 'date'))}</div>`,
          field('recycledType', 'Waste type', select('recycledType', [['pre-consumer', 'Pre-consumer (factory cutting waste)'], ['post-consumer', 'Post-consumer (used garments)']], l.recycledType || 'pre-consumer')),
          field('colourSort', 'Colour and fibre sort', input('colourSort', o.colourSort)),
          field('rmdNumber', 'Declaration number', input('rmdNumber', o.rmdNumber), 'Number printed on the signed reclaimed material declaration'),
          `<label class="check-field"><input type="checkbox" id="rmdSigned" name="rmdSigned" ${o.rmdSigned ? 'checked' : ''}> I have uploaded the signed declaration</label>`,
          `<label class="field" for="rmdFile"><span class="field-label">Signed declaration (PDF or photo)</span><input id="rmdFile" name="rmdFile" type="file" accept="application/pdf,image/*"><span class="field-hint">Prototype: the file name is stored, the file is not uploaded.</span></label>`,
        ].join(''),
        submit: 'Save declaration',
      };
    },
    submit(db, v, p) {
      const l = lot(db, p.lot);
      l.recycledType = v.recycledType;
      l.origin = {
        ...l.origin,
        sources: v.sources.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
          const [name, kind, city] = s.split(',').map((x) => x.trim());
          return { name, kind, city };
        }),
        collectionFrom: v.collectionFrom, collectionTo: v.collectionTo, colourSort: v.colourSort,
        rmdNumber: v.rmdNumber, rmdSigned: v.rmdSigned === 'on', rmdFile: v.rmdFile || l.origin?.rmdFile,
      };
      return 'Declaration saved';
    },
  },

  doc: {
    render(db, p) {
      const t = transfer(db, p.transfer);
      const isTc = p.doc === 'TC';
      const d = (isTc ? t.tc : t.docs?.[p.doc]) || {};
      const l = lot(db, t.lotId);
      const seller = org(db, t.fromOrg);
      const buyer = org(db, t.toOrg);
      const showPct = isTc || p.doc === 'PO';
      return {
        title: `${isTc ? 'Transaction certificate' : DOC_TYPES[p.doc].label} for ${t.id}`,
        intro: 'Type the values exactly as printed on the document. Upload a corrected document if the original was wrong.',
        body: [
          `<div class="field-row">${field('number', 'Document number', input('number', d.number, 'text', 'required'))}${field('date', 'Date', input('date', d.date || today(), 'date'))}</div>`,
          field('seller', 'Seller as printed', input('seller', d.seller ?? seller.name)),
          field('buyer', 'Buyer as printed', input('buyer', d.buyer ?? buyer.name)),
          `<div class="field-row">${field('qty', `Quantity (${l.unit})`, input('qty', d.qty ?? t.qty, 'number', 'step="any"'), p.doc === 'PACKING' ? 'Net weight, excluding cones and packaging' : '')}
          ${showPct ? field('recycledPct', 'Recycled %', input('recycledPct', d.recycledPct ?? l.recycledPct, 'number', 'step="any"')) : ''}</div>`,
          `<label class="field" for="file"><span class="field-label">Document scan</span><input id="file" name="file" type="file" accept="application/pdf,image/*"></label>`,
        ].join(''),
        submit: 'Save document',
      };
    },
    submit(db, v, p) {
      const t = transfer(db, p.transfer);
      const d = { number: v.number.trim(), date: v.date, seller: v.seller.trim(), buyer: v.buyer.trim(), qty: n(v.qty) };
      if (v.recycledPct !== undefined) d.recycledPct = n(v.recycledPct);
      if (v.file) d.file = v.file;
      if (p.doc === 'TC') t.tc = { standard: org(db, t.fromOrg).sc?.standard || 'GRS', ...t.tc, ...d };
      else t.docs = { ...t.docs, [p.doc]: { ...t.docs?.[p.doc], ...d } };
      return 'Document saved';
    },
  },

  received: {
    render(db, p) {
      const t = transfer(db, p.transfer);
      const l = lot(db, t.lotId);
      return { title: `Goods received for ${t.id}`, intro: 'Weight or count at your gate, before processing.',
        body: field('receivedQty', `Received (${l.unit})`, input('receivedQty', t.receivedQty ?? t.qty, 'number', 'step="any" required')), submit: 'Save' };
    },
    submit(db, v, p) { transfer(db, p.transfer).receivedQty = n(v.receivedQty); return 'Receipt saved'; },
  },

  shipment: {
    render(db) {
      const me = org(db, actingAs());
      const lots = db.lots.filter((l) => l.orgId === me.id && lotRemaining(db, l) > 0);
      const buyers = (me.suppliesTo || []).map((id) => org(db, id)).filter(Boolean);
      if (!lots.length) return { title: 'Record shipment', intro: 'You have no stock to ship. Record production (or collected waste) first.', body: '', submit: null };
      const cert = TIERS[me.tier].certRequired;
      const crossBorder = buyers[0] && buyers[0].country !== me.country;
      return {
        title: 'Record shipment',
        intro: 'One shipment, one set of documents. Quantities are compared across all of them automatically.',
        body: [
          field('lotId', 'From lot', select('lotId', lots.map((l) => [l.id, `${l.id} · ${MATERIALS[l.material].label} · ${num(lotRemaining(db, l))} ${l.unit} left`]), lots[0].id)),
          `<div class="field-row">${field('toOrg', 'Buyer', select('toOrg', buyers.map((b) => [b.id, b.name]), buyers[0]?.id))}${field('date', 'Ship date', input('date', today(), 'date'))}</div>`,
          field('qty', 'Quantity shipped', input('qty', '', 'number', 'step="any" required')),
          cert ? `<fieldset><legend>Transaction certificate</legend><div class="field-row">${field('tcNumber', 'TC number', input('tcNumber', ''))}${field('tcDate', 'TC date', input('tcDate', '', 'date'))}</div><p class="field-hint">Leave blank if not issued yet. The shipment stays flagged until it is added.</p></fieldset>` : '',
          `<fieldset><legend>Commercial documents</legend>
            <div class="field-row">${field('poNumber', 'Buyer PO number', input('poNumber', ''))}${field('invNumber', 'Invoice number', input('invNumber', ''))}</div>
            <div class="field-row">${field('plNumber', 'Packing list number', input('plNumber', ''))}${field('plQty', 'Packing list net qty', input('plQty', '', 'number', 'step="any"'))}</div>
            ${crossBorder ? field('blNumber', 'Bill of lading number', input('blNumber', '')) : ''}
          </fieldset>`,
        ].join(''),
        submit: 'Record shipment',
      };
    },
    submit(db, v) {
      const me = org(db, actingAs());
      const buyer = org(db, v.toOrg);
      const l = lot(db, v.lotId);
      const qty = n(v.qty);
      const base = { date: v.date, seller: me.name, buyer: buyer.name };
      const docs = {};
      if (v.poNumber) docs.PO = { ...base, number: v.poNumber, qty, recycledPct: l.recycledPct };
      if (v.invNumber) docs.INVOICE = { ...base, number: v.invNumber, qty };
      if (v.plNumber) docs.PACKING = { ...base, number: v.plNumber, qty: n(v.plQty) ?? qty };
      if (v.blNumber) docs.BL = { ...base, number: v.blNumber, qty };
      const id = nextId('T', db.transfers);
      db.transfers.push({ id, fromOrg: me.id, toOrg: buyer.id, lotId: l.id, date: v.date, qty,
        tc: v.tcNumber ? { number: v.tcNumber, date: v.tcDate || v.date, standard: me.sc?.standard || 'GRS', seller: me.name, buyer: buyer.name, qty, recycledPct: l.recycledPct } : null,
        docs });
      const missing = requiredDocs(me, buyer).filter((d) => !docs[d]);
      return `Shipment ${id} recorded${missing.length ? `. Still missing: ${missing.map((d) => DOC_TYPES[d].label.toLowerCase()).join(', ')}` : ''}`;
    },
  },

  production: {
    render(db) {
      const me = org(db, actingAs());
      const used = consumedByTransfer(db);
      const inputs = db.transfers.filter((t) => t.toOrg === me.id).map((t) => ({ t, left: transferKgIn(db, t) - (used[t.id] || 0) })).filter((x) => x.left > 0.5);
      const type = Object.entries(PROCESS_TYPES).find(([, pt]) => pt.tier === me.tier)?.[0];
      const material = materialFor(me.tier);
      if (!type) return { title: 'Record production', intro: 'Your tier does not record production runs.', body: '', submit: null };
      if (!inputs.length) return { title: 'Record production', intro: 'No received material left to process. Ask your supplier to record their shipment to you first.', body: '', submit: null };
      const garment = me.tier === 'garment';
      return {
        title: `Record ${PROCESS_TYPES[type].label.toLowerCase()}`,
        intro: 'Enter what went in and what came out. The recycled share of the output is calculated from the inputs; you cannot declare more.',
        body: [
          `<input type="hidden" name="type" value="${type}"><input type="hidden" name="material" value="${material}">`,
          field('date', 'Production date', input('date', today(), 'date')),
          `<fieldset><legend>Certified inputs used (kg)</legend>${inputs.map(({ t, left }) => field(`in_${t.id}`, `${t.id} from ${org(db, t.fromOrg).name} · ${transferPct(db, t)}% recycled · ${num(left)} kg left`, input(`in_${t.id}`, '', 'number', `step="any" min="0" max="${round(left, 2)}"`))).join('')}</fieldset>`,
          me.tier === 'spinner' ? `<div class="field-row">${field('otherKg', 'Virgin / non-recycled fibre (kg)', input('otherKg', '', 'number', 'step="any" min="0"'))}${field('otherNote', 'Describe', input('otherNote', 'Virgin cotton, not claimed'))}</div>` : '',
          garment
            ? `<div class="field-row">${field('outQty', 'Pieces produced', input('outQty', '', 'number', 'step="1" required'))}${field('kgPerUnit', 'Garment weight (kg/pc)', input('kgPerUnit', '0.165', 'number', 'step="any"'))}</div>
               <div class="field-row">${field('kgPerPc', 'Fabric consumption (kg/pc, from marker)', input('kgPerPc', '0.19', 'number', 'step="any"'))}${field('marker', 'Marker reference', input('marker', ''))}</div>`
            : field('outQty', 'Output (kg)', input('outQty', '', 'number', 'step="any" required')),
          field('spec', 'Output description', input('spec', '', 'text', `placeholder="${esc(MATERIALS[material].label)}"`)),
          field('records', 'Production records', input('records', ''), 'Comma-separated references, e.g. blend sheet, batch cards'),
        ].join(''),
        submit: 'Record production',
      };
    },
    submit(db, v) {
      const me = org(db, actingAs());
      const inputs = Object.entries(v).filter(([k, val]) => k.startsWith('in_') && n(val) > 0).map(([k, val]) => ({ transferId: k.slice(3), kg: n(val) }));
      if (!inputs.length) throw new Error('Enter the kg used from at least one received shipment.');
      const nonClaimed = n(v.otherKg) > 0 ? [{ material: 'virgin-cotton-fibre', kg: n(v.otherKg), note: v.otherNote }] : [];
      const recIn = inputs.reduce((s, i) => s + i.kg * transferPct(db, transfer(db, i.transferId)) / 100, 0);
      const inKg = inputs.reduce((s, i) => s + i.kg, 0) + nonClaimed.reduce((s, i) => s + i.kg, 0);
      const pid = nextId('P', db.processes);
      const lid = `L-${pid}`;
      const garment = me.tier === 'garment';
      const firstLot = lot(db, transfer(db, inputs[0].transferId).lotId);
      db.lots.push({ id: lid, orgId: me.id, material: v.material, qty: n(v.outQty), unit: garment ? 'pcs' : 'kg',
        kgPerUnit: garment ? n(v.kgPerUnit) : undefined, recycledPct: Math.floor((recIn / inKg) * 1000) / 10,
        recycledType: firstLot.recycledType, producedBy: pid, createdAt: v.date, spec: v.spec || undefined });
      db.processes.push({ id: pid, orgId: me.id, type: v.type, date: v.date, inputs, nonClaimed, outputLotId: lid,
        consumption: garment ? { kgPerPc: n(v.kgPerPc), marker: v.marker } : undefined,
        records: v.records ? v.records.split(',').map((s) => s.trim()).filter(Boolean) : [] });
      return `Production ${pid} recorded; output lot ${lid}`;
    },
  },

  wastelot: {
    render() {
      return {
        title: 'Record collected waste',
        intro: 'One lot per batch you sell to the recycler. Complete the origin declaration straight after.',
        body: [
          `<div class="field-row">${field('qty', 'Weight (kg)', input('qty', '', 'number', 'step="any" required'))}${field('createdAt', 'Date bagged', input('createdAt', today(), 'date'))}</div>`,
          field('spec', 'Description', input('spec', 'Cotton jersey cutting waste')),
        ].join(''),
        submit: 'Record lot',
      };
    },
    submit(db, v) {
      const id = nextId('L-W', db.lots.filter((l) => l.id.startsWith('L-W')));
      db.lots.push({ id, orgId: actingAs(), material: 'cotton-cutting-waste', qty: n(v.qty), unit: 'kg', recycledPct: 100,
        recycledType: 'pre-consumer', createdAt: v.createdAt, spec: v.spec,
        origin: { sources: [], collectionFrom: '', collectionTo: '', colourSort: '', rmdNumber: '', rmdSigned: false } });
      return `Lot ${id} recorded. Add its origin declaration next.`;
    },
  },

  process: {
    render(db, p) {
      const pr = db.processes.find((x) => x.id === p.process);
      const out = lot(db, pr.outputLotId);
      const b = processBalance(db, pr);
      const garment = pr.type === 'cut_sew';
      return {
        title: `Correct ${pr.id}`,
        intro: `Inputs give ${num(b.computedPct, 2)}% recycled by weight. Correct the figures to match your production records.`,
        body: [
          `<div class="field-row">${field('outQty', garment ? 'Pieces produced' : 'Output (kg)', input('outQty', out.qty, 'number', 'step="any" required'))}
           ${field('recycledPct', 'Declared recycled %', input('recycledPct', out.recycledPct, 'number', 'step="any"'))}</div>`,
          garment ? `<div class="field-row">${field('kgPerPc', 'Fabric consumption (kg/pc)', input('kgPerPc', pr.consumption?.kgPerPc, 'number', 'step="any"'))}${field('kgPerUnit', 'Garment weight (kg/pc)', input('kgPerUnit', out.kgPerUnit, 'number', 'step="any"'))}</div>` : '',
          field('records', 'Production records', input('records', (pr.records || []).join(', '))),
        ].join(''),
        submit: 'Save correction',
      };
    },
    submit(db, v, p) {
      const pr = db.processes.find((x) => x.id === p.process);
      const out = lot(db, pr.outputLotId);
      out.qty = n(v.outQty);
      out.recycledPct = n(v.recycledPct);
      if (pr.type === 'cut_sew') { pr.consumption = { ...pr.consumption, kgPerPc: n(v.kgPerPc) }; out.kgPerUnit = n(v.kgPerUnit); }
      pr.records = v.records.split(',').map((s) => s.trim()).filter(Boolean);
      return `${pr.id} corrected`;
    },
  },

  'raise-gap': {
    render(db, p) {
      const c = allChecks(db).find((x) => x.key === p.key);
      const o = org(db, c.owner);
      return {
        title: 'Raise a gap',
        intro: `${esc(o.name)} will see this request in their portal. The gap closes by itself when the check passes.`,
        body: [
          `<div class="quote"><strong>${esc(c.title)}</strong> (${esc(c.subject)})<br>${esc(c.detail)}</div>`,
          field('message', 'Message to supplier', `<textarea id="message" name="message" rows="4" required>${esc(defaultAsk(c))}</textarea>`),
        ].join(''),
        submit: `Send to ${esc(o.name)}`,
      };
    },
    submit(db, v, p) {
      const c = allChecks(db).find((x) => x.key === p.key);
      const id = nextId('G', db.gaps);
      db.gaps.push({ id, key: c.key, owner: c.owner, raisedBy: actingAs(), raisedAt: today(), status: 'open', title: c.title,
        thread: [{ by: actingAs(), at: today(), text: v.message }] });
      return `Gap ${id} sent to ${org(db, c.owner).name}`;
    },
  },
};

function defaultAsk(c) {
  const asks = {
    quantity: 'Quantities on this shipment do not reconcile. Please send a corrected document, or explain the difference (gross vs net weight, moisture, cones).',
    parties: 'Company names differ between documents. Please reissue with the registered names.',
    composition: 'The recycled % differs between the TC, PO and lot. Please confirm the correct blend and reissue.',
    consumption: 'Pieces booked need more fabric than was received under TC. Please check the cutting report and marker consumption.',
    origin: 'Please complete the reclaimed material declaration for this lot.',
    sc: 'Your scope certificate did not cover this shipment date. Please share the renewed certificate.',
    tc: 'Please upload the transaction certificate for this shipment.',
    docs: 'Please upload the missing documents for this shipment.',
  };
  return asks[c.id] || `Please check: ${c.detail}`;
}

function certFields(o) {
  const sc = o.sc || {};
  return [
    `<div class="field-row">${field('number', 'Certificate number', input('number', sc.number, 'text', 'required'))}${field('standard', 'Standard', select('standard', [['GRS', 'GRS'], ['RCS', 'RCS']], sc.standard || 'GRS'))}</div>`,
    field('body', 'Certification body', input('body', sc.body, 'text', 'placeholder="e.g. Control Union"')),
    `<div class="field-row">${field('validFrom', 'Valid from', input('validFrom', sc.validFrom, 'date', 'required'))}${field('validTo', 'Valid to', input('validTo', sc.validTo, 'date', 'required'))}</div>`,
    `<p class="field-hint">Scope: ${esc(MATERIALS[materialFor(o.tier)]?.label || 'n/a')}</p>`,
  ].join('');
}

function certFrom(v, o) {
  return { number: v.number.trim(), standard: v.standard, body: v.body, validFrom: v.validFrom, validTo: v.validTo, scope: [materialFor(o.tier)] };
}

