import { open, state, report } from './lib.mjs';

// B6 — midnight rollover while the app sits open.
{
  const { browser, page, ctx } = await open({ at: '2026-08-31T19:55:00Z' }); // Mon 23:55 Dubai
  const before = await state(page);
  await ctx.clock.fastForward('10:00'); // to Tue 00:05 Dubai
  await page.waitForTimeout(600);
  const after = await state(page);
  report('B6 rolling past midnight moves on to the new day\'s session',
    after.dateInput === '2026-09-01' && after.activeTab === 'Legs',
    `before: ${before.dateInput} ${before.activeTab} ${before.activeVariant} | after: ${after.dateInput} ${after.activeTab} ${after.activeVariant}, header "${after.header}"`);
  await browser.close();
}

// B7 — rolling into Saturday.
{
  const { browser, page, ctx } = await open({ at: '2026-09-04T19:55:00Z' }); // Fri 23:55 Dubai
  await ctx.clock.fastForward('10:00'); // Sat 00:05
  await page.waitForTimeout(600);
  const s = await state(page);
  report('B7 rolling into Saturday shows the rest day', s.view === 'rest',
    `view=${s.view}, date=${s.dateInput}, showing ${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// B8 — a completed session, viewed on its own day, offers view-then-edit.
{
  const { browser, page } = await open({ at: '2026-08-31T14:00:00Z' });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  const s = await state(page);
  report('B8 viewing 30 Aug shows Push A as done, not an open form',
    s.view === 'done' && s.activeTab === 'Push',
    `view=${s.view}, tab=${s.activeTab} ${s.activeVariant}, save button=${s.saveButton}`);
  await browser.close();
}

// B9 — unlocking one date must not unlock the same session on another date.
{
  const { browser, page } = await open({ at: '2026-08-31T14:00:00Z' });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Edit this session/i }).click();
  await page.waitForTimeout(300);
  const edit = await state(page);
  await page.locator('input[type=date]').fill('2026-08-28');
  await page.waitForTimeout(400);
  const other = await state(page);
  report('B9 unlocking 30 Aug leaves 28 Aug locked',
    edit.view === 'form' && other.view !== 'form',
    `30 Aug after edit=${edit.view}; 28 Aug then shows ${other.view}`);
  await browser.close();
}
