'use strict';

const assert = require('assert/strict');
const { parseQuery, hasQuery, matchesQuery } = require('../src/renderer/search');

// A couple of stand-in projects to match against.
const jump = {
  name: 'Jump 3',
  location: 'Jump / May 2026',
  daw: 'Ableton',
  bpm: 142
};
const jumpRec = { key: 'F Minor', camelot: '4A', note: 'needs a vocal chop' };

const reel = {
  name: 'Reel alignment',
  location: 'Suraag',
  daw: 'FL Studio',
  bpm: 90
};
const reelRec = { key: 'C Major', camelot: '8B', note: '' };

function bpmRangeMatches() {
  const q = parseQuery('bpm:140-145');
  assert.equal(hasQuery(q), true);
  assert.equal(matchesQuery(jump, jumpRec, q), true);
  assert.equal(matchesQuery(reel, reelRec, q), false);
}

function bareRangeReadsAsBpm() {
  const q = parseQuery('140-145');
  assert.deepEqual(q.bpm, { lo: 140, hi: 145 });
  assert.equal(matchesQuery(jump, jumpRec, q), true);
}

function bareYearRangeStaysText() {
  // Out of tempo range, so it must not be treated as a BPM filter.
  const q = parseQuery('2020-2021');
  assert.equal(q.bpm, null);
  assert.deepEqual(q.text, ['2020-2021']);
}

function keyMatchesNameOrCamelot() {
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('key:fmin')), true);
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('key:4A')), true);
  assert.equal(matchesQuery(reel, reelRec, parseQuery('key:fmin')), false);
}

function dawAndNoteFilters() {
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('daw:ableton')), true);
  assert.equal(matchesQuery(reel, reelRec, parseQuery('daw:ableton')), false);
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('note:vocal')), true);
  assert.equal(matchesQuery(reel, reelRec, parseQuery('note:vocal')), false);
}

function freeTextIsAndMatched() {
  // Both terms must be present somewhere in the project's text.
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('jump vocal')), true);
  assert.equal(matchesQuery(jump, jumpRec, parseQuery('jump drums')), false);
}

function combinedFieldsAndText() {
  const q = parseQuery('bpm:140-145 key:4A vocal');
  assert.equal(matchesQuery(jump, jumpRec, q), true);
  assert.equal(matchesQuery(reel, reelRec, q), false);
}

function emptyQueryIsInactive() {
  assert.equal(hasQuery(parseQuery('   ')), false);
}

async function run() {
  const tests = [
    bpmRangeMatches,
    bareRangeReadsAsBpm,
    bareYearRangeStaysText,
    keyMatchesNameOrCamelot,
    dawAndNoteFilters,
    freeTextIsAndMatched,
    combinedFieldsAndText,
    emptyQueryIsInactive
  ];
  for (const test of tests) {
    await test();
    console.log(`ok - ${test.name}`);
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
