/**
 * Key & scale benchmark for DSP.analyse / DSP.analyseLive.
 *
 *   npx tsx test/bench/key-benchmark.ts            # full run
 *   npx tsx test/bench/key-benchmark.ts --quick    # 4 tonics only
 *   npx tsx test/bench/key-benchmark.ts --live     # score analyseLive
 *   npx tsx test/bench/key-benchmark.ts --full     # score full analyse (slow)
 *   add --misses to list every miss
 *
 * Renders short arrangements (bass, pad, melody, drums) in every key across
 * common major/minor progressions, then scores with the MIREX weighting:
 * exact 1, fifth 0.5, relative 0.3, parallel 0.2.
 */
import { DSP } from '../../src/renderer/dsp';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiHz = (m: number, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);

type Chord = { root: number; tones: number[] }; // semitones from tonic
type Prog = { name: string; mode: 'maj' | 'min'; scale: string; chords: Chord[]; melody: number[] };

const M = (root: number, q: 'maj' | 'min' | 'dim' | '7') => ({
  root,
  tones: q === 'maj' ? [0, 4, 7] : q === 'min' ? [0, 3, 7] : q === 'dim' ? [0, 3, 6] : [0, 4, 7, 10]
});

export const PROGRESSIONS: Prog[] = [
  { name: 'I-V-vi-IV', mode: 'maj', scale: 'major', chords: [M(0, 'maj'), M(7, 'maj'), M(9, 'min'), M(5, 'maj')], melody: [4, 2, 0, 2, 7, 4, 2, 0] },
  { name: 'I-IV-V-I', mode: 'maj', scale: 'major', chords: [M(0, 'maj'), M(5, 'maj'), M(7, '7'), M(0, 'maj')], melody: [0, 4, 7, 5, 4, 2, 11, 0] },
  { name: 'ii-V-I-I', mode: 'maj', scale: 'major', chords: [M(2, 'min'), M(7, '7'), M(0, 'maj'), M(0, 'maj')], melody: [5, 2, 11, 7, 4, 0, 7, 4] },
  { name: 'I-vi-IV-V', mode: 'maj', scale: 'major', chords: [M(0, 'maj'), M(9, 'min'), M(5, 'maj'), M(7, 'maj')], melody: [7, 4, 9, 0, 5, 9, 11, 2] },
  { name: 'i-iv-V-i', mode: 'min', scale: 'harmonicMinor', chords: [M(0, 'min'), M(5, 'min'), M(7, 'maj'), M(0, 'min')], melody: [0, 3, 5, 8, 7, 11, 2, 0] },
  { name: 'i-VI-III-VII', mode: 'min', scale: 'minor', chords: [M(0, 'min'), M(8, 'maj'), M(3, 'maj'), M(10, 'maj')], melody: [7, 3, 0, 3, 10, 7, 5, 2] },
  { name: 'i-VII-VI-VII', mode: 'min', scale: 'minor', chords: [M(0, 'min'), M(10, 'maj'), M(8, 'maj'), M(10, 'maj')], melody: [0, 2, 3, 2, 0, 10, 8, 7] },
  { name: 'i-iv-v-i', mode: 'min', scale: 'minor', chords: [M(0, 'min'), M(5, 'min'), M(7, 'min'), M(0, 'min')], melody: [3, 0, 5, 8, 7, 10, 3, 0] }
];

export interface RenderOptions {
  sampleRate?: number;
  seconds?: number;
  bpm?: number;
  a4?: number;
  drums?: boolean;
  seed?: number;
}

/** Saw-ish voice with rolled-off harmonics — closer to real instruments than sines. */
const TABLE_SIZE = 4096;
const tables = new Map<string, Float32Array>();
function table(harmonics: number, tilt: number): Float32Array {
  const id = `${harmonics}:${tilt}`;
  let tab = tables.get(id);
  if (!tab) {
    tab = new Float32Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      for (let h = 1; h <= harmonics; h += 1) tab[i] += Math.sin((2 * Math.PI * h * i) / TABLE_SIZE) / Math.pow(h, tilt);
    }
    tables.set(id, tab);
  }
  return tab;
}
function voice(freq: number, t: number, harmonics = 6, tilt = 1.2) {
  const phase = (freq * t) % 1;
  return table(harmonics, tilt)[Math.floor(phase * TABLE_SIZE)];
}

export function renderProgression(tonicPc: number, prog: Prog, opts: RenderOptions = {}): Float32Array {
  const sr = opts.sampleRate ?? 44100;
  const seconds = opts.seconds ?? 16;
  const bpm = opts.bpm ?? 110;
  const a4 = opts.a4 ?? 440;
  const drums = opts.drums ?? true;
  let seed = opts.seed ?? 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  const beat = 60 / bpm;
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const bassBase = 36 + tonicPc; // C2..B2

  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const b = t / beat;
    const bar = Math.floor(b / 4) % prog.chords.length;
    const chord = prog.chords[bar];
    const inBeat = (b % 1) * beat;

    // Bass: chord root, pulsing on beats.
    const bassMidi = bassBase + (chord.root > 6 ? chord.root - 12 : chord.root);
    let v = 0.28 * voice(midiHz(bassMidi, a4), t, 4, 1.6) * (0.55 + 0.45 * Math.exp(-inBeat * 4));

    // Pad: close-voiced chord tones between G3 and F#4.
    for (const tone of chord.tones) {
      let m = 60 + ((tonicPc + chord.root + tone) % 12);
      if (m > 66) m -= 12;
      v += 0.07 * voice(midiHz(m, a4), t, 5, 1.4);
    }

    // Melody: one note per beat, pluck envelope, an octave up.
    const step = Math.floor(b) % prog.melody.length;
    const mel = 72 + ((tonicPc + prog.melody[step]) % 12); // C5..B5
    v += 0.12 * voice(midiHz(mel, a4), t, 4, 1.5) * Math.exp(-inBeat * 3.5);

    if (drums) {
      if (inBeat < 0.15) v += 0.7 * Math.sin(2 * Math.PI * (48 + 80 * Math.exp(-inBeat * 35)) * inBeat) * Math.exp(-inBeat * 22);
      const hat = ((b + 0.5) % 1) * beat;
      if (hat < 0.04) v += 0.15 * rnd() * Math.exp(-hat * 100);
      const snare = ((b + 1) % 2) * beat;
      if (Math.floor(b) % 2 === 1 && inBeat < 0.12) v += 0.25 * rnd() * Math.exp(-inBeat * 30);
      void snare;
    }
    out[i] = Math.max(-1, Math.min(1, v * 0.6));
  }
  return out;
}

export function mirexScore(expected: string, got: string | null): number {
  if (!got) return 0;
  if (expected === got) return 1;
  const [et, em] = expected.split(' ');
  const [gt, gm] = got.split(' ');
  const e = NOTES.indexOf(et);
  const g = NOTES.indexOf(gt);
  if (em === gm && (g === (e + 7) % 12 || g === (e + 5) % 12)) return 0.5;
  if (em === 'maj' && gm === 'min' && g === (e + 9) % 12) return 0.3;
  if (em === 'min' && gm === 'maj' && g === (e + 3) % 12) return 0.3;
  if (em !== gm && g === e) return 0.2;
  return 0;
}

interface TrackResult {
  variant: string;
  prog: string;
  expected: string;
  got: string | null;
  scale: string | null;
  expectedScale: string;
  confidence: number;
  score: number;
}

function runShard(args: string[], shard: number, shards: number): TrackResult[] {
  const quick = args.includes('--quick');
  const live = args.includes('--live');
  const full = args.includes('--full');
  const tonics = quick ? [0, 4, 7, 10] : NOTES.map((_, i) => i);
  const variants: { label: string; opts: RenderOptions }[] = [
    { label: 'std', opts: {} },
    { label: 'A432', opts: { a4: 432 } },
    { label: 'nodrums', opts: { drums: false, bpm: 84 } }
  ];
  const results: TrackResult[] = [];
  let index = 0;
  for (const variant of variants) {
    for (const prog of PROGRESSIONS) {
      for (const pc of tonics) {
        if (index++ % shards !== shard) continue;
        const sr = live ? 11025 : 44100;
        const audio = renderProgression(pc, prog, { ...variant.opts, sampleRate: sr, seconds: live ? 12 : 16 });
        const result: any = live
          ? DSP.analyseLive(audio, sr)
          : full ? DSP.analyse(audio, sr) : DSP.analyseKey(audio, sr);
        const expected = `${NOTES[pc]} ${prog.mode}`;
        results.push({ variant: variant.label, prog: prog.name, expected, got: result.key, scale: result.scale, expectedScale: prog.scale, confidence: result.keyConfidence ?? result.confidence ?? 0, score: mirexScore(expected, result.key) });
      }
    }
  }
  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const shardArg = args.find((a) => a.startsWith('--shard='));
  if (shardArg) {
    const [k, n] = shardArg.slice(8).split('/').map(Number);
    process.stdout.write(JSON.stringify(runShard(args, k, n)));
  } else {
    const { execFileSync } = require('child_process');
    const os = require('os');
    const workers = Math.max(1, Math.min(8, os.cpus().length));
    const started = Date.now();
    const pending = Array.from({ length: workers }, (_, k) =>
      new Promise<TrackResult[]>((resolve, reject) => {
        const { execFile } = require('child_process');
        execFile(process.execPath, [...process.execArgv, __filename, ...args, `--shard=${k}/${workers}`],
          { maxBuffer: 64 * 1024 * 1024 },
          (err: any, out: string) => (err ? reject(err) : resolve(JSON.parse(out))));
      })
    );
    void execFileSync;
    Promise.all(pending).then((parts) => {
      const all = parts.flat();
      const label = args.includes('--live') ? 'analyseLive' : args.includes('--full') ? 'analyse' : 'analyseKey';
      const exact = all.filter((r) => r.score === 1).length;
      const mirex = all.reduce((a, r) => a + r.score, 0) / all.length;
      console.log(`\n${label} — ${all.length} tracks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      console.log(`exact ${exact}/${all.length} (${((exact / all.length) * 100).toFixed(1)}%)   MIREX ${(mirex * 100).toFixed(1)}%`);
      const keyed = all.filter((r) => r.score === 1);
      const scaleOk = keyed.filter((r) => r.scale === r.expectedScale).length;
      const meanConf = (rs: TrackResult[]) => (rs.reduce((a, r) => a + r.confidence, 0) / Math.max(1, rs.length)).toFixed(2);
      console.log(`mean confidence: right ${meanConf(keyed)}, wrong ${meanConf(all.filter((r) => r.score < 1))}`);
      console.log(`scale correct when key correct: ${scaleOk}/${keyed.length} (${((scaleOk / Math.max(1, keyed.length)) * 100).toFixed(1)}%)`);
      const group = (key: (r: TrackResult) => string) => {
        const m = new Map<string, number[]>();
        for (const r of all) m.set(key(r), [...(m.get(key(r)) || []), r.score]);
        return [...m].map(([k, v]) => `  ${k.padEnd(13)} ${((v.reduce((a, b) => a + b, 0) / v.length) * 100).toFixed(0)}%`).join('\n');
      };
      console.log(group((r) => r.prog));
      console.log(group((r) => r.variant));
      if (args.includes('--misses')) {
        for (const r of all.filter((x) => x.score < 1 || x.scale !== x.expectedScale)) {
          console.log(`${r.variant.padEnd(8)} ${r.prog.padEnd(13)} want ${r.expected.padEnd(7)} got ${String(r.got).padEnd(8)} scale=${r.scale} (want ${r.expectedScale})`);
        }
      }
    });
  }
}
