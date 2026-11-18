'use strict';

/**
 * REAPER (.rpp) — plain text, nested `<BLOCK ... >` sections. Read and written.
 *
 * Item positions are in seconds; the neutral model is in beats, so both
 * directions go through the project tempo. In-project MIDI is stored as
 * `E <delta> <status> <data1> <data2>` lines in hex, with ticks per quarter
 * note given on the HASDATA line.
 */

import fsp from 'fs/promises';
import nodePath from 'path';
import { Project, Track, AudioClip, MidiClip, Note, AutoPoint, AutomationKind, emptyProject, secondsToBeats, beatsToSeconds, clamp, setLane } from './model';

/*
 * Envelope value conventions. Volume (VOLENV2) is linear gain, as in VOLPAN.
 * Pan and mute envelopes do not use the same sense as the track's VOLPAN /
 * MUTESOLO lines. These two constants hold that mapping in one place.
 *
 *   PAN_ENV_SIGN   envelope value = PAN_ENV_SIGN × model pan (-1 left … 1 right)
 *   MUTE_ENV_MUTED envelope value that means "muted" (the other is 1 - it)
 */
export const PAN_ENV_SIGN = -1;
export const MUTE_ENV_MUTED = 0;

const ENVELOPES: Record<string, AutomationKind> = { VOLENV2: 'volume', PANENV2: 'pan', MUTEENV: 'mute' };
import { FileFinder } from './files';

/* ================================================================== */
/* read                                                               */
/* ================================================================== */

interface Block {
  head: string[];
  lines: string[][];
  blocks: Block[];
}

/** Split one RPP line into tokens, honouring "double", 'single' and `back` quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i += 1;
    if (i >= line.length) break;
    const q = line[i];
    if (q === '"' || q === "'" || q === '`') {
      const end = line.indexOf(q, i + 1);
      out.push(line.slice(i + 1, end === -1 ? line.length : end));
      i = end === -1 ? line.length : end + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j += 1;
      out.push(line.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function parseRpp(text: string): Block {
  const root: Block = { head: [], lines: [], blocks: [] };
  const stack = [root];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('<')) {
      const block: Block = { head: tokenize(line.slice(1)), lines: [], blocks: [] };
      stack[stack.length - 1].blocks.push(block);
      stack.push(block);
    } else if (line === '>') {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].lines.push(tokenize(line));
    }
  }
  return root;
}

const line = (b: Block, key: string) => b.lines.find((l) => l[0] === key) || null;
const n = (v: string | undefined, d = 0) => {
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : d;
};

export async function readReaper(filePath: string): Promise<Project> {
  const text = await fsp.readFile(filePath, 'utf8');
  const root = parseRpp(text);
  const rp = root.blocks.find((b) => b.head[0] === 'REAPER_PROJECT');
  if (!rp) throw new Error('This does not look like a REAPER project (no REAPER_PROJECT block).');

  const project = emptyProject(nodePath.basename(filePath, nodePath.extname(filePath)), 'REAPER');
  const finder = new FileFinder(nodePath.dirname(filePath));

  const tempo = line(rp, 'TEMPO');
  if (tempo) {
    if (n(tempo[1]) > 0) project.bpm = n(tempo[1]);
    project.timeSignature = [n(tempo[2], 4) || 4, n(tempo[3], 4) || 4];
  }
  const tempoEnv = rp.blocks.find((b) => b.head[0] === 'TEMPOENVEX');
  if (tempoEnv && tempoEnv.lines.filter((l) => l[0] === 'PT').length > 1) {
    project.warnings.push(`Tempo changes found — the converted project uses a constant ${project.bpm} BPM.`);
  }

  for (const l of rp.lines) {
    if (l[0] !== 'MARKER') continue;
    const name = l[3] || `Marker ${l[1]}`;
    const isRegionEnd = (n(l[4]) & 1) === 1 && !l[3];
    if (isRegionEnd) continue;
    project.markers.push({ name, time: secondsToBeats(n(l[2]), project.bpm) });
  }

  for (const tb of rp.blocks.filter((b) => b.head[0] === 'TRACK')) {
    const volpan = line(tb, 'VOLPAN');
    const mutesolo = line(tb, 'MUTESOLO');
    const peakcol = line(tb, 'PEAKCOL');
    const track: Track = {
      name: line(tb, 'NAME')?.[1] || 'Track',
      kind: 'audio',
      volume: clamp(n(volpan?.[1], 1), 0, 4),
      pan: clamp(n(volpan?.[2], 0), -1, 1),
      mute: n(mutesolo?.[1]) === 1,
      color: reaperColor(n(peakcol?.[1], 0)),
      clips: []
    };
    const isFolder = n(line(tb, 'ISBUS')?.[1]) === 1;
    if (isFolder) project.warnings.push(`Folder "${track.name}" was flattened — its tracks are converted individually.`);
    if (tb.blocks.some((b) => b.head[0] === 'FXCHAIN' && b.blocks.length)) {
      project.warnings.push('Instruments and effects are not converted — re-insert them in the new DAW.');
    }

    readEnvelopes(tb, track, project);

    let midi = 0;
    let audio = 0;
    for (const ib of tb.blocks.filter((b) => b.head[0] === 'ITEM')) {
      const clip = await itemToClip(ib, project, finder, track.name);
      if (!clip) continue;
      if (clip.kind === 'midi') midi += 1;
      else audio += 1;
      track.clips.push(clip);
    }
    if (midi && audio) project.warnings.push(`"${track.name}" mixes audio and MIDI items — it is converted as a MIDI track; the audio stays on it.`);
    track.kind = midi > audio ? 'midi' : 'audio';
    if (isFolder && !track.clips.length) continue;
    project.tracks.push(track);
  }
  return project;
}

function reaperColor(value: number): string | null {
  // REAPER stores 0x01bbggrr with the high bit set when a custom colour is on.
  if (!(value & 0x1000000)) return null;
  const r = value & 0xff;
  const g = (value >> 8) & 0xff;
  const b = (value >> 16) & 0xff;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

async function itemToClip(ib: Block, project: Project, finder: FileFinder, trackName: string): Promise<AudioClip | MidiClip | null> {
  const posSec = n(line(ib, 'POSITION')?.[1]);
  const lenSec = n(line(ib, 'LENGTH')?.[1]);
  const soffs = n(line(ib, 'SOFFS')?.[1]);
  const rate = n(line(ib, 'PLAYRATE')?.[1], 1);
  const mute = n(line(ib, 'MUTE')?.[1]) === 1;
  const name = line(ib, 'NAME')?.[1] || '';
  if (lenSec <= 0) return null;
  if (mute) project.warnings.push(`Muted item "${name || 'item'}" on "${trackName}" was converted unmuted.`);
  if (Math.abs(rate - 1) > 1e-4) project.warnings.push(`"${name || 'item'}" on "${trackName}" has a play rate of ${rate} — it is converted at normal speed.`);

  // A SECTION source wraps the real one.
  let source = ib.blocks.find((b) => b.head[0] === 'SOURCE') || null;
  let sectionOffset = 0;
  while (source && source.head[1] === 'SECTION') {
    sectionOffset += n(line(source, 'STARTPOS')?.[1]);
    source = source.blocks.find((b) => b.head[0] === 'SOURCE') || null;
  }
  if (!source) return null;

  const start = secondsToBeats(posSec, project.bpm);
  const length = secondsToBeats(lenSec, project.bpm);
  const type = source.head[1];

  if (type === 'MIDI') {
    const hasData = line(source, 'HASDATA');
    if (!hasData) {
      project.warnings.push(`MIDI item "${name || 'item'}" uses an external MIDI file and was skipped.`);
      return null;
    }
    const tpq = n(hasData[2], 960) || 960;
    const offsetBeats = secondsToBeats(soffs + sectionOffset, project.bpm);
    const notes: Note[] = [];
    const open = new Map<number, { tick: number; vel: number }>();
    let tick = 0;
    for (const l of source.lines) {
      if (l[0] !== 'E' && l[0] !== 'e') continue;
      tick += n(l[1]);
      const status = parseInt(l[2], 16);
      const d1 = parseInt(l[3], 16);
      const d2 = parseInt(l[4], 16);
      const kind = status & 0xf0;
      const key = ((status & 0x0f) << 8) | d1;
      if (kind === 0x90 && d2 > 0) open.set(key, { tick, vel: d2 });
      else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const on = open.get(key);
        if (!on) continue;
        open.delete(key);
        const s = on.tick / tpq - offsetBeats;
        const e = Math.min(tick / tpq - offsetBeats, length);
        if (s < -1e-9 || s >= length || e <= s) continue;
        notes.push({ start: s, length: e - s, pitch: d1, velocity: clamp(on.vel, 1, 127) });
      }
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return { kind: 'midi', name, start, length, notes };
  }

  const fileLine = line(source, 'FILE');
  const stored = fileLine?.[1] || '';
  const fileName = nodePath.basename(stored.replace(/\\/g, '/'));
  const file = await finder.resolve([stored], fileName);
  if (!file) project.warnings.push(`Audio file not found: ${fileName || '(unnamed)'} on "${trackName}".`);
  const vol = line(ib, 'VOLPAN');
  return {
    kind: 'audio',
    name: name || fileName.replace(/\.[^.]+$/, ''),
    start,
    length,
    file,
    fileName,
    offset: Math.max(0, soffs + sectionOffset),
    gain: clamp(n(vol?.[1], 1), 0, 8)
  };
}

function readEnvelopes(tb: Block, track: Track, project: Project): void {
  let other = 0;
  let curved = false;
  for (const env of tb.blocks) {
    const kind = ENVELOPES[env.head[0]];
    if (!kind) continue;
    if (n(line(env, 'ACT')?.[1], 1) === 0) continue; // envelope switched off
    if (kind === 'volume' && n(line(env, 'VOLTYPE')?.[1]) === 1) {
      project.warnings.push(`Volume automation on "${track.name}" uses fader scaling and was not converted.`);
      continue;
    }
    const points: AutoPoint[] = [];
    const pts = env.lines.filter((l) => l[0] === 'PT');
    pts.forEach((l, i) => {
      const time = secondsToBeats(n(l[1]), project.bpm);
      const raw = n(l[2]);
      const shape = n(l[3]);
      let value: number;
      if (kind === 'volume') value = clamp(raw, 0, 4);
      else if (kind === 'pan') value = clamp(raw * PAN_ENV_SIGN, -1, 1);
      else value = Math.abs(raw - MUTE_ENV_MUTED) < 0.5 ? 1 : 0;
      points.push({ time, value });
      // Shape 1 is "square": hold until the next point.
      const next = pts[i + 1];
      if (shape === 1 && next && kind !== 'mute') points.push({ time: secondsToBeats(n(next[1]), project.bpm), value });
      if (shape !== 0 && shape !== 1) curved = true;
    });
    setLane(track, kind, points);
  }
  const countOther = (b: Block) => {
    for (const child of b.blocks) {
      const name = child.head[0];
      if (!ENVELOPES[name] && /ENV/.test(name) && child.lines.some((l) => l[0] === 'PT')) other += 1;
      countOther(child);
    }
  };
  countOther(tb);
  if (curved) project.warnings.push(`Curved automation on "${track.name}" was converted as straight ramps.`);
  if (other) {
    project.warnings.push(`${other} automation lane(s) on "${track.name}" (plug-ins, sends, width, pre-FX or take envelopes) were not converted — only volume, pan and mute automation is.`);
  }
}

/* ================================================================== */
/* write                                                              */
/* ================================================================== */

const SOURCE_TYPES: Record<string, string> = {
  '.wav': 'WAVE',
  '.wave': 'WAVE',
  '.aif': 'WAVE',
  '.aiff': 'WAVE',
  '.mp3': 'MP3',
  '.flac': 'FLAC',
  '.ogg': 'VORBIS',
  '.opus': 'OPUS'
};

const TPQ = 960;

function q(value: string): string {
  // RPP picks whichever quote the string doesn't contain.
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `\`${value.replace(/`/g, "'")}\``;
}

function f(x: number): string {
  return String(Math.round(x * 1e10) / 1e10);
}

export function writeReaperText(project: Project): string {
  const out: string[] = [];
  out.push('<REAPER_PROJECT 0.1 "7.0/daw-buddy" 0');
  out.push(`  TEMPO ${f(project.bpm)} ${project.timeSignature[0]} ${project.timeSignature[1]}`);
  project.markers.forEach((m, i) => {
    out.push(`  MARKER ${i + 1} ${f(beatsToSeconds(m.time, project.bpm))} ${q(m.name)} 0 0 1`);
  });

  for (const track of project.tracks) {
    out.push('  <TRACK');
    out.push(`    NAME ${q(track.name)}`);
    if (track.color) {
      const hex = parseInt(track.color.slice(1), 16);
      const r = (hex >> 16) & 0xff;
      const g = (hex >> 8) & 0xff;
      const b = hex & 0xff;
      out.push(`    PEAKCOL ${(0x1000000 | (b << 16) | (g << 8) | r) >>> 0}`);
    }
    out.push(`    VOLPAN ${f(track.volume)} ${f(track.pan)} -1 -1 1`);
    out.push(`    MUTESOLO ${track.mute ? 1 : 0} 0 0`);
    const auto = track.automation || {};
    for (const [block, kind] of Object.entries(ENVELOPES)) {
      const lane = auto[kind];
      if (!lane || !lane.length) continue;
      const hold = kind === 'mute';
      out.push(`    <${block}`);
      out.push('      ACT 1 -1');
      out.push('      VIS 1 1 1');
      out.push('      LANEHEIGHT 0 0');
      out.push('      ARM 0');
      out.push(`      DEFSHAPE ${hold ? 1 : 0} -1 -1`);
      for (const p of lane) {
        const sec = f(beatsToSeconds(p.time, project.bpm));
        let v: number;
        if (kind === 'volume') v = p.value;
        else if (kind === 'pan') v = p.value * PAN_ENV_SIGN;
        else v = p.value >= 0.5 ? MUTE_ENV_MUTED : 1 - MUTE_ENV_MUTED;
        out.push(`      PT ${sec} ${f(v)} ${hold ? 1 : 0}`);
      }
      out.push('    >');
    }
    for (const clip of track.clips) {
      out.push('    <ITEM');
      out.push(`      POSITION ${f(beatsToSeconds(clip.start, project.bpm))}`);
      out.push(`      LENGTH ${f(beatsToSeconds(clip.length, project.bpm))}`);
      out.push(`      NAME ${q(clip.name || (clip.kind === 'audio' ? clip.fileName : 'MIDI'))}`);
      if (clip.kind === 'audio') {
        out.push(`      SOFFS ${f(clip.offset)}`);
        out.push(`      VOLPAN ${f(clip.gain)} 0 1 -1`);
        const type = SOURCE_TYPES[nodePath.extname(clip.fileName).toLowerCase()] || 'WAVE';
        out.push(`      <SOURCE ${type}`);
        out.push(`        FILE ${q(clip.file || clip.fileName)}`);
        out.push('      >');
      } else {
        out.push('      <SOURCE MIDI');
        out.push(`        HASDATA 1 ${TPQ} QN`);
        const events: { tick: number; bytes: number[]; order: number }[] = [];
        for (const note of clip.notes) {
          const on = Math.round(note.start * TPQ);
          const off = Math.max(on + 1, Math.round((note.start + note.length) * TPQ));
          events.push({ tick: on, bytes: [0x90, note.pitch, note.velocity], order: 1 });
          events.push({ tick: off, bytes: [0x80, note.pitch, 0], order: 0 });
        }
        events.sort((a, b) => a.tick - b.tick || a.order - b.order);
        let last = 0;
        for (const e of events) {
          out.push(`        E ${e.tick - last} ${e.bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
          last = e.tick;
        }
        const end = Math.max(last, Math.round(clip.length * TPQ));
        out.push(`        E ${end - last} b0 7b 00`);
        out.push('      >');
      }
      out.push('    >');
    }
    out.push('  >');
  }
  out.push('>');
  return out.join('\n') + '\n';
}

export async function writeReaper(project: Project, outFile: string): Promise<string[]> {
  await fsp.writeFile(outFile, writeReaperText(project), 'utf8');
  return [];
}
