// Reading a log back in. Until there is a backend this is the only way into the
// standalone app, and the only way back after a phone loses its storage.
//
// The assertion that matters is that it MERGES. A file is a copy from some
// earlier moment; this device may hold sessions the file predates. Taking the
// file wholesale would delete training that exists nowhere else — the same
// class of loss the whole store/device merge exists to prevent.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
const three = JSON.parse(fs.readFileSync(FIXTURES + '/three-day.json', 'utf8'));
const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');

const countSets = (logs) => {
  let n = 0;
  for (const slots of Object.values(logs || {}))
    for (const entries of Object.values(slots || {}))
      for (const ex of Object.values(entries || {})) n += (ex.sets || []).filter((s) => s.w || s.r).length;
  return n;
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const run = async (label, { onDevice, inFile }) => {
  const file = path.join(tmp, 'import-' + label.replace(/\W+/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(inFile));
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx.clock.install({ time: new Date('2026-09-03T09:00:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const docs = { 'meta/prefs': { theme: 'system', updatedAt: 'x' } };
  for (const [d, slots] of Object.entries(onDevice)) docs['sessions/' + d] = { date: d, slots, updatedAt: 'x' };
  await page.addInitScript(stub(), [false, docs, false]);
  await page.goto(pageWith({ 'workout-logs': {}, 'bodyweight-logs': [], profile: three.profile, theme: 'system' }, 'imp'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(400);
  await page.setInputFiles('[aria-label="Import log"] input[type=file]', file);
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => {
    const out = {};
    for (const [k, v] of Object.entries(window.__db.docs)) if (k.startsWith('sessions/')) out[k.slice(9)] = v.slots;
    return out;
  });
  const said = await page.$('[aria-label="Import result"]');
  const message = said ? (await said.innerText()).trim() : null;
  await ctx.close();
  return { after, message, errors };
};

// A file holding a day this device has never seen.
{
  const onDevice = { '2026-09-01': three['workout-logs']['2026-09-01'] };
  const r = await run('new day', { onDevice, inFile: three });
  ok('a day only in the file is taken', Boolean(r.after['2026-08-30']), Object.keys(r.after).sort().join(', '));
  ok('and the day already here is kept', Boolean(r.after['2026-09-01']), Object.keys(r.after).sort().join(', '));
  ok('every set from both sides is on record', countSets(r.after) === countSets(three['workout-logs']),
     `${countSets(three['workout-logs'])} expected, ${countSets(r.after)} stored`);
  ok('and it says what it did', /Added \d+ sets?/.test(r.message || ''), r.message);
  ok('no page errors', r.errors.length === 0, r.errors.join(';'));
}

// THE ONE THAT MATTERS. The device holds a session the file has never seen —
// trained after that backup was taken. Importing must not delete it.
{
  const extra = { '2026-09-02': { 'Push-B': { 'flat-barbell-bench-press': { sets: [{ w: '80', r: '5' }, { w: '85', r: '4' }] } } } };
  const onDevice = { ...three['workout-logs'], ...extra };
  const r = await run('older file', { onDevice, inFile: three });
  ok('a session the file predates is NOT deleted', Boolean(r.after['2026-09-02']), Object.keys(r.after).sort().join(', '));
  ok('and its sets are intact', countSets({ x: r.after['2026-09-02'] }) === 2,
     JSON.stringify(r.after['2026-09-02'] || null).slice(0, 80));
  ok('nothing else was lost either', countSets(r.after) === countSets(onDevice),
     `${countSets(onDevice)} before, ${countSets(r.after)} after`);
  ok('and it says it added nothing', /nothing this device did not already have/.test(r.message || ''), r.message);
  ok('no page errors', r.errors.length === 0, r.errors.join(';'));
}

// A file that is not a log at all.
{
  const r = await run('rubbish', { onDevice: three['workout-logs'], inFile: { hello: 'world' } });
  ok('a file with no log in it changes nothing', countSets(r.after) === countSets(three['workout-logs']),
     `${countSets(three['workout-logs'])} before, ${countSets(r.after)} after`);
  ok('no page errors on a bad file', r.errors.length === 0, r.errors.join(';'));
}

await b.close();
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'IMPORT SUITE FAILED':'IMPORT SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
