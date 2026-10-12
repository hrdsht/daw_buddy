'use strict';

/**
 * Audio → MIDI tool view. Drop a sample, loop, stem or vocal; Spotify's
 * Basic Pitch model (in audio-midi-worker.ts) transcribes it; the notes are
 * cleaned up, optionally quantised, previewed on a piano roll and exported
 * as a .mid file or dragged straight into the DAW.
 */

import { el, headRow, toast } from './dom';
import { DSP } from './dsp';
import {
  BASIC_PITCH_SAMPLE_RATE,
  TranscribedNote,
  cleanNotes,
  quantizeNotes,
  notesToMidi,
  summariseNotes,
  midiNoteName,
  mixToMono,
  resample,
  amplitudeToVelocity
} from './audio-midi';

type Status = 'idle' | 'decoding' | 'transcribing' | 'ready' | 'error';

interface Settings {
  sensitivity: number; // 0..100 → onset threshold 0.8..0.2
  minNoteMs: number;
  lowMidi: number;
  highMidi: number;
  pitchBends: boolean;
  quantize: 0 | 2 | 4 | 8; // steps per beat; 0 = off
  quantizeStrength: number; // 0..100
  bpm: number;
}

const MODEL_FRAME_MS = (256 / BASIC_PITCH_SAMPLE_RATE) * 1000; // ~11.6 ms
const MAX_SECONDS = 600;

const state: {
  status: Status;
  message: string;
  progress: number;
  fileName: string | null;
  durationSeconds: number;
  detectedBpm: number | null;
  rawNotes: TranscribedNote[];
  backend: string | null;
  modelMs: number;
  settings: Settings;
} = {
  status: 'idle',
  message: '',
  progress: 0,
  fileName: null,
  durationSeconds: 0,
  detectedBpm: null,
  rawNotes: [],
  backend: null,
  modelMs: 0,
  settings: {
    sensitivity: 50,
    minNoteMs: 60,
    lowMidi: 21,
    highMidi: 108,
    pitchBends: false,
    quantize: 0,
    quantizeStrength: 100,
    bpm: 120
  }
};

let container: HTMLElement | null = null;
let worker: Worker | null = null;
let requestId = 0;
let extractTimer: ReturnType<typeof setTimeout> | null = null;
let previewStop: (() => void) | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker('./audio-midi-worker.js');
    worker.onmessage = (event) => onWorkerMessage(event.data);
    worker.onerror = (event) => {
      // The worker script itself failed (bad bundle, out of memory…).
      event.preventDefault();
      onWorkerMessage({ type: 'error', id: requestId, message: event.message || 'the transcription engine stopped' });
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function extractParams() {
  const s = state.settings;
  return {
    onsetThreshold: 0.8 - (s.sensitivity / 100) * 0.6,
    frameThreshold: 0.3,
    minNoteFrames: Math.max(1, Math.round(s.minNoteMs / MODEL_FRAME_MS)),
    pitchBends: s.pitchBends
  };
}

/** Notes as they will be exported: range-filtered and optionally quantised. */
export function finalNotes(): TranscribedNote[] {
  const s = state.settings;
  let notes = cleanNotes(state.rawNotes, { minMidi: s.lowMidi, maxMidi: s.highMidi });
  if (s.quantize) {
    notes = quantizeNotes(notes, { bpm: s.bpm, stepsPerBeat: s.quantize, strength: s.quantizeStrength / 100 });
  }
  return notes;
}

function onWorkerMessage(message: any) {
  if (!message || message.id !== requestId) return; // stale run
  if (message.type === 'progress') {
    state.progress = Math.max(0, Math.min(1, message.percent));
    updateProgress();
    return;
  }
  if (message.type === 'error') {
    state.status = 'error';
    state.message = `Transcription failed: ${message.message}`;
    rerender();
    return;
  }
  if (message.type === 'notes') {
    state.rawNotes = message.notes;
    state.backend = message.backend;
    if (message.modelMs) state.modelMs = message.modelMs;
    state.status = 'ready';
    rerender();
  }
}

async function decodeToModelInput(file: File): Promise<{ samples: Float32Array; seconds: number; bpm: number | null }> {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const length = Math.ceil(seconds * BASIC_PITCH_SAMPLE_RATE);

  let samples: Float32Array;
  try {
    // Browser resampler is band-limited; better than the JS fallback.
    const offline = new OfflineAudioContext(1, length, BASIC_PITCH_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    samples = rendered.getChannelData(0).slice();
  } catch {
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    samples = resample(mixToMono(channels), decoded.sampleRate, BASIC_PITCH_SAMPLE_RATE).subarray(0, length);
  }

  // Tempo for the MIDI file and the quantise grid, from the first 30 s.
  let bpm: number | null = null;
  try {
    const window = resample(samples.subarray(0, BASIC_PITCH_SAMPLE_RATE * 30), BASIC_PITCH_SAMPLE_RATE, 11025);
    const live = DSP.analyseLive(window, 11025);
    bpm = live.bpm ? Math.round(live.bpm) : null;
  } catch {
    bpm = null;
  }
  return { samples, seconds, bpm };
}

async function handleFile(file: File) {
  stopPreview();
  requestId += 1;
  const id = requestId;
  state.status = 'decoding';
  state.progress = 0;
  state.fileName = file.name;
  state.rawNotes = [];
  state.message = '';
  rerender();
  try {
    const { samples, seconds, bpm } = await decodeToModelInput(file);
    if (id !== requestId) return;
    state.durationSeconds = seconds;
    state.detectedBpm = bpm;
    if (bpm) state.settings.bpm = bpm;
    state.status = 'transcribing';
    rerender();
    getWorker().postMessage({ type: 'transcribe', id, samples, params: extractParams() }, [samples.buffer]);
  } catch (error) {
    state.status = 'error';
    state.message = `Couldn't read “${file.name}”: ${error instanceof Error ? error.message : String(error)}`;
    rerender();
  }
}

/** Re-pick notes from the last model run after a setting change (debounced). */
function reextract() {
  if (state.status !== 'ready' || !worker) return;
  if (extractTimer) clearTimeout(extractTimer);
  extractTimer = setTimeout(() => {
    worker!.postMessage({ type: 'extract', id: requestId, params: extractParams() });
  }, 150);
}

function outputName(): string {
  const base = (state.fileName || 'audio').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_#-]+/g, '_');
  return `${base}_MIDI.mid`;
}

function midiBytes(): Uint8Array {
  return notesToMidi(finalNotes(), {
    bpm: state.settings.bpm,
    trackName: (state.fileName || 'Audio to MIDI').replace(/\.[^.]+$/, ''),
    pitchBends: state.settings.pitchBends
  });
}

/* ------------------------------------------------------------------ */
/* Preview playback — a soft synth voice per note                      */
/* ------------------------------------------------------------------ */

function stopPreview() {
  if (previewStop) previewStop();
  previewStop = null;
}

function playPreview(onEnd: () => void) {
  stopPreview();
  const notes = finalNotes();
  if (!notes.length) return;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  let end = 0;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (n.pitchMidi - 69) / 12);
    const g = ctx.createGain();
    const start = t0 + n.startTimeSeconds;
    const stop = start + Math.max(0.05, n.durationSeconds);
    const peak = amplitudeToVelocity(n.amplitude) / 127;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.01);
    g.gain.setTargetAtTime(peak * 0.6, start + 0.01, 0.15);
    g.gain.setTargetAtTime(0, stop, 0.04);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(stop + 0.3);
    end = Math.max(end, stop + 0.3);
  }
  const timer = setTimeout(() => { stopPreview(); onEnd(); }, (end - ctx.currentTime) * 1000 + 100);
  previewStop = () => {
    clearTimeout(timer);
    void ctx.close();
  };
}

/* ------------------------------------------------------------------ */
/* Piano roll                                                          */
/* ------------------------------------------------------------------ */

function drawPianoRoll(canvas: HTMLCanvasElement, notes: TranscribedNote[]) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 260;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  const css = getComputedStyle(document.body);
  const lineColour = css.getPropertyValue('--line').trim() || 'rgba(255,255,255,0.08)';
  const accent = css.getPropertyValue('--amber').trim() || '#00f0ff';
  const dim = css.getPropertyValue('--dim').trim() || '#5f6e64';
  g.clearRect(0, 0, width, height);

  const summary = summariseNotes(notes);
  if (!summary.count) return;
  const low = Math.max(0, (summary.lowest as number) - 2);
  const high = Math.min(127, (summary.highest as number) + 2);
  const rows = high - low + 1;
  const duration = Math.max(1, Math.max(summary.durationSeconds, state.durationSeconds));
  const gutter = 34;
  const x = (t: number) => gutter + (t / duration) * (width - gutter - 4);
  const rowH = height / rows;

  // Black-key rows and C labels.
  g.font = '10px system-ui, sans-serif';
  for (let m = low; m <= high; m += 1) {
    const y = height - (m - low + 1) * rowH;
    if ([1, 3, 6, 8, 10].includes(m % 12)) {
      g.fillStyle = lineColour;
      g.fillRect(gutter, y, width - gutter, rowH);
    }
    if (m % 12 === 0) {
      g.fillStyle = dim;
      g.fillText(midiNoteName(m), 2, y + rowH - 1);
    }
  }
  // Bar lines at the working tempo.
  const bar = (60 / state.settings.bpm) * 4;
  g.fillStyle = lineColour;
  for (let t = 0; t <= duration; t += bar) g.fillRect(x(t), 0, 1, height);

  for (const n of notes) {
    const y = height - (n.pitchMidi - low + 1) * rowH;
    g.globalAlpha = 0.35 + 0.65 * (amplitudeToVelocity(n.amplitude) / 127);
    g.fillStyle = accent;
    g.fillRect(x(n.startTimeSeconds), y + 0.5, Math.max(2, x(n.startTimeSeconds + n.durationSeconds) - x(n.startTimeSeconds)), Math.max(2, rowH - 1));
  }
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

function updateProgress() {
  const bar = container?.querySelector<HTMLElement>('.a2m-progress__fill');
  const label = container?.querySelector<HTMLElement>('.a2m-progress__label');
  if (bar) bar.style.width = `${Math.round(state.progress * 100)}%`;
  if (label) label.textContent = `Transcribing… ${Math.round(state.progress * 100)}%`;
}

function slider(label: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onInput: (v: number) => void) {
  const wrap = el('label', 'a2m-field');
  const head = el('span', 'a2m-field__label');
  const name = el('span', null, label);
  const val = el('span', 'a2m-field__value', format(value));
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = format(v);
    onInput(v);
  });
  wrap.append(head, input);
  return wrap;
}

function select(label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
  const wrap = el('label', 'a2m-field');
  wrap.append(el('span', 'a2m-field__label', label));
  const input = document.createElement('select');
  for (const [v, text] of options) input.append(new Option(text, v));
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  wrap.append(input);
  return wrap;
}

function noteOptions(from: number, to: number): [string, string][] {
  const out: [string, string][] = [];
  for (let m = from; m <= to; m += 1) out.push([String(m), midiNoteName(m)]);
  return out;
}

function renderDropZone(): HTMLElement {
  const busy = state.status === 'decoding' || state.status === 'transcribing';
  const zone = el('div', `scale-dropzone a2m-drop ${busy ? 'scale-dropzone--analyzing' : ''}`);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.wav,.mp3,.flac,.ogg,.aif,.aiff,.m4a';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) void handleFile(input.files[0]);
  });
  const content = el('div', 'scale-dropzone__content');
  if (busy) {
    content.append(el('h4', 'scale-dropzone__title', state.status === 'decoding' ? `Reading ${state.fileName}…` : `Listening for notes in ${state.fileName}`));
    const progress = el('div', 'a2m-progress');
    const fill = el('div', 'a2m-progress__fill');
    fill.style.width = `${Math.round(state.progress * 100)}%`;
    progress.append(fill);
    content.append(progress, el('p', 'scale-dropzone__subtitle a2m-progress__label', state.status === 'decoding' ? 'Decoding audio…' : `Transcribing… ${Math.round(state.progress * 100)}%`));
  } else {
    content.append(el('h4', 'scale-dropzone__title', state.fileName ? 'Drop another file to transcribe' : 'Drop a sample, loop, stem or vocal'));
    content.append(el('p', 'scale-dropzone__subtitle', 'WAV, MP3, FLAC, AIFF, OGG, M4A · works best on one instrument or voice at a time'));
    const browse = el('button', 'pill pill--solid', 'Browse file…');
    browse.type = 'button';
    browse.addEventListener('click', () => input.click());
    content.append(browse);
  }
  zone.append(input, content);
  zone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add('scale-dropzone--over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('scale-dropzone--over'));
  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove('scale-dropzone--over');
    const file = e.dataTransfer?.files?.[0];
    if (file && !busy) void handleFile(file);
  });
  return zone;
}

function renderSettings(): HTMLElement {
  const s = state.settings;
  const box = el('div', 'a2m-settings');
  box.append(
    slider('Note sensitivity', 0, 100, 1, s.sensitivity, (v) => (v < 34 ? `Fewer notes (${v})` : v > 66 ? `More notes (${v})` : `Balanced (${v})`), (v) => { s.sensitivity = v; reextract(); }),
    slider('Shortest note', 20, 400, 10, s.minNoteMs, (v) => `${v} ms`, (v) => { s.minNoteMs = v; reextract(); }),
    select('Lowest note', noteOptions(21, 96), String(s.lowMidi), (v) => { s.lowMidi = Number(v); rerenderResults(); }),
    select('Highest note', noteOptions(36, 108), String(s.highMidi), (v) => { s.highMidi = Number(v); rerenderResults(); }),
    select('Quantise', [['0', 'Off — keep timing'], ['2', '1/8 notes'], ['4', '1/16 notes'], ['8', '1/32 notes']], String(s.quantize), (v) => { s.quantize = Number(v) as Settings['quantize']; rerenderResults(); }),
    slider('Quantise strength', 0, 100, 5, s.quantizeStrength, (v) => `${v}%`, (v) => { s.quantizeStrength = v; rerenderResults(); })
  );

  const bpmWrap = el('label', 'a2m-field');
  bpmWrap.append(el('span', 'a2m-field__label', state.detectedBpm ? `Tempo (detected ${state.detectedBpm})` : 'Tempo'));
  const bpm = document.createElement('input');
  bpm.type = 'number';
  bpm.min = '40';
  bpm.max = '240';
  bpm.step = '1';
  bpm.value = String(s.bpm);
  bpm.addEventListener('change', () => {
    const v = Number(bpm.value);
    if (v >= 40 && v <= 240) { s.bpm = v; rerenderResults(); }
  });
  bpmWrap.append(bpm);
  box.append(bpmWrap);

  const bends = el('label', 'a2m-check');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = s.pitchBends;
  check.addEventListener('change', () => { s.pitchBends = check.checked; reextract(); });
  bends.append(check, el('span', null, 'Pitch bends (single-line parts: vocals, bass, leads)'));
  box.append(bends);
  return box;
}

function renderResults(): HTMLElement {
  const box = el('div', 'a2m-results');
  const notes = finalNotes();
  const summary = summariseNotes(notes);

  const stats = el('div', 'a2m-stats');
  const stat = (label: string, value: string) => {
    const s = el('div', 'a2m-stat');
    s.append(el('span', 'a2m-stat__label', label), el('b', 'a2m-stat__value', value));
    return s;
  };
  stats.append(
    stat('Notes', String(summary.count)),
    stat('Range', summary.count ? `${midiNoteName(summary.lowest as number)}–${midiNoteName(summary.highest as number)}` : '—'),
    stat('Most at once', String(summary.polyphony)),
    stat('Length', `${state.durationSeconds.toFixed(1)} s`)
  );
  box.append(stats);

  const canvas = document.createElement('canvas');
  canvas.className = 'a2m-roll';
  box.append(canvas);
  requestAnimationFrame(() => drawPianoRoll(canvas, notes));

  const actions = el('div', 'a2m-actions');
  const play = el('button', 'pill', '▶ Preview MIDI');
  play.type = 'button';
  play.disabled = !notes.length;
  play.addEventListener('click', () => {
    if (previewStop) {
      stopPreview();
      play.textContent = '▶ Preview MIDI';
      return;
    }
    play.textContent = '■ Stop';
    playPreview(() => { play.textContent = '▶ Preview MIDI'; });
  });

  const drag = el('button', 'pill pill--solid', '⇢ Drag MIDI into your DAW');
  drag.type = 'button';
  drag.draggable = true;
  drag.disabled = !notes.length;
  drag.title = 'Drag this button onto a DAW track';
  drag.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if ((window as any).api?.dragMidi) await (window as any).api.dragMidi(outputName(), Array.from(midiBytes()));
  });

  const save = el('button', 'pill', '⤓ Save .mid');
  save.type = 'button';
  save.disabled = !notes.length;
  save.addEventListener('click', async () => {
    const api = (window as any).api;
    if (!api?.saveMidi) return;
    const saved = await api.saveMidi(outputName(), Array.from(midiBytes()), { title: 'Save MIDI', subfolder: 'Audio to MIDI' });
    if (saved) toast('MIDI saved', saved);
  });
  actions.append(play, drag, save);
  box.append(actions);

  const foot = el('p', 'muted a2m-foot');
  const where = state.backend === 'webgl' ? 'on your graphics card' : 'on your CPU';
  foot.textContent = `Transcribed ${where}${state.modelMs ? ` in ${(state.modelMs / 1000).toFixed(1)} s` : ''}. Nothing left this computer. Powered by Spotify's Basic Pitch.`;
  box.append(foot);
  return box;
}

function rerenderResults() {
  if (!container) return;
  const old = container.querySelector('.a2m-results');
  if (old && state.status === 'ready') old.replaceWith(renderResults());
}

function rerender() {
  if (!container || !container.isConnected) return;
  mountAudioMidiTool(container);
}

export function mountAudioMidiTool(target: HTMLElement) {
  container = target;
  target.innerHTML = '';
  const section = el('div', 'section a2m');
  section.append(headRow('Audio → MIDI', 'Turn any recording into MIDI notes — melodies, chords, bass lines and vocals. Runs entirely on this computer.'));
  section.append(renderDropZone());
  if (state.status === 'error') section.append(el('p', 'a2m-error', state.message));
  if (state.status === 'ready') {
    const layout = el('div', 'a2m-layout');
    layout.append(renderSettings(), renderResults());
    section.append(layout);
  }
  target.append(section);
}

export function leaveAudioMidiTool() {
  stopPreview();
}
