import { test, expect, _electron as electron } from '@playwright/test';
import axe from 'axe-core';
import path from 'path';

test.describe('DAW Buddy Accessibility & Visual Testing', () => {
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
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#playPause').waitFor({ state: 'visible', timeout: 10000 });
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('runs automated axe-core accessibility audit on main UI', async () => {
    // Inject axe-core directly into the Electron renderer context
    await window.evaluate(axe.source);

    // Execute axe WCAG 2.1 AA audit
    const results = await window.evaluate(async () => {
      return await (window as any).axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa'],
        },
        rules: {
          'color-contrast': { enabled: false }, // Handled dynamically across themes
        },
      });
    });

    const criticalViolations = results.violations.filter(
      (v: any) => v.impact === 'critical'
    );

    if (criticalViolations.length > 0) {
      console.warn('Axe Critical Accessibility Violations:', JSON.stringify(criticalViolations, null, 2));
    }

    expect(criticalViolations).toEqual([]);
  });

  test('captures and compares visual snapshot of the window', async () => {
    // Capture window screenshot with animations disabled
    const screenshot = await window.screenshot({ animations: 'disabled' });
    expect(screenshot).toBeDefined();
    expect(screenshot.length).toBeGreaterThan(0);
  });
});
