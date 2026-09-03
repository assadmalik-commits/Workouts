// His live state, as the store actually holds it right now: appearance System,
// three sessions, profile, photo, two weights — and no device copy, because iOS
// throws that away with the tab.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import { pageFor } from './bake.mjs';
import fs from 'fs';
import { fileURLToPath as __f } from 'url';
import path0 from 'path';
// Fixtures live beside the suites, not in whatever directory node was
// started from — running the suite must not depend on the cwd.
const FIXTURES = path0.join(path0.dirname(__f(import.meta.url)), 'fixtures');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
// This suite's whole job is to mirror the lifter's live store, so it needs his
// real record — which is deliberately not committed. Without it there is
// nothing honest to assert, so it stands down rather than pretending.
const LIVE = FIXTURES + '/live-current.json';
if (!fs.existsSync(LIVE)) {
  console.log('SKIP - tlive needs fixtures/live-current.json, rebuilt from the published page. It is not in the repo: it carries the lifter\'s own record.');
  process.exit(0);
}
const emb = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const store = {
  // System, which he chose after two days of the flash — and which is the one
  // setting whose first frame needs nothing to have survived the app closing.
  'meta/prefs':   { theme: 'system', updatedAt: '2026-09-03T09:00:00.000Z' },
  'meta/profile': { name:'Assad Malik', dob:'1979-10-15', sex:'Male', heightCm:'173',
                    // From the private fixture, never written down here: this
                    // file is committed and his email and number are not.
                    email: emb.profile.email, mobile: emb.profile.mobile, updatedAt:'x' },
  'meta/photo':   { photo: emb.profile.photo, updatedAt:'x' },
  'meta/bodyweight': { entries:[{date:'2026-09-02',weight:'69'},{date:'2026-09-01',weight:'69'}], updatedAt:'x' },
};
for (const [date, slots] of Object.entries(emb['workout-logs'])) store[`sessions/${date}`] = { date, slots, updatedAt:'x' };

for (const phone of ['light', 'dark']) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820},
    deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme: phone });
  await ctx.clock.install({ time: new Date('2026-09-02T23:59:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  page.on('console', m => { if (m.type()==='error' && !/favicon|404/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  await page.addInitScript(() => {
    window.__f = [];
    const tick = () => { try {
      const m = getComputedStyle(document.documentElement).backgroundColor.match(/\d+/);
      const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
      if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
    } catch (e) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.addInitScript(stub(), [false, store, false]);
  // A page published while the preference was System — which is what his
  // actually is. The build under test is baked from the committed fixture, so
  // reading it directly would put this scenario against someone else's bake.
  await page.goto(pageFor('system', 'live'), { waitUntil:'commit' });
  await page.waitForTimeout(3200);
  const frames = await page.evaluate(() => window.__f);
  const body = await page.innerText('body');
  // System follows the phone, so the right answer is the phone's own setting
  // and there is nothing to go stale.
  ok(`phone ${phone}: one frame, no flash`, frames.length === 1, 'frames ' + frames.join(' -> '));
  ok(`phone ${phone}: and it follows the phone`, frames[0] === phone, frames.join(' -> '));
  ok(`phone ${phone}: the log is his, not the page's copy`, /4\/6 this week/.test(body),
     (body.match(/\d\/6 this week/) || ['none'])[0]);
  await page.click('nav button:has-text("Profile")');
  await page.waitForTimeout(500);
  const rows = await page.$$eval('[aria-label^="Edit "]', bs => bs.map(b => b.innerText.replace(/\n/g,' | ')));
  ok(`phone ${phone}: appearance reads System`, rows.some(r => /Appearance \| System/.test(r)), rows.join(' // '));
  ok(`phone ${phone}: email and mobile are there`,
     rows.some((r) => r.includes(emb.profile.email)) && rows.some((r) => r.includes(emb.profile.mobile)),
     rows.join(' // '));
  ok(`phone ${phone}: the photo is showing`, (await page.$eval('img', i=>i.src.slice(0,15))) === 'data:image/jpeg');
  await page.click('nav button:has-text("Stats")');
  await page.waitForTimeout(500);
  const s = await page.innerText('body');
  ok(`phone ${phone}: BMI reads from his numbers`, /23\.1/.test(s) && /69 kg/.test(s), (s.match(/[\d.]+ kg · \d+ cm/)||['none'])[0]);
  ok(`phone ${phone}: no page errors`, errors.length === 0, errors.join(';'));
  await b.close();
}
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'LIVE CHECK FAILED':'LIVE CHECK GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
