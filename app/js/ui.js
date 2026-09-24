// Small rendering helpers shared by every view.

import { TIERS } from './engine/rules.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function num(n, d = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const STATUS_LABEL = { pass: 'Pass', warn: 'Check', fail: 'Gap', na: 'N/A', open: 'Open', resolved: 'Resolved', held: 'Held', ready: 'Ready', invited: 'Invited', active: 'Active' };
export function pill(status, label) {
  return `<span class="pill pill-${esc(status)}">${esc(label || STATUS_LABEL[status] || status)}</span>`;
}

export function dot(status) {
  return `<span class="dot dot-${esc(status)}" aria-hidden="true"></span>`;
}

// Monochrome line icons, drawn on a 24px grid.
const PATHS = {
  waste: '<path d="M4 13a8 8 0 0 1 13.6-5.7"/><path d="M20 11a8 8 0 0 1-13.6 5.7"/><path d="M18 3v4.5h-4.5"/><path d="M6 21v-4.5h4.5"/>',
  recycler: '<path d="M3 7c3-2.5 6 2.5 9 0s6-2.5 9 0"/><path d="M3 12c3-2.5 6 2.5 9 0s6-2.5 9 0"/><path d="M3 17c3-2.5 6 2.5 9 0s6-2.5 9 0"/>',
  spinner: '<path d="M6 3h12M6 21h12"/><path d="M8 3c0 3 2 4 2 9s-2 6-2 9M16 3c0 3-2 4-2 9s2 6 2 9"/><path d="M10 8h4M10 12h4M10 16h4"/>',
  mill: '<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>',
  garment: '<path d="M8.5 3 3 6l2 5 3-1.2V21h8V9.8l3 1.2 2-5-5.5-3a3.5 3.5 0 0 1-7 0z"/>',
  buyer: '<path d="M4 10v11h16V10"/><path d="M3 10 5 4h14l2 6z"/><path d="M9.5 21v-6h5v6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  scale: '<path d="M12 4v17M7 21h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  cert: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M7 8h6M7 11h4"/><circle cx="16" cy="15" r="3"/><path d="m14.5 17.5-.5 3.5 2-1 2 1-.5-3.5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  arrow: '<path d="M12 4v16M6 14l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 7 9 6 9-6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}
export const tierIcon = (tier) => icon(TIERS[tier]?.icon || 'doc');

export function checkRow(c, actions = '') {
  return `<li class="check check-${c.status}">
    ${dot(c.status)}
    <div class="check-body"><div class="check-title">${esc(c.title)} ${pill(c.status)}</div>
    <div class="check-detail">${esc(c.detail)}</div>${actions ? `<div class="check-actions">${actions}</div>` : ''}</div>
  </li>`;
}

export function statusCounts(checks) {
  const n = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) if (n[c.status] !== undefined) n[c.status] += 1;
  return n;
}

export function countPills(checks) {
  const n = statusCounts(checks);
  return [
    n.fail ? pill('fail', `${n.fail} gap${n.fail > 1 ? 's' : ''}`) : '',
    n.warn ? pill('warn', `${n.warn} to check`) : '',
    !n.fail && !n.warn ? pill('pass', `${n.pass} pass`) : '',
  ].join('');
}

export function bar(score) {
  const pct = Math.round(score * 100);
  const cls = pct >= 90 ? 'pass' : pct >= 60 ? 'warn' : 'fail';
  return `<span class="bar" role="img" aria-label="${pct}% complete"><span class="bar-fill bar-${cls}" style="width:${pct}%"></span></span><span class="bar-num">${pct}%</span>`;
}

export function btn(label, action, data = {}, cls = '') {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button type="button" class="btn ${cls}" data-action="${esc(action)}" ${attrs}>${label}</button>`;
}

export function field(id, label, input, hint = '') {
  return `<label class="field" for="${id}"><span class="field-label">${esc(label)}</span>${input}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}</label>`;
}
export function input(id, value = '', type = 'text', extra = '') {
  return `<input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
}
export function select(id, options, value = '') {
  return `<select id="${id}" name="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
