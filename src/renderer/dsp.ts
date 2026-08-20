'use strict';

/* eslint-disable no-bitwise */

/**
 * Tempo and musical key estimation from raw audio samples.
 *
 * Reworked in proposal 0007:
 *   - 16,384-point FFT for sub-60Hz semitone resolution
 *   - Constant-Q chroma integrating semitone bands directly
 *   - Harmonic suppression preventing false fifth/third matches
 *   - Tonic-first detection decoupled from mode/scale
 *   - 16 scale shapes including modal thaats (bhairav, bhairavi, etc.)
 */

/* ==================================================================
   1. FFT — iterative radix-2 Cooley-Tukey, in place
   ================================================================== */

function fftMagnitudes(real: Float64Array, imag: Float64Array): Float32Array {
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

const HANN_CACHE = new Map<number, Float32Array>();

function hann(size: number): Float32Array {
  const cached = HANN_CACHE.get(size);
  if (cached) return cached;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  HANN_CACHE.set(size, w);
  return w;
}

/* ==================================================================
   2. Shared front end — spectra with 16384 FFT
   ================================================================== */

const RECOMMENDED_FFT = 16384;
const DEFAULT_HOP = 2048;

function spectra(samples: Float32Array | Float64Array, sampleRate: number, onProgress?: (p: number) => void) {
  let frameSize = RECOMMENDED_FFT;
  while (frameSize > samples.length && frameSize > 2048) {
    frameSize >>= 1;
  }
  // Hop around ~20-25ms for good tempo tracking
  const hopSize = Math.max(256, Math.min(1024, Math.pow(2, Math.round(Math.log2(sampleRate * 0.023)))));

  const window = hann(frameSize);
  const framesCount = samples.length < frameSize
    ? 0
    : 1 + Math.floor((samples.length - frameSize) / hopSize);
  const out: Float32Array[] = [];

  const real = new Float64Array(frameSize);
  const imag = new Float64Array(frameSize);

  for (let f = 0; f < framesCount; f += 1) {
    const offset = f * hopSize;
    for (let i = 0; i < frameSize; i += 1) {
      real[i] = samples[offset + i] * window[i];
      imag[i] = 0;
    }
    out.push(fftMagnitudes(real, imag));

    if (onProgress && f % 40 === 0) onProgress(f / framesCount);
  }

  return {
    frames: out,
    binHz: sampleRate / frameSize,
    hopSeconds: hopSize / sampleRate,
    frameSize,
    hopSize
  };
}

/* ==================================================================
   3. Tempo — spectral flux & autocorrelation
   ================================================================== */

function detectTempo(frames: Float32Array[], hopSeconds: number) {
  if (frames.length < 32) return { bpm: null, confidence: 0 };

  const flux = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f += 1) {
    let sum = 0;
    const prev = frames[f - 1];
    const cur = frames[f];
    // Below ~5kHz
    const limit = Math.min(cur.length, Math.round(600 * (cur.length / 2048)));
    for (let b = 0; b < limit; b += 1) {
      const diff = cur[b] - prev[b];
      if (diff > 0) sum += diff;
    }
    flux[f] = sum;
  }

  const smoothed = movingAverage(flux, 24);
  const envelope = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i += 1) {
    envelope[i] = Math.max(0, flux[i] - smoothed[i]);
  }

  const minLag = Math.max(1, Math.round(60 / 200 / hopSeconds)); // 200 BPM
  const maxLag = Math.round(60 / 60 / hopSeconds); //  60 BPM

  let best = { lag: 0, score: 0 };
  const scoreMap: Record<number, number> = {};
  const scores: { lag: number; score: number }[] = [];

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < envelope.length; i += 1) {
      sum += envelope[i] * envelope[i + lag];
    }
    const score = sum / (envelope.length - lag);
    scoreMap[lag] = score;
    scores.push({ lag, score });
    if (score > best.score) best = { lag, score };
  }

  if (!best.lag) return { bpm: null, confidence: 0 };

  // Parabolic interpolation around peak
  let exactLag = best.lag;
  const s0 = scoreMap[best.lag - 1];
  const s1 = best.score;
  const s2 = scoreMap[best.lag + 1];
  if (s0 !== undefined && s2 !== undefined) {
    const denom = s0 - 2 * s1 + s2;
    if (denom !== 0) {
      const delta = 0.5 * (s0 - s2) / denom;
      if (Math.abs(delta) < 1) exactLag += delta;
    }
  }

  let bpm = 60 / (exactLag * hopSeconds);

  while (bpm < 90) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const meanScore = scores.reduce((a, s) => a + s.score, 0) / scores.length;
  const confidence = meanScore > 0 ? Math.min(1, (best.score / meanScore - 1) / 3) : 0;

  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

function movingAverage(data: Float32Array, radius: number): Float32Array {
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
   4. Key & Scale Detection — Constant-Q, Harmonics, Tonic, 16 Scales
   ================================================================== */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  bhairav: [0, 1, 4, 5, 7, 8, 11],
  todi: [0, 1, 3, 6, 7, 8, 11],
  marwa: [0, 1, 4, 6, 9, 11],
  poorvi: [0, 1, 4, 6, 7, 8, 11],
  charukesi: [0, 2, 4, 5, 7, 8, 10],
  shivaranjani: [0, 2, 3, 7, 9],
  malkauns: [0, 3, 5, 8, 10],
  bhupali: [0, 2, 4, 7, 9],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
};

export const THAAT_MAP: Record<string, string> = {
  major: 'Bilawal (Major)',
  minor: 'Asavari (Natural Minor)',
  dorian: 'Kafi (Dorian)',
  phrygian: 'Bhairavi (Phrygian)',
  lydian: 'Kalyan / Yaman (Lydian)',
  mixolydian: 'Khamaj (Mixolydian)',
  bhairav: 'Bhairav',
  todi: 'Todi',
  poorvi: 'Poorvi',
  marwa: 'Marwa',
  charukesi: 'Charukesi',
  shivaranjani: 'Shivaranjani',
  malkauns: 'Malkauns',
  bhupali: 'Bhoop / Bhupali'
};

export interface RagaSuggestion {
  name: string;
  thaat: string;
  degrees: number[];
  aarohana: string;
  aarohanaDegrees: number[];
  avarohana: string;
  avarohanaDegrees: number[];
  sargam: string;
  time?: string;
  mood?: string;
  score: number;
  matchPercent: number;
}

export const RAGA_DEFINITIONS: Array<{
  name: string;
  thaat: string;
  degrees: number[];
  aarohana: string;
  aarohanaDegrees: number[];
  avarohana: string;
  avarohanaDegrees: number[];
  sargam: string;
  time: string;
  mood: string;
}> = [
  {
    name: 'Bhairav',
    thaat: 'Bhairav',
    degrees: [0, 1, 4, 5, 7, 8, 11],
    aarohana: 'S r G m P d N Ṡ',
    aarohanaDegrees: [0, 1, 4, 5, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P m G r S',
    avarohanaDegrees: [12, 11, 8, 7, 5, 4, 1, 0],
    sargam: 'S r G m P d N',
    time: 'Dawn / Early Morning',
    mood: 'Devotional, Majestic & Serene'
  },
  {
    name: 'Ahir Bhairav',
    thaat: 'Bhairav',
    degrees: [0, 1, 4, 5, 7, 9, 10],
    aarohana: 'S r G m P D n Ṡ',
    aarohanaDegrees: [0, 1, 4, 5, 7, 9, 10, 12],
    avarohana: 'Ṡ n D P m G r S',
    avarohanaDegrees: [12, 10, 9, 7, 5, 4, 1, 0],
    sargam: 'S r G m P D n',
    time: 'Morning (1st Prahar)',
    mood: 'Peaceful, Divine & Uplifting'
  },
  {
    name: 'Bairagi',
    thaat: 'Bhairav',
    degrees: [0, 1, 5, 7, 10],
    aarohana: 'S r m P n Ṡ',
    aarohanaDegrees: [0, 1, 5, 7, 10, 12],
    avarohana: 'Ṡ n P m r S',
    avarohanaDegrees: [12, 10, 7, 5, 1, 0],
    sargam: 'S r m P n',
    time: 'Early Morning',
    mood: 'Meditative, Renunciant & Pure'
  },
  {
    name: 'Kalingada',
    thaat: 'Bhairav',
    degrees: [0, 1, 4, 5, 7, 8, 11],
    aarohana: 'S r G m P d N Ṡ',
    aarohanaDegrees: [0, 1, 4, 5, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P m G r S',
    avarohanaDegrees: [12, 11, 8, 7, 5, 4, 1, 0],
    sargam: 'S r G m P d N',
    time: 'Late Morning',
    mood: 'Light, Melodic & Devotional'
  },
  {
    name: 'Nat Bhairav',
    thaat: 'Bhairav',
    degrees: [0, 2, 4, 5, 7, 8, 11],
    aarohana: 'S R G m P d N Ṡ',
    aarohanaDegrees: [0, 2, 4, 5, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P m G R S',
    avarohanaDegrees: [12, 11, 8, 7, 5, 4, 2, 0],
    sargam: 'S R G m P d N',
    time: 'Morning',
    mood: 'Soothing & Contemplative'
  },
  {
    name: 'Yaman / Kalyan',
    thaat: 'Kalyan',
    degrees: [0, 2, 4, 6, 7, 9, 11],
    aarohana: 'S R G M P D N Ṡ',
    aarohanaDegrees: [0, 2, 4, 6, 7, 9, 11, 12],
    avarohana: 'Ṡ N D P M G R S',
    avarohanaDegrees: [12, 11, 9, 7, 6, 4, 2, 0],
    sargam: 'S R G M P D N',
    time: 'Evening (1st Prahar of Night)',
    mood: 'Romantic, Graceful & Blissful'
  },
  {
    name: 'Bhoop / Bhupali',
    thaat: 'Kalyan',
    degrees: [0, 2, 4, 7, 9],
    aarohana: 'S R G P D Ṡ',
    aarohanaDegrees: [0, 2, 4, 7, 9, 12],
    avarohana: 'Ṡ D P G R S',
    avarohanaDegrees: [12, 9, 7, 4, 2, 0],
    sargam: 'S R G P D',
    time: 'Early Evening',
    mood: 'Grand, Peaceful & Soothing'
  },
  {
    name: 'Shuddha Kalyan',
    thaat: 'Kalyan',
    degrees: [0, 2, 4, 7, 9, 11],
    aarohana: 'S R G P D Ṡ',
    aarohanaDegrees: [0, 2, 4, 7, 9, 12],
    avarohana: 'Ṡ N D P M G R S',
    avarohanaDegrees: [12, 11, 9, 7, 6, 4, 2, 0],
    sargam: 'S R G P D N',
    time: 'Night (1st Prahar)',
    mood: 'Serene & Stately'
  },
  {
    name: 'Bihag',
    thaat: 'Bilawal',
    degrees: [0, 4, 5, 6, 7, 11],
    aarohana: 'S G m P N Ṡ',
    aarohanaDegrees: [0, 4, 5, 7, 11, 12],
    avarohana: 'Ṡ N D P M P G m G R S',
    avarohanaDegrees: [12, 11, 9, 7, 6, 7, 4, 5, 4, 2, 0],
    sargam: 'S G m M P N',
    time: 'Late Night (2nd Prahar)',
    mood: 'Romantic, Expressive & Longing'
  },
  {
    name: 'Hansadhwani',
    thaat: 'Bilawal',
    degrees: [0, 2, 4, 7, 11],
    aarohana: 'S R G P N Ṡ',
    aarohanaDegrees: [0, 2, 4, 7, 11, 12],
    avarohana: 'Ṡ N P G R S',
    avarohanaDegrees: [12, 11, 7, 4, 2, 0],
    sargam: 'S R G P N',
    time: 'Evening',
    mood: 'Auspicious, Radiant & Joyous'
  },
  {
    name: 'Bilawal / Alhaiya Bilawal',
    thaat: 'Bilawal',
    degrees: [0, 2, 4, 5, 7, 9, 11],
    aarohana: 'S R G P D N Ṡ',
    aarohanaDegrees: [0, 2, 4, 7, 9, 11, 12],
    avarohana: 'Ṡ N D P D n D P m G R S',
    avarohanaDegrees: [12, 11, 9, 7, 9, 10, 9, 7, 5, 4, 2, 0],
    sargam: 'S R G m P D N',
    time: 'Late Morning',
    mood: 'Cheerful, Fresh & Vibrant'
  },
  {
    name: 'Khamaj',
    thaat: 'Khamaj',
    degrees: [0, 4, 5, 7, 9, 10, 11],
    aarohana: 'S G m P D N Ṡ',
    aarohanaDegrees: [0, 4, 5, 7, 9, 11, 12],
    avarohana: 'Ṡ n D P m G R S',
    avarohanaDegrees: [12, 10, 9, 7, 5, 4, 2, 0],
    sargam: 'S G m P D N n',
    time: 'Late Evening',
    mood: 'Sensuous, Playful & Expressive'
  },
  {
    name: 'Desh',
    thaat: 'Khamaj',
    degrees: [0, 2, 5, 7, 10, 11],
    aarohana: 'S R m P N Ṡ',
    aarohanaDegrees: [0, 2, 5, 7, 11, 12],
    avarohana: 'Ṡ n D P m G R S',
    avarohanaDegrees: [12, 10, 9, 7, 5, 4, 2, 0],
    sargam: 'S R m P N n',
    time: 'Second Prahar of Night (Monsoon)',
    mood: 'Patriotic, Romantic & Sweet'
  },
  {
    name: 'Rageshri',
    thaat: 'Khamaj',
    degrees: [0, 2, 4, 5, 9, 10],
    aarohana: 'S R G m D n Ṡ',
    aarohanaDegrees: [0, 2, 4, 5, 9, 10, 12],
    avarohana: 'Ṡ n D m G R S',
    avarohanaDegrees: [12, 10, 9, 5, 4, 2, 0],
    sargam: 'S R G m D n',
    time: 'Night (2nd Prahar)',
    mood: 'Romantic, Deep & Tender'
  },
  {
    name: 'Kafi',
    thaat: 'Kafi',
    degrees: [0, 2, 3, 5, 7, 9, 10],
    aarohana: 'S R g m P D n Ṡ',
    aarohanaDegrees: [0, 2, 3, 5, 7, 9, 10, 12],
    avarohana: 'Ṡ n D P m g R S',
    avarohanaDegrees: [12, 10, 9, 7, 5, 3, 2, 0],
    sargam: 'S R g m P D n',
    time: 'Midnight (Spring/Holi)',
    mood: 'Joyful, Passionate & Folk-Rooted'
  },
  {
    name: 'Bhimpalasi',
    thaat: 'Kafi',
    degrees: [0, 3, 5, 7, 10, 2, 9],
    aarohana: 'S g m P n Ṡ',
    aarohanaDegrees: [0, 3, 5, 7, 10, 12],
    avarohana: 'Ṡ n D P m g R S',
    avarohanaDegrees: [12, 10, 9, 7, 5, 3, 2, 0],
    sargam: 'S g m P n (R D in avroha)',
    time: 'Late Afternoon',
    mood: 'Tender, Poignant & Longing'
  },
  {
    name: 'Bageshri',
    thaat: 'Kafi',
    degrees: [0, 2, 3, 5, 9, 10],
    aarohana: 'S g m D n Ṡ',
    aarohanaDegrees: [0, 3, 5, 9, 10, 12],
    avarohana: 'Ṡ n D m g R S',
    avarohanaDegrees: [12, 10, 9, 5, 3, 2, 0],
    sargam: 'S R g m D n',
    time: 'Midnight',
    mood: 'Romantic, Introspective & Sweet'
  },
  {
    name: 'Brindavani Sarang',
    thaat: 'Kafi',
    degrees: [0, 2, 5, 7, 10, 11],
    aarohana: 'S R m P N Ṡ',
    aarohanaDegrees: [0, 2, 5, 7, 11, 12],
    avarohana: 'Ṡ n P m R S',
    avarohanaDegrees: [12, 10, 7, 5, 2, 0],
    sargam: 'S R m P N (n in avroha)',
    time: 'Afternoon',
    mood: 'Refreshing, Sunny & Sparkling'
  },
  {
    name: 'Asavari',
    thaat: 'Asavari',
    degrees: [0, 2, 3, 5, 7, 8, 10],
    aarohana: 'S R m P d Ṡ',
    aarohanaDegrees: [0, 2, 5, 7, 8, 12],
    avarohana: 'Ṡ n d P m g R S',
    avarohanaDegrees: [12, 10, 8, 7, 5, 3, 2, 0],
    sargam: 'S R g m P d n',
    time: 'Morning (2nd Prahar)',
    mood: 'Melancholic, Yearning & Tender'
  },
  {
    name: 'Darbari Kanada',
    thaat: 'Asavari',
    degrees: [0, 2, 3, 5, 7, 8, 10],
    aarohana: 'S R g m P d n Ṡ',
    aarohanaDegrees: [0, 2, 3, 5, 7, 8, 10, 12],
    avarohana: 'Ṡ d n P m P g m R S',
    avarohanaDegrees: [12, 8, 10, 7, 5, 7, 3, 5, 2, 0],
    sargam: 'S R g m P d n',
    time: 'Deep Midnight',
    mood: 'Majestic, Royal, Profound & Slow'
  },
  {
    name: 'Jaunpuri',
    thaat: 'Asavari',
    degrees: [0, 2, 3, 5, 7, 8, 10],
    aarohana: 'S R m P d n Ṡ',
    aarohanaDegrees: [0, 2, 5, 7, 8, 10, 12],
    avarohana: 'Ṡ n d P m g R S',
    avarohanaDegrees: [12, 10, 8, 7, 5, 3, 2, 0],
    sargam: 'S R g m P d n',
    time: 'Late Morning',
    mood: 'Plaintive, Expressive & Melodic'
  },
  {
    name: 'Bhairavi',
    thaat: 'Bhairavi',
    degrees: [0, 1, 3, 5, 7, 8, 10],
    aarohana: 'S r g m P d n Ṡ',
    aarohanaDegrees: [0, 1, 3, 5, 7, 8, 10, 12],
    avarohana: 'Ṡ n d P m g r S',
    avarohanaDegrees: [12, 10, 8, 7, 5, 3, 1, 0],
    sargam: 'S r g m P d n',
    time: 'Morning (Concert Finale / Anytime)',
    mood: 'Universal, Devotional & Cathartic'
  },
  {
    name: 'Malkauns',
    thaat: 'Bhairavi',
    degrees: [0, 3, 5, 8, 10],
    aarohana: 'S g m d n Ṡ',
    aarohanaDegrees: [0, 3, 5, 8, 10, 12],
    avarohana: 'Ṡ n d m g S',
    avarohanaDegrees: [12, 10, 8, 5, 3, 0],
    sargam: 'S g m d n',
    time: 'Late Night (3rd Prahar)',
    mood: 'Intense, Meditative & Hypnotic'
  },
  {
    name: 'Miyan Ki Todi',
    thaat: 'Todi',
    degrees: [0, 1, 3, 6, 7, 8, 11],
    aarohana: 'S r g M d N Ṡ',
    aarohanaDegrees: [0, 1, 3, 6, 8, 11, 12],
    avarohana: 'Ṡ N d P M g r S',
    avarohanaDegrees: [12, 11, 8, 7, 6, 3, 1, 0],
    sargam: 'S r g M P d N',
    time: 'Late Morning (2nd Prahar)',
    mood: 'Pathos, Devotion & Deep Meditation'
  },
  {
    name: 'Gurjari Todi',
    thaat: 'Todi',
    degrees: [0, 1, 3, 6, 8, 11],
    aarohana: 'S r g M d N Ṡ',
    aarohanaDegrees: [0, 1, 3, 6, 8, 11, 12],
    avarohana: 'Ṡ N d M g r S',
    avarohanaDegrees: [12, 11, 8, 6, 3, 1, 0],
    sargam: 'S r g M d N',
    time: 'Late Morning',
    mood: 'Deeply Moving & Melancholic'
  },
  {
    name: 'Poorvi',
    thaat: 'Poorvi',
    degrees: [0, 1, 4, 5, 6, 7, 8, 11],
    aarohana: 'S r G M P d N Ṡ',
    aarohanaDegrees: [0, 1, 4, 6, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P M G m G r S',
    avarohanaDegrees: [12, 11, 8, 7, 6, 4, 5, 4, 1, 0],
    sargam: 'S r G m M P d N',
    time: 'Sunset (Sandhiprakash)',
    mood: 'Twilight, Mysterious & Mystical'
  },
  {
    name: 'Puriya Dhanashree',
    thaat: 'Poorvi',
    degrees: [0, 1, 4, 6, 7, 8, 11],
    aarohana: 'S r G M P d N Ṡ',
    aarohanaDegrees: [0, 1, 4, 6, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P M G r S',
    avarohanaDegrees: [12, 11, 8, 7, 6, 4, 1, 0],
    sargam: 'S r G M P d N',
    time: 'Late Afternoon / Dusk',
    mood: 'Romantic, Serious & Poignant'
  },
  {
    name: 'Marwa',
    thaat: 'Marwa',
    degrees: [0, 1, 4, 6, 9, 11],
    aarohana: 'S r G M D N Ṡ',
    aarohanaDegrees: [0, 1, 4, 6, 9, 11, 12],
    avarohana: 'Ṡ N D M G r S',
    avarohanaDegrees: [12, 11, 9, 6, 4, 1, 0],
    sargam: 'S r G M D N',
    time: 'Sunset (Sandhiprakash)',
    mood: 'Anxious, Haunting, Yearning & Unique'
  },
  {
    name: 'Charukesi',
    thaat: 'Charukesi',
    degrees: [0, 2, 4, 5, 7, 8, 10],
    aarohana: 'S R G m P d n Ṡ',
    aarohanaDegrees: [0, 2, 4, 5, 7, 8, 10, 12],
    avarohana: 'Ṡ n d P m G R S',
    avarohanaDegrees: [12, 10, 8, 7, 5, 4, 2, 0],
    sargam: 'S R G m P d n',
    time: 'Anytime / Evening',
    mood: 'Emotional, Melting, Sweet & Soulful'
  },
  {
    name: 'Shivaranjani',
    thaat: 'Kafi',
    degrees: [0, 2, 3, 7, 9],
    aarohana: 'S R g P D Ṡ',
    aarohanaDegrees: [0, 2, 3, 7, 9, 12],
    avarohana: 'Ṡ D P g R S',
    avarohanaDegrees: [12, 9, 7, 3, 2, 0],
    sargam: 'S R g P D',
    time: 'Midnight / Anytime',
    mood: 'Tearful, Heartfelt, Romantic & Tragic'
  },
  {
    name: 'Kirwani',
    thaat: 'Kalyan / Melakarta',
    degrees: [0, 2, 3, 5, 7, 8, 11],
    aarohana: 'S R g m P d N Ṡ',
    aarohanaDegrees: [0, 2, 3, 5, 7, 8, 11, 12],
    avarohana: 'Ṡ N d P m g R S',
    avarohanaDegrees: [12, 11, 8, 7, 5, 3, 2, 0],
    sargam: 'S R g m P d N',
    time: 'Night (1st Prahar)',
    mood: 'Melancholic yet Elegant'
  },
  {
    name: 'Madhuvanti',
    thaat: 'Todi',
    degrees: [0, 2, 3, 6, 7, 9, 11],
    aarohana: 'S g M P N Ṡ',
    aarohanaDegrees: [0, 3, 6, 7, 11, 12],
    avarohana: 'Ṡ N D P M g R S',
    avarohanaDegrees: [12, 11, 9, 7, 6, 3, 2, 0],
    sargam: 'S R g M P D N',
    time: 'Late Afternoon / Dusk',
    mood: 'Sweet, Longing & Romantic'
  },
  {
    name: 'Jog',
    thaat: 'Kafi',
    degrees: [0, 3, 4, 5, 7, 10],
    aarohana: 'S G m P n Ṡ',
    aarohanaDegrees: [0, 4, 5, 7, 10, 12],
    avarohana: 'Ṡ n P m G m g S',
    avarohanaDegrees: [12, 10, 7, 5, 4, 5, 3, 0],
    sargam: 'S g G m P n',
    time: 'Late Night',
    mood: 'Enchanting, Intoxicating & Soulful'
  }
];

export function findMatchingRagas(chroma: Float64Array, tonicPc: number, topN = 6): RagaSuggestion[] {
  const scored = RAGA_DEFINITIONS.map((raga) => {
    const inScale = new Set(raga.degrees.map((d) => (tonicPc + d) % 12));
    let inside = 0;
    let outside = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      if (inScale.has(pc)) inside += chroma[pc];
      else outside += chroma[pc];
    }
    const total = inside + outside || 1;
    const coverage = inside / total;
    const score = Math.max(0, coverage - outside * 1.5);
    const matchPercent = Math.round(Math.min(99, Math.max(35, score * 100)));
    return {
      ...raga,
      score,
      matchPercent
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

const CAMELOT_MAJOR: Record<string, string> = {
  C: '8B', 'C#': '3B', D: '10B', 'D#': '5B', E: '12B', F: '7B',
  'F#': '2B', G: '9B', 'G#': '4B', A: '11B', 'A#': '6B', B: '1B'
};
const CAMELOT_MINOR: Record<string, string> = {
  C: '5A', 'C#': '12A', D: '7A', 'D#': '2A', E: '9A', F: '4A',
  'F#': '11A', G: '6A', 'G#': '1A', A: '8A', 'A#': '3A', B: '10A'
};

/**
 * Detects reference concert pitch (A4) between 420 Hz and 460 Hz.
 * Critical for Indian classical music (tanpura frequently at 430-435 Hz) and live instruments.
 */
function detectTuning(frames: Float32Array[], binHz: number): { a4: number; centsOffset: number } {
  if (frames.length === 0) return { a4: 440, centsOffset: 0 };

  const numBins = frames[0].length;
  const avgSpec = new Float32Array(numBins);
  for (const f of frames) {
    for (let b = 0; b < numBins; b += 1) {
      avgSpec[b] += f[b];
    }
  }

  // Harmonic spectrum range: 90 Hz to 1800 Hz
  const minBin = Math.max(1, Math.floor(90 / binHz));
  const maxBin = Math.min(numBins - 2, Math.floor(1800 / binHz));

  const peaks: { hz: number; mag: number }[] = [];
  for (let b = minBin; b <= maxBin; b += 1) {
    if (avgSpec[b] > avgSpec[b - 1] && avgSpec[b] > avgSpec[b + 1]) {
      const s0 = avgSpec[b - 1];
      const s1 = avgSpec[b];
      const s2 = avgSpec[b + 1];
      const denom = s0 - 2 * s1 + s2;
      const delta = denom !== 0 ? 0.5 * (s0 - s2) / denom : 0;
      const peakHz = (b + delta) * binHz;
      peaks.push({ hz: peakHz, mag: s1 });
    }
  }

  if (peaks.length < 3) return { a4: 440, centsOffset: 0 };

  peaks.sort((a, b) => b.mag - a.mag);
  const topPeaks = peaks.slice(0, 48);

  let bestA4 = 440;
  let bestScore = -Infinity;

  // Search range: 428 Hz to 452 Hz (+/- 45 cents around 440 Hz) with gentle prior to prevent semitone aliasing
  for (let a4 = 428; a4 <= 452; a4 += 0.5) {
    let score = 0;
    for (const p of topPeaks) {
      const midiF = 69 + 12 * Math.log2(p.hz / a4);
      const nearestMidi = Math.round(midiF);
      const semitoneDist = Math.abs(midiF - nearestMidi);
      if (semitoneDist < 0.25) {
        const w = Math.cos(semitoneDist * Math.PI * 2);
        score += w * p.mag;
      }
    }
    const prior = 1 - 0.15 * Math.pow((a4 - 440) / 15, 2);
    score *= prior;
    if (score > bestScore) {
      bestScore = score;
      bestA4 = a4;
    }
  }

  const roundedA4 = Math.round(bestA4 * 10) / 10;
  const cents = Math.round(1200 * Math.log2(roundedA4 / 440) * 10) / 10;
  return { a4: roundedA4, centsOffset: cents };
}

/**
 * Constant-Q Chroma extractor aware of concert pitch A4 reference.
 */
function chromaFromSpectrum(
  magnitudes: Float32Array | Float64Array,
  binHz: number,
  options: { a4?: number; lowMidi?: number; highMidi?: number } = {}
) {
  const a4 = options.a4 || 440;
  const lowNote = options.lowMidi || 33; // A1 (~55 Hz)
  const highNote = options.highMidi || 96; // C7 (~2093 Hz)
  const chroma = new Float64Array(12);

  for (let midi = lowNote; midi <= highNote; midi += 1) {
    const centre = a4 * Math.pow(2, (midi - 69) / 12);
    const lower = centre * Math.pow(2, -0.5 / 12);
    const upper = centre * Math.pow(2, 0.5 / 12);

    const from = Math.max(1, Math.floor(lower / binHz));
    const to = Math.min(magnitudes.length - 1, Math.ceil(upper / binHz));
    if (to < from) continue;

    let energy = 0;
    for (let bin = from; bin <= to; bin += 1) energy += magnitudes[bin];

    // Low and mid notes (melodic range and drone fundamentals) have highest pitch clarity
    const weight = midi < 45 ? 1.25 : midi < 70 ? 1.1 : midi < 82 ? 0.7 : 0.2;
    chroma[((midi % 12) + 12) % 12] += energy * weight;
  }

  return normalise(chroma);
}

function detectDroneAndBass(frames: Float32Array[], binHz: number, a4 = 440) {
  const bassPersistence = new Float64Array(12);
  const bassEnergy = new Float64Array(12);

  for (const frame of frames) {
    const bassC = chromaFromSpectrum(frame, binHz, { a4, lowMidi: 33, highMidi: 57 });
    for (let pc = 0; pc < 12; pc += 1) {
      bassEnergy[pc] += bassC[pc];
      if (bassC[pc] > 0.12) {
        bassPersistence[pc] += 1;
      }
    }
  }

  const total = frames.length || 1;
  for (let pc = 0; pc < 12; pc += 1) {
    bassPersistence[pc] /= total;
    bassEnergy[pc] /= total;
  }

  return { bassPersistence, bassEnergy: normalise(bassEnergy) };
}

function suppressHarmonics(chroma: Float64Array, strength = 0.25): Float64Array {
  const out = Float64Array.from(chroma);
  const harmonics = [
    { interval: 7, weight: 0.7 },
    { interval: 4, weight: 0.2 },
    { interval: 10, weight: 0.15 },
    { interval: 6, weight: 0.18 }
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

function findTonic(
  averageChroma: Float64Array,
  frameChromas?: Float64Array[],
  droneData?: { bassPersistence: Float64Array; bassEnergy: Float64Array }
) {
  const stability = new Float64Array(12);

  if (frameChromas && frameChromas.length > 0) {
    for (const frame of frameChromas) {
      const ranked = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => frame[b] - frame[a]);
      stability[ranked[0]] += 1;
      stability[ranked[1]] += 0.5;
      stability[ranked[2]] += 0.25;
    }
    const total = frameChromas.length;
    for (let i = 0; i < 12; i += 1) stability[i] /= total;
  } else {
    for (let i = 0; i < 12; i += 1) stability[i] = averageChroma[i];
  }

  const scored: { pc: number; note: string; score: number; presence: number; stability: number }[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    const fifth = averageChroma[(pc + 7) % 12];
    const fourth = averageChroma[(pc + 5) % 12];

    let droneBoost = 0;
    if (droneData) {
      const saPersistence = droneData.bassPersistence[pc];
      const paPersistence = droneData.bassPersistence[(pc + 7) % 12];
      const maPersistence = droneData.bassPersistence[(pc + 5) % 12];
      const bassSa = droneData.bassEnergy[pc];

      droneBoost = saPersistence * 1.4 + paPersistence * 0.7 + maPersistence * 0.3 + bassSa * 1.1;
    }

    const score =
      averageChroma[pc] * 1.0 +
      stability[pc] * 1.2 +
      fifth * 0.85 +
      fourth * 0.25 +
      droneBoost -
      averageChroma[(pc + 1) % 12] * 0.25 -
      averageChroma[(pc + 11) % 12] * 0.25;

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

function findScale(chroma: Float64Array, tonicPc: number) {
  const results: { name: string; coverage: number; score: number; degrees: number[] }[] = [];

  for (const [name, degrees] of Object.entries(SCALES)) {
    const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

    let inside = 0;
    let outside = 0;

    for (let pc = 0; pc < 12; pc += 1) {
      if (inScale.has(pc)) {
        inside += chroma[pc];
      } else {
        outside += chroma[pc];
      }
    }

    const total = inside + outside;
    const coverage = total > 0 ? inside / total : 0;

    // Penalty for notes outside the scale
    const outsidePenalty = outside * 1.5;

    // Tie-break priority for standard canonical major and minor
    const standardBonus = (name === 'minor' || name === 'major') ? 0.02 : 0;

    const score = Math.max(0, coverage - outsidePenalty + standardBonus);
    results.push({ name, coverage, score, degrees });
  }

  results.sort((a, b) => b.score - a.score);

  const best = results[0];
  const second = results[1] || best;
  const margin = best.score > 0 ? (best.score - second.score) / best.score : 0;

  return {
    scale: best.name,
    coverage: best.coverage,
    confidence: Math.max(0, Math.min(1, margin * 8)),
    alternatives: results.slice(1, 4).map((r) => r.name),
    degrees: best.degrees
  };
}

function krumhansl(chroma: Float64Array) {
  let best = { score: -Infinity, tonic: NOTES[0], mode: 'maj' };
  for (let root = 0; root < 12; root += 1) {
    for (const [mode, profile] of [['maj', MAJOR] as const, ['min', MINOR] as const]) {
      const score = correlate(chroma, rotate(profile, root));
      if (score > best.score) best = { score, tonic: NOTES[root], mode };
    }
  }
  return best;
}

function detectKey(frames: Float32Array[], binHz: number, options: any = {}) {
  if (frames.length === 0) {
    return {
      key: null,
      note: null,
      mode: null,
      camelot: null,
      confidence: 0,
      alternate: null,
      tonic: null,
      tonicPc: 0,
      tonicConfidence: 0,
      scale: null,
      scaleConfidence: 0,
      modal: false,
      degrees: [],
      tuningA4: 440,
      tuningCents: 0,
      thaat: null
    };
  }

  // 1. Detect dynamic concert pitch (A4 = 420..460 Hz)
  const tuning = detectTuning(frames, binHz);
  const a4 = tuning.a4;

  // 2. Extract tuning-aligned frame chromas & drone fundamentals
  const droneData = detectDroneAndBass(frames, binHz, a4);
  const frameChromas: Float64Array[] = [];
  const avgChroma = new Float64Array(12);

  for (const frame of frames) {
    const c = chromaFromSpectrum(frame, binHz, { a4 });
    frameChromas.push(c);
    for (let i = 0; i < 12; i += 1) avgChroma[i] += c[i];
  }

  const count = frameChromas.length;
  for (let i = 0; i < 12; i += 1) avgChroma[i] /= count;
  const averageChroma = normalise(avgChroma);

  const clean = options.suppressHarmonics === false
    ? averageChroma
    : suppressHarmonics(averageChroma);

  const tonicResult = findTonic(clean, frameChromas, droneData);
  const scaleResult = findScale(clean, tonicResult.tonicPc);

  // Krumhansl correlation
  const profile = krumhansl(clean);
  const agrees = profile.tonic === tonicResult.tonic;

  // Western Major / Minor resolution via profile score & tonic agreement
  const isWesternMajor = agrees && profile.mode === 'maj' && profile.score > 0.45;
  const isWesternMinor = agrees && profile.mode === 'min' && profile.score > 0.45;

  let finalScale = scaleResult.scale;
  if (isWesternMajor && !['major', 'lydian', 'mixolydian'].includes(finalScale)) {
    finalScale = 'major';
  } else if (isWesternMinor && !['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor'].includes(finalScale)) {
    finalScale = 'minor';
  }

  const finalDegrees = SCALES[finalScale] || scaleResult.degrees;
  const isModal = ['bhairav', 'todi', 'marwa', 'poorvi', 'charukesi', 'shivaranjani', 'malkauns'].includes(finalScale);

  const isMajorMode = isWesternMajor || finalScale === 'major' || ['lydian', 'mixolydian'].includes(finalScale);

  const keyString = !isModal
    ? `${tonicResult.tonic} ${isMajorMode ? 'maj' : 'min'}`
    : null;
  const camelotCode = !isModal
    ? (isMajorMode ? CAMELOT_MAJOR : CAMELOT_MINOR)[tonicResult.tonic]
    : null;

  return {
    key: keyString,
    note: tonicResult.tonic,
    mode: !isModal ? (isWesternMajor || finalScale === 'major' ? 'maj' : 'min') : null,
    camelot: camelotCode,
    confidence: agrees
      ? Math.min(1, tonicResult.confidence + 0.2)
      : tonicResult.confidence,
    alternate: tonicResult.runnerUp,

    tonic: tonicResult.tonic,
    tonicPc: tonicResult.tonicPc,
    tonicConfidence: agrees
      ? Math.min(1, tonicResult.confidence + 0.2)
      : tonicResult.confidence,
    tonicAlternative: tonicResult.runnerUp,

    scale: finalScale,
    scaleConfidence: scaleResult.confidence,
    scaleAlternatives: scaleResult.alternatives,
    degrees: finalDegrees,

    modal: isModal,
    tuningA4: tuning.a4,
    tuningCents: tuning.centsOffset,
    thaat: THAAT_MAP[finalScale] || null,
    ragas: findMatchingRagas(clean, tonicResult.tonicPc),
    profileSays: `${profile.tonic} ${profile.mode}`,
    profileAgrees: agrees,
    ranked: tonicResult.ranked
  };
}

function rotate(profile: number[], by: number): Float64Array {
  const out = new Float64Array(12);
  for (let i = 0; i < 12; i += 1) out[i] = profile[(i - by + 12) % 12];
  return out;
}

function correlate(a: Float64Array, b: Float64Array): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= 12;
  meanB /= 12;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < 12; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function normalise(values: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  if (sum === 0) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / sum;
  return out;
}

/* ==================================================================
   5. The one function the UI calls
   ================================================================== */

function analyse(channelData: Float32Array | Float64Array, sampleRate: number, onProgress?: (p: number) => void) {
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
    tonic: key.tonic,
    tonicConfidence: key.tonicConfidence,
    scale: key.scale,
    scaleConfidence: key.scaleConfidence,
    modal: key.modal,
    tuningA4: key.tuningA4,
    tuningCents: key.tuningCents,
    thaat: key.thaat,
    ragas: key.ragas,
    analysedSeconds: Math.round(wanted / sampleRate)
  };
}

export const DSP = {
  analyse,
  detectKey,
  detectTempo,
  detectTuning,
  detectDroneAndBass,
  fftMagnitudes,
  chromaFromSpectrum,
  suppressHarmonics,
  findTonic,
  findScale,
  findMatchingRagas,
  krumhansl,
  NOTES,
  SCALES,
  THAAT_MAP,
  RAGA_DEFINITIONS,
  RECOMMENDED_FFT
};
