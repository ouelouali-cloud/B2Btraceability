// Consistent backup while the server runs: `npm run backup`.
// Writes data/backups/threadback-YYYY-MM-DDTHH-MM.db (ledger, users, file index).
// Document scans live in data/files/ and never change once written; copy that
// folder alongside (for example with rsync) to complete the backup.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.env.DB_FILE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'threadback.db');
const dir = join(dirname(file), 'backups');
mkdirSync(dir, { recursive: true });
const out = join(dir, `threadback-${new Date().toISOString().slice(0, 16).replace(':', '-')}.db`);
new DatabaseSync(file).exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
console.log(`Backup written: ${out}`);
