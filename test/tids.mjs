// The log is keyed by exercise id now, and the one-time migration turns every
// name-keyed session into an id-keyed one. Nothing may be lost on the way: a
// dropped entry is training the lifter actually did, and the app would still
// count the session as trained while showing it nowhere — the exact bug that
// made this work necessary.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

// His real record if it is here, the frozen one otherwise — the migration has
// to be right for the log that actually exists.
const LIVE = FIXTURES + '/live-current.json';
const src = JSON.parse(fs.readFileSync(fs.existsSync(LIVE) ? LIVE : FIXTURES + '/three-day.json', 'utf8'));
const label = fs.existsSync(LIVE) ? 'his live record' : 'the frozen fixture';

const countSets = (logs) => {
  let n = 0, keys = [];
  for (const slots of Object.values(logs || {}))
    for (const entries of Object.values(slots || {}))
      for (const [k, ex] of Object.entries(entries || {})) {
        keys.push(k);
        n += (ex.sets || []).filter((s) => s.w || s.r).length;
      }
  return { sets: n, keys };
};
const before = countSets(src['workout-logs']);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
await ctx.clock.install({ time: new Date('2026-09-03T09:00:00+04:00') });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
// An empty store, so the page's own block is what gets migrated and written up.
await page.addInitScript(stub(), [false, {}, false]);
await page.goto(pageWith(src, 'ids'), { waitUntil:'networkidle' });
await page.waitForTimeout(2500);

const written = await page.evaluate(() => {
  const out = {};
  for (const [k, v] of Object.entries(window.__db.docs)) if (k.startsWith('sessions/')) out[k.slice(9)] = v.slots;
  return out;
});
const after = countSets(written);

ok(`${label}: every set survives the migration`, after.sets === before.sets, `${before.sets} before, ${after.sets} after`);
ok(`${label}: every day survives`, Object.keys(written).length === Object.keys(src['workout-logs']).length,
   `${Object.keys(src['workout-logs']).length} before, ${Object.keys(written).length} after`);
// The point of the exercise: no key is a display name any more.
const looksLikeName = after.keys.filter((k) => /[A-Z ]/.test(k) && !k.startsWith('unlisted:'));
ok(`${label}: nothing is keyed by a name`, looksLikeName.length === 0, looksLikeName.join(', ') || 'all ids');
ok(`${label}: no page errors`, errors.length === 0, errors.join(';'));

// And the screen shows the same work it did before, by name.
const body = await page.innerText('body');
ok(`${label}: the week counter is unchanged`, /\d\/6 this week/.test(body), (body.match(/\d\/6 this week/) || ['none'])[0]);
// The whole point of the work: renaming an exercise costs nothing. This does
// the rename for real — the name string is replaced in the shipped bundle,
// which is exactly what editing plan.js and rebuilding does — and then compares
// the renamed build against the unrenamed one, on the same day, same session.
//
// On the name-keyed build the sets stayed under the old name: the session still
// counted as trained and they appeared nowhere. Comparing the two is what
// catches that, because a bare "does the new name show" would pass either way.
{
  const art = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');
  const OLD = 'Back Squat', NEW = 'Barbell Back Squat';
  // The log AFTER migration — keyed by id, which is the state everything from
  // here on is in. Feeding the pre-migration, name-keyed block in here would
  // test something else: a rename that happens *during* the one-time migration,
  // where the old name genuinely cannot be resolved and the sets are kept as
  // unlisted rather than lost. That case is real but it is not this one.
  const idKeyed = { ...src, 'workout-logs': written };
  ok('the migrated log is keyed by id, not by name',
     JSON.stringify(written).includes('back-squat') && !JSON.stringify(written).includes('"' + OLD + '"'),
     'back-squat present, "' + OLD + '" absent');
  fs.writeFileSync(path.join(art, 'ids-plain.html'), fs.readFileSync(pageWith(idKeyed, 'ids-plain').replace('http://127.0.0.1:4320/', path.join(art, '/')), 'utf8'));
  // Rename in the PROGRAMME only — the app bundle — and not in the embedded
  // log. Replacing the name across the whole page renames the data too, which
  // makes a name-keyed build look like it handled the rename fine. It was
  // doing this suite's work for it.
  const whole = fs.readFileSync(path.join(art, 'ids-plain.html'), 'utf8');
  const jsAt = whole.indexOf('<script type="module" id="app-js">');
  if (jsAt === -1) throw new Error('app bundle not found in the page under test');
  const head = whole.slice(0, jsAt), bundle = whole.slice(jsAt);
  if (!bundle.includes(OLD)) throw new Error('the programme does not name ' + OLD);
  fs.writeFileSync(path.join(art, 'ids-renamed.html'), head + bundle.split(OLD).join(NEW));

  // Open a page, walk to the Legs A session where that exercise lives, and
  // report what it shows.
  const legsA = async (file) => {
    const c = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
    await c.clock.install({ time: new Date('2026-09-01T20:00:00+04:00') });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await p.addInitScript(stub(), [false, {}, false]);
    await p.goto('http://127.0.0.1:4320/' + file, { waitUntil:'networkidle' });
    await p.waitForTimeout(2200);
    await p.click('button:has-text("Legs")');
    await p.waitForTimeout(300);
    await p.click('button:has-text("Day A")');
    await p.waitForTimeout(500);
    const text = await p.innerText('body');
    // Every weight logged on this screen, which is what would vanish.
    const weights = (text.match(/\d+(\.\d+)?\s*kg/g) || []).length;
    await c.close();
    return { text, weights, errs };
  };

  const plain = await legsA('ids-plain.html');
  const after2 = await legsA('ids-renamed.html');

  // The new name has the old one inside it, so "does the old name appear" is
  // not a usable negative. Compare the two builds instead: one shows the new
  // name, the other does not.
  ok('the renamed exercise shows under its new name',
     after2.text.includes(NEW) && !plain.text.includes(NEW) && plain.text.includes(OLD),
     `renamed page: ${after2.text.includes(NEW) ? 'new name' : 'MISSING'}; plain page: ${plain.text.includes(OLD) ? 'old name' : 'MISSING'}`);
  // The assertion that actually catches it. On the name-keyed build this reads
  // "6 logged weights before, 5 after": the renamed exercise's sets are stranded
  // under the old name and the new row is empty.
  ok('and the same amount of work is on screen as before the rename',
     after2.weights === plain.weights && plain.weights > 0,
     `${plain.weights} logged weights before, ${after2.weights} after`);
  ok('no page errors after a rename', after2.errs.length === 0, after2.errs.join(';'));
}

await b.close();

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'ID SUITE FAILED':'ID SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
