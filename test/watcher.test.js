'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startWatching, stopWatching } = require('../src/main/lib/watcher');

async function testWatcherOperations() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-buddy-watch-'));

  try {
    let bounceCalled = false;
    let bouncedData = null;

    startWatching([tmpDir], (data) => {
      bounceCalled = true;
      bouncedData = data;
    }, { pollWatching: false });

    assert.ok(typeof startWatching === 'function', 'startWatching must be defined');
    assert.ok(typeof stopWatching === 'function', 'stopWatching must be defined');

    stopWatching();
    console.log('ok - testWatcherOperations');
  } finally {
    stopWatching();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

testWatcherOperations().catch((err) => {
  console.error(err);
  process.exit(1);
});
