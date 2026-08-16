'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { ProjectIndex } = require('../src/main/lib/projectindex');

async function completeCatalogueSurvivesRestart() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-index-'));
  try {
    const index = new ProjectIndex(path.join(dir, 'project-index.json'));
    const settings = {
      roots: [path.join(dir, 'Projects')],
      ignore: ['Backup', 'Samples'],
      followLinks: false
    };
    const entries = [{ path: path.join(dir, 'Projects', 'Song.als'), name: 'Song' }];

    assert.equal(await index.load(settings), null);
    assert.equal(await index.save(settings, entries), true);

    const restored = await new ProjectIndex(index.filePath).load(settings);
    assert.deepEqual(restored.entries, entries);
    assert.ok(restored.savedAt > 0);

    const newer = [{ path: path.join(dir, 'Projects', 'New Song.als'), name: 'New Song' }];
    assert.equal(await index.save(settings, newer), true);
    assert.deepEqual((await index.load(settings)).entries, newer);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function changedRootsInvalidateCatalogue() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-index-'));
  try {
    const index = new ProjectIndex(path.join(dir, 'project-index.json'));
    const settings = { roots: [path.join(dir, 'A')], ignore: [], followLinks: false };
    await index.save(settings, [{ path: path.join(dir, 'A', 'Song.als') }]);

    const changed = { ...settings, roots: [path.join(dir, 'B')] };
    assert.equal(await index.load(changed), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await completeCatalogueSurvivesRestart();
  console.log('ok - completeCatalogueSurvivesRestart');
  await changedRootsInvalidateCatalogue();
  console.log('ok - changedRootsInvalidateCatalogue');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
