'use strict';

/**
 * Key detection, rebuilt.
 *
 * ------------------------------------------------------------------
 * WHY THE OLD ONE WAS WRONG
 *
 * Two separate faults, both real:
 *
 * 1. FREQUENCY RESOLUTION. The old chroma took a 4096-point FFT and snapped
 *    each bin to the nearest semitone. At 44.1kHz that is 10.77 Hz per bin —
 *    but a semitone at A#2 (116 Hz) is only 6.9 Hz wide. So below roughly
 *    250 Hz a single bin spans more than a semitone, and a bass note smears
 *    across three pitch classes:
 *
 *        bin 10  107.7 Hz → A
 *        bin 11  118.4 Hz → A#     ← the actual note
 *        bin 12  129.2 Hz → C
 *
 *    The tonic is usually the lowest strong note in the mix, which means the
 *    single most important pitch was the worst measured.
 *
 * 2. NO HARMONIC ALLOWANCE. A note at A# puts energy at A#, F (5th), D (3rd)
 *    and up. Correlating raw chroma against key profiles lets a strong
 *    harmonic series vote for keys a third or fifth away from the truth.
 *
 * And a third problem that isn't a bug so much as a wrong premise: raga-based
 * music is not in a Western major or minor key. Forcing 24 profiles onto it
 * returns whichever of 24 wrong answers fits least badly.
 * ------------------------------------------------------------------
 *
 * WHAT THIS DOES INSTEAD
 *
 * Finds the TONIC first, and treats the mode as a separate, less certain
 * question. That ordering matters because the tonic is what the drone plays,
 * what a collaborator asks for, and what mixing in key depends on. A correct
 * tonic with an unknown mode is useful. A confident wrong key is not.
 */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Scale shapes worth recognising beyond major and minor. Semitones from the
 * tonic.
 *
 * The ragas here are the common thaat shapes, named for what they are. This
 * is not a claim to identify a raga — that needs phrasing, ornamentation and
 * ascent/descent asymmetry, none of which is in a pitch histogram. It only
 * says which set of notes is being used.
 */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  // Bhairav — flat 2nd and flat 6th with a major 3rd and 7th
  bhairav: [0, 1, 4, 5, 7, 8, 11],
  // Bhairavi — all four flats
  bhairavi: [0, 1, 3, 5, 7, 8, 10],
  // Todi-like
  todi: [0, 1, 3, 6, 7, 8, 11],
  // Kalyan / Yaman
  yaman: [0, 2, 4, 6, 7, 9, 11],
  // Charukesi
  charukesi: [0, 2, 4, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
};

/* ================================================================== */
/* 1. Chroma, at a resolution that can actually see the bass          */
/* ================================================================== */

/**
 * A constant-Q style chroma: instead of taking FFT bins and rounding them to
 * semitones, it sums the energy in the band around each semitone directly.
 *
 * That way an A#2 is measured across the 6.9 Hz that actually is A#2, rather
 * than being assigned to whichever 10.77 Hz bin it happens to fall in.
 *
 * Needs a longer window than the old one — 16384 at 44.1kHz gives 2.7 Hz per
 * bin, enough to resolve a semitone down to about 60 Hz.
 */
function chromaFromSpectrum(magnitudes, binHz, options = {}) {
  const lowNote = options.lowMidi || 33; // A1, 55 Hz
  const highNote = options.highMidi || 96; // C7
  const chroma = new Float64Array(12);

  for (let midi = lowNote; midi <= highNote; midi += 1) {
    const centre = 440 * Math.pow(2, (midi - 69) / 12);
    const lower = centre * Math.pow(2, -0.5 / 12);
    const upper = centre * Math.pow(2, 0.5 / 12);

    const from = Math.max(1, Math.floor(lower / binHz));
    const to = Math.min(magnitudes.length - 1, Math.ceil(upper / binHz));
    if (to < from) continue;

    let energy = 0;
    for (let bin = from; bin <= to; bin += 1) energy += magnitudes[bin];

    // Octave weighting: the middle of the range carries most melodic
    // information. Very low notes are muddy, very high ones are usually
    // harmonics rather than fundamentals.
    const weight = midi < 45 ? 0.6 : midi > 84 ? 0.5 : 1;

    chroma[((midi % 12) + 12) % 12] += energy * weight;
  }

  return normalise(chroma);
}

/**
 * Removes energy that is probably a harmonic of a lower note.
 *
 * A note at A# also lights up F (its fifth) and D (its major third). Without
 * this, a strong bass note votes for the key a fifth up as well as its own —
 * which is exactly the kind of error that turns A# into F#.
 *
 * Subtractive rather than multiplicative, and conservative: it removes a
 * fraction of what each pitch class contributes to its harmonics, so a note
 * that is genuinely present survives.
 */
function suppressHarmonics(chroma, strength = 0.35) {
  const out = Float64Array.from(chroma);
  // 5th (7 semitones), major 3rd (4), and the octave-folded 7th (10)
  const harmonics = [
    { interval: 7, weight: 1.0 },
    { interval: 4, weight: 0.6 },
    { interval: 10, weight: 0.3 }
  ];

  for (let root = 0; root < 12; root += 1) {
    for (const { interval, weight } of harmonics) {
      const target = (root + interval) % 12;
      out[target] -= chroma[root] * strength * weight;
    }
  }

  for (let i = 0; i < 12; i += 1) if (out[i] < 0) out[i] = 0;
  return normalise(out);
}

/* ================================================================== */
/* 2. Tonic — the question worth answering first                      */
/* ================================================================== */

/**
 * Finds the tonic without assuming a mode.
 *
 * Three pieces of evidence, combined:
 *
 *   presence   how much of the total energy sits on that pitch class
 *   stability  how consistently it is present across the whole piece —
 *              a drone or a repeatedly returned-to root scores high, a
 *              passing note does not
 *   fifth      whether the pitch class a fifth above is also strong, which
 *              is the single most reliable signal of a tonal centre and is
 *              exactly what a tanpura provides
 *
 * This works on raga material, where the drone states the tonic continuously,
 * and it works on Western material, where the root is the most returned-to
 * note. It does not need to know the mode to answer.
 */
function findTonic(averageChroma, frameChromas) {
  const stability = new Float64Array(12);

  if (frameChromas && frameChromas.length > 0) {
    // How often each pitch class is among the strongest in a frame.
    for (const frame of frameChromas) {
      const ranked = Array.from(frame.keys()).sort((a, b) => frame[b] - frame[a]);
      stability[ranked[0]] += 1;
      stability[ranked[1]] += 0.5;
      stability[ranked[2]] += 0.25;
    }
    const total = frameChromas.length;
    for (let i = 0; i < 12; i += 1) stability[i] /= total;
  } else {
    for (let i = 0; i < 12; i += 1) stability[i] = averageChroma[i];
  }

  const scored = [];
  for (let pc = 0; pc < 12; pc += 1) {
    const fifth = averageChroma[(pc + 7) % 12];
    const fourth = averageChroma[(pc + 5) % 12];

    const score =
      averageChroma[pc] * 1.0 +
      stability[pc] * 1.2 +
      fifth * 0.8 + // a strong fifth above supports this as the root
      fourth * 0.2 -
      averageChroma[(pc + 1) % 12] * 0.3; // a strong semitone above argues against

    scored.push({ pc, note: NOTES[pc], score, presence: averageChroma[pc], stability: stability[pc] });
  }

  scored.sort((a, b) => b.score - a.score);

  const margin = scored[0].score > 0 ? (scored[0].score - scored[1].score) / scored[0].score : 0;

  return {
    tonic: scored[0].note,
    tonicPc: scored[0].pc,
    confidence: Math.max(0, Math.min(1, margin * 3.5)),
    runnerUp: scored[1].note,
    ranked: scored.slice(0, 4)
  };
}

/* ================================================================== */
/* 3. Mode — a separate question, answered only if the notes support it */
/* ================================================================== */

/**
 * Given a tonic, which scale shape best fits what is actually sounding.
 *
 * Scored by how much of the total energy falls on scale degrees versus
 * outside them, so a scale that explains more of the music wins.
 */
function findScale(chroma, tonicPc) {
  const results = [];

  for (const [name, degrees] of Object.entries(SCALES)) {
    const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

    let inside = 0;
    let outside = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      if (inScale.has(pc)) inside += chroma[pc];
      else outside += chroma[pc];
    }

    // Prefer scales that explain the energy without simply having more notes.
    const coverage = inside / (inside + outside);
    const efficiency = coverage / Math.sqrt(degrees.length / 7);
    results.push({ name, coverage, score: efficiency, degrees });
  }

  results.sort((a, b) => b.score - a.score);

  const best = results[0];
  const margin = (best.score - results[1].score) / best.score;

  return {
    scale: best.name,
    coverage: best.coverage,
    confidence: Math.max(0, Math.min(1, margin * 8)),
    alternatives: results.slice(1, 3).map((r) => r.name)
  };
}

/* ================================================================== */
/* 4. The answer                                                      */
/* ================================================================== */

const CAMELOT_MAJOR = {
  C: '8B', 'C#': '3B', D: '10B', 'D#': '5B', E: '12B', F: '7B',
  'F#': '2B', G: '9B', 'G#': '4B', A: '11B', 'A#': '6B', B: '1B'
};
const CAMELOT_MINOR = {
  C: '5A', 'C#': '12A', D: '7A', 'D#': '2A', E: '9A', F: '4A',
  'F#': '11A', G: '6A', 'G#': '1A', A: '8A', 'A#': '3A', B: '10A'
};

/**
 * Reports what it actually knows.
 *
 * `tonic` is always given, with its own confidence — this is what the drone
 * should play and what a collaborator means when they ask what key something
 * is in.
 *
 * `key` and `camelot` are only filled in when the scale is recognisably
 * major or minor. A raga on A# gets `tonic: 'A#'` and `scale: 'bhairav'`
 * with no Camelot number, because Camelot describes the Western circle of
 * fifths and saying "6B" about Bhairav would be inventing information.
 */
function analyseKey(averageChroma, frameChromas, options = {}) {
  const clean = options.suppressHarmonics === false
    ? averageChroma
    : suppressHarmonics(averageChroma);

  const tonicResult = findTonic(clean, frameChromas);
  const scaleResult = findScale(clean, tonicResult.tonicPc);

  const isMajorish = ['major', 'lydian', 'mixolydian'].includes(scaleResult.scale);
  const isMinorish = ['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor'].includes(scaleResult.scale);
  const western = isMajorish || isMinorish;

  // Cross-check against the Krumhansl profiles. Agreement raises confidence;
  // disagreement is worth surfacing rather than hiding.
  const profile = krumhansl(clean);
  const agrees = profile.tonic === tonicResult.tonic;

  return {
    tonic: tonicResult.tonic,
    tonicConfidence: agrees
      ? Math.min(1, tonicResult.confidence + 0.2)
      : tonicResult.confidence,
    tonicAlternative: tonicResult.runnerUp,

    scale: scaleResult.scale,
    scaleConfidence: scaleResult.confidence,
    scaleAlternatives: scaleResult.alternatives,

    key: western
      ? `${tonicResult.tonic} ${isMajorish ? 'maj' : 'min'}`
      : null,
    camelot: western
      ? (isMajorish ? CAMELOT_MAJOR : CAMELOT_MINOR)[tonicResult.tonic]
      : null,

    modal: !western,
    profileSays: `${profile.tonic} ${profile.mode}`,
    profileAgrees: agrees,
    ranked: tonicResult.ranked
  };
}

/** The old method, kept as a cross-check rather than as the answer. */
function krumhansl(chroma) {
  let best = { score: -Infinity };
  for (let root = 0; root < 12; root += 1) {
    for (const [mode, profile] of [['maj', MAJOR], ['min', MINOR]]) {
      const score = correlate(chroma, rotate(profile, root));
      if (score > best.score) best = { score, tonic: NOTES[root], mode };
    }
  }
  return best;
}

/* ---------------------------- helpers ---------------------------- */

function rotate(profile, by) {
  const out = new Array(12);
  for (let i = 0; i < 12; i += 1) out[i] = profile[(i - by + 12) % 12];
  return out;
}

function correlate(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function mean(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

function normalise(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  if (sum === 0) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / sum;
  return out;
}

module.exports = {
  analyseKey,
  chromaFromSpectrum,
  suppressHarmonics,
  findTonic,
  findScale,
  krumhansl,
  NOTES,
  SCALES,
  RECOMMENDED_FFT: 16384
};
