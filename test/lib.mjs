import { chromium } from 'playwright';

export const TZ = 'Asia/Dubai';
export const URL = 'http://localhost:4300/';

// A finished Push A on Sunday 30 August — every exercise the session asks for,
// because a session only counts as trained when all of them are logged.
export const SEED = {
  '2026-08-30': {
    'Push-A': {
      'Incline Dumbbell Press': { sets: [{w:'10',r:'10'},{w:'12',r:'10'},{w:'14',r:'8'},{w:'16',r:'8'}] },
      'Deficit Push-Ups': { sets: [{w:'0',r:'10'},{w:'0',r:'10'},{w:'0',r:'10'}] },
      'Cable Flyes (low-to-high)': { sets: [{w:'3',r:'15'},{w:'6',r:'12'},{w:'6',r:'12'}] },
      'Seated Dumbbell Shoulder Press': { sets: [{w:'10',r:'10'},{w:'12',r:'10'},{w:'14',r:'10'},{w:'14',r:'10'}] },
      'Cable Lateral Raise (lean away)': { sets: [{w:'2',r:'15'},{w:'2',r:'15'},{w:'2',r:'15'},{w:'2',r:'15'}] },
      'Rope Tricep Pushdown': { sets: [{w:'12',r:'12'},{w:'14',r:'12'},{w:'14',r:'12'}] },
      'Overhead Cable Tricep Extension': { sets: [{w:'12',r:'12'},{w:'14',r:'12'},{w:'14',r:'12'}] },
    },
  },
};

// The program's own exercise names, read from source, so fixtures stay true as
// the program changes. A session only counts as trained when all of them are
// logged, so a seed that means "trained" has to list them all.
import fs from 'fs';
const PLAN = fs.readFileSync('/home/user/Workouts/src/plan.js', 'utf8');
export const exercisesOf = (slot) => {
  const [day, variant] = slot.split('-');
  const dayBlock = PLAN.slice(PLAN.indexOf(`${day}: {`));
  const from = dayBlock.indexOf(`${variant}: {`);
  const next = variant === 'A' ? dayBlock.indexOf('B: {', from) : dayBlock.length;
  return [...dayBlock.slice(from, next).matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
};
export const wholeSession = (slot, w = '20', r = '10') =>
  Object.fromEntries(exercisesOf(slot).map((n) => [n, { sets: [{ w, r }] }]));

export async function open({ seed = SEED, bw = [], profile = null, at = null, tz = TZ } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    timezoneId: tz, locale: 'en-GB',
    viewport: { width: 440, height: 820 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  if (at) await ctx.clock.install({ time: new Date(at) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  // Seed once, not on every navigation — re-seeding on reload masks whether
  // the app itself kept anything.
  await page.addInitScript(([s, b, p]) => {
    if (localStorage.getItem('__seeded__')) return;
    localStorage.setItem('__seeded__', '1');
    localStorage.setItem('workout-logs', JSON.stringify(s));
    localStorage.setItem('bodyweight-logs', JSON.stringify(b));
    if (p) localStorage.setItem('profile', JSON.stringify(p));
  }, [seed, bw, profile]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return { browser, ctx, page, errors };
}

// What the app is showing right now, as plain facts.
export async function state(page) {
  return page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent?.trim() || null;
    const body = document.body.innerText;
    const activeTab = [...document.querySelectorAll('.flex.px-4 button')]
      .find((b) => b.className.includes('bg-fg'))?.textContent.trim() || null;
    const activeVariant = [...document.querySelectorAll('button')]
      .filter((b) => /^Day [AB]$/.test(b.textContent.trim()))
      .find((b) => !b.className.includes('bg-surface'))?.textContent.trim() || null;
    const strip = [...document.querySelectorAll('.grid-cols-7 button')].map((b) => ({
      label: b.querySelector('span')?.textContent.trim(),
      selected: b.className.includes('bg-fg'),
      today: b.className.includes('border-fg/40'),
    }));
    return {
      header: t('header .text-\\[15px\\]'),
      dateInput: document.querySelector('input[type=date]')?.value || null,
      activeTab, activeVariant, strip,
      // The save control's label changes with whether anything is unsaved; its
      // accessible name does not, and that is what "this session is open for
      // logging" actually means.
      saveButton: document.querySelector('[aria-label^="Save "]')?.getAttribute('aria-label') || null,
      savePending: (() => {
        const b = document.querySelector('[aria-label^="Save "]');
        return b ? !/^Saved$/.test(b.textContent.trim()) : null;
      })(),
      view: /session not recorded/i.test(body) ? 'unrecorded'
        : /rest day/i.test(body) ? 'rest'
        : /\b(push|pull|legs) [ab] (done|· \d+ of \d+)/i.test(body) ? 'done'
        : /body weight \(kg\)/i.test(body) ? 'bodyweight'
        : 'form',
      counter: (body.match(/(\d+)\/(\d+) this week/) || [null])[0],
      bodySnippet: body.slice(0, 400),
    };
  });
}

export function report(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n      ' + detail : ''}`);
  return pass;
}

// The bottom bar is the only way between sections, so tests go through it too.
export async function nav(page, label) {
  await page.locator('nav button', { hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForTimeout(250);
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText);
