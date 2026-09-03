// A stand-in for the artifact runtime, faithful to the parts of the contract
// this app leans on: `use()` answers late and can answer null, documents are
// whole-body writes, a collection read sees only its own depth, and a store
// that cannot be reached rejects with `unavailable`.
export const stub = ({ noDb = false, seedDocs = {}, fail = false } = {}) =>
  function install([noDbFlag, docs, failFlag]) {
    // The store outlives a reload, as the real one does. addInitScript runs
    // again on every navigation, so without this the store was wiped and the
    // app's first-run migration re-ran — which made a reload look like it had
    // reverted whatever had just been saved.
    const KEEP = '__db_docs__';
    let start = JSON.parse(JSON.stringify(docs));
    try {
      const held = sessionStorage.getItem(KEEP);
      if (held) start = JSON.parse(held);
      else sessionStorage.setItem(KEEP, JSON.stringify(start));
    } catch (e) { /* private mode: fall back to the seed */ }
    window.__db = { docs: start };
    const persist = () => {
      try { sessionStorage.setItem(KEEP, JSON.stringify(window.__db.docs)); } catch (e) {}
    };
    window.__calls = { publishes: 0, writes: [], reads: 0, download: null, downloadBody: null };
    window.__dbFail = failFlag;
    window.__noDb = noDbFlag;

    const snap = (id, body) => ({
      id,
      exists: body !== undefined,
      data: () => body,
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    const guard = () => {
      if (window.__dbFail) throw { code: 'unavailable', message: 'no signal' };
    };
    const makeDoc = (path) => ({
      id: path.split('/').pop(),
      path,
      async get() {
        guard();
        return snap(path.split('/').pop(), window.__db.docs[path]);
      },
      async set(data) {
        guard();
        window.__db.docs[path] = JSON.parse(JSON.stringify(data));
        persist();
        window.__calls.writes.push(path);
      },
      async update(data) {
        guard();
        if (window.__db.docs[path] === undefined) throw { code: 'invalid_argument', message: 'absent' };
        Object.assign(window.__db.docs[path], data);
        persist();
        window.__calls.writes.push(path);
      },
      async delete() {
        guard();
        delete window.__db.docs[path];
        persist();
        window.__calls.writes.push('DEL ' + path);
      },
      collection: (p) => makeCollection(path + '/' + p),
    });
    const makeCollection = (path) => ({
      path,
      doc: (id) => makeDoc(path + '/' + (id ?? 'auto')),
      async get() {
        guard();
        window.__calls.reads += 1;
        const docs = Object.entries(window.__db.docs)
          .filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
          .map(([p, body]) => snap(p.split('/').pop(), body));
        return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      },
    });
    const DB = { doc: makeDoc, collection: makeCollection };

    Object.defineProperty(window, 'claude', {
      value: {
        use: async (name) => {
          // Never within the first script run, by contract.
          await new Promise((r) => setTimeout(r, 40));
          if (name === 'db') return window.__noDb ? null : DB;
          if (name === 'artifact')
            return { publish: async (doc) => { window.__calls.publishes += 1; window.__calls.published = doc; } };
          if (name === 'downloads')
            return {
              save: async (req) => {
                window.__calls.download = req.filename;
                window.__calls.downloadBody = String(req.data);
                return { status: 'saved' };
              },
            };
          return null;
        },
      },
      writable: false,
      configurable: true,
    });
  };
