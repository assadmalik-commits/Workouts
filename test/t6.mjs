import { open, state, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';

// B14 — saved data survives a reload (the ordinary path).
{
  const { browser, page } = await open({ at: AT });
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(200);
  await page.locator('input[type=number]').first().fill('25');
  await page.locator('input[type=number]').nth(1).fill('15');
  await page.getByRole('button', { name: /Save Pull A/i }).click();
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const s = await state(page);
  report('B14 a saved session survives a reload', /25kg/.test(s.bodySnippet) || s.counter === '2/6 this week',
    `counter=${s.counter}`);
  await browser.close();
}

// B15 — Saturday "Catch up" logs against the Saturday date.
{
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z' });
  await page.getByRole('button', { name: /Catch up/i }).click();
  await page.waitForTimeout(300);
  const s = await state(page);
  // Work done on a Saturday belongs to that Saturday; the rest day is a
  // default, not a bar on training.
  report('B15 a Saturday catch-up is dated to the Saturday it was done',
    s.dateInput === '2026-09-05' && s.view === 'form' && /Save /.test(s.saveButton || ''),
    `catch-up form is dated ${s.dateInput} for ${s.activeTab} ${s.activeVariant}, button "${s.saveButton}"`);
  await browser.close();
}

// B16 — a log dated next week must not count toward this week.
{
  const seed = { '2026-09-09': { 'Legs-A': { 'Back Squat': { sets: [{w:'60',r:'8'}] } } } };
  const { browser, page } = await open({ at: AT, seed });
  const s = await state(page);
  report('B16 a future-dated log stays out of this week\'s count', s.counter === '0/6 this week',
    `counter=${s.counter} with only a 9 Sep entry on file (this week starts 30 Aug)`);
  await browser.close();
}

// B17 — theme choice survives a reload.
{
  const { browser, page } = await open({ at: AT });
  await page.getByRole('button', { name: /Switch to dark/i }).click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const t = await page.evaluate(() => document.documentElement.dataset.appTheme);
  report('B17 dark mode survives a reload', t === 'dark', `theme after reload = ${t}`);
  await browser.close();
}

// B18 — page height on a 440x820 phone (the "rolls over" complaint).
{
  const { browser, page } = await open({ at: AT });
  const h1 = await page.evaluate(() => document.body.scrollHeight);
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: /Add set/i }).click(); await page.waitForTimeout(120); }
  const h2 = await page.evaluate(() => document.body.scrollHeight);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  report('B18 no horizontal overflow with 4 sets open', !overflow,
    `height closed=${h1}px, with one exercise open at 4 sets=${h2}px, viewport=820px; horizontal overflow=${overflow}`);
  await browser.close();
}
