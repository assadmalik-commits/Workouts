// The lifter, and what can be worked out about them.
//
// WHO standards throughout, unaltered. There are other classifications — the
// 2004 Asian consultation puts overweight at 23 rather than 25, and NICE now
// prefers waist-to-height for people carrying muscle — but mixing standards in
// one app produces a number nobody can look up. One standard, named on screen.

export const SEXES = ['Male', 'Female'];

export const EMPTY_PROFILE = { name: '', dob: '', sex: '', heightCm: '', photo: '' };

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

// Mass over height squared, in kg and metres.
export const bmiOf = (weightKg, heightCm) => {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return null;
  const bmi = w / (h * h);
  return Number.isFinite(bmi) ? bmi : null;
};

// The WHO adult classification. `to` is the value the band stops at, exclusive.
export const BMI_BANDS = [
  { label: 'Underweight', short: 'Under', from: 0, to: 18.5, tone: 'amber' },
  { label: 'Normal weight', short: 'Normal', from: 18.5, to: 25, tone: 'mint' },
  { label: 'Overweight', short: 'Over', from: 25, to: 30, tone: 'amber' },
  { label: 'Obese class I', short: 'Ob I', from: 30, to: 35, tone: 'danger' },
  { label: 'Obese class II', short: 'Ob II', from: 35, to: 40, tone: 'danger' },
  { label: 'Obese class III', short: 'Ob III', from: 40, to: Infinity, tone: 'danger' },
];

export const bandOf = (bmi) =>
  bmi === null || bmi === undefined ? null : BMI_BANDS.find((b) => bmi < b.to) || null;

// The weight that would put this height at the top of the normal band, which
// is the only actionable thing BMI has to say.
export const healthyRange = (heightCm) => {
  const h = Number(heightCm) / 100;
  if (!(h > 0)) return null;
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
export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
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
