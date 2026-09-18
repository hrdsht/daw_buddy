'use strict';

/**
 * Variable-length quantity helper for reading MIDI deltas and lengths.
 */
function readVlq(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  while (offset + bytesRead < bytes.length) {
    const b = bytes[offset + bytesRead];
    bytesRead++;
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { value, bytesRead };
}

export interface NoteTransformFn {
  (note: number): number;
}

/**
 * Walks a Standard MIDI File (format 0 or 1) and applies a transformation function
 * to every Note-On, Note-Off, and Polyphonic Aftertouch event.
 * Track lengths and all metadata / controllers remain intact.
 */
export function transformMidiNotes(midiBytes: Uint8Array, transform: NoteTransformFn): Uint8Array {
  if (
    midiBytes.length < 14 ||
    midiBytes[0] !== 0x4d ||
    midiBytes[1] !== 0x54 ||
    midiBytes[2] !== 0x68 ||
    midiBytes[3] !== 0x64
  ) {
    throw new Error('Not a valid Standard MIDI File (.mid)');
  }

  const output = new Uint8Array(midiBytes);
  const numTracks = (output[10] << 8) | output[11];
  let offset = 14;

  for (let t = 0; t < numTracks && offset < output.length; t++) {
    if (
      output[offset] !== 0x4d ||
      output[offset + 1] !== 0x54 ||
      output[offset + 2] !== 0x72 ||
      output[offset + 3] !== 0x6b
    ) {
      break;
    }

    const trackLen =
      (output[offset + 4] << 24) |
      (output[offset + 5] << 16) |
      (output[offset + 6] << 8) |
      output[offset + 7];
    offset += 8;
    const trackEnd = offset + trackLen;

    let runningStatus = 0;

    while (offset < trackEnd && offset < output.length) {
      // Read variable-length delta time
      const delta = readVlq(output, offset);
      offset += delta.bytesRead;

      if (offset >= output.length) break;

      let status = output[offset];
      if (status & 0x80) {
        runningStatus = status;
        offset++;
      } else {
        status = runningStatus;
      }

      const msgType = status & 0xf0;

      if (status === 0xff) {
        // Meta event
        offset++; // meta type
        const len = readVlq(output, offset);
        offset += len.bytesRead + len.value;
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx event
        const len = readVlq(output, offset);
        offset += len.bytesRead + len.value;
      } else if (msgType === 0x90 || msgType === 0x80 || msgType === 0xa0) {
        // Note On (0x90), Note Off (0x80), or Polyphonic Aftertouch (0xa0)
        const noteIndex = offset;
        const currentNote = output[noteIndex];
        const transformed = transform(currentNote);
        output[noteIndex] = Math.max(0, Math.min(127, Math.round(transformed)));
        offset += 2; // note byte + velocity/pressure byte
      } else if (msgType === 0xb0 || msgType === 0xe0) {
        // Control Change (0xb0) or Pitch Bend (0xe0)
        offset += 2;
      } else if (msgType === 0xc0 || msgType === 0xd0) {
        // Program Change (0xc0) or Channel Pressure (0xd0)
        offset += 1;
      } else {
        // Fallback for unexpected status byte
        offset++;
      }
    }

    offset = trackEnd;
  }

  return output;
}

/**
 * Transpose all notes in a Standard MIDI File by a fixed number of chromatic semitones.
 */
export function transposeMidiBytes(midiBytes: Uint8Array, semitones: number): Uint8Array {
  if (semitones === 0) return new Uint8Array(midiBytes);
  return transformMidiNotes(midiBytes, (note) => note + semitones);
}

/**
 * Modally remap notes in a Standard MIDI File from a source scale to a target scale.
 * Scale degrees: e.g. Major = [0, 2, 4, 5, 7, 9, 11], Minor = [0, 2, 3, 5, 7, 8, 10].
 * If a note is outside the source scale (accidental/passing note), it is transposed by the key root delta.
 */
export function remapMidiToScale(
  midiBytes: Uint8Array,
  srcTonicPc: number,
  srcDegrees: number[],
  dstTonicPc: number,
  dstDegrees: number[]
): Uint8Array {
  const rootShift = (dstTonicPc - srcTonicPc + 12) % 12;
  const shortestShift = rootShift > 6 ? rootShift - 12 : rootShift;

  const mapping: Record<number, number> = {};

  // Map each degree of source scale to corresponding degree of destination scale
  for (let i = 0; i < srcDegrees.length; i++) {
    const srcNotePc = (srcTonicPc + srcDegrees[i]) % 12;
    const dstDegree = dstDegrees[i % dstDegrees.length];
    const dstNotePc = (dstTonicPc + dstDegree) % 12;
    mapping[srcNotePc] = dstNotePc;
  }

  return transformMidiNotes(midiBytes, (origNote) => {
    const pitchClass = origNote % 12;

    if (mapping[pitchClass] !== undefined) {
      const targetPc = mapping[pitchClass];
      let pcDelta = targetPc - pitchClass;
      if (pcDelta > 6) pcDelta -= 12;
      else if (pcDelta < -6) pcDelta += 12;
      return origNote + pcDelta;
    }

    // Chromatic passing note fallback: apply root shift
    return origNote + shortestShift;
  });
}

/**
 * Calculate the optimal (shortest interval) semitone difference between two pitch classes.
 */
export function calculateShortestSemitoneShift(srcPc: number, dstPc: number): number {
  const delta = (dstPc - srcPc + 12) % 12;
  return delta > 6 ? delta - 12 : delta;
}

/**
 * Transpose an array of note names or chord tokens.
 */
export function transposeChordName(
  chord: string,
  semitones: number,
  notesList: string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
): string {
  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return chord;
  const [, root, suffix] = match;
  let pc = notesList.indexOf(root);
  if (pc === -1) {
    const flatMap: Record<string, string> = {
      Db: 'C#',
      Eb: 'D#',
      Gb: 'F#',
      Ab: 'G#',
      Bb: 'A#'
    };
    if (flatMap[root]) pc = notesList.indexOf(flatMap[root]);
  }
  if (pc === -1) return chord;
  const newPc = (pc + semitones + 120) % 12;
  return `${notesList[newPc]}${suffix}`;
}
