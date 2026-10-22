#!/usr/bin/env node
/**
 * Reset an admin password directly in the database, for when the password is
 * forgotten and no email (SMTP) is configured for reset links.
 *
 *   DATABASE_URL='postgres://…' npm run reset-admin-password
 *
 * DATABASE_URL is the production one from Vercel → Settings → Environment
 * Variables (or the Neon console). Lists the admin accounts, asks which one
 * and a new password, then signs that account out everywhere. Nothing is
 * written to any file and the password is never printed.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as usersRepo from '../src/repositories/users.repo.js';
import * as sessionsRepo from '../src/repositories/sessions.repo.js';
import { audit } from '../src/services/audit.service.js';
import { closeDb } from '../src/db/index.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the database whose admin password you want to reset.');
  process.exit(1);
}

const users = (await usersRepo.list()).filter((u) => u.is_active);
if (!users.length) {
  console.error('No active admin accounts. Use `npm run create-admin` instead.');
  await closeDb();
  process.exit(1);
}
console.log('\nAdmin accounts:');
users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email}  (${u.role})`));

/* Line-by-line reads work the same at a terminal and when answers are piped
   in; rl.question() drops lines that arrive before it is called. */
const rl = readline.createInterface({ input: stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => { stdout.write(q); const { value } = await lines.next(); return String(value ?? '').trim(); };

const user = users[Number(await ask('\nWhich account (number): ')) - 1];
if (!user) { console.error('No such account.'); rl.close(); await closeDb(); process.exit(1); }

const password = await ask('New password (min 12 characters): ');
if (password.length < 12) { console.error('Password must be at least 12 characters.'); rl.close(); await closeDb(); process.exit(1); }
const confirm = await ask('Confirm new password: ');
rl.close();
if (password !== confirm) { console.error('Passwords do not match.'); await closeDb(); process.exit(1); }

if (await usersRepo.setPassword(user.id, password) !== 1) {
  console.error('The password was not changed.');
  await closeDb();
  process.exit(1);
}
await sessionsRepo.revokeAllForUser(user.id);
await audit({ userEmail: 'cli' }, {
  action: 'auth.password.reset', entity: 'user', entity_id: user.id,
  summary: `Password reset from the command line for ${user.email}`,
});
console.log(`\nPassword updated for ${user.email}. Sign in at /admin. Lockouts were cleared.`);
await closeDb();
