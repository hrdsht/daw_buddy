const k2 = require('../src/renderer/key2');
const NOTES = k2.NOTES;

// Build a chroma the way real material would present, with a drone.
function chromaFor(tonicPc, degrees, { drone = 1.5, harmonics = true } = {}) {
  const c = new Float64Array(12).fill(0.01);
  for (const d of degrees) c[(tonicPc + d) % 12] += 1;
  c[tonicPc] += drone;
  c[(tonicPc + 7) % 12] += drone * 0.7;
  if (harmonics) {
    // every sounding note throws energy at its 5th and 3rd
    const base = Array.from(c);
    for (let pc = 0; pc < 12; pc++) {
      c[(pc + 7) % 12] += base[pc] * 0.45;
      c[(pc + 4) % 12] += base[pc] * 0.3;
    }
  }
  const sum = c.reduce((a, b) => a + b, 0);
  return c.map(v => v / sum);
}

const cases = [
  ['A# Bhairav (raga)',      10, k2.SCALES.bhairav,  'A#'],
  ['A# Bhairavi (raga)',     10, k2.SCALES.bhairavi, 'A#'],
  ['A# minor',               10, k2.SCALES.minor,    'A#'],
  ['F# minor',                6, k2.SCALES.minor,    'F#'],
  ['C major',                 0, k2.SCALES.major,    'C'],
  ['D dorian',                2, k2.SCALES.dorian,   'D'],
  ['G# yaman (raga)',         8, k2.SCALES.yaman,    'G#'],
  ['E minor pentatonic',      4, k2.SCALES.pentatonicMinor, 'E']
];

console.log('material                 old (Krumhansl)   new tonic   scale            correct?');
console.log('-'.repeat(88));
let oldRight = 0, newRight = 0;
for (const [label, pc, degrees, expected] of cases) {
  const chroma = chromaFor(pc, degrees);
  const old = k2.krumhansl(chroma);
  const now = k2.analyseKey(chroma, null);

  const oldOk = old.tonic === expected;
  const newOk = now.tonic === expected;
  if (oldOk) oldRight++;
  if (newOk) newRight++;

  console.log(
    label.padEnd(24),
    (old.tonic + ' ' + old.mode).padEnd(17),
    now.tonic.padEnd(11),
    now.scale.padEnd(16),
    (oldOk ? 'old ok ' : 'old WRONG ') + (newOk ? '· new ok' : '· new WRONG')
  );
}
console.log('-'.repeat(88));
console.log('tonic correct:  old ' + oldRight + '/' + cases.length + '   new ' + newRight + '/' + cases.length);
