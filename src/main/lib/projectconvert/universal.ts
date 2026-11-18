'use strict';

/**
 * The "works in any DAW" pack: one multitrack MIDI file plus one WAV stem per
 * audio track, every stem starting at bar 1.
 *
 * Ableton Live, FL Studio, Logic Pro, Pro Tools and the rest all open a
 * Standard MIDI File with its tempo, time signature, markers and named tracks,
 * and all of them line up a stack of same-length WAVs when you drop them at
 * the start of the timeline. That's the format every DAW can import, so it is
 * the honest route into the DAWs whose project files are closed.
 */

import fsp from 'fs/promises';
import nodePath from 'path';
import { Project, AudioClip, AutoPoint, Automation, beatsToSeconds, projectLength } from './model';

/**
 * Reads a lane at steadily increasing times without rescanning it from the
 * start — a stem asks for a value every sample.
 */
export function laneCursor(points: AutoPoint[], hold: boolean): (time: number) => number {
  let i = 0;
  return (time: number) => {
    while (i < points.length && points[i].time <= time) i += 1;
    if (i === 0) return points[0].value;
    if (i >= points.length) return points[points.length - 1].value;
    const a = points[i - 1];
    const b = points[i];
    if (hold || b.time - a.time < 1e-12) return a.value;
    return a.value + ((time - a.time) * (b.value - a.value)) / (b.time - a.time);
  };
}
import { decodeWav, encodeWavFloat, Decoded } from './audio';

/* ------------------------------ MIDI ------------------------------- */

const TPQ = 960;

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function textEvent(type: number, text: string): number[] {
  const data = [...Buffer.from(text, 'utf8')];
  return [0xff, type, ...vlq(data.length), ...data];
}

function chunk(events: { tick: number; bytes: number[]; order: number }[]): Buffer {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const head = Buffer.alloc(8);
  head.write('MTrk', 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, Buffer.from(body)]);
}

/** Format 1 SMF: a conductor track, then one track per MIDI track. */
export function projectToMidi(project: Project, warn: (w: string) => void = () => {}): Buffer | null {
  const midiTracks = project.tracks.filter((t) => t.kind === 'midi' && t.clips.length);
  const conductor: { tick: number; bytes: number[]; order: number }[] = [];
  const usPerQuarter = Math.round(60000000 / project.bpm);
  conductor.push({ tick: 0, order: 0, bytes: textEvent(0x03, project.name) });
  conductor.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] });
  const [num, den] = project.timeSignature;
  conductor.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8] });
  for (const m of project.markers) conductor.push({ tick: Math.round(m.time * TPQ), order: 1, bytes: textEvent(0x06, m.name) });

  const chunks = [chunk(conductor)];
  midiTracks.forEach((track, i) => {
    const channel = i % 16 === 9 ? 10 : i % 16; // keep off the GM drum channel
    const events: { tick: number; bytes: number[]; order: number }[] = [];
    events.push({ tick: 0, order: 0, bytes: textEvent(0x03, track.name) });
    for (const clip of track.clips) {
      if (clip.kind !== 'midi') continue;
      for (const n of clip.notes) {
        const on = Math.round((clip.start + n.start) * TPQ);
        const off = Math.max(on + 1, Math.round((clip.start + n.start + n.length) * TPQ));
        events.push({ tick: on, order: 2, bytes: [0x90 | channel, n.pitch, n.velocity] });
        events.push({ tick: off, order: 1, bytes: [0x80 | channel, n.pitch, 0] });
      }
    }
    events.push(...controllerEvents(track.automation, channel));
    if (track.automation?.mute?.length) {
      warn(`Mute automation on MIDI track "${track.name}" can't be stored in a MIDI file and was left out.`);
    }
    chunks.push(chunk(events));
  });

  const header = Buffer.alloc(14);
  header.write('MThd', 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(chunks.length, 10);
  header.writeUInt16BE(TPQ, 12);
  return midiTracks.length || project.markers.length ? Buffer.concat([header, ...chunks]) : null;
}

/*
 * Volume → CC7 and pan → CC10, the two controllers every DAW and General MIDI
 * instrument understands. CC7 follows the GM curve (dB = 40·log10(cc/127)),
 * so cc = 127·sqrt(gain); anything above unity is capped at 127. Ramps are
 * sampled every 1/32 note and only changes are written.
 */
function controllerEvents(automation: Automation | undefined, channel: number) {
  const out: { tick: number; bytes: number[]; order: number }[] = [];
  const lanes: [AutoPoint[] | undefined, number, (v: number) => number][] = [
    [automation?.volume, 7, (g) => Math.round(127 * Math.sqrt(Math.max(0, g)))],
    [automation?.pan, 10, (p) => Math.round(64 + p * 63)]
  ];
  for (const [lane, cc, toCc] of lanes) {
    if (!lane || !lane.length) continue;
    const read = laneCursor(lane, false);
    const step = 1 / 8; // beats
    const end = lane[lane.length - 1].time;
    let last = -1;
    for (let t = 0; t <= end + step; t += step) {
      const tt = Math.min(t, end);
      const v = Math.min(127, Math.max(0, toCc(read(tt))));
      if (v !== last) {
        out.push({ tick: Math.round(tt * TPQ), order: 0, bytes: [0xb0 | channel, cc, v] });
        last = v;
      }
    }
  }
  return out;
}

/* ------------------------------ stems ------------------------------ */

/**
 * Render one audio track to a single WAV that starts at bar 1. Clips are
 * placed at their timeline positions with their source offset and clip gain;
 * track fader and pan are NOT applied (stems arrive at unity, and the faders
 * are listed in the report). Returns null when nothing on the track could be
 * rendered.
 */
export async function renderStem(
  clips: AudioClip[],
  project: Project,
  totalSec: number,
  warn: (w: string) => void,
  automation: Automation = {}
): Promise<Buffer | null> {
  const usable = clips.filter((c) => c.file && /\.wave?$/i.test(c.file));
  for (const c of clips) {
    if (!c.file) continue; // already reported as missing by the reader
    if (!/\.wave?$/i.test(c.file)) warn(`"${c.fileName}" is not a WAV, so it was copied to the Audio folder instead of rendered into a stem.`);
  }
  if (!usable.length) return null;

  const decoded = new Map<string, Decoded>();
  for (const c of usable) {
    if (decoded.has(c.file as string)) continue;
    try {
      decoded.set(c.file as string, await decodeWav(c.file as string));
    } catch (err: any) {
      warn(`Could not read "${c.fileName}": ${err.message}`);
    }
  }
  if (!decoded.size) return null;

  // Most common rate wins; anything else is resampled to it.
  const rates = new Map<number, number>();
  for (const d of decoded.values()) rates.set(d.sampleRate, (rates.get(d.sampleRate) || 0) + 1);
  const rate = [...rates.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (rates.size > 1) warn('Clips with different sample rates were resampled to match their track.');
  const stereo = [...decoded.values()].some((d) => d.channels.length > 1);
  // Pan automation needs two channels to pan between.
  const outCh = stereo || automation.pan?.length ? 2 : 1;
  const frames = Math.ceil(totalSec * rate);
  const out = Array.from({ length: outCh }, () => new Float32Array(frames));

  for (const c of usable) {
    const src = decoded.get(c.file as string);
    if (!src) continue;
    const startFrame = Math.round(beatsToSeconds(c.start, project.bpm) * rate);
    const lenFrames = Math.round(beatsToSeconds(c.length, project.bpm) * rate);
    const ratio = src.sampleRate / rate;
    const srcStart = c.offset * src.sampleRate;
    const srcLen = src.channels[0].length;
    for (let ch = 0; ch < outCh; ch += 1) {
      const s = src.channels[Math.min(ch, src.channels.length - 1)];
      const o = out[ch];
      for (let i = 0; i < lenFrames; i += 1) {
        const dst = startFrame + i;
        if (dst >= frames) break;
        const pos = srcStart + i * ratio;
        const p0 = Math.floor(pos);
        if (p0 >= srcLen) break;
        const frac = pos - p0;
        const a = s[p0];
        const b = p0 + 1 < srcLen ? s[p0 + 1] : a;
        o[dst] += (a + (b - a) * frac) * c.gain;
      }
    }
  }
  applyAutomation(out, rate, project.bpm, automation);
  return encodeWavFloat(out, rate);
}

/**
 * Bake volume, pan and mute automation into rendered audio. Pan is a balance
 * control (turning right lowers the left side), the way most DAW stereo
 * channel pans behave.
 */
export function applyAutomation(channels: Float32Array[], rate: number, bpm: number, automation: Automation): void {
  const vol = automation.volume?.length ? laneCursor(automation.volume, false) : null;
  const pan = automation.pan?.length && channels.length === 2 ? laneCursor(automation.pan, false) : null;
  const mute = automation.mute?.length ? laneCursor(automation.mute, true) : null;
  if (!vol && !pan && !mute) return;
  const frames = channels[0].length;
  const beatsPerFrame = bpm / 60 / rate;
  for (let f = 0; f < frames; f += 1) {
    const beat = f * beatsPerFrame;
    let gain = vol ? vol(beat) : 1;
    if (mute && mute(beat) >= 0.5) gain = 0;
    if (pan) {
      const p = pan(beat);
      channels[0][f] *= gain * (p > 0 ? 1 - p : 1);
      channels[1][f] *= gain * (p < 0 ? 1 + p : 1);
    } else {
      for (let c = 0; c < channels.length; c += 1) channels[c][f] *= gain;
    }
  }
}

export async function writeUniversal(project: Project, outDir: string, onProgress?: (msg: string) => void): Promise<string[]> {
  const notes: string[] = [];
  await fsp.mkdir(outDir, { recursive: true });

  const midi = projectToMidi(project, (w) => notes.push(w));
  if (midi) await fsp.writeFile(nodePath.join(outDir, `${safe(project.name)}.mid`), midi);

  const totalSec = beatsToSeconds(projectLength(project), project.bpm) + 0.5;
  const stemsDir = nodePath.join(outDir, 'Stems');
  const audioDir = nodePath.join(outDir, 'Audio');
  let index = 0;
  for (const track of project.tracks) {
    index += 1;
    if (track.kind !== 'audio' || !track.clips.length) continue;
    onProgress?.(`Rendering stem: ${track.name}`);
    const audio = track.clips.filter((c): c is AudioClip => c.kind === 'audio');
    const wav = await renderStem(audio, project, totalSec, (w) => notes.push(w), track.automation);
    if (wav) {
      await fsp.mkdir(stemsDir, { recursive: true });
      await fsp.writeFile(nodePath.join(stemsDir, `${String(index).padStart(2, '0')} ${safe(track.name)}.wav`), wav);
    }
    // Files that couldn't be rendered are still handed over.
    for (const c of audio) {
      if (!c.file || /\.wave?$/i.test(c.file)) continue;
      await fsp.mkdir(audioDir, { recursive: true });
      await fsp.copyFile(c.file, nodePath.join(audioDir, nodePath.basename(c.file))).catch(() => {});
    }
  }

  const mixer = project.tracks
    .map((t) => {
      const a = t.automation || {};
      const how = t.kind === 'audio' ? 'in stem' : 'as CC';
      const vol = a.volume?.length ? `auto (${how})` : gainDb(t.volume);
      const pan = a.pan?.length ? `auto (${how})` : panText(t.pan);
      const mute = a.mute?.length ? (t.kind === 'audio' ? '   mute auto (in stem)' : '') : t.mute ? '   MUTED' : '';
      return `  ${t.name.padEnd(28)} ${vol.padStart(14)}   pan ${pan.padStart(13)}${mute}`;
    })
    .join('\n');
  const readme = `${project.name} — converted from ${project.source} by DAW Buddy

Tempo:          ${Math.round(project.bpm * 1000) / 1000} BPM
Time signature: ${project.timeSignature[0]}/${project.timeSignature[1]}

HOW TO OPEN IN ANY DAW
1. Create a new project and set the tempo to ${Math.round(project.bpm * 1000) / 1000} BPM.
2. Drag everything in "Stems" onto the timeline at bar 1 (the very start).
   Every stem starts at bar 1 — that is what keeps them in sync.
3. Drag "${safe(project.name)}.mid" in at bar 1 for the MIDI parts, tempo and markers.
   - Ableton Live: drag into the Arrangement; each MIDI track becomes its own track.
   - FL Studio: File > Import > MIDI file (tick "Start at bar 1").
   - Logic Pro: File > Import > MIDI File.
   - Pro Tools: File > Import > MIDI (import tempo map from MIDI file).
4. Add instruments to the MIDI tracks and set faders using the table below.

Stems are 32-bit float WAV. Track faders and pan are NOT baked in, so you
keep full control — set them from the table below. The exception is
automation: where a track had volume, pan or mute automation, the moves are
baked into its stem ("in stem" below) — leave that fader at 0 dB and that
pan centred. On MIDI tracks, volume and pan automation is written into the
MIDI file as CC7 / CC10 ("as CC").

MIXER (from the original project)
${mixer}
`;
  await fsp.writeFile(nodePath.join(outDir, 'READ ME — how to open.txt'), readme, 'utf8');
  return [...new Set(notes)];
}

function gainDb(linear: number): string {
  if (linear <= 0) return '-inf dB';
  const db = 20 * Math.log10(linear);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

function panText(pan: number): string {
  if (Math.abs(pan) < 0.005) return 'C';
  return `${Math.round(Math.abs(pan) * 100)}${pan < 0 ? 'L' : 'R'}`;
}

export function safe(name: string): string {
  return (name || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'Untitled';
}
