// Document scans (TCs, invoices, slips). Stored once per content on disk, named
// by their SHA-256. The same fingerprint is written into the document record,
// so the ledger proves which exact file was attached; a swapped file no longer
// matches its record.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_FILE = 8 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

export class Files {
  constructor(ledger, dir) {
    this.sql = ledger.sql;
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (
      sha TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      size INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  }

  save(orgId, { name, type, data }) {
    if (!ALLOWED.test(type || '')) throw new Error('Only PDF, JPEG, PNG or WebP files can be attached.');
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length) throw new Error('The file is empty.');
    if (buf.length > MAX_FILE) throw new Error('Files can be at most 8 MB.');
    const sha = createHash('sha256').update(buf).digest('hex');
    const path = join(this.dir, sha);
    if (!existsSync(path)) writeFileSync(path, buf);
    this.sql.prepare('INSERT OR IGNORE INTO files (sha, org_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha, orgId, String(name || 'document').slice(0, 200), type, buf.length, new Date().toISOString());
    return { sha, name: String(name || 'document').slice(0, 200), type, size: buf.length };
  }

  meta(sha) { return /^[0-9a-f]{64}$/.test(sha) ? this.sql.prepare('SELECT * FROM files WHERE sha = ?').get(sha) : null; }
  read(sha) { return readFileSync(join(this.dir, sha)); }
}
