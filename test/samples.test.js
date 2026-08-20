'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const samples = require('../src/main/lib/samples');

// A minimal Ableton-shaped set with one SampleRef per (relativePath, absPath) pair.
function alsXml(refs) {
  const blocks = refs
    .map(
      (r) => `<SampleRef><FileRef>
        <RelativePathType Value="3" />
        <RelativePath Value="${r.rel}" />
        <Path Value="${r.abs}" />
        <Type Value="1" />
      </FileRef></SampleRef>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ableton><LiveSet>${blocks}</LiveSet></Ableton>`;
}

async function flagsOnlyTrulyMissingSamples() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-samples-'));
  try {
    // A sample that exists relative to the project, one that exists only at its
    // absolute path, and one that exists nowhere.
    await fs.mkdir(path.join(temp, 'Samples'), { recursive: true });
    await fs.writeFile(path.join(temp, 'Samples', 'kick.wav'), 'RIFF....');
    const elsewhere = path.join(temp, 'elsewhere');
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.writeFile(path.join(elsewhere, 'snare.wav'), 'RIFF....');

    const xml = alsXml([
      { rel: 'Samples/kick.wav', abs: '/nope/kick.wav' }, // relative resolves -> present
      { rel: 'Samples/snare.wav', abs: path.join(elsewhere, 'snare.wav') }, // absolute exists -> present
      { rel: 'Samples/ghost.wav', abs: '/nope/ghost.wav' } // neither -> missing
    ]);
    const setPath = path.join(temp, 'song.als');
    await fs.writeFile(setPath, zlib.gzipSync(Buffer.from(xml)));

    const result = await samples.auditSamples(setPath);
    assert.equal(result.supported, true);
    assert.equal(result.referenced, 3, 'three distinct references');
    assert.equal(result.present, 2, 'the relative and the absolute one both resolve');
    assert.equal(result.missing.length, 1, 'only the truly-missing one is flagged');
    assert.equal(result.missing[0].name, 'ghost.wav');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function dedupesAndIgnoresNonAbleton() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-samples2-'));
  try {
    // Same missing sample referenced twice must count once.
    const xml = alsXml([
      { rel: 'Samples/dup.wav', abs: '/nope/dup.wav' },
      { rel: 'Samples/dup.wav', abs: '/nope/dup.wav' }
    ]);
    const setPath = path.join(temp, 'dupes.als');
    await fs.writeFile(setPath, zlib.gzipSync(Buffer.from(xml)));
    const result = await samples.auditSamples(setPath);
    assert.equal(result.referenced, 1, 'the duplicate reference is collapsed');
    assert.equal(result.missing.length, 1);

    // Non-Ableton sessions are reported unsupported, never mangled.
    const flp = path.join(temp, 'beat.flp');
    await fs.writeFile(flp, Buffer.from([0x46, 0x4c, 0x68, 0x64]));
    const bad = await samples.auditSamples(flp);
    assert.equal(bad.supported, false);
    assert.equal(bad.missing.length, 0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await flagsOnlyTrulyMissingSamples();
  console.log('ok - flagsOnlyTrulyMissingSamples');
  await dedupesAndIgnoresNonAbleton();
  console.log('ok - dedupesAndIgnoresNonAbleton');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
