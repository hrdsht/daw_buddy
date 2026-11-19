'use strict';

/**
 * Smoke test for the Tauri (Rust) build — proposal 0007.
 *
 * Boots the real app through tauri-driver (WebDriver), with a throwaway
 * config folder whose settings.json approves a fixture folder, then:
 *   1. checks the window booted and window.api is the Tauri bridge,
 *   2. runs the project converter through the bridge for every target and
 *      checks the files land,
 *   3. lists the fixture project through the Rust scanner and shows it in
 *      the project list, and checks an un-ported method fails loudly,
 *   4. opens Tools → Project converter and saves a screenshot.
 *
 * Needs: a debug build (cargo build -p daw-buddy), tauri-driver
 * (cargo install tauri-driver --locked), WebKitWebDriver on Linux, and a
 * display (xvfb-run on CI).
 *
 * Run: xvfb-run -a node scripts/tauri-smoke.js [screenshot.png]
 */

const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { rampWav, alsXml } = require('../test/fixtures/projectconvert-fixture');

const root = path.resolve(__dirname, '..');
const appBin = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'daw-buddy.exe' : 'daw-buddy');
const shotPath = process.argv[2] || null;
const PORT = 4444;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}

(async () => {
  assert.ok(fs.existsSync(appBin), `Build the app first: cargo build -p daw-buddy (${appBin})`);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-tauri-'));
  const config = path.join(home, '.config');
  const music = path.join(home, 'Music');
  const projectDir = path.join(music, 'Song Project');
  fs.mkdirSync(path.join(projectDir, 'Samples', 'Imported'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'Samples', 'Imported', 'ramp.wav'), rampWav(1000, 10));
  const als = path.join(projectDir, 'Song.als');
  fs.writeFileSync(als, zlib.gzipSync(Buffer.from(alsXml(), 'utf8')));
  fs.mkdirSync(path.join(config, 'daw-buddy'), { recursive: true });
  fs.writeFileSync(
    path.join(config, 'daw-buddy', 'settings.json'),
    JSON.stringify({ roots: [music], regionSetupComplete: true, lastSeenVersion: '999.0.0', outputFolder: path.join(home, 'Output') }, null, 2)
  );

  const driver = spawn('tauri-driver', ['--port', String(PORT)], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config, WEBKIT_DISABLE_COMPOSITING_MODE: '1' },
    stdio: 'inherit'
  });
  let session = null;
  try {
    for (let i = 0; i < 50; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/status`);
        break;
      } catch {
        await delay(200);
      }
    }
    session = (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: appBin } } } })).sessionId;
    const run = (script, args = []) => wd('POST', `/session/${session}/execute/async`, { script, args });

    // 1. booted, on the bridge
    await delay(3000);
    const boot = await run(`const done = arguments[arguments.length - 1];
      Promise.resolve(window.api.getSettings()).then((s) => done({ shell: s.shell, roots: s.roots, hasBridge: !!window.__TAURI__ }), (e) => done({ error: String(e) }));`);
    assert.equal(boot.shell, 'tauri', `settings came from Rust: ${JSON.stringify(boot)}`);
    assert.deepEqual(boot.roots, [music]);
    console.log('  ✓ booted on the Tauri bridge; settings read from Rust');

    // 2. converter, every target
    const results = await run(
      `const [file, done] = [arguments[0], arguments[arguments.length - 1]];
      (async () => {
        const summary = await window.api.projectConvertInspect(file);
        const out = {};
        for (const t of ['reaper', 'dawproject', 'universal']) out[t] = await window.api.projectConvertRun(file, t);
        return { summary, out };
      })().then(done, (e) => done({ error: String(e) }));`,
      [als]
    );
    assert.ok(!results.error, results.error);
    assert.equal(results.summary.tracks, 2);
    assert.equal(results.summary.automationLanes, 3);
    for (const [target, r] of Object.entries(results.out)) {
      assert.ok(fs.existsSync(r.outputPath), `${target}: ${r.outputPath}`);
      assert.ok(fs.existsSync(r.logPath), `${target}: log`);
    }
    assert.match(fs.readFileSync(results.out.reaper.outputPath, 'utf8'), /NAME "Lead Keys"/);
    assert.ok(fs.existsSync(path.join(results.out.universal.outputPath, 'Stems', '01 Drums & Perc.wav')));
    console.log('  ✓ project converter ran in Rust for all three targets');

    // 2b. the path guard holds
    const outside = await run(`const done = arguments[arguments.length - 1];
      window.api.projectConvertInspect('/etc/hostname').then(() => done('allowed'), (e) => done(String(e)));`);
    assert.match(outside, /outside your approved folders/);
    console.log('  ✓ files outside approved folders are refused');

    // 3. the project list comes from the Rust scanner
    const scan = await run(`const done = arguments[arguments.length - 1];
      window.api.scan().then((r) => done({ names: r.entries.map((e) => e.name), rows: r.grouped.length, bpm: r.entries[0] && r.entries[0].bpm, errors: r.errors }), (e) => done({ error: String(e) }));`);
    assert.ok(!scan.error, scan.error);
    assert.deepEqual(scan.names, ['Song'], JSON.stringify(scan));
    assert.equal(scan.bpm, 120);
    assert.deepEqual(scan.errors, []);
    console.log('  ✓ scan() lists projects from the Rust scanner');

    // 3b. un-ported methods fail loudly
    const notPorted = await run(`const done = arguments[arguments.length - 1];
      window.api.id3Inspect('/tmp').then(() => done('resolved'), (e) => done(String(e)));`);
    assert.match(notPorted, /isn't available in the Rust build yet/);
    console.log('  ✓ un-ported calls fail with a clear message');

    // 4. the converter screen
    // 3c. the project list renders the scanned project
    const listed = await run(`const done = arguments[arguments.length - 1];
      document.querySelectorAll('.onboarding-overlay, [class*=tour]').forEach((n) => n.remove());
      let tries = 0;
      (function poll() {
        const hit = [...document.querySelectorAll('*')].some((n) => n.children.length === 0 && n.textContent.trim() === 'Song');
        if (hit || ++tries > 40) done(hit); else setTimeout(poll, 250);
      })();`);
    assert.ok(listed, 'project "Song" appears in the list');
    if (shotPath) {
      const listPng = await wd('GET', `/session/${session}/screenshot`);
      fs.writeFileSync(shotPath.replace(/\.png$/, '-list.png'), Buffer.from(listPng, 'base64'));
    }
    console.log('  ✓ the project list shows it');

    if (shotPath) {
      await run(`const done = arguments[arguments.length - 1];
        document.querySelectorAll('.onboarding-overlay, [class*=tour]').forEach((n) => n.remove());
        const tools = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === 'Tools');
        tools.click();
        setTimeout(() => {
          const card = [...document.querySelectorAll('.tool-card')].find((c) => c.textContent.includes('Project converter'));
          card.click();
          setTimeout(done, 800);
        }, 600);`);
      const png = await wd('GET', `/session/${session}/screenshot`);
      fs.writeFileSync(shotPath, Buffer.from(png, 'base64'));
      console.log(`  ✓ screenshot: ${shotPath}`);
    }
    console.log('tauri-smoke: passed');
  } finally {
    if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
    driver.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
