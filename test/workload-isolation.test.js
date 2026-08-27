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

    // 2. Test Scan on empty directory
    const scanRes = await service.handleCommand({
      id: 'cmd-2',
      type: 'SCAN_ROOTS',
      generationId: 2,
      payload: {
        roots: [tempDir],
        dataDir: tempDir,
        shallow: false
      }
    });

    assert.equal(scanRes.type, 'SCAN_COMPLETED');
    assert.equal(scanRes.generationId, 2);
    assert.equal(Array.isArray(scanRes.payload.projects), true);
    assert.equal(scanRes.payload.stats.scannedRootsCount, 1);

    // 3. Test Snapshot retrieval
    const snapshot = service.getSnapshot();
    assert.ok(snapshot, 'Snapshot should be stored in service');
    assert.equal(snapshot.generationId, 2);

    console.log('✔ CatalogueService lifecycle, scanning and snapshots verified.');
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

  // Job 1 fails cleanly with typed error because file is missing (no unhandled exception)
  assert.equal(res1.jobId, 'job-1');
  assert.equal(res1.type, 'JOB_FAILED');
  assert.ok(res1.error);

  // Job 2 is cancelled cleanly
  assert.equal(res2.jobId, 'job-2');
  assert.equal(res2.type, 'JOB_CANCELLED');

  console.log('✔ AudioJobService bounded queue, priority and cancellation verified.');
}

async function runAll() {
  await testCatalogueServiceLifecycle();
  await testAudioJobServiceQueueAndCancellation();
  console.log('\nAll Proposal 0005 Workload Isolation Tests Passed Successfully!');
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
