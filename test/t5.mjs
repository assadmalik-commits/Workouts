import { open, state, report, nav } from './lib.mjs';
const AT = '2026-08-31T14:00:00Z';

// B10 — negative and nonsense weights.
{
  const { browser, page } = await open({ at: AT });
  await page.getByText('Straight-Arm Pulldown').click();
  await page.waitForTimeout(200);
  await page.locator('input[type=number]').first().fill('-40');
  await page.locator('input[type=number]').nth(1).fill('12');
  await page.waitForTimeout(300);
  const body = await page.evaluate(() => document.body.innerText);
  report('B10 a negative weight is rejected', !/-40kg|-480 kg/.test(body),
    `summary line reads: ${(body.match(/Straight-Arm Pulldown\n([^\n]*)/) || [])[1]}; total shows ${(body.match(/(-?\d+) kg total/) || [])[0]}`);
  await browser.close();
}

// B11 — removing every set from a saved exercise.
{
  const { browser, page } = await open({ at: AT });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Edit this session/i }).click();
  await page.waitForTimeout(300);
  await page.getByText('Incline Dumbbell Press').click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /Remove set 1/ }).click();
    await page.waitForTimeout(150);
  }
  const s = await state(page);
  report('B11 emptying an exercise leaves the page coherent', s.view === 'form',
    `view=${s.view}; counter=${s.counter}`);
  await browser.close();
}

// B12 — history wording and ordering.
{
  const seed = {
    '2026-08-23': { 'Pull-A': { 'Face Pulls': { sets: [{w:'10',r:'15'},{w:'12',r:'12'}] } } },
    '2026-08-16': { 'Pull-A': { 'Face Pulls': { sets: [{w:'8',r:'15'}] } } },
  };
  const { browser, page } = await open({ at: AT, seed });
  await page.getByRole('button', { name: /Pull A history/i }).click();
  await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.body.innerText);
  const block = txt.slice(txt.indexOf('Pull A history'));
  report('B12 history lists each set as a pill, newest first',
    /Face Pulls\n10kg × 15\n12kg × 12/.test(block) &&
    block.indexOf('23 Aug') < block.indexOf('16 Aug'),
    block.split('\n').slice(0, 8).join(' | '));
  await browser.close();
}

// B13 — the weight BMI is computed from is the newest by date, whatever order
// the entries happen to be stored in. Weight now lives on the profile and can
// only be dated today, so the risk is no longer a past-dated entry winning —
// it is storage order deciding, which is an accident.
{
  // Deliberately out of order in storage, and carrying no note, so the
  // scrapped tab's migration leaves both entries where they are.
  const { browser, page } = await open({ at: AT, bw: [
    { date: '2026-08-25', weight: '72' },
    { date: '2026-08-30', weight: '69' },
  ], profile: { heightCm: '178' } });
  await nav(page, 'Stats');
  const txt = await page.evaluate(() => document.body.innerText);
  const bmi = (txt.match(/body mass index\n([\d.]+)/i) || [])[1];
  const reading = (txt.match(/(\d+(?:\.\d+)?) kg · 178 cm · (\d+ \w+ \d+)/i) || []);
  report('B13 BMI uses the newest weight by date, not by storage order',
    bmi === '21.8' && reading[1] === '69' && /30 Aug/i.test(reading[2] || ''),
    `BMI ${bmi} from ${reading[1]}kg dated ${reading[2]}`);
  await browser.close();
}
