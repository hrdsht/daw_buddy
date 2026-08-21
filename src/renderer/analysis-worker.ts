import { DSP } from './dsp';

/**
 * Runs tempo/key detection AND scale-modulation scanning away from the
 * visible app window so long analysis cannot interrupt playback or UI.
 *
 * Supported message types:
 *   { type: 'analyse',                id, samples, sampleRate }
 *   { type: 'detectScaleModulations', id, samples, sampleRate }
 * (omitting `type` defaults to 'analyse' for backwards-compat)
 */
(self as any).onmessage = (event) => {
  const { id, type, samples, sampleRate } = event.data || {};
  try {
    let result: any;
    if (type === 'detectScaleModulations') {
      result = DSP.detectScaleModulations(samples, sampleRate);
    } else {
      result = DSP.analyse(samples, sampleRate);
    }
    (self as any).postMessage({ id, result });
  } catch (error) {
    (self as any).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
