// Key/value storage adapter.
//
// When the app runs inside a host that provides `window.storage` (get/set
// returning promises), we use it directly. Standalone in a browser we fall
// back to localStorage behind the same async, `{ value }`-shaped interface.
const memory = new Map();

function backend() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (e) {
    // Access can throw when cookies/site data are blocked.
  }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
  };
}

const fallback = {
  async get(key) {
    const value = backend().getItem(key);
    return value === null ? null : { value };
  },
  async set(key, value) {
    backend().setItem(key, value);
  },
};

// Whether writes actually survive. Safari inside a third-party iframe — which
// is how a published page is served — and private mode can both expose
// localStorage and then reject or discard what's written to it. A silent
// fall back to memory looks identical to working until the log disappears, so
// probe it and let the UI say so.
export function storageIsDurable() {
  try {
    if (typeof window !== 'undefined' && window.storage) return true;
    if (typeof localStorage === 'undefined') return false;
    const probe = '__durability_probe__';
    localStorage.setItem(probe, '1');
    const ok = localStorage.getItem(probe) === '1';
    localStorage.removeItem(probe);
    return ok;
  } catch (e) {
    return false;
  }
}

export const storage = {
  get: (key, shared = false) =>
    typeof window !== 'undefined' && window.storage
      ? window.storage.get(key, shared)
      : fallback.get(key),
  set: (key, value, shared = false) =>
    typeof window !== 'undefined' && window.storage
      ? window.storage.set(key, value, shared)
      : fallback.set(key, value),
};
