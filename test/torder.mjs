import { open, report, SEED, exercisesOf } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const AT = '2026-09-01T14:00:00Z';
const PLAN = exercisesOf('Push-A');

// Storage order deliberately scrambled: the second exercise moved to the end,
// exactly what renaming a key does to a JSON object.
const scrambled = {};
const src = SEED['2026-08-30']['Push-A'];
for (const n of PLAN.filter((n) => n !== PLAN[1])) scrambled[n] = src[n];
scrambled[PLAN[1]] = src[PLAN[1]];
const seed = { '2026-08-30': { 'Push-A': scrambled }, '2026-08-23': { 'Push-A': scrambled } };

const listed = (txt, from) => {
  const block = txt.slice(txt.indexOf(from));
  return PLAN.filter((n) => block.includes(n)).sort((a, b) => block.indexOf(a) - block.indexOf(b));
};

{
  const { browser, page } = await open({ at: AT, seed });
  console.log('   stored order puts', PLAN[1], 'last');

  // The record card, reached through the calendar.
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(500);
  const card = await page.evaluate(() => document.body.innerText);
  const cardOrder = listed(card, 'PUSH A');
  R('the record card follows the program order', JSON.stringify(cardOrder) === JSON.stringify(PLAN),
    cardOrder.slice(0, 3).join(' → '));
  R('and shows the sets as pills', /10kg × 10/.test(card) && !/4 sets · max/.test(card.slice(card.indexOf('PUSH A'), card.indexOf('Edit this session'))),
    'pills, no summary line');

  // The history, on the same session.
  await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Push', exact: true }).click(); await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^Day A$/ }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Push A history/i }).click(); await page.waitForTimeout(500);
  const hist = await page.evaluate(() => document.body.innerText);
  const histOrder = listed(hist, '23 Aug 2026');
  R('the history follows the same order', JSON.stringify(histOrder) === JSON.stringify(PLAN),
    histOrder.slice(0, 3).join(' → '));
  R('so the two agree', JSON.stringify(histOrder) === JSON.stringify(cardOrder), 'record card and history match');
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
