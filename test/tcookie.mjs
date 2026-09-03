// If the device copy is the thing failing, something else has to carry the
// theme alone. It is not a cookie — that was tried, and measured failing on the
// lifter's phone. It is the store, and the page the store gets baked into.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageFor } from './bake.mjs';
// The store here says dark, so the page under test is one published while it
// said dark. Serving a light-baked page would make this a stale-bake test
// wearing a storage-loss test's name.
const URL = pageFor('dark', 'cookie');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

const launch = async (breakLocalStorage) => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820},
    deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme:'light' });
  await ctx.clock.install({ time: new Date('2026-09-02T18:00:00+04:00') });
  const page = await ctx.newPage();
  await page.addInitScript((breakIt) => {
    window.__f = [];
    const tick = () => { try {
      const m = getComputedStyle(document.documentElement).backgroundColor.match(/\d+/);
      const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
      if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
    } catch (e) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    if (breakIt) {
      // A device that keeps everything except the theme — the phone's actual
      // behaviour, whatever the cause.
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'theme') return;
        return real.call(this, k, v);
      };
    }
  }, breakLocalStorage);
  await page.addInitScript(stub(), [false, {
    'meta/prefs': { theme:'dark', updatedAt:'x' },
    'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173', updatedAt:'x' },
    'sessions/2026-08-30': { date:'2026-08-30', slots:{ 'Push-A': { 'Incline Dumbbell Press': { sets:[{w:'10',r:'10'}] } } }, updatedAt:'x' },
  }, false]);
  return { b, page };
};

for (const [label, broken] of [['localStorage working', false], ['localStorage silently dropping theme', true]]) {
  const { b, page } = await launch(broken);
  await page.goto(URL, { waitUntil:'commit' });
  // The cookie used to be the answer here. It never was on the phone: Safari
  // blocks a cross-origin frame's cookies outright, which the lifter's own
  // boot report showed as cookie:null immediately after a write. What carries
  // the theme now is the store, which is durable whatever the device drops,
  // and the page, which is what the next publish bakes that store value into.
  // Wait for the write rather than for a stopwatch. A fixed delay made this
  // suite fail once in four runs, which is a racy test and not a racy app —
  // though it is worth knowing the same race exists on a phone, where the
  // store answers at 2.7s: close the app before that and nothing is learned.
  await page.waitForFunction(() => (window.__db?.docs?.['meta/prefs'] || {}).theme === 'dark', null, { timeout: 15000 }).catch(() => {});
  const stored = await page.evaluate(() => JSON.stringify(window.__db.docs['meta/prefs'] || null));
  ok(`${label}: the store carries the answer`, /"theme":"dark"/.test(stored), stored || '(none)');
  // And nothing is left leaning on a cookie, on any path.
  ok(`${label}: nothing is written to a cookie`, !/apptheme/.test(await page.evaluate(() => document.cookie)),
    await page.evaluate(() => document.cookie) || '(none)');
  await page.reload({ waitUntil:'commit' });
  await page.waitForTimeout(3000);
  const frames = await page.evaluate(() => window.__f);
  ok(`${label}: the second open paints dark at once`, frames.length === 1 && frames[0] === 'dark', 'frames ' + frames.join(' -> '));
  await b.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'STORAGE-LOSS SUITE FAILED':'STORAGE-LOSS SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
