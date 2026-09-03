import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
import fs from 'fs';
import { fileURLToPath as __f } from 'url';
import path0 from 'path';
// Fixtures live beside the suites, not in whatever directory node was
// started from — running the suite must not depend on the cwd.
const FIXTURES = path0.join(path0.dirname(__f(import.meta.url)), 'fixtures');

// This suite counts what migrates out of the page: three sessions and one
// weigh-in. current.html carries the live record, so the day he weighed in
// again the counts stopped matching and the suite reported a migration bug
// that was really a fixture that had moved. The block is part of the scenario.
const URL = pageWith(JSON.parse(fs.readFileSync(FIXTURES + '/three-day.json', 'utf8')), 'db');
const AT = '2026-09-02T09:00:00+04:00';
const checks = [];
const ok = (n, c, e = '') => checks.push([c ? 'PASS' : 'FAIL', n, e]);

async function open({ noDb = false, seedDocs = {}, fail = false, keepStorage = null } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Dubai', locale: 'en-GB',
    viewport: { width: 440, height: 820 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await ctx.clock.install({ time: new Date(AT) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    // The test server has no favicon and the artifact host does, so its 404 is
    // the harness talking about itself, not the app.
    if (m.type() === 'error' && !/favicon/.test(m.text()) && !/404/.test(m.text()))
      errors.push('CONSOLE: ' + m.text());
  });
  if (keepStorage) await page.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, keepStorage);
  await page.addInitScript(stub(), [noDb, seedDocs, fail]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  return { browser, page, errors };
}

const docs = (page) => page.evaluate(() => Object.keys(window.__db.docs).sort());
// The first exercise NOTHING has been logged against — a finished one shows
// what was lifted instead of its target, so this deliberately skips those.
const openFirstEmptyExercise = async (page) => {
  for (const btn of await page.$$('button')) {
    const t = await btn.innerText();
    if (/sets of/.test(t)) { await btn.click(); return t.split('\n')[1]; }
  }
  return null;
};
const calls = (page) => page.evaluate(() => window.__calls);
const today = '2026-09-02';

// ---- A. first run against an empty store: the page's log moves into it
{
  const { browser, page, errors } = await open();
  const d = await docs(page);
  ok('A migrates every training day', ['sessions/2026-08-30','sessions/2026-08-31','sessions/2026-09-01'].every((p) => d.includes(p)), d.join(','));
  ok('A migrates the profile', d.includes('meta/profile'));
  ok('A migrates the photo to its own document', d.includes('meta/photo'));
  ok('A migrates the weights', d.includes('meta/bodyweight'));
  ok('A migrates the theme', d.includes('meta/prefs'));
  const bodies = await page.evaluate(() => ({
    profile: window.__db.docs['meta/profile'],
    photoLen: (window.__db.docs['meta/photo'] || {}).photo?.length || 0,
    session: window.__db.docs['sessions/2026-08-30'],
    bw: window.__db.docs['meta/bodyweight'],
  }));
  ok('A keeps the photo out of the profile document', !('photo' in bodies.profile), JSON.stringify(Object.keys(bodies.profile)));
  ok('A the photo really travelled', bodies.photoLen > 30000, 'photo chars ' + bodies.photoLen);
  ok('A profile document under the 256KiB cap', JSON.stringify(bodies.profile).length < 262144);
  ok('A photo document under the 256KiB cap', bodies.photoLen < 262144, 'bytes ' + bodies.photoLen);
  ok('A session carries its date and slots', bodies.session?.date === '2026-08-30' && !!bodies.session?.slots?.['Push-A']);
  ok('A session records when it was written', typeof bodies.session?.updatedAt === 'string');
  ok('A weights survived', JSON.stringify(bodies.bw?.entries) === JSON.stringify([{ date: '2026-09-01', weight: '69' }]), JSON.stringify(bodies.bw));
  const c = await calls(page);
  ok('A migration did not republish the page', c.publishes === 0, 'publishes ' + c.publishes);
  ok('A no page errors', errors.length === 0, errors.join(';'));
  await browser.close();
}

// ---- B. an edit writes one day, and never republishes
{
  const { browser, page, errors } = await open();
  await page.evaluate(() => { window.__calls.writes = []; });
  await openFirstEmptyExercise(page);
  await page.waitForTimeout(300);
  const boxes = await page.$$('input[type="number"]');
  await boxes[0].fill('42');
  await boxes[1].fill('7');
  await page.waitForTimeout(1200);
  const c = await calls(page);
  const sessionWrites = c.writes.filter((w) => w.startsWith('sessions/'));
  ok('B the edit reached the store', sessionWrites.length > 0, c.writes.join(','));
  ok('B only the day edited was written', sessionWrites.every((w) => w === `sessions/${today}`), sessionWrites.join(','));
  ok('B untouched days were not rewritten', !c.writes.includes('sessions/2026-08-30'), c.writes.join(','));
  ok('B typing did not republish', c.publishes === 0, 'publishes ' + c.publishes);
  const saveBtn = await page.$('[aria-label^="Save "]');
  ok('B the button says the record is filed', !!saveBtn && !(await saveBtn.isEnabled()), 'enabled ' + (saveBtn ? await saveBtn.isEnabled() : 'no button'));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(600);
  const c2 = await calls(page);
  ok('B closing the page did not republish either', c2.publishes === 0, 'publishes ' + c2.publishes);
  ok('B nothing left outstanding', await page.evaluate(() => localStorage.getItem('db-pending')) === '[]', await page.evaluate(() => localStorage.getItem('db-pending')));
  ok('B no page errors', errors.length === 0, errors.join(';'));
  await browser.close();
}

// ---- C. with no store, the old publishing behaviour is untouched
{
  const { browser, page, errors } = await open({ noDb: true });
  const d = await page.evaluate(() => Object.keys(window.__db.docs));
  ok('C nothing written to a store that is not there', d.length === 0, d.join(','));
  await openFirstEmptyExercise(page);
  await page.waitForTimeout(300);
  const boxes = await page.$$('input[type="number"]');
  await boxes[0].fill('42');
  await boxes[1].fill('7');
  await page.waitForTimeout(1000);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(500);
  const c = await calls(page);
  ok('C the page still publishes itself as the fallback', c.publishes >= 1, 'publishes ' + c.publishes);
  ok('C no page errors', errors.length === 0, errors.join(';'));
  await browser.close();
}

// ---- D. what the store holds is the record
{
  const seed = {
    'sessions/2026-08-30': { date: '2026-08-30', slots: { 'Push-A': { 'Incline Dumbbell Press': { sets: [{ w: '99', r: '3' }] } } }, updatedAt: '2026-08-30T10:00:00Z' },
    'meta/profile': { name: 'From The Store', dob: '1986-04-22', sex: 'Male', heightCm: '173', updatedAt: '2026-09-01T10:00:00Z' },
    'meta/bodyweight': { entries: [{ date: '2026-09-01', weight: '71' }], updatedAt: '2026-09-01T10:00:00Z' },
  };
  const { browser, page, errors } = await open({ seedDocs: seed });
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(400);
  // Profile is rows now, and the weight lives on Stats beside its BMI.
  const rows = await page.$$eval('[aria-label^="Edit "]', (bs) => bs.map((b) => b.innerText.replace(/\n/g, ' | ')));
  ok('D the store’s profile wins over the page’s', rows.some((r) => /From The Store/.test(r)), JSON.stringify(rows));
  await page.click('nav button:has-text("Stats")');
  await page.waitForTimeout(400);
  const shownWeight = await page.inputValue('#stats-weight');
  ok('D the store’s weight wins too', shownWeight === '71', 'field holds ' + shownWeight);
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(400);
  const photo = await page.$eval('img', (i) => i.src.slice(0, 22));
  ok('D the photo survives a profile the store had no photo for', photo.startsWith('data:image'), photo);
  ok('D no page errors', errors.length === 0, errors.join(';'));
  await browser.close();
}

// ---- E. trained out of signal: the session is held, and wins on the way back
{
  const { browser, page, errors } = await open({ fail: true });
  await openFirstEmptyExercise(page);
  await page.waitForTimeout(300);
  const boxes = await page.$$('input[type="number"]');
  await boxes[0].fill('55');
  await boxes[1].fill('5');
  await page.waitForTimeout(2200);
  const held = await page.evaluate(() => localStorage.getItem('db-pending'));
  ok('E a session the store refused is held', (held || '').includes(`session:${today}`), String(held));
  const kept = await page.evaluate(() => ({
    logs: localStorage.getItem('workout-logs'),
    pending: localStorage.getItem('db-pending'),
    profile: localStorage.getItem('profile'),
  }));
  ok('E the device kept the session anyway', (kept.logs || '').includes('"55"'), (kept.logs || '').slice(0, 80));
  const c = await calls(page);
  ok('E an unreachable store does not republish instead', c.publishes === 0, 'publishes ' + c.publishes);
  // Out of signal the button is live again, and pressing it is the one path
  // that asks to publish outright — the only place the fallback guard can be
  // caught doing its job.
  const offlineSave = await page.$('[aria-label^="Save "]');
  ok('E the button offers to save while the store is unreachable', !!offlineSave && (await offlineSave.isEnabled()));
  if (offlineSave && (await offlineSave.isEnabled())) {
    await offlineSave.click();
    await page.waitForTimeout(2500);
  }
  const cOffline = await calls(page);
  ok('E pressing Save still does not republish the page', cOffline.publishes === 0, 'publishes ' + cOffline.publishes);
  await browser.close();

  // back in signal, against a store holding an older copy of that same day
  const older = {
    [`sessions/${today}`]: { date: today, slots: { 'Push-B': { 'Incline Dumbbell Press': { sets: [{ w: '1', r: '1' }] } } }, updatedAt: '2026-09-02T05:00:00Z' },
    'meta/profile': { name: 'Sample Lifter', dob: '1986-04-22', sex: 'Male', heightCm: '173', updatedAt: '2026-09-01T10:00:00Z' },
  };
  const back = await open({ seedDocs: older, keepStorage: kept.logs ? { 'workout-logs': kept.logs, 'db-pending': kept.pending, profile: kept.profile } : null });
  const body = await back.page.innerText('body');
  ok('E the held session is what the screen shows',
    /Flat Barbell Bench Press[\s\S]{0,40}55kg/.test(body), body.replace(/\n/g, ' | ').slice(0, 220));
  ok('E the store’s older copy did not come back',
    !body.includes('Incline Dumbbell Press'), body.replace(/\n/g, ' | ').slice(0, 220));
  const after = await back.page.evaluate(() => window.__db.docs[`sessions/2026-09-02`]);
  ok('E and was written up on the way back', JSON.stringify(after?.slots || {}).includes('"55"'), JSON.stringify(after?.slots || {}).slice(0, 120));
  ok('E nothing left held afterwards', await back.page.evaluate(() => localStorage.getItem('db-pending')) === '[]', await back.page.evaluate(() => localStorage.getItem('db-pending')));
  ok('E no page errors', back.errors.length === 0, back.errors.join(';'));
  await back.browser.close();
}

// ---- F. the log can still be taken out as a file
{
  const { browser, page, errors } = await open();
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(400);
  const btn = await page.$('[aria-label="Export log"]');
  ok('F the export is offered', !!btn);
  await btn.click();
  await page.waitForTimeout(500);
  const c = await calls(page);
  ok('F it offers a json file named for today', c.download === `training-log-${today}.json`, String(c.download));
  let parsed = null;
  try { parsed = JSON.parse(c.downloadBody); } catch (e) { /* left null */ }
  ok('F the file is valid json', !!parsed);
  ok('F it carries every session', Object.keys(parsed?.['workout-logs'] || {}).length === 3, JSON.stringify(Object.keys(parsed?.['workout-logs'] || {})));
  ok('F it carries the profile and the photo', !!parsed?.profile?.name && (parsed?.profile?.photo || '').length > 30000);
  ok('F it carries the weights', (parsed?.['bodyweight-logs'] || []).length === 1);
  ok('F no page errors', errors.length === 0, errors.join(';'));
  await browser.close();
}

for (const [s, n, e] of checks) console.log(s, '-', n, e ? '  [' + e + ']' : '');
console.log(checks.some((c) => c[0] === 'FAIL') ? 'DB SUITE FAILED' : 'DB SUITE GREEN (' + checks.length + ')');
process.exit(checks.some((c) => c[0] === 'FAIL') ? 1 : 0);
