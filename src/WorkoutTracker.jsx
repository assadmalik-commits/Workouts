import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dumbbell, Scale, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { storage, storageIsDurable } from './storage';
import { readEmbedded, hasEmbeddedData, getPublisher } from './sync';
import { PROGRAM, DAYS, VARIANTS } from './plan';

// Shown in the header so it's obvious at a glance which build is loaded.
const APP_VERSION = '2.4';

const todayStr = () => new Date().toISOString().slice(0, 10);

const slotKey = (day, variant) => `${day}-${variant}`;

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
  const [date, setDate] = useState(todayStr());
  const [openEx, setOpenEx] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [bwInput, setBwInput] = useState('');
  const [bwNotes, setBwNotes] = useState('');
  const [durable, setDurable] = useState(true);
  const publisherRef = useRef(null);

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
      setReady(true);
      if (changed) save('workout-logs', migrated);

      // The capability resolves after the first render, or not at all.
      const publish = await getPublisher();
      publisherRef.current = publish;
      setDurable(Boolean(publish) || storageIsDurable());
    })();
  }, [load, save, setReady]);

  const isBodyweight = tab === 'Bodyweight';
  const slot = slotKey(tab, variant);
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

  const publishAll = async (nextLogs, nextBw) => {
    const publish = publisherRef.current;
    if (!publish) return true;
    const res = await publish({ 'workout-logs': nextLogs, 'bodyweight-logs': nextBw });
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
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-2 bg-slate-800 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-700"
        />
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
              setVariant('A');
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
          <div className="flex gap-2">
            {VARIANTS.map((v) => {
              const done = Object.keys(logs[date]?.[slotKey(tab, v)] || {}).some((name) =>
                isFilled(logs[date][slotKey(tab, v)][name])
              );
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
                      : 'bg-white text-slate-500 border-slate-200'
                  }`}
                >
                  Day {v}
                  {done ? ' •' : ''}
                </button>
              );
            })}
          </div>

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
