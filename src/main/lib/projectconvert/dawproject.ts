'use strict';

/**
 * DAWproject (.dawproject) — the open interchange format from Bitwig and
 * PreSonus. Read and written here.
 *
 * Opens in Bitwig Studio, Studio One (6.5+), Cubase and Nuendo (14+), and a
 * growing list of others. It is a zip holding project.xml, metadata.xml and
 * (usually) the audio itself, so the result is one self-contained file.
 *
 * Spec: https://github.com/bitwig/dawproject
 */

import fsp from 'fs/promises';
import os from 'os';
import nodePath from 'path';
import crypto from 'crypto';
import { parseXml, child, children, findAll, num, attrs, escapeXml, XmlNode } from './xml';
import { Project, Track, Clip, Note, AudioClip, emptyProject, secondsToBeats, beatsToSeconds, clamp } from './model';
import { ZipWriter } from './zipwriter';
import { audioInfo } from './audio';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const zip = require('../zipreader');

const AUDIO_LIMIT = 2 * 1024 * 1024 * 1024;

/* ================================================================== */
/* read                                                               */
/* ================================================================== */

export async function readDawproject(filePath: string): Promise<Project> {
  const buf = await fsp.readFile(filePath);
  const entries = zip.listEntries(buf);
  if (!entries) throw new Error('Not a DAWproject file (not a zip archive).');
  const projectEntry = entries.find((e: any) => e.name === 'project.xml');
  if (!projectEntry) throw new Error('Not a DAWproject file (no project.xml inside).');
  const xmlBuf = zip.readEntry(buf, projectEntry, 256 * 1024 * 1024);
  if (!xmlBuf) throw new Error('Could not unpack project.xml.');

  const doc = parseXml(xmlBuf.toString('utf8'));
  const root = child(doc, 'Project');
  if (!root) throw new Error('project.xml has no Project element.');

  const project = emptyProject(nodePath.basename(filePath, nodePath.extname(filePath)), 'DAWproject');
  const transport = child(root, 'Transport');
  const tempo = num(child(transport, 'Tempo')?.attrs.value, 0);
  if (tempo > 0) project.bpm = tempo;
  const sig = child(transport, 'TimeSignature');
  if (sig) project.timeSignature = [num(sig.attrs.numerator, 4), num(sig.attrs.denominator, 4)];

  /* tracks by id */
  const byId = new Map<string, Track>();
  const order: Track[] = [];
  const visitTracks = (node: XmlNode | null) => {
    for (const t of children(node, 'Track')) {
      const channel = child(t, 'Channel');
      const role = channel?.attrs.role;
      const hasChildren = children(t, 'Track').length > 0;
      if (role !== 'master' && !hasChildren) {
        const track = trackFromXml(t, channel);
        byId.set(t.attrs.id, track);
        if (channel?.attrs.id) byId.set(channel.attrs.id, track);
        order.push(track);
      } else if (hasChildren) {
        project.warnings.push(`Folder "${t.attrs.name || 'Group'}" was flattened — its tracks are converted individually.`);
      }
      visitTracks(t);
    }
  };
  visitTracks(child(root, 'Structure'));

  /* audio inside the zip is extracted next to the OS temp folder */
  const extractDir = nodePath.join(os.tmpdir(), 'daw-buddy-convert', crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 12));
  const extracted = new Map<string, string>();
  const resolveFile = async (fileNode: XmlNode | null): Promise<{ file: string | null; fileName: string }> => {
    const p = fileNode?.attrs.path || '';
    const fileName = nodePath.basename(p.replace(/\\/g, '/'));
    if (!p) return { file: null, fileName };
    if (fileNode?.attrs.external === 'true') {
      const full = nodePath.isAbsolute(p) ? p : nodePath.join(nodePath.dirname(filePath), p);
      try {
        await fsp.access(full);
        return { file: full, fileName };
      } catch {
        return { file: null, fileName };
      }
    }
    if (extracted.has(p)) return { file: extracted.get(p) as string, fileName };
    const entry = entries.find((e: any) => e.name === p);
    const data = entry ? zip.readEntry(buf, entry, AUDIO_LIMIT) : null;
    if (!data) return { file: null, fileName };
    const out = nodePath.join(extractDir, p);
    await fsp.mkdir(nodePath.dirname(out), { recursive: true });
    await fsp.writeFile(out, data);
    extracted.set(p, out);
    return { file: out, fileName };
  };

  /* arrangement */
  const arrangement = child(root, 'Arrangement');
  for (const m of findAll(child(arrangement, 'Markers'), 'Marker')) {
    project.markers.push({ name: m.attrs.name || 'Marker', time: num(m.attrs.time) });
  }
  if (child(arrangement, 'TempoAutomation') && findAll(child(arrangement, 'TempoAutomation'), 'RealPoint').length > 1) {
    project.warnings.push(`Tempo changes found — the converted project uses a constant ${project.bpm} BPM.`);
  }

  const walkLanes = async (node: XmlNode, trackId: string | null, unit: string) => {
    const myUnit = node.attrs.timeUnit || unit;
    const myTrack = node.attrs.track || trackId;
    for (const c of node.children) {
      if (c.name === 'Lanes') await walkLanes(c, myTrack, myUnit);
      else if (c.name === 'Clips') {
        const track = myTrack ? byId.get(myTrack) : null;
        if (!track) continue;
        for (const clipNode of children(c, 'Clip')) {
          track.clips.push(...(await clipsFromXml(clipNode, 0, myUnit, project, resolveFile)));
        }
      } else if (c.name === 'Points' && c.children.length > 1) {
        project.warnings.push('Automation is not converted.');
      }
    }
  };
  for (const lanes of children(arrangement, 'Lanes')) await walkLanes(lanes, null, 'beats');

  project.tracks = order;
  if (findAll(child(root, 'Structure'), 'Devices').some((d) => d.children.length)) {
    project.warnings.push('Instruments and effects are not converted — re-insert them in the new DAW.');
  }
  return project;
}

function trackFromXml(t: XmlNode, channel: XmlNode | null): Track {
  const contentType = t.attrs.contentType || '';
  const vol = child(channel, 'Volume');
  let volume = num(vol?.attrs.value, 1);
  if (vol?.attrs.unit === 'decibel') volume = 10 ** (volume / 20);
  const panNode = child(channel, 'Pan');
  let pan = num(panNode?.attrs.value, 0.5);
  if (!panNode || panNode.attrs.unit === 'normalized' || !panNode.attrs.unit) pan = pan * 2 - 1;
  return {
    name: t.attrs.name || 'Track',
    kind: contentType.includes('notes') && !contentType.includes('audio') ? 'midi' : contentType.includes('audio') ? 'audio' : 'midi',
    volume: clamp(volume, 0, 4),
    pan: clamp(pan, -1, 1),
    mute: child(channel, 'Mute')?.attrs.value === 'true',
    color: /^#[0-9a-f]{6}$/i.test(t.attrs.color || '') ? t.attrs.color.toLowerCase() : null,
    clips: []
  };
}

async function clipsFromXml(
  clipNode: XmlNode,
  parentOffset: number,
  unit: string,
  project: Project,
  resolveFile: (n: XmlNode | null) => Promise<{ file: string | null; fileName: string }>
): Promise<Clip[]> {
  const toBeats = (v: number) => (unit === 'seconds' ? secondsToBeats(v, project.bpm) : v);
  const start = parentOffset + toBeats(num(clipNode.attrs.time));
  const length = toBeats(num(clipNode.attrs.duration));
  const playStart = num(clipNode.attrs.playStart);
  const name = clipNode.attrs.name || '';
  if (clipNode.attrs.enable === 'false') return [];
  if (clipNode.attrs.loopEnd !== undefined && num(clipNode.attrs.loopEnd) - num(clipNode.attrs.loopStart) < length - 1e-6) {
    project.warnings.push(`Looped clip "${name || 'clip'}" was converted as a single pass.`);
  }

  const out: Clip[] = [];

  // Nested clips (a clip containing Clips) — offset into the parent.
  const nested = child(clipNode, 'Clips');
  if (nested) {
    for (const c of children(nested, 'Clip')) out.push(...(await clipsFromXml(c, start - playStart, unit, project, resolveFile)));
    return out;
  }

  const notesNode = child(clipNode, 'Notes') || findAll(child(clipNode, 'Lanes'), 'Notes')[0] || null;
  if (notesNode) {
    const notes: Note[] = [];
    for (const n of children(notesNode, 'Note')) {
      const t = num(n.attrs.time) - playStart;
      if (t < -1e-9 || t >= length) continue;
      notes.push({
        start: t,
        length: Math.min(num(n.attrs.duration), length - t),
        pitch: clamp(Math.round(num(n.attrs.key, 60)), 0, 127),
        velocity: clamp(Math.round(num(n.attrs.vel, 0.8) * 127), 1, 127)
      });
    }
    out.push({ kind: 'midi', name, start, length, notes });
    return out;
  }

  const warps = child(clipNode, 'Warps');
  const audioNode = child(warps, 'Audio') || child(clipNode, 'Audio');
  if (audioNode) {
    const { file, fileName } = await resolveFile(child(audioNode, 'File'));
    if (!file) project.warnings.push(`Audio file not found: ${fileName || '(unnamed)'}.`);
    let offset: number;
    if (warps) {
      const points = children(warps, 'Warp').map((w) => ({ t: num(w.attrs.time), c: num(w.attrs.contentTime) }));
      const warpSec = warps.attrs.contentTimeUnit !== 'beats';
      offset = interpolate(points, playStart);
      if (!warpSec) offset = beatsToSeconds(offset, project.bpm);
      if (points.length >= 2) {
        const a = points[0];
        const b = points[points.length - 1];
        const rate = (b.c - a.c) / Math.max(1e-9, b.t - a.t);
        const expected = warpSec ? 60 / project.bpm : 1;
        if (Math.abs(rate / expected - 1) > 0.002) {
          project.warnings.push(`"${name || fileName}" is time-stretched — it is placed correctly but plays at its original speed.`);
        }
      }
    } else {
      const contentUnit = clipNode.attrs.contentTimeUnit || unit;
      offset = contentUnit === 'seconds' ? playStart : beatsToSeconds(playStart, project.bpm);
    }
    const clip: AudioClip = { kind: 'audio', name: name || fileName.replace(/\.[^.]+$/, ''), start, length, file, fileName, offset: Math.max(0, offset), gain: 1 };
    out.push(clip);
  }
  return out;
}

function interpolate(points: { t: number; c: number }[], t: number): number {
  if (!points.length) return t;
  if (points.length === 1) return points[0].c + (t - points[0].t);
  let i = 0;
  while (i < points.length - 2 && t > points[i + 1].t) i += 1;
  const a = points[i];
  const b = points[i + 1];
  if (Math.abs(b.t - a.t) < 1e-9) return a.c;
  return a.c + ((t - a.t) * (b.c - a.c)) / (b.t - a.t);
}

/* ================================================================== */
/* write                                                              */
/* ================================================================== */

export interface DawprojectOptions {
  /** Copy audio into the file (self-contained) or reference it in place. */
  embedAudio?: boolean;
}

export async function writeDawproject(project: Project, outFile: string, options: DawprojectOptions = {}): Promise<string[]> {
  const embed = options.embedAudio !== false;
  const notes: string[] = [];
  let nextId = 0;
  const id = () => `id${nextId++}`;
  const zipOut = new ZipWriter();
  const embedded = new Map<string, string>(); // source path → zip path
  const usedNames = new Set<string>();
  let embeddedBytes = 0;

  const fileRef = async (clip: AudioClip) => {
    if (!clip.file) return { path: clip.fileName, external: true };
    if (!embed) return { path: clip.file, external: true };
    if (embedded.has(clip.file)) return { path: embedded.get(clip.file) as string, external: false };
    const data = await fsp.readFile(clip.file);
    embeddedBytes += data.length;
    if (embeddedBytes > AUDIO_LIMIT) {
      notes.push(`Audio over 2 GB — "${clip.fileName}" is referenced in place rather than embedded.`);
      return { path: clip.file, external: true };
    }
    let name = nodePath.basename(clip.file);
    let n = 2;
    while (usedNames.has(name.toLowerCase())) name = nodePath.basename(clip.file).replace(/(\.[^.]+)?$/, ` ${n++}$1`);
    usedNames.add(name.toLowerCase());
    const zipPath = `audio/${name}`;
    zipOut.add(zipPath, data, false);
    embedded.set(clip.file, zipPath);
    return { path: zipPath, external: false };
  };

  const masterChannelId = id();
  const structure: string[] = [];
  const lanes: string[] = [];

  for (const track of project.tracks) {
    const trackId = id();
    const channelId = id();
    structure.push(
      `    <Track${attrs({ contentType: track.kind === 'audio' ? 'audio' : 'notes', loaded: 'true', id: trackId, name: track.name, color: track.color || undefined })}>\n` +
        `      <Channel${attrs({ audioChannels: 2, destination: masterChannelId, role: 'regular', solo: 'false', id: channelId })}>\n` +
        `        <Mute${attrs({ value: track.mute, id: id(), name: 'Mute' })}/>\n` +
        `        <Pan${attrs({ max: 1, min: 0, unit: 'normalized', value: fmt((track.pan + 1) / 2), id: id(), name: 'Pan' })}/>\n` +
        `        <Volume${attrs({ max: 2, min: 0, unit: 'linear', value: fmt(track.volume), id: id(), name: 'Volume' })}/>\n` +
        `      </Channel>\n` +
        `    </Track>`
    );

    const clipXml: string[] = [];
    for (const clip of track.clips) {
      if (clip.kind === 'midi') {
        const noteXml = clip.notes
          .map((n) => `            <Note${attrs({ time: fmt(n.start), duration: fmt(n.length), channel: 0, key: n.pitch, vel: fmt(n.velocity / 127), rel: '0.5' })}/>`)
          .join('\n');
        clipXml.push(
          `        <Clip${attrs({ time: fmt(clip.start), duration: fmt(clip.length), playStart: '0', name: clip.name || undefined })}>\n` +
            `          <Notes${attrs({ id: id() })}>\n${noteXml}${noteXml ? '\n' : ''}          </Notes>\n` +
            `        </Clip>`
        );
      } else {
        const ref = await fileRef(clip);
        const info = clip.file ? await audioInfo(clip.file) : null;
        const lengthSec = beatsToSeconds(clip.length, project.bpm);
        clipXml.push(
          `        <Clip${attrs({ time: fmt(clip.start), duration: fmt(clip.length), playStart: '0', name: clip.name || undefined })}>\n` +
            `          <Warps${attrs({ contentTimeUnit: 'seconds', timeUnit: 'beats', id: id() })}>\n` +
            `            <Audio${attrs({ algorithm: 'raw', channels: info?.channels || 2, duration: fmt(info?.duration || clip.offset + lengthSec), sampleRate: info?.sampleRate || 44100, id: id() })}>\n` +
            `              <File${attrs({ path: ref.path, external: ref.external ? 'true' : undefined })}/>\n` +
            `            </Audio>\n` +
            `            <Warp${attrs({ time: '0', contentTime: fmt(clip.offset) })}/>\n` +
            `            <Warp${attrs({ time: fmt(clip.length), contentTime: fmt(clip.offset + lengthSec) })}/>\n` +
            `          </Warps>\n` +
            `        </Clip>`
        );
        if (Math.abs(clip.gain - 1) > 1e-3) notes.push('Clip gain is not part of DAWproject 1.0 — clip gain was dropped.');
      }
    }
    lanes.push(
      `      <Lanes${attrs({ track: trackId, id: id() })}>\n` +
        `        <Clips${attrs({ id: id() })}>\n${clipXml.join('\n')}${clipXml.length ? '\n' : ''}        </Clips>\n` +
        `      </Lanes>`
    );
  }

  structure.push(
    `    <Track${attrs({ contentType: 'audio notes', loaded: 'true', id: id(), name: 'Master' })}>\n` +
      `      <Channel${attrs({ audioChannels: 2, role: 'master', solo: 'false', id: masterChannelId })}>\n` +
      `        <Mute${attrs({ value: 'false', id: id(), name: 'Mute' })}/>\n` +
      `        <Pan${attrs({ max: 1, min: 0, unit: 'normalized', value: '0.5', id: id(), name: 'Pan' })}/>\n` +
      `        <Volume${attrs({ max: 2, min: 0, unit: 'linear', value: '1', id: id(), name: 'Volume' })}/>\n` +
      `      </Channel>\n` +
      `    </Track>`
  );

  const markerXml = project.markers.length
    ? `    <Markers${attrs({ id: id() })}>\n${project.markers
        .map((m) => `      <Marker${attrs({ time: fmt(m.time), name: m.name })}/>`)
        .join('\n')}\n    </Markers>\n`
    : '';

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Project version="1.0">\n` +
    `  <Application name="DAW Buddy" version="1.0"/>\n` +
    `  <Transport>\n` +
    `    <Tempo${attrs({ max: 666, min: 20, unit: 'bpm', value: fmt(project.bpm), id: id(), name: 'Tempo' })}/>\n` +
    `    <TimeSignature${attrs({ denominator: project.timeSignature[1], numerator: project.timeSignature[0], id: id() })}/>\n` +
    `  </Transport>\n` +
    `  <Structure>\n${structure.join('\n')}\n  </Structure>\n` +
    `  <Arrangement${attrs({ id: id() })}>\n` +
    markerXml +
    `    <Lanes${attrs({ timeUnit: 'beats', id: id() })}>\n${lanes.join('\n')}\n    </Lanes>\n` +
    `  </Arrangement>\n` +
    `  <Scenes/>\n` +
    `</Project>\n`;

  const metadata =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<MetaData>\n  <Title>${escapeXml(project.name)}</Title>\n  <Comment>Converted from ${escapeXml(project.source)} by DAW Buddy</Comment>\n</MetaData>\n`;

  zipOut.add('project.xml', Buffer.from(xml, 'utf8'));
  zipOut.add('metadata.xml', Buffer.from(metadata, 'utf8'));
  await fsp.writeFile(outFile, zipOut.toBuffer());
  return [...new Set(notes)];
}

function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}
