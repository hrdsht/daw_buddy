'use strict';

/**
 * Runs Spotify's Basic Pitch (Apache-2.0) away from the window thread.
 *
 * The model (~0.9 MB) is bundled into this worker by esbuild, so it loads
 * from memory — nothing is fetched and no audio leaves the machine.
 *
 * Messages in:
 *   { type: 'transcribe', id, samples }   mono Float32Array at 22.05 kHz
 *   { type: 'extract',    id, params }    re-pick notes from the last run
 * Messages out:
 *   { type: 'progress', id, percent }
 *   { type: 'notes',    id, notes, backend, modelMs }
 *   { type: 'error',    id, message }
 *
 * The raw model output is kept after a run, so changing sensitivity or note
 * length re-extracts notes in milliseconds without re-running the model.
 */

import './worker-globals'; // must stay first — see the file for why
import * as tf from '@tensorflow/tfjs';
import {
  BasicPitch,
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  noteFramesToTime
} from '@spotify/basic-pitch';
// @ts-ignore — bundled by esbuild (json loader)
import modelJson from '@spotify/basic-pitch/model/model.json';
// @ts-ignore — bundled by esbuild (binary loader → Uint8Array)
import modelWeights from '@spotify/basic-pitch/model/group1-shard1of1.bin';

export interface ExtractParams {
  onsetThreshold: number; // 0..1, lower = more notes
  frameThreshold: number; // 0..1, lower = longer notes
  minNoteFrames: number; // model frames (~11.6 ms each)
  minHz?: number | null;
  maxHz?: number | null;
  pitchBends: boolean;
}

let basicPitch: BasicPitch | null = null;
let backend = 'cpu';
let lastOutput: { frames: number[][]; onsets: number[][]; contours: number[][] } | null = null;

async function load(): Promise<BasicPitch> {
  if (basicPitch) return basicPitch;
  try {
    // WebGL works in a worker through OffscreenCanvas; fall back if the GPU
    // path isn't available (older drivers, headless machines).
    if (typeof (self as any).OffscreenCanvas !== 'undefined' && (await tf.setBackend('webgl'))) {
      backend = 'webgl';
    } else {
      throw new Error('no webgl');
    }
  } catch {
    await tf.setBackend('cpu');
    backend = 'cpu';
  }
  await tf.ready();
  const weights = modelWeights as Uint8Array;
  const model = tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: (modelJson as any).modelTopology,
      weightSpecs: (modelJson as any).weightsManifest[0].weights,
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
      format: (modelJson as any).format,
      generatedBy: (modelJson as any).generatedBy,
      convertedBy: (modelJson as any).convertedBy
    })
  );
  basicPitch = new BasicPitch(model);
  return basicPitch;
}

function positiveHz(hz: number | null | undefined): number | null {
  return hz && hz > 0 ? hz : null;
}

function extract(params: ExtractParams) {
  if (!lastOutput) return [];
  const { frames, onsets, contours } = lastOutput;
  let events = outputToNotesPoly(
    frames,
    onsets,
    params.onsetThreshold,
    params.frameThreshold,
    Math.max(1, Math.round(params.minNoteFrames)),
    true,
    positiveHz(params.maxHz),
    positiveHz(params.minHz),
    true
  );
  if (params.pitchBends) events = addPitchBendsToNoteEvents(contours, events);
  return noteFramesToTime(events).map((n: any) => ({
    pitchMidi: n.pitchMidi,
    startTimeSeconds: n.startTimeSeconds,
    durationSeconds: n.durationSeconds,
    amplitude: n.amplitude,
    pitchBends: params.pitchBends ? n.pitchBends : undefined
  }));
}

let currentId = 0;

/**
 * tfjs runs parts of inference inside timers; an exception there skips the
 * try/catch below and would leave the window waiting forever. Report it.
 */
function reportUncaught(error: unknown) {
  (self as any).postMessage({
    type: 'error',
    id: currentId,
    message: error instanceof Error ? error.message : String(error)
  });
}
self.addEventListener('error', (event: ErrorEvent) => reportUncaught(event.error || event.message));
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportUncaught(event.reason));

(self as any).onmessage = async (event: MessageEvent) => {
  const { type, id, samples, params } = event.data || {};
  currentId = id;
  try {
    if (type === 'transcribe') {
      const model = await load();
      const frames: number[][] = [];
      const onsets: number[][] = [];
      const contours: number[][] = [];
      const started = performance.now();
      await model.evaluateModel(
        samples as Float32Array,
        (f: number[][], o: number[][], c: number[][]) => {
          frames.push(...f);
          onsets.push(...o);
          contours.push(...c);
        },
        (percent: number) => (self as any).postMessage({ type: 'progress', id, percent })
      );
      lastOutput = { frames, onsets, contours };
      const modelMs = Math.round(performance.now() - started);
      (self as any).postMessage({ type: 'notes', id, notes: extract(params), backend, modelMs });
    } else if (type === 'extract') {
      (self as any).postMessage({ type: 'notes', id, notes: extract(params), backend, modelMs: 0 });
    }
  } catch (error) {
    (self as any).postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
