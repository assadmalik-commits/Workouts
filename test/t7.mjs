import { open, state, report, wholeSession } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';

// B19 removed: "Train it again anyway" no longer exists (covered by t11).

// B20 — a week finished: all six done.
{
  const seed = {};
  const days = ['2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'];
  const slots = ['Push-A','Pull-A','Legs-A','Push-B','Pull-B','Legs-B'];
  // Every exercise of every session — a week is only complete when each one is.
  days.forEach((d, i) => { seed[d] = { [slots[i]]: wholeSession(slots[i]) }; });
  const { browser, page } = await open({ at: '2026-09-04T14:00:00Z', seed });
  const s = await state(page);
  report('B20 a complete week reads 6/6 and says it reopens Sunday',
    s.counter === '6/6 this week' && /reopens sunday/i.test(s.bodySnippet),
    `counter=${s.counter}, view=${s.view}`);
  await browser.close();
}

// B21 — logs referencing an exercise no longer in the program.
{
  // The realistic case: a session trained in full, then the program moved on
  // and one of its exercises no longer exists.
  const seed = { '2026-08-30': { 'Pull-A': { ...wholeSession('Pull-A'), 'Deleted Exercise': { sets: [{ w: '50', r: '5' }] } } } };
  const { browser, page, errors } = await open({ at: AT, seed });
  // The record for a day is shown on that day, so that is where to look.
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(450);
  const s = await state(page);
  const txt = await page.evaluate(() => document.body.innerText);
  report('B21 an exercise the program no longer has is still shown',
    errors.length === 0 && /Deleted Exercise\n50kg × 5/.test(txt),
    `errors=${errors.length}; view=${s.view}; ${(txt.match(/Deleted Exercise\n[^\n]*/) || ['not on screen'])[0]}`);
  await browser.close();
}

// B22 — decimal weights.
{
  const { browser, page } = await open({ at: AT });
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(200);
  await page.locator('input[type=number]').first().fill('12.5');
  await page.locator('input[type=number]').nth(1).fill('10');
  await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.body.innerText);
  report('B22 decimal weights read cleanly', /12\.5kg|125 kg/.test(txt),
    `summary: ${(txt.match(/Straight-Arm Pulldown\n([^\n]*)/) || [])[1]}`);
  await browser.close();
}
