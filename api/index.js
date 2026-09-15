/**
 * Vercel serverless entry point.
 *
 * Every request is routed here by vercel.json and handed to the same Express
 * app the long-running server uses, so there is one codebase and no divergence
 * between local and deployed behaviour.
 *
 * Migrations run once per cold start behind a Postgres advisory lock, which
 * makes concurrent instances safe.
 *
 * Configuration problems are caught and rendered as a setup page rather than
 * being allowed to crash the function: an unconfigured deployment otherwise
 * shows only FUNCTION_INVOCATION_FAILED, which says nothing about which
 * variable is missing or that a redeploy is required to pick it up.
 */
let app;
let boot;
let bootError = null;

/** Variables the app cannot start without, and where each comes from. */
const REQUIRED = [
  ['APP_SECRET', 'Add manually — generate with: openssl rand -hex 32'],
  ['DATABASE_URL', 'Storage → Neon/Postgres integration (leave the prefix empty)'],
];
/** Not required to boot, but features silently degrade without them. */
const OPTIONAL = [
  ['BLOB_READ_WRITE_TOKEN', 'Storage → Blob store — image uploads need it'],
  ['PUBLIC_URL', 'e.g. https://your-project.vercel.app — used for links and SEO'],
  ['CRON_SECRET', 'Protects /api/cron, which sends appointment reminders'],
];

const missing = (list) => list.filter(([name]) => !process.env[name]);

function setupPage(res, problem) {
  const missingRequired = missing(REQUIRED);
  const missingOptional = missing(OPTIONAL);
  const row = ([name, hint]) =>
    `<tr><td><code>${name}</code></td><td>${hint}</td></tr>`;

  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup required</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;margin:0;padding:40px 20px;background:#FAF8F3;color:#26302C}
  main{max-width:640px;margin:0 auto}
  h1{font-size:22px;color:#16302D;margin:0 0 6px}
  p.sub{color:#5B665A;margin:0 0 24px}
  table{width:100%;border-collapse:collapse;margin:14px 0 24px}
  td{padding:9px 10px;border-bottom:1px solid #E4DFD3;vertical-align:top;font-size:14px}
  code{background:#F1EDE4;padding:2px 6px;border-radius:4px;font-size:13px}
  .note{background:#F1EDE4;border-left:3px solid #C79A4B;padding:12px 14px;border-radius:6px;font-size:14px}
  h2{font-size:15px;margin:22px 0 4px;color:#16302D}
</style>
<main>
  <h1>Setup required</h1>
  <p class="sub">This deployment is missing configuration, so it cannot start.</p>
  ${missingRequired.length ? `<h2>Required — the app will not boot without these</h2>
  <table>${missingRequired.map(row).join('')}</table>` : ''}
  ${missingOptional.length ? `<h2>Optional — features degrade without these</h2>
  <table>${missingOptional.map(row).join('')}</table>` : ''}
  <div class="note">
    <strong>After adding them, redeploy.</strong> Vercel injects environment
    variables at build time, so an existing deployment never picks up new
    values. Go to <em>Deployments → latest → ⋯ → Redeploy</em>.
  </div>
  ${problem && !missingRequired.length
    ? `<h2>Reported problem</h2><p><code>${String(problem).slice(0, 300)}</code></p>` : ''}
</main>`);
}

async function build() {
  const { createApp } = await import('../src/app.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  await migrate({ log: console.log });
  await seed({ log: console.log });
  return createApp();
}

export default async function handler(req, res) {
  // Answer with the setup page before touching anything that needs config.
  if (missing(REQUIRED).length) return setupPage(res);

  if (!boot) {
    boot = build().then(
      (a) => { app = a; },
      (err) => { bootError = err; console.error('[boot] failed:', err); }
    );
  }
  await boot;

  if (bootError) {
    // Let the next request retry rather than caching a transient failure
    // (a database still waking up, for instance).
    const err = bootError;
    boot = undefined;
    bootError = null;
    return setupPage(res, err.message);
  }

  return app(req, res);
}
