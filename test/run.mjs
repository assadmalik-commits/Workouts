import { execFileSync } from 'child_process';
const suites = process.argv.slice(2);
let bad = 0;
for (const f of suites) {
  let out = '', ok = true;
  try {
    out = execFileSync('node', [f], { encoding: 'utf8', timeout: 110000 });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    ok = false;
  }
  const pass = (out.match(/^PASS/gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  const crashed = !ok && fail === 0;
  if (fail || crashed) bad++;
  console.log(`${f.padEnd(14)} ${String(pass).padStart(3)} pass  ${fail} fail${crashed ? '   CRASHED — not a pass' : ''}`);
  if (fail) console.log(out.split('\n').filter((l) => /^FAIL/.test(l)).map((l) => '    ' + l).join('\n'));
  if (crashed) console.log('    ' + (out.trim().split('\n').slice(-6).join('\n    ')));
}
console.log(bad ? `\n${bad} suite(s) not clean` : '\nALL SUITES CLEAN');
