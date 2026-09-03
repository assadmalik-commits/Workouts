import { open, state, report, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
// A fixed fixture, not the live log: the live file is overwritten with real
// training as it happens, and a test that reads it changes meaning underneath.
// Push A finished Sunday; Pull A begun Monday and left at 3 of 7.
const LIVE = {
  ...SEED,
  '2026-08-31': {
    'Pull-A': {
      'Straight-Arm Pulldown': { sets: [{ w: '15.8', r: '15' }, { w: '18', r: '15' }, { w: '20.3', r: '12' }] },
      'Chest-Supported T-Bar Row': { sets: [{ w: '32', r: '10' }, { w: '36', r: '10' }, { w: '36', r: '10' }, { w: '41', r: '8' }] },
      'Lat Pulldown': { sets: [{ w: '45', r: '10' }, { w: '52', r: '10' }, { w: '52', r: '8' }, { w: '59', r: '8' }] },
    },
  },
};
const TUE = '2026-09-01T14:00:00Z';   // Tuesday 1 Sep, Dubai evening

// Assad's case: Pull A begun Monday, 3 of 7, now Tuesday.
{
  const { browser, page } = await open({ at: TUE, seed: LIVE });
  await page.getByRole('button', { name: 'Pull', exact: true }).click();
  await page.waitForTimeout(400);
  const s = await state(page);
  const txt = await page.evaluate(() => document.body.innerText);
  R('Tuesday shows Pull A as not recorded today', s.view === 'unrecorded', `view=${s.view}`);
  R('and says where it was started, and how far', /started on 31 Aug 2026 — 3 of 7 exercises/i.test(txt),
    (txt.match(/It was started[^\n]*\n?[^\n]*/) || ['missing'])[0].replace('\n',' '));
  R('and offers the day it belongs to', /Go to 31 Aug 2026/.test(txt), 'button present');
  R('and the way on to what is due today', /Go to Legs A/.test(txt), 'button present');
  R('with no way to log it against Tuesday', s.saveButton === null, `save button: ${s.saveButton}`);
  await browser.close();
}

// Monday via the calendar: the record, edited on purpose.
{
  const { browser, page } = await open({ at: TUE, seed: LIVE });
  await page.locator('input[type=date]').fill('2026-08-31'); await page.waitForTimeout(500);
  const s = await state(page);
  const txt = await page.evaluate(() => document.body.innerText);
  R('Monday reads as a record, not an edit form', s.view === 'done', `view=${s.view}`);
  R('titled with how far it got', /PULL A · 3 OF 7/i.test(txt), (txt.match(/PULL A[^\n]*/) || [])[0]);
  R('listing the work done, set by set',
    /Lat Pulldown\n45kg × 10\n52kg × 10\n52kg × 8\n59kg × 8/.test(txt),
    (txt.match(/Lat Pulldown\n[^A-Z]{0,50}/) || ['not found'])[0].replace(/\n/g, ' | '));
  R('and editing is deliberate', await page.getByRole('button', { name: /Edit this session/i }).count() === 1, 'Edit present');
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(400);
  const e = await state(page);
  R('editing then opens the form for that day', e.view === 'form' && e.dateInput === '2026-08-31', `${e.view} on ${e.dateInput}`);
  await browser.close();
}

// A finished past day still reads "done", not "7 of 7".
{
  const { browser, page } = await open({ at: TUE, seed: SEED });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  const txt = await page.evaluate(() => document.body.innerText);
  R('a finished day still reads done', /PUSH A DONE/i.test(txt), (txt.match(/PUSH A[^\n]*/) || [])[0]);
  await browser.close();
}

// A session never begun is still open to train today — catching up must work.
{
  const { browser, page } = await open({ at: TUE, seed: LIVE });
  await page.getByRole('button', { name: 'Push', exact: true }).click(); await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^Day B$/ }).click(); await page.waitForTimeout(400);
  const s = await state(page);
  R('an untouched session is still loggable today', s.view === 'form' && /Save Push B/.test(s.saveButton || ''),
    `view=${s.view}, button "${s.saveButton}"`);
  await browser.close();
}

// A past day with nothing on it is unchanged.
{
  const { browser, page } = await open({ at: TUE, seed: LIVE });
  await page.locator('input[type=date]').fill('2026-08-28'); await page.waitForTimeout(500);
  const s = await state(page);
  const txt = await page.evaluate(() => document.body.innerText);
  R('an empty past day still says not recorded', s.view === 'unrecorded' && !/It was started/.test(txt), `view=${s.view}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
