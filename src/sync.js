// Durable storage for the published page.
//
// A published artifact runs inside a cross-origin iframe, and Safari discards
// that frame's localStorage when the tab closes — a session looks saved, then
// is gone. A write-then-read probe can't catch it, because the write really
// does succeed while the page is open.
//
// The `artifact` capability gives the page a real record instead: it saves a
// new version of itself with the log embedded in it. That survives the browser
// clearing site data, and follows the account rather than the device.
//
// Standalone — `npm run dev`, or any plain host — there is no capability and no
// embedded data block, so this reports unavailable and storage.js goes on using
// localStorage.

const DATA_ID = 'log-data';
const CSS_ID = 'app-css';
const JS_ID = 'app-js';

// The log carried inside the page itself, or null when this isn't the
// published page.
export function readEmbedded() {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(DATA_ID);
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function hasEmbeddedData(state) {
  if (!state) return false;
  const logs = state['workout-logs'];
  const bw = state['bodyweight-logs'];
  return Boolean((logs && Object.keys(logs).length) || (bw && bw.length));
}

// Rebuild the whole document from the page's own static assets plus fresh
// state. Deliberately not a serialization of the live DOM: the style and script
// text never change, so republishing is idempotent apart from the log itself.
function buildDocument(state) {
  const css = document.getElementById(CSS_ID);
  const js = document.getElementById(JS_ID);
  if (!css || !js) return null;
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    // The artifact's name is the reader's, not this file's: republishing with a
    // hardcoded title renamed it back on every save.
    `<title>${(document.title || 'Workout Tracker').replace(/</g, '\\u003c')}</title>`,
    '<style id="' + CSS_ID + '">' + css.textContent + '</style>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="application/json" id="' + DATA_ID + '">' + json + '<\/script>',
    '<script type="module" id="' + JS_ID + '">' + js.textContent + '<\/script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// Resolves to a publish function, or null when this view can't save durably.
export async function getPublisher() {
  if (typeof window === 'undefined' || typeof window.claude?.use !== 'function') return null;
  if (typeof document === 'undefined' || !document.getElementById(DATA_ID)) return null;

  let artifact = null;
  try {
    artifact = await window.claude.use('artifact');
  } catch (e) {
    return null;
  }
  if (!artifact || typeof artifact.publish !== 'function') return null;

  return async function publish(state) {
    const doc = buildDocument(state);
    if (!doc) return { ok: false, reason: 'template' };
    try {
      await artifact.publish(doc);
      return { ok: true };
    } catch (e) {
      // A conflict means someone else's version won and every view reloads to
      // it; retrying would only fight that.
      return { ok: false, reason: e?.code || 'error' };
    }
  };
}
