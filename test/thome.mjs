// Leaving Home ends the visit to whatever day was being looked at.
import { open, state, report, nav, bodyText, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
// Push A on Sunday, Pull A on Monday; Tuesday is Legs A and still due.
const SEED2 = { ...SEED, '2026-08-31': { 'Pull-A': wholeSession('Pull-A', '25', '12') } };
const TUE = '2026-09-01T14:00:00Z';

{
  const { browser, page } = await open({ at: TUE, seed: SEED2 });
  const start = await state(page);
  R('Home opens on today and the session due', start.dateInput === '2026-09-01' && start.activeTab === 'Legs',
    `${start.dateInput} / ${start.activeTab} ${start.activeVariant}`);

  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(450);
  const past = await state(page);
  R('the calendar still opens a past day', past.dateInput === '2026-08-30' && past.activeTab === 'Push',
    `${past.dateInput} / ${past.activeTab}`);

  await nav(page, 'Stats');
  await nav(page, 'Streak');
  await nav(page, 'Home');
  const back = await state(page);
  R('crossing to Stats and Streak and back resets to today', back.dateInput === '2026-09-01', back.dateInput);
  R('and to the session due on it', back.activeTab === 'Legs' && back.activeVariant === 'Day A',
    `${back.activeTab} ${back.activeVariant}`);
  await browser.close();
}

// One section is enough; it is leaving that ends the visit, not how far.
{
  const { browser, page } = await open({ at: TUE, seed: SEED2 });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(450);
  await nav(page, 'Profile');
  await nav(page, 'Home');
  const back = await state(page);
  R('one section away is enough', back.dateInput === '2026-09-01' && back.activeTab === 'Legs',
    `${back.dateInput} / ${back.activeTab}`);
  await browser.close();
}

// Tapping Home while already on Home is the same intent.
{
  const { browser, page } = await open({ at: TUE, seed: SEED2 });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(450);
  await nav(page, 'Home');
  const back = await state(page);
  R('tapping Home while on Home resets too', back.dateInput === '2026-09-01', back.dateInput);
  await browser.close();
}

// A reload is not a section change: a publish must not throw away the day the
// lifter deliberately opened.
{
  const { browser, page } = await open({ at: TUE, seed: SEED2 });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(450);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const back = await state(page);
  R('a reload still restores the day being looked at', back.dateInput === '2026-08-30', back.dateInput);
  await browser.close();
}

// Nothing to save is nothing to press.
{
  const { browser, page } = await open({ at: TUE, seed: SEED2 });
  const idle = await page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Save "]');
    return { text: b.textContent.trim(), disabled: b.disabled };
  });
  R('with nothing written down the Save button is inert and says so',
    idle.disabled && /no sets entered/i.test(idle.text),
    `"${idle.text}" disabled=${idle.disabled}`);

  await page.getByText('Back Squat', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type=number]').first().fill('60');
  await page.waitForTimeout(900);
  const half = await page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Save "]');
    return { text: b.textContent.trim(), disabled: b.disabled,
             stored: JSON.parse(localStorage.getItem('workout-logs') || '{}')['2026-09-01'] || null };
  });
  R('a weight with no reps is not a record', half.stored === null && half.disabled,
    JSON.stringify(half));

  await page.locator('input[type=number]').nth(1).fill('8');
  await page.waitForTimeout(900);
  const done = await page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Save "]');
    return { text: b.textContent.trim(), disabled: b.disabled,
             stored: JSON.parse(localStorage.getItem('workout-logs') || '{}')['2026-09-01'] || null };
  });
  R('both written down is', !done.disabled && /^Save /.test(done.text) && done.stored !== null,
    `"${done.text}" ${JSON.stringify(done.stored)}`);
  await browser.close();
}

// Bodyweight work still counts: 0kg is a weight.
{
  const { browser, page } = await open({ at: '2026-08-30T14:00:00Z', seed: {} });
  await page.getByText('Deficit Push-Ups', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type=number]').first().fill('0');
  await page.locator('input[type=number]').nth(1).fill('12');
  await page.waitForTimeout(900);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('workout-logs') || '{}'));
  R('0kg by 12 reps is a record', JSON.stringify(stored).includes('"w":"0","r":"12"'), JSON.stringify(stored));
  R('and reads BW on the row', /BW × 12|3 sets · body weight|1 set · body weight/.test(await bodyText(page)),
    ((await bodyText(page)).match(/1 set[^\n]*/) || ['?'])[0]);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
