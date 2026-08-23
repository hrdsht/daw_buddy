'use strict';

export interface SlowedReverbOptions {
  speedPercent: number; // 50 to 100, default 87
  isSemitones: boolean;
  semitones: number; // -12 to 0, default -2
  reverbMix: number; // 0 to 100, default 35
  sampleRate: 44100 | 48000;
  wavBitDepth: 16 | 24 | 32;
  mp3Bitrate: number; // 128, 160, 192, 256, 320 (default 192)
}

export const DEFAULT_SLOWED_REVERB_OPTIONS: SlowedReverbOptions = {
  speedPercent: 87,
  isSemitones: false,
  semitones: -2,
  reverbMix: 35,
  sampleRate: 44100,
  wavBitDepth: 16,
  mp3Bitrate: 192
};

export function percentToSemitones(percent: number): number {
  return 12 * Math.log2(Math.max(0.01, percent) / 100);
}

export function semitonesToPercent(semitones: number): number {
  return 100 * Math.pow(2, semitones / 12);
}

export function getPlaybackRate(isSemitones: boolean, value: number): number {
  if (isSemitones) {
    return Math.pow(2, value / 12);
  }
  return Math.max(0.25, value / 100);
}

export function getEqualPowerGains(mixPercent: number): { dry: number; wet: number } {
  const mix = Math.min(1, Math.max(0, mixPercent / 100));
  return {
    dry: Math.cos(mix * Math.PI * 0.5),
    wet: Math.sin(mix * Math.PI * 0.5)
  };
}

function createMockAudioBuffer(length: number, sampleRate: number, durationSec: number): AudioBuffer {
  return {
    numberOfChannels: 2,
    length,
    sampleRate,
    duration: durationSec,
    _data: [new Float32Array(length), new Float32Array(length)],
    getChannelData(c: number) {
      return this._data[c];
    }
  } as any as AudioBuffer;
}

/**
 * Generates an algorithmic Freeverb stereo impulse response (IR) AudioBuffer.
 */
export function createFreeverbIR(
  sampleRate: number,
  durationSec = 4.5,
  roomSize = 0.82,
  damp = 0.45,
  audioCtx?: BaseAudioContext | null
): AudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  let buffer: AudioBuffer;

  if (audioCtx && typeof audioCtx.createBuffer === 'function') {
    buffer = audioCtx.createBuffer(2, length, sampleRate);
  } else if (typeof AudioBuffer !== 'undefined') {
    try {
      buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
    } catch {
      try {
        const Ctx = (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) || null;
        if (Ctx) {
          buffer = new Ctx().createBuffer(2, length, sampleRate);
        } else {
          buffer = createMockAudioBuffer(length, sampleRate, durationSec);
        }
      } catch {
        buffer = createMockAudioBuffer(length, sampleRate, durationSec);
      }
    }
  } else {
    buffer = createMockAudioBuffer(length, sampleRate, durationSec);
  }

  const scale = sampleRate / 44100;

  for (let c = 0; c < 2; c++) {
    const out = buffer.getChannelData(c);
    const spread = c === 1 ? 23 : 0;
    const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1114].map((d) =>
      Math.floor((d + spread) * scale)
    );
    const allpassDelays = [225, 556, 441, 341].map((d) =>
      Math.floor((d + spread) * scale)
    );

    const combBuffers = combDelays.map((d) => new Float32Array(d));
    const combIndices = combDelays.map(() => 0);
    const combFilters = combDelays.map(() => 0);
    const apBuffers = allpassDelays.map((d) => new Float32Array(d));
    const apIndices = allpassDelays.map(() => 0);

    for (let i = 0; i < length; i++) {
      const input = i === 0 ? 1.0 : 0.0;
      let outSample = 0;
      for (let j = 0; j < 8; j++) {
        const idx = combIndices[j];
        const delayed = combBuffers[j][idx];
        combFilters[j] = delayed * (1 - damp) + combFilters[j] * damp;
        combBuffers[j][idx] = input + combFilters[j] * roomSize;
        outSample += delayed;
        combIndices[j] = (idx + 1) % combDelays[j];
      }
      for (let j = 0; j < 4; j++) {
        const idx = apIndices[j];
        const delayed = apBuffers[j][idx];
        const apInput = outSample;
        apBuffers[j][idx] = apInput + delayed * 0.5;
        outSample = delayed - apInput;
        apIndices[j] = (idx + 1) % allpassDelays[j];
      }
      // Apply smooth natural exponential decay envelope
      const decayEnv = Math.exp((-3.5 * i) / length);
      out[i] = outSample * decayEnv * 0.18;
    }
  }

  return buffer;
}

/**
 * Normalizes rendered audio buffer RMS and peak levels against original.
 */
export function normalizeBufferRMS(renderedBuffer: AudioBuffer, originalBuffer: AudioBuffer): void {
  function getRMS(buf: AudioBuffer): number {
    let sum = 0;
    const total = buf.length * buf.numberOfChannels;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    }
    return Math.sqrt(sum / Math.max(1, total));
  }

  function getPeak(buf: AudioBuffer): number {
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return peak;
  }

  const origRms = getRMS(originalBuffer);
  const renderedRms = getRMS(renderedBuffer);
  const renderedPeak = getPeak(renderedBuffer);

  if (renderedRms > 0) {
    let ratio = origRms / renderedRms;
    if (renderedPeak * ratio > 0.98) ratio = 0.98 / Math.max(0.001, renderedPeak);
    for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
      const data = renderedBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= ratio;
    }
  }
}

/**
 * Renders slowed + reverbed AudioBuffer offline at desired sample rate.
 */
export async function renderSlowedReverbAudio(
  sourceBuffer: AudioBuffer,
  options: {
    playbackRate: number;
    reverbPercent: number; // 0 to 1
    sampleRate?: number; // 44100 or 48000
  }
): Promise<AudioBuffer> {
  const targetSampleRate = options.sampleRate || 44100;
  const playbackRate = Math.max(0.25, Math.min(2.0, options.playbackRate));
  const reverbPercent = Math.max(0, Math.min(1.0, options.reverbPercent));

  // Length calculation (base duration / playbackRate + reverb tail)
  const baseDuration = sourceBuffer.duration / playbackRate;
  const tailDuration = reverbPercent > 0 ? 4.0 : 0.2;
  const totalLength = Math.ceil((baseDuration + tailDuration) * targetSampleRate);

  const OfflineCtxClass = (typeof window !== 'undefined' && (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)) || (globalThis as any).OfflineAudioContext;
  const offlineCtx = new OfflineCtxClass(
    Math.min(2, Math.max(1, sourceBuffer.numberOfChannels)),
    totalLength,
    targetSampleRate
  );

  const irBuffer = createFreeverbIR(targetSampleRate, 4.5, 0.82, 0.45, offlineCtx);

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = playbackRate;

  const { dry, wet } = getEqualPowerGains(reverbPercent * 100);

  // Dry path
  const dryGain = offlineCtx.createGain();
  dryGain.gain.value = dry;
  source.connect(dryGain);
  dryGain.connect(offlineCtx.destination);

  // Wet path
  if (reverbPercent > 0.001) {
    const convolver = offlineCtx.createConvolver();
    convolver.buffer = irBuffer;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = wet;
    source.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(offlineCtx.destination);
  }

  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  normalizeBufferRMS(renderedBuffer, sourceBuffer);
  return renderedBuffer;
}

/**
 * Encodes an AudioBuffer into 16-bit, 24-bit PCM, or 32-bit Float WAV bytes.
 */
export function encodeWavBuffer(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 | 32 = 16
): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const isFloat = bitDepth === 32;
  const audioFormat = isFloat ? 3 : 1; // 3 = IEEE float, 1 = PCM

  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // "fmt " sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // "data" sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write samples
  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i] || 0));

      if (bitDepth === 16) {
        const intSample = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(offset, Math.round(intSample), true);
        offset += 2;
      } else if (bitDepth === 24) {
        const intSample = Math.round(sample < 0 ? sample * 8388608 : sample * 8388607);
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      } else if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }

  return new Uint8Array(arrayBuffer);
}

let CachedMp3Encoder: any = null;

export function getMp3EncoderClass(): any {
  if (CachedMp3Encoder) return CachedMp3Encoder;

  if (typeof (globalThis as any).lamejs !== 'undefined' && (globalThis as any).lamejs.Mp3Encoder) {
    CachedMp3Encoder = (globalThis as any).lamejs.Mp3Encoder;
    return CachedMp3Encoder;
  }
  if (typeof (window as any) !== 'undefined' && (window as any).lamejs && (window as any).lamejs.Mp3Encoder) {
    CachedMp3Encoder = (window as any).lamejs.Mp3Encoder;
    return CachedMp3Encoder;
  }

  // Node / CommonJS environment (for unit tests / CLI runners)
  try {
    const gReq = (globalThis as any).require;
    if (typeof gReq === 'function') {
      const fs = gReq('fs');
      const minPath = gReq.resolve('lamejs/lame.min.js');
      const src = fs.readFileSync(minPath, 'utf8');
      const fn = new Function(src + '; return lamejs.Mp3Encoder;');
      CachedMp3Encoder = fn();
      if (CachedMp3Encoder) return CachedMp3Encoder;
    }
  } catch {}

  return null;
}

/**
 * Encodes an AudioBuffer into MP3 bytes using lamejs at chosen bitrate.
 */
export async function encodeMp3Buffer(
  buffer: AudioBuffer,
  bitrateKbps = 192
): Promise<Uint8Array> {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = Math.max(128, Math.min(320, bitrateKbps));

  // Instantiate lamejs encoder
  const Mp3Encoder = getMp3EncoderClass();
  if (!Mp3Encoder) {
    throw new Error('MP3 encoder not available.');
  }

  const mp3encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];

  const samples = buffer.length;
  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : null;

  const sampleBlockSize = 1152;
  let leftChunk = new Int16Array(sampleBlockSize);
  let rightChunk = channels > 1 ? new Int16Array(sampleBlockSize) : null;

  for (let i = 0; i < samples; i += sampleBlockSize) {
    const chunkLength = Math.min(sampleBlockSize, samples - i);
    if (chunkLength < sampleBlockSize) {
      leftChunk = new Int16Array(chunkLength);
      if (channels > 1) rightChunk = new Int16Array(chunkLength);
    }

    for (let j = 0; j < chunkLength; j++) {
      const l = left[i + j];
      leftChunk[j] = Math.round(l < 0 ? l * 32768 : l * 32767);
      if (channels > 1 && right && rightChunk) {
        const r = right[i + j];
        rightChunk[j] = Math.round(r < 0 ? r * 32768 : r * 32767);
      }
    }

    let mp3buf: Int8Array | Uint8Array;
    if (channels > 1 && rightChunk) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.byteLength));
    }
  }

  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) {
    mp3Data.push(new Uint8Array(endBuf.buffer, endBuf.byteOffset, endBuf.byteLength));
  }

  // Concatenate all chunks into a single Uint8Array
  const totalLength = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Interactive Seekable Waveform Canvas component.
 */
export class SlowedReverbWaveformPlayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: AudioBuffer | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private startTime = 0;
  private pauseOffset = 0;
  private isPlaying = false;
  private animFrameId: number | null = null;
  private onTimeUpdate?: (currentSec: number, totalSec: number) => void;
  private onPlay?: () => void;
  private peaks: Float32Array = new Float32Array(0);

  constructor(
    canvas: HTMLCanvasElement,
    onTimeUpdate?: (cur: number, total: number) => void,
    onPlay?: () => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onTimeUpdate = onTimeUpdate;
    this.onPlay = onPlay;
    this.attachEvents();
  }

  public setOnPlay(onPlay: () => void) {
    this.onPlay = onPlay;
  }

  public loadBuffer(buffer: AudioBuffer) {
    this.stop();
    this.buffer = buffer;
    this.pauseOffset = 0;
    this.computePeaks();
    this.draw();
    if (this.onTimeUpdate) {
      this.onTimeUpdate(0, buffer.duration);
    }
  }

  private computePeaks() {
    if (!this.buffer) return;
    const numBars = 180;
    this.peaks = new Float32Array(numBars);
    const data = this.buffer.getChannelData(0);
    const blockSize = Math.floor(data.length / numBars);

    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(data[start + j] || 0);
        if (val > max) max = val;
      }
      this.peaks[i] = max;
    }
  }

  private attachEvents() {
    this.canvas.addEventListener('click', (e: MouseEvent) => {
      if (!this.buffer) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      this.seekTo(ratio * this.buffer.duration);
    });
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public play() {
    if (!this.buffer) return;
    if (this.isPlaying) return;

    if (this.onPlay) {
      try {
        this.onPlay();
      } catch (err) {
        console.error('[SlowedReverbPlayer] onPlay error:', err);
      }
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!this.audioContext) this.audioContext = new AudioCtx();
    if (this.audioContext.state === 'suspended') this.audioContext.resume();

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.buffer;
    this.sourceNode.connect(this.audioContext.destination);

    if (this.pauseOffset >= this.buffer.duration) {
      this.pauseOffset = 0;
    }

    this.sourceNode.start(0, this.pauseOffset);
    this.startTime = this.audioContext.currentTime - this.pauseOffset;
    this.isPlaying = true;

    this.sourceNode.onended = () => {
      if (this.isPlaying && this.getCurrentTime() >= (this.buffer?.duration || 0) - 0.05) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this.draw();
        if (this.onTimeUpdate) this.onTimeUpdate(0, this.buffer?.duration || 0);
      }
    };

    this.startLoop();
  }

  public pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.isPlaying = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.draw();
  }

  public stop() {
    this.pause();
    this.pauseOffset = 0;
    this.draw();
    if (this.onTimeUpdate && this.buffer) {
      this.onTimeUpdate(0, this.buffer.duration);
    }
  }

  public seekTo(seconds: number) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.pause();
    }
    this.pauseOffset = Math.max(0, Math.min(seconds, this.buffer?.duration || 0));
    this.draw();
    if (this.onTimeUpdate && this.buffer) {
      this.onTimeUpdate(this.pauseOffset, this.buffer.duration);
    }
    if (wasPlaying) {
      this.play();
    }
  }

  public getCurrentTime(): number {
    if (!this.buffer) return 0;
    if (!this.isPlaying || !this.audioContext) return this.pauseOffset;
    const elapsed = this.audioContext.currentTime - this.startTime;
    return Math.min(this.buffer.duration, Math.max(0, elapsed));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private startLoop() {
    const render = () => {
      if (!this.isPlaying) return;
      this.draw();
      if (this.onTimeUpdate && this.buffer) {
        this.onTimeUpdate(this.getCurrentTime(), this.buffer.duration);
      }
      this.animFrameId = requestAnimationFrame(render);
    };
    this.animFrameId = requestAnimationFrame(render);
  }

  public draw() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (!this.buffer || this.peaks.length === 0) {
      // Empty placeholder
      this.ctx.fillStyle = '#3a4454';
      this.ctx.font = '12px Inter, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Processed audio waveform will appear here', w / 2, h / 2 + 4);
      return;
    }

    const curTime = this.getCurrentTime();
    const progress = Math.max(0, Math.min(1, curTime / this.buffer.duration));
    const numBars = this.peaks.length;
    const barWidth = w / numBars;

    // Draw background grid & center line
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, h / 2);
    this.ctx.lineTo(w, h / 2);
    this.ctx.stroke();

    for (let i = 0; i < numBars; i++) {
      const x = i * barWidth;
      const peak = Math.max(0.04, this.peaks[i]);
      const barH = Math.min(h * 0.9, peak * h * 0.88);
      const y = (h - barH) / 2;

      const isPlayed = x / w <= progress;
      this.ctx.fillStyle = isPlayed ? '#00e5ff' : 'rgba(255, 255, 255, 0.28)';
      this.ctx.fillRect(x + 1, y, Math.max(1.5, barWidth - 1.5), barH);
    }

    // Draw Playhead / Scrub line
    const cursorX = progress * w;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cursorX, 0);
    this.ctx.lineTo(cursorX, h);
    this.ctx.stroke();

    // Playhead head dot
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.beginPath();
    this.ctx.arc(cursorX, 6, 4.5, 0, Math.PI * 2);
    this.ctx.fill();
  }
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
