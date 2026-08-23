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
    await expect(playBtn).toBeVisible();

    const clipBtn = window.locator('#clipBtn');
    await expect(clipBtn).toBeVisible();

    const verbBtn = window.locator('#verbBtn');
    await expect(verbBtn).toBeVisible();

    const metroBtn = window.locator('#metroBtn');
    await expect(metroBtn).toBeVisible();
  });

  test('toggles and configures Clipper DSP panel on right-click', async () => {
    const clipBtn = window.locator('#clipBtn');
    const clipPanel = window.locator('#clipPanel');

    // Initially hidden
    await expect(clipPanel).toBeHidden();

    // Right-click to open panel
    await clipBtn.click({ button: 'right' });
    await expect(clipPanel).toBeVisible();

    // Verify curve pills
    const tanhPill = window.locator('.clip-pill[data-curve="tanh"]');
    const quinticPill = window.locator('.clip-pill[data-curve="quintic"]');
    await expect(tanhPill).toBeVisible();
    await expect(quinticPill).toBeVisible();

    // Switch curve to Quintic
    await quinticPill.click();
    await expect(quinticPill).toHaveClass(/is-active/);

    // Verify canvas visualizer
    const canvas = window.locator('#clipCurveCanvas');
    await expect(canvas).toBeVisible();

    // Press Escape to dismiss panel
    await window.keyboard.press('Escape');
    await expect(clipPanel).toBeHidden();
  });

  test('toggles Reverb DSP panel on right-click', async () => {
    const verbBtn = window.locator('#verbBtn');
    const reverbPanel = window.locator('#reverbPanel');

    await expect(reverbPanel).toBeHidden();

    // Right-click to open
    await verbBtn.click({ button: 'right' });
    await expect(reverbPanel).toBeVisible();

    // Verify sliders
    const decaySlider = window.locator('#reverbDecay');
    await expect(decaySlider).toBeVisible();

    // Dismiss with Escape
    await window.keyboard.press('Escape');
    await expect(reverbPanel).toBeHidden();
  });
});
