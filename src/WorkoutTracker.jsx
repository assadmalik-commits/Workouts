import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dumbbell, Check, ChevronDown, ChevronUp, Loader2, Moon, Sun, Plus, Trash2, CalendarX,
  Home, Flame, Activity, User, Camera,
} from 'lucide-react';
import { storage, storageIsDurable } from './storage';
import { readEmbedded, hasEmbeddedData, getPublisher } from './sync';
import { PROGRAM, DAYS, VARIANTS } from './plan';
import {
  SEXES, EMPTY_PROFILE, normaliseProfile, migrateWeights, ageOn, bmiOf, BMI_BANDS, BMI_CAVEAT,
  BMI_SOURCE, bandOf, healthyRange, readAvatar, initialsOf,
} from './profile';

// Shown in the header so it's obvious at a glance which build is loaded.
const APP_VERSION = '7.8';

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
const cleanNumber = (value, allowDecimal) =>
  (allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/).test(value) ? value : null;

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
const setFilled = (set) => Boolean(set && written(set.w) && written(set.r));

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
const formatWeight = (w) => {
  if (w === '' || w === undefined || w === null) return '-';
  if (Number(w) === 0) return 'BW';
  return `${w}kg`;
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
          {formatWeight(set.w)} × {set.r || '-'}
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
        const sets = setsOf(entry).filter(setFilled);
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
  const [theme, setTheme] = useState('light');
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
  const [durable, setDurable] = useState(true);
  const publisherRef = useRef(null);
  const openedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const embedded = readEmbedded();
      let stored;
      let b;
      let p;
      if (hasEmbeddedData(embedded)) {
        stored = embedded['workout-logs'] || {};
        b = embedded['bodyweight-logs'] || [];
        p = embedded.profile;
      } else {
        stored = await load('workout-logs', {});
        b = await load('bodyweight-logs', []);
        p = await load('profile', null);
      }
      const { logs: migrated, changed } = migrate(stored);
      const { weights, changed: weightsChanged } = migrateWeights(b, localDateStr());
      setLogs(migrated);
      setBwLogs(weights);
      setProfile(normaliseProfile(p));

      const storedTheme = hasEmbeddedData(embedded)
        ? embedded.theme
        : await load('theme', null);
      if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme);

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

  const goToDate = (picked) => {
    // A session cannot have been trained on a day that hasn't happened.
    if (!picked || picked > today) return;
    setDate(picked);
    setPinned(true);
    setRestPeek(false);
    setOpenEx(null);
    const trained = sessionOn(picked);
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
    const clean = cleanNumber(value, field === 'w');
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
    const id = setTimeout(() => {
      savedRef.current = snapshot;
      unpublishedRef.current = true;
      setPending(true);
      save('workout-logs', JSON.parse(snapshot));
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
      savedProfileRef.current = snapshot;
      unpublishedRef.current = true;
      setPending(true);
      save('profile', JSON.parse(snapshot));
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

  const saveLogs = async () => {
    const record = persistable(logs);
    savedRef.current = JSON.stringify(record);
    unpublishedRef.current = false;
    setPending(false);
    const ok = await save('workout-logs', record);
    const published = await publishAll(record, bwLogs);
    if (ok || published) {
      setSavedFlash('workout');
      setTimeout(() => setSavedFlash(null), 1500);
    }
  };

  // Saving the profile also files the weight against today, so the record of
  // what the lifter weighed keeps its dates without asking them to log it in a
  // second place.
  const saveProfile = async () => {
    const clean = {
      ...profile,
      name: String(profile.name || '').trim(),
      heightCm: String(profile.heightCm || '').trim(),
    };
    const weight = String(weightInput || '').trim();
    const onFile = weightHistory.find((e) => e.date === today);
    let nextBw = weightHistory;
    if (weight && Number(weight) > 0 && (!onFile || String(onFile.weight) !== weight)) {
      // No `notes` key. It is the marker that says an entry came from the
      // scrapped Bodyweight tab, and writing one here would make every weight
      // the profile saves look legacy — so the migration would re-date it
      // every morning and eat the history it is meant to keep.
      nextBw = [
        ...weightHistory.filter((e) => e.date !== today),
        { date: today, weight },
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    setProfile(clean);
    setBwLogs(nextBw);
    savedProfileRef.current = JSON.stringify(clean);
    unpublishedRef.current = false;
    setPending(false);
    const okProfile = await save('profile', clean);
    const okWeight = nextBw === weightHistory ? true : await save('bodyweight-logs', nextBw);
    const published = await publishAll(persistable(logs), nextBw, clean);
    if ((okProfile && okWeight) || published) {
      setSavedFlash('profile');
      setTimeout(() => setSavedFlash(null), 1500);
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
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    save('theme', next);
  };

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
    setOverrides({});
  }, [date]);

  // The weight on the profile is a current weight, not a blank form to fill in
  // daily: it shows today's entry if there is one, and the last one on record
  // otherwise.
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

  return (
    <div
      className={`min-h-screen bg-night text-fg font-sans ${showSave ? 'pb-36' : 'pb-24'}`}
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
      ) : (
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
                    onClick={() => goToDate(begunOn)}
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
          {bmi === null ? (
            <div className="bg-surface border border-line rounded-2xl px-5 py-10 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-raised text-dim flex items-center justify-center">
                <Activity size={24} />
              </div>
              <div className="font-display text-2xl font-bold uppercase tracking-wide mt-4">
                Two numbers missing
              </div>
              <div className="text-[15px] text-dim font-semibold mt-2 leading-relaxed max-w-[22rem] mx-auto">
                BMI needs your {!profile.heightCm ? 'height' : ''}
                {!profile.heightCm && !latestWeight ? ' and your ' : ''}
                {!latestWeight ? 'weight' : ''}. Both live on the profile.
              </div>
              <button
                onClick={() => setView('profile')}
                className="mt-5 bg-mint text-night rounded-xl px-5 py-3 text-sm font-bold"
              >
                Go to profile
              </button>
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
                  No entries yet. Add your weight on the profile and it is kept here by date.
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

      {view === 'profile' && (
        <div className="px-4 mt-4">
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <Avatar profile={profile} size={72} />
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

            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-5 block">
              Name
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              placeholder="Your name"
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-base font-semibold focus:border-mint focus:outline-none"
            />

            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-4 block">
              Date of birth
            </label>
            <input
              type="date"
              value={profile.dob}
              max={today}
              onChange={(e) => setProfile((p) => ({ ...p, dob: e.target.value }))}
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-base font-semibold nums focus:border-mint focus:outline-none"
            />
            {/* Age is worked out from the date, so it can never go stale. */}
            <div className="text-[13px] text-dim font-semibold mt-1.5 nums">
              {age === null ? 'Your age is worked out from this.' : `${age} years old`}
            </div>

            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-4 block">
              Sex
            </label>
            <div className="flex gap-2 mt-1.5">
              {SEXES.map((s) => (
                <button
                  key={s}
                  onClick={() => setProfile((p) => ({ ...p, sex: p.sex === s ? '' : s }))}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${
                    profile.sex === s
                      ? 'bg-fg text-night border-fg'
                      : 'bg-raised text-dim border-line'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-4 block">
              Height (cm)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={profile.heightCm}
              placeholder="178"
              onChange={(e) => {
                const clean = cleanNumber(e.target.value, true);
                if (clean !== null) setProfile((p) => ({ ...p, heightCm: clean }));
              }}
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-base font-semibold nums focus:border-mint focus:outline-none"
            />

            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-4 block">
              Weight (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={weightInput}
              placeholder="69"
              onChange={(e) => {
                const clean = cleanNumber(e.target.value, true);
                if (clean !== null) setWeightInput(clean);
              }}
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-base font-semibold nums focus:border-mint focus:outline-none"
            />
          </div>

          <button
            onClick={saveProfile}
            className="w-full mt-3 bg-mint text-night rounded-xl py-3.5 font-bold flex items-center justify-center gap-2"
          >
            {savedFlash === 'profile' ? (
              <>
                <Check size={18} /> Saved
              </>
            ) : (
              'Save profile'
            )}
          </button>
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
      <div className="app-bar fixed bottom-0 left-0 right-0 z-30 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-none select-none backdrop-blur-lg">
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
            {/* One control, two states. Typing is already the save, so a filled
                button sitting there all session is loud about nothing; it fills
                only when something has not reached the published page yet, and
                otherwise says so quietly. It stays pressable either way — being
                able to press it is the point of having it. The accessible name
                does not change with the state. */}
            {pending ? (
              `Save ${tab} ${variant}`
            ) : (
              <>
                <Check size={15} /> Saved
              </>
            )}
          </button>
        )}
        <nav className="pointer-events-auto flex rounded-2xl bg-[var(--bar-bg)] backdrop-blur-2xl backdrop-saturate-150 border border-line/50 shadow-lg">
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
                className="flex-1 flex justify-center py-1 px-1"
              >
                {/* The capsule is what says which section you are on. The whole
                    cell stays tappable; only this part is marked. */}
                <span
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition ${
                    on ? 'bg-[var(--bar-active)] text-mint' : 'text-dim'
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
    </div>
  );
}
