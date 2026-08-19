'use strict';

import { NavigationHistory } from './navigation';

/**
 * Shared central state store for DAW Buddy.
 */

export interface AppState {
  settings: any;
  records: Record<string, any>;
  entries: any[];
  groupedRows: any[];
  groupVersionsOn: boolean;
  expanded: Set<string>;
  browsing: string | null;
  view: string;
  openProject: any | null;
  projectTab: string;
  projectTool: string | null;
  selected: string | null;
  activeAuditionPath: string | null;
  filterRoot: string | null;
  filterDaw: string | null;
  favOnly: boolean;
  sortBy: string;
  sortDir: number;
  noteTimers: Map<string, any>;
  dedupeState: { groups: any[]; scanned: number; folders: number; chosen: Set<number> };
  silenceProgressStatus: string | null;
  finishProgressStatus: string | null;
  qcProgressStatus: string | null;
  dedupeProgressStatus: string | null;
  diskProgressStatus: string | null;
  diskState: any | null;
  diskScanning: boolean;
  activeNoteEditor: string | null;
  finishFolder: string | null;
  finishResults: any[];
  finishChosen: Set<number>;
  id3Folder: string | null;
  id3Files: any[];
  id3Selected: Set<string>;
  analysisWorker: Worker | null;
  analysisRequestId: number;
  pendingAnalysis: Map<number, any>;
  activePlayAnalysis: Map<string, boolean>;
  analysisJobs: Map<string, any>;
  navigationHistory: NavigationHistory;
}

export const state: AppState = {
  settings: null,
  records: {},
  entries: [],
  groupedRows: [],
  groupVersionsOn: true,
  expanded: new Set(),
  browsing: null,
  view: 'list',
  openProject: null,
  projectTab: 'projectfiles',
  projectTool: null,
  selected: null,
  activeAuditionPath: null,
  filterRoot: null,
  filterDaw: null,
  favOnly: false,
  sortBy: 'modified',
  sortDir: -1,
  noteTimers: new Map(),
  dedupeState: { groups: [], scanned: 0, folders: 0, chosen: new Set<number>() },
  silenceProgressStatus: null,
  finishProgressStatus: null,
  qcProgressStatus: null,
  dedupeProgressStatus: null,
  diskProgressStatus: null,
  diskState: null,
  diskScanning: false,
  activeNoteEditor: null,
  finishFolder: null,
  finishResults: [],
  finishChosen: new Set<number>(),
  id3Folder: null,
  id3Files: [],
  id3Selected: new Set(),
  analysisWorker: null,
  analysisRequestId: 0,
  pendingAnalysis: new Map(),
  activePlayAnalysis: new Map(),
  analysisJobs: new Map(),
  navigationHistory: new NavigationHistory()
};

export function record(path: string): any {
  return state.records[path] || {};
}
