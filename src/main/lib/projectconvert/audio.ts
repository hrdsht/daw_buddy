'use strict';

/**
 * WAV helpers for the converter: header info, decode to float, encode float.
 * Reuses the chunk-walking WAV parser from ../silence, which already copes
 * with LIST chunks before `data`, odd padding and WAVE_FORMAT_EXTENSIBLE.
 */

import fsp from 'fs/promises';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const silence = require('../silence');

export interface AudioInfo {
  sampleRate: number;
  channels: number;
  duration: number; // seconds
}

export async function audioInfo(file: string): Promise<AudioInfo | null> {
  if (!/\.wave?$/i.test(file)) return null;
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const head = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const parsed = silence.parseWav(head.subarray(0, bytesRead), { headerOnly: true });
    if (parsed.error) return null;
    const frameBytes = (parsed.fmt.bitsPerSample / 8) * parsed.fmt.numChannels;
    const stat = await handle.stat();
    const dataBytes = Math.min(parsed.declaredDataSize, stat.size - parsed.dataOffset);
    return {
      sampleRate: parsed.fmt.sampleRate,
      channels: parsed.fmt.numChannels,
      duration: Math.max(0, dataBytes / frameBytes / parsed.fmt.sampleRate)
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export interface Decoded {
  sampleRate: number;
  channels: Float32Array[];
}

/** Decode a PCM/float WAV into one Float32Array per channel. */
export async function decodeWav(file: string): Promise<Decoded> {
  const buf = await fsp.readFile(file);
  const parsed = silence.parseWav(buf);
  if (parsed.error) throw new Error(parsed.error);
  const { fmt, dataOffset, dataSize } = parsed;
  const bytes = fmt.bitsPerSample / 8;
  const frames = Math.floor(dataSize / (bytes * fmt.numChannels));
  const channels = Array.from({ length: fmt.numChannels }, () => new Float32Array(frames));
  let pos = dataOffset;
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < fmt.numChannels; c += 1) {
      let v: number;
      if (fmt.bitsPerSample === 16) v = buf.readInt16LE(pos) / 32768;
      else if (fmt.bitsPerSample === 24) {
        let x = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
        if (x & 0x800000) x -= 0x1000000;
        v = x / 8388608;
      } else if (fmt.int32) v = buf.readInt32LE(pos) / 2147483648;
      else v = buf.readFloatLE(pos);
      channels[c][f] = v;
      pos += bytes;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}

/** 32-bit float WAV — headroom for overlapping clips, opens everywhere. */
export function encodeWavFloat(channels: Float32Array[], sampleRate: number): Buffer {
  const numChannels = channels.length;
  const frames = channels[0]?.length || 0;
  const dataSize = frames * numChannels * 4;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 4, 28);
  buf.writeUInt16LE(numChannels * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let pos = 44;
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < numChannels; c += 1) {
      buf.writeFloatLE(channels[c][f], pos);
      pos += 4;
    }
  }
  return buf;
}
