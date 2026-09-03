import { open, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };

// Every rename, the slot each one lives in, and the id its sets must end up
// under. The ids are written out here rather than imported from the programme
// on purpose: they are a contract, and a test that read them from the same
// file the app reads could never notice one being changed. Changing an id
// silently reassigns somebody's training history to a different exercise.
const CASES = [
  { old: 'Deficit Push-Ups / Weighted Dips', now: 'Deficit Push-Ups', id: 'deficit-push-ups', slot: 'Push-A' },
  { old: 'Weighted Pull-Ups / Lat Pulldown', now: 'Lat Pulldown',     id: 'lat-pulldown',     slot: 'Pull-A' },
  { old: 'Deadlift / Rack Pull',             now: 'Rack Pull',        id: 'rack-pull',        slot: 'Pull-B' },
  { old: 'Reverse Pec-Deck / Band Pull-Apart', now: 'Reverse Pec-Deck', id: 'reverse-pec-deck', slot: 'Pull-B' },
  { old: 'Back Extension / Glute-Ham Raise', now: 'Glute-Ham Raise',  id: 'glute-ham-raise',  slot: 'Legs-B' },
  { old: 'Donkey / Standing Calf Raise',     now: 'Donkey Calf Raise', id: 'donkey-calf-raise', slot: 'Legs-B' },
];

for (const c of CASES) {
  // Sets logged under the old name must survive, show under the new one, and
  // be rewritten into the record under the exercise's id — never under either
  // name, or the next rename would strand them again.
  const seed = { '2026-08-24': { [c.slot]: { [c.old]: { sets: [{ w: '40', r: '10' }, { w: '50', r: '8' }] } } } };
  const { browser, page, errors } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-24');
  await page.waitForTimeout(450);
  const txt = await page.evaluate(() => document.body.innerText);
  const stored = await page.evaluate(() => localStorage.getItem('workout-logs'));
  const ok = new RegExp(`${c.now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n40kg × 10\\n50kg × 8`).test(txt)
    && !txt.includes(c.old) && stored.includes(`"${c.id}"`)
    && !stored.includes(c.old) && !stored.includes(`"${c.now}"`);
  R(`${c.old}  ->  ${c.now}`, ok && errors.length === 0,
    ok ? `shown as "${c.now}", stored as "${c.id}"` : (txt.match(new RegExp(`${c.now}\\n[^\\n]*`)) || ['NOT SHOWN'])[0]);
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
