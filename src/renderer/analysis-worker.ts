import { DSP } from './dsp';

/**
 * Runs tempo and key detection away from the visible app window so a 60-second
 * analysis cannot interrupt playback, scrolling or button clicks.
 */
(self as any).onmessage = (event) => {
  const { id, samples, sampleRate } = event.data || {};
  try {
    const result = DSP.analyse(samples, sampleRate);
    (self as any).postMessage({ id, result });
  } catch (error) {
    (self as any).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
