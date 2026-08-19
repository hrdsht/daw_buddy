# Format converter — integration notes

Two new modules for `src/main/lib/`, plus a test file. Nothing else is
touched; no existing file is modified.

## Install

```
npm install lamejs --save
```

`ffmpeg-static` stays **optional**. If it's installed, or the user points at
an ffmpeg binary in settings, ffmpeg becomes the default automatically.

## What the modules do

**`encoders.ts`** — decides which encoder to use and how to reach it.
Looks for ffmpeg in three places: a configured path in settings, the
`ffmpeg-static` package, then the system PATH. Falls back to lamejs, and
**reports the fallback** rather than silently ignoring the user's choice.

**`convert.ts`** — the work. `planJob()` returns split points and exact size
estimates without writing anything; `renderJob()` writes the parts.

## The thing worth knowing before wiring the UI

**At higher settings, 50 MB binds long before 5 minutes does.** Measured:

| Format | 5 min is | Real part limit | Bound by |
|---|---|---|---|
| WAV 48k 24-bit stereo | 82.4 MB | **2:55** | size |
| WAV 44.1k 24-bit stereo | 75.7 MB | 3:11 | size |
| WAV 44.1k 16-bit stereo | 50.5 MB | 4:48 | size |
| WAV 44.1k 16-bit mono | 25.2 MB | 4:57 | time |
| WAV 48k 32-bit float | 109.9 MB | 2:11 | size |
| MP3 128–320 kbps | 4.6–11.4 MB | 4:57 | time |

`plan.limit.boundBy` is `'size'` or `'time'`. Worth surfacing, e.g.
*"splitting every 2:55 — 50 MB reached before 5:00 at this format"*.

## Suggested IPC

```js
ipcMain.handle('convert:plan', async (event, files, options) => {
  files.forEach((file) => guardApproved(file));
  return convert.planJob(files, options);
});

ipcMain.handle('convert:render', async (event, files, options) => {
  const outputRoot = await ensureOutputFolder();
  if (!outputRoot) throw new Error('No output folder — add a project folder in Settings first.');
  files.forEach((file) => guardApproved(file));

  return convert.renderJob(files, outputRoot, options, (done, total) => {
    mainWindow?.webContents.send('convert:progress', { done, total });
  });
});

ipcMain.handle('convert:encoders', async () => {
  const resolved = await encoders.resolve(settings.get());
  return { ...resolved, capabilities: encoders.capabilities(resolved) };
});
```

Output lands in `<outputRoot>/Converted/`, named `<source> pt 1.mp3`,
`pt 2` and so on. A job that fits in one part gets no suffix.

## Settings to add

```js
encoderPreference: 'auto',   // 'auto' | 'lame' | 'ffmpeg'
ffmpegPath: null,            // set when the user downloads or locates it
```

## UI notes

- Format defaults to **MP3**, bitrate slider defaults to **192**, steps
  128 / 160 / 192 / 224 / 256 / 320 (`convert.MP3_BITRATES`)
- WAV offers 44100 / 48000 (`WAV_RATES`) and 16 / 24 / 32 bit (`WAV_DEPTHS`)
- Show `plan.totalBytes` and the per-part sizes live as the slider moves —
  the estimate is exact arithmetic, tested within 2% of the written file
- Grey out sample rates other than the source unless
  `capabilities.resample` is true
- Show `resolved.fellBackReason` when present

## Deliberate limits, and why

**WAV input only** without ffmpeg. Reading MP3 needs a decoder.

**No sample-rate conversion** without ffmpeg — refused, not approximated.
Doing 44.1↔48 naively aliases audibly, and this material is training data for
voice cloning. `renderJob` returns `{ ok: false, message }` explaining what to
change.

**Mismatched sources are flagged.** Joining a 48k file onto a 44.1k one
without resampling shifts its pitch. `plan.warnings` carries `mixedRates` /
`mixedChannels`.

**Padding is generated, not preserved.** Every part is trimmed to the
threshold then given exactly `padSeconds` of digital silence at each end, so
parts are identical regardless of what the source looked like — and it still
works where a split lands mid-phrase. The pad is subtracted from the budget,
or a job would pass the preview and fail after padding.

**Float WAV is not clamped.** 32-bit float legitimately carries values above
±1; clamping would destroy headroom. Integer depths are clamped, as they must
be.

## Tests

`node --test test/convert.test.js` — 12 tests, all passing. Covers the size
limits at every offered format, splits landing in silence, continuous audio
falling back to a zero crossing, no part exceeding either limit, padding
present in the written file, estimate accuracy, and both refusal paths.
