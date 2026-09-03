// System, Light, Dark. System is the default and the only answer that can be
// known before the first paint, which is what ends the flash.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

// The page carries its own theme, baked at publish time, and it is the only
// thing the boot script can read before the first paint. So which bake a
// scenario runs against is part of the scenario. These are the bytes of the
// build under test with one attribute swapped — never a page written here, or
// the suite would go green against a build it never loaded.
const art = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');
const built = fs.readFileSync(path.join(art, 'current.html'), 'utf8');
if (!/name="app-theme" content="[a-z]+"/.test(built)) throw new Error('build under test has no baked theme');
const pageFor = (bake) => {
  const name = `tap-${bake}.html`;
  fs.writeFileSync(path.join(art, name), built.replace(/name="app-theme" content="[a-z]+"/, `name="app-theme" content="${bake}"`));
  return `http://127.0.0.1:4320/${name}`;
};

// A page published while the preference was `store` is the ordinary case: the
// bake and the store agree, because the bake came from the store.
async function open({ system = 'light', store = null, device = null, bake = null } = {}) {
  const URL = pageFor(bake || store || 'system');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme: system });
  await ctx.clock.install({ time: new Date('2026-09-02T12:00:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  await page.addInitScript(() => {
    window.__frames = [];
    const tick = () => {
      try {
        const el = document.documentElement;
        if (el) {
          const m = getComputedStyle(el).backgroundColor.match(/\d+/);
          const shade = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : 'none';
          if (shade !== window.__frames[window.__frames.length-1]) window.__frames.push(shade);
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (device) await page.addInitScript((d) => localStorage.setItem('theme', JSON.stringify(d)), device);
  await page.addInitScript(stub(), [false, store ? { 'meta/prefs': { theme: store, updatedAt:'x' } } : {}, false]);
  await page.goto(URL, { waitUntil:'commit' });
  await page.waitForTimeout(2600);
  return { b, page, errors };
}
const frames = (page) => page.evaluate(() => window.__frames);
const shade = (page) => page.evaluate(() => document.documentElement.dataset.appTheme);
const go = async (page, l) => { await page.click(`nav button:has-text("${l}")`); await page.waitForTimeout(400); };

// On System, the phone decides — and nothing repaints, either way round.
for (const system of ['light', 'dark']) {
  const { b, page, errors } = await open({ system, store: 'system' });
  ok(`A system pref on a ${system} phone shows ${system}`, await shade(page) === system, await shade(page));
  ok(`A system pref on a ${system} phone never repaints`, (await frames(page)).length === 1, (await frames(page)).join(' -> '));
  ok(`A no page errors (${system})`, errors.length === 0, errors.join(';'));
  await b.close();
}

// The cost of keeping the answer in the page: a bake that has gone stale
// relative to the store — the preference changed and the page has not been
// republished since — is one step on the next open, and one only. The store
// still wins; it just wins a frame late.
{
  const { b, page, errors } = await open({ system: 'light', store: 'system', bake: 'dark' });
  const f = await frames(page);
  ok('A a stale bake costs one step, and only one', f.length === 2 && f[0] === 'dark' && f[1] === 'light', f.join(' -> '));
  ok('A and the store still wins', await shade(page) === 'light', await shade(page));
  ok('A no page errors (stale bake)', errors.length === 0, errors.join(';'));
  await b.close();
}

// The row, and choosing through it.
{
  const { b, page, errors } = await open({ system: 'light', store: 'system' });
  await go(page, 'Profile');
  const row = await page.$eval('[aria-label="Edit Appearance"]', (el) => el.innerText.replace(/\n/g, ' | '));
  ok('B the row is there and says what is in force', /Appearance/.test(row) && /System/.test(row), row);
  await page.click('[aria-label="Edit Appearance"]');
  await page.waitForTimeout(400);
  const body = await page.innerText('body');
  ok('B three options', /System/.test(body) && /Light/.test(body) && /Dark/.test(body));
  ok('B and it says what System means', /follows your phone/i.test(body));
  ok('B no Save on a choice screen', (await page.$$('[aria-label^="Save "]')).length === 0);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(700);
  ok('B choosing Dark takes effect at once', await shade(page) === 'dark', await shade(page));
  ok('B and is written down as a preference, not a colour',
    await page.evaluate(() => (window.__db.docs['meta/prefs']||{}).theme) === 'dark',
    await page.evaluate(() => JSON.stringify(window.__db.docs['meta/prefs'])));
  const row2 = await page.$eval('[aria-label="Edit Appearance"]', (el) => el.innerText.replace(/\n/g, ' | '));
  ok('B the row follows', /Dark/.test(row2), row2);
  ok('B no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

// An override outlives a reopen, and System survives a wiped device copy.
{
  const { b, page, errors } = await open({ system: 'light', store: 'system', device: 'system' });
  ok('C system on a light phone, storage intact: one frame', (await frames(page)).length === 1, (await frames(page)).join(' -> '));
  await b.close();
}
{
  // Safari threw the device copy away; the store still says follow the phone.
  const { b, page, errors } = await open({ system: 'dark', store: 'system', device: null });
  ok('C storage gone, System, dark phone: still one frame and dark',
    (await frames(page)).length === 1 && (await shade(page)) === 'dark',
    (await frames(page)).join(' -> ') + ' / ' + (await shade(page)));
  ok('C no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

// The header button still works, and now means "override".
{
  const { b, page, errors } = await open({ system: 'light', store: 'system' });
  await page.click('header button:has(svg)');
  await page.waitForTimeout(800);
  ok('D the moon still flips it in one tap', await shade(page) === 'dark', await shade(page));
  ok('D and records an override rather than System',
    await page.evaluate(() => (window.__db.docs['meta/prefs']||{}).theme) === 'dark',
    await page.evaluate(() => JSON.stringify(window.__db.docs['meta/prefs'])));
  ok('D no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'APPEARANCE SUITE FAILED':'APPEARANCE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
