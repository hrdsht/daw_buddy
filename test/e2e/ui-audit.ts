import { _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

async function runUiAudit() {
  console.log('--- Starting DAW Buddy UI Visual Audit ---');
  const outDir = path.resolve(__dirname, '../../test-results/ui-audit');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../../'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  const auditResults: any[] = [];

  async function auditView(viewName: string, screenshotFilename: string) {
    const screenshotPath = path.join(outDir, screenshotFilename);
    await window.screenshot({ path: screenshotPath });

    const metrics = await window.evaluate(() => {
      const issues: { type: string; selector: string; detail: string; severity: 'high' | 'medium' | 'low' }[] = [];

      // 1. Contrast & Readability Audit
      const textElements = Array.from(document.querySelectorAll('p, span, button, th, td, h1, h2, h3, .chip, label, input'));
      let auditedTextCount = 0;

      textElements.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        auditedTextCount++;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Check font size
        const fontSize = parseFloat(style.fontSize);
        if (fontSize < 10 && el.innerText.trim().length > 0) {
          issues.push({
            type: 'Typography',
            selector: el.className || el.tagName,
            detail: `Font size (${fontSize}px) is below 10px threshold.`,
            severity: 'medium'
          });
        }
      });

      // 2. Click Target Size Audit (Fitts's Law for Desktop audio controls)
      const interactiveElements = Array.from(document.querySelectorAll('button, .btn, .chip, input[type="range"], select'));
      let auditedInteractiveCount = 0;

      interactiveElements.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        auditedInteractiveCount++;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (rect.width < 18 || rect.height < 18) {
            issues.push({
              type: 'Touch/Click Target',
              selector: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').join('.') : ''}`,
              detail: `Interactive target is small (${Math.round(rect.width)}x${Math.round(rect.height)}px). Minimum recommended is 20x20px.`,
              severity: 'low'
            });
          }
        }
      });

      // 3. Overflow & Visual Clipping Detection
      const containers = Array.from(document.querySelectorAll('.table-wrap, .panel, .modal__body, .main-layout, #notesDrawer'));
      containers.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (el.scrollWidth > el.clientWidth + 2 && window.getComputedStyle(el).overflowX === 'hidden') {
          issues.push({
            type: 'Layout Overflow',
            selector: el.className || el.id,
            detail: `Content is clipped horizontally (scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px).`,
            severity: 'high'
          });
        }
      });

      return {
        auditedTextCount,
        auditedInteractiveCount,
        issuesCount: issues.length,
        issues
      };
    });

    auditResults.push({
      view: viewName,
      screenshot: screenshotFilename,
      ...metrics
    });
    console.log(`Audited [${viewName}]: ${metrics.issuesCount} issues flagged across ${metrics.auditedTextCount} text nodes and ${metrics.auditedInteractiveCount} controls.`);
  }

  // 1. Audit Main Project Library
  await auditView('Main Project Library Table', '01-main-library.png');

  // 2. Audit Clipper DSP Panel
  const clipBtn = window.locator('#clipBtn');
  if (await clipBtn.isVisible()) {
    await clipBtn.click({ button: 'right' });
    await window.waitForTimeout(300);
    await auditView('Clipper DSP Floating Panel', '02-clipper-dsp-panel.png');
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  }

  // 3. Audit Reverb DSP Panel
  const verbBtn = window.locator('#verbBtn');
  if (await verbBtn.isVisible()) {
    await verbBtn.click({ button: 'right' });
    await window.waitForTimeout(300);
    await auditView('Reverb DSP Floating Panel', '03-reverb-dsp-panel.png');
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  }

  // 4. Audit Standalone Tools / Audio Converter
  const toolsTab = window.locator('.tab[data-tab="tools"]');
  if (await toolsTab.isVisible()) {
    await toolsTab.click();
    await window.waitForTimeout(300);
    const converterCard = window.locator('.tool-card[data-tool="convert"]');
    if (await converterCard.isVisible()) {
      await converterCard.click();
      await window.waitForTimeout(300);
      await auditView('Standalone Audio Converter & Splitter', '04-converter-tool.png');
    }
  }

  // 5. Audit Settings View
  const settingsTab = window.locator('.tab[data-tab="settings"]');
  if (await settingsTab.isVisible()) {
    await settingsTab.click();
    await window.waitForTimeout(300);
    await auditView('Settings & Audio Preferences', '05-settings-view.png');
  }

  await app.close();

  const reportPath = path.join(outDir, 'UI_AUDIT_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditResults, null, 2), 'utf-8');
  console.log(`UI Audit complete! Report written to: ${reportPath}`);
}

runUiAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
