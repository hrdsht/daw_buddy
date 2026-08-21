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

export interface TalaSuggestion {
  timeSignature: string;
  name: string;
  matras: number;
  vibhag: string;
  bols: string;
  description: string;
}

export const TALA_MAP: Record<string, TalaSuggestion> = {
  '4/4': {
    timeSignature: '4/4',
    name: 'Teental / Keherwa / Adi Tala',
    matras: 16,
    vibhag: '4+4+4+4 (or 4+4 Keherwa)',
    bols: 'Dha Dhin Dhin Dha | Dha Dhin Dhin Dha | Dha Tin Tin Ta | Ta Dhin Dhin Dha',
    description: 'Most versatile 4-beat cycle (Keherwa 8 matras, Teental 16 matras, Carnatic Adi Tala)'
  },
  '3/4': {
    timeSignature: '3/4',
    name: 'Dadra / Rupak (3-pulse)',
    matras: 6,
    vibhag: '3+3',
    bols: 'Dha Dhi Na | Dha Tu Na',
    description: '6 matras divided in 2 vibhags of 3, light classical, Ghazals and folk waltz rhythms'
  },
  '6/8': {
    timeSignature: '6/8',
    name: 'Dadra (Compound) / Khemta / Garba',
    matras: 6,
    vibhag: '3+3 (Dotted Duple)',
    bols: 'Dha Ge Na | Dha Ti Na',
    description: 'Compound 6-pulse, energetic folk dances (Garba, Lavani, Qawwali) and swinging Dadra'
  },
  '7/8': {
    timeSignature: '7/8',
    name: 'Rupak / Mishra Chapu',
    matras: 7,
    vibhag: '3+2+2 (or 3+4)',
    bols: 'Tin Tin Na | Dhi Na | Dhi Na',
    description: '7 matras beginning on Khali (Tin), Carnatic Mishra Chapu (3+4) and Hindustani Rupak'
  },
  '7/4': {
    timeSignature: '7/4',
    name: 'Teevra / Roopak Vilambit',
    matras: 7,
    vibhag: '3+2+2',
    bols: 'Dha Din Ta | Tite Kata | Gadi Gana',
    description: 'Classical 7-beat rhythm with open resonant pakhawaj/tabla strokes'
  },
  '5/8': {
    timeSignature: '5/8',
    name: 'Khanda Chapu / Half-Jhaptal',
    matras: 5,
    vibhag: '2+3',
    bols: 'Ta Ka | Ta Ki Ta',
    description: 'Fast 5-pulse syncopation popular in Carnatic fusion and modern Indian indie'
  },
  '5/4': {
    timeSignature: '5/4',
    name: 'Jhaptal',
    matras: 10,
    vibhag: '2+3+2+3',
    bols: 'Dhi Na | Dhi Dhi Na | Ti Na | Dhi Dhi Na',
    description: '10 matras in 4 divisions, meditative and majestic classical cadence'
  },
  '12/8': {
    timeSignature: '12/8',
    name: 'Ektaal / Chautaal',
    matras: 12,
    vibhag: '2+2+2+2+2+2',
    bols: 'Dhin Dhin | DhaGe Tirakita | Tu Na | Kat Ta | DhaGe Tirakita | Dhi Na',
    description: '12 matras, standard for classical Khayal and Dhrupad compositions'
  }
};

export interface MeterResult {
  timeSignature: string;
  confidence: number;
  tala: TalaSuggestion;
}

export function detectMeter(
  envelope: Float32Array | null | undefined,
  beatLag: number,
  hopSeconds: number
): MeterResult {
  if (!envelope || envelope.length < 64 || beatLag <= 0) {
    return {
      timeSignature: '4/4',
      confidence: 0,
      tala: TALA_MAP['4/4']
    };
  }

  function scoreLag(lag: number): number {
    const iLag = Math.round(lag);
    if (iLag <= 0 || iLag >= envelope!.length - 1) return 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i + iLag < envelope!.length; i += 1) {
      sum += envelope![i] * envelope![i + iLag];
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  const s2 = scoreLag(beatLag * 2);
  const s3 = scoreLag(beatLag * 3);
  const s4 = scoreLag(beatLag * 4);
  const s5 = scoreLag(beatLag * 2.5); // 5/8 or 5-pulse sub-beats
  const s5_4 = scoreLag(beatLag * 5); // 5/4
  const s6 = scoreLag(beatLag * 3);   // 6/8 dotted or 6-pulse
  const s7 = scoreLag(beatLag * 3.5); // 7/8
  const s7_4 = scoreLag(beatLag * 7); // 7/4
  const s12 = scoreLag(beatLag * 6);  // 12/8

  // Calculate comparative weights - prefer fundamental subdivisions
  const meterScores: Array<{ sig: string; score: number }> = [
    { sig: '4/4', score: s4 * 1.15 + s2 * 0.5 },
    { sig: '3/4', score: s3 * 1.2 },
    { sig: '6/8', score: s6 * 1.1 + scoreLag(beatLag * 1.5) * 0.6 },
    { sig: '7/8', score: s7 * 1.4 + scoreLag(beatLag * 1.75) * 0.5 },
    { sig: '7/4', score: s7_4 * 0.9 },
    { sig: '5/8', score: s5 * 1.4 + scoreLag(beatLag * 1.25) * 0.5 },
    { sig: '5/4', score: s5_4 * 0.9 },
    { sig: '12/8', score: s12 * 1.1 }
  ];

  meterScores.sort((a, b) => b.score - a.score);

  const best = meterScores[0];
  const second = meterScores[1];

  let confidence = 0.5;
  if (best.score > 0) {
    confidence = Math.min(1, Math.max(0.1, (best.score - (second ? second.score * 0.75 : 0)) / (best.score || 1)));
  }

  const chosenSig = best && best.score > 0 ? best.sig : '4/4';
  const tala = TALA_MAP[chosenSig] || TALA_MAP['4/4'];

  return {
    timeSignature: chosenSig,
    confidence: Math.round(confidence * 100) / 100,
    tala
  };
}

function detectTempo(frames: Float32Array[], hopSeconds: number) {
  if (frames.length < 32) return { bpm: null, confidence: 0, beatLag: 0, envelope: null };

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

  if (!best.lag) return { bpm: null, confidence: 0, beatLag: 0, envelope };

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

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    beatLag: exactLag,
    envelope
  };
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
  blues: [0, 3, 5, 6, 7, 10],
  // Arabic / Egyptian
  maqam_hijaz: [0, 1, 4, 5, 7, 8, 10],
  maqam_bayati: [0, 1, 3, 5, 7, 8, 10],
  maqam_kurd: [0, 1, 3, 5, 7, 8, 10],
  maqam_nahawand: [0, 2, 3, 5, 7, 8, 11],
  maqam_rast: [0, 2, 4, 5, 7, 9, 10],
  egyptian_suspended: [0, 2, 5, 7, 10],
  double_harmonic_arabic: [0, 1, 4, 5, 7, 8, 11],
  // Chinese & East Asian
  gong_diao: [0, 2, 4, 7, 9],
  shang_diao: [0, 2, 5, 7, 10],
  jiao_diao: [0, 3, 5, 8, 10],
  zhi_diao: [0, 2, 5, 7, 9],
  yu_diao: [0, 3, 5, 7, 10],
  hirajoshi_japan: [0, 2, 3, 7, 8],
  insen_japan: [0, 1, 5, 7, 10],
  // Mediterranean & Latin
  flamenco_mode: [0, 1, 4, 5, 7, 8, 10],
  hungarian_gypsy_minor: [0, 2, 3, 6, 7, 8, 11],
  // Celtic
  celtic_pentatonic: [0, 2, 4, 7, 9]
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
  bhupali: 'Bhoop / Bhupali',
  maqam_hijaz: 'Hijaz (Maqam)',
  maqam_bayati: 'Bayati (Maqam)',
  maqam_kurd: 'Kurd (Maqam)',
  maqam_nahawand: 'Nahawand (Maqam)',
  maqam_rast: 'Rast (Maqam)',
  egyptian_suspended: 'Egyptian Pentatonic',
  double_harmonic_arabic: 'Hijaz Kar (Double Harmonic)',
  gong_diao: 'Gong 宫 (Palace Mode)',
  shang_diao: 'Shang 商 (Merchant Mode)',
  jiao_diao: 'Jiao 角 (Horn Mode)',
  zhi_diao: 'Zhi 徵 (Feather Mode)',
  yu_diao: 'Yu 羽 (Wings Mode)',
  hirajoshi_japan: 'Hirajōshi (Koto)',
  insen_japan: 'Insen (Shakuhachi)',
  flamenco_mode: 'Modo Flamenco',
  hungarian_gypsy_minor: 'Gypsy Minor',
  celtic_pentatonic: 'Gaelic Folk'
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
  suggestedTimeSig?: string;
  suggestedTaal?: string;
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
  suggestedTimeSig?: string;
  suggestedTaal?: string;
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
    mood: 'Devotional, Majestic & Serene',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental (16 matras) / Ektaal (12/8)'
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
    mood: 'Peaceful, Divine & Uplifting',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental (4/4) / Roopak (7/8)'
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
    mood: 'Meditative, Renunciant & Pure',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Jhaptal (5/4)'
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
    mood: 'Light, Melodic & Devotional',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Keherwa (4/4)'
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
    mood: 'Soothing & Contemplative',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Keherwa'
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
    mood: 'Romantic, Graceful & Blissful',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental (16 matras) / Roopak (7/8)'
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
    mood: 'Grand, Peaceful & Soothing',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Keherwa'
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
    mood: 'Serene & Stately',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Jhaptal (5/4)'
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
    mood: 'Romantic, Expressive & Longing',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Ektaal (12/8)'
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
    mood: 'Auspicious, Radiant & Joyous',
    suggestedTimeSig: '7/8',
    suggestedTaal: 'Rupak / Mishra Chapu (7/8) / Keherwa'
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
    mood: 'Cheerful, Fresh & Vibrant',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental (4/4) / Ektaal (12/8)'
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
    mood: 'Sensuous, Playful & Expressive',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Keherwa (4/4)'
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
    mood: 'Patriotic, Romantic & Sweet',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Rupak (7/8)'
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
    mood: 'Romantic, Deep & Tender',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Jhaptal (5/4)'
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
    mood: 'Joyful, Passionate & Folk-Rooted',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Keherwa (4/4) / Dhamar'
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
    mood: 'Tender, Poignant & Longing',
    suggestedTimeSig: '5/4',
    suggestedTaal: 'Jhaptal (10 matras, 5/4) / Teental'
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
    mood: 'Romantic, Introspective & Sweet',
    suggestedTimeSig: '5/4',
    suggestedTaal: 'Jhaptal (5/4) / Teental (4/4)'
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
    mood: 'Refreshing, Sunny & Sparkling',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Keherwa / Teental / Ektaal'
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
    mood: 'Melancholic, Yearning & Tender',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Roopak (7/8)'
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
    mood: 'Majestic, Royal, Profound & Slow',
    suggestedTimeSig: '12/8',
    suggestedTaal: 'Ektaal (12 matras, 12/8) / Teental Vilambit'
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
    mood: 'Plaintive, Expressive & Melodic',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Roopak (7/8)'
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
    mood: 'Universal, Devotional & Cathartic',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Keherwa (4/4) / Deepchandi (7/4)'
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
    mood: 'Intense, Meditative & Hypnotic',
    suggestedTimeSig: '5/4',
    suggestedTaal: 'Jhaptal (10 matras, 5/4) / Teental'
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
    mood: 'Pathos, Devotion & Deep Meditation',
    suggestedTimeSig: '12/8',
    suggestedTaal: 'Ektaal (12/8) / Jhaptal (5/4)'
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
    mood: 'Deeply Moving & Melancholic',
    suggestedTimeSig: '12/8',
    suggestedTaal: 'Ektaal (12/8) / Teental'
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
    mood: 'Twilight, Mysterious & Mystical',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Roopak (7/8)'
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
    mood: 'Romantic, Serious & Poignant',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental / Roopak (7/8)'
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
    mood: 'Anxious, Haunting, Yearning & Unique',
    suggestedTimeSig: '5/4',
    suggestedTaal: 'Jhaptal (5/4) / Teental'
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
    mood: 'Emotional, Melting, Sweet & Soulful',
    suggestedTimeSig: '7/8',
    suggestedTaal: 'Mishra Chapu / Rupak (7/8) / Keherwa (4/4)'
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
    mood: 'Tearful, Heartfelt, Romantic & Tragic',
    suggestedTimeSig: '6/8',
    suggestedTaal: 'Dadra (6/8) / Keherwa (4/4)'
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
    mood: 'Melancholic yet Elegant',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Keherwa (4/4) / Dadra (6/8) / Rupak (7/8)'
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
    mood: 'Sweet, Longing & Romantic',
    suggestedTimeSig: '4/4',
    suggestedTaal: 'Teental (4/4) / Jhaptal (5/4)'
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
    mood: 'Enchanting, Intoxicating & Soulful',
    suggestedTimeSig: '5/4',
    suggestedTaal: 'Jhaptal (5/4) / Teental (4/4)'
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
  const meter = detectMeter(tempo.envelope, tempo.beatLag, hopSeconds);
  const key = detectKey(frames, binHz);

  return {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    timeSignature: meter.timeSignature,
    meterConfidence: meter.confidence,
    tala: meter.tala,
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

export interface GenreDefinition {
  id: string;
  name: string;
  category: 'Botanica & Organic' | 'Bollywood & Indian' | 'Afro & Latin' | 'House' | 'Dubstep & Bass' | 'Drum & Bass' | 'Hip Hop & Urban' | 'Techno & Trance' | 'Electronic & Experimental';
  typicalBpm: [number, number];
  description: string;
}

export const GENRE_DATABASE: GenreDefinition[] = [
  // Botanica & Organic
  { id: 'botanica', name: 'Botanica', category: 'Botanica & Organic', typicalBpm: [116, 122], description: 'Lush organic house with forest foley, wooden percussion, soothing bamboo flutes, and deep earthly grooves.' },
  { id: 'organic-house', name: 'Organic House / Downtempo', category: 'Botanica & Organic', typicalBpm: [112, 120], description: 'Warm analog pads, ethnic acoustic strings, gentle 4/4 shakers, and meditative melodic soundscapes.' },
  { id: 'folktronica', name: 'Folktronica', category: 'Botanica & Organic', typicalBpm: [110, 124], description: 'Fusion of acoustic folk instrumentation (acoustic guitar, violin, kalimba) with electronic beats and micro-edits.' },
  { id: 'ethno-deep-house', name: 'Ethno Deep House', category: 'Botanica & Organic', typicalBpm: [118, 123], description: 'Middle Eastern and South Asian microtonal vocal samples, framed drums, and deep atmospheric desert house grooves.' },
  { id: 'trip-hop', name: 'Trip Hop / Downtempo', category: 'Botanica & Organic', typicalBpm: [75, 90], description: 'Heavy downtempo hip hop breakbeats, dark smoky jazz samples, and melancholic cinematic ambience.' },
  { id: 'ambient-chill', name: 'Ambient & Chillout', category: 'Botanica & Organic', typicalBpm: [60, 90], description: 'Immersive soundscapes, textural drones, slow-evolving harmony, and zero rigid percussion.' },

  // Bollywood & Indian
  { id: 'bollywood-dance', name: 'Bollywood Dance / Item Song', category: 'Bollywood & Indian', typicalBpm: [128, 135], description: 'High-energy club beats with live dholak, tabla tarang, bright brass stabs, and catchy commercial vocal hooks.' },
  { id: 'bollywood-romantic', name: 'Bollywood Romantic / Filmi Pop', category: 'Bollywood & Indian', typicalBpm: [75, 90], description: 'Emotive acoustic guitars, bansuri melodies, lush string sections, and heartfelt playback vocal style.' },
  { id: 'desi-hiphop', name: 'Desi Hip Hop / Gully Rap', category: 'Bollywood & Indian', typicalBpm: [85, 140], description: 'Raw street beats, South Asian boom bap, hard-hitting 808s, and authentic Hindi/Urdu/Punjabi flows.' },
  { id: 'punjabi-pop', name: 'Punjabi Pop / Bhangra', category: 'Bollywood & Indian', typicalBpm: [95, 105], description: 'Pounding Punjabi dhol, syncopated tumbi riffs, bright algoze, and infectious festive swing.' },
  { id: 'bolly-trap', name: 'Bolly-Trap / Desi Bass', category: 'Bollywood & Indian', typicalBpm: [130, 150], description: 'Heavy modern 808 slides, shehnai/sitar leads, trap rolling hats, and massive festival drops.' },
  { id: 'sufi-rock', name: 'Sufi Rock & Pop', category: 'Bollywood & Indian', typicalBpm: [90, 120], description: 'Passionate spiritual lyrics, roaring electric guitars, driving harmonium, and intense dholak accompaniment.' },
  { id: 'qawwali-fusion', name: 'Qawwali Fusion', category: 'Bollywood & Indian', typicalBpm: [80, 130], description: 'Hypnotic harmonium ostinatos, hand-clapping choruses, tabla syncopation, and ecstatic vocal climaxes.' },
  { id: 'south-kuthu', name: 'South Indian Kuthu / Dappankuthu', category: 'Bollywood & Indian', typicalBpm: [130, 145], description: 'Frenetic 6/8 or fast 4/4 dappu & thavil beats, roaring nadaswaram leads, and unstoppable street energy.' },
  { id: 'classic-bollywood', name: 'Classic Bollywood / Retro Filmi', category: 'Bollywood & Indian', typicalBpm: [100, 125], description: '70s/80s analog warmth, RD Burman brass riffs, live orchestral strings, and vintage rhythm sections.' },
  { id: 'bollywood-ghazal', name: 'Bollywood Ghazal & Semi-Classical', category: 'Bollywood & Indian', typicalBpm: [65, 85], description: 'Subtle sarangi/sitar nuances, classical alaap, slow keherwa or dadra tabla, and deep poetic longing.' },

  // Afro & Latin
  { id: 'afro-house', name: 'Afro House', category: 'Afro & Latin', typicalBpm: [120, 125], description: 'Hypnotic syncopated tribal percussion, deep basslines, and soulful vocal/synth layers.' },
  { id: 'afrobeat', name: 'Afrobeat / Afrobeats', category: 'Afro & Latin', typicalBpm: [98, 108], description: 'West African rhythms, bouncy log drums or syncopated kicks, and interlocking guitar riffs.' },
  { id: 'amapiano', name: 'Amapiano', category: 'Afro & Latin', typicalBpm: [112, 116], description: 'South African deep house with airy pads, wide log drum basslines, and lounge keys.' },
  { id: 'afro-tech', name: 'Afro Tech', category: 'Afro & Latin', typicalBpm: [122, 126], description: 'Futuristic electronic synths layered with sharp tribal African percussion and dark rolling baselines.' },
  { id: 'reggaeton', name: 'Reggaeton', category: 'Afro & Latin', typicalBpm: [88, 98], description: 'Iconic Dembow rhythm (boom-ch-boom-chick), punchy 808s, and Latin dance flow.' },
  { id: 'reggae', name: 'Reggae', category: 'Afro & Latin', typicalBpm: [70, 85], description: 'Offbeat stabs (skank), deep warm basslines, and relaxed one-drop grooves.' },
  { id: 'dancehall', name: 'Dancehall', category: 'Afro & Latin', typicalBpm: [95, 110], description: 'Fast-paced digital Caribbean riddims with sharp snares, syncopated claps, and energetic flow.' },
  { id: 'baile-funk', name: 'Baile Funk', category: 'Afro & Latin', typicalBpm: [130, 135], description: 'Brazilian Rio favela beat with raw aggressive percussion and call-and-response vocal chops.' },
  { id: 'moombahton', name: 'Moombahton', category: 'Afro & Latin', typicalBpm: [108, 112], description: 'Fusion of electro house build-ups and Dutch house synths over a swinging half-time reggaeton Dembow rhythm.' },

  // House
  { id: 'deep-house', name: 'Deep House', category: 'House', typicalBpm: [120, 125], description: 'Soulful minor 7th/9th chords, warm sub-bass, smooth 4/4 kicks, and lush atmosphere.' },
  { id: 'tech-house', name: 'Tech House', category: 'House', typicalBpm: [124, 128], description: 'Driving groovy rolling basslines, punchy percussive claps, and minimal hypnotic hooks.' },
  { id: 'progressive-house', name: 'Progressive House', category: 'House', typicalBpm: [124, 128], description: 'Evolving melodic structures, emotional atmospheric breakdowns, and driving festival energy.' },
  { id: 'melodic-house', name: 'Melodic House / Techno', category: 'House', typicalBpm: [122, 126], description: 'Deep emotive synth arpeggios, hypnotic basslines, and melancholic chord progressions.' },
  { id: 'bass-house', name: 'Bass House', category: 'House', typicalBpm: [126, 128], description: 'Heavy aggressive FM growls, wobbly metallic basslines, and four-on-the-floor energy.' },
  { id: 'electro-house', name: 'Electro House', category: 'House', typicalBpm: [128, 130], description: 'Buzzing distorted synth leads, dirty prominent bass riffs, and high-octane drops.' },
  { id: 'future-house', name: 'Future House', category: 'House', typicalBpm: [126, 128], description: 'Metallic muted brass/bass stabs, bouncy swing groove, and energetic club drops.' },
  { id: 'french-house', name: 'French House / Nu-Disco', category: 'House', typicalBpm: [118, 124], description: 'Filtered funk/disco sample loops, phaser sweeps, and grooving slap basslines.' },
  { id: 'acid-house', name: 'Acid House', category: 'House', typicalBpm: [124, 130], description: 'Squelchy resonant TB-303 basslines, sharp 909 hi-hats, and hypnotic repetition.' },
  { id: 'uk-garage', name: 'UK Garage / 2-Step', category: 'House', typicalBpm: [130, 136], description: 'Skippy syncopated swing beats, chopped time-stretched vocal samples, and subby organ bass.' },
  { id: 'speed-garage', name: 'Speed Garage / Bassline', category: 'House', typicalBpm: [136, 142], description: 'Warped heavy 4/4 bass drops, skippy 2-step percussion, and 90s time-stretched vocal chops.' },

  // Dubstep & Bass
  { id: 'dubstep', name: 'Dubstep', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Half-time 140 BPM groove with devastating sub bass, screeching wavetable growls, and heavy impact.' },
  { id: 'riddim', name: 'Riddim', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Repetitive minimalist percussive synth chops, swinging triplet groove, and heavy sub pressure.' },
  { id: 'colour-bass', name: 'Colour Bass / Future Riddim', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Harmonic vocoded bass leads, pitch-tracked resonant chords, and melodic, vibrant textures.' },
  { id: 'melodic-dubstep', name: 'Melodic Dubstep', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Emotional supersaw chords, lush piano intros, vocal chops, and powerful anthemic drops.' },
  { id: 'brostep', name: 'Brostep', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Aggressive screeching mid-range growls, metallic tearout synths, and relentless energetic flow.' },
  { id: 'tearout', name: 'Tearout Dubstep', category: 'Dubstep & Bass', typicalBpm: [140, 150], description: 'Relentless distorted machine-gun synth shots, heavy sustained sub, and chaotic aggression.' },
  { id: 'deep-dubstep', name: 'Deep Dubstep / 140', category: 'Dubstep & Bass', typicalBpm: [140, 142], description: 'Dark cavernous reverbs, chest-rattling 40Hz sub-bass, and organic space percussion.' },
  { id: 'future-bass', name: 'Future Bass', category: 'Dubstep & Bass', typicalBpm: [130, 160], description: 'Detuned sidechained supersaw chords, cute vocal chops, pitch-bent 808s, and lush textures.' },
  { id: 'midtempo', name: 'Midtempo Bass', category: 'Dubstep & Bass', typicalBpm: [100, 110], description: 'Dark cyberpunk mechanical crunch, 100 BPM half-time stomp, and distorted glitchy leads.' },
  { id: 'glitch-hop', name: 'Glitch Hop / Neurohop', category: 'Dubstep & Bass', typicalBpm: [100, 110], description: 'Complex neurofunk-style morphing basslines, tight hip-hop drum grooves, and intricate micro-edits.' },

  // Drum & Bass
  { id: 'liquid-dnb', name: 'Liquid DnB', category: 'Drum & Bass', typicalBpm: [170, 175], description: 'Soulful electric piano, lush pad atmosphere, rolling breakbeats, and warm deep sub-bass.' },
  { id: 'neurofunk', name: 'Neurofunk', category: 'Drum & Bass', typicalBpm: [172, 178], description: 'Complex reese bass sound design, techy mechanical percussion, and dark futuristic soundscapes.' },
  { id: 'jump-up', name: 'Jump Up', category: 'Drum & Bass', typicalBpm: [174, 178], description: 'Simple energetic squelchy synth stabs, high-pitched screechy bass riffs, and rave hype.' },
  { id: 'jungle', name: 'Jungle', category: 'Drum & Bass', typicalBpm: [160, 170], description: 'Chopped Amen breaks, pitch-shifted reggae/dub vocal samples, and roaring 808 subs.' },
  { id: 'dancefloor-dnb', name: 'Dancefloor DnB', category: 'Drum & Bass', typicalBpm: [174, 176], description: 'Huge catchy anthemic supersaw leads, massive vocal top-lines, and energetic festival drops.' },
  { id: 'halftime-dnb', name: 'Halftime / Drumstep', category: 'Drum & Bass', typicalBpm: [85, 88], description: 'Half-speed 85/170 BPM groove with hip-hop cadence, aggressive bass sound design, and sharp snares.' },

  // Hip Hop & Urban
  { id: 'boom-bap', name: 'Boom Bap / Golden Era', category: 'Hip Hop & Urban', typicalBpm: [85, 95], description: 'Dusty vinyl drum breaks, punchy kick-snare patterns, sliced jazz/soul samples, and laid-back swing.' },
  { id: 'trap', name: 'Trap', category: 'Hip Hop & Urban', typicalBpm: [130, 160], description: 'Fast rolling triplet hi-hats, booming pitched 808 sub-bass, snappy brass stabs, and dark minor melodies.' },
  { id: 'drill', name: 'Drill (UK / NY Drill)', category: 'Hip Hop & Urban', typicalBpm: [140, 145], description: 'Sliding distorted 808 glides, offbeat syncopated counter-snares, and eerie acoustic/vocal loops.' },
  { id: 'jersey-club', name: 'Jersey Club', category: 'Hip Hop & Urban', typicalBpm: [130, 140], description: 'Trippy 5-beat bounce rhythm, iconic bed squeak samples, chopped vocal stabs, and heavy sub kicks.' },
  { id: 'lofi-hiphop', name: 'Lo-Fi Hip Hop', category: 'Hip Hop & Urban', typicalBpm: [75, 88], description: 'Detuned tape-warbled Rhodes keys, vinyl crackle, relaxed unquantized drum swing, and chill vibes.' },
  { id: 'phonk', name: 'Phonk / Drift Phonk', category: 'Hip Hop & Urban', typicalBpm: [130, 160], description: 'Distorted cowbell melodies, Memphis rap vocal chops, aggressive dirty 808s, and dark energy.' },

  // Techno & Trance
  { id: 'peak-time-techno', name: 'Peak Time / Driving Techno', category: 'Techno & Trance', typicalBpm: [130, 136], description: 'Industrial rumble kicks, relentless 16th-note bass drives, hypnotic synth hooks, and dark energy.' },
  { id: 'hard-groove-techno', name: 'Hard Groove Techno', category: 'Techno & Trance', typicalBpm: [136, 144], description: 'Old-school tribal techno energy, 909 percussive rolls, funky vocal loops, and relentless dancefloor drive.' },
  { id: 'hard-techno', name: 'Hard Techno / Schranz', category: 'Techno & Trance', typicalBpm: [145, 160], description: 'Distorted overdriven kick drums, screeches, fast industrial loops, and relentless rave speed.' },
  { id: 'psytrance', name: 'Psytrance', category: 'Techno & Trance', typicalBpm: [138, 145], description: 'Rolling triplet K-B-B-B basslines, psychedelic squelches, galactic delays, and spiritual chanting.' },
  { id: 'uplifting-trance', name: 'Uplifting Trance', category: 'Techno & Trance', typicalBpm: [136, 140], description: 'Emotional piano breakdowns, soaring euphoric supersaws, and energetic driving rolling sub.' },

  // Electronic & Experimental
  { id: 'synthwave', name: 'Synthwave / Retrowave', category: 'Electronic & Experimental', typicalBpm: [105, 120], description: '80s analog synthesizers, gated reverb snare drums, arpeggiated basslines, and neon nostalgia.' },
  { id: 'wave-hardwave', name: 'Wave / Hardwave', category: 'Electronic & Experimental', typicalBpm: [130, 145], description: 'Emotional detuned reese basses, trap drums, cinematic cyberpunk pads, and soaring pitch-bent leads.' },
  { id: 'hyperpop', name: 'Hyperpop', category: 'Electronic & Experimental', typicalBpm: [135, 170], description: 'Extreme pitched vocal glitches, abrasive bubblegum synths, distorted 808s, and frantic energy.' },
  { id: 'indie-dance', name: 'Indie Dance / Dark Disco', category: 'Electronic & Experimental', typicalBpm: [118, 124], description: 'Post-punk basslines, retro drum machines, dry vocal hooks, and atmospheric synth pads.' },
  { id: 'shoegaze', name: 'Shoegaze / Dream Pop', category: 'Electronic & Experimental', typicalBpm: [90, 125], description: 'Walls of fuzz and reverb-drenched guitars, ethereal breathy vocals, and hazy emotional textures.' },
  { id: 'chiptune', name: 'Chiptune / 8-Bit', category: 'Electronic & Experimental', typicalBpm: [125, 160], description: 'Vintage game-console synth waveforms (square, triangle, noise), rapid arpeggios, and retro nostalgia.' }
];

export interface ScaleSegment {
  startSec: number;
  endSec: number;
  durationSec: number;
  percentStart: number;
  percentWidth: number;
  key: string | null;
  note: string | null;
  mode: string | null;
  scale: string | null;
  camelot: string | null;
  confidence: number;
  color: string;
  badgeBg: string;
  textColor: string;
  ragas: RagaSuggestion[];
  transitionFromPrev?: {
    semitoneDelta: number;
    shiftLabel: string;
    type: string;
    camelotShift?: string;
  } | null;
}

export interface ScaleModulationReport {
  duration: number;
  hasModulation: boolean;
  segmentCount: number;
  segments: ScaleSegment[];
  uniqueKeys: string[];
}

const MAJOR_PALETTE = [
  { color: '#00f0ff', badgeBg: 'rgba(0, 240, 255, 0.22)', textColor: '#00f0ff' }, // Electric Cyan
  { color: '#ffd600', badgeBg: 'rgba(255, 214, 0, 0.22)', textColor: '#ffd600' }, // Solar Yellow
  { color: '#22c55e', badgeBg: 'rgba(34, 197, 94, 0.22)', textColor: '#4ade80' }, // Vibrant Emerald
  { color: '#ff7849', badgeBg: 'rgba(255, 120, 73, 0.22)', textColor: '#ff8a5b' }, // Bright Coral
  { color: '#38bdf8', badgeBg: 'rgba(56, 189, 248, 0.22)', textColor: '#7dd3fc' }, // Sky Blue
  { color: '#f43f5e', badgeBg: 'rgba(244, 63, 94, 0.22)', textColor: '#fb7185' }  // Neon Rose
];

const MINOR_PALETTE = [
  { color: '#6366f1', badgeBg: 'rgba(99, 102, 241, 0.25)', textColor: '#a5b4fc' }, // Deep Indigo
  { color: '#9333ea', badgeBg: 'rgba(147, 51, 234, 0.25)', textColor: '#c084fc' }, // Midnight Violet
  { color: '#d97706', badgeBg: 'rgba(217, 119, 6, 0.25)', textColor: '#fcd34d' }, // Dark Amber
  { color: '#be123c', badgeBg: 'rgba(190, 18, 60, 0.25)', textColor: '#fda4af' }, // Crimson
  { color: '#059669', badgeBg: 'rgba(5, 150, 105, 0.25)', textColor: '#6ee7b7' }, // Dark Forest
  { color: '#475569', badgeBg: 'rgba(71, 85, 105, 0.30)', textColor: '#cbd5e1' }  // Deep Slate
];

export function detectScaleModulations(
  samples: Float32Array | Float64Array,
  sampleRate: number,
  options: { windowSec?: number; hopSec?: number } = {}
): ScaleModulationReport {
  const totalDuration = samples.length / sampleRate;
  if (totalDuration < 2) {
    return {
      duration: totalDuration,
      hasModulation: false,
      segmentCount: 0,
      segments: [],
      uniqueKeys: []
    };
  }

  // Adaptive window sizing: 6-12s windows for robust harmonic integration
  const windowSec = options.windowSec || Math.max(6, Math.min(12, totalDuration / 6));
  const hopSec = options.hopSec || windowSec * 0.5;
  const windowSamples = Math.floor(windowSec * sampleRate);
  const hopSamples = Math.floor(hopSec * sampleRate);

  interface RawWindowResult {
    startSec: number;
    endSec: number;
    key: string | null;
    note: string | null;
    mode: string | null;
    scale: string | null;
    camelot: string | null;
    confidence: number;
    tonicPc: number;
    ragas: RagaSuggestion[];
  }

  const rawWindows: RawWindowResult[] = [];

  for (let offset = 0; offset + windowSamples * 0.5 <= samples.length; offset += hopSamples) {
    const end = Math.min(samples.length, offset + windowSamples);
    const winSlice = samples.subarray(offset, end);
    const { frames, binHz } = spectra(winSlice, sampleRate);
    if (frames.length === 0) continue;

    const keyRes = detectKey(frames, binHz);
    const startSec = Math.round((offset / sampleRate) * 10) / 10;
    const endSec = Math.round((end / sampleRate) * 10) / 10;

    rawWindows.push({
      startSec,
      endSec,
      key: keyRes.key || (keyRes.tonic ? `${keyRes.tonic} ${keyRes.scale || ''}`.trim() : null),
      note: keyRes.note || keyRes.tonic,
      mode: keyRes.mode,
      scale: keyRes.scale,
      camelot: keyRes.camelot,
      confidence: keyRes.confidence,
      tonicPc: keyRes.tonicPc || 0,
      ragas: keyRes.ragas || []
    });
  }

  if (rawWindows.length === 0) {
    return {
      duration: totalDuration,
      hasModulation: false,
      segmentCount: 0,
      segments: [],
      uniqueKeys: []
    };
  }

  // Temporal smoothing & contiguous segment merging
  interface MergedSegment {
    startSec: number;
    endSec: number;
    key: string | null;
    note: string | null;
    mode: string | null;
    scale: string | null;
    camelot: string | null;
    confidenceSum: number;
    count: number;
    tonicPc: number;
    ragas: RagaSuggestion[];
  }

  const merged: MergedSegment[] = [];

  for (let i = 0; i < rawWindows.length; i += 1) {
    const cur = rawWindows[i];
    if (!cur.key) continue;

    const last = merged[merged.length - 1];
    const isSameKey = last && last.key === cur.key;

    if (isSameKey) {
      last.endSec = cur.endSec;
      last.confidenceSum += cur.confidence;
      last.count += 1;
      if (cur.ragas && cur.ragas.length > 0 && last.ragas.length === 0) {
        last.ragas = cur.ragas;
      }
    } else {
      // Lookahead check: Ignore 1-frame spurious flutter if adjacent windows match
      if (last && i + 1 < rawWindows.length && rawWindows[i + 1].key === last.key) {
        last.endSec = rawWindows[i + 1].endSec;
        last.confidenceSum += rawWindows[i + 1].confidence;
        last.count += 1;
        i += 1; // skip transient flutter
        continue;
      }

      merged.push({
        startSec: cur.startSec,
        endSec: cur.endSec,
        key: cur.key,
        note: cur.note,
        mode: cur.mode,
        scale: cur.scale,
        camelot: cur.camelot,
        confidenceSum: cur.confidence,
        count: 1,
        tonicPc: cur.tonicPc,
        ragas: cur.ragas
      });
    }
  }

  if (merged.length === 0) {
    return {
      duration: totalDuration,
      hasModulation: false,
      segmentCount: 0,
      segments: [],
      uniqueKeys: []
    };
  }

  // Adjust contiguous time boundaries so segments seamlessly tile 0 -> totalDuration
  merged[0].startSec = 0;
  for (let i = 0; i < merged.length - 1; i += 1) {
    const boundary = Math.round(((merged[i].endSec + merged[i + 1].startSec) / 2) * 10) / 10;
    merged[i].endSec = boundary;
    merged[i + 1].startSec = boundary;
  }
  merged[merged.length - 1].endSec = Math.round(totalDuration * 10) / 10;

  // Filter out tiny noise segments (< 4 seconds unless it is the only segment)
  const filteredMerged = merged.filter((seg, idx, arr) => {
    const segDur = seg.endSec - seg.startSec;
    return arr.length === 1 || segDur >= 4.0;
  });

  const finalSegmentsList = filteredMerged.length > 0 ? filteredMerged : merged;
  finalSegmentsList[0].startSec = 0;
  for (let i = 0; i < finalSegmentsList.length - 1; i += 1) {
    finalSegmentsList[i].endSec = finalSegmentsList[i + 1].startSec;
  }
  finalSegmentsList[finalSegmentsList.length - 1].endSec = Math.round(totalDuration * 10) / 10;

  // Extract unique keys
  const uniqueKeySet = new Set<string>();
  finalSegmentsList.forEach((s) => {
    if (s.key) uniqueKeySet.add(s.key);
  });
  const uniqueKeys = Array.from(uniqueKeySet);

  // Assign distinct colors per unique key (brighter for major, darker for minor)
  const keyColorMap = new Map<string, { color: string; badgeBg: string; textColor: string }>();
  let majorIdx = 0;
  let minorIdx = 0;

  uniqueKeys.forEach((k) => {
    const isMajor = k.toLowerCase().includes('maj');
    if (isMajor) {
      keyColorMap.set(k, MAJOR_PALETTE[majorIdx % MAJOR_PALETTE.length]);
      majorIdx += 1;
    } else {
      keyColorMap.set(k, MINOR_PALETTE[minorIdx % MINOR_PALETTE.length]);
      minorIdx += 1;
    }
  });

  const outputSegments: ScaleSegment[] = finalSegmentsList.map((seg, idx) => {
    const dur = Math.max(0.1, seg.endSec - seg.startSec);
    const pStart = Math.max(0, Math.min(100, (seg.startSec / totalDuration) * 100));
    const pWidth = Math.max(0.1, Math.min(100 - pStart, (dur / totalDuration) * 100));
    const palette = keyColorMap.get(seg.key || '') || (seg.mode === 'maj' ? MAJOR_PALETTE[0] : MINOR_PALETTE[0]);

    let transitionFromPrev = null;
    if (idx > 0) {
      const prev = finalSegmentsList[idx - 1];
      const deltaSt = ((seg.tonicPc - prev.tonicPc + 12) % 12);
      let shiftLabel = '';
      let modType = 'Modulation';

      if (deltaSt === 1) {
        shiftLabel = '+1 st (Half-step lift)';
        modType = 'Gear-Shift Lift (+1 st)';
      } else if (deltaSt === 2) {
        shiftLabel = '+2 st (Whole-step lift)';
        modType = 'Gear-Shift Lift (+2 st)';
      } else if (deltaSt === 11) {
        shiftLabel = '-1 st (Half-step drop)';
        modType = 'Key Drop (-1 st)';
      } else if (deltaSt === 10) {
        shiftLabel = '-2 st (Whole-step drop)';
        modType = 'Key Drop (-2 st)';
      } else if (deltaSt === 3 || deltaSt === 9) {
        shiftLabel = deltaSt === 3 ? '+3 st' : '-3 st';
        modType = 'Relative Major / Minor Shift';
      } else if (deltaSt === 7 || deltaSt === 5) {
        shiftLabel = deltaSt === 7 ? '+7 st (Dominant 5th)' : '+5 st (Subdominant 4th)';
        modType = 'Circle of Fifths Modulation';
      } else if (deltaSt === 0 && prev.mode !== seg.mode) {
        shiftLabel = 'Parallel mode switch';
        modType = 'Parallel Key Modulation';
      } else {
        shiftLabel = `+${deltaSt} st`;
        modType = `Modulation (+${deltaSt} st)`;
      }

      transitionFromPrev = {
        semitoneDelta: deltaSt,
        shiftLabel,
        type: modType,
        camelotShift: prev.camelot && seg.camelot ? `${prev.camelot} ➔ ${seg.camelot}` : undefined
      };
    }

    return {
      startSec: seg.startSec,
      endSec: seg.endSec,
      durationSec: dur,
      percentStart: pStart,
      percentWidth: pWidth,
      key: seg.key,
      note: seg.note,
      mode: seg.mode,
      scale: seg.scale,
      camelot: seg.camelot,
      confidence: Math.round((seg.confidenceSum / seg.count) * 100) / 100,
      color: palette.color,
      badgeBg: palette.badgeBg,
      textColor: palette.textColor,
      ragas: seg.ragas || [],
      transitionFromPrev
    };
  });

  return {
    duration: totalDuration,
    hasModulation: uniqueKeys.length > 1,
    segmentCount: outputSegments.length,
    segments: outputSegments,
    uniqueKeys
  };
}

export const DSP = {
  analyse,
  detectKey,
  detectTempo,
  detectMeter,
  detectTuning,
  detectDroneAndBass,
  detectScaleModulations,
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
  TALA_MAP,
  RAGA_DEFINITIONS,
  GENRE_DATABASE,
  RECOMMENDED_FFT
};

