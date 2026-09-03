// The whole suite, from a clean clone: build, serve, run everything, report.
//
// This exists because for two days the harness lived only in a session
// scratchpad that dies with its container — 46 suites and every process
// decision they encode, one reclaim away from gone. It is in the repository now.
//
// Chromium only, at the path Playwright installs it to, with --no-sandbox.
// Tests run in Asia/Dubai: three temporal-dead-zone crashes rendered fine in
// UTC and white-screened at GMT+4.
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Never pipe the build into anything: a pipeline exits with the status of its
// last command, so a broken build reports success and every later measurement
// silently runs against a stale bundle. This has cost real work twice.
process.stdout.write('building… ');
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
console.log('ok');

// Building is what points the suites at the build under test: inline.mjs writes
// art/current.html, and every suite reads that one file. Pinning suites to
// version-numbered pages once let a suite run against a four-versions-old build.
const fixture = path.join(here, 'fixtures', 'three-day.json');
execFileSync('node', [path.join(here, 'inline.mjs'), fixture, path.join(here, 'art', 'built.html')],
  { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] });

const servers = [
  spawn('node', [path.join(here, 'serve.mjs'), path.join(here, 'art'), '4320'], { stdio: 'ignore', detached: true }),
  spawn('node', [path.join(here, 'serve.mjs'), path.join(root, 'dist'), '4300'], { stdio: 'ignore', detached: true }),
];
const stop = () => servers.forEach((s) => { try { process.kill(-s.pid); } catch (e) { try { s.kill(); } catch (e2) {} } });
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
await new Promise((r) => setTimeout(r, 1500));

const only = process.argv.slice(2);
const suites = only.length ? only : fs.readdirSync(here)
  .filter((f) => /^(regress|repro\d|t[a-z0-9]+)\.mjs$/.test(f))
  .filter((f) => !['run.mjs', 'run-all.mjs'].includes(f))
  .sort();

let bad = 0, pass = 0, fail = 0, skipped = 0;
for (const f of suites) {
  let out = '', ok = true;
  try {
    out = execFileSync('node', [path.join(here, f)], { encoding: 'utf8', timeout: 180000, cwd: here });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    ok = false;
  }
  const p = (out.match(/^PASS/gm) || []).length;
  const q = (out.match(/^FAIL/gm) || []).length;
  const skip = /^SKIP/m.test(out);
  const crashed = !ok && q === 0;
  pass += p; fail += q;
  if (skip) skipped++;
  // A suite that crashes has not passed, whatever it printed before dying.
  if (q || crashed) bad++;
  console.log(`${f.padEnd(18)} ${String(p).padStart(3)} pass  ${q} fail${crashed ? '   CRASHED — not a pass' : ''}${skip ? '   (skipped)' : ''}`);
  if (q) console.log(out.split('\n').filter((l) => /^FAIL/.test(l)).map((l) => '    ' + l).join('\n'));
  if (crashed) console.log('    ' + out.trim().split('\n').slice(-6).join('\n    '));
}
console.log(`\n${suites.length} suites, ${pass} checks${skipped ? `, ${skipped} skipped` : ''}` +
  (bad ? ` — ${bad} NOT CLEAN, ${fail} failing checks` : ' — all clean'));
stop();
process.exit(bad ? 1 : 0);
