# Training Log

A mobile-first push/pull/legs workout tracker. Log weight, reps and sets per
exercise for a given date, and keep a running body-weight history.

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

- `workout-logs` — `{ "YYYY-MM-DD": { "Push": { "Exercise name": { w, r, s } } } }`
- `bodyweight-logs` — `[{ date, weight, notes }]`, newest first

`src/storage.js` picks the backend at runtime: it uses `window.storage` when the
app is embedded in a host that provides it, and falls back to `localStorage`
(then to in-memory) in a plain browser. Data therefore lives on the device — no
server, no account.

## Editing the plan

The routine lives in the `PLAN` constant at the top of `src/WorkoutTracker.jsx`.
Each day is a list of `{ name, target }`; adding a day adds a tab automatically.
