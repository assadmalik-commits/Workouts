# Training Log

A mobile-first push/pull/legs workout tracker. Log weight, reps and sets per
exercise for a given date, and keep a running body-weight history.

Each of the three days has an **A** and a **B** variant, so consecutive Push
(or Pull, or Legs) sessions hit different angles instead of repeating the same
exercises — six distinct sessions in total. Every variant shows what it focuses
on, every exercise carries a note on how to run the set, and each day/variant
keeps its own history plus a "last time" reference on the exercise you're
filling in.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Stack

- React 18 + Vite
- Tailwind CSS v4
- lucide-react icons

## Data

Entries are saved under two keys, `workout-logs` and `bodyweight-logs`:

- `workout-logs` — `{ "YYYY-MM-DD": { "Push-A": { "Exercise name": { w, r, s } } } }`
- `bodyweight-logs` — `[{ date, weight, notes }]`, newest first

Logs written before variants existed used the bare day name (`"Push"`) as the
slot key. They are migrated to the matching A variant on load and written back
once, so older entries keep showing up in history.

`src/storage.js` picks the backend at runtime: it uses `window.storage` when the
app is embedded in a host that provides it, and falls back to `localStorage`
(then to in-memory) in a plain browser. Data therefore lives on the device — no
server, no account.

## Editing the plan

The routine lives in `src/plan.js` as `PROGRAM[day][variant]`, where each
variant is a `focus` line plus a list of `{ name, target, note }`. Adding a day
adds a tab automatically; adding a variant adds a toggle button.
