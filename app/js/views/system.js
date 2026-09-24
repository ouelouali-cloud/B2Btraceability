// System views: the live material flow, the ledger itself, how it works,
// and signing in.

import { TIERS } from '../engine/rules.js';
import { materialFlow } from '../engine/flow.js';
import { esc, num, date, pill, icon, tierIcon } from '../ui.js';

// ---------------------------------------------------------------- time

export function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date(iso.slice(0, 10));
}
const fresh = (iso) => Date.now() - new Date(iso) < 12000;

// ---------------------------------------------------------------- live flow

export function flowView(db, feed, { tenant, mode, status }) {
  const f = materialFlow(db);
  const recent = new Set(feed.filter((e) => fresh(e.at)).flatMap((e) => e.refs || []).map((r) => r.split(':')[1]));

  const W = 1000;
  const base = 250;
  const colX = (i) => 70 + i * 172;
  const maxKg = Math.max(1, ...f.nodes.map((n) => Math.max(n.inKg + n.virginKg, n.producedKg)), ...f.edges.map((e) => e.kg));
  const k = 170 / maxKg;
  const h = (kg) => Math.max(kg > 0 ? 3 : 0, kg * k);
  const idx = Object.fromEntries(f.nodes.map((n, i) => [n.tier, i]));
  const tone = { pass: 'ok', warn: 'warn', fail: 'bad' };

  const bands = f.edges.map((e) => {
    const x1 = colX(idx[e.from]) + 8;
    const x2 = colX(idx[e.to]) - 8;
    const t1 = h(e.kg);
    const r1 = h(e.recKg);
    const intoVirgin = f.nodes[idx[e.to]].virginKg > 0;
    const mid = intoVirgin ? x1 + 8 : (x1 + x2) / 2;
    const anchor = intoVirgin ? 'start' : 'middle';
    const live = e.ids.some((id) => recent.has(id));
    const href = e.ids.length === 1 ? (e.claim ? '#chain' : `#handoff.${e.ids[0]}`) : null;
    const shape = `<g class="band band-${tone[e.status]} ${live ? 'band-live' : ''}">
      <title>${esc(e.ids.join(', '))}: ${num(e.kg)} kg, ${num(e.recKg)} kg recycled</title>
      <rect x="${x1}" y="${base - t1}" width="${x2 - x1}" height="${t1}" class="band-all"/>
      <rect x="${x1}" y="${base - r1}" width="${x2 - x1}" height="${r1}" class="band-rec"/>
      <line x1="${x1}" x2="${x2}" y1="${base - t1 / 2}" y2="${base - t1 / 2}" class="band-dash"/>
      <text x="${mid}" y="${base - t1 - 22}" class="band-label" text-anchor="${anchor}">${esc(e.claim ? 'Claim' : e.ids.length === 1 ? e.ids[0] : `${e.ids.length} shipments`)} · ${num(e.kg)} kg</text>
      <text x="${mid}" y="${base - t1 - 8}" class="band-sub" text-anchor="${anchor}">${num(e.kg ? (e.recKg / e.kg) * 100 : 0)}% recycled${e.status === 'fail' ? ' · gap' : ''}</text>
    </g>`;
    return href ? `<a href="${href}">${shape}</a>` : shape;
  }).join('');

  const nodes = f.nodes.map((n, i) => {
    const x = colX(i);
    const hh = h(Math.max(n.inKg + n.virginKg, n.producedKg, n.inKg));
    const empty = !n.inKg && !n.producedKg;
    const vh = h(n.virginKg);
    const virgin = n.virginKg ? `<g class="virgin"><title>${num(n.virginKg)} kg virgin cotton, not claimed</title>
      <rect x="${x - 62}" y="${base - h(n.inKg) - vh}" width="54" height="${vh}" class="virgin-block"/>
      <text x="${x - 64}" y="${base - h(n.inKg) - vh - 8}" class="band-sub">+ ${num(n.virginKg)} kg virgin cotton</text></g>` : '';
    return `<g class="node ${empty ? 'node-empty' : ''}">
      ${virgin}
      <rect x="${x - 8}" y="${base - Math.max(hh, 4)}" width="16" height="${Math.max(hh, 4)}" rx="2" class="node-bar"/>
      <text x="${x}" y="${base + 22}" text-anchor="middle" class="node-title">${esc(n.label)}</text>
      <text x="${x}" y="${base + 38}" text-anchor="middle" class="node-org">${esc(n.orgs[0] || (empty ? 'not visible to you' : ''))}${n.orgs.length > 1 ? ` +${n.orgs.length - 1}` : ''}</text>
      ${n.tier !== 'buyer' && !empty ? `<text x="${x}" y="${base + 56}" text-anchor="middle" class="node-num">${n.tier === 'waste' ? `${num(n.producedKg)} kg declared` : `${num(n.inKg)} in → ${num(n.producedKg)} out`}</text>
      <text x="${x}" y="${base + 72}" text-anchor="middle" class="node-num muted-svg">${num(n.stockKg)} kg in stock</text>
      ${n.lossKg ? `<text x="${x}" y="${base + 88}" text-anchor="middle" class="node-num muted-svg">${num(n.lossKg)} kg loss</text>` : ''}` : ''}
    </g>`;
  }).join('');

  const feedList = feed.length ? feed.map((e) => `<li class="feed-item ${fresh(e.at) ? 'feed-new' : ''}">
      <div class="feed-top"><strong>${esc(e.actorName)}</strong><span class="muted small">${ago(e.at)}</span></div>
      <p>${esc(e.summary)}</p>
      <p class="muted small">${esc(e.user)} · entry ${e.seq} · <span class="mono">${esc(e.hash.slice(0, 10))}</span></p></li>`).join('')
    : '<li class="empty">No entries yet.</li>';

  const liveLabel = status === 'offline' ? pill('warn', 'Offline, showing last known state') : `<span class="live-dot" aria-hidden="true"></span> Live`;
  return `
    <header class="page-head">
      <div><p class="eyebrow">Material flow · ${liveLabel}</p><h1>From cutting waste to T-shirts, as it happens</h1>
      <p class="muted">Band height is kilograms. The dark part is recycled cotton; at the spinner, virgin cotton joins and the share drops to 40%. Red bands have a failing check. Every entry below updates this picture ${mode === 'demo' ? 'in every open tab' : 'on every connected screen'}.</p></div>
    </header>
    <dl class="stats">
      <div><dt>Recycled cotton entered</dt><dd>${num(f.totals.recycledKg)}<span class="muted"> kg</span></dd></div>
      <div><dt>In stock along the chain</dt><dd>${num(f.totals.stockKg)}<span class="muted"> kg</span></dd></div>
      <div><dt>Process loss</dt><dd>${num(f.totals.lossKg)}<span class="muted"> kg</span></dd></div>
      <div><dt>Ledger entries</dt><dd>${num(feed[0]?.seq || 0)}</dd></div>
    </dl>
    <div class="flow-layout">
      <div class="flow-wrap"><svg class="flow-svg" viewBox="0 0 ${W} 350" role="img" aria-label="Material flow between tiers in kilograms">${bands}${nodes}</svg>
        <p class="flow-legend"><span class="sw sw-rec"></span> Recycled cotton <span class="sw sw-all"></span> Other fibre <span class="sw sw-bad"></span> Failing check ${tenant ? '' : '· You see your own slice of the chain'}</p></div>
      <aside class="feed"><h2>Ledger, live</h2><ol class="feed-list">${feedList}</ol>
        <a class="link small" href="#ledgerlog">Full ledger and hash check →</a></aside>
    </div>`;
}

// ---------------------------------------------------------------- ledger

export function ledgerLogView(entries, verify, loading) {
  const rows = (entries || []).map((e) => `<tr>
    <td class="num">${e.seq}</td><td class="nowrap small">${esc(e.at.slice(0, 16).replace('T', ' '))}</td>
    <td>${esc(e.actorName)}<div class="muted small">${esc(e.user)}</div></td>
    <td>${esc(e.summary)}<div class="muted small mono">${esc(e.command)}</div></td>
    <td class="mono small">${esc(e.hash.slice(0, 12))}…<div class="muted">← ${esc(e.prev.slice(0, 8))}</div></td></tr>`).join('');
  const v = verify
    ? verify.ok ? pill('pass', `Chain intact · ${num(verify.count)} entries`) : pill('fail', `Broken at entry ${verify.brokenAt}: ${verify.reason}`)
    : '';
  return `
    <header class="page-head">
      <div><p class="eyebrow">Ledger</p><h1>Every change, in order, never overwritten</h1>
      <p class="muted">Each line records who changed what, and when. Each line's fingerprint (hash) includes the fingerprint of the line before, so editing any past line breaks every line after it. Current data is simply all lines replayed.</p></div>
      <div class="head-actions">${v}<button type="button" class="btn" data-action="verify">Check the chain</button></div>
    </header>
    ${loading ? '<p class="empty">Loading the ledger…</p>' : `<div class="table-wrap"><table class="table ledger-log">
      <thead><tr><th class="num">#</th><th>When (UTC)</th><th>Company</th><th>What happened</th><th>Fingerprint</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Nothing visible to you yet.</td></tr>'}</tbody></table></div>`}`;
}

// ---------------------------------------------------------------- concept

export function conceptView() {
  const who = [
    ['waste', 'Waste trader', 'Declares each batch on a phone: source factories, kg, sort, signature. Works offline.'],
    ['recycler', 'Recycler', 'Books goods-in at the gate, countersigns the declaration, records sorting and shredding, ships fibre with a TC.'],
    ['spinner', 'Spinner and mill', 'Record receipts, blends, production runs and shipment documents.'],
    ['garment', 'You', 'Record cutting and sewing, raise gaps, release the claim.'],
  ];
  return `
    <header class="page-head"><div><p class="eyebrow">How it works</p><h1>One ledger, fed by every tier, checked at every handoff</h1>
      <p class="muted">Threadback is a shared record of what happened to the material, written by the companies that handled it. It answers three questions for every claim: where the material came from, who handled it, and whether the kilograms add up.</p></div></header>
    <ol class="concept">
      <li class="concept-step">
        <h2><span class="step-n">1</span> Each company enters what it did</h2>
        <ul class="who">${who.map(([t, n, d]) => `<li><span class="who-ico">${tierIcon(t)}</span><div><strong>${esc(n)}</strong><span>${esc(d)}</span></div></li>`).join('')}</ul>
        <p class="muted small">Suppliers join by invitation from their buyer. Each company sees its own records and its direct partners, never the rest of the chain or any prices.</p>
      </li>
      <li class="concept-step">
        <h2><span class="step-n">2</span> Every entry becomes a line in the ledger</h2>
        <div class="ledger-line"><span class="mono">#128</span><span><strong>GreenFibre Recycling</strong> · Goods-in T-8K2: 3,760 kg of L-W2 from Rahman Jhut Traders, declaration countersigned</span><span class="mono muted">3f9a2c…  ← 81be07…</span></div>
        <p class="muted small">Lines are only ever added. Each line is fingerprinted together with the line before it, so nobody, including us, can quietly change history. A phone that is offline keeps its entries and sends them when it reconnects.</p>
      </li>
      <li class="concept-step">
        <h2><span class="step-n">3</span> The ledger becomes a live material flow</h2>
        <div class="mini-flow">${['waste', 'recycler', 'spinner', 'mill', 'garment', 'buyer'].map((t) => `<span>${tierIcon(t)}<small>${esc(TIERS[t].label)}</small></span>`).join('<i aria-hidden="true">→</i>')}</div>
        <p class="muted small">Kilograms in, kilograms out, loss and stock at every tier, updated the moment an entry lands. A mass-balance account per company keeps recycled kg from being claimed twice.</p>
      </li>
      <li class="concept-step">
        <h2><span class="step-n">4</span> Checks decide whether the claim can go out</h2>
        <div class="three-q">
          <div>${icon('waste')}<strong>Origin</strong><span>Declaration signed, every kg traced to a factory, countersigned at goods-in</span></div>
          <div>${icon('doc')}<strong>Who handled it</strong><span>TC, PO, invoice, packing list and goods-in weight agree at each handoff</span></div>
          <div>${icon('scale')}<strong>Mass balance</strong><span>Yield, blend and consumption reconcile; credit never goes below zero</span></div>
        </div>
        <p class="muted small">A failing check becomes a gap sent to the company that owns the data. It closes by itself when the data is fixed. The claim is released only when every check back to the waste passes.</p>
      </li>
    </ol>
    <p><a class="btn btn-primary" href="#flow">See the live flow</a></p>`;
}

// ---------------------------------------------------------------- sign in

export function loginView(accounts, error) {
  return `<div class="auth">
    <form class="auth-card" data-form="login" novalidate>
      <h1>Sign in to Threadback</h1>
      <p class="muted">The chain-of-custody ledger for recycled cotton.</p>
      <label class="field" for="login-email"><span class="field-label">Email</span><input id="login-email" name="email" type="email" autocomplete="username" required></label>
      <label class="field" for="login-password"><span class="field-label">Password</span><input id="login-password" name="password" type="password" autocomplete="current-password" required></label>
      ${error ? `<p class="form-error">${esc(error)}</p>` : ''}
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    ${accounts?.length ? `<section class="auth-demo"><h2>Demo accounts</h2><p class="muted small">Password <span class="mono">demo</span>. Sign in as two companies on two devices to watch data flow live.</p>
      <ul>${accounts.map((a) => `<li><button type="button" class="demo-acct" data-action="demo-login" data-email="${esc(a.email)}">
        <span class="who-ico">${tierIcon(a.tier || 'garment')}</span><span><strong>${esc(a.name)}</strong><span class="muted small">${esc(a.role)}, ${esc(a.org)}</span></span></button></li>`).join('')}</ul></section>` : ''}
  </div>`;
}

export function joinView(info, error) {
  if (!info) return `<div class="auth"><div class="auth-card"><h1>Invitation</h1><p class="form-error">${esc(error || 'Loading…')}</p></div></div>`;
  return `<div class="auth"><form class="auth-card" data-form="join" novalidate>
    <h1>Join ${esc(info.org)} on Threadback</h1>
    <p class="muted">${esc(info.invitedBy || 'Your buyer')} invited you to share traceability data. Your account: <span class="mono">${esc(info.email)}</span></p>
    <label class="field" for="join-name"><span class="field-label">Your name</span><input id="join-name" name="name" autocomplete="name" required></label>
    <label class="field" for="join-password"><span class="field-label">Choose a password (8+ characters)</span><input id="join-password" name="password" type="password" autocomplete="new-password" required></label>
    ${error ? `<p class="form-error">${esc(error)}</p>` : ''}
    <button class="btn btn-primary" type="submit">Create account</button>
  </form></div>`;
}

// ---------------------------------------------------------------- inbox

export function inboxView(feed, me, lastSeen) {
  const mine = feed.filter((e) => e.actor !== me && e.actor !== 'system');
  const items = mine.map((e) => `<li class="feed-item ${e.seq > lastSeen ? 'feed-new' : ''}">
      <div class="feed-top"><strong>${esc(e.actorName)}</strong><span class="muted small">${ago(e.at)}</span></div>
      <p>${esc(e.summary)}</p><p class="muted small">${esc(e.user)} · entry ${e.seq}</p></li>`).join('');
  return `
    <header class="page-head"><div><p class="eyebrow">Inbox</p><h1>What your partners did</h1>
      <p class="muted">Entries by other companies that touch your records: requests, replies, deliveries, countersignatures. With email or SMS set up on the server, the important ones also reach you there.</p></div></header>
    <ol class="feed-list inbox-list">${items || '<li class="empty">Nothing yet. New entries appear here live.</li>'}</ol>`;
}
