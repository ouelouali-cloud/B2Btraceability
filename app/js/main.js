// App shell: hash router, "viewing as" switcher, form dialog, delegated events.

import { TIERS } from './engine/rules.js';
import { org, transfer, lot } from './engine/db.js';
import { load, db, actingAs, isTenant, mutate, reset, subscribe, today } from './store.js';
import { esc, icon } from './ui.js';
import { FORMS } from './forms.js';
import * as T from './views/tenant.js';
import * as D from './views/detail.js';
import * as S from './views/supplier.js';

load();

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const switcher = document.getElementById('acting-as');
const modal = document.getElementById('modal');
const toastEl = document.getElementById('toast');

// ---------------------------------------------------------------- visibility

// A supplier sees its own organisation, its direct buyers and sellers, and
// nothing further up or down the chain.
function canSee(kind, id) {
  if (isTenant()) return true;
  const me = actingAs();
  const d = db();
  if (kind === 'org') return id === me;
  if (kind === 'handoff') { const t = transfer(d, id); return t && (t.fromOrg === me || t.toOrg === me); }
  if (kind === 'process') return d.processes.some((p) => p.id === id && p.orgId === me);
  if (kind === 'lot') {
    const l = lot(d, id);
    return l && (l.orgId === me || d.transfers.some((t) => t.lotId === id && t.toOrg === me));
  }
  if (kind === 'ledger') return !id || id === me;
  return true;
}

function navItems() {
  if (isTenant()) {
    return [['overview', 'Overview'], ['chain', 'Chain'], ['suppliers', 'Suppliers'], ['ledger', 'Mass balance'], ['gaps', 'Gaps']];
  }
  const me = org(db(), actingAs());
  if (me.status === 'invited') return [['tasks', 'Invitation']];
  return [['tasks', 'My tasks'], ['shipments', 'Shipments'], ['production', 'Production'], ['ledger', 'Mass balance'], [`org.${me.id}`, 'Company']];
}

// ---------------------------------------------------------------- render

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const [name, ...rest] = hash.split('.');
  return { name: name || (isTenant() ? 'overview' : 'tasks'), id: rest.join('.') };
}

function render() {
  const d = db();
  const { name, id } = route();
  const me = actingAs();

  switcher.innerHTML = d.orgs.filter((o) => o.tier !== 'buyer')
    .sort((a, b) => TIERS[b.tier].order - TIERS[a.tier].order)
    .map((o) => `<option value="${esc(o.id)}" ${o.id === me ? 'selected' : ''}>${esc(o.name)} · ${o.id === d.tenantId ? 'manufacturer' : TIERS[o.tier].label.toLowerCase()}${o.status === 'invited' ? ' (invited)' : ''}</option>`)
    .join('');

  const openCount = d.gaps.filter((g) => g.status === 'open' && (isTenant() || g.owner === me)).length;
  nav.innerHTML = navItems().map(([k, label]) => {
    const active = name === k.split('.')[0] && (!k.includes('.') || id === k.split('.')[1]);
    const badge = (k === 'gaps' || k === 'tasks') && openCount ? `<span class="nav-badge">${openCount}</span>` : '';
    return `<a href="#${k}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${label}${badge}</a>`;
  }).join('');

  const visibleOrgs = d.orgs.filter((o) => canSee('org', o.id));
  const denied = '<p class="empty">This record belongs to another company and is not shared with you.</p>';
  let html;
  switch (name) {
    case 'overview': html = isTenant() ? T.overview(d) : S.tasks(d, me); break;
    case 'chain': html = isTenant() ? T.chain(d, id) : denied; break;
    case 'suppliers': html = isTenant() ? T.suppliers(d) : denied; break;
    case 'ledger': html = canSee('ledger', id) ? T.ledgerView(d, id || (isTenant() ? '' : me), visibleOrgs) : denied; break;
    case 'gaps': html = T.gaps(d, id, (g) => isTenant() || g.owner === me); break;
    case 'handoff': html = canSee('handoff', id) ? D.handoff(d, id) : denied; break;
    case 'process': html = canSee('process', id) ? D.processView(d, id) : denied; break;
    case 'lot': html = canSee('lot', id) ? D.lotView(d, id) : denied; break;
    case 'org': html = canSee('org', id) ? D.orgView(d, id) : denied; break;
    case 'tasks': html = S.tasks(d, me); break;
    case 'shipments': html = S.shipments(d, me); break;
    case 'production': html = S.production(d, me); break;
    default: html = '<p class="empty">Page not found.</p>';
  }
  view.innerHTML = html;

  if (name === 'gaps' && id) document.getElementById(`gap-${id}`)?.scrollIntoView({ block: 'start' });
}

function go(hash) {
  if (location.hash === `#${hash}`) render();
  else location.hash = hash;
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
}

// ---------------------------------------------------------------- forms

let activeForm = null;
function openForm(name, params) {
  const f = FORMS[name];
  const r = f.render(db(), params);
  activeForm = { name, params };
  modal.innerHTML = `<form method="dialog" class="dialog-form" id="dialog-form" novalidate>
    <header class="dialog-head"><h2>${esc(r.title)}</h2><button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></header>
    ${r.intro ? `<p class="dialog-intro">${r.intro}</p>` : ''}
    <div class="dialog-body">${r.body}</div>
    <p class="form-error" id="form-error" hidden></p>
    <footer class="dialog-foot"><button type="button" class="btn btn-quiet" data-action="close">Cancel</button>
    ${r.submit ? `<button type="submit" class="btn btn-primary">${r.submit}</button>` : ''}</footer>
  </form>`;
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
  modal.querySelector('input:not([type=hidden]), select, textarea')?.focus();
}

function closeForm() {
  activeForm = null;
  if (modal.open && typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
}

function formValues(form) {
  const v = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.checked) v[el.name] = 'on'; continue; }
    if (el.type === 'file') { if (el.files?.[0]) v[el.name] = el.files[0].name; continue; }
    v[el.name] = el.value;
  }
  return v;
}

modal.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const err = form.querySelector('#form-error');
  const missing = [...form.querySelectorAll('[required]')].find((el) => !el.value.trim());
  if (missing) {
    err.textContent = `${missing.closest('label')?.querySelector('.field-label')?.textContent || 'A required field'} is required.`;
    err.hidden = false;
    missing.focus();
    return;
  }
  const { name, params } = activeForm;
  let msg;
  try {
    const closed = mutate((d) => { msg = FORMS[name].submit(d, formValues(form), params); });
    closeForm();
    toast(closed.length ? `${msg}. Gap ${closed.join(', ')} closed: the check now passes.` : msg);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action } = b.dataset;
  if (action === 'close') return closeForm();
  if (action === 'form') return openForm(b.dataset.form, { ...b.dataset });
  if (action === 'raise-gap') return openForm('raise-gap', { key: b.dataset.key });
  if (action === 'resolve-gap') {
    mutate((d) => {
      const g = d.gaps.find((x) => x.id === b.dataset.gap);
      g.status = 'resolved';
      g.resolvedAt = today();
      g.thread.push({ by: actingAs(), at: today(), text: 'Marked resolved by the buyer.' });
    });
    return toast(`Gap ${b.dataset.gap} marked resolved`);
  }
  if (action === 'reset') { reset(); go(''); return toast('Demo data restored'); }
  if (action === 'guide') { document.getElementById('guide').hidden = !document.getElementById('guide').hidden; }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form="reply"]');
  if (!f) return;
  e.preventDefault();
  const text = f.elements.text.value.trim();
  if (!text) return;
  mutate((d) => d.gaps.find((g) => g.id === f.dataset.gap).thread.push({ by: actingAs(), at: today(), text }));
  toast('Reply sent');
});

switcher.addEventListener('change', () => {
  closeForm();
  db().ui.actingAs = switcher.value;
  mutate(() => {});
  go(isTenant() ? 'overview' : 'tasks');
});

modal.addEventListener('click', (e) => { if (e.target === modal) closeForm(); });
window.addEventListener('hashchange', () => { render(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); });
subscribe(render);
document.getElementById('brand-icon').innerHTML = icon('recycler');
render();
