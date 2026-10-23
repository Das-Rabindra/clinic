/**
 * Forward-only migration runner. Each .sql file in migrations/ runs once, in
 * filename order, and is recorded in schema_migrations.
 *
 * Everything happens in one transaction holding a transaction-level advisory
 * lock, so concurrent boots on a serverless platform cannot race to apply
 * the same migration.
 *
 * It used to take a session-level lock (pg_advisory_lock) outside any
 * transaction. Through a transaction-mode pooler such as Neon's pooled
 * endpoint, consecutive statements outside a transaction can run on different
 * server connections, so the unlock could miss the connection that held the
 * lock. The lock then stayed held, and the next cold start waited on it until
 * the platform timed the request out (a 504). A transaction-level lock lives
 * and dies with its transaction, which the pooler keeps on one connection.
 *
 * Called inside an existing tx() (as boot.js does), it joins that
 * transaction; the lock is then held until the caller commits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, all, run, exec_raw } from './index.js';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
/* A new key: the old session-level lock on 8472613 may still be held by a
   pooled server connection, and session and transaction advisory locks share
   one key space, so reusing it would wait on that leaked lock. */
const LOCK_KEY = 8472614;

export const migrationFiles = () =>
  fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

export async function migrate({ log = console.log } = {}) {
  return tx(async () => {
    await run('SELECT pg_advisory_xact_lock(?)', LOCK_KEY);
    await exec_raw(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const applied = new Set((await all('SELECT name FROM schema_migrations')).map(r => r.name));
    let count = 0;
    for (const file of migrationFiles()) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      /* A savepoint per file, so the error names the file that failed rather
         than surfacing as "current transaction is aborted". */
      await exec_raw('SAVEPOINT migration');
      try {
        await exec_raw(sql);
        await run('INSERT INTO schema_migrations (name) VALUES (?) RETURNING name', file);
        await exec_raw('RELEASE SAVEPOINT migration');
      } catch (err) {
        await exec_raw('ROLLBACK TO SAVEPOINT migration');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      log(`[migrate] applied ${file}`);
      count++;
    }
    if (!count) log('[migrate] up to date');
    return count;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { closeDb } = await import('./index.js');
  await migrate();
  await closeDb();
  process.exit(0);
}
