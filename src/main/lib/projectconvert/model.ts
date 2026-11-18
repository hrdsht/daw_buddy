'use strict';

/**
 * The neutral project every reader produces and every writer consumes.
 *
 * Converting N formats to M formats directly is N×M converters. Going through
 * one shared shape is N readers + M writers, and each one can be tested on its
 * own.
 *
 * Time is in BEATS (quarter notes) from the start of the arrangement at the
 * project tempo. Audio offsets into a source file are in SECONDS, because the
 * file itself knows nothing about beats.
 *
 * What travels: tempo, time signature, markers, tracks (name, volume, pan,
 * mute, colour), track volume / pan / mute automation, audio clips (file,
 * position, length, start offset, gain) and MIDI clips (notes with velocity).
 * What doesn't: plug-ins and their settings or automation, sends/routing,
 * warping/time-stretch and tempo changes. Every reader records what it had to
 * leave behind in `warnings`.
 */

export interface Note {
  /** Beats from the start of the clip. */
  start: number;
  length: number;
  pitch: number; // 0-127
  velocity: number; // 1-127
}

export interface AudioClip {
  kind: 'audio';
  name: string;
  start: number; // beats, arrangement position
  length: number; // beats
  /** Absolute path to the source file, or null if it could not be found. */
  file: string | null;
  /** The file name as the project referenced it — kept even when missing. */
  fileName: string;
  /** Seconds into the source file where playback begins. */
  offset: number;
  /** Linear clip gain, 1 = unity. */
  gain: number;
}

export interface MidiClip {
  kind: 'midi';
  name: string;
  start: number;
  length: number;
  notes: Note[];
}

export type Clip = AudioClip | MidiClip;

/**
 * One automation breakpoint. `value` is in the same unit as the matching Track
 * field: volume = linear gain, pan = -1..1, mute = 1 (muted) or 0 (playing).
 */
export interface AutoPoint {
  time: number; // beats
  value: number;
}

/**
 * Volume and pan ramp linearly between points; mute holds each value until
 * the next point. Two points at the same time make an instant jump.
 */
export interface Automation {
  volume?: AutoPoint[];
  pan?: AutoPoint[];
  mute?: AutoPoint[];
}

export type AutomationKind = keyof Automation;

export interface Track {
  name: string;
  kind: 'audio' | 'midi';
  /** Linear gain, 1 = 0 dB. */
  volume: number;
  /** -1 (left) .. 0 (centre) .. 1 (right). */
  pan: number;
  mute: boolean;
  /** '#rrggbb' or null. */
  color: string | null;
  clips: Clip[];
  automation?: Automation;
}

export interface Marker {
  name: string;
  time: number; // beats
}

export interface Project {
  name: string;
  /** Format name of the source, e.g. 'Ableton Live'. */
  source: string;
  bpm: number;
  timeSignature: [number, number];
  markers: Marker[];
  tracks: Track[];
  warnings: string[];
}

export function emptyProject(name: string, source: string): Project {
  return { name, source, bpm: 120, timeSignature: [4, 4], markers: [], tracks: [], warnings: [] };
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/** Where the last clip ends, in beats. */
export function projectLength(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.length);
  }
  return end;
}

/** Sort and clamp to the start of the song. */
export function cleanLane(points: AutoPoint[]): AutoPoint[] | undefined {
  const sorted = points
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .map((p, i) => ({ ...p, time: Math.max(0, p.time), i }))
    .sort((a, b) => a.time - b.time || a.i - b.i)
    .map(({ time, value }) => ({ time, value }));
  // Keep only the LAST point among several that clamped to time 0 — earlier
  // ones (Ableton's "before the song" default) are overridden by it.
  let firstAfterZero = 0;
  while (firstAfterZero + 1 < sorted.length && sorted[firstAfterZero + 1].time === 0) firstAfterZero += 1;
  const lane = sorted.slice(firstAfterZero);
  return lane.length ? lane : undefined;
}

/**
 * Attach a lane to a track. One point is not movement, just a level: it
 * becomes the track's static value. When the automation is active the DAW
 * ignores the fader, so the lane's value wins either way.
 */
export function setLane(track: Track, kind: AutomationKind, points: AutoPoint[]): void {
  const lane = cleanLane(points);
  if (!lane) return;
  const flat = lane.every((p) => Math.abs(p.value - lane[0].value) < 1e-9);
  if (flat) {
    if (kind === 'volume') track.volume = lane[0].value;
    else if (kind === 'pan') track.pan = lane[0].value;
    else track.mute = lane[0].value >= 0.5;
    return;
  }
  track.automation = track.automation || {};
  track.automation[kind] = lane;
}

/** Value of a lane at a time. `hold` = step (mute); otherwise linear. */
export function valueAt(points: AutoPoint[], time: number, hold: boolean): number {
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    if (time < b.time) {
      const a = points[i - 1];
      if (hold || b.time - a.time < 1e-12) return a.value;
      return a.value + ((time - a.time) * (b.value - a.value)) / (b.time - a.time);
    }
  }
  return points[points.length - 1].value;
}

export function hasAutomation(track: Track): boolean {
  const a = track.automation;
  return !!a && !!((a.volume && a.volume.length) || (a.pan && a.pan.length) || (a.mute && a.mute.length));
}

export function summarise(project: Project) {
  let audioClips = 0;
  let midiClips = 0;
  let notes = 0;
  let missingFiles = 0;
  let automationLanes = 0;
  for (const track of project.tracks) {
    for (const lane of Object.values(track.automation || {})) if (lane && lane.length) automationLanes += 1;
    for (const clip of track.clips) {
      if (clip.kind === 'audio') {
        audioClips += 1;
        if (!clip.file) missingFiles += 1;
      } else {
        midiClips += 1;
        notes += clip.notes.length;
      }
    }
  }
  return {
    name: project.name,
    source: project.source,
    bpm: project.bpm,
    timeSignature: `${project.timeSignature[0]}/${project.timeSignature[1]}`,
    tracks: project.tracks.length,
    audioTracks: project.tracks.filter((t) => t.kind === 'audio').length,
    midiTracks: project.tracks.filter((t) => t.kind === 'midi').length,
    audioClips,
    midiClips,
    notes,
    markers: project.markers.length,
    automationLanes,
    missingFiles,
    lengthBeats: projectLength(project),
    warnings: project.warnings
  };
}

/** Keep a warning list readable: collapse repeats into "… (×12)". */
export function dedupeWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].map(([w, n]) => (n > 1 ? `${w} (×${n})` : w));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
