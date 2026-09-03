// The profile: what the lifter enters, what is worked out, what survives.
import { open, report, nav, bodyText } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';

// A 1×1 PNG. readAvatar re-encodes whatever it is given, so the input only has
// to be a decodable image.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Identity is edited a field at a time on Profile; the two measurements live
// on Stats beside the BMI they feed. Each commits itself, so there is no longer
// a single Save to press afterwards.
const setRow = async (page, label, value) => {
  await nav(page, 'Profile');
  await page.click(`[aria-label="Edit ${label}"]`);
  await page.waitForTimeout(250);
  await page.fill('#field-input', value);
  await page.waitForTimeout(200);
  const save = page.locator(`[aria-label="Save ${label}"]`);
  if (await save.isEnabled()) await save.click();
  else await page.click('[aria-label="Back"]');
  await page.waitForTimeout(350);
};
const setChoice = async (page, label, option) => {
  await nav(page, 'Profile');
  await page.click(`[aria-label="Edit ${label}"]`);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: new RegExp(`^${option}$`) }).click();
  await page.waitForTimeout(350);
};
const setMeasure = async (page, sel, value, saveLabel) => {
  await nav(page, 'Stats');
  if (sel === '#stats-height') {
    const change = page.getByRole('button', { name: 'Change', exact: true });
    if (await change.count()) { await change.click(); await page.waitForTimeout(200); }
  }
  await page.fill(sel, value);
  await page.waitForTimeout(200);
  const save = page.locator(`[aria-label="${saveLabel}"]`);
  if (await save.isEnabled()) await save.click();
  await page.waitForTimeout(400);
};
const fill = async (page, { name, dob, sex, height, weight }) => {
  if (name !== undefined) await setRow(page, 'Name', name);
  if (dob !== undefined) await setRow(page, 'Date of birth', dob);
  if (sex !== undefined) await setChoice(page, 'Gender', sex);
  if (height !== undefined) await setMeasure(page, '#stats-height', height, 'Save height');
  if (weight !== undefined) await setMeasure(page, '#stats-weight', weight, 'Save weight');
};
// What the app holds now, read off the screens that show it.
const readBack = async (page) => {
  await nav(page, 'Profile');
  const rows = await page.$$eval('[aria-label^="Edit "]', bs =>
    Object.fromEntries(bs.map(b => {
      const parts = b.innerText.split('\n');
      return [parts[0].trim(), (parts[1] || '').trim()];
    })));
  await nav(page, 'Stats');
  const height = await page.evaluate(() => {
    const el = document.querySelector('#stats-height');
    if (el) return el.value;
    const m = document.body.innerText.match(/Height\s*\n?\s*(\d+)\s*cm/);
    return m ? m[1] : '';
  });
  const weight = await page.locator('#stats-weight').inputValue();
  return { ...rows, height, weight };
};

// Everything typed in comes back after a reload.
{
  const { browser, page, errors } = await open({ at: MON, bw: [] });
  await fill(page, { name: 'Assad', dob: '1995-03-12', sex: 'Male', height: '178', weight: '69' });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const got = await readBack(page);
  R('the name survives a reload', got.Name === 'Assad', JSON.stringify(got));
  R('the date of birth survives', /1995/.test(got['Date of birth']), got['Date of birth']);
  R('the sex survives', got.Gender === 'Male', String(got.Gender));
  R('the height survives', got.height === '178', got.height);
  R('the weight survives', got.weight === '69', got.weight);
  R('no page errors', errors.length === 0, errors.join('; '));
  await browser.close();
}

// Age is worked out, never stored.
{
  const { browser, page } = await open({ at: MON, bw: [] });
  await fill(page, { dob: '1995-03-12' });
  await page.waitForTimeout(300);
  const dobRow = (await readBack(page))['Date of birth'];
  R('age is derived from the date of birth', /· 31$/.test(dobRow), dobRow);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('profile') || '{}'));
  R('and is not written to storage', !('age' in stored), Object.keys(stored).join(','));
  await browser.close();
}

// A birthday that has not come round yet this year is a year younger.
{
  const { browser, page } = await open({ at: MON, bw: [] });
  await fill(page, { dob: '1995-09-01' });
  await page.waitForTimeout(300);
  const row = (await readBack(page))['Date of birth'];
  R('a birthday tomorrow is still last year’s age', /· 30$/.test(row), row);
  await browser.close();
}

// The weight is filed against today, whatever date Home happens to be showing.
// The seeded entry carries no note, so it is not one of the scrapped tab's and
// the migration below leaves it where it is.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '69' }] });
  await page.locator('input[type=date]').fill('2026-08-25');
  await page.waitForTimeout(400);
  await fill(page, { height: '178', weight: '72' });
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs') || '[]'));
  R('a new weight is dated today, not the day being viewed',
    stored.some((e) => e.date === '2026-08-31' && e.weight === '72') && !stored.some((e) => e.date === '2026-08-25'),
    JSON.stringify(stored));
  R('and the earlier entry is kept', stored.some((e) => e.date === '2026-08-30' && e.weight === '69'), `${stored.length} entries`);
  await browser.close();
}

// A negative height is not a height.
{
  const { browser, page } = await open({ at: MON, bw: [] });
  await nav(page, 'Stats');
  await page.fill('#stats-height', '-5');
  await page.waitForTimeout(200);
  const value = await page.locator('#stats-height').inputValue();
  R('a negative height is refused', value !== '-5', `field holds "${value}"`);
  await browser.close();
}

// A photo, downscaled, kept, and shown on the home header.
{
  const { browser, page } = await open({ at: MON, bw: [] });
  await nav(page, 'Profile');
  await page.setInputFiles('#profile-photo', { name: 'me.png', mimeType: 'image/png', buffer: PIXEL });
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('profile') || '{}'));
  R('the photo is stored re-encoded, not as the file given',
    typeof stored.photo === 'string' && stored.photo.startsWith('data:image/jpeg'),
    String(stored.photo).slice(0, 30));
  R('and is small enough to travel inside the page', stored.photo.length < 120000,
    `${(stored.photo.length / 1024).toFixed(1)}KB`);
  await nav(page, 'Home');
  const inHeader = await page.locator('header img').count();
  R('it shows in the home header', inHeader === 1, `${inHeader} image(s)`);
  await nav(page, 'Profile');
  await page.getByRole('button', { name: /Remove photo/i }).click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('profile') || '{}'));
  R('and can be removed', !after.photo, String(after.photo).slice(0, 20));
  await browser.close();
}

// Without a photo the header still says who this is.
{
  const { browser, page } = await open({ at: MON, bw: [], profile: { name: 'Sample Lifter' } });
  const initials = await page.evaluate(() => document.querySelector('header span.rounded-full span')?.textContent.trim());
  R('initials stand in for a missing photo', initials === 'SL', String(initials));
  await browser.close();
}

// The weight log carried over from the scrapped Bodyweight tab. Its date is
// whenever that tab was last used, which reads on Stats as a stale measurement
// rather than a current weight — so the number is kept and filed as today's.
{
  const legacy = [{ date: '2026-08-30', weight: '69', notes: 'Evening Session - 10:30 PM' }];
  const { browser, page } = await open({ at: MON, bw: legacy, profile: { heightCm: '178' } });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs') || '[]'));
  R('the carried-over weight is re-dated to today',
    stored.length === 1 && stored[0].date === '2026-08-31' && stored[0].weight === '69',
    JSON.stringify(stored));
  R('and the note from the scrapped tab goes with it', !('notes' in stored[0]), JSON.stringify(stored[0]));
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  R('so Stats reads it as a weight from today', /69 kg · 178 cm · 31 Aug 2026/.test(txt),
    (txt.match(/[\d.]+ kg · \d+ cm · [^\n]*/) || ['none'])[0]);
  R('with the BMI it gives', /body mass index\n21\.8/i.test(txt), (txt.match(/body mass index\n[\d.]+/i) || ['none'])[0]);
  await browser.close();
}

// Once. A migration that re-dated the weight every morning would be a worse
// lie than the stale date it replaced — and would eat the history it exists to
// keep. So this walks the real path: save a weight through the profile, take
// what that actually wrote, and open it again the next day.
{
  const { browser, page } = await open({ at: MON, bw: [], profile: { heightCm: '178' } });
  await fill(page, { weight: '69' });
  await page.waitForTimeout(500);
  const written = await page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs') || '[]'));
  R('a weight saved from the profile carries no legacy marker',
    written.length === 1 && !('notes' in written[0]), JSON.stringify(written));
  await browser.close();

  const next = await open({ at: '2026-09-01T14:00:00Z', bw: written, profile: { heightCm: '178' } });
  const after = await next.page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs') || '[]'));
  R('so the next day leaves its date alone',
    after.length === 1 && after[0].date === '2026-08-31', JSON.stringify(after));
  await next.browser.close();
}

// A second weight on a later day is a second entry, not a replacement.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-29', weight: '70' }], profile: { heightCm: '178' } });
  await fill(page, { weight: '69' });
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bodyweight-logs') || '[]'));
  R('the earlier weight survives a new one', stored.length === 2 && stored[0].date === '2026-08-31' && stored[1].date === '2026-08-29',
    JSON.stringify(stored));
  await browser.close();
}

// The profile takes the lifter's details and nothing else. How the weight log
// is keyed is the app's own business, and BMI belongs on the screen built to
// explain it — a reading with no classification beside it is worse than none.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '69' }],
    profile: { name: 'Sample Lifter', dob: '1995-03-12', sex: 'Male', heightCm: '178' } });
  await nav(page, 'Profile');
  const txt = await bodyText(page);
  R('the profile does not explain how the weight log is keyed',
    !/one entry a day|replaces today|earlier days are kept/i.test(txt),
    (txt.match(/[^\n]*entry a day[^\n]*/i) || ['clean'])[0]);
  R('and carries no BMI of its own', !/\bBMI\b/.test(txt) && !/Normal range|Overweight|Obese class/.test(txt),
    (txt.match(/BMI[^\n]*|Normal range[^\n]*/) || ['clean'])[0]);
  R('the identity fields are all still there',
    /name/i.test(txt) && /email/i.test(txt) && /mobile/i.test(txt) &&
    /date of birth/i.test(txt) && /gender/i.test(txt),
    'name, email, mobile, dob, gender');
  // The two measurements moved to Stats, beside the reading they produce.
  R('and the measurements are not on the profile',
    !/height/i.test(txt) && !/weight/i.test(txt),
    (txt.match(/height[^\n]*|weight[^\n]*/i) || ['clean'])[0]);

  // And BMI is still exactly one tap away, where it belongs.
  await nav(page, 'Stats');
  R('BMI is on Stats', /body mass index\n21\.8/i.test(await bodyText(page)),
    ((await bodyText(page)).match(/body mass index\n[\d.]+/i) || ['missing'])[0]);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
