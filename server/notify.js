// Notifications. After each ledger entry, work out which companies should hear
// about it, then deliver one message per user of those companies.
//
// Delivery: every message is stored in the `outbox` table. If NOTIFY_WEBHOOK_URL
// is set, each message is also POSTed there as JSON {to, subject, text, url},
// so any email or SMS service (or a small Zapier / Make / Twilio function) can
// send it. No email library is bundled on purpose.

const one = (entry, c) => entry.changes.find((x) => x.c === c && x.data)?.data;
const orgName = (state, id) => state.orgs.find((o) => o.id === id)?.name || 'A partner';

// Pure: which companies get which message for this entry.
export function messagesFor(entry, state) {
  const out = [];
  const actor = orgName(state, entry.actor);
  const push = (orgId, subject, text, path = '') => { if (orgId && orgId !== entry.actor) out.push({ orgId, subject, text, path }); };

  switch (entry.command) {
    case 'gap.raise': {
      const g = one(entry, 'gaps');
      if (g) push(g.owner, `Evidence request from ${actor}: ${g.title}`, `${actor} needs your help with "${g.title}" (${g.key.split(':')[0]}).\n\n${g.thread.at(-1)?.text || ''}`, '#tasks');
      break;
    }
    case 'gap.reply': {
      const g = one(entry, 'gaps');
      if (g) {
        const to = entry.actor === g.owner ? g.raisedBy : g.owner;
        push(to, `Reply from ${actor} on ${g.title}`, g.thread.at(-1)?.text || '', `#gaps.${g.id}`);
      }
      break;
    }
    case 'goodsin.record': {
      const t = one(entry, 'transfers');
      if (t) push(t.fromOrg, `${actor} received your batch ${t.lotId}`, `${actor} weighed ${Number(t.receivedQty).toLocaleString('en-GB')} kg of ${t.lotId} at its gate${t.countersign ? ' and countersigned your declaration' : ''}.`, '#tasks');
      break;
    }
    case 'receipt.countersign': {
      const t = one(entry, 'transfers');
      if (t) push(t.fromOrg, `${actor} countersigned your declaration`, entry.summary, '#tasks');
      break;
    }
    case 'batch.step': {
      const l = one(entry, 'lots');
      if (l?.origin?.declaration?.signedOn && /Signed declaration/.test(entry.summary)) {
        const seller = state.orgs.find((o) => o.id === l.orgId);
        for (const to of seller?.suppliesTo || []) push(to, `New signed waste batch from ${actor}`, `${l.id}: ${Number(l.qty).toLocaleString('en-GB')} kg is declared and ready for goods-in.`, '#tasks');
      }
      break;
    }
    case 'shipment.record': {
      const t = one(entry, 'transfers');
      if (t) push(t.toOrg, `Shipment ${t.id} from ${actor}`, entry.summary, `#handoff.${t.id}`);
      break;
    }
    default:
  }
  return out;
}

export class Notifier {
  constructor(ledger, { webhook = process.env.NOTIFY_WEBHOOK_URL, baseUrl = process.env.PUBLIC_URL || '', quiet = false } = {}) {
    this.sql = ledger.sql;
    this.webhook = webhook;
    this.baseUrl = baseUrl;
    this.quiet = quiet;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, to_email TEXT NOT NULL, subject TEXT NOT NULL,
      text TEXT NOT NULL, url TEXT, seq INTEGER, status TEXT NOT NULL)`);
    ledger.listeners.add((e) => this.onEntry(e, ledger.state));
  }

  usersOf(orgId) {
    return this.sql.prepare('SELECT email, name FROM users WHERE org_id = ?').all(orgId);
  }

  onEntry(entry, state) {
    for (const m of messagesFor(entry, state)) {
      for (const u of this.usersOf(m.orgId)) this.deliver({ to: u.email, subject: m.subject, text: `Hello ${u.name},\n\n${m.text}`, url: this.baseUrl + '/' + m.path, seq: entry.seq });
    }
  }

  // Also used for invitations, which go to someone without an account yet.
  deliver({ to, subject, text, url = '', seq = null }) {
    const r = this.sql.prepare('INSERT INTO outbox (created_at, to_email, subject, text, url, seq, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), to, subject, text, url, seq, this.webhook ? 'sending' : 'stored');
    if (!this.webhook) return;
    fetch(this.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, subject, text, url }) })
      .then((res) => this.mark(r.lastInsertRowid, res.ok ? 'sent' : `failed ${res.status}`))
      .catch((err) => { this.mark(r.lastInsertRowid, 'failed'); if (!this.quiet) console.error('notify:', err.message); });
  }

  mark(id, status) { this.sql.prepare('UPDATE outbox SET status = ? WHERE id = ?').run(status, id); }

  recent(limit = 50) { return this.sql.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT ?').all(limit); }
}
