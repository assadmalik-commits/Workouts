// The bake is only as fresh as the last publish, and nothing else refreshes it.
// So a preference changed in the app has to rewrite the page, or it disagrees
// with it for ever — which is a step on every open, not one step. Measured on
// the lifter's phone, and reproduced in trecur.mjs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
const art = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
const built = fs.readFileSync(path.join(art, 'current.html'), 'utf8');
// His state exactly: the page baked dark, the store holding dark, a light phone.
const bakeDark = built.replace(/name="app-theme" content="[a-z]+"/, 'name="app-theme" content="dark"');
fs.writeFileSync(path.join(art, 'reb-start.html'), bakeDark);

const docs = () => ({
  'meta/prefs': { theme:'dark', updatedAt:'2026-09-02T08:00:00.000Z' },
  'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173', updatedAt:'x' },
  'sessions/2026-09-01': { date:'2026-09-01', slots:{ 'Legs-A': { 'Back Squat': { sets:[{w:'60',r:'8'}] } } }, updatedAt:'x' },
});

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const newPage = async (file, seedStore) => {
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme:'light' });
  await ctx.clock.install({ time: new Date('2026-09-02T18:40:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  await page.addInitScript(() => {
    window.__f = [];
    const tick = () => { try {
      const m = getComputedStyle(document.documentElement).backgroundColor.match(/\d+/);
      const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
      if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
    } catch (e) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // Safari discards this frame's storage with the tab, and blocks its cookies.
    try { Object.defineProperty(document, 'cookie', { get: () => '', set: () => {}, configurable: true }); } catch (e) {}
  });
  await page.addInitScript(stub(), [false, seedStore, false]);
  await page.goto('http://127.0.0.1:4320/' + file, { waitUntil:'commit' });
  return { ctx, page, errors };
};

// Open on his current page, and switch to Day the way he does.
const { ctx, page, errors } = await newPage('reb-start.html', docs());
await page.waitForTimeout(3500);
await page.click('nav button:has-text("Profile")'); await page.waitForTimeout(500);
await page.click('[aria-label="Edit Appearance"]'); await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Light', exact: true }).click();
await page.waitForTimeout(1500);

ok('the choice takes effect at once', await page.evaluate(() => document.documentElement.dataset.appTheme) === 'light',
  await page.evaluate(() => document.documentElement.dataset.appTheme));
ok('and reaches the store', await page.evaluate(() => (window.__db.docs['meta/prefs']||{}).theme) === 'light',
  await page.evaluate(() => JSON.stringify(window.__db.docs['meta/prefs'])));
// Nothing may republish while he is still looking at the screen he tapped on.
// A publish reloads the view, and a reload a second after the tap is a flicker
// — which is the complaint that produced this test.
ok('nothing republishes under his finger', await page.evaluate(() => window.__calls.publishes) === 0,
  'publishes ' + await page.evaluate(() => window.__calls.publishes));
// He leaves. Backgrounding the app is when the page gets rewritten.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1200);
const published = await page.evaluate(() => window.__calls.published || null);
ok('the page is rewritten on the way out', Boolean(published), published ? 'published' : 'nothing published');
ok('and the rewritten page is baked light',
  Boolean(published) && /name="app-theme" content="light"/.test(published),
  published ? (published.match(/name="app-theme" content="[a-z]+"/) || ['(no bake)'])[0] : '(nothing)');
ok('the whole record travels with it — the log is not lost',
  Boolean(published) && /2026-09-01/.test(published) && /Back Squat/.test(published),
  Boolean(published) && /2026-09-01/.test(published) ? 'log present' : 'LOG MISSING');
ok('no page errors on the change', errors.length === 0, errors.join(';'));
if (published) fs.writeFileSync(path.join(art, 'reb-after.html'), published);
await ctx.close();

// Now the part that matters: the next open, storage gone, on the page the app
// just published. This is what he sees tomorrow morning.
if (published) {
  for (const open of [1, 2]) {
    const next = await newPage('reb-after.html', { ...docs(), 'meta/prefs': { theme:'light', updatedAt:'x' } });
    await next.page.waitForTimeout(4000);
    const f = await next.page.evaluate(() => window.__f);
    ok(`open ${open} after the change: one frame, light`, f.length === 1 && f[0] === 'light', 'frames ' + f.join(' -> '));
    ok(`open ${open}: nothing republishes on a plain open`, await next.page.evaluate(() => window.__calls.publishes) === 0,
      'publishes ' + await next.page.evaluate(() => window.__calls.publishes));
    ok(`open ${open}: no page errors`, next.errors.length === 0, next.errors.join(';'));
    await next.ctx.close();
  }
}
await b.close();
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'REBAKE SUITE FAILED':'REBAKE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
