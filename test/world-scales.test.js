'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Import world-scales module functions
const {
  WORLD_REGIONS,
  WORLD_SCALES_DATABASE,
  findMatchingWorldScales,
  generateWorldScaleMidi
} = require('../src/renderer/world-scales');

test('World Regions Configuration and Defaults', () => {
  assert.ok(WORLD_REGIONS.length >= 6, 'Should have at least 6 major musical regions');
  
  const indianRegion = WORLD_REGIONS.find((r) => r.id === 'indian');
  assert.ok(indianRegion, 'Indian region should exist');
  assert.equal(indianRegion.flag, '🇮🇳');
  assert.ok(indianRegion.lat > 10 && indianRegion.lng > 70, 'Coordinates for India should be valid');

  const arabicRegion = WORLD_REGIONS.find((r) => r.id === 'arabic');
  assert.ok(arabicRegion, 'Arabic/Egyptian region should exist');
  assert.equal(arabicRegion.flag, '🇪🇬');

  const chineseRegion = WORLD_REGIONS.find((r) => r.id === 'chinese');
  assert.ok(chineseRegion, 'Chinese/East Asian region should exist');
  assert.equal(chineseRegion.flag, '🇨🇳');
});

test('World Scales Database Structure and Degrees', () => {
  assert.ok(WORLD_SCALES_DATABASE.length >= 20, 'Should have a rich library of world scales');

  // 1. Indian Raaga check
  const bhairav = WORLD_SCALES_DATABASE.find((s) => s.id === 'bhairav');
  assert.ok(bhairav, 'Bhairav should exist in world scales');
  assert.deepEqual(bhairav.degrees, [0, 1, 4, 5, 7, 8, 11]);
  assert.equal(bhairav.tradition, 'indian');
  assert.ok(bhairav.phraseNotation && bhairav.phraseNotation.ascending);

  // 2. Arabic Maqam check
  const hijaz = WORLD_SCALES_DATABASE.find((s) => s.id === 'maqam_hijaz');
  assert.ok(hijaz, 'Maqam Hijaz should exist');
  assert.deepEqual(hijaz.degrees, [0, 1, 4, 5, 7, 8, 10]);
  assert.equal(hijaz.tradition, 'arabic');

  const bayati = WORLD_SCALES_DATABASE.find((s) => s.id === 'maqam_bayati');
  assert.ok(bayati, 'Maqam Bayati should exist');
  assert.equal(bayati.tradition, 'arabic');

  const egySuspended = WORLD_SCALES_DATABASE.find((s) => s.id === 'egyptian_suspended');
  assert.ok(egySuspended, 'Egyptian Suspended scale should exist');
  assert.deepEqual(egySuspended.degrees, [0, 2, 5, 7, 10]);

  // 3. Chinese Pentatonic check
  const gong = WORLD_SCALES_DATABASE.find((s) => s.id === 'gong_diao');
  assert.ok(gong, 'Gong Diao should exist');
  assert.deepEqual(gong.degrees, [0, 2, 4, 7, 9]);
  assert.equal(gong.tradition, 'chinese');

  const yu = WORLD_SCALES_DATABASE.find((s) => s.id === 'yu_diao');
  assert.ok(yu, 'Yu Diao should exist');
  assert.deepEqual(yu.degrees, [0, 3, 5, 7, 10]);

  const hirajoshi = WORLD_SCALES_DATABASE.find((s) => s.id === 'hirajoshi_japan');
  assert.ok(hirajoshi, 'Hirajoshi should exist');
  assert.deepEqual(hirajoshi.degrees, [0, 2, 3, 7, 8]);

  // 4. Western & Mediterranean checks
  const dorian = WORLD_SCALES_DATABASE.find((s) => s.id === 'dorian_mode');
  assert.ok(dorian, 'Dorian mode should exist');
  assert.deepEqual(dorian.degrees, [0, 2, 3, 5, 7, 9, 10]);

  const harmonicMinor = WORLD_SCALES_DATABASE.find((s) => s.id === 'harmonic_minor');
  assert.ok(harmonicMinor, 'Harmonic Minor should exist');
  assert.deepEqual(harmonicMinor.degrees, [0, 2, 3, 5, 7, 8, 11]);

  const melodicMinor = WORLD_SCALES_DATABASE.find((s) => s.id === 'melodic_minor');
  assert.ok(melodicMinor, 'Melodic Minor should exist');
  assert.deepEqual(melodicMinor.degrees, [0, 2, 3, 5, 7, 9, 11]);

  const lydian = WORLD_SCALES_DATABASE.find((s) => s.id === 'lydian_mode');
  assert.ok(lydian, 'Lydian mode should exist');
  assert.deepEqual(lydian.degrees, [0, 2, 4, 6, 7, 9, 11]);

  const phrygian = WORLD_SCALES_DATABASE.find((s) => s.id === 'phrygian_mode');
  assert.ok(phrygian, 'Phrygian mode should exist');
  assert.deepEqual(phrygian.degrees, [0, 1, 3, 5, 7, 8, 10]);

  const flamenco = WORLD_SCALES_DATABASE.find((s) => s.id === 'flamenco_mode');
  assert.ok(flamenco, 'Flamenco mode should exist');
  assert.deepEqual(flamenco.degrees, [0, 1, 4, 5, 7, 8, 10]);
  assert.equal(flamenco.tradition, 'mediterranean');
});

test('Chroma Matching across World Traditions', () => {
  // Test Chroma for C Hijaz: C(0), Db(1), E(4), F(5), G(7), Ab(8), Bb(10)
  const hijazChroma = new Float64Array(12);
  [0, 1, 4, 5, 7, 8, 10].forEach((d) => (hijazChroma[d] = 1.0));

  // Match in Arabic tradition
  const arabicMatches = findMatchingWorldScales(hijazChroma, 0, 'arabic', 4);
  assert.ok(arabicMatches.length > 0);
  assert.equal(arabicMatches[0].id, 'maqam_hijaz', 'Top match for Hijaz chroma should be Maqam Hijaz');
  assert.ok(arabicMatches[0].matchPercent >= 85);

  // Test Chroma for C Gong Pentatonic: C(0), D(2), E(4), G(7), A(9)
  const gongChroma = new Float64Array(12);
  [0, 2, 4, 7, 9].forEach((d) => (gongChroma[d] = 1.0));

  const chineseMatches = findMatchingWorldScales(gongChroma, 0, 'chinese', 4);
  assert.ok(chineseMatches.length > 0);
  assert.equal(chineseMatches[0].id, 'gong_diao', 'Top match for Gong chroma should be Gong Diao');
  assert.ok(chineseMatches[0].matchPercent >= 90);

  // Test Western Only tradition matching for A Harmonic Minor: A(9), B(11), C(0), D(2), E(4), F(5), G#(8)
  const harmMinorChroma = new Float64Array(12);
  [9, 11, 0, 2, 4, 5, 8].forEach((d) => (harmMinorChroma[d] = 1.0));

  const westernMatches = findMatchingWorldScales(harmMinorChroma, 9, ['western'], 4);
  assert.ok(westernMatches.length > 0);
  assert.ok(westernMatches.every((m) => m.tradition === 'western'), 'All matches in Western-only mode should be Western scales');
  assert.equal(westernMatches[0].id, 'harmonic_minor');

  // Test All traditions
  const allMatches = findMatchingWorldScales(gongChroma, 0, 'all', 6);
  assert.ok(allMatches.length > 0);
  assert.ok(allMatches.some((m) => m.tradition === 'chinese' || m.tradition === 'celtic' || m.tradition === 'western'));
});

test('World Scale MIDI Generation', () => {
  const midiBytes = generateWorldScaleMidi(0, [0, 1, 4, 5, 7, 8, 10, 12], [12, 10, 8, 7, 5, 4, 1, 0], {
    bpm: 120,
    octave: 4
  });

  assert.ok(midiBytes instanceof Uint8Array, 'Should return Uint8Array');
  assert.ok(midiBytes.length > 30, 'MIDI file should contain valid header and track data');

  // Verify MThd header
  assert.equal(midiBytes[0], 0x4d); // M
  assert.equal(midiBytes[1], 0x54); // T
  assert.equal(midiBytes[2], 0x68); // h
  assert.equal(midiBytes[3], 0x64); // d
});
