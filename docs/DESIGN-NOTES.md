# Design notes

Reasoning behind where this app is going, and why the order is what it is.
Written 31 August 2026 at v6.0; the scope decision below settled 1 September
at v6.5; the four sections and the profile arrived at v7.0.

## Scope: one lifter, no distribution

**Decided.** This is Assad's log, used daily by Assad, and nobody else. App
stores, accounts and multi-device sync are deferred until that changes — which
it may never.

This is not a limitation, it is the thing that makes the app good. It removes
the tension that ran through the earlier version of this note: that every
generalising feature walks toward the crowded end of the market and away from
what makes this app unusual. There is no market. Features are judged on
whether one lifter wants them, which is a far easier question to answer and a
far better app to use.

What that drops: accounts, a backend, sync, App Review, a privacy policy, a
data-deletion flow, crash reporting, support. None of it is needed to log a
workout.

What survives, and why, is below.

## Where it stands

A single-user, opinionated log for one fixed programme: six sessions (Push,
Pull, Legs × A/B), Sunday to Friday, Saturday rest, rotation resetting each
Sunday. It enforces that programme rather than accommodating any programme —
you cannot repeat a session you have already trained this week, and correcting
an earlier day is deliberate, through the calendar.

It has no server. The published page is the database: it rewrites itself with
the log embedded in it.

Four sections, reached from a bar at the foot of the screen: **Home** is where
the app runs and the only one that logs anything; **Streak**, **Stats** and
**Profile** are read, not worked in. That is why the session's Save button
belongs to Home alone, and why it sits above the bar rather than competing with
it for the same strip of a 440px phone.

The bar floats: rounded, translucent, blurred, with the session scrolling
behind it and the gutters passing taps through. Nothing in it is selectable — a
long press on a phone otherwise starts a text selection and raises the callout
menu over the button being pressed, which is neither useful nor recoverable
mid-set. The first version was an opaque
strip with a filled green Save slab on top of it, and between them they walled
off a seventh of the screen — v7.0 was rejected on exactly that. Two changes
fixed it. The Save button only fills when something has not reached the
published page yet, and otherwise says *Saved* quietly; it stays pressable
either way, because being able to press it is the whole point of having it. And
the bar's ground is a variable rather than a token, because the two themes need
different amounts of it: dark text on a light page ghosts through far more than
light text on a dark one at the same opacity.

## The streak counts days, not weeks

Saturday is the program's rest day, so the walk steps over it: it neither
extends a streak nor breaks one, and a streak begun on a Sunday survives into
the next week. Today is stepped over on the same grounds while it is still
open — a day that has not finished yet is not a day that was missed, and a
counter that read 0 every morning until the session was done would be saying
something untrue.

A day counts when *every* exercise in its session is logged, the same rule the
week's x/6 counter uses. A day with some exercises logged and the session
abandoned still breaks the streak, but it is listed as *started*, not *missed* —
turning up and stopping halfway is a different fact about the week.

This is the one number in the app that outlives the Sunday reset.

## Stats: BMI, WHO, and nothing dressed up

BMI is mass over height squared, classified by the WHO adult bands — under
18.5, 18.5–25, 25–30, then the three obese classes. The standard is named on
screen, because a number whose classification cannot be looked up is worse than
no number.

Other standards exist and were considered: the WHO 2004 Asian consultation puts
overweight at 23 rather than 25, and NICE now prefers waist-to-height (under
0.5) precisely because it works for people carrying muscle, which BMI does not.
Mixing standards in one app produces a reading nobody can check, so there is
one, and the page says which.

RMR was specified and then dropped. Mifflin-St Jeor needs age and sex on top of
height and weight, is accurate within 10% for about seven people in ten, and
answers a question — how much should I eat — that this app is not otherwise in.
The profile still carries date of birth and sex, so it can come back cheaply if
it earns its place.

Each band says something of its own, and what it says is WHO's own
risk-of-comorbidities grading — low, average, increased, moderate, severe, very
severe — plus the name and range WHO gives the band. Six bands, six different
lines, none of them invented. WHO's caveats on the measure hold everywhere, so
they are said once underneath rather than under each.

The source is **WHO Technical Report Series 894 (2000), Table 2.1**, transcribed
in `docs/who-trs-894-table-2.1.txt` and named on the screen so the reading can
be looked up rather than taken on the app's word. That transcription is worth
keeping: this environment cannot reach who.int, and the table was got here by
the lifter opening the report and copying it out.

Checking it against the report corrected five things a secondary source had
left wrong. WHO's label for 18.50–24.99 is **normal range**, not normal weight.
WHO writes the cut-offs to **two decimals**. **Preobese** is WHO's name for
25.00–29.99, sitting under an "overweight: ≥25.00" heading that carries no risk
grading of its own. The class II subdivision exists **because management options
differ above 35**, which is a fact about treatment rather than about risk. And
the footnote is worth quoting whole — it says the relationship it tabulates is
*simplistic*, that risk is *continuous and graded*, and that diet, ethnic group
and activity level all move it. The six risk grades themselves were already
right.

**Classify what is shown, not what is held.** BMI is displayed to one decimal
and graded on that same rounded value. Grading the full value instead put 24.96
on screen as 25.0 under a "normal range" pill, which the lifter has no way to
resolve.

Two rounds of use shaped that. v7.1 repeated one paragraph about muscle and fat
under every reading, which read as a disclaimer rather than as guidance. The
first replacement gave each band advice — see a doctor, watch your waist, the
log is better evidence than this number — and that was rejected on the ground
that settles it: **no training or lifting guidance on this screen, WHO and
nothing else.** An app that mixes a standard with its own coaching leaves you
unable to tell which half you can look up.

## Where the lifter is, and what a publish does to it

Publishing reloads every open view, this one included, so the app leaves itself
a note of where the lifter was and reads it back on boot. That note used to be
written at the moment Save was pressed — which meant moving to another section
before the publish's reload arrived put the lifter back on the section they had
left. Saving a weight on the profile and stepping across to Stats bounced
straight back to the profile.

The note is now kept current: it describes where the lifter is, not where they
were when they pressed the button. It costs one sessionStorage write per
navigation.

## The profile, and the photo

Name, date of birth, sex, height, weight, photo.

Age is derived from the date of birth and never stored: an age typed in once is
wrong within a year and nothing on screen would say so. Weight is not stored on
the profile either — the field writes an entry into the weight log, dated today,
so the history keeps its dates while the profile shows a current weight. It can
only ever be dated today, whatever date Home happens to be showing.

**One entry a day.** The log is keyed by date, so saving a weight again on the
same day replaces that day's rather than adding to it — correcting a typo costs
nothing and does not leave two readings for one morning. Earlier days are never
touched.

The field said so, in a line under it, and that line came off again at v7.4: it
described the app's own bookkeeping rather than telling the lifter anything they
needed. The screen takes their details; how the log is keyed is the app's
business. The same edit removed a BMI reading from the profile — the number
belongs on the screen built to classify it, one tap away, not floating loose
beside the height field.

The photo is re-encoded before it is stored: cropped square, drawn at 256px —
the largest it is ever displayed — and saved as JPEG, which lands around 20KB.
It has to be, because it travels inside the published page alongside the log. A
phone camera's 4MB original would dwarf the thing it is attached to.

The weight log that came from the scrapped Bodyweight tab is migrated once: its
newest reading is re-dated to today and its free-text note dropped, because on
Stats an old date reads as a stale measurement rather than as what the lifter
weighs. The migrated entry has no `notes` key, which is what stops it happening
again — without that marker it would re-date the weight every morning, which is
a worse lie than the stale date it replaced.

## Next: stable exercise IDs

**Do this before anything else that touches exercises.**

Every log entry is keyed by the exercise's *name string*. Renaming one
exercise — `Deficit Push-Ups / Weighted Dips` to `Deficit Push-Ups` — needed a
`RENAMED` migration map plus a separate fix so entries under a name the program
no longer has still appear on screen. Before that fix, renaming stranded the
sets: they stayed in the record, still counted the session as trained, and were
visible nowhere.

This was first argued as groundwork for letting *users* choose exercises. That
argument is gone with the scope decision, and it was the weaker one anyway. The
real driver is the lifter renaming his own exercises: six renames in the first
week of use, each needing a `RENAMED` entry, and one orphan bug that had to be
fixed before a rename stopped hiding the sets logged under the old name.

That happens at one user exactly as it happens at a thousand.

The fix: exercises get stable IDs; names become display-only; logs reference
IDs. It is cheap now — one user, one week of data — and gets steadily more
expensive.

## Then: a PWA, for the lifter and not for a store

Add-to-home-screen, offline, no review, no fee. Worth doing on its own merits,
not as a step toward distribution:

- A real icon, set by the app rather than borrowed from the page that hosts it.
  While the log lives as an artifact, the home-screen icon is whatever
  claude.ai's page provides; the only lever is an emoji, and a wordmark needs a
  Shortcuts workaround.
- Full screen, without a browser address bar taking a strip of a 440px phone.
- **It removes the publish-reload entirely.** Saving currently republishes the
  page, and publishing reloads every open view — which is what threw the lifter
  onto the next day mid-session on 1 September. On its own hosting there is no
  publish, so there is no reload.

That third point is the strongest reason and was not obvious until the bug
turned up in use.

If the store question ever returns: it is not mostly a coding problem. A
Capacitor wrapper is days; the rest is everything listed under the scope
decision above. Check the current fees and review rules directly — they
change.

## Later, judged only on whether one lifter wants them

### Exercise dropdown per muscle group

Needs the ID work first. With one user the library can simply be
user-extensible — there is nobody else's duplicates to worry about.

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

### Settings that are not a profile

The profile exists now, and it holds the lifter rather than their preferences.
Units, available equipment and a programme start date are a different thing —
settings — and none has been asked for yet.

## Tried and removed — do not re-propose without asking

**A progression prompt** (`3 sets · max 14kg · ready to add weight`, plus a
matching cue inside the exercise). The rule was sound — double progression, hold
the weight until every prescribed set reaches the top of its rep range — and it
worked. It was removed at v6.0 because in use it was clutter and got in the way
of editing a session.

The lesson was about how it arrived: the question was "what do I do with this
number?", which wanted an explanation, and it was answered with a feature.
Clarify before building.
