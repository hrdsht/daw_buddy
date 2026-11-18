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
 * mute, colour), audio clips (file, position, length, start offset, gain) and
 * MIDI clips (notes with velocity). What doesn't: plugins and their settings,
 * automation, sends/routing, warping/time-stretch and tempo changes. Those are
 * proprietary per DAW and no converter — paid or not — moves them reliably.
 * Every reader records what it had to leave behind in `warnings`.
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

export function summarise(project: Project) {
  let audioClips = 0;
  let midiClips = 0;
  let notes = 0;
  let missingFiles = 0;
  for (const track of project.tracks) {
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
