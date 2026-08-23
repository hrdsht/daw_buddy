'use strict';

/**
 * Open-Source DSP Clipper Models and Waveshaping Transfer Functions.
 *
 * Inspired by open-source DSP clipper algorithms (ChowDSP Clipper, Airwindows,
 * FreeClip by Venn Audio, OJD SoftClipper, and analog diode saturation circuits).
 */

export type ClipperCurve = 'hard' | 'tanh' | 'cubic' | 'atan' | 'quintic';

export interface ClipperSettings {
  curve: ClipperCurve;
  gainDb: number;      // Input Drive in dB (0.0 to 18.0 dB)
  ceilingDb: number;   // Output Ceiling in dB (-6.0 to 0.0 dB)
}

export const DEFAULT_CLIPPER_SETTINGS: ClipperSettings = {
  curve: 'tanh',
  gainDb: 4.0,
  ceilingDb: 0.0
};

export function normalizeClipperSettings(raw: any): ClipperSettings {
  const curve: ClipperCurve = ['hard', 'tanh', 'cubic', 'atan', 'quintic'].includes(raw?.curve)
    ? raw.curve
    : 'tanh';
  const gainDb = typeof raw?.gainDb === 'number' && !isNaN(raw.gainDb)
    ? Math.max(0, Math.min(18, raw.gainDb))
    : 4.0;
  const ceilingDb = typeof raw?.ceilingDb === 'number' && !isNaN(raw.ceilingDb)
    ? Math.max(-6, Math.min(0, raw.ceilingDb))
    : 0.0;
  return { curve, gainDb, ceilingDb };
}

/**
 * Generates an 8192-point Float32Array transfer curve table for Web Audio WaveShaperNode.
 * 
 * Maps x in [-1.0, 1.0] -> y = f(x * Drive) * Ceiling.
 */
export function makeClipCurve(
  curve: ClipperCurve = 'tanh',
  gainDb: number = 4.0,
  ceilingDb: number = 0.0,
  samples: number = 8192
): Float32Array {
  const table = new Float32Array(samples);
  const G = Math.pow(10, gainDb / 20);      // Drive linear gain multiplier (1.0x to 7.94x)
  const C = Math.pow(10, ceilingDb / 20);   // Ceiling output trim (0.501 to 1.0)

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1; // [-1.0, +1.0]
    const u = x * G;
    let y = 0;

    switch (curve) {
      case 'hard':
        // Hard Brickwall Limiter (Instant transient clamp)
        y = Math.max(-1, Math.min(1, u));
        break;

      case 'tanh':
        // Soft Analog Tape / Tube Saturation (Tanh)
        y = G > 0.001 ? Math.tanh(u) / Math.tanh(G) : Math.tanh(u);
        break;

      case 'cubic': {
        // 3rd-Order Polynomial Soft Knee (Analog console overdrive)
        const uc = Math.max(-1.5, Math.min(1.5, u));
        y = Math.max(-1, Math.min(1, uc - (uc * uc * uc) / 6.75));
        break;
      }

      case 'atan':
        // Germanium Diode Soft Knee (Arctangent transition)
        y = G > 0.001 ? Math.atan(u) / Math.atan(G) : Math.atan(u);
        break;

      case 'quintic': {
        // Modern EDM Punchy Clipper (Algebraic quintic soft-knee)
        const norm = G / Math.pow(1 + Math.pow(G, 4), 0.25);
        const out = u / Math.pow(1 + Math.pow(Math.abs(u), 4), 0.25);
        y = norm > 0.0001 ? out / norm : out;
        y = Math.max(-1, Math.min(1, y));
        break;
      }

      default:
        y = Math.max(-1, Math.min(1, u));
        break;
    }

    table[i] = y * C;
  }

  return table;
}
