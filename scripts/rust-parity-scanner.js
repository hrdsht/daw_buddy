'use strict';

/**
 * Rust ⇄ TypeScript parity for the project scanner (proposal 0007, slice 2).
 *
 * Builds the fixture drive (test/fixtures/scanner-fixture.js), scans it with
 * the TypeScript scanner (scanRoots / scanFolder + groupVersions) and with the
 * Rust `catalogue` crate, and requires the same entries, grouped rows, errors
 * and flags — with links followed and not, and for a single-folder browse.
 *
 * The only tolerated difference is the wording of OS error messages that are
 * passed through verbatim (Node's "ENOENT: …" vs Rust's "No such file…").
 *
 * Run: npx tsx scripts/rust-parity-scanner.js
 */

const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanRoots, scanFolder } = require('../src/main/lib/scanner');
const { groupVersions } = require('../src/main/lib/versions');
const { build } = require('../test/fixtures/scanner-fixture');

const root = path.resolve(__dirname, '..');
execFileSync('cargo', ['build', '-q', '--release', '-p', 'catalogue', '--example', 'scan'], { cwd: root, stdio: 'inherit' });
const bin = path.join(root, 'target', 'release', 'examples', process.platform === 'win32' ? 'scan.exe' : 'scan');

const rust = (opts, ...args) => JSON.parse(execFileSync(bin, [JSON.stringify(opts), ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }));

/** Pass-through OS error text differs by runtime; everything else must match. */
function normalise(value) {
  return JSON.parse(
    JSON.stringify(value).replace(/(Could not read [a-z]+: )[^"]*/g, '$1<os error>')
  );
}

function compare(label, ts, rs) {
  const a = normalise(ts);
  const b = normalise(rs);
  assert.equal(b.entries.length, a.entries.length, `${label}: entry count`);
  a.entries.forEach((entry, i) => assert.deepEqual(b.entries[i], entry, `${label}: entry ${i} (${entry.name})`));
  assert.deepEqual(b.grouped, a.grouped, `${label}: grouped rows`);
  assert.deepEqual(b.errors, a.errors, `${label}: errors`);
  assert.equal(b.truncated, a.truncated, `${label}: truncated`);
  if ('foldersRead' in a) assert.equal(b.foldersRead, a.foldersRead, `${label}: foldersRead`);
  console.log(`  ✓ ${label}: ${a.entries.length} sessions, ${a.grouped.length} rows, ${a.errors.length} error(s)`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-scan-parity-'));
  const fx = build(dir);
  try {
    for (const followLinks of [false, true]) {
      const opts = { ignore: fx.ignore, followLinks };
      const ts = await scanRoots([fx.drive, fx.missing], opts);
      ts.grouped = groupVersions(ts.entries);
      compare(`scanRoots (followLinks=${followLinks})`, ts, rust(opts, fx.drive, fx.missing));
    }

    const folder = path.join(fx.drive, 'Clients');
    const ts = await scanFolder(folder, fx.drive, { ignore: fx.ignore });
    ts.grouped = groupVersions(ts.entries);
    compare('scanFolder (browse)', ts, rust({ ignore: fx.ignore }, '--folder', folder, fx.drive));

    // Sanity: the fixture really exercises what it claims to.
    const names = ts.entries.map((e) => e.name);
    assert.ok(names.length > 0);
    console.log('rust-parity-scanner: passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err.message.length > 4000 ? err.message.slice(0, 4000) + '…' : err.message);
  process.exit(1);
});
