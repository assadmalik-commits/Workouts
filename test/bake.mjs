// The page carries its own theme, baked at publish time, and it is the only
// thing readable before the first paint. So which bake a scenario runs against
// is part of the scenario, not a constant: a suite seeding a dark store has to
// serve a page published while the preference was dark, or it is testing a
// stale bake without saying so.
//
// These are the bytes of the build under test with one attribute swapped —
// never a page written here, or a suite could go green against a build it
// never loaded. That is how tdb ran against v8.1 for four versions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const art = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art');
const built = fs.readFileSync(path.join(art, 'current.html'), 'utf8');
if (!/name="app-theme" content="[a-z]+"/.test(built)) throw new Error('build under test has no baked theme');

export function pageFor(bake, tag = 'bake') {
  const name = `${tag}-${bake}.html`;
  fs.writeFileSync(path.join(art, name), built.replace(/name="app-theme" content="[a-z]+"/, `name="app-theme" content="${bake}"`));
  return `http://127.0.0.1:4320/${name}`;
}

// The same argument for the embedded block. It is built from the lifter's live
// state so that a release carries his record, which means a suite describing
// "no email yet" or "nothing weighed today" silently stops describing anything
// the day he fills those in. What the page carries is part of the scenario.
export function pageWith(state, tag = 'block') {
  const name = `${tag}.html`;
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  const html = built
    .replace(/name="app-theme" content="[a-z]+"/, `name="app-theme" content="${state.theme === 'dark' ? 'dark' : state.theme === 'light' ? 'light' : 'system'}"`)
    .replace(/(<script type="application\/json" id="log-data">)[\s\S]*?(<\/script>)/, `$1${json}$2`);
  if (!html.includes(json)) throw new Error('log-data block not found in the build under test');
  fs.writeFileSync(path.join(art, name), html);
  return `http://127.0.0.1:4320/${name}`;
}
