'use strict';

/**
 * Writes dist/renderer/THIRD_PARTY_NOTICES.txt for the open-source code that
 * esbuild bundles into the renderer (currently the Audio → MIDI worker:
 * Spotify's Basic Pitch, TensorFlow.js and their dependencies).
 *
 * Apache-2.0 and MIT both require their licence text to ship with the app.
 * Versions and texts are read from node_modules at build time so the file
 * always matches what was bundled. Run after the bundles are built, as part
 * of `npm run build`.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'renderer', 'THIRD_PARTY_NOTICES.txt');

const PACKAGES = [
  '@spotify/basic-pitch',
  '@tensorflow/tfjs',
  '@tensorflow/tfjs-core',
  '@tensorflow/tfjs-backend-cpu',
  '@tensorflow/tfjs-backend-webgl',
  '@tensorflow/tfjs-converter',
  '@tensorflow/tfjs-data',
  '@tensorflow/tfjs-layers',
  '@tonejs/midi',
  'midi-file',
  'array-flatten',
  'long',
  'seedrandom'
];

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'NOTICE'];

function licenseText(dir) {
  for (const name of LICENSE_FILES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  }
  // Some MIT packages keep the licence at the end of their README.
  const readme = path.join(dir, 'README.md');
  if (fs.existsSync(readme)) {
    const text = fs.readFileSync(readme, 'utf8');
    const grant = text.indexOf('Permission is hereby granted');
    if (grant >= 0) {
      const copyright = text.lastIndexOf('Copyright', grant);
      const end = text.indexOf('SOFTWARE.', grant);
      if (copyright >= 0 && end > grant) return text.slice(copyright, end + 'SOFTWARE.'.length).trim();
    }
  }
  return null;
}

const sections = [];
let apacheText = null;

for (const name of PACKAGES) {
  const dir = path.join(root, 'node_modules', name);
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) {
    console.error(`[notices] ${name} is not installed — run npm install`);
    process.exitCode = 1;
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
  const text = licenseText(dir);
  if (text && /Apache License/.test(text) && !apacheText) apacheText = text;

  const lines = [`${pkg.name} ${pkg.version}`, `License: ${pkg.license || 'see below'}`];
  if (pkg.homepage || repo) lines.push(`Source: ${pkg.homepage || repo}`);
  lines.push('');
  if (text && !/Apache License/.test(text)) lines.push(text);
  else lines.push('Licensed under the Apache License, Version 2.0 — full text at the end of this file.');
  sections.push(lines.join('\n'));
}

const header = [
  'DAW Buddy — third-party notices',
  '',
  'The Audio → MIDI tool uses Basic Pitch by Spotify (https://github.com/spotify/basic-pitch)',
  'running on TensorFlow.js. These components are bundled into the app under',
  'the licences below.',
  ''
].join('\n');

const rule = '\n\n' + '-'.repeat(78) + '\n\n';
let body = header + rule + sections.join(rule);
if (apacheText) body += rule + apacheText + '\n';

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`[notices] wrote ${path.relative(root, out)} (${PACKAGES.length} packages)`);
