# Design notes

Reasoning behind where this app is going, and why the order is what it is.
Written 31 August 2026, at v6.0.

## Where it stands

A single-user, opinionated log for one fixed programme: six sessions (Push,
Pull, Legs × A/B), Sunday to Friday, Saturday rest, rotation resetting each
Sunday. It enforces that programme rather than accommodating any programme —
you cannot repeat a session you have already trained this week, and correcting
an earlier day is deliberate, through the calendar.

It has no server. The published page is the database: it rewrites itself with
the log embedded in it.

## Next: stable exercise IDs

**Do this before anything else that touches exercises.**

Every log entry is keyed by the exercise's *name string*. Renaming one
exercise — `Deficit Push-Ups / Weighted Dips` to `Deficit Push-Ups` — needed a
`RENAMED` migration map plus a separate fix so entries under a name the program
no longer has still appear on screen. Before that fix, renaming stranded the
sets: they stayed in the record, still counted the session as trained, and were
visible nowhere.

That was one rename, done by hand. Let people pick their own exercises and the
fragility becomes structural.

The fix: exercises get stable IDs; names become display-only; logs reference
IDs. It is cheap now — one user, one week of data — and gets steadily more
expensive.

## Then: a PWA, not an app store

Add-to-home-screen, offline, no review, no fee. It gets most of "this is a real
app" for very little, and it is the honest way to find out whether the store
version is worth the rest.

The store route is not mostly a coding problem. A Capacitor wrapper is days;
the rest is a backend, a developer account and review (a thin web-view wrapper
risks rejection under Apple's minimum-functionality guideline), a privacy
policy, a data-deletion flow, privacy disclosures, crash reporting and support.
Check the current fees and review rules directly — they change.

## Later, with open questions

### Exercise dropdown per muscle group

Natural fit, but it needs the ID work first. Also needs a decision on whether
the library is fixed or user-extensible; user-extensible means user-authored
names, which is where duplicate and near-duplicate entries start.

### Choosing a 4, 5 or 6-day split

Bigger than it looks. The rotation is currently constants — `ROTATION`,
`SCHEDULE`, `REST_DOW`, the seven-cell week strip, the `x/6` counter, the
Sunday reset. Making it variable means the rotation becomes data. That is a
clean refactor, but it touches the locking, the rest-day logic and the strip.

The harder part is history: if August was six-day and September is five-day,
past sessions must still render under the programme that was live then. So
programmes need versioning, and logs need to point at the programme they belong
to. That, not the picker, is the work.

Monthly is the wrong cadence. Training blocks run 4–12 weeks, and a month
boundary lands mid-week against a Sunday reset. Prefer a programme with a start
date, switched when the lifter chooses.

### User profile

Needs a reason to exist. Bodyweight is already tracked. Units, available
equipment and a programme start date would earn their place; a name and a photo
would not.

The real thing behind "profile" is **accounts**, and that is the actual fork in
the road: there is no server at all today. Multi-device sync means auth, a
backend, and being responsible for someone else's data.

## The tension to keep in view

What makes this app unusual is that it is opinionated. Most loggers are
free-form. Free exercise selection and variable splits both make it more
general — which walks toward the crowded part of the market (Strong, Hevy,
Boostcamp, all mature with free tiers) and away from the thing that is
distinctive.

"A log that holds you to your programme" is an angle. "Another exercise logger"
is not. Each generalising feature should be weighed against that.

## Tried and removed — do not re-propose without asking

**A progression prompt** (`3 sets · max 14kg · ready to add weight`, plus a
matching cue inside the exercise). The rule was sound — double progression, hold
the weight until every prescribed set reaches the top of its rep range — and it
worked. It was removed at v6.0 because in use it was clutter and got in the way
of editing a session.

The lesson was about how it arrived: the question was "what do I do with this
number?", which wanted an explanation, and it was answered with a feature.
Clarify before building.
