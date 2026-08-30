import React, { useState, useEffect, useCallback } from 'react';
import { Dumbbell, Scale, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { storage } from './storage';

const PLAN = {
  Push: [
    { name: 'Incline Dumbbell Press', target: '4x6-8' },
    { name: 'Deficit Push-Ups / Weighted Dips', target: '3x10-12' },
    { name: 'Cable Flyes (low-to-high)', target: '3x12-15' },
    { name: 'Seated Dumbbell Shoulder Press', target: '4x8-10' },
    { name: 'Cable Lateral Raise (lean away)', target: '4x15-20' },
    { name: 'Rope Tricep Pushdown', target: '3x12 + drop set' },
    { name: 'Overhead Cable Tricep Extension', target: '3x10-12' },
  ],
  Pull: [
    { name: 'Straight-Arm Pulldown', target: '3x15' },
    { name: 'Chest-Supported T-Bar Row', target: '4x8-10' },
    { name: 'Weighted Pull-Ups / Lat Pulldown', target: '4x8-10' },
    { name: 'Cable Row (wide grip)', target: '3x10-12' },
    { name: 'Face Pulls', target: '4x15-20' },
    { name: 'Incline Dumbbell Curl', target: '4x8-10' },
    { name: 'Cable Curl', target: '3x12 + drop set' },
  ],
  Legs: [
    { name: 'Leg Extensions', target: '3x15' },
    { name: 'Squats', target: '4x6-8' },
    { name: 'Romanian Deadlift', target: '4x8-10' },
    { name: 'Seated Leg Curl', target: '4x10-12' },
    { name: 'Walking Lunges', target: '3x12/leg' },
    { name: 'Deficit Calf Raise', target: '4x12-15' },
    { name: 'Seated Calf Raise', target: '3x15-20' },
  ],
};

const DAYS = Object.keys(PLAN);
const todayStr = () => new Date().toISOString().slice(0, 10);

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

  return { load, save, ready, setReady, error, setError };
}

export default function WorkoutTracker() {
  const { load, save, ready, setReady, error } = useStorage();
  const [tab, setTab] = useState('Push');
  const [logs, setLogs] = useState({}); // { date: { Push: { exName: {w,r,s} } } }
  const [bwLogs, setBwLogs] = useState([]); // [{date, weight, notes}]
  const [date, setDate] = useState(todayStr());
  const [openEx, setOpenEx] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [bwInput, setBwInput] = useState('');
  const [bwNotes, setBwNotes] = useState('');

  useEffect(() => {
    (async () => {
      const l = await load('workout-logs', {});
      const b = await load('bodyweight-logs', []);
      setLogs(l);
      setBwLogs(b);
      setReady(true);
    })();
  }, [load, setReady]);

  const getEntry = (d, day, exName) => {
    return (logs[d] && logs[d][day] && logs[d][day][exName]) || { w: '', r: '', s: '' };
  };

  const updateEntry = (field, value) => {
    setLogs((prev) => {
      const next = { ...prev };
      next[date] = { ...(next[date] || {}) };
      next[date][tab] = { ...(next[date][tab] || {}) };
      next[date][tab][openEx] = { ...(next[date][tab][openEx] || {}), [field]: value };
      return next;
    });
  };

  const saveLogs = async () => {
    const ok = await save('workout-logs', logs);
    if (ok) {
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
    if (ok) {
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
        </h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-2 bg-slate-800 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-700"
        />
      </div>

      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex px-4 mt-4 gap-2">
        {[...DAYS, 'Bodyweight'].map((d) => (
          <button
            key={d}
            onClick={() => setTab(d)}
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

      {tab !== 'Bodyweight' ? (
        <div className="px-4 mt-4 space-y-2">
          {PLAN[tab].map((ex) => {
            const entry = getEntry(date, tab, ex.name);
            const filled = entry.w || entry.r || entry.s;
            const isOpen = openEx === ex.name;
            return (
              <div
                key={ex.name}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                <button
                  onClick={() => setOpenEx(isOpen ? null : ex.name)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{ex.name}</div>
                    <div className="text-xs text-slate-400">Target: {ex.target}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {filled ? (
                      <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">
                        {entry.w || '-'}kg × {entry.r || '-'}
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
                  <div className="px-4 pb-4 grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-slate-400">Weight (kg)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={entry.w}
                        onChange={(e) => updateEntry('w', e.target.value)}
                        className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Reps</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={entry.r}
                        onChange={(e) => updateEntry('r', e.target.value)}
                        className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Sets</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={entry.s}
                        onChange={(e) => updateEntry('s', e.target.value)}
                        className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

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
                  <span className="text-sm text-slate-600">{e.date}</span>
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
