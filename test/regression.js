'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { scanRoots } = require('../lib/scanner');
const renamer = require('../lib/renamer');
const dedupe = require('../lib/dedupe');
const silence = require('../lib/silence');

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

async function run() {
  const tests = [
    scannerKeepsSessionFactsSeparate,
    caseOnlyRenameWorks,
    changedDuplicateIsNeverReplaced,
    processedOutputsDoNotCollide
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
