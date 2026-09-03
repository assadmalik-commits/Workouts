import { open, state, report, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T19:44:00Z';

// The reported bug: save mid-session, get moved on to the next day.
{
  const { browser, page } = await open({ at: MON, seed: SEED });
  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('input[type=number]').first().fill('20.3');
  await page.locator('input[type=number]').nth(1).fill('15');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Save Pull A/i }).click();
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });   // what publishing does
  await page.waitForTimeout(700);
  const s = await state(page);
  R('saving mid-session leaves you on that session', s.activeTab === 'Pull' && s.activeVariant === 'Day A',
    `landed on ${s.activeTab} ${s.activeVariant}, ${s.counter}`);
  R('and the set that was logged is still there', /20\.3kg/.test(s.bodySnippet) || /1 set/.test(s.bodySnippet),
    (s.bodySnippet.match(/Straight-Arm Pulldown\n[^\n]*/) || [])[0]);
  await browser.close();
}

// A phone locking mid-set publishes too; coming back must not move you either.
{
  const { browser, page } = await open({ at: MON, seed: SEED });
  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('input[type=number]').first().fill('20.3');
  await page.waitForTimeout(900);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const s = await state(page);
  R('locking the phone mid-set leaves you on that session', s.activeTab === 'Pull' && s.activeVariant === 'Day A',
    `landed on ${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// Editing a past day and saving must come back to that day, not to today.
{
  const { browser, page } = await open({ at: MON, seed: SEED });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(450);
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(300);
  // Correct something. Save does nothing when nothing has changed, which is
  // the point of the button being inert.
  await page.getByText('Incline Dumbbell Press', { exact: true }).click(); await page.waitForTimeout(250);
  await page.locator('input[type=number]').first().fill('11'); await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Save Push A/i }).click(); await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  const s = await state(page);
  R('saving an edit to 30 Aug returns to 30 Aug', s.dateInput === '2026-08-30' && s.activeTab === 'Push',
    `landed on ${s.dateInput}, ${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// A plain open — no publish, no note — still lands on what is due.
{
  const { browser, page } = await open({ at: MON, seed: SEED });
  const s = await state(page);
  R('opening the app normally still lands on the session due', s.activeTab === 'Pull' && s.activeVariant === 'Day A',
    `${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// And once Pull A is genuinely finished, a fresh open moves on.
{
  // Pull A finished in full — only then does the rotation move on.
  const seed = { ...SEED, '2026-08-31': { 'Pull-A': wholeSession('Pull-A') } };
  const { browser, page } = await open({ at: MON, seed });
  const s = await state(page);
  R('a fresh open after Pull A moves on to Legs A', s.activeTab === 'Legs' && s.activeVariant === 'Day A',
    `${s.activeTab} ${s.activeVariant}, ${s.counter}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
