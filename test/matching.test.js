'use strict';

const assert = require('assert/strict');
const {
  parseCamelot,
  keyRelation,
  compatibleKey,
  tempoRelation,
  findMatches
} = require('../src/renderer/matching');

function parsesCamelot() {
  assert.deepEqual(parseCamelot('8A'), { num: 8, letter: 'A' });
  assert.deepEqual(parseCamelot(' 12b '), { num: 12, letter: 'B' });
  assert.equal(parseCamelot('13A'), null);
  assert.equal(parseCamelot('F minor'), null);
  assert.equal(parseCamelot(''), null);
}

function keyRelations() {
  assert.equal(keyRelation('8A', '8A'), 'same key');
  assert.equal(keyRelation('8A', '8B'), 'relative');
  assert.equal(keyRelation('8A', '9A'), 'fifth'); // +1 up the wheel
  assert.equal(keyRelation('8A', '7A'), 'fourth');
  assert.equal(keyRelation('12A', '1A'), 'fifth'); // wraps 12 -> 1
  assert.equal(keyRelation('1A', '12A'), 'fourth');
  assert.equal(keyRelation('8A', '3A'), null); // clash
  assert.equal(keyRelation('8A', '2B'), null);
}

function compatibleKeyWrapper() {
  assert.equal(compatibleKey('8A', '9A'), true);
  assert.equal(compatibleKey('8A', '3B'), false);
}

function tempoRelations() {
  assert.equal(tempoRelation(140, 141), 'same tempo');
  assert.equal(tempoRelation(140, 70), 'half/double time');
  assert.equal(tempoRelation(70, 140), 'half/double time');
  assert.equal(tempoRelation(140, 128), null);
  assert.equal(tempoRelation(140, 0), null);
}

function findMatchesRanksBest() {
  const target = { path: 't', bpm: 140 };
  const targetRec = { camelot: '8A' };
  const entries = [
    { path: 'a', bpm: 140, name: 'same key + tempo' }, // 8A 140
    { path: 'b', bpm: 70, name: 'relative + double' }, //  8B 70
    { path: 'c', bpm: 128, name: 'clash' }, //             3A 128
    { path: 'd', bpm: 141, name: 'fifth + tempo' }, //     9A 141
    { path: 't', bpm: 140, name: 'self' }
  ];
  const recs = { a: { camelot: '8A' }, b: { camelot: '8B' }, c: { camelot: '3A' }, d: { camelot: '9A' } };
  const matches = findMatches(target, targetRec, entries, (e) => recs[e.path] || {});

  const paths = matches.map((m) => m.entry.path);
  assert.ok(!paths.includes('t'), 'excludes self');
  assert.ok(!paths.includes('c'), 'excludes clashing key');
  assert.equal(paths[0], 'a', 'same key + same tempo ranks first');
  assert.deepEqual(matches[0].keyRelation, 'same key');
}

function tempoOnlyWhenTargetHasNoKey() {
  const target = { path: 't', bpm: 140 };
  const targetRec = { camelot: null }; // no key detected
  const entries = [{ path: 'a', bpm: 140, name: 'tempo only' }];
  const matches = findMatches(target, targetRec, entries, () => ({ camelot: '8A' }));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tempoRelation, 'same tempo');
}

async function run() {
  const tests = [
    parsesCamelot,
    keyRelations,
    compatibleKeyWrapper,
    tempoRelations,
    findMatchesRanksBest,
    tempoOnlyWhenTargetHasNoKey
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
