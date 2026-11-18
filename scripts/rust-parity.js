'use strict';

/**
 * Rust ⇄ TypeScript parity for the project converter (proposal 0007).
 *
 * Builds the shared fixtures, converts them with BOTH implementations to
 * every target, and compares what comes out:
 *   - REAPER .rpp text, MIDI files, stems and READMEs: byte for byte
 *   - DAWproject: the unzipped project.xml / metadata.xml / audio entries
 *     (the zip container differs only in deflate bytes, zlib vs miniz)
 *   - Conversion logs: everything except the timestamp line
 *   - inspect() summaries: deep-equal
 * plus a second hop (each one's DAWproject → the other's REAPER).
 *
 * Run: npx tsx scripts/rust-parity.js   (builds the Rust example first)
 */

const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const pc = require('../src/main/lib/projectconvert');
const zip = require('../src/main/lib/zipreader');
const { ZipWriter } = require('../src/main/lib/projectconvert/zipwriter');
const { rampWav, alsXml } = require('../test/fixtures/projectconvert-fixture');

const root = path.resolve(__dirname, '..');
execFileSync('cargo', ['build', '-q', '--release', '-p', 'projectconvert', '--example', 'convert'], { cwd: root, stdio: 'inherit' });
const rustBin = path.join(root, 'target', 'release', 'examples', process.platform === 'win32' ? 'convert.exe' : 'convert');

function rust(...args) {
  return JSON.parse(execFileSync(rustBin, args, { encoding: 'utf8' }));
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

function unzipAll(buf) {
  const out = {};
  for (const e of zip.listEntries(buf)) out[e.name] = zip.readEntry(buf, e, 1 << 30);
  return out;
}

const withoutDate = (text) => text.replace(/^Date: .*$/m, 'Date: <stripped>');
// Each implementation unpacks DAWproject audio into its own temp folder, so
// compare REAPER FILE references by file name.
const rppNormal = (text) => text.replace(/^(\s*FILE )(["'`]).*[\\/]([^\\/]+)\2$/gm, '$1$2$3$2');

async function compareOutputs(label, tsResult, rsResult) {
  if (tsResult.outputPath.endsWith('.dawproject')) {
    const a = unzipAll(await fs.readFile(tsResult.outputPath));
    const b = unzipAll(await fs.readFile(rsResult.outputPath));
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), `${label}: zip entries`);
    for (const name of Object.keys(a)) assert.ok(a[name].equals(b[name]), `${label}: ${name} differs`);
  } else if (tsResult.outputPath.endsWith('.rpp')) {
    assert.equal(
      rppNormal(await fs.readFile(rsResult.outputPath, 'utf8')),
      rppNormal(await fs.readFile(tsResult.outputPath, 'utf8')),
      `${label}: .rpp`
    );
  } else {
    const files = await listFiles(tsResult.outputPath);
    assert.deepEqual(await listFiles(rsResult.outputPath), files, `${label}: file list`);
    for (const f of files) {
      if (f === 'Conversion log.txt') continue;
      const a = await fs.readFile(path.join(tsResult.outputPath, f));
      const b = await fs.readFile(path.join(rsResult.outputPath, f));
      assert.ok(a.equals(b), `${label}: ${f} differs`);
    }
  }
  assert.equal(
    withoutDate(await fs.readFile(rsResult.logPath, 'utf8')),
    withoutDate(await fs.readFile(tsResult.logPath, 'utf8')),
    `${label}: conversion log`
  );
  assert.deepEqual(rsResult.warnings, tsResult.warnings, `${label}: warnings`);
  console.log(`  ✓ ${label}`);
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dawbuddy-parity-'));
  const projectDir = path.join(dir, 'Song Project');
  await fs.mkdir(path.join(projectDir, 'Samples', 'Imported'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'Samples', 'Imported', 'ramp.wav'), rampWav(1000, 10));
  const als = path.join(projectDir, 'Song.als');
  await fs.writeFile(als, zlib.gzipSync(Buffer.from(alsXml(), 'utf8')));

  // A DAWproject "from another DAW": hold steps, decibels, a plug-in lane.
  const other = new ZipWriter();
  other.add(
    'project.xml',
    Buffer.from(`<?xml version="1.0"?>
<Project version="1.0">
  <Transport><Tempo unit="bpm" value="100"/><TimeSignature numerator="7" denominator="8"/></Transport>
  <Structure>
    <Track contentType="audio" id="t1" name="Vox" color="#AABBCC">
      <Channel role="regular" id="c1"><Volume unit="decibel" value="-3" id="v1"/><Pan unit="normalized" value="0.25" id="p1"/><Mute value="true" id="m1"/>
        <Devices><Vst3Plugin id="fx1"><Parameters><RealParameter id="fxp1" value="0.2"/></Parameters></Vst3Plugin></Devices></Channel>
    </Track>
    <Track contentType="notes" id="t2" name="Bass"><Channel role="regular" id="c2"><Volume unit="linear" value="0.8" id="v2"/></Channel></Track>
  </Structure>
  <Arrangement>
    <Markers><Marker time="4" name="Verse"/></Markers>
    <Lanes timeUnit="beats">
      <Lanes track="t1">
        <Clips><Clip time="2" duration="4" playStart="0" name="take"><Warps contentTimeUnit="seconds" timeUnit="beats"><Audio channels="1" duration="10" sampleRate="1000"><File path="audio/ramp.wav"/></Audio><Warp time="0" contentTime="0.5"/><Warp time="4" contentTime="2.9"/></Warps></Clip></Clips>
        <Points unit="decibel"><Target parameter="v1"/><RealPoint time="0" value="-6.0206" interpolation="hold"/><RealPoint time="4" value="0" interpolation="linear"/></Points>
        <Points><Target parameter="fxp1"/><RealPoint time="0" value="0"/><RealPoint time="1" value="1"/></Points>
      </Lanes>
      <Lanes track="t2"><Clips><Clip time="0" duration="8" playStart="1"><Notes><Note time="1" duration="2" key="40" vel="0.5"/><Note time="6" duration="4" key="43" vel="1"/></Notes></Clip></Clips></Lanes>
    </Lanes>
  </Arrangement>
</Project>`)
  );
  other.add('audio/ramp.wav', rampWav(1000, 10), false);
  const otherFile = path.join(dir, 'Other.dawproject');
  await fs.writeFile(otherFile, other.toBuffer());

  const sources = [als, otherFile];
  let checks = 0;
  for (const src of sources) {
    console.log(path.basename(src));
    assert.deepEqual(rust(src, 'inspect'), await pc.inspect(src), `${path.basename(src)}: inspect`);
    console.log('  ✓ inspect');
    checks += 1;
    for (const target of ['reaper', 'dawproject', 'universal']) {
      const tsOut = path.join(dir, 'ts', target);
      const rsOut = path.join(dir, 'rs', target);
      await fs.mkdir(tsOut, { recursive: true });
      await fs.mkdir(rsOut, { recursive: true });
      const a = await pc.convert(src, target, tsOut);
      const b = rust(src, target, rsOut);
      await compareOutputs(`${path.basename(src)} → ${target}`, a, b);
      checks += 1;

      // Second hop: read the OTHER implementation's output.
      if (target !== 'universal') {
        const hopTs = path.join(dir, 'hop-ts', target);
        const hopRs = path.join(dir, 'hop-rs', target);
        await fs.mkdir(hopTs, { recursive: true });
        await fs.mkdir(hopRs, { recursive: true });
        const c = await pc.convert(b.outputPath, 'reaper', hopTs);
        const d = rust(a.outputPath, 'reaper', hopRs);
        assert.equal(rppNormal(await fs.readFile(d.outputPath, 'utf8')), rppNormal(await fs.readFile(c.outputPath, 'utf8')), `${target} second hop`);
        console.log(`  ✓ ${target} → other implementation → reaper`);
        checks += 1;
      }
    }
  }
  await fs.rm(dir, { recursive: true, force: true });
  console.log(`rust-parity: ${checks} checks passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
