// Walks from a finished product back to the waste it came from, and decides
// whether a claim on that product can be released.

import { TIERS, RULES, requiredDocs } from './rules.js';
import { org, lot, transfer, processOf, fibreKgOf, daysBetween } from './db.js';
import { checkTransfer, checkProcess, checkOrigin, originMissing, sourcedKg, worst, fmt } from './checks.js';
import { ledger, lotRemaining } from './ledger.js';

// Tree: { lot, org, process, checks, inputs: [{ transfer, checks, upstream }] }
export function traceLot(db, lotId, seen = new Set()) {
  const l = lot(db, lotId);
  if (!l || seen.has(lotId)) return null;
  seen.add(lotId);
  const p = l.producedBy ? processOf(db, l.producedBy) : null;
  return {
    lot: l,
    org: org(db, l.orgId),
    process: p,
    checks: p ? checkProcess(db, p) : l.origin ? checkOrigin(db, l) : [],
    inputs: p ? p.inputs.map((i) => {
      const t = transfer(db, i.transferId);
      return { transfer: t, kg: i.kg, checks: checkTransfer(db, t), upstream: traceLot(db, t.lotId, seen) };
    }) : [],
  };
}

// Flattened, most upstream first: alternating node / handoff entries.
export function chainSteps(tree) {
  const steps = [];
  (function walk(node) {
    if (!node) return;
    // Upstream first so the list reads waste → garment.
    for (const i of node.inputs) {
      walk(i.upstream);
      steps.push({ kind: 'handoff', transfer: i.transfer, checks: i.checks, kg: i.kg });
    }
    steps.push({ kind: 'node', node });
  })(tree);
  return steps;
}

export function treeChecks(tree) {
  if (!tree) return [];
  return [...tree.checks, ...tree.inputs.flatMap((i) => [...i.checks, ...treeChecks(i.upstream)])];
}

// ---------------------------------------------------------------- claims

export function checkClaim(db, c) {
  const l = lot(db, c.lotId);
  const owner = l.orgId;
  const mk = (id, title, status, detail) => ({ key: `${c.id}:${id}`, subject: c.id, id, group: 'claim', title, status, detail, owner });
  const out = [];

  const left = lotRemaining(db, l) + c.pcs; // stock before this claim
  out.push(mk('stock', 'Pieces available on lot', c.pcs > left ? 'fail' : 'pass',
    `Claiming ${fmt(c.pcs)} of ${fmt(left)} pcs on ${l.id}.`));

  out.push(mk('pct', 'Claim within product composition',
    c.recycledPct > l.recycledPct ? 'fail' : c.recycledPct < RULES.minClaimPct ? 'fail' : 'pass',
    c.recycledPct < RULES.minClaimPct ? `${c.recycledPct}% is below the ${RULES.minClaimPct}% minimum for a product claim.`
      : `Claim ${c.recycledPct}% vs product ${l.recycledPct}%.`));

  const led = ledger(db, owner);
  const kg = fibreKgOf(l, c.pcs) * c.recycledPct / 100;
  out.push(mk('balance', 'Within mass-balance credit', led.firstNegative ? 'fail' : 'pass',
    led.firstNegative ? `Account goes negative at ${led.firstNegative.ref}. Claims cannot exceed recycled content produced.`
      : `Claim uses ${fmt(Math.round(kg))} kg recycled; ${fmt(Math.round(led.credit))} kg credit left after it.`));

  const up = treeChecks(traceLot(db, c.lotId));
  const fails = up.filter((x) => x.status === 'fail');
  const warns = up.filter((x) => x.status === 'warn');
  out.push(mk('upstream', 'Upstream chain verified', fails.length ? 'fail' : warns.length ? 'warn' : 'pass',
    fails.length ? `${fails.length} failing ${fails.length === 1 ? 'check' : 'checks'} upstream: ${fails.map((f) => f.title.toLowerCase() + ' (' + f.subject + ')').join(', ')}.`
      : warns.length ? `All checks pass; ${warns.length} ${warns.length === 1 ? 'warning' : 'warnings'} to tidy before audit.`
        : `All ${up.length} upstream checks pass back to the waste source.`));
  return out;
}

export function claimStatus(db, c) {
  const checks = checkClaim(db, c);
  const w = worst(checks);
  return { checks, status: w === 'fail' ? 'held' : 'ready', warn: w === 'warn' };
}

// ---------------------------------------------------------------- everything

export function allChecks(db) {
  return [
    ...db.transfers.flatMap((t) => checkTransfer(db, t)),
    ...db.processes.flatMap((p) => checkProcess(db, p)),
    ...db.lots.filter((l) => l.origin).flatMap((l) => checkOrigin(db, l)),
    ...db.claims.flatMap((c) => checkClaim(db, c)),
  ];
}

// What each supplier still owes the chain, as a checklist.
export function completeness(db, orgId, asOf) {
  const o = org(db, orgId);
  const tier = TIERS[o.tier];
  const items = [];
  if (o.status === 'invited') items.push({ label: 'Accept invitation and create account', ok: false });
  if (tier.certRequired) {
    items.push({ label: 'Scope certificate on file', ok: !!o.sc?.number });
    if (o.sc?.number) {
      const days = daysBetween(asOf, o.sc.validTo);
      items.push({ label: days < 0 ? `Scope certificate expired ${o.sc.validTo}` : days < RULES.scExpiryWarnDays ? `Scope certificate renewal (expires ${o.sc.validTo})` : 'Scope certificate current', ok: days >= RULES.scExpiryWarnDays, soft: days >= 0 });
    }
  }
  for (const l of db.lots.filter((x) => x.orgId === orgId && x.origin)) {
    const miss = originMissing(l);
    items.push({ label: `Origin declaration for ${l.id}` + (miss.length ? ` (${miss.length} items missing)` : ''), ok: !miss.length });
    items.push({ label: `Every kg of ${l.id} traced to a factory (${Math.round(sourcedKg(l)).toLocaleString('en-GB')} of ${l.qty.toLocaleString('en-GB')} kg)`, ok: l.qty > 0 && Math.abs(sourcedKg(l) - l.qty) / l.qty <= 0.02 });
  }
  for (const t of db.transfers.filter((x) => x.fromOrg === orgId)) {
    if (tier.certRequired) items.push({ label: `TC for ${t.id}`, ok: !!t.tc?.number });
    const need = requiredDocs(o, org(db, t.toOrg));
    const have = need.filter((d) => t.docs?.[d]?.number);
    items.push({ label: `Documents for ${t.id} (${have.length}/${need.length})`, ok: have.length === need.length });
  }
  for (const p of db.processes.filter((x) => x.orgId === orgId)) {
    items.push({ label: `Production records for ${p.id}`, ok: (p.records || []).length > 0 });
  }
  const score = items.length ? items.filter((i) => i.ok).length / items.length : 0;
  return { items, score };
}

// Close any open gap whose check now passes. Returns ids closed.
export function syncGaps(db, now) {
  const byKey = Object.fromEntries(allChecks(db).map((c) => [c.key, c]));
  const closed = [];
  for (const g of db.gaps) {
    if (g.status !== 'open') continue;
    const c = byKey[g.key];
    if (c && (c.status === 'pass' || c.status === 'na')) {
      g.status = 'resolved';
      g.resolvedAt = now;
      g.thread.push({ by: 'system', at: now, text: `Check now passes: ${c.detail}` });
      closed.push(g.id);
    }
  }
  return closed;
}
