// The garment itself: what the claim is printed on, and what it is made of.

import { RULES, STANDARD, TIERS } from '../engine/rules.js';
import { org, lot, fibreKgOf, kgOf } from '../engine/db.js';
import { traceLot, chainSteps, claimStatus } from '../engine/trace.js';
import { esc, num, pill, tierIcon, btn } from '../ui.js';
import { backLink } from './common.js';
import { isTenant, actingAs } from '../store.js';

// Technical flat sketch of a crew-neck T-shirt, front view, in the colourway.
// Colours are fixed: it sits on its own light "sample card", like a spec sheet.
export function teeSvg(colour = '#d9ccb1', { title = 'T-shirt front flat sketch', cls = '' } = {}) {
  const ink = '#3a3934';
  const shade = shadeHex(colour, -0.16);
  const deep = shadeHex(colour, -0.32);
  return `<svg class="tee ${cls}" viewBox="0 0 400 420" role="img" aria-label="${esc(title)}">
    <title>${esc(title)}</title>
    <path d="M160 40 Q200 80 240 40 L300 58 L372 132 L337 164 L290 126 L292 392 Q200 399 108 392 L110 126 L63 164 L28 132 L100 58 Z" fill="${colour}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M168 38 Q200 66 232 38 Q200 47 168 38 Z" fill="${deep}"/>
    <path d="M160 40 Q200 80 240 40 L232 38 Q200 66 168 38 Z" fill="${shade}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="191" y="44" width="18" height="7" rx="1" fill="#f4f2ec" stroke="${ink}" stroke-width="0.8"/>
    <g fill="none" stroke="${ink}" stroke-width="1" stroke-dasharray="4 3" opacity="0.75">
      <path d="M163 44 Q200 86 237 44"/>
      <path d="M364 126 L330 157"/><path d="M359 121 L325 152"/>
      <path d="M36 126 L70 157"/><path d="M41 121 L75 152"/>
      <path d="M110 380 Q200 387 291 380"/><path d="M110 375 Q200 382 291 375"/>
    </g>
    <g fill="none" stroke="${ink}" stroke-width="1" opacity="0.35">
      <path d="M290 126 Q286 90 300 58"/><path d="M110 126 Q114 90 100 58"/>
    </g>
  </svg>`;
}

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(Math.max(0, Math.min(255, c + c * amt))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function productThumb(l, size = 'sm') {
  const p = l.product;
  if (!p) return '';
  return `<a class="thumb thumb-${size}" href="#product.${esc(l.id)}" aria-label="${esc(p.name)}, product page">
    ${p.photo ? `<img src="${p.photo}" alt="">` : teeSvg(p.colour.hex, { title: `${p.name} in ${p.colour.name}` })}</a>`;
}

export function productView(db, lotId) {
  const l = lot(db, lotId);
  if (!l || l.unit !== 'pcs') return '<p class="empty">No product sheet for this lot.</p>';
  const canEdit = isTenant() || actingAs() === l.orgId;
  if (!l.product) {
    return `${backLink('#claims', 'Claims')}
      <header class="page-head"><div><p class="eyebrow">Lot <span class="mono">${esc(l.id)}</span> · ${num(l.qty)} pcs</p><h1>No product sheet yet</h1>
      <p class="muted">Add the style, colour, garment weight and fabric weight. The fabric weight is what carries the recycled claim; thread and labels do not.</p></div></header>
      ${canEdit ? `<p>${btn('Add product sheet', 'form', { form: 'product', lot: l.id }, 'btn-primary')}</p>` : ''}`;
  }
  const p = l.product;
  const maker = org(db, l.orgId);
  const claim = db.claims.find((c) => c.lotId === l.id);
  const cs = claim ? claimStatus(db, claim) : null;
  const pct = claim?.recycledPct ?? l.recycledPct;
  const logoOk = pct >= RULES.grsLogoMinPct;
  const recPerPc = (l.fibreKgPerUnit ?? l.kgPerUnit) * pct / 100;
  const editable = isTenant() || actingAs() === l.orgId;
  const bomTotal = p.bom.reduce((s, b) => s + b.kg, 0);
  const steps = chainSteps(traceLot(db, l.id)).filter((s) => s.kind === 'node');

  const sizes = p.sizes.map((s) => `<tr><td>${esc(s.size)}</td><td class="num">${s.share}%</td>
    <td class="num">${num(Math.round(l.qty * s.share / 100))}</td><td class="num">${num(s.kg * 1000)} g</td></tr>`).join('');
  const bom = p.bom.map((b) => `<tr class="${b.claimed ? '' : 'row-trim'}"><td>${esc(b.component)}<div class="muted small">${esc(b.material)}</div></td>
    <td class="num">${num(b.kg * 1000, 1)} g</td><td class="num">${b.recycledPct}%</td>
    <td>${b.lotId ? `<a class="mono" href="#lot.${esc(b.lotId)}">${esc(b.lotId)}</a>` : '<span class="muted small">Trim, no claim</span>'}</td></tr>`).join('');

  return `
    ${backLink('#chain', 'Chain')}
    <div class="product">
      <figure class="product-figure">
        <div class="sample-card">${p.photo ? `<img class="product-photo" src="${p.photo}" alt="${esc(p.name)} in ${esc(p.colour.name)}">` : teeSvg(p.colour.hex, { title: `${p.name}, front flat sketch in ${p.colour.name}` })}
          <span class="swatch" style="background:${esc(p.colour.hex)}" aria-hidden="true"></span></div>
        <figcaption>${p.photo ? 'Product photo' : 'Front flat sketch'} · ${esc(p.colour.name)} <span class="mono">${esc(p.colour.code)}</span></figcaption>
        ${editable ? `${btn('Edit product sheet', 'form', { form: 'product', lot: l.id }, 'btn-small')}<label class="btn btn-small" for="product-photo">${p.photo ? 'Replace photo' : 'Upload product photo'}</label>
          <input class="sr" id="product-photo" type="file" accept="image/*" data-product-photo="${esc(l.id)}">
          ${p.photo ? `<button type="button" class="btn btn-small btn-quiet" data-action="product-photo-clear" data-lot="${esc(l.id)}">Use sketch</button>` : ''}` : ''}
      </figure>
      <div class="product-info">
        <p class="eyebrow">${esc(p.brand)} · ${esc(p.season)} · style <span class="mono">${esc(p.style)}</span></p>
        <h1>${esc(p.name)}</h1>
        <p class="muted">${esc(p.fit)}. Made by ${esc(maker.name)}, ${esc(maker.city)}. Lot <a class="mono" href="#lot.${esc(l.id)}">${esc(l.id)}</a>, ${num(l.qty)} pcs.</p>
        <div class="hangtag">
          <p class="hangtag-claim">${esc(claim?.text || `Made with ${pct}% recycled cotton`)}</p>
          <p class="hangtag-line">Certified to ${STANDARD} by ${esc(maker.sc?.body || '—')} · <span class="mono">${esc(maker.sc?.number || '—')}</span></p>
          <p class="hangtag-note">${logoOk ? `${STANDARD} logo allowed on product (${pct}% ≥ ${RULES.grsLogoMinPct}%).` : `Text claim only. The ${STANDARD} logo needs at least ${RULES.grsLogoMinPct}% recycled content; this style has ${pct}%.`}</p>
          ${cs ? `<p>${cs.status === 'ready' ? pill('pass', 'Claim ready to release') : pill('fail', 'Claim held')} <a class="link" href="#chain.${esc(claim.id)}">See why</a></p>` : ''}
        </div>
        <dl class="kv spec">
          <div><dt>Composition</dt><dd>${esc(p.composition)}</dd></div>
          <div><dt>Fabric</dt><dd>${esc(p.fabric)}</dd></div>
          <div><dt>Construction</dt><dd>${esc(p.construction)}</dd></div>
          <div><dt>Recycled cotton per piece</dt><dd>${num(recPerPc * 1000)} g <span class="muted small">(${num((l.fibreKgPerUnit ?? l.kgPerUnit) * 1000)} g fibre × ${pct}%)</span></dd></div>
          <div><dt>HS code · origin</dt><dd><span class="mono">${esc(p.hs)}</span> · ${esc(p.countryOfOrigin)}</dd></div>
          <div><dt>Care</dt><dd>${esc(p.care)}</dd></div>
        </dl>
      </div>
    </div>
    <div class="two-col">
      <section class="section"><div class="section-head"><h2>Bill of materials, per piece</h2>
        <p class="muted">Average size. Only fabric carries the recycled claim; thread and labels are trims.</p></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Component</th><th class="num">Weight</th><th class="num">Recycled</th><th>Source lot</th></tr></thead>
        <tbody>${bom}<tr class="row-total"><td>Garment</td><td class="num">${num(bomTotal * 1000)} g</td><td class="num">${num(fibreKgOf(l, 1) * pct / kgOf(l, 1), 1)}%</td><td class="muted small">of total weight</td></tr></tbody></table></div>
      </section>
      <section class="section"><div class="section-head"><h2>Size breakdown</h2><p class="muted">Ratio from the buyer's PO; weights from the size set.</p></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Size</th><th class="num">Ratio</th><th class="num">Pieces</th><th class="num">Weight</th></tr></thead>
        <tbody>${sizes}</tbody></table></div>
      </section>
    </div>
    <section class="section"><div class="section-head"><h2>Traced to</h2></div>
      <ol class="mini-chain">${steps.map((s) => `<li><a href="#${s.node.lot.origin ? 'lot' : 'org'}.${esc(s.node.lot.origin ? s.node.lot.id : s.node.org.id)}">${tierIcon(s.node.org.tier)}<span><strong>${esc(TIERS[s.node.org.tier].label)}</strong>${esc(s.node.org.name)}</span></a></li>`).join('')}</ol>
    </section>`;
}
