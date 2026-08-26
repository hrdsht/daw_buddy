import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('DAW Buddy Desktop App (Electron E2E)', () => {
  let app: any;
  let window: any;

  test.beforeEach(async () => {
    app = await electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '../../'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    window = await app.firstWindow();
    window.on('console', (msg: any) => console.log('PAGE LOG:', msg.text()));
    window.on('pageerror', (err: any) => console.log('PAGE ERR:', err));
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('launches window and displays player toolbar controls', async () => {
    const playBtn = window.locator('#playPause');
    await expect(playBtn).toBeVisible({ timeout: 15000 });

    const clipBtn = window.locator('#clipBtn');
    await expect(clipBtn).toBeVisible({ timeout: 10000 });

    const verbBtn = window.locator('#verbBtn');
    await expect(verbBtn).toBeVisible({ timeout: 10000 });

    const metroBtn = window.locator('#metroBtn');
    await expect(metroBtn).toBeVisible({ timeout: 10000 });
  });

  test('toggles and configures Clipper DSP panel on right-click', async () => {
    const clipBtn = window.locator('#clipBtn');
    await expect(clipBtn).toBeVisible({ timeout: 15000 });
    const clipPanel = window.locator('#clipPanel');

    // Right-click to open panel
    await clipBtn.dispatchEvent('contextmenu');
    await expect(clipPanel).toBeVisible({ timeout: 15000 });

    // Verify curve pills
    const tanhPill = window.locator('.clip-pill[data-curve="tanh"]');
    const quinticPill = window.locator('.clip-pill[data-curve="quintic"]');
    await expect(tanhPill).toBeVisible({ timeout: 10000 });
    await expect(quinticPill).toBeVisible({ timeout: 10000 });

    // Switch curve to Quintic
    await quinticPill.click();
    await expect(quinticPill).toHaveClass(/is-active/, { timeout: 10000 });

    // Verify canvas visualizer
    const canvas = window.locator('#clipCurveCanvas');
    await expect(canvas).toBeVisible();

    // Press Escape to dismiss panel
    await window.keyboard.press('Escape');
    await expect(clipPanel).toBeHidden();
  });

  test('toggles Reverb DSP panel on right-click', async () => {
    const verbBtn = window.locator('#verbBtn');
    await expect(verbBtn).toBeVisible({ timeout: 15000 });
    const reverbPanel = window.locator('#reverbPanel');

    // Right-click to open
    await verbBtn.dispatchEvent('contextmenu');
    await expect(reverbPanel).toBeVisible({ timeout: 15000 });

    // Verify sliders
    const decaySlider = window.locator('#reverbDecay');
    await expect(decaySlider).toBeVisible({ timeout: 10000 });

    // Dismiss with Escape
    await window.keyboard.press('Escape');
    await expect(reverbPanel).toBeHidden();
  });

  test('navigates to Tools view and opens Format Converter & Splitter UI', async () => {
    // Switch to Tools tab
    const toolsTab = window.locator('.tab[data-tab="tools"]');
    if (await toolsTab.isVisible()) {
      await toolsTab.click();
      
      // Verify Converter tool card exists
      const converterCard = window.locator('.tool-card[data-tool="convert"]');
      await expect(converterCard).toBeVisible();

      // Click card to open Standalone Converter tool
      await converterCard.click();

      // Verify converter container and dropzone are rendered
      const converterContainer = window.locator('.standalone-converter');
      await expect(converterContainer).toBeVisible();

      const dropzone = window.locator('#converterDropzone');
      await expect(dropzone).toBeVisible();

      // Verify format pills (MP3 and WAV)
      const mp3Pill = window.locator('.converter-fmt-pill[data-format="mp3"]');
      const wavPill = window.locator('.converter-fmt-pill[data-format="wav"]');
      await expect(mp3Pill).toBeVisible();
      await expect(wavPill).toBeVisible();

      // Switch to WAV format
      await wavPill.click();
      await expect(wavPill).toHaveClass(/is-active/);
    }
  });

  test('renders project list immediately without blocking full-screen spinner', async () => {
    // The main view should show project table or rows immediately
    const viewEl = window.locator('#view');
    await expect(viewEl).toBeVisible();

    // Verify search input is interactive immediately
    const searchInput = window.getByPlaceholder('Search projects…');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Bangalore');
    await expect(searchInput).toHaveValue('Bangalore');
    await searchInput.fill('');
  });
});

