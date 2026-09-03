import { open, state, report, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const AT = '2026-09-01T14:00:00Z';   // Tuesday
const seed = { ...SEED, '2026-08-31': { 'Pull-A': wholeSession('Pull-A') } };

{
  const { browser, page } = await open({ at: AT, seed });

  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  let s = await state(page);
  R('30 Aug opens as a record', s.view === 'done', `view=${s.view}`);

  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(400);
  s = await state(page);
  R('Edit opens the form', s.view === 'form', `view=${s.view}`);

  // Toggle to another date and back, without saving.
  await page.locator('input[type=date]').fill('2026-08-31'); await page.waitForTimeout(500);
  const away = await state(page);
  R('the other date shows its own record', away.view === 'done' && away.dateInput === '2026-08-31',
    `${away.dateInput} → ${away.view}`);

  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  s = await state(page);
  R('coming back to 30 Aug shows the record again, not the form', s.view === 'done',
    `view=${s.view} — editing should end when you leave the date`);

  await browser.close();
}

// Same through the Today button.
{
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.waitForTimeout(500);
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  const s = await state(page);
  R('Today then back also ends the edit', s.view === 'done', `view=${s.view}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
