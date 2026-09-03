import { open, state, report } from './lib.mjs';

// B3 — it is Saturday. Navigate to a past date, then press Today.
{
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z' }); // Sat 5 Sep 18:00 Dubai
  const boot = await state(page);
  report('B3a Saturday boots into the rest view', boot.view === 'rest', `view=${boot.view}`);
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(300);
  const past = await state(page);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.waitForTimeout(300);
  const back = await state(page);
  report('B3b pressing Today on a Saturday returns to the rest view', back.view === 'rest',
    `after Today: view=${back.view}, date=${back.dateInput}, tab=${back.activeTab} ${back.activeVariant}`);
  await browser.close();
}

// B4 — navigate to a past SATURDAY on a normal weekday. Rest is the default
// for the day being lived, not a verdict on the past: a past Saturday answers
// the same question every past date answers.
{
  const { browser, page } = await open({ at: '2026-08-31T14:00:00Z' });
  await page.locator('input[type=date]').fill('2026-08-29'); // Sat 29 Aug
  await page.waitForTimeout(300);
  const s = await state(page);
  const stripSel = s.strip.findIndex((x) => x.selected);
  report('B4 a past Saturday reads as unrecorded, not as a rest day',
    s.view === 'unrecorded',
    `view=${s.view}, strip selects cell ${stripSel} (${s.strip[stripSel]?.label}), showing ${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// B5 — a future date can be picked and logged against.
{
  const { browser, page } = await open({ at: '2026-08-31T14:00:00Z' });
  await page.locator('input[type=date]').fill('2026-12-25');
  await page.waitForTimeout(300);
  const s = await state(page);
  const max = await page.locator('input[type=date]').getAttribute('max');
  // The picker is capped at today, and a future date typed past that cap is
  // refused — the field stays on today, which correctly shows today's session.
  report('B5 the date picker refuses future dates',
    max === '2026-08-31' && s.dateInput === '2026-08-31',
    `max attr=${max}; after picking 25 Dec 2026 the field reads ${s.dateInput}`);
  await browser.close();
}
