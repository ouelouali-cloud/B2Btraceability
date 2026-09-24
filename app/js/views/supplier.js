// Supplier portal: what an invited supplier sees after accepting the invitation.
// Only their own lots, their own shipments, and requests addressed to them.

import { TIERS, MATERIALS, PROCESS_TYPES } from '../engine/rules.js';
import { org, lot } from '../engine/db.js';
import { checkTransfer, checkProcess, processBalance } from '../engine/checks.js';
import { allChecks, completeness } from '../engine/trace.js';
import { esc, num, date, pill, dot, icon, tierIcon, countPills, bar, btn } from '../ui.js';
import { gapCard, fixButton } from './common.js';
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
  const failing = allChecks(db).filter((c) => c.owner === me && c.status === 'fail' && !open.some((g) => g.key === c.key) && c.group !== 'claim');
  const comp = completeness(db, me, today());

  return `
    <header class="page-head">
      <div><p class="eyebrow">${esc(tier.label)} · supplier portal</p><h1>${esc(o.name)}</h1>
      <p class="muted">You supply ${esc((o.suppliesTo || []).map((x) => org(db, x)?.name).join(', '))}. Anything here blocks their recycled content claim until it is fixed.</p></div>
      <div class="head-actions">${btn(`${icon('plus')} Record shipment`, 'form', { form: 'shipment' }, 'btn-primary')}${o.tier !== 'waste' ? btn(`${icon('plus')} Record production`, 'form', { form: 'production' }) : ''}</div>
    </header>
    <section class="section"><div class="section-head"><h2>Requests from your buyer (${open.length})</h2></div>
      ${open.length ? open.map((g) => `${gapCard(db, g)}<div class="gap-fix">${fixFor(db, g)}</div>`).join('') : '<p class="empty">No open requests. Thank you.</p>'}</section>
    ${failing.length ? `<section class="section"><div class="section-head"><h2>Also failing</h2><p class="muted">Not raised yet, but your buyer will see these.</p></div>
      <ul class="att-list">${failing.map((c) => `<li class="att">${dot('fail')}<div><div><strong>${esc(c.title)}</strong> <span class="mono muted">${esc(c.subject)}</span></div><div class="muted small">${esc(c.detail)}</div><div class="check-actions">${fixButton(c)}</div></div></li>`).join('')}</ul></section>` : ''}
    <section class="section"><div class="section-head"><h2>Your data</h2><span class="nowrap">${bar(comp.score)}</span></div>
      <ul class="todo">${comp.items.map((i) => `<li class="${i.ok ? 'done' : i.soft ? 'soft' : 'open'}"><span class="box" aria-hidden="true">${i.ok ? '✓' : ''}</span>${esc(i.label)}</li>`).join('')}</ul></section>`;
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
    <section class="section"><div class="section-head"><h2>Your lots</h2>${o.tier === 'waste' ? btn(`${icon('plus')} Record collected waste`, 'form', { form: 'wastelot' }, 'btn-small') : ''}</div>
      ${lots.length ? `<ul class="plain">${lots.map((l) => `<li>${tierIcon(o.tier)} <a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a> ${esc(l.spec || MATERIALS[l.material].label)} · ${num(l.qty)} ${esc(l.unit)} · ${l.recycledPct}%</li>`).join('')}</ul>` : '<p class="empty">No lots.</p>'}
    </section>`;
}
