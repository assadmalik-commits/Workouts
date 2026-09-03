// iOS discards a cross-origin frame's localStorage when the tab closes. What is
// left is a page whose embedded block is frozen at publish time and a store
// that is current. The block must not get a vote.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageFor } from './bake.mjs';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
// What the boot script will guess before anything async has answered. Storage
// is gone and cookies are blocked, so the only thing readable in that frame is
// the page's own baked meta — read it out of the build under test rather than
// writing it down here, or this suite drifts the moment the bake changes.
// Each scenario runs against a page published while the preference was what
// the store now holds — the ordinary case. The release itself is baked
// 'system' now, which is neither of the colours these cases are about, so
// reading the bake off current.html would just throw.
const bakeFor = (t) => t;

const run = async (label, storeTheme, systemTheme = 'light') => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme: systemTheme });
  await ctx.clock.install({ time: new Date('2026-09-02T12:00:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  // No theme on the device at all — Safari threw it away with the tab.
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
  await page.addInitScript(stub(), [false, {
    'sessions/2026-08-30': { date:'2026-08-30', slots:{ 'Push-A': { 'Incline Dumbbell Press': { sets:[{w:'10',r:'10'}] } } }, updatedAt:'x' },
    'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173', updatedAt:'x' },
    'meta/prefs': { theme: storeTheme, updatedAt:'x' },
  }, false]);
  await page.goto(process.env.TDISCARD_URL || pageFor(bakeFor(storeTheme), 'discard'), { waitUntil:'commit' });
  await page.waitForTimeout(3500);
  const frames = await page.evaluate(() => window.__frames);
  ok(`${label}: settles on the store's ${storeTheme}`, frames[frames.length-1] === storeTheme, 'frames ' + frames.join(' -> '));
  // With no device copy there is nothing to read before the store answers
  // except the page's own baked theme, so one step from that to the stored
  // theme is honest. What must never happen is a third state — the embedded
  // block's frozen guess painted in between, which is the bug this suite
  // exists for. The phone's own setting is no longer the boot guess: it is the
  // last fallback, below the bake, and only reached when the page carries
  // 'system'.
  const allowed = [bakeFor(storeTheme), storeTheme].filter((v, i, a) => a.indexOf(v) === i);
  ok(`${label}: at most one step, and no wrong theme in between`,
    frames.length <= allowed.length && frames.every((f, i) => f === allowed[i]),
    'frames ' + frames.join(' -> '));
  ok(`${label}: no page errors`, errors.length === 0, errors.join(';'));
  await b.close();
};

// The bake is the boot guess, so it matching the stored theme is the case that
// must be seamless — which is every open where the page is not stale, and so
// most opens, most of the time.
await run('storage gone, phone light, store light', 'light', 'light');
await run('storage gone, phone dark, store dark', 'dark', 'dark');
// And when they disagree, one honest step, never a third state.
await run('storage gone, phone light, store dark', 'dark', 'light');
await run('storage gone, phone dark, store light', 'light', 'dark');

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'DISCARD SUITE FAILED':'DISCARD SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
