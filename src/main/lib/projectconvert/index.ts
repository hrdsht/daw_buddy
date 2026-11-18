'use strict';

/**
 * Project converter: move a session from one DAW to another.
 *
 *   read (format-specific) → neutral Project → write (format-specific)
 *
 * Readers:  Ableton Live (.als), DAWproject (.dawproject), REAPER (.rpp)
 * Writers:  DAWproject  → Bitwig, Studio One, Cubase, Nuendo
 *           REAPER      → REAPER
 *           MIDI+stems  → Ableton Live, FL Studio, Logic, Pro Tools, any DAW
 *
 * Track volume, pan and mute automation travels to every target (baked into
 * stems / written as CC7 and CC10 for MIDI + stems).
 *
 * Every conversion writes a log naming what could not be carried, instead of
 * dropping it quietly.
 */

import fsp from 'fs/promises';
import nodePath from 'path';
import { Project, summarise, dedupeWarnings } from './model';
import { readAbleton } from './read-ableton';
import { readDawproject, writeDawproject } from './dawproject';
import { readReaper, writeReaper } from './reaper';
import { writeUniversal, safe } from './universal';

export const READERS: Record<string, { name: string; read: (p: string) => Promise<Project> }> = {
  '.als': { name: 'Ableton Live', read: readAbleton },
  '.dawproject': { name: 'DAWproject', read: readDawproject },
  '.rpp': { name: 'REAPER', read: readReaper }
};

/** Formats DAW Buddy scans but can't open for conversion, with the way out. */
const CLOSED: Record<string, string> = {
  '.flp': 'FL Studio projects are a closed binary format. In FL Studio use File > Export > All stems (and MIDI), or open the tracks here after exporting.',
  '.logicx': 'Logic projects are a closed format. In Logic use File > Export > All Tracks as Audio Files, plus File > Export > Selection as MIDI File.',
  '.logic': 'Logic projects are a closed format. In Logic use File > Export > All Tracks as Audio Files, plus File > Export > Selection as MIDI File.',
  '.ptx': 'Pro Tools sessions are a closed format. In Pro Tools use File > Export > Selected Tracks as AAF, or bounce tracks and export MIDI.',
  '.cpr': 'Cubase 14+ can save this directly: File > Export > DAWproject. Convert that file here.',
  '.song': 'Studio One 6.5+ can save this directly: File > Export > DAWproject. Convert that file here.',
  '.bwproject': 'Bitwig can save this directly: File > Export > DAWproject. Convert that file here.'
};

export const TARGETS = [
  {
    key: 'dawproject',
    name: 'DAWproject',
    ext: '.dawproject',
    daws: 'Bitwig Studio · Studio One · Cubase · Nuendo',
    detail: 'One self-contained file with tracks, clips, MIDI, mixer, markers and the audio itself.'
  },
  {
    key: 'reaper',
    name: 'REAPER project',
    ext: '.rpp',
    daws: 'REAPER',
    detail: 'A native .rpp with tracks, items, MIDI, faders, pan, colours and markers. Audio stays where it is.'
  },
  {
    key: 'universal',
    name: 'MIDI + stems',
    ext: 'folder',
    daws: 'Ableton Live · FL Studio · Logic Pro · Pro Tools · any DAW',
    detail: 'A multitrack MIDI file (tempo, markers, every MIDI part) and one WAV stem per audio track, all starting at bar 1.'
  }
];

export function supports(filePath: string): { ok: boolean; format?: string; reason?: string } {
  const ext = nodePath.extname(filePath).toLowerCase();
  if (READERS[ext]) return { ok: true, format: READERS[ext].name };
  if (CLOSED[ext]) return { ok: false, reason: CLOSED[ext] };
  return { ok: false, reason: 'This file type cannot be converted yet. Supported: Ableton .als, DAWproject, REAPER .rpp.' };
}

export async function inspect(filePath: string) {
  const ext = nodePath.extname(filePath).toLowerCase();
  const reader = READERS[ext];
  if (!reader) throw new Error(supports(filePath).reason);
  const project = await reader.read(filePath);
  return { ...summarise(project), warnings: dedupeWarnings(project.warnings) };
}

export interface ConvertResult {
  outputPath: string;
  logPath: string;
  summary: ReturnType<typeof summarise>;
  warnings: string[];
}

export async function convert(
  filePath: string,
  target: string,
  outputRoot: string,
  onProgress?: (message: string) => void
): Promise<ConvertResult> {
  const ext = nodePath.extname(filePath).toLowerCase();
  const reader = READERS[ext];
  if (!reader) throw new Error(supports(filePath).reason);
  const spec = TARGETS.find((t) => t.key === target);
  if (!spec) throw new Error(`Unknown target: ${target}`);

  onProgress?.(`Reading ${reader.name} project…`);
  const project = await reader.read(filePath);

  const folder = await uniqueDir(nodePath.join(outputRoot, `${safe(project.name)} (${spec.name})`));
  await fsp.mkdir(folder, { recursive: true });

  let outputPath = folder;
  let writerNotes: string[] = [];
  onProgress?.(`Writing ${spec.name}…`);
  if (target === 'dawproject') {
    outputPath = nodePath.join(folder, `${safe(project.name)}.dawproject`);
    writerNotes = await writeDawproject(project, outputPath);
  } else if (target === 'reaper') {
    outputPath = nodePath.join(folder, `${safe(project.name)}.rpp`);
    writerNotes = await writeReaper(project, outputPath);
  } else {
    writerNotes = await writeUniversal(project, folder, onProgress);
  }

  const warnings = dedupeWarnings([...project.warnings, ...writerNotes]);
  const summary = summarise(project);
  const logPath = nodePath.join(folder, 'Conversion log.txt');
  await fsp.writeFile(logPath, logText(filePath, spec.name, summary, warnings), 'utf8');
  onProgress?.('Done');
  return { outputPath, logPath, summary, warnings };
}

function logText(source: string, target: string, s: ReturnType<typeof summarise>, warnings: string[]): string {
  return [
    `DAW Buddy — project conversion`,
    `Source: ${source} (${s.source})`,
    `Target: ${target}`,
    `Date:   ${new Date().toISOString()}`,
    '',
    `Tempo ${s.bpm} BPM · ${s.timeSignature}`,
    `${s.tracks} tracks (${s.audioTracks} audio, ${s.midiTracks} MIDI)`,
    `${s.audioClips} audio clips · ${s.midiClips} MIDI clips · ${s.notes} notes · ${s.markers} markers · ${s.automationLanes} automation lanes`,
    '',
    warnings.length ? 'NOT CARRIED / CHECK THESE' : 'Everything in the arrangement was carried.',
    ...warnings.map((w) => `  - ${w}`),
    '',
    'Always carried when present: tempo, time signature, markers, track names,',
    'fader, pan, mute, colours (where the source has them), track volume / pan /',
    'mute automation, audio clip positions and trims, MIDI notes and velocities.',
    'Never carried by this converter: plug-ins and their settings or automation,',
    'sends/buses, warping/time-stretch, tempo changes.',
    ''
  ].join('\n');
}

async function uniqueDir(base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    try {
      await fsp.access(candidate);
      candidate = `${base} (${n++})`;
    } catch {
      return candidate;
    }
  }
}
