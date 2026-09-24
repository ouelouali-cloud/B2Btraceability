// Every data-entry form. Each entry has `render(db, params)` → { title, intro, body }
// and `command(values, params)` → [commandName, payload]. Forms never change
// data themselves: the command layer (engine/commands.js) does, on this device
// at once and on the server when the command arrives.

import { TIERS, MATERIALS, PROCESS_TYPES, DOC_TYPES } from './engine/rules.js';
import { org, lot, transfer, transferPct, transferKgIn, round, pctDiff } from './engine/db.js';
import { consumedByTransfer, processBalance } from './engine/checks.js';
import { lotRemaining } from './engine/ledger.js';
import { allChecks } from './engine/trace.js';
import { esc, num, date, field, input, select } from './ui.js';
import { actingAs, today } from './store.js';
import { makeId } from './engine/commands.js';
import { isSigned } from './engine/declaration.js';
import { namedSources, collectionPeriod } from './engine/checks.js';

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
    command: (v) => ['org.invite', { id: makeId('O').toLowerCase(), v }],
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
    command: (v, p) => ['org.accept', { org: p.org, v }],
  },

  certificate: {
    render(db, p) {
      const o = org(db, p.org);
      return { title: 'Scope certificate', intro: 'Update when your certificate is renewed or its scope changes.', body: certFields(o), submit: 'Save certificate' };
    },
    command: (v, p) => ['certificate.save', { org: p.org, v }],
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
    command: (v, p) => ['doc.save', { transfer: p.transfer, doc: p.doc, v }],
  },

  received: {
    render(db, p) {
      const t = transfer(db, p.transfer);
      const l = lot(db, t.lotId);
      return { title: `Goods received for ${t.id}`, intro: 'Weight or count at your gate, before processing.',
        body: field('receivedQty', `Received (${l.unit})`, input('receivedQty', t.receivedQty ?? t.qty, 'number', 'step="any" required')), submit: 'Save' };
    },
    command: (v, p) => ['receipt.save', { transfer: p.transfer, v }],
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
    command: (v) => ['shipment.record', { id: makeId('T'), v }],
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
          me.tier === 'recycler' ? field('rejectsKg', 'Sorting rejects (kg)', input('rejectsKg', '', 'number', 'step="any" min="0"'), 'Pieces removed before shredding: elastane, prints, polyester. Part of the loss.') : '',
          field('spec', 'Output description', input('spec', '', 'text', `placeholder="${esc(MATERIALS[material].label)}"`)),
          field('records', 'Production records', input('records', ''), 'Comma-separated references, e.g. blend sheet, batch cards'),
        ].join(''),
        submit: 'Record production',
      };
    },
    command: (v) => { const id = makeId('P'); return ['production.record', { id, lotId: `L-${id}`, v }]; },
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
    command: (v, p) => ['production.correct', { process: p.process, v }],
  },

  goodsin: {
    render(db, p) {
      const l = lot(db, p.lot);
      const o = l.origin;
      const d = o.declaration || {};
      const seller = org(db, l.orgId);
      const signed = isSigned(l);
      const [from, to] = collectionPeriod(l);
      return {
        title: `Goods-in: ${l.id} from ${seller.name}`,
        intro: 'Weigh the delivery at your gate and compare it with the trader’s declaration. Your record creates this handoff in the chain.',
        body: [
          `<div class="decl-card">
            <p><strong>${num(l.qty)} kg</strong> declared · ${num(o.bags)} bags · slip ${esc(o.slipNumber || '—')}</p>
            <p class="muted small">${namedSources(l).map((s) => `${esc(s.name)} ${num(s.kg)} kg`).join(' · ') || 'No sources listed'}</p>
            <p class="muted small">${esc([o.colourSort, o.fibre, l.recycledType].filter(Boolean).join(' · '))}${from ? ` · collected ${date(from)} to ${date(to)}` : ''}</p>
            <p class="small">${signed ? `Declaration <span class="mono">${esc(d.number)}</span> signed by ${esc(d.signer)} on ${date(d.signedOn)}` : '<strong>Declaration not signed yet.</strong> You can record the weight now and countersign later.'}</p>
          </div>`,
          `<div class="field-row">${field('date', 'Date received', input('date', today(), 'date'))}${field('receivedQty', 'Weight at your gate (kg)', input('receivedQty', '', 'number', 'step="any" required inputmode="decimal"'), 'Net of bags')}</div>`,
          `<div class="field-row">${field('gateSlip', 'Your weighbridge slip', input('gateSlip', ''))}${field('moisturePct', 'Moisture (%)', input('moisturePct', '', 'number', 'step="any" min="0" max="30"'), 'Explains small weight differences')}</div>`,
          `<div class="field-row">${field('poNumber', 'Your purchase order', input('poNumber', '', 'text', 'required'))}${field('invoiceNumber', 'Seller’s invoice or cash memo', input('invoiceNumber', '', 'text', 'required'))}</div>`,
          signed ? `<label class="check-field"><input type="checkbox" id="countersign" name="countersign" checked> I checked this delivery against declaration ${esc(d.number)}: sources, weight and sort match.</label>` : '',
        ].join(''),
        submit: 'Record goods-in',
      };
    },
    command: (v, p) => ['goodsin.record', { id: makeId('T'), lot: p.lot, v }],
  },

  countersign: {
    render(db, p) {
      const t = transfer(db, p.transfer);
      const l = lot(db, t.lotId);
      const d = l.origin.declaration;
      const diffPct = pctDiff(t.receivedQty ?? t.qty, l.qty);
      return {
        title: `Countersign declaration ${d.number}`,
        intro: `You received ${esc(l.id)} on ${date(t.date)}. Confirm the delivery matched what ${esc(org(db, l.orgId).name)} declared.`,
        body: [
          `<div class="decl-card"><p>Declared <strong>${num(l.qty)} kg</strong> · at your gate <strong>${num(t.receivedQty)} kg</strong> (${num(diffPct, 1)}% difference${t.goodsIn?.moisturePct ? `, moisture ${t.goodsIn.moisturePct}%` : ''})</p>
            <p class="muted small">${namedSources(l).map((s) => `${esc(s.name)} ${num(s.kg)} kg`).join(' · ')}</p>
            <p class="small">Signed by ${esc(d.signer)} on ${date(d.signedOn)}</p></div>`,
          '<label class="check-field"><input type="checkbox" id="confirm" name="confirm"> Sources, weight and sort match this declaration.</label>',
        ].join(''),
        submit: 'Countersign',
      };
    },
    command: (v, p) => {
      if (v.confirm !== 'on') throw new Error('Tick the box to confirm you checked the delivery.');
      return ['receipt.countersign', { transfer: p.transfer }];
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
    command: (v, p) => ['gap.raise', { id: makeId('G'), key: p.key, v }],
  },
};

function defaultAsk(c) {
  const asks = {
    quantity: 'Quantities on this shipment do not reconcile. Please send a corrected document, or explain the difference (gross vs net weight, moisture, cones).',
    parties: 'Company names differ between documents. Please reissue with the registered names.',
    composition: 'The recycled % differs between the TC, PO and lot. Please confirm the correct blend and reissue.',
    consumption: 'Pieces booked need more fabric than was received under TC. Please check the cutting report and marker consumption.',
    origin: 'Please complete the reclaimed material declaration for this batch.',
    sources: 'Part of this batch is not traced to a factory. Please list every source factory with its weight.',
    sc: 'Your scope certificate did not cover this shipment date. Please share the renewed certificate.',
    tc: 'Please upload the transaction certificate for this shipment.',
    docs: 'Please upload the missing documents for this shipment.',
    countersign: 'Please confirm the delivery against the signed declaration at goods-in.',
  };
  return asks[c.id] || `Please check: ${c.detail}`;
}

function certFields(o) {
  const sc = o.sc || {};
  return [
    `<div class="field-row">${field('number', 'Certificate number', input('number', sc.number, 'text', 'required'))}${field('standard', 'Standard', input('standard', 'GRS', 'text', 'readonly'))}</div>`,
    field('body', 'Certification body', input('body', sc.body, 'text', 'placeholder="e.g. Control Union"')),
    `<div class="field-row">${field('validFrom', 'Valid from', input('validFrom', sc.validFrom, 'date', 'required'))}${field('validTo', 'Valid to', input('validTo', sc.validTo, 'date', 'required'))}</div>`,
    `<p class="field-hint">Scope: ${esc(MATERIALS[materialFor(o.tier)]?.label || 'n/a')}</p>`,
  ].join('');
}


