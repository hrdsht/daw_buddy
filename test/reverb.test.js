'use strict';

const assert = require('assert/strict');
const {
  DEFAULT_REVERB_SETTINGS,
  equalPowerReverbGains,
  formatReverbFrequency,
  normalizeReverbSettings
} = require('../src/renderer/reverb');

function settingsAreSafeForTheAudioGraph() {
  const settings = normalizeReverbSettings({
    decay: 99,
    size: -20,
    preDelay: 999,
    lowCut: 1900,
    highCut: 1500,
    mix: 140
  });

  assert.equal(settings.decay, 12);
  assert.equal(settings.size, 0);
  assert.equal(settings.preDelay, 250);
  assert.equal(settings.lowCut, 1400);
  assert.equal(settings.highCut, 2000);
  assert.equal(settings.mix, 100);
}

function mixUsesEqualPowerGains() {
  assert.deepEqual(equalPowerReverbGains(0), { dry: 1, wet: 0 });
  const halfway = equalPowerReverbGains(50);
  assert.ok(Math.abs(halfway.dry - Math.SQRT1_2) < 0.000001);
  assert.ok(Math.abs(halfway.wet - Math.SQRT1_2) < 0.000001);
}

function defaultsAndLabelsStayReadable() {
  assert.equal(DEFAULT_REVERB_SETTINGS.mix, 35);
  assert.equal(DEFAULT_REVERB_SETTINGS.preDelay, 20);
  assert.equal(formatReverbFrequency(120), '120 Hz');
  assert.equal(formatReverbFrequency(12000), '12 kHz');
}

settingsAreSafeForTheAudioGraph();
console.log('ok - settingsAreSafeForTheAudioGraph');
mixUsesEqualPowerGains();
console.log('ok - mixUsesEqualPowerGains');
defaultsAndLabelsStayReadable();
console.log('ok - defaultsAndLabelsStayReadable');
