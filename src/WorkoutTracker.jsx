import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dumbbell, Scale, Check, ChevronDown, ChevronUp, Loader2, Moon, Sun, Plus, X,
} from 'lucide-react';
import { storage, storageIsDurable } from './storage';
import { readEmbedded, hasEmbeddedData, getPublisher } from './sync';
import { PROGRAM, DAYS, VARIANTS } from './plan';

// Shown in the header so it's obvious at a glance which build is loaded.
const APP_VERSION = '4.3';

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

// The week runs Sunday to Friday, one session a day, with Saturday off.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCHEDULE = ROTATION.map((session, i) => ({ ...session, dow: i }));
const REST_DOW = 6;
const scheduledFor = (d) => SCHEDULE.find((x) => x.dow === d.getDay()) || null;

// Sunday opens the week, so the rotation resets on its own each Sunday.
const weekStartStr = (d) => {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  return localDateStr(start);
};

// An entry is a list of sets: [{ w, r }, ...]. One row per set, because sets
// are not interchangeable — a ramp of 10, 12, 14, 16 recorded as four sets of
// 16 overstates the work by a quarter and erases the ramp itself.
const setsOf = (entry) => (Array.isArray(entry?.sets) ? entry.sets : []);

const setFilled = (set) => Boolean(set && (set.w !== '' || set.r !== ''));

const isFilled = (entry) => setsOf(entry).some(setFilled);

// A weight of 0 means the lift was done at bodyweight — dips, pull-ups,
// push-ups. BW says that on its own; spelling out the kg carried is noise.
const formatWeight = (w) => {
  if (w === '' || w === undefined || w === null) return '-';
  if (Number(w) === 0) return 'BW';
  return `${w}kg`;
};

// Total load moved: every set counted, not one set multiplied.
const volumeOf = (entry) =>
  setsOf(entry).reduce((sum, set) => sum + (Number(set.w) || 0) * (Number(set.r) || 0), 0);

// One grammar, always: every set listed as weight×reps, the unit always on the
// weight, sets separated by a dot. Uniform sets repeat rather than collapsing
// into a count — special cases for "these happen to match" produced three
// different notations in the same list, and a reader had to work out which
// one they were looking at before they could read the numbers.
const summarise = (entry) =>
  setsOf(entry)
    .filter(setFilled)
    .map((set) => `${formatWeight(set.w)}×${set.r || '-'}`)
    .join(' · ');

const formatSet = (entry) => summarise(entry) || '-';

const prettyDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
      for (const [exName, entry] of Object.entries(entries || {})) {
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
  const [tab, setTab] = useState('Push');
  const [variant, setVariant] = useState('A');
  const [logs, setLogs] = useState({}); // { date: { "Push-A": { exName: {w,r,s} } } }
  const [bwLogs, setBwLogs] = useState([]); // [{date, weight, notes}]
  const [date, setDate] = useState(() => localDateStr());
  // The date follows the clock until a past session is picked deliberately.
  const [pinned, setPinned] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Sessions the lifter chose to repeat anyway, for this visit only.
  const [overrides, setOverrides] = useState({});
  // Saturday is a destination of its own rather than a blank in the strip.
  const [restView, setRestView] = useState(false);
  const [theme, setTheme] = useState('light');
  const [showHistory, setShowHistory] = useState(false);
  const [openEx, setOpenEx] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [bwInput, setBwInput] = useState('');
  const [bwNotes, setBwNotes] = useState('');
  const [durable, setDurable] = useState(true);
  const publisherRef = useRef(null);
  const openedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const embedded = readEmbedded();
      let stored;
      let b;
      if (hasEmbeddedData(embedded)) {
        stored = embedded['workout-logs'] || {};
        b = embedded['bodyweight-logs'] || [];
      } else {
        stored = await load('workout-logs', {});
        b = await load('bodyweight-logs', []);
      }
      const { logs: migrated, changed } = migrate(stored);
      setLogs(migrated);
      setBwLogs(b);

      const storedTheme = hasEmbeddedData(embedded)
        ? embedded.theme
        : await load('theme', null);
      if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme);

      setReady(true);
      if (changed) save('workout-logs', migrated);

      // The capability resolves after the first render, or not at all.
      const publish = await getPublisher();
      publisherRef.current = publish;
      setDurable(Boolean(publish) || storageIsDurable());
    })();
  }, [load, save, setReady]);

  // Sessions trained in the current rotation, mapped to the day they were done.
  const today = localDateStr(now);
  const weekStart = weekStartStr(now);
  const todayPlan = scheduledFor(now);
  const isRestDay = now.getDay() === REST_DOW;

  const cycle = useMemo(() => {
    const done = {};
    for (const [d, slots] of Object.entries(logs)) {
      if (d < weekStart) continue;
      for (const [slot, entries] of Object.entries(slots)) {
        if (!Object.values(entries).some(isFilled)) continue;
        if (!done[slot] || d < done[slot]) done[slot] = d;
      }
    }
    return done;
  }, [logs, weekStart]);

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
    if (!doneOn || doneOn === date || date < today || overrides[slot]) return null;
    return doneOn;
  };

  // Land on a session that's still available for the day being opened.
  const pickVariant = (day) =>
    VARIANTS.find((v) => !lockedOn(day, v)) || VARIANTS[0];

  // Open on the session that's actually due rather than on a spent one.
  useEffect(() => {
    if (!ready || openedRef.current) return;
    openedRef.current = true;
    if (isRestDay) {
      setRestView(true);
      return;
    }
    if (nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
    }
  }, [ready, nextUp, isRestDay]);

  const isBodyweight = tab === 'Bodyweight';
  const slot = slotKey(tab, variant);
  const locked = isBodyweight ? null : lockedOn(tab, variant);
  const session = isBodyweight ? null : PROGRAM[tab][variant];

  const getEntry = (exName) =>
    (logs[date] && logs[date][slot] && logs[date][slot][exName]) || { sets: [] };

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
    const sets = setsOf(getEntry(exName)).map((set, i) =>
      i === index ? { ...set, [field]: value } : set
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
        .map(([d, byDay]) => ({
          date: d,
          entries: Object.entries(byDay[slot] || {})
            .filter(([, entry]) => isFilled(entry))
            .map(([name, entry]) => ({ name, ...entry })),
        }))
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

  const publishAll = async (nextLogs, nextBw) => {
    const publish = publisherRef.current;
    if (!publish) return true;
    const res = await publish({
      'workout-logs': nextLogs,
      'bodyweight-logs': nextBw,
      theme,
    });
    return res.ok;
  };

  const saveLogs = async () => {
    const ok = await save('workout-logs', logs);
    const published = await publishAll(logs, bwLogs);
    if (ok || published) {
      setSavedFlash('workout');
      setTimeout(() => setSavedFlash(null), 1500);
    }
  };

  const saveBodyweight = async () => {
    if (!bwInput) return;
    const entry = { date, weight: bwInput, notes: bwNotes };
    const next = [...bwLogs.filter((e) => e.date !== date), entry].sort((a, b) =>
      a.date < b.date ? 1 : -1
    );
    const ok = await save('bodyweight-logs', next);
    const published = await publishAll(logs, next);
    if (ok || published) {
      setBwLogs(next);
      setSavedFlash('bw');
      setTimeout(() => setSavedFlash(null), 1500);
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

  useEffect(() => {
    const existing = bwLogs.find((e) => e.date === date);
    setBwInput(existing ? existing.weight : '');
    setBwNotes(existing ? existing.notes : '');
  }, [date, bwLogs]);

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

  return (
    <div className="min-h-screen bg-night text-fg font-sans pb-32">
      <header className="sticky top-0 z-20 bg-night border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wider flex items-center gap-2">
            <Dumbbell size={18} className="text-mint" />
            Training Log
          </h1>
          <div className="flex items-center gap-3 shrink-0">
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
        <div className="mt-1 text-[15px] text-dim font-semibold font-semibold">
          {date === today ? clock : `Viewing ${prettyDate(date)}`}
        </div>

        {/* The week as a strip: which session belongs to which day, what's done,
            where today sits. Tapping a day opens that session. */}
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {DOW.map((label, dow) => {
            const planned = SCHEDULE.find((x) => x.dow === dow);
            const isToday = now.getDay() === dow;
            const done = planned && cycle[planned.slot];
            const accent = planned ? accentOf(planned.variant) : null;
            return (
              <button
                key={label}
                onClick={() => {
                  setOpenEx(null);
                  if (!planned) {
                    setRestView(true);
                    return;
                  }
                  setRestView(false);
                  setTab(planned.day);
                  setVariant(planned.variant);
                }}
                className={`rounded-lg py-1.5 flex flex-col items-center gap-1.5 border transition ${
                  (!planned && restView) || (isToday && !restView)
                    ? 'border-fg/40 bg-surface'
                    : 'border-transparent'
                }`}
              >
                <span
                  className={`text-xs font-bold uppercase tracking-wide ${
                    isToday ? 'text-fg' : 'text-dim'
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
            onChange={(e) => {
              const picked = e.target.value;
              setDate(picked);
              setPinned(picked !== today);
            }}
            className="bg-raised text-fg text-xs rounded-lg px-2.5 py-1.5 border border-line nums"
          />
          {date !== today && (
            <button
              onClick={() => {
                setDate(today);
                setPinned(false);
              }}
              className="text-xs font-semibold text-night bg-fg rounded-lg px-3 py-1.5"
            >
              Today
            </button>
          )}
          <span className="ml-auto text-[15px] text-dim nums font-semibold">
            {doneCount}/{ROTATION.length} this week
          </span>
        </div>
      </header>

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

      <div className="flex px-4 mt-4 gap-1.5">
        {[...DAYS, 'Bodyweight'].map((d) => (
          <button
            key={d}
            onClick={() => {
              setRestView(false);
              setTab(d);
              if (d !== 'Bodyweight') setVariant(pickVariant(d));
              setOpenEx(null);
            }}
            className={`py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
              d === 'Bodyweight' ? 'shrink-0 px-3' : 'flex-1'
            } ${tab === d ? 'bg-fg text-night' : 'bg-surface text-dim border border-line'}`}
          >
            {d === 'Bodyweight' ? <Scale size={14} className="inline mr-1 -mt-0.5" /> : null}
            {d}
          </button>
        ))}
      </div>

      {restView && !isBodyweight ? (
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
                  setRestView(false);
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
      ) : !isBodyweight ? (
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

          {locked ? (
            <div className="mt-4 bg-surface border border-line rounded-2xl px-5 py-8 text-center">
              <div
                className={`mx-auto w-11 h-11 rounded-full flex items-center justify-center ${
                  accentOf(variant) === 'mint'
                    ? 'bg-mint-dim text-mint'
                    : 'bg-amber-dim text-amber'
                }`}
              >
                <Check size={22} />
              </div>
              <div className="font-display text-2xl font-bold uppercase tracking-wide mt-3">
                {tab} {variant} done
              </div>
              <div className="text-sm text-dim mt-1">
                Trained {prettyDate(locked)}. Comes round again on Sunday.
              </div>
              {nextUp && (
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
              )}
              <button
                onClick={() => setOverrides((o) => ({ ...o, [slot]: true }))}
                className="block mx-auto mt-4 text-xs text-dim underline"
              >
                Train it again anyway
              </button>
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
                            {filled ? summarise(entry) : ex.target}
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
                          {(filled || last) && (
                            <div className="flex items-baseline justify-between gap-2 mb-2">
                              <span className="text-[13px] text-dim nums font-semibold">
                                {filled ? `Target ${ex.target}` : ''}
                              </span>
                              {last && (
                                <span className="text-[13px] text-dim nums font-semibold truncate">
                                  Last {formatSet(last)}
                                </span>
                              )}
                            </div>
                          )}

                          {sets.map((set, si) => (
                            <div key={si} className="flex items-center gap-2 mb-1.5">
                              <span className="w-10 shrink-0 text-[11px] font-bold uppercase tracking-wide text-dim">
                                Set {si + 1}
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                value={set.w}
                                placeholder="kg"
                                onChange={(e) => updateSet(ex.name, si, 'w', e.target.value)}
                                className="min-w-0 flex-1 bg-raised border border-line rounded-lg px-2 py-2 text-[17px] font-bold text-center nums focus:border-mint focus:outline-none"
                              />
                              <input
                                type="number"
                                inputMode="numeric"
                                value={set.r}
                                placeholder="reps"
                                onChange={(e) => updateSet(ex.name, si, 'r', e.target.value)}
                                className="min-w-0 flex-1 bg-raised border border-line rounded-lg px-2 py-2 text-[17px] font-bold text-center nums focus:border-mint focus:outline-none"
                              />
                              <button
                                onClick={() => removeSet(ex.name, si)}
                                aria-label={`Remove set ${si + 1}`}
                                className="w-8 h-8 shrink-0 rounded-lg text-dim flex items-center justify-center"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}

                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => addSet(ex.name)}
                              className="flex-1 border border-dashed border-line rounded-lg py-2 text-[13px] font-bold text-dim flex items-center justify-center gap-1.5"
                            >
                              <Plus size={15} /> Add set
                            </button>
                            {volumeOf(entry) > 0 && (
                              <span className="text-[13px] text-dim nums font-semibold shrink-0">
                                {volumeOf(entry)} kg total
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
                      <div key={e.name} className="text-[13px] text-dim mt-1 nums font-semibold">
                        {e.name}: {formatSet(e)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 mt-4">
          <div className="bg-surface rounded-2xl border border-line p-5">
            {bwLogs[0] && (
              <div className="text-center pb-5 mb-5 border-b border-line">
                <div className="font-display text-5xl font-bold nums">{bwLogs[0].weight}</div>
                <div className="text-xs text-dim uppercase tracking-widest mt-1">
                  kg · {prettyDate(bwLogs[0].date)}
                </div>
              </div>
            )}
            <label className="text-xs uppercase tracking-widest text-dim font-bold">
              Body weight (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={bwInput}
              onChange={(e) => setBwInput(e.target.value)}
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-lg font-semibold nums focus:border-mint focus:outline-none"
              placeholder="69"
            />
            <label className="text-xs uppercase tracking-widest text-dim font-bold mt-4 block">
              Notes
            </label>
            <input
              type="text"
              value={bwNotes}
              onChange={(e) => setBwNotes(e.target.value)}
              className="w-full mt-1.5 bg-raised border border-line rounded-xl px-4 py-3 text-sm focus:border-mint focus:outline-none"
              placeholder="fasted, morning"
            />
            <button
              onClick={saveBodyweight}
              className="w-full mt-5 bg-mint text-night rounded-xl py-3.5 font-bold flex items-center justify-center gap-2"
            >
              {savedFlash === 'bw' ? (
                <>
                  <Check size={18} /> Saved
                </>
              ) : (
                'Save Entry'
              )}
            </button>
          </div>

          <div className="mt-6">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide text-dim mb-2">
              History
            </h2>
            <div className="space-y-2">
              {bwLogs.length === 0 && <div className="text-sm text-dim">No entries yet.</div>}
              {bwLogs.map((e) => (
                <div
                  key={e.date}
                  className="bg-surface border border-line rounded-xl px-4 py-3 flex justify-between items-center gap-2"
                >
                  <span className="text-[15px] text-dim font-semibold font-semibold">{prettyDate(e.date)}</span>
                  {e.notes ? (
                    <span className="text-xs text-dim truncate flex-1 text-right">{e.notes}</span>
                  ) : null}
                  <span className="font-display text-xl font-bold shrink-0 nums">
                    {e.weight}
                    <span className="text-xs text-dim font-sans font-medium ml-1">kg</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Thumb-reachable: the one action taken mid-set. */}
      {!isBodyweight && !locked && !restView && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-night border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={saveLogs}
            className="w-full bg-mint text-night rounded-xl py-3.5 font-bold flex items-center justify-center gap-2"
          >
            {savedFlash === 'workout' ? (
              <>
                <Check size={18} /> Saved
              </>
            ) : (
              `Save ${tab} ${variant}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
