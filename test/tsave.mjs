// The Save button says which of three things is true, and a screen you walk
// away from does not keep what you half-typed on it.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
// A frozen three-day log. This suite types into today's session and watches
// the Save wake up, so it needs a page where today is untouched — which the
// live record stops being the moment he trains.
import fsF from 'fs';
import { fileURLToPath as __f } from 'url';
import path0 from 'path';
// Fixtures live beside the suites, not in whatever directory node was
// started from — running the suite must not depend on the cwd.
const FIXTURES = path0.join(path0.dirname(__f(import.meta.url)), 'fixtures');
const URL = pageWith(JSON.parse(fsF.readFileSync(FIXTURES + '/three-day.json', 'utf8')), 'save');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

async function open(at = '2026-09-02T09:00:00+04:00') {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx.clock.install({ time: new Date(at) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  page.on('console', m => { if (m.type()==='error' && !/favicon|404/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  await page.addInitScript(stub(), [false, {}, false]);
  await page.goto(URL, { waitUntil:'networkidle' });
  await page.waitForTimeout(1300);
  return { b, page, errors };
}
const go = async (page, l) => { await page.click(`nav button:has-text("${l}")`); await page.waitForTimeout(450); };
const saveBtn = (page) => page.locator('[aria-label^="Save "]').first();
const openFirstEmpty = async (page) => {
  for (const btn of await page.$$('button')) {
    const t = await btn.innerText();
    if (/sets of/.test(t)) { await btn.click(); return; }
  }
};

// ---- the button on a session with nothing in it
{
  const { b, page, errors } = await open();
  const label = await saveBtn(page).innerText();
  ok('A an empty session does not claim a save', !/saved/i.test(label), `button says "${label}"`);
  ok('A it says nothing has been entered', /no sets entered/i.test(label), `button says "${label}"`);
  ok('A and it is not pressable', !(await saveBtn(page).isEnabled()));

  // typing turns it into a real save
  await openFirstEmpty(page);
  await page.waitForTimeout(300);
  const boxes = await page.$$('input[type="number"]');
  await boxes[0].fill('60'); await boxes[1].fill('8');
  await page.waitForTimeout(300);
  ok('A typing makes it a live Save', /save push b/i.test(await saveBtn(page).innerText()), await saveBtn(page).innerText());
  await page.waitForTimeout(1200);
  const after = await saveBtn(page).innerText();
  ok('A and once filed it says Saved', /saved/i.test(after), `button says "${after}"`);
  ok('A no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

// ---- a screen walked away from forgets what was half-typed
{
  const { b, page, errors } = await open();
  await go(page, 'Stats');
  ok('B weight opens on the record', await page.inputValue('#stats-weight') === '69');
  // File one for today first, so "unchanged" is a state that can exist.
  await page.fill('#stats-weight', '70');
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Save weight"]').click();
  await page.waitForTimeout(800);
  ok('B once filed for today its Save locks', !(await page.locator('[aria-label="Save weight"]').isEnabled()));

  await page.fill('#stats-weight', '77');
  await page.waitForTimeout(200);
  ok('B a change lights its Save', await page.locator('[aria-label="Save weight"]').isEnabled());
  await go(page, 'Home');
  await go(page, 'Stats');
  ok('B coming back restores the recorded weight', await page.inputValue('#stats-weight') === '70',
    'field holds ' + (await page.inputValue('#stats-weight')));
  ok('B and its Save is locked again', !(await page.locator('[aria-label="Save weight"]').isEnabled()));
  // Against the entries, not the whole document: a timestamp ending .770Z
  // makes a substring search for "77" pass for the wrong reason.
  const entries = await page.evaluate(() => (window.__db.docs['meta/bodyweight'] || {}).entries || []);
  ok('B the abandoned value never reached the record',
    !entries.some((e) => String(e.weight) === '77'), JSON.stringify(entries));

  // height: unlocked and half-typed, then abandoned
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.waitForTimeout(250);
  await page.fill('#stats-height', '181');
  await page.waitForTimeout(200);
  await go(page, 'Profile');
  await go(page, 'Stats');
  ok('B height locks itself again on the way back', (await page.$$('#stats-height')).length === 0);
  ok('B and still shows what is on record', /173 cm/.test(await page.innerText('body')));
  ok('B nothing was written', await page.evaluate(() => (window.__db.docs['meta/profile']||{}).heightCm) !== '181',
    await page.evaluate(() => JSON.stringify((window.__db.docs['meta/profile']||{}).heightCm)));
  ok('B no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'SAVE SUITE FAILED':'SAVE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
