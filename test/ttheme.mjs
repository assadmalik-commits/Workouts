// Dark or light is a preference of the device in your hand. The page carries a
// snapshot of what was true when it was last published, and the store may hold
// what another view chose; neither outranks the phone.
import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
const URL = process.env.TTHEME_URL || 'http://127.0.0.1:4320/current.html';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);
const seed = {
  'sessions/2026-08-30': { date:'2026-08-30', slots:{ 'Push-A': { 'Incline Dumbbell Press': { sets:[{w:'10',r:'10'}] } } }, updatedAt:'x' },
  'meta/profile': { name:'Sample Lifter', dob:'1986-04-22', sex:'Male', heightCm:'173', updatedAt:'x' },
  'meta/prefs': { theme:'light', updatedAt:'x' },
};
async function open(pre) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await ctx.clock.install({ time: new Date('2026-09-02T12:00:00+04:00') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  if (pre) await page.addInitScript(pre);
  await page.addInitScript(stub(), [false, seed, false]);
  return { b, page, errors };
}
const theme = (page) => page.evaluate(() => document.documentElement.dataset.appTheme);
const dbTheme = (page) => page.evaluate(() => (window.__db.docs['meta/prefs']||{}).theme);

// The page says dark, the store says light, this device last chose dark.
{
  const { b, page, errors } = await open(() => localStorage.setItem('theme', '"dark"'));
  await page.goto(URL, { waitUntil:'commit' });
  await page.waitForTimeout(60);
  const first = await theme(page);
  ok('A the first paint is the device’s theme', first === 'dark', 'painted ' + first);
  const seen = new Set();
  for (let i = 0; i < 24; i++) { seen.add(await theme(page)); await page.waitForTimeout(120); }
  ok('A and it never flickers to the other one', !seen.has('light'), 'saw ' + [...seen].join(','));
  ok('A the store is corrected to match', await dbTheme(page) === 'dark', 'store ' + (await dbTheme(page)));
  ok('A no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

// Toggling, closing, coming back.
{
  const { b, page, errors } = await open();
  await page.goto(URL, { waitUntil:'networkidle' });
  await page.waitForTimeout(1200);
  const before = await theme(page);
  await page.click('header button:has(svg)');
  await page.waitForTimeout(900);
  const after = await theme(page);
  ok('B the moon changes the theme', after !== before, `${before} -> ${after}`);
  ok('B and the store follows', await dbTheme(page) === after, 'store ' + (await dbTheme(page)));
  await page.reload({ waitUntil:'commit' });
  await page.waitForTimeout(60);
  ok('B it comes back on the chosen theme immediately', await theme(page) === after, 'painted ' + (await theme(page)));
  const seen = new Set();
  for (let i = 0; i < 20; i++) { seen.add(await theme(page)); await page.waitForTimeout(120); }
  ok('B and stays on it', seen.size === 1 && seen.has(after), 'saw ' + [...seen].join(','));
  ok('B no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

// A device that has never chosen falls back to what the store holds.
{
  const { b, page, errors } = await open();
  await page.goto(URL, { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  ok('C a fresh device takes the store’s theme', await theme(page) === 'light', 'painted ' + (await theme(page)));
  ok('C no page errors', errors.length === 0, errors.join(';'));
  await b.close();
}

// Every frame from the moment the document exists. The palette is dark by
// default and light is the override data-app-theme switches on, so a document
// without that attribute is a dark document — and it used to be set from a
// React effect, which lands after the first paint. A lifter on day mode got a
// frame of night on every open.
for (const chose of ['light', 'dark']) {
  const other = chose === 'light' ? 'dark' : 'light';
  const { b, page, errors } = await open();
  await page.addInitScript((t) => localStorage.setItem('theme', JSON.stringify(t)), chose);
  await page.goto(URL, { waitUntil: 'commit' });
  const frames = [];
  for (let i = 0; i < 40; i++) {
    const f = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      // Which palette is actually on screen, not which attribute is set.
      return Number(bg.match(/\d+/)[0]) < 128 ? 'dark' : 'light';
    }).catch(() => null);
    if (f && f !== frames[frames.length - 1]) frames.push(f);
    await page.waitForTimeout(25);
  }
  ok(`D chose ${chose}: the very first paint is ${chose}`, frames[0] === chose, 'frames ' + frames.join(' -> '));
  ok(`D chose ${chose}: no frame of ${other} at any point`, !frames.includes(other), 'frames ' + frames.join(' -> '));
  ok(`D chose ${chose}: no page errors`, errors.length === 0, errors.join(';'));
  await b.close();
}

// The one thing a local harness cannot show. The published page is wrapped by
// the host, whose runtime and reset stylesheet run first, and our own 26KB of
// CSS and 218KB of JS make the parse long enough for a paint to land in the
// middle of it. html's background is var(--color-night) unconditionally, so a
// stylesheet that applies before data-app-theme is set paints a dark frame.
// Serving the file bare never leaves that gap, so assert the order instead.
{
  const fs = await import('fs');
  // `URL` is the page under test here, not the global constructor.
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  // Beside the suite, not relative to whatever directory node was started from.
  const html = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'art', URL.split('/').pop()), 'utf8');
  const boot = html.indexOf('id="theme-boot"');
  const style = html.indexOf('id="app-css"');
  ok('E the published page carries the theme boot', boot !== -1);
  ok('E and runs it before the stylesheet it governs', boot !== -1 && style !== -1 && boot < style,
    `boot at ${boot}, stylesheet at ${style}`);
}

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'THEME SUITE FAILED':'THEME SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
