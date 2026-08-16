'use strict';

/**
 * tsc/esbuild emit only JavaScript. The renderer's static assets — the HTML,
 * CSS, and the splash logo/video — have to be copied into dist/renderer/ by
 * hand, or the built app loads a blank window. Run after the bundles are built,
 * as part of `npm run build`.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'src', 'renderer');
const to = path.join(root, 'dist', 'renderer');

// Individual files (app.js and splash.js are produced by esbuild, not copied).
const files = ['index.html', 'styles.css', 'splash.html', 'splash.css'];

// Directories copied whole (recursively).
const dirs = ['assets'];

fs.mkdirSync(to, { recursive: true });

for (const name of files) {
  const src = path.join(from, name);
  if (!fs.existsSync(src)) {
    console.error(`[copy-assets] missing ${path.relative(root, src)}`);
    process.exitCode = 1;
    continue;
  }
  fs.copyFileSync(src, path.join(to, name));
}

for (const name of dirs) {
  const src = path.join(from, name);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(to, name), { recursive: true });
}

console.log(
  `[copy-assets] copied ${files.length} file(s) + ${dirs.length} dir(s) into dist/renderer/`
);
