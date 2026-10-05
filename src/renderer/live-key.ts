'use strict';

/**
 * Live Key — listens to whatever the computer is playing (system loopback or
 * any input device) and keeps a settled key / Camelot / BPM reading on screen.
 *
 * Everything runs locally: audio lives only in a ~12 s rolling buffer in this
 * window and is analysed by the existing DSP worker. Nothing is recorded,
 * stored or uploaded.
 *
 * The top half of this file is pure (no DOM) so it can be unit-tested.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const LIVE_SAMPLE_RATE = 11025;
export const LIVE_WINDOW_SECONDS = 12;
export const LIVE_MIN_SECONDS = 4;
export const LIVE_SILENCE_RMS = 0.003;

export type LiveState = 'idle' | 'silent' | 'listening' | 'settling' | 'locked';
export type ConfidenceTone = 'red' | 'amber' | 'green';

export interface LiveRawReading {
  key: string | null;
  camelot: string | null;
  keyConfidence: number;
  bpm: number | null;
  bpmConfidence: number;
  tuningCents?: number;
  rms?: number;
}

export interface LiveSettledReading {
  state: LiveState;
  key: string | null;
  camelot: string | null;
  keyStability: number; // 0..1 — weighted share of recent readings that agree
  bpm: number | null;
  bpmStability: number;
  tuningCents: number;
  relative: string | null;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Box-filter decimation. Good enough for chroma + onset work below 5 kHz. */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Fixed-capacity mono ring buffer; `snapshot()` returns oldest → newest. */
export class RollingBuffer {
  private data: Float32Array;
  private writeIndex = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get length(): number {
    return this.filled;
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      this.data[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
    this.filled = Math.min(this.capacity, this.filled + samples.length);
  }

  clear(): void {
    this.writeIndex = 0;
    this.filled = 0;
  }

  snapshot(): Float32Array {
    const out = new Float32Array(this.filled);
    const start = (this.writeIndex - this.filled + this.capacity) % this.capacity;
    for (let i = 0; i < this.filled; i += 1) {
      out[i] = this.data[(start + i) % this.capacity];
    }
    return out;
  }
}

/** "A min" → "C maj", "C maj" → "A min". */
export function relativeKey(key: string | null): string | null {
  if (!key) return null;
  const [tonic, mode] = key.split(' ');
  const pc = NOTE_NAMES.indexOf(tonic);
  if (pc < 0) return null;
  if (mode === 'min') return `${NOTE_NAMES[(pc + 3) % 12]} maj`;
  if (mode === 'maj') return `${NOTE_NAMES[(pc + 9) % 12]} min`;
  return null;
}

export function confidenceTone(value: number): ConfidenceTone {
  if (value >= 0.7) return 'green';
  if (value >= 0.45) return 'amber';
  return 'red';
}

/** One-line clipboard string, e.g. "A min · 8A · 124 BPM". */
export function formatReading(reading: Pick<LiveSettledReading, 'key' | 'camelot' | 'bpm'>): string {
  const parts: string[] = [];
  if (reading.key) parts.push(reading.key);
  if (reading.camelot) parts.push(reading.camelot);
  if (reading.bpm) parts.push(`${Math.round(reading.bpm)} BPM`);
  return parts.join(' · ');
}

/** Folds a tempo into the octave of a reference so 62/124/248 vote together. */
export function foldTempo(bpm: number, reference: number): number {
  let value = bpm;
  while (value < reference / Math.SQRT2) value *= 2;
  while (value > reference * Math.SQRT2) value /= 2;
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Smooths jittery per-window readings into one settled answer. A key is only
 * "locked" once it wins a confidence-weighted vote across recent windows, so
 * a passing borrowed chord doesn't flip the display.
 */
export class LiveReadingTracker {
  private history: LiveRawReading[] = [];

  constructor(private readonly depth = 6) {}

  reset(): void {
    this.history = [];
  }

  push(raw: LiveRawReading): LiveSettledReading {
    if ((raw.rms ?? 1) < LIVE_SILENCE_RMS) {
      return { ...this.settle(), state: 'silent' };
    }
    this.history.push(raw);
    if (this.history.length > this.depth) this.history.shift();
    return this.settle();
  }

  settle(): LiveSettledReading {
    const readings = this.history;
    const empty: LiveSettledReading = {
      state: 'listening',
      key: null,
      camelot: null,
      keyStability: 0,
      bpm: null,
      bpmStability: 0,
      tuningCents: 0,
      relative: null
    };
    if (!readings.length) return empty;

    // Key vote — confidence-weighted, newer windows count slightly more.
    const votes = new Map<string, { weight: number; camelot: string | null }>();
    let totalWeight = 0;
    readings.forEach((r, index) => {
      const recency = 0.6 + 0.4 * ((index + 1) / readings.length);
      const weight = Math.max(0.05, r.keyConfidence) * recency;
      totalWeight += weight;
      if (!r.key) return;
      const entry = votes.get(r.key) || { weight: 0, camelot: r.camelot };
      entry.weight += weight;
      votes.set(r.key, entry);
    });
    let bestKey: string | null = null;
    let bestWeight = 0;
    let bestCamelot: string | null = null;
    for (const [key, entry] of votes) {
      if (entry.weight > bestWeight) {
        bestKey = key;
        bestWeight = entry.weight;
        bestCamelot = entry.camelot;
      }
    }
    const keyStability = totalWeight > 0 ? bestWeight / totalWeight : 0;

    // Tempo — median after folding into the dominant octave.
    const tempos = readings
      .filter((r) => r.bpm && r.bpmConfidence > 0.05)
      .map((r) => r.bpm as number);
    let bpm: number | null = null;
    let bpmStability = 0;
    if (tempos.length) {
      const reference = median(tempos);
      const folded = tempos.map((t) => foldTempo(t, reference));
      bpm = Math.round(median(folded) * 10) / 10;
      const agreeing = folded.filter((t) => Math.abs(t - (bpm as number)) <= 1.5).length;
      bpmStability = agreeing / readings.length;
    }

    const cents = readings.map((r) => r.tuningCents ?? 0);
    const tuningCents = Math.round(median(cents));

    let state: LiveState = 'listening';
    if (readings.length >= 3 && keyStability >= 0.7) state = 'locked';
    else if (readings.length >= 2 && keyStability >= 0.45) state = 'settling';

    return {
      state,
      key: bestKey,
      camelot: bestCamelot,
      keyStability,
      bpm,
      bpmStability,
      tuningCents,
      relative: relativeKey(bestKey)
    };
  }
}

/* ------------------------------------------------------------------ */
/* Window controller                                                   */
/* ------------------------------------------------------------------ */

const SYSTEM_SOURCE = 'system';
const ANALYSIS_INTERVAL_MS = 2000;
const HISTORY_LIMIT = 8;

interface HistoryEntry {
  text: string;
  at: Date;
}

function supportsSystemLoopback(): boolean {
  // Chromium only exposes desktop loopback audio on Windows and macOS.
  return !/Linux/i.test(navigator.userAgent);
}

export class LiveKeyController {
  private btn: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  private sourceSelect: HTMLSelectElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private requestId = 0;

  private buffer = new RollingBuffer(LIVE_SAMPLE_RATE * LIVE_WINDOW_SECONDS);
  private tracker = new LiveReadingTracker();
  private latest: LiveSettledReading | null = null;
  private history: HistoryEntry[] = [];

  init(): void {
    this.btn = document.getElementById('liveKeyBtn') as HTMLButtonElement | null;
    this.panel = document.getElementById('liveKeyPanel');
    this.sourceSelect = document.getElementById('liveKeySource') as HTMLSelectElement | null;
    this.toggleBtn = document.getElementById('liveKeyToggle') as HTMLButtonElement | null;
    if (!this.btn || !this.panel) return;

    this.btn.addEventListener('click', () => this.toggle());
    document.getElementById('liveKeyClose')?.addEventListener('click', () => this.close());
    this.toggleBtn?.addEventListener('click', () => {
      if (this.stream) this.stop();
      else void this.start();
    });
    document.getElementById('liveKeyCopy')?.addEventListener('click', () => this.copy());
    this.panel.querySelectorAll<HTMLElement>('[data-copy-part]').forEach((node) => {
      node.addEventListener('click', () => this.copyPart(node.dataset.copyPart || ''));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.panel && !this.panel.hidden) this.close();
    });

    const api = (window as any).api;
    api?.onLiveKeyHotkey?.((payload: { copied: string | null }) => {
      this.flashStatus(payload && payload.copied ? `Copied “${payload.copied}”` : 'Nothing settled yet');
    });

    this.render();
  }

  open(): void {
    if (!this.panel || !this.btn) return;
    this.panel.hidden = false;
    this.btn.classList.add('is-active');
    this.btn.setAttribute('aria-expanded', 'true');
    const rect = this.btn.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 32);
    let left = rect.left - 40;
    if (left + width > window.innerWidth - 16) left = window.innerWidth - width - 16;
    if (left < 16) left = 16;
    this.panel.style.top = `${rect.bottom + 8}px`;
    this.panel.style.left = `${left}px`;
    void this.populateSources();
  }

  close(): void {
    if (!this.panel || !this.btn) return;
    // Closing the panel keeps listening — the topbar pill keeps the reading.
    this.panel.hidden = true;
    this.btn.classList.remove('is-active');
    this.btn.setAttribute('aria-expanded', 'false');
  }

  toggle(): void {
    if (!this.panel) return;
    if (this.panel.hidden) this.open();
    else this.close();
  }

  private async populateSources(): Promise<void> {
    const select = this.sourceSelect;
    if (!select || this.stream) return;
    const previous = select.value;
    select.textContent = '';
    if (supportsSystemLoopback()) {
      select.append(new Option('System audio (everything playing)', SYSTEM_SOURCE));
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      devices
        .filter((d) => d.kind === 'audioinput')
        .forEach((d, index) => {
          select.append(new Option(d.label || `Input ${index + 1}`, d.deviceId));
        });
    } catch {
      /* device list is a convenience; system audio still works */
    }
    if (!select.options.length) {
      select.append(new Option('No audio sources found', ''));
    }
    if (previous && Array.from(select.options).some((o) => o.value === previous)) {
      select.value = previous;
    }
    const hint = document.getElementById('liveKeySourceHint');
    if (hint) {
      hint.textContent = supportsSystemLoopback()
        ? 'System audio hears every app — DAW, browser, streaming. On macOS, allow Screen Recording when asked (audio only, no video is kept).'
        : 'On Linux pick a “Monitor of …” input to hear everything the computer plays.';
    }
  }

  private async openStream(source: string): Promise<MediaStream> {
    if (source === SYSTEM_SOURCE) {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((track) => track.stop());
      if (!stream.getAudioTracks().length) {
        throw new Error('System audio capture is not available here — pick an input device instead.');
      }
      return stream;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: source ? { exact: source } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
  }

  async start(): Promise<void> {
    if (this.stream) return;
    const source = this.sourceSelect?.value ?? SYSTEM_SOURCE;
    this.setStatus('Starting…');
    try {
      this.stream = await this.openStream(source);
    } catch (error) {
      this.stream = null;
      this.setStatus(error instanceof Error ? error.message : String(error));
      return;
    }

    this.buffer.clear();
    this.tracker.reset();
    this.latest = { ...this.tracker.settle(), state: 'listening' };

    const context = new AudioContext();
    const input = context.createMediaStreamSource(this.stream);
    const processor = context.createScriptProcessor(4096, 2, 1);
    const mute = context.createGain();
    mute.gain.value = 0; // keep the graph pulling without playing audio back
    processor.onaudioprocess = (event) => {
      const inBuf = event.inputBuffer;
      const left = inBuf.getChannelData(0);
      const mono = new Float32Array(left.length);
      if (inBuf.numberOfChannels > 1) {
        const right = inBuf.getChannelData(1);
        for (let i = 0; i < left.length; i += 1) mono[i] = 0.5 * (left[i] + right[i]);
      } else {
        mono.set(left);
      }
      this.buffer.push(downsample(mono, context.sampleRate, LIVE_SAMPLE_RATE));
    };
    input.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.context = context;
    this.processor = processor;

    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => this.stop());
    });

    this.worker = new Worker('./analysis-worker.js');
    this.worker.onmessage = (event) => this.onWorkerResult(event.data);
    this.timer = setInterval(() => this.tick(), ANALYSIS_INTERVAL_MS);

    (window as any).api?.liveKeySetActive?.(true);
    this.render();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.processor?.disconnect();
    this.processor = null;
    void this.context?.close();
    this.context = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.buffer.clear();
    (window as any).api?.liveKeySetActive?.(false);
    if (this.latest) this.latest = { ...this.latest, state: 'idle' };
    this.render();
  }

  private tick(): void {
    if (!this.worker || this.busy) return;
    if (this.buffer.length < LIVE_SAMPLE_RATE * LIVE_MIN_SECONDS) {
      this.setStatus(`Listening… ${Math.floor(this.buffer.length / LIVE_SAMPLE_RATE)} s`);
      return;
    }
    const samples = this.buffer.snapshot();
    this.busy = true;
    this.requestId += 1;
    this.worker.postMessage(
      { id: this.requestId, type: 'analyseLive', samples, sampleRate: LIVE_SAMPLE_RATE },
      [samples.buffer]
    );
  }

  private onWorkerResult(message: any): void {
    this.busy = false;
    if (!this.stream || !message || message.error || !message.result) return;
    const previousKey = this.latest?.state === 'locked' ? this.latest.key : null;
    this.latest = this.tracker.push(message.result as LiveRawReading);

    if (this.latest.state === 'locked' && this.latest.key && this.latest.key !== previousKey) {
      this.history.unshift({ text: formatReading(this.latest), at: new Date() });
      this.history = this.history.slice(0, HISTORY_LIMIT);
    }
    const text = this.latest.state === 'locked' ? formatReading(this.latest) : '';
    (window as any).api?.liveKeyPublish?.(text);
    this.render();
  }

  private copy(): void {
    if (!this.latest || !this.latest.key) return;
    void navigator.clipboard.writeText(formatReading(this.latest));
    this.flashStatus('Copied');
  }

  private copyPart(part: string): void {
    if (!this.latest) return;
    const value =
      part === 'key' ? this.latest.key
        : part === 'camelot' ? this.latest.camelot
          : part === 'bpm' && this.latest.bpm ? String(Math.round(this.latest.bpm))
            : null;
    if (!value) return;
    void navigator.clipboard.writeText(value);
    this.flashStatus(`Copied ${value}`);
  }

  private statusOverride: string | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  private setStatus(text: string): void {
    const node = document.getElementById('liveKeyStatus');
    if (node) node.textContent = text;
  }

  private flashStatus(text: string): void {
    this.statusOverride = text;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusOverride = null;
      this.render();
    }, 1800);
    this.render();
  }

  private render(): void {
    const reading = this.latest;
    const listening = Boolean(this.stream);
    const state: LiveState = listening ? (reading?.state ?? 'listening') : 'idle';

    if (this.toggleBtn) {
      this.toggleBtn.textContent = listening ? 'Stop listening' : 'Start listening';
      this.toggleBtn.classList.toggle('is-live', listening);
    }
    if (this.sourceSelect) this.sourceSelect.disabled = listening;

    const ring = document.getElementById('liveKeyRing');
    const tone = listening && reading ? confidenceTone(reading.keyStability) : null;
    if (ring) {
      ring.dataset.tone = tone ?? 'off';
      ring.dataset.state = state;
      ring.style.setProperty('--live-progress', String(reading ? reading.keyStability : 0));
    }

    const set = (id: string, text: string) => {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    set('liveKeyValue', reading?.key ?? '—');
    set('liveKeyCamelot', reading?.camelot ?? '—');
    set('liveKeyBpm', reading?.bpm ? String(Math.round(reading.bpm)) : '—');
    set('liveKeyRelative', reading?.relative ? `Relative: ${reading.relative}` : '');
    set(
      'liveKeyTuning',
      reading && reading.key
        ? `Tuning ${reading.tuningCents > 0 ? '+' : ''}${reading.tuningCents}¢`
        : ''
    );

    const statusText: Record<LiveState, string> = {
      idle: reading?.key ? 'Stopped — last reading kept' : 'Not listening',
      silent: 'Waiting for audio…',
      listening: 'Listening…',
      settling: 'Settling…',
      locked: 'Locked'
    };
    this.setStatus(this.statusOverride ?? statusText[state]);

    const historyNode = document.getElementById('liveKeyHistory');
    if (historyNode) {
      historyNode.textContent = '';
      for (const entry of this.history) {
        const li = document.createElement('li');
        const time = document.createElement('span');
        time.className = 'live-key-history__time';
        time.textContent = entry.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const text = document.createElement('span');
        text.textContent = entry.text;
        li.append(time, text);
        historyNode.append(li);
      }
    }

    const copyBtn = document.getElementById('liveKeyCopy') as HTMLButtonElement | null;
    if (copyBtn) copyBtn.disabled = !reading?.key;

    // Topbar pill mirrors the reading so the panel can stay closed.
    const badge = document.getElementById('liveKeyPillBadge');
    if (badge) badge.textContent = listening && reading?.key ? `${reading.key} · ${reading.camelot ?? ''}`.trim() : listening ? '…' : 'Off';
    this.btn?.classList.toggle('is-live', listening);
  }
}

let controller: LiveKeyController | null = null;

export function initLiveKey(): LiveKeyController {
  if (!controller) {
    controller = new LiveKeyController();
    controller.init();
  }
  return controller;
}
