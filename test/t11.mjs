import { open, state, report, wholeSession } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';
let fails = 0;
const R = (n, p, d) => { if (!report(n, p, d)) fails++; };

// A session done on another day this rotation: forward only.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('.grid-cols-7 button').first().click(); // Sunday → Push A
  await page.waitForTimeout(400);
  const s = await state(page);
  R('a spent session shows no way to train it again',
    await page.getByRole('button', { name: /Train it again anyway/i }).count() === 0, 'route removed');
  R('and no way to edit it from here',
    await page.getByRole('button', { name: /Edit this session/i }).count() === 0, 'no edit button');
  R('it offers the way forward instead',
    await page.getByRole('button', { name: /Go to Pull A/i }).count() === 1, `view=${s.view}`);
  R('with no save bar', s.saveButton === null, `${s.saveButton}`);
  await browser.close();
}

// The last session of a finished week has nothing forward and must not break.
{
  const seed = {};
  const days = ['2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'];
  const slots = ['Push-A','Pull-A','Legs-A','Push-B','Pull-B','Legs-B'];
  days.forEach((d, i) => { seed[d] = { [slots[i]]: wholeSession(slots[i]) }; });
  const { browser, page, errors } = await open({ at: '2026-09-04T14:00:00Z', seed });
  await page.locator('.grid-cols-7 button').first().click(); // Sunday → Push A, done 30 Aug
  await page.waitForTimeout(400);
  const s = await state(page);
  R('a completed week renders the done card cleanly',
    s.view === 'done' && errors.length === 0 && /reopens sunday/i.test(s.bodySnippet),
    `view=${s.view}, counter=${s.counter}, errors=${errors.length}`);
  await browser.close();
}

// The calendar keeps both of its deliberate routes.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(400);
  R('calendar → edit a recorded day',
    await page.getByRole('button', { name: /Edit this session/i }).count() === 1, 'present');
  await page.locator('input[type=date]').fill('2026-08-27'); await page.waitForTimeout(400);
  R('calendar → log an unrecorded day',
    await page.getByRole('button', { name: /Log it for this day anyway/i }).count() === 1, 'present');
  await page.getByRole('button', { name: /Log it for this day anyway/i }).click();
  await page.waitForTimeout(300);
  const s = await state(page);
  R('and that opens a form dated to the day chosen',
    s.view === 'form' && s.dateInput === '2026-08-27', `${s.view} dated ${s.dateInput}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
