'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const disk = require('../src/main/lib/disk');

async function diskInsightsMeasureAndRankProjects() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-disk-'));
  try {
    const small = path.join(temp, 'Small Project');
    const large = path.join(temp, 'Large Project');
    const imported = path.join(small, 'Samples', 'Imported');
    await fs.mkdir(imported, { recursive: true });
    await fs.mkdir(large, { recursive: true });
    await fs.writeFile(path.join(small, 'session.als'), Buffer.alloc(1000));
    await fs.writeFile(path.join(imported, 'kick.wav'), Buffer.alloc(2000));
    await fs.writeFile(path.join(large, 'render.wav'), Buffer.alloc(5000));

    let progressEvents = 0;
    const result = await disk.scanFolders([small, large], {}, () => {
      progressEvents += 1;
    });

    assert.equal(result.projects.length, 2);
    assert.equal(result.projects[0].name, 'Large Project');
    assert.equal(result.projects[0].bytes, 5000);
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].bytes, 2000);
    assert.equal(result.imported[0].files, 1);
    assert.equal(result.filesScanned, 3);
    assert.ok(progressEvents >= 2);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function diskInsightsRespectTheFileBudget() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-disk-limit-'));
  try {
    await fs.writeFile(path.join(temp, 'one.wav'), Buffer.alloc(10));
    await fs.writeFile(path.join(temp, 'two.wav'), Buffer.alloc(10));
    const result = await disk.scanFolders([temp], { maxFiles: 1 });
    assert.equal(result.filesScanned, 1);
    assert.equal(result.truncated, true);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await diskInsightsMeasureAndRankProjects();
  console.log('ok - diskInsightsMeasureAndRankProjects');
  await diskInsightsRespectTheFileBudget();
  console.log('ok - diskInsightsRespectTheFileBudget');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
