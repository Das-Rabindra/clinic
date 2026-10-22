/**
 * Design-system preview route, plus the first browser-level checks.
 *
 * The browser half drives real Chromium (Puppeteer, a devDependency) against
 * the app on an ephemeral port and a throwaway database. It is skipped, not
 * failed, where Chromium cannot launch, so a server without a browser still
 * runs the rest of the suite.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, browser;

before(async () => {
  ctx = await setupEnv('styleguide');
  await bootDb();
  srv = await startServer();
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  } catch { browser = null; }
});
after(async () => {
  if (browser) await browser.close();
  await srv.close();
  await cleanup(ctx);
});

describe('styleguide route', () => {
  test('renders, and tells crawlers not to index it', async () => {
    const r = await srv.call('/_styleguide');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(r.body, /<meta name="robots" content="noindex, nofollow">/);
  });

  test('is not in the sitemap and not linked from public pages', async () => {
    const sitemap = await srv.call('/sitemap.xml');
    assert.ok(!sitemap.body.includes('_styleguide'));
    for (const page of ['/', '/services', '/privacy']) {
      const r = await srv.call(page);
      assert.ok(!r.body.includes('_styleguide'), `${page} links to the styleguide`);
    }
  });

  test('every public page is on the design system, none on the old stylesheet', async () => {
    for (const path of ['/', '/services', '/services/dentures', '/privacy', '/no-such-page']) {
      const r = (await srv.call(path)).body;
      assert.ok(r.includes('/css/ds.css'), path);
      assert.ok(!r.includes('/css/site.css') && !r.includes('/js/site.js'), path);
    }
    assert.equal((await srv.call('/css/site.css')).status, 404, 'the old stylesheet is gone');
  });
});

describe('styleguide in a browser', () => {
  /* The skip is decided when the test runs, after before() has tried to
     launch Chromium — not when the file is loaded. */
  const btest = (name, fn) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium could not launch');
    await fn();
  });
  const page = async (width, setup) => {
    const p = await browser.newPage();
    if (setup) await setup(p);
    await p.setViewport({ width, height: 860, isMobile: width < 768, hasTouch: width < 768 });
    await p.goto(srv.base + '/_styleguide', { waitUntil: 'networkidle0' });
    return p;
  };

  for (const width of [360, 768, 1440]) {
    btest(`no horizontal overflow and no console errors at ${width}px`, async () => {
      const errors = [];
      const p = await page(width, (pg) => {
        pg.on('pageerror', (e) => errors.push(String(e)));
        pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      });
      const { scroll, client } = await p.evaluate(() => ({
        scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      await p.close();
      assert.ok(scroll <= client, `scrollWidth ${scroll} > ${client}`);
      assert.deepEqual(errors, []);
    });
  }

  btest('mobile menu keeps focus inside, Esc closes and restores focus', async () => {
    const p = await page(375);
    await p.click('[data-nav-toggle]');
    assert.equal(await p.$eval('[data-nav-toggle]', (t) => t.getAttribute('aria-label')), 'Close menu');
    for (let i = 0; i < 15; i++) {
      await p.keyboard.press('Tab');
      const inside = await p.evaluate(() =>
        Boolean(document.activeElement.closest('#sgDrawer') || document.activeElement.matches('[data-nav-toggle]')));
      assert.ok(inside, `Tab ${i + 1} left the menu`);
    }
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.activeElement.matches('[data-nav-toggle]')), true);
    assert.equal(await p.$eval('[data-nav-toggle]', (t) => t.getAttribute('aria-expanded')), 'false');
    await p.close();
  });

  btest('dialog takes focus, traps Tab, and returns focus on close', async () => {
    const p = await page(1024);
    await p.click('[data-dialog-open]');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'sgDlgInput');
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press('Tab');
      assert.ok(await p.evaluate(() => Boolean(document.activeElement.closest('dialog'))), `Tab ${i + 1} left the dialog`);
    }
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.activeElement.matches('[data-dialog-open]')), true);
    await p.close();
  });

  btest('form errors are announced, associated, and focus the first problem', async () => {
    const p = await page(1024);
    await p.click('form[data-validate] [type=submit]');
    const s = await p.evaluate(() => ({
      focus: document.activeElement.id,
      invalid: document.getElementById('sgName').getAttribute('aria-invalid'),
      describedBy: document.getElementById('sgPhone').getAttribute('aria-describedby'),
      phoneError: document.getElementById('sgPhoneErr').textContent,
      status: document.querySelector('[data-form-status]').textContent,
    }));
    await p.close();
    assert.equal(s.focus, 'sgName');
    assert.equal(s.invalid, 'true');
    assert.match(s.describedBy, /sgPhoneErr/);
    assert.ok(s.phoneError.length > 0);
    assert.match(s.status, /2 problems/);
  });

  btest('accordion answers stay visible without JavaScript', async () => {
    const p = await page(1024, (pg) => pg.setJavaScriptEnabled(false));
    assert.equal(await p.$eval('#sgAcc2', (el) => getComputedStyle(el).display), 'block');
    await p.close();
  });

  btest('motion is switched off under prefers-reduced-motion', async () => {
    const p = await page(1024, (pg) => pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]));
    const d = await p.$eval('.button', (el) => parseFloat(getComputedStyle(el).transitionDuration));
    await p.close();
    assert.ok(d < 0.001);
  });
});
