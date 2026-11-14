'use strict';

/**
 * Imported first by audio-midi-worker.ts, before TensorFlow.js.
 *
 * tfjs 3.x's WebGL backend polls with `if (!window || …)`. In a worker
 * `window` is undeclared, so that line throws a ReferenceError inside a
 * timer instead of evaluating to false, and transcription never finishes.
 * Declaring the global as `undefined` makes the check behave as intended,
 * while tfjs's own `typeof window !== 'undefined'` tests still see no window.
 */
if (!('window' in self)) {
  (self as any).window = undefined;
}

export {};
