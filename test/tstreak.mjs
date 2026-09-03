// The streak: days in a row, Saturday stepped over, today left open.
import { open, report, nav, bodyText, wholeSession } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };

// Sun 30 Aug through Fri 4 Sep, one finished session a day, in program order.
const WEEK = {
  '2026-08-30': { 'Push-A': wholeSession('Push-A') },
  '2026-08-31': { 'Pull-A': wholeSession('Pull-A') },
  '2026-09-01': { 'Legs-A': wholeSession('Legs-A') },
  '2026-09-02': { 'Push-B': wholeSession('Push-B') },
  '2026-09-03': { 'Pull-B': wholeSession('Pull-B') },
  '2026-09-04': { 'Legs-B': wholeSession('Legs-B') },
};
const only = (...days) => Object.fromEntries(days.map((d) => [d, WEEK[d]]));

const readStreak = async (page) => {
  await nav(page, 'Streak');
  const txt = await bodyText(page);
  return {
    txt,
    current: Number((txt.match(/\n(\d+)\n(?:day|days) in a row/i) || [])[1]),
    longest: Number((txt.match(/Longest\n(\d+)/i) || [])[1]),
  };
};

// Two days done, today still open. Today is not a day you missed.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: only('2026-08-30', '2026-08-31') });
  const s = await readStreak(page);
  R('two finished days in a row read 2', s.current === 2, `read ${s.current}`);
  R('today being unfinished does not break it', !/Last broken/.test(s.txt),
    (s.txt.match(/Finish[^\n]*|Last broken[^\n]*/) || ['none'])[0]);
  R('and it names what would keep it', /Finish Legs A today to keep it/.test(s.txt),
    (s.txt.match(/Finish[^\n]*/) || ['none'])[0]);
  await browser.close();
}

// A skipped weekday breaks it, and the page says which day and what was due.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: only('2026-08-30') });
  const s = await readStreak(page);
  R('a skipped Monday breaks the streak', s.current === 0, `read ${s.current}`);
  R('the longest run is still remembered', s.longest === 1, `read ${s.longest}`);
  R('and the day it broke on is named', /31 Aug 2026/.test(s.txt), (s.txt.match(/Last broken[^\n]*/) || ['none'])[0]);
  R('with the session that was due', /Pull A was due/.test(s.txt), (s.txt.match(/\w+ [AB] was due/) || ['none'])[0]);
  await browser.close();
}

// Saturday is rest. It neither counts nor breaks.
{
  const { browser, page } = await open({ at: '2026-09-05T14:00:00Z', seed: WEEK });
  const s = await readStreak(page);
  R('six days Sunday to Friday read 6 on the Saturday', s.current === 6, `read ${s.current}`);
  R('and Saturday is not listed as missed', !/05 Sep 2026/.test(s.txt), 'not listed');
  R('the rest day is said to cost nothing', /Saturday is rest/.test(s.txt), (s.txt.match(/Saturday[^\n]*/) || ['none'])[0]);
  await browser.close();
}

// The streak steps over the rest day into the next week, which the 6-of-6
// counter cannot do.
{
  const { browser, page } = await open({ at: '2026-09-06T14:00:00Z', seed: WEEK });
  const s = await readStreak(page);
  R('the streak survives into the new week', s.current === 6, `read ${s.current}`);
  R('while the week counter has reset', /this week\n0of 6/i.test(s.txt),
    (s.txt.match(/this week\n\d+of 6/i) || ['none'])[0].replace(/\n/g, ' '));
  await browser.close();
}

// And a seventh day extends it past the rest day.
{
  const seed = { ...WEEK, '2026-09-06': { 'Push-A': wholeSession('Push-A') } };
  const { browser, page } = await open({ at: '2026-09-06T18:00:00Z', seed });
  const s = await readStreak(page);
  R('training the Sunday after makes it 7', s.current === 7, `read ${s.current}`);
  await browser.close();
}

// A session started and abandoned is a different thing from not turning up.
{
  const seed = {
    ...only('2026-08-30'),
    '2026-08-31': { 'Pull-A': { 'Straight-Arm Pulldown': { sets: [{ w: '15', r: '12' }] } } },
  };
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed });
  const s = await readStreak(page);
  R('an unfinished session still breaks the streak', s.current === 0, `read ${s.current}`);
  R('but is recorded as started, not missed', /Started — 1 of 7 exercises/.test(s.txt),
    (s.txt.match(/Started[^\n]*|Pull A was due/) || ['none'])[0]);
  await browser.close();
}

// Nothing logged at all is not a broken streak, it is one that has not started.
{
  const { browser, page } = await open({ at: '2026-09-01T14:00:00Z', seed: {} });
  const s = await readStreak(page);
  R('an empty log reads 0 without claiming a break', s.current === 0 && /the streak starts/.test(s.txt),
    (s.txt.match(/Finish every[^\n]*|Last broken[^\n]*/) || ['none'])[0]);
  R('and nothing is listed as missed', /Nothing missed since you started/.test(s.txt), 'clean');
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
