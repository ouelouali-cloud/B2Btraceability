// App shell: start-up, sign-in, hash router, top bar, form dialog, events.
// Every change goes through store.send(); nothing here edits data directly.

import { TIERS } from './engine/rules.js';
import { org, transfer, lot } from './engine/db.js';
import { makeId } from './engine/commands.js';
import { nextStep, prevStep } from './engine/declaration.js';
import * as store from './store.js';
import { db, actingAs, isTenant, today, send } from './store.js';
import { DEMO_USERS } from './seed.js';
import { esc, icon } from './ui.js';
import { FORMS } from './forms.js';
import * as T from './views/tenant.js';
import * as D from './views/detail.js';
import * as S from './views/supplier.js';
import * as W from './views/declare.js';
import * as X from './views/system.js';
import { productView } from './views/product.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const topRight = document.getElementById('top-right');
const guide = document.getElementById('guide');
const modal = document.getElementById('modal');
const toastEl = document.getElementById('toast');

const wizStep = {};          // lotId -> step being edited (kept in memory, not in the URL)
const ledgerPage = { entries: null, verify: null, loading: false };
let started = false;
let pendingRender = false;

// ---------------------------------------------------------------- start-up

async function boot() {
  let ok = false;
  try {
    ok = await store.init();
  } catch (e) {
    view.innerHTML = `<p class="empty">Could not start: ${esc(e.message)}</p>`;
    return;
  }
  if (location.hash.startsWith('#join.') && store.mode() === 'server') return showJoin(location.hash.slice(6));
  if (!ok) return showLogin();
  start();
}

function start() {
  document.body.classList.remove('auth-mode');
  if (!started) {
    started = true;
    store.subscribe(onStoreEvent);
    if (store.mode() === 'server' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell unavailable */ });
    }
  }
  render();
}

async function showLogin(error = '') {
  document.body.classList.add('auth-mode');
  nav.innerHTML = '';
  topRight.innerHTML = '';
  let accounts = [];
  try { accounts = await store.transport().demoAccounts(); } catch { /* none */ }
  view.innerHTML = X.loginView(accounts.map((a) => ({ ...a, tier: a.tier || TIER_OF[a.orgId] })), error);
  view.querySelector('#login-email')?.focus();
}
const TIER_OF = { sonar: 'garment', waste: 'waste', recy: 'recycler', spin: 'spinner', mill: 'mill' };

async function showJoin(token, error = '') {
  document.body.classList.add('auth-mode');
  nav.innerHTML = '';
  topRight.innerHTML = '';
  try {
    const info = await store.transport().inviteInfo(token);
    view.innerHTML = X.joinView(info, error);
    view.querySelector('form').dataset.token = token;
  } catch (e) {
    view.innerHTML = X.joinView(null, e.message);
  }
}

// Re-render on data changes, but never under someone's fingers: if a form
// field has focus or a dialog is open, wait until they are done.
function onStoreEvent(evt) {
  if (evt.loggedOut) return showLogin();
  if (evt.rejected) toast(`The server did not accept "${evt.rejected.summary}": ${evt.error}`, 7000);
  if (evt.entry && evt.entry.actor !== actingAs()) toast(`${evt.entry.actorName}: ${evt.entry.summary}`);
  if (evt.reset) Object.keys(wizStep).forEach((k) => delete wizStep[k]);
  renderTopbar();
  const typing = view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  // The declaration form holds unsaved input across several fields (and a
  // signature); it only redraws when the user moves between steps.
  if (modal.open || typing || drawing || document.getElementById('wizard')) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (pendingRender && !modal.open && !drawing && !document.getElementById('wizard') && !view.contains(document.activeElement)) { pendingRender = false; render(); }
}, 0));

// ---------------------------------------------------------------- visibility

// The server already filters what each company receives; this only decides
// which pages make sense for the signed-in company.
function canSee(kind, id) {
  if (isTenant()) return true;
  const me = actingAs();
  const d = db();
  if (kind === 'org') return id === me;
  if (kind === 'handoff') { const t = transfer(d, id); return t && (t.fromOrg === me || t.toOrg === me); }
  if (kind === 'process') return d.processes.some((p) => p.id === id && p.orgId === me);
  if (kind === 'lot') return !!lot(d, id);
  if (kind === 'ledger') return !id || id === me;
  if (kind === 'product') return lot(d, id)?.orgId === me;
  return true;
}

function navItems() {
  if (isTenant()) {
    return [['overview', 'Overview'], ['flow', 'Material flow'], ['chain', 'Chain'], ['suppliers', 'Suppliers'], ['ledger', 'Mass balance'], ['gaps', 'Gaps'], ['ledgerlog', 'Ledger'], ['concept', 'How it works']];
  }
  const me = org(db(), actingAs());
  if (me.status === 'invited') return [['tasks', 'Invitation'], ['concept', 'How it works']];
  if (me.tier === 'waste') return [['tasks', 'My batches'], ['shipments', 'Shipments'], ['concept', 'How it works']];
  if (me.tier === 'recycler') return [['tasks', 'Goods-in'], ['production', 'Production'], ['shipments', 'Shipments'], ['flow', 'Material flow'], ['ledger', 'Mass balance'], ['ledgerlog', 'Ledger'], [`org.${me.id}`, 'Company']];
  return [['tasks', 'My tasks'], ['shipments', 'Shipments'], ['production', 'Production'], ['flow', 'Material flow'], ['ledger', 'Mass balance'], ['ledgerlog', 'Ledger'], [`org.${me.id}`, 'Company']];
}

// ---------------------------------------------------------------- render

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const [name, ...rest] = hash.split('.');
  return { name: name || (isTenant() ? 'overview' : 'tasks'), id: rest.join('.') };
}

function renderTopbar() {
  const d = db();
  if (!d) return;
  const s = store.syncStatus();
  const me = store.session();
  const pillText = s.status === 'offline' ? `Offline${s.pending ? ` · ${s.pending} saved` : ''}`
    : s.status === 'syncing' || s.pending ? `Sending ${s.pending || ''}…` : 'Live';
  const sync = `<button type="button" class="sync sync-${s.pending && s.status !== 'offline' ? 'syncing' : s.status}" data-action="outbox" aria-label="Connection: ${esc(pillText)}. Open saved changes.">
    <span class="sync-dot" aria-hidden="true"></span>${esc(pillText)}${s.rejected ? ` · ${s.rejected} not accepted` : ''}</button>`;
  const who = store.mode() === 'demo'
    ? `<label class="acting"><span class="acting-label">Viewing as</span><select id="acting-as" aria-label="Viewing as company">${
      d.orgs.length && DEMO_USERS.map((u) => `<option value="${u.orgId}" ${u.orgId === actingAs() ? 'selected' : ''}>${esc(u.name)} · ${esc(org(d, u.orgId)?.name || u.orgId)}</option>`).join('')}</select></label>`
    : `<span class="user-chip"><strong>${esc(me.name)}</strong><span class="muted">${esc(org(d, me.orgId)?.name || '')}</span></span><button type="button" class="btn btn-quiet btn-small" data-action="signout">Sign out</button>`;
  topRight.innerHTML = `${sync}${who}<div class="top-actions">
    <button type="button" class="btn btn-quiet btn-small" data-action="guide">Demo guide</button>
    ${store.mode() === 'demo' || isTenant() ? '<button type="button" class="btn btn-quiet btn-small" data-action="reset">Reset demo</button>' : ''}</div>`;
}

function render() {
  const d = db();
  if (!d) return;
  pendingRender = false;
  renderTopbar();
  const { name, id } = route();
  const me = actingAs();

  const openCount = d.gaps.filter((g) => g.status === 'open' && (isTenant() || g.owner === me)).length;
  nav.innerHTML = navItems().map(([k, label]) => {
    const active = name === k.split('.')[0] && (!k.includes('.') || id === k.split('.')[1]);
    const badge = (k === 'gaps' || k === 'tasks') && openCount ? `<span class="nav-badge">${openCount}</span>` : '';
    return `<a href="#${k}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${label}${badge}</a>`;
  }).join('');

  const visibleOrgs = d.orgs.filter((o) => canSee('org', o.id));
  const denied = '<p class="empty">This record belongs to another company and is not shared with you.</p>';
  const sys = { tenant: isTenant(), mode: store.mode(), status: store.syncStatus().status };
  let html;
  switch (name) {
    case 'overview': html = isTenant() ? T.overview(d) : S.tasks(d, me); break;
    case 'flow': html = X.flowView(d, store.liveFeed(), sys); break;
    case 'ledgerlog': html = X.ledgerLogView(ledgerPage.entries, ledgerPage.verify, !ledgerPage.entries); loadLedger(); break;
    case 'concept': html = X.conceptView(); break;
    case 'chain': html = isTenant() ? T.chain(d, id) : denied; break;
    case 'suppliers': html = isTenant() ? T.suppliers(d) : denied; break;
    case 'ledger': html = canSee('ledger', id) ? T.ledgerView(d, id || (isTenant() ? '' : me), visibleOrgs) : denied; break;
    case 'gaps': html = T.gaps(d, id, (g) => isTenant() || g.owner === me); break;
    case 'handoff': html = canSee('handoff', id) ? D.handoff(d, id) : denied; break;
    case 'process': html = canSee('process', id) ? D.processView(d, id) : denied; break;
    case 'lot': html = canSee('lot', id) ? D.lotView(d, id) : denied; break;
    case 'org': html = canSee('org', id) ? D.orgView(d, id) : denied; break;
    case 'declare': html = canSee('lot', id) ? W.declare(d, id, wizStep[id], lot(d, id)?.orgId === me) : denied; break;
    case 'product': html = canSee('product', id) ? productView(d, id) : denied; break;
    case 'tasks': html = S.tasks(d, me); break;
    case 'shipments': html = S.shipments(d, me); break;
    case 'production': html = S.production(d, me); break;
    case 'join': html = '<p class="empty">You are already signed in. Sign out to accept an invitation for another company.</p>'; break;
    default: html = '<p class="empty">Page not found.</p>';
  }
  view.innerHTML = html;
  initSignaturePad();
  if (name === 'gaps' && id) document.getElementById(`gap-${id}`)?.scrollIntoView({ block: 'start' });
}

let ledgerSeq = -1;
async function loadLedger() {
  const seq = store.liveFeed()[0]?.seq ?? 0;
  if (ledgerPage.loading || (ledgerPage.entries && seq === ledgerSeq)) return;
  ledgerPage.loading = true;
  try {
    ledgerPage.entries = await store.transport().ledger();
    ledgerSeq = seq;
  } catch {
    ledgerPage.entries = ledgerPage.entries || [];
  }
  ledgerPage.loading = false;
  if (route().name === 'ledgerlog') render();
}

function go(hash) {
  if (location.hash === `#${hash}`) render();
  else location.hash = hash;
}

let toastTimer;
function toast(msg, ms = 4200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function afterSend(r, fallback) {
  const closed = r.closed?.length ? ` Gap ${r.closed.join(', ')} closed: the check now passes.` : '';
  toast(r.queued ? `Saved on this device: ${r.summary}. It will be sent when you are back online.` : `${fallback || r.summary}.${closed}`);
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
  showModal();
}

function showModal() {
  if (typeof modal.showModal === 'function') { if (!modal.open) modal.showModal(); } else modal.setAttribute('open', '');
  modal.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea')?.focus();
}

function closeForm() {
  activeForm = null;
  if (modal.open && typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  if (pendingRender) render();
}

function formValues(form) {
  const v = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.checked) v[el.name] = 'on'; continue; }
    if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; continue; }
    if (el.type === 'file') { if (el.files?.[0]) v[el.name] = el.files[0].name; continue; }
    v[el.name] = el.value;
  }
  return v;
}

modal.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!activeForm) return;
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
  try {
    const [cmd, payload] = FORMS[name].command(formValues(form), params, db());
    const r = send(cmd, payload);
    closeForm();
    afterSend(r);
    if (cmd === 'org.invite') r.sent.then((res) => { const inv = res?.results?.find((x) => x?.invite); if (inv) showInvite(inv.invite); });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

function showInvite(inv) {
  const url = new URL(inv.url, location.href).href;
  activeForm = null;
  modal.innerHTML = `<div class="dialog-form"><header class="dialog-head"><h2>Invitation link</h2><button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></header>
    <p class="dialog-intro">Send this link to ${esc(inv.email)}. It works once and lets them create their account. (Email delivery comes later.)</p>
    <div class="dialog-body"><input id="invite-url" readonly value="${esc(url)}"><button type="button" class="btn" data-action="copy-invite">Copy link</button></div></div>`;
  showModal();
}

function showOutbox() {
  const pend = store.pending();
  const rej = store.rejectedList();
  const s = store.syncStatus();
  const item = (c, rejected) => `<li class="ob-item ${rejected ? 'ob-rejected' : ''}"><div><strong>${esc(c.summary || c.name)}</strong>
      <span class="muted small">${esc(new Date(c.at).toLocaleString('en-GB'))}${c.error ? ` · ${esc(c.error)}` : ''}</span></div>
      ${rejected || c.error ? `<button type="button" class="btn btn-small btn-quiet" data-action="discard" data-id="${esc(c.id)}">Discard</button>` : ''}</li>`;
  activeForm = null;
  modal.innerHTML = `<div class="dialog-form"><header class="dialog-head"><h2>${s.status === 'offline' ? 'Offline' : 'Connection'}</h2><button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></header>
    <p class="dialog-intro">${s.status === 'offline' ? 'No connection. Everything you enter is kept on this device and sent, in order, as soon as the connection is back.' : 'Connected. Entries reach the ledger immediately and other companies see them live.'}</p>
    <div class="dialog-body">
      <h3 class="group-label">Waiting to send (${pend.length})</h3>
      ${pend.length ? `<ul class="ob-list">${pend.map((c) => item(c, false)).join('')}</ul>` : '<p class="muted small">Nothing waiting.</p>'}
      ${rej.length ? `<h3 class="group-label">Not accepted by the server (${rej.length})</h3><ul class="ob-list">${rej.map((c) => item(c, true)).join('')}</ul>` : ''}
      ${store.mode() === 'demo' ? `<label class="check-field"><input type="checkbox" id="sim-offline" ${store.transport().offline ? 'checked' : ''}> Simulate no connection (try the waste form offline)</label>` : ''}
      ${pend.length && s.status !== 'offline' ? '<button type="button" class="btn" data-action="flush">Send now</button>' : ''}
    </div></div>`;
  showModal();
}

// ---------------------------------------------------------------- waste declaration

function saveWizard(form, extra = {}) {
  const r = send('batch.step', { lot: form.dataset.lot, step: form.dataset.step, v: { ...formValues(form), ...extra } });
  return r;
}

function wizardGo(lotId, step) {
  wizStep[lotId] = step;
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id === 'wizard') {
    e.preventDefault();
    const { lot: lotId, step } = form.dataset;
    try {
      const r = saveWizard(form);
      if (step === 'declare') afterSend(r, 'Declaration signed and sent');
      wizardGo(lotId, nextStep(step));
    } catch (ex) {
      const el = document.getElementById('wz-error');
      el.textContent = ex.message;
      el.hidden = false;
      el.scrollIntoView({ block: 'center' });
    }
    return;
  }
  if (form.dataset.form === 'reply') {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    try { afterSend(send('gap.reply', { gap: form.dataset.gap, text }), 'Reply sent'); } catch (ex) { toast(ex.message); }
    return;
  }
  if (form.dataset.form === 'login') {
    e.preventDefault();
    try { if (await store.login(form.elements.email.value, form.elements.password.value)) { location.hash = ''; start(); } } catch (ex) { showLogin(ex.message); }
    return;
  }
  if (form.dataset.form === 'join') {
    e.preventDefault();
    try { if (await store.join(form.dataset.token, form.elements.name.value, form.elements.password.value)) { location.hash = 'tasks'; start(); } } catch (ex) { showJoin(form.dataset.token, ex.message); }
  }
});

// Shrink a photo in the browser before storing it (phones produce 4–12 MB files).
function shrinkImage(file, max = 960) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read.')); };
    img.src = url;
  });
}

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'acting-as') {
    closeForm();
    Object.keys(wizStep).forEach((k) => delete wizStep[k]);
    ledgerPage.entries = null;
    await store.switchDemoActor(el.value);
    return go(isTenant() ? 'overview' : 'tasks');
  }
  if (el.id === 'sim-offline') {
    await store.setSimulatedOffline(el.checked);
    showOutbox();
    return toast(el.checked ? 'Connection off. Keep working: changes are saved on this device.' : 'Connection back. Saved changes sent.');
  }
  const file = el.files?.[0];
  if (!file) return;
  try {
    if (el.dataset.photo) {
      const data = await shrinkImage(file);
      document.getElementById(el.dataset.photo).value = data;
      const prev = document.getElementById(`${el.dataset.photo}-preview`);
      prev.src = data;
      prev.hidden = false;
      prev.closest('.photo-drop')?.classList.add('has-photo');
    } else if (el.dataset.productPhoto) {
      afterSend(send('product.photo', { lot: el.dataset.productPhoto, photo: await shrinkImage(file, 1200) }), 'Product photo saved');
    }
  } catch (ex) { toast(ex.message); }
});

// Live total on the sources step.
document.addEventListener('input', (e) => {
  if (!e.target.classList.contains('src-kg')) return;
  const box = document.getElementById('src-total');
  const sum = [...document.querySelectorAll('.src-kg')].reduce((s, i) => s + (Number(i.value) || 0), 0);
  box.innerHTML = W.totalBar(sum, Number(box.dataset.target));
});

let drawing = false;
function initSignaturePad() {
  const pad = document.getElementById('sig-pad');
  if (!pad) return;
  const out = document.getElementById('signature');
  const dpr = window.devicePixelRatio || 1;
  const w = pad.clientWidth;
  const h = pad.clientHeight;
  pad.width = w * dpr;
  pad.height = h * dpr;
  const ctx = pad.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1d2b4f';
  if (pad.dataset.existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = pad.dataset.existing;
  }
  const pos = (ev) => { const r = pad.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  pad.addEventListener('pointerdown', (ev) => {
    if (pad.closest('fieldset')?.disabled) return;
    drawing = true;
    pad.setPointerCapture(ev.pointerId);
    ctx.beginPath();
    ctx.moveTo(...pos(ev));
    ev.preventDefault();
  });
  pad.addEventListener('pointermove', (ev) => {
    if (!drawing) return;
    ctx.lineTo(...pos(ev));
    ctx.stroke();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    out.value = pad.toDataURL('image/png');
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- clicks

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action } = b.dataset;
  try {
    switch (action) {
      case 'close': return closeForm();
      case 'form': return openForm(b.dataset.form, { ...b.dataset });
      case 'raise-gap': return openForm('raise-gap', { key: b.dataset.key });
      case 'resolve-gap': return afterSend(send('gap.resolve', { gap: b.dataset.gap }), `Gap ${b.dataset.gap} marked resolved`);
      case 'outbox': return showOutbox();
      case 'discard': store.discard(b.dataset.id); return showOutbox();
      case 'flush': await store.flush(); return showOutbox();
      case 'guide': guide.hidden = !guide.hidden; renderGuide(); return undefined;
      case 'signout': return store.logout();
      case 'demo-login': {
        const f = view.querySelector('form[data-form="login"]');
        f.elements.email.value = b.dataset.email;
        f.elements.password.value = 'demo';
        return f.requestSubmit();
      }
      case 'verify': {
        ledgerPage.verify = await store.transport().verify();
        return render();
      }
      case 'copy-invite': {
        const inp = document.getElementById('invite-url');
        try { await navigator.clipboard.writeText(inp.value); toast('Link copied'); } catch { inp.select(); }
        return undefined;
      }
      case 'reset':
        Object.keys(wizStep).forEach((k) => delete wizStep[k]);
        ledgerPage.entries = null;
        await store.resetDemo();
        go('');
        return toast('Demo data restored');
      case 'new-batch': {
        const id = makeId('L-W');
        send('batch.create', { id });
        wizStep[id] = 'batch';
        return go(`declare.${id}`);
      }
      case 'product-photo-clear':
        return afterSend(send('product.photo', { lot: b.dataset.lot, photo: null }), 'Back to the sketch');
      case 'sig-clear': {
        const pad = document.getElementById('sig-pad');
        pad.getContext('2d').clearRect(0, 0, pad.width, pad.height);
        pad.dataset.existing = '';
        document.getElementById('signature').value = '';
        return undefined;
      }
      case 'wiz-step':
      case 'wiz-back':
      case 'wiz-add-source':
      case 'wiz-remove-source': {
        const form = document.getElementById('wizard');
        const lotId = form?.dataset.lot || route().id;
        const editable = form && !form.querySelector('fieldset').disabled;
        if (action === 'wiz-add-source' || action === 'wiz-remove-source') {
          saveWizard(form, action === 'wiz-add-source' ? { addBlank: true } : { remove: Number(b.dataset.i) });
          wizStep[lotId] = 'sources';
          render();
          if (action === 'wiz-add-source') document.querySelector('.src-card:last-child input')?.focus();
          return undefined;
        }
        if (editable && form.dataset.step !== 'declare') { try { saveWizard(form); } catch { /* keep going */ } }
        return wizardGo(lotId, action === 'wiz-step' ? b.dataset.step : prevStep(form.dataset.step));
      }
      default: return undefined;
    }
  } catch (ex) {
    toast(ex.message, 6000);
    return undefined;
  }
});

function renderGuide() {
  const demo = store.mode() === 'demo';
  guide.innerHTML = `<h2>Ten minutes with the demo</h2>
  <ol>
    <li><strong>As Sonar Apparel</strong> (you, the manufacturer), open <em>How it works</em>, then <em>Material flow</em>. The claim for the Everyday Crew Tee is held by gaps at three weak points.</li>
    <li>${demo ? 'Open this page in a <strong>second tab</strong> and set it to <strong>GreenFibre Recycling</strong>.' : 'Sign in as <strong>Kamal Hossain (GreenFibre Recycling)</strong> on a second device.'} Everything either side enters appears in the other at once.</li>
    <li>As <strong>Rahman Jhut Traders</strong> (best on a phone): ${demo ? 'tap the <em>Live</em> button and switch on <em>Simulate no connection</em>.' : 'switch the phone to flight mode.'} Continue the L-W1 declaration: Fatullah Garments collected 22 Jun 2026; add Siddhirganj Knitwear, 1,200 kg, 27 Jun; tick “no printed pieces”; sign. Then reconnect: the saved changes are sent in order.</li>
    <li>As <strong>GreenFibre Recycling</strong>: countersign T1 in the goods-in screen, and book goods-in for L-W2 (for example 3,760 kg, moisture 6%). Watch the flow update.</li>
    <li>As <strong>Meghna Spinning Mills</strong>, correct the T3 packing list to 3,000 kg net. As <strong>Sonar Apparel</strong>, correct P4 to 13,500 pieces. The claim is released. Open <em>Ledger</em> and check the chain.</li>
  </ol>
  <p class="muted small">${demo ? 'This hosted demo runs the ledger inside your browser. Run the real server with npm start for accounts, a database and live updates across devices.' : 'Demo accounts use the password demo.'}</p>`;
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#join.') && store.mode() === 'server' && !db()) return showJoin(location.hash.slice(6));
  if (!db()) return undefined;
  render();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  return undefined;
});
document.getElementById('brand-icon').innerHTML = icon('recycler');
boot();
