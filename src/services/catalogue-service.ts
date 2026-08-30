'use strict';

/**
 * Catalogue Service (Proposal 0005)
 * 
 * Runs as an isolated utility process to own project-root scanning, DAW file parsing,
 * cache/index updates, and filesystem watching without blocking the Main Supervisor
 * or UI Renderer.
 */

import {
  CatalogueCommand,
  CatalogueEventMessage,
  CatalogueSnapshot,
  ScanProgressPayload,
  ScanRootsPayload,
  WatchRootsPayload
} from '../shared/protocols/catalogue-protocol';

const { scanRoots } = require('../main/lib/scanner');
const { ProjectIndex } = require('../main/lib/projectindex');
const { ParseCache } = require('../main/lib/cache');
const { groupVersions } = require('../main/lib/versions');
const watcher = require('../main/lib/watcher');
const path = require('path');

export class CatalogueService {
  private currentGenerationId = 0;
  private currentSnapshot: CatalogueSnapshot | null = null;
  private isScanning = false;
  private cancelRequested = false;
  private dataDir = '';
  private projectIndex: InstanceType<typeof ProjectIndex> | null = null;
  private parseCache: InstanceType<typeof ParseCache> | null = null;
  private cacheReady: Promise<any> = Promise.resolve();
  private activeRoots: string[] = [];

  constructor(dataDir?: string) {
    if (dataDir) {
      this.setDataDir(dataDir);
    }
  }

  public setDataDir(dataDir: string) {
    this.dataDir = dataDir;
    this.projectIndex = new ProjectIndex(path.join(this.dataDir, 'project-index.json'));
    this.parseCache = new ParseCache(path.join(this.dataDir, 'cache.json'));
    this.cacheReady = this.parseCache.load();
  }

  public getSnapshot(): CatalogueSnapshot | null {
    return this.currentSnapshot;
  }

  public async handleCommand(cmd: CatalogueCommand): Promise<CatalogueEventMessage | null> {
    switch (cmd.type) {
      case 'PING':
        return {
          replyToId: cmd.id,
          type: 'PONG',
          generationId: cmd.generationId,
          payload: { timestamp: Date.now() }
        };

      case 'INIT':
        if (cmd.payload && cmd.payload.dataDir) {
          this.setDataDir(cmd.payload.dataDir);
        }
        return {
          replyToId: cmd.id,
          type: 'SNAPSHOT_UPDATED',
          generationId: cmd.generationId,
          payload: this.currentSnapshot
        };

      case 'CANCEL_SCAN':
        this.cancelRequested = true;
        return {
          replyToId: cmd.id,
          type: 'SCAN_FAILED',
          generationId: cmd.generationId,
          payload: { cancelled: true, reason: 'User requested cancellation' }
        };

      case 'SCAN_ROOTS':
        return this.executeScan(cmd);

      case 'WATCH_ROOTS':
        return this.startWatching(cmd);

      case 'UNWATCH_ROOTS':
        watcher.stopWatching();
        return {
          replyToId: cmd.id,
          type: 'WATCH_EVENT',
          generationId: cmd.generationId,
          payload: { event: 'status', status: 'stopped' }
        };

      default:
        return null;
    }
  }

  public async executeScan(
    cmd: CatalogueCommand<ScanRootsPayload>,
    progressCallback?: (progress: ScanProgressPayload) => void
  ): Promise<CatalogueEventMessage> {
    const payload = cmd.payload || { roots: [], dataDir: '' };
    this.currentGenerationId = cmd.generationId;
    this.cancelRequested = false;
    this.isScanning = true;

    if (payload.dataDir && (!this.dataDir || this.dataDir !== payload.dataDir)) {
      this.setDataDir(payload.dataDir);
    }

    const startTime = Date.now();
    this.activeRoots = payload.roots || [];

    try {
      const emitProgress = (p: ScanProgressPayload) => {
        if (progressCallback) progressCallback(p);
        this.emitToSupervisor({
          replyToId: cmd.id,
          type: 'SCAN_PROGRESS',
          generationId: cmd.generationId,
          payload: p
        });
      };

      emitProgress({
        phase: 'discovering',
        foundProjects: 0,
        parsedProjects: 0,
        totalEstimated: 0
      });

      await this.cacheReady;
      if (this.parseCache) this.parseCache.resetCounters();

      const scanOptions: any = {
        shallow: payload.shallow || false,
        ignore: payload.ignore || [],
        followLinks: Boolean(payload.followLinks),
        cache: this.parseCache,
        onProgress: (p: any) => {
          if (this.cancelRequested) return false;
          emitProgress({
            phase: 'parsing',
            foundProjects: p.found || 0,
            parsedProjects: p.parsed || 0,
            totalEstimated: p.total || 0,
            currentPath: p.current
          });
          return true;
        }
      };

      const result = await scanRoots(this.activeRoots, scanOptions);

      if (this.cancelRequested) {
        this.isScanning = false;
        return {
          replyToId: cmd.id,
          type: 'SCAN_FAILED',
          generationId: cmd.generationId,
          payload: { cancelled: true }
        };
      }

      const entries = Array.isArray(result) ? result : result.entries || [];
      const durationMs = Date.now() - startTime;

      if (this.parseCache) {
        this.parseCache.prune(entries.map((entry: any) => entry.sessionPath));
        await this.parseCache.save();
      }

      const snapshot: CatalogueSnapshot = {
        generationId: cmd.generationId,
        timestamp: Date.now(),
        roots: this.activeRoots,
        projects: entries,
        stats: {
          totalProjects: entries.length,
          totalAudioCount: entries.reduce(
            (acc: number, p: any) => acc + (p.audioFiles ? p.audioFiles.length : 0),
            0
          ),
          scannedRootsCount: this.activeRoots.length,
          durationMs
        },
        unavailableRoots: result.unavailableRoots || [],
        truncated: Boolean(result.truncated),
        errors: result.errors || []
      };

      this.currentSnapshot = snapshot;

      // Save index to disk in background when complete
      if (this.projectIndex && !payload.shallow && !result.truncated && (!result.errors || result.errors.length === 0)) {
        await this.projectIndex.save(
          { roots: this.activeRoots, ignore: payload.ignore || [], followLinks: payload.followLinks },
          entries
        );
      }

      this.isScanning = false;

      return {
        replyToId: cmd.id,
        type: 'SCAN_COMPLETED',
        generationId: cmd.generationId,
        payload: {
          ...snapshot,
          entries,
          grouped: groupVersions(entries),
          errors: result.errors || [],
          truncated: Boolean(result.truncated),
          foldersRead: result.foldersRead || 0,
          cache: this.parseCache ? this.parseCache.stats() : { entries: 0, hits: 0, misses: 0 }
        }
      };
    } catch (err: any) {
      this.isScanning = false;
      return {
        replyToId: cmd.id,
        type: 'SCAN_FAILED',
        generationId: cmd.generationId,
        payload: { error: err.message || String(err) }
      };
    }
  }

  private startWatching(cmd: CatalogueCommand<WatchRootsPayload>): CatalogueEventMessage {
    const payload = cmd.payload || { roots: [] };
    const rootsToWatch = payload.roots || this.activeRoots;

    watcher.startWatching(
      rootsToWatch,
      (bounce: any) => {
        this.emitToSupervisor({
          type: 'WATCH_EVENT',
          generationId: this.currentGenerationId,
          payload: { event: 'bounce_detected', bounce }
        });
      },
      (changedPaths: string[]) => {
        this.emitToSupervisor({
          type: 'WATCH_EVENT',
          generationId: this.currentGenerationId,
          payload: { event: 'projects_changed', paths: changedPaths }
        });
      }
    );

    return {
      replyToId: cmd.id,
      type: 'WATCH_EVENT',
      generationId: cmd.generationId,
      payload: { event: 'status', status: 'watching', rootsCount: rootsToWatch.length }
    };
  }

  private emitToSupervisor(msg: CatalogueEventMessage) {
    if (typeof process !== 'undefined') {
      const parentPort = (process as any).parentPort;
      if (parentPort && typeof parentPort.postMessage === 'function') {
        parentPort.postMessage(msg);
      } else if (typeof process.send === 'function') {
        process.send(msg);
      }
    }
  }
}

// Automatically bootstrap listener if executed as an isolated utilityProcess
if (typeof process !== 'undefined') {
  const parentPort = (process as any).parentPort;
  const service = new CatalogueService();

  if (parentPort && typeof parentPort.on === 'function') {
    parentPort.on('message', async (e: any) => {
      const cmd: CatalogueCommand = e.data;
      if (!cmd) return;
      const response = await service.handleCommand(cmd);
      if (response) {
        parentPort.postMessage(response);
      }
    });
  } else if (typeof process.on === 'function') {
    process.on('message', async (cmd: any) => {
      if (!cmd) return;
      const response = await service.handleCommand(cmd);
      if (response && typeof process.send === 'function') {
        process.send(response);
      }
    });
  }
}
