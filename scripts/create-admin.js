#!/usr/bin/env node
/** Interactive first-admin creation. Never writes credentials to any file. */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import * as usersRepo from '../src/repositories/users.repo.js';
import { closeDb } from '../src/db/index.js';

migrate({ log: () => {} });
seed({ log: () => {} });

const rl = readline.createInterface({ input: stdin, output: stdout });

const email = (await rl.question('Admin email: ')).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('That is not a valid email address.');
  process.exit(1);
}
if (usersRepo.findByEmail(email)) {
  console.error('An account with that email already exists.');
  process.exit(1);
}
const name = (await rl.question('Full name: ')).trim() || 'Clinic Administrator';
const password = (await rl.question('Password (min 12 characters): ')).trim();
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}
const confirm = (await rl.question('Confirm password: ')).trim();
if (password !== confirm) {
  console.error('Passwords do not match.');
  process.exit(1);
}
rl.close();

const role = usersRepo.count() === 0 ? 'owner' : 'admin';
const user = usersRepo.create({ email, name, password, role });
console.log(`\nCreated ${role} account: ${user.email}`);
closeDb();
