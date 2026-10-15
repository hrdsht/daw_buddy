import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** A tiny valid 16-bit mono WAV (0.25 s of a sine) so the renamer has stems to list. */
function writeWav(file: string, freq: number) {
  const rate = 22050;
  const samples = Math.floor(rate * 0.25);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

test.describe('Text fields stay writeable', () => {
  let app: any;
  let window: any;
  let stems: string;

  test.beforeEach(async () => {
    stems = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-buddy-stems-'));
    writeWav(path.join(stems, 'Kick_01.wav'), 60);
    writeWav(path.join(stems, 'Bass_main.wav'), 110);
    writeWav(path.join(stems, 'Lead Vox.wav'), 440);

    app = await electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '../../'),
      env: { ...process.env, NODE_ENV: 'test' }
    });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#rescan').waitFor({ state: 'visible', timeout: 15000 });
    const onboarding = window.locator('#regionOnboardingOverlay .onboarding-header__close-btn');
    if (await onboarding.count()) await onboarding.click();
    // Answer the folder picker with the temp stems folder.
    await app.evaluate(({ dialog }: any, dir: string) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, stems);
  });

  test.afterEach(async () => {
    if (app) await app.close();
    fs.rmSync(stems, { recursive: true, force: true });
  });

  test('every Smart renamer category field accepts clicks and typing, row after row', async () => {
    await window.locator('button', { hasText: /^\s*Tools\s*$/ }).first().click();
    await window.locator('.tool-card', { hasText: 'Renamer' }).click();
    await window.locator('.renamer-mode-btn', { hasText: 'Smart renamer' }).click();
    await window.locator('#view button', { hasText: /Choose (a different )?folder/ }).first().click();

    const field = (name: string) => window.locator(`[data-focus-key="smart-row:${path.join(stems, name)}"]`);
    await expect(field('Kick_01.wav')).toBeVisible({ timeout: 10000 });

    // Mouse only, no Enter between rows — the sequence that used to leave the
    // next field covered by the previous row's suggestion menu.
    for (const [name, word] of [['Kick_01.wav', 'drums'], ['Bass_main.wav', 'bass'], ['Lead Vox.wav', 'vocals']]) {
      await field(name).click({ timeout: 3000 });
      await window.keyboard.press('Control+A');
      await window.keyboard.type(word);
      await expect(field(name)).toBeFocused();
      await expect(field(name)).toHaveValue(word);
    }
    await window.locator('#view h3').first().click();

    await expect(field('Kick_01.wav')).toHaveValue(/^drums/);
    await expect(field('Bass_main.wav')).toHaveValue(/^bass/);
    await expect(field('Lead Vox.wav')).toHaveValue(/^vocals/);
  });

  test('a field focused before a list re-render keeps focus and its unsaved text', async () => {
    await window.locator('button', { hasText: /^\s*Tools\s*$/ }).first().click();
    await window.locator('.tool-card', { hasText: 'Renamer' }).click();
    await window.locator('.renamer-mode-btn', { hasText: 'Smart renamer' }).click();
    await window.locator('#view button', { hasText: /Choose (a different )?folder/ }).first().click();
    const kick = window.locator(`[data-focus-key="smart-row:${path.join(stems, 'Kick_01.wav')}"]`);
    const bass = window.locator(`[data-focus-key="smart-row:${path.join(stems, 'Bass_main.wav')}"]`);
    await expect(kick).toBeVisible({ timeout: 10000 });

    // Type in Kick, click Bass and start typing straight away. Saving Kick
    // re-renders every row; Bass must keep focus and what was typed.
    await kick.click();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('drums');
    await bass.click();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('ba');
    await window.waitForTimeout(400); // past the save-on-blur delay
    await window.keyboard.type('ss');
    await expect(bass).toBeFocused();
    await expect(bass).toHaveValue('bass');
  });
});
