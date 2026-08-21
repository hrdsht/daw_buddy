'use strict';

/**
 * Is a DAW already running?
 *
 * Opening a second session while one is loaded is at best a long wait and at
 * worst a stalled machine mid-mix. Three accidental clicks is three too many,
 * so the Open button asks first whenever a DAW is up.
 *
 * There's no cross-platform API for this, so we shell out to the tool each OS
 * already has: tasklist on Windows, ps on macOS and Linux.
 *
 * The patterns are anchored to the START of the process name rather than
 * searched for anywhere in the output. The first version used a loose
 * /reaper/i and matched "oom_reaper", a Linux kernel thread — which would
 * have meant a false "a DAW is running" warning every single time.
 */

const { exec } = require('child_process');
const path = require('path');

const DAWS = [
  { match: /^ableton live/i, name: 'Ableton Live' },
  { match: /^live$/i, name: 'Ableton Live' },
  { match: /^fl(64|32)?$/i, name: 'FL Studio' },
  { match: /^fl studio/i, name: 'FL Studio' },
  { match: /^reaper$/i, name: 'REAPER' },
  { match: /^cubase/i, name: 'Cubase' },
  { match: /^nuendo/i, name: 'Nuendo' },
  { match: /^studio ?one/i, name: 'Fender Studio Pro' },
  { match: /^fender ?studio/i, name: 'Fender Studio Pro' },
  { match: /^studioapp/i, name: 'Studio One' },
  { match: /^logic ?pro/i, name: 'Logic Pro' },
  { match: /^pro ?tools/i, name: 'Pro Tools' },
  { match: /^bitwig/i, name: 'Bitwig Studio' },
  { match: /^ardour/i, name: 'Ardour' },
  { match: /^lmms$/i, name: 'LMMS' },
  { match: /^renoise/i, name: 'Renoise' },
  { match: /^waveform/i, name: 'Waveform' },
  { match: /^tracktion/i, name: 'Tracktion' },
  { match: /^mixbus/i, name: 'Harrison Mixbus' },
  { match: /^audacity$/i, name: 'Audacity' }
];

// Cache briefly: clicking down a list shouldn't spawn a process listing per
// click, but the answer does need to stay current.
let cache = { at: 0, running: [] };
const CACHE_MS = 4000;

function listProcesses() {
  return new Promise((resolve) => {
    const command =
      process.platform === 'win32'
        ? 'tasklist /fo csv /nh'
        : 'ps -Ao comm= 2>/dev/null || ps -eo comm 2>/dev/null || ps ax -o comm= 2>/dev/null';

    exec(command, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err || !stdout ? '' : stdout);
    });
  });
}

/**
 * One process name per line. Windows gives CSV — "chrome.exe","1234",... —
 * so the first quoted field is taken. Unix gives a path or bare name.
 */
function processNames(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;

      const csv = trimmed.match(/^"([^"]+)"/);
      const raw = csv ? csv[1] : trimmed;

      // Strip any directory part and the .exe, so "FL64.exe" and
      // "/Applications/Logic Pro.app/.../Logic Pro" both reduce sensibly.
      return path.basename(raw).replace(/\.exe$/i, '');
    })
    .filter(Boolean);
}

async function runningDaws() {
  if (Date.now() - cache.at < CACHE_MS) return cache.running;

  const names = processNames(await listProcesses());
  const running = [];

  for (const name of names) {
    for (const daw of DAWS) {
      if (daw.match.test(name) && !running.includes(daw.name)) {
        running.push(daw.name);
      }
    }
  }

  cache = { at: Date.now(), running };
  return running;
}

/** Forget the cached answer — used right after the user opens something. */
function forget() {
  cache = { at: 0, running: [] };
}

module.exports = { runningDaws, forget, processNames, DAWS };
