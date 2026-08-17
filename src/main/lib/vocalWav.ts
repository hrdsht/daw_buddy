'use strict';

/**
 * Writes a brand-new WAV file from a format descriptor and a raw PCM buffer.
 *
 * `silence.ts`'s `buildHeader` rebuilds a header from an *existing* buffer's
 * leading chunks — it has nothing to copy from when the audio being written
 * doesn't come from a single source file (a rebuilt timeline assembled from
 * many blocks, or one exported block sliced out of a bigger recording). This
 * always writes the plain 44-byte RIFF/fmt/data layout; no LIST/cue chunks,
 * since there is no original header to preserve for these outputs.
 */

interface WavFmt {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function writeWav(fmt: WavFmt, pcmBuffer: Buffer): Buffer {
  const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
  const byteRate = fmt.sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(fmt.audioFormat, 20);
  header.writeUInt16LE(fmt.numChannels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(fmt.bitsPerSample, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

module.exports = { writeWav };
