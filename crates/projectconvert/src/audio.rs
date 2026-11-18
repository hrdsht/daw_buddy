//! WAV helpers for the converter — header info, decode to float, encode
//! float. Same chunk walk as `silence.parseWav`: LIST chunks before `data`,
//! odd padding written either way, WAVE_FORMAT_EXTENSIBLE.

use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub struct Fmt {
    pub channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
    pub float: bool,
}

pub struct Parsed {
    pub fmt: Fmt,
    pub data_offset: usize,
    pub data_size: usize,
    pub declared_size: usize,
}

fn looks_like_id(b: &[u8], at: usize) -> bool {
    at + 4 <= b.len() && b[at..at + 4].iter().all(|&c| (0x20..=0x7e).contains(&c))
}

fn next_chunk(b: &[u8], pos: usize, size: usize) -> usize {
    let padded = pos + 8 + size + (size % 2);
    if size.is_multiple_of(2) {
        return padded;
    }
    let unpadded = pos + 8 + size;
    if looks_like_id(b, padded) {
        padded
    } else if looks_like_id(b, unpadded) {
        unpadded
    } else {
        padded
    }
}

pub fn parse_wav(b: &[u8], header_only: bool) -> Result<Parsed, String> {
    if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err("Not a valid uncompressed WAV file".into());
    }
    let mut pos = 12;
    let mut fmt = None;
    let mut data: Option<(usize, usize)> = None;
    while pos + 8 <= b.len() {
        let id = &b[pos..pos + 4];
        let size = u32::from_le_bytes([b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]]) as usize;
        if id == b"fmt " {
            if pos + 8 + 16 > b.len() {
                return Err("Truncated fmt chunk".into());
            }
            let r = |o: usize| u16::from_le_bytes([b[pos + 8 + o], b[pos + 9 + o]]);
            let mut format = r(0);
            if format == 0xfffe && pos + 8 + 26 <= b.len() {
                let sub = r(24);
                if sub == 1 || sub == 3 {
                    format = sub;
                }
            }
            if format != 1 && format != 3 {
                return Err("Unsupported format: audio is compressed".into());
            }
            let channels = r(2);
            let sample_rate = u32::from_le_bytes([b[pos + 12], b[pos + 13], b[pos + 14], b[pos + 15]]);
            let bits = r(14);
            if ![16, 24, 32].contains(&bits) {
                return Err(format!("Unsupported bit depth: {bits}-bit"));
            }
            if !(1..=8).contains(&channels) {
                return Err(format!("Unexpected channel count: {channels}"));
            }
            fmt = Some(Fmt { channels, sample_rate, bits, float: format == 3 && bits == 32 });
        } else if id == b"data" {
            data = Some((pos + 8, size));
        }
        if data.is_some() && fmt.is_some() && header_only {
            break;
        }
        pos = next_chunk(b, pos, size);
    }
    let (Some(fmt), Some((data_offset, declared))) = (fmt, data) else {
        return Err("Missing format or data chunks".into());
    };
    let available = b.len().saturating_sub(data_offset);
    let data_size = if header_only { declared } else { declared.min(available) };
    if data_size == 0 {
        return Err("Data chunk is empty".into());
    }
    Ok(Parsed { fmt, data_offset, data_size, declared_size: declared })
}

#[derive(Debug, Clone, Copy)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f64,
}

fn is_wav(p: &Path) -> bool {
    p.extension().map(|e| e.eq_ignore_ascii_case("wav") || e.eq_ignore_ascii_case("wave")).unwrap_or(false)
}

pub fn audio_info(file: &Path) -> Option<AudioInfo> {
    if !is_wav(file) {
        return None;
    }
    let mut f = std::fs::File::open(file).ok()?;
    let mut head = Vec::with_capacity(1 << 20);
    (&mut f).take(1 << 20).read_to_end(&mut head).ok()?;
    let parsed = parse_wav(&head, true).ok()?;
    let total = f.metadata().ok()?.len() as usize;
    let frame = (parsed.fmt.bits as usize / 8) * parsed.fmt.channels as usize;
    let bytes = parsed.declared_size.min(total.saturating_sub(parsed.data_offset));
    Some(AudioInfo {
        sample_rate: parsed.fmt.sample_rate,
        channels: parsed.fmt.channels,
        duration: (bytes as f64 / frame as f64 / parsed.fmt.sample_rate as f64).max(0.0),
    })
}

pub struct Decoded {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

pub fn decode_wav(file: &Path) -> Result<Decoded, String> {
    let b = std::fs::read(file).map_err(|e| e.to_string())?;
    let p = parse_wav(&b, false)?;
    let bytes = p.fmt.bits as usize / 8;
    let nch = p.fmt.channels as usize;
    let frames = p.data_size / (bytes * nch);
    let mut channels = vec![Vec::with_capacity(frames); nch];
    let mut pos = p.data_offset;
    for _ in 0..frames {
        for ch in channels.iter_mut() {
            let v = match p.fmt.bits {
                16 => i16::from_le_bytes([b[pos], b[pos + 1]]) as f32 / 32768.0,
                24 => {
                    let mut x = b[pos] as i32 | (b[pos + 1] as i32) << 8 | (b[pos + 2] as i32) << 16;
                    if x & 0x80_0000 != 0 {
                        x -= 0x100_0000;
                    }
                    x as f32 / 8_388_608.0
                }
                _ if p.fmt.float => f32::from_le_bytes([b[pos], b[pos + 1], b[pos + 2], b[pos + 3]]),
                _ => (i32::from_le_bytes([b[pos], b[pos + 1], b[pos + 2], b[pos + 3]]) as f64 / 2_147_483_648.0) as f32,
            };
            ch.push(v);
            pos += bytes;
        }
    }
    Ok(Decoded { sample_rate: p.fmt.sample_rate, channels })
}

/// 32-bit float WAV — headroom for overlapping clips, opens everywhere.
pub fn encode_wav_float(channels: &[Vec<f32>], rate: u32) -> Vec<u8> {
    let nch = channels.len() as u32;
    let frames = channels.first().map(|c| c.len()).unwrap_or(0);
    let data = frames as u32 * nch * 4;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&(nch as u16).to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * nch * 4).to_le_bytes());
    out.extend_from_slice(&((nch * 4) as u16).to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for f in 0..frames {
        for ch in channels {
            out.extend_from_slice(&ch[f].to_le_bytes());
        }
    }
    out
}
