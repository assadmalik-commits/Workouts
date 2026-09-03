// Profile is who you are; Stats is what you measure.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageWith } from './bake.mjs';
import fs from 'fs';
import { fileURLToPath as __f } from 'url';
import path0 from 'path';
// Fixtures live beside the suites, not in whatever directory node was
// started from — running the suite must not depend on the cwd.
const FIXTURES = path0.join(path0.dirname(__f(import.meta.url)), 'fixtures');
// This suite describes a lifter who has not filled in an email or a mobile and
// has not weighed in today. current.html carries the real record, so once he
// added those the suite was asserting against a page that contradicted it —
// and the assertions that mattered most were the ones that stopped being true.
const URL = pageWith({
  'workout-logs': {},
  'bodyweight-logs': [{ date: '2026-09-01', weight: '69' }],
  // A photo of realistic size and format, from the committed fixture. The
  // lifter's own is deliberately not in this repository.
  profile: { name: 'Sample Lifter', dob: '1986-04-22', sex: 'Male', heightCm: '173',
             photo: JSON.parse(fs.readFileSync(FIXTURES + '/three-day.json', 'utf8')).profile.photo },
  theme: 'light',
}, 'profile2');
const AT = '2026-09-02T09:00:00+04:00';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

async function open(seedDocs = {}) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx.clock.install({ time: new Date(AT) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/favicon|404/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  await page.addInitScript(stub(), [false, seedDocs, false]);
  await page.goto(URL, { waitUntil:'networkidle' });
  await page.waitForTimeout(1300);
  return { b, page, errors };
}
const go = async (page, label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(400); };
// Identity only. Appearance is a setting for this device and sits in a card of
// its own, even though it opens through the same kind of row.
const rows = (page) => page.$$eval('[aria-label^="Edit "]', (bs) =>
  bs.map((b) => b.innerText.replace(/\n/g, ' | ')).filter((t) => !/^Appearance/.test(t)));

// ---- Profile is a record, not a form
{
  const { b, page, errors } = await open();
  await go(page, 'Profile');
  const r = await rows(page);
  ok('P five identity rows', r.length === 5, JSON.stringify(r));
  ok('P rows are the identity fields', /Name/.test(r[0]) && /Email/.test(r[1]) && /Mobile/.test(r[2]) && /Date of birth/.test(r[3]) && /Gender/.test(r[4]), JSON.stringify(r));
  ok('P name shows its value', /Sample Lifter/.test(r[0]), r[0]);
  ok('P empty fields read Not set', /Not set/.test(r[1]) && /Not set/.test(r[2]), r[1]+' // '+r[2]);
  ok('P date of birth shows the age', /40/.test(r[3]), r[3]);
  const body = await page.innerText('body');
  ok('P appearance is offered, apart from identity', /Appearance/.test(body));
  ok('P no weight field on profile', !/Weight/i.test(body), body.replace(/\n/g,' | ').slice(0,200));
  ok('P no height field on profile', !/Height/i.test(body));
  ok('P no green save slab', !/Save profile/i.test(body));
  ok('P the photo is still a card', await page.$eval('img', i => i.getBoundingClientRect().width) >= 60, 'avatar px');
  ok('P export still offered', !!(await page.$('[aria-label="Export log"]')));
  ok('P no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

// ---- An edit screen: locked Save, tick, return key, discard on back
{
  const { b, page, errors } = await open();
  await go(page, 'Profile');
  await page.click('[aria-label="Edit Name"]');
  await page.waitForTimeout(400);
  const saveBtn = await page.$('[aria-label="Save Name"]');
  ok('E Save is present', !!saveBtn);
  ok('E Save is locked before any change', !(await saveBtn.isEnabled()));
  ok('E the bottom bar is gone while editing', (await page.$$('.app-nav')).length === 0);
  ok('E the field is prefilled', await page.inputValue('#field-input') === 'Sample Lifter');
  ok('E no tick before a change', (await page.$$('[aria-label="Ready to save"]')).length === 0);
  await page.fill('#field-input', 'Assad M');
  await page.waitForTimeout(200);
  ok('E tick appears once changed and valid', (await page.$$('[aria-label="Ready to save"]')).length === 1);
  ok('E Save unlocks', await (await page.$('[aria-label="Save Name"]')).isEnabled());
  await page.fill('#field-input', '');
  await page.waitForTimeout(200);
  ok('E an empty name locks Save again', !(await (await page.$('[aria-label="Save Name"]')).isEnabled()));
  ok('E and says why', /cannot be empty/i.test(await page.innerText('body')));
  // back discards
  await page.fill('#field-input', 'Discarded');
  await page.waitForTimeout(200);
  await page.click('[aria-label="Back"]');
  await page.waitForTimeout(400);
  ok('E back discards the edit', /Sample Lifter/.test((await rows(page))[0]), (await rows(page))[0]);
  ok('E and the bar comes back', (await page.$$('.app-nav')).length === 1);
  ok('E the capsule is measured again', (await page.$$('.app-capsule')).length === 1);
  // return key commits
  await page.click('[aria-label="Edit Name"]');
  await page.waitForTimeout(300);
  await page.fill('#field-input', 'Sample Lifter Jr');
  await page.press('#field-input', 'Enter');
  await page.waitForTimeout(400);
  ok('E return commits and returns', /Sample Lifter Jr/.test((await rows(page))[0]), (await rows(page))[0]);
  ok('E no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

// ---- Validation per field
{
  const { b, page, errors } = await open();
  await go(page, 'Profile');
  const cases = [
    ['Email', 'notanemail', false], ['Email', 'a@b.co', true],
    ['Mobile number', 'abc', false], ['Mobile number', '+971 50 123 4567', true],
  ];
  for (const [label, value, want] of cases) {
    await page.click(`[aria-label="Edit ${label}"]`);
    await page.waitForTimeout(300);
    await page.fill('#field-input', value);
    await page.waitForTimeout(200);
    const live = await (await page.$(`[aria-label="Save ${label}"]`)).isEnabled();
    ok(`V ${label} "${value}" ${want ? 'saves' : 'refused'}`, live === want, 'enabled=' + live);
    await page.click('[aria-label="Back"]');
    await page.waitForTimeout(300);
  }
  ok('V no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

// ---- Gender commits on tap, no Save
{
  const { b, page, errors } = await open();
  await go(page, 'Profile');
  await page.click('[aria-label="Edit Gender"]');
  await page.waitForTimeout(400);
  const body = await page.innerText('body');
  ok('G three options', /Male/.test(body) && /Female/.test(body) && /Prefer not to say/.test(body), body.replace(/\n/g,' | ').slice(0,160));
  ok('G no Save on a choice screen', (await page.$$('[aria-label^="Save "]')).length === 0);
  ok('G says it changes no numbers', /same scale for everyone/i.test(body));
  await page.click('text=Prefer not to say');
  await page.waitForTimeout(500);
  ok('G tapping commits and returns', /Prefer not to say/.test((await rows(page))[4]), (await rows(page))[4]);
  ok('G no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

// ---- Stats owns the measurements
{
  const { b, page, errors } = await open();
  await go(page, 'Stats');
  const body = await page.innerText('body');
  ok('S measurements are on stats', /measurements/i.test(body));  // uppercased by CSS
  ok('S weight is seeded from the record', await page.inputValue('#stats-weight') === '69');
  // Nothing logged today yet and the field shows the last known weight, so
  // pressing Save would file it against today — a real change, so it is live.
  ok('S weight Save is live when today has no entry', await (await page.$('[aria-label="Save weight"]')).isEnabled());
  ok('S height is locked', /Set once/i.test(body), body.replace(/\n/g,' | ').slice(0,300));
  ok('S no height input while locked', (await page.$$('#stats-height')).length === 0);
  await page.fill('#stats-weight', '70.5');
  await page.waitForTimeout(200);
  ok('S weight Save unlocks on a change', await (await page.$('[aria-label="Save weight"]')).isEnabled());
  await page.click('[aria-label="Save weight"]');
  await page.waitForTimeout(900);
  const after = await page.innerText('body');
  ok('S the weight is on record', /70\.5 kg on record for today/.test(after), after.replace(/\n/g,' | ').slice(0,260));
  ok('S BMI moved with it', /23\.6/.test(after), after.replace(/\n/g,' | ').slice(0,200));
  const bwDoc = await page.evaluate(() => JSON.stringify(window.__db.docs['meta/bodyweight'] || null));
  ok('S it reached the store', bwDoc.includes('70.5'), bwDoc);
  ok('S Save locks again after saving', !(await (await page.$('[aria-label="Save weight"]')).isEnabled()));
  // height unlock
  await page.click('text=Change');
  await page.waitForTimeout(300);
  ok('S Change reveals the height field', (await page.$$('#stats-height')).length === 1);
  ok('S height Save locked when unchanged', !(await (await page.$('[aria-label="Save height"]')).isEnabled()));
  await page.fill('#stats-height', '175');
  await page.waitForTimeout(200);
  await page.click('[aria-label="Save height"]');
  await page.waitForTimeout(900);
  const h = await page.innerText('body');
  ok('S height saved and relocked', /175 cm/.test(h) && /Set once/i.test(h), h.replace(/\n/g,' | ').slice(0,260));
  ok('S it reached the store too', await page.evaluate(() => (window.__db.docs['meta/profile']||{}).heightCm) === '175', await page.evaluate(() => JSON.stringify(window.__db.docs['meta/profile'])));
  ok('S no page errors', errors.length===0, errors.join(';'));
  await b.close();
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL') ? 'PROFILE SUITE FAILED' : 'PROFILE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
