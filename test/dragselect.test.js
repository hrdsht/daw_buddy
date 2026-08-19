'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function testSelectionStateLogic() {
  const items = new Map();
  let active = false;

  function toggle(item) {
    if (items.has(item.id)) {
      items.delete(item.id);
      if (items.size === 0) active = false;
    } else {
      active = true;
      items.set(item.id, item);
    }
  }

  function getFilePaths() {
    return Array.from(items.values()).map(i => i.path).filter(Boolean);
  }

  function getTotalSize() {
    return Array.from(items.values()).reduce((sum, i) => sum + (i.size || 0), 0);
  }

  const item1 = { id: 'render1.wav', name: 'Render 1', path: '/path/to/render1.wav', size: 1024 * 1024 * 10 };
  const item2 = { id: 'render2.wav', name: 'Render 2', path: '/path/to/render2.wav', size: 1024 * 1024 * 20 };
  const item3 = { id: 'stem1.wav', name: 'Stem 1', path: '/path/to/stem1.wav', size: 1024 * 1024 * 5 };

  assert.equal(active, false);
  toggle(item1);
  assert.equal(active, true);
  assert.equal(items.size, 1);
  assert.deepEqual(getFilePaths(), ['/path/to/render1.wav']);

  toggle(item2);
  toggle(item3);
  assert.equal(items.size, 3);
  assert.equal(getTotalSize(), 1024 * 1024 * 35);
  assert.deepEqual(getFilePaths(), ['/path/to/render1.wav', '/path/to/render2.wav', '/path/to/stem1.wav']);

  // Deselect item2
  toggle(item2);
  assert.equal(items.size, 2);
  assert.deepEqual(getFilePaths(), ['/path/to/render1.wav', '/path/to/stem1.wav']);

  // Deselect remaining
  toggle(item1);
  toggle(item3);
  assert.equal(items.size, 0);
  assert.equal(active, false);
}

async function testDragPathValidation() {
  const tmp = os.tmpdir();
  const testFile1 = path.join(tmp, `daw_buddy_test_1_${Date.now()}.wav`);
  const testFile2 = path.join(tmp, `daw_buddy_test_2_${Date.now()}.wav`);
  const nonExistent = path.join(tmp, `non_existent_${Date.now()}.wav`);

  fs.writeFileSync(testFile1, 'fake audio 1');
  fs.writeFileSync(testFile2, 'fake audio 2');

  try {
    const inputPaths = [testFile1, nonExistent, testFile2, ''];
    const validFiles = [];
    for (const fp of inputPaths) {
      if (typeof fp === 'string' && fp.trim()) {
        try {
          const stat = fs.statSync(fp);
          if (stat.isFile()) validFiles.push(fp);
        } catch {}
      }
    }

    assert.equal(validFiles.length, 2);
    assert.deepEqual(validFiles, [testFile1, testFile2]);
  } finally {
    try { fs.unlinkSync(testFile1); } catch {}
    try { fs.unlinkSync(testFile2); } catch {}
  }
}

testSelectionStateLogic();
console.log('ok - testSelectionStateLogic');
testDragPathValidation().then(() => {
  console.log('ok - testDragPathValidation');
});
