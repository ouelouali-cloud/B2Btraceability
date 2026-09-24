// Accounts: one user belongs to one company. Passwords are scrypt-hashed,
// session and invite tokens are stored only as SHA-256 hashes.

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { sha256 } from './ledger.js';

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString('hex')}`;
}

export function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class Auth {
  constructor(ledger) { this.sql = ledger.sql; }

  createUser({ orgId, email, name, password }) {
    const id = randomUUID();
    this.sql.prepare('INSERT INTO users (id, org_id, email, name, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, orgId, email.toLowerCase().trim(), name.trim(), hashPassword(password), new Date().toISOString());
    return this.user(id);
  }

  user(id) {
    return this.sql.prepare('SELECT id, org_id AS orgId, email, name FROM users WHERE id = ?').get(id) || null;
  }

  login(email, password) {
    const u = this.sql.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
    if (!u || !checkPassword(String(password || ''), u.pass)) return null;
    return { token: this.newSession(u.id), user: this.user(u.id) };
  }

  newSession(userId) {
    const token = randomBytes(32).toString('hex');
    this.sql.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha256(token), userId, new Date().toISOString());
    return token;
  }

  fromToken(token) {
    if (!token) return null;
    const s = this.sql.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(sha256(token));
    return s ? this.user(s.user_id) : null;
  }

  logout(token) {
    this.sql.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(String(token || '')));
  }

  createInvite(orgId, email) {
    const token = randomBytes(24).toString('base64url');
    this.sql.prepare('INSERT INTO invites (token_hash, org_id, email, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), orgId, email, new Date().toISOString());
    return token;
  }

  invite(token) {
    return this.sql.prepare('SELECT org_id AS orgId, email, used_at AS usedAt FROM invites WHERE token_hash = ?').get(sha256(String(token || ''))) || null;
  }

  useInvite(token, { name, password }) {
    const inv = this.invite(token);
    if (!inv || inv.usedAt) return null;
    const u = this.createUser({ orgId: inv.orgId, email: inv.email, name, password });
    this.sql.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(new Date().toISOString(), sha256(token));
    return { token: this.newSession(u.id), user: u };
  }

  wipeSessions() { this.sql.exec('DELETE FROM sessions;'); }
}

export { DEMO_USERS } from '../app/js/seed.js';
