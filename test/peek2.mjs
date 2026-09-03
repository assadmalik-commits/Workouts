import { chromium } from 'playwright';
import { stub } from './dbstub.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const f of ['ids.html', 'ids-renamed.html']) {
  const c = await b.newContext({ timezoneId:'Asia/Dubai', locale:'en-GB', viewport:{width:440,height:820}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  await c.clock.install({ time: new Date('2026-09-01T20:00:00+04:00') });
  const p = await c.newPage();
  await p.addInitScript(stub(), [false, {}, false]);
  await p.goto('http://127.0.0.1:4320/' + f, { waitUntil:'networkidle' });
  await p.waitForTimeout(2200);
  await p.click('button:has-text("Legs")'); await p.waitForTimeout(300);
  await p.click('button:has-text("Day A")'); await p.waitForTimeout(500);
  const t = await p.innerText('body');
  console.log('=== ' + f);
  console.log(t.split('\n').filter(l => /Squat|kg|×/.test(l)).slice(0, 14).map(l => '   ' + l).join('\n'));
  await c.close();
}
await b.close();
