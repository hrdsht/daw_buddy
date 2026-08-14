'use strict';

/**
 * Silence removal tool.
 * 
 * CORE RULES:
 * 1. Never in place. Always writes to the output folder.
 * 2. Defaults: RMS detection, -72 dB, End-only, 10ms tail.
 * 3. Bails immediately on compressed WAVs or unknown layouts.
 */

const fs = require('fs/promises');
const path = require('path');

const DEFAULTS = {
  detection: 'RMS', // 'Peak' or 'RMS'
  thresholdDb: -72,
  where: 'End',     // Currently only supporting 'End' as specified
  tailMs: 10
};

// Convert decibels to a linear amplitude threshold (0.0 to 1.0)
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * Parses the WAV, finds the true end of the audio (minus silence), 
 * and writes the truncated version to the output folder.
 */
async function removeSilence(inputPath, outputRoot, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const threshold = dbToLinear(opts.thresholdDb);
  
  let buf;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return { success: false, path: inputPath, error: `Could not read file: ${err.message}` };
  }

  // 1. WAV Header Validation
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return { success: false, path: inputPath, error: 'Not a valid uncompressed WAV file' };
  }

  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  // 2. Safely parse RIFF chunks
  while (pos < buf.length) {
    if (pos + 8 > buf.length) break;
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    
    if (chunkId === 'fmt ') {
      const audioFormat = buf.readUInt16LE(pos + 8);
      const numChannels = buf.readUInt16LE(pos + 10);
      const sampleRate = buf.readUInt32LE(pos + 12);
      const bitsPerSample = buf.readUInt16LE(pos + 22);
      
      // PCM = 1, IEEE Float = 3. Reject anything compressed.
      if (audioFormat !== 1 && audioFormat !== 3) {
        return { success: false, path: inputPath, error: 'Unsupported format: Audio is compressed' };
      }
      
      // We only support 16-bit, 24-bit, and 32-bit float.
      if (![16, 24, 32].includes(bitsPerSample)) {
        return { success: false, path: inputPath, error: `Unsupported bit depth: ${bitsPerSample}-bit` };
      }

      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
    }
    
    pos += 8 + chunkSize;
  }

  if (!fmt || dataOffset === -1) {
    return { success: false, path: inputPath, error: 'Missing format or data chunks' };
  }

  // 3. Scan backwards to find the last sample that exceeds the threshold
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const totalFrames = dataSize / blockAlign;
  
  let lastAudioFrame = 0;
  
  // Calculate RMS window size (e.g., 50ms window)
  const windowFrames = Math.floor(fmt.sampleRate * 0.05); 
  let currentSumSq = 0;
  let windowCount = 0;

  for (let frame = totalFrames - 1; frame >= 0; frame--) {
    let maxAbs = 0;
    
    // Read all channels for this frame
    for (let c = 0; c < fmt.numChannels; c++) {
      const offset = dataOffset + (frame * blockAlign) + (c * bytesPerSample);
      let sampleVal = 0;

      if (fmt.bitsPerSample === 16) {
        sampleVal = Math.abs(buf.readInt16LE(offset)) / 32768.0;
      } else if (fmt.bitsPerSample === 24) {
        // 24-bit requires reading 3 bytes and sign-extending
        let intVal = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
        if (intVal & 0x800000) intVal -= 0x1000000;
        sampleVal = Math.abs(intVal) / 8388608.0;
      } else if (fmt.bitsPerSample === 32) {
        sampleVal = Math.abs(buf.readFloatLE(offset));
      }
      
      if (sampleVal > maxAbs) maxAbs = sampleVal;
    }

    if (opts.detection === 'Peak') {
      if (maxAbs > threshold) {
        lastAudioFrame = frame;
        break;
      }
    } else {
      // RMS Calculation logic
      currentSumSq += (maxAbs * maxAbs);
      windowCount++;
      
      if (windowCount >= windowFrames) {
        const rms = Math.sqrt(currentSumSq / windowFrames);
        if (rms > threshold) {
          lastAudioFrame = Math.min(totalFrames - 1, frame + windowFrames);
          break;
        }
        currentSumSq = 0;
        windowCount = 0;
      }
    }
  }

  // 4. Calculate Tail & Slice the Buffer
  const tailFrames = Math.floor(fmt.sampleRate * (opts.tailMs / 1000));
  const cutFrame = Math.min(totalFrames, lastAudioFrame + tailFrames);
  const newDataSize = cutFrame * blockAlign;
  
  if (newDataSize >= dataSize) {
    return { success: true, path: inputPath, modified: false, message: 'No trailing silence found' };
  }

  // Build the new truncated WAV buffer
  const newHeader = Buffer.alloc(44);
  buf.copy(newHeader, 0, 0, 44);
  
  // Update file size and data chunk size in the header
  newHeader.writeUInt32LE(36 + newDataSize, 4); // RIFF size
  newHeader.writeUInt32LE(newDataSize, 40);     // Data size
  
  const audioData = buf.subarray(dataOffset, dataOffset + newDataSize);
  const outBuf = Buffer.concat([newHeader, audioData]);

  // 5. Write to Output Folder, preserving folder structure
  const fileName = path.basename(inputPath);
  const parentFolder = path.basename(path.dirname(inputPath));
  const outDir = path.join(outputRoot, parentFolder);
  
  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, fileName), outBuf);
    
    return { 
      success: true, 
      path: inputPath, 
      modified: true, 
      reclaimedBytes: dataSize - newDataSize 
    };
  } catch (err) {
    return { success: false, path: inputPath, error: `Failed to write output: ${err.message}` };
  }
}

module.exports = { removeSilence, DEFAULTS };