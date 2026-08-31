'use strict';

/**
 * Audio Job Service Message Protocol (Proposal 0005)
 * 
 * Typed message protocol for bounded offline audio decoding, DSP operations,
 * waveform extraction, and format conversions running in an isolated worker.
 */

export type AudioJobType =
  | 'ANALYZE_WAVEFORM'
  | 'DETECT_TEMPO_KEY'
  | 'TRIM_SILENCE'
  | 'CONVERT_AUDIO'
  | 'FINISH_AUDIO'
  | 'VOCAL_SPLIT'
  | 'CANCEL_JOB';

export interface AnalyzeWaveformPayload {
  filePath: string;
  points?: number;
}

export interface DetectTempoKeyPayload {
  filePath: string;
  detectTuning?: boolean;
}

export interface TrimSilencePayload {
  inputPath: string;
  outputPath: string;
  thresholdDb?: number;
  sourceRoot?: string;
  detection?: string;
  where?: string;
  headMs?: number;
  tailMs?: number;
  [key: string]: any;
}

export interface ConvertAudioPayload {
  inputPath: string;
  outputPath: string;
  targetFormat: 'wav' | 'mp3' | 'flac' | 'aac' | 'aiff';
  bitrate?: number;
  sampleRate?: number;
  splitSilence?: boolean;
  [key: string]: any;
}

export interface FinishAudioPayload {
  inputPath: string;
  outputPath: string;
  sourceRoot?: string;
  normalize?: boolean;
  trimToBars?: boolean;
  targetPeakDb?: number;
  bpm?: number;
  bars?: number;
  beatsPerBar?: number;
  targetLufs?: number;
  peakLimit?: number;
  [key: string]: any;
}

export interface VocalSplitPayload {
  inputPath: string;
  options?: any;
}

export interface AudioJobRequest<T = any> {
  jobId: string;
  type: AudioJobType;
  generationId: number;
  priority?: number; // 0 = highest, 10 = lowest (default 5)
  payload: T;
}

export type AudioJobEventType =
  | 'JOB_STARTED'
  | 'JOB_PROGRESS'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'JOB_CANCELLED';

export interface AudioJobProgressPayload {
  percent: number;
  phase: string;
  processedBytes?: number;
  totalBytes?: number;
}

export interface AudioJobEvent<T = any> {
  jobId: string;
  type: AudioJobEventType;
  generationId: number;
  payload?: T;
  error?: string;
}
