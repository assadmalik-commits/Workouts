import { open, report } from './lib.mjs';
const seed = {
  '2026-08-23': { 'Push-A': { 'Incline Dumbbell Press': { sets: [{w:'10',r:'10'},{w:'12',r:'10'}] } } },
  '2026-08-30': { 'Push-A': { 'Incline Dumbbell Press': { sets: [{w:'14',r:'8'},{w:'16',r:'8'}] } } },
};
const { browser, page } = await open({ at: '2026-08-31T14:00:00Z', seed });
await page.locator('input[type=date]').fill('2026-08-30'); await page.waitForTimeout(400);
const doneTxt = await page.evaluate(() => document.body.innerText);
console.log('--- done card ---\n' + doneTxt.slice(doneTxt.indexOf('PUSH A DONE')));
await page.getByRole('button', { name: /Edit this session/i }).click(); await page.waitForTimeout(300);
await page.getByText('Incline Dumbbell Press').click(); await page.waitForTimeout(300);
const editTxt = await page.evaluate(() => document.body.innerText);
const last = (editTxt.match(/Last\n[^A-Z]{0,30}/) || [])[0];
report('the "Last" line lists each set as its own pill',
  /Last\n10kg × 10\n12kg × 10/.test(editTxt), (last || 'not found').replace(/\n/g, ' | '));
await browser.close();
