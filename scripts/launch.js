'use strict';

/**
 * Daily launcher: rebuild only when source/assets are newer than dist.
 * A fresh clone still builds on its first launch; ordinary launches skip the
 * TypeScript/esbuild work and start Electron immediately.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const builtMain = path.join(root, 'dist', 'main', 'main.js');
const inputs = [
  path.join(root, 'src'),
  path.join(root, 'scripts', 'copy-assets.js'),
  path.join(root, 'tsconfig.json'),
  path.join(root, 'tsconfig.renderer.json'),
  path.join(root, 'package.json')
];

function newestMtime(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return Infinity;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const name of fs.readdirSync(target)) {
    newest = Math.max(newest, newestMtime(path.join(target, name)));
  }
  return newest;
}

function needsBuild() {
  if (!fs.existsSync(builtMain)) return true;
  const builtAt = fs.statSync(builtMain).mtimeMs;
  return inputs.some((input) => newestMtime(input) > builtAt);
}

function launch() {
  if (needsBuild()) {
    console.log('  Updating the app build (only needed after code changes)...');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }

  const electron = require('electron');
  const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code === null ? 1 : code));
  child.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

if (require.main === module) launch();

module.exports = { newestMtime, needsBuild, launch };
