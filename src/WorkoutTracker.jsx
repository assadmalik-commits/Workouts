import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dumbbell, Check, ChevronDown, ChevronUp, Loader2, Moon, Sun, Plus, Trash2, CalendarX,
  Home, Flame, Activity, User, Camera, Download, ChevronRight, ChevronLeft, X, Lock,
} from 'lucide-react';
import { storage, storageIsDurable } from './storage';
import { readEmbedded, hasEmbeddedData, getPublisher } from './sync';
import { getStore, getDownloader, changedKeys, mergeState, dateOfKey, KEY } from './db';
import { PROGRAM, DAYS, VARIANTS } from './plan';
import {
  SEXES, EMPTY_PROFILE, normaliseProfile, migrateWeights, ageOn, bmiOf, BMI_BANDS, BMI_CAVEAT,
  BMI_SOURCE, bandOf, healthyRange, readAvatar, initialsOf, plausibleHeight, plausibleWeight,
  PROFILE_FIELDS, fieldByKey, validField, invalidReason,
  APPEARANCE, isThemePref, labelOfPref, prefOfLabel,
} from './profile';

// Shown in the header so it's obvious at a glance which build is loaded.
const APP_VERSION = '9.1';

// The four places the app can be. Home is where it runs; the other three are
// read, not worked in, which is why the session's Save bar belongs to Home
// alone.
const NAV = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'streak', label: 'Streak', Icon: Flame },
  { key: 'stats', label: 'Stats', Icon: Activity },
  { key: 'profile', label: 'Profile', Icon: User },
];

// The local calendar date, not the UTC one. toISOString() is UTC, so anywhere
// ahead of it a late-evening session would be filed under the previous day.
const localDateStr = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const slotKey = (day, variant) => `${day}-${variant}`;

// The week's six sessions in program order. Order can flex in practice — Pull
// and Legs swap happily — but each one is trained once before any comes round
// again.
const ROTATION = VARIANTS.flatMap((variant) =>
  DAYS.map((day) => ({ day, variant, slot: slotKey(day, variant), label: `${day} ${variant}` }))
);

// Every exercise a session asks for, by slot.
const SLOT_EXERCISES = Object.fromEntries(
  ROTATION.map((r) => [r.slot, PROGRAM[r.day][r.variant].exercises.map((ex) => ex.name)])
);

// The week runs Sunday to Friday, one session a day, with Saturday off.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCHEDULE = ROTATION.map((session, i) => ({ ...session, dow: i }));
const REST_DOW = 6;
const scheduledFor = (d) => SCHEDULE.find((x) => x.dow === d.getDay()) || null;
const dowOf = (iso) => new Date(`${iso}T00:00:00`).getDay();

// Sunday opens the week, so the rotation resets on its own each Sunday.
const weekStartStr = (d) => {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  return localDateStr(start);
};

// Training days in a row.
//
// Saturday is the program's rest day: the walk steps over it, so it neither
// extends a streak nor breaks one. Today is stepped over on the same grounds
// while it is still open — a day that has not finished yet is not a day that
// was missed, and a streak that reads 0 every morning until the session is done
// would be telling the lifter something untrue.
//
// One pass, forward from the first day ever trained, because the current run,
// the longest run and the days that broke them are the same walk.
const streakFrom = (trained, today) => {
  const out = { current: 0, longest: 0, since: null, missed: [] };
  const first = [...trained].sort()[0];
  if (!first) return out;
  const cursor = new Date(`${first}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  let since = null;
  while (cursor <= end) {
    const iso = localDateStr(cursor);
    if (cursor.getDay() !== REST_DOW) {
      if (trained.has(iso)) {
        if (!out.current) since = iso;
        out.current += 1;
        if (out.current > out.longest) out.longest = out.current;
      } else if (iso !== today) {
        out.current = 0;
        since = null;
        out.missed.push(iso);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  out.since = since;
  out.missed.reverse();
  return out;
};

// A number field accepts "-40" and "1e5" as readily as "40". A negative lift
// is not a thing, and a negative volume in the week's total is worse.
//
// A ceiling belongs here too, next to the minus sign it already refuses: a
// mistyped 999999 kg is a slip, not an entry, and the app has no business
// working out a BMI for a 999 cm adult. The keystroke simply does not take,
// which is what already happens for "-".
const cleanNumber = (value, allowDecimal, max) => {
  if (!(allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/).test(value)) return null;
  if (max !== undefined && value !== '' && Number(value) > max) return null;
  return value;
};

// What the fields will take. Generous enough never to argue with a real
// session — the heaviest lift ever recorded is under 600kg — and tight enough
// that a slipped thumb cannot produce nonsense.
const MAX = { setWeight: 1000, reps: 200, heightCm: 250, bodyWeight: 400 };

// An entry is a list of sets: [{ w, r }, ...]. One row per set, because sets
// are not interchangeable — a ramp of 10, 12, 14, 16 recorded as four sets of
// 16 overstates the work by a quarter and erases the ramp itself.
const setsOf = (entry) => (Array.isArray(entry?.sets) ? entry.sets : []);

// A set is a weight and a rep count together. Either one alone is not a
// lighter version of the same record — it is a row still being typed. Accepting
// it put "1 set · max 20kg" on the screen for an exercise nobody had finished
// writing down, and counted it toward the session being trained.
//
// A weight of 0 is a real weight: that is how bodyweight work is written.
const written = (v) => v !== '' && v !== null && v !== undefined;
// And zero reps is not a rep count: nothing was lifted, so nothing was done.
// A weight of zero is different — that is how bodyweight work is written.
const setFilled = (set) =>
  Boolean(set && written(set.w) && written(set.r) && Number(set.r) > 0);

const isFilled = (entry) => setsOf(entry).some(setFilled);

// A session is trained when every exercise in it has been logged. Anything
// less is a session in progress: one recorded exercise used to tick the day
// off, move the rotation on, and count toward the week.
const slotComplete = (slot, entries) => {
  const names = SLOT_EXERCISES[slot];
  if (!names || !names.length) return false;
  return names.every((name) => isFilled((entries || {})[name]));
};

// A weight of 0 means the lift was done at bodyweight — dips, pull-ups,
// push-ups. BW says that on its own; spelling out the kg carried is noise.
// Shown as the number it is, not as the characters that were typed. "007" and
// ".5" reach storage verbatim from a number field, and rendering them raw put
// "max 0.5kg" in the row summary above a ".5kg" pill — the same set, written
// two ways.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
};

const formatWeight = (w) => {
  if (w === '' || w === undefined || w === null) return '-';
  if (Number(w) === 0) return 'BW';
  return `${num(w)}kg`;
};

// The load an exercise is remembered by: its heaviest set. Total volume added
// every set together into a number that meant little and read as a lot — 528 kg
// for four sets topping out at 20. The top set is what gets chased next week.
//
// One phrasing, used wherever the load is named: "max weight 20kg", or "body
// weight" when nothing was carried, or nothing at all when no weight was
// written down.
const loadOf = (entry) => {
  const weights = setsOf(entry)
    .filter(setFilled)
    .map((set) => set.w)
    .filter((w) => w !== '' && w !== null && w !== undefined);
  if (!weights.length) return '';
  const top = Math.max(...weights.map(Number));
  return top === 0 ? 'body weight' : `max ${top}kg`;
};

// A set list is a table, not a sentence. Spelled out as prose, seven exercises
// wrap into a paragraph of notes and the ramp is lost in the commas. One pill
// per set keeps every number and reads left to right the way it was lifted.
function SetList({ entry }) {
  const sets = setsOf(entry).filter(setFilled);
  if (!sets.length) return <span className="text-[13px] text-dim">-</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {sets.map((set, i) => (
        <span
          key={i}
          className="bg-raised border border-line rounded-lg px-2 py-1 text-[13px] nums font-semibold"
        >
          {formatWeight(set.w)} × {set.r === '' || set.r == null ? '-' : num(set.r)}
        </span>
      ))}
    </div>
  );
}

// The lifter's photo, or the next best thing. It is small on the home header
// and large on the profile, and never anything but a circle.
function Avatar({ profile, size }) {
  const initials = initialsOf(profile?.name);
  return (
    <span
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full overflow-hidden bg-raised border border-line flex items-center justify-center"
    >
      {profile?.photo ? (
        <img src={profile.photo} alt="" className="w-full h-full object-cover" />
      ) : initials ? (
        <span
          className="font-display font-bold text-dim leading-none"
          style={{ fontSize: Math.round(size * 0.36) }}
        >
          {initials}
        </span>
      ) : (
        <User size={Math.round(size * 0.5)} className="text-dim" />
      )}
    </span>
  );
}

// The collapsed row cannot hold that for four sets without growing the page,
// so it carries a summary instead — a count and the load moved. That is a
// different fact about the session, not a second notation for the same one.
const summarise = (entry) => {
  const count = setsOf(entry).filter(setFilled).length;
  if (!count) return '';
  const sets = `${count} ${count === 1 ? 'set' : 'sets'}`;
  const load = loadOf(entry);
  return load ? `${sets} · ${load}` : sets;
};

// The record, stripped to what was actually written down. Opening an exercise
// offers a blank set so there is a row to type into, and that blank row lands
// in state like any other — but it is not a change to the record, and treating
// it as one is what made merely browsing the plan republish the page.
const persistable = (logs) => {
  const out = {};
  for (const [date, slots] of Object.entries(logs || {})) {
    const keptSlots = {};
    for (const [slot, entries] of Object.entries(slots || {})) {
      const kept = {};
      for (const [name, entry] of Object.entries(entries || {})) {
        // Canonical in the record, whatever the keypad produced.
        const sets = setsOf(entry)
          .filter(setFilled)
          .map((set) => ({ w: num(set.w), r: num(set.r) }));
        if (sets.length) kept[name] = { sets };
      }
      if (Object.keys(kept).length) keptSlots[slot] = kept;
    }
    if (Object.keys(keptSlots).length) out[date] = keptSlots;
  }
  return out;
};

// "4x6-8" is shorthand a lifter has to decode. Say it: "4 sets of 6-8 reps",
// keeping whatever the program appended — "+ drop set", "/leg".
const formatTarget = (target) => {
  const m = String(target).match(/^\s*(\d+)\s*[x×]\s*([\d-]+)(.*)$/i);
  if (!m) return target;
  const [, sets, reps, rest] = m;
  let out = `${sets} ${Number(sets) === 1 ? 'set' : 'sets'} of ${reps} reps`;
  const tail = rest.trim();
  if (tail.startsWith('/')) out += ` per ${tail.slice(1)}`;
  else if (tail) out += ` ${tail}`;
  return out;
};

// The next date a given session is due. The rotation reopens on Sunday, but
// each session has its own weekday inside it — Push A on Sunday, Pull A on
// Monday, Legs A on Tuesday and so on. Saying "Sunday" for all six answers a
// question about the rotation when the lifter asked one about the session in
// front of them.
//
// `|| 7` because landing on the session's own weekday means next week's: this
// only shows for a session already trained in the current rotation.
const nextDueDate = (slot, fromIso) => {
  const planned = SCHEDULE.find((x) => x.slot === slot);
  if (!planned || !fromIso) return null;
  const from = new Date(`${fromIso}T00:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  from.setDate(from.getDate() + ((planned.dow - from.getDay() + 7) % 7 || 7));
  return localDateStr(from);
};

const weekdayName = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'long' });
};

// Day and month, for a date the year of which is never in question.
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const prettyDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Publishing saves a new version of the page, and every open view reloads to
// it — this one included. Without a note of where the lifter was, that reload
// boots them onto whatever session is next due, mid-set. The note lives in
// sessionStorage so it survives the reload and nothing else.
// A store that has not answered within a beat. Not an error — just too slow to
// hold the first render for.
const SLOW_STORE = Symbol('slow-store');

const RESUME_KEY = 'resume-session';

const rememberPlace = (place) => {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(place));
  } catch (e) {
    // Blocked storage only costs the lifter their place, not their log.
  }
};

const takePlace = () => {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

// Exercises that have been renamed since they were first logged. Without this
// the sets stay in the record under the old name, still counting the session
// as trained, while showing nowhere on screen.
const RENAMED = {
  'Deficit Push-Ups / Weighted Dips': 'Deficit Push-Ups',
  'Weighted Pull-Ups / Lat Pulldown': 'Lat Pulldown',
  'Deadlift / Rack Pull': 'Rack Pull',
  'Reverse Pec-Deck / Band Pull-Apart': 'Reverse Pec-Deck',
  'Back Extension / Glute-Ham Raise': 'Glute-Ham Raise',
  'Donkey / Standing Calf Raise': 'Donkey Calf Raise',
};

// v1 stored a day's entries under the bare day name ("Push"); v2 splits each
// day into an A and a B variant. Existing logs belong to the A variants, which
// carry v1's exercises.
function migrate(logs) {
  let changed = false;
  const next = {};
  for (const [date, byDay] of Object.entries(logs || {})) {
    const slots = {};
    for (const [key, entries] of Object.entries(byDay || {})) {
      const target = DAYS.includes(key) ? slotKey(key, 'A') : key;
      if (DAYS.includes(key)) changed = true;
      const converted = {};
      for (const [rawName, entry] of Object.entries(entries || {})) {
        const exName = RENAMED[rawName] || rawName;
        if (exName !== rawName) changed = true;
        if (Array.isArray(entry?.sets)) {
          converted[exName] = entry;
          continue;
        }
        // The old shape said "s sets of r at w", so that is what it becomes.
        // Any set that was actually different can now be corrected in place.
        const count = Math.max(1, Math.min(20, Number(entry?.s) || 1));
        converted[exName] = {
          sets: Array.from({ length: count }, () => ({ w: entry?.w ?? '', r: entry?.r ?? '' })),
        };
        changed = true;
      }
      slots[target] = { ...(slots[target] || {}), ...converted };
    }
    next[date] = slots;
  }
  return { logs: next, changed };
}

function useStorage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (key, fallback) => {
    try {
      const res = await storage.get(key, false);
      return res ? JSON.parse(res.value) : fallback;
    } catch (e) {
      return fallback;
    }
  }, []);

  const save = useCallback(async (key, value) => {
    try {
      await storage.set(key, JSON.stringify(value), false);
      setError(null);
      return true;
    } catch (e) {
      setError('Could not save — check your connection and try again.');
      return false;
    }
  }, []);

  return { load, save, ready, setReady, error };
}

export default function WorkoutTracker() {
  const { load, save, ready, setReady, error } = useStorage();
  // Which of the four sections is on screen. The session tabs below are a
  // different thing entirely: they choose what to look at inside Home.
  const [view, setView] = useState('home');
  const [tab, setTab] = useState('Push');
  const [variant, setVariant] = useState('A');
  const [logs, setLogs] = useState({}); // { date: { "Push-A": { exName: {w,r,s} } } }
  const [bwLogs, setBwLogs] = useState([]); // [{date, weight, notes}]
  const [date, setDate] = useState(() => localDateStr());
  // The date follows the clock until a past session is picked deliberately.
  const [pinned, setPinned] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Dates whose record the lifter opened for correction, for this visit only.
  // Reached from the calendar and nowhere else: a session done this rotation
  // cannot be trained a second time, only written down more accurately.
  const [overrides, setOverrides] = useState({});
  // Saturday is rest for the date being viewed, not just for today. Training
  // one anyway is a deliberate catch-up, and only for that date.
  const [caughtUp, setCaughtUp] = useState({});
  // Tapping Rest looks at the rest day from any weekday, without moving off it.
  const [restPeek, setRestPeek] = useState(false);
  // What was chosen: follow the phone, or override it. Read synchronously and
  // matching the boot script in index.html exactly — the two disagreeing is a
  // repaint.
  const [themePref, setThemePref] = useState(() => {
    try {
      const t = JSON.parse(localStorage.getItem('theme'));
      if (t === 'dark' || t === 'light') return t;
    } catch (e) {
      /* blocked storage falls through to system */
    }
    return 'system';
  });
  // What the phone is set to, watched rather than sampled: on System the app
  // has to follow it turning over at sunset, not only at the next open.
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch (e) {
      return undefined;
    }
    const follow = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, []);
  const theme = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;
  const [showHistory, setShowHistory] = useState(false);
  const [openEx, setOpenEx] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [weightInput, setWeightInput] = useState('');
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  // Written down since the last publish. A ref alone cannot drive the button's
  // appearance, and the button is the only thing that says whether the record
  // has reached the page it lives in.
  const [pending, setPending] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  // Which identity field has been opened for editing, and the value being
  // typed. The draft lives here rather than in `profile`, so backing out
  // discards it and nothing is written on the way.
  const [editField, setEditField] = useState(null);
  const [draft, setDraft] = useState('');
  // Height sits on Stats beside the weight it is measured against, and it is
  // set once, so it locks the way anything set-once next to a live control
  // should.
  const [heightInput, setHeightInput] = useState('');
  const [heightUnlocked, setHeightUnlocked] = useState(false);
  const [exportState, setExportState] = useState(null);
  const [durable, setDurable] = useState(true);
  const publisherRef = useRef(null);
  const openedRef = useRef(false);
  // The store, once it answers, and the keys this device has written down but
  // has not yet got into it. That set is what lets a session trained out of
  // signal beat the store's older copy of the same day on the next load.
  const storeRef = useRef(null);
  const pendingKeysRef = useRef(new Set());
  const flushRef = useRef(null);
  const [downloader, setDownloader] = useState(null);

  useEffect(() => {
    (async () => {
      // Null on any page without the block — `npm run dev`, or any plain host.
      const embedded = readEmbedded() || {};

      // Where the first render comes from, in order of how current it is.
      //
      // The device copy is written on the same debounce as everything else, so
      // it is up to the minute. The block embedded in the page was up to the
      // minute too, until v8.1: the app republished itself on every save, and
      // rewrote the block each time. Once the store took over, the page stopped
      // republishing and the block froze at whatever was true when it was last
      // shipped. It has been read first on every open since — which shows the
      // lifter their training as it stood on that day until the store answers,
      // and that is what "my changes are missing" looks like from the outside.
      //
      // So: the device first, the store second, and the block only when there
      // is nothing else — which is a page with no store, the case it was
      // written for.
      const deviceLogs = await load('workout-logs', null);
      const deviceBw = await load('bodyweight-logs', null);
      const deviceProfile = await load('profile', null);
      const deviceHas = deviceLogs !== null || deviceBw !== null || deviceProfile !== null;

      const storePromise = getStore();
      let early = null;
      if (deviceHas) {
        early = { logs: deviceLogs || {}, bw: deviceBw || [], profile: deviceProfile };
      } else if (typeof window !== 'undefined' && typeof window.claude?.use === 'function') {
        // Nothing on this device and a store to ask. Waiting shows a spinner
        // for a moment; painting the block shows a log that is days old and
        // says nothing about being provisional. Bounded, so a store that never
        // answers costs a moment rather than the app.
        const waited = await Promise.race([
          storePromise,
          new Promise((r) => setTimeout(() => r(SLOW_STORE), 2500)),
        ]);
        if (waited && waited !== SLOW_STORE) {
          const first = await Promise.race([
            waited.readAll(),
            new Promise((r) => setTimeout(() => r(null), 2500)),
          ]);
          if (first && first.ok && !first.empty) {
            early = {
              logs: first.state['workout-logs'] || {},
              bw: first.state['bodyweight-logs'] || [],
              profile: first.state.profile,
            };
          }
        }
      }
      if (!early) {
        early = {
          logs: embedded['workout-logs'] || {},
          bw: embedded['bodyweight-logs'] || [],
          profile: embedded.profile,
        };
      }
      // The photo is the one thing worth taking from the block even when
      // something fresher exists, because it changes about never — a stale copy
      // is the same copy. Losing a face because one document did not come back
      // is a poor trade, and unlike a log it cannot mislead: it is either the
      // right picture or none.
      if (!early.profile?.photo && embedded.profile?.photo) {
        early.profile = { ...(early.profile || {}), photo: embedded.profile.photo };
      }

      const stored = early.logs;
      const b = early.bw;
      const p = early.profile;
      const { logs: migrated, changed } = migrate(stored);
      const { weights, changed: weightsChanged } = migrateWeights(b, localDateStr());
      setLogs(migrated);
      setBwLogs(weights);
      setProfile(normaliseProfile(p));

      // The theme is the one thing the embedded block must never decide. It is
      // frozen at whatever was true when the page was last published, and on
      // iOS the device copy it would be standing in for is exactly what gets
      // lost: Safari discards a cross-origin frame's localStorage when the tab
      // closes. So on the next open there is no device choice, the block says
      // something months old, and applying it repaints the whole app in the
      // wrong theme until the store answers a second later.
      //
      // Nothing is applied unless this device actually chose it. With no
      // choice, the boot script's default stands until the store speaks.
      const deviceTheme = await load('theme', null);
      const deviceChose = isThemePref(deviceTheme);
      if (deviceChose) setThemePref(deviceTheme);
      // The block is still good enough to seed an empty store on a first run,
      // which is the only thing it is used for now.
      const storedTheme = deviceChose
        ? deviceTheme
        : hasEmbeddedData(embedded)
          ? embedded.theme
          : null;

      setReady(true);
      if (changed) save('workout-logs', migrated);
      if (weightsChanged) {
        save('bodyweight-logs', weights);
        // The migrated log has to reach the published page too, but not by
        // publishing on load — that would reload every open view. Mark it and
        // let the next save or the page going away carry it.
        unpublishedRef.current = true;
        setPending(true);
      }

      // The capability resolves after the first render, or not at all.
      const publish = await getPublisher();
      publisherRef.current = publish;
      setDurable(Boolean(publish) || storageIsDurable());
      // Stored behind a thunk: passing a function to a setter makes React
      // treat it as an updater and call it, which is not what this is.
      getDownloader().then((offer) => setDownloader(() => offer));

      // The store answers later still, and by now the app is on screen and
      // working from the device copy. What the store holds is the record;
      // what this device is still carrying — a session trained out of signal,
      // a correction made out of range — is named in the pending set and
      // outranks it.
      pendingKeysRef.current = new Set(await load('db-pending', []));
      const store = await storePromise;
      storeRef.current = store;
      if (!store) return;
      setDurable(true);

      const local = {
        'workout-logs': persistable(migrated),
        'bodyweight-logs': weights,
        profile: normaliseProfile(p),
        theme: isThemePref(storedTheme) ? storedTheme : 'system',
      };
      // What the page carries is what it last published, and it now
      // publishes almost never. A session trained out of signal was written to
      // the device and nowhere else, so anything still held has to be read
      // back from there or the merge below would drop it on the floor.
      if (pendingKeysRef.current.size) {
        const deviceLogs = await load('workout-logs', {});
        const deviceProfile = await load('profile', null);
        const deviceBw = await load('bodyweight-logs', []);
        const deviceTheme = await load('theme', null);
        for (const key of pendingKeysRef.current) {
          const held = dateOfKey(key);
          if (held !== null) {
            if (deviceLogs[held]) local['workout-logs'][held] = deviceLogs[held];
            else delete local['workout-logs'][held];
          } else if (key === KEY.profile || key === KEY.photo) {
            if (deviceProfile) local.profile = normaliseProfile(deviceProfile);
          } else if (key === KEY.bodyweight) {
            local['bodyweight-logs'] = deviceBw;
          } else if (key === KEY.theme && isThemePref(deviceTheme)) {
            local.theme = deviceTheme;
          }
        }
      }

      const read = await store.readAll();
      if (!read.ok) return;

      if (read.empty) {
        // First run against an empty store: what the page is carrying moves
        // into it, and the embedded block stops being the record and becomes
        // a backup of it.
        await flushRef.current?.(changedKeys({}, local), local);
        return;
      }

      // A theme this device has actually chosen is held for the merge, so it
      // outranks the store. Not added to the pending set itself — nothing is
      // outstanding — but changedKeys below still writes it up if the store
      // disagrees, which quietly corrects a stale row.
      const heldForMerge = new Set(pendingKeysRef.current);
      if (deviceChose) heldForMerge.add(KEY.theme);
      const merged = mergeState(local, read.state, heldForMerge);
      setLogs(merged['workout-logs']);
      setBwLogs(merged['bodyweight-logs']);
      setProfile(normaliseProfile(merged.profile));
      if (isThemePref(merged.theme)) setThemePref(merged.theme);
      // A merge is not an edit. Without telling the debounced writers what is
      // now on record they read it back as something the lifter typed and
      // write the whole log again.
      savedRef.current = JSON.stringify(persistable(merged['workout-logs']));
      savedProfileRef.current = JSON.stringify(normaliseProfile(merged.profile));
      // Whatever this device contributed to that merge still has to get up.
      await flushRef.current?.(changedKeys(read.state, merged), merged);
    })();
  }, [load, save, setReady]);

  // Sessions trained in the current rotation, mapped to the day they were done.
  const today = localDateStr(now);
  const weekStart = weekStartStr(now);
  // Which cell in the strip the selected date falls on, or -1 when looking at
  // a date outside this week.
  const weekEnd = (() => {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + 6);
    return localDateStr(d);
  })();
  const selectedDow =
    date >= weekStart && date <= weekEnd ? new Date(`${date}T00:00:00`).getDay() : -1;

  const todayPlan = scheduledFor(now);
  const selectedIsRest = dowOf(date) === REST_DOW;
  // Rest is the default for the day being lived, not a verdict on the past.
  // Going back to a date asks what was recorded on it, and a Saturday answers
  // that the same way every other day does — the session, or nothing. Tapping
  // Rest in the strip is still a deliberate look at the rest day, whatever
  // date is on screen.
  const restView = restPeek || (selectedIsRest && date >= today && !caughtUp[date]);
  // Leaving the rest day is always a choice about the day on screen.
  const leaveRest = () => {
    setRestPeek(false);
    if (selectedIsRest) setCaughtUp((c) => ({ ...c, [date]: true }));
  };

  const cycle = useMemo(() => {
    const done = {};
    for (const [d, slots] of Object.entries(logs)) {
      // Work dated after today has not happened; it must not fill the week.
      if (d < weekStart || d > today) continue;
      for (const [slot, entries] of Object.entries(slots)) {
        if (!slotComplete(slot, entries)) continue;
        if (!done[slot] || d < done[slot]) done[slot] = d;
      }
    }
    return done;
  }, [logs, weekStart, today]);

  // The day a session was begun this week, whether or not it was finished.
  // A session belongs to the day it was started; a later day must not be able
  // to open a second copy of it.
  const begun = useMemo(() => {
    const first = {};
    for (const [d, slots] of Object.entries(logs)) {
      if (d < weekStart || d > today) continue;
      for (const [slot, entries] of Object.entries(slots)) {
        if (!Object.values(entries).some(isFilled)) continue;
        if (!first[slot] || d < first[slot]) first[slot] = d;
      }
    }
    return first;
  }, [logs, weekStart, today]);

  // Every day, in the whole record, that ended with a session finished. Not
  // scoped to this week — the streak is the one thing here that outlives the
  // Sunday reset.
  const trainedDays = useMemo(() => {
    const days = new Set();
    for (const [d, slots] of Object.entries(logs)) {
      if (d > today) continue;
      if (Object.entries(slots).some(([which, entries]) => slotComplete(which, entries))) {
        days.add(d);
      }
    }
    return days;
  }, [logs, today]);

  // Days with something written down but the session left unfinished. A missed
  // day reads differently when the lifter turned up and stopped halfway.
  const partialDays = useMemo(() => {
    const days = {};
    for (const [d, slots] of Object.entries(logs)) {
      if (d > today || trainedDays.has(d)) continue;
      for (const [which, entries] of Object.entries(slots)) {
        const names = SLOT_EXERCISES[which] || [];
        const done = names.filter((n) => isFilled(entries[n])).length;
        if (done) days[d] = { slot: which, done, total: names.length };
      }
    }
    return days;
  }, [logs, today, trainedDays]);

  const streak = useMemo(() => streakFrom(trainedDays, today), [trainedDays, today]);

  // Newest first. Stored order is whatever the last write left behind, and the
  // first entry is read as "current weight" in three places.
  const weightHistory = useMemo(
    () => [...bwLogs].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [bwLogs]
  );
  const latestWeight = weightHistory[0] || null;
  const age = ageOn(profile.dob, today);
  const exactBmi = bmiOf(latestWeight?.weight, profile.heightCm);
  // Classify what is shown, not what is held. Displaying one decimal while
  // grading the full value puts 24.96 on screen as 25.0 under a "Normal range"
  // pill — a contradiction with no way for the lifter to resolve it.
  const bmi = exactBmi === null ? null : Math.round(exactBmi * 10) / 10;
  const band = bandOf(bmi);
  const target = healthyRange(profile.heightCm);

  const doneCount = Object.keys(cycle).length;
  const weekComplete = doneCount >= ROTATION.length;
  const nextUp =
    todayPlan && !cycle[todayPlan.slot]
      ? todayPlan
      : ROTATION.find((r) => !cycle[r.slot]) || null;

  // A session is spent once it has been trained on some other day this
  // rotation. Two exceptions, both about correcting the record rather than
  // repeating the work: the day it was actually trained stays open, and so
  // does any past date — going back to a date deliberately is editing history,
  // which the rotation has no business blocking.
  const lockedOn = (day, variant) => {
    const slot = slotKey(day, variant);
    const doneOn = cycle[slot];
    if (!doneOn || overrides[`${slot}@${date}`]) return null;
    // The session being trained right now stays open; everything already done
    // shows as done, and is edited only on purpose.
    if (doneOn === date && date === today) return null;
    return doneOn;
  };

  // Land on a session that's still available for the day being opened.
  const pickVariant = (day) =>
    VARIANTS.find((v) => !lockedOn(day, v)) || VARIANTS[0];

  // The session trained on a given day, if any. Going to a date is going to
  // what was done on it — landing on whatever session happened to be open
  // shows an empty form for a day that already has a record.
  const sessionOn = (iso) => {
    const slots = logs[iso] || {};
    return ROTATION.find((r) => Object.values(slots[r.slot] || {}).some(isFilled)) || null;
  };

  // Arriving at a date with the record already open for writing. The effect
  // that clears overrides owns them, so this leaves it a note rather than
  // setting one the same render would wipe.
  const openOnArrivalRef = useRef(null);

  const goToDate = (picked, openForWriting = false) => {
    // A session cannot have been trained on a day that hasn't happened.
    if (!picked || picked > today) return;
    const trained = sessionOn(picked);
    if (openForWriting) {
      openOnArrivalRef.current = { date: picked, slot: trained ? trained.slot : slot };
    }
    setDate(picked);
    setPinned(true);
    setRestPeek(false);
    setOpenEx(null);
    if (trained) {
      setTab(trained.day);
      setVariant(trained.variant);
    }
  };

  // Leaving Home ends the visit to whatever day was being looked at. A past
  // date is opened deliberately, through the calendar, and reached for a
  // reason; crossing to Stats and back is not that reason, and coming back to
  // a form for 30 August three days later is a good way to write to the wrong
  // day. So the section resets to the day being trained and the session due on
  // it. A reload is not a section change and still restores the lifter's place.
  const resetToToday = () => {
    setDate(today);
    setPinned(false);
    setRestPeek(false);
    setOpenEx(null);
    if (nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
    }
  };

  // Coming back to today from a past date left the session you were correcting
  // on screen — and today refuses it, so you landed on its lock card rather
  // than on the session actually due. Only rescue that case; a session today
  // still allows is left alone.
  const returnToToday = () => {
    setDate(today);
    setPinned(false);
    setRestPeek(false);
    const trainedOn = cycle[slotKey(tab, variant)];
    if (trainedOn && trainedOn !== today && nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
      setOpenEx(null);
    }
  };

  // Open on the session that's actually due — unless a publish reloaded the
  // page out from under the lifter, in which case put them back where they
  // were. Saving mid-session must not read as being moved on to the next one.
  useEffect(() => {
    if (!ready || openedRef.current) return;
    openedRef.current = true;
    const place = takePlace();
    if (place && place.tab && place.variant) {
      const when = place.date && place.date <= today ? place.date : today;
      setDate(when);
      setPinned(when !== today);
      setTab(place.tab);
      setVariant(place.variant);
      if (place.view) setView(place.view);
      return;
    }
    if (nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
    }
  }, [ready, nextUp, today]);

  const slot = slotKey(tab, variant);
  const isFilledSlot = (iso, which) =>
    Object.values((logs[iso] || {})[which] || {}).some(isFilled);

  const locked = lockedOn(tab, variant);

  // A past day with nothing logged for this session is a gap in the record,
  // not an invitation to fill one in by accident. Say so, and make writing to
  // it deliberate.
  const session = PROGRAM[tab][variant];
  const override = Boolean(overrides[`${slot}@${date}`]);
  const hasRecord = isFilledSlot(date, slot);
  const begunOn = begun[slot];

  // A day that has passed holds a record or it does not. Either way it is read
  // first and written to only on purpose, through the calendar.
  const pastRecord = date < today && hasRecord && !override;

  // Today, for a session begun on an earlier day and left unfinished: nothing
  // is recorded for it today, and logging here would start a second copy of a
  // session that belongs to another day.
  const stranded =
    date === today &&
    Boolean(begunOn) &&
    begunOn !== today &&
    !cycle[slot] &&
    !override;

  const unrecorded = (date < today && !hasRecord && !override) || stranded;

  // The day this session's record actually lives on: the date being looked at
  // when it holds one, otherwise the day the rotation says it was trained.
  const recordDate = pastRecord ? date : locked;
  const nextDue = nextDueDate(slot, today);

  const progressOn = (iso, which, exercises) => {
    const entries = (logs[iso] || {})[which] || {};
    const names = (exercises || []).map((ex) => ex.name);
    return { done: names.filter((n) => isFilled(entries[n])).length, total: names.length };
  };

  const getEntry = (exName) =>
    (logs[date] && logs[date][slot] && logs[date][slot][exName]) || { sets: [] };

  // Everything recorded for the session on screen: the program's exercises in
  // their own order, then anything logged under a name the program no longer
  // has. Work that counts the session as trained must be visible somewhere,
  // even if the program has moved on since it was done.
  const recorded = () => {
    const entries = (logs[date] || {})[slot] || {};
    const planned = (session?.exercises || []).map((ex) => ex.name);
    const orphaned = Object.keys(entries).filter((name) => !planned.includes(name));
    return [...planned, ...orphaned]
      .filter((name) => isFilled(entries[name]))
      .map((name) => ({ name, entry: entries[name] }));
  };

  const writeSets = (exName, sets) => {
    setLogs((prev) => {
      const next = { ...prev };
      next[date] = { ...(next[date] || {}) };
      next[date][slot] = { ...(next[date][slot] || {}) };
      next[date][slot][exName] = { sets };
      return next;
    });
  };

  const updateSet = (exName, index, field, value) => {
    const clean = cleanNumber(value, field === 'w', field === 'w' ? MAX.setWeight : MAX.reps);
    if (clean === null) return;
    const sets = setsOf(getEntry(exName)).map((set, i) =>
      i === index ? { ...set, [field]: clean } : set
    );
    writeSets(exName, sets);
  };

  // A new set starts from the one before it, so an unchanged set is a tap and
  // only a changed one needs typing.
  const addSet = (exName) => {
    const sets = setsOf(getEntry(exName));
    const previous = sets[sets.length - 1];
    writeSets(exName, [...sets, previous ? { ...previous } : { w: '', r: '' }]);
  };

  const removeSet = (exName, index) =>
    writeSets(exName, setsOf(getEntry(exName)).filter((_, i) => i !== index));

  // Every earlier date that has entries for the day/variant on screen, newest
  // first — the running record for this specific session.
  const history = useMemo(
    () =>
      Object.entries(logs)
        .filter(([d]) => d < date)
        .map(([d, byDay]) => {
          // Program order, then anything logged under a name it no longer has.
          // Storage order is an accident — renaming an exercise moves its key
          // to the end of the object — and must not decide what is shown.
          const entries = byDay[slot] || {};
          const planned = SLOT_EXERCISES[slot] || [];
          const orphaned = Object.keys(entries).filter((n) => !planned.includes(n));
          return {
            date: d,
            entries: [...planned, ...orphaned]
              .filter((name) => isFilled(entries[name]))
              .map((name) => ({ name, ...entries[name] })),
          };
        })
        .filter((h) => h.entries.length > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [logs, slot, date]
  );

  // What was lifted on this exercise last time, so the next set has a target.
  const lastFor = (exName) => {
    for (const h of history) {
      const found = h.entries.find((e) => e.name === exName);
      if (found) return { ...found, date: h.date };
    }
    return null;
  };

  const publishRef = useRef(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // Every publish rewrites the whole page, so it carries everything — passing
  // one piece and letting the others default to the last render would drop
  // whichever the caller forgot.
  const publishAll = async (nextLogs, nextBw, nextProfile) => {
    // Publishing is the fallback now. Once the store has answered the record
    // is already durable beside the page, and republishing would reload every
    // open view — the lifter's included — to change nothing.
    if (storeRef.current) return true;
    const publish = publisherRef.current;
    if (!publish) return true;
    const res = await publish({
      'workout-logs': nextLogs,
      'bodyweight-logs': nextBw,
      profile: nextProfile ?? profileRef.current,
      theme,
    });
    return res.ok;
  };
  publishRef.current = publishAll;

  // The preference is what is written down; the resolved theme is a reading of
  // it and the phone together, and would be wrong on another device.
  const themeRef = useRef(themePref);
  themeRef.current = themePref;

  // A complete state for the store to write from. writeKeys only touches the
  // keys it is handed, but it reads them all out of one object, so a caller
  // that knows about one change need not assemble the rest.
  const stateOf = (record, bw, prof, th) => ({
    'workout-logs': record ?? persistable(logsRef.current),
    'bodyweight-logs': bw ?? bwRef.current,
    profile: prof ?? profileRef.current,
    theme: th ?? themeRef.current,
  });

  // Write the named keys, holding each in the pending set until the store
  // confirms it. A key that never confirms stays held, and the next load lets
  // this device's copy win rather than reading an older day back over it.
  const flushKeys = async (keys, state) => {
    const store = storeRef.current;
    if (!store || !keys?.length) return;
    for (const k of keys) pendingKeysRef.current.add(k);
    save('db-pending', [...pendingKeysRef.current]);
    const { written } = await store.writeKeys(keys, state);
    for (const k of written) pendingKeysRef.current.delete(k);
    save('db-pending', [...pendingKeysRef.current]);
    // The button says whether the record is filed, so it has to follow what
    // the store actually took.
    const outstanding = pendingKeysRef.current.size > 0;
    unpublishedRef.current = outstanding;
    setPending(outstanding);
  };
  flushRef.current = flushKeys;

  // Typing is the save: numbers reach the device as soon as they stop moving,
  // so a session cannot be lost by never pressing the button.
  //
  // Publishing is not, and must never be on a timer. Saving a new version of
  // the page reloads every open view of it, this one included — mid-session
  // that throws the lifter back to today's session with everything closed. It
  // happens only when the lifter acts (the Save button) or when the page is
  // going away, which is the moment the device copy might not survive.
  const logsRef = useRef(logs);
  const bwRef = useRef(bwLogs);
  logsRef.current = logs;
  bwRef.current = bwLogs;

  // Where the lifter is, kept current. Writing this at publish time instead
  // recorded where they were when they pressed Save — so moving to another
  // section before the publish's reload arrived put them back on the one they
  // had left. It is a sessionStorage write per navigation and nothing more.
  useEffect(() => {
    if (!ready) return;
    rememberPlace({ date, tab, variant, view });
  }, [ready, date, tab, variant, view]);

  // Written down since the last publish, and so not yet durable.
  const unpublishedRef = useRef(false);
  // The record as last written to the device; null until the load settles.
  const savedRef = useRef(null);
  const savedProfileRef = useRef(null);

  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.stringify(persistable(logs));
    // The first pass after loading is the loaded record, not an edit.
    if (savedRef.current === null) {
      savedRef.current = snapshot;
      return;
    }
    // Opening and closing exercises moves state without changing the record.
    if (snapshot === savedRef.current) return;
    // Outstanding from the keystroke, not from the timer. The record counts a
    // set the moment it is typed, so leaving this until the debounce fired let
    // the button say "Saved" over a set that had not reached anything yet.
    unpublishedRef.current = true;
    setPending(true);
    const id = setTimeout(() => {
      const previous = savedRef.current;
      savedRef.current = snapshot;
      const record = JSON.parse(snapshot);
      save('workout-logs', record);
      // The store takes the day that changed on the same debounce as the
      // device copy. This is the write that makes the record durable, and
      // unlike a publish it moves nothing on screen.
      flushKeys(
        changedKeys({ 'workout-logs': JSON.parse(previous) }, { 'workout-logs': record }),
        stateOf(record)
      );
    }, 500);
    return () => clearTimeout(id);
  }, [logs, ready, save]);

  // The profile follows the same policy as the log: typing reaches the device
  // on its own, and publishing waits for the lifter to act or for the page to
  // go away.
  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.stringify(profile);
    if (savedProfileRef.current === null) {
      savedProfileRef.current = snapshot;
      return;
    }
    if (snapshot === savedProfileRef.current) return;
    const id = setTimeout(() => {
      const previous = savedProfileRef.current;
      savedProfileRef.current = snapshot;
      unpublishedRef.current = true;
      setPending(true);
      const clean = JSON.parse(snapshot);
      save('profile', clean);
      flushKeys(
        changedKeys({ profile: JSON.parse(previous) }, { profile: clean }),
        stateOf(undefined, undefined, clean)
      );
    }, 500);
    return () => clearTimeout(id);
  }, [profile, ready, save]);

  // A phone locking mid-set, or the tab closing, must not be a way to lose
  // work. Hidden is also the one moment a reload costs nothing.
  useEffect(() => {
    const flush = () => {
      const record = persistable(logsRef.current);
      savedRef.current = JSON.stringify(record);
      save('workout-logs', record);
      // Anything the store still has not taken goes up now: back in signal
      // and closing the app is the last chance the page gets.
      flushRef.current?.([...pendingKeysRef.current], stateOf(record));
      if (!unpublishedRef.current) return;
      unpublishedRef.current = false;
      setPending(false);
      publishRef.current?.(record, bwRef.current, profileRef.current);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [save]);

  // Height shows what is on record, so "locked until changed" means something:
  // against an empty box every value differs, and the Save would sit lit from
  // the moment the screen opened.
  useEffect(() => {
    if (!ready) return;
    setHeightInput(String(profile.heightCm || ''));
  }, [ready, profile.heightCm]);

  // Leaving a screen abandons whatever was half-typed on it. Coming back to a
  // field still holding an edit from ten minutes ago is a trap: it reads as a
  // value that was chosen rather than one walked away from, and its Save may
  // be sitting lit over it. Keyed on the section alone — the record it resets
  // to is read at the moment of the change, not followed.
  useEffect(() => {
    const known = weightHistory.find((e) => e.date === today) || weightHistory[0];
    setWeightInput(known ? String(known.weight) : '');
    setHeightInput(String(profile.heightCm || ''));
    setHeightUnlocked(false);
    setEditField(null);
    setDraft('');
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLogs = async () => {
    const record = persistable(logs);
    const previous = savedRef.current;
    savedRef.current = JSON.stringify(record);
    unpublishedRef.current = false;
    setPending(false);
    const ok = await save('workout-logs', record);
    // The button is a flush: the day just written plus anything the store
    // refused earlier.
    const keys = new Set(pendingKeysRef.current);
    for (const k of changedKeys(
      { 'workout-logs': JSON.parse(previous || '{}') },
      { 'workout-logs': record }
    ))
      keys.add(k);
    await flushKeys([...keys], stateOf(record));
    const published = await publishAll(record, bwLogs);
    if (ok || published) {
      setSavedFlash('workout');
      setTimeout(() => setSavedFlash(null), 1500);
    }
  };

  // Saving the profile also files the weight against today, so the record of
  // what the lifter weighed keeps its dates without asking them to log it in a
  // second place.
  // A field commits from its own screen. The debounced writer picks the change
  // up out of `profile` exactly as it always did, so persistence is untouched.
  const commitField = (key, value) => {
    setProfile((p) => ({ ...p, [key]: typeof value === 'string' ? value.trim() : value }));
  };

  const openField = (key) => {
    setDraft(String(profile[key] ?? ''));
    setEditField(key);
  };
  // Backing out of an edit discards it, silently, the way every app that does
  // this does. A dialog on a path walked twice a year is not worth its weight.
  const closeField = () => {
    setEditField(null);
    setDraft('');
  };
  const commitDraft = () => {
    if (!editField || !draftReady) return;
    commitField(editField, draft);
    closeField();
  };

  // Weight is the one measurement that moves, and it files against today.
  const saveWeight = async () => {
    if (!weightReady) return;
    const weight = num(String(weightInput).trim());
    const nextBw = [
      ...weightHistory.filter((e) => e.date !== today),
      { date: today, weight },
    ].sort((a, b) => (a.date < b.date ? 1 : -1));
    setBwLogs(nextBw);
    await save('bodyweight-logs', nextBw);
    const keys = new Set(pendingKeysRef.current);
    keys.add(KEY.bodyweight);
    await flushKeys([...keys], stateOf(persistable(logs), nextBw));
    await publishAll(persistable(logs), nextBw);
    setSavedFlash('weight');
    setTimeout(() => setSavedFlash(null), 1500);
  };

  const unlockHeight = () => {
    setHeightInput(String(profile.heightCm || ''));
    setHeightUnlocked(true);
  };
  const saveHeight = () => {
    if (!heightReady) return;
    commitField('heightCm', num(String(heightInput).trim()));
    setHeightUnlocked(false);
    setSavedFlash('height');
    setTimeout(() => setSavedFlash(null), 1500);
  };

  // The whole record as one file: every session, the weights, the profile and
  // the photo, in the same shape the app reads. While the log lived inside the
  // page, saving the page was a complete backup — this is that back.
  const exportLog = async () => {
    if (!downloader) return;
    const body = JSON.stringify(
      {
        'workout-logs': persistable(logs),
        'bodyweight-logs': weightHistory,
        profile,
        theme,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    const res = await downloader(`training-log-${today}.json`, body);
    if (res.ok) {
      setExportState('saved');
      setTimeout(() => setExportState(null), 1500);
      return;
    }
    // Declining the prompt is an answer, not a fault. Only a real refusal is
    // worth putting on screen.
    if (res.code !== 'declined') {
      setExportState('failed');
      setTimeout(() => setExportState(null), 3000);
    }
  };

  const pickPhoto = async (file) => {
    if (!file) return;
    setPhotoError(null);
    try {
      const photo = await readAvatar(file);
      setProfile((p) => ({ ...p, photo }));
    } catch (e) {
      setPhotoError('That file could not be read as a photo.');
    }
  };

  // Re-read the clock periodically, and whenever the page comes back to the
  // foreground — a phone left locked mid-workout wakes up on the wrong day.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Remember it on the device straight away, so the switch is instant rather
  // than waiting on the next save.
  const applyAppearance = (pref) => {
    if (!isThemePref(pref)) return;
    setThemePref(pref);
    save('theme', pref);
    flushKeys([KEY.theme], stateOf(undefined, undefined, undefined, pref));
  };
  // The button in the header is a quick override: it sets the opposite of what
  // is on screen now, whether that came from the phone or from a choice.
  const toggleTheme = () => applyAppearance(theme === 'light' ? 'dark' : 'light');

  useEffect(() => {
    if (!pinned) setDate(today);
  }, [today, pinned]);

  // Midnight moves the app on to the new day: the session that is due now, not
  // whatever was left on screen when the date turned over.
  const dayRef = useRef(today);
  useEffect(() => {
    if (dayRef.current === today) return;
    dayRef.current = today;
    if (pinned) return;
    setRestPeek(false);
    setOpenEx(null);
    if (nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
    }
  }, [today, pinned, nextUp]);

  // Reset on the way back into Home, not on boot — a publish's reload must
  // still put the lifter back where they were, and that is not a section
  // change.
  // The capsule is one element that moves, not one per section appearing and
  // disappearing. Its position and width are measured from whichever cell is
  // current, because the capsule hugs its label and "Profile" is wider than
  // "Home" — so this cannot be done with a quarter-width slide.
  const navRef = useRef(null);
  const [capsule, setCapsule] = useState(null);
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => {
      const marked = nav.querySelector('[aria-current="page"] > span');
      if (!marked) return;
      const outer = nav.getBoundingClientRect();
      const box = marked.getBoundingClientRect();
      // Offsets are from the padding box, which is where an absolutely
      // positioned child starts; getBoundingClientRect gives the border box,
      // and the bar has a border.
      setCapsule({
        left: box.left - outer.left - nav.clientLeft,
        top: box.top - outer.top - nav.clientTop,
        width: box.width,
        height: box.height,
      });
    };
    measure();
    // A rotation or a font settling changes the widths under it.
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
    // `ready` matters: until the log has loaded the app renders a spinner and
    // there is no bar to measure, and the view has not changed to prompt a
    // second look.
    // editField matters as much as view: the bar unmounts while a field is
    // open, so the capsule has to be measured again when it comes back.
  }, [view, ready, editField]);

  // The first placement is where the capsule already is, not somewhere it
  // slides in from.
  useEffect(() => {
    if (capsule) settledRef.current = true;
  }, [capsule]);

  const cameFromRef = useRef(view);
  useEffect(() => {
    const previous = cameFromRef.current;
    cameFromRef.current = view;
    if (view !== 'home' || previous === 'home') return;
    resetToToday();
  });

  // Choosing to edit a day is a decision about that day, taken now. Leaving it
  // ends the edit: without this the unlock outlived the visit, so coming back
  // to the date reopened the form instead of showing the record, and only a
  // save appeared to close it — because saving republishes and the reload took
  // the state with it.
  useEffect(() => {
    const wanted = openOnArrivalRef.current;
    openOnArrivalRef.current = null;
    setOverrides(wanted && wanted.date === date ? { [`${wanted.slot}@${date}`]: true } : {});
  }, [date]);

  // The weight field is a current weight, not a blank form to fill in daily: it
  // shows today's entry if there is one, and the last one on record otherwise.
  // So Save starts live on a day nothing has been logged — pressing it files
  // that weight against today, which is a change — and locks once it matches
  // what today already holds.
  useEffect(() => {
    const known = weightHistory.find((e) => e.date === today) || weightHistory[0];
    setWeightInput(known ? String(known.weight) : '');
  }, [today, weightHistory]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-night">
        <Loader2 className="animate-spin text-mint" size={28} />
      </div>
    );
  }

  const clock = `${now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })} · ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  const accentOf = (v) => (v === 'A' ? 'mint' : 'amber');

  // The session the program asked for on a given date, which is what a missed
  // day missed.
  const dueOn = (iso) => SCHEDULE.find((x) => x.dow === dowOf(iso)) || null;

  // The Save bar belongs to a session in progress, and so to Home alone.
  const editing = editField ? fieldByKey(editField) : null;
  const draftValid = editing ? validField(editing.key, draft, today) : false;
  const draftChanged = editing
    ? String(draft).trim() !== String(profile[editing.key] ?? '').trim()
    : false;
  // Both halves, always together: a Save that lights for an unchanged value
  // writes what is already there, and one that lights for an invalid value
  // writes rubbish.
  const draftReady = draftValid && draftChanged;

  const todayWeightEntry = weightHistory.find((e) => e.date === today) || null;
  const weightReady =
    plausibleWeight(weightInput) &&
    (!todayWeightEntry || Number(todayWeightEntry.weight) !== Number(weightInput));
  const heightReady =
    plausibleHeight(heightInput) && Number(heightInput) !== Number(profile.heightCm);
  const heightLocked = Boolean(profile.heightCm) && !heightUnlocked;

  // What a row shows to the right of its label. Empty reads as "Not set" so an
  // unfilled field looks unfilled rather than broken.
  const rowValue = (f) => {
    const v = profile[f.key];
    if (!v) return null;
    if (f.key === 'dob') return age === null ? prettyDate(v) : `${prettyDate(v)} · ${age}`;
    return v;
  };

  const showSave =
    view === 'home' && !locked && !pastRecord && !restView && !unrecorded;

  const streakNote = (() => {
    if (!trainedDays.size) return 'Finish every exercise in a session and the streak starts.';
    if (!streak.current) {
      return streak.missed[0]
        ? `Last broken on ${prettyDate(streak.missed[0])}. Finish a session to start again.`
        : 'Finish a session to start again.';
    }
    if (trainedDays.has(today)) return 'Today is counted. Saturday is rest — it costs nothing.';
    if (dowOf(today) === REST_DOW) return 'Saturday is rest. The streak carries over to Sunday.';
    return nextUp ? `Finish ${nextUp.label} today to keep it.` : 'Finish today’s session to keep it.';
  })();

  // Where this BMI falls on the scale the bands are drawn against. 15 to 42
  // covers everything the classification distinguishes without squashing the
  // normal band into a sliver.
  const SCALE_MIN = 15;
  const SCALE_MAX = 42;
  const scalePos =
    bmi === null
      ? null
      : Math.min(100, Math.max(0, ((bmi - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
  const toneBg = { mint: 'bg-mint', amber: 'bg-amber', danger: 'bg-danger' };
  const toneText = { mint: 'text-mint', amber: 'text-amber', danger: 'text-danger' };
  const toneFill = { mint: 'bg-mint-dim', amber: 'bg-amber-dim', danger: 'bg-danger-dim' };

  // Why there is no reading. Missing and implausible are different problems and
  // "two numbers missing" was said for both — including when only one was.
  const statsGap = (() => {
    const missing = [];
    if (!profile.heightCm) missing.push('height');
    if (!latestWeight) missing.push('weight');
    if (missing.length) {
      return {
        title: missing.length > 1 ? 'Two numbers missing' : 'One number missing',
        // The fields are directly above this message now, so it points at
        // them rather than sending the reader to another tab.
        body: `BMI needs your ${missing.join(' and your ')}. ${
          missing.length > 1 ? 'Both are' : 'It is'
        } at the top of this screen.`,
      };
    }
    const wrong = [];
    if (!plausibleHeight(profile.heightCm)) wrong.push(`${num(profile.heightCm)} cm`);
    if (!plausibleWeight(latestWeight.weight)) wrong.push(`${num(latestWeight.weight)} kg`);
    return {
      title: 'That does not look right',
      body: `There is no BMI to give for ${wrong.join(' and ')}. Worth checking at the top of this screen.`,
    };
  })();

  return (
    <div
      className={`min-h-screen bg-night text-fg font-sans ${showSave ? 'pb-40' : 'pb-28'}`}
    >
      {view === 'home' ? (
        <header className="sticky top-0 z-20 bg-night border-b border-line px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-bold uppercase tracking-wider flex items-center gap-2">
              <Dumbbell size={18} className="text-mint" />
              Training Log
            </h1>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={toggleTheme}
                aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
                className="w-9 h-9 rounded-full bg-surface border border-line text-dim flex items-center justify-center"
              >
                {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
              </button>
              <button onClick={() => setView('profile')} aria-label="Profile">
                <Avatar profile={profile} size={36} />
              </button>
              <span className="text-xs text-dim nums font-semibold">v{APP_VERSION}</span>
            </div>
          </div>
          <div className="mt-1 text-[15px] text-dim font-semibold font-semibold">
            {date === today ? clock : `Viewing ${prettyDate(date)}`}
          </div>

          {/* The week as a strip: which session belongs to which day, what's done,
              where today sits. Tapping a day opens that session. */}
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {DOW.map((label, dow) => {
              const planned = SCHEDULE.find((x) => x.dow === dow);
              const isToday = now.getDay() === dow;
              const isSelected = restView ? !planned : selectedDow === dow;
              const done = planned && cycle[planned.slot];
              const accent = planned ? accentOf(planned.variant) : null;
              return (
                <button
                  key={label}
                  onClick={() => {
                    setOpenEx(null);
                    if (!planned) {
                      setRestPeek(true);
                      return;
                    }
                    // The strip is this week's plan, not a way back into a day
                    // already trained: it says how each session stands and always
                    // stays on today. Going back to change what was logged is the
                    // calendar's job, and only the calendar's.
                    setRestPeek(false);
                    setDate(today);
                    setPinned(false);
                    if (dowOf(today) === REST_DOW) {
                      setCaughtUp((c) => ({ ...c, [today]: true }));
                    }
                    setTab(planned.day);
                    setVariant(planned.variant);
                  }}
                  className={`rounded-lg py-1.5 flex flex-col items-center gap-1.5 border transition ${
                    isSelected
                      ? 'border-fg bg-fg'
                      : isToday
                        ? 'border-fg/40 bg-surface'
                        : 'border-transparent'
                  }`}
                >
                  <span
                    className={`text-xs font-bold uppercase tracking-wide ${
                      isSelected ? 'text-night' : isToday ? 'text-fg' : 'text-dim'
                    }`}
                  >
                    {planned ? label[0] : 'Rest'}
                  </span>
                  <span
                    className={`h-1.5 w-full rounded-full ${
                      !planned
                        ? 'bg-line'
                        : done
                          ? accent === 'mint'
                            ? 'bg-mint'
                            : 'bg-amber'
                          : accent === 'mint'
                            ? 'bg-mint-dim'
                            : 'bg-amber-dim'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked === today) {
                  returnToToday();
                  return;
                }
                goToDate(picked);
              }}
              className="bg-raised text-fg text-xs rounded-lg px-2.5 py-1.5 border border-line nums"
            />
            {date !== today && (
              <button
                onClick={returnToToday}
                className="text-xs font-semibold text-dim bg-surface border border-line rounded-lg px-3 py-1.5"
              >
                Today
              </button>
            )}
            <span className="ml-auto text-[15px] text-dim nums font-semibold">
              {doneCount}/{ROTATION.length} this week
            </span>
          </div>
        </header>
      ) : editing ? null : (
        <header className="sticky top-0 z-20 bg-night border-b border-line px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-bold uppercase tracking-wider flex items-center gap-2">
              {(() => {
                const { Icon, label } = NAV.find((n) => n.key === view);
                return (
                  <>
                    <Icon size={18} className="text-mint" />
                    {label}
                  </>
                );
              })()}
            </h1>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={toggleTheme}
                aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
                className="w-9 h-9 rounded-full bg-surface border border-line text-dim flex items-center justify-center"
              >
                {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
              </button>
              <span className="text-xs text-dim nums font-semibold">v{APP_VERSION}</span>
            </div>
          </div>
        </header>
      )}

      {!durable && (
        <div className="mx-4 mt-3 bg-danger-dim border border-danger/40 text-danger text-sm rounded-xl px-3 py-2.5">
          <span className="font-semibold">This browser isn’t keeping saved data.</span> Your
          entries will disappear when you close the page. In Safari, turn off Settings → Apps
          → Safari → Prevent Cross-Site Tracking, or open this page in another browser.
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 bg-danger-dim border border-danger/40 text-danger text-sm rounded-xl px-3 py-2.5">
          {error}
        </div>
      )}

      {view === 'home' && (
        <>
        <div className="flex px-4 mt-4 gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => {
                leaveRest();
                setTab(d);
                setVariant(pickVariant(d));
                setOpenEx(null);
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                tab === d ? 'bg-fg text-night' : 'bg-surface text-dim border border-line'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {restView ? (
          <div className="px-4 mt-4">
            <div className="bg-surface border border-line rounded-2xl px-5 py-10 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-raised text-dim flex items-center justify-center">
                <Moon size={24} />
              </div>
              <div className="font-display text-3xl font-bold uppercase tracking-wide mt-4">
                Rest day
              </div>
              <div className="text-[15px] text-dim font-semibold mt-2 leading-relaxed max-w-[22rem] mx-auto">
                Rest it out today, you’ll get stronger tomorrow.
              </div>
              <div className="mt-6 pt-5 border-t border-line text-[15px] text-dim font-semibold nums">
                {doneCount} of {ROTATION.length} sessions done this week
              </div>
              {weekComplete ? (
                <div className="text-[15px] text-dim font-semibold mt-1">The rotation reopens Sunday.</div>
              ) : nextUp ? (
                <button
                  onClick={() => {
                    leaveRest();
                    setTab(nextUp.day);
                    setVariant(nextUp.variant);
                    setOpenEx(null);
                  }}
                  className="mt-4 bg-raised text-fg border border-line rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  Catch up: {nextUp.label}
                </button>
              ) : null}
            </div>

            <div className="mt-6">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide text-dim mb-2">
                This week
              </h2>
              <div className="space-y-2">
                {ROTATION.map((r) => {
                  const on = cycle[r.slot];
                  return (
                    <div
                      key={r.slot}
                      className="bg-surface border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center ${
                            on
                              ? r.variant === 'A'
                                ? 'bg-mint text-night'
                                : 'bg-amber text-night'
                              : 'bg-raised text-dim'
                          }`}
                        >
                          {on ? <Check size={13} /> : null}
                        </span>
                        <span className="font-semibold text-[15px] truncate">{r.label}</span>
                      </div>
                      <span className="text-[15px] text-dim font-semibold shrink-0 nums">
                        {on ? prettyDate(on) : DOW[r.dow]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 mt-4">
            <div className="flex gap-2 items-center">
              {VARIANTS.map((v) => {
                const spent = Boolean(lockedOn(tab, v));
                const onToday = cycle[slotKey(tab, v)] === date;
                const on = variant === v;
                const accent = accentOf(v);
                return (
                  <button
                    key={v}
                    onClick={() => {
                      setVariant(v);
                      setOpenEx(null);
                    }}
                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition flex items-center gap-1.5 ${
                      on
                        ? accent === 'mint'
                          ? 'bg-mint-dim text-mint border-mint/40'
                          : 'bg-amber-dim text-amber border-amber/40'
                        : 'bg-surface text-dim border-line'
                    }`}
                  >
                    Day {v}
                    {spent || onToday ? <Check size={14} /> : null}
                  </button>
                );
              })}
              <span className="ml-auto text-sm text-dim text-right font-semibold">
                {weekComplete
                  ? 'Reopens Sunday'
                  : nextUp
                    ? `Next: ${nextUp.label}${
                        todayPlan && nextUp.slot === todayPlan.slot ? ' · today' : ''
                      }`
                    : ''}
              </span>
            </div>

            {unrecorded ? (
              <div className="mt-4 bg-surface border border-line rounded-2xl px-5 py-8 text-center">
                <div className="mx-auto w-11 h-11 rounded-full bg-raised text-dim flex items-center justify-center">
                  <CalendarX size={21} />
                </div>
                <div className="font-display text-2xl font-bold uppercase tracking-wide mt-3">
                  Session not recorded
                </div>
                <div className="text-sm text-dim mt-1">
                  Nothing was logged for {tab} {variant} on {prettyDate(date)}.
                </div>
                {stranded && (
                  <div className="text-sm text-dim mt-2 leading-relaxed max-w-[22rem] mx-auto">
                    It was started on {prettyDate(begunOn)} —{' '}
                    {progressOn(begunOn, slot, session?.exercises).done} of{' '}
                    {progressOn(begunOn, slot, session?.exercises).total} exercises. Finish it on
                    the day it belongs to.
                  </div>
                )}
                {stranded ? (
                  <button
                    // The card above says to finish it on the day it belongs
                    // to. Landing on a read-only record and asking for another
                    // tap is not that.
                    onClick={() => goToDate(begunOn, true)}
                    className="mt-5 bg-mint text-night rounded-xl px-5 py-3 text-sm font-bold"
                  >
                    Go to {prettyDate(begunOn)}
                  </button>
                ) : (
                  <button
                    onClick={returnToToday}
                    className="mt-5 bg-mint text-night rounded-xl px-5 py-3 text-sm font-bold"
                  >
                    Back to today
                  </button>
                )}
                {stranded && nextUp && (
                  <button
                    onClick={() => {
                      setTab(nextUp.day);
                      setVariant(nextUp.variant);
                      setOpenEx(null);
                    }}
                    className="block mx-auto mt-4 text-sm font-semibold text-dim underline"
                  >
                    Go to {nextUp.label}
                  </button>
                )}
                {!stranded && (
                  <button
                    onClick={() => setOverrides((o) => ({ ...o, [`${slot}@${date}`]: true }))}
                    className="block mx-auto mt-4 text-xs text-dim underline"
                  >
                    Log it for this day anyway
                  </button>
                )}
              </div>
            ) : pastRecord || locked ? (
              <div className="mt-4 bg-surface border border-line rounded-2xl px-5 py-6">
                <div className="text-center">
                  {/* Count the day the record was written on, not the day being
                      looked at. Reading today's date for a session trained
                      yesterday showed a finished session as "0 of 6". */}
                  {progressOn(recordDate, slot, session?.exercises).done ===
                  progressOn(recordDate, slot, session?.exercises).total ? (
                    <div
                      className={`mx-auto w-11 h-11 rounded-full flex items-center justify-center ${
                        accentOf(variant) === 'mint'
                          ? 'bg-mint-dim text-mint'
                          : 'bg-amber-dim text-amber'
                      }`}
                    >
                      <Check size={22} />
                    </div>
                  ) : (
                    <div className="mx-auto w-11 h-11 rounded-full bg-raised text-dim flex items-center justify-center">
                      <Dumbbell size={20} />
                    </div>
                  )}
                  <div className="font-display text-2xl font-bold uppercase tracking-wide mt-3">
                    {tab} {variant}{' '}
                    {progressOn(recordDate, slot, session?.exercises).done ===
                    progressOn(recordDate, slot, session?.exercises).total
                      ? 'done'
                      : `· ${progressOn(recordDate, slot, session?.exercises).done} of ${
                          progressOn(recordDate, slot, session?.exercises).total
                        }`}
                  </div>
                  <div className="text-sm text-dim mt-1">
                    Trained {prettyDate(recordDate)}
                    {locked && locked !== date && nextDue
                      ? `. Comes round again on ${weekdayName(nextDue)}, ${shortDate(nextDue)}.`
                      : ''}
                  </div>
                </div>

                {/* The day's own record: show what was done — name
                    over load, the way the exercise rows in the session itself
                    read. A long name and its load will not share a line at a size
                    worth reading, and half a name is worse than two lines that
                    were meant to be two. */}
                {(pastRecord || locked === date) && (
                  <div className="mt-5 pt-4 border-t border-line space-y-3">
                    {recorded().map(({ name, entry }) => (
                      <div key={name}>
                        <div className="text-[15px] font-semibold leading-tight">{name}</div>
                        <div className="mt-1.5">
                          <SetList entry={entry} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {pastRecord || locked === date ? (
                  <button
                    onClick={() => setOverrides((o) => ({ ...o, [`${slot}@${date}`]: true }))}
                    className="w-full mt-5 bg-surface border border-line text-fg rounded-xl px-5 py-3 text-sm font-bold"
                  >
                    Edit this session
                  </button>
                ) : nextUp ? (
                  // Done is done: a session spent this rotation offers the way
                  // forward, not a way to train it a second time.
                  <div className="text-center">
                    <button
                      onClick={() => {
                        setTab(nextUp.day);
                        setVariant(nextUp.variant);
                        setOpenEx(null);
                      }}
                      className="mt-5 bg-mint text-night rounded-xl px-5 py-3 text-sm font-bold"
                    >
                      Go to {nextUp.label}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 border ${
                    accentOf(variant) === 'mint'
                      ? 'bg-mint-dim/50 border-mint/25'
                      : 'bg-amber-dim/50 border-amber/25'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-xl font-bold uppercase tracking-wide">
                      {tab} {variant}
                    </span>
                    <span
                      className={`text-xs font-bold uppercase tracking-widest ${
                        accentOf(variant) === 'mint' ? 'text-mint' : 'text-amber'
                      }`}
                    >
                      {DOW[SCHEDULE.find((x) => x.slot === slot).dow]}
                    </span>
                  </div>
                  <div className="text-[15px] text-dim font-semibold mt-1 leading-relaxed">{session.focus}</div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {session.exercises.map((ex, i) => {
                    const entry = getEntry(ex.name);
                    const sets = setsOf(entry);
                    const isOpen = openEx === ex.name;
                    const last = lastFor(ex.name);
                    const filled = isFilled(entry);
                    return (
                      <div
                        key={ex.name}
                        className={`bg-surface rounded-xl border overflow-hidden ${
                          filled ? 'border-mint/40' : 'border-line'
                        }`}
                      >
                        <button
                          onClick={() => {
                            const next = isOpen ? null : ex.name;
                            setOpenEx(next);
                            // Opening an untouched exercise offers its first set.
                            if (next && setsOf(getEntry(ex.name)).length === 0) addSet(ex.name);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                        >
                          <span
                            className={`w-6 h-6 shrink-0 rounded-lg text-[11px] font-bold flex items-center justify-center nums ${
                              filled ? 'bg-mint text-night' : 'bg-raised text-dim'
                            }`}
                          >
                            {filled ? <Check size={13} /> : i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-[15px] leading-tight truncate">
                              {ex.name}
                            </div>
                            <div className="text-[13px] text-dim nums font-semibold truncate">
                              {filled ? summarise(entry) : formatTarget(ex.target)}
                            </div>
                          </div>
                          {isOpen ? (
                            <ChevronUp size={17} className="text-dim shrink-0" />
                          ) : (
                            <ChevronDown size={17} className="text-dim shrink-0" />
                          )}
                        </button>

                        {isOpen && (
                          <div className="px-3 pb-3">
                            {/* The row above already shows the target until something
                                is logged, at which point it shows the sets instead —
                                so the target only needs repeating once it is gone. */}
                            {filled && (
                              <div className="text-[13px] text-dim nums font-semibold mb-2">
                                Target {formatTarget(ex.target)}
                              </div>
                            )}
                            {last && (
                              <div className="mb-2.5">
                                <div className="text-[13px] text-dim font-semibold mb-1.5">Last</div>
                                <SetList entry={last} />
                              </div>
                            )}
                            {sets.map((set, si) => (
                              <div key={si} className="flex items-center gap-2 mb-1">
                                <span className="w-10 shrink-0 text-[11px] font-bold uppercase tracking-wide text-dim">
                                  Set {si + 1}
                                </span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  value={set.w}
                                  placeholder="0"
                                  onChange={(e) => updateSet(ex.name, si, 'w', e.target.value)}
                                  className="min-w-0 flex-1 max-w-[5.5rem] bg-raised border border-line rounded-lg px-2 py-1.5 text-base font-bold text-center nums focus:border-mint focus:outline-none"
                                />
                                <span className="text-[13px] font-semibold text-dim shrink-0">kg</span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  value={set.r}
                                  placeholder="0"
                                  onChange={(e) => updateSet(ex.name, si, 'r', e.target.value)}
                                  className="min-w-0 flex-1 max-w-[5.5rem] bg-raised border border-line rounded-lg px-2 py-1.5 text-base font-bold text-center nums focus:border-mint focus:outline-none"
                                />
                                <span className="text-[13px] font-semibold text-dim shrink-0">reps</span>
                                <button
                                  onClick={() => removeSet(ex.name, si)}
                                  aria-label={`Remove set ${si + 1}`}
                                  className="w-7 h-7 shrink-0 rounded-lg text-dim flex items-center justify-center ml-auto"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            ))}

                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => addSet(ex.name)}
                                className="border border-dashed border-line rounded-lg px-3 py-1.5 text-[13px] font-bold text-dim flex items-center justify-center gap-1.5"
                              >
                                <Plus size={15} /> Add set
                              </button>
                              {loadOf(entry) && (
                                <span className="text-[13px] text-dim nums font-semibold shrink-0">
                                  {loadOf(entry)}
                                </span>
                              )}
                            </div>

                            <p className="text-[13px] text-dim mt-2.5 leading-relaxed">{ex.note}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Closed by default: what's below the fold should be the session, not the archive. */}
            <div className="mt-6">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="w-full flex items-center justify-between gap-2 bg-surface border border-line rounded-xl px-4 py-3"
              >
                <span className="font-bold text-[15px]">
                  {tab} {variant} history
                </span>
                <span className="flex items-center gap-2 text-dim">
                  <span className="text-[13px] nums font-semibold">
                    {history.length === 0 ? 'none yet' : history.length}
                  </span>
                  {showHistory ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                </span>
              </button>
              {showHistory && (
                <div className="space-y-2 mt-2">
                  {history.length === 0 && (
                    <div className="text-[15px] text-dim">Nothing logged for this session yet.</div>
                  )}
                  {history.map((h) => (
                    <div key={h.date} className="bg-surface border border-line rounded-xl px-4 py-3">
                      <div className="text-[15px] font-bold">{prettyDate(h.date)}</div>
                      {h.entries.map((e) => (
                        <div key={e.name} className="mt-3">
                          <div className="text-[14px] font-bold leading-tight">{e.name}</div>
                          <div className="mt-1.5">
                            <SetList entry={e} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </>
      )}

      {view === 'streak' && (
        <div className="px-4 mt-4">
          <div className="bg-surface border border-line rounded-2xl px-5 py-8 text-center">
            <div
              className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${
                streak.current ? 'bg-amber-dim text-amber' : 'bg-raised text-dim'
              }`}
            >
              <Flame size={26} />
            </div>
            <div className="font-display text-6xl font-bold nums mt-3 leading-none">
              {streak.current}
            </div>
            <div className="text-xs uppercase tracking-widest text-dim font-bold mt-2">
              {streak.current === 1 ? 'day in a row' : 'days in a row'}
            </div>
            <div className="text-[15px] text-dim font-semibold mt-3 leading-relaxed max-w-[22rem] mx-auto">
              {streakNote}
            </div>
            {streak.since && streak.current > 1 && (
              <div className="mt-5 pt-4 border-t border-line text-[15px] text-dim font-semibold nums">
                Running since {prettyDate(streak.since)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="bg-surface border border-line rounded-xl px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-dim font-bold">Longest</div>
              <div className="font-display text-2xl font-bold nums mt-0.5">
                {streak.longest}
                <span className="text-sm text-dim font-sans font-semibold ml-1.5">
                  {streak.longest === 1 ? 'day' : 'days'}
                </span>
              </div>
            </div>
            <div className="bg-surface border border-line rounded-xl px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-dim font-bold">This week</div>
              <div className="font-display text-2xl font-bold nums mt-0.5">
                {doneCount}
                <span className="text-sm text-dim font-sans font-semibold ml-1.5">
                  of {ROTATION.length}
                </span>
              </div>
            </div>
          </div>

          {/* The same seven cells as the home strip, answering a different
              question: not what is planned, but what actually happened. */}
          <div className="mt-3 bg-surface border border-line rounded-xl px-4 py-3">
            <div className="text-xs uppercase tracking-widest text-dim font-bold">
              Week of {prettyDate(weekStart)}
            </div>
            <div className="mt-2.5 grid grid-cols-7 gap-1.5">
              {DOW.map((label, dow) => {
                const cell = new Date(`${weekStart}T00:00:00`);
                cell.setDate(cell.getDate() + dow);
                const iso = localDateStr(cell);
                const isToday = iso === today;
                const part = partialDays[iso];
                let look = 'bg-surface border-line text-dim';
                let mark = <span className="text-[13px] font-bold">·</span>;
                if (dow === REST_DOW) {
                  look = 'bg-raised border-line text-dim';
                  mark = <Moon size={13} />;
                } else if (trainedDays.has(iso)) {
                  look = 'bg-mint border-mint text-night';
                  mark = <Check size={14} />;
                } else if (iso > today) {
                  look = 'bg-surface border-line text-dim';
                } else if (part) {
                  look = 'bg-amber-dim border-amber/40 text-amber';
                  mark = <span className="text-[11px] font-bold nums">{part.done}</span>;
                } else if (isToday) {
                  look = 'bg-surface border-mint/50 text-mint';
                  mark = <Dumbbell size={13} />;
                } else {
                  look = 'bg-danger-dim border-danger/40 text-danger';
                  mark = <span className="text-[13px] font-bold">—</span>;
                }
                return (
                  <div key={label} className="text-center">
                    <div
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        isToday ? 'text-fg' : 'text-dim'
                      }`}
                    >
                      {label}
                    </div>
                    <div
                      className={`mt-1 h-9 rounded-lg border flex items-center justify-center ${look}`}
                    >
                      {mark}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide text-dim mb-2">
              Days missed
            </h2>
            <div className="space-y-2">
              {streak.missed.length === 0 ? (
                <div className="text-[15px] text-dim">
                  Nothing missed since you started. Saturday is rest and never counts against you.
                </div>
              ) : (
                streak.missed.slice(0, 10).map((iso) => {
                  const due = dueOn(iso);
                  const part = partialDays[iso];
                  return (
                    <div
                      key={iso}
                      className="bg-surface border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold nums">{prettyDate(iso)}</div>
                        <div className="text-[13px] text-dim font-semibold truncate">
                          {part
                            ? `Started — ${part.done} of ${part.total} exercises`
                            : due
                              ? `${due.label} was due`
                              : 'Nothing was due'}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-bold uppercase tracking-widest shrink-0 ${
                          part ? 'text-amber' : 'text-danger'
                        }`}
                      >
                        {part ? 'Part' : 'Missed'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'stats' && (
        <div className="px-4 mt-4">
          {/* Both inputs to BMI, on the screen that shows it. They used to live
              on Profile, a tab away from the number they make, and the history
              below said so in as many words: "add your weight on the profile".
              Measurements sit above the reading rather than below it because
              the WHO section is long, and a weight field under it would be off
              the bottom of the screen every time. */}
          <div className="bg-surface border border-line rounded-2xl p-5 mb-4">
            <h2 className="text-xs uppercase tracking-widest text-dim font-bold">Measurements</h2>

            <label htmlFor="stats-weight" className="text-[13px] font-bold mt-4 block">
              Weight
            </label>
            <div className="flex gap-2 mt-1.5">
              <div className="relative flex-1 min-w-0">
                <input
                  id="stats-weight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={weightInput}
                  placeholder="69"
                  onChange={(e) => {
                    const clean = cleanNumber(e.target.value, true, MAX.bodyWeight);
                    if (clean !== null) setWeightInput(clean);
                  }}
                  className="w-full bg-raised border border-line rounded-xl pl-4 pr-10 py-3 text-base font-semibold nums focus:border-mint focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-dim font-bold pointer-events-none">
                  kg
                </span>
              </div>
              <button
                onClick={saveWeight}
                disabled={!weightReady}
                aria-label="Save weight"
                className={`px-5 rounded-xl text-sm font-bold shrink-0 transition ${
                  weightReady ? 'bg-mint text-night' : 'bg-raised text-dim/60 border border-line'
                }`}
              >
                {savedFlash === 'weight' ? <Check size={16} /> : 'Save'}
              </button>
            </div>
            <p className="text-[13px] text-dim font-semibold mt-2 nums">
              {todayWeightEntry
                ? `${todayWeightEntry.weight} kg on record for today`
                : 'Nothing recorded today.'}
            </p>

            {/* Set once, and locked because it sits next to a field that is
                typed into every week. */}
            <div className="border-t border-line mt-4 pt-4">
              {heightLocked ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-bold">Height</span>
                    <span className="flex items-center gap-3">
                      <span className="text-[15px] font-semibold nums">
                        {profile.heightCm} cm
                      </span>
                      <button
                        onClick={unlockHeight}
                        className="text-[13px] font-bold text-mint"
                      >
                        Change
                      </button>
                    </span>
                  </div>
                  <p className="flex items-center gap-1.5 text-[13px] text-dim mt-2">
                    <Lock size={12} /> Set once, so a stray tap cannot move it.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="stats-height" className="text-[13px] font-bold block">
                    Height
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    <div className="relative flex-1 min-w-0">
                      <input
                        id="stats-height"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={heightInput}
                        placeholder="173"
                        onChange={(e) => {
                          const clean = cleanNumber(e.target.value, false, MAX.heightCm);
                          if (clean !== null) setHeightInput(clean);
                        }}
                        className="w-full bg-raised border border-line rounded-xl pl-4 pr-10 py-3 text-base font-semibold nums focus:border-mint focus:outline-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-dim font-bold pointer-events-none">
                        cm
                      </span>
                    </div>
                    <button
                      onClick={saveHeight}
                      disabled={!heightReady}
                      aria-label="Save height"
                      className={`px-5 rounded-xl text-sm font-bold shrink-0 transition ${
                        heightReady
                          ? 'bg-mint text-night'
                          : 'bg-raised text-dim/60 border border-line'
                      }`}
                    >
                      {savedFlash === 'height' ? <Check size={16} /> : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {bmi === null ? (
            <div className="bg-surface border border-line rounded-2xl px-5 py-10 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-raised text-dim flex items-center justify-center">
                <Activity size={24} />
              </div>
              <div className="font-display text-2xl font-bold uppercase tracking-wide mt-4">
                {statsGap.title}
              </div>
              <div className="text-[15px] text-dim font-semibold mt-2 leading-relaxed max-w-[22rem] mx-auto">
                {statsGap.body}
              </div>
            </div>
          ) : (
            <>
              <div className="bg-surface border border-line rounded-2xl px-5 py-6 text-center">
                <div className="text-xs uppercase tracking-widest text-dim font-bold">
                  Body mass index
                </div>
                <div className="font-display text-6xl font-bold nums mt-1 leading-none">
                  {bmi.toFixed(1)}
                </div>
                <div
                  className={`inline-block mt-3 rounded-full px-3.5 py-1.5 text-sm font-bold ${
                    toneFill[band.tone]
                  } ${toneText[band.tone]}`}
                >
                  {band.label}
                </div>
                <div className="text-[13px] text-dim font-semibold mt-2.5 nums">
                  {latestWeight.weight} kg · {profile.heightCm} cm ·{' '}
                  {prettyDate(latestWeight.date)}
                </div>

                {/* Where that sits among the bands, drawn to scale so the
                    distance to the next one is the real distance. */}
                <div className="mt-6 relative">
                  <div className="h-2.5 rounded-full overflow-hidden flex">
                    {BMI_BANDS.map((b) => {
                      const from = Math.max(b.from, SCALE_MIN);
                      const to = Math.min(b.to, SCALE_MAX);
                      const width = ((to - from) / (SCALE_MAX - SCALE_MIN)) * 100;
                      if (width <= 0) return null;
                      return (
                        <div
                          key={b.label}
                          style={{ width: `${width}%` }}
                          className={`${toneBg[b.tone]} ${
                            b.label === band.label ? '' : 'opacity-25'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div
                    className="absolute top-0 -translate-x-1/2 -translate-y-1"
                    style={{ left: `${scalePos}%` }}
                  >
                    <div className="w-1.5 h-4.5 rounded-full bg-fg border-2 border-night" />
                  </div>
                  <div className="relative h-4 mt-2">
                    {[18.5, 25, 30, 35, 40].map((v) => (
                      <span
                        key={v}
                        className="absolute top-0 -translate-x-1/2 text-[10px] text-dim font-bold nums"
                        style={{ left: `${((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%` }}
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {target && (
                <div className="mt-3 bg-surface border border-line rounded-xl px-4 py-3 flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest text-dim font-bold">
                    Normal at {profile.heightCm} cm
                  </span>
                  <span className="font-display text-lg font-bold nums shrink-0">
                    {target.low.toFixed(1)}–{target.high.toFixed(1)}
                    <span className="text-xs text-dim font-sans font-medium ml-1">kg</span>
                  </span>
                </div>
              )}

              {/* WHO's own risk grading for this band, which differs in all six
                  — so each reading says something about itself without anyone
                  inventing advice to fill the space. The caveats are WHO's too,
                  and hold in every band, so they are said once. */}
              <div className="mt-3 space-y-2">
                <p className="text-[15px] font-semibold leading-relaxed">
                  <span className="text-dim">Risk of comorbidities: </span>
                  {band.risk}
                </p>
                <p className="text-[13px] text-dim leading-relaxed">
                  <span className="font-semibold">{band.label}:</span> {band.range}
                </p>
                <p className="text-[13px] text-dim leading-relaxed">{BMI_CAVEAT}</p>
                {/* Named down to the table, so the reading can be looked up
                    rather than taken on the app's word. */}
                <p className="text-[13px] text-dim leading-relaxed font-semibold">{BMI_SOURCE}</p>
              </div>
            </>
          )}

          <div className="mt-6">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide text-dim mb-2">
              Weight
            </h2>
            <div className="space-y-2">
              {weightHistory.length === 0 && (
                <div className="text-[15px] text-dim">
                  No entries yet. Save a weight above and it is kept here by date.
                </div>
              )}
              {weightHistory.map((e, i) => {
                const previous = weightHistory[i + 1];
                const delta = previous ? Number(e.weight) - Number(previous.weight) : null;
                return (
                  <div
                    key={e.date}
                    className="bg-surface border border-line rounded-xl px-4 py-3 flex justify-between items-center gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold nums">{prettyDate(e.date)}</div>
                      {e.notes ? (
                        <div className="text-[13px] text-dim truncate">{e.notes}</div>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display text-xl font-bold nums">
                        {e.weight}
                        <span className="text-xs text-dim font-sans font-medium ml-1">kg</span>
                      </div>
                      {delta ? (
                        <div className="text-[13px] text-dim nums font-semibold">
                          {delta > 0 ? '+' : ''}
                          {delta.toFixed(1)} kg
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {view === 'profile' && editing === null && (
        <div className="px-4 mt-4 space-y-4">
          {/* Your face, at a size worth looking at. On a screen that is now
              nothing but identity, it is the content rather than a competitor
              for the top of it. */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <label htmlFor="profile-photo" className="cursor-pointer shrink-0">
                <Avatar profile={profile} size={72} />
              </label>
              <div className="min-w-0">
                <label
                  htmlFor="profile-photo"
                  className="inline-flex items-center gap-1.5 bg-raised border border-line rounded-xl px-3 py-2 text-[13px] font-bold cursor-pointer"
                >
                  <Camera size={15} />
                  {profile.photo ? 'Change photo' : 'Add photo'}
                </label>
                <input
                  id="profile-photo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    pickPhoto(e.target.files && e.target.files[0]);
                    e.target.value = '';
                  }}
                />
                {profile.photo && (
                  <button
                    onClick={() => setProfile((p) => ({ ...p, photo: '' }))}
                    className="block mt-2 text-[13px] text-dim underline"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            {photoError && <div className="mt-3 text-[13px] text-danger">{photoError}</div>}
          </div>

          {/* A row is a door, not a field. The value is what you read; editing
              happens where it has your whole attention. */}
          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            {PROFILE_FIELDS.map((f, i) => {
              const shown = rowValue(f);
              return (
                <button
                  key={f.key}
                  onClick={() => openField(f.key)}
                  aria-label={`Edit ${f.label}`}
                  className={`w-full flex items-center gap-3 px-4 py-4 text-left ${
                    i > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="text-[15px] font-semibold shrink-0">{f.label}</span>
                  <span
                    className={`flex-1 min-w-0 text-[15px] text-right truncate ${
                      shown ? 'text-dim' : 'text-dim/60'
                    }`}
                  >
                    {shown || 'Not set'}
                  </span>
                  <ChevronRight size={18} className="text-dim shrink-0" />
                </button>
              );
            })}
          </div>

          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            <button
              onClick={() => openField(APPEARANCE.key)}
              aria-label={`Edit ${APPEARANCE.label}`}
              className="w-full flex items-center gap-3 px-4 py-4 text-left"
            >
              <span className="text-[15px] font-semibold shrink-0">{APPEARANCE.label}</span>
              <span className="flex-1 min-w-0 text-[15px] text-right truncate text-dim">
                {labelOfPref(themePref)}
                {themePref === 'system' ? ` · ${theme}` : ''}
              </span>
              <ChevronRight size={18} className="text-dim shrink-0" />
            </button>
          </div>

          {/* Your data, which is what this screen is about once the details
              above are set. */}
          {downloader && (
            <button
              onClick={exportLog}
              aria-label="Export log"
              className="w-full bg-raised border border-line rounded-xl py-3 text-sm font-bold text-dim flex items-center justify-center gap-2"
            >
              {exportState === 'saved' ? (
                <>
                  <Check size={16} /> Exported
                </>
              ) : (
                <>
                  <Download size={16} /> Export log
                </>
              )}
            </button>
          )}
          {exportState === 'failed' && (
            <p className="text-xs text-dim text-center">That file could not be saved.</p>
          )}
        </div>
      )}

      {/* One field, its own screen. Save sits top right rather than along the
          bottom: with a keyboard up, a fixed bottom bar in an iframe is the
          same geometry that hid the nav behind the home indicator, and the two
          corners read plainly as discard and commit. */}
      {view === 'profile' && editing && (
        <div className="px-4 pt-5">
          <div className="flex items-center gap-1 -ml-2">
            <button onClick={closeField} aria-label="Back" className="p-2 rounded-full text-fg">
              <ChevronLeft size={24} />
            </button>
            <h2 className="font-display text-lg font-bold flex-1">{editing.label}</h2>
            {editing.kind !== 'choice' && (
              <button
                onClick={commitDraft}
                disabled={!draftReady}
                aria-label={`Save ${editing.label}`}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                  draftReady ? 'bg-mint text-night' : 'bg-raised text-dim/60 border border-line'
                }`}
              >
                Save
              </button>
            )}
          </div>

          {editing.kind === 'choice' ? (
            /* A choice cannot be half made or wrong, so there is nothing for a
               Save to confirm. Tapping is the answer. */
            <div className="bg-surface border border-line rounded-2xl overflow-hidden mt-5">
              {editing.options.map((option, i) => {
                const chosen =
                  editing.key === APPEARANCE.key
                    ? labelOfPref(themePref) === option
                    : profile[editing.key] === option;
                return (
                  <button
                    key={option}
                    onClick={() => {
                      if (editing.key === APPEARANCE.key) applyAppearance(prefOfLabel(option));
                      else commitField(editing.key, option);
                      closeField();
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-4 text-left ${
                      i > 0 ? 'border-t border-line' : ''
                    }`}
                  >
                    <span className="text-[15px] font-semibold">{option}</span>
                    {chosen && <Check size={18} className="text-mint" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <div
                className={`relative bg-surface border rounded-2xl px-4 pt-2.5 pb-2 ${
                  draftReady ? 'border-mint' : 'border-line focus-within:border-mint'
                }`}
              >
                {/* The label stays put while you type, so a screen with one box
                    on it still says what the box is. */}
                <label
                  htmlFor="field-input"
                  className="block text-[11px] uppercase tracking-widest text-dim font-bold"
                >
                  {editing.label}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="field-input"
                    autoFocus
                    type={editing.type}
                    inputMode={editing.inputMode}
                    max={editing.kind === 'date' ? today : undefined}
                    value={draft}
                    placeholder={editing.placeholder}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // The return key is the commit for anything with a
                      // keyboard, so the corner is never a journey.
                      if (e.key === 'Enter') commitDraft();
                    }}
                    className={`flex-1 min-w-0 bg-transparent py-1 text-base font-semibold focus:outline-none ${
                      editing.kind === 'date' ? 'nums' : ''
                    }`}
                  />
                  {draftReady ? (
                    <span
                      aria-label="Ready to save"
                      className="w-6 h-6 rounded-full bg-mint text-night flex items-center justify-center shrink-0"
                    >
                      <Check size={14} strokeWidth={3} />
                    </span>
                  ) : (
                    draft !== '' &&
                    editing.kind !== 'date' && (
                      <button
                        onClick={() => setDraft('')}
                        aria-label="Clear"
                        className="w-6 h-6 rounded-full bg-dim/25 text-fg flex items-center justify-center shrink-0"
                      >
                        <X size={14} strokeWidth={3} />
                      </button>
                    )
                  )}
                </div>
              </div>

              {editing.key === 'dob' && draftValid && (
                <p className="text-[13px] text-dim font-semibold mt-2 nums">
                  {ageOn(draft, today)} years old
                </p>
              )}
              {/* Also when the field has been cleared: emptying a required
                  value is exactly when the Save going dark needs explaining. */}
              {!draftValid && (draft !== '' || draftChanged) && (
                <p className="text-[13px] text-danger mt-2">{invalidReason(editing.key)}</p>
              )}
              {editing.hint && <p className="text-[13px] text-dim mt-2">{editing.hint}</p>}
            </div>
          )}

          {editing.kind === 'choice' && editing.hint && (
            <p className="text-[13px] text-dim mt-3">{editing.hint}</p>
          )}
        </div>
      )}

      {/* The bar floats rather than walling off the foot of the page: rounded,
          translucent, blurred, with the session scrolling behind it. A solid
          strip and a filled green slab took a seventh of a 440px screen and
          read as chrome; this reads as something resting on the page. The
          gutters around it pass taps through to whatever is underneath.

          The blur belongs to the whole foot, not only to the two pills inside
          it. With it on the pills alone, the 8px gap between them and the strip
          below the bar were clear windows onto the page: an exercise name
          scrolling past landed there razor-sharp between two frosted panels,
          which reads as a mistake rather than as glass. */}
      {editing === null && (
      <div className="app-bar fixed bottom-0 left-0 right-0 z-30 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none select-none backdrop-blur-lg">
        {showSave && (
          <button
            onClick={saveLogs}
            // Nothing to save is nothing to press. It stayed pressable for the
            // reassurance of being able to press it, but pressing it flashed
            // green as though something had been written down — the opposite
            // of what the colour means everywhere else on this button.
            disabled={!pending && savedFlash !== 'workout'}
            aria-label={`Save ${tab} ${variant}`}
            className={`pointer-events-auto w-full mb-2 rounded-2xl py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 shadow-lg transition ${
              pending || savedFlash === 'workout'
                ? 'bg-mint text-night'
                : 'bg-[var(--bar-bg)] backdrop-blur-2xl backdrop-saturate-150 border border-line/50 text-dim'
            }`}
          >
            {/* Three states, because three things can be true. Green and
                pressable when something is written down and not yet filed.
                "Saved" when the session holds sets and they are all on record.
                And on a session with nothing in it, it says so — "Saved" there
                was a claim about a save that never happened, which is what
                made the button impossible to trust. The accessible name stays
                the same in all three. */}
            {pending ? (
              `Save ${tab} ${variant}`
            ) : hasRecord ? (
              <>
                <Check size={15} /> Saved
              </>
            ) : (
              'No sets entered yet'
            )}
          </button>
        )}
        <nav
          ref={navRef}
          className="app-nav pointer-events-auto relative flex rounded-2xl bg-[var(--bar-bg)] backdrop-blur-2xl backdrop-saturate-150 border border-line/50 shadow-lg"
        >
          {/* The capsule itself: one element, behind the buttons, that travels
              to whichever section is current. */}
          {capsule && (
            <span
              aria-hidden="true"
              // The space before the interpolation is load-bearing: with `${`
              // hard against the `]`, Tailwind's scanner does not see the
              // candidate and never emits the class, leaving a capsule with no
              // colour at all.
              className={`app-capsule absolute rounded-xl bg-[var(--bar-active)] ${
                settledRef.current ? 'app-capsule-moves' : ''
              }`}
              style={{
                transform: `translate3d(${capsule.left}px, ${capsule.top}px, 0)`,
                width: capsule.width,
                height: capsule.height,
              }}
            />
          )}
          {NAV.map(({ key, label, Icon }) => {
            const on = view === key;
            return (
              <button
                key={key}
                onClick={() => {
                  // Home is the day being trained. Tapping it while already
                  // there is the same intent as arriving from another section,
                  // which the effect above handles.
                  if (key === 'home' && view === 'home') resetToToday();
                  setView(key);
                }}
                aria-current={on ? 'page' : undefined}
                className="relative flex-1 flex justify-center py-1 px-1"
              >
                {/* The whole cell stays tappable; this is only what the capsule
                    is measured against, and what carries the colour. */}
                <span
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors duration-200 ${
                    on ? 'text-mint' : 'text-dim'
                  }`}
                >
                  <Icon size={20} strokeWidth={on ? 2.4 : 2} />
                  <span className="text-[11px] font-bold tracking-wide">{label}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      )}
    </div>
  );
}
