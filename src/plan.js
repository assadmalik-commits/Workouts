// The 6-day training split: three days, each with an A and a B variant.
//
// Variants exist so consecutive Push (or Pull, or Legs) sessions hit different
// angles and patterns instead of repeating the same seven exercises. Each
// variant carries a `focus` line explaining what it covers, and each exercise a
// `note` on how to run the set.
//
// Adding a day here adds a tab; adding a variant adds a toggle button.
//
// **Every exercise has an `id`, and it never changes.** The log is keyed by it,
// so an id is the one thing in this file that is not editable: rename an
// exercise freely, move it between days, rewrite its target and note — the sets
// logged against it follow, because none of that is what identifies it.
//
// Changing an id, or reusing one, silently reassigns somebody's training
// history to a different exercise. Adding a new exercise means a new id that
// has never been used before; the ids happen to read like the names they were
// coined from, and that is a convenience, not a rule to maintain.
//
// This replaced keying the log by the exercise's name, which needed a
// hand-written RENAMED entry for every rename — six in the first week — and
// stranded the sets outright when one was missed.
export const PROGRAM = {
  Push: {
    A: {
      focus: 'Upper chest & incline pressing, lateral delt, rope triceps',
      exercises: [
        {
          id: 'incline-dumbbell-press',
          name: 'Incline Dumbbell Press',
          target: '4x6-8',
          note: 'Main mass driver — push to 1 rep in reserve.',
        },
        {
          id: 'deficit-push-ups',
          name: 'Deficit Push-Ups',
          target: '3x10-12',
          note: 'Add weight once bodyweight gets easy.',
        },
        {
          id: 'cable-flyes-low-to-high',
          name: 'Cable Flyes (low-to-high)',
          target: '3x12-15',
          note: 'Focus stretch + squeeze, upper chest fibers.',
        },
        {
          id: 'seated-dumbbell-shoulder-press',
          name: 'Seated Dumbbell Shoulder Press',
          target: '4x8-10',
          note: '1 rep in reserve on final set.',
        },
        {
          id: 'cable-lateral-raise-lean-away',
          name: 'Cable Lateral Raise (lean away)',
          target: '4x15-20',
          note: 'Light weight, strict form, true failure.',
        },
        {
          id: 'rope-tricep-pushdown',
          name: 'Rope Tricep Pushdown',
          target: '3x12 + drop set',
          note: 'Drop 20-30% on last set, no rest.',
        },
        {
          id: 'overhead-cable-tricep-extension',
          name: 'Overhead Cable Tricep Extension',
          target: '3x10-12',
          note: 'Controlled stretch at bottom.',
        },
      ],
    },
    B: {
      focus: 'Flat/mid chest, vertical front delt, rear delt, close-grip triceps',
      exercises: [
        {
          id: 'flat-barbell-bench-press',
          name: 'Flat Barbell Bench Press',
          target: '4x6-8',
          note: 'Fills the flat/mid-chest gap missing from Push A.',
        },
        { id: 'decline-dumbbell-press', name: 'Decline Dumbbell Press', target: '3x8-10', note: 'Lower chest angle.' },
        {
          id: 'standing-barbell-press',
          name: 'Standing Barbell Press',
          target: '4x8-10',
          note: 'Vertical pressing angle, different from seated DB.',
        },
        {
          id: 'cable-crossover-high-to-low',
          name: 'Cable Crossover (high-to-low)',
          target: '3x12-15',
          note: 'Mid/lower chest, opposite angle to Push A flyes.',
        },
        {
          id: 'rear-delt-fly-cable-or-db',
          name: 'Rear Delt Fly (cable or DB)',
          target: '3x15-20',
          note: 'Push days otherwise never train rear delt.',
        },
        {
          id: 'close-grip-bench-press',
          name: 'Close-Grip Bench Press',
          target: '4x8-10',
          note: 'Heavier tricep angle vs. rope pushdown.',
        },
        {
          id: 'single-arm-overhead-tricep-extension',
          name: 'Single-Arm Overhead Tricep Extension',
          target: '3x12-15',
          note: 'Long-head tricep stretch.',
        },
      ],
    },
  },
  Pull: {
    A: {
      focus: 'Lat width, horizontal rowing, supinated curls',
      exercises: [
        {
          id: 'straight-arm-pulldown',
          name: 'Straight-Arm Pulldown',
          target: '3x15',
          note: 'Lat isolation, warms up the width pattern.',
        },
        {
          id: 'chest-supported-t-bar-row',
          name: 'Chest-Supported T-Bar Row',
          target: '4x8-10',
          note: 'Mid-back thickness, strict form.',
        },
        {
          id: 'lat-pulldown',
          name: 'Lat Pulldown',
          target: '4x8-10',
          note: 'Primary width builder.',
        },
        {
          id: 'cable-row-wide-grip',
          name: 'Cable Row (wide grip)',
          target: '3x10-12',
          note: 'Upper back / rear delt emphasis.',
        },
        {
          id: 'face-pulls',
          name: 'Face Pulls',
          target: '4x15-20',
          note: 'Rear delt + external rotation health work.',
        },
        { id: 'incline-dumbbell-curl', name: 'Incline Dumbbell Curl', target: '4x8-10', note: 'Long-head bicep stretch.' },
        {
          id: 'cable-curl',
          name: 'Cable Curl',
          target: '3x12 + drop set',
          note: 'Drop 20-30% on last set, no rest.',
        },
      ],
    },
    B: {
      focus: 'Back thickness (hinge + unilateral), traps, brachialis',
      exercises: [
        {
          id: 'rack-pull',
          name: 'Rack Pull',
          target: '4x5-6',
          note: 'Biggest missing stimulus — overall back thickness.',
        },
        {
          id: 'single-arm-dumbbell-row',
          name: 'Single-Arm Dumbbell Row',
          target: '4x8-10',
          note: 'Unilateral thickness, corrects imbalances.',
        },
        {
          id: 'seated-cable-row-close-neutral-grip',
          name: 'Seated Cable Row (close/neutral grip)',
          target: '3x10-12',
          note: "Different angle than Pull A's wide-grip row.",
        },
        {
          id: 'reverse-pec-deck',
          name: 'Reverse Pec-Deck',
          target: '3x15-20',
          note: 'Rear delt volume, alternative to face pulls.',
        },
        {
          id: 'dumbbell-shrugs',
          name: 'Dumbbell Shrugs',
          target: '3x12-15',
          note: "Traps aren't hit anywhere else in the program.",
        },
        {
          id: 'hammer-curl',
          name: 'Hammer Curl',
          target: '4x10-12',
          note: 'Brachialis/forearm — neither curl in Pull A trains this.',
        },
        {
          id: 'ez-bar-curl',
          name: 'EZ-Bar Curl',
          target: '3x12 + drop set',
          note: 'Drop 20-30% on last set, no rest.',
        },
      ],
    },
  },
  Legs: {
    A: {
      focus: 'Quad-dominant',
      exercises: [
        { id: 'back-squat', name: 'Back Squat', target: '4x6-8', note: 'Main quad/overall leg mass driver.' },
        { id: 'leg-press', name: 'Leg Press', target: '4x10-12', note: 'Feet low/narrow for quad bias.' },
        {
          id: 'walking-lunges',
          name: 'Walking Lunges',
          target: '3x10-12/leg',
          note: 'Unilateral quad + glute work.',
        },
        {
          id: 'leg-extension',
          name: 'Leg Extension',
          target: '3x15-20',
          note: 'Quad isolation, take to true failure.',
        },
        { id: 'seated-calf-raise', name: 'Seated Calf Raise', target: '4x12-15', note: 'Soleus emphasis (bent knee).' },
        {
          id: 'standing-calf-raise',
          name: 'Standing Calf Raise',
          target: '4x15-20',
          note: 'Gastrocnemius emphasis (straight knee).',
        },
      ],
    },
    B: {
      focus: 'Posterior chain — hamstrings & glutes',
      exercises: [
        {
          id: 'romanian-deadlift',
          name: 'Romanian Deadlift',
          target: '4x8-10',
          note: 'Primary hinge — missing from Legs A entirely.',
        },
        {
          id: 'hip-thrust',
          name: 'Hip Thrust',
          target: '4x8-10',
          note: 'Glute-focused, complements the hinge pattern.',
        },
        {
          id: 'lying-or-seated-leg-curl',
          name: 'Lying or Seated Leg Curl',
          target: '3x12-15',
          note: 'Hamstring isolation, opposite of leg extension.',
        },
        {
          id: 'bulgarian-split-squat',
          name: 'Bulgarian Split Squat',
          target: '3x10-12/leg',
          note: "Unilateral, glute-biased vs. Legs A's lunge.",
        },
        {
          id: 'glute-ham-raise',
          name: 'Glute-Ham Raise',
          target: '3x12-15',
          note: 'Posterior chain finisher.',
        },
        {
          id: 'donkey-calf-raise',
          name: 'Donkey Calf Raise',
          target: '4x15-20',
          note: 'Second calf session, keeps frequency up.',
        },
      ],
    },
  },
};

export const DAYS = Object.keys(PROGRAM);
export const VARIANTS = ['A', 'B'];

// Every exercise in the programme, however the days are arranged.
export const ALL_EXERCISES = Object.values(PROGRAM)
  .flatMap((variants) => Object.values(variants))
  .flatMap((def) => def.exercises);

// id -> exercise. What the log needs to turn a stored key back into something
// with a name to show.
export const EXERCISE_BY_ID = Object.fromEntries(ALL_EXERCISES.map((ex) => [ex.id, ex]));

// name -> id, for the one-time migration of logs written before ids existed,
// and for nothing else. Reading it anywhere in the running app would be keying
// off a name again through the back door.
export const ID_BY_NAME = Object.fromEntries(ALL_EXERCISES.map((ex) => [ex.name, ex.id]));

// The display name for a stored key. A log can hold an id the programme no
// longer lists — an exercise dropped from the plan — and those sets are still
// the lifter's, so they keep the name they were logged under rather than
// disappearing.
export const nameOfId = (id, fallback = null) => {
  if (EXERCISE_BY_ID[id]) return EXERCISE_BY_ID[id].name;
  // A key the migration could not match to the programme keeps the name it was
  // logged under, behind a prefix that cannot collide with a real id.
  const cut = String(id || '').indexOf(':');
  if (cut !== -1) return String(id).slice(cut + 1);
  return fallback || id;
};
