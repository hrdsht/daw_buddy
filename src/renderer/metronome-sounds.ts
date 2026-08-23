'use strict';

/**
 * Metronome Soundsets and Click Generation Module.
 * Provides authentic DAW soundsets (Ableton, Cubase, FL Studio, Logic, Pro Tools, etc.),
 * sample-accurate Web Audio playback, and offline WAV / MIDI click track generation for DAW drag-and-drop.
 */

import { rhythmGuideMidi } from './midiwrite';

export interface MetronomeSoundset {
  id: string;
  name: string;
  daw: string;
  description: string;
  downbeatUrl: string;
  upbeatUrl: string;
}

export const METRONOME_SOUNDSETS: MetronomeSoundset[] = [
  {
    id: 'ableton',
    name: 'Ableton Live',
    daw: 'Ableton',
    description: 'Classic crisp Ableton wooden clave / pulse',
    downbeatUrl: 'assets/metronome/Ableton (DEFAULT)/Metronome.wav',
    upbeatUrl: 'assets/metronome/Ableton (DEFAULT)/MetronomeUp.wav'
  },
  {
    id: 'fl-studio',
    name: 'FL Studio',
    daw: 'FL Studio',
    description: 'Punchy studio hat / digital click',
    downbeatUrl: 'assets/metronome/FL Studio/Metronome.wav',
    upbeatUrl: 'assets/metronome/FL Studio/MetronomeUp.wav'
  },
  {
    id: 'logic',
    name: 'Logic Pro',
    daw: 'Logic',
    description: 'Warm acoustic woodblock beat',
    downbeatUrl: 'assets/metronome/Logic/Metronome.wav',
    upbeatUrl: 'assets/metronome/Logic/MetronomeUp.wav'
  },
  {
    id: 'cubase',
    name: 'Steinberg Cubase',
    daw: 'Cubase',
    description: 'Precise electronic side-stick click',
    downbeatUrl: 'assets/metronome/Cubase/Metronome.wav',
    upbeatUrl: 'assets/metronome/Cubase/MetronomeUp.wav'
  },
  {
    id: 'protools-default',
    name: 'Pro Tools (Default)',
    daw: 'Pro Tools',
    description: 'Industry-standard studio click track',
    downbeatUrl: 'assets/metronome/Pro Tools/Default/Metronome.wav',
    upbeatUrl: 'assets/metronome/Pro Tools/Default/MetronomeUp.wav'
  },
  {
    id: 'protools-marimba',
    name: 'Pro Tools (Marimba)',
    daw: 'Pro Tools',
    description: 'Melodic pitched marimba pulse',
    downbeatUrl: 'assets/metronome/Pro Tools/Marimba/Metronome.wav',
    upbeatUrl: 'assets/metronome/Pro Tools/Marimba/MetronomeUp.wav'
  },
  {
    id: 'maschine',
    name: 'NI Maschine',
    daw: 'Maschine',
    description: 'Modern electronic rimshot click',
    downbeatUrl: 'assets/metronome/Maschine/Metronome.wav',
    upbeatUrl: 'assets/metronome/Maschine/MetronomeUp.wav'
  },
  {
    id: 'mpc',
    name: 'Akai MPC',
    daw: 'MPC',
    description: 'Vintage MPC tight transient click',
    downbeatUrl: 'assets/metronome/MPC/Metronome.wav',
    upbeatUrl: 'assets/metronome/MPC/MetronomeUp.wav'
  },
  {
    id: 'reason',
    name: 'Reason Studios',
    daw: 'Reason',
    description: 'Analog synth click pulse',
    downbeatUrl: 'assets/metronome/Reason/Metronome.wav',
    upbeatUrl: 'assets/metronome/Reason/MetronomeUp.wav'
  },
  {
    id: 'sonar',
    name: 'Cakewalk Sonar',
    daw: 'Sonar',
    description: 'Sharp digital beep',
    downbeatUrl: 'assets/metronome/Sonar/Metronome.wav',
    upbeatUrl: 'assets/metronome/Sonar/MetronomeUp.wav'
  },
  {
    id: 'synth',
    name: 'Electronic Beep (Synth)',
    daw: 'Synth',
    description: 'Frequency-ramped sine click',
    downbeatUrl: '',
    upbeatUrl: ''
  }
];

interface DecodedSoundset {
  downbeat: AudioBuffer | null;
  upbeat: AudioBuffer | null;
}

const decodedBufferCache = new Map<string, DecodedSoundset>();
const loadingPromises = new Map<string, Promise<DecodedSoundset>>();

export function getMetronomeSoundsets(): MetronomeSoundset[] {
  return METRONOME_SOUNDSETS;
}

export function getMetronomeSoundset(id: string): MetronomeSoundset {
  return METRONOME_SOUNDSETS.find((s) => s.id === id) || METRONOME_SOUNDSETS[0];
}

async function fetchAndDecode(url: string, ac: AudioContext | OfflineAudioContext): Promise<AudioBuffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return await ac.decodeAudioData(arrayBuf);
  } catch (err) {
    console.warn(`[Metronome] Failed to load audio from ${url}:`, err);
    return null;
  }
}

export async function loadSoundsetBuffers(
  soundId: string,
  ac?: AudioContext | OfflineAudioContext
): Promise<DecodedSoundset> {
  if (soundId === 'synth') {
    return { downbeat: null, upbeat: null };
  }

  if (decodedBufferCache.has(soundId)) {
    return decodedBufferCache.get(soundId)!;
  }

  if (loadingPromises.has(soundId)) {
    return loadingPromises.get(soundId)!;
  }

  const def = getMetronomeSoundset(soundId);
  const targetAc = ac || new (window.AudioContext || (window as any).webkitAudioContext)();

  const promise = (async () => {
    const [downbeat, upbeat] = await Promise.all([
      fetchAndDecode(def.downbeatUrl, targetAc),
      fetchAndDecode(def.upbeatUrl, targetAc)
    ]);
    const res: DecodedSoundset = { downbeat, upbeat };
    decodedBufferCache.set(soundId, res);
    loadingPromises.delete(soundId);
    return res;
  })();

  loadingPromises.set(soundId, promise);
  return promise;
}

/** Preload all soundsets in background */
export function preloadAllMetronomeSoundsets(ac?: AudioContext): void {
  for (const s of METRONOME_SOUNDSETS) {
    if (s.id !== 'synth') {
      loadSoundsetBuffers(s.id, ac).catch(() => {});
    }
  }
}

/** Play a single metronome pulse */
export function playMetronomePulse(
  ac: AudioContext,
  soundId: string,
  isDownbeat: boolean,
  isAccent: boolean,
  volume = 0.85,
  destination?: AudioNode
): void {
  const dest = destination || ac.destination;
  const now = ac.currentTime;

  if (soundId === 'synth') {
    playSynthClick(ac, isDownbeat, isAccent, volume, dest);
    return;
  }

  const cached = decodedBufferCache.get(soundId);
  const buffer = isDownbeat ? cached?.downbeat : cached?.upbeat;

  if (!buffer) {
    // If soundset is still loading, play synth fallback and trigger load
    playSynthClick(ac, isDownbeat, isAccent, volume, dest);
    loadSoundsetBuffers(soundId, ac).catch(() => {});
    return;
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const gain = ac.createGain();
  const gainVal = isDownbeat ? volume * 1.0 : isAccent ? volume * 0.85 : volume * 0.7;
  gain.gain.setValueAtTime(gainVal, now);

  source.connect(gain);
  gain.connect(dest);
  source.start(now);
}

function playSynthClick(
  ac: AudioContext,
  isDownbeat: boolean,
  isAccent: boolean,
  volume: number,
  dest: AudioNode
): void {
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  const freq = isDownbeat ? 1400 : isAccent ? 1050 : 800;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.035);

  const clickVol = (isDownbeat ? 0.9 : isAccent ? 0.75 : 0.6) * volume;
  gain.gain.setValueAtTime(clickVol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

  osc.connect(gain);
  gain.connect(dest);

  osc.start(now);
  osc.stop(now + 0.04);
}

/**
 * 16-bit PCM WAV Encoder from AudioBuffer
 */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // 'RIFF' header
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, totalSize - 8, true);
  view.setUint32(8, 0x57415645, false); // 'WAVE'

  // 'fmt ' chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit

  // 'data' chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Uint8Array(arrayBuffer);
}

/**
 * Generates an offline rendered multi-bar .wav click track loop with exact downbeats and upbeats
 */
export async function generateMetronomeWav(
  soundId: string,
  bpm = 120,
  timeSignature = '4/4',
  bars = 4
): Promise<Uint8Array> {
  const safeBpm = Math.max(20, Math.min(400, Number(bpm) || 120));
  const parts = String(timeSignature || '4/4').split('/');
  const num = parseInt(parts[0], 10) || 4;
  const den = parseInt(parts[1], 10) || 4;

  const secondsPerQuarter = 60 / safeBpm;
  const secondsPerBeat = (secondsPerQuarter * 4) / den;
  const totalBeats = num * bars;
  const totalDuration = totalBeats * secondsPerBeat;

  const sampleRate = 44100;
  const lengthSamples = Math.ceil(totalDuration * sampleRate);

  const offlineAc = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    2,
    lengthSamples,
    sampleRate
  );

  let buffers: DecodedSoundset = { downbeat: null, upbeat: null };
  if (soundId !== 'synth') {
    buffers = await loadSoundsetBuffers(soundId, offlineAc);
  }

  for (let b = 0; b < totalBeats; b++) {
    const beatTime = b * secondsPerBeat;
    const beatInBar = b % num;
    const isDownbeat = beatInBar === 0;

    let isSubAccent = false;
    if (num === 4 && beatInBar === 2) isSubAccent = true;
    else if (num === 6 && beatInBar === 3) isSubAccent = true;
    else if (num === 7 && (beatInBar === 3 || beatInBar === 5)) isSubAccent = true;
    else if (num === 5 && beatInBar === 3) isSubAccent = true;
    else if (num === 12 && (beatInBar === 3 || beatInBar === 6 || beatInBar === 9)) isSubAccent = true;

    if (soundId !== 'synth' && (isDownbeat ? buffers.downbeat : buffers.upbeat)) {
      const src = offlineAc.createBufferSource();
      src.buffer = isDownbeat ? buffers.downbeat : buffers.upbeat;

      const gain = offlineAc.createGain();
      const vol = isDownbeat ? 0.95 : isSubAccent ? 0.8 : 0.65;
      gain.gain.setValueAtTime(vol, beatTime);

      src.connect(gain);
      gain.connect(offlineAc.destination);
      src.start(beatTime);
    } else {
      // Synth click
      const osc = offlineAc.createOscillator();
      const gain = offlineAc.createGain();

      const freq = isDownbeat ? 1400 : isSubAccent ? 1050 : 800;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, beatTime);
      osc.frequency.exponentialRampToValueAtTime(80, beatTime + 0.035);

      const clickVol = isDownbeat ? 0.9 : isSubAccent ? 0.75 : 0.6;
      gain.gain.setValueAtTime(clickVol, beatTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, beatTime + 0.035);

      osc.connect(gain);
      gain.connect(offlineAc.destination);

      osc.start(beatTime);
      osc.stop(beatTime + 0.04);
    }
  }

  const renderedBuffer = await offlineAc.startRendering();
  return audioBufferToWav(renderedBuffer);
}

/**
 * Generates rhythmic MIDI click track
 */
export function generateMetronomeMidi(
  bpm = 120,
  timeSignature = '4/4',
  bars = 8
): Uint8Array {
  return rhythmGuideMidi(bpm, timeSignature, { bars });
}
