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
