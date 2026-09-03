// The bar is for tapping: no selection, no callout, no tap flash.
import { open, report, nav, SEED } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const DIST = '/home/user/Workouts/dist/assets';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';

{
  const { browser, page } = await open({ at: MON });
  const css = await page.evaluate(() => {
    const pick = (el) => {
      const s = getComputedStyle(el);
      return {
        select: s.webkitUserSelect || s.userSelect,
        callout: s.webkitTouchCallout,
        flash: s.webkitTapHighlightColor,
      };
    };
    return {
      nav: pick(document.querySelector('nav')),
      label: pick(document.querySelector('nav button span')),
      save: pick(document.querySelector('[aria-label^="Save "]')),
    };
  });
  R('the bar itself is not selectable', css.nav.select === 'none', css.nav.select);
  R('nor are the labels inside it', css.label.select === 'none', css.label.select);
  R('nor is the save button', css.save.select === 'none', css.save.select);
  // -webkit-touch-callout is iOS-only: Chromium does not parse it, so it is in
  // neither the computed style nor the CSSOM. The built stylesheet is the only
  // place the shipped rule can be checked at all, and checking the computed
  // value instead would pass on a stylesheet that never declared it.
  const sheet = fs.readFileSync(
    path.join(DIST, fs.readdirSync(DIST).find((f) => f.endsWith('.css'))), 'utf8');
  const rule = (sheet.match(/\.app-bar[^{]*\{[^}]*\}/) || [''])[0];
  R('the rule that stops iOS raising a callout is shipped', /-webkit-touch-callout:\s*none/.test(rule),
    rule || 'no .app-bar rule in the stylesheet');

  R('and no grey tap flash', /rgba\(0, 0, 0, 0\)|transparent/.test(css.label.flash), css.label.flash);

  // Selecting across it must come back empty, not with "HomeStreakStatsProfile".
  const selected = await page.evaluate(() => {
    const bar = document.querySelector('nav');
    const range = document.createRange();
    range.selectNodeContents(bar);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString();
  });
  R('so dragging across it selects nothing', selected === '', JSON.stringify(selected));

  // Still a button, though.
  await nav(page, 'Stats');
  R('and it still navigates', /body mass index|two numbers missing/i.test(await page.evaluate(() => document.body.innerText)), 'moved to Stats');
  await browser.close();
}

// The section you are on is marked by a capsule behind it, the way the system
// tab bar does it — one at a time, and translucent so it lifts what the bar is
// already showing rather than painting over it.
{
  const { browser, page } = await open({ at: MON });
  const read = () => page.evaluate(() => {
    const el = document.querySelector('.app-capsule');
    const bg = el ? getComputedStyle(el).backgroundColor : '';
    const marked = document.querySelector('[aria-current="page"]');
    const span = marked && marked.querySelector('span');
    const r = el && el.getBoundingClientRect();
    const m = span && span.getBoundingClientRect();
    return {
      current: marked ? marked.textContent.trim() : null,
      capsules: document.querySelectorAll('.app-capsule').length,
      over: r && m ? Math.abs(r.left - m.left) < 2 && Math.abs(r.width - m.width) < 2 : false,
      alpha: Number((bg.match(/[\d.]+\)$/) || ['1)'])[0].slice(0, -1)),
    };
  });

  for (const section of ['Home', 'Streak', 'Stats', 'Profile']) {
    if (section !== 'Home') await nav(page, section);
    await page.waitForTimeout(420);
    const c = await read();
    R(`${section} is the only one wearing the capsule`,
      c.capsules === 1 && c.over && c.current === section,
      `${c.capsules} capsule(s), over the marked cell: ${c.over}, marked: ${c.current}`);
    R(`and it is the one marked for a screen reader`, c.current === section, String(c.current));
    R(`the capsule is coloured, and translucent rather than a paint layer`,
      c.alpha > 0 && c.alpha < 0.5, `alpha ${c.alpha}`);
  }
  await browser.close();
}

// It has to read in both themes, on grounds of opposite lightness.
{
  const { browser, page } = await open({ at: MON });
  const capsuleOf = () => page.evaluate(() => ({
    theme: document.documentElement.dataset.appTheme,
    bg: getComputedStyle(document.querySelector('.app-capsule')).backgroundColor,
  }));
  const light = await capsuleOf();
  await page.locator('[aria-label^="Switch to"]').click();
  await page.waitForTimeout(400);
  const dark = await capsuleOf();
  R('the two themes get their own capsule, not one shared value', light.bg !== dark.bg,
    `${light.theme} ${light.bg} vs ${dark.theme} ${dark.bg}`);
  await browser.close();
}

// The blur has to belong to the whole foot, not only to the two pills inside
// it. With it on the pills alone the 8px gap between them and the strip below
// the bar were clear windows: an exercise name scrolling past landed there
// razor-sharp between two frosted panels.
{
  const { browser, page } = await open({ at: MON, seed: SEED });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const foot = await page.evaluate(() => {
    const el = document.querySelector('nav').parentElement;
    const cs = getComputedStyle(el);
    const nav = document.querySelector('nav').getBoundingClientRect();
    const save = document.querySelector('[aria-label^="Save "]');
    const r = el.getBoundingClientRect();
    return {
      blur: cs.backdropFilter || cs.webkitBackdropFilter,
      // The gap the sharp text was landing in, and the strip under the bar.
      gap: save ? Math.round(nav.top - save.getBoundingClientRect().bottom) : null,
      below: Math.round(r.bottom - nav.bottom),
      coversToBottom: Math.abs(r.bottom - innerHeight) < 2,
      scrollable: document.body.scrollHeight > innerHeight + 40,
    };
  });
  R('the whole foot blurs what passes behind it', /blur\(\d/.test(foot.blur), String(foot.blur));
  R('including the gap between the two pills', foot.gap > 0, `${foot.gap}px of gap`);
  R('and the strip below the bar', foot.below > 0, `${foot.below}px below`);
  R('the blurred region reaches the bottom of the screen', foot.coversToBottom, 'reaches');
  R('and the page is long enough for this to matter', foot.scrollable, 'scrollable');
  await browser.close();
}

// The capsule is one element that travels, not one per section blinking in and
// out. Measured, because it hugs its label and "Profile" is wider than "Home".
{
  const { browser, page } = await open({ at: MON });
  const cap = () => page.evaluate(() => {
    const el = document.querySelector('.app-capsule');
    if (!el) return null;
    const nav = document.querySelector('nav').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const marked = document.querySelector('[aria-current="page"] > span').getBoundingClientRect();
    return {
      left: Math.round(r.left - nav.left),
      width: Math.round(r.width),
      onTheMarkedCell: Math.abs(r.left - marked.left) < 2 && Math.abs(r.width - marked.width) < 2,
      count: document.querySelectorAll('.app-capsule').length,
    };
  });

  const start = await cap();
  R('the capsule is placed before anything is tapped', start !== null, JSON.stringify(start));
  R('there is exactly one of it', start.count === 1, `${start.count}`);
  R('and it sits on the section that is marked', start.onTheMarkedCell, JSON.stringify(start));

  // Caught in flight: a jump would already be at its destination.
  await page.locator('nav button', { hasText: /^Profile$/ }).click();
  await page.waitForTimeout(70);
  const flight = await cap();
  await page.waitForTimeout(500);
  const landed = await cap();
  R('tapping another section moves it', landed.left !== start.left, `${start.left} -> ${landed.left}`);
  R('and it travels rather than jumping',
    flight.left > start.left && flight.left < landed.left,
    `start ${start.left}, in flight ${flight.left}, landed ${landed.left}`);
  R('it lands on the marked cell', landed.onTheMarkedCell, JSON.stringify(landed));

  // Every section, since the widths differ.
  for (const section of ['Home', 'Streak', 'Stats', 'Profile']) {
    await nav(page, section);
    await page.waitForTimeout(450);
    const c = await cap();
    R(`and lines up on ${section}`, c.onTheMarkedCell, `left ${c.left}, width ${c.width}`);
  }
  await browser.close();
}

// Movement is a preference, and some people have turned it off.
{
  const { browser, page } = await open({ at: MON });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('.app-capsule')).transitionDuration);
  R('reduced motion turns the travel off', /^0s(, 0s)*$/.test(d), d);
  await browser.close();
}
// The iPhone home indicator lives at the very bottom of the screen and its
// swipe-up band reaches above it. A published page runs in an iframe where
// env(safe-area-inset-bottom) reports 0, so the floor in the bar's padding is
// the only thing holding the nav clear of it. At 0.5rem the indicator was
// drawn across the nav's bottom edge and ate taps meant for the buttons.
{
  const { browser, page } = await open({ at: MON });
  const gap = await page.evaluate(() => {
    const nav = document.querySelector('.app-nav').getBoundingClientRect();
    return Math.round(innerHeight - nav.bottom);
  });
  R('the nav clears the home indicator band', gap >= 20, gap + 'px below the nav');

  // Lifting the bar is only safe if the page still scrolls past it.
  const covered = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    const bar = document.querySelector('.app-bar').getBoundingClientRect();
    // The last thing with real text in it, not a full-height wrapper.
    const els = [...document.querySelectorAll('p, h1, h2, h3, button, span, div')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() && e.getBoundingClientRect().height > 0)
      .filter((e) => !e.closest('.app-bar'));
    const last = els[els.length - 1];
    return { name: last.textContent.trim().slice(0, 30), bottom: Math.round(last.getBoundingClientRect().bottom), barTop: Math.round(bar.top) };
  });
  R('the last of the page still scrolls clear of the bar', covered.bottom <= covered.barTop,
    `"${covered.name}" ends at ${covered.bottom}, bar starts at ${covered.barTop}`);
  await browser.close();
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
