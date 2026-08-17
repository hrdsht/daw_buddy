'use strict';

/**
 * Vocal timeline round trip — Phase 2, rebuild.
 *
 * Takes externally processed blocks (same stable IDs the split step wrote)
 * and places each one at its exact original sample-frame position. Blocks
 * that are missing, the wrong format, or would run into the next block are
 * never guessed at — they're left as silence at their original spot and
 * reported, so a partial or bad batch never produces a file that looks
 * finished when it isn't.
 */

const fs = require('fs/promises');
const path = require('path');

const { parseWav } = require('./silence');
const { writeWav } = require('./vocalWav');
const vocalManifest = require('./vocalManifest');

const DEFAULT_TOLERANCE_MS = 50;

/**
 * Reads every manifest block against the folder of processed files and
 * decides, per block, whether it's safe to place. Shared by analyseRebuild
 * and rebuildTimeline so the preview and the real write agree.
 */
async function evaluateBlocks(manifest, blocksFolder, options: Record<string, any> = {}) {
  const toleranceMs = options.toleranceMs ?? manifest.options?.padMs ?? DEFAULT_TOLERANCE_MS;
  const toleranceFrames = Math.floor(manifest.source.sampleRate * (toleranceMs / 1000));

  let files;
  try {
    files = await fs.readdir(blocksFolder);
  } catch (err) {
    throw new Error(`Could not read blocks folder: ${err.message}`);
  }
  const availableFiles = new Set(files.filter((name) => name.toLowerCase().endsWith('.wav')));

  const blockSegments = manifest.segments.filter((segment) => segment.type === 'block');
  const results = [];
  const claimed = new Set();

  for (let i = 0; i < manifest.segments.length; i += 1) {
    const segment = manifest.segments[i];
    if (segment.type !== 'block') continue;

    const originalFrames = segment.endFrame - segment.startFrame;
    const next = manifest.segments[i + 1];
    const maxAllowedFrames = (next ? next.startFrame : manifest.source.totalFrames) - segment.startFrame;

    const entry: Record<string, any> = {
      id: segment.id,
      file: segment.file,
      startFrame: segment.startFrame,
      originalFrames,
      originalDurationSec: originalFrames / manifest.source.sampleRate
    };

    if (!availableFiles.has(segment.file)) {
      results.push({ ...entry, status: 'missing', detail: 'No matching file in the blocks folder.' });
      continue;
    }
    claimed.add(segment.file);

    const filePath = path.join(blocksFolder, segment.file);
    let buf;
    try {
      buf = await fs.readFile(filePath);
    } catch (err) {
      results.push({ ...entry, status: 'error', detail: `Could not read file: ${err.message}` });
      continue;
    }

    const parsed = parseWav(buf);
    if (parsed.error) {
      results.push({ ...entry, status: 'error', detail: parsed.error });
      continue;
    }

    const { fmt, dataOffset, dataSize } = parsed;
    if (
      fmt.sampleRate !== manifest.source.sampleRate ||
      fmt.numChannels !== manifest.source.channels ||
      fmt.bitsPerSample !== manifest.source.bitsPerSample ||
      fmt.audioFormat !== manifest.source.audioFormat
    ) {
      results.push({
        ...entry,
        status: 'format-mismatch',
        detail: `Expected ${manifest.source.sampleRate}Hz/${manifest.source.channels}ch/${manifest.source.bitsPerSample}-bit, got ${fmt.sampleRate}Hz/${fmt.numChannels}ch/${fmt.bitsPerSample}-bit.`
      });
      continue;
    }

    const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
    const processedFrames = Math.floor(dataSize / blockAlign);
    const hash = require('crypto').createHash('sha256').update(buf).digest('hex');

    if (processedFrames > maxAllowedFrames) {
      results.push({
        ...entry,
        status: 'duration-collision',
        detail: `Processed block is ${((processedFrames - maxAllowedFrames) / fmt.sampleRate).toFixed(3)}s longer than the room available before the next block's original position.`,
        processedFrames,
        processedDurationSec: processedFrames / fmt.sampleRate
      });
      continue;
    }

    const diff = processedFrames - originalFrames;
    let status = 'ok';
    if (Math.abs(diff) > toleranceFrames) status = diff < 0 ? 'shorter' : 'extended';
    if (status === 'ok' && hash === segment.hash) status = 'identical-to-original';

    results.push({
      ...entry,
      status,
      detail: status === 'identical-to-original' ? 'Identical to the original export — was it actually processed?' : null,
      dataOffset,
      dataSize,
      processedFrames,
      processedDurationSec: processedFrames / fmt.sampleRate
    });
  }

  const unexpected = [...availableFiles].filter((name) => !claimed.has(name) && name !== 'manifest.json');

  return { blocks: results, unexpected, blockCount: blockSegments.length };
}

/** Dry run — validates without writing anything. */
async function analyseRebuild(manifestPath, blocksFolder, options: Record<string, any> = {}) {
  const manifest = await vocalManifest.readManifest(manifestPath);
  const evaluation = await evaluateBlocks(manifest, blocksFolder, options);

  return {
    manifestPath,
    blocksFolder,
    source: manifest.source,
    ...evaluation,
    readyCount: evaluation.blocks.filter((b) => b.status === 'ok' || b.status === 'identical-to-original' || b.status === 'shorter' || b.status === 'extended').length,
    flaggedCount: evaluation.blocks.filter((b) => b.status === 'missing' || b.status === 'error' || b.status === 'format-mismatch' || b.status === 'duration-collision').length
  };
}

const PLACEABLE = new Set(['ok', 'identical-to-original', 'shorter', 'extended']);

/**
 * The real run. Every block is placed at its own absolute original start
 * frame in a zero-filled buffer sized to the manifest's total length — not
 * appended one after another — so a short block automatically leaves the
 * right amount of silence before whatever comes next, with no special
 * casing needed.
 */
async function rebuildTimeline(manifestPath, blocksFolder, options: Record<string, any> = {}) {
  const manifest = await vocalManifest.readManifest(manifestPath);
  const evaluation = await evaluateBlocks(manifest, blocksFolder, options);

  const { audioFormat, sampleRate, channels, bitsPerSample, totalFrames } = manifest.source;
  const blockAlign = channels * (bitsPerSample / 8);
  const outputBuffer = Buffer.alloc(totalFrames * blockAlign);

  const accepted = [];
  const flagged = [];

  for (const block of evaluation.blocks) {
    if (!PLACEABLE.has(block.status)) {
      flagged.push({ id: block.id, status: block.status, detail: block.detail });
      continue;
    }

    const filePath = path.join(blocksFolder, block.file);
    const buf = await fs.readFile(filePath);
    const parsed = parseWav(buf);
    const pcm = buf.subarray(parsed.dataOffset, parsed.dataOffset + parsed.dataSize);

    const destStart = block.startFrame * blockAlign;
    pcm.copy(outputBuffer, destStart);

    accepted.push({ id: block.id, status: block.status });
    if (block.status !== 'ok') {
      flagged.push({ id: block.id, status: block.status, detail: block.detail, informational: true });
    }
  }

  const sourceBase = path.basename(manifest.source.filename, path.extname(manifest.source.filename));
  const outputPath = path.join(path.dirname(blocksFolder), `${sourceBase} (Rebuilt).wav`);
  const wavBuffer = writeWav(
    { audioFormat, numChannels: channels, sampleRate, bitsPerSample },
    outputBuffer
  );

  const temp = `${outputPath}.tmp-${Date.now()}`;
  await fs.writeFile(temp, wavBuffer);
  await fs.rename(temp, outputPath);

  return {
    success: true,
    output: outputPath,
    accepted,
    flagged,
    unexpected: evaluation.unexpected,
    blockCount: evaluation.blockCount
  };
}

module.exports = { analyseRebuild, rebuildTimeline, evaluateBlocks };
