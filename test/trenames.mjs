import { open, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };

// Every rename, and the slot each one lives in.
const CASES = [
  { old: 'Deficit Push-Ups / Weighted Dips', now: 'Deficit Push-Ups', slot: 'Push-A' },
  { old: 'Weighted Pull-Ups / Lat Pulldown', now: 'Lat Pulldown',     slot: 'Pull-A' },
  { old: 'Deadlift / Rack Pull',             now: 'Rack Pull',        slot: 'Pull-B' },
  { old: 'Reverse Pec-Deck / Band Pull-Apart', now: 'Reverse Pec-Deck', slot: 'Pull-B' },
  { old: 'Back Extension / Glute-Ham Raise', now: 'Glute-Ham Raise',  slot: 'Legs-B' },
  { old: 'Donkey / Standing Calf Raise',     now: 'Donkey Calf Raise', slot: 'Legs-B' },
];

for (const c of CASES) {
  // Sets logged under the old name must survive and show under the new one.
  const seed = { '2026-08-24': { [c.slot]: { [c.old]: { sets: [{ w: '40', r: '10' }, { w: '50', r: '8' }] } } } };
  const { browser, page, errors } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-24');
  await page.waitForTimeout(450);
  const txt = await page.evaluate(() => document.body.innerText);
  const stored = await page.evaluate(() => localStorage.getItem('workout-logs'));
  const ok = new RegExp(`${c.now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n40kg × 10\\n50kg × 8`).test(txt)
    && !txt.includes(c.old) && stored.includes(`"${c.now}"`) && !stored.includes(c.old);
  R(`${c.old}  ->  ${c.now}`, ok && errors.length === 0,
    ok ? 'renamed, sets carried, record rewritten' : (txt.match(new RegExp(`${c.now}\\n[^\\n]*`)) || ['NOT SHOWN'])[0]);
  await browser.close();
}

// The one deliberately left alone.
{
  const { browser, page } = await open({ at: AT });
  await page.getByRole('button', { name: 'Pull', exact: true }).click(); await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^Day B$/ }).click(); await page.waitForTimeout(350);
  const txt = await page.evaluate(() => document.body.innerText);
  R('Seated Cable Row (close/neutral grip) is untouched', /Seated Cable Row \(close\/neutral grip\)/.test(txt), 'present');
  R('and no paired names remain in Pull B', !/Deadlift \/|Band Pull-Apart/.test(txt), 'clean');
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
