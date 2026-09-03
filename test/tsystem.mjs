// System cannot flash, and this is the proof rather than the argument. The first
// frame is measured off the compositor — real pixels — with the CPU throttled so
// the gap between the host's runtime and ours is as wide as it is on his phone.
//
// The cases are chosen to be the ones that broke every previous fix: no device
// copy (Safari discarded it), and a bake or a store that disagrees. System has
// to survive all of them, because it reads the phone and needs nothing to have
// survived anything.
import { record } from './screencast.mjs';
import { stub } from './dbstub.mjs';
import { pageFor } from './bake.mjs';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL',n,e]);

const run = async (label, { phone, bake, store, device }, want, { step = false } = {}) => {
  const init = [];
  // Safari throws the device copy away with the tab; that is the default here.
  if (device) init.push(new Function('localStorage.setItem("theme", JSON.stringify("' + device + '"))'));
  const r = await record({
    url: pageFor(bake, 'sys'),
    phone, throttle: 6, ms: 4500, init,
    seed: [stub(), [false, { 'meta/prefs': { theme: store, updatedAt: 'x' },
      'sessions/2026-09-01': { date:'2026-09-01', slots:{ 'Legs-A': { 'Back Squat': { sets:[{w:'60',r:'8'}] } } }, updatedAt:'x' } }, false]],
  });
  // The pre-paint window belongs to whatever is embedding us and is white here;
  // what this suite owns is everything from our first paint onwards.
  const seq = r.steps.map((s) => `${s.at}ms ${s.shade}`).join(' -> ');
  // The frame at 0ms is the pre-paint window, which belongs to whatever is
  // embedding us and is white in this harness. What this suite owns starts at
  // our first paint.
  const ours = r.steps.filter((s) => s.at > 0 && s.shade !== 'mid').map((s) => s.shade);
  const settled = ours.length ? ours[ours.length - 1] : want;
  if (step) {
    ok(`${label}: costs one step and settles right`, ours.length <= 2 && settled === want, seq);
  } else {
    ok(`${label}: never shows the wrong colour`, ours.every((sh) => sh === want) && settled === want, seq);
  }
  ok(`${label}: no page errors`, r.errors.length === 0, r.errors.join(';'));
};

for (const phone of ['light', 'dark']) {
  const want = phone === 'dark' ? 'DARK' : 'LIGHT';
  const other = phone === 'dark' ? 'light' : 'dark';

  // THE GUARANTEE. On System with the page baked 'system', the boot script has
  // nothing to read but the phone, so the first frame is right by construction
  // — no device copy needed, no store answer needed, nothing to have survived
  // the app closing. This is the case he will actually be in.
  await run(`System everywhere, ${phone} phone   `, { phone, bake: 'system', store: 'system', device: null }, want);
  // And with the device copy intact, which is the other half of the time.
  await run(`System everywhere, ${phone}, device  `, { phone, bake: 'system', store: 'system', device: 'system' }, want);

  // THE COST, pinned so nobody thinks it is free. If he switches to Light or
  // Dark and back, the page keeps the concrete bake until it is republished,
  // and the boot script reads it ahead of the phone. That is one step on one
  // open, and it heals the first time the app is backgrounded rather than
  // closed. Asserting it means a change that quietly makes it worse will show.
  await run(`stale ${other} bake, ${phone} phone   `, { phone, bake: other, store: 'system', device: null }, want, { step: true });
}
for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'SYSTEM SUITE FAILED':'SYSTEM SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
