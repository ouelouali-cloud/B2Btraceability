// Pieces shared by the manufacturer and supplier views.

import { org } from '../engine/db.js';
import { esc, btn, checkRow, pill, date } from '../ui.js';
import { actingAs, isTenant } from '../store.js';

export const openGap = (db, key) => db.gaps.find((g) => g.key === key && g.status === 'open');

// The action a viewer can take on a check: raise a gap (manufacturer),
// or fix the data (the supplier who owns it).
export function checkActions(db, c) {
  if (c.status === 'pass' || c.status === 'na') return '';
  const g = openGap(db, c.key);
  const parts = [];
  if (g) parts.push(`<a class="link" href="#gaps.${esc(g.id)}">Gap ${esc(g.id)} open with ${esc(org(db, g.owner).name)}</a>`);
  else if (isTenant() && c.owner !== actingAs()) parts.push(btn('Raise gap', 'raise-gap', { key: c.key }, 'btn-small'));
  if (c.owner === actingAs()) parts.push(fixButton(c));
  return parts.join(' ');
}

export function fixButton(c) {
  const s = c.subject;
  if (c.id === 'origin') return btn('Complete declaration', 'form', { form: 'origin', lot: s }, 'btn-small btn-primary');
  if (['consumption', 'blend', 'yield', 'records', 'inputs'].includes(c.id)) return btn('Correct production record', 'form', { form: 'process', process: s }, 'btn-small btn-primary');
  if (['sc', 'scope'].includes(c.id)) return btn('Update certificate', 'form', { form: 'certificate', org: c.owner }, 'btn-small btn-primary');
  if (c.group === 'claim') return '';
  return `<a class="btn btn-small btn-primary" href="#handoff.${esc(s)}">Correct documents</a>`;
}

export function checkList(db, checks, groups = true) {
  if (!groups) return `<ul class="checks">${checks.map((c) => checkRow(c, checkActions(db, c))).join('')}</ul>`;
  const labels = { verify: 'Verify', reconcile: 'Reconcile', origin: 'Origin', claim: 'Claim' };
  const order = ['origin', 'verify', 'reconcile', 'claim'];
  return order.filter((g) => checks.some((c) => c.group === g)).map((g) => `
    <h3 class="group-label">${labels[g]}</h3>
    <ul class="checks">${checks.filter((c) => c.group === g).map((c) => checkRow(c, checkActions(db, c))).join('')}</ul>`).join('');
}

export function gapCard(db, g, { compact = false } = {}) {
  const owner = org(db, g.owner);
  const who = (id) => (id === 'system' ? 'Threadback' : org(db, id)?.name || id);
  const canReply = g.status === 'open' && (actingAs() === g.owner || actingAs() === g.raisedBy || isTenant());
  const subject = g.key.split(':')[0];
  const href = subject.startsWith('T') ? `#handoff.${subject}` : subject.startsWith('P') ? `#process.${subject}`
    : subject.startsWith('L') ? `#lot.${subject}` : `#chain.${subject}`;
  return `<article class="gap gap-${g.status}" id="gap-${esc(g.id)}">
    <header class="gap-head">
      <div><span class="mono">${esc(g.id)}</span> · <a class="link" href="${href}">${esc(g.title)} (${esc(subject)})</a></div>
      ${pill(g.status)}
    </header>
    <p class="gap-meta">Waiting on <strong>${esc(owner.name)}</strong> · raised ${date(g.raisedAt)}${g.resolvedAt ? ` · resolved ${date(g.resolvedAt)}` : ''}</p>
    ${compact ? '' : `<ol class="thread">${g.thread.map((m) => `<li class="msg ${m.by === 'system' ? 'msg-system' : ''}"><span class="msg-by">${esc(who(m.by))}</span> <span class="msg-at">${date(m.at)}</span><p>${esc(m.text)}</p></li>`).join('')}</ol>
    ${canReply ? `<form class="reply" data-form="reply" data-gap="${esc(g.id)}">
      <label class="sr" for="reply-${esc(g.id)}">Reply</label>
      <textarea id="reply-${esc(g.id)}" name="text" rows="2" placeholder="Reply or attach a note about the evidence you sent"></textarea>
      <div class="reply-actions"><button class="btn btn-small" type="submit">Send reply</button>
      ${isTenant() ? btn('Mark resolved', 'resolve-gap', { gap: g.id }, 'btn-small btn-quiet') : ''}</div>
    </form>` : ''}`}
  </article>`;
}

export function backLink(href, label) {
  return `<a class="back" href="${href}">← ${esc(label)}</a>`;
}
