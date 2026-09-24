// The waste source's reclaimed material declaration: the four steps, when
// each counts as done, and how a step's form values are applied to the lot.
// Shared by the phone form (views/declare.js) and the command layer.

import { RULES } from './rules.js';
import { org, lot, pctDiff } from './db.js';
import { namedSources, sourcedKg, originMissing } from './checks.js';

export const STEPS = [
  { id: 'batch', label: 'Batch', bn: 'বস্তা ও ওজন' },
  { id: 'sources', label: 'Sources', bn: 'উৎস কারখানা' },
  { id: 'sort', label: 'Sort', bn: 'রং ও তন্তু' },
  { id: 'declare', label: 'Sign', bn: 'ঘোষণা ও স্বাক্ষর' },
];

export function stepDone(l, id) {
  const o = l.origin || {};
  const src = namedSources(l);
  if (id === 'batch') return l.qty > 0 && !!o.slipNumber;
  if (id === 'sources') return src.length > 0 && src.every((s) => s.kg > 0 && s.collectedOn) && pctDiff(sourcedKg(l), l.qty) <= RULES.qtyTolerancePct;
  if (id === 'sort') return !!(o.colourSort && o.fibre && l.recycledType && o.contamination?.noElastane && o.contamination?.noPrint);
  if (id === 'declare') return !!(o.declaration?.signedOn && (o.declaration.signature || o.declaration.paperPhoto));
  return false;
}

export const isSigned = (l) => stepDone(l, 'declare') && !originMissing(l).length;
export const firstOpenStep = (l) => (STEPS.find((s) => !stepDone(l, s.id)) || STEPS[STEPS.length - 1]).id;

export function nextStep(step) {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[i + 1]?.id || 'summary';
}
export function prevStep(step) {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[Math.max(0, i - 1)].id;
}

const snapshot = (l) => JSON.stringify([l.qty, l.recycledType, { ...l.origin, declaration: undefined }]);

// Apply one step's values to the lot (mutates). Returns an error string, or ''.
// Any change to the declared facts after signing clears the signature.
export function applyStep(db, lotId, step, v, today) {
  const l = lot(db, lotId);
  const o = l.origin;
  const before = snapshot(l);
  if (step === 'batch') {
    l.qty = Number(v.qty) || 0;
    l.createdAt = v.createdAt || l.createdAt;
    o.bags = v.bags === '' || v.bags === undefined ? null : Number(v.bags);
    o.slipNumber = (v.slipNumber || '').trim();
    if (v.slipPhoto) o.slipPhoto = v.slipPhoto;
  }
  if (step === 'sources') {
    const idx = [...new Set(Object.keys(v).filter((k) => k.startsWith('src_name_')).map((k) => k.slice(9)))];
    o.sources = idx.map((i) => ({
      name: (v[`src_name_${i}`] || '').trim(), kind: v[`src_kind_${i}`], city: (v[`src_city_${i}`] || '').trim(),
      kg: Number(v[`src_kg_${i}`]) || 0, collectedOn: v[`src_date_${i}`] || '',
    })).filter((s) => s.name || s.kg);
    if (v.addBlank) o.sources.push({ name: '', kind: 'Cutting waste', city: '', kg: 0, collectedOn: '' });
    if (Number.isInteger(v.remove)) o.sources.splice(v.remove, 1);
  }
  if (step === 'sort') {
    o.colourSort = v.colourSort || '';
    o.fibre = v.fibre || '';
    l.recycledType = v.recycledType || '';
    o.contamination = { noElastane: v.noElastane === 'on', noPrint: v.noPrint === 'on' };
  }
  const d = o.declaration || (o.declaration = {});
  if (snapshot(l) !== before && d.signedOn) {
    d.signedOn = '';
    d.signature = null;
    d.paperPhoto = null;
  }
  if (step === 'declare') {
    d.signer = (v.signer || '').trim();
    d.role = (v.role || '').trim();
    d.signature = v.signature || null;
    if (v.paperPhoto) d.paperPhoto = v.paperPhoto;
    const open = originMissing(l).filter(([k]) => !['signer', 'signature'].includes(k));
    if (open.length) return `Finish the earlier steps first: ${open.map(([, m]) => m.toLowerCase()).join(', ')}.`;
    if (!d.signer) return 'Type your name before signing.';
    if (!d.signature && !d.paperPhoto) return 'Sign in the box, or add a photo of the signed paper form.';
    d.signedOn = today;
    d.number = d.number || `RMD-${org(db, l.orgId).name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()}-${today.slice(2, 4)}${today.slice(5, 7)}-${l.id.replace(/^L-/, '')}`;
  }
  return '';
}
