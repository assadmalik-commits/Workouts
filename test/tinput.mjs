// What a thumb can get into a field, and what the app then holds and shows.
// Every case here was found by sweeping the fields rather than by reasoning
// about them, and each one was a real reading on screen before it was fixed.
import { open, report, nav, bodyText, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';

const type = async (page, nth, value) => {
  const el = page.locator('input[type=number]').nth(nth);
  await el.evaluate((n) => { n.value = ''; });
  await el.click();
  if (value !== '') await el.pressSequentially(value, { delay: 10 });
};
const setsOf = (page) => page.evaluate(() => {
  const e = (JSON.parse(localStorage.getItem('workout-logs') || '{}')['2026-08-31'] || {})['Pull-A']?.['Straight-Arm Pulldown'];
  return e ? e.sets : null;
});

// A number field takes what the keypad gives it. The record should not.
{
  const { browser, page } = await open({ at: MON });
  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(300);
  for (const [typed, expected, why] of [
    ['007', '7', 'a leading-zero weight is stored as the number'],
    ['.5', '0.5', 'a bare decimal point is stored as 0.5'],
    ['00', '0', 'a doubled zero is one zero, which is bodyweight'],
  ]) {
    await type(page, 0, typed);
    await type(page, 1, '10');
    await page.waitForTimeout(700);
    const sets = await setsOf(page);
    R(why, sets && sets[0].w === expected, `typed ${typed}, stored ${JSON.stringify(sets && sets[0])}`);
  }

  // And the same number reads the same way wherever it is shown.
  await type(page, 0, '.5');
  await type(page, 1, '10');
  await page.waitForTimeout(700);
  const txt = await bodyText(page);
  R('the row summary and the set pill agree',
    /max 0\.5kg/.test(txt) && !/[^\d]\.5kg/.test(txt), (txt.match(/max [\d.]+kg/) || ['?'])[0]);
  await browser.close();
}

// A rep count of zero is not a rep count.
{
  const { browser, page } = await open({ at: MON });
  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(300);
  await type(page, 0, '20');
  await type(page, 1, '0');
  await page.waitForTimeout(800);
  R('20kg for zero reps is not a set', (await setsOf(page)) === null, JSON.stringify(await setsOf(page)));
  await type(page, 1, '00');
  await page.waitForTimeout(800);
  R('nor is 20kg for "00" reps', (await setsOf(page)) === null, JSON.stringify(await setsOf(page)));
  await type(page, 1, '1');
  await page.waitForTimeout(800);
  R('one rep is', (await setsOf(page))?.[0]?.r === '1', JSON.stringify(await setsOf(page)));
  await browser.close();
}

// A slipped thumb cannot enter a number that is not a lift.
{
  const { browser, page } = await open({ at: MON });
  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(300);
  await type(page, 0, '999999');
  await page.waitForTimeout(400);
  R('a weight cannot run past a thousand kilos',
    Number(await page.locator('input[type=number]').first().inputValue()) <= 1000,
    `field holds ${await page.locator('input[type=number]').first().inputValue()}`);
  await type(page, 1, '999999');
  await page.waitForTimeout(400);
  R('nor a rep count past two hundred',
    Number(await page.locator('input[type=number]').nth(1).inputValue()) <= 200,
    `field holds ${await page.locator('input[type=number]').nth(1).inputValue()}`);
  await browser.close();
}

// Numbers that are not a person get no reading, and are told why. Height and
// weight live on Stats now, beside the reading they produce.
const setMeasure = async (page, sel, value, saveLabel) => {
  const el = page.locator(sel);
  await el.evaluate((n) => { n.value = ''; });
  await el.click();
  if (value !== '') await el.pressSequentially(value, { delay: 10 });
  await page.waitForTimeout(150);
  const save = page.locator(`[aria-label="${saveLabel}"]`);
  if (await save.isEnabled()) await save.click();
  await page.waitForTimeout(500);
};
{
  const { browser, page } = await open({ at: MON, bw: [], profile: {} });
  await nav(page, 'Stats');
  await setMeasure(page, '#stats-height', '173', 'Save height');
  await setMeasure(page, '#stats-weight', '69', 'Save weight');
  R('173cm and 69kg is a reading', /body mass index/i.test(await bodyText(page)),
    (await bodyText(page)).replace(/\n/g, ' | ').slice(0, 120));

  // A number that is not a person can no longer be entered at all: the Save
  // never lights, so it never reaches the record to be complained about later.
  const change = page.getByRole('button', { name: 'Change', exact: true });
  if (await change.count()) { await change.click(); await page.waitForTimeout(250); }
  await setMeasure(page, '#stats-height', '1', 'Save height');
  R('1cm is not a height, and cannot be saved',
    (await page.locator('#stats-height').count()) === 1 &&
      !(await page.locator('[aria-label="Save height"]').isEnabled()),
    'save enabled ' + (await page.locator('[aria-label="Save height"]').isEnabled()));

  await setMeasure(page, '#stats-weight', '1', 'Save weight');
  R('1kg is not a weight, and cannot be saved',
    !(await page.locator('[aria-label="Save weight"]').isEnabled()),
    'save enabled ' + (await page.locator('[aria-label="Save weight"]').isEnabled()));
  await browser.close();
}

// A reading that is already on record from before those guards still has to be
// refused rather than dressed up as a BMI.
{
  const { browser, page } = await open({
    at: MON, bw: [{ date: '2026-08-30', weight: '69' }], profile: { heightCm: '1' },
  });
  await nav(page, 'Stats');
  const t = await bodyText(page);
  R('a height already on record that is not a height gets no reading',
    /does not look right/i.test(t), t.replace(/\n/g, ' | ').slice(0, 160));
  await browser.close();
}

{
  const { browser, page } = await open({ at: MON, bw: [], profile: {} });
  // One missing number is not two.
  const fresh = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '69' }], profile: {} });
  await nav(fresh.page, 'Stats');
  const t = await bodyText(fresh.page);
  R('one number missing is not called two',
    /one number missing/i.test(t) && /at the top of this screen/i.test(t),
    t.replace(/\n/g, ' | ').slice(0, 160));
  await fresh.browser.close();
  await browser.close();
}

// A weight the profile refused must not sit in the field as though it had been
// taken.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '69' }], profile: { heightCm: '173' } });
  await nav(page, 'Stats');
  const el = page.locator('#stats-weight');
  await el.evaluate((n) => { n.value = ''; });
  await el.click();
  await el.pressSequentially('0', { delay: 10 });
  await page.waitForTimeout(250);
  const live = await page.locator('[aria-label="Save weight"]').isEnabled();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs')));
  R('a weight of zero cannot even be offered to the record',
    live === false && stored.length === 1 && stored[0].weight === '69',
    `save enabled ${live}, stored ${JSON.stringify(stored)}`);
  await browser.close();
}

// A name is made of characters, not of UTF-16 code units.
{
  const { browser, page } = await open({ at: MON, profile: { name: 'Assad 💪' } });
  const initials = await page.evaluate(() => document.querySelector('header span.rounded-full span')?.textContent || '');
  R('an emoji in the name does not break the initials', initials === 'A💪' && !/�/.test(initials),
    JSON.stringify(initials));
  await browser.close();
}

// "Finish it on the day it belongs to" has to open it for finishing.
{
  const seed = { '2026-08-31': { 'Pull-A': { 'Straight-Arm Pulldown': { sets: [{ w: '15', r: '12' }] } } } };
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed });
  await page.getByRole('button', { name: 'Pull', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Go to 31 Aug/i }).click();
  await page.waitForTimeout(600);
  const openForWriting = await page.locator('[aria-label="Save Pull A"]').count();
  const stillAsking = await page.getByRole('button', { name: /Edit this session/i }).count();
  R('the hand-off lands with the session open, not on a read-only card',
    openForWriting === 1 && stillAsking === 0, `save bar ${openForWriting}, edit button ${stillAsking}`);
  // And leaving the day still closes it.
  await nav(page, 'Streak');
  await nav(page, 'Home');
  const date = await page.locator('input[type=date]').inputValue();
  R('and leaving still ends the visit', date === '2026-09-01', date);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
