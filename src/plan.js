// The 6-day training split: three days, each with an A and a B variant.
//
// Variants exist so consecutive Push (or Pull, or Legs) sessions hit different
// angles and patterns instead of repeating the same seven exercises. Each
// variant carries a `focus` line explaining what it covers, and each exercise a
// `note` on how to run the set.
//
// Adding a day here adds a tab; adding a variant adds a toggle button.
export const PROGRAM = {
  Push: {
    A: {
      focus: 'Upper chest & incline pressing, lateral delt, rope triceps',
      exercises: [
        {
          name: 'Incline Dumbbell Press',
          target: '4x6-8',
          note: 'Main mass driver — push to 1 rep in reserve.',
        },
        {
          name: 'Deficit Push-Ups',
          target: '3x10-12',
          note: 'Add weight once bodyweight gets easy.',
        },
        {
          name: 'Cable Flyes (low-to-high)',
          target: '3x12-15',
          note: 'Focus stretch + squeeze, upper chest fibers.',
        },
        {
          name: 'Seated Dumbbell Shoulder Press',
          target: '4x8-10',
          note: '1 rep in reserve on final set.',
        },
        {
          name: 'Cable Lateral Raise (lean away)',
          target: '4x15-20',
          note: 'Light weight, strict form, true failure.',
        },
        {
          name: 'Rope Tricep Pushdown',
          target: '3x12 + drop set',
          note: 'Drop 20-30% on last set, no rest.',
        },
        {
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
          name: 'Flat Barbell Bench Press',
          target: '4x6-8',
          note: 'Fills the flat/mid-chest gap missing from Push A.',
        },
        { name: 'Decline Dumbbell Press', target: '3x8-10', note: 'Lower chest angle.' },
        {
          name: 'Standing Barbell Press',
          target: '4x8-10',
          note: 'Vertical pressing angle, different from seated DB.',
        },
        {
          name: 'Cable Crossover (high-to-low)',
          target: '3x12-15',
          note: 'Mid/lower chest, opposite angle to Push A flyes.',
        },
        {
          name: 'Rear Delt Fly (cable or DB)',
          target: '3x15-20',
          note: 'Push days otherwise never train rear delt.',
        },
        {
          name: 'Close-Grip Bench Press',
          target: '4x8-10',
          note: 'Heavier tricep angle vs. rope pushdown.',
        },
        {
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
          name: 'Straight-Arm Pulldown',
          target: '3x15',
          note: 'Lat isolation, warms up the width pattern.',
        },
        {
          name: 'Chest-Supported T-Bar Row',
          target: '4x8-10',
          note: 'Mid-back thickness, strict form.',
        },
        {
          name: 'Weighted Pull-Ups / Lat Pulldown',
          target: '4x8-10',
          note: 'Primary width builder.',
        },
        {
          name: 'Cable Row (wide grip)',
          target: '3x10-12',
          note: 'Upper back / rear delt emphasis.',
        },
        {
          name: 'Face Pulls',
          target: '4x15-20',
          note: 'Rear delt + external rotation health work.',
        },
        { name: 'Incline Dumbbell Curl', target: '4x8-10', note: 'Long-head bicep stretch.' },
        {
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
          name: 'Deadlift / Rack Pull',
          target: '4x5-6',
          note: 'Biggest missing stimulus — overall back thickness.',
        },
        {
          name: 'Single-Arm Dumbbell Row',
          target: '4x8-10',
          note: 'Unilateral thickness, corrects imbalances.',
        },
        {
          name: 'Seated Cable Row (close/neutral grip)',
          target: '3x10-12',
          note: "Different angle than Pull A's wide-grip row.",
        },
        {
          name: 'Reverse Pec-Deck / Band Pull-Apart',
          target: '3x15-20',
          note: 'Rear delt volume, alternative to face pulls.',
        },
        {
          name: 'Dumbbell Shrugs',
          target: '3x12-15',
          note: "Traps aren't hit anywhere else in the program.",
        },
        {
          name: 'Hammer Curl',
          target: '4x10-12',
          note: 'Brachialis/forearm — neither curl in Pull A trains this.',
        },
        {
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
        { name: 'Back Squat', target: '4x6-8', note: 'Main quad/overall leg mass driver.' },
        { name: 'Leg Press', target: '4x10-12', note: 'Feet low/narrow for quad bias.' },
        {
          name: 'Walking Lunges',
          target: '3x10-12/leg',
          note: 'Unilateral quad + glute work.',
        },
        {
          name: 'Leg Extension',
          target: '3x15-20',
          note: 'Quad isolation, take to true failure.',
        },
        { name: 'Seated Calf Raise', target: '4x12-15', note: 'Soleus emphasis (bent knee).' },
        {
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
          name: 'Romanian Deadlift',
          target: '4x8-10',
          note: 'Primary hinge — missing from Legs A entirely.',
        },
        {
          name: 'Hip Thrust',
          target: '4x8-10',
          note: 'Glute-focused, complements the hinge pattern.',
        },
        {
          name: 'Lying or Seated Leg Curl',
          target: '3x12-15',
          note: 'Hamstring isolation, opposite of leg extension.',
        },
        {
          name: 'Bulgarian Split Squat',
          target: '3x10-12/leg',
          note: "Unilateral, glute-biased vs. Legs A's lunge.",
        },
        {
          name: 'Back Extension / Glute-Ham Raise',
          target: '3x12-15',
          note: 'Posterior chain finisher.',
        },
        {
          name: 'Donkey / Standing Calf Raise',
          target: '4x15-20',
          note: 'Second calf session, keeps frequency up.',
        },
      ],
    },
  },
};

export const DAYS = Object.keys(PROGRAM);
export const VARIANTS = ['A', 'B'];
