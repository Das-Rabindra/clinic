/**
 * Forward-only migration runner. Each .sql file in migrations/ runs once, in
 * filename order, inside a transaction, and is recorded in schema_migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate({ log = console.log } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // better-sqlite3 cannot run exec() inside a JS transaction wrapper reliably
    // for multi-statement DDL, so we bracket manually.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      log(`[migrate] applied ${file}`);
      count++;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  if (!count) log('[migrate] up to date');
  return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  process.exit(0);
}
