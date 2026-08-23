'use strict';

const assert = require('assert/strict');
const {
  THEME_STYLES,
  MINIMALIST_ACCENTS,
  ABLETON_ACCENTS,
  CLASSIC_ACCENTS,
  BLOO_ACCENTS,
  ACCENTS,
  SURFACES
} = require('../src/renderer/dom');

function testThemeDefaults() {
  assert.ok(THEME_STYLES.includes('minimalist'), 'Minimalist must be a supported theme style');
  assert.ok(THEME_STYLES.includes('ableton'), 'Ableton Like must be a supported theme style');
  assert.ok(THEME_STYLES.includes('classic'), 'Studio Classic must be a supported theme style');
  assert.ok(THEME_STYLES.includes('bloo'), 'Bloo Wireframe must be a supported theme style');
  assert.equal(THEME_STYLES[0], 'minimalist', 'Minimalist should be the default theme style');

  assert.ok(MINIMALIST_ACCENTS.includes('cyan'), 'Electric Cyan should be in minimalist accents');
  assert.ok(MINIMALIST_ACCENTS.includes('mint'), 'Neon Mint should be in minimalist accents');
  assert.ok(ABLETON_ACCENTS.includes('mint'), 'Ableton Mint should be in ableton accents');
  assert.ok(ABLETON_ACCENTS.includes('magenta'), 'Hot Magenta should be in ableton accents');
  assert.ok(ABLETON_ACCENTS.includes('yellow'), 'Solar Yellow should be in ableton accents');
  assert.ok(CLASSIC_ACCENTS.includes('green'), 'Green should be in classic accents');
  assert.ok(CLASSIC_ACCENTS.includes('amber'), 'Amber should be in classic accents');
  assert.ok(BLOO_ACCENTS.includes('bloo'), 'Bloo should be in bloo accents');
  assert.ok(BLOO_ACCENTS.includes('cyan'), 'Cyan should be in bloo accents');

  assert.ok(SURFACES.includes('dark'));
  assert.ok(SURFACES.includes('light'));
  assert.ok(SURFACES.includes('amoled'));
}

testThemeDefaults();
console.log('ok - testThemeDefaults');
