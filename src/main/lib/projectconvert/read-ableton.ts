'use strict';

/**
 * Ableton Live sets (.als) → neutral project.
 *
 * An .als is gzipped XML. Arrangement clips live under each track's
 * MainSequencer → ArrangerAutomation → Events. Session View clips (the
 * ClipSlotList) are a different thing — a launcher, not a timeline — and are
 * deliberately not converted.
 *
 * The part that takes care is clip CONTENT time. A warped audio clip measures
 * its content in beats and maps beats to seconds through warp markers. An
 * unwarped one measures its content in seconds. Loop brace, start marker and
 * arrangement length then decide which slice of the file plays where — and a
 * looped clip that is longer on the timeline than its loop repeats, so it is
 * unrolled into one clip per pass.
 */

import fsp from 'fs/promises';
import nodePath from 'path';
import zlib from 'zlib';
import { parseXml, child, children, path, findAll, value, num, XmlNode } from './xml';
import { Project, Track, AudioClip, MidiClip, Note, AutoPoint, emptyProject, clamp, setLane } from './model';
import { FileFinder } from './files';

const STRETCH_TOLERANCE = 0.002;

export async function readAbleton(filePath: string): Promise<Project> {
  const raw = await fsp.readFile(filePath);
  const xml = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const doc = parseXml(xml);
  const liveSet = path(doc, 'Ableton', 'LiveSet');
  if (!liveSet) throw new Error('This does not look like an Ableton Live set (no LiveSet element).');

  const project = emptyProject(nodePath.basename(filePath, nodePath.extname(filePath)), 'Ableton Live');
  const finder = new FileFinder(nodePath.dirname(filePath));

  /* tempo + time signature live on the master track's mixer */
  const master = child(liveSet, 'MainTrack') || child(liveSet, 'MasterTrack');
  const masterMixer = path(master, 'DeviceChain', 'Mixer');
  const bpm = num(value(masterMixer, 'Tempo', 'Manual'), 0);
  if (bpm > 0) project.bpm = bpm;
  const tempoEvents = findAll(path(masterMixer, 'Tempo', 'ArrangerAutomation'), 'FloatEvent');
  if (tempoEvents.length > 1) {
    project.warnings.push(
      `Tempo automation found — the converted project uses a constant ${round(project.bpm)} BPM.`
    );
  }
  const sig = num(value(masterMixer, 'TimeSignature', 'Manual'), NaN);
  if (Number.isFinite(sig)) project.timeSignature = decodeTimeSignature(sig);

  const masterOther = envelopesOf(master).filter((env) => {
    const id = pointeeId(env);
    return id !== automationTargetId(path(masterMixer, 'Tempo')) && id !== automationTargetId(path(masterMixer, 'TimeSignature'));
  });
  if (masterOther.length) {
    project.warnings.push(`${masterOther.length} automation lane(s) on the Main track were not converted — only track volume, pan and mute automation is.`);
  }

  /* locators */
  for (const locator of findAll(path(liveSet, 'Locators', 'Locators'), 'Locator')) {
    project.markers.push({
      name: value(locator, 'Name') || 'Marker',
      time: num(value(locator, 'Time'))
    });
  }

  /* tracks */
  const tracksNode = child(liveSet, 'Tracks');
  let sessionOnlyClips = 0;
  for (const trackNode of children(tracksNode)) {
    const kind = trackNode.name;
    const name = trackName(trackNode);

    if (kind === 'GroupTrack') {
      project.warnings.push(`Group "${name}" was flattened — its tracks are converted individually.`);
      continue;
    }
    if (kind === 'ReturnTrack') {
      project.warnings.push(`Return track "${name}" was skipped — effects and sends are not converted.`);
      continue;
    }
    if (kind !== 'AudioTrack' && kind !== 'MidiTrack') continue;

    const mixer = path(trackNode, 'DeviceChain', 'Mixer');
    const track: Track = {
      name,
      kind: kind === 'AudioTrack' ? 'audio' : 'midi',
      volume: clamp(num(value(mixer, 'Volume', 'Manual'), 1), 0, 4),
      pan: clamp(num(value(mixer, 'Pan', 'Manual'), 0), -1, 1),
      mute: value(mixer, 'Speaker', 'Manual') === 'false',
      color: null,
      clips: []
    };

    const sequencer = path(trackNode, 'DeviceChain', 'MainSequencer');
    const arranger = findAll(sequencer, 'ArrangerAutomation')[0] || null;
    const clipName = track.kind === 'audio' ? 'AudioClip' : 'MidiClip';
    const clips = findAll(arranger, clipName);

    sessionOnlyClips += findAll(child(sequencer, 'ClipSlotList'), clipName).length;

    for (const clipNode of clips) {
      if (value(clipNode, 'Disabled') === 'true') {
        project.warnings.push(`A deactivated clip on "${name}" was skipped.`);
        continue;
      }
      if (track.kind === 'audio') {
        track.clips.push(...(await audioClips(clipNode, project, finder, name)));
      } else {
        const clip = midiClip(clipNode);
        if (clip) track.clips.push(clip);
      }
    }

    readTrackAutomation(trackNode, mixer, track, project);

    if (findAll(trackNode, 'PluginDevice').length || findAll(path(trackNode, 'DeviceChain', 'DeviceChain'), 'Devices').some((d) => d.children.length)) {
      project.warnings.push('Instruments and effects (plugins and Live devices) are not converted — re-insert them in the new DAW.');
    }

    project.tracks.push(track);
  }

  if (sessionOnlyClips) {
    project.warnings.push(
      `${sessionOnlyClips} Session View clip(s) were not converted — only the Arrangement timeline is. Record or drag any you need into the Arrangement first.`
    );
  }

  return project;
}

/* ------------------------------------------------------------------ */

function trackName(trackNode: XmlNode): string {
  return (
    value(trackNode, 'Name', 'UserName') ||
    value(trackNode, 'Name', 'EffectiveName') ||
    trackNode.name.replace('Track', ' track')
  );
}

/** Ableton packs time signature as denominatorIndex * 99 + (numerator - 1). */
export function decodeTimeSignature(encoded: number): [number, number] {
  const numerator = (encoded % 99) + 1;
  const denominator = 2 ** Math.floor(encoded / 99);
  if (numerator < 1 || numerator > 99 || ![1, 2, 4, 8, 16, 32].includes(denominator)) return [4, 4];
  return [numerator, denominator];
}

interface Segment {
  arrStart: number; // beats, arrangement
  arrLength: number; // beats, arrangement
  contentStart: number; // content units (beats if warped/midi, seconds if not)
}

/**
 * Which slices of a clip's content play where on the timeline. A clip that is
 * not looping, or is shorter than its loop, is one slice. A looping clip that
 * runs past its loop end repeats from loop start.
 */
export function clipSegments(
  arrStart: number,
  arrLength: number,
  contentStart: number,
  loopStart: number,
  loopEnd: number,
  loopOn: boolean,
  contentPerBeat: number
): Segment[] {
  const segments: Segment[] = [];
  const loopLength = (loopEnd - loopStart) / contentPerBeat; // in beats
  if (!loopOn || loopLength <= 1e-6) {
    return [{ arrStart, arrLength, contentStart }];
  }
  let at = 0;
  let cs = contentStart;
  // First pass runs from the start marker to the loop end.
  let first = (loopEnd - contentStart) / contentPerBeat;
  if (first <= 1e-6) first = loopLength;
  let segLength = Math.min(first, arrLength);
  let guard = 0;
  while (at < arrLength - 1e-6 && guard < 10000) {
    segments.push({ arrStart: arrStart + at, arrLength: segLength, contentStart: cs });
    at += segLength;
    cs = loopStart;
    segLength = Math.min(loopLength, arrLength - at);
    guard += 1;
  }
  return segments;
}

function clipFrame(clipNode: XmlNode) {
  const arrStart = num(clipNode.attrs.Time, num(value(clipNode, 'CurrentStart')));
  const currentStart = num(value(clipNode, 'CurrentStart'), arrStart);
  const currentEnd = num(value(clipNode, 'CurrentEnd'), currentStart);
  const loop = child(clipNode, 'Loop');
  const loopStart = num(value(loop, 'LoopStart'));
  const loopEnd = num(value(loop, 'LoopEnd'), loopStart);
  const startRelative = num(value(loop, 'StartRelative'));
  const loopOn = value(loop, 'LoopOn') === 'true';
  return {
    name: value(clipNode, 'Name') || '',
    arrStart: currentStart,
    arrLength: Math.max(0, currentEnd - currentStart),
    loopStart,
    loopEnd,
    contentStart: loopStart + startRelative,
    loopOn
  };
}

/* ------------------------------ audio ------------------------------ */

interface WarpMarker {
  sec: number;
  beat: number;
}

function warpMarkers(clipNode: XmlNode): WarpMarker[] {
  return findAll(child(clipNode, 'WarpMarkers'), 'WarpMarker')
    .map((m) => ({ sec: num(m.attrs.SecTime), beat: num(m.attrs.BeatTime) }))
    .sort((a, b) => a.beat - b.beat);
}

/** Content beat → seconds in the file, piecewise linear through warp markers. */
export function beatToSec(beat: number, markers: WarpMarker[], bpm: number): number {
  if (!markers.length) return (beat * 60) / bpm;
  if (markers.length === 1) return markers[0].sec + ((beat - markers[0].beat) * 60) / bpm;
  let i = 0;
  while (i < markers.length - 2 && beat > markers[i + 1].beat) i += 1;
  const a = markers[i];
  const b = markers[i + 1];
  const span = b.beat - a.beat;
  if (Math.abs(span) < 1e-9) return a.sec;
  return a.sec + ((beat - a.beat) * (b.sec - a.sec)) / span;
}

async function audioClips(clipNode: XmlNode, project: Project, finder: FileFinder, trackName: string): Promise<AudioClip[]> {
  const frame = clipFrame(clipNode);
  if (frame.arrLength <= 0) return [];

  const warped = value(clipNode, 'IsWarped') === 'true';
  const markers = warped ? warpMarkers(clipNode) : [];
  const contentPerBeat = warped ? 1 : 60 / project.bpm;

  const { file, fileName } = await resolveSample(clipNode, finder);
  if (!file) project.warnings.push(`Audio file not found: ${fileName || '(unnamed)'} on "${trackName}".`);

  const gain = clamp(num(value(clipNode, 'SampleVolume'), 1), 0, 8);
  const segments = clipSegments(
    frame.arrStart,
    frame.arrLength,
    frame.contentStart,
    frame.loopStart,
    frame.loopEnd,
    frame.loopOn,
    contentPerBeat
  );

  const toSec = (content: number) => (warped ? beatToSec(content, markers, project.bpm) : content);

  if (warped && markers.length >= 2) {
    const s0 = toSec(frame.contentStart);
    const s1 = toSec(frame.contentStart + Math.min(frame.arrLength, 4));
    const playedSec = s1 - s0;
    const wallSec = (Math.min(frame.arrLength, 4) * 60) / project.bpm;
    if (wallSec > 0 && Math.abs(playedSec / wallSec - 1) > STRETCH_TOLERANCE) {
      project.warnings.push(
        `"${frame.name || fileName}" on "${trackName}" is time-stretched by warping — it is placed at the right position, but plays at its original speed. Re-warp it in the new DAW.`
      );
    }
  }

  return segments.map((seg) => ({
    kind: 'audio' as const,
    name: frame.name || stripExt(fileName),
    start: seg.arrStart,
    length: seg.arrLength,
    file,
    fileName,
    offset: Math.max(0, toSec(seg.contentStart)),
    gain
  }));
}

async function resolveSample(clipNode: XmlNode, finder: FileFinder): Promise<{ file: string | null; fileName: string }> {
  const fileRef = path(clipNode, 'SampleRef', 'FileRef');
  const candidates: string[] = [];
  let fileName = '';

  // Live 11+: plain absolute and relative path strings.
  const absolute = value(fileRef, 'Path');
  if (absolute) candidates.push(absolute);
  const relValue = value(fileRef, 'RelativePath');
  if (relValue) candidates.push(nodePath.join(finder.root, relValue));

  // Live 10 and earlier: RelativePathElement list + a Name.
  const name = value(fileRef, 'Name');
  const relElements = children(child(fileRef, 'RelativePath'), 'RelativePathElement').map((e) => e.attrs.Dir || '');
  if (name) {
    fileName = name;
    if (relElements.length) candidates.push(nodePath.join(finder.root, ...relElements.map((d) => (d === '' ? '..' : d)), name));
  }

  // Windows sets store the absolute path as UTF-16 hex in <Data>.
  const data = child(fileRef, 'Data');
  if (data && data.text) {
    const decoded = decodeUtf16Hex(data.text);
    if (decoded) candidates.push(decoded);
  }

  if (!fileName) fileName = nodePath.basename((absolute || relValue || '').replace(/\\/g, '/'));
  const file = await finder.resolve(candidates, fileName);
  return { file, fileName };
}

function decodeUtf16Hex(hex: string): string | null {
  const clean = hex.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 4 !== 0) return null;
  const text = Buffer.from(clean, 'hex').toString('utf16le').replace(/\u0000+$/, '');
  return /^[A-Za-z]:[\\/]/.test(text) ? text : null;
}

/* ------------------------------ midi ------------------------------- */

function midiClip(clipNode: XmlNode): MidiClip | null {
  const frame = clipFrame(clipNode);
  if (frame.arrLength <= 0) return null;

  const source: Note[] = [];
  for (const keyTrack of findAll(path(clipNode, 'Notes', 'KeyTracks'), 'KeyTrack')) {
    const pitch = num(value(keyTrack, 'MidiKey'), -1);
    if (pitch < 0 || pitch > 127) continue;
    for (const ev of findAll(child(keyTrack, 'Notes'), 'MidiNoteEvent')) {
      if (ev.attrs.IsEnabled === 'false') continue;
      source.push({
        start: num(ev.attrs.Time),
        length: num(ev.attrs.Duration),
        pitch,
        velocity: clamp(Math.round(num(ev.attrs.Velocity, 100)), 1, 127)
      });
    }
  }

  const segments = clipSegments(frame.arrStart, frame.arrLength, frame.contentStart, frame.loopStart, frame.loopEnd, frame.loopOn, 1);
  const notes: Note[] = [];
  for (const seg of segments) {
    const segEnd = seg.contentStart + seg.arrLength;
    for (const n of source) {
      if (n.start < seg.contentStart - 1e-9 || n.start >= segEnd - 1e-9) continue;
      const start = seg.arrStart - frame.arrStart + (n.start - seg.contentStart);
      const length = Math.min(n.length, segEnd - n.start);
      if (length > 1e-6) notes.push({ ...n, start, length });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  return { kind: 'midi', name: frame.name, start: frame.arrStart, length: frame.arrLength, notes };
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------------------------- automation --------------------------- */

/*
 * Automation lives beside the mixer, not inside it: each mixer parameter has
 * an <AutomationTarget Id="N">, and the track's <AutomationEnvelopes> holds
 * envelopes whose <EnvelopeTarget><PointeeId Value="N"/> point back at it.
 * Events are in arrangement beats. The first event usually sits at a huge
 * negative time — that's the value "before the song", clamped to 0 here.
 */

function automationTargetId(param: XmlNode | null): string | null {
  const target = child(param, 'AutomationTarget');
  return target ? target.attrs.Id || null : null;
}

function envelopesOf(trackNode: XmlNode | null): XmlNode[] {
  return findAll(path(trackNode, 'AutomationEnvelopes', 'Envelopes'), 'AutomationEnvelope');
}

function pointeeId(env: XmlNode): string | null {
  return value(env, 'EnvelopeTarget', 'PointeeId');
}

function readTrackAutomation(trackNode: XmlNode, mixer: XmlNode | null, track: Track, project: Project): void {
  const ids = {
    volume: automationTargetId(path(mixer, 'Volume')),
    pan: automationTargetId(path(mixer, 'Pan')),
    mute: automationTargetId(path(mixer, 'Speaker'))
  };
  let other = 0;
  let curved = false;
  for (const env of envelopesOf(trackNode)) {
    const id = pointeeId(env);
    const kind = id === null ? null : id === ids.volume ? 'volume' : id === ids.pan ? 'pan' : id === ids.mute ? 'mute' : null;
    if (!kind) {
      other += 1;
      continue;
    }
    const points: AutoPoint[] = [];
    if (kind === 'mute') {
      for (const ev of findAll(env, 'BoolEvent')) {
        // Speaker on = playing, so muted is the opposite.
        points.push({ time: num(ev.attrs.Time), value: ev.attrs.Value === 'true' ? 0 : 1 });
      }
    } else {
      for (const ev of findAll(env, 'FloatEvent')) {
        if (ev.attrs.CurveControl1X !== undefined || ev.attrs.CurveControl1Y !== undefined) curved = true;
        const v = num(ev.attrs.Value);
        points.push({ time: num(ev.attrs.Time), value: kind === 'volume' ? clamp(v, 0, 4) : clamp(v, -1, 1) });
      }
    }
    setLane(track, kind, points);
  }
  if (curved) project.warnings.push(`Curved automation on "${track.name}" was converted as straight ramps.`);
  if (other) {
    project.warnings.push(`${other} automation lane(s) on "${track.name}" (plug-ins, devices or sends) were not converted — only volume, pan and mute automation is.`);
  }
}
