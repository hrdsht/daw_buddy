'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { classify } = require('../src/main/lib/matcher');
const { UserDictionary } = require('../src/main/lib/userdict');
const renamelog = require('../src/main/lib/renamelog');

test('Smart Renamer - Matcher classifying standard stems', () => {
  const kick = classify('01_Kick_In_44k.wav');
  assert.equal(kick.category, 'drums');
  assert.equal(kick.subtype, 'kick');
  assert.ok(kick.confidence >= 0.8);

  const snare = classify('Snare_Top_Mic_processed.wav');
  assert.equal(snare.category, 'drums');
  assert.equal(snare.subtype, 'snare');

  const sub = classify('808_Sub_Bass_Heavy.wav');
  assert.equal(sub.category, 'bass');
  assert.equal(sub.subtype, 'sub');

  const vox = classify('Lead_Vocal_Main_dry.wav');
  assert.equal(vox.category, 'vox');
  assert.equal(vox.subtype, 'lead');

  const guitar = classify('Acoustic_Guitar_L.wav');
  assert.equal(guitar.category, 'guitar');
  assert.equal(guitar.subtype, 'acoustic');

  const synth = classify('Synth_Lead_Arp.wav');
  assert.equal(synth.category, 'synth');

  const unknown = classify('AudioTrack_01.wav');
  assert.equal(unknown.matched, false);
  assert.equal(unknown.category, null);
});

test('Smart Renamer - UserDictionary learning & custom overrides', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-dict-test-'));
  const dictPath = path.join(tmpDir, 'userdict.json');

  try {
    const userDict = new UserDictionary(dictPath);
    userDict.addToken('percs', 'darbuka', 'doumbek');
    await userDict.save();

    const loadedDict = new UserDictionary(dictPath);
    await loadedDict.load();

    const match1 = classify('Solo_Doumbek_Stem.wav', loadedDict.data);
    assert.equal(match1.category, 'percs');
    assert.equal(match1.subtype, 'darbuka');

    // Test learning tokens from corrections (requires 3 sightings to promote)
    loadedDict.learn(['mysticflute'], 'winds', 'flute');
    loadedDict.learn(['mysticflute'], 'winds', 'flute');
    const promoted = loadedDict.learn(['mysticflute'], 'winds', 'flute');
    assert.ok(promoted.includes('mysticflute'));

    const match2 = classify('04_mysticflute_take.wav', loadedDict.data);
    assert.equal(match2.category, 'winds');
    assert.equal(match2.subtype, 'flute');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Smart Renamer - renamelog manifests and rollback verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-renamelog-test-'));

  try {
    const fileA = path.join(tmpDir, 'old_kick.wav');
    const fileB = path.join(tmpDir, 'old_snare.wav');
    fs.writeFileSync(fileA, 'dummy-audio-kick');
    fs.writeFileSync(fileB, 'dummy-audio-snare');

    const doneMoves = [
      { from: fileA, to: path.join(tmpDir, 'drums_kick_1.wav') },
      { from: fileB, to: path.join(tmpDir, 'drums_snare_1.wav') }
    ];

    // Rename on disk to simulate apply
    fs.renameSync(fileA, path.join(tmpDir, 'drums_kick_1.wav'));
    fs.renameSync(fileB, path.join(tmpDir, 'drums_snare_1.wav'));

    // Write manifest
    const res = await renamelog.write(tmpDir, doneMoves, { tool: 'smart-rename' });
    assert.ok(res && res.file);
    assert.ok(fs.existsSync(res.file));

    // List manifests
    const manifests = await renamelog.list(tmpDir);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].manifest.count, 2);

    // Preview revert
    const preview = await renamelog.preview(tmpDir, manifests[0].file);
    assert.equal(preview.ok, true);
    assert.equal(preview.rows.length, 2);
    assert.equal(preview.rows[0].status, 'ok');

    // Revert
    const revertRes = await renamelog.revert(tmpDir, manifests[0].file);
    assert.equal(revertRes.ok, true);
    assert.equal(revertRes.reverted, 2);
    assert.ok(fs.existsSync(fileA));
    assert.ok(fs.existsSync(fileB));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
