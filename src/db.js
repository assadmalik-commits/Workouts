// The durable store, kept beside the page instead of inside it.
//
// Until now the log lived in the published page: saving meant republishing,
// and a republish reloads every open view — mid-session that threw the lifter
// back to today with everything closed, which is why sync.js is forbidden from
// publishing on a timer. The `db` capability gives the page a document store
// that outlives reloads and republishes without being part of the document, so
// a save is a write and nothing moves on screen.
//
// Shape: one document per training day under `sessions/`, and the things that
// are not a training day under `meta/`. Per-day documents mean a save writes
// only the day that changed, and a year of six-day weeks is about 312
// documents against a 5,000-document ceiling.
//
// The photo has a document to itself. It is twenty times the size of the rest
// of the profile put together and changes about never, so splitting it keeps
// every profile write small and puts the one body that could ever approach the
// 256KiB document limit where nothing else has to carry it.
//
// Standalone — `npm run dev`, or any plain host — there is no capability, this
// resolves null, and the app goes on with localStorage exactly as before.

const SESSIONS = 'sessions';

// What a write can be asked to carry. The app tracks these same strings as the
// set of things written down but not yet confirmed durable, so a save that
// happened with no signal can be retried without re-writing everything.
export const KEY = {
  session: (date) => `session:${date}`,
  profile: 'profile',
  photo: 'photo',
  bodyweight: 'bodyweight',
  theme: 'theme',
};

export const dateOfKey = (key) =>
  key.startsWith('session:') ? key.slice('session:'.length) : null;

const stamp = () => new Date().toISOString();

// `unavailable` is the one code the contract says to retry, once, after a
// short randomized delay. Everything else is either a bug in this file
// (`invalid_argument`), a full database (`quota_exceeded`) or a grant that has
// gone away (`revoked`) — retrying any of those cannot succeed.
const RETRYABLE = 'unavailable';

async function once(work) {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    const code = e?.code || 'unavailable';
    if (code !== RETRYABLE) return { ok: false, code };
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    try {
      return { ok: true, value: await work() };
    } catch (e2) {
      return { ok: false, code: e2?.code || 'unavailable' };
    }
  }
}

// Resolves to a store, or null when this view cannot run one. The capability
// resolves late by contract — never within the first script run, and null
// after ten seconds when no viewer answers — so the app must already be on
// screen and working from the device copy before this settles.
export async function getStore() {
  if (typeof window === 'undefined' || typeof window.claude?.use !== 'function') return null;

  let db = null;
  try {
    db = await window.claude.use('db');
  } catch (e) {
    return null;
  }
  if (!db || typeof db.doc !== 'function' || typeof db.collection !== 'function') return null;

  // Everything the store holds, in the same shape readEmbedded() returns, so
  // the load path treats a db read and an embedded block as the same kind of
  // thing.
  async function readAll() {
    const state = {
      'workout-logs': {},
      'bodyweight-logs': [],
      profile: null,
      theme: null,
    };
    let found = 0;

    const sessions = await once(() => db.collection(SESSIONS).get());
    if (!sessions.ok) return { ok: false, code: sessions.code };
    for (const doc of sessions.value.docs) {
      const body = doc.data() || {};
      if (body.slots && typeof body.slots === 'object') {
        state['workout-logs'][doc.id] = body.slots;
        found += 1;
      }
    }

    const metas = await Promise.all(
      ['profile', 'photo', 'bodyweight', 'prefs'].map((id) =>
        once(() => db.doc(`meta/${id}`).get())
      )
    );
    if (metas.some((m) => !m.ok)) return { ok: false, code: metas.find((m) => !m.ok).code };
    const [profileDoc, photoDoc, bwDoc, prefsDoc] = metas.map((m) => m.value);

    if (profileDoc.exists) {
      const { updatedAt, ...rest } = profileDoc.data() || {};
      state.profile = rest;
      found += 1;
    }
    if (photoDoc.exists) {
      const photo = (photoDoc.data() || {}).photo;
      if (photo) {
        state.profile = { ...(state.profile || {}), photo };
        found += 1;
      }
    }
    if (bwDoc.exists) {
      const entries = (bwDoc.data() || {}).entries;
      if (Array.isArray(entries)) {
        state['bodyweight-logs'] = entries;
        found += 1;
      }
    }
    if (prefsDoc.exists) {
      const t = (prefsDoc.data() || {}).theme;
      if (t === 'dark' || t === 'light') state.theme = t;
    }

    // An empty store is the signal to migrate what the page is carrying into
    // it. Anything at all on record means this is not a first run, and the
    // page's embedded block is a stale backup that must not be written back.
    return { ok: true, state, empty: found === 0 };
  }

  // Writes only the keys named. A day whose record has gone empty — every set
  // cleared — is deleted rather than left behind, or the next load would read
  // it back and the sets would reappear.
  async function writeKeys(keys, state) {
    const written = [];
    const failed = [];
    const logs = state['workout-logs'] || {};

    for (const key of keys) {
      const date = dateOfKey(key);
      let res;
      if (date !== null) {
        const slots = logs[date];
        res = slots
          ? await once(() =>
              db.doc(`${SESSIONS}/${date}`).set({ date, slots, updatedAt: stamp() })
            )
          : await once(() => db.doc(`${SESSIONS}/${date}`).delete());
      } else if (key === KEY.profile) {
        const { photo, ...rest } = state.profile || {};
        res = await once(() => db.doc('meta/profile').set({ ...rest, updatedAt: stamp() }));
      } else if (key === KEY.photo) {
        const photo = (state.profile || {}).photo || '';
        res = await once(() => db.doc('meta/photo').set({ photo, updatedAt: stamp() }));
      } else if (key === KEY.bodyweight) {
        res = await once(() =>
          db.doc('meta/bodyweight').set({
            entries: state['bodyweight-logs'] || [],
            updatedAt: stamp(),
          })
        );
      } else if (key === KEY.theme) {
        res = await once(() =>
          db.doc('meta/prefs').set({ theme: state.theme, updatedAt: stamp() })
        );
      } else {
        continue;
      }
      if (res.ok) written.push(key);
      else failed.push({ key, code: res.code });
    }
    return { written, failed };
  }

  return { readAll, writeKeys };
}

// Which keys differ between two states. The debounced save knows a record
// changed but not which day, and writing all of them on every keystroke would
// spend the call budget on days nobody touched.
export function changedKeys(before, after) {
  const keys = [];
  const a = before || {};
  const b = after || {};

  const logsA = a['workout-logs'] || {};
  const logsB = b['workout-logs'] || {};
  for (const date of new Set([...Object.keys(logsA), ...Object.keys(logsB)])) {
    if (JSON.stringify(logsA[date]) !== JSON.stringify(logsB[date])) keys.push(KEY.session(date));
  }

  const { photo: photoA, ...restA } = a.profile || {};
  const { photo: photoB, ...restB } = b.profile || {};
  if (JSON.stringify(restA) !== JSON.stringify(restB)) keys.push(KEY.profile);
  if ((photoA || '') !== (photoB || '')) keys.push(KEY.photo);

  if (JSON.stringify(a['bodyweight-logs'] || []) !== JSON.stringify(b['bodyweight-logs'] || []))
    keys.push(KEY.bodyweight);
  if (a.theme !== b.theme) keys.push(KEY.theme);

  return keys;
}

// What the store holds, merged with what the device has.
//
// The store is the record, so it wins — except for whatever this device wrote
// down while it could not reach the store. Training in a basement with no
// signal writes to localStorage and leaves the day in `pending`; without this
// the first load back in range would read the older day out of the store and
// discard the session.
export function mergeState(local, remote, pending) {
  const held = new Set(pending || []);
  const merged = {
    'workout-logs': { ...(remote['workout-logs'] || {}) },
    'bodyweight-logs': remote['bodyweight-logs'] || [],
    profile: remote.profile,
    theme: remote.theme,
  };

  const localLogs = local['workout-logs'] || {};
  for (const date of Object.keys(localLogs)) {
    // A day the store has never heard of is this device's to contribute,
    // whether or not it is still pending — the store cannot have deleted
    // something it was never told about.
    if (held.has(KEY.session(date)) || !(date in merged['workout-logs'])) {
      merged['workout-logs'][date] = localLogs[date];
    }
  }
  // A day held on this device and since emptied must not be resurrected from
  // the store.
  for (const key of held) {
    const date = dateOfKey(key);
    if (date !== null && !(date in localLogs)) delete merged['workout-logs'][date];
  }

  const localProfile = local.profile || {};
  const remoteProfile = remote.profile || {};
  if (held.has(KEY.profile) || !remote.profile) {
    const { photo, ...rest } = localProfile;
    merged.profile = { ...remoteProfile, ...rest };
  }
  if (held.has(KEY.photo) || !remoteProfile.photo) {
    merged.profile = { ...(merged.profile || {}), photo: localProfile.photo || remoteProfile.photo || '' };
  }
  if (held.has(KEY.bodyweight) || !remote['bodyweight-logs']?.length) {
    merged['bodyweight-logs'] = local['bodyweight-logs'] || [];
  }
  // Dark or light is a preference of the device in your hand. The caller marks
  // the theme held when this phone has actually chosen one, and then that beats
  // the store — which may hold what another view chose, or what was true when
  // the page was last published. A device that has never chosen takes the
  // store's, so a fresh one starts somewhere sensible rather than on whatever
  // the publish froze.
  if (held.has(KEY.theme) || !remote.theme) merged.theme = local.theme ?? remote.theme;

  return merged;
}

// Offering the record as a file.
//
// While the log lived inside the page, downloading the page was a complete
// backup — the lifter held everything. Moving it into the store takes that
// away unless the app hands it back, so this is not a nicety: it is the other
// half of the move.
export async function getDownloader() {
  if (typeof window === 'undefined' || typeof window.claude?.use !== 'function') return null;
  let downloads = null;
  try {
    downloads = await window.claude.use('downloads');
  } catch (e) {
    return null;
  }
  if (!downloads || typeof downloads.save !== 'function') return null;

  return async function offer(filename, data) {
    try {
      await downloads.save({ filename, data });
      return { ok: true };
    } catch (e) {
      // Declining the prompt is an answer, not a failure, and must never be
      // retried or reported as one.
      return { ok: false, code: e?.code || 'unavailable' };
    }
  };
}
