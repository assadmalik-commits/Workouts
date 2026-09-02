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

The blur belongs to the **whole foot**, not to the two pills inside it. With it
on the pills alone, the 8px gap between them and the strip below the bar were
clear windows onto the page: an exercise name scrolling past landed there
razor-sharp between two frosted panels, which reads as a mistake rather than as
glass. Raised in use with a screenshot; the fix is one class on the container,
and the test that guards it fails with `none` when that class is removed.

A gradient scrim over the same region was tried at the same time and dropped: it
removed one faint card edge the blur had left, and cost a second thing to get
right across two themes.

The section you are on is marked by a **capsule behind it**, not by colour
alone — the pattern iOS 26's Liquid Glass tab bar uses, and the one WhatsApp
adopted along with it. The capsule is translucent like the bar itself, so it
lifts or dims what the bar is already showing rather than painting over it, and
it carries its own value per theme for the same reason the bar does. The whole
cell stays tappable; only the capsule is marked. It cost six pixels of height,
which came back out of the padding — the foot stays under a seventh of the
screen, and there is a test that says so.

The capsule is **one element that travels**, not one per section blinking in and
out. Its position and width are measured from whichever cell is current, because
it hugs its label and "Profile" is wider than "Home" — a quarter-width slide
would fit none of them. Transform and width animate over 260ms, and
`prefers-reduced-motion` turns that off.

Two things it taught, both worth keeping:

- The measuring effect has to depend on `ready`, not only on the view. Until the
  log loads the app renders a spinner and there is no bar to measure, so the
  capsule was not placed until the first tap.
- An arbitrary Tailwind class with a template interpolation hard against its
  closing bracket is invisible to the scanner. The class was never emitted and
  the capsule had no colour at all. Leave a space before the interpolation.

The second got through because the assertion guarding it read `alpha < 0.5`,
which a fully transparent capsule satisfies. It now reads `alpha > 0 && alpha <
0.5`. An assertion that passes on the thing being absent is not an assertion.

The other half of that system component — the bar shrinking on scroll down and
returning on scroll up — is deliberately not built. It is the more interesting
behaviour and the riskier one: Safari's rubber-band scrolling and its
disappearing address bar both fire scroll events, and a bar that moves when you
did not ask it to is a different proposition mid-set than on a browsing
screen.

## A session's own weekday, not the rotation's

The rotation reopens on Sunday, but each session has its own day inside it —
Push A Sunday, Pull A Monday, Legs A Tuesday, and so on. A spent session used to
say "comes round again on Sunday" whichever one you were looking at, which
answers a question about the rotation when the lifter asked one about the
session in front of them. It now names the session's own next weekday and date.

"The rotation reopens Sunday" is still said on the rest-day card and beside a
finished week, because there it is the right fact.

Found alongside it: a session trained yesterday and looked at today read
**"Legs A · 0 of 6"** under a dumbbell rather than "Legs A done" under a tick.
The card counted the day being *looked at* instead of the day the record was
written on. The two are the same for a past date opened through the calendar,
and different for a session the rotation is holding shut — which is exactly when
the card shows.

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

## What a field will take

Swept at v7.9 by typing every value a thumb can produce into every box on every
page, rather than by reasoning about the code. Seven readings on screen were
wrong; none had been noticed in use.

**A number field hands over what was typed, not what was meant.** `007`, `.5`
and `00` all reach storage verbatim from an `<input type="number">`, and were
rendered raw — putting `max 0.5kg` in a row summary above a `.5kg` pill, the
same set written two ways. Numbers are now canonical in the record and rendered
as numbers wherever they appear.

**A ceiling belongs next to the minus sign the field already refuses.** A
mistyped 999999 kg is a slip, not an entry. Weight stops at 1000 kg, reps at
200, height at 250 cm, bodyweight at 400 kg — the keystroke simply does not
take, exactly as it already did not for `-`.

**A floor cannot live in the field**, because `1` is a good keystroke on the way
to `173`. So it lives where the number is used: a height and weight that are not
a person's produce no BMI at all, rather than 690,000. Stats says which number
looks wrong, and no longer says "two numbers missing" when one is.

**A refused value must not sit in the field as though it had been taken.** A `0`
typed into the profile's weight was not saved — correctly — but stayed on
screen, while Stats went on using the real weight. The field now snaps back to
what is on record.

**Initials are characters, not UTF-16 code units.** `Assad 💪` took the first
half of the emoji's surrogate pair and drew the replacement glyph in the header.

**"Finish it on the day it belongs to" has to open it for finishing.** The
stranded-session hand-off landed on a read-only record card and asked for
another tap. It now arrives with the session open, and leaving the day still
closes it.

## A set is a weight and a rep count

Either one alone is a row still being typed, not a lighter version of the same
record. **And zero reps is not a rep count** — `20kg × 0` was counting as a set
and toward the session being trained. A weight of zero is different: that is how
bodyweight work is written. Accepting half of one put `1 set · max 20kg` on the screen for an
exercise nobody had finished writing down, and counted it toward the session
being trained. A weight of **0** is a real weight — that is how bodyweight work
is written — so the test is whether something was written, not whether it is
non-zero.

The Save button follows from that. It is inert when there is nothing unsaved:
pressing it used to flash green as though something had been written down, which
is the opposite of what that colour means everywhere else on the same button. It
still says *Saved*, because the reassurance of seeing that is why it stays on
screen at all.

## Leaving Home ends the visit to the day

A past date is opened deliberately, through the calendar, and reached for a
reason. Crossing to Stats and coming back is not that reason — and returning to
an open form for 30 August three days later is a good way to write to the wrong
day. So arriving at Home from another section resets it to the day being trained
and the session due on it.

A reload is not a section change. A publish still puts the lifter back exactly
where they were, past date included, which is what the resume note below is for.

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

## Looked at and dropped — do not re-propose without asking

**Calories burnt per session.** Researched at v7.5 and dropped before anything
was built.

There is no gold-standard formula, only a gold-standard measurement: indirect
calorimetry, which for resistance work also needs blood lactate to catch the
anaerobic share. The practical standard is the Compendium of Physical
Activities — code 02054, MET 3.5, "multiple exercises, 8–15 repetitions at
varied resistance", which describes this programme almost word for word.

`kcal/min = MET × 3.5 × kg ÷ 200`. At 69 kg over 40 minutes that is 169 kcal,
121 of them above resting.

It was dropped because of what that equation does not contain: the load, the
reps, the sets. Two of the lifter's own sessions moved 2,297 kg and 6,624 kg —
nearly three times the work — and both come out at 169 kcal. With a roughly
fixed session length the figure is a constant wearing a measurement's clothes,
and it would sit next to a volume-load number that is measured rather than
estimated, and weaker than it.

The physics route is worse, not better: mass × gravity × range × reps ÷
efficiency gives 11 and 31 kcal for those same sessions. It counts only the
concentric phase, guesses the range of motion, scores bodyweight work at zero,
and misses the hours of raised metabolism afterwards.

Treadmills get away with it because the machine *sets* the work — belt speed and
deck angle are known, not guessed — and even then they run 15–20% high.

## Tried and removed — do not re-propose without asking

**A progression prompt** (`3 sets · max 14kg · ready to add weight`, plus a
matching cue inside the exercise). The rule was sound — double progression, hold
the weight until every prescribed set reaches the top of its rep range — and it
worked. It was removed at v6.0 because in use it was clutter and got in the way
of editing a session.

The lesson was about how it arrived: the question was "what do I do with this
number?", which wanted an explanation, and it was answered with a feature.
Clarify before building.

## v8.1 — the log moved out of the page

Until now the log and the app were the same file. Saving meant republishing,
and a republish reloads every open view, so the app was forbidden from saving
on a timer: a mid-session publish threw the lifter back to today with
everything closed. Shipping any code change meant reading the live page,
lifting the log out of `#log-data`, and pasting it into the new build; forget
that step and the publish is refused, which is the only reason nothing was ever
lost.

The `db` capability holds documents beside the page instead of inside it. The
log is now `sessions/<date>`, one document per training day, plus `meta/`
documents for the profile, the photo, the weights and the theme. What that buys:

- **Saving no longer reloads anything.** This is the real prize, not the
  workflow. `publishAll` returns early when a store answered.
- **Shipping code cannot touch the log.** It is not in the file any more.
- **A day's write is a day's write.** `changedKeys` compares before and after,
  so typing into today never rewrites August.

### Why one document per day

A single log document would be rewritten in full on every keystroke's debounce
and would grow without bound against the 256KiB document limit. Per-day
documents cost about 312 a year against a 5,000-document ceiling — sixteen
years — and make a write proportional to what changed.

The photo has a document of its own. It is twenty times the rest of the profile
put together and changes about never, so splitting it keeps every profile write
small and isolates the one body that could ever approach the size limit.

### The pending set

`db-pending` names the keys this device has written down and the store has not
taken. It is the whole of the offline story: on the next load those keys beat
the store's copy, and everything else loses to it. Without it, training in a
basement and coming back into signal would read the older day back over the
session that was just done.

Two things had to be got right, and the second was got wrong first:

1. A day cleared on the device must not be resurrected from the store — so a
   held key with nothing behind it deletes rather than merges.
2. The local side of the merge cannot be built from the embedded block. The
   page carries what it last published, and it now publishes almost never, so
   the offline session exists only on the device. The first cut read the
   embedded block, and the merge deleted the session it was meant to protect.
   The test caught it before it shipped: breaking the guard again shows the
   day's document going to `{}`.

### What this costs

While the log lived in the page, saving the page was a complete backup. Moving
the data out takes that away, so the Profile screen now offers **Export log** —
the whole record as one JSON file, sessions, weights, profile and photo, in the
shape the app itself reads. That is not a nicety; it is the other half of the
move, and it is why the `downloads` capability is declared.

Declaring `db` also makes the artifact organization-internal: it can no longer
be shared by public link. For a private log read by one person that costs
nothing, but it is a door that closes.

### Still true

`sync.js` is untouched and still correct — it is what runs when there is no
store, and its tests still pass unchanged. Nothing about the WHO screen, the
programme, the streak rule or the capsule moved.

### Not done

The self-publish path stays until the store has been proven in the lifter's own
hands. Once it has, `sync.js` and the embedded block can go, and the page
becomes only an app. Stable exercise IDs are still the next piece of real work.

## Where this is going

Decided September 2026. For at least this week the app stays what it has always
been: one lifter's log, used daily. After that it starts becoming something a
stranger could open, with the App Store and Play Store as the eventual target.

That ordering matters for what gets built next, because the two are not the
same app:

1. **Stable exercise IDs.** Already the next piece of work, and the vision makes
   it blocking rather than tidy. Log entries are keyed by exercise name, so a
   user who renames or builds their own exercise strands their sets. Nothing
   multi-user can be built on top of that. It is also invisible to the lifter
   and gets more expensive with every session logged, so it is cheap now and
   never cheaper again.
2. **The programme becomes data, not code.** `plan.js` is this lifter's own
   six-day split, written in source. A stranger needs their own.
3. **Accounts, and a second person's data.** Not before the two above.

### What survives the move and what does not

`db.js`, `sync.js` and `storage.js` — 444 lines of 3,440, about 13% — are
Claude-artifact-specific. `claude.use()` does not exist on a phone, so that
layer is replaced by on-device storage in a wrapped build (Capacitor keeps this
codebase; React Native would not). Everything else — the programme, the WHO
screen, the streak rule, the whole interface — is ordinary React and travels.

This is the argument for v8.1 beyond the reload it fixed: the record is now a
set of documents with a defined shape rather than a page that rewrites itself,
and a defined shape is portable. The old model was not.

The WHO discipline pays off here too. A health screen that follows one named
standard, cites it, and mixes in no coaching of its own is far easier to defend
at App Store review than one that gives advice it cannot source.

### This week is also v8.1's soak test

The self-publish fallback in `sync.js` stays until the store has been proven in
the lifter's own hands. A week of real sessions is that proof. If saving never
reloads the app and nothing goes missing, the fallback and the embedded block
can go and the page becomes only an app.

### The export nudge (queued with stable IDs)

Asked for September 2026. The store is the record and writes itself, so the
export is not a per-session chore — it guards a different class of loss: the
artifact deleted, the account gone, or simply wanting the history outside
Claude. Once a month is the right cadence at six sessions a week, and nobody
should have to remember it.

Shape:

- `meta/prefs` already exists for the theme; `lastExportAt` belongs there, and
  in the device copy alongside it.
- Stamped only on a **successful** export. `downloads.save()` rejects with
  `declined` when the lifter dismisses the sheet, and a dismissal is an answer,
  not a backup — it must not reset the clock.
- Shown when there is no `lastExportAt` at all, or it is more than 30 days old.
- A quiet line on Profile, above the Export button. Not a banner on Home: that
  screen is used mid-set with a barbell waiting, and nothing belongs there that
  is not the session. If it turns out to be too easy to miss, the next step is a
  mark on the Profile tab, not a louder Profile.

It has nothing to do with exercise IDs and could ship on its own; it is bundled
with them because that is the next time the app is opened for work.

## v8.3 — Profile is who you are, Stats is what you measure

The Save button had lost its job. Before v8.1 it meant "not yet in the
published page", which lasted until you pressed it. Once the store took writes
half a second after typing, nothing was ever outstanding, so the button sat
permanently in its quiet state announcing "Saved" — including on an empty
session it had saved nothing of. The word was the bug: "Saved" is a claim about
the past. A greyed-out "Save" claims nothing.

Four apps were looked at: WhatsApp Business, GymNation, Instagram, WeChat. What
they agree on is that a set-once field is a row you read, and editing it happens
on a screen of its own with a commit that stays locked until something changes.
What they disagree on is where that commit lives — WhatsApp puts a bar along the
bottom, Instagram and WeChat put it in the top right. WeChat contradicts itself
between two of its own screens, so none of them is scripture.

### The reframe

Every one of those is a profile you revisit. Ours is not. Five of six fields are
set once at first run and never touched again; the sixth, weight, is typed every
week. So the screen's job was never "edit your profile".

That splits the app cleanly:

- **Profile — who you are.** Photo, name, email, mobile, date of birth, gender.
  A record, not a form.
- **Stats — what you measure.** Height, weight, BMI, the WHO bands, the history.

Height and weight belong together because they are the two inputs to one
number. Splitting them across tabs was the original mistake, and the app had
been admitting it: Stats already held the BMI *and* the weight history, and its
empty state read "add your weight on the profile" — pointing at another tab to
fix a number it was showing. Moving the inputs deleted that sentence.

### Where the commit went, and why it is not taste

Top right. On a single-field screen the keyboard is up, and a `position: fixed`
bottom bar in iOS Safari inside a cross-origin iframe is the same geometry that
hid the nav behind the home indicator in v8.2 — fixed is relative to the layout
viewport, and in an iframe the offsets to correct it cannot be read. Instagram
and WeChat are probably at the top for the same reason. WhatsApp can afford the
bottom because it is native and gets the inset for free.

The return key also commits, so the corner is never a journey for a text field.

### One rule instead of a per-field argument

**A Save exists where a value can be incomplete or wrong.** A half-typed name,
a height of 1, a year fat-fingered — those need a moment to say "yes, that one".
A choice cannot be either: the instant you tap "Female" your intent is whole, so
a Save there is a redundant tap carrying no information the selection does not.
Gender commits on tap and returns; text, number and date fields keep the locked
Save.

That rule answers the same question for every field added later.

### Odds and ends

- Height gets a lock rather than a row, because it sits *next to* a live control
  rather than among set-once ones. Same guard, different context.
- Gender offers "Prefer not to say", and says on screen that BMI uses the same
  scale for everyone — which is the honest thing to say about a field the app
  collects and never reads.
- Backing out of an edit discards it silently. All four references do, and a
  dialog on a path walked twice a year is not worth its weight.
- The edit screen hides both the app header and the bottom bar. A back arrow
  plus a tab bar is two navigation models arguing on one screen.
- An implausible height or weight can no longer be entered at all — the Save
  never lights — so "that does not look right" is now only reachable from data
  recorded before those guards existed. It still has a test, seeded directly.

## v9.0 — System, Light, Dark, and why it took five versions

A flash on every open: choose day, close the app, and it comes back dark for
about a second before correcting. Four attempts, and the first three fixed real
faults that were not this one.

- **v8.5** made the device's copy beat the store. Real bug, wrong one.
- **v8.6** set the theme before React mounted rather than from an effect. Also
  real: the palette is dark by default and light is what `data-app-theme`
  switches on, so a document without that attribute is a dark document.
- **v8.7** moved that boot script ahead of the 26KB stylesheet it governs — in
  the published page it had been sitting at byte 26375 with the stylesheet at
  155. Real again, still not it.
- **v8.8** found it: on iOS the artifact runs in a cross-origin frame whose
  localStorage Safari discards with the tab. `sync.js` has carried a comment
  saying so since it was written. So on every reopen there was no device copy,
  and the load fell back to the theme embedded in the page — frozen at publish
  time, saying dark since the v8.3 build, while the store said light. Light,
  dark, light.
- **v8.9** replaced that with a hardcoded light default, which fixed day mode by
  breaking night mode. A fixed guess is wrong for half the people.

### What the whole thing was really about

An app-held light/dark preference needs somewhere durable to read it from
*before the first paint*. In this frame there is nowhere: storage is discarded,
the page's copy is stale, and the store is a network call. Every version above
was an attempt to work around a preference the device cannot hold.

So the preference changed shape. **System is the default**, and System resolves
from `prefers-color-scheme` — synchronously, correctly, every time, with nothing
to remember. Light and Dark remain as explicit overrides for anyone who wants
the app to disagree with their phone, and those still ride in the store.

On System there is one painted frame and no flash at all, on either kind of
phone, with the device copy present or wiped. That is the cure; everything
before it was narrowing.

### Where it lives

An **Appearance** row on Profile, opening the same choice screen as Gender —
commit on tap, no Save, because a choice cannot be half-made. It sits in a card
of its own: it is a setting for this device, not a fact about the lifter, and it
must never travel into `meta/profile`.

The moon in the header stays and still flips in one tap. It now means "override
with the opposite of what I am looking at", which is what pressing it always
meant in practice.

### Two things worth keeping

`prefers-color-scheme` is watched rather than sampled, so on System the app
follows the phone turning over at sunset rather than at the next open.

The boot script in `index.html` and the `useState` initialiser resolve the
preference by identical rules. If those two ever disagree, the disagreement is
a repaint — which is the whole bug, reintroduced.

## v9.1 — the frozen block, and what it had been doing since v8.1

The theme flash was not a theme bug. It was the visible corner of a regression
introduced by the storage move, and it had been affecting the whole app.

### What changed underneath

Before v8.1 the app republished itself on every save, and `publishAll` wrote the
whole state — log, weights, profile, theme — back into `#log-data`. So the block
embedded in the page was **continuously refreshed**. Reading it first on load was
correct, because it was never more than one save out of date.

v8.1 added `if (storeRef.current) return true;` so a save no longer republishes.
That was the point of the change and it is right. But the block stopped being
refreshed at that moment and became a snapshot of whatever was true when the
page was last shipped — while the load path went on reading it first, as though
nothing had changed.

Since then, every open rendered the log, the weights, the profile and the theme
**as they stood at the last publish**, until the store answered a second later.
Measured, with a store holding a session the page had never heard of:

    the week counter showed  3 -> 4 of 6

The theme was simply the most visible instance, because a whole-page colour
change is impossible to miss where a stale set count is not.

### The fix

The first render now comes from the most current thing available, in order:

1. **The device copy.** Written on the same debounce as everything else, so it
   is up to the minute.
2. **The store**, waited for — bounded — when the device has nothing. A spinner
   for a moment is honest; a log that is days old and says nothing about being
   provisional is not.
3. **The block**, only when there is nothing else. That is a page with no store,
   which is the case it was written for.

The photo is the one exception, taken from the block even when something fresher
exists: it changes about never, so a stale copy is the same copy, and it cannot
mislead — it is either the right face or none.

### The lesson worth keeping

**A change that stops something being written must account for everything that
reads it.** v8.1 was reviewed as "does the log still save" and it did. Nobody
asked what else had depended on the publish as a side effect. The block had two
jobs — a backup, and the source for the first render — and only the first was
thought about.

Two smaller versions of the same fault turned up alongside it:

- The suites were pinned to version-numbered files, so `tdb` ran against the
  v8.1 build for four versions. Its passes were real and about old code. Every
  suite now reads one `current.html` that the build writes.
- The `theme` in `live-*.json`, which seeds the embedded block, was hand-carried
  between versions and drifted from the store. It is rebuilt from `read_db` now.
