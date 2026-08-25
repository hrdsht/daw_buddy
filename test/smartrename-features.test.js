'use strict';

const assert = require('assert/strict');
const {
  isFlStudioArtifact,
  formatStemOutputName
} = require('../src/renderer/dom');

function testFlStudioArtifactDetection() {
  // Positive matches (FL Studio redundant master/current bounces)
  assert.equal(isFlStudioArtifact('_Master.wav'), true, '_Master.wav is FL artifact');
  assert.equal(isFlStudioArtifact('_Current.wav'), true, '_Current.wav is FL artifact');
  assert.equal(isFlStudioArtifact('Beat_Master.wav'), true, 'Beat_Master.wav is FL artifact');
  assert.equal(isFlStudioArtifact('Project - Current.wav'), true, 'Project - Current.wav is FL artifact');
  assert.equal(isFlStudioArtifact('MySong_master.mp3'), true, 'MySong_master.mp3 is FL artifact');
  assert.equal(isFlStudioArtifact('Mix_current.flac'), true, 'Mix_current.flac is FL artifact');
  assert.equal(isFlStudioArtifact('Master.wav'), true, 'Master.wav is FL artifact');
  assert.equal(isFlStudioArtifact('Current.wav'), true, 'Current.wav is FL artifact');

  // Negative matches (Regular stems that should NOT be excluded or deleted)
  assert.equal(isFlStudioArtifact('Kick.wav'), false, 'Kick.wav is regular stem');
  assert.equal(isFlStudioArtifact('808 Bass.wav'), false, '808 Bass.wav is regular stem');
  assert.equal(isFlStudioArtifact('Master_1.wav'), false, 'Master_1.wav should not match artifact ending');
  assert.equal(isFlStudioArtifact('Current_Lead.wav'), false, 'Current_Lead.wav should not match artifact ending');
  assert.equal(isFlStudioArtifact('Mastering EQ.wav'), false, 'Mastering EQ.wav should not match');
  assert.equal(isFlStudioArtifact(''), false, 'Empty string is false');
}

function testStemNamingFormats() {
  // 1. snake_case format
  assert.equal(
    formatStemOutputName('drums', 'kick', 1, '.wav', 'snake'),
    'drums_kick_1.wav'
  );
  assert.equal(
    formatStemOutputName('rhythm', null, 2, '.wav', 'snake'),
    'rhythm_2.wav'
  );

  // 2. Title Space format (e.g. "Rhythm 1", "Drums Kick 2")
  assert.equal(
    formatStemOutputName('rhythm', null, 1, '.wav', 'title'),
    'Rhythm 1.wav'
  );
  assert.equal(
    formatStemOutputName('drums', 'snare', 3, '.wav', 'title'),
    'Drums Snare 3.wav'
  );

  // 3. Padded format (e.g. "Rhythm 01", "RX 02")
  assert.equal(
    formatStemOutputName('rhythm', null, 1, '.wav', 'padded'),
    'Rhythm 01.wav'
  );
  assert.equal(
    formatStemOutputName('rhythm', null, 12, '.wav', 'padded'),
    'Rhythm 12.wav'
  );
  assert.equal(
    formatStemOutputName('rx', null, 5, '.wav', 'padded'),
    'Rx 05.wav'
  );

  // 4. Hyphen format
  assert.equal(
    formatStemOutputName('synth_lead', null, 2, '.wav', 'hyphen'),
    'synth-lead-02.wav'
  );

  // 5. Custom name override
  assert.equal(
    formatStemOutputName('drums', 'kick', 1, '.wav', 'snake', 'CustomKick_Dry.wav'),
    'CustomKick_Dry.wav'
  );

  // 6. Vocal Artist token preservation with style format
  assert.equal(
    formatStemOutputName('vox', 'lead', 1, '.wav', 'snake', null, 'ritesh'),
    'vox_ritesh_1.wav'
  );
  assert.equal(
    formatStemOutputName('vox', 'lead', 1, '.wav', 'title', null, 'ritesh'),
    'Vox Ritesh 1.wav'
  );
  assert.equal(
    formatStemOutputName('vox', 'lead', 1, '.wav', 'padded', null, 'ritesh'),
    'Vox Ritesh 01.wav'
  );
  // 7. Batch custom category numbering (e.g. "rx" on 5 files)
  const stems = ['stem_a.wav', 'stem_b.wav', 'stem_c.wav', 'stem_d.wav', 'stem_e.wav'];
  const formattedSnake = stems.map((_, i) => formatStemOutputName('rx', null, i + 1, '.wav', 'snake'));
  assert.deepEqual(formattedSnake, [
    'rx_1.wav',
    'rx_2.wav',
    'rx_3.wav',
    'rx_4.wav',
    'rx_5.wav'
  ]);

  const formattedPadded = stems.map((_, i) => formatStemOutputName('rx', null, i + 1, '.wav', 'padded'));
  assert.deepEqual(formattedPadded, [
    'Rx 01.wav',
    'Rx 02.wav',
    'Rx 03.wav',
    'Rx 04.wav',
    'Rx 05.wav'
  ]);
}

function testUserDefinedCustomCategories() {
  const customStems = ['vocal_take1.wav', 'vocal_take2.wav', 'vocal_take3.wav'];
  const formattedCustomSnake = customStems.map((_, i) => formatStemOutputName('bgv', null, i + 1, '.wav', 'snake'));
  assert.deepEqual(formattedCustomSnake, [
    'bgv_1.wav',
    'bgv_2.wav',
    'bgv_3.wav'
  ]);

  const formattedCustomTitle = customStems.map((_, i) => formatStemOutputName('bgv', null, i + 1, '.wav', 'title'));
  assert.deepEqual(formattedCustomTitle, [
    'Bgv 1.wav',
    'Bgv 2.wav',
    'Bgv 3.wav'
  ]);
}

testFlStudioArtifactDetection();
console.log('ok - testFlStudioArtifactDetection');

testStemNamingFormats();
console.log('ok - testStemNamingFormats');

testUserDefinedCustomCategories();
console.log('ok - testUserDefinedCustomCategories');


