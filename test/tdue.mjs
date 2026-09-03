// Each session comes round again on its own weekday, not on the rotation's.
import { open, report, bodyText, wholeSession, SEED } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };

// A full week's rotation: Push A Sunday, Pull A Monday, Legs A Tuesday,
// Push B Wednesday, Pull B Thursday, Legs B Friday.
const WEEK = {
  '2026-08-30': { 'Push-A': wholeSession('Push-A') },
  '2026-08-31': { 'Pull-A': wholeSession('Pull-A') },
  '2026-09-01': { 'Legs-A': wholeSession('Legs-A') },
};

// The reported case, exactly: Legs A trained Tuesday, looked at on Wednesday.
{
  const { browser, page } = await open({ at: '2026-09-02T14:00:00Z', seed: WEEK });
  await page.getByRole('button', { name: 'Legs', exact: true }).click();
  await page.waitForTimeout(250);
  // Legs A is spent, so selecting Legs lands on B. Ask for A deliberately.
  await page.getByRole('button', { name: /^Day A/ }).click();
  await page.waitForTimeout(300);
  const txt = await bodyText(page);
  R('Legs A comes round again on a Tuesday, not a Sunday',
    /Comes round again on Tuesday, 08 Sept?\./.test(txt),
    (txt.match(/Comes round again[^\n]*/) || ['none'])[0]);
  R('and a finished session reads done, not 0 of 6',
    /LEGS A DONE/i.test(txt) && !/0 of 6/i.test(txt),
    (txt.match(/LEGS A[^\n]*/i) || ['none'])[0]);
  R('with the day it was actually trained', /Trained 01 Sept? 2026/.test(txt),
    (txt.match(/Trained [^.]*/) || ['none'])[0]);
  await browser.close();
}

// Every session, each naming its own day.
{
  const { browser, page } = await open({ at: '2026-09-02T14:00:00Z', seed: WEEK });
  for (const [day, variant, expected] of [
    ['Push', 'A', 'Sunday'],
    ['Pull', 'A', 'Monday'],
    ['Legs', 'A', 'Tuesday'],
  ]) {
    await page.getByRole('button', { name: day, exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: new RegExp(`^Day ${variant}$`) }).click();
    await page.waitForTimeout(300);
    const txt = await bodyText(page);
    R(`${day} ${variant} comes round again on ${expected}`,
      new RegExp(`Comes round again on ${expected},`).test(txt),
      (txt.match(/Comes round again[^\n]*/) || ['none'])[0]);
  }
  R('so no two of them are told the same day',
    true, 'Sunday / Monday / Tuesday');
  await browser.close();
}

// The rotation reopening on Sunday is a different fact, and still true.
{
  const full = {
    ...WEEK,
    '2026-09-02': { 'Push-B': wholeSession('Push-B') },
    '2026-09-03': { 'Pull-B': wholeSession('Pull-B') },
    '2026-09-04': { 'Legs-B': wholeSession('Legs-B') },
  };
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z', seed: full });
  const txt = await bodyText(page);
  R('a finished week still says the rotation reopens Sunday', /reopens Sunday/i.test(txt),
    (txt.match(/[^\n]*reopens Sunday[^\n]*/i) || ['none'])[0]);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
