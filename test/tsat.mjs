import { open, state, report } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';   // Mon 31 Aug 18:00 Dubai
const SAT = '2026-09-05T14:00:00Z';   // Sat 5 Sep 18:00 Dubai

// A past Saturday with nothing on it reads like any other unrecorded day.
{
  const { browser, page } = await open({ at: MON });
  await page.locator('input[type=date]').fill('2026-08-29'); // Sat, last week
  await page.waitForTimeout(450);
  const s = await state(page);
  R('a past Saturday says the session was not recorded', s.view === 'unrecorded',
    `view=${s.view}, date=${s.dateInput}`);
  await browser.close();
}
// Including a Saturday inside the current week that has already passed.
{
  const { browser, page } = await open({ at: '2026-09-06T14:00:00Z' }); // Sun 6 Sep
  await page.locator('input[type=date]').fill('2026-09-05'); // yesterday, a Saturday
  await page.waitForTimeout(450);
  const s = await state(page);
  R('yesterday-was-Saturday says the same', s.view === 'unrecorded', `view=${s.view}`);
  await browser.close();
}
// A Saturday that was actually trained shows the record, not "not recorded".
{
  const seed = { '2026-08-29': { 'Legs-A': { 'Back Squat': { sets: [{ w: '60', r: '8' }] } } } };
  const { browser, page } = await open({ at: MON, seed });
  await page.locator('input[type=date]').fill('2026-08-29');
  await page.waitForTimeout(450);
  const txt = await page.evaluate(() => document.body.innerText);
  R('a Saturday that was trained shows what was done', /Back Squat/.test(txt) && !/Session not recorded/i.test(txt),
    (txt.match(/Back Squat\n[^\n]*/) || ['not shown'])[0]);
  await browser.close();
}
// Today being Saturday still opens on the rest day.
{
  const { browser, page } = await open({ at: SAT });
  const s = await state(page);
  R('today being Saturday still rests', s.view === 'rest', `view=${s.view}`);
  await browser.close();
}
// And coming home from a past date on a Saturday still lands on the rest day.
{
  const { browser, page } = await open({ at: SAT });
  await page.locator('input[type=date]').fill('2026-08-31'); await page.waitForTimeout(450);
  await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.waitForTimeout(450);
  const s = await state(page);
  R('Today on a Saturday returns to the rest day', s.view === 'rest', `view=${s.view}, date=${s.dateInput}`);
  await browser.close();
}
// Tapping Rest in the strip is still a deliberate look, from any date.
{
  const { browser, page } = await open({ at: MON });
  await page.locator('input[type=date]').fill('2026-08-29'); await page.waitForTimeout(450);
  await page.locator('.grid-cols-7 button').nth(6).click(); await page.waitForTimeout(400);
  const s = await state(page);
  R('tapping Rest still shows the rest day', s.view === 'rest', `view=${s.view}`);
  await browser.close();
}
// Catching up on a Saturday still works.
{
  const { browser, page } = await open({ at: SAT });
  await page.getByRole('button', { name: /Catch up/i }).click(); await page.waitForTimeout(450);
  const s = await state(page);
  R('a Saturday catch-up still opens a loggable session', s.view === 'form' && s.dateInput === '2026-09-05',
    `view=${s.view} dated ${s.dateInput}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
