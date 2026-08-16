'use strict';

/**
 * Small, dependency-free ID3 reader/editor.
 * Metadata is rebuilt while the MPEG audio bytes are copied byte-for-byte.
 */

const fs = require('fs/promises');
const path = require('path');

const FIELD_FRAMES = {
  title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2',
  composer: 'TCOM', publisher: 'TPUB', copyright: 'TCOP', genre: 'TCON',
  year: 'TDRC', track: 'TRCK'
};
const FRAME_FIELDS = Object.fromEntries(
  Object.entries(FIELD_FRAMES).map(([field, frame]) => [frame, field])
);
const V22_FIELDS = {
  TT2: 'title', TP1: 'artist', TAL: 'album', TP2: 'albumArtist',
  TCM: 'composer', TPB: 'publisher', TCR: 'copyright', TCO: 'genre',
  TYE: 'year', TRK: 'track'
};

async function inspect(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    let headBytes = 0;
    let v2Count = 0;
    const tags = [];

    while (headBytes + 10 <= stat.size) {
      const header = Buffer.alloc(10);
      const read = await handle.read(header, 0, 10, headBytes);
      if (read.bytesRead < 10 || header.toString('ascii', 0, 3) !== 'ID3') break;
      const bodySize = syncsafe(header, 6);
      const footer = header[5] & 0x10 ? 10 : 0;
      const total = 10 + bodySize + footer;
      if (headBytes + total > stat.size) break;

      // Text frames are normally tiny. Read even artwork-bearing tags up to
      // 64 MB, but do not let a malformed tag allocate unlimited memory.
      if (bodySize <= 64 * 1024 * 1024) {
        const tag = Buffer.alloc(10 + bodySize);
        header.copy(tag);
        if (bodySize > 0) await handle.read(tag, 10, bodySize, headBytes + 10);
        tags.push(tag);
      }
      headBytes += total;
      v2Count += 1;
    }

    let tailBytes = 0;
    let tail = null;
    if (stat.size >= 128) {
      tail = Buffer.alloc(128);
      await handle.read(tail, 0, 128, stat.size - 128);
      if (tail.toString('ascii', 0, 3) === 'TAG') tailBytes = 128;
      else tail = null;
    }

    const fields = {};
    tags.forEach((tag) => readV2Fields(tag, fields));
    if (tail) readV1Fields(tail, fields);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      headBytes,
      tailBytes,
      hasV2: v2Count > 0,
      v2Count,
      hasV1: tailBytes > 0,
      fields,
      bytesRemovable: headBytes + tailBytes
    };
  } finally {
    await handle.close();
  }
}

async function inspectFolder(folder, maxDepth = 8) {
  const paths = [];
  await findMp3s(folder, paths, 0, maxDepth);
  paths.sort((a, b) => a.localeCompare(b));
  const results = [];
  for (const filePath of paths) {
    try {
      results.push(await inspect(filePath));
    } catch (error) {
      results.push({ path: filePath, name: path.basename(filePath), size: 0,
        fields: {}, bytesRemovable: 0, error: error.message });
    }
  }
  return results;
}

async function findMp3s(folder, out, depth, maxDepth) {
  if (depth > maxDepth || out.length >= 10000) return;
  let contents;
  try {
    contents = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of contents) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await findMp3s(full, out, depth + 1, maxDepth);
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.mp3') out.push(full);
  }
}

function measure(buf) {
  let headBytes = 0;
  let v2Count = 0;
  while (buf.length >= headBytes + 10 &&
    buf[headBytes] === 0x49 && buf[headBytes + 1] === 0x44 && buf[headBytes + 2] === 0x33) {
    const flags = buf[headBytes + 5];
    const size = syncsafe(buf, headBytes + 6);
    const total = 10 + size + (flags & 0x10 ? 10 : 0);
    if (headBytes + total > buf.length) break;
    headBytes += total;
    v2Count += 1;
  }

  const tailBytes = buf.length >= 128 &&
    buf[buf.length - 128] === 0x54 && buf[buf.length - 127] === 0x41 &&
    buf[buf.length - 126] === 0x47 ? 128 : 0;
  return { headBytes, tailBytes, hasV2: v2Count > 0, v2Count, hasV1: tailBytes > 0 };
}

function readFields(buf, layout = measure(buf)) {
  const fields = {};
  if (layout.hasV2) readV2Fields(buf, fields);
  if (layout.hasV1) readV1Fields(buf, fields);
  return fields;
}

function readV2Fields(buf, fields) {
  const version = buf[3];
  const tagEnd = Math.min(buf.length, 10 + syncsafe(buf, 6));
  let offset = 10;
  if (buf[5] & 0x40) {
    if (version === 4 && offset + 4 <= tagEnd) offset += syncsafe(buf, offset);
    else if (offset + 4 <= tagEnd) offset += 4 + buf.readUInt32BE(offset);
  }

  while (offset < tagEnd) {
    const idLength = version === 2 ? 3 : 4;
    const headerLength = version === 2 ? 6 : 10;
    if (offset + headerLength > tagEnd) break;
    const id = buf.toString('ascii', offset, offset + idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = version === 2
      ? (buf[offset + 3] << 16) | (buf[offset + 4] << 8) | buf[offset + 5]
      : version === 4 ? syncsafe(buf, offset + 4) : buf.readUInt32BE(offset + 4);
    const start = offset + headerLength;
    const end = start + size;
    if (end > tagEnd) break;
    const field = version === 2 ? V22_FIELDS[id] : FRAME_FIELDS[id];
    if (field && !fields[field]) fields[field] = decodeText(buf.subarray(start, end));
    if ((id === 'COMM' || id === 'COM') && !fields.comment) {
      fields.comment = decodeComment(buf.subarray(start, end));
    }
    offset = end;
  }
}

function readV1Fields(buf, fields) {
  const start = buf.length - 128;
  const values = {
    title: latin1(buf.subarray(start + 3, start + 33)),
    artist: latin1(buf.subarray(start + 33, start + 63)),
    album: latin1(buf.subarray(start + 63, start + 93)),
    year: latin1(buf.subarray(start + 93, start + 97)),
    comment: latin1(buf.subarray(start + 97, start + 127))
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value && !fields[key]) fields[key] = value;
  });
}

function decodeText(payload) {
  if (!payload.length) return '';
  return decodeEncoded(payload.subarray(1), payload[0]).replace(/\0+$/g, '').trim();
}

function decodeComment(payload) {
  if (payload.length < 4) return '';
  const encoding = payload[0];
  let body = payload.subarray(4);
  const separator = encoding === 1 || encoding === 2 ? findDoubleZero(body) : body.indexOf(0);
  if (separator >= 0) body = body.subarray(separator + (encoding === 1 || encoding === 2 ? 2 : 1));
  return decodeEncoded(body, encoding).replace(/\0+$/g, '').trim();
}

function decodeEncoded(bytes, encoding) {
  if (encoding === 0) return bytes.toString('latin1');
  if (encoding === 3) return bytes.toString('utf8');
  if (encoding === 2) return swap16(bytes).toString('utf16le');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return swap16(bytes.subarray(2)).toString('utf16le');
  return bytes.toString('utf16le');
}

function swap16(bytes) {
  const out = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] = bytes[i + 1];
    out[i + 1] = bytes[i];
  }
  return out;
}

function findDoubleZero(bytes) {
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  }
  return -1;
}

function latin1(bytes) {
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero >= 0 ? zero : bytes.length).toString('latin1').trim();
}

function syncsafe(buf, offset) {
  return ((buf[offset] & 0x7f) << 21) | ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) | (buf[offset + 3] & 0x7f);
}

function syncsafeBuffer(value) {
  return Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f,
    (value >> 7) & 0x7f, value & 0x7f]);
}

function buildTag(rawFields) {
  const fields = sanitiseFields(rawFields);
  const frames = [];
  for (const [field, id] of Object.entries(FIELD_FRAMES)) {
    if (fields[field]) frames.push(buildFrame(id,
      Buffer.concat([Buffer.from([3]), Buffer.from(fields[field], 'utf8')])));
  }
  if (fields.comment) {
    frames.push(buildFrame('COMM', Buffer.concat([
      Buffer.from([3]), Buffer.from('eng', 'ascii'), Buffer.from([0]),
      Buffer.from(fields.comment, 'utf8')
    ])));
  }
  if (!frames.length) return Buffer.alloc(0);
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = 4;
  syncsafeBuffer(body.length).copy(header, 6);
  return Buffer.concat([header, body]);
}

function buildFrame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'ascii');
  syncsafeBuffer(payload.length).copy(header, 4);
  return Buffer.concat([header, payload]);
}

function sanitiseFields(raw = {}) {
  const fields = {};
  for (const key of [...Object.keys(FIELD_FRAMES), 'comment']) {
    if (typeof raw[key] !== 'string') continue;
    const value = raw[key].replace(/\0/g, '').trim().slice(0, 1000);
    if (value) fields[key] = value;
  }
  return fields;
}

async function rewrite(filePath, fields) {
  const buf = await fs.readFile(filePath);
  const layout = measure(buf);
  const audio = buf.subarray(layout.headBytes, buf.length - layout.tailBytes);
  if (audio.length === 0) throw new Error('Refusing to write an empty file');
  const tag = buildTag(fields);
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temp, tag.length ? Buffer.concat([tag, audio]) : audio);
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return { path: filePath, name: path.basename(filePath), changed: true,
    removed: layout.headBytes + layout.tailBytes, written: tag.length,
    before: buf.length, after: tag.length + audio.length };
}

async function strip(filePath) {
  const buf = await fs.readFile(filePath);
  const layout = measure(buf);
  if (layout.headBytes + layout.tailBytes === 0) {
    return { path: filePath, changed: false, removed: 0 };
  }
  return rewrite(filePath, {});
}

async function write(filePath, fields) {
  return rewrite(filePath, fields);
}

module.exports = { inspect, inspectFolder, strip, write, measure, readFields,
  buildTag, sanitiseFields };
