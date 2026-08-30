import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dumbbell, Scale, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { storage, storageIsDurable } from './storage';
import { readEmbedded, hasEmbeddedData, getPublisher } from './sync';
import { PROGRAM, DAYS, VARIANTS } from './plan';

// Shown in the header so it's obvious at a glance which build is loaded.
const APP_VERSION = '2.6';

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

const isFilled = (entry) => Boolean(entry && (entry.w || entry.r || entry.s));

// A weight of 0 means the lift was done at bodyweight — dips, pull-ups,
// push-ups. BW says that on its own; spelling out the kg carried is noise.
const formatWeight = (w) => {
  if (w === '' || w === undefined || w === null) return '-';
  if (Number(w) === 0) return 'BW';
  return `${w}kg`;
};

const formatSet = (entry) =>
  `${formatWeight(entry.w)} × ${entry.r || '-'} reps × ${entry.s || '-'} sets`;

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
      if (DAYS.includes(key)) {
        slots[slotKey(key, 'A')] = { ...(slots[slotKey(key, 'A')] || {}), ...entries };
        changed = true;
      } else {
        slots[key] = entries;
      }
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
  // The day the current rotation opened; sessions logged on or after it count
  // towards this week.
  const [cycleStart, setCycleStart] = useState(null);
  // Sessions the lifter chose to repeat anyway, for this visit only.
  const [overrides, setOverrides] = useState({});
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

      let start = hasEmbeddedData(embedded)
        ? embedded['cycle-start']
        : await load('cycle-start', null);
      if (!start) {
        // Existing logs belong to the rotation in progress, so open it at the
        // earliest session on record rather than stranding them.
        const dates = Object.keys(migrated).sort();
        start = dates[0] || localDateStr();
        save('cycle-start', start);
      }
      setCycleStart(start);
      setReady(true);
      if (changed) save('workout-logs', migrated);

      // The capability resolves after the first render, or not at all.
      const publish = await getPublisher();
      publisherRef.current = publish;
      setDurable(Boolean(publish) || storageIsDurable());
    })();
  }, [load, save, setReady]);

  // Sessions trained in the current rotation, mapped to the day they were done.
  const cycle = useMemo(() => {
    const done = {};
    if (!cycleStart) return done;
    for (const [d, slots] of Object.entries(logs)) {
      if (d < cycleStart) continue;
      for (const [slot, entries] of Object.entries(slots)) {
        if (!Object.values(entries).some(isFilled)) continue;
        if (!done[slot] || d < done[slot]) done[slot] = d;
      }
    }
    return done;
  }, [logs, cycleStart]);

  const doneCount = Object.keys(cycle).length;
  const weekComplete = doneCount >= ROTATION.length;
  const nextUp = ROTATION.find((r) => !cycle[r.slot]) || null;

  // A session is spent once it has been trained on some other day this
  // rotation. The day it was actually trained stays open, so a session can be
  // finished or corrected.
  const lockedOn = (day, variant) => {
    const slot = slotKey(day, variant);
    const doneOn = cycle[slot];
    if (!doneOn || doneOn === date || overrides[slot]) return null;
    return doneOn;
  };

  // Land on a session that's still available for the day being opened.
  const pickVariant = (day) =>
    VARIANTS.find((v) => !lockedOn(day, v)) || VARIANTS[0];

  const startNextWeek = async () => {
    const start = localDateStr(now);
    setCycleStart(start);
    setOverrides({});
    await save('cycle-start', start);
    await publishAll(logs, bwLogs, start);
  };

  // Open on the session that's actually due rather than on a spent one.
  useEffect(() => {
    if (!ready || openedRef.current || !cycleStart) return;
    openedRef.current = true;
    if (nextUp) {
      setTab(nextUp.day);
      setVariant(nextUp.variant);
    }
  }, [ready, cycleStart, nextUp]);

  const isBodyweight = tab === 'Bodyweight';
  const slot = slotKey(tab, variant);
  const locked = isBodyweight ? null : lockedOn(tab, variant);
  const session = isBodyweight ? null : PROGRAM[tab][variant];

  const getEntry = (exName) =>
    (logs[date] && logs[date][slot] && logs[date][slot][exName]) || { w: '', r: '', s: '' };

  const updateEntry = (exName, field, value) => {
    setLogs((prev) => {
      const next = { ...prev };
      next[date] = { ...(next[date] || {}) };
      next[date][slot] = { ...(next[date][slot] || {}) };
      next[date][slot][exName] = { ...(next[date][slot][exName] || {}), [field]: value };
      return next;
    });
  };

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

  const publishAll = async (nextLogs, nextBw, nextStart = cycleStart) => {
    const publish = publisherRef.current;
    if (!publish) return true;
    const res = await publish({
      'workout-logs': nextLogs,
      'bodyweight-logs': nextBw,
      'cycle-start': nextStart,
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

  const today = localDateStr(now);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="sticky top-0 z-10 bg-slate-900 text-white px-4 pt-4 pb-3 shadow-md">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Dumbbell size={20} /> Training Log
          <span className="text-xs font-medium text-slate-400 ml-auto">v{APP_VERSION}</span>
        </h1>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const picked = e.target.value;
              setDate(picked);
              setPinned(picked !== today);
            }}
            className="bg-slate-800 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-700"
          />
          {date !== today && (
            <button
              onClick={() => {
                setDate(today);
                setPinned(false);
              }}
              className="text-xs font-semibold bg-slate-700 text-slate-100 rounded-lg px-3 py-1.5"
            >
              Today
            </button>
          )}
        </div>
        <div className="mt-1.5 text-xs text-slate-400">
          {date === today
            ? `Today · ${now.toLocaleDateString(undefined, {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
              })} · ${now.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : `Viewing ${prettyDate(date)}`}
        </div>
      </div>

      {!durable && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          <span className="font-semibold">This browser isn’t keeping saved data.</span> Your
          entries will disappear when you close the page. In Safari, turn off Settings →
          Apps → Safari → Prevent Cross-Site Tracking, or open this page in another browser.
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex px-4 mt-4 gap-2">
        {[...DAYS, 'Bodyweight'].map((d) => (
          <button
            key={d}
            onClick={() => {
              setTab(d);
              if (d !== 'Bodyweight') setVariant(pickVariant(d));
              setOpenEx(null);
            }}
            className={`py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
              d === 'Bodyweight' ? 'shrink-0 px-3' : 'flex-1'
            } ${
              tab === d
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 border border-slate-200'
            }`}
          >
            {d === 'Bodyweight' ? <Scale size={14} className="inline mr-1 -mt-0.5" /> : null}
            {d}
          </button>
        ))}
      </div>

      {!isBodyweight ? (
        <div className="px-4 mt-4">
          <div className="flex gap-2 items-center">
            {VARIANTS.map((v) => {
              const spent = Boolean(lockedOn(tab, v));
              const onToday = cycle[slotKey(tab, v)] === date;
              return (
                <button
                  key={v}
                  onClick={() => {
                    setVariant(v);
                    setOpenEx(null);
                  }}
                  className={`px-5 py-1.5 rounded-full text-sm font-bold border transition ${
                    variant === v
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : spent
                        ? 'bg-slate-100 text-slate-400 border-slate-200'
                        : 'bg-white text-slate-500 border-slate-200'
                  }`}
                >
                  Day {v}
                  {spent || onToday ? ' ✓' : ''}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {weekComplete
                ? 'All six sessions done this week'
                : `${doneCount} of ${ROTATION.length} done this week${
                    nextUp ? ` · Next: ${nextUp.label}` : ''
                  }`}
            </span>
            {weekComplete && (
              <button
                onClick={startNextWeek}
                className="text-xs font-semibold bg-slate-900 text-white rounded-lg px-3 py-1.5 shrink-0"
              >
                Start next week
              </button>
            )}
          </div>

          {locked ? (
            <div className="mt-3 bg-white border border-slate-200 rounded-xl px-4 py-5 text-center">
              <div className="text-sm font-semibold text-slate-800">
                {tab} {variant} is done this week
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Trained {prettyDate(locked)}. It comes round again next week.
              </div>
              {nextUp && (
                <button
                  onClick={() => {
                    setTab(nextUp.day);
                    setVariant(nextUp.variant);
                    setOpenEx(null);
                  }}
                  className="mt-4 bg-slate-900 text-white rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  Go to {nextUp.label}
                </button>
              )}
              <button
                onClick={() => setOverrides((o) => ({ ...o, [slot]: true }))}
                className="block mx-auto mt-3 text-xs text-slate-400 underline"
              >
                Train it again anyway
              </button>
            </div>
          ) : (
          <>
          <div className="mt-3 bg-slate-100 border-l-4 border-slate-900 rounded-r-lg px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">
              {tab} {variant} focus:
            </span>{' '}
            {session.focus}
          </div>

          <div className="mt-3 space-y-2">
            {session.exercises.map((ex) => {
              const entry = getEntry(ex.name);
              const isOpen = openEx === ex.name;
              const last = lastFor(ex.name);
              return (
                <div
                  key={ex.name}
                  className="bg-white rounded-xl border border-slate-200 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenEx(isOpen ? null : ex.name)}
                    className="w-full flex items-start justify-between px-4 py-3 text-left gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 text-sm">{ex.name}</div>
                      <div className="text-xs text-slate-400">Target: {ex.target}</div>
                      <div className="text-xs text-slate-500 mt-1">{ex.note}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isFilled(entry) ? (
                        <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">
                          {formatWeight(entry.w)} × {entry.r || '-'} × {entry.s || '-'}
                        </span>
                      ) : null}
                      {isOpen ? (
                        <ChevronUp size={18} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={18} className="text-slate-400" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400">Weight (kg)</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={entry.w}
                            onChange={(e) => updateEntry(ex.name, 'w', e.target.value)}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Reps</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={entry.r}
                            onChange={(e) => updateEntry(ex.name, 'r', e.target.value)}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Sets</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={entry.s}
                            onChange={(e) => updateEntry(ex.name, 's', e.target.value)}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          />
                        </div>
                      </div>
                      {last ? (
                        <div className="mt-2 text-xs text-slate-400">
                          Last ({prettyDate(last.date)}): {formatSet(last)}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={saveLogs}
            className="w-full mt-4 bg-slate-900 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2"
          >
            {savedFlash === 'workout' ? (
              <>
                <Check size={18} /> Saved
              </>
            ) : (
              'Save Today’s Session'
            )}
          </button>
          </>
          )}

          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-500 mb-2">
              History — {tab} {variant}
            </h2>
            <div className="space-y-2">
              {history.length === 0 && (
                <div className="text-sm text-slate-400">No entries yet.</div>
              )}
              {history.map((h) => (
                <div key={h.date} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <div className="text-sm font-semibold text-slate-800">{prettyDate(h.date)}</div>
                  {h.entries.map((e) => (
                    <div key={e.name} className="text-xs text-slate-500 mt-1">
                      {e.name}: {formatSet(e)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <label className="text-xs text-slate-400">Body weight (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              value={bwInput}
              onChange={(e) => setBwInput(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. 69"
            />
            <label className="text-xs text-slate-400 mt-3 block">Notes</label>
            <input
              type="text"
              value={bwNotes}
              onChange={(e) => setBwNotes(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. fasted, morning"
            />
            <button
              onClick={saveBodyweight}
              className="w-full mt-4 bg-slate-900 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2"
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

          <div className="mt-4">
            <h2 className="text-sm font-semibold text-slate-500 mb-2">History</h2>
            <div className="space-y-2">
              {bwLogs.length === 0 && (
                <div className="text-sm text-slate-400">No entries yet.</div>
              )}
              {bwLogs.map((e) => (
                <div
                  key={e.date}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex justify-between items-center gap-2"
                >
                  <span className="text-sm text-slate-600">{prettyDate(e.date)}</span>
                  {e.notes ? (
                    <span className="text-xs text-slate-400 truncate flex-1 text-right">
                      {e.notes}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold text-slate-800 shrink-0">
                    {e.weight} kg
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
