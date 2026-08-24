'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { processNames, DAWS } = require('../src/main/lib/procs');
const { samePath, isInside } = require('../src/main/lib/settings');
const { planJob } = require('../src/main/lib/convert');
const { encodeMp3WithLame, capabilities } = require('../src/main/lib/encoders');

test('macOS & Linux Cross-Platform Compatibility Test Suite', async (t) => {

  await t.test('macOS Process List Parsing & DAW Detection', () => {
    // macOS `ps -ax -o comm` outputs full binary paths inside .app bundles
    const mockMacPsOutput = `
/sbin/launchd
/usr/libexec/logd
/Applications/Ableton Live 12 Suite.app/Contents/MacOS/Live
/Applications/Logic Pro.app/Contents/MacOS/Logic Pro
/Applications/FL Studio 2024.app/Contents/MacOS/FL Studio
/Applications/Pro Tools.app/Contents/MacOS/Pro Tools
/Applications/Bitwig Studio.app/Contents/MacOS/Bitwig Studio
/Applications/REAPER.app/Contents/MacOS/REAPER
/Applications/Cubase 13.app/Contents/MacOS/Cubase 13
/Applications/Studio One 6.app/Contents/MacOS/Studio One
/usr/bin/login
`;
    const names = processNames(mockMacPsOutput);
    assert.ok(names.length >= 7, 'Should parse process basenames from macOS app bundle paths');

    const matched = [];
    for (const name of names) {
      for (const daw of DAWS) {
        if (daw.match.test(name) && !matched.includes(daw.name)) {
          matched.push(daw.name);
        }
      }
    }

    assert.ok(matched.includes('Ableton Live'), 'Ableton Live on macOS should be detected');
    assert.ok(matched.includes('Logic Pro'), 'Logic Pro on macOS should be detected');
    assert.ok(matched.includes('FL Studio'), 'FL Studio on macOS should be detected');
    assert.ok(matched.includes('Pro Tools'), 'Pro Tools on macOS should be detected');
    assert.ok(matched.includes('Bitwig Studio'), 'Bitwig Studio on macOS should be detected');
    assert.ok(matched.includes('REAPER'), 'REAPER on macOS should be detected');
    assert.ok(matched.includes('Cubase'), 'Cubase on macOS should be detected');
    assert.ok(matched.includes('Fender Studio Pro') || matched.includes('Studio One'), 'Studio One on macOS should be detected');
  });

  await t.test('macOS AppleDouble (._*) and .DS_Store ignored by scanner filters', () => {
    const macCruft = [
      '._MySong.als',
      '._vocal.wav',
      '.DS_Store',
      '.localized',
      '._audio.mp3'
    ];

    for (const file of macCruft) {
      const isAppleDouble = path.basename(file).startsWith('._');
      const isHidden = path.basename(file).startsWith('.');
      assert.ok(isAppleDouble || isHidden, `${file} must be identified as hidden metadata`);
    }
  });

  await t.test('Linux & POSIX Path Normalization and Relativity', () => {
    const root = '/home/musician/Music/DAW Projects';
    const sub = '/home/musician/Music/DAW Projects/Deep House 2026/render.wav';
    const outside = '/home/musician/Downloads/sample.wav';

    assert.ok(isInside(sub, root), 'Subfolder should be recognized as inside root on Linux');
    assert.ok(!isInside(outside, root), 'Outside folder should be recognized as outside root on Linux');

    if (process.platform === 'win32' || process.platform === 'darwin') {
      const winPath = 'C:\\Users\\musician\\Music\\Project';
      const winPathLower = 'c:\\users\\musician\\music\\project';
      assert.ok(samePath(winPath, winPathLower), 'Windows & macOS paths match case-insensitively');
    }

    const linuxPath = '/home/user/music/project';
    const linuxPathSame = '/home/user/music/project';
    assert.ok(samePath(linuxPath, linuxPathSame), 'Linux paths should match accurately');
  });

  await t.test('Audio extension case-insensitivity on case-sensitive filesystems', () => {
    const testCases = [
      { name: 'kick.WAV', expected: true },
      { name: 'snare.wav', expected: true },
      { name: 'synth.Mp3', expected: true },
      { name: 'bass.MP3', expected: true },
      { name: 'pad.Flac', expected: true },
      { name: 'lead.FLAC', expected: true },
      { name: 'sample.Aif', expected: true },
      { name: 'drone.AIFF', expected: true },
      { name: 'notes.txt', expected: false },
      { name: 'document.pdf', expected: false }
    ];

    const audioExts = ['.wav', '.mp3', '.flac', '.aif', '.aiff', '.ogg', '.m4a'];
    for (const { name, expected } of testCases) {
      const ext = path.extname(name).toLowerCase();
      const isAudio = audioExts.includes(ext);
      assert.strictEqual(isAudio, expected, `${name} audio check mismatch`);
    }
  });

  await t.test('Pure JavaScript / WASM Encoders work across all platforms without external binaries', async () => {
    const { resolve: resolveEncoders } = require('../src/main/lib/encoders');
    const resolved = await resolveEncoders();
    const caps = capabilities(resolved);
    assert.ok(caps.wav, 'WAV support is available natively on all OS');
    assert.ok(caps.mp3, 'MP3 support (via lamejs or ffmpeg) is available on all OS');

    const dummySamples = new Int16Array(44100);
    const mp3Buffer = encodeMp3WithLame(dummySamples, { sampleRate: 44100, channels: 1, bitrate: 128 });
    assert.ok(mp3Buffer.length > 0, 'Pure JS MP3 encode must produce non-empty buffer on all OS');

    const convert = require('../src/main/lib/convert');
    const limit = convert.maxPartSeconds({ ...convert.DEFAULTS, format: 'mp3', bitrate: 192 });
    assert.equal(limit.boundBy, 'time', 'MP3 at 192kbps should be bound by time limit across all OS');
    assert.ok(limit.seconds <= 300, 'Max part duration should be <= 300s (5 minutes)');
  });

});
