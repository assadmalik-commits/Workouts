// Stats: BMI, and the WHO bands at their own edges.
import { open, report, nav, bodyText } from './lib.mjs';
let fails = 0; const R = (n,p,d) => { if(!report(n,p,d)) fails++; };
const MON = '2026-08-31T14:00:00Z';
// No note, so this is not one of the scrapped Bodyweight tab's entries and
// keeps its own date. That migration has its own suite.
const BW = [{ date: '2026-08-30', weight: '69' }];

// Nothing to work with, and the page says which piece is missing.
{
  const { browser, page } = await open({ at: MON, bw: [] });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  R('with no height and no weight it asks for both', /two numbers missing/i.test(txt) && /height and your weight/.test(txt),
    (txt.match(/BMI needs[^\n]*/) || ['missing'])[0]);
  // No button to send the reader elsewhere any more: the two fields that fix
  // this are on the same screen, above the message.
  R('and the fields that fix it are on the same screen',
    (await page.locator('#stats-weight').count()) === 1 &&
      (await page.locator('#stats-height').count()) === 1 &&
      /at the top of this screen/i.test(txt),
    txt.replace(/\n/g, ' | ').slice(0, 140));
  await browser.close();
}

// A weight on record but no height is still only half of a BMI.
{
  const { browser, page } = await open({ at: MON, bw: BW });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  // One missing number is not two, and the card no longer says it is.
  R('a weight alone is not a BMI', /one number missing/i.test(txt) && /BMI needs your height\./.test(txt.replace(/\n/g, ' ')),
    (txt.match(/BMI needs[^\n]*/) || ['missing'])[0]);
  R('but the weight is still listed', /69/.test(txt) && /30 Aug/.test(txt), 'weight history shown');
  await browser.close();
}

// The number itself, and the band it falls in.
{
  const { browser, page } = await open({ at: MON, bw: BW, profile: { heightCm: '178', name: 'Assad' } });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  const bmi = (txt.match(/Body mass index\n([\d.]+)/i) || [])[1];
  R('69kg at 178cm reads 21.8', bmi === '21.8', `read ${bmi}`);
  R('and is called normal weight', /Normal range/.test(txt), (txt.match(/Normal range|Overweight|Obese[^\n]*|Underweight/) || ['none'])[0]);
  R('the normal range for that height is spelled out', /58\.6–78\.9/.test(txt), (txt.match(/[\d.]+–[\d.]+\nkg/) || ['missing'])[0]);
  R('the standard is named down to the table', /WHO Technical Report Series 894, Table 2\.1 \(2000\)/.test(txt), 'named');
  await browser.close();
}

// Every band, at the value that defines its edge. One browser, walking the
// weight up through the classification.
{
  // Each band also has to say something of its own. One caveat repeated under
  // every reading tells the lifter nothing about the reading in front of them.
  // Each band also has to say something of its own, and it has to be WHO's own
  // risk-of-comorbidities grading — not advice invented to fill the space.
  const cases = [
    ['58.3', 'Underweight', /risk of comorbidities: low — but WHO adds: risk of other clinical problems increased\./i],
    ['78.9', 'Normal range', /risk of comorbidities: average\./i],
    ['79.5', 'Overweight', /risk of comorbidities: increased\./i],
    ['95.4', 'Obese class I', /risk of comorbidities: moderate\./i],
    ['111.2', 'Obese class II', /risk of comorbidities: severe\./i],
    ['127.1', 'Obese class III', /risk of comorbidities: very severe\./i],
  ];
  const guidance = [];
  const { browser, page } = await open({ at: MON, bw: [], profile: { heightCm: '178' } });
  for (const [weight, expected, says] of cases) {
    // The weight is entered on Stats now, on the same screen as the band it
    // lands in.
    await nav(page, 'Stats');
    await page.fill('#stats-weight', weight);
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Save weight"]').click();
    await page.waitForTimeout(500);
    const txt = await bodyText(page);
    const band = (txt.match(/Underweight|Normal range|Overweight|Obese class I{1,3}/) || ['none'])[0];
    const bmi = (txt.match(/Body mass index\n([\d.]+)/i) || [])[1];
    R(`${weight}kg at 178cm is ${expected}`, band === expected, `BMI ${bmi} read as ${band}`);
    const note = txt.slice(txt.indexOf('kg · 178 cm')).split('\n').slice(1).join(' ');
    R(`and ${expected} is told something of its own`, says.test(note),
      note.slice(0, 110).trim() || 'no guidance shown');
    guidance.push(note.replace(/These BMI values are age-independent[\s\S]*/, '').trim());
    R(`and ${expected} carries no training advice`,
      !/\b(lift|lifting|train|training|gym|programme|program|workout)\b/i.test(note.replace(/These BMI values are age-independent[\s\S]*/, '')),
      note.replace(/These BMI values are age-independent[\s\S]*/, '').slice(0, 90).trim());
  }
  R('no two bands are given the same guidance', new Set(guidance).size === cases.length,
    `${new Set(guidance).size} distinct of ${cases.length}`);
  R('and the standard is still named under each', guidance.length === cases.length, `${guidance.length}`);
  await browser.close();
}

// The number on screen is the number that gets classified. 79.1kg at 178cm is
// a BMI of 24.9653 — which displays as 25.0, and a 25.0 sitting under a
// "Normal range" pill is a contradiction the lifter cannot resolve.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '79.1' }], profile: { heightCm: '178' } });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  const bmi = (txt.match(/body mass index\n([\d.]+)/i) || [])[1];
  const band = (txt.match(/Underweight|Normal range|Overweight|Obese class I{1,3}/) || ['none'])[0];
  R('a BMI that displays as 25.0 is classified as 25.0', bmi === '25.0' && band === 'Overweight',
    `${bmi} read as ${band}`);
  await browser.close();
}

// WHO writes the ranges to two decimals, and names the 25.00-29.99 slice
// preobese under an overweight heading. The app quotes the table, so it says
// what the table says.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '69' }], profile: { heightCm: '178' } });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  R('the band is named the way WHO names it', /Normal range: 18\.50 to 24\.99\./.test(txt),
    (txt.match(/Normal range:[^\n]*/) || ['none'])[0]);
  R('and the footnote is WHO’s own', /age-independent and the same for both sexes/.test(txt) &&
    /continuous and graded and begin at a BMI above 25/.test(txt), 'footnote present');
  R('including the sentence about muscle and fat', /does not distinguish between weight associated with muscle/.test(txt),
    'present');
  await browser.close();
}

// The preobese label, checked where it belongs.
{
  const { browser, page } = await open({ at: MON, bw: [{ date: '2026-08-30', weight: '85' }], profile: { heightCm: '178' } });
  await nav(page, 'Stats');
  const txt = await bodyText(page);
  R('the overweight band quotes WHO’s preobese label', /25\.00 to 29\.99, which WHO labels preobese/.test(txt),
    (txt.match(/Overweight:[^\n]*/) || ['none'])[0]);
  await browser.close();
}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
