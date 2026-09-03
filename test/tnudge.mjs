// The backup nudge. The log lives in a store the lifter does not own and cannot
// reach; the export is the copy he holds. So the app should say when there
// isn't one — quietly, on the screen that can answer it.
//
// The assertion that matters is the last pair: dismissing the share sheet must
// not reset the clock. A dismissal is an answer, not a backup, and stamping it
// would promise a file that does not exist.
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
const src = JSON.parse(fs.readFileSync(FIXTURES + '/three-day.json', 'utf8'));
const NOW = '2026-09-03T09:00:00+04:00';
const daysAgo = (n) => new Date(new Date(NOW).getTime() - n * 86400000).toISOString();

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const open = async ({ lastExportAt = null, decline = false } = {}) => {
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx.clock.install({ time: new Date(NOW) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  if (decline) await page.addInitScript(() => { window.__declineDownload = true; });
  await page.addInitScript(stub(), [false, {
    'meta/prefs': { theme: 'system', ...(lastExportAt ? { lastExportAt } : {}), updatedAt: 'x' },
    'meta/profile': { name: 'Sample Lifter', dob: '1986-04-22', sex: 'Male', heightCm: '173', updatedAt: 'x' },
    'sessions/2026-09-01': { date: '2026-09-01', slots: { 'Legs-A': { 'back-squat': { sets: [{ w: '60', r: '8' }] } } }, updatedAt: 'x' },
  }, false]);
  await page.goto(pageWith(src, 'nudge'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(500);
  return { ctx, page, errors };
};
const nudge = async (page) => {
  const el = await page.$('[aria-label="Export reminder"]');
  return el ? (await el.innerText()).trim() : null;
};

{
  const { ctx, page, errors } = await open();
  ok('never exported: the line is there and says so', /never been backed up/i.test(await nudge(page) || ''), await nudge(page));
  ok('never exported: no page errors', errors.length === 0, errors.join(';'));
  await ctx.close();
}
{
  const { ctx, page } = await open({ lastExportAt: daysAgo(5) });
  ok('backed up 5 days ago: nothing is said', (await nudge(page)) === null, await nudge(page));
  await ctx.close();
}
{
  const { ctx, page } = await open({ lastExportAt: daysAgo(40) });
  ok('backed up 40 days ago: the line returns with the number', /40 days ago/.test(await nudge(page) || ''), await nudge(page));
  await ctx.close();
}
// A real export answers it, and the answer is written down where the next open
// will find it.
{
  const { ctx, page } = await open();
  await page.click('[aria-label="Export log"]');
  await page.waitForTimeout(1200);
  ok('exporting clears the line', (await nudge(page)) === null, await nudge(page));
  const stamped = await page.evaluate(() => (window.__db.docs['meta/prefs'] || {}).lastExportAt);
  ok('and the stamp reaches the store', typeof stamped === 'string', String(stamped));
  ok('and the theme is still there beside it',
     await page.evaluate(() => (window.__db.docs['meta/prefs'] || {}).theme) === 'system',
     await page.evaluate(() => JSON.stringify(window.__db.docs['meta/prefs'])));
  const body = await page.evaluate(() => window.__calls.downloadBody);
  ok('the file carries the preference, not the resolved colour', /"theme": "system"/.test(body || ''),
     (String(body).match(/"theme": "[a-z]+"/) || ['none'])[0]);
  await ctx.close();
}
// And a dismissal does not.
{
  const { ctx, page } = await open({ decline: true });
  await page.click('[aria-label="Export log"]');
  await page.waitForTimeout(1200);
  ok('dismissing the sheet leaves the line up', /never been backed up/i.test(await nudge(page) || ''), await nudge(page));
  ok('and writes no stamp', await page.evaluate(() => (window.__db.docs['meta/prefs'] || {}).lastExportAt) === undefined,
     String(await page.evaluate(() => (window.__db.docs['meta/prefs'] || {}).lastExportAt)));
  ok('and does not report a failure', !/could not be saved/i.test(await page.innerText('body')));
  await ctx.close();
}
await b.close();
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'NUDGE SUITE FAILED':'NUDGE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
