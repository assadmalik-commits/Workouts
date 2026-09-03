import { open, state, report, SEED } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
// Fixed, not the live log — that file is overwritten with real training and a
// test reading it changes meaning underneath. Push A finished Sunday; Pull A
// begun Monday, 2 of 7.
const LIVE = {
  ...SEED,
  '2026-08-31': {
    'Pull-A': {
      'Straight-Arm Pulldown': { sets: [{ w: '15.8', r: '15' }, { w: '18', r: '15' }, { w: '20.3', r: '12' }] },
      'Chest-Supported T-Bar Row': { sets: [{ w: '32', r: '10' }, { w: '41', r: '8' }] },
    },
  },
};
const MON = '2026-08-31T19:50:00Z';

// Assad's real state tonight: Push A finished Sunday, 2 of 7 of Pull A done.
{
  const { browser, page } = await open({ at: MON, seed: LIVE });
  const s = await state(page);
  R('a session 2 of 7 done does not count toward the week', s.counter === '1/6 this week', s.counter);
  R('and the rotation stays on it', s.activeTab === 'Pull' && s.activeVariant === 'Day A' && /Next: Pull A · today/.test(s.bodySnippet),
    `${s.activeTab} ${s.activeVariant} | ${(s.bodySnippet.match(/Next: [^\n]*/) || [])[0]}`);
  const ticked = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter(b => /^Day A/.test(b.textContent.trim()))
      .some(b => b.querySelector('svg')));
  R('and Day A is not ticked', !ticked, ticked ? 'still ticked' : 'no tick');
  R('the work logged is still shown', /3 sets · max 20\.3kg/.test(s.bodySnippet) || /Straight-Arm/.test(s.bodySnippet), 'sets visible');
  await browser.close();
}

// Finish every exercise and the day ticks over.
{
  const full = JSON.parse(JSON.stringify(LIVE));
  for (const n of ['Lat Pulldown', 'Cable Row (wide grip)', 'Face Pulls', 'Incline Dumbbell Curl', 'Cable Curl'])
    full['2026-08-31']['Pull-A'][n] = { sets: [{ w: '20', r: '10' }] };
  const { browser, page } = await open({ at: MON, seed: full });
  const s = await state(page);
  R('all seven done counts toward the week', s.counter === '2/6 this week', s.counter);
  R('and the rotation moves on', s.activeTab === 'Legs' && s.activeVariant === 'Day A', `${s.activeTab} ${s.activeVariant}`);
  await browser.close();
}

// A part-done day is still a recorded day, not a gap in the log.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: LIVE });
  await page.locator('input[type=date]').fill('2026-08-31'); await page.waitForTimeout(450);
  const s = await state(page);
  R('a part-done past day is not called unrecorded', s.view !== 'unrecorded', `view=${s.view}`);
  await browser.close();
}

// And a part-done session stays open to finish, rather than locking.
{
  const { browser, page } = await open({ at: MON, seed: LIVE });
  const s = await state(page);
  R('a part-done session stays open to finish', s.view === 'form' && /Save Pull A/.test(s.saveButton || ''),
    `view=${s.view}, button "${s.saveButton}"`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
