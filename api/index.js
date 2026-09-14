/**
 * Vercel serverless entry point.
 *
 * Every request is routed here by vercel.json and handed to the same Express
 * app the long-running server uses, so there is one codebase and no divergence
 * between local and deployed behaviour.
 *
 * Migrations run once per cold start behind a Postgres advisory lock, which
 * makes concurrent instances safe.
 */
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

let app;
let ready;

async function boot() {
  await migrate({ log: console.log });
  await seed({ log: console.log });
  return createApp();
}

export default async function handler(req, res) {
  if (!ready) ready = boot().then((a) => { app = a; });
  await ready;
  return app(req, res);
}
