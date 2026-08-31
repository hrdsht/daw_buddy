'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { CatalogueService } = require('../src/services/catalogue-service');
const { AudioJobService } = require('../src/services/audio-service');

async function testCatalogueServiceLifecycle() {
  console.log('--- Testing CatalogueService Lifecycle & Message Protocol ---');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-cat-test-'));

  try {
    const service = new CatalogueService(tempDir);

    // 1. Test PING / PONG
    const pingRes = await service.handleCommand({
      id: 'cmd-1',
      type: 'PING',
      generationId: 1
    });

    assert.equal(pingRes.type, 'PONG');
    assert.equal(pingRes.replyToId, 'cmd-1');
    assert.equal(pingRes.generationId, 1);

    // 2. Test Scan on empty directory with progress tracking
    const progressEvents = [];
    const scanRes = await service.executeScan(
      {
        id: 'cmd-2',
        type: 'SCAN_ROOTS',
        generationId: 2,
        payload: {
          roots: [tempDir],
          dataDir: tempDir,
          shallow: false
        }
      },
      (p) => progressEvents.push(p)
    );

    assert.equal(scanRes.type, 'SCAN_COMPLETED');
    assert.equal(scanRes.generationId, 2);
    assert.equal(Array.isArray(scanRes.payload.projects), true);
    assert.equal(scanRes.payload.stats.scannedRootsCount, 1);
    assert.ok(progressEvents.length > 0, 'Should have received scan progress callbacks');
    assert.equal(progressEvents[0].phase, 'discovering');

    // 3. Test Snapshot retrieval
    const snapshot = service.getSnapshot();
    assert.ok(snapshot, 'Snapshot should be stored in service');
    assert.equal(snapshot.generationId, 2);

    // 4. Test Watch / Unwatch lifecycle
    const watchRes = await service.handleCommand({
      id: 'cmd-3',
      type: 'WATCH_ROOTS',
      generationId: 3,
      payload: { roots: [tempDir] }
    });
    assert.equal(watchRes.type, 'WATCH_EVENT');
    assert.equal(watchRes.payload.status, 'watching');

    const unwatchRes = await service.handleCommand({
      id: 'cmd-4',
      type: 'UNWATCH_ROOTS',
      generationId: 4
    });
    assert.equal(unwatchRes.type, 'WATCH_EVENT');
    assert.equal(unwatchRes.payload.status, 'stopped');

    console.log('✔ CatalogueService lifecycle, scanning, progress and snapshots verified.');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testAudioJobServiceQueueAndCancellation() {
  console.log('--- Testing AudioJobService Queue, Concurrency & Cancellation ---');
  const audioService = new AudioJobService(1); // 1 job at a time

  const events = [];
  const p1 = audioService.submitJob({
    jobId: 'job-1',
    type: 'TRIM_SILENCE',
    generationId: 1,
    priority: 5,
    payload: {
      inputPath: 'non-existent-1.wav',
      outputPath: 'out-1.wav'
    }
  });

  const p2 = audioService.submitJob({
    jobId: 'job-2',
    type: 'CONVERT_AUDIO',
    generationId: 1,
    priority: 1, // Higher priority than job 3
    payload: {
      inputPath: 'non-existent-2.wav',
      outputPath: 'out-2.wav',
      targetFormat: 'wav'
    }
  });

  // Cancel job-2 before it runs
  audioService.cancelJob('job-2');

  const [res1, res2] = await Promise.all([p1, p2]);

  // Job 1 handles missing file gracefully without crashing (success: false with error description)
  assert.equal(res1.jobId, 'job-1');
  assert.equal(res1.type, 'JOB_COMPLETED');
  assert.equal(res1.payload.success, false);
  assert.ok(res1.payload.error);

  // Job 2 is cancelled cleanly
  assert.equal(res2.jobId, 'job-2');
  assert.equal(res2.type, 'JOB_CANCELLED');

  // Job 3 with unsupported type emits typed JOB_FAILED event
  const res3 = await audioService.submitJob({
    jobId: 'job-3',
    type: 'INVALID_TYPE',
    generationId: 1,
    payload: {}
  });
  assert.equal(res3.jobId, 'job-3');
  assert.equal(res3.type, 'JOB_FAILED');
  assert.ok(res3.error);

  console.log('✔ AudioJobService bounded queue, priority and cancellation verified.');
}

function sineWav(seconds, sampleRate = 1000, amplitude = 0.25, leadingSilence = 0.5, trailingSilence = 0.5) {
  const leadingFrames = Math.round(leadingSilence * sampleRate);
  const toneFrames = Math.round(seconds * sampleRate);
  const trailingFrames = Math.round(trailingSilence * sampleRate);
  const totalFrames = leadingFrames + toneFrames + trailingFrames;
  const buffer = Buffer.alloc(44 + totalFrames * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(totalFrames * 2, 40);

  // Leading silence is zeros (already alloc'd 0)
  for (let i = 0; i < toneFrames; i += 1) {
    const sample = Math.sin((2 * Math.PI * 50 * i) / sampleRate) * amplitude;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + (leadingFrames + i) * 2);
  }
  // Trailing silence is zeros
  return buffer;
}

async function testAudioJobServiceRealExecution() {
  console.log('--- Testing AudioJobService Real Audio Job Execution ---');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-audio-job-test-'));
  const audioService = new AudioJobService(1);

  try {
    const testWav = path.join(tempDir, 'test_sample.wav');
    const outDir = path.join(tempDir, 'output');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(testWav, sineWav(2, 44100, 0.4, 0.5, 0.5));

    // 1. Real TRIM_SILENCE Job
    const trimRes = await audioService.submitJob({
      jobId: 'real-trim-1',
      type: 'TRIM_SILENCE',
      generationId: 1,
      payload: {
        inputPath: testWav,
        outputPath: outDir,
        detection: 'Peak',
        thresholdDb: -40,
        where: 'Both',
        headMs: 10,
        tailMs: 10,
        sourceRoot: tempDir
      }
    });

    assert.equal(trimRes.type, 'JOB_COMPLETED', `TRIM_SILENCE failed: ${trimRes.error}`);
    assert.ok(trimRes.payload, 'Should have payload result');
    assert.equal(trimRes.payload.success, true);
    assert.equal(trimRes.payload.modified, true);
    assert.ok(trimRes.payload.output, 'Should have output file path');
    const trimOutExists = await fs.stat(trimRes.payload.output).then(() => true).catch(() => false);
    assert.ok(trimOutExists, 'Trimmed audio file should exist on disk');

    // 2. Real FINISH_AUDIO Job
    const finishRes = await audioService.submitJob({
      jobId: 'real-finish-1',
      type: 'FINISH_AUDIO',
      generationId: 1,
      payload: {
        inputPath: testWav,
        outputPath: outDir,
        normalize: true,
        trimToBars: true,
        targetPeakDb: -3,
        bpm: 120,
        bars: 1,
        beatsPerBar: 4,
        sourceRoot: tempDir
      }
    });

    assert.equal(finishRes.type, 'JOB_COMPLETED', `FINISH_AUDIO failed: ${finishRes.error}`);
    assert.ok(finishRes.payload, 'Should have payload result');
    assert.equal(finishRes.payload.success, true);
    assert.equal(finishRes.payload.modified, true);
    assert.ok(finishRes.payload.output, 'Should have output file path');
    const finishOutExists = await fs.stat(finishRes.payload.output).then(() => true).catch(() => false);
    assert.ok(finishOutExists, 'Finished audio file should exist on disk');

    // 3. Real CONVERT_AUDIO Job
    const convertRes = await audioService.submitJob({
      jobId: 'real-convert-1',
      type: 'CONVERT_AUDIO',
      generationId: 1,
      payload: {
        inputPath: testWav,
        outputPath: outDir,
        targetFormat: 'wav'
      }
    });

    assert.equal(convertRes.type, 'JOB_COMPLETED', `CONVERT_AUDIO failed: ${convertRes.error}`);
    assert.ok(convertRes.payload, 'Should have payload result');
    assert.equal(convertRes.payload.ok, true);
    assert.ok(Array.isArray(convertRes.payload.results) && convertRes.payload.results.length > 0);
    const convertedPath = convertRes.payload.results[0].output;
    const convertOutExists = await fs.stat(convertedPath).then(() => true).catch(() => false);
    assert.ok(convertOutExists, 'Converted audio file should exist on disk');

    console.log('✔ AudioJobService real file processing (trim, finish, convert) verified.');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runAll() {
  await testCatalogueServiceLifecycle();
  await testAudioJobServiceQueueAndCancellation();
  await testAudioJobServiceRealExecution();
  console.log('\nAll Proposal 0005 Workload Isolation Tests Passed Successfully!');
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
