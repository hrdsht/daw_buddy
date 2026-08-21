import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePath, sanitizeText } from '../src/main/lib/crashlog.ts';

test('sanitizePath converts raw user paths to structural metrics', () => {
  const rawWindowsPath = 'C:\\Users\\JohnDoe\\Music\\MySecretAlbum2026\\HeavyDrop\\render.wav';
  const res = sanitizePath(rawWindowsPath);

  assert.equal(res.sanitized.includes('JohnDoe'), false);
  assert.equal(res.sanitized.includes('MySecretAlbum2026'), false);
  assert.equal(res.sanitized.includes('HeavyDrop'), false);
  assert.ok(res.info);
  assert.equal(res.info.extension, '.wav');
  assert.equal(res.info.depth, 7);
  assert.equal(res.info.exceedsMaxPath, false);
  assert.equal(res.info.charLength, rawWindowsPath.length);
});

test('sanitizePath detects paths exceeding MAX_PATH limit', () => {
  const longSegment = 'nestedFolder_'.repeat(25);
  const longPath = `D:\\Audio\\${longSegment}\\project.als`;
  const res = sanitizePath(longPath);

  assert.ok(res.info);
  assert.equal(res.info.exceedsMaxPath, true);
  assert.equal(res.info.extension, '.als');
  assert.ok(res.info.charLength > 260);
});

test('sanitizeText redacts paths and usernames in stack traces', () => {
  const mockStack = `Error: ENOENT: no such file or directory, open 'C:\\Users\\producer123\\Beats\\TopSecretTrack\\stem_vocals.wav'
    at readFile (C:\\Users\\producer123\\AppData\\Local\\Programs\\DAWBuddy\\resources\\app.asar\\dist\\main.js:120:15)
    at scanProject (C:\\Users\\producer123\\AppData\\Local\\Programs\\DAWBuddy\\resources\\app.asar\\dist\\scanner.js:45:9)`;

  const res = sanitizeText(mockStack);

  assert.equal(res.text.includes('producer123'), false);
  assert.equal(res.text.includes('TopSecretTrack'), false);
  assert.equal(res.text.includes('stem_vocals.wav'), false);
  assert.ok(res.text.includes('<app>/'));
  assert.ok(res.pathsFound.length > 0);
  assert.equal(res.pathsFound[0].extension, '.wav');
});
