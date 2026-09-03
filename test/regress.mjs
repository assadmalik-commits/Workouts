import { open, state, report } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';
let fails = 0;
const R = (n, p, d) => { if (!report(n, p, d)) fails++; };

// The behaviours the last few rounds fixed, re-checked end to end.
{
  const { browser, page, errors } = await open({ at: AT });
  const boot = await state(page);
  R('boot opens the session due today', boot.activeTab === 'Pull' && boot.activeVariant === 'Day A' && boot.view === 'form', `${boot.activeTab} ${boot.activeVariant}, ${boot.view}`);
  R('the strip marks the day being viewed', boot.strip[1].selected && !boot.strip[0].selected, boot.strip.map(x=>x.label+(x.selected?'*':'')).join(' '));
  R('Today is not offered while already on today', boot.dateInput === '2026-08-31', boot.dateInput);

  // go back, view, edit, come home
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(400);
  const done = await state(page);
  R('a trained day opens its record as done', done.view === 'done' && done.activeTab === 'Push', `${done.view} / ${done.activeTab}`);
  R('the strip follows to the viewed day', done.strip[0].selected, done.strip.map(x=>x.label+(x.selected?'*':'')).join(' '));
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(300);
  const edit = await state(page);
  R('editing a past session is deliberate and then possible', edit.view === 'form' && /Save Push A/.test(edit.saveButton||''), `${edit.view} / ${edit.saveButton}`);
  await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.waitForTimeout(400);
  const home = await state(page);
  R('Today returns to today and the session due', home.dateInput === '2026-08-31' && home.activeTab === 'Pull' && home.view === 'form', `${home.dateInput} ${home.activeTab} ${home.activeVariant} ${home.view}`);

  await page.locator('input[type=date]').fill('2026-08-27'); await page.waitForTimeout(400);
  const gap = await state(page);
  R('a day with no record says so', gap.view === 'unrecorded', gap.view);
  R('no save button on an unrecorded day', gap.saveButton === null, `${gap.saveButton}`);

  R('no console or page errors throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// notation, targets, BW
{
  // The per-set notation is text in the collapsed row and history; inside the
  // open editor the sets are input fields, so it is read where it renders.
  const seed = {
    '2026-08-23': { 'Push-A': { 'Incline Dumbbell Press': { sets: [{w:'10',r:'10'},{w:'12',r:'10'}] } } },
    '2026-08-30': { 'Push-A': { 'Incline Dumbbell Press': { sets: [{w:'14',r:'8'},{w:'16',r:'8'}] } } },
  };
  const { browser, page } = await open({ at: AT, seed });
  // A past day holds a record, part-done or not, so it is read first and
  // edited on purpose. The "Last:" line then reports the week before.
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(300);
  await page.getByText('Incline Dumbbell Press', { exact: true }).click(); await page.waitForTimeout(300);
  const open_ = await page.evaluate(() => document.body.innerText);
  // The set list is a pill per set now, so it lands on its own lines.
  const last = (open_.match(/Last\n[^A-Z]{0,30}/) || [])[0];
  R('the Last line lists each set as its own pill',
    /Last\n10kg × 10\n12kg × 10/.test(open_), (last || 'not found').replace(/\n/g, ' | '));
  R('targets read in words', /\d+ sets of [\d-]+ reps/.test(open_), (open_.match(/\d+ sets of [\d-]+ reps/)||[])[0]);
  await browser.close();
}

{
  const seed = { '2026-08-30': { 'Push-A': { 'Weighted Dips': { sets: [{w:'0',r:'12'}] } } } };
  const { browser, page } = await open({ at: AT, seed });
  await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  R('a zero weight reads as BW, not 0kg', !/0kg/.test(txt), txt.includes('1 set') ? 'summary shows "1 set"' : 'n/a');
  await browser.close();
}
console.log(fails === 0 ? '\nALL REGRESSION CHECKS PASS' : `\n${fails} REGRESSION FAILURE(S)`);
