import { open, state, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z'; // Mon 31 Aug, Push A trained Sun 30 Aug
let fails = 0;
const R = (n, p, d) => { if (!report(n, p, d)) fails++; };

// The strip must not be a route into a past session.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('.grid-cols-7 button').first().click(); // Sunday
  await page.waitForTimeout(400);
  const s = await state(page);
  const hasEdit = await page.getByRole('button', { name: /Edit this session/i }).count();
  R('tapping Sunday stays on today', s.dateInput === '2026-08-31', `date is now ${s.dateInput}`);
  R('tapping Sunday shows Push A as done', s.view === 'done' && s.activeTab === 'Push', `${s.activeTab} ${s.activeVariant} / ${s.view}`);
  R('tapping Sunday offers no edit route', hasEdit === 0, `"Edit this session" buttons present: ${hasEdit}`);
  R('the strip highlight stays on today', s.strip[1].selected && !s.strip[0].selected, s.strip.map(x=>x.label+(x.selected?'*':'')).join(' '));
  await browser.close();
}

// A day still to come is selectable from the strip and loggable today.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('.grid-cols-7 button').nth(3).click(); // Wednesday = Push B
  await page.waitForTimeout(400);
  const s = await state(page);
  R('an untrained day opens ready to log, dated today',
    s.dateInput === '2026-08-31' && s.view === 'form' && s.activeTab === 'Push' && s.activeVariant === 'Day B',
    `${s.dateInput} ${s.activeTab} ${s.activeVariant} ${s.view}`);
  await browser.close();
}

// The calendar remains the way back, and still allows a deliberate edit.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  const done = await state(page);
  const hasEdit = await page.getByRole('button', { name: /Edit this session/i }).count();
  R('the calendar still reaches 30 Aug', done.dateInput === '2026-08-30' && done.view === 'done', `${done.dateInput} / ${done.view}`);
  R('and still offers the deliberate edit', hasEdit === 1, `edit buttons: ${hasEdit}`);
  await page.getByRole('button', { name: /Edit this session/i }).click();
  await page.waitForTimeout(300);
  const edit = await state(page);
  R('editing 30 Aug works from the calendar', edit.view === 'form' && /Save Push A/.test(edit.saveButton || ''), `${edit.view} / ${edit.saveButton}`);
  await browser.close();
}

// Coming from a past date, the strip brings you home rather than staying back there.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  await page.locator('.grid-cols-7 button').nth(1).click(); // Monday
  await page.waitForTimeout(400);
  const s = await state(page);
  R('the strip returns you to today from a past date',
    s.dateInput === '2026-08-31' && s.view === 'form' && s.activeTab === 'Pull',
    `${s.dateInput} ${s.activeTab} ${s.activeVariant} ${s.view}`);
  await browser.close();
}

// Saturday: the strip still works as a catch-up, dated to Saturday.
{
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z' });
  await page.locator('.grid-cols-7 button').nth(1).click(); // Monday = Pull A
  await page.waitForTimeout(400);
  const s = await state(page);
  R('on a Saturday the strip catches up, dated Saturday',
    s.dateInput === '2026-09-05' && s.view === 'form' && s.activeTab === 'Pull',
    `${s.dateInput} ${s.activeTab} ${s.view}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
