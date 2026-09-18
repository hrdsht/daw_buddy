'use strict';

import { encodeWavBuffer } from './slowed-reverb';

/**
 * Calculates the semitone difference from source pitch class to destination pitch class.
 * Returns the shortest chromatic interval (-6 to +5), or normalized positive (0 to 11).
 */
export function getPitchDeltaSemitones(srcPc: number, dstPc: number, preferShortest = true): number {
  const diff = (dstPc - srcPc + 12) % 12;
  if (!preferShortest) return diff;
  return diff > 6 ? diff - 12 : diff;
}

/**
 * Pitch shifts an AudioBuffer by resampling via playbackRate on an OfflineAudioContext.
 * Positive semitones = higher pitch (+faster duration); negative = lower pitch (+longer duration).
 */
export async function renderPitchShiftedAudio(
  sourceBuffer: AudioBuffer,
  semitones: number,
  targetSampleRate?: number
): Promise<AudioBuffer> {
  const sRate = targetSampleRate || sourceBuffer.sampleRate;
  const playbackRate = Math.pow(2, semitones / 12);
  const targetLength = Math.max(1, Math.round(sourceBuffer.length / playbackRate));

  const OfflineCtxClass =
    window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;

  if (!OfflineCtxClass) {
    throw new Error('OfflineAudioContext is not available in this environment.');
  }

  const offlineCtx = new OfflineCtxClass(
    Math.min(2, Math.max(1, sourceBuffer.numberOfChannels)),
    targetLength,
    sRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = playbackRate;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Encodes pitch-shifted AudioBuffer into WAV bytes (16-bit PCM by default).
 */
export function pitchShiftedToWavBytes(buffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Uint8Array {
  return encodeWavBuffer(buffer, bitDepth);
}
