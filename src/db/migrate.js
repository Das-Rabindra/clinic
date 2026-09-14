/**
 * Forward-only migration runner. Each .sql file in migrations/ runs once, in
 * filename order, inside a transaction, and is recorded in schema_migrations.
 *
 * A Postgres advisory lock serialises concurrent boots — on a serverless
 * platform several instances can start at once, and without the lock they
 * would race to apply the same migration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, exec_raw } from './index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 8472613;   // arbitrary but stable

export async function migrate({ log = console.log } = {}) {
  await exec_raw(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const applied = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name)
    );
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`[migrate] applied ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    if (!count) log('[migrate] up to date');
    return count;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch { /* lock released with the connection */ }
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { closeDb } = await import('./index.js');
  await migrate();
  await closeDb();
  process.exit(0);
}
