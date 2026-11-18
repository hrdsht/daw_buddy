'use strict';

/**
 * A minimal zip writer — the counterpart to ../zipreader. DAWproject files
 * are zips, and Node ships deflate but not the zip container.
 *
 * Text is deflated; audio is STORED (already incompressible, and storing keeps
 * conversion fast). No zip64, so the whole archive must stay under 4 GB —
 * `add` throws before that happens rather than writing a broken file.
 */

import zlib from 'zlib';

const LIMIT = 0xffffffff;

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
}

export class ZipWriter {
  private parts: Buffer[] = [];
  private entries: Entry[] = [];
  private offset = 0;

  add(name: string, data: Buffer, compress = true): void {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = compress ? zlib.deflateRawSync(data) : null;
    const useDeflate = !!deflated && deflated.length < data.length;
    const body = useDeflate ? (deflated as Buffer) : data;
    const crc = crc32(data);

    if (this.offset + 30 + nameBuf.length + body.length > LIMIT - 1024 * 1024) {
      throw new Error('Converted project would exceed 4 GB — too large for a DAWproject file.');
    }

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0x21, 12); // date: 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    this.entries.push({
      name: nameBuf,
      crc,
      size: data.length,
      compressedSize: body.length,
      method: useDeflate ? 8 : 0,
      offset: this.offset
    });
    this.parts.push(header, nameBuf, body);
    this.offset += header.length + nameBuf.length + body.length;
  }

  toBuffer(): Buffer {
    const central: Buffer[] = [];
    let centralSize = 0;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(0, 12);
      h.writeUInt16LE(0x21, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      central.push(h, e.name);
      centralSize += h.length + e.name.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...this.parts, ...central, eocd]);
  }
}

let table: Int32Array | null = null;

export function crc32(buf: Buffer): number {
  const z = zlib as any;
  if (typeof z.crc32 === 'function') return z.crc32(buf) >>> 0;
  if (!table) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
