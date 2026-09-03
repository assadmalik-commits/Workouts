// His phone, exactly as the boot report describes it: no storage that survives,
// cookies blocked, phone set to light, preference dark, store answering at 3.2s.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import fs from 'fs';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
// The build under test, wrapped the way the host wraps it — never a
// version-numbered file. Pinning a suite to one is how tdb spent four versions
// asserting things about code that had already been replaced, and how repro2
// and repro3 went on testing publish-on-save for twelve versions after it was
// removed. Those two are gone; this one reads what the build just wrote.
import path from 'path';
import { fileURLToPath } from 'url';
const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'art', 'current.html'), 'utf8')
  // This scenario is a dark preference on a light phone, so the page it runs
  // against is one published while the preference was dark.
  .replace(/name="app-theme" content="[a-z]+"/, 'name="app-theme" content="dark"');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ timezoneId:'Asia/Dubai', viewport:{width:440,height:820}, deviceScaleFactor:3,
  isMobile:true, hasTouch:true, colorScheme:'light' });   // his phone is light
const page = await ctx.newPage();
await page.addInitScript(() => {
  // Nothing survives a close, and cookies do not exist here.
  try { localStorage.clear(); } catch (e) {}
  Object.defineProperty(document, 'cookie', { get: () => '', set: () => {}, configurable: true });
  window.__f = [];
  const tick = () => { try {
    const el = document.body || document.documentElement;
    const m = getComputedStyle(el).backgroundColor.match(/\d+/);
    const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
    if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
  } catch (e) {} requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
// A store that takes 3.2 seconds, like his.
await page.addInitScript(stub(), [false, { 'meta/prefs': { theme:'dark', updatedAt:'x' },
  'meta/profile': { name:'Sample Lifter', dob:'1986-04-22', sex:'Male', heightCm:'173', updatedAt:'x' },
  'sessions/2026-08-30': { date:'2026-08-30', slots:{ 'Push-A': { 'Incline Dumbbell Press': { sets:[{w:'10',r:'10'}] } } }, updatedAt:'x' } }, false]);
await page.route('**/hosted.html', (route) => route.fulfill({ contentType:'text/html', body:
  '<!doctype html><html><head><meta charset=utf8><style>:root{color-scheme:light}body{margin:0;background:#faf9f5;color:#141413}</style></head><body>\n' + html + '\n</body></html>' }));
await page.goto('http://127.0.0.1:4320/hosted.html', { waitUntil:'commit' });
await page.waitForTimeout(5000);
const frames = await page.evaluate(() => window.__f);
const trace = await page.evaluate(() => JSON.stringify(window.__trace || []));
ok('every frame is dark, from the first', frames.length === 1 && frames[0] === 'dark', 'frames ' + frames.join(' -> '));
console.log('   trace:', trace);
await b.close();

// The cost of keeping it in the page: if the lifter changes their preference
// and the page has not been republished since, the baked value is stale and
// they get one step until it is. Far smaller than a step on every open, but it
// is a real cost and it should be visible here rather than discovered later.
{
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx2 = await b2.newContext({ timezoneId:'Asia/Dubai', viewport:{width:440,height:820}, deviceScaleFactor:3,
    isMobile:true, hasTouch:true, colorScheme:'light' });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => {
    try { localStorage.clear(); } catch (e) {}
    window.__f = [];
    const tick = () => { try {
      const el = document.body || document.documentElement;
      const m = getComputedStyle(el).backgroundColor.match(/\d+/);
      const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
      if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
    } catch (e) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  // Page says dark; the lifter has since chosen light and the store knows.
  await p2.addInitScript(stub(), [false, { 'meta/prefs': { theme:'light', updatedAt:'x' },
    'meta/profile': { name:'Sample Lifter', dob:'1986-04-22', sex:'Male', heightCm:'173', updatedAt:'x' } }, false]);
  await p2.route('**/hosted.html', (route) => route.fulfill({ contentType:'text/html', body:
    '<!doctype html><html><head><meta charset=utf8><style>body{margin:0;background:#faf9f5}</style></head><body>\n' + html + '\n</body></html>' }));
  await p2.goto('http://127.0.0.1:4320/hosted.html', { waitUntil:'commit' });
  await p2.waitForTimeout(4000);
  const f = await p2.evaluate(() => window.__f);
  ok('a stale baked value costs one step, and only one', f.join(' -> ') === 'dark -> light', 'frames ' + f.join(' -> '));
  await b2.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'PAGE SUITE FAILED':'PAGE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
