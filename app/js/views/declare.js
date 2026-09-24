// The waste source's declaration, built for a phone in a jhut godown:
// four short steps, big inputs, Bangla labels under the English ones,
// photos instead of paperwork, and a finger signature.

import { WASTE_KINDS, COLOUR_SORTS, FIBRE_SORTS, RULES } from '../engine/rules.js';
import { org, lot, pctDiff } from '../engine/db.js';
import { namedSources, sourcedKg, collectionPeriod, originMissing } from '../engine/checks.js';
import { STEPS, stepDone, firstOpenStep, isSigned } from '../engine/declaration.js';
import { syncStatus } from '../store.js';

export { STEPS, stepDone };
import { esc, num, date, icon } from '../ui.js';
import { backLink } from './common.js';

const KNOWN_FACTORIES = ['Anwar Knit Composite', 'Fatullah Garments', 'Siddhirganj Knitwear', 'Hossain Knit Wear', 'Sonar Apparel Ltd (cutting room)'];

const lbl = (forId, en, bn, hint = '') => `<label class="wz-label" for="${forId}"><span>${esc(en)}</span><span class="bn" lang="bn">${esc(bn)}</span></label>${hint ? `<p class="wz-hint">${esc(hint)}</p>` : ''}`;

function photoField(name, value, en, bn, hint) {
  return `<div class="wz-field">
    ${lbl(`${name}-file`, en, bn, hint)}
    <div class="photo-drop ${value ? 'has-photo' : ''}">
      <img id="${name}-preview" alt="" ${value ? `src="${value}"` : 'hidden'}>
      <label class="photo-btn" for="${name}-file">${icon('doc')}<span>${value ? 'Replace photo' : 'Take or choose photo'}</span></label>
      <input class="sr" id="${name}-file" type="file" accept="image/*" capture="environment" data-photo="${name}">
      <input type="hidden" name="${name}" id="${name}" value="${esc(value || '')}">
    </div>
  </div>`;
}

function radios(name, options, value, en, bn) {
  return `<fieldset class="wz-field wz-chips"><legend class="wz-label"><span>${esc(en)}</span><span class="bn" lang="bn">${esc(bn)}</span></legend>
    <div class="chips">${options.map((o, i) => `<input type="radio" id="${name}-${i}" name="${name}" value="${esc(o)}" ${o === value ? 'checked' : ''}><label for="${name}-${i}">${esc(o)}</label>`).join('')}</div></fieldset>`;
}

function stepBatch(l) {
  const o = l.origin || {};
  return `
    <div class="wz-field">${lbl('qty', 'Batch weight (kg)', 'মোট ওজন (কেজি)', 'As printed on the weighbridge slip.')}
      <input class="wz-big" id="qty" name="qty" type="number" inputmode="decimal" step="any" min="0" value="${esc(l.qty || '')}"></div>
    <div class="wz-row">
      <div class="wz-field">${lbl('bags', 'Number of bags', 'বস্তার সংখ্যা')}<input id="bags" name="bags" type="number" inputmode="numeric" min="0" value="${esc(o.bags ?? '')}"></div>
      <div class="wz-field">${lbl('createdAt', 'Date bagged', 'বস্তাবন্দির তারিখ')}<input id="createdAt" name="createdAt" type="date" value="${esc(l.createdAt || '')}"></div>
    </div>
    <div class="wz-field">${lbl('slipNumber', 'Weighbridge slip number', 'ওজন স্লিপ নম্বর')}<input id="slipNumber" name="slipNumber" value="${esc(o.slipNumber || '')}" autocomplete="off"></div>
    ${photoField('slipPhoto', o.slipPhoto, 'Photo of the weighbridge slip', 'ওজন স্লিপের ছবি', 'Optional, but auditors ask for it.')}`;
}

function stepSources(l) {
  const src = (l.origin?.sources || []).length ? l.origin.sources : [{ name: '', kind: WASTE_KINDS[0], city: '', kg: '', collectedOn: '' }];
  const sum = sourcedKg(l);
  return `
    <p class="wz-intro">Which factories did this waste come from? One card per factory. The weights must add up to the batch: <strong>${num(l.qty)} kg</strong>.</p>
    <datalist id="factories">${KNOWN_FACTORIES.map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist>
    <ol class="src-list">${src.map((s, i) => `<li class="src-card">
      <div class="src-head"><span class="src-n">${i + 1}</span>
        ${src.length > 1 ? `<button type="button" class="btn btn-quiet btn-small" data-action="wiz-remove-source" data-i="${i}">Remove</button>` : ''}</div>
      <div class="wz-field">${lbl(`src_name_${i}`, 'Factory', 'কারখানা')}<input id="src_name_${i}" name="src_name_${i}" list="factories" value="${esc(s.name)}" autocomplete="off"></div>
      <div class="wz-row">
        <div class="wz-field">${lbl(`src_kg_${i}`, 'Weight (kg)', 'ওজন (কেজি)')}<input class="src-kg" id="src_kg_${i}" name="src_kg_${i}" type="number" inputmode="decimal" step="any" min="0" value="${esc(s.kg || '')}"></div>
        <div class="wz-field">${lbl(`src_date_${i}`, 'Collected on', 'সংগ্রহের তারিখ')}<input id="src_date_${i}" name="src_date_${i}" type="date" value="${esc(s.collectedOn || '')}"></div>
      </div>
      <div class="wz-row">
        <div class="wz-field">${lbl(`src_kind_${i}`, 'Waste type', 'ঝুটের ধরন')}<select id="src_kind_${i}" name="src_kind_${i}">${WASTE_KINDS.map((k) => `<option ${k === s.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        <div class="wz-field">${lbl(`src_city_${i}`, 'Area', 'এলাকা')}<input id="src_city_${i}" name="src_city_${i}" value="${esc(s.city || '')}"></div>
      </div>
    </li>`).join('')}</ol>
    <button type="button" class="btn wz-add" data-action="wiz-add-source">${icon('plus')} Add another factory</button>
    <div class="src-total" id="src-total" data-target="${esc(l.qty)}">${totalBar(sum, l.qty)}</div>`;
}

export function totalBar(sum, target) {
  const ok = target > 0 && pctDiff(sum, target) <= RULES.qtyTolerancePct;
  const pct = target ? Math.min(100, (sum / target) * 100) : 0;
  const left = target - sum;
  return `<div class="src-bar"><span class="src-fill ${ok ? 'ok' : ''}" style="width:${pct}%"></span></div>
    <p class="${ok ? 'ok-text' : 'bad-text'}">${num(sum)} of ${num(target)} kg traced to a factory.
    ${ok ? 'Adds up.' : left > 0 ? `${num(left)} kg still to account for.` : `${num(-left)} kg more than the batch weight.`}</p>`;
}

function stepSort(l) {
  const o = l.origin || {};
  const c = o.contamination || {};
  return `
    <p class="wz-intro">The recycler can only shred clean, sorted cotton. Elastane and prints ruin the fibre.</p>
    ${radios('colourSort', COLOUR_SORTS, o.colourSort, 'Colour group', 'রং')}
    ${radios('fibre', FIBRE_SORTS, o.fibre, 'Fibre content', 'তন্তু')}
    <fieldset class="wz-field"><legend class="wz-label"><span>Checked before bagging</span><span class="bn" lang="bn">বস্তাবন্দির আগে যাচাই</span></legend>
      <label class="tick"><input type="checkbox" name="noElastane" ${c.noElastane ? 'checked' : ''}><span>No elastane or spandex pieces</span></label>
      <label class="tick"><input type="checkbox" name="noPrint" ${c.noPrint ? 'checked' : ''}><span>No printed, coated or embroidered pieces</span></label>
    </fieldset>
    ${radios('recycledType', ['pre-consumer', 'post-consumer'], l.recycledType, 'Where the waste comes from', 'ঝুটের উৎস')}
    <p class="wz-hint">Pre-consumer: offcuts from factories that never reached a customer. Post-consumer: used clothing.</p>`;
}

function stepDeclare(db, l) {
  const o = l.origin || {};
  const d = o.declaration || {};
  const buyer = org(db, org(db, l.orgId).suppliesTo?.[0]);
  const missing = originMissing(l).filter(([k]) => !['signer', 'signature'].includes(k));
  const [from, to] = collectionPeriod(l);
  const src = namedSources(l);
  return `
    ${missing.length ? `<div class="wz-warn">${icon('alert')}<div><strong>Finish the earlier steps first</strong><br>${missing.map(([, m]) => esc(m)).join(' · ')}</div></div>` : ''}
    <blockquote class="declaration" lang="en">
      I declare that the <strong>${num(l.qty)} kg</strong> of ${esc((o.fibre || 'cotton').toLowerCase())} waste in batch <strong>${esc(l.id)}</strong>
      is ${esc(l.recycledType || 'pre-consumer')} material collected from ${src.length ? src.map((s) => esc(s.name)).join(', ') : 'the factories listed'}
      ${from ? `between ${date(from)} and ${date(to)}` : ''}, and that it has not been mixed with material from any other source.
    </blockquote>
    <div class="wz-row">
      <div class="wz-field">${lbl('signer', 'Your name', 'আপনার নাম')}<input id="signer" name="signer" value="${esc(d.signer || '')}" autocomplete="name"></div>
      <div class="wz-field">${lbl('role', 'Role', 'পদবি')}<input id="role" name="role" value="${esc(d.role || '')}" placeholder="Owner, manager"></div>
    </div>
    <div class="wz-field">
      <div class="wz-label-row">${lbl('sig-pad', 'Sign here with your finger', 'এখানে স্বাক্ষর করুন')}<button type="button" class="btn btn-quiet btn-small" data-action="sig-clear">Clear</button></div>
      <canvas id="sig-pad" class="sig-pad" data-existing="${esc(d.signature || '')}" aria-label="Signature pad"></canvas>
      <input type="hidden" name="signature" id="signature" value="${esc(d.signature || '')}">
    </div>
    ${photoField('paperPhoto', d.paperPhoto, 'Or: photo of the signed paper form', 'অথবা: স্বাক্ষরিত কাগজের ছবি', '')}
    <p class="wz-hint">Sent to ${esc(buyer?.name || 'your buyer')}. Once signed, any change to the batch needs a new signature.</p>`;
}

function summary(db, l) {
  const o = l.origin;
  const d = o.declaration;
  const [from, to] = collectionPeriod(l);
  const buyer = org(db, org(db, l.orgId).suppliesTo?.[0]);
  return `<section class="wz-done">
    <div class="wz-done-head">${icon('cert')}<div><h2>Declaration ${esc(d.number)} signed</h2>
      <p class="muted">Signed by ${esc(d.signer)}${d.role ? `, ${esc(d.role)}` : ''} on ${date(d.signedOn)}. Sent to ${esc(buyer?.name || 'buyer')}.</p></div></div>
    <dl class="kv">
      <div><dt>Batch</dt><dd>${num(l.qty)} kg in ${num(o.bags)} bags · slip ${esc(o.slipNumber)}</dd></div>
      <div><dt>Collected</dt><dd>${date(from)} to ${date(to)}</dd></div>
      <div><dt>Sort</dt><dd>${esc(o.colourSort)} · ${esc(o.fibre)} · ${esc(l.recycledType)}</dd></div>
      <div><dt>Checked</dt><dd>No elastane · No prints</dd></div>
    </dl>
    <div class="table-wrap"><table class="table"><thead><tr><th>Factory</th><th>Type</th><th>Collected</th><th class="num">kg</th></tr></thead>
      <tbody>${namedSources(l).map((s) => `<tr><td>${esc(s.name)}<div class="muted small">${esc(s.city || '')}</div></td><td>${esc(s.kind)}</td><td class="nowrap">${date(s.collectedOn)}</td><td class="num">${num(s.kg)}</td></tr>`).join('')}</tbody></table></div>
    <div class="evidence">${o.slipPhoto ? `<figure><img src="${o.slipPhoto}" alt="Weighbridge slip ${esc(o.slipNumber)}"><figcaption>Weighbridge slip</figcaption></figure>` : ''}
      ${d.signature ? `<figure class="sig-fig"><img src="${d.signature}" alt="Signature of ${esc(d.signer)}"><figcaption>Signature</figcaption></figure>` : ''}
      ${d.paperPhoto ? `<figure><img src="${d.paperPhoto}" alt="Signed paper form"><figcaption>Signed paper form</figcaption></figure>` : ''}</div>
  </section>`;
}

export function declare(db, lotId, step, editable) {
  const l = lot(db, lotId);
  if (!l || !l.origin) return '<p class="empty">No waste batch with that reference.</p>';
  const signed = isSigned(l);
  const sync = syncStatus();
  const offlineNote = sync.status === 'offline'
    ? `<div class="wz-offline" role="status"><strong>You are offline.</strong> Everything you enter is saved on this phone${sync.pending ? ` (${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting)` : ''} and sent when you are back online.</div>`
    : sync.pending ? `<div class="wz-offline wz-sending" role="status">Sending ${sync.pending} saved ${sync.pending === 1 ? 'change' : 'changes'}…</div>` : '';
  if (signed && step !== 'edit' && !STEPS.some((s) => s.id === step)) {
    return `${backLink('#tasks', 'My batches')}
      <header class="page-head"><div><p class="eyebrow">Waste declaration · ${esc(l.id)}</p><h1>${num(l.qty)} kg ${esc(l.spec || 'cotton cutting waste')}</h1></div>
      ${editable ? `<div class="head-actions"><button type="button" class="btn" data-action="wiz-step" data-step="batch">Edit batch</button></div>` : ''}</header>
      ${offlineNote}${summary(db, l)}`;
  }
  const cur = STEPS.some((s) => s.id === step) ? step : firstOpenStep(l);
  const idx = STEPS.findIndex((s) => s.id === cur);
  const body = { batch: stepBatch, sources: stepSources, sort: stepSort, declare: (x) => stepDeclare(db, x) }[cur](l);
  return `${backLink('#tasks', 'My batches')}
    <div class="wizard">
      ${offlineNote}
      <header class="wz-head">
        <p class="eyebrow">Waste declaration · ${esc(l.id)}</p>
        <h1>${esc(STEPS[idx].label)} <span class="bn" lang="bn">${esc(STEPS[idx].bn)}</span></h1>
        <ol class="wz-steps" aria-label="Steps">${STEPS.map((s, i) => `<li>
          <button type="button" data-action="wiz-step" data-step="${s.id}" class="${s.id === cur ? 'current' : ''} ${stepDone(l, s.id) ? 'done' : ''}" ${s.id === cur ? 'aria-current="step"' : ''}>
            <span class="wz-dot">${stepDone(l, s.id) ? '✓' : i + 1}</span><span class="wz-step-label">${esc(s.label)}</span></button></li>`).join('')}</ol>
      </header>
      <form id="wizard" class="wz-body" data-lot="${esc(l.id)}" data-step="${cur}" novalidate>
        <fieldset ${editable ? '' : 'disabled'} class="wz-fields">${body}</fieldset>
        <p class="form-error" id="wz-error" hidden></p>
        ${editable ? `<footer class="wz-foot ${cur === 'declare' ? 'wz-foot-static' : ''}">
          ${idx > 0 ? `<button type="button" class="btn wz-back" data-action="wiz-back">Back</button>` : '<span></span>'}
          ${cur === 'declare' ? `<button type="submit" class="btn btn-primary wz-next">Sign and send</button>` : `<button type="submit" class="btn btn-primary wz-next">Save and continue</button>`}
        </footer>` : ''}
      </form>
    </div>`;
}
