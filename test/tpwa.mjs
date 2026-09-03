// The standalone app: installable to the home screen, and able to open with no
// network at all. The lifter trains in a basement with no signal, so "offline"
// is not a nicety — it is the ordinary case.
//
// Served from a subdirectory, because that is what GitHub Pages does
// (/Workouts/, not the domain root) and an absolute asset path would 404 there
// while working perfectly in every local test.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

// A static server rooted so the app lives under /Workouts/, exactly as Pages
// serves it.
const http = await import('http');
const dist = path.join(here, '..', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' };
let offline = false;
const server = http.createServer((req, res) => {
  if (offline) { req.socket.destroy(); return; }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/Workouts/')) { res.writeHead(404); return res.end('nf'); }
  p = p.slice('/Workouts'.length);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(4444, r));
const URL_ = 'http://127.0.0.1:4444/Workouts/';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
const errors = [];
const failed = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

ok('the app renders from a subdirectory', /TRAINING LOG/i.test(await page.innerText('body')), (await page.innerText('body')).split('\n')[0]);
ok('nothing 404s under that path', failed.length === 0, failed.slice(0, 4).join(' | '));
ok('no page errors', errors.length === 0, errors.join(';'));

// The manifest the phone reads to install it.
const man = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  if (!link) return null;
  const res = await fetch(link.href);
  return res.ok ? res.json() : null;
});
ok('a manifest is served and parses', Boolean(man), man ? man.name : 'missing');
ok('it installs standalone, not as a browser tab', man?.display === 'standalone', String(man?.display));
ok('its icons are relative, so they resolve under the subdirectory',
   (man?.icons || []).every((i) => i.src.startsWith('./')), JSON.stringify((man?.icons || []).map((i) => i.src)));
const icons = await page.evaluate(async (m) =>
  Promise.all((m.icons || []).map(async (i) => (await fetch(new URL(i.src, document.baseURI))).status)), man);
ok('and every icon actually loads', icons.every((s) => s === 200), icons.join(','));

// The service worker, and then the same app with the server switched off.
const reg = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => Boolean(r.active)).catch(() => false));
ok('a service worker takes control', reg === true, String(reg));
await page.waitForTimeout(1200);

offline = true;
const p2 = await ctx.newPage();
const errs2 = [];
p2.on('pageerror', (e) => errs2.push('PAGEERROR: ' + e.message));
let opened = true;
await p2.goto(URL_, { waitUntil: 'domcontentloaded' }).catch(() => { opened = false; });
await p2.waitForTimeout(2500);
const offlineText = opened ? await p2.innerText('body').catch(() => '') : '';
ok('with the network gone, the app still opens', /TRAINING LOG/i.test(offlineText), opened ? offlineText.split('\n')[0] : 'navigation failed');
ok('and does not error offline', errs2.length === 0, errs2.join(';'));

await b.close();
server.close();
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'PWA SUITE FAILED':'PWA SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
