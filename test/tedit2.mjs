import { open, state, report, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const AT = '2026-09-01T14:00:00Z';
const seed = { ...SEED, '2026-08-31': { 'Pull-A': wholeSession('Pull-A') } };

// Editing must still work while you stay on the day.
{
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(400);
  await page.getByText('Incline Dumbbell Press', { exact: true }).click(); await page.waitForTimeout(300);
  await page.locator('input[type=number]').first().fill('22');
  await page.waitForTimeout(900);
  const s = await state(page);
  const ls = await page.evaluate(() => localStorage.getItem('workout-logs'));
  R('the form stays open while editing that day', s.view === 'form' && s.dateInput === '2026-08-30', `${s.view} on ${s.dateInput}`);
  R('and the change is written', /"22"/.test(ls || ''), 'saved to the device');
  await browser.close();
}

// Switching day or variant on the same date must not end the edit either.
{
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Day B$/ }).click(); await page.waitForTimeout(350);
  await page.getByRole('button', { name: /^Day A$/ }).click(); await page.waitForTimeout(350);
  const s = await state(page);
  R('switching variant and back keeps the edit open', s.view === 'form', `view=${s.view}`);
  await browser.close();
}

// "Log it for this day anyway" on an empty past day ends the same way.
{
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-27'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Log it for this day anyway/i }).click(); await page.waitForTimeout(400);
  let s = await state(page);
  R('logging an empty past day opens a form', s.view === 'form', `view=${s.view}`);
  await page.locator('input[type=date]').fill('2026-08-26'); await page.waitForTimeout(450);
  await page.locator('input[type=date]').fill('2026-08-27'); await page.waitForTimeout(450);
  s = await state(page);
  R('and leaving the day closes it again', s.view === 'unrecorded', `view=${s.view}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
