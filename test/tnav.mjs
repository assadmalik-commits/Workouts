// The bottom bar: four sections, and what belongs to each.
import { open, state, report, nav, bodyText, SEED } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';

{
  const { browser, page, errors } = await open({ at: MON });
  const labels = await page.locator('nav button').allInnerTexts();
  R('four sections, in order', labels.join('|') === 'Home|Streak|Stats|Profile', labels.join('|'));

  for (const [label, marker] of [['Streak', /days? in a row/i], ['Stats', /body mass index|two numbers missing/i], ['Profile', /date of birth/i]]) {
    await nav(page, label);
    const txt = await bodyText(page);
    R(`${label} opens its own page`, marker.test(txt), txt.split('\n').slice(0, 3).join(' | '));
  }

  await nav(page, 'Home');
  const s = await state(page);
  R('and Home comes back to the session', s.activeTab === 'Pull' && /Save Pull A/.test(s.saveButton || ''), `${s.activeTab} / ${s.saveButton}`);
  R('no page errors while moving between them', errors.length === 0, errors.join('; '));
  await browser.close();
}

// The Save bar is the session's, so it is not offered on a page that has no
// session to save.
{
  const { browser, page } = await open({ at: MON });
  const onHome = await page.locator('[aria-label="Save Pull A"]').count();
  await nav(page, 'Streak');
  const onStreak = await page.locator('[aria-label="Save Pull A"]').count();
  R('Save shows on Home', onHome === 1, `${onHome}`);
  R('and not on Streak', onStreak === 0, `${onStreak}`);
  await browser.close();
}

// Home is the way back to today. Leaving a past date open and coming back
// through the bar should not strand the lifter in the past.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: SEED });
  await page.locator('input[type=date]').fill('2026-08-30');
  await page.waitForTimeout(400);
  const away = await state(page);
  await nav(page, 'Profile');
  await nav(page, 'Home');
  await nav(page, 'Home');
  const back = await state(page);
  R('a past date can still be opened', away.dateInput === '2026-08-30', away.dateInput);
  R('and tapping Home from Home returns to today', back.dateInput === '2026-09-01', back.dateInput);
  await browser.close();
}

// The bar must not cover the last thing on the page.
{
  const { browser, page } = await open({ at: MON });
  // Scrolled all the way down, the last thing on the page must still be above
  // the bar — the padding at the foot of the page is what buys that.
  const clear = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 200));
    const bar = document.querySelector('nav').parentElement.getBoundingClientRect();
    const last = [...document.querySelectorAll('button')]
      .find((b) => / history/i.test(b.textContent));
    return { barTop: bar.top, contentBottom: last.getBoundingClientRect().bottom };
  });
  R('the page scrolls clear of the fixed bar', clear.contentBottom <= clear.barTop,
    `content ends at ${clear.contentBottom.toFixed(0)}, bar starts at ${clear.barTop.toFixed(0)}`);
  await browser.close();
}

// The Save control is one button in two states: filled and named when there is
// something unsaved, quiet and saying so when there is not.
{
  const { browser, page } = await open({ at: MON });
  const look = () => page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Save "]');
    return b && { name: b.getAttribute('aria-label'), text: b.textContent.trim(), filled: b.className.includes('bg-mint') };
  });
  const idle = await look();
  // A session with nothing in it has had nothing saved, and the button now
  // says so rather than claiming a save that never happened.
  R('nothing typed: the button is quiet and says nothing was entered',
    /no sets entered/i.test(idle.text) && !idle.filled, `"${idle.text}" filled=${idle.filled}`);
  R('and still names the session for a screen reader', idle.name === 'Save Pull A', idle.name);

  await page.getByText('Straight-Arm Pulldown', { exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('input[type=number]').first().fill('25');
  await page.locator('input[type=number]').nth(1).fill('12');
  await page.waitForTimeout(800);
  const dirty = await look();
  R('a typed set fills it and names what it saves', dirty.text === 'Save Pull A' && dirty.filled, `"${dirty.text}" filled=${dirty.filled}`);

  await page.locator('[aria-label="Save Pull A"]').click();
  // Past the 1.5s confirmation flash, which deliberately keeps it filled.
  await page.waitForTimeout(2000);
  const after = await look();
  R('and pressing it puts the button back to quiet', after.text === 'Saved' && !after.filled, `"${after.text}" filled=${after.filled}`);
  await browser.close();
}

// It is a fixed strip, so measure what it actually costs the screen.
//
// Two numbers, because they are two different things. What the lifter called
// too big was the CHROME — a solid strip and a filled green slab taking a
// seventh of the screen. Below the pills is a transparent gutter that the page
// scrolls behind, and that gutter has to hold the nav clear of the iPhone home
// indicator, whose swipe-up band was otherwise eating taps. Lifting the bar
// grew the gutter from 8px to 24px and left the pills at 107px, exactly as
// they were. Measuring both together would have called that a regression in
// visual weight when nothing visible changed size, so the seventh now guards
// the pills and a looser ceiling keeps the gutter honest.
{
  const { browser, page } = await open({ at: MON });
  const box = await page.evaluate(() => {
    const bar = document.querySelector('.app-bar').getBoundingClientRect();
    const nav = document.querySelector('.app-nav').getBoundingClientRect();
    const save = document.querySelector('[aria-label^="Save "]')?.getBoundingClientRect();
    const top = save ? Math.min(save.top, nav.top) : nav.top;
    return { pills: nav.bottom - top, whole: bar.height };
  });
  R('the visible foot stays under a seventh of the screen', box.pills < 820 / 7,
    `pills ${Math.round(box.pills)}px of ${Math.round(820 / 7)}px`);
  R('and the whole foot, gutter included, stays under a fifth', box.whole < 820 / 5,
    `foot ${Math.round(box.whole)}px of ${Math.round(820 / 5)}px`);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
