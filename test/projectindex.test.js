'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { ProjectIndex, mergeUnreadableRoots } = require('../src/main/lib/projectindex');

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

async function unreadableRootKeepsItsProjectsButOthersUpdate() {
  // Before: any unreadable root blocked the save, so the catalogue froze for
  // every root (new projects vanished again on the next launch).
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-index-'));
  try {
    const jump = path.join(dir, 'Jump');
    const usb = path.join(dir, 'USB');
    const index = new ProjectIndex(path.join(dir, 'project-index.json'));
    const settings = { roots: [jump, usb], ignore: [], followLinks: false };
    const song = (root, name) => ({ sessionPath: path.join(root, name, `${name}.als`), root, name });

    await index.save(settings, [song(jump, 'Old'), song(usb, 'Gig')]);

    // USB is unplugged; Jump gained "New" and lost "Old".
    const saved = await index.saveAfterScan(settings, [song(jump, 'New')], {
      errors: [{ root: usb, message: 'not found' }],
      truncated: false
    });
    assert.equal(saved, true, 'saves despite the unreadable root');
    const names = (await index.load(settings)).entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['Gig', 'New'], 'Jump is fresh, USB keeps its last known project');

    // A clean scan replaces everything, including the USB root's projects.
    await index.saveAfterScan(settings, [song(jump, 'New')], { errors: [], truncated: false });
    assert.deepEqual((await index.load(settings)).entries.map((e) => e.name), ['New']);

    // A truncated scan is partial in unknown places and is never saved.
    assert.equal(await index.saveAfterScan(settings, [], { errors: [], truncated: true }), false);
    assert.deepEqual((await index.load(settings)).entries.map((e) => e.name), ['New']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function mergeDoesNotDuplicateProjectsFoundAgain() {
  const prev = [{ sessionPath: '/usb/A.als', root: '/usb' }, { sessionPath: '/jump/B.als', root: '/jump' }];
  const fresh = [{ sessionPath: '/usb/A.als', root: '/usb' }];
  const merged = mergeUnreadableRoots(prev, fresh, ['/usb']);
  assert.deepEqual(merged.map((e) => e.sessionPath), ['/usb/A.als'], 'no duplicate, readable roots not resurrected');
}

async function main() {
  await unreadableRootKeepsItsProjectsButOthersUpdate();
  console.log('ok - unreadableRootKeepsItsProjectsButOthersUpdate');
  mergeDoesNotDuplicateProjectsFoundAgain();
  console.log('ok - mergeDoesNotDuplicateProjectsFoundAgain');
  await completeCatalogueSurvivesRestart();
  console.log('ok - completeCatalogueSurvivesRestart');
  await changedRootsInvalidateCatalogue();
  console.log('ok - changedRootsInvalidateCatalogue');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
