// The published page runs inside the host's document, and the host does not
// merely wrap it: its frame runtime writes its OWN theme into our document once
// __frame_init arrives — `t.dataset.theme = e; t.style.colorScheme = e` — where
// e is the viewer's Claude app theme, not the app's preference. That is an
// inline style, so it outranks the stylesheet rule it collides with:
//
//   html { color-scheme: dark }                      <- our unconditional base
//   html[data-app-theme='light'] { color-scheme: light }
//
// It arrives after our boot script has already painted. So this suite watches
// every frame with the host behaving the way the live runtime actually does,
// including the case that matters: a light preference viewed from a dark
// Claude app.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const art = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
// The build under test, never a version-numbered fixture: this suite was pinned
// to training-log-v95.html and so spent four versions testing old code.
const built = fs.readFileSync(path.join(art, 'current.html'), 'utf8');
const bakedAs = (t) => built.replace(/name="app-theme" content="[a-z]+"/, `name="app-theme" content="${t}"`);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const run = async (label, want, hostTheme, phone) => {
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', viewport:{width:440,height:820}, deviceScaleFactor:3,
    isMobile:true, hasTouch:true, colorScheme: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  await page.addInitScript((host) => {
    window.__f = [];
    const tick = () => { try {
      const el = document.body || document.documentElement;
      const m = getComputedStyle(el).backgroundColor.match(/\d+/);
      const s = m ? (Number(m[0]) < 128 ? 'dark' : 'light') : null;
      if (s && s !== window.__f[window.__f.length-1]) window.__f.push(s);
    } catch (e) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // Safari discards this frame's storage with the tab, and blocks its cookies.
    try { Object.defineProperty(document, 'cookie', { get: () => '', set: () => {}, configurable: true }); } catch (e) {}
    // What the host's runtime does to our document when __frame_init lands:
    // exactly the body of Q() in the live frame-runtime, on the host's own
    // timing — after our boot script, around when the app is mounting.
    setTimeout(() => {
      try {
        const t = document.documentElement;
        t.dataset.theme = host;
        t.style.colorScheme = host;
      } catch (e) {}
    }, 250);
  }, hostTheme);
  await page.addInitScript(stub(), [false, { 'meta/prefs': { theme: want, updatedAt:'x' },
    'sessions/2026-09-01': { date:'2026-09-01', slots:{ 'Legs-A': { 'Back Squat': { sets:[{w:'60',r:'8'}] } } }, updatedAt:'x' } }, false]);
  const file = `host-${want}.html`;
  fs.writeFileSync(path.join(art, file), bakedAs(want));
  await page.goto('http://127.0.0.1:4320/' + file, { waitUntil:'commit' });
  await page.waitForTimeout(3000);
  const frames = await page.evaluate(() => window.__f);
  ok(`${label}: every frame is ${want}`, frames.length === 1 && frames[0] === want, 'frames ' + frames.join(' -> '));
  ok(`${label}: settles on ${want}`, await page.evaluate(() => document.documentElement.dataset.appTheme) === want,
    await page.evaluate(() => document.documentElement.dataset.appTheme));
  ok(`${label}: no page errors`, errors.length === 0, errors.join(';'));
  await ctx.close();
};

// The Claude app agreeing with the preference is the easy half.
await run('dark preference, dark Claude app', 'dark', 'dark', 'dark');
await run('light preference, light Claude app', 'light', 'light', 'light');
// And the half he is actually living in: the app set to Light while Claude
// itself is dark. The host writes colorScheme:dark over our light document.
await run('light preference, DARK Claude app', 'light', 'dark', 'dark');
await run('dark preference, light Claude app', 'dark', 'light', 'light');

await b.close();
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'HOST SUITE FAILED':'HOST SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
