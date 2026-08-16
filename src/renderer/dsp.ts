'use strict';

/* eslint-disable no-bitwise */

/**
 * Tempo and musical key estimation from raw audio samples.
 *
 * This runs in the window, on the PCM that the browser engine already decoded
 * for playback. Nothing here needs a library — it's all arithmetic on arrays.
 *
 * ------------------------------------------------------------------
 * The honest bit: tempo detection is reliable on this kind of material.
 * Key detection is a guess with a confidence attached. On a clean piano
 * recording it's near perfect. On a dense mix with detuned supersaws,
 * pitched percussion and heavy sidechain, it will sometimes hand you the
 * relative minor or the key a fifth away. Treat it as a strong hint that
 * saves you time, not as a fact.
 * ------------------------------------------------------------------
 */

/* ==================================================================
   1. FFT — iterative radix-2 Cooley-Tukey, in place
   ================================================================== */

/**
 * Takes real input, returns magnitudes for the lower half of the spectrum.
 *
 * Two stages, as in any textbook implementation:
 *   a) bit-reversal permutation — reorder the input so the butterflies below
 *      read from adjacent slots
 *   b) log2(n) passes of butterflies, each combining pairs twice as far apart
 *
 * n must be a power of two.
 */
function fftMagnitudes(real, imag) {
  const n = real.length;

  // (a) bit-reversal permutation
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = real[i];
      real[i] = real[j];
      real[j] = t;
      t = imag[i];
      imag[i] = imag[j];
      imag[j] = t;
    }
  }

  // (b) butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;

      for (let k = 0; k < len / 2; k += 1) {
        const aReal = real[i + k];
        const aImag = imag[i + k];
        const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
        const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;

        real[i + k] = aReal + bReal;
        imag[i + k] = aImag + bImag;
        real[i + k + len / 2] = aReal - bReal;
        imag[i + k + len / 2] = aImag - bImag;

        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }

  const half = n / 2;
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i += 1) {
    mags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
  return mags;
}

function hann(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

/* ==================================================================
   2. Shared front end — one pass of spectra for both analyses
   ================================================================== */

const FRAME = 4096;
const HOP = 1024;

function spectra(samples, sampleRate, onProgress) {
  const window = hann(FRAME);
  const frames = samples.length < FRAME
    ? 0
    : 1 + Math.floor((samples.length - FRAME) / HOP);
  const out = [];

  const real = new Float64Array(FRAME);
  const imag = new Float64Array(FRAME);

  for (let f = 0; f < frames; f += 1) {
    const offset = f * HOP;
    for (let i = 0; i < FRAME; i += 1) {
      real[i] = samples[offset + i] * window[i];
      imag[i] = 0;
    }
    out.push(fftMagnitudes(real, imag));

    if (onProgress && f % 40 === 0) onProgress(f / frames);
  }

  return { frames: out, binHz: sampleRate / FRAME, hopSeconds: HOP / sampleRate };
}

/* ==================================================================
   3. Tempo — spectral flux, then autocorrelation
   ================================================================== */

/**
 * Spectral flux: how much brighter did this frame get compared to the last?
 * Only increases count — a note starting is a rise in energy, a note ending
 * isn't an onset. That gives a spiky envelope where the drums are.
 *
 * Then autocorrelation: slide the envelope against itself and see which
 * offset lines the spikes up best. That offset is the beat period.
 */
function detectTempo(frames, hopSeconds) {
  if (frames.length < 32) return { bpm: null, confidence: 0 };

  const flux = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f += 1) {
    let sum = 0;
    const prev = frames[f - 1];
    const cur = frames[f];
    // Below ~5kHz. Above that is mostly cymbal wash and air.
    const limit = Math.min(cur.length, 600);
    for (let b = 0; b < limit; b += 1) {
      const diff = cur[b] - prev[b];
      if (diff > 0) sum += diff;
    }
    flux[f] = sum;
  }

  // Remove the slow drift so loud sections don't dominate quiet ones.
  const smoothed = movingAverage(flux, 24);
  const envelope = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i += 1) {
    envelope[i] = Math.max(0, flux[i] - smoothed[i]);
  }

  const minLag = Math.round(60 / 200 / hopSeconds); // 200 BPM
  const maxLag = Math.round(60 / 60 / hopSeconds); //  60 BPM

  let best = { lag: 0, score: 0 };
  const scores = [];

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < envelope.length; i += 1) {
      sum += envelope[i] * envelope[i + lag];
    }
    const score = sum / (envelope.length - lag);
    scores.push({ lag, score });
    if (score > best.score) best = { lag, score };
  }

  if (!best.lag) return { bpm: null, confidence: 0 };

  let bpm = 60 / (best.lag * hopSeconds);

  // Octave errors are the classic failure: 174 read as 87, or 128 as 256.
  // Dance music lives in 90–180, so fold into that window.
  while (bpm < 90) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const mean = scores.reduce((a, s) => a + s.score, 0) / scores.length;
  const confidence = mean > 0 ? Math.min(1, (best.score / mean - 1) / 3) : 0;

  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

function movingAverage(data, radius) {
  const out = new Float32Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
    if (i >= radius * 2 + 1) sum -= data[i - radius * 2 - 1];
    out[Math.max(0, i - radius)] = sum / Math.min(i + 1, radius * 2 + 1);
  }
  return out;
}

/* ==================================================================
   4. Key — chroma, then correlation against key profiles
   ================================================================== */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Kessler profiles: how much each of the 12 pitch classes tends to
// be heard in a piece in that key. Derived from listening experiments.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot wheel. Major keys are the B ring, minors the A ring.
const CAMELOT_MAJOR = {
  C: '8B', 'C#': '3B', D: '10B', 'D#': '5B', E: '12B', F: '7B',
  'F#': '2B', G: '9B', 'G#': '4B', A: '11B', 'A#': '6B', B: '1B'
};
const CAMELOT_MINOR = {
  C: '5A', 'C#': '12A', D: '7A', 'D#': '2A', E: '9A', F: '4A',
  'F#': '11A', G: '6A', 'G#': '1A', A: '8A', 'A#': '3A', B: '10A'
};

function detectKey(frames, binHz) {
  if (frames.length === 0) return { key: null, confidence: 0 };

  const chroma = new Float64Array(12);

  // Only look at 65 Hz to 2 kHz. Below that is bass fundamentals that smear,
  // above it is harmonics that muddy the picture.
  const lowBin = Math.max(1, Math.floor(65 / binHz));
  const highBin = Math.min(frames[0].length - 1, Math.ceil(2000 / binHz));

  for (const frame of frames) {
    for (let b = lowBin; b <= highBin; b += 1) {
      const magnitude = frame[b];
      if (magnitude <= 0) continue;

      const hz = b * binHz;
      // MIDI note number from frequency, then fold to a pitch class.
      const midi = 69 + 12 * Math.log2(hz / 440);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pitchClass] += magnitude;
    }
  }

  const total = chroma.reduce((a, b) => a + b, 0);
  if (total === 0) return { key: null, confidence: 0 };
  for (let i = 0; i < 12; i += 1) chroma[i] /= total;

  const ranked = [];
  for (let root = 0; root < 12; root += 1) {
    ranked.push({
      root,
      mode: 'major',
      score: correlate(chroma, rotate(MAJOR, root))
    });
    ranked.push({
      root,
      mode: 'minor',
      score: correlate(chroma, rotate(MINOR, root))
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  // Confidence is how far clear the winner is. A near-tie usually means the
  // relative major/minor pair, which share all the same notes.
  const gap = winner.score - runnerUp.score;
  const confidence = Math.max(0, Math.min(1, gap * 6));

  const note = NOTES[winner.root];
  const camelot =
    winner.mode === 'major' ? CAMELOT_MAJOR[note] : CAMELOT_MINOR[note];

  return {
    key: `${note} ${winner.mode === 'major' ? 'maj' : 'min'}`,
    note,
    mode: winner.mode,
    camelot,
    confidence,
    alternate: `${NOTES[runnerUp.root]} ${runnerUp.mode === 'major' ? 'maj' : 'min'}`
  };
}

function rotate(profile, by) {
  const out = new Array(12);
  for (let i = 0; i < 12; i += 1) out[i] = profile[(i - by + 12) % 12];
  return out;
}

// Pearson correlation between the measured chroma and a key profile.
function correlate(a, b) {
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/* ==================================================================
   5. The one function the UI calls
   ================================================================== */

/**
 * Analyses up to 60 seconds taken from the middle of the track. The middle
 * beats the start: intros are often a filtered pad with no drums and no
 * harmony, which is the worst possible material for both jobs.
 */
function analyse(channelData, sampleRate, onProgress?) {
  const maxSeconds = 60;
  const wanted = Math.min(channelData.length, maxSeconds * sampleRate);
  const start = Math.max(0, Math.floor((channelData.length - wanted) / 2));
  const slice = channelData.subarray(start, start + wanted);

  const { frames, binHz, hopSeconds } = spectra(slice, sampleRate, onProgress);

  const tempo = detectTempo(frames, hopSeconds);
  const key = detectKey(frames, binHz);

  return {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    key: key.key,
    camelot: key.camelot,
    keyConfidence: key.confidence,
    keyAlternate: key.alternate,
    analysedSeconds: Math.round(wanted / sampleRate)
  };
}

export const DSP = { analyse, detectKey, detectTempo, fftMagnitudes, NOTES };
