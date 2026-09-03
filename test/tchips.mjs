import { open, report, SEED, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const AT = '2026-09-01T14:00:00Z';

// History: a pill per set, no run-on sentence.
{
  const seed = {
    ...SEED,
    '2026-08-23': { 'Pull-A': { ...wholeSession('Pull-A'), 'Straight-Arm Pulldown': { sets: [{w:'15.8',r:'15'},{w:'18',r:'15'},{w:'20.3',r:'12'}] } } },
  };
  const { browser, page, errors } = await open({ at: AT, seed });
  await page.getByRole('button', { name: 'Pull', exact: true }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Pull A history/i }).click(); await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  // Each pill is its own block, so the sets land on their own lines.
  R('each set is its own pill',
    /Straight-Arm Pulldown\n15\.8kg × 15\n18kg × 15\n20\.3kg × 12/.test(txt),
    (txt.match(/Straight-Arm Pulldown\n[^A-Z]{0,40}/) || ['not found'])[0].replace(/\n/g, ' | '));
  R('and the run-on sentence is gone', !/15\.8kg × 15 reps, 18kg/.test(txt), 'no prose list');
  R('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// The Last line while logging gets the same treatment.
{
  const seed = { ...SEED, '2026-08-24': { 'Legs-A': { 'Back Squat': { sets: [{w:'60',r:'8'},{w:'70',r:'6'}] } } } };
  const { browser, page } = await open({ at: AT, seed });
  await page.getByRole('button', { name: 'Legs', exact: true }).click(); await page.waitForTimeout(300);
  await page.getByText('Back Squat', { exact: true }).click(); await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  R('the Last line is labelled and chipped', /Last\n60kg × 8\n70kg × 6/.test(txt) || (/Last/.test(txt) && /60kg × 8/.test(txt)),
    (txt.match(/Last[\s\S]{0,40}/) || [])[0].replace(/\n/g, ' / '));
  R('with no "reps" prose left', !/60kg × 8 reps, 70kg/.test(txt), 'clean');
  await browser.close();
}

// Bodyweight sets still read BW.
{
  const seed = { ...SEED, '2026-08-23': { 'Push-A': { ...wholeSession('Push-A'), 'Deficit Push-Ups': { sets: [{w:'0',r:'12'}] } } } };
  const { browser, page } = await open({ at: AT, seed });
  // Push A is finished, so selecting Push lands on B — pick A deliberately.
  await page.getByRole('button', { name: 'Push', exact: true }).click(); await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^Day A$/ }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Push A history/i }).click(); await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  R('a bodyweight set reads BW in its pill', /BW × 12/.test(txt), (txt.match(/BW × \d+/) || ['missing'])[0]);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
