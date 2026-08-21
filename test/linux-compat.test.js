'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { processNames, DAWS } = require('../src/main/lib/procs');
const { scanRoots, scanFolder, NEVER_PROJECTS } = require('../src/main/lib/scanner');
const { Settings, samePath, isInside } = require('../src/main/lib/settings');

test('Linux Process List Parsing & DAW Detection', async (t) => {
  await t.test('parses standard Linux ps output', () => {
    const mockPsOutput = `
systemd
kthreadd
pulseaudio
pipewire
pipewire-pulse
bitwig-studio
reaper
ardour-8.6.0
lmms
renoise
Waveform13
audacity
oom_reaper
bash
ps
`;
    const names = processNames(mockPsOutput);
    assert.ok(names.includes('bitwig-studio'));
    assert.ok(names.includes('reaper'));
    assert.ok(names.includes('ardour-8.6.0'));
    assert.ok(names.includes('lmms'));
    assert.ok(names.includes('renoise'));
    assert.ok(names.includes('Waveform13'));
    assert.ok(names.includes('audacity'));
    assert.ok(names.includes('oom_reaper'));

    // Check DAW matching
    const matched = [];
    for (const name of names) {
      for (const daw of DAWS) {
        if (daw.match.test(name) && !matched.includes(daw.name)) {
          matched.push(daw.name);
        }
      }
    }

    assert.ok(matched.includes('Bitwig Studio'), 'Bitwig Studio should be detected');
    assert.ok(matched.includes('REAPER'), 'REAPER should be detected');
    assert.ok(matched.includes('Ardour'), 'Ardour should be detected');
    assert.ok(matched.includes('LMMS'), 'LMMS should be detected');
    assert.ok(matched.includes('Renoise'), 'Renoise should be detected');
    assert.ok(matched.includes('Waveform'), 'Waveform should be detected');
    assert.ok(matched.includes('Audacity'), 'Audacity should be detected');

    // Crucial: oom_reaper must NEVER trigger REAPER
    const oomMatches = DAWS.filter((d) => d.match.test('oom_reaper'));
    assert.strictEqual(oomMatches.length, 0, 'oom_reaper kernel thread must NOT trigger REAPER detection');
  });

  await t.test('handles Linux paths in process listing', () => {
    const mockPsPaths = `
/usr/bin/pipewire
/opt/bitwig-studio/bin/bitwig-studio
/opt/REAPER/reaper
/usr/bin/lmms
`;
    const names = processNames(mockPsPaths);
    assert.deepStrictEqual(names, ['pipewire', 'bitwig-studio', 'reaper', 'lmms']);
  });
});

test('Linux Path Handling & Case Sensitivity', async (t) => {
  await t.test('path normalization and relativity', () => {
    const parent = '/home/producer/Music/Studio Projects';
    const child = '/home/producer/Music/Studio Projects/2026/Track1';
    assert.ok(isInside(child, parent), 'Child folder should be inside parent');

    const outside = '/media/producer/ExternalDrive/Projects';
    assert.ok(!isInside(outside, parent), 'External drive should not be inside home');
  });
});
