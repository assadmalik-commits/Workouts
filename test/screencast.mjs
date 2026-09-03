// What the screen actually showed, frame by frame, from the compositor.
//
// Every instrument used on this bug so far has run inside the page, which means
// none of them could see a frame painted while the page's main thread was busy
// — and the host's frame-runtime is 13KB of blocking inline script that runs
// before anything of ours. CDP's screencast comes from the browser process, so
// it keeps delivering frames through that window.
import { chromium } from 'playwright';
import { decode, shadeOf } from './png.mjs';

export async function record({ url, phone = 'light', throttle = 1, ms = 4000, init = [], seed = null }) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820},
    deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  for (const fn of init) await page.addInitScript(fn);
  if (seed) await page.addInitScript(seed[0], seed[1]);
  const cdp = await ctx.newCDPSession(page);
  // A phone is several times slower than this container; his boot script ran at
  // 526ms where the harness runs it in 40. Throttling is what makes the gap
  // between the host's script and ours wide enough to see.
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const frames = [];
  let t0 = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const at = t0 ? Math.round((f.metadata.timestamp - t0) * 1000) : 0;
    if (!t0) t0 = f.metadata.timestamp;
    try {
      const png = decode(Buffer.from(f.data, 'base64'));
      frames.push({ at, ...shadeOf(png) });
    } catch (e) { frames.push({ at, shade: 'undecodable', mean: -1 }); }
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForTimeout(ms);
  try { await cdp.send('Page.stopScreencast'); } catch (e) {}
  const trace = await page.evaluate(() => (window.__trace || []).map(r => r.at + 'ms ' + r.step + ' ' + JSON.stringify(r.detail))).catch(() => []);
  await b.close();
  // Only the changes: a run of identical frames is one thing on screen.
  const steps = [];
  for (const f of frames) if (!steps.length || steps[steps.length-1].shade !== f.shade) steps.push(f);
  return { frames, steps, trace, errors };
}
