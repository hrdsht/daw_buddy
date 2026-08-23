'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { scanRoots } = require('../src/main/lib/scanner');
const renamer = require('../src/main/lib/renamer');
const dedupe = require('../src/main/lib/dedupe');
const silence = require('../src/main/lib/silence');
const vocalSplit = require('../src/main/lib/vocalSplit');
const vocalRebuild = require('../src/main/lib/vocalRebuild');
const renders = require('../src/main/lib/renders');
const videos = require('../src/main/lib/videos');
const id3 = require('../src/main/lib/id3');
const versions = require('../src/main/lib/versions');
const { ProjectStore } = require('../src/main/lib/notes');

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-test-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function scannerKeepsSessionFactsSeparate() {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, 'Alpha.rpp'),
      '<REAPER_PROJECT\n TEMPO 100 4 4\n>'
    );
    await fs.writeFile(path.join(dir, 'Alpha.rpp-bak'), 'backup');
    await fs.writeFile(
      path.join(dir, 'Beta.rpp'),
      '<REAPER_PROJECT\n TEMPO 120 4 4\n>'
    );

    const result = await scanRoots([dir]);
    const byName = Object.fromEntries(result.entries.map((entry) => [entry.name, entry]));

    assert.equal(byName.Alpha.backupCount, 1);
    assert.equal(byName.Beta.backupCount, 0);
    assert.equal(byName.Alpha.projectFile, byName.Alpha.sessionPath);
  });
}

function projectVersionsRemainGrouped() {
  const folder = 'C:\\Music\\Nava Bharat Jodo';
  const entries = [
    ['Nava bharat jodo 4', 4],
    ['Nava bharat jodo 3 bounced_3', 3],
    ['Nava bharat jodo 3 bounced', 2],
    ['Nava bharat jodo', 1]
  ].map(([name, modified]) => ({
    name,
    modified,
    folder,
    path: `${folder}\\${name}.als`,
    audioCount: 0,
    backupCount: 0,
    health: 0
  }));

  const grouped = versions.groupVersions(entries);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, 'Nava bharat jodo');
  assert.equal(grouped[0].versionCount, 4);
}

async function caseOnlyRenameWorks() {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'kick.wav'), 'audio');
    const files = await renamer.listFiles(dir, ['.wav']);
    const plan = renamer.plan(files, {
      operation: 'replaceText',
      find: 'kick',
      replace: 'KICK'
    });
    const undoLog = path.join(dir, 'undo.json');
    const result = await renamer.apply(plan, undoLog);

    assert.equal(result.renamed, 1);
    assert.equal(result.failed.length, 0);
    await fs.access(path.join(dir, 'KICK.wav'));

    const undone = await renamer.undo(undoLog);
    assert.equal(undone.reverted, 1);
    assert.equal(undone.failed.length, 0);
    await fs.access(path.join(dir, 'kick.wav'));
  });
}

async function changedDuplicateIsNeverReplaced() {
  await withTempDir(async (dir) => {
    const firstDir = path.join(dir, 'A', 'Samples', 'Imported');
    const secondDir = path.join(dir, 'B', 'Samples', 'Imported');
    await fs.mkdir(firstDir, { recursive: true });
    await fs.mkdir(secondDir, { recursive: true });

    const first = path.join(firstDir, 'sample.wav');
    const second = path.join(secondDir, 'sample.wav');
    await fs.writeFile(first, Buffer.alloc(9000, 1));
    await fs.writeFile(second, Buffer.alloc(9000, 1));

    const scan = await dedupe.findDuplicates([dir]);
    assert.equal(scan.groups.length, 1);

    await fs.writeFile(second, Buffer.alloc(9000, 2));
    const result = await dedupe.linkGroups(scan.groups);
    const after = await fs.readFile(second);

    assert.equal(result.linked, 0);
    assert.equal(after[0], 2);
  });
}

function testWav() {
  const frames = 100;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(1000, 24);
  buffer.writeUInt32LE(2000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < 10; i += 1) buffer.writeInt16LE(12000, 44 + i * 2);
  return buffer;
}

/**
 * Builds a mono 16-bit WAV from a list of { type: 'active' | 'silence', ms }
 * segments. Active segments alternate +/-12000 (well above any sane
 * threshold); silence segments are true zero. Segment lengths are chosen as
 * exact multiples of the default 50ms window in the tests below, so the
 * windowed classifier's boundaries land exactly on the segment boundaries —
 * no quantization slop to account for in the assertions.
 */
function synthWav(sampleRate, segments) {
  const bytesPerSample = 2;
  const frameCounts = segments.map((s) => Math.round((sampleRate * s.ms) / 1000));
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0);

  const buffer = Buffer.alloc(44 + totalFrames * bytesPerSample);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(totalFrames * bytesPerSample, 40);

  let frame = 0;
  segments.forEach((segment, index) => {
    const frames = frameCounts[index];
    for (let i = 0; i < frames; i += 1) {
      const value = segment.type === 'active' ? (i % 2 === 0 ? 12000 : -12000) : 0;
      buffer.writeInt16LE(value, 44 + (frame + i) * bytesPerSample);
    }
    frame += frames;
  });

  return buffer;
}

async function vocalSplitFindsExpectedBlocks() {
  const sampleRate = 8000;
  const pattern = [
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 200 },
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 300 },
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 250 },
    { type: 'silence', ms: 500 }
  ];

  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'vocal.wav');
    await fs.writeFile(filePath, synthWav(sampleRate, pattern));

    const preview = await vocalSplit.analyseSplit(filePath, {
      detection: 'Peak',
      thresholdDb: -20,
      minSilenceMs: 400,
      padMs: 0
    });

    assert.equal(preview.blockCount, 3);
    const blocks = preview.segments.filter((s) => s.type === 'block');
    assert.equal(blocks[0].durationSec, 0.2);
    assert.equal(blocks[1].durationSec, 0.3);
    assert.equal(blocks[2].durationSec, 0.25);
  });
}

async function vocalRoundTripIsSampleAccurate() {
  const sampleRate = 8000;
  const pattern = [
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 200 },
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 300 },
    { type: 'silence', ms: 500 }
  ];

  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'vocal.wav');
    const original = synthWav(sampleRate, pattern);
    await fs.writeFile(filePath, original);

    const options = { detection: 'Peak', thresholdDb: -20, minSilenceMs: 400, padMs: 0 };
    const result = await vocalSplit.splitVocal(filePath, options);
    assert.ok(result.modified);
    assert.equal(result.blockCount, 2);

    // The source is never touched.
    assert.deepEqual(await fs.readFile(filePath), original);

    // Simulate the blocks coming back from external processing unchanged.
    const processedDir = path.join(dir, 'processed');
    await fs.mkdir(processedDir);
    const blockSegments = result.segments.filter((s) => s.file);
    for (const segment of blockSegments) {
      await fs.copyFile(
        path.join(result.outputFolder, segment.file),
        path.join(processedDir, segment.file)
      );
    }

    const rebuilt = await vocalRebuild.rebuildTimeline(result.manifestPath, processedDir);
    // Unchanged blocks round-trip cleanly — any flagged entries here are only
    // the informational "identical to original, was it processed?" note, not
    // a real problem.
    assert.equal(rebuilt.flagged.filter((f) => !f.informational).length, 0);
    assert.equal(rebuilt.accepted.length, 2);

    const rebuiltBuf = await fs.readFile(rebuilt.output);
    const parsedOriginal = silence.parseWav(original);
    const parsedRebuilt = silence.parseWav(rebuiltBuf);
    const originalPcm = original.subarray(
      parsedOriginal.dataOffset,
      parsedOriginal.dataOffset + parsedOriginal.dataSize
    );
    const rebuiltPcm = rebuiltBuf.subarray(
      parsedRebuilt.dataOffset,
      parsedRebuilt.dataOffset + parsedRebuilt.dataSize
    );
    assert.deepEqual(rebuiltPcm, originalPcm);
  });
}

async function vocalRebuildFlagsDurationCollision() {
  const sampleRate = 8000;
  const pattern = [
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 200 },
    { type: 'silence', ms: 500 },
    { type: 'active', ms: 300 },
    { type: 'silence', ms: 500 }
  ];

  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'vocal.wav');
    await fs.writeFile(filePath, synthWav(sampleRate, pattern));

    const options = { detection: 'Peak', thresholdDb: -20, minSilenceMs: 400, padMs: 0 };
    const result = await vocalSplit.splitVocal(filePath, options);
    const blockSegments = result.segments.filter((s) => s.file);
    assert.equal(blockSegments.length, 2);

    const processedDir = path.join(dir, 'processed');
    await fs.mkdir(processedDir);

    // First block comes back unchanged.
    await fs.copyFile(
      path.join(result.outputFolder, blockSegments[0].file),
      path.join(processedDir, blockSegments[0].file)
    );
    // Second comes back far longer than the silence available before it —
    // must be flagged, not overlapped into the next segment.
    await fs.writeFile(
      path.join(processedDir, blockSegments[1].file),
      synthWav(sampleRate, [{ type: 'active', ms: 2000 }])
    );

    const rebuilt = await vocalRebuild.rebuildTimeline(result.manifestPath, processedDir);

    const hardFlagged = rebuilt.flagged.filter((f) => !f.informational).map((f) => f.id);
    assert.deepEqual(hardFlagged, [blockSegments[1].id]);
    assert.ok(rebuilt.accepted.some((a) => a.id === blockSegments[0].id));
    assert.ok(!rebuilt.accepted.some((a) => a.id === blockSegments[1].id));

    // Never overlapped/extended to fit — the output stays exactly the
    // manifest's original length.
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    const outputBuf = await fs.readFile(rebuilt.output);
    const parsedOutput = silence.parseWav(outputBuf);
    const blockAlign = manifest.source.channels * (manifest.source.bitsPerSample / 8);
    assert.equal(parsedOutput.dataSize / blockAlign, manifest.source.totalFrames);
  });
}

async function processedOutputsDoNotCollide() {
  await withTempDir(async (dir) => {
    const roots = [path.join(dir, 'A'), path.join(dir, 'B')];
    const output = path.join(dir, 'output');

    for (const root of roots) {
      const folder = path.join(root, 'Drums');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'kick.wav'), testWav());
    }

    const results = [];
    for (const root of roots) {
      results.push(
        await silence.removeSilence(
          path.join(root, 'Drums', 'kick.wav'),
          output,
          {
            detection: 'Peak',
            thresholdDb: -20,
            tailMs: 0,
            sourceRoot: root
          }
        )
      );
    }

    assert.ok(results.every((result) => result.modified));
    assert.notEqual(results[0].output, results[1].output);
    await Promise.all(results.map((result) => fs.access(result.output)));
  });
}

async function renderFinderRecognisesProjectVersions() {
  await withTempDir(async (dir) => {
    const songFolder = path.join(dir, 'Nava Bharat Jodo');
    const projectFolder = path.join(songFolder, 'Nava bharat jodo Project');
    await fs.mkdir(projectFolder, { recursive: true });

    const session = path.join(projectFolder, 'Nava bharat jodo 4.als');
    await fs.writeFile(session, 'project');
    await fs.writeFile(path.join(songFolder, 'Nava bharat jodo 3.wav'), testWav());
    await fs.writeFile(path.join(songFolder, 'Nava bharat jodo 3.mp3'), 'mp3-data');
    await fs.writeFile(path.join(songFolder, 'Different song.wav'), testWav());

    const result = await renders.findRenders(
      session,
      dir,
      [],
      ['Nava bharat jodo 3', 'Nava bharat jodo 3 bounced', 'Nava bharat jodo 2']
    );

    assert.equal(result.renders.length, 1);
    assert.equal(result.renders[0].primary.name, 'Nava bharat jodo 3.wav');
    assert.ok(result.renders[0].formats.includes('wav'));
    assert.ok(result.renders[0].formats.includes('mp3'));
    assert.equal(result.renders[0].files.length, 2);
    assert.ok(result.renders[0].files.some((f) => f.ext === '.wav'));
    assert.ok(result.renders[0].files.some((f) => f.ext === '.mp3'));
  });
}

async function studioHistoryIsCountedButNotListed() {
  await withTempDir(async (dir) => {
    const project = path.join(dir, 'My Song');
    const history = path.join(project, 'History');
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(project, 'My Song.song'), 'project');
    await fs.writeFile(path.join(history, 'My Song 20260815 (Autosaved).song'), 'save');
    await fs.writeFile(path.join(history, 'My Song 20260814 (Autosaved).song'), 'save');

    const result = await scanRoots([dir]);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, 'My Song');
    assert.equal(result.entries[0].backupCount, 2);
  });
}

async function bitwigBackupsAreCountedButNotListed() {
  await withTempDir(async (dir) => {
    const project = path.join(dir, 'Bitwig Song');
    const backups = path.join(project, 'auto-backup');
    const versionsFolder = path.join(backups, 'versions');
    await fs.mkdir(versionsFolder, { recursive: true });
    await fs.writeFile(path.join(project, 'Bitwig Song.bwproject'), 'project');
    await fs.writeFile(path.join(backups, 'Bitwig Song backup.bwproject'), 'backup');
    await fs.writeFile(
      path.join(versionsFolder, 'Bitwig Song [5.3].bwproject'),
      'version backup'
    );

    const result = await scanRoots([dir]);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, 'Bitwig Song');
    assert.equal(result.entries[0].daw, 'Bitwig Studio');
    assert.equal(result.entries[0].backupCount, 2);
    assert.equal(result.entries[0].bpm, null);
  });
}

async function proToolsBackupsAndSourceAudioStayOutOfResults() {
  await withTempDir(async (dir) => {
    const project = path.join(dir, 'Studio Vocal');
    const backups = path.join(project, 'Session File Backups');
    const sourceAudio = path.join(project, 'Audio Files');
    const bounces = path.join(project, 'Bounced Files');
    await fs.mkdir(backups, { recursive: true });
    await fs.mkdir(sourceAudio, { recursive: true });
    await fs.mkdir(bounces, { recursive: true });
    await fs.writeFile(path.join(project, 'Studio Vocal.ptx'), 'session');
    await fs.writeFile(path.join(backups, 'Studio Vocal.bak.001.ptx'), 'backup');
    await fs.writeFile(path.join(backups, 'Studio Vocal.bak.002.ptx'), 'backup');
    await fs.writeFile(path.join(sourceAudio, 'Studio Vocal.wav'), testWav());

    const withoutBounce = await scanRoots([dir]);
    assert.equal(withoutBounce.entries.length, 1);
    assert.equal(withoutBounce.entries[0].name, 'Studio Vocal');
    assert.equal(withoutBounce.entries[0].daw, 'Pro Tools');
    assert.equal(withoutBounce.entries[0].backupCount, 2);
    assert.equal(withoutBounce.entries[0].audioCount, 0);

    await fs.writeFile(path.join(bounces, 'Studio Vocal.wav'), testWav());
    const withBounce = await scanRoots([dir]);
    assert.equal(withBounce.entries[0].audioCount, 1);

    const listed = await renders.findRenders(
      path.join(project, 'Studio Vocal.ptx'),
      dir
    );
    assert.equal(listed.renders.length, 1);
    assert.equal(listed.renders[0].primary.name, 'Studio Vocal.wav');
  });
}

async function audioInAnotherBranchDoesNotEnablePlay() {
  await withTempDir(async (dir) => {
    const projectFolder = path.join(dir, 'Archive', 'Song Project');
    const unrelated = path.join(dir, 'Current Work');
    await fs.mkdir(projectFolder, { recursive: true });
    await fs.mkdir(unrelated, { recursive: true });
    await fs.writeFile(path.join(projectFolder, 'Same Name.rpp'), '<REAPER_PROJECT>');
    await fs.writeFile(path.join(unrelated, 'Same Name.wav'), testWav());

    const result = await scanRoots([dir]);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].audioCount, 0);

    const rendersFolder = path.join(dir, 'Archive', 'Renders');
    await fs.mkdir(rendersFolder, { recursive: true });
    await fs.writeFile(path.join(rendersFolder, 'Same Name.wav'), testWav());

    const rescanned = await scanRoots([dir]);
    assert.equal(rescanned.entries[0].audioCount, 1);
  });
}

async function videosAreCountedAndListed() {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'Picture Project.rpp'), '<REAPER_PROJECT>');
    await fs.writeFile(path.join(dir, 'picture.mp4'), 'video');
    await fs.writeFile(path.join(dir, 'picture.mp4.asd'), 'sidecar');

    const result = await scanRoots([dir]);
    assert.equal(result.entries[0].videoCount, 1);

    const listed = await videos.listVideos(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'picture.mp4');
  });
}

async function id3EditingNeverChangesAudioBytes() {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'sample.mp3');
    const audio = Buffer.alloc(4096);
    for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 37) & 0xff;
    await fs.writeFile(filePath, audio);

    await id3.write(filePath, {
      title: 'Granite Kick',
      artist: 'Hrdsht',
      album: 'Reddit Cleanup',
      composer: 'Hrdsht',
      genre: 'EDM',
      year: '2026',
      comment: 'Clean metadata'
    });

    const tagged = await id3.inspect(filePath);
    assert.equal(tagged.fields.title, 'Granite Kick');
    assert.equal(tagged.fields.artist, 'Hrdsht');
    assert.equal(tagged.fields.album, 'Reddit Cleanup');
    assert.equal(tagged.fields.composer, 'Hrdsht');
    assert.equal(tagged.fields.comment, 'Clean metadata');
    assert.ok(tagged.headBytes > 0);

    await id3.strip(filePath);
    const after = await fs.readFile(filePath);
    assert.deepEqual(after, audio);
  });
}

async function audioCopiedToProjectFolderRootIsListed() {
  await withTempDir(async (dir) => {
    const projectFolder = path.join(dir, 'Guruji Song Project');
    await fs.mkdir(projectFolder, { recursive: true });

    const session = path.join(projectFolder, 'Guruji Song.als');
    await fs.writeFile(session, 'project');
    await fs.writeFile(path.join(projectFolder, 'Guruji_Rough (1).mp3'), 'mp3-data');

    const result = await renders.findRenders(session, dir);
    assert.equal(result.renders.length, 1);
    assert.equal(result.renders[0].base, 'Guruji_Rough');
    assert.equal(result.renders[0].version, 1);
    assert.equal(result.renders[0].primary.name, 'Guruji_Rough (1).mp3');
  });
}

async function audioAnalysisPersistsInStore() {
  await withTempDir(async (dir) => {
    const storePath = path.join(dir, 'notes.json');
    const store = new ProjectStore(storePath);
    await store.load();

    const analysisData = {
      bpm: 128,
      key: 'C maj',
      camelot: '8B',
      timeSignature: '4/4',
      tala: { name: 'Teental' }
    };

    store.set('C:\\Music\\Track_v1.wav', {
      analysis: analysisData,
      detectedBpm: 128,
      key: 'C maj',
      camelot: '8B',
      detectedTimeSignature: '4/4',
      detectedTala: 'Teental'
    });
    await store.flush();

    const store2 = new ProjectStore(storePath);
    await store2.load();
    const retrieved = store2.get('C:\\Music\\Track_v1.wav');

    assert.equal(retrieved.key, 'C maj');
    assert.equal(retrieved.detectedBpm, 128);
    assert.equal(retrieved.detectedTimeSignature, '4/4');
    assert.equal(retrieved.detectedTala, 'Teental');
    assert.deepEqual(retrieved.analysis, analysisData);
  });
}

async function run() {
  const tests = [
    scannerKeepsSessionFactsSeparate,
    projectVersionsRemainGrouped,
    caseOnlyRenameWorks,
    changedDuplicateIsNeverReplaced,
    processedOutputsDoNotCollide,
    vocalSplitFindsExpectedBlocks,
    vocalRoundTripIsSampleAccurate,
    vocalRebuildFlagsDurationCollision,
    renderFinderRecognisesProjectVersions,
    audioCopiedToProjectFolderRootIsListed,
    studioHistoryIsCountedButNotListed,
    bitwigBackupsAreCountedButNotListed,
    proToolsBackupsAndSourceAudioStayOutOfResults,
    audioInAnotherBranchDoesNotEnablePlay,
    videosAreCountedAndListed,
    id3EditingNeverChangesAudioBytes,
    audioAnalysisPersistsInStore
  ];

  for (const test of tests) {
    await test();
    console.log(`ok - ${test.name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
