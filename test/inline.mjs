// Build the single-file artifact: the same shape sync.js republishes, so the
// app can keep rewriting itself with the log inside.
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assets = fs.readdirSync(path.join(dist, 'assets'));
const css = fs.readFileSync(path.join(dist, 'assets', assets.find((f) => f.endsWith('.css'))), 'utf8');
const js = fs.readFileSync(path.join(dist, 'assets', assets.find((f) => f.endsWith('.js'))), 'utf8');
// Copied out of the built index.html rather than written here, so the artifact
// and the dev page cannot disagree about what runs before the first paint.
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const bootMatch = indexHtml.match(/<script id="theme-boot">([\s\S]*?)<\/script>/);
if (!bootMatch) throw new Error('theme-boot script missing from dist/index.html');
const boot = bootMatch[1];
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const json = JSON.stringify(state).replace(/</g, '\\u003c');
const out = [
  // The artifact host injects these; the local copy needs them too, or mobile
  // emulation lays the page out at 980px and scales it down, which hides every
  // wrapping and overflow problem.
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<title>' + (process.argv[4] || "Assad's Training Log") + '</title>',
  // Before the stylesheet, not after it. html's background is var(--color-night)
  // unconditionally and the light palette is what data-app-theme switches on,
  // so a stylesheet that applies before the attribute is set paints one dark
  // frame at every open.
  // The one thing in this frame that is readable before the first paint and
  // survives everything, because it IS the page. Storage does not survive a
  // close on iOS and third-party cookies are blocked outright; both were tried
  // and both were measured failing on the lifter's own phone.
  '<meta name="app-theme" content="' + (state.theme === 'dark' ? 'dark' : state.theme === 'light' ? 'light' : 'system') + '">',
  '<script id="theme-boot">' + boot + '</' + 'script>',
  '<style id="app-css">' + css + '</style>',
  '<div id="root"></div>',
  '<script type="application/json" id="log-data">' + json + '</' + 'script>',
  '<script type="module" id="app-js">' + js + '</' + 'script>',
].join('\n');
fs.writeFileSync(process.argv[3], out);
// Every suite reads test/art/current.html, so building is what points them at
// the build under test. Pinning suites to a version-numbered file let tdb run
// against v8.1 for four versions without anyone noticing.
const current = path.join(path.dirname(fileURLToPath(import.meta.url)), 'art', 'current.html');
try { fs.writeFileSync(current, out); } catch (e) { /* running outside the harness */ }
console.log('wrote', process.argv[3], (out.length / 1024).toFixed(0) + 'KB');
