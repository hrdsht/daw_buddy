'use strict';

/**
 * Project converter: Ableton → neutral → DAWproject / REAPER / MIDI+stems,
 * and back again. A synthetic set exercises the parts that are easy to get
 * wrong: looped MIDI clips unrolling, warped vs unwarped audio offsets, the
 * packed time signature, and file lookup when the stored path is stale.
 */

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const pc = require('../src/main/lib/projectconvert');
const { clipSegments, decodeTimeSignature, beatToSec } = require('../src/main/lib/projectconvert/read-ableton');
const { parseXml } = require('../src/main/lib/projectconvert/xml');
const { tokenize } = require('../src/main/lib/projectconvert/reaper');
const zip = require('../src/main/lib/zipreader');
const silence = require('../src/main/lib/silence');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** 16-bit mono WAV where sample i = (i % 1000) * 10, so offsets are checkable. */
function rampWav(sampleRate, seconds) {
  const frames = Math.round(sampleRate * seconds);
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) buf.writeInt16LE((i % 1000) * 10, 44 + i * 2);
  return buf;
}

function alsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0">
  <LiveSet>
    <Tracks>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="Drums &amp; Perc" /><UserName Value="" /></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.5" /></Volume>
            <Pan><Manual Value="-0.25" /></Pan>
            <Speaker><Manual Value="true" /></Speaker>
          </Mixer>
          <MainSequencer>
            <ClipSlotList />
            <Sample>
              <ArrangerAutomation>
                <Events>
                  <AudioClip Id="0" Time="4">
                    <CurrentStart Value="4" /><CurrentEnd Value="8" />
                    <Loop><LoopStart Value="1" /><LoopEnd Value="5" /><StartRelative Value="0" /><LoopOn Value="false" /></Loop>
                    <Name Value="Unwarped" />
                    <SampleRef><FileRef><RelativePath Value="Samples/Imported/ramp.wav" /><Path Value="/no/such/place/ramp.wav" /></FileRef></SampleRef>
                    <IsWarped Value="false" />
                    <SampleVolume Value="1" />
                  </AudioClip>
                  <AudioClip Id="1" Time="8">
                    <CurrentStart Value="8" /><CurrentEnd Value="10" />
                    <Loop><LoopStart Value="2" /><LoopEnd Value="6" /><StartRelative Value="0" /><LoopOn Value="false" /></Loop>
                    <Name Value="Warped" />
                    <SampleRef><FileRef><Path Value="C:/old/drive/ramp.wav" /></FileRef></SampleRef>
                    <IsWarped Value="true" />
                    <WarpMarkers><WarpMarker Id="0" SecTime="0" BeatTime="0" /><WarpMarker Id="1" SecTime="4" BeatTime="8" /></WarpMarkers>
                    <SampleVolume Value="0.5" />
                  </AudioClip>
                </Events>
              </ArrangerAutomation>
            </Sample>
          </MainSequencer>
        </DeviceChain>
      </AudioTrack>
      <MidiTrack Id="2">
        <Name><EffectiveName Value="Keys" /><UserName Value="Lead Keys" /></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="1" /></Volume>
            <Pan><Manual Value="0" /></Pan>
            <Speaker><Manual Value="false" /></Speaker>
          </Mixer>
          <MainSequencer>
            <ClipSlotList>
              <ClipSlot><ClipSlot><Value><MidiClip Id="9" Time="0"><CurrentStart Value="0"/><CurrentEnd Value="4"/></MidiClip></Value></ClipSlot></ClipSlot>
            </ClipSlotList>
            <ClipTimeable>
              <ArrangerAutomation>
                <Events>
                  <MidiClip Id="0" Time="0">
                    <CurrentStart Value="0" /><CurrentEnd Value="10" />
                    <Loop><LoopStart Value="0" /><LoopEnd Value="4" /><StartRelative Value="0" /><LoopOn Value="true" /></Loop>
                    <Name Value="Riff" />
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="0">
                          <Notes>
                            <MidiNoteEvent Time="0" Duration="1" Velocity="100" IsEnabled="true" />
                            <MidiNoteEvent Time="3.5" Duration="1" Velocity="90" IsEnabled="true" />
                            <MidiNoteEvent Time="2" Duration="1" Velocity="90" IsEnabled="false" />
                          </Notes>
                          <MidiKey Value="60" />
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Events>
              </ArrangerAutomation>
            </ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
      <ReturnTrack Id="3"><Name><EffectiveName Value="A-Reverb" /></Name></ReturnTrack>
    </Tracks>
    <MainTrack>
      <DeviceChain>
        <Mixer>
          <Tempo><Manual Value="120" /></Tempo>
          <TimeSignature><Manual Value="200" /></TimeSignature>
        </Mixer>
      </DeviceChain>
    </MainTrack>
    <Locators><Locators>
      <Locator Id="0"><Time Value="0" /><Name Value="Intro" /></Locator>
      <Locator Id="1"><Time Value="8" /><Name Value="Drop" /></Locator>
    </Locators></Locators>
  </LiveSet>
</Ableton>`;
}

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dawbuddy-pc-'));
  const projectDir = path.join(dir, 'Song Project');
  await fs.mkdir(path.join(projectDir, 'Samples', 'Imported'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'Samples', 'Imported', 'ramp.wav'), rampWav(1000, 10));
  const als = path.join(projectDir, 'Song.als');
  await fs.writeFile(als, zlib.gzipSync(Buffer.from(alsXml(), 'utf8')));
  return { dir, als, out: path.join(dir, 'out') };
}

(async () => {
  await test('xml parser handles entities, self-closing tags and quoted >', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &gt; 0"><b y=\'2\'/><c>t&amp;u</c></a>');
    const a = doc.children[0];
    assert.equal(a.attrs.x, '1 > 0');
    assert.equal(a.children[0].attrs.y, '2');
    assert.equal(a.children[1].text, 't&u');
  });

  await test('Ableton time signature decoding', () => {
    assert.deepEqual(decodeTimeSignature(201), [4, 4]);
    assert.deepEqual(decodeTimeSignature(200), [3, 4]);
    assert.deepEqual(decodeTimeSignature(302), [6, 8]);
  });

  await test('looped clip unrolls into passes', () => {
    const segs = clipSegments(0, 10, 0, 0, 4, true, 1);
    assert.deepEqual(segs.map((s) => [s.arrStart, s.arrLength, s.contentStart]), [[0, 4, 0], [4, 4, 0], [8, 2, 0]]);
    const offset = clipSegments(0, 6, 3, 2, 4, true, 1);
    assert.deepEqual(offset.map((s) => [s.arrStart, s.arrLength, s.contentStart]), [[0, 1, 3], [1, 2, 2], [3, 2, 2], [5, 1, 2]]);
  });

  await test('warp markers map beats to seconds', () => {
    near(beatToSec(2, [{ sec: 0, beat: 0 }, { sec: 4, beat: 8 }], 120), 1);
    near(beatToSec(2, [], 120), 1);
  });

  await test('rpp tokenizer honours quotes', () => {
    assert.deepEqual(tokenize('NAME "My \'quoted\' track"'), ['NAME', "My 'quoted' track"]);
    assert.deepEqual(tokenize('FILE `a "b" c` 1'), ['FILE', 'a "b" c', '1']);
  });

  const fx = await fixture();

  await test('reads an Ableton set into the neutral model', async () => {
    const s = await pc.inspect(fx.als);
    assert.equal(s.source, 'Ableton Live');
    assert.equal(s.bpm, 120);
    assert.equal(s.timeSignature, '3/4');
    assert.equal(s.tracks, 2);
    assert.equal(s.audioClips, 2);
    assert.equal(s.midiClips, 1);
    assert.equal(s.notes, 5, 'two enabled notes × 2 full passes + 1 note in the half pass');
    assert.equal(s.markers, 2);
    assert.equal(s.missingFiles, 0, 'stale absolute path falls back to the project folder');
    assert.ok(s.warnings.some((w) => /Session View/.test(w)));
    assert.ok(s.warnings.some((w) => /Return track "A-Reverb"/.test(w)));
  });

  await test('Ableton → REAPER keeps names, positions, offsets and notes', async () => {
    const r = await pc.convert(fx.als, 'reaper', fx.out);
    const text = await fs.readFile(r.outputPath, 'utf8');
    assert.match(text, /TEMPO 120 3 4/);
    assert.match(text, /NAME "Drums & Perc"/);
    assert.match(text, /NAME "Lead Keys"/);
    assert.match(text, /MARKER 2 4 "Drop"/);
    assert.match(text, /VOLPAN 0.5 -0.25/);
    assert.match(text, /MUTESOLO 1 0 0/);
    // Unwarped clip: at beat 4 = 2 s, starts 1 s into the file.
    assert.match(text, /POSITION 2\n\s+LENGTH 2\n\s+NAME "Unwarped"\n\s+SOFFS 1\n/);
    // Warped clip: content beat 2 → 1 s through the warp markers.
    assert.match(text, /POSITION 4\n\s+LENGTH 1\n\s+NAME "Warped"\n\s+SOFFS 1\n\s+VOLPAN 0.5/);

    const back = await pc.inspect(r.outputPath);
    assert.equal(back.tracks, 2);
    assert.equal(back.notes, 5);
    assert.equal(back.audioClips, 2);
    assert.equal(back.missingFiles, 0);
    const log = await fs.readFile(r.logPath, 'utf8');
    assert.match(log, /NOT CARRIED/);
  });

  await test('Ableton → DAWproject is a valid zip that reads back the same', async () => {
    const r = await pc.convert(fx.als, 'dawproject', fx.out);
    const buf = await fs.readFile(r.outputPath);
    const names = zip.listEntries(buf).map((e) => e.name).sort();
    assert.deepEqual(names, ['audio/ramp.wav', 'metadata.xml', 'project.xml']);
    const xml = zip.readEntry(buf, zip.listEntries(buf).find((e) => e.name === 'project.xml')).toString('utf8');
    assert.match(xml, /<TimeSignature denominator="4" numerator="3"/);
    assert.match(xml, /<Marker time="8" name="Drop"\/>/);

    const back = await pc.inspect(r.outputPath);
    assert.equal(back.bpm, 120);
    assert.equal(back.timeSignature, '3/4');
    assert.equal(back.tracks, 2);
    assert.equal(back.audioClips, 2);
    assert.equal(back.notes, 5);
    assert.equal(back.missingFiles, 0);

    // And on to REAPER: the offsets must survive two hops.
    const r2 = await pc.convert(r.outputPath, 'reaper', fx.out);
    const text = await fs.readFile(r2.outputPath, 'utf8');
    assert.match(text, /POSITION 2\n\s+LENGTH 2\n\s+NAME "Unwarped"\n\s+SOFFS 1\n/);
    assert.match(text, /NAME "Lead Keys"/);
  });

  await test('Ableton → MIDI + stems renders aligned stems and a format-1 MIDI file', async () => {
    const r = await pc.convert(fx.als, 'universal', fx.out);
    const files = await fs.readdir(r.outputPath);
    assert.ok(files.includes('Song.mid'));
    assert.ok(files.includes('READ ME — how to open.txt'));
    const stems = await fs.readdir(path.join(r.outputPath, 'Stems'));
    assert.deepEqual(stems, ['01 Drums & Perc.wav']);

    const wav = await fs.readFile(path.join(r.outputPath, 'Stems', stems[0]));
    const parsed = silence.parseWav(wav);
    assert.equal(parsed.fmt.sampleRate, 1000);
    const at = (sec) => wav.readFloatLE(parsed.dataOffset + Math.round(sec * 1000) * 4);
    near(at(1.5), 0, 1e-9); // before any clip: silence
    // Unwarped clip starts at 2 s with source offset 1 s → source frame 1000 → ramp value 0.
    near(at(2), ((1000 % 1000) * 10) / 32768, 1e-6);
    near(at(2.25), ((1250 % 1000) * 10) / 32768, 1e-6);
    // Warped clip at 4 s, offset 1 s, gain 0.5.
    near(at(4.1), (((1100 % 1000) * 10) / 32768) * 0.5, 1e-6);

    const mid = await fs.readFile(path.join(r.outputPath, 'Song.mid'));
    assert.equal(mid.toString('ascii', 0, 4), 'MThd');
    assert.equal(mid.readUInt16BE(8), 1);
    assert.equal(mid.readUInt16BE(10), 2, 'conductor + one MIDI track');
    assert.ok(mid.includes(Buffer.from('Lead Keys')));
    assert.ok(mid.includes(Buffer.from('Drop')));
  });

  await test('closed formats explain the way out', () => {
    const r = pc.supports('/x/Beat.flp');
    assert.equal(r.ok, false);
    assert.match(r.reason, /FL Studio/);
    assert.match(pc.supports('/x/Song.cpr').reason, /DAWproject/);
    assert.equal(pc.supports('/x/Song.als').ok, true);
  });

  await fs.rm(fx.dir, { recursive: true, force: true });
  console.log(`projectconvert: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
