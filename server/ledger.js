// Persistence. One SQLite file holds:
//   entries   the ledger, append-only, hash-linked (the source of truth)
//   users, sessions, invites   who may write, and for which company
// The current state is rebuilt from the entries at start-up and then kept
// in memory; every accepted command appends one entry.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { seed } from '../app/js/seed.js';
import { execute } from '../app/js/engine/commands.js';
import { COLLECTIONS, diff, applyChanges, emptyState, hashInput, GENESIS, verifyChain } from '../app/js/engine/ledgerlog.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    seq INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, user TEXT NOT NULL,
    command TEXT NOT NULL, command_id TEXT UNIQUE, summary TEXT NOT NULL,
    changes TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pass TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    created_at TEXT NOT NULL, used_at TEXT);
`;

const row = (r) => ({ ...r, changes: JSON.parse(r.changes) });

export class Ledger {
  constructor(file) {
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec(SCHEMA);
    this.listeners = new Set();
    this.load();
  }

  load() {
    const tenant = this.sql.prepare("SELECT v FROM meta WHERE k = 'tenant'").get()?.v;
    this.state = emptyState(tenant || null);
    this.head = GENESIS;
    this.seq = 0;
    for (const r of this.sql.prepare('SELECT * FROM entries ORDER BY seq').all()) {
      applyChanges(this.state, JSON.parse(r.changes));
      this.head = r.hash;
      this.seq = r.seq;
    }
  }

  get empty() { return this.seq === 0; }

  // First entry: the demo network as it stands on day one.
  genesis() {
    const s = seed();
    this.sql.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('tenant', ?)").run(s.tenantId);
    this.state = emptyState(s.tenantId);
    const changes = COLLECTIONS.flatMap((c) => s[c].map((r) => ({ c, id: r.id, data: r })));
    this.append({ actor: 'system', user: 'system', command: 'network.seed', commandId: null, summary: 'Demo supply chain loaded', changes });
  }

  append({ actor, user, command, commandId, summary, changes }) {
    const e = { seq: this.seq + 1, at: new Date().toISOString(), actor, user, command, summary, changes, prev: this.head };
    e.hash = sha256(hashInput(e));
    this.sql.prepare(`INSERT INTO entries (seq, at, actor, user, command, command_id, summary, changes, prev, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.seq, e.at, actor, user, command, commandId, summary, JSON.stringify(changes), e.prev, e.hash);
    applyChanges(this.state, changes);
    this.seq = e.seq;
    this.head = e.hash;
    for (const fn of this.listeners) fn(e);
    return e;
  }

  // Run a command for a user. Replaying the same command id returns the
  // original result instead of writing twice (phones retry after going offline).
  run(name, payload, { actor, userName, commandId }) {
    if (commandId) {
      const prior = this.sql.prepare('SELECT seq, summary FROM entries WHERE command_id = ?').get(commandId);
      if (prior) return { seq: prior.seq, summary: prior.summary, closed: [], duplicate: true };
    }
    const now = new Date().toISOString().slice(0, 10);
    const { next, summary, closed } = execute(this.state, name, payload, { actor, userName, now });
    const changes = diff(this.state, next);
    if (!changes.length) return { seq: this.seq, summary, closed, unchanged: true };
    const e = this.append({ actor, user: userName, command: name, commandId: commandId || null, summary, changes });
    return { seq: e.seq, summary, closed };
  }

  entries({ after = 0, limit = 500 } = {}) {
    return this.sql.prepare('SELECT * FROM entries WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit).map(row);
  }

  recent(limit = 200) {
    return this.sql.prepare('SELECT * FROM entries ORDER BY seq DESC LIMIT ?').all(limit).map(row);
  }

  verify() {
    return verifyChain(this.sql.prepare('SELECT * FROM entries ORDER BY seq').all().map(row), sha256);
  }

  reset() {
    this.sql.exec('DELETE FROM entries; DELETE FROM meta;');
    this.load();
    this.genesis();
  }
}
