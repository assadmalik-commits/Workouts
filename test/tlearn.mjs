// The device has to learn what the store knows, or every open pays the store's
// latency again. His report: logs present, theme null, store "dark", 2.7s.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageFor } from './bake.mjs';
// This scenario's store says dark, so it runs against a page published while
// the preference was dark — the ordinary case. A bake that disagrees is the
// stale case, and tappearance owns it.
const URL = process.env.TLEARN_URL || pageFor('dark', 'learn');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
// His phone is set to light; his preference, held only in the store, is dark.
const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820},
  deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme: 'light' });
await ctx.clock.install({ time: new Date('2026-09-02T17:30:00+04:00') });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
// Logs on the device, no theme — exactly what the report showed.
await page.addInitScript(() => {
  localStorage.setItem('workout-logs', JSON.stringify({
    '2026-08-30': { 'Push-A': { 'Incline Dumbbell Press': { sets: [{ w:'10', r:'10' }] } } },
  }));
  window.__f = [];
  const tick = () => { try {
    const m = getComputedStyle(document.documentElement).backgroundColor.match(/\d+/);
    const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
    if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
  } catch (e) {} requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.addInitScript(stub(), [false, {
  'meta/prefs': { theme:'dark', updatedAt:'x' },
  'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173', updatedAt:'x' },
  'sessions/2026-08-30': { date:'2026-08-30', slots:{ 'Push-A': { 'Incline Dumbbell Press': { sets:[{w:'10',r:'10'}] } } }, updatedAt:'x' },
}, false]);

await page.goto(URL, { waitUntil:'commit' });
await page.waitForTimeout(3000);
// The page itself now carries the preference, so even a first open on a
// device that has never seen the app paints it correctly.
ok('the first open no longer steps either',
  (await page.evaluate(() => window.__f)).join(' -> ') === 'dark',
  (await page.evaluate(() => window.__f)).join(' -> '));
const learned = await page.evaluate(() => localStorage.getItem('theme'));
ok('but the device has now learned it', learned === '"dark"', 'localStorage theme = ' + learned);

await page.reload({ waitUntil:'commit' });
await page.waitForTimeout(3000);
const frames = await page.evaluate(() => window.__f);
ok('so the next open paints dark straight away', frames.length === 1 && frames[0] === 'dark', 'frames ' + frames.join(' -> '));
ok('no page errors', errors.length === 0, errors.join(';'));
await b.close();

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'LEARN SUITE FAILED':'LEARN SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
