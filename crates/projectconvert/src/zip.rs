//! Minimal zip reader and writer — twins of `zipreader.ts` and
//! `zipwriter.ts`. Text is deflated, audio stored; no zip64, so archives
//! stay under 4 GB.

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::{Read, Write};

pub struct Entry {
    pub name: String,
    pub size: u32,
    pub compressed_size: u32,
    pub offset: u32,
    pub method: u16,
}

fn u16le(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}
fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

pub fn list_entries(buf: &[u8]) -> Option<Vec<Entry>> {
    if buf.len() < 22 {
        return None;
    }
    let limit = buf.len().saturating_sub(66_000);
    let mut eocd = None;
    let mut i = buf.len() - 22;
    loop {
        if u32le(buf, i) == 0x0605_4b50 {
            eocd = Some(i);
            break;
        }
        if i == limit || i == 0 {
            break;
        }
        i -= 1;
    }
    let eocd = eocd?;
    let count = u16le(buf, eocd + 10) as usize;
    let mut pos = u32le(buf, eocd + 16) as usize;
    let mut out = Vec::new();
    for _ in 0..count {
        if pos + 46 > buf.len() || u32le(buf, pos) != 0x0201_4b50 {
            break;
        }
        let name_len = u16le(buf, pos + 28) as usize;
        let extra = u16le(buf, pos + 30) as usize;
        let comment = u16le(buf, pos + 32) as usize;
        if pos + 46 + name_len > buf.len() {
            break;
        }
        out.push(Entry {
            name: String::from_utf8_lossy(&buf[pos + 46..pos + 46 + name_len]).to_string(),
            method: u16le(buf, pos + 10),
            compressed_size: u32le(buf, pos + 20),
            size: u32le(buf, pos + 24),
            offset: u32le(buf, pos + 42),
        });
        pos += 46 + name_len + extra + comment;
    }
    Some(out)
}

pub fn read_entry(buf: &[u8], e: &Entry, max_bytes: usize) -> Option<Vec<u8>> {
    if e.size as usize > max_bytes {
        return None;
    }
    let off = e.offset as usize;
    if off + 30 > buf.len() {
        return None;
    }
    let start = off + 30 + u16le(buf, off + 26) as usize + u16le(buf, off + 28) as usize;
    let end = (start + e.compressed_size as usize).min(buf.len());
    let data = buf.get(start..end)?;
    match e.method {
        0 => Some(data.to_vec()),
        8 => {
            let mut out = Vec::with_capacity(e.size as usize);
            DeflateDecoder::new(data).read_to_end(&mut out).ok()?;
            Some(out)
        }
        _ => None,
    }
}

struct Written {
    name: Vec<u8>,
    crc: u32,
    size: u32,
    compressed: u32,
    method: u16,
    offset: u32,
}

#[derive(Default)]
pub struct ZipWriter {
    parts: Vec<u8>,
    entries: Vec<Written>,
}

impl ZipWriter {
    pub fn add(&mut self, name: &str, data: &[u8], compress: bool) -> Result<(), String> {
        let name_b = name.as_bytes().to_vec();
        let deflated = if compress {
            let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
            enc.write_all(data).map_err(|e| e.to_string())?;
            Some(enc.finish().map_err(|e| e.to_string())?)
        } else {
            None
        };
        let use_deflate = deflated.as_ref().map(|d| d.len() < data.len()).unwrap_or(false);
        let body: &[u8] = if use_deflate { deflated.as_ref().unwrap() } else { data };
        if self.parts.len() + 30 + name_b.len() + body.len() > (u32::MAX as usize) - 1024 * 1024 {
            return Err("Converted project would exceed 4 GB — too large for a DAWproject file.".into());
        }
        let crc = crc32(data);
        let method: u16 = if use_deflate { 8 } else { 0 };
        let offset = self.parts.len() as u32;
        let p = &mut self.parts;
        p.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        p.extend_from_slice(&20u16.to_le_bytes());
        p.extend_from_slice(&0x0800u16.to_le_bytes());
        p.extend_from_slice(&method.to_le_bytes());
        p.extend_from_slice(&0u16.to_le_bytes());
        p.extend_from_slice(&0x21u16.to_le_bytes());
        p.extend_from_slice(&crc.to_le_bytes());
        p.extend_from_slice(&(body.len() as u32).to_le_bytes());
        p.extend_from_slice(&(data.len() as u32).to_le_bytes());
        p.extend_from_slice(&(name_b.len() as u16).to_le_bytes());
        p.extend_from_slice(&0u16.to_le_bytes());
        p.extend_from_slice(&name_b);
        p.extend_from_slice(body);
        self.entries.push(Written {
            name: name_b,
            crc,
            size: data.len() as u32,
            compressed: body.len() as u32,
            method,
            offset,
        });
        Ok(())
    }

    pub fn finish(mut self) -> Vec<u8> {
        let central_start = self.parts.len() as u32;
        let mut central = Vec::new();
        for e in &self.entries {
            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&0x0800u16.to_le_bytes());
            central.extend_from_slice(&e.method.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0x21u16.to_le_bytes());
            central.extend_from_slice(&e.crc.to_le_bytes());
            central.extend_from_slice(&e.compressed.to_le_bytes());
            central.extend_from_slice(&e.size.to_le_bytes());
            central.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0u8; 8]); // extra, comment, disk, internal attr
            central.extend_from_slice(&0u32.to_le_bytes()); // ext attr
            central.extend_from_slice(&e.offset.to_le_bytes());
            central.extend_from_slice(&e.name);
        }
        let n = self.entries.len() as u16;
        let size = central.len() as u32;
        self.parts.extend_from_slice(&central);
        self.parts.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        self.parts.extend_from_slice(&[0u8; 4]);
        self.parts.extend_from_slice(&n.to_le_bytes());
        self.parts.extend_from_slice(&n.to_le_bytes());
        self.parts.extend_from_slice(&size.to_le_bytes());
        self.parts.extend_from_slice(&central_start.to_le_bytes());
        self.parts.extend_from_slice(&0u16.to_le_bytes());
        self.parts
    }
}

pub fn crc32(buf: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, slot) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *slot = c;
        }
        t
    });
    let mut crc = 0xffff_ffffu32;
    for &b in buf {
        crc = table[((crc ^ b as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    crc ^ 0xffff_ffff
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        let mut z = ZipWriter::default();
        z.add("a.txt", b"hello hello hello hello", true).unwrap();
        z.add("b.bin", &[1, 2, 3], false).unwrap();
        let buf = z.finish();
        let entries = list_entries(&buf).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(read_entry(&buf, &entries[0], 1 << 20).unwrap(), b"hello hello hello hello");
        assert_eq!(read_entry(&buf, &entries[1], 1 << 20).unwrap(), vec![1, 2, 3]);
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }
}
