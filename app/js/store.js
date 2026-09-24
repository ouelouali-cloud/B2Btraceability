// Browser-side persistence. In production this module is the only thing that
// changes: swap localStorage for API calls and the engine and views stay as is.

import { seed } from './seed.js';
import { syncGaps } from './engine/trace.js';

const KEY = 'threadback.v2';
const listeners = new Set();
let state = null;

export const today = () => new Date().toISOString().slice(0, 10);

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

export function load() {
  const raw = read(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2) state = parsed;
    } catch { /* fall through to seed */ }
  }
  if (!state) state = seed();
  if (!state.ui) state.ui = { actingAs: state.tenantId };
  return state;
}

export const db = () => state;
export const actingAs = () => state.ui.actingAs;
export const isTenant = () => state.ui.actingAs === state.tenantId;

export function subscribe(fn) { listeners.add(fn); }

// Apply a change, re-run checks, auto-close gaps whose check now passes.
export function mutate(fn) {
  fn(state);
  const closed = syncGaps(state, today());
  write(KEY, JSON.stringify(state));
  listeners.forEach((l) => l({ closed }));
  return closed;
}

export function reset() {
  const ui = state.ui;
  state = seed();
  state.ui = { ...ui, actingAs: state.tenantId };
  write(KEY, JSON.stringify(state));
  listeners.forEach((l) => l({ closed: [] }));
}

export function nextId(prefix, list) {
  const n = list.map((x) => parseInt(String(x.id).replace(/\D/g, ''), 10) || 0);
  return `${prefix}${Math.max(0, ...n) + 1}`;
}
