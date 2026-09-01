# Working on this repo

A mobile-first training log for one lifter, Assad, on an iPhone in Dubai
(GMT+4, Safari, 440×820 @3×). Read `docs/DESIGN-NOTES.md` before proposing
anything beyond a fix — it carries the reasoning for what comes next and what
has already been tried and rejected.

## Where things are

- `src/plan.js` — the programme. One place to edit the routine.
- `src/WorkoutTracker.jsx` — the whole app: four sections behind a bottom bar,
  of which Home is the only one that logs anything.
- `src/profile.js` — the lifter, and what is worked out from them: BMI, the WHO
  bands, age from date of birth, the photo downscaler.
- `src/db.js` — the record. One document per training day beside the page,
  plus the merge that decides between it and the device.
- `src/sync.js` — the fallback: the published page rewrites itself with the log
  embedded in it, used only when there is no store.
- `src/storage.js` — localStorage behind an async interface.

## Build and test

```bash
npm run build            # check the exit status, see below
```

Tests are Playwright scripts driven against the built app. Chromium only, at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, with `--no-sandbox`.

## Rules learned the hard way

**Never pipe a build into `tail` or `head`.** A pipeline exits with the status
of its last command, so a broken build reports success and every later
measurement silently runs against a stale bundle. This has caused wasted work
twice.

**The store is the record; the page is not.** The log lives in `db`, one
document per training day, written on the same short debounce as the device
copy. A save is a write and nothing moves on screen.

**Never publish the artifact on a timer.** `artifact.publish()` saves a new
version and *every open view reloads to it, including this one*. Mid-session
that throws the lifter back to today with everything closed. Publishing is now
the fallback for a view with no store, and `publishAll` refuses outright when
there is one — that guard is what keeps a save from reloading the page under
the lifter. It is only reachable out of signal, which is where its test has to
live: with a healthy store the Save button disables itself the moment the write
confirms, so nothing can be caught there.

**Opening an exercise is not an edit.** It adds a blank set so there is a row to
type into. Compare `persistable(logs)` — filled sets only — to decide whether
anything actually changed, or merely browsing the plan will republish the page.

**Shipping code no longer carries the lifter's log.** It is in the store, so a
new version is a plain publish. The `#log-data` block left in the page is a
frozen backup from the migration, not the record — refresh it from `read_db`
if it is ever worth refreshing, never by reading the whole page back.

**What the device holds and the store has not taken is named in `db-pending`.**
That set is the only reason a session trained out of signal survives: on the
next load it outranks the store's older copy of the same day. The page carries
what it last published and now publishes almost never, so anything held has to
be read back off the device — building the merge's local side from the embedded
block alone silently destroys the session. That bug was written and caught by
its own test before it shipped; the test is `E` in `tdb.mjs`.

**A local copy of the artifact needs `<meta name="viewport">`.** The artifact
host injects one; a local file without it lays out at 980px under mobile
emulation and scales down, hiding every wrapping and overflow problem.

**Test in `Asia/Dubai`.** Three separate temporal-dead-zone crashes rendered
fine in UTC and white-screened at GMT+4, because a date comparison stopped
short-circuiting. Date logic must be exercised in the lifter's timezone.

**Anything the lifter adds travels inside the published page.** A photo, or
anything else with a file behind it, is re-encoded to something small before it
reaches storage — the profile picture is cropped square and drawn at 256px,
which lands near 20KB. An untouched camera JPEG would be twenty times the log
it rides with.

**One health standard, named on screen, and nothing alongside it.** BMI follows
the WHO adult bands, including WHO's own risk-of-comorbidities grading and
WHO's own caveats, and the page says so. Alternatives exist and are argued in
the design notes; mixing them gives a reading nobody can look up. Do not add
training advice to that screen — it was tried and rejected. An app that mixes a
standard with its own coaching leaves the lifter unable to tell which half they
can check.

**Log entries are keyed by exercise name.** Renaming an exercise strands its
sets unless `RENAMED` carries them across. See the design notes: stable IDs are
the next piece of work for exactly this reason.

## Working style

Clarify before building. When the ask is a question about whether something is
useful, answer the question — do not arrive with a feature.

Assertions that cannot fail are worse than no assertions. If a suite goes green
after a change that should have broken something, check the harness before
believing it.
