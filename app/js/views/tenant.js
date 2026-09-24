// Manufacturer views: the whole chain, as the company making the claim sees it.

import { TIERS, MATERIALS, PROCESS_TYPES } from '../engine/rules.js';
import { org, lot, kgOf } from '../engine/db.js';
import { processBalance, worst } from '../engine/checks.js';
import { ledger } from '../engine/ledger.js';
import { traceLot, chainSteps, claimStatus, allChecks, completeness } from '../engine/trace.js';
import { esc, num, date, pill, dot, icon, tierIcon, countPills, bar, btn } from '../ui.js';
import { checkList, checkActions, gapCard } from './common.js';
import { today } from '../store.js';

// ---------------------------------------------------------------- overview

export function overview(db) {
  const checks = allChecks(db);
  const failing = checks.filter((c) => c.status === 'fail' && c.group !== 'claim');
  const openGaps = db.gaps.filter((g) => g.status === 'open');
  const chainOrgs = db.orgs.filter((o) => o.tier !== 'buyer').sort((a, b) => TIERS[a.tier].order - TIERS[b.tier].order);

  const claims = db.claims.map((c) => {
    const s = claimStatus(db, c);
    const l = lot(db, c.lotId);
    return `<article class="claim claim-${s.status}">
      <div class="claim-top">
        <div>
          <p class="eyebrow">Claim ${esc(c.id)} · ${esc(org(db, c.buyer).name)} · PO ${esc(c.buyerPo)}</p>
          <h2 class="claim-text">“${esc(c.text)}”</h2>
          <p class="muted">${num(c.pcs)} pcs of ${esc(l.spec || MATERIALS[l.material].label)} · ${num(kgOf(l, c.pcs) * c.recycledPct / 100)} kg recycled cotton claimed</p>
        </div>
        <div class="claim-state">${s.status === 'ready' ? pill('pass', 'Ready to release') : pill('fail', 'Claim held')}</div>
      </div>
      ${checkList(db, s.checks, false)}
      <div class="row-actions"><a class="btn btn-primary" href="#chain.${esc(c.id)}">Open the chain</a></div>
    </article>`;
  }).join('');

  const strip = chainOrgs.map((o) => {
    const mine = checks.filter((c) => c.owner === o.id && c.group !== 'claim');
    const status = o.status === 'invited' ? 'warn' : worst(mine);
    const comp = completeness(db, o.id, today());
    return `<a class="tier-cell" href="#org.${esc(o.id)}">
      <span class="tier-ico">${tierIcon(o.tier)}</span>
      <span class="tier-name">${esc(TIERS[o.tier].label)}</span>
      <span class="tier-org">${esc(o.name)}</span>
      <span class="tier-bar">${bar(comp.score)}</span>
      <span class="tier-status">${dot(status)} ${o.status === 'invited' ? 'Invited, not joined' : status === 'fail' ? `${mine.filter((c) => c.status === 'fail').length} failing` : status === 'warn' ? 'Warnings' : 'All checks pass'}</span>
    </a>`;
  }).join('');

  const attention = failing.map((c) => `<li class="att">
      ${dot('fail')}<div><div><strong>${esc(c.title)}</strong> <span class="mono muted">${esc(c.subject)}</span> · ${esc(org(db, c.owner).name)}</div>
      <div class="muted small">${esc(c.detail)}</div><div class="check-actions">${checkActions(db, c)}</div></div>
    </li>`).join('');

  const active = db.orgs.filter((o) => o.status === 'active' && o.tier !== 'buyer' && o.id !== db.tenantId).length;
  const invited = db.orgs.filter((o) => o.status === 'invited').length;
  const passing = checks.filter((c) => c.status === 'pass').length;
  const scored = checks.filter((c) => c.status !== 'na').length;

  return `
    <header class="page-head">
      <div><p class="eyebrow">${esc(org(db, db.tenantId).name)} · manufacturer workspace</p>
      <h1>Recycled-cotton T-shirts, waste to claim</h1></div>
      <div class="head-actions">${btn(`${icon('mail')} Invite supplier`, 'form', { form: 'invite' })}</div>
    </header>
    <dl class="stats">
      <div><dt>Suppliers connected</dt><dd>${active}<span class="muted"> + ${invited} invited</span></dd></div>
      <div><dt>Checks passing</dt><dd>${passing}<span class="muted"> / ${scored}</span></dd></div>
      <div><dt>Open gaps</dt><dd>${openGaps.length}<span class="muted"> with suppliers</span></dd></div>
      <div><dt>Failing, no gap raised</dt><dd>${failing.filter((c) => !db.gaps.some((g) => g.key === c.key && g.status === 'open')).length}</dd></div>
    </dl>
    ${claims}
    <section class="section">
      <div class="section-head"><h2>Data quality by tier</h2><p class="muted">Most upstream on the left. Bars show how much each supplier has filed.</p></div>
      <div class="tier-strip">${strip}</div>
    </section>
    <div class="two-col">
      <section class="section">
        <div class="section-head"><h2>Needs attention</h2></div>
        ${attention ? `<ul class="att-list">${attention}</ul>` : '<p class="empty">No failing checks. Every handoff reconciles.</p>'}
      </section>
      <section class="section">
        <div class="section-head"><h2>Open gaps</h2><a class="link" href="#gaps">All gaps</a></div>
        ${openGaps.length ? openGaps.map((g) => gapCard(db, g, { compact: true })).join('') : '<p class="empty">No open gaps.</p>'}
      </section>
    </div>`;
}

// ---------------------------------------------------------------- chain

export function chain(db, claimId) {
  const c = db.claims.find((x) => x.id === claimId) || db.claims[0];
  const s = claimStatus(db, c);
  const tree = traceLot(db, c.lotId);
  const steps = chainSteps(tree);

  const body = steps.map((st) => {
    if (st.kind === 'handoff') {
      const t = st.transfer;
      const l = lot(db, t.lotId);
      return `<a class="hop" href="#handoff.${esc(t.id)}">
        <span class="hop-line" aria-hidden="true"></span>
        <span class="hop-body">
          <span class="tc-badge">${t.tc?.number ? 'TC' : 'RMD'}</span>
          <span class="mono">${esc(t.id)}</span>
          <span class="muted">${num(t.qty)} ${esc(l.unit)} · ${date(t.date)}</span>
          <span class="hop-pills">${countPills(st.checks)}</span>
        </span>
      </a>`;
    }
    const { node } = st;
    const l = node.lot;
    const p = node.process;
    const b = p ? processBalance(db, p) : null;
    const sc = node.org.sc;
    return `<article class="node">
      <div class="node-main">
        <span class="node-ico">${tierIcon(node.org.tier)}</span>
        <div class="node-text">
          <p class="node-tier">${esc(TIERS[node.org.tier].label)}</p>
          <h3><a href="#org.${esc(node.org.id)}">${esc(node.org.name)}</a></h3>
          <p class="node-lot"><a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a> ${esc(l.spec || MATERIALS[l.material].label)} · ${num(l.qty)} ${esc(l.unit)} · ${l.recycledPct}% recycled</p>
        </div>
        <div class="node-cert">${sc ? `<span class="chip">${icon('cert')} ${esc(sc.standard)} ${esc(sc.number)}</span>` : '<span class="chip chip-quiet">Not certified</span>'}</div>
      </div>
      ${p ? `<a class="node-proc" href="#process.${esc(p.id)}">
        <span><span class="mono">${esc(p.id)}</span> ${esc(PROCESS_TYPES[p.type].label)}: ${num(b.inKg)} kg in → ${num(b.outKg)} kg out (${num(b.yieldPct, 1)}%)</span>
        <span class="hop-pills">${countPills(node.checks)}</span></a>`
    : `<a class="node-proc" href="#lot.${esc(l.id)}"><span>Origin: ${esc(l.recycledType)} waste from ${(l.origin?.sources || []).length} cutting rooms</span><span class="hop-pills">${countPills(node.checks)}</span></a>`}
    </article>`;
  }).join('');

  const buyer = org(db, c.buyer);
  return `
    <header class="page-head">
      <div><p class="eyebrow">Chain of custody · claim ${esc(c.id)}</p>
      <h1>${esc(c.text)}</h1>
      <p class="muted">${num(c.pcs)} pcs for ${esc(buyer.name)}, PO ${esc(c.buyerPo)}. Material moves down; every handoff is checked against the same rules.</p></div>
      <div class="claim-state">${s.status === 'ready' ? pill('pass', 'Ready to release') : pill('fail', 'Claim held')}</div>
    </header>
    <div class="chain-layout">
      <div class="chain">${body}
        <span class="hop hop-static"><span class="hop-line" aria-hidden="true"></span><span class="hop-body"><span class="tc-badge">Claim</span><span class="mono">${esc(c.id)}</span></span></span>
        <article class="node node-buyer"><div class="node-main"><span class="node-ico">${tierIcon('buyer')}</span>
          <div class="node-text"><p class="node-tier">EU buyer / brand</p><h3>${esc(buyer.name)}</h3><p class="node-lot">Receives the claim. ${esc(buyer.city)}, ${esc(buyer.country)}</p></div></div></article>
      </div>
      <aside class="legend">
        <h2>Checked at every hop</h2>
        <ul>
          <li>${icon('scale')}<div><strong>Quantity</strong><span>TC = invoice = packing list = goods received, ±2%</span></div></li>
          <li>${icon('recycler')}<div><strong>Composition</strong><span>Recycled % on TC matches PO and lot</span></div></li>
          <li>${icon('doc')}<div><strong>Documents</strong><span>PO, invoice, packing list, B/L when exported</span></div></li>
          <li>${icon('cert')}<div><strong>Certificates</strong><span>TC present, SC valid on shipment date, product in scope</span></div></li>
        </ul>
        <h2>Checked inside each tier</h2>
        <ul>
          <li>${icon('scale')}<div><strong>Mass balance</strong><span>Output recycled kg never above input</span></div></li>
          <li>${icon('garment')}<div><strong>Consumption</strong><span>Pieces × kg/pc fits in fabric received</span></div></li>
        </ul>
        <h2>Claim status</h2>
        ${checkList(db, s.checks, false)}
      </aside>
    </div>`;
}

// ---------------------------------------------------------------- suppliers

export function suppliers(db) {
  const rows = db.orgs.filter((o) => o.id !== db.tenantId && o.tier !== 'buyer')
    .sort((a, b) => TIERS[a.tier].order - TIERS[b.tier].order)
    .map((o) => {
      const comp = completeness(db, o.id, today());
      const via = o.invitedBy ? org(db, o.invitedBy)?.name : '—';
      return `<tr>
        <td><a class="rowlink" href="#org.${esc(o.id)}"><span class="cell-ico">${tierIcon(o.tier)}</span>${esc(o.name)}</a><div class="muted small">${esc(o.city)}, ${esc(o.country)}</div></td>
        <td>${esc(TIERS[o.tier].label)}</td>
        <td>${o.sc ? `<span class="mono small">${esc(o.sc.number)}</span><div class="muted small">to ${date(o.sc.validTo)}</div>` : TIERS[o.tier].certRequired ? pill('fail', 'Missing') : '<span class="muted small">Not required</span>'}</td>
        <td class="nowrap">${bar(comp.score)}</td>
        <td>${pill(o.status)}<div class="muted small">via ${esc(via)}</div></td>
      </tr>`;
    }).join('');
  return `
    <header class="page-head">
      <div><p class="eyebrow">Supplier network</p><h1>Suppliers by tier</h1>
      <p class="muted">Each tier invites the supplier directly upstream of it. You see the whole chain; suppliers see only their own buyer and seller.</p></div>
      <div class="head-actions">${btn(`${icon('mail')} Invite supplier`, 'form', { form: 'invite' }, 'btn-primary')}</div>
    </header>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Supplier</th><th>Tier</th><th>Scope certificate</th><th>Data filed</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- mass balance

export function ledgerView(db, orgId, visibleOrgs) {
  const orgs = visibleOrgs.filter((o) => o.tier !== 'buyer').sort((a, b) => TIERS[a.tier].order - TIERS[b.tier].order);
  const sel = orgs.find((o) => o.id === orgId) || orgs[0];
  const summary = orgs.map((o) => {
    const led = ledger(db, o.id);
    return `<tr class="${o.id === sel.id ? 'row-selected' : ''}">
      <td><a class="rowlink" href="#ledger.${esc(o.id)}"><span class="cell-ico">${tierIcon(o.tier)}</span>${esc(o.name)}</a></td>
      <td class="num">${num(led.input)}</td><td class="num">${num(led.loss)}</td><td class="num">${num(led.credit)}</td>
      <td>${led.firstNegative ? pill('fail', 'Over-claimed') : led.rows.length ? pill('pass', 'Balanced') : pill('na', 'No entries')}</td></tr>`;
  }).join('');

  const led = ledger(db, sel.id);
  const kindLabel = { collected: 'Collected', received: 'Received', produced: 'Produced', shipped: 'Shipped', claimed: 'Claimed' };
  const href = (r) => (r.ref.startsWith('T') ? `#handoff.${r.ref}` : r.ref.startsWith('P') ? `#process.${r.ref}` : r.ref.startsWith('L') ? `#lot.${r.ref}` : `#chain.${r.ref}`);
  const signed = (n) => (Math.abs(n) < 0.5 ? '<span class="muted">·</span>' : `${n > 0 ? '+' : '−'}${num(Math.abs(n))}`);
  const rows = led.rows.map((r) => `<tr class="${r.creditBal < -0.5 ? 'row-bad' : ''}">
      <td class="nowrap">${date(r.date)}</td><td>${kindLabel[r.kind]}</td>
      <td><a class="mono" href="${href(r)}">${esc(r.ref)}</a> <span class="muted small">${esc(r.note)}</span></td>
      <td class="num">${signed(r.input)}</td><td class="num">${num(r.inputBal)}</td>
      <td class="num">${signed(r.credit)}</td><td class="num strong">${num(r.creditBal)}</td></tr>`).join('');

  return `
    <header class="page-head">
      <div><p class="eyebrow">Mass balance · kg of recycled content</p><h1>Ledger</h1>
      <p class="muted">Recycled kg received goes into stock. Production moves it into credit, minus process loss. Shipments and claims draw credit down, and credit can never go below zero.</p></div>
    </header>
    ${orgs.length > 1 ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Organisation</th><th class="num">Unprocessed input</th><th class="num">Process loss</th><th class="num">Credit to claim</th><th>Status</th></tr></thead>
      <tbody>${summary}</tbody></table></div>` : ''}
    <section class="section">
      <div class="section-head"><h2>${esc(sel.name)}</h2><span class="muted">${esc(TIERS[sel.tier].label)}</span></div>
      ${rows ? `<div class="table-wrap"><table class="table ledger">
        <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th class="num">Input kg</th><th class="num">Input bal.</th><th class="num">Credit kg</th><th class="num">Credit bal.</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="empty">No entries yet.</p>'}
    </section>`;
}

// ---------------------------------------------------------------- gaps

export function gaps(db, focus, visible) {
  const list = db.gaps.filter(visible);
  const open = list.filter((g) => g.status === 'open');
  const done = list.filter((g) => g.status !== 'open');
  return `
    <header class="page-head"><div><p class="eyebrow">Evidence requests</p><h1>Gaps</h1>
    <p class="muted">A gap is raised when a check fails. It closes on its own once the supplier corrects the data and the check passes.</p></div></header>
    <section class="section"><div class="section-head"><h2>Open (${open.length})</h2></div>
      ${open.length ? open.map((g) => gapCard(db, g)).join('') : '<p class="empty">Nothing waiting on suppliers.</p>'}</section>
    <section class="section"><div class="section-head"><h2>Resolved (${done.length})</h2></div>
      ${done.length ? done.map((g) => gapCard(db, g)).join('') : '<p class="empty">No resolved gaps yet.</p>'}</section>`;
}
