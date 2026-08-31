'use strict';

/**
 * Audio Job Service (Proposal 0005)
 * 
 * Bounded worker for offline audio decoding, DSP transformations,
 * and format encoding with queue management, priority ordering, and cancellation.
 */

import {
  AudioJobEvent,
  AudioJobRequest,
  ConvertAudioPayload,
  FinishAudioPayload,
  TrimSilencePayload,
  VocalSplitPayload
} from '../shared/protocols/audio-protocol';

const convert = require('../main/lib/convert');
const { processFile: finishAudio } = require('../main/lib/finisher');
const { removeSilence } = require('../main/lib/silence');
const vocalSplit = require('../main/lib/vocalSplit');

interface QueuedJob {
  request: AudioJobRequest;
  onProgress?: (percent: number, phase: string) => void;
  resolve: (res: AudioJobEvent) => void;
  reject: (err: any) => void;
}

export class AudioJobService {
  private queue: QueuedJob[] = [];
  private activeJobsCount = 0;
  private maxConcurrency = 1; // Default 1 for disk safety
  private cancelledJobIds = new Set<string>();

  constructor(maxConcurrency = 1) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  public cancelJob(jobId: string) {
    this.cancelledJobIds.add(jobId);
    // Remove from pending queue if not started
    this.queue = this.queue.filter((q) => {
      if (q.request.jobId === jobId) {
        q.resolve({
          jobId,
          type: 'JOB_CANCELLED',
          generationId: q.request.generationId,
          payload: { reason: 'Job cancelled before execution' }
        });
        return false;
      }
      return true;
    });
  }

  public submitJob<T = any>(
    request: AudioJobRequest<T>,
    onProgress?: (percent: number, phase: string) => void
  ): Promise<AudioJobEvent> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        request,
        onProgress,
        resolve,
        reject
      });

      // Sort queue by priority (lower number = higher priority)
      this.queue.sort((a, b) => (a.request.priority ?? 5) - (b.request.priority ?? 5));

      this.processNext();
    });
  }

  private async processNext() {
    if (this.activeJobsCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    if (this.cancelledJobIds.has(job.request.jobId)) {
      this.cancelledJobIds.delete(job.request.jobId);
      job.resolve({
        jobId: job.request.jobId,
        type: 'JOB_CANCELLED',
        generationId: job.request.generationId
      });
      this.processNext();
      return;
    }

    this.activeJobsCount++;
    this.emitEvent({
      jobId: job.request.jobId,
      type: 'JOB_STARTED',
      generationId: job.request.generationId
    });

    try {
      const result = await this.executeJob(job.request, (percent, phase) => {
        if (job.onProgress) job.onProgress(percent, phase);
        this.emitEvent({
          jobId: job.request.jobId,
          type: 'JOB_PROGRESS',
          generationId: job.request.generationId,
          payload: { percent, phase }
        });
      });

      if (this.cancelledJobIds.has(job.request.jobId)) {
        this.cancelledJobIds.delete(job.request.jobId);
        job.resolve({
          jobId: job.request.jobId,
          type: 'JOB_CANCELLED',
          generationId: job.request.generationId
        });
      } else {
        const completedEvent: AudioJobEvent = {
          jobId: job.request.jobId,
          type: 'JOB_COMPLETED',
          generationId: job.request.generationId,
          payload: result
        };
        job.resolve(completedEvent);
        this.emitEvent(completedEvent);
      }
    } catch (err: any) {
      const failEvent: AudioJobEvent = {
        jobId: job.request.jobId,
        type: 'JOB_FAILED',
        generationId: job.request.generationId,
        error: err.message || String(err)
      };
      job.resolve(failEvent);
      this.emitEvent(failEvent);
    } finally {
      this.activeJobsCount--;
      this.processNext();
    }
  }

  private async executeJob(
    req: AudioJobRequest,
    progress: (percent: number, phase: string) => void
  ): Promise<any> {
    switch (req.type) {
      case 'CONVERT_AUDIO': {
        const p = req.payload as ConvertAudioPayload;
        progress(10, 'Initializing audio convert');
        const res = await convert.renderJob(
          [p.inputPath],
          p.outputPath,
          {
            format: p.targetFormat || 'wav',
            bitrate: p.bitrate,
            sampleRate: p.sampleRate,
            splitSilence: p.splitSilence,
            enableSplit: p.enableSplit ?? false,
            ...p
          },
          (done: number, total: number) => {
            const pct = Math.round((done / Math.max(1, total)) * 100);
            progress(pct, 'Encoding audio');
          }
        );
        if (!res.ok) {
          throw new Error(res.message || 'Audio conversion failed');
        }
        progress(100, 'Conversion complete');
        return res;
      }

      case 'TRIM_SILENCE': {
        const p = req.payload as TrimSilencePayload;
        progress(20, 'Analyzing audio waveform for silence');
        const res = await removeSilence(p.inputPath, p.outputPath, {
          thresholdDb: p.thresholdDb || -72,
          sourceRoot: p.sourceRoot,
          detection: p.detection,
          where: p.where,
          headMs: p.headMs,
          tailMs: p.tailMs,
          ...p
        });
        progress(100, 'Trim complete');
        return res;
      }

      case 'FINISH_AUDIO': {
        const p = req.payload as FinishAudioPayload;
        progress(25, 'Calculating peak normalization & loudness');
        const res = await finishAudio(p.inputPath, p.outputPath, {
          normalize: p.normalize,
          trimToBars: p.trimToBars,
          targetPeakDb: p.targetPeakDb,
          bpm: p.bpm,
          bars: p.bars,
          beatsPerBar: p.beatsPerBar,
          sourceRoot: p.sourceRoot,
          targetLufs: p.targetLufs || -14,
          peakLimit: p.peakLimit || -0.3,
          ...p
        });
        progress(100, 'Audio finishing complete');
        return res;
      }

      case 'VOCAL_SPLIT': {
        const p = req.payload as VocalSplitPayload;
        progress(20, 'Analyzing vocal transients & pauses');
        const res = await vocalSplit.splitVocal(p.inputPath, p.options);
        progress(100, 'Vocal split complete');
        return res;
      }

      default:
        throw new Error(`Unsupported audio job type: ${req.type}`);
    }
  }

  private emitEvent(event: AudioJobEvent) {
    if (typeof process !== 'undefined') {
      const parentPort = (process as any).parentPort;
      if (parentPort && typeof parentPort.postMessage === 'function') {
        parentPort.postMessage(event);
      } else if (typeof process.send === 'function') {
        process.send(event);
      }
    }
  }
}
