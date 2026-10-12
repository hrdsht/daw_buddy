'use strict';

/**
 * Audio → MIDI — the pure half (no DOM, no TensorFlow), so it can be tested
 * in Node. Transcription itself runs Spotify's Basic Pitch model in
 * audio-midi-worker.ts; this module prepares its input and turns its notes
 * into a clean Standard MIDI File.
 */

/** Basic Pitch is trained on mono audio at this rate. */
export const BASIC_PITCH_SAMPLE_RATE = 22050;

/** Basic Pitch contours resolve pitch to a third of a semitone. */
const CONTOUR_BINS_PER_SEMITONE = 3;

/** Pitch-bend range DAWs assume unless told otherwise (±2 semitones). */
const BEND_RANGE_SEMITONES = 2;

const TPQ = 480;

export interface TranscribedNote {
  pitchMidi: number;
  startTimeSeconds: number;
  durationSeconds: number;
  amplitude: number; // 0..1
  pitchBends?: number[]; // per model frame, in contour bins (⅓ semitone)
}

export interface NoteCleanupOptions {
  minMidi?: number;
  maxMidi?: number;
  minDurationSeconds?: number;
}

export interface QuantizeOptions {
  bpm: number;
  stepsPerBeat: number; // 4 = 1/16 notes, 2 = 1/8, 8 = 1/32
  strength?: number; // 0..1, 1 = hard snap
}

export interface MidiWriteOptions {
  bpm?: number;
  trackName?: string;
  pitchBends?: boolean;
}

/* ------------------------------------------------------------------ */
/* Input preparation                                                   */
/* ------------------------------------------------------------------ */

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0].slice();
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i += 1) out[i] += channel[i] / channels.length;
  }
  return out;
}

/**
 * Linear-interpolation resampler with a box pre-filter when downsampling.
 * The window uses OfflineAudioContext for this; this is the fallback and the
 * version tests run against.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  let source = input;
  if (ratio > 1) {
    // Average over each output period so content above the new Nyquist
    // doesn't fold back down as false notes.
    const radius = Math.floor(ratio / 2);
    if (radius > 0) {
      source = new Float32Array(input.length);
      let sum = 0;
      let count = 0;
      for (let i = 0; i < Math.min(radius, input.length); i += 1) { sum += input[i]; count += 1; }
      for (let i = 0; i < input.length; i += 1) {
        const add = i + radius;
        const drop = i - radius - 1;
        if (add < input.length) { sum += input[add]; count += 1; }
        if (drop >= 0) { sum -= input[drop]; count -= 1; }
        source[i] = sum / count;
      }
    }
  }
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = source[index] ?? 0;
    const b = source[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Note cleanup                                                        */
/* ------------------------------------------------------------------ */

export function cleanNotes(notes: TranscribedNote[], options: NoteCleanupOptions = {}): TranscribedNote[] {
  const minMidi = options.minMidi ?? 0;
  const maxMidi = options.maxMidi ?? 127;
  const minDuration = options.minDurationSeconds ?? 0;
  return notes
    .filter((n) => n.pitchMidi >= minMidi && n.pitchMidi <= maxMidi && n.durationSeconds >= minDuration)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
}

/**
 * Snaps note starts and ends to a beat grid. Partial strength moves notes
 * part of the way, keeping some human feel. Notes never shrink below one
 * grid step, and same-pitch notes that collide after snapping are merged.
 */
export function quantizeNotes(notes: TranscribedNote[], options: QuantizeOptions): TranscribedNote[] {
  const step = 60 / options.bpm / options.stepsPerBeat;
  const strength = Math.max(0, Math.min(1, options.strength ?? 1));
  const snap = (t: number) => t + (Math.round(t / step) * step - t) * strength;

  const moved = notes.map((n) => {
    const start = Math.max(0, snap(n.startTimeSeconds));
    let end = snap(n.startTimeSeconds + n.durationSeconds);
    if (end - start < step * strength) end = start + step;
    return { ...n, startTimeSeconds: start, durationSeconds: end - start };
  });

  moved.sort((a, b) => a.pitchMidi - b.pitchMidi || a.startTimeSeconds - b.startTimeSeconds);
  const merged: TranscribedNote[] = [];
  for (const note of moved) {
    const last = merged[merged.length - 1];
    const lastEnd = last ? last.startTimeSeconds + last.durationSeconds : -Infinity;
    if (last && last.pitchMidi === note.pitchMidi && note.startTimeSeconds < lastEnd - 1e-6) {
      const end = Math.max(lastEnd, note.startTimeSeconds + note.durationSeconds);
      last.durationSeconds = end - last.startTimeSeconds;
      last.amplitude = Math.max(last.amplitude, note.amplitude);
    } else {
      merged.push({ ...note });
    }
  }
  return merged.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
}

export function amplitudeToVelocity(amplitude: number): number {
  // Model amplitudes cluster low; a gentle curve keeps quiet notes audible.
  const v = Math.round(20 + 107 * Math.sqrt(Math.max(0, Math.min(1, amplitude))));
  return Math.max(1, Math.min(127, v));
}

/** Contour-bin offset (⅓ semitone units) → 14-bit MIDI pitch-bend value. */
export function bendToMidiValue(bins: number): number {
  const semitones = bins / CONTOUR_BINS_PER_SEMITONE;
  const value = Math.round(8192 + (semitones / BEND_RANGE_SEMITONES) * 8192);
  return Math.max(0, Math.min(16383, value));
}

export interface NoteSummary {
  count: number;
  lowest: number | null;
  highest: number | null;
  durationSeconds: number;
  polyphony: number; // most notes sounding at once
}

export function summariseNotes(notes: TranscribedNote[]): NoteSummary {
  if (!notes.length) return { count: 0, lowest: null, highest: null, durationSeconds: 0, polyphony: 0 };
  let lowest = 127;
  let highest = 0;
  let end = 0;
  const edges: [number, number][] = [];
  for (const n of notes) {
    lowest = Math.min(lowest, n.pitchMidi);
    highest = Math.max(highest, n.pitchMidi);
    end = Math.max(end, n.startTimeSeconds + n.durationSeconds);
    edges.push([n.startTimeSeconds, 1], [n.startTimeSeconds + n.durationSeconds, -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let polyphony = 0;
  for (const [, delta] of edges) {
    current += delta;
    polyphony = Math.max(polyphony, current);
  }
  return { count: notes.length, lowest, highest, durationSeconds: end, polyphony };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiNoteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/* ------------------------------------------------------------------ */
/* MIDI file                                                           */
/* ------------------------------------------------------------------ */

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

const be32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];

/**
 * Standard MIDI File, format 0, one track on channel 1. Times are written in
 * ticks at the given tempo, so notes land on the DAW grid when the project
 * tempo matches. Pitch bends are only meaningful for single-line parts
 * (vocals, bass, leads) — on chords every note would bend together.
 */
export function notesToMidi(notes: TranscribedNote[], options: MidiWriteOptions = {}): Uint8Array {
  const bpm = options.bpm && options.bpm > 0 ? options.bpm : 120;
  const ticksPerSecond = (TPQ * bpm) / 60;
  const toTicks = (seconds: number) => Math.max(0, Math.round(seconds * ticksPerSecond));

  type Ev = { tick: number; order: number; bytes: number[] };
  const events: Ev[] = [];

  for (const n of notes) {
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitchMidi)));
    const on = toTicks(n.startTimeSeconds);
    const off = Math.max(on + 1, toTicks(n.startTimeSeconds + n.durationSeconds));
    events.push({ tick: on, order: 2, bytes: [0x90, pitch, amplitudeToVelocity(n.amplitude)] });
    events.push({ tick: off, order: 0, bytes: [0x80, pitch, 0] });

    if (options.pitchBends && n.pitchBends && n.pitchBends.length) {
      let previous = -1;
      n.pitchBends.forEach((bins, i) => {
        const value = bendToMidiValue(bins);
        if (value === previous) return;
        previous = value;
        const tick = on + Math.floor(((off - on) * i) / n.pitchBends!.length);
        events.push({ tick, order: 1, bytes: [0xe0, value & 0x7f, (value >> 7) & 0x7f] });
      });
      // Re-centre at note-off so the next note starts in tune.
      events.push({ tick: off, order: 1, bytes: [0xe0, 0x00, 0x40] });
    }
  }

  // Note-offs before bends before note-ons at the same tick, so a repeated
  // note re-triggers instead of being cut by its own previous note-off.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const body: number[] = [];
  const name = Array.from(new TextEncoder().encode(options.trackName || 'Audio to MIDI')).slice(0, 120);
  body.push(...vlq(0), 0xff, 0x03, ...vlq(name.length), ...name);
  const usPerQuarter = Math.round(60000000 / bpm);
  body.push(...vlq(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  body.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);

  let lastTick = 0;
  for (const ev of events) {
    body.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);

  const head = [0x4d, 0x54, 0x68, 0x64, ...be32(6), ...be16(0), ...be16(1), ...be16(TPQ)];
  const track = [0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body];
  return Uint8Array.from([...head, ...track]);
}
