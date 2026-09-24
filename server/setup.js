// Start a real network: one manufacturer, one user, no demo data.
//
//   npm run setup -- --company "Sonar Apparel Ltd" --city Chattogram --country BD \
//                    --name "Nusrat Jahan" --email nusrat@example.com --password '********'
//
// Then run the server with DEMO=0. Suppliers join through invitation links.

import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.js';
import { Auth } from './auth.js';
import { emptyState } from '../app/js/engine/ledgerlog.js';

export function setupNetwork(file, { company, city = '', country = 'BD', name, email, password }) {
  if (!company || !name || !email || String(password || '').length < 8) {
    throw new Error('Required: --company, --name, --email and --password (8+ characters).');
  }
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const ledger = new Ledger(file);
  if (!ledger.empty) throw new Error(`${file} already has ${ledger.seq} ledger entries. Use a new DB_FILE.`);
  const id = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'manufacturer';
  const network = emptyState(id);
  network.orgs.push({ id, name: company, tier: 'garment', city, country: country.toUpperCase(), email, status: 'active', invitedBy: null, suppliesTo: [], sc: null });
  ledger.genesis(network, `Network created for ${company}`);
  const user = new Auth(ledger).createUser({ orgId: id, email, name, password });
  return { ledger, user, orgId: id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    company: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' },
    name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, db: { type: 'string' },
  } });
  const file = values.db || process.env.DB_FILE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'threadback.db');
  try {
    const { orgId } = setupNetwork(file, values);
    console.log(`Created ${values.company} (${orgId}) in ${file}. Start with: DEMO=0 DB_FILE=${file} npm start`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
