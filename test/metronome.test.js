'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { rhythmGuideMidi } = require('../src/renderer/midiwrite');

function testMetronomeSoundsetsExist() {
  const baseDir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'metronome');
  assert.ok(fs.existsSync(baseDir), 'Metronome assets folder must exist');

  const sets = [
    { id: 'ableton', folder: 'Ableton (DEFAULT)' },
    { id: 'cubase', folder: 'Cubase' },
    { id: 'fl-studio', folder: 'FL Studio' },
    { id: 'logic', folder: 'Logic' },
    { id: 'maschine', folder: 'Maschine' },
    { id: 'mpc', folder: 'MPC' },
    { id: 'protools-default', folder: path.join('Pro Tools', 'Default') },
    { id: 'protools-marimba', folder: path.join('Pro Tools', 'Marimba') },
    { id: 'reason', folder: 'Reason' },
    { id: 'sonar', folder: 'Sonar' }
  ];

  for (const s of sets) {
    const downPath = path.join(baseDir, s.folder, 'Metronome.wav');
    const upPath = path.join(baseDir, s.folder, 'MetronomeUp.wav');

    assert.ok(fs.existsSync(downPath), `Downbeat file must exist for ${s.id}: ${downPath}`);
    assert.ok(fs.existsSync(upPath), `Upbeat file must exist for ${s.id}: ${upPath}`);

    const downBytes = fs.readFileSync(downPath);
    const upBytes = fs.readFileSync(upPath);

    assert.ok(downBytes.length > 100, `Downbeat file for ${s.id} is too small`);
    assert.ok(upBytes.length > 100, `Upbeat file for ${s.id} is too small`);

    // Verify RIFF / WAVE header
    assert.equal(downBytes.toString('ascii', 0, 4), 'RIFF', `Downbeat for ${s.id} must be RIFF`);
    assert.equal(downBytes.toString('ascii', 8, 12), 'WAVE', `Downbeat for ${s.id} must be WAVE`);
    assert.equal(upBytes.toString('ascii', 0, 4), 'RIFF', `Upbeat for ${s.id} must be RIFF`);
    assert.equal(upBytes.toString('ascii', 8, 12), 'WAVE', `Upbeat for ${s.id} must be WAVE`);
  }
}

function testMetronomeMidiGeneration() {
  // 4/4 meter 4 bars
  const midi44 = rhythmGuideMidi(120, '4/4', { bars: 4 });
  assert.ok(midi44 instanceof Uint8Array);
  assert.equal(Buffer.from(midi44.slice(0, 4)).toString('ascii'), 'MThd');

  // 6/8 compound meter 8 bars
  const midi68 = rhythmGuideMidi(140, '6/8', { bars: 8 });
  assert.ok(midi68 instanceof Uint8Array);
  assert.equal(Buffer.from(midi68.slice(0, 4)).toString('ascii'), 'MThd');

  // 7/8 odd meter 4 bars
  const midi78 = rhythmGuideMidi(160, '7/8', { bars: 4 });
  assert.ok(midi78 instanceof Uint8Array);
  assert.equal(Buffer.from(midi78.slice(0, 4)).toString('ascii'), 'MThd');
}

function runAll() {
  testMetronomeSoundsetsExist();
  testMetronomeMidiGeneration();
  console.log('ok - testMetronomeSoundsetsAndMidiGeneration');
}

runAll();
