'use strict';

export type ReverbSettings = {
  decay: number;
  size: number;
  preDelay: number;
  lowCut: number;
  highCut: number;
  mix: number;
};

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  decay: 2.2,
  size: 55,
  preDelay: 20,
  lowCut: 120,
  highCut: 12000,
  mix: 35
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeReverbSettings(
  candidate: Partial<ReverbSettings> = {}
): ReverbSettings {
  const merged = { ...DEFAULT_REVERB_SETTINGS, ...candidate };
  const lowCut = clamp(Number(merged.lowCut) || 20, 20, 2000);
  const highCut = clamp(Number(merged.highCut) || 20000, 1000, 20000);

  return {
    decay: clamp(Number(merged.decay) || DEFAULT_REVERB_SETTINGS.decay, 0.2, 12),
    size: clamp(Number(merged.size) || 0, 0, 100),
    preDelay: clamp(Number(merged.preDelay) || 0, 0, 250),
    lowCut: Math.min(lowCut, highCut - 100),
    highCut: Math.max(highCut, lowCut + 100),
    mix: clamp(Number(merged.mix) || 0, 0, 100)
  };
}

export function equalPowerReverbGains(mixPercent: number) {
  const mix = clamp(mixPercent, 0, 100) / 100;
  return {
    dry: Math.cos(mix * Math.PI * 0.5),
    wet: Math.sin(mix * Math.PI * 0.5)
  };
}

export function formatReverbFrequency(frequency: number) {
  if (frequency >= 1000) {
    const digits = frequency >= 10000 ? 0 : 1;
    return `${(frequency / 1000).toFixed(digits)} kHz`;
  }
  return `${Math.round(frequency)} Hz`;
}
