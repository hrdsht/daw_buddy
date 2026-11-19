'use strict';

/**
 * A project drive in miniature, for the scanner parity check
 * (scripts/rust-parity-scanner.js). Every DAW format the scanner knows, plus
 * the edge cases the walk has rules for: backups beside and below projects,
 * render folders, loose audio in an ancestor, version families, zipped
 * exports, videos, skip-list folders, hidden folders, links and an
 * unreadable root.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ZipWriter } = require('../../src/main/lib/projectconvert/zipwriter');

const write = (file, data = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

// Fixed timestamps (whole seconds and fractional) so ordering is deterministic.
let clock = Date.UTC(2026, 0, 1) / 1000;
const touch = (file, fraction = 0) => {
  clock += 3600;
  fs.utimesSync(file, clock + fraction, clock + fraction);
};

function als(bpm, num = 4, den = 4, legacy = false) {
  const tempo = legacy
    ? `<CurrentTempo Value="${bpm}" />`
    : `<Tempo><LomId Value="0" /><Manual Value="${bpm}" /></Tempo>`;
  const xml = `<?xml version="1.0"?><Ableton><LiveSet><MainTrack><DeviceChain><Mixer>${tempo}</Mixer></DeviceChain></MainTrack>
<TimeSignature><Numerator Value="${num}" /><Denominator Value="${den}" /></TimeSignature></LiveSet></Ableton>`;
  return zlib.gzipSync(Buffer.from(xml));
}

/** A classic FLP: header, then events — time sig, old tempo, then fine tempo. */
function flp({ fine = null, old = null, num = null, den = null, text = true } = {}) {
  const events = [];
  if (num) events.push(Buffer.from([17, num]));
  if (den) events.push(Buffer.from([18, den]));
  if (text) events.push(Buffer.from([199, 5, 0x46, 0x4c, 0x20, 0x32, 0x36])); // varint text "FL 26"
  if (old) {
    const b = Buffer.alloc(3);
    b[0] = 66;
    b.writeUInt16LE(old, 1);
    events.push(b);
  }
  if (fine) {
    const b = Buffer.alloc(5);
    b[0] = 156;
    b.writeUInt32LE(Math.round(fine * 1000), 1);
    events.push(b);
  }
  const data = Buffer.concat(events);
  const head = Buffer.alloc(14);
  head.write('FLhd', 0);
  head.writeUInt32LE(6, 4);
  const dt = Buffer.alloc(8);
  dt.write('FLdt', 0);
  dt.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, dt, data]);
}

function song(tempo, num, den) {
  const z = new ZipWriter();
  z.add('Song/song.xml', Buffer.from(`<Song><Attributes Tempo="${tempo}"/><TimeSignature numerator="${num}" denominator="${den}"/></Song>`));
  z.add('Media/clip.wav', Buffer.from('RIFF'));
  return z.toBuffer();
}

function build(root) {
  fs.rmSync(root, { recursive: true, force: true });
  const drive = path.join(root, 'Music');

  /* Ableton: a folder with several pieces of work, versions, backups, renders */
  const olaala = path.join(drive, 'Clients', 'Olaala bgm idea 3 Project');
  write(path.join(olaala, 'Yogi mom reunion.als'), als(85));
  touch(path.join(olaala, 'Yogi mom reunion.als'));
  write(path.join(olaala, 'Yogi mom reunion 2.als'), als(85, 3, 4));
  touch(path.join(olaala, 'Yogi mom reunion 2.als'), 0.25);
  write(path.join(olaala, 'Yogi babu TEASER INTRO finale.als'), als(120.555));
  touch(path.join(olaala, 'Yogi babu TEASER INTRO finale.als'));
  write(path.join(olaala, 'Old legacy set.als'), als(98.5, 6, 8, true));
  write(path.join(olaala, 'Broken.als'), Buffer.from([0x1f, 0x8b, 1, 2, 3])); // corrupt gzip
  write(path.join(olaala, 'No tempo.als'), Buffer.from('<Ableton><LiveSet/></Ableton>'));
  for (let i = 0; i < 5; i += 1) write(path.join(olaala, 'Backup', `Yogi mom reunion [2026-0${i + 1}-01].als`), 'x');
  write(path.join(olaala, 'Samples', 'Imported', 'Inner.als'), als(1)); // never a project
  write(path.join(olaala, 'Ableton Project Info', 'x.als'), als(1));
  write(path.join(olaala, 'Bounces', 'Yogi mom reunion master.wav'), 'w');
  touch(path.join(olaala, 'Bounces', 'Yogi mom reunion master.wav'), 0.5);
  write(path.join(olaala, 'Bounces', 'nested', 'Yogi babu teaser.mp3'), 'w');
  write(path.join(olaala, 'Yogi mom reunion 2.zip'), 'zip');
  write(path.join(olaala, 'teaser cut.mp4'), 'v');
  write(path.join(olaala, 'Kick.WAV'), 'w'); // upper-case extension

  /* Version family: one folder, seven rows → one group */
  const nava = path.join(drive, 'Nava Bharat Jodo Project');
  ['Nava bharat jodo', 'Nava bharat jodo 2', 'Nava bharat jodo 3', 'Nava bharat jodo 3 bounced', 'Nava bharat jodo 3 bounced_2', 'Nava bharat jodo 4', 'Studio 54'].forEach(
    (n, i) => {
      write(path.join(nava, `${n}.als`), als(100 + i));
      touch(path.join(nava, `${n}.als`));
    }
  );

  /* FL Studio: fine tempo + time sig, old-tempo only, FL26 fallback, backups */
  const fl = path.join(drive, 'FL', 'Reel alignment ai voice');
  write(path.join(fl, 'Reel alignment ai voice.flp'), flp({ fine: 140.5, num: 7, den: 8 }));
  write(path.join(fl, 'Old tempo.flp'), flp({ old: 93 }));
  write(path.join(fl, 'Reel alignment ai voice (autosaved on 10-08-2026 at 9h46).flp'), flp({ fine: 1 }));
  write(path.join(fl, 'Backup', 'Reel alignment ai voice (overwritten on 10-08-2026 at 12h59).flp'), 'x');
  write(path.join(fl, 'Not FL.flp'), 'garbage');
  const fl26 = Buffer.alloc(200);
  fl26.write('FLhd', 0);
  fl26.writeUInt32LE(6, 4);
  fl26.write('FLdt', 14);
  fl26.writeUInt32LE(178, 18);
  fl26[22] = 172; // swallowing event, as FL 26 writes
  fl26[128] = 156;
  fl26.writeUInt32LE(140000, 129);
  write(path.join(fl, 'FL26 project.flp'), fl26);
  write(path.join(fl, 'Renders', 'Reel alignment ai voice.wav'), 'w');

  /* REAPER */
  // Not 'Mix': a folder named like a render folder is never walked for projects.
  const rpp = path.join(drive, 'Reaper', 'Club night');
  write(path.join(rpp, 'Mix.rpp'), '<REAPER_PROJECT 0.1 "7.0"\n  TEMPO 128.5 6 8\n>\n');
  write(path.join(rpp, 'Mix-2026.rpp-bak'), 'x');
  write(path.join(rpp, 'mix take.rpp-bak'), 'x');
  write(path.join(rpp, 'Bass.wav.rpp'), 'TEMPO 1');
  write(path.join(rpp, 'Mix (backup 2).rpp'), 'TEMPO 2');
  write(path.join(rpp, 'Untimed.rpp'), '<REAPER_PROJECT>\n');

  /* Bitwig, Pro Tools, Studio One, Cubase, Logic */
  const bw = path.join(drive, 'Bitwig', 'Track');
  write(path.join(bw, 'Track.bwproject'), 'b');
  write(path.join(bw, 'auto-backup', 'Track-1.bwproject'), 'b');
  write(path.join(bw, 'auto-backup', 'versions', 'Track-old.bwproject'), 'b');
  const pt = path.join(drive, 'ProTools', 'Film');
  write(path.join(pt, 'Film.ptx'), 'p');
  write(path.join(pt, 'Session File Backups', 'Film.bak.001.ptx'), 'p');
  write(path.join(pt, 'Audio Files', 'Inside.ptx'), 'p');
  const s1 = path.join(drive, 'StudioOne', 'Anthem');
  write(path.join(s1, 'Anthem.song'), song(96.25, 5, 4));
  write(path.join(s1, 'History', 'Anthem (1).song'), 's');
  write(path.join(s1, 'History', 'Anthem (2).song'), 's');
  const cub = path.join(drive, 'Cubase', 'Score');
  write(path.join(cub, 'Score.cpr'), 'c');
  write(path.join(cub, 'Score.bak'), 'c');
  const logic = path.join(drive, 'Logic');
  write(path.join(logic, 'Ballad.logicx', 'Alternatives', '000', 'ProjectData'), 'l');
  write(path.join(logic, 'Ballad.logicx', 'Alternatives', '001', 'ProjectData'), 'l');
  write(path.join(logic, 'Incomplete.logicx', 'Resources', 'x'), 'l');
  write(path.join(logic, 'Ballad.mp3'), 'w'); // loose render beside the package

  /* Walk rules */
  write(path.join(drive, '.hidden', 'Secret.als'), als(1));
  write(path.join(drive, 'Skip Me', 'Skipped.als'), als(1)); // in the ignore list
  write(path.join(drive, 'Shortcut.als.lnk'), 'lnk');
  write(path.join(drive, 'Deep', 'a', 'b', 'c', 'd', 'Deep song.als'), als(77));
  write(path.join(drive, 'Loose render ancestor.wav'), 'w');
  try {
    fs.symlinkSync(path.join(drive, 'Deep'), path.join(drive, 'Link to deep'), 'dir');
  } catch {
    /* symlinks may be unavailable on Windows without privileges */
  }

  return { drive, missing: path.join(root, 'Unplugged drive'), ignore: ['Skip Me'] };
}

module.exports = { build };
