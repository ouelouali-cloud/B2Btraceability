// The reconciliation engine. Every check returns the same shape:
//   { key, subject, id, group, title, status: pass|warn|fail|na, detail, owner }
// `key` is stable (subjectId:checkId) so a gap raised against a check can close
// itself when the underlying data is corrected and the check passes.

import { TIERS, PROCESS_TYPES, DOC_TYPES, RULES, requiredDocs, MATERIALS } from './rules.js';
import { org, lot, transfer, kgOf, fibreKgOf, transferPct, transferKgIn, daysBetween, pctDiff, round } from './db.js';

const mk = (subject, owner) => (id, group, title, status, detail) => ({
  key: `${subject}:${id}`, subject, id, group, title, status, detail, owner,
});

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,&()'-]/g, ' ')
    .replace(/\b(ltd|limited|pvt|plc|ab|co|mills?|inc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- handoffs

export function checkTransfer(db, t) {
  const seller = org(db, t.fromOrg);
  const buyer = org(db, t.toOrg);
  const l = lot(db, t.lotId);
  const tier = TIERS[seller.tier];
  const c = mk(t.id, seller.id);
  const out = [];
  const docs = t.docs || {};

  // -- Verify: certificates
  if (!tier.certRequired) {
    out.push(c('tc', 'verify', 'Transaction certificate', 'na',
      `${tier.label}s are not certified. The reclaimed material declaration on the lot is the evidence instead.`));
  } else if (!t.tc || !t.tc.number) {
    out.push(c('tc', 'verify', 'Transaction certificate', 'fail', 'No TC attached to this shipment.'));
  } else if (t.tc.date && daysBetween(t.date, t.tc.date) < 0) {
    out.push(c('tc', 'verify', 'Transaction certificate', 'fail',
      `TC ${t.tc.number} is dated ${t.tc.date}, before the goods shipped on ${t.date}.`));
  } else {
    out.push(c('tc', 'verify', 'Transaction certificate', 'pass', `${t.tc.standard || 'GRS'} TC ${t.tc.number}, issued ${t.tc.date || 'n/a'}.`));
  }

  if (tier.certRequired) {
    const sc = seller.sc;
    if (!sc || !sc.number) {
      out.push(c('sc', 'verify', 'Scope certificate valid', 'fail', `${seller.name} has no scope certificate on file.`));
    } else if (t.date < sc.validFrom || t.date > sc.validTo) {
      out.push(c('sc', 'verify', 'Scope certificate valid', 'fail',
        `SC ${sc.number} is valid ${sc.validFrom} to ${sc.validTo}; shipment dated ${t.date}.`));
    } else {
      out.push(c('sc', 'verify', 'Scope certificate valid', 'pass', `SC ${sc.number} (${sc.body}) valid on ${t.date}.`));
    }
    if (sc && sc.number) {
      const inScope = (sc.scope || []).includes(l.material);
      out.push(c('scope', 'verify', 'Product in certificate scope', inScope ? 'pass' : 'fail',
        inScope ? `${MATERIALS[l.material].label} is listed on the SC.`
          : `${MATERIALS[l.material].label} is not listed on SC ${sc.number}.`));
    }
  }

  // -- Verify: documents present
  const needed = requiredDocs(seller, buyer);
  const missing = needed.filter((d) => !docs[d] || !docs[d].number);
  out.push(c('docs', 'verify', 'Commercial documents complete', missing.length ? 'fail' : 'pass',
    missing.length ? `Missing: ${missing.map((d) => DOC_TYPES[d].label).join(', ')}.`
      : `${needed.map((d) => DOC_TYPES[d].short).join(', ')} on file.`));

  // -- Verify: parties
  const named = [];
  if (t.tc && t.tc.number) named.push(['TC', t.tc.seller, t.tc.buyer]);
  for (const [k, d] of Object.entries(docs)) if (d && d.number) named.push([DOC_TYPES[k].short, d.seller, d.buyer]);
  const hard = [];
  const soft = [];
  for (const [src, s, b] of named) {
    for (const [val, party, role] of [[s, seller, 'seller'], [b, buyer, 'buyer']]) {
      if (!val || val === party.name) continue;
      (normName(val) === normName(party.name) ? soft : hard).push(`${src} ${role} reads "${val}"`);
    }
  }
  out.push(c('parties', 'verify', 'Seller and buyer match',
    hard.length ? 'fail' : soft.length ? 'warn' : 'pass',
    hard.length ? `${hard.join('; ')}. Expected ${seller.name} → ${buyer.name}.`
      : soft.length ? `Name variants: ${soft.join('; ')}. Ask for a corrected document before audit.`
        : `${seller.name} → ${buyer.name} on every document.`));

  // -- Verify: dates
  const late = [];
  for (const [k, d] of Object.entries(docs)) {
    if (d && d.date && Math.abs(daysBetween(t.date, d.date)) > RULES.docWindowDays) late.push(`${DOC_TYPES[k].short} ${d.date}`);
  }
  out.push(c('dates', 'verify', 'Dates line up', late.length ? 'warn' : 'pass',
    late.length ? `More than ${RULES.docWindowDays} days from shipment (${t.date}): ${late.join(', ')}.`
      : `All documents within ${RULES.docWindowDays} days of shipment on ${t.date}.`));

  // -- Verify: composition
  const comp = [['Lot', l.recycledPct]];
  if (t.tc && Number.isFinite(t.tc.recycledPct)) comp.push(['TC', t.tc.recycledPct]);
  if (docs.PO && Number.isFinite(docs.PO.recycledPct)) comp.push(['PO spec', docs.PO.recycledPct]);
  const off = comp.filter(([, v]) => Math.abs(v - l.recycledPct) > RULES.compositionTolerancePts);
  out.push(c('composition', 'verify', 'Recycled % consistent', off.length ? 'fail' : 'pass',
    comp.map(([k, v]) => `${k} ${v}%`).join(' · ') + (off.length ? ` (tolerance ±${RULES.compositionTolerancePts} pt)` : '')));

  // -- Reconcile: quantity
  const qty = [];
  if (t.tc && Number.isFinite(t.tc.qty)) qty.push(['TC', t.tc.qty]);
  for (const k of ['INVOICE', 'PACKING', 'BL']) if (docs[k] && Number.isFinite(docs[k].qty)) qty.push([DOC_TYPES[k].short, docs[k].qty]);
  if (Number.isFinite(t.receivedQty)) qty.push(['Received', t.receivedQty]);
  const unit = l.unit;
  const bad = qty.filter(([, v]) => pctDiff(v, t.qty) > RULES.qtyTolerancePct);
  const onlyReceived = bad.length === 1 && bad[0][0] === 'Received';
  const qCheck = c('quantity', 'reconcile', 'Quantities reconcile', bad.length ? 'fail' : 'pass',
    `Shipped ${fmt(t.qty)} ${unit} · ` + qty.map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') +
    (bad.length ? `. Off by more than ${RULES.qtyTolerancePct}%: ${bad.map(([k, v]) => `${k} (${sign(v - t.qty)}${fmt(Math.abs(v - t.qty))} ${unit})`).join(', ')}.` : ''));
  if (onlyReceived) qCheck.owner = buyer.id;
  out.push(qCheck);

  return out;
}

// ---------------------------------------------------------------- origin

export const ORIGIN_FIELDS = [
  ['slipNumber', 'Weighbridge slip number'],
  ['sources', 'At least one source factory'],
  ['sourceDetail', 'Weight and date for every source'],
  ['colourSort', 'Colour sort'],
  ['fibre', 'Fibre content'],
  ['contamination', 'Confirmed free of elastane and prints'],
  ['recycledType', 'Pre- or post-consumer'],
  ['signer', 'Name of signer'],
  ['signature', 'Signature or signed paper form'],
];

export const namedSources = (l) => (l.origin?.sources || []).filter((s) => s.name && s.name.trim());

export function originMissing(l) {
  const o = l.origin || {};
  const src = namedSources(l);
  const d = o.declaration || {};
  const ok = {
    slipNumber: !!o.slipNumber,
    sources: src.length > 0,
    sourceDetail: src.length > 0 && src.every((s) => s.kg > 0 && s.collectedOn),
    colourSort: !!o.colourSort,
    fibre: !!o.fibre,
    contamination: !!(o.contamination?.noElastane && o.contamination?.noPrint),
    recycledType: !!l.recycledType,
    signer: !!d.signer,
    signature: !!(d.signature || d.paperPhoto),
  };
  return ORIGIN_FIELDS.filter(([k]) => !ok[k]);
}

// First and last collection date across the sources.
export function collectionPeriod(l) {
  const dates = namedSources(l).map((s) => s.collectedOn).filter(Boolean).sort();
  return dates.length ? [dates[0], dates[dates.length - 1]] : [null, null];
}

export function sourcedKg(l) {
  return namedSources(l).reduce((s, x) => s + (Number(x.kg) || 0), 0);
}

export function checkOrigin(db, l) {
  const c = mk(l.id, l.orgId);
  const missing = originMissing(l);
  const src = namedSources(l);
  const d = l.origin?.declaration || {};
  const [from, to] = collectionPeriod(l);
  const out = [c('origin', 'origin', 'Reclaimed material declaration', missing.length ? 'fail' : 'pass',
    missing.length ? `Missing: ${missing.map(([, label]) => label.toLowerCase()).join(', ')}.`
      : `${src.length} source ${src.length === 1 ? 'factory' : 'factories'}, collected ${from} to ${to}, ${l.recycledType}. ` +
        `Declaration ${d.number || ''} signed by ${d.signer} on ${d.signedOn || 'n/a'}.`)];

  const sum = sourcedKg(l);
  const gap = l.qty - sum;
  const off = !src.length || pctDiff(sum, l.qty) > RULES.qtyTolerancePct;
  out.push(c('sources', 'origin', 'Every kg traced to a factory', off ? 'fail' : 'pass',
    !src.length ? `No source factories listed for ${fmt(l.qty)} kg.`
      : off ? `${fmt(sum)} of ${fmt(l.qty)} kg traced to a named factory; ${fmt(Math.abs(gap))} kg ${gap > 0 ? 'unaccounted for' : 'more than the batch weight'}.`
        : `${fmt(sum)} of ${fmt(l.qty)} kg traced to ${src.length} named ${src.length === 1 ? 'factory' : 'factories'}.`));
  return out;
}

// ---------------------------------------------------------------- production

// Kg of each received transfer consumed across every production record.
export function consumedByTransfer(db) {
  const used = {};
  for (const p of db.processes) for (const i of p.inputs) used[i.transferId] = (used[i.transferId] || 0) + i.kg;
  return used;
}

export function processBalance(db, p) {
  const out = lot(db, p.outputLotId);
  const claimedIn = p.inputs.reduce((s, i) => s + i.kg, 0);
  const otherIn = (p.nonClaimed || []).reduce((s, i) => s + i.kg, 0);
  const inKg = claimedIn + otherIn;
  const recIn = p.inputs.reduce((s, i) => s + i.kg * transferPct(db, transfer(db, i.transferId)) / 100, 0);
  const outKg = kgOf(out, out.qty);
  const recOut = fibreKgOf(out, out.qty) * out.recycledPct / 100;
  return {
    inKg, claimedIn, otherIn, recIn, outKg, recOut,
    computedPct: inKg ? (recIn / inKg) * 100 : 0,
    yieldPct: inKg ? (outKg / inKg) * 100 : 0,
    lossKg: inKg - outKg,
  };
}

export function checkProcess(db, p) {
  const c = mk(p.id, p.orgId);
  const type = PROCESS_TYPES[p.type];
  const out = lot(db, p.outputLotId);
  const b = processBalance(db, p);
  const res = [];

  // Inputs cannot exceed what was received.
  const used = consumedByTransfer(db);
  const over = p.inputs
    .map((i) => ({ t: transfer(db, i.transferId), used: used[i.transferId] }))
    .filter(({ t, used }) => used > transferKgIn(db, t) + 0.01);
  res.push(c('inputs', 'reconcile', 'Inputs covered by receipts', over.length ? 'fail' : 'pass',
    over.length ? over.map(({ t, used }) => `${fmt(used)} kg of ${t.id} consumed, only ${fmt(transferKgIn(db, t))} kg received`).join('; ') + '.'
      : `${fmt(b.claimedIn)} kg certified input drawn from ${p.inputs.map((i) => i.transferId).join(', ')}` +
        (b.otherIn ? `, plus ${fmt(b.otherIn)} kg non-recycled.` : '.')));

  // Yield plausibility.
  const [lo, hi] = type.yield;
  const y = round(b.yieldPct);
  res.push(c('yield', 'reconcile', 'Yield plausible', y < lo || y > hi ? 'warn' : 'pass',
    `${fmt(b.inKg)} kg in → ${fmt(round(b.outKg, 0))} kg out = ${y}% (expected ${lo}–${hi}% for ${type.label.toLowerCase()}).`));

  // Declared recycled % of output must be supported by the inputs.
  const cp = round(b.computedPct, 2);
  res.push(c('blend', 'reconcile', 'Recycled % supported by inputs',
    out.recycledPct > cp + RULES.compositionTolerancePts ? 'fail' : 'pass',
    `Inputs give ${cp}% recycled by weight; output declared ${out.recycledPct}%.`));

  // Garment tier: pieces × fabric consumption must fit inside fabric received.
  if (p.type === 'cut_sew') {
    const k = p.consumption?.kgPerPc || 0;
    const need = out.qty * k;
    res.push(c('consumption', 'reconcile', 'Fabric consumption reconciles', need > b.claimedIn + 0.01 ? 'fail' : 'pass',
      `${fmt(out.qty)} pcs × ${k} kg/pc (marker ${p.consumption?.marker || 'n/a'}) = ${fmt(round(need, 0))} kg needed; ` +
      `${fmt(b.claimedIn)} kg certified fabric used.` + (need > b.claimedIn ? ` Short by ${fmt(round(need - b.claimedIn, 0))} kg.` : '')));
  }

  const hasRecords = (p.records || []).length > 0;
  res.push(c('records', 'reconcile', 'Production records attached', hasRecords ? 'pass' : 'warn',
    hasRecords ? p.records.join(', ') : 'No production records attached.'));
  return res;
}

// ---------------------------------------------------------------- helpers

export function fmt(n) {
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}
const sign = (n) => (n > 0 ? '+' : '−');

export function worst(checks) {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}
