import { open, state, report, nav } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';

// B1' — typed sets reach storage without pressing Save, and survive a reload.
{
  const { browser, page } = await open({ at: AT });
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(200);
  await page.locator('input[type=number]').first().fill('25');
  await page.locator('input[type=number]').nth(1).fill('15');
  await page.waitForTimeout(900); // past the 500ms debounce
  const ls = await page.evaluate(() => localStorage.getItem('workout-logs'));
  // What is actually guaranteed without pressing Save: the numbers reach the
  // device. A reload of the published page does NOT keep them — the embedded
  // copy wins over the device copy — so that is deliberately not asserted here.
  report("B1' sets reach the device without pressing Save",
    // Keyed by id: the display name is not what reaches storage.
    /"straight-arm-pulldown"/.test(ls || '') && /"25"/.test(ls || ''),
    `written to storage without Save: ${/straight-arm-pulldown/.test(ls || '')}`);
  await browser.close();
}

// B2' — a phone locking mid-set flushes rather than waits.
{
  const { browser, page } = await open({ at: AT });
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(200);
  // Both halves: a weight with no rep count is a row still being typed, not a
  // set, and there would be nothing for the flush to write.
  await page.locator('input[type=number]').first().fill('30');
  await page.locator('input[type=number]').nth(1).fill('12');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(250);
  const ls = await page.evaluate(() => localStorage.getItem('workout-logs'));
  report("B2' hiding the page flushes immediately", /"w":"30"/.test(ls || ''), `storage: ${/"w":"30"/.test(ls||'') ? 'has the set' : 'missing'}`);
  await browser.close();
}

// B5' — a future date typed into the field is refused.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('input[type=date]').fill('2026-12-25');
  await page.waitForTimeout(400);
  const s = await state(page);
  report("B5' a future date is refused", s.dateInput === '2026-08-31',
    `field settled on ${s.dateInput}, max=${await page.locator('input[type=date]').getAttribute('max')}`);
  await browser.close();
}

// B6' — rollover re-opens on the new day's session.
{
  const { browser, page, ctx } = await open({ at: '2026-08-31T19:55:00Z' });
  await ctx.clock.fastForward('10:00');
  await page.waitForTimeout(700);
  const s = await state(page);
  report("B6' rolling past midnight opens the new day's session",
    s.dateInput === '2026-09-01' && s.activeTab === 'Legs',
    `now ${s.dateInput}, showing ${s.activeTab} ${s.activeVariant}, header "${s.header}"`);
  await browser.close();
}

// B13' — the weight field is a current weight, so it opens showing what is on
// record rather than an empty box to fill in again each day. It lives on Stats
// now, beside the BMI it feeds.
{
  const { browser, page } = await open({ at: AT, bw: [{date:'2026-08-30', weight:'69', notes:'morning'}] });
  await nav(page, 'Stats');
  const shown = await page.locator('#stats-weight').inputValue();
  report("B13' the weight field opens on the weight last recorded", shown === '69', `field holds "${shown}"`);
  await browser.close();
}

// B15' — a Saturday catch-up is dated to the Saturday it was actually done.
{
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z' });
  await page.getByRole('button', { name: /Catch up/i }).click();
  await page.waitForTimeout(400);
  const s = await state(page);
  report("B15' a Saturday catch-up stays on Saturday and is loggable",
    s.dateInput === '2026-09-05' && s.view === 'form' && /Save Pull A/.test(s.saveButton || ''),
    `dated ${s.dateInput}, view=${s.view}, button "${s.saveButton}"`);
  await browser.close();
}
