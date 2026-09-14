/** Process entry point: migrate, seed, start HTTP, start jobs, shut down cleanly. */
import { createApp } from './app.js';
import { config } from './config/env.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { closeDb } from './db/index.js';
import * as scheduler from './jobs/scheduler.js';

await migrate();
await seed();

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  Samal Dental Care platform`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Website  : ${config.publicUrl}`);
  console.log(`  Admin    : ${config.publicUrl}/admin`);
  console.log(`  Env      : ${config.env}`);
  console.log(`  Database : ${config.database.url.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`  Uploads  : ${config.paths.uploadDir}\n`);
});

scheduler.start();

/* An HTTPS-less production deployment cannot use Secure cookies; say so plainly
   rather than letting sign-in fail mysteriously in the browser. */
if (config.isProd && !config.session.secureCookies) {
  console.warn(
    '[server] PUBLIC_URL is not https and TRUST_PROXY is false, so session cookies\n' +
    '         are sent without the Secure flag. Sign-in will work over plain HTTP,\n' +
    '         but put this behind HTTPS before taking real patient bookings.'
  );
}

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down`);
  scheduler.stop();
  server.close(async () => { await closeDb(); process.exit(0); });
  // Don't hang forever on lingering keep-alive connections.
  setTimeout(async () => { await closeDb(); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));

export { app, server };
