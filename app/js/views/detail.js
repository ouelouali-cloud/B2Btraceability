// Detail pages: one handoff, one production run, one lot, one organisation.

import { TIERS, MATERIALS, PROCESS_TYPES, DOC_TYPES, RULES, requiredDocs } from '../engine/rules.js';
import { org, lot, transfer, kgOf, pctDiff, transferKgIn } from '../engine/db.js';
import { checkTransfer, checkProcess, checkOrigin, processBalance, consumedByTransfer, originMissing, namedSources, sourcedKg, collectionPeriod } from '../engine/checks.js';
import { productThumb } from './product.js';
import { completeness } from '../engine/trace.js';
import { lotRemaining } from '../engine/ledger.js';
import { esc, num, date, pill, tierIcon, icon, btn, bar, countPills } from '../ui.js';
import { checkList, gapCard, backLink } from './common.js';
import { actingAs, isTenant, today, fileUrl } from '../store.js';

const scan = (f) => (f?.sha ? ` <a class="scan-link" href="${esc(fileUrl(f))}" target="_blank" rel="noopener" title="Open scan (SHA-256 ${esc(f.sha.slice(0, 12))}…)">${icon('doc')}<span class="sr">Open scan</span></a>` : '');
const notFound = (what) => `<p class="empty">${esc(what)} not found, or not shared with your company.</p>`;

// ---------------------------------------------------------------- handoff

export function handoff(db, id) {
  const t = transfer(db, id);
  if (!t) return notFound('Shipment');
  const seller = org(db, t.fromOrg);
  const buyer = org(db, t.toOrg);
  const l = lot(db, t.lotId);
  const checks = checkTransfer(db, t);
  const needed = requiredDocs(seller, buyer);
  const me = actingAs();
  const isSeller = me === seller.id;
  const isBuyer = me === buyer.id;

  const partyCell = (val, party) => {
    if (!val) return '<td class="muted">—</td>';
    const cls = val === party.name ? '' : 'cell-warn';
    return `<td class="${cls}">${esc(val)}</td>`;
  };
  const qtyCell = (v) => (Number.isFinite(v) ? `<td class="num ${pctDiff(v, t.qty) > RULES.qtyTolerancePct ? 'cell-bad' : ''}">${num(v, 2)}</td>` : '<td class="muted num">—</td>');
  const pctCell = (v) => (Number.isFinite(v) ? `<td class="num ${Math.abs(v - l.recycledPct) > RULES.compositionTolerancePts ? 'cell-bad' : ''}">${v}%</td>` : '<td class="muted num">—</td>');

  const rows = [];
  if (TIERS[seller.tier].certRequired || t.tc) {
    const tc = t.tc || {};
    rows.push(`<tr class="${tc.number ? '' : 'row-missing'}"><th scope="row"><span class="doc-kind doc-cert">Transaction cert.</span></th>
      <td class="mono">${esc(tc.number || 'Missing')}${scan(tc.file)}</td><td class="nowrap">${date(tc.date)}</td>
      ${partyCell(tc.seller, seller)}${partyCell(tc.buyer, buyer)}${qtyCell(tc.qty)}${pctCell(tc.recycledPct)}
      <td>${isSeller ? btn('Edit', 'form', { form: 'doc', transfer: t.id, doc: 'TC' }, 'btn-small') : ''}</td></tr>`);
  }
  for (const k of Object.keys(DOC_TYPES)) {
    const d = t.docs?.[k];
    if (!d && !needed.includes(k)) continue;
    rows.push(`<tr class="${d?.number ? '' : 'row-missing'}"><th scope="row"><span class="doc-kind">${esc(DOC_TYPES[k].label)}</span></th>
      <td class="mono">${esc(d?.number || 'Missing')}${scan(d?.file)}</td><td class="nowrap">${date(d?.date)}</td>
      ${partyCell(d?.seller, seller)}${partyCell(d?.buyer, buyer)}${qtyCell(d?.qty)}${pctCell(d?.recycledPct)}
      <td>${isSeller ? btn(d ? 'Edit' : 'Add', 'form', { form: 'doc', transfer: t.id, doc: k }, 'btn-small') : ''}</td></tr>`);
  }
  rows.push(`<tr><th scope="row"><span class="doc-kind doc-internal">Goods received</span></th>
    <td class="muted">Buyer weighing</td><td class="nowrap">—</td><td class="muted">—</td><td>${esc(buyer.name)}</td>${qtyCell(t.receivedQty)}<td class="muted num">—</td>
    <td>${isBuyer ? btn('Edit', 'form', { form: 'received', transfer: t.id }, 'btn-small') : ''}</td></tr>`);

  const gapsHere = db.gaps.filter((g) => g.key.startsWith(`${t.id}:`));
  return `
    ${backLink(isTenant() ? '#chain' : '#shipments', isTenant() ? 'Chain' : 'Shipments')}
    <header class="page-head">
      <div><p class="eyebrow">Handoff <span class="mono">${esc(t.id)}</span> · shipped ${date(t.date)}</p>
      <h1 class="handoff-title"><span>${tierIcon(seller.tier)} ${esc(seller.name)}</span><span class="arrow">→</span><span>${tierIcon(buyer.tier)} ${esc(buyer.name)}</span></h1>
      <p class="muted"><a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a> ${esc(l.spec || MATERIALS[l.material].label)} · ${num(t.qty)} ${esc(l.unit)} at ${l.recycledPct}% recycled</p></div>
      <div>${countPills(checks)}</div>
    </header>
    <section class="section">
      <div class="section-head"><h2>Document cross-check</h2><p class="muted">Every document is read against the TC. Red cells are outside tolerance (±${RULES.qtyTolerancePct}% on quantity, ±${RULES.compositionTolerancePts} pt on recycled %). Amber names differ from the registered company name.</p></div>
      <div class="table-wrap"><table class="table matrix">
        <thead><tr><th>Document</th><th>Number</th><th>Date</th><th>Seller</th><th>Buyer</th><th class="num">Qty (${esc(l.unit)})</th><th class="num">Rec. %</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Checks</h2></div>
      ${checkList(db, checks)}
    </section>
    ${gapsHere.length ? `<section class="section"><div class="section-head"><h2>Gaps on this handoff</h2></div>${gapsHere.map((g) => gapCard(db, g)).join('')}</section>` : ''}`;
}

// ---------------------------------------------------------------- production run

export function processView(db, id) {
  const p = db.processes.find((x) => x.id === id);
  if (!p) return notFound('Production record');
  const o = org(db, p.orgId);
  const out = lot(db, p.outputLotId);
  const b = processBalance(db, p);
  const checks = checkProcess(db, p);
  const used = consumedByTransfer(db);
  const inputs = p.inputs.map((i) => {
    const t = transfer(db, i.transferId);
    const tl = lot(db, t.lotId);
    return `<tr><td><a class="mono" href="#handoff.${esc(t.id)}">${esc(t.id)}</a> from ${esc(org(db, t.fromOrg).name)}</td>
      <td>${esc(MATERIALS[tl.material].label)}</td><td class="num">${num(i.kg)}</td>
      <td class="num">${t.tc?.recycledPct ?? tl.recycledPct}%</td><td class="num">${num(transferKgIn(db, t) - used[t.id])}</td></tr>`;
  }).join('') + (p.nonClaimed || []).map((n) => `<tr><td class="muted">Non-recycled input</td><td>${esc(MATERIALS[n.material]?.label || n.material)} <span class="muted small">${esc(n.note || '')}</span></td>
      <td class="num">${num(n.kg)}</td><td class="num">0%</td><td class="muted num">—</td></tr>`).join('');

  const flow = `<div class="flow">
    <div class="flow-box"><span class="flow-num">${num(b.inKg)}</span><span class="flow-unit">kg in</span><span class="muted small">${num(b.recIn)} kg recycled</span></div>
    <div class="flow-arrow">→</div>
    <div class="flow-box"><span class="flow-num">${num(b.outKg)}</span><span class="flow-unit">kg out</span><span class="muted small">${out.unit === 'pcs' ? `${num(out.qty)} pcs × ${out.kgPerUnit} kg` : `${num(b.recOut)} kg recycled`}</span></div>
    <div class="flow-box flow-loss"><span class="flow-num">${num(b.lossKg)}</span><span class="flow-unit">kg loss</span><span class="muted small">${num(100 - b.yieldPct, 1)}% of input</span></div>
  </div>`;

  return `
    ${backLink(isTenant() ? '#chain' : '#production', isTenant() ? 'Chain' : 'Production')}
    <header class="page-head">
      <div><p class="eyebrow">Production <span class="mono">${esc(p.id)}</span> · ${date(p.date)}</p>
      <h1>${esc(PROCESS_TYPES[p.type].label)} at ${esc(o.name)}</h1>
      <p class="muted">Output <a class="mono" href="#lot.${esc(out.id)}">${esc(out.id)}</a> ${esc(out.spec || MATERIALS[out.material].label)}, declared ${out.recycledPct}% recycled</p></div>
      <div class="head-actions">${actingAs() === o.id ? btn('Correct production record', 'form', { form: 'process', process: p.id }, 'btn-primary') : countPills(checks)}</div>
    </header>
    ${flow}
    <section class="section"><div class="section-head"><h2>Inputs</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Source</th><th>Material</th><th class="num">kg used</th><th class="num">Recycled</th><th class="num">kg left</th></tr></thead>
        <tbody>${inputs}</tbody></table></div>
      ${p.consumption ? `<p class="muted small">Fabric consumption from marker ${esc(p.consumption.marker)}: ${p.consumption.kgPerPc} kg per piece, cutting waste included.</p>` : ''}
    </section>
    <section class="section"><div class="section-head"><h2>Checks</h2></div>${checkList(db, checks)}</section>`;
}

// ---------------------------------------------------------------- lot / origin

export function lotView(db, id) {
  const l = lot(db, id);
  if (!l) return notFound('Lot');
  const o = org(db, l.orgId);
  const origin = l.origin;
  const checks = origin ? checkOrigin(db, l) : l.producedBy ? checkProcess(db, db.processes.find((p) => p.id === l.producedBy)) : [];
  const out = db.transfers.filter((t) => t.lotId === l.id);
  const mine = actingAs() === o.id;

  const originBlock = origin ? (() => {
    const d = origin.declaration || {};
    const [from, to] = collectionPeriod(l);
    const src = namedSources(l);
    const missing = originMissing(l);
    return `<section class="section">
    <div class="section-head"><h2>Reclaimed material declaration</h2>
      <a class="btn btn-small ${mine ? 'btn-primary' : ''}" href="#declare.${esc(l.id)}">${mine ? (missing.length ? 'Continue declaration' : 'Open declaration') : 'View declaration'}</a></div>
    <p class="muted">The recycler, as the first certified tier, must hold this for every batch of waste it buys. Most chains lose their evidence here.</p>
    <dl class="kv">
      <div class="${origin.slipNumber ? '' : 'kv-missing'}"><dt>Weighbridge slip</dt><dd>${esc(origin.slipNumber || 'Missing')}${origin.bags ? ` · ${num(origin.bags)} bags` : ''}</dd></div>
      <div class="${from ? '' : 'kv-missing'}"><dt>Collected</dt><dd>${from ? `${date(from)} to ${date(to)}` : 'Missing'}</dd></div>
      <div class="${origin.colourSort && origin.fibre ? '' : 'kv-missing'}"><dt>Sort</dt><dd>${esc([origin.colourSort, origin.fibre, l.recycledType].filter(Boolean).join(' · ') || 'Missing')}</dd></div>
      <div class="${origin.contamination?.noElastane && origin.contamination?.noPrint ? '' : 'kv-missing'}"><dt>Contamination check</dt><dd>${origin.contamination?.noElastane ? 'No elastane' : 'Elastane not checked'} · ${origin.contamination?.noPrint ? 'No prints' : 'Prints not checked'}</dd></div>
      <div class="${d.signedOn ? '' : 'kv-missing'}"><dt>Signed</dt><dd>${d.signedOn ? `${esc(d.signer)} on ${date(d.signedOn)} · <span class="mono">${esc(d.number)}</span>` : 'Not signed'}</dd></div>
    </dl>
    <div class="table-wrap"><table class="table"><thead><tr><th>Source factory</th><th>Type</th><th>Collected</th><th class="num">kg</th></tr></thead>
      <tbody>${src.map((s) => `<tr><td>${esc(s.name)}<div class="muted small">${esc(s.city || '')}</div></td><td>${esc(s.kind || '')}</td><td class="nowrap ${s.collectedOn ? '' : 'cell-bad'}">${s.collectedOn ? date(s.collectedOn) : 'Missing'}</td><td class="num">${num(s.kg)}</td></tr>`).join('')}
      <tr class="row-total"><td colspan="3">Traced to a factory</td><td class="num ${Math.abs(sourcedKg(l) - l.qty) / (l.qty || 1) > 0.02 ? 'cell-bad' : ''}">${num(sourcedKg(l))} / ${num(l.qty)}</td></tr></tbody></table></div>
    </section>`;
  })() : '';

  return `
    ${backLink(isTenant() ? '#chain' : '#tasks', isTenant() ? 'Chain' : 'My tasks')}
    <header class="page-head">
      <div><p class="eyebrow">Lot <span class="mono">${esc(l.id)}</span> · ${esc(o.name)}</p>
      <h1>${esc(l.spec || MATERIALS[l.material].label)}</h1>
      <p class="muted">${num(l.qty)} ${esc(l.unit)}${l.unit === 'pcs' ? ` (${num(kgOf(l, l.qty))} kg)` : ''} · ${l.recycledPct}% recycled, ${esc(l.recycledType || 'n/a')} · ${num(lotRemaining(db, l))} ${esc(l.unit)} unshipped</p></div>
      <div>${countPills(checks)}</div>
    </header>
    ${originBlock}
    ${l.unit === 'pcs' && !l.product ? `<p><a class="btn" href="#product.${esc(l.id)}">Add product sheet</a></p>` : ''}
    ${l.product ? `<a class="product-strip" href="#product.${esc(l.id)}">${productThumb(l)}<span><strong>${esc(l.product.name)}</strong><span class="muted small">Product sheet: photo, bill of materials, sizes, hang tag</span></span></a>` : ''}
    ${l.producedBy ? `<p><a class="link" href="#process.${esc(l.producedBy)}">Produced in ${esc(l.producedBy)} →</a></p>` : ''}
    <section class="section"><div class="section-head"><h2>Checks</h2></div>${checks.length ? checkList(db, checks) : '<p class="empty">No checks for this lot.</p>'}</section>
    <section class="section"><div class="section-head"><h2>Shipped from this lot</h2></div>
      ${out.length ? `<ul class="plain">${out.map((t) => `<li><a class="mono" href="#handoff.${esc(t.id)}">${esc(t.id)}</a> ${num(t.qty)} ${esc(l.unit)} to ${esc(org(db, t.toOrg).name)}, ${date(t.date)}</li>`).join('')}</ul>` : '<p class="empty">Nothing shipped yet.</p>'}
    </section>`;
}

// ---------------------------------------------------------------- organisation

export function orgView(db, id) {
  const o = org(db, id);
  if (!o) return notFound('Organisation');
  const tier = TIERS[o.tier];
  const comp = completeness(db, o.id, today());
  const mine = actingAs() === o.id;
  const lots = db.lots.filter((l) => l.orgId === o.id);
  const tOut = db.transfers.filter((t) => t.fromOrg === o.id);
  const tIn = db.transfers.filter((t) => t.toOrg === o.id);
  const procs = db.processes.filter((p) => p.orgId === o.id);
  const invitedBy = o.invitedBy ? org(db, o.invitedBy) : null;
  const supplies = (o.suppliesTo || []).map((x) => org(db, x)?.name).filter(Boolean).join(', ');
  const sc = o.sc;
  const tRow = (t, dir) => {
    const other = org(db, dir === 'out' ? t.toOrg : t.fromOrg);
    const l = lot(db, t.lotId);
    return `<li><a class="mono" href="#handoff.${esc(t.id)}">${esc(t.id)}</a> ${dir === 'out' ? 'to' : 'from'} ${esc(other.name)} · ${num(t.qty)} ${esc(l.unit)} · ${date(t.date)} ${countPills(checkTransfer(db, t))}</li>`;
  };

  return `
    ${isTenant() ? backLink('#suppliers', 'Suppliers') : ''}
    <header class="page-head">
      <div><p class="eyebrow">${esc(tier.label)} · ${esc(o.city)}, ${esc(o.country)}</p>
      <h1 class="with-ico">${tierIcon(o.tier)} ${esc(o.name)}</h1>
      <p class="muted">${supplies ? `Supplies ${esc(supplies)}. ` : ''}${invitedBy ? `Invited by ${esc(invitedBy.name)}. ` : ''}Contact <span class="mono small">${esc(o.email)}</span></p>
      ${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}</div>
      <div class="head-actions">${pill(o.status)}${mine || (isTenant() && o.id !== db.tenantId && o.tier !== 'buyer') ? btn(`${icon('mail')} Invite ${mine ? 'your supplier' : 'their supplier'}`, 'form', { form: 'invite', for: o.id }) : ''}</div>
    </header>
    <div class="two-col">
      <section class="section">
        <div class="section-head"><h2>Scope certificate</h2>${mine && tier.certRequired ? btn(sc ? 'Update' : 'Add certificate', 'form', { form: 'certificate', org: o.id }, 'btn-small') : ''}</div>
        ${sc ? `<div class="cert-card">${icon('cert')}<div><p class="mono">${esc(sc.number)}</p>
          <p>${esc(sc.standard)} · ${esc(sc.body)}</p><p class="muted small">Valid ${date(sc.validFrom)} to ${date(sc.validTo)}</p>
          <p class="muted small">Scope: ${(sc.scope || []).map((m) => esc(MATERIALS[m]?.label || m)).join(', ')}</p></div></div>`
    : `<p class="empty">${tier.certRequired ? 'No scope certificate on file. Shipments from this supplier cannot carry a TC.' : `${esc(tier.label)}s are not certified. Evidence comes from the reclaimed material declaration on each lot.`}</p>`}
      </section>
      <section class="section">
        <div class="section-head"><h2>Data filed</h2><span class="nowrap">${bar(comp.score)}</span></div>
        <ul class="todo">${comp.items.map((i) => `<li class="${i.ok ? 'done' : i.soft ? 'soft' : 'open'}"><span class="box" aria-hidden="true">${i.ok ? '✓' : ''}</span>${esc(i.label)}</li>`).join('')}</ul>
      </section>
    </div>
    <section class="section"><div class="section-head"><h2>Lots</h2></div>
      ${lots.length ? `<ul class="plain">${lots.map((l) => `<li><a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a> ${esc(l.spec || MATERIALS[l.material].label)} · ${num(l.qty)} ${esc(l.unit)} · ${l.recycledPct}%</li>`).join('')}</ul>` : '<p class="empty">No lots recorded.</p>'}</section>
    <div class="two-col">
      <section class="section"><div class="section-head"><h2>Received</h2></div>${tIn.length ? `<ul class="plain">${tIn.map((t) => tRow(t, 'in')).join('')}</ul>` : '<p class="empty">Nothing received.</p>'}</section>
      <section class="section"><div class="section-head"><h2>Shipped</h2></div>${tOut.length ? `<ul class="plain">${tOut.map((t) => tRow(t, 'out')).join('')}</ul>` : '<p class="empty">Nothing shipped.</p>'}</section>
    </div>
    ${procs.length ? `<section class="section"><div class="section-head"><h2>Production</h2></div><ul class="plain">${procs.map((p) => `<li><a class="mono" href="#process.${esc(p.id)}">${esc(p.id)}</a> ${esc(PROCESS_TYPES[p.type].label)}, ${date(p.date)} ${countPills(checkProcess(db, p))}</li>`).join('')}</ul></section>` : ''}
    ${tier.certRequired || o.tier === 'waste' ? `<p><a class="link" href="#ledger.${esc(o.id)}">Mass-balance ledger →</a></p>` : ''}`;
}
