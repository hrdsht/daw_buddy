'use strict';

/**
 * A minimal zip reader, built on Node's zlib. No dependency needed.
 *
 * Node ships gzip but not zip. They are different things: gzip is one
 * compressed stream, zip is an archive format wrapping many compressed
 * streams plus a directory of what's inside.
 *
 * A zip is read from the BACK, which is the part that surprises people.
 * At the very end sits the "end of central directory" record, which says
 * where the file listing starts. That listing then points at each file's
 * local header. Reading forwards is impossible without it.
 *
 *   [file 1 data][file 2 data]...[central directory][EOCD]
 *                                                    ^ start here
 */

const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Returns [{ name, size, compressedSize, offset, method }] or null. */
function listEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > buf.length) break;
    if (buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) break;

    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength);

    entries.push({ name, size, compressedSize, offset, method });
    pos += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * The EOCD is at the end but can be followed by a comment of up to 64KB,
 * so we scan backwards for its signature rather than assuming a position.
 */
function findEocd(buf) {
  const limit = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= limit; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/** Decompresses one entry. Returns a Buffer, or null if it can't. */
function readEntry(buf, entry, maxBytes = 8 * 1024 * 1024) {
  if (entry.size > maxBytes) return null;
  if (entry.offset + 30 > buf.length) return null;

  // The local header repeats the name and extra length, and those can differ
  // from the central directory's, so they have to be read again here.
  const nameLength = buf.readUInt16LE(entry.offset + 26);
  const extraLength = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = buf.subarray(start, start + entry.compressedSize);

  try {
    if (entry.method === 0) return Buffer.from(data); // stored, not compressed
    if (entry.method === 8) return zlib.inflateRawSync(data);
  } catch {
    return null;
  }
  return null;
}

module.exports = { listEntries, readEntry };
