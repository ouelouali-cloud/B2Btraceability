// Supplier portal: what an invited supplier sees after accepting the invitation.
// Only their own lots, their own shipments, and requests addressed to them.

import { TIERS, MATERIALS, PROCESS_TYPES } from '../engine/rules.js';
import { org, lot } from '../engine/db.js';
import { checkTransfer, checkProcess, processBalance, consumedByTransfer } from '../engine/checks.js';
import { transferKgIn } from '../engine/db.js';
import { lotRemaining } from '../engine/ledger.js';
import { isSigned } from '../engine/declaration.js';
import { allChecks, completeness } from '../engine/trace.js';
import { esc, num, date, pill, dot, icon, tierIcon, countPills, bar, btn } from '../ui.js';
import { gapCard, fixButton } from './common.js';
import { STEPS, stepDone } from './declare.js';
import { namedSources, sourcedKg } from '../engine/checks.js';
import { today } from '../store.js';

export function tasks(db, me) {
  const o = org(db, me);
  const tier = TIERS[o.tier];
  if (o.status === 'invited') {
    const by = org(db, o.invitedBy);
    return `<header class="page-head"><div><p class="eyebrow">Invitation</p><h1>${esc(by.name)} invited you to share traceability data</h1>
      <p class="muted">They buy from you and need to show where their recycled material came from. You will be asked for your scope certificate, the documents for each shipment, and a record of each production run. Your prices and your other customers stay private.</p></div></header>
      <section class="section invite-card">
        <ol class="steps">
          <li><strong>Accept and add your scope certificate</strong><span>${tier.certRequired ? 'Needed before your shipments can carry a TC.' : 'Not required at your tier.'}</span></li>
          <li><strong>Record what you ship to ${esc(by.name)}</strong><span>TC, invoice, packing list for each shipment.</span></li>
          <li><strong>Invite your own supplier</strong><span>So the chain reaches the waste source.</span></li>
        </ol>
        ${btn('Accept invitation', 'form', { form: 'accept', org: me }, 'btn-primary')}
      </section>`;
  }

  const gaps = db.gaps.filter((g) => g.owner === me);
  const open = gaps.filter((g) => g.status === 'open');
  if (o.tier === 'waste') return wasteHome(db, o, open);
  const failing = allChecks(db).filter((c) => c.owner === me && c.status === 'fail' && !open.some((g) => g.key === c.key) && c.group !== 'claim');
  const comp = completeness(db, me, today());

  const common = commonSections(db, open, failing, comp);
  if (o.tier === 'recycler') return recyclerHome(db, o, common);

  return `
    <header class="page-head">
      <div><p class="eyebrow">${esc(tier.label)} · supplier portal</p><h1>${esc(o.name)}</h1>
      <p class="muted">You supply ${esc((o.suppliesTo || []).map((x) => org(db, x)?.name).join(', '))}. Anything here blocks their recycled content claim until it is fixed.</p></div>
      <div class="head-actions">${btn(`${icon('plus')} Record shipment`, 'form', { form: 'shipment' }, 'btn-primary')}${o.tier !== 'waste' ? btn(`${icon('plus')} Record production`, 'form', { form: 'production' }) : ''}</div>
    </header>
    ${common}`;
}

function commonSections(db, open, failing, comp) {
  return `
    <section class="section"><div class="section-head"><h2>Requests from your buyer (${open.length})</h2></div>
      ${open.length ? open.map((g) => `${gapCard(db, g)}<div class="gap-fix">${fixFor(db, g)}</div>`).join('') : '<p class="empty">No open requests. Thank you.</p>'}</section>
    ${failing.length ? `<section class="section"><div class="section-head"><h2>Also failing</h2><p class="muted">Not raised yet, but your buyer will see these.</p></div>
      <ul class="att-list">${failing.map((c) => `<li class="att">${dot('fail')}<div><div><strong>${esc(c.title)}</strong> <span class="mono muted">${esc(c.subject)}</span></div><div class="muted small">${esc(c.detail)}</div><div class="check-actions">${fixButton(c)}</div></div></li>`).join('')}</ul></section>` : ''}
    <section class="section"><div class="section-head"><h2>Your data</h2><span class="nowrap">${bar(comp.score)}</span></div>
      <ul class="todo">${comp.items.map((i) => `<li class="${i.ok ? 'done' : i.soft ? 'soft' : 'open'}"><span class="box" aria-hidden="true">${i.ok ? '✓' : ''}</span>${esc(i.label)}</li>`).join('')}</ul></section>`;
}

// The recycler is the first certified tier and the bridge between informal
// waste and certified fibre: it books every delivery of waste, confirms it
// against the trader's declaration, and turns it into fibre.
function recyclerHome(db, o, common) {
  const incoming = db.lots.filter((l) => l.origin && l.orgId !== o.id && !db.transfers.some((t) => t.lotId === l.id));
  const toSign = db.transfers.filter((t) => t.toOrg === o.id && lot(db, t.lotId)?.origin && isSigned(lot(db, t.lotId))
    && (!t.countersign || t.countersign.signedOn !== lot(db, t.lotId).origin.declaration.signedOn));
  const used = consumedByTransfer(db);
  const yard = db.transfers.filter((t) => t.toOrg === o.id).reduce((s, t) => s + Math.max(0, transferKgIn(db, t) - (used[t.id] || 0)), 0);
  const fibre = db.lots.filter((l) => l.orgId === o.id).reduce((s, l) => s + Math.max(0, lotRemaining(db, l)), 0);

  const queue = incoming.map((l) => {
    const signed = isSigned(l);
    const done = STEPS.filter((st) => stepDone(l, st.id)).length;
    const d = l.origin.declaration || {};
    return `<article class="batch ${signed ? '' : 'batch-waiting'}">
      <div class="batch-top"><div><p class="eyebrow"><span class="mono">${esc(l.id)}</span> · ${esc(org(db, l.orgId).name)}</p>
        <h3>${num(l.qty)} kg <span class="muted">${esc(l.origin.colourSort || 'cotton waste')}</span></h3>
        <p class="muted small">${namedSources(l).length} factories · ${signed ? `declaration ${esc(d.number)} signed ${date(d.signedOn)}` : `declaration ${done} of ${STEPS.length} steps`}</p></div>
        ${signed ? pill('pass', 'Ready') : pill('warn', 'Being declared')}</div>
      ${btn(signed ? 'Record goods-in' : 'Record weight now', 'form', { form: 'goodsin', lot: l.id }, `batch-cta ${signed ? 'btn-primary' : ''}`)}
    </article>`;
  }).join('');

  return `
    <header class="page-head">
      <div><p class="eyebrow">Recycler · supplier portal</p><h1>${esc(o.name)}</h1>
      <p class="muted">Book each delivery of waste, confirm it against the trader's declaration, record sorting and shredding, and ship fibre with a TC. Everything you enter reaches ${esc(org(db, db.tenantId)?.name || 'your buyer')} live.</p></div>
      <div class="head-actions">${btn(`${icon('plus')} Record production`, 'form', { form: 'production' }, 'btn-primary')}${btn(`${icon('plus')} Record shipment`, 'form', { form: 'shipment' })}</div>
    </header>
    <dl class="stats">
      <div><dt>Waiting for goods-in</dt><dd>${incoming.length}<span class="muted"> batches</span></dd></div>
      <div><dt>To countersign</dt><dd>${toSign.length}</dd></div>
      <div><dt>Waste in yard</dt><dd>${num(yard)}<span class="muted"> kg</span></dd></div>
      <div><dt>Fibre in stock</dt><dd>${num(fibre)}<span class="muted"> kg</span></dd></div>
    </dl>
    <section class="section"><div class="section-head"><h2>Goods-in queue</h2><p class="muted">Waste batches your suppliers have declared to you. Signed ones are ready to book.</p></div>
      <div class="batches">${queue || '<p class="empty">No waste waiting. New batches appear here the moment a trader starts declaring them.</p>'}</div></section>
    ${toSign.length ? `<section class="section"><div class="section-head"><h2>Declarations to countersign</h2></div>
      <ul class="att-list">${toSign.map((t) => `<li class="att">${dot('fail')}<div><div><strong>${esc(t.id)}</strong> · ${num(t.receivedQty)} kg of ${esc(t.lotId)} from ${esc(org(db, t.fromOrg).name)}</div>
        <div class="muted small">Received ${date(t.date)}. Declaration ${esc(lot(db, t.lotId).origin.declaration.number)} is signed and waiting for your confirmation.</div>
        <div class="check-actions">${btn('Countersign', 'form', { form: 'countersign', transfer: t.id }, 'btn-small btn-primary')}</div></div></li>`).join('')}</ul></section>` : ''}
    ${common}`;
}

// Waste traders get one job per batch: finish and sign its declaration.
function wasteHome(db, o, open) {
  const batches = db.lots.filter((l) => l.orgId === o.id && l.origin).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const buyer = org(db, o.suppliesTo?.[0]);
  const cards = batches.map((l) => {
    const done = STEPS.filter((s) => stepDone(l, s.id)).length;
    const signed = done === STEPS.length;
    const src = namedSources(l);
    return `<article class="batch ${signed ? 'batch-done' : ''}">
      <div class="batch-top"><div><p class="eyebrow"><span class="mono">${esc(l.id)}</span> · bagged ${date(l.createdAt)}</p>
        <h3>${num(l.qty)} kg <span class="muted">${esc(l.origin.colourSort || 'cotton waste')}</span></h3>
        <p class="muted small">${src.length} ${src.length === 1 ? 'factory' : 'factories'} · ${num(sourcedKg(l))} of ${num(l.qty)} kg traced</p></div>
        ${signed ? pill('pass', 'Signed') : pill('fail', `${done} of ${STEPS.length} steps`)}</div>
      <div class="batch-steps" aria-hidden="true">${STEPS.map((s) => `<span class="${stepDone(l, s.id) ? 'on' : ''}"></span>`).join('')}</div>
      <a class="btn ${signed ? '' : 'btn-primary'} batch-cta" href="#declare.${esc(l.id)}">${signed ? 'View declaration' : done ? 'Continue declaration' : 'Start declaration'}</a>
    </article>`;
  }).join('');
  return `
    <header class="page-head"><div><p class="eyebrow">Waste source · supplier portal</p><h1>${esc(o.name)}</h1>
      <p class="muted">For every batch you sell to ${esc(buyer?.name || 'the recycler')}: say which factories it came from and sign. About three minutes per batch.</p></div>
      <div class="head-actions">${btn(`${icon('plus')} New batch`, 'new-batch', {}, 'btn-primary')}</div></header>
    ${open.length ? `<section class="section"><div class="section-head"><h2>Messages from your buyer</h2></div>${open.map((g) => gapCard(db, g)).join('')}</section>` : ''}
    <section class="section"><div class="section-head"><h2>Your batches</h2></div>
      <div class="batches">${cards || '<p class="empty">No batches yet. Tap New batch when you bag waste for sale.</p>'}</div></section>`;
}

function fixFor(db, g) {
  const c = allChecks(db).find((x) => x.key === g.key);
  return c ? fixButton(c) : '';
}

export function shipments(db, me) {
  const row = (t, dir) => {
    const l = lot(db, t.lotId);
    const other = org(db, dir === 'out' ? t.toOrg : t.fromOrg);
    return `<tr><td><a class="mono" href="#handoff.${esc(t.id)}">${esc(t.id)}</a></td><td class="nowrap">${date(t.date)}</td>
      <td>${dir === 'out' ? 'To' : 'From'} ${esc(other.name)}</td><td>${esc(MATERIALS[l.material].label)}</td>
      <td class="num">${num(t.qty)} ${esc(l.unit)}</td><td class="mono small">${esc(t.tc?.number || '—')}</td><td>${countPills(checkTransfer(db, t))}</td></tr>`;
  };
  const out = db.transfers.filter((t) => t.fromOrg === me);
  const inn = db.transfers.filter((t) => t.toOrg === me);
  const table = (list, dir) => (list.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Ref</th><th>Date</th><th>Party</th><th>Material</th><th class="num">Qty</th><th>TC</th><th>Checks</th></tr></thead>
    <tbody>${list.map((t) => row(t, dir)).join('')}</tbody></table></div>` : '<p class="empty">None recorded.</p>');
  return `
    <header class="page-head"><div><p class="eyebrow">Supplier portal</p><h1>Shipments</h1></div>
      <div class="head-actions">${btn(`${icon('plus')} Record shipment`, 'form', { form: 'shipment' }, 'btn-primary')}</div></header>
    <section class="section"><div class="section-head"><h2>Shipped by you</h2></div>${table(out, 'out')}</section>
    <section class="section"><div class="section-head"><h2>Received by you</h2></div>${table(inn, 'in')}</section>`;
}

export function production(db, me) {
  const o = org(db, me);
  const procs = db.processes.filter((p) => p.orgId === me);
  const lots = db.lots.filter((l) => l.orgId === me);
  return `
    <header class="page-head"><div><p class="eyebrow">Supplier portal</p><h1>Production</h1>
      <p class="muted">Each run turns received material into a new lot. The recycled share of the output is worked out from the inputs.</p></div>
      <div class="head-actions">${o.tier !== 'waste' ? btn(`${icon('plus')} Record production`, 'form', { form: 'production' }, 'btn-primary') : ''}</div></header>
    <section class="section"><div class="section-head"><h2>Runs</h2></div>
      ${procs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>Date</th><th>Step</th><th class="num">In → out kg</th><th class="num">Yield</th><th>Checks</th></tr></thead><tbody>
      ${procs.map((p) => { const b = processBalance(db, p); return `<tr><td><a class="mono" href="#process.${esc(p.id)}">${esc(p.id)}</a></td><td class="nowrap">${date(p.date)}</td><td>${esc(PROCESS_TYPES[p.type].label)}</td><td class="num">${num(b.inKg)} → ${num(b.outKg)}</td><td class="num">${num(b.yieldPct, 1)}%</td><td>${countPills(checkProcess(db, p))}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<p class="empty">${o.tier === 'waste' ? 'Waste sources collect rather than produce. Record each collection as a lot with its origin declaration.' : 'No production recorded.'}</p>`}
    </section>
    <section class="section"><div class="section-head"><h2>Your lots</h2>${o.tier === 'waste' ? btn(`${icon('plus')} New batch`, 'new-batch', {}, 'btn-small') : ''}</div>
      ${lots.length ? `<ul class="plain">${lots.map((l) => `<li>${tierIcon(o.tier)} <a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a> ${esc(l.spec || MATERIALS[l.material].label)} · ${num(l.qty)} ${esc(l.unit)} · ${l.recycledPct}%</li>`).join('')}</ul>` : '<p class="empty">No lots.</p>'}
    </section>`;
}
