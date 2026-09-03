// Publishing reloads every open view, including this one. The marker that puts
// the lifter back has to describe where they are when the reload lands — not
// where they were when they pressed the button that caused it.
import { open, state, report, nav, bodyText, SEED } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';

// The reported bug: save a weight, move to another section, and the publish's
// reload arrives and drops you back where you saved. The weight now lives on
// Stats, so the move under test is Stats to Profile.
{
  const { browser, page } = await open({ at: MON, bw: [], profile: { heightCm: '178' } });
  await nav(page, 'Stats');
  await page.locator('#stats-weight').fill('69');
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Save weight"]').click();
  await page.waitForTimeout(400);
  await nav(page, 'Profile');
  // What a publish does to the page it was called from.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const txt = await bodyText(page);
  R('saving a weight then moving to Profile stays on Profile',
    /date of birth/i.test(txt) && !/body mass index/i.test(txt), txt.replace(/\n/g, ' | ').slice(0, 120));
  await browser.close();
}

// Every section, not just that one.
{
  const { browser, page } = await open({ at: MON });
  // Home is recognised by the week strip, not by the Save button: what that
  // button says depends on whether anything has been logged.
  for (const [section, marker] of [['Streak', /days? in a row/i], ['Profile', /date of birth/i], ['Home', /this week/i]]) {
    await nav(page, section);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const txt = await bodyText(page);
    R(`a reload on ${section} comes back to ${section}`, marker.test(txt), txt.split('\n').slice(0, 2).join(' | '));
  }
  await browser.close();
}

// And the guarantee it was written for still holds: a save mid-session must not
// read as being moved on to the next one.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: SEED });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  const before = await state(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const after = await state(page);
  R('a past date being looked at survives a reload',
    after.dateInput === '2026-08-30' && after.activeTab === before.activeTab,
    `${before.dateInput}/${before.activeTab} → ${after.dateInput}/${after.activeTab}`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
