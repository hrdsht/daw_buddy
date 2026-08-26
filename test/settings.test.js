'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { Settings, DEFAULTS } = require('../src/main/lib/settings');

async function testSettingsDefaultsAndPersistence() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-settings-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    const s1 = new Settings(settingsPath);
    s1.load();

    const data1 = s1.get();
    assert.equal(data1.regionSetupComplete, false, 'Default regionSetupComplete should be false');
    assert.equal(data1.lastSeenVersion, null, 'Default lastSeenVersion should be null');
    assert.equal(data1.region, 'indian', 'Default region should be indian');
    assert.deepEqual(data1.scaleTraditions, ['all'], 'Default scaleTraditions should be all');

    // Simulate onboarding completion on version 0.5.1-beta.1
    s1.update({
      region: 'arabic',
      scaleTraditions: ['arabic', 'western'],
      regionSetupComplete: true,
      lastSeenVersion: '0.5.1-beta.1',
      outputFolder: path.join(dir, 'Output')
    });

    // Reload settings from disk in a fresh instance
    const s2 = new Settings(settingsPath);
    s2.load();
    const data2 = s2.get();

    assert.equal(data2.regionSetupComplete, true, 'regionSetupComplete should persist as true');
    assert.equal(data2.lastSeenVersion, '0.5.1-beta.1', 'lastSeenVersion should persist');
    assert.equal(data2.region, 'arabic', 'region should persist');
    assert.deepEqual(data2.scaleTraditions, ['arabic', 'western'], 'scaleTraditions should persist');
    assert.equal(data2.outputFolder, path.join(dir, 'Output'), 'outputFolder should persist');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testFreshInstallAndUpdateConditions() {
  const shouldShowOnboarding = (settings) => {
    const isSetupDone = Boolean(
      settings && (settings.regionSetupComplete || (settings.roots && settings.roots.length > 0) || settings.outputFolder)
    );
    return !isSetupDone;
  };

  // Case 1: Fresh Install (no setup, no roots, no output folder)
  const freshSettings = { ...DEFAULTS, regionSetupComplete: false, lastSeenVersion: null, roots: [], outputFolder: null };
  assert.equal(shouldShowOnboarding(freshSettings), true, 'Fresh install must trigger setup');

  // Case 2: Configured on current version
  const completedSettings = {
    ...DEFAULTS,
    regionSetupComplete: true,
    lastSeenVersion: '0.5.1-beta.1'
  };
  assert.equal(
    shouldShowOnboarding(completedSettings),
    false,
    'Subsequent run on same version must NOT trigger setup'
  );

  // Case 3: App updated to newer version (e.g. 0.5.2) -> existing user must NOT be disrupted
  assert.equal(
    shouldShowOnboarding(completedSettings),
    false,
    'Updated app version must seamlessly open without intrusive setup wizard'
  );

  // Case 4: Existing user with configured roots
  const existingUserWithRoots = {
    ...DEFAULTS,
    regionSetupComplete: false,
    roots: ['/Users/music/Ableton Projects']
  };
  assert.equal(
    shouldShowOnboarding(existingUserWithRoots),
    false,
    'User with existing project roots must not be blocked by onboarding wizard'
  );
}

async function testUnavailableRootsSurviveStartup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-settings-roots-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    const unavailableRoot = path.join(dir, 'unplugged-external-drive');
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ roots: [unavailableRoot] }),
      'utf8'
    );

    const settings = new Settings(settingsPath);
    settings.load();
    assert.deepEqual(
      settings.get().roots,
      [unavailableRoot],
      'Startup must not probe or discard an unavailable project drive'
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await testSettingsDefaultsAndPersistence();
  console.log('ok - testSettingsDefaultsAndPersistence');
  await testFreshInstallAndUpdateConditions();
  console.log('ok - testFreshInstallAndUpdateConditions');
  await testUnavailableRootsSurviveStartup();
  console.log('ok - testUnavailableRootsSurviveStartup');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
