// The block embedded in the page froze the moment the app stopped republishing
// itself. The store is the record; the block is a snapshot of whenever the page
// was last shipped. Rendering the block first shows the lifter their training as
// it was on that day, for as long as the store takes to answer.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
import fs from 'fs';
import { fileURLToPath as __f } from 'url';
import path0 from 'path';
// Fixtures live beside the suites, not in whatever directory node was
// started from — running the suite must not depend on the cwd.
const FIXTURES = path0.join(path0.dirname(__f(import.meta.url)), 'fixtures');
// A frozen three-day log: this suite counts what the page shows when there is
// no store, and the live record grows every time he trains.
const embeddedFixture = JSON.parse(fs.readFileSync(FIXTURES + '/three-day.json', 'utf8'));
const URL = process.env.TSTALE_URL || pageWith(embeddedFixture, 'stale');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

const embedded = embeddedFixture;
// The store knows about a session the page has never heard of — exactly what
// happens the moment the lifter trains after a publish.
const store = { 'meta/prefs': { theme:'system', updatedAt:'x' },
  'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173', updatedAt:'x' },
  'meta/bodyweight': { entries: embedded['bodyweight-logs'], updatedAt:'x' } };
for (const [date, slots] of Object.entries(embedded['workout-logs'])) {
  store[`sessions/${date}`] = { date, slots, updatedAt: 'x' };
}
store['sessions/2026-09-02'] = {
  date: '2026-09-02',
  slots: { 'Push-B': Object.fromEntries(
    ['Flat Barbell Bench Press','Decline Dumbbell Press','Standing Barbell Press',
     'Cable Crossover (high-to-low)','Rear Delt Fly (cable or DB)','Close-Grip Bench Press',
     'Single-Arm Overhead Tricep Extension'].map((n) => [n, { sets: [{ w: '40', r: '8' }] }])) },
  updatedAt: 'x',
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
await ctx.clock.install({ time: new Date('2026-09-02T20:00:00+04:00') });
const page = await ctx.newPage();
// No device copy: iOS threw it away with the tab.
await page.addInitScript(() => {
  window.__seen = [];
  const tick = () => {
    try {
      const m = document.body && document.body.innerText.match(/(\d)\/6 this week/);
      if (m && m[1] !== window.__seen[window.__seen.length-1]) window.__seen.push(m[1]);
    } catch (e) {}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.addInitScript(stub(), [false, store, false]);
await page.goto(URL, { waitUntil:'commit' });
await page.waitForTimeout(3000);
const seen = await page.evaluate(() => window.__seen);
ok('the week count never shows the page’s frozen copy first',
  seen.length === 1 && seen[0] === '4', 'showed ' + seen.join(' -> ') + ' of 6');
ok('and settles on what the store holds', seen[seen.length-1] === '4', 'ended on ' + seen[seen.length-1]);
await b.close();

// The device copy is current, so it can be painted at once — no waiting.
{
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx2 = await b2.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx2.clock.install({ time: new Date('2026-09-02T20:00:00+04:00') });
  const p2 = await ctx2.newPage();
  const deviceLogs = { ...embedded['workout-logs'], '2026-09-02': store['sessions/2026-09-02'].slots };
  await p2.addInitScript((l) => localStorage.setItem('workout-logs', JSON.stringify(l)), deviceLogs);
  await p2.addInitScript(stub(), [false, store, false]);
  await p2.goto(URL, { waitUntil:'commit' });
  await p2.waitForTimeout(2500);
  const t = await p2.innerText('body');
  ok('a device copy is trusted and shown', /4\/6 this week/.test(t), (t.match(/\d\/6 this week/) || ['none'])[0]);
  await b2.close();
}

// With no store at all the block is exactly what it was written for.
{
  const b3 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx3 = await b3.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx3.clock.install({ time: new Date('2026-09-02T20:00:00+04:00') });
  const p3 = await ctx3.newPage();
  await p3.addInitScript(stub(), [true, {}, false]);  // no db in this view
  await p3.goto(URL, { waitUntil:'commit' });
  await p3.waitForTimeout(4000);
  const t = await p3.innerText('body');
  ok('with no store the page still shows its own copy', /3\/6 this week/.test(t), (t.match(/\d\/6 this week/) || ['none'])[0]);
  ok('and does not hang on a spinner', !/^\s*$/.test(t) && /TRAINING LOG/i.test(t));
  await b3.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'STALE SUITE FAILED':'STALE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
