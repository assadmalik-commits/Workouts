import { open, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };

// The new name is what the session shows.
{
  const { browser, page, errors } = await open({ at: AT });
  const txt = await page.evaluate(() => document.body.innerText);
  R('Pull A lists "Lat Pulldown"', /Lat Pulldown\n4 sets of 8-10 reps/.test(txt), (txt.match(/Lat Pulldown[^\n]*\n[^\n]*/) || ['missing'])[0]);
  R('and no longer mentions weighted pull-ups', !/Weighted Pull-Ups/.test(txt), 'old name gone');
  R('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}
// Anything logged under the old name comes across rather than being stranded.
{
  const seed = { '2026-08-24': { 'Pull-A': { 'Weighted Pull-Ups / Lat Pulldown': { sets: [{ w: '40', r: '10' }, { w: '45', r: '8' }] } } } };
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-24'); await page.waitForTimeout(450);
  const txt = await page.evaluate(() => document.body.innerText);
  R('old entries carry across to the new name', /Lat Pulldown\n40kg × 10\n45kg × 8/.test(txt), (txt.match(/Lat Pulldown\n[^\n]*/) || ['not shown'])[0]);
  R('and nothing is left under the old name', !/Weighted Pull-Ups/.test(txt), 'old name gone');
  const stored = await page.evaluate(() => localStorage.getItem('workout-logs'));
  R('the stored record is rewritten too', /"Lat Pulldown"/.test(stored) && !/Weighted Pull-Ups/.test(stored), 'migrated on disk');
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
