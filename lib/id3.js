'use strict';

/**
 * Strips ID3 tags out of MP3 files.
 *
 * This is pure byte surgery — no library needed. An MP3 with tags looks like:
 *
 *   [ID3v2 header + tag data]  at the very start, optional, can be stacked
 *   [ ...the actual audio... ]
 *   [ID3v1 tag, exactly 128 bytes]  at the very end, optional
 *
 * ID3v2 header, 10 bytes:
 *   0-2  the letters "ID3"
 *   3-4  version
 *   5    flags (bit 0x10 means a 10 byte footer follows the tag)
 *   6-9  size, as a "syncsafe" integer
 *
 * Syncsafe means each byte only uses its low 7 bits, so the tag data can
 * never accidentally contain the bit pattern that marks the start of an audio
 * frame. Four bytes therefore carry 28 bits, not 32. That's why the size is
 * assembled with shifts of 21/14/7/0 rather than 24/16/8/0.
 *
 * ID3v1 is simpler: the last 128 bytes, starting with the letters "TAG".
 */

const fs = require('fs/promises');
const path = require('path');

async function inspect(filePath) {
  const buf = await fs.readFile(filePath);
  const layout = measure(buf);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: buf.length,
    ...layout,
    bytesRemovable: layout.headBytes + layout.tailBytes
  };
}

function measure(buf) {
  let headBytes = 0;
  let v2Count = 0;

  // Tags can be stacked. Keep peeling while another one starts.
  while (
    buf.length >= headBytes + 10 &&
    buf[headBytes] === 0x49 && // I
    buf[headBytes + 1] === 0x44 && // D
    buf[headBytes + 2] === 0x33 // 3
  ) {
    const flags = buf[headBytes + 5];
    const size = syncsafe(buf, headBytes + 6);
    const footer = flags & 0x10 ? 10 : 0;
    const total = 10 + size + footer;

    if (size <= 0 || headBytes + total > buf.length) break; // malformed
    headBytes += total;
    v2Count += 1;
  }

  let tailBytes = 0;
  if (
    buf.length >= 128 &&
    buf[buf.length - 128] === 0x54 && // T
    buf[buf.length - 127] === 0x41 && // A
    buf[buf.length - 126] === 0x47 // G
  ) {
    tailBytes = 128;
  }

  return {
    headBytes,
    tailBytes,
    hasV2: v2Count > 0,
    v2Count,
    hasV1: tailBytes > 0
  };
}

function syncsafe(buf, offset) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

/**
 * Rewrites the file without its tags. Writes to a temporary file first and
 * renames on success, so a crash mid-write can't leave you with half an mp3.
 */
async function strip(filePath) {
  const buf = await fs.readFile(filePath);
  const layout = measure(buf);
  const removed = layout.headBytes + layout.tailBytes;

  if (removed === 0) {
    return { path: filePath, changed: false, removed: 0 };
  }

  const audio = buf.subarray(layout.headBytes, buf.length - layout.tailBytes);
  if (audio.length === 0) {
    throw new Error('Refusing to write an empty file');
  }

  const temp = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(temp, audio);
  await fs.rename(temp, filePath);

  return {
    path: filePath,
    name: path.basename(filePath),
    changed: true,
    removed,
    before: buf.length,
    after: audio.length
  };
}

module.exports = { inspect, strip, measure };
