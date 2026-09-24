// The evidence pack as a document: what the manufacturer sends its EU buyer
// and certification body. Rendered in three places: inside the app, as the
// read-only page behind a share link, and as a downloadable file.

import { esc, num, date, icon, tierIcon } from '../ui.js';
import { teeSvg } from './product.js';

const STATUS_TEXT = { pass: 'Pass', warn: 'Check', fail: 'Gap', na: 'N/A' };
const stat = (s) => `<span class="pk-st pk-st-${esc(s)}">${STATUS_TEXT[s] || esc(s)}</span>`;

function checksTable(checks) {
  if (!checks?.length) return '';
  return `<table class="pk-table pk-checks"><tbody>${checks.map((c) => `<tr><td>${stat(c.status)}</td><td><strong>${esc(c.title)}</strong><div class="pk-muted">${esc(c.detail)}</div></td></tr>`).join('')}</tbody></table>`;
}

function fileLink(file, fileUrl) {
  if (!file?.sha) return '<span class="pk-muted">—</span>';
  return `<a href="${esc(fileUrl(file))}" target="_blank" rel="noopener">${icon('doc')} ${esc(file.name || 'scan')}</a><div class="pk-hash" title="SHA-256">${esc(file.sha.slice(0, 16))}…</div>`;
}

export function packView(pack, { mode = 'app', fileUrl = () => '#', shared = null, canShare = false } = {}) {
  if (!pack) return '<p class="empty">This evidence pack is not available.</p>';
  const c = pack.claim;
  const ready = pack.status === 'ready';
  const p = pack.product;
  const nodes = pack.chain.filter((s) => s.kind === 'node');
  const hops = pack.chain.filter((s) => s.kind === 'handoff');
  const origins = nodes.filter((n) => n.origin);
  const v = pack.ledger.verify;

  const actions = mode === 'file' ? '' : `<div class="pk-actions no-print">
    ${mode === 'app' ? `<a class="btn btn-quiet" href="#chain.${esc(c.id)}">Open the chain</a>` : ''}
    <button type="button" class="btn" data-action="pack-print">Print or save as PDF</button>
    ${mode === 'app' ? `<button type="button" class="btn" data-action="pack-download" data-claim="${esc(c.id)}">Download pack</button>` : ''}
    ${canShare ? (shared ? `<button type="button" class="btn btn-primary" data-action="pack-link" data-claim="${esc(c.id)}">Share link</button><button type="button" class="btn btn-quiet" data-action="pack-unshare" data-claim="${esc(c.id)}">Stop sharing</button>`
    : `<button type="button" class="btn btn-primary" data-action="pack-share" data-claim="${esc(c.id)}">Share with buyer</button>`) : ''}
  </div>`;

  return `<article class="pk">
    ${mode === 'app' ? '<a class="back no-print" href="#claims">← Claims</a>' : ''}
    <header class="pk-head">
      <div class="pk-title">
        <p class="pk-eyebrow">Evidence pack · claim ${esc(c.id)} · ${esc(pack.standard)}</p>
        <h1>${esc(c.text)}</h1>
        <p class="pk-muted">${num(c.pcs)} pcs for ${esc(pack.buyer?.name || '—')}, purchase order ${esc(c.buyerPo)}. Made by ${esc(pack.maker.name)}, ${esc(pack.maker.city)}, ${esc(pack.maker.country)}.
        Generated ${esc(pack.generatedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
      </div>
      <div class="pk-stamp pk-stamp-${ready ? 'ready' : 'held'}">${ready ? 'Ready to release' : 'Claim held'}<small>${pack.upstreamSummary.pass} of ${pack.upstreamSummary.total} upstream checks pass</small></div>
    </header>
    ${actions}

    <section class="pk-sec pk-summary">
      ${p ? `<div class="pk-product">${p.photo ? `<img src="${p.photo}" alt="${esc(p.name)}">` : teeSvg(p.colour?.hex, { title: `${p.name} front sketch` })}</div>` : ''}
      <dl class="pk-kv">
        ${p ? `<div><dt>Product</dt><dd>${esc(p.name)} · ${esc(p.brand)} style <span class="mono">${esc(p.style)}</span> · ${esc(p.colour?.name || '')}</dd></div>
        <div><dt>Composition</dt><dd>${esc(p.composition)}</dd></div>` : ''}
        <div><dt>Recycled cotton claimed</dt><dd>${num(c.recycledKg)} kg in ${num(c.garmentKg)} kg of garments</dd></div>
        <div><dt>GRS label</dt><dd>${c.logoAllowed ? 'GRS logo allowed on product' : `Text claim only (logo needs 50%; this claim is ${c.recycledPct}%)`}</dd></div>
        <div><dt>Certified by</dt><dd>${pack.maker.sc ? `${esc(pack.maker.sc.body)} · <span class="mono">${esc(pack.maker.sc.number)}</span>, valid to ${date(pack.maker.sc.validTo)}` : 'No scope certificate on file'}</dd></div>
        <div><dt>Ledger</dt><dd>${v ? (v.ok ? `Chain intact, ${num(v.count)} entries, head <span class="mono">${esc(v.head.slice(0, 12))}…</span>` : `Chain broken at entry ${v.brokenAt}`) : 'Not verified'}</dd></div>
      </dl>
    </section>

    <section class="pk-sec">
      <h2>1. Claim checks</h2>
      ${checksTable(pack.claimChecks)}
    </section>

    <section class="pk-sec">
      <h2>2. Chain of custody</h2>
      <div class="pk-scroll"><table class="pk-table">
        <thead><tr><th>Tier</th><th>Company</th><th>Certificate</th><th>Lot</th><th class="r">Quantity</th><th class="r">Recycled</th><th>Checks</th></tr></thead>
        <tbody>${nodes.map((n) => `<tr><td>${tierIcon(n.org.tier)} ${esc(n.org.tierLabel)}</td><td>${esc(n.org.name)}<div class="pk-muted">${esc(n.org.city)}, ${esc(n.org.country)}</div></td>
          <td>${n.org.sc ? `<span class="mono">${esc(n.org.sc.number)}</span><div class="pk-muted">${esc(n.org.sc.body)}, to ${date(n.org.sc.validTo)}</div>` : '<span class="pk-muted">Not certified (declaration)</span>'}</td>
          <td class="mono">${esc(n.lot.id)}</td><td class="r">${num(n.lot.qty)} ${esc(n.lot.unit)}</td><td class="r">${n.lot.recycledPct}%</td><td>${stat(n.status)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    ${origins.map((n) => {
      const o = n.origin;
      const d = o.declaration || {};
      const hop = hops.find((h) => h.lotId === n.lot.id);
      return `<section class="pk-sec pk-break">
      <h2>3. Origin: ${esc(n.org.name)}, batch ${esc(n.lot.id)}</h2>
      <dl class="pk-kv">
        <div><dt>Batch</dt><dd>${num(o.qty)} kg · ${num(o.bags)} bags · weighbridge slip ${esc(o.slipNumber || '—')}</dd></div>
        <div><dt>Collected</dt><dd>${o.period?.[0] ? `${date(o.period[0])} to ${date(o.period[1])}` : '—'} · ${esc(n.lot.recycledType || '')}</dd></div>
        <div><dt>Sort</dt><dd>${esc(o.colourSort || '—')} · ${esc(o.fibre || '—')} · ${o.contamination?.noElastane ? 'no elastane' : 'elastane not checked'} · ${o.contamination?.noPrint ? 'no prints' : 'prints not checked'}</dd></div>
        <div><dt>Declaration</dt><dd>${d.signedOn ? `<span class="mono">${esc(d.number)}</span> signed by ${esc(d.signer)}${d.role ? `, ${esc(d.role)}` : ''} on ${date(d.signedOn)}` : 'Not signed'}</dd></div>
        <div><dt>Countersigned</dt><dd>${hop?.countersign ? `${esc(hop.countersign.by)} (${esc(hop.buyer.name)}) on ${date(hop.countersign.at)}` : 'Not countersigned'}</dd></div>
      </dl>
      <div class="pk-scroll"><table class="pk-table"><thead><tr><th>Source factory</th><th>Area</th><th>Waste type</th><th>Collected</th><th class="r">kg</th></tr></thead>
        <tbody>${(o.sources || []).map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.city || '')}</td><td>${esc(s.kind || '')}</td><td>${date(s.collectedOn)}</td><td class="r">${num(s.kg)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pk-evidence">${o.slipPhoto ? `<figure><img src="${o.slipPhoto}" alt="Weighbridge slip"><figcaption>Weighbridge slip</figcaption></figure>` : ''}
        ${d.signature ? `<figure><img src="${d.signature}" alt="Signature of ${esc(d.signer)}"><figcaption>Signature</figcaption></figure>` : ''}
        ${d.paperPhoto ? `<figure><img src="${d.paperPhoto}" alt="Signed paper declaration"><figcaption>Signed paper form</figcaption></figure>` : ''}</div>
      ${checksTable(n.checks)}
    </section>`;
    }).join('')}

    <section class="pk-sec pk-break">
      <h2>4. Handoffs and documents</h2>
      ${hops.map((h) => `<div class="pk-hop">
        <h3><span class="mono">${esc(h.id)}</span> ${esc(h.seller.name)} → ${esc(h.buyer.name)} · ${date(h.date)} · ${num(h.qty)} ${esc(h.unit)} ${stat(h.status)}</h3>
        <div class="pk-scroll"><table class="pk-table">
          <thead><tr><th>Document</th><th>Number</th><th>Date</th><th class="r">Qty</th><th class="r">Rec. %</th><th>Scan</th></tr></thead>
          <tbody>
            ${h.tc ? `<tr><td>Transaction certificate</td><td class="mono">${esc(h.tc.number)}</td><td>${date(h.tc.date)}</td><td class="r">${num(h.tc.qty)}</td><td class="r">${h.tc.recycledPct ?? '—'}%</td><td>${fileLink(h.tc.file, fileUrl)}</td></tr>` : ''}
            ${h.documents.map((d) => `<tr><td>${esc(d.label)}</td><td class="mono">${esc(d.number)}</td><td>${date(d.date)}</td><td class="r">${num(d.qty)}</td><td class="r">${d.recycledPct ?? '—'}${d.recycledPct != null ? '%' : ''}</td><td>${fileLink(d.file, fileUrl)}</td></tr>`).join('')}
            <tr><td>Goods received</td><td class="pk-muted">${esc(h.goodsIn?.slipNumber || 'buyer weighing')}</td><td></td><td class="r">${num(h.receivedQty)}</td><td></td><td class="pk-muted">${h.goodsIn?.moisturePct != null ? `moisture ${h.goodsIn.moisturePct}%` : ''}</td></tr>
          </tbody></table></div>
        ${checksTable(h.checks.filter((x) => x.status !== 'na'))}
      </div>`).join('')}
    </section>

    <section class="pk-sec pk-break">
      <h2>5. Production and mass balance</h2>
      <div class="pk-scroll"><table class="pk-table">
        <thead><tr><th>Company</th><th>Step</th><th>Date</th><th class="r">In kg</th><th class="r">Out kg</th><th class="r">Yield</th><th class="r">Recycled in / declared</th><th>Records</th></tr></thead>
        <tbody>${nodes.filter((n) => n.process).map((n) => { const pr = n.process; return `<tr><td>${esc(n.org.name)}</td><td>${esc(pr.label)} <span class="mono pk-muted">${esc(pr.id)}</span></td><td>${date(pr.date)}</td>
          <td class="r">${num(pr.inKg)}${pr.nonClaimed.length ? `<div class="pk-muted">incl. ${num(pr.nonClaimed.reduce((s, x) => s + x.kg, 0))} virgin</div>` : ''}</td><td class="r">${num(pr.outKg)}</td><td class="r">${num(pr.yieldPct, 1)}%</td>
          <td class="r">${num(pr.computedPct, 2)}% / ${n.lot.recycledPct}%</td><td class="pk-muted">${esc(pr.records.join(', '))}${pr.consumption ? `<div>${pr.consumption.kgPerPc} kg fabric per piece (${esc(pr.consumption.marker || 'marker')})</div>` : ''}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <h3>Mass-balance account: ${esc(pack.maker.name)} (kg recycled content)</h3>
      <div class="pk-scroll"><table class="pk-table">
        <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th class="r">Input</th><th class="r">Credit</th><th class="r">Credit balance</th></tr></thead>
        <tbody>${pack.massBalance.rows.map((r) => `<tr><td>${date(r.date)}</td><td>${esc(r.kind)}</td><td><span class="mono">${esc(r.ref)}</span> <span class="pk-muted">${esc(r.note)}</span></td>
          <td class="r">${Math.abs(r.input) < 0.5 ? '' : num(r.input)}</td><td class="r">${Math.abs(r.credit) < 0.5 ? '' : num(r.credit)}</td><td class="r"><strong>${num(r.creditBal)}</strong></td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="pk-sec pk-break">
      <h2>6. Certificates and document index</h2>
      <div class="pk-scroll"><table class="pk-table"><thead><tr><th>Company</th><th>Scope certificate</th><th>Body</th><th>Valid</th></tr></thead>
        <tbody>${pack.certificates.map((s) => `<tr><td>${esc(s.org)}</td><td class="mono">${esc(s.number)}</td><td>${esc(s.body)}</td><td>${date(s.validFrom)} to ${date(s.validTo)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pk-scroll"><table class="pk-table"><thead><tr><th>Handoff</th><th>Document</th><th>Number</th><th>Date</th><th>Issued by</th><th class="r">Qty</th><th>Scan</th></tr></thead>
        <tbody>${pack.documents.map((d) => `<tr><td class="mono">${esc(d.handoff)}</td><td>${esc(d.label)}</td><td class="mono">${esc(d.number)}</td><td>${date(d.date)}</td><td>${esc(d.issuer || '')}</td><td class="r">${num(d.qty)}</td><td>${fileLink(d.file, fileUrl)}</td></tr>`).join('')}</tbody></table></div>
    </section>

    <section class="pk-sec pk-break">
      <h2>7. Ledger proof</h2>
      <p class="pk-muted">Every entry below was written by the company named, at the time shown, and is chained to the entry before it by a SHA-256 fingerprint. ${v?.ok ? `The full ledger (${num(v.count)} entries) was verified intact when this pack was generated.` : ''}</p>
      <div class="pk-scroll"><table class="pk-table">
        <thead><tr><th class="r">#</th><th>When (UTC)</th><th>Company</th><th>What happened</th><th>Fingerprint</th></tr></thead>
        <tbody>${pack.ledger.entries.map((e) => `<tr><td class="r">${e.seq}</td><td>${esc(e.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(e.actorName)}<div class="pk-muted">${esc(e.user)}</div></td><td>${esc(e.summary)}</td><td class="pk-hash">${esc(e.hash.slice(0, 16))}…</td></tr>`).join('') || '<tr><td colspan="5" class="pk-muted">No entries.</td></tr>'}</tbody>
      </table></div>
    </section>
    ${mode !== 'app' ? `<footer class="pk-foot">Threadback evidence pack · claim ${esc(c.id)} · ${esc(pack.generatedAt)}</footer>` : ''}
  </article>`;
}

// Standalone HTML file of the pack, with its data embedded for machines.
export function packFile(pack, css, fileUrl) {
  const json = JSON.stringify(pack).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence pack ${esc(pack.claim.id)}: ${esc(pack.claim.text)}</title><style>${css}</style></head>
<body class="pk-file">${packView(pack, { mode: 'file', fileUrl })}
<script type="application/json" id="threadback-evidence-pack">${json}</script></body></html>`;
}

