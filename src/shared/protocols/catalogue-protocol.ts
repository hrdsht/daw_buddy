'use strict';

/**
 * Catalogue Service Message Protocol (Proposal 0005)
 * 
 * Typed message protocol between the Main Process Supervisor and the
 * dedicated Catalogue utilityProcess.
 */

export interface CatalogueProjectFact {
  path: string;
  name: string;
  daw: string;
  modified: number;
  sizeBytes?: number;
  tempo?: number;
  key?: string;
  timeSignature?: string;
  scale?: string;
  tala?: string;
  tags?: string[];
  notes?: string;
  audioFiles?: string[];
  missingSamplesCount?: number;
}

export interface CatalogueStats {
  totalProjects: number;
  totalAudioCount: number;
  scannedRootsCount: number;
  durationMs: number;
}

export interface CatalogueSnapshot {
  generationId: number;
  timestamp: number;
  roots: string[];
  projects: CatalogueProjectFact[];
  stats: CatalogueStats;
  unavailableRoots?: string[];
  truncated?: boolean;
  errors?: string[];
}

export type CatalogueCommandType =
  | 'INIT'
  | 'SCAN_ROOTS'
  | 'GET_SNAPSHOT'
  | 'WATCH_ROOTS'
  | 'UNWATCH_ROOTS'
  | 'CANCEL_SCAN'
  | 'PING';

export interface ScanRootsPayload {
  roots: string[];
  dataDir: string;
  ignore?: string[];
  followLinks?: boolean;
  shallow?: boolean;
  budgetMs?: number;
}

export interface WatchRootsPayload {
  roots: string[];
}

export interface InitPayload {
  dataDir: string;
}

export interface CatalogueCommand<T = any> {
  id: string;
  type: CatalogueCommandType;
  generationId: number;
  payload?: T;
}

export type CatalogueEventMessageType =
  | 'SNAPSHOT_UPDATED'
  | 'SCAN_PROGRESS'
  | 'SCAN_COMPLETED'
  | 'SCAN_FAILED'
  | 'WATCH_EVENT'
  | 'ROOT_UNAVAILABLE'
  | 'CATALOGUE_DEGRADED'
  | 'PONG';

export interface ScanProgressPayload {
  phase: 'discovering' | 'parsing' | 'indexing' | 'idle';
  foundProjects: number;
  parsedProjects: number;
  totalEstimated: number;
  currentPath?: string;
}

export interface WatchEventPayload {
  event: 'bounce_detected' | 'projects_changed' | 'status';
  bounce?: any;
  paths?: string[];
  status?: string;
  rootsCount?: number;
}

export interface DegradedStatePayload {
  reason: string;
  crashCount: number;
  fallbackAvailable: boolean;
  restarting: boolean;
}

export interface CatalogueEventMessage<T = any> {
  replyToId?: string;
  type: CatalogueEventMessageType;
  generationId: number;
  payload: T;
}
