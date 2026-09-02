// The lifter, and what can be worked out about them.
//
// WHO standards throughout, unaltered. There are other classifications — the
// 2004 Asian consultation puts overweight at 23 rather than 25, and NICE now
// prefers waist-to-height for people carrying muscle — but mixing standards in
// one app produces a number nobody can look up. One standard, named on screen.

// Nothing in the app reads this — BMI follows one scale for everyone — so an
// opt-out costs nothing and is the honest shape for a field we ask for and
// then do not use.
export const SEXES = ['Male', 'Female', 'Prefer not to say'];

export const EMPTY_PROFILE = {
  name: '',
  email: '',
  mobile: '',
  dob: '',
  sex: '',
  heightCm: '',
  photo: '',
};

// Stored profiles predate fields that were added later, and a missing key
// reads as `undefined` in an input, which React treats as uncontrolled.
export const normaliseProfile = (raw) => ({ ...EMPTY_PROFILE, ...(raw || {}) });

export const profileFilled = (p) =>
  Boolean(p && (p.name || p.dob || p.sex || p.heightCm || p.photo));

// Age is derived, never stored: a number typed in once is wrong within a year
// and there is nothing on screen to say so.
export const ageOn = (dob, iso) => {
  if (!dob || !iso) return null;
  const born = new Date(`${dob}T00:00:00`);
  const on = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(on.getTime())) return null;
  let age = on.getFullYear() - born.getFullYear();
  const months = on.getMonth() - born.getMonth();
  if (months < 0 || (months === 0 && on.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
};

// What counts as a person. A field can be capped at the top — a thumb cannot
// type past it — but not at the bottom: 1 is a perfectly good keystroke on the
// way to 173. So the floor lives here, where the number is used, and an
// implausible pair produces no reading rather than a BMI of 690,000.
export const PLAUSIBLE = { heightCm: [100, 250], weightKg: [25, 400] };

const within = (value, [low, high]) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= low && n <= high;
};

export const plausibleHeight = (heightCm) => within(heightCm, PLAUSIBLE.heightCm);
export const plausibleWeight = (weightKg) => within(weightKg, PLAUSIBLE.weightKg);

// Mass over height squared, in kg and metres.
export const bmiOf = (weightKg, heightCm) => {
  if (!plausibleHeight(heightCm) || !plausibleWeight(weightKg)) return null;
  const bmi = Number(weightKg) / (Number(heightCm) / 100) ** 2;
  return Number.isFinite(bmi) ? bmi : null;
};

// WHO Technical Report Series 894 (2000), Table 2.1, "Classification of adults
// according to BMI" — transcribed from the report itself, not from a secondary
// reproduction of it. `to` is the value the band stops at, exclusive; `risk` is
// WHO's own risk-of-comorbidities grading, which is what lets each band say
// something different without anyone inventing advice to fill the space.
//
// WHO's own labels, WHO's own two-decimal ranges. "Normal range", not "normal
// weight". "Preobese" is WHO's name for the 25.00-29.99 slice, nested under an
// "Overweight: >=25.00" heading that carries no risk grading of its own.
//
// No training guidance lives here. The lifter asked for the classification and
// not for a coach, and an app that mixes the two leaves you unable to tell
// which half you can look up.
export const BMI_SOURCE = 'WHO Technical Report Series 894, Table 2.1 (2000)';

export const BMI_BANDS = [
  {
    label: 'Underweight',
    short: 'Under',
    from: 0,
    to: 18.5,
    tone: 'amber',
    risk: 'Low — but WHO adds: risk of other clinical problems increased.',
    range: 'Below 18.50.',
  },
  {
    label: 'Normal range',
    short: 'Normal',
    from: 18.5,
    to: 25,
    tone: 'mint',
    risk: 'Average.',
    range: '18.50 to 24.99.',
  },
  {
    label: 'Overweight',
    short: 'Over',
    from: 25,
    to: 30,
    tone: 'amber',
    risk: 'Increased.',
    range: '25.00 to 29.99, which WHO labels preobese, under overweight at 25.00 or more.',
  },
  {
    label: 'Obese class I',
    short: 'Ob I',
    from: 30,
    to: 35,
    tone: 'danger',
    risk: 'Moderate.',
    range: '30.00 to 34.99.',
  },
  {
    label: 'Obese class II',
    short: 'Ob II',
    from: 35,
    to: 40,
    tone: 'danger',
    risk: 'Severe.',
    range: '35.00 to 39.99. WHO adds this subdivision because management options differ above 35.',
  },
  {
    label: 'Obese class III',
    short: 'Ob III',
    from: 40,
    to: Infinity,
    tone: 'danger',
    risk: 'Very severe.',
    range: '40.00 or more.',
  },
];

// The footnote to Table 2.1, plus the sentence from section 2.3.2 that answers
// the question a lifter actually has. WHO's words, because a paraphrase of a
// standard is no longer the standard.
export const BMI_CAVEAT =
  'These BMI values are age-independent and the same for both sexes. BMI does not distinguish ' +
  'between weight associated with muscle and weight associated with fat, and may not correspond ' +
  'to the same degree of fatness in different populations. The table shows a simplistic ' +
  'relationship between BMI and the risk of comorbidity, which can be affected by a range of ' +
  'factors, including the nature of the diet, ethnic group and activity level. The risks ' +
  'associated with increasing BMI are continuous and graded and begin at a BMI above 25.';

export const bandOf = (bmi) =>
  bmi === null || bmi === undefined ? null : BMI_BANDS.find((b) => bmi < b.to) || null;

// The weight that would put this height at the top of the normal band, which
// is the only actionable thing BMI has to say.
export const healthyRange = (heightCm) => {
  if (!plausibleHeight(heightCm)) return null;
  const h = Number(heightCm) / 100;
  return { low: 18.5 * h * h, high: 24.9 * h * h };
};

// A photo travels inside the published page, alongside the log. A phone
// camera's 4MB JPEG would dwarf it, so the file never reaches storage as
// itself: it is cropped square, drawn at the largest size it is ever displayed,
// and re-encoded. That lands around 20KB.
export const AVATAR_PX = 256;

export function readAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('not an image'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) throw new Error('empty image');
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_PX;
        canvas.height = AVATAR_PX;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          AVATAR_PX,
          AVATAR_PX
        );
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read image'));
    };
    img.src = url;
  });
}

// What stands in for the photo until there is one.
// By character, not by UTF-16 code unit. "Assad 💪" took the first half of the
// emoji's surrogate pair and drew the replacement glyph in the header.
const firstChar = (word) => Array.from(word)[0] || '';

export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const initials =
    firstChar(parts[0]) + (parts.length > 1 ? firstChar(parts[parts.length - 1]) : '');
  return initials.toUpperCase();
};

// The weight log predates the profile: it came from the Bodyweight tab, which
// has been scrapped. Those entries carry a free-text note the app no longer
// offers, and a date from whenever that tab was last opened — which reads on
// Stats as a stale measurement rather than what the lifter weighs now.
//
// Keep the number, because it is real, and file it as today's. Once: the
// migrated entry has no `notes` key, so nothing about it is legacy any more and
// the next run leaves it alone. Without that marker this would re-date the
// weight every morning, which is a different kind of lie.
export function migrateWeights(entries, today) {
  const list = Array.isArray(entries) ? entries : [];
  const legacy = list.filter((e) => e && Object.prototype.hasOwnProperty.call(e, 'notes'));
  if (!legacy.length) return { weights: list, changed: false };
  const newest = legacy.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const weights = [
    ...list.filter((e) => !legacy.includes(e) && e.date !== today),
    { date: today, weight: String(newest.weight) },
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { weights, changed: true };
}

// The identity fields, each edited on a screen of its own.
//
// Height is deliberately absent: it is an input to BMI, so it lives on Stats
// beside the weight it is measured against, not here among the things that say
// who you are. Weight is absent for the same reason and the opposite one — it
// is the only measurement that changes.
export const PROFILE_FIELDS = [
  { key: 'name', label: 'Name', kind: 'text', type: 'text', placeholder: 'Your name' },
  {
    key: 'email',
    label: 'Email',
    kind: 'text',
    type: 'email',
    inputMode: 'email',
    placeholder: 'you@example.com',
    optional: true,
    // Nothing reads it. When there are accounts this stops being a profile
    // field and becomes a login identity, so nothing is built on it now.
    hint: 'Kept with your details. Nothing in the app uses it yet.',
  },
  {
    key: 'mobile',
    label: 'Mobile number',
    kind: 'text',
    type: 'tel',
    inputMode: 'tel',
    placeholder: '+971 50 123 4567',
    optional: true,
    hint: 'Kept with your details. Nothing in the app uses it yet.',
  },
  {
    key: 'dob',
    label: 'Date of birth',
    kind: 'date',
    type: 'date',
    hint: 'Your age is worked out from this, so it never goes stale.',
  },
  {
    key: 'sex',
    label: 'Gender',
    kind: 'choice',
    options: SEXES,
    // Said plainly rather than left for someone to wonder about. The WHO bands
    // are the same for everyone, so this genuinely changes nothing on Stats.
    hint: 'BMI uses the same scale for everyone, so this does not change any of your numbers.',
  },
];

export const fieldByKey = (key) => PROFILE_FIELDS.find((f) => f.key === key) || null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_SHAPE = /^\+?[\d\s()-]+$/;
const digitsIn = (v) => (String(v).match(/\d/g) || []).length;

// Bounds for a date of birth. Not a judgement about who may lift — a date
// outside these is a typo, and the point is to catch a year entered wrong.
export const DOB_AGE = [13, 120];

// Whether a value may be saved. One function drives both the tick inside the
// field and whether the Save is live, so the two can never disagree.
export function validField(key, value, todayIso) {
  const v = String(value ?? '').trim();
  switch (key) {
    case 'name':
      return v.length > 0;
    case 'email':
      return v === '' || EMAIL.test(v);
    case 'mobile':
      return v === '' || (PHONE_SHAPE.test(v) && digitsIn(v) >= 7);
    case 'dob': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      if (Number.isNaN(new Date(`${v}T00:00:00`).getTime())) return false;
      if (todayIso && v > todayIso) return false;
      const age = ageOn(v, todayIso);
      return age !== null && age >= DOB_AGE[0] && age <= DOB_AGE[1];
    }
    case 'heightCm':
      return plausibleHeight(v);
    case 'sex':
      return SEXES.includes(v);
    default:
      return true;
  }
}

// Why a value was refused. Shown under the field, so a Save that will not light
// up is never a mystery.
export function invalidReason(key) {
  switch (key) {
    case 'name':
      return 'A name cannot be empty.';
    case 'email':
      return 'That does not look like an email address.';
    case 'mobile':
      return 'That does not look like a phone number.';
    case 'dob':
      return `Use a date in the past that puts you between ${DOB_AGE[0]} and ${DOB_AGE[1]}.`;
    case 'heightCm':
      return `A height between ${PLAUSIBLE.heightCm[0]} and ${PLAUSIBLE.heightCm[1]} cm.`;
    default:
      return 'That value cannot be saved.';
  }
}
