/**
 * Runs inside the window. No file access — everything goes through
 * window.api, defined in preload.js.
 *
 * The project list, project page and standalone tools share the main pane.
 */

import { Player } from './player';
import { parseQuery, hasQuery, matchesQuery } from './search';
import { findMatches } from './matching';
import { droneNoteFor } from './drone';
import { NavigationHistory } from './navigation';
import { DSP, ScaleSegment, ScaleModulationReport } from './dsp';
import {
  layout as kbLayoutFn,
  highlight as kbHighlightFn,
  fretboardLayout as fretboardLayoutFn,
  highlightFretboard as fretboardHighlightFn,
  FretNote,
  GUITAR_STRINGS,
  wheelLayout as wheelLayoutFn,
  compatible as camelotCompatible,
  codeFor,
  CAMELOT_KEYS,
  DEGREE_NAMES,
  SARGAM_NAMES
} from './scaleview';
import { scaleMidi, progressionMidi, notesFor, ragaMidi, rhythmGuideMidi } from './midiwrite';
import {
  ScaleTraditionId,
  WORLD_REGIONS,
  WORLD_SCALES_DATABASE,
  findMatchingWorldScales,
  generateWorldScaleMidi,
  ScoredWorldScale
} from './world-scales';
import { showRegionOnboardingModal } from './onboarding';
import {
  METRONOME_SOUNDSETS,
  getMetronomeSoundsets,
  getMetronomeSoundset,
  generateMetronomeWav,
  generateMetronomeMidi,
  loadSoundsetBuffers,
  playMetronomePulse
} from './metronome-sounds';
import {
  SlowedReverbOptions,
  DEFAULT_SLOWED_REVERB_OPTIONS,
  percentToSemitones,
  semitonesToPercent,
  getPlaybackRate,
  renderSlowedReverbAudio,
  encodeWavBuffer,
  encodeMp3Buffer,
  SlowedReverbWaveformPlayer,
  formatDuration as formatSrDuration,
  formatBytes as formatSrBytes
} from './slowed-reverb';

const $ = (id: string): any => document.getElementById(id);

const viewEl = $('view');
const collectionsEl = $('collections');
const searchEl = $('search');
const toastsEl = $('toasts');
const favFilterEl = $('favFilter');
const backBtn = $('backBtn');
const sheetEl = $('sheet');
const scrimEl = $('scrim');
const themeToggleEl = $('themeToggle');

import {
  applyAppearance,
  applyThemeTuning,
  currentSurface,
  currentThemeStyle,
  THEME_STYLES,
  MINIMALIST_ACCENTS,
  ABLETON_ACCENTS,
  CLASSIC_ACCENTS,
  ACCENTS,
  SURFACES,
  ABLETON_CLIP_PALETTE,
  ABLETON_PALETTE_GRID,
  getAbletonProjectColor
} from './dom';
import { startFeatureWalkthrough, startProjectWalkthrough, startToolWalkthrough } from './tour';

// Initialize saved appearance (Default: Minimalist, Dark, Cyan)
const savedStyle = localStorage.getItem('dawBuddyThemeStyle') || 'minimalist';
const savedAccent = localStorage.getItem('dawBuddyAccent') || (savedStyle === 'minimalist' ? 'cyan' : 'green');
let savedSurface = localStorage.getItem('dawBuddySurface');
if (!savedSurface) {
  savedSurface = localStorage.getItem('dawBuddyTheme') === 'light' ? 'light' : 'dark';
}
applyAppearance(savedAccent, savedSurface, savedStyle);

// Topbar button: quick flip between dark and light (preserves active theme style and accent) or open Theme Lab if clicking gear
themeToggleEl.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target && target.closest('.pill-gear-hint')) {
    e.stopPropagation();
    toggleThemeComicBubble();
    return;
  }
  const next = currentSurface() === 'light' ? 'dark' : 'light';
  applyAppearance(document.body.dataset.accent, next, currentThemeStyle());
});

// Topbar button: right click brings up Comic Speech Bubble Theme Lab
themeToggleEl.addEventListener('contextmenu', (event: MouseEvent) => {
  event.preventDefault();
  toggleThemeComicBubble();
});

const ACCENT_COLOR_MAP: Record<string, string> = {
  cyan: '#00e5ff',
  mint: '#00d699',
  lime: '#9be62a',
  pink: '#ff66b2',
  mono: '#e0e0e0',
  magenta: '#ff2e93',
  yellow: '#ffea00',
  sky: '#29a9ff',
  lavender: '#9d7aff',
  amber: '#ff851b',
  coral: '#f78c80',
  green: '#2ee6a8',
  blue: '#3b82f6',
  red: '#ef4444'
};

let activeComicBubble: HTMLElement | null = null;

function closeThemeComicBubble() {
  if (activeComicBubble) {
    activeComicBubble.remove();
    activeComicBubble = null;
  }
}

function toggleThemeComicBubble() {
  if (activeComicBubble) {
    closeThemeComicBubble();
    return;
  }

  const bubble = el('div', 'comic-theme-bubble');
  activeComicBubble = bubble;

  const tail = el('div', 'comic-theme-bubble__tail');
  bubble.append(tail);

  // Header
  const head = el('div', 'comic-theme-bubble__head');
  const title = el('div', 'comic-theme-bubble__title');
  title.innerHTML = '<span>💭</span> <span>Theme Lab</span>';
  
  const closeBtn = el('button', 'comic-theme-bubble__close', '✕');
  closeBtn.title = 'Close';
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    closeThemeComicBubble();
  });
  head.append(title, closeBtn);
  bubble.append(head);

  // Surface Modes (Dark, Light, AMOLED)
  const surfaceSection = el('div', 'comic-theme-bubble__section');
  surfaceSection.append(el('div', 'comic-theme-bubble__label', 'Mode / Surface'));
  const surfaceRow = el('div', 'comic-theme-bubble__row');

  const surfaces = [
    { key: 'dark', label: '🌙 Dark' },
    { key: 'light', label: '☀️ Light' },
    { key: 'amoled', label: '🖤 AMOLED' }
  ];

  surfaces.forEach((s) => {
    const btn = el('button', `comic-bubble-pill${currentSurface() === s.key ? ' is-active' : ''}`, s.label);
    btn.type = 'button';
    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      applyAppearance(document.body.dataset.accent, s.key, currentThemeStyle());
      updateBubbleStates();
    });
    surfaceRow.append(btn);
  });
  surfaceSection.append(surfaceRow);
  bubble.append(surfaceSection);

  // Theme Styles (Minimalist, Ableton, Classic)
  const styleSection = el('div', 'comic-theme-bubble__section');
  styleSection.append(el('div', 'comic-theme-bubble__label', 'Theme Style'));
  const styleRow = el('div', 'comic-theme-bubble__row');

  const styles = [
    { key: 'minimalist', label: '🎛️ Minimal' },
    { key: 'ableton', label: '🎹 Ableton Like' },
    { key: 'classic', label: '🎚️ Classic' }
  ];

  styles.forEach((st) => {
    const btn = el('button', `comic-bubble-pill${currentThemeStyle() === st.key ? ' is-active' : ''}`, st.label);
    btn.type = 'button';
    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      const defAccent = st.key === 'minimalist' ? 'cyan' : (st.key === 'ableton' ? 'mint' : 'green');
      applyAppearance(defAccent, currentSurface(), st.key);
      updateBubbleStates();
    });
    styleRow.append(btn);
  });
  styleSection.append(styleRow);
  bubble.append(styleSection);

  // Accent Swatches
  const swatchSection = el('div', 'comic-theme-bubble__section');
  swatchSection.append(el('div', 'comic-theme-bubble__label', 'Accent Colour'));
  const swatchesContainer = el('div', 'comic-theme-bubble__swatches');
  swatchSection.append(swatchesContainer);
  bubble.append(swatchSection);

  function renderSwatches() {
    swatchesContainer.innerHTML = '';
    const curStyle = currentThemeStyle();
    const curAccent = document.body.dataset.accent || (curStyle === 'minimalist' ? 'cyan' : 'green');
    const list = curStyle === 'minimalist' ? MINIMALIST_ACCENTS : (curStyle === 'ableton' ? ABLETON_ACCENTS : CLASSIC_ACCENTS);

    list.forEach((acc) => {
      const sw = el('button', `comic-bubble-swatch${curAccent === acc ? ' is-active' : ''}`);
      sw.type = 'button';
      sw.title = acc.charAt(0).toUpperCase() + acc.slice(1);
      sw.style.backgroundColor = ACCENT_COLOR_MAP[acc] || '#00e5ff';
      sw.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        applyAppearance(acc, currentSurface(), curStyle);
        updateBubbleStates();
      });
      swatchesContainer.append(sw);
    });
  }

  function updateBubbleStates() {
    const curSurf = currentSurface();
    const curStyle = currentThemeStyle();

    surfaceRow.childNodes.forEach((node: any, idx: number) => {
      node.classList.toggle('is-active', surfaces[idx].key === curSurf);
    });

    styleRow.childNodes.forEach((node: any, idx: number) => {
      node.classList.toggle('is-active', styles[idx].key === curStyle);
    });

    renderSwatches();
  }

  renderSwatches();

  // Position relative to themeToggleEl
  document.body.append(bubble);
  const rect = themeToggleEl.getBoundingClientRect();
  bubble.style.top = `${rect.bottom + 10}px`;
  bubble.style.right = `${Math.max(16, window.innerWidth - rect.right - 8)}px`;

  // Auto-close on click outside or escape
  const handleOutsideClick = (e: MouseEvent) => {
    if (!bubble.contains(e.target as Node) && e.target !== themeToggleEl) {
      closeThemeComicBubble();
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeThemeComicBubble();
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    }
  };

  setTimeout(() => {
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
  }, 10);
}

// Settings — Theme style switch (Minimalist vs Ableton Like vs Studio Classic)
if ($('themeStyles')) {
  $('themeStyles').addEventListener('click', (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest('.style-btn') as HTMLElement;
    if (btn) {
      const style = btn.getAttribute('data-style') || 'minimalist';
      const defaultAccent = style === 'minimalist' ? 'cyan' : (style === 'ableton' ? 'mint' : 'green');
      applyAppearance(defaultAccent, currentSurface(), style);
    }
  });
}

// Settings — Accent swatches across all theme styles
['minimalistSwatches', 'abletonSwatches', 'classicSwatches'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('click', (event: MouseEvent) => {
      const btn = (event.target as HTMLElement).closest('.swatch') as HTMLElement;
      if (btn) {
        applyAppearance(btn.getAttribute('data-accent') || undefined, currentSurface(), currentThemeStyle());
      }
    });
  }
});

// Settings — Surface modes (Dark, Light, AMOLED)
if ($('surfaceModes')) {
  $('surfaceModes').addEventListener('click', (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest('.surface-btn') as HTMLElement;
    if (btn) {
      applyAppearance(document.body.dataset.accent, btn.getAttribute('data-surface') || undefined, currentThemeStyle());
    }
  });
}

// Settings — Brightness & Contrast Sliders
const themeBrightnessSlider = $('themeBrightnessSlider') as HTMLInputElement | null;
if (themeBrightnessSlider) {
  themeBrightnessSlider.addEventListener('input', () => {
    const val = Number(themeBrightnessSlider.value) || 100;
    applyThemeTuning(val, undefined);
  });
  themeBrightnessSlider.addEventListener('dblclick', () => applyThemeTuning(100, undefined));
}

const themeContrastSlider = $('themeContrastSlider') as HTMLInputElement | null;
if (themeContrastSlider) {
  themeContrastSlider.addEventListener('input', () => {
    const val = Number(themeContrastSlider.value) || 100;
    applyThemeTuning(undefined, val);
  });
  themeContrastSlider.addEventListener('dblclick', () => applyThemeTuning(undefined, 100));
}

if ($('resetThemeTuning')) {
  $('resetThemeTuning').addEventListener('click', () => applyThemeTuning(100, 100));
}

// Settings — Reset theme to default (Dark Minimalist with Cyan accent)
if ($('resetTheme')) {
  $('resetTheme').addEventListener('click', () => {
    applyAppearance('cyan', 'dark', 'minimalist');
    applyThemeTuning(100, 100);
  });
}

if ($('miniToggle')) {
  $('miniToggle').addEventListener('click', () => {
    if (window.api && window.api.toggleMiniPlayer) {
      window.api.toggleMiniPlayer();
    }
  });
}

/* ============================== state ============================== */

let settings = null;
let records = {};
let entries = [];
let groupedRows = [];
let groupVersionsOn = true;
let expanded = new Set();
let browsing = null;
let view = 'list';
let openProject = null;
let projectTab = 'projectfiles';
let projectTool = null;
let selected = null;
let activeAuditionPath = null;
let filterRoot = null;
let filterDaw = null;
let favOnly = false;
let sortBy = 'modified';
let sortDir = -1;
const noteTimers = new Map();
const sampleAuditCache = new Map(); // sessionPath -> audit result, cleared on rescan
const projectRendersCache = new Map<string, any>(); // sessionPath -> findRenders result, cleared on rescan
const projectStemsCache = new Map<string, any[]>(); // stemsPath -> listAllAudio files, cleared on rescan
const projectAllAudioCache = new Map<string, any[]>(); // folder -> deepAudio files, cleared on rescan
let dedupeState = { groups: [], scanned: 0, folders: 0, chosen: new Set<number>() };
let silenceProgressStatus = null;
let finishProgressStatus = null;
let qcProgressStatus = null;
let dedupeProgressStatus = null;
let diskProgressStatus = null;
let diskState = null;
let diskScanning = false;
let activeNoteEditor = null;
let finishFolder = null;
let finishResults = [];
let finishChosen = new Set<number>();
let id3Folder = null;
let id3Files = [];
let id3Selected = new Set();
let analysisWorker = null;
let analysisRequestId = 0;
const pendingAnalysis = new Map();
const activePlayAnalysis = new Map();
const analysisJobs = new Map();
const audioAnalysisCache = new Map<string, any>();
const navigationHistory = new NavigationHistory();

function getFileAnalysis(filePath?: string | null, fileName?: string | null, entry?: any): any | null {
  if (filePath && audioAnalysisCache.has(filePath)) {
    return audioAnalysisCache.get(filePath);
  }
  const rec = filePath ? (records as any)[filePath] : null;
  if (rec && (rec.analysis || rec.key || rec.detectedBpm || rec.tonic)) {
    const res = rec.analysis || {
      key: rec.key,
      camelot: rec.camelot,
      keyConfidence: rec.keyConfidence,
      keyAlternate: rec.keyAlternate,
      tonic: rec.tonic,
      tonicConfidence: rec.tonicConfidence,
      scale: rec.scale,
      scaleConfidence: rec.scaleConfidence,
      modal: rec.modal,
      bpm: rec.detectedBpm,
      timeSignature: rec.detectedTimeSignature,
      tala: rec.detectedTala ? { name: rec.detectedTala } : null,
      tuningA4: rec.tuningA4,
      ragas: rec.ragas,
      chordProgression: rec.chordProgression
    };
    if (filePath) audioAnalysisCache.set(filePath, res);
    return res;
  }
  if (entry && fileName && (records as any)[entry.path]?.analysedFrom === fileName) {
    const entryRec = (records as any)[entry.path];
    if (entryRec && (entryRec.key || entryRec.detectedBpm || entryRec.tonic)) {
      const res = {
        key: entryRec.key,
        camelot: entryRec.camelot,
        keyConfidence: entryRec.keyConfidence,
        keyAlternate: entryRec.keyAlternate,
        tonic: entryRec.tonic,
        tonicConfidence: entryRec.tonicConfidence,
        scale: entryRec.scale,
        scaleConfidence: entryRec.scaleConfidence,
        modal: entryRec.modal,
        bpm: entryRec.detectedBpm,
        timeSignature: entryRec.detectedTimeSignature,
        tala: entryRec.detectedTala ? { name: entryRec.detectedTala } : null,
        tuningA4: entryRec.tuningA4,
        ragas: entryRec.ragas
      };
      if (filePath) audioAnalysisCache.set(filePath, res);
      return res;
    }
  }
  return null;
}

function isFileAnalysed(filePath?: string | null, fileName?: string | null, entry?: any): boolean {
  return Boolean(getFileAnalysis(filePath, fileName, entry));
}

interface ConfirmModalOptions {
  title?: string;
  icon?: string;
  message: string;
  details?: string;
  confirmText?: string;
  cancelText?: string;
}

function showConfirmModal(opts: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    document.querySelectorAll('.confirm-modal-overlay').forEach((node) => node.remove());

    const overlay = el('div', 'confirm-modal-overlay');
    const modal = el('div', 'confirm-modal');

    // Header
    const header = el('div', 'confirm-modal__header');
    const titles = el('div', 'confirm-modal__titles');
    if (opts.icon) {
      titles.append(el('span', 'confirm-modal__icon', opts.icon));
    }
    titles.append(el('h3', 'confirm-modal__title', opts.title || 'Are you sure?'));
    header.append(titles);

    const closeBtn = el('button', 'confirm-modal__close', '✕');
    closeBtn.title = 'Cancel (Esc)';
    closeBtn.addEventListener('click', () => {
      cleanup(false);
    });
    header.append(closeBtn);
    modal.append(header);

    // Body
    const body = el('div', 'confirm-modal__body');
    const msg = el('p', 'confirm-modal__message', opts.message);
    body.append(msg);

    if (opts.details) {
      const detailsBox = el('div', 'confirm-modal__details');
      detailsBox.append(el('div', 'confirm-modal__details-label', 'Knowledge Base Record'));
      detailsBox.append(el('div', 'confirm-modal__details-content', opts.details));
      body.append(detailsBox);
    }

    const prompt = el('p', 'confirm-modal__prompt', 'Would you like to re-analyse it now?');
    body.append(prompt);
    modal.append(body);

    // Footer
    const footer = el('div', 'confirm-modal__footer');
    const cancelBtn = el('button', 'pill', opts.cancelText || 'No');
    const confirmBtn = el('button', 'pill pill--solid', opts.confirmText || 'Yes');

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));

    footer.append(cancelBtn, confirmBtn);
    modal.append(footer);
    overlay.append(modal);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup(false);
      } else if (e.key === 'Enter') {
        cleanup(true);
      }
    };
    window.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    function cleanup(result: boolean) {
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    document.body.append(overlay);
    requestAnimationFrame(() => confirmBtn.focus());
  });
}

/* ==================================================================
   GLOBAL UNCAUGHT ERROR REPORTING & CRASH RECOVERY
   ================================================================== */

window.addEventListener('error', (event) => {
  console.error('[Renderer Uncaught Error]:', event.error || event.message);
  try {
    if (window.api && window.api.crashlogReportRendererError) {
      window.api.crashlogReportRendererError({
        message: event.message || 'Renderer Error',
        stack: event.error?.stack,
        name: event.error?.name
      });
    }
  } catch {}
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer Unhandled Rejection]:', event.reason);
  try {
    const reason = event.reason;
    if (window.api && window.api.crashlogReportRendererError) {
      window.api.crashlogReportRendererError({
        message: typeof reason === 'string' ? reason : (reason?.message || 'Unhandled Promise Rejection'),
        stack: reason?.stack,
        name: reason?.name
      });
    }
  } catch {}
});

function showCrashRecoveryModal(report: any) {
  if ($('crashRecoveryOverlay')) return;

  const overlay = el('div', 'crash-recovery-overlay');
  overlay.id = 'crashRecoveryOverlay';

  const modal = el('div', 'crash-recovery-modal');

  // Header
  const header = el('div', 'crash-recovery-header');
  const title = el('div', 'crash-recovery-title');
  title.innerHTML = `<span>🚨</span> <span>DAW Buddy Recovered From a Crash</span>`;

  const closeBtn = el('button', 'crash-recovery-close', '✕');
  closeBtn.title = 'Skip / Dismiss (Esc)';
  header.append(title, closeBtn);

  // Description
  const desc = el('div', 'crash-recovery-desc',
    `DAW Buddy caught an unexpected error on ${report.timeString || 'the last session'}. A diagnostic report was saved locally. You can drag and drop the crash log below directly into an email, Discord, or GitHub issue, or copy the error text.`
  );

  // Error Snippet Box
  const errorBox = el('div', 'crash-recovery-box',
    `[${(report.source || 'main').toUpperCase()}] ${report.errorName || 'Error'}: ${report.errorMessage || 'Unknown crash'}\n\n${report.errorStack || ''}`
  );

  // Draggable Log Pill
  const pill = el('div', 'crash-drag-pill');
  pill.draggable = true;
  pill.title = 'Click and drag this crash log file directly into an email, Discord, or folder';

  const pillIcon = el('span', 'crash-drag-pill__icon', '📋');
  const pillInfo = el('div', 'crash-drag-pill__info');
  const filename = report.logFilePath ? report.logFilePath.split(/[\\/]/).pop() : 'crash-report.log';
  const pillName = el('span', 'crash-drag-pill__name', filename);
  const pillHint = el('span', 'crash-drag-pill__hint', '📦 Drag & Drop file directly into Mail / Discord');
  pillInfo.append(pillName, pillHint);
  pill.append(pillIcon, pillInfo);

  pill.addEventListener('dragstart', (e: DragEvent) => {
    e.preventDefault();
    if (window.api && window.api.dragFiles && report.logFilePath) {
      window.api.dragFiles([report.logFilePath]);
    }
  });

  // Developer Support Email Banner (1-click copy)
  const emailBanner = el('div', 'crash-email-banner');
  const emailLeft = el('div', 'crash-email-banner__left');
  const emailIcon = el('span', 'crash-email-banner__icon', '✉️');
  const emailText = el('span', 'crash-email-banner__text');
  emailText.innerHTML = `Send log to: <b class="crash-email-address" title="Click to copy">ba55icklistens@gmail.com</b>`;
  emailLeft.append(emailIcon, emailText);

  const copyEmailBtn = el('button', 'pill pill--sm', '📋 Copy Email');
  copyEmailBtn.title = 'Copy ba55icklistens@gmail.com to clipboard';
  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('ba55icklistens@gmail.com');
      copyEmailBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyEmailBtn.textContent = '📋 Copy Email'; }, 2000);
    } catch {}
  };
  copyEmailBtn.addEventListener('click', handleCopyEmail);
  emailText.addEventListener('click', handleCopyEmail);
  emailBanner.append(emailLeft, copyEmailBtn);

  // Action Buttons
  const actions = el('div', 'crash-recovery-actions');

  const copyBtn = el('button', 'btn', '📋 Copy Details');
  copyBtn.addEventListener('click', async () => {
    try {
      const textToCopy = `DAW Buddy Crash Report (${report.timeString}):\n${report.errorName}: ${report.errorMessage}\n\nStack:\n${report.errorStack || 'N/A'}\n\nSystem:\n${JSON.stringify(report.systemInfo, null, 2)}`;
      await navigator.clipboard.writeText(textToCopy);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Details'; }, 2000);
    } catch {}
  });

  const openFolderBtn = el('button', 'btn', '📂 Show in Folder');
  openFolderBtn.addEventListener('click', async () => {
    if (window.api && window.api.crashlogOpenFolder) {
      await window.api.crashlogOpenFolder();
    }
  });

  const dismissBtn = el('button', 'btn btn--primary', 'Skip / Dismiss');

  const dismissModal = async () => {
    try {
      await window.api?.crashlogDismiss?.();
    } catch {}
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismissModal();
    }
  };

  closeBtn.addEventListener('click', dismissModal);
  dismissBtn.addEventListener('click', dismissModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismissModal();
  });
  document.addEventListener('keydown', onEsc);

  actions.append(openFolderBtn, copyBtn, dismissBtn);
  modal.append(header, desc, errorBox, pill, emailBanner, actions);
  overlay.append(modal);
  document.body.append(overlay);
}

/* ============================= startup ============================= */

async function boot() {
  if ($('openTour')) decorateAction('openTour', 'compass', 'Tour');
  decorateAction('openTools', 'sliders', 'Tools');
  decorateAction('openSettings', 'settings', 'Settings');
  buildSortMenu();
  settings = await window.api.getSettings();
  records = await window.api.getRecords();
  applySettings();
  await refresh();

  // Check if a prior crash occurred and show skippable recovery modal
  try {
    const latestCrash = await window.api.crashlogGetLatest?.();
    if (latestCrash && !latestCrash.dismissed) {
      showCrashRecoveryModal(latestCrash);
    }
  } catch (err) {
    console.warn('[CrashRecovery] Check error:', err);
  }

  // If user hasn't configured region & world scales yet, display the interactive 3D Globe wizard on first run or after update!
  const APP_VERSION = (settings && settings.appVersion) || '0.4.9-beta2';
  const seenSetupVersion = localStorage.getItem('dawBuddyRegionSetupVersion');
  const isSetupDone = Boolean(settings.regionSetupComplete) || localStorage.getItem('dawBuddyRegionSetupComplete') === 'true';

  if (!isSetupDone || seenSetupVersion !== APP_VERSION) {
    if (isSetupDone && seenSetupVersion !== APP_VERSION) {
      localStorage.setItem('dawBuddyRegionSetupVersion', APP_VERSION);
    } else {
      localStorage.setItem('dawBuddyRegionSetupVersion', APP_VERSION);
      setTimeout(() => {
        showRegionOnboardingModal({
          currentRegion: settings.region || 'indian',
          currentTraditions: settings.scaleTraditions || ['all'],
          isUpdateOrSettings: false,
          onSave: async (result) => {
            localStorage.setItem('dawBuddyRegionSetupComplete', 'true');
            localStorage.setItem('dawBuddyRegionSetupVersion', APP_VERSION);
            settings = await window.api.updateSettings({
              region: result.region,
              scaleTraditions: result.scaleTraditions,
              regionSetupComplete: true
            });
            applySettings();
            render();
          },
          playSynthNote: (pc, oct, a4) => playSynthNote(pc, oct, a4 || 440)
        });
      }, 450);
    }
  } else {
    // Auto-launch walkthrough on first start or after version updates
    setTimeout(() => {
      startFeatureWalkthrough(false);
    }, 750);
  }
}

function applySettings() {
  if (settings.listSort && settings.listSort.by) {
    sortBy = settings.listSort.by;
    sortDir = settings.listSort.dir === 1 ? 1 : -1;
  }
  $('alwaysOnTop').checked = settings.alwaysOnTop;
  $('pollWatching').checked = settings.pollWatching;
  if ($('followLinks')) $('followLinks').checked = Boolean(settings.followLinks);
  if ($('outputPath')) {
    $('outputPath').textContent = settings.outputFolder || 'Created on first scan';
  }
  $('ignoreInput').value = settings.ignore.join(', ');
  if ($('webhookInput')) $('webhookInput').value = settings.webhookUrl || '';
  if ($('enableCrashLogs')) {
    $('enableCrashLogs').checked = settings.enableCrashLogs !== false;
  }
  if ($('appVersionDisplay')) {
    $('appVersionDisplay').textContent = `v${(settings && settings.appVersion) || '0.4.9-beta2'}`;
  }
  $('dataDir').textContent = settings.dataDir;
  document.body.classList.toggle('is-mac', Boolean(settings.isMac));

  const regSelect = $('settingRegionSelect') as HTMLSelectElement | null;
  if (regSelect) {
    regSelect.value = settings.region || 'indian';
  }

  const scaleSelect = $('settingScaleTraditionSelect') as HTMLSelectElement | null;
  if (scaleSelect) {
    const trads = settings.scaleTraditions || ['all'];
    if (trads.includes('all')) {
      scaleSelect.value = 'all';
    } else if (trads.length === 1) {
      scaleSelect.value = trads[0];
    } else {
      scaleSelect.value = 'custom';
    }
  }

  const regFlag = $('regionSummaryFlag');
  const regText = $('regionSummaryText');
  if (regFlag && regText) {
    const regObj = WORLD_REGIONS.find((r) => r.id === (settings.region || 'indian')) || WORLD_REGIONS[0];
    regFlag.textContent = regObj.flag;
    const isAll = !settings.scaleTraditions || settings.scaleTraditions.includes('all');
    let tradDesc = 'All World Traditions';
    if (!isAll) {
      if (settings.scaleTraditions.length === 1 && settings.scaleTraditions[0] === 'western') {
        tradDesc = 'Western Scales Only';
      } else if (settings.scaleTraditions.length === 1) {
        tradDesc = `${settings.scaleTraditions[0]} only`;
      } else {
        tradDesc = `${settings.scaleTraditions.length} traditions`;
      }
    }
    regText.innerHTML = `<strong>${regObj.name}</strong> (${tradDesc})`;
  }

  // Apply Animation Scale to DOM and Settings UI
  const reduced = Boolean(settings.reducedAnimation);
  const scale = typeof settings.animationScale === 'number' ? settings.animationScale : (reduced ? 0.5 : 1.0);
  const effectiveScale = reduced ? scale : 1.0;
  document.body.setAttribute('data-anim-scale', String(effectiveScale));

  const scaleLabels: Record<number, string> = {
    0: '0x (Instant / Off)',
    1: '0.25x (Ultra Fast)',
    2: '0.50x (Snappy)',
    3: '1.0x (Full Default)'
  };

  let sliderIdx = 3;
  if (effectiveScale <= 0.05) sliderIdx = 0;
  else if (effectiveScale <= 0.35) sliderIdx = 1;
  else if (effectiveScale <= 0.75) sliderIdx = 2;
  else sliderIdx = 3;

  const animSlider = $('animScaleRangeSlider') as HTMLInputElement | null;
  const animValueDisplay = $('animScaleDisplayValue');

  if (animSlider) {
    animSlider.value = String(sliderIdx);
  }
  if (animValueDisplay) {
    animValueDisplay.textContent = scaleLabels[sliderIdx] || `${effectiveScale}x`;
  }

  renderRootList();
}

async function refresh() {
  sampleAuditCache.clear();
  projectRendersCache.clear();
  projectStemsCache.clear();
  projectAllAudioCache.clear();
  if (view === 'list') showSpinner('Scanning', 'Reading your folders.');

  const result = browsing
    ? await window.api.browse(browsing)
    : await window.api.scan();

  applyProjectResult(result);
}

function applyProjectResult(result, { background = false } = {}) {
  // Do not replace a folder-specific browsing view with the root catalogue.
  // The next trip back to All projects will request the verified root list.
  if (background && browsing) return;

  entries = result.entries || [];
  groupedRows = result.grouped || [];

  // How many sessions share each folder, so a row can show "8 in folder".
  const perFolder = new Map();
  entries.forEach((e) => perFolder.set(e.folder, (perFolder.get(e.folder) || 0) + 1));
  entries.forEach((e) => {
    e.siblingCount = perFolder.get(e.folder) || 1;
  });

  if (result.cache) {
    console.log(
      `[${result.fromIndex ? 'index' : 'scan'}] ${entries.length} sessions · ` +
        `${result.foldersRead} folders read · ` +
        `cache ${result.cache.hits} hit / ${result.cache.misses} parsed`
    );
  }

  (result.errors || []).forEach((error) =>
    toast('Folder unreadable', `${basename(error.root)} — ${error.message}`, true)
  );
  if (result.truncated) {
    toast(
      'Scan stopped early',
      'That tree is unusually large. Add folders you do not need to the skip list.',
      true
    );
  }

  renderCollections();
  render();

  if (!Player.getCurrent()) {
    preloadLatestRender({ autoplay: false });
  }
}

/* ============================ navigation =========================== */

function render() {
  backBtn.hidden = view === 'list' && !browsing;
  setPageTitle();

  if (view === 'project') return renderProjectPage();

  // If returning to non-project views, reset dynamic project theme overrides back to user's setting
  if (currentThemeStyle() === 'ableton' || document.body.style.getPropertyValue('--amber')) {
    document.body.style.removeProperty('--amber');
    document.body.style.removeProperty('--amber-ink');
    document.body.style.removeProperty('--sage');
    document.body.style.removeProperty('--accent-glow');
    document.documentElement.style.removeProperty('--amber');
    document.documentElement.style.removeProperty('--amber-ink');
    document.documentElement.style.removeProperty('--sage');
    document.documentElement.style.removeProperty('--accent-glow');
    applyAppearance();
    Player.draw();
  }

  if (view === 'thisweek') return renderThisWeek();
  if (view === 'tools') return renderStandaloneTools();
  if (view === 'slowed-reverb') return renderSlowedReverbTool();
  if (view === 'randomizer') return renderRandomizerTool();
  if (view === 'scale-tool') return renderScaleMidiTool();
  if (view === 'dedupe') return renderDedupe();
  if (view === 'disk') return renderDiskInsights();
  if (view === 'id3') return renderId3Editor();
  if (view === 'rename' || view === 'batch-rename') return renderStandaloneRename();
  if (view === 'smart-rename') return renderStandaloneSmartRename();
  if (view === 'finish') return renderAudioFinishing();
  if (view === 'silence') return renderStandaloneSilence();
  if (view === 'vocal') return renderStandaloneVocal();
  return renderList();
}

// The topbar heading reflects where you are — the active collection on the list,
// or the name of the page/tool everywhere else.
const TOOL_TITLES: Record<string, string> = {
  tools: 'Tools',
  'slowed-reverb': 'Slowed + Reverb Studio',
  randomizer: 'Music Randomizer',
  'scale-tool': 'Scale & Raaga Detector',
  dedupe: 'Sample cleanup',
  disk: 'Disk insights',
  id3: 'ID3 editor',
  rename: 'Bulk renamer',
  'batch-rename': 'Bulk renamer',
  'smart-rename': 'Smart renamer',
  finish: 'Audio finishing',
  silence: 'Strip silence',
  vocal: 'Vocal reconstruction',
  thisweek: 'This week'
};

function setPageTitle() {
  const titleEl = document.getElementById('pageTitle');
  if (!titleEl) return;
  let title: string;
  if (view === 'project' && openProject) title = openProject.name;
  else if (TOOL_TITLES[view]) title = TOOL_TITLES[view];
  else if (favOnly) title = 'Favourites';
  else if (filterRoot) title = basename(filterRoot);
  else if (filterDaw) title = filterDaw;
  else if (browsing) title = basename(browsing);
  else title = 'All projects';
  titleEl.textContent = title;

  // The sort control only applies to the project list.
  const sortMount = document.getElementById('sortMount');
  if (sortMount) sortMount.style.display = view === 'list' ? '' : 'none';
  updateSortLabel();
}

function captureLocation() {
  return {
    view,
    browsing,
    openProject,
    projectTab,
    projectTool,
    filterRoot,
    filterDaw,
    favOnly,
    groupVersionsOn,
    selected,
    search: searchEl.value,
    entries,
    groupedRows,
    scrollTop: viewEl.scrollTop
  };
}

function restoreLocation(location) {
  view = location.view;
  browsing = location.browsing;
  openProject = location.openProject;
  projectTab = location.projectTab;
  projectTool = location.projectTool;
  filterRoot = location.filterRoot;
  filterDaw = location.filterDaw;
  favOnly = location.favOnly;
  groupVersionsOn = location.groupVersionsOn;
  selected = location.selected;
  searchEl.value = location.search || '';
  entries = location.entries || entries;
  groupedRows = location.groupedRows || groupedRows;
  favFilterEl.classList.toggle('is-on', favOnly);
  renderCollections();
  render();
  requestAnimationFrame(() => {
    viewEl.scrollTop = location.scrollTop || 0;
  });
}

function navigateBack() {
  const location = navigationHistory.backFrom(captureLocation());
  if (location) return restoreLocation(location);

  // Fallback for a page reached before history tracking was initialized.
  if (view !== 'list') {
    view = 'list';
    openProject = null;
    render();
    return;
  }
  if (!browsing) return;
  const parent = browsing.split(/[\\/]/).slice(0, -1).join(sep());
  const stillInside = settings.roots.some(
    (root) => parent && (parent === root || parent.startsWith(root))
  );
  browsing = stillInside ? parent : null;
  refresh();
}

function navigateForward() {
  const location = navigationHistory.forwardFrom(captureLocation());
  if (location) restoreLocation(location);
}

function goList(folder) {
  navigationHistory.visit(captureLocation());
  view = 'list';
  browsing = folder || null;
  openProject = null;
  viewEl.scrollTop = 0;
  if (browsing || entries.length === 0) {
    refresh();
  } else {
    render();
    renderCollections();
  }
}

function goProject(entry) {
  navigationHistory.visit(captureLocation());
  view = 'project';
  openProject = entry;
  activeAuditionPath = entry.path;
  projectTab = 'projectfiles';
  projectTool = null;
  renameFolder = entry.folder;
  silenceFolder = entry.folder;
  silenceResults = [];
  silenceChosen = new Set();
  qcFolder = entry.folder;
  viewEl.scrollTop = 0;
  render();
}

backBtn.addEventListener('click', navigateBack);

/* ============================== sidebar ============================ */

function renderCollections() {
  collectionsEl.innerHTML = '';

  const shown = groupVersionsOn && groupedRows.length ? groupedRows.length : entries.length;
  const all = collButton('All projects', shown, 'grid');
  if (!filterRoot && !favOnly && view !== 'thisweek') all.classList.add('is-on');
  all.addEventListener('click', () => {
    filterRoot = null;
    favOnly = false;
    goList(null);
  });
  collectionsEl.append(all);

  // What you have opened or bounced in the last seven days, at a glance. Always
  // reflects the whole catalogue, so it drops any active browse/filter state.
  const week = collButton('This week', entries.filter((e) => e.modified >= weekCutoff()).length, 'calendar');
  if (view === 'thisweek') week.classList.add('is-on');
  week.addEventListener('click', () => {
    navigationHistory.visit(captureLocation());
    filterRoot = null;
    filterDaw = null;
    favOnly = false;
    favFilterEl.classList.toggle('is-on', false);
    view = 'thisweek';
    viewEl.scrollTop = 0;
    if (browsing) {
      browsing = null;
      refresh(); // re-scan the full catalogue, then renders this view
    } else {
      render();
      renderCollections();
    }
  });
  collectionsEl.append(week);

  const favCount = entries.filter((e) => record(e.path).favourite).length;
  const favs = collButton('Favourites', favCount, 'star');
  if (favOnly) favs.classList.add('is-on');
  favs.addEventListener('click', () => {
    favOnly = !favOnly;
    favFilterEl.classList.toggle('is-on', favOnly);
    view = 'list';
    render();
    renderCollections();
  });
  collectionsEl.append(favs);

  // Keep both list modes visible. Previously this was one toggle whose label
  // changed to "Every file" when grouping was off, which made the grouping
  // feature look as though it had disappeared.
  const grouped = collButton(
    'Grouped',
    groupedRows.length || entries.length,
    'layers'
  );
  grouped.title = 'Combine numbered, bounced and autosaved versions into one project row';
  if (groupVersionsOn) grouped.classList.add('is-on');
  grouped.addEventListener('click', () => {
    groupVersionsOn = true;
    expanded = new Set();
    view = 'list';
    render();
    renderCollections();
  });
  collectionsEl.append(grouped);

  const everyFile = collButton('Every file', `${entries.length} files`, 'files');
  everyFile.title = 'Show every individual DAW project file';
  if (!groupVersionsOn) everyFile.classList.add('is-on');
  everyFile.addEventListener('click', () => {
    groupVersionsOn = false;
    expanded = new Set();
    view = 'list';
    render();
    renderCollections();
  });
  collectionsEl.append(everyFile);

  if (settings.roots.length > 0) {
    collectionsEl.append(el('div', 'coll__label', 'Folders'));
    settings.roots.forEach((root) => {
      const count = entries.filter((e) => e.root === root).length;
      const item = collButton(basename(root), count, 'folder');
      if (filterRoot === root) item.classList.add('is-on');
      item.addEventListener('click', () => {
        filterRoot = filterRoot === root ? null : root;
        view = 'list';
        render();
        renderCollections();
      });
      collectionsEl.append(item);
    });
  }

  // DAWs actually present. Never list one with zero projects.
  const daws = new Map();
  entries.forEach((entry) => {
    if (!entry.daw) return;
    daws.set(entry.daw, (daws.get(entry.daw) || 0) + 1);
  });

  if (daws.size > 1) {
    collectionsEl.append(el('div', 'coll__label', 'DAWs'));
    [...daws.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([daw, count]) => {
        const item = collButton(daw, count, 'disc');
        if (filterDaw === daw) item.classList.add('is-on');
        item.addEventListener('click', () => {
          filterDaw = filterDaw === daw ? null : daw;
          view = 'list';
          render();
          renderCollections();
        });
        collectionsEl.append(item);
      });
  }
}

function collButton(name, count, iconName?) {
  const node = el('button', 'coll');
  if (iconName) node.append(svgIcon(iconName));
  node.append(el('span', 'coll__name', name));
  node.append(el('span', 'coll__count', String(count)));
  return node;
}

/* ============================== the list =========================== */

/* ------------------------------ sorting ---------------------------- */

const SORT_OPTIONS = [
  { key: 'modified', label: 'Modified', dir: -1 },
  { key: 'name', label: 'Name', dir: 1 },
  { key: 'bpm', label: 'BPM', dir: -1 },
  { key: 'key', label: 'Key', dir: 1 },
  { key: 'saves', label: 'Saves', dir: -1 },
  { key: 'audio', label: 'Audio', dir: -1 },
  { key: 'favourite', label: 'Favourites first', dir: -1 },
  { key: 'notes', label: 'Has notes', dir: -1 }
];

// Apply a sort. Re-selecting the active column flips direction; a new column
// uses its natural default. The choice is persisted so it survives a restart.
function setSort(by, dir?) {
  if (dir === undefined) {
    dir = by === sortBy ? -sortDir : SORT_OPTIONS.find((o) => o.key === by)?.dir ?? -1;
  }
  sortBy = by;
  sortDir = dir;
  if (window.api && window.api.updateSettings) {
    window.api
      .updateSettings({ listSort: { by: sortBy, dir: sortDir } })
      .then((s) => {
        settings = s;
      });
  }
  render();
}

function buildSortMenu() {
  const mount = $('sortMount');
  if (!mount) return;
  mount.innerHTML = '';
  const btn = el('button', 'pill sortmenu__btn');
  btn.append(svgIcon('sliders', 'sortmenu__icon', 14));
  btn.append(el('span', 'sortmenu__label'));
  btn.append(el('span', 'sortmenu__caret', '▾'));

  const pop = el('div', 'sortmenu__pop');
  pop.hidden = true;
  SORT_OPTIONS.forEach((opt) => {
    const item = el('button', 'sortmenu__item');
    item.dataset.key = opt.key;
    item.append(el('span', 'sortmenu__itemlabel', opt.label));
    item.append(el('span', 'sortmenu__dir'));
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      pop.hidden = true;
      setSort(opt.key);
    });
    pop.append(item);
  });

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', () => {
    pop.hidden = true;
  });

  mount.append(btn, pop);
  updateSortLabel();
}

function updateSortLabel() {
  const mount = $('sortMount');
  if (!mount) return;
  const opt = SORT_OPTIONS.find((o) => o.key === sortBy);
  const label = mount.querySelector('.sortmenu__label');
  if (label) label.textContent = opt ? opt.label : 'Modified';
  mount.querySelectorAll('.sortmenu__item').forEach((item: any) => {
    const active = item.dataset.key === sortBy;
    item.classList.toggle('is-on', active);
    const dir = item.querySelector('.sortmenu__dir');
    if (dir) dir.textContent = active ? (sortDir === 1 ? '↑' : '↓') : '';
  });
}

function effectiveTime(entry: any): number {
  return Math.max(entry?.modified || 0, entry?.renderModified || 0, entry?.lastActivity || 0);
}

function visible() {
  const q = parseQuery(searchEl.value);
  const active = hasQuery(q);
  const source = groupVersionsOn && groupedRows.length ? groupedRows : entries;

  let list = source.filter((entry) => {
    if (filterRoot && entry.root !== filterRoot) return false;
    if (filterDaw && entry.daw !== filterDaw) return false;
    if (favOnly && !record(entry.path).favourite) return false;
    if (!active) return true;
    return matchesQuery({ ...entry, bpm: bpmFor(entry) }, record(entry.path), q);
  });

  return list.slice().sort((a, b) => {
    const ra = record(a.path);
    const rb = record(b.path);
    if (sortBy === 'name') return a.name.localeCompare(b.name) * sortDir;
    if (sortBy === 'key') {
      return (
        (ra.camelot || '~').localeCompare(rb.camelot || '~') * sortDir
      );
    }
    if (sortBy === 'bpm') return ((bpmFor(a) || 0) - (bpmFor(b) || 0)) * sortDir;
    if (sortBy === 'saves') return ((a.backupCount || 0) - (b.backupCount || 0)) * sortDir;
    if (sortBy === 'audio') return ((a.audioCount || 0) - (b.audioCount || 0)) * sortDir;
    if (sortBy === 'favourite') {
      const diff = (ra.favourite ? 1 : 0) - (rb.favourite ? 1 : 0);
      // Tie-break flagged/unflagged groups by newest first, so a "favourites
      // first" list still reads chronologically within each group.
      return diff !== 0 ? diff * sortDir : (effectiveTime(a) - effectiveTime(b)) * -1;
    }
    if (sortBy === 'notes') {
      const hasA = ra.note && ra.note.trim() ? 1 : 0;
      const hasB = rb.note && rb.note.trim() ? 1 : 0;
      return hasA !== hasB ? (hasA - hasB) * sortDir : (effectiveTime(a) - effectiveTime(b)) * -1;
    }
    return (effectiveTime(a) - effectiveTime(b)) * sortDir;
  });
}

function renderList() {
  viewEl.innerHTML = '';

  if (settings.roots.length === 0) {
    return renderEmpty(
      'Add your projects folder',
      'Open Settings and point it at the folder your sessions live in.'
    );
  }

  const list = visible();

  if (browsing) {
    const trail = el('div', 'page__kicker', browsing);
    trail.style.padding = '10px 12px 4px';
    viewEl.append(trail);
  }

  const head = el('div', 'thead');
  [
    ['Name', 'name', 'th--name'],
    ['BPM', 'bpm', ''],
    ['Key', 'key', ''],
    ['Audio', null, ''],
    ['Saves', null, 'th--health'],
    ['Modified', 'modified', '']
  ].forEach(([label, key, extra]) => {
    const th = el('span', `th ${extra}`.trim(), label);
    if (key) {
      th.dataset.sort = key;
      if (sortBy === key) th.classList.add('is-sorted');
      th.addEventListener('click', () => setSort(key));
    }
    head.append(th);
  });
  viewEl.append(head);

  if (list.length === 0) {
    return renderEmpty(
      'Nothing matches',
      searchEl.value
        ? 'No project matches that search.'
        : 'No sessions turned up in these folders.'
    );
  }

  const fragment = document.createDocumentFragment();
  list.forEach((entry) => {
    fragment.append(buildRow(entry));

    if (entry.isGroup && expanded.has(entry.path)) {
      entry.versions.forEach((version) => fragment.append(buildVersionRow(version)));
    }
  });
  viewEl.append(fragment);
}

// NOTE: buildVersionRow is referenced by the grouped-versions expand path but
// never defined — a latent ReferenceError. Aliased to buildRow (a version is
// itself a session entry) so expanding a group renders rows rather than
// throwing. Revisit when the grouping feature is built out.
function buildVersionRow(entry) {
  return buildRow(entry);
}

function buildRow(entry) {
  const rec = record(entry.path);
  const row = el('article', 'row');
  if (selected === entry.path) row.classList.add('is-selected');

  const customColor = rec.customColor;
  const projectColor = customColor
    ? { hex: customColor, ink: '#ffffff' }
    : getAbletonProjectColor(entry.sessionPath || entry.path || entry.name);

  if (currentThemeStyle() === 'ableton' || customColor) {
    const tag = el('div', 'row__ableton-tag');
    tag.style.backgroundColor = projectColor.hex;
    tag.style.color = projectColor.hex;
    row.append(tag);
  }

  const fileToDrag = entry.audioPath || entry.sessionPath || entry.path;
  const item: SelectedItem = {
    id: entry.path,
    name: entry.name,
    path: fileToDrag,
    size: entry.size,
    type: 'project'
  };

  /* name */
  const main = el('div', 'row__main');
  const line = el('div', 'row__nameline');
  line.append(createSelectHandle(item));
  line.append(el('span', 'row__name', entry.name));

  if (entry.daw) {
    const dawBadge = el('span', 'badge badge--daw', entry.daw);
    if (currentThemeStyle() === 'ableton' || customColor) {
      dawBadge.style.borderColor = `${projectColor.hex}44`;
      dawBadge.style.color = projectColor.hex;
    }
    line.append(dawBadge);
  }
  if (rec.favourite) line.append(el('span', 'badge badge--fav', 'Fav'));
  if (rec.genre) {
    const genreBadge = el('span', 'badge badge--genre', rec.genre);
    genreBadge.title = `Genre: ${rec.genre}`;
    line.append(genreBadge);
  }
  if (entry.packaged) {
    const badge = el('span', 'badge badge--packaged', 'Packaged');
    badge.title = 'A zip of the same name sits alongside — exported as a loop package';
    line.append(badge);
  }
  if (entry.isGroup && entry.versionCount > 1) {
    const open = expanded.has(entry.path);
    const badge = el(
      'button',
      'badge badge--inside',
      `${open ? '▾' : '▸'} ${entry.versionCount} variations`
    );
    badge.title = 'Every variation of this project in the same folder';
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      if (open) expanded.delete(entry.path);
      else expanded.add(entry.path);
      render();
    });
    line.append(badge);
  } else if (!entry.isGroup && entry.siblingCount > 1 && !groupVersionsOn) {
    line.append(el('span', 'badge', `${entry.siblingCount} variations in folder`));
  }
  main.append(line);
  main.append(el('div', 'row__sub', entry.location || basename(entry.root)));
  row.append(main);

  /* bpm & time signature */
  const rowBpm = bpmFor(entry);
  const rowSig = timeSignatureFor(entry);
  const bpm = el('div', 'cell cell--bpm');
  if (rowBpm !== null) {
    bpm.append(el('span', null, formatBpm(rowBpm)));
    if (rowSig) {
      const sigBadge = el('span', 'cell--sig-badge', rowSig);
      const talaInfo = DSP.TALA_MAP[rowSig] || (rec.tala ? { name: rec.tala } : null);
      if (talaInfo) sigBadge.title = talaInfo.name;
      bpm.append(sigBadge);
    }
  } else if (rowSig) {
    const sigBadge = el('span', 'cell--sig-badge', rowSig);
    const talaInfo = DSP.TALA_MAP[rowSig] || (rec.tala ? { name: rec.tala } : null);
    if (talaInfo) sigBadge.title = talaInfo.name;
    bpm.append(sigBadge);
  } else {
    bpm.textContent = activePlayAnalysis.has(entry.path) ? '…' : '—';
    bpm.classList.add('cell--empty');
  }
  row.append(bpm);

  /* key */
  if (rec.key) {
    const keyCell = el('div');
    keyCell.append(el('div', 'keycell__key', rec.key));
    if (rec.camelot) keyCell.append(el('div', 'keycell__camelot', rec.camelot));
    row.append(keyCell);
  } else if (rec.tonic && rec.scale) {
    const keyCell = el('div');
    keyCell.append(el('div', 'keycell__key', rec.tonic));
    keyCell.append(el('div', 'keycell__camelot', rec.scale));
    row.append(keyCell);
  } else if (activePlayAnalysis.has(entry.path)) {
    row.append(el('div', 'cell cell--empty', 'Analysing…'));
  } else {
    row.append(el('div', 'cell cell--empty', '—'));
  }

  /* play — disabled when the scan found no audio, rather than finding out
     after you've clicked */
  const playCell = el('div');
  const play = el('button', 'rowbtn', '▶ Play');
  play.disabled = !entry.audioCount;
  play.title = entry.audioCount
    ? `${entry.audioCount} audio file(s)`
    : 'No audio in this project';
  play.addEventListener('click', async (event) => {
    event.stopPropagation();
    await playNewest(entry);
  });
  playCell.append(play);
  row.append(playCell);

  /* saves */
  const health = el('div', 'cell--health');
  const meter = el('div', 'meter');
  const fill = el('div', 'meter__fill');
  fill.style.width = `${Math.round((entry.health || 0) * 100)}%`;
  meter.append(fill);
  health.append(meter);
  health.append(el('div', 'meter__caption', `${entry.backupCount}`));
  row.append(health);

  const rowTime = effectiveTime(entry);
  const timeCell = el('div', 'cell', timeAgo(rowTime));
  if (entry.renderModified && entry.renderModified > (entry.modified || 0)) {
    timeCell.title = `Rendered ${timeAgo(entry.renderModified)} (Saved ${timeAgo(entry.modified || 0)})`;
  }
  row.append(timeCell);

  row.addEventListener('click', () => {
    selected = entry.path;
    render();
  });
  row.addEventListener('dblclick', () =>
    goProject(entry.isGroup ? entry.versions[0] : entry)
  );
  row.title = entry.sessionPath;
  attachDraggableAndSelectable(row, item);
  return row;
}

async function playNewest(entry: any) {
  // The Play button stops the row click from bubbling. Record the project
  // explicitly so the drone follows this audio, not an older highlighted row.
  selected = entry.path;
  activeAuditionPath = entry.path;

  let file: any = null;

  // 1. Try finding renders for this specific session
  try {
    const result = await window.api.findRenders(
      entry.sessionPath,
      entry.root,
      stemsFolderFor(entry),
      siblingsOf(entry)
    );
    if (result && result.renders && result.renders.length > 0) {
      file = result.renders[0].primary || result.renders[0].files?.[0];
    }
  } catch (err) {
    console.warn('[playNewest] findRenders error:', err);
  }

  // 2. If it is a grouped project, check variations in the group
  if (!file && entry.isGroup && Array.isArray(entry.versions)) {
    for (const ver of entry.versions) {
      if (ver.sessionPath === entry.sessionPath) continue;
      try {
        const verRes = await window.api.findRenders(
          ver.sessionPath,
          ver.root || entry.root,
          stemsFolderFor(ver),
          siblingsOf(ver)
        );
        if (verRes && verRes.renders && verRes.renders.length > 0) {
          file = verRes.renders[0].primary || verRes.renders[0].files?.[0];
          if (file) break;
        }
      } catch {}
    }
  }

  // 3. Fallback: Search all audio files in the project folder and take the newest
  if (!file && entry.folder) {
    try {
      const allAudio = await window.api.listAllAudio(entry.folder);
      if (allAudio && allAudio.length > 0) {
        file = allAudio[0];
      }
    } catch {}
  }

  if (!file) {
    toast('No audio', `No render found for ${entry.name}`, true);
    return;
  }

  await Player.load(file, { autoplay: true, project: entry });
}

let isPreloadingRender = false;

async function preloadLatestRender({ autoplay = false } = {}) {
  if (Player.getCurrent() || isPreloadingRender) return;
  isPreloadingRender = true;

  try {
    // 1. If viewing a specific project, try its newest render first
    if (view === 'project' && openProject && openProject.audioCount > 0) {
      let file: any = null;
      const result = await window.api.findRenders(
        openProject.sessionPath,
        openProject.root,
        stemsFolderFor(openProject),
        siblingsOf(openProject)
      );
      if (result && result.renders && result.renders.length > 0) {
        file = result.renders[0].primary || result.renders[0].files?.[0];
      }
      if (!file && openProject.folder) {
        const allAudio = await window.api.listAllAudio(openProject.folder);
        if (allAudio && allAudio.length > 0) file = allAudio[0];
      }
      if (file) {
        selected = openProject.path;
        activeAuditionPath = openProject.path;
        await Player.load(file, { autoplay, project: openProject });
        return;
      }
    }

    // 2. Otherwise find the top project in the list (newest first) and load its newest render
    const candidates = (entries || []).filter((e) => e.audioCount > 0);
    for (const entry of candidates) {
      if (Player.getCurrent()) return;
      let file: any = null;
      const result = await window.api.findRenders(
        entry.sessionPath,
        entry.root,
        stemsFolderFor(entry),
        siblingsOf(entry)
      );
      if (result && result.renders && result.renders.length > 0) {
        file = result.renders[0].primary || result.renders[0].files?.[0];
      }
      if (!file && entry.isGroup && Array.isArray(entry.versions)) {
        for (const ver of entry.versions) {
          const verRes = await window.api.findRenders(
            ver.sessionPath,
            ver.root || entry.root,
            stemsFolderFor(ver),
            siblingsOf(ver)
          );
          if (verRes && verRes.renders && verRes.renders.length > 0) {
            file = verRes.renders[0].primary || verRes.renders[0].files?.[0];
            if (file) break;
          }
        }
      }
      if (!file && entry.folder) {
        const allAudio = await window.api.listAllAudio(entry.folder);
        if (allAudio && allAudio.length > 0) file = allAudio[0];
      }
      if (file) {
        selected = entry.path;
        activeAuditionPath = entry.path;
        await Player.load(file, { autoplay, project: entry });
        return;
      }
    }
  } catch (err) {
    console.warn('[preloadLatestRender] Error preloading render:', err);
  } finally {
    isPreloadingRender = false;
  }
}

/** Other session files sitting in the same folder. */
function siblingsOf(entry) {
  return entries
    .filter((other) => other.folder === entry.folder && other.path !== entry.path)
    .map((other) => other.name);
}

function stemsFolderFor(entry) {
  const rec = record(entry.path);
  return rec.stemsPath ? [rec.stemsPath] : [];
}

/* ==================================================================
   Camelot Interactive Modal & Scale Inspector
   ================================================================== */

let _audioCtx: AudioContext | null = null;
let _audioCtxSuspendTimer: any = null;

function scheduleAudioContextIdleSuspend() {
  if (_audioCtxSuspendTimer) clearTimeout(_audioCtxSuspendTimer);
  _audioCtxSuspendTimer = setTimeout(() => {
    if (_audioCtx && _audioCtx.state === 'running' && !currentScaleSession && !activeChordGain) {
      _audioCtx.suspend().catch(() => {});
    }
  }, 2500);
}

function getAudioContext(): AudioContext | null {
  if (_audioCtxSuspendTimer) {
    clearTimeout(_audioCtxSuspendTimer);
    _audioCtxSuspendTimer = null;
  }
  if (!_audioCtx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) _audioCtx = new AudioCtx();
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

interface ScalePlaybackSession {
  id: string;
  timers: ReturnType<typeof setTimeout>[];
  nodes: Array<{ osc: OscillatorNode; gain: GainNode }>;
  onStop: (() => void) | null;
}

let currentScaleSession: ScalePlaybackSession | null = null;

function isScalePlaying(id?: string): boolean {
  if (!currentScaleSession) return false;
  if (id !== undefined) return currentScaleSession.id === id;
  return true;
}

let activeChordGain: GainNode | null = null;
let activeChordOscs: OscillatorNode[] = [];

function stopActiveChord(fadeSec = 0.045): void {
  if (!activeChordGain) return;
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      activeChordGain.gain.cancelScheduledValues(now);
      const currentVal = Math.max(0.0001, activeChordGain.gain.value);
      activeChordGain.gain.setValueAtTime(currentVal, now);
      activeChordGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      const oscs = activeChordOscs;
      setTimeout(() => {
        oscs.forEach((osc) => {
          try {
            osc.stop();
            osc.disconnect();
          } catch (_) {}
        });
        scheduleAudioContextIdleSuspend();
      }, Math.ceil(fadeSec * 1000) + 15);
    }
  } catch (_) {}
  activeChordGain = null;
  activeChordOscs = [];
}

function stopScalePlayback() {
  stopActiveChord(0.045);
  if (!currentScaleSession) {
    scheduleAudioContextIdleSuspend();
    return;
  }
  const sess = currentScaleSession;
  currentScaleSession = null;
  sess.timers.forEach((t) => clearTimeout(t));
  sess.timers = [];
  const ctx = getAudioContext();
  const now = ctx ? ctx.currentTime : 0;
  sess.nodes.forEach(({ osc, gain }) => {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.04);
      osc.stop(now + 0.05);
    } catch (_) {}
  });
  sess.nodes = [];
  if (sess.onStop) {
    try { sess.onStop(); } catch (_) {}
  }
  scheduleAudioContextIdleSuspend();
}

function playSynthNote(pc: number, octave = 4, a4 = 440, duration = 0.85): { osc: OscillatorNode; gain: GainNode } | null {
  try {
    const ctx = getAudioContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const midi = 12 * (octave + 1) + pc;
    const freq = a4 * Math.pow(2, (midi - 69) / 12);

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.025);
    gain.gain.linearRampToValueAtTime(0.22, now + duration * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    setTimeout(() => scheduleAudioContextIdleSuspend(), Math.ceil(duration * 1000) + 100);
    return { osc, gain };
  } catch (err) {
    console.error('Audio synth error:', err);
    return null;
  }
}

function playSynthChord(midiNotes: number[], a4 = 440, duration = 1.35): void {
  try {
    const ctx = getAudioContext();
    if (!ctx || !midiNotes || midiNotes.length === 0) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Smoothly de-click & fade out any previously playing chord before starting the new one
    stopActiveChord(0.045);

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    const gainPerNote = 0.28 / Math.sqrt(midiNotes.length);
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(gainPerNote, now + 0.035);
    masterGain.gain.linearRampToValueAtTime(gainPerNote * 0.75, now + duration * 0.4);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(ctx.destination);

    activeChordGain = masterGain;
    activeChordOscs = [];

    midiNotes.forEach((midi) => {
      const freq = a4 * Math.pow(2, (midi - 69) / 12);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(masterGain);
      osc.start(now);
      osc.stop(now + duration + 0.06);
      activeChordOscs.push(osc);
    });
    setTimeout(() => scheduleAudioContextIdleSuspend(), Math.ceil(duration * 1000) + 100);
  } catch (err) {
    console.error('Chord synth error:', err);
  }
}


function playFullScale(tonicPc: number, degrees: number[], a4 = 440, id = 'full-scale', onDone?: () => void): boolean {
  if (isScalePlaying(id)) {
    stopScalePlayback();
    return false;
  }
  stopScalePlayback();
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const session: ScalePlaybackSession = {
    id,
    timers: [],
    nodes: [],
    onStop: onDone || null
  };
  currentScaleSession = session;

  degrees.forEach((interval, idx) => {
    const notePc = (tonicPc + interval) % 12;
    const octave = interval < 12 ? (notePc < tonicPc ? 5 : 4) : (4 + Math.floor(interval / 12));
    const t = setTimeout(() => {
      if (currentScaleSession !== session) return;
      const noteResult = playSynthNote(notePc, octave, a4, 0.75);
      if (noteResult) session.nodes.push(noteResult);
    }, idx * 440);
    session.timers.push(t);
  });

  const finalT = setTimeout(() => {
    if (currentScaleSession !== session) return;
    const noteResult = playSynthNote(tonicPc, 5, a4, 1.2);
    if (noteResult) session.nodes.push(noteResult);
    const finishT = setTimeout(() => {
      if (currentScaleSession === session) {
        stopScalePlayback();
      }
    }, 1250);
    session.timers.push(finishT);
  }, degrees.length * 440);
  session.timers.push(finalT);
  return true;
}

function playRagaSequence(tonicPc: number, aarohanaDegrees: number[], avarohanaDegrees: number[], a4 = 440, id = 'raga-seq', onDone?: () => void): boolean {
  if (isScalePlaying(id)) {
    stopScalePlayback();
    return false;
  }
  stopScalePlayback();
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const fullSeq = [...aarohanaDegrees, ...avarohanaDegrees];
  const session: ScalePlaybackSession = {
    id,
    timers: [],
    nodes: [],
    onStop: onDone || null
  };
  currentScaleSession = session;

  fullSeq.forEach((deg, idx) => {
    const notePc = (tonicPc + deg) % 12;
    const octave = 4 + Math.floor((tonicPc + deg) / 12);
    const t = setTimeout(() => {
      if (currentScaleSession !== session) return;
      const noteResult = playSynthNote(notePc, octave, a4, 0.65);
      if (noteResult) session.nodes.push(noteResult);
    }, idx * 360);
    session.timers.push(t);
  });

  const finishT = setTimeout(() => {
    if (currentScaleSession === session) {
      stopScalePlayback();
    }
  }, fullSeq.length * 360 + 700);
  session.timers.push(finishT);
  return true;
}

/* ==================================================================
   Scale Change & Modulation Detector Functions
   ================================================================== */

const projectScaleModCache = new Map<string, ScaleModulationReport>();

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderScaleModBar(report: ScaleModulationReport | null, entry?: any) {
  const barEl = $('scaleModBar');
  if (!barEl) return;

  if (!report || !report.segments || report.segments.length === 0) {
    barEl.style.display = 'none';
    barEl.innerHTML = '';
    return;
  }

  barEl.style.display = 'flex';
  barEl.innerHTML = '';

  report.segments.forEach((seg, idx) => {
    const segEl = el('div', 'scale-mod-segment');
    segEl.style.width = `${seg.percentWidth}%`;
    segEl.style.backgroundColor = seg.badgeBg;
    segEl.style.borderBottom = `2px solid ${seg.color}`;

    let titleText = `Section ${idx + 1}: ${seg.key || seg.note || 'Scale'} (${fmtClock(seg.startSec)} – ${fmtClock(seg.endSec)})`;
    if (seg.transitionFromPrev) {
      titleText += ` · ${seg.transitionFromPrev.type} (${seg.transitionFromPrev.shiftLabel})`;
    }
    titleText += ' — Click to seek · Double-click or Right-click to inspect';
    segEl.title = titleText;

    const label = el('span', 'scale-mod-segment__label');
    label.style.color = seg.textColor;

    const keySpan = el('span', 'scale-mod-segment__key', seg.key || seg.note || 'Scale');
    const timeSpan = el('span', 'scale-mod-segment__time', `${fmtClock(seg.startSec)}–${fmtClock(seg.endSec)}`);
    label.append(keySpan, timeSpan);

    if (seg.transitionFromPrev) {
      const tag = el('span', 'scale-mod-segment__tag', seg.transitionFromPrev.shiftLabel);
      tag.title = seg.transitionFromPrev.type;
      label.append(tag);
    }

    segEl.append(label);

    // Single click → seek to section for quick auditioning
    segEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      Player.seek(seg.startSec);
    });

    // Double-click OR right-click → open Scale & Modulation Inspector
    segEl.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      openScaleModulationModal(seg, report, entry);
    });
    segEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openScaleModulationModal(seg, report, entry);
    });

    barEl.append(segEl);
  });
}

function openScaleModulationModal(segment: ScaleSegment, report: ScaleModulationReport, entry?: any) {
  document.querySelectorAll('.scale-mod-modal-overlay').forEach((n) => n.remove());

  const overlay = el('div', 'scale-mod-modal-overlay');
  const dialog = el('div', 'scale-mod-modal');

  // Header
  const header = el('div', 'scale-mod-modal__header');
  const titles = el('div');
  const title = el('h2', 'scale-mod-modal__title');
  title.innerHTML = `🎼 Scale &amp; Modulation Inspector <span style="font-size:13px; font-weight:normal; opacity:0.85; color:${segment.textColor};">(${segment.key || segment.note})</span>`;
  const sub = el('p', 'scale-mod-modal__subtitle', `Section Timestamp: ${fmtClock(segment.startSec)} – ${fmtClock(segment.endSec)} (${Math.round(segment.durationSec)}s) · Track Total: ${Math.round(report.duration)}s`);
  titles.append(title, sub);

  const closeBtn = el('button', 'scale-mod-modal__close', '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(titles, closeBtn);
  dialog.append(header);

  // Body
  const body = el('div', 'scale-mod-modal__body');

  // Main Card
  const mainCard = el('div', 'scale-mod-inspect-card');
  const row1 = el('div', 'scale-mod-inspect__row');

  const badge = el('div', 'scale-mod-pill-badge');
  badge.style.background = segment.badgeBg;
  badge.style.color = segment.textColor;
  badge.style.border = `1px solid ${segment.color}`;
  badge.innerHTML = `<strong>${segment.key || segment.note || 'Detected Scale'}</strong> ${segment.camelot ? `(${segment.camelot})` : ''} · ${segment.mode === 'maj' ? '☀️ Bright Major' : '🌙 Deep Minor'}`;

  const auditionBtn = el('button', 'pill pill--solid pill--sm', '▶ Audition Section');
  auditionBtn.title = 'Play audio starting at this section timestamp';
  auditionBtn.addEventListener('click', () => {
    Player.seek(segment.startSec);
    Player.toggle();
  });

  row1.append(badge, auditionBtn);
  mainCard.append(row1);

  // Transition banner if this section modulated from previous
  if (segment.transitionFromPrev) {
    const banner = el('div');
    banner.style.padding = '8px 12px';
    banner.style.borderRadius = '6px';
    banner.style.background = 'color-mix(in srgb, var(--amber) 15%, transparent)';
    banner.style.border = '1px solid var(--amber)';
    banner.style.fontSize = '12px';
    banner.style.color = 'var(--text)';
    banner.innerHTML = `⚡ <strong>${segment.transitionFromPrev.type}</strong>: <code>${segment.transitionFromPrev.shiftLabel}</code> ${segment.transitionFromPrev.camelotShift ? `· Camelot Shift: <strong>${segment.transitionFromPrev.camelotShift}</strong>` : ''}`;
    mainCard.append(banner);
  }

  body.append(mainCard);

  // Relative Indian Classical Raagas & World Scales section
  const raagasHead = el('div');
  raagasHead.style.display = 'flex';
  raagasHead.style.alignItems = 'center';
  raagasHead.style.justifyContent = 'space-between';
  raagasHead.style.marginTop = '4px';

  const raagasTitle = el('h3', null, 'Relative Raagas & Scales in this Section');
  raagasTitle.style.margin = '0';
  raagasTitle.style.fontSize = '13.5px';
  raagasTitle.style.color = 'var(--text)';
  raagasHead.append(raagasTitle);
  body.append(raagasHead);

  if (segment.ragas && segment.ragas.length > 0) {
    const list = el('div', 'scale-mod-raagas-list');
    segment.ragas.slice(0, 6).forEach((raga) => {
      const item = el('div', 'scale-mod-raga-item');
      const itemHead = el('div', 'scale-mod-raga-item__head');
      const name = el('span', 'scale-mod-raga-item__name', raga.name);
      const pct = el('span', 'scale-mod-raga-item__pct', `${raga.matchPercent}% match`);
      itemHead.append(name, pct);

      const sargam = el('div', 'scale-mod-raga-item__sargam', `Aarohana: ${raga.aarohana || raga.sargam || '—'}`);
      const meta = el('div', 'scale-mod-raga-item__meta', `Thaat: ${raga.thaat} · Mood: ${raga.mood || 'Classic'} · Time: ${raga.time || 'Anytime'}`);

      item.append(itemHead, sargam, meta);
      list.append(item);
    });
    body.append(list);
  } else {
    const emptyMsg = el('p', 'muted', 'No specific regional scale suggestions mapped for this window.');
    emptyMsg.style.fontSize = '12px';
    body.append(emptyMsg);
  }

  dialog.append(body);
  overlay.append(dialog);

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  document.body.append(overlay);
}

function renderFretboardSvg(
  tonicPc: number,
  degrees: number[],
  selectedTuningA4 = 440,
  onNoteClick?: (note: FretNote) => void
): SVGElement & { vibrateString: (strIdx: number) => void; vibrateNote: (notePc: number) => void } {
  const fb = fretboardLayoutFn(12, 560, 114);
  const highlightedNotes = fretboardHighlightFn(fb.notes, tonicPc, degrees);
  const svgNS = 'http://www.w3.org/2000/svg';

  const svgFb = document.createElementNS(svgNS, 'svg') as any;
  svgFb.setAttribute('class', 'scale-fretboard');
  svgFb.setAttribute('viewBox', `0 0 ${fb.width} ${fb.height}`);
  svgFb.setAttribute('width', '100%');
  svgFb.setAttribute('height', '114');

  // 1. Fretboard body slab
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', '36');
  bg.setAttribute('y', '6');
  bg.setAttribute('width', String(fb.width - 36 - 12));
  bg.setAttribute('height', String(fb.height - 18));
  bg.setAttribute('rx', '4');
  bg.setAttribute('class', 'fretboard-wood');
  svgFb.appendChild(bg);

  // 2. Nut (fret 0 separator)
  const nut = document.createElementNS(svgNS, 'rect');
  nut.setAttribute('x', '33');
  nut.setAttribute('y', '5');
  nut.setAttribute('width', '5');
  nut.setAttribute('height', String(fb.height - 16));
  nut.setAttribute('rx', '1.5');
  nut.setAttribute('class', 'fretboard-nut');
  svgFb.appendChild(nut);

  // 3. Fret wires & Fret numbers
  fb.frets.forEach((f) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(f.x));
    line.setAttribute('y1', '6');
    line.setAttribute('x2', String(f.x));
    line.setAttribute('y2', String(fb.height - 12));
    line.setAttribute('class', 'fretboard-wire');
    svgFb.appendChild(line);

    // Fret number label below fretboard
    if ([1, 3, 5, 7, 9, 12].includes(f.fret)) {
      const fretNum = document.createElementNS(svgNS, 'text');
      const fretCenterX = f.fret === 1 ? (36 + f.x) / 2 : (f.x - f.width / 2);
      fretNum.setAttribute('x', String(fretCenterX));
      fretNum.setAttribute('y', String(fb.height - 1));
      fretNum.setAttribute('text-anchor', 'middle');
      fretNum.setAttribute('class', 'fretboard-num');
      fretNum.textContent = String(f.fret);
      svgFb.appendChild(fretNum);
    }
  });

  // 4. Inlay markers (3, 5, 7, 9, 12)
  fb.inlays.forEach((inlay) => {
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', String(inlay.x));
    dot.setAttribute('cy', String(inlay.y));
    dot.setAttribute('r', inlay.double ? '3' : '4');
    dot.setAttribute('class', 'fretboard-inlay');
    svgFb.appendChild(dot);
  });

  // 5. Strings
  fb.strings.forEach((str) => {
    // Open string name label at left
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', '16');
    label.setAttribute('y', String(str.y + 3.5));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'fretboard-string-label');
    label.textContent = str.name.slice(0, 1);
    svgFb.appendChild(label);

    const sLine = document.createElementNS(svgNS, 'line');
    sLine.setAttribute('x1', '28');
    sLine.setAttribute('y1', String(str.y));
    sLine.setAttribute('x2', String(fb.width - 14));
    sLine.setAttribute('y2', String(str.y));
    sLine.setAttribute('stroke-width', String(str.gauge));
    sLine.setAttribute('class', `fretboard-string fretboard-string--${str.index}`);
    svgFb.appendChild(sLine);
  });

  function vibrateString(strIdx: number) {
    const line = svgFb.querySelector(`.fretboard-string--${strIdx}`);
    if (line) {
      line.classList.remove('is-vibrating');
      (line as any).clientLeft;
      line.classList.add('is-vibrating');
      line.addEventListener('animationend', () => line.classList.remove('is-vibrating'), { once: true });
    }
  }

  function pluckNoteGroup(group: SVGElement) {
    if (group) {
      group.classList.remove('is-plucked');
      (group as any).clientLeft;
      group.classList.add('is-plucked');
      group.addEventListener('animationend', () => group.classList.remove('is-plucked'), { once: true });
    }
  }

  function vibrateNote(notePc: number) {
    const matching = fb.notes.filter((n) => n.pc === notePc && n.state !== 'out');
    if (matching.length > 0) {
      matching.forEach((n) => {
        vibrateString(n.stringIndex);
        const g = svgFb.querySelector(`[data-note-pc="${n.pc}"][data-string-idx="${n.stringIndex}"][data-fret="${n.fret}"]`);
        if (g) pluckNoteGroup(g as SVGElement);
      });
    } else {
      vibrateString(0);
    }
  }

  // 6. Scale & Tonic Notes
  highlightedNotes.forEach((note) => {
    if (note.state === 'out') return;

    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('class', `fret-note-group fret-note--${note.state}`);
    group.setAttribute('data-note-pc', String(note.pc));
    group.setAttribute('data-string-idx', String(note.stringIndex));
    group.setAttribute('data-fret', String(note.fret));
    group.style.cursor = 'pointer';

    const ripple = document.createElementNS(svgNS, 'circle');
    ripple.setAttribute('cx', String(note.x));
    ripple.setAttribute('cy', String(note.y));
    ripple.setAttribute('r', '8');
    ripple.setAttribute('class', 'fret-note-ripple');
    group.appendChild(ripple);

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(note.x));
    circle.setAttribute('cy', String(note.y));
    circle.setAttribute('r', note.fret === 0 ? '7.5' : '8.5');
    circle.setAttribute('class', `fret-note-circle fret-note-circle--${note.state}`);
    group.appendChild(circle);

    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('x', String(note.x));
    txt.setAttribute('y', String(note.y + 3));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('class', 'fret-note-text');
    txt.textContent = note.name;
    group.appendChild(txt);

    const interval = ((note.pc - tonicPc) % 12 + 12) % 12;
    const degName = DEGREE_NAMES[interval] || '';
    const sargam = SARGAM_NAMES[interval] || '';
    group.innerHTML += `<title>${note.name} (${degName}${sargam ? ` · ${sargam}` : ''}) — String ${note.stringIndex + 1} (${note.stringName}), Fret ${note.fret}</title>`;

    group.addEventListener('click', (e) => {
      e.stopPropagation();
      playSynthNote(note.pc, note.octave, selectedTuningA4);
      pluckNoteGroup(group);
      vibrateString(note.stringIndex);
      if (onNoteClick) onNoteClick(note);
    });

    svgFb.appendChild(group);
  });

  svgFb.vibrateString = vibrateString;
  svgFb.vibrateNote = vibrateNote;
  return svgFb;
}

function openCamelotModal(entry: any, rec: any, projectBpm: number | null) {
  document.querySelectorAll('.camelot-modal-overlay').forEach((node) => node.remove());

  const overlay = el('div', 'modal-overlay camelot-modal-overlay');
  const dialog = el('div', 'camelot-modal');

  // Header
  const header = el('div', 'camelot-modal__header');
  const titleGroup = el('div', 'camelot-modal__titles');
  titleGroup.append(el('h2', 'camelot-modal__title', 'Camelot Harmonic Wheel & Scale Inspector'));

  let subtitleText = entry.name;
  if (rec.key) subtitleText += ` · Detected: ${rec.key}${rec.camelot ? ` (${rec.camelot})` : ''}`;
  else if (rec.tonic && rec.scale) subtitleText += ` · Detected: ${rec.tonic} ${rec.scale}`;
  if (rec.tuningA4 && rec.tuningA4 !== 440) {
    subtitleText += ` · Concert Pitch: A4 = ${rec.tuningA4} Hz (${rec.tuningCents > 0 ? '+' : ''}${rec.tuningCents}c)`;
  }
  titleGroup.append(el('p', 'camelot-modal__subtitle', subtitleText));
  header.append(titleGroup);

  const closeBtn = el('button', 'round camelot-modal__close', '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(closeBtn);
  dialog.append(header);

  // Body
  const body = el('div', 'camelot-modal__body');

  let selectedCode = rec.camelot || (rec.tonic && rec.scale === 'major' ? codeFor(rec.tonic, 'maj') : codeFor(rec.tonic, 'min')) || '8A';
  let selectedTonic = rec.tonic || CAMELOT_KEYS[selectedCode] || 'A';
  let selectedScale = rec.scale || (selectedCode.endsWith('B') ? 'major' : 'minor');
  let baseKeyScale = selectedScale;
  const selectedTuningA4 = rec.tuningA4 || 440;

  const inspectorCol = el('div', 'camelot-modal__inspector');

  function updateInspector() {
    inspectorCol.innerHTML = '';

    const tonicPc = DSP.NOTES.indexOf(selectedTonic);
    const degrees = DSP.SCALES[selectedScale] || (selectedCode.endsWith('B') ? DSP.SCALES.major : DSP.SCALES.minor);
    const thaat = DSP.THAAT_MAP[selectedScale] || (selectedCode.endsWith('B') ? 'Bilawal (Major)' : 'Asavari (Natural Minor)');
    const comp = camelotCompatible(selectedCode);

    // Inspector Top Card: Instruments & Visualizers
    const topCard = el('div', 'scale-inspect-card');
    const headerRow = el('div', 'scale-inspect__header');

    const keyBadge = el('div', 'scale-inspect__key-badge');
    keyBadge.append(el('span', 'scale-inspect__camelot-num', selectedCode));
    keyBadge.append(el('span', 'scale-inspect__key-name', `${selectedTonic} ${selectedScale === 'major' ? 'Major' : selectedScale === 'minor' ? 'Minor' : selectedScale}`));
    headerRow.append(keyBadge);

    const thaatBadge = el('div', 'scale-inspect__thaat-badge', thaat);
    headerRow.append(thaatBadge);
    topCard.append(headerRow);

    // 1. 2-octave Interactive Piano Keyboard
    const kb = kbLayoutFn(2, 19, 70);
    const highlightedKeys = kbHighlightFn(kb.keys, tonicPc, degrees);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgKb = document.createElementNS(svgNS, 'svg');
    svgKb.setAttribute('class', 'scale-inspect__keyboard');
    svgKb.setAttribute('viewBox', `0 0 ${kb.width} ${kb.height}`);
    svgKb.setAttribute('width', '100%');
    svgKb.setAttribute('height', '76');

    highlightedKeys.filter((k) => k.type === 'white').forEach((k) => {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(k.x));
      rect.setAttribute('y', String(k.y));
      rect.setAttribute('width', String(k.width - 1));
      rect.setAttribute('height', String(k.height));
      rect.setAttribute('rx', '3');
      rect.setAttribute('class', `scale-key scale-key--white scale-key--${k.state}`);
      const degInterval = ((k.pc - tonicPc) % 12 + 12) % 12;
      const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
      const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
      rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
      rect.addEventListener('click', () => {
        playSynthNote(k.pc, 4 + k.octave, selectedTuningA4);
        if (svgFb && svgFb.vibrateNote) svgFb.vibrateNote(k.pc);
      });
      svgKb.appendChild(rect);
    });

    highlightedKeys.filter((k) => k.type === 'black').forEach((k) => {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(k.x));
      rect.setAttribute('y', String(k.y));
      rect.setAttribute('width', String(k.width));
      rect.setAttribute('height', String(k.height));
      rect.setAttribute('rx', '3');
      rect.setAttribute('class', `scale-key scale-key--black scale-key--${k.state}`);
      const degInterval = ((k.pc - tonicPc) % 12 + 12) % 12;
      const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
      const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
      rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
      rect.addEventListener('click', () => {
        playSynthNote(k.pc, 4 + k.octave, selectedTuningA4);
        if (svgFb && svgFb.vibrateNote) svgFb.vibrateNote(k.pc);
      });
      svgKb.appendChild(rect);
    });
    topCard.append(svgKb);

    // 2. 6-String Interactive Guitar Fretboard
    const svgFb = renderFretboardSvg(tonicPc, degrees, selectedTuningA4);
    topCard.append(svgFb);
    inspectorCol.append(topCard);

    // 3. Centered & Expanded Scale Degrees & Indian Sargam Solfege Card
    const notesSection = el('div', 'scale-notes-section');
    const notesSecHead = el('div', 'scale-notes__header');
    notesSecHead.append(el('h4', 'scale-notes__title', 'Scale Notes & Sargam Solfege'));
    notesSecHead.append(el('span', 'scale-notes__sub', `${degrees.length} Notes in Scale · Tuning A4 = ${selectedTuningA4.toFixed(1)} Hz`));
    notesSection.append(notesSecHead);

    const notesGrid = el('div', 'scale-notes-grid');
    degrees.forEach((deg, idx) => {
      const notePc = (tonicPc + deg) % 12;
      const noteName = DSP.NOTES[notePc];
      const sargamName = SARGAM_NAMES[deg] || '–';
      const degName = DEGREE_NAMES[idx] || `${idx + 1}`;
      const octave = idx === 0 || deg < 12 ? 4 : 5;
      const freq = (selectedTuningA4 * Math.pow(2, (notePc - 9 + (octave - 4) * 12) / 12)).toFixed(1);

      const noteCard = el('button', `note-badge ${idx === 0 ? 'note-badge--tonic' : ''}`);
      noteCard.title = `Click to play ${noteName} (${sargamName} · ${degName} · ${freq} Hz)`;
      noteCard.append(el('div', 'note-badge__name', noteName));
      noteCard.append(el('div', 'note-badge__sargam', sargamName));
      noteCard.append(el('div', 'note-badge__degree', degName));
      noteCard.append(el('div', 'note-badge__freq', `${freq} Hz`));
      noteCard.addEventListener('click', () => {
        playSynthNote(notePc, octave, selectedTuningA4);
        if (svgFb && svgFb.vibrateNote) svgFb.vibrateNote(notePc);
      });
      notesGrid.append(noteCard);
    });
    notesSection.append(notesGrid);
    inspectorCol.append(notesSection);

    // World Musical Traditions & Scales Explorer Box
    const baseDegrees = DSP.SCALES[baseKeyScale] || (selectedCode.endsWith('B') ? DSP.SCALES.major : DSP.SCALES.minor);
    const ragaChroma = new Float64Array(12);
    baseDegrees.forEach((d) => {
      ragaChroma[(tonicPc + d) % 12] = 1.0;
    });

    const userPrefTradition: ScaleTraditionId = (settings && settings.region) || 'indian';
    let activeTraditionTab: ScaleTraditionId = userPrefTradition === 'indian' ? 'all' : userPrefTradition;

    const worldSection = el('div', 'scale-ragas-section scale-world-section');
    
    // Header row with tabs
    const worldHeader = el('div', 'scale-world-header');
    worldHeader.append(el('h4', 'scale-notes__title', 'World Musical Traditions & Scale Suggestions'));

    const tabsRow = el('div', 'scale-tradition-tabs');
    const tabOptions: { id: ScaleTraditionId; label: string }[] = [
      { id: 'all', label: '✨ All Traditions' },
      { id: 'indian', label: '🇮🇳 Indian Raagas' },
      { id: 'arabic', label: '🇪🇬 Arabic Maqamat' },
      { id: 'chinese', label: '🇨🇳 Chinese & East Asian' },
      { id: 'western', label: '🌐 Western & Jazz' },
      { id: 'mediterranean', label: '🇪🇸 Mediterranean' }
    ];

    const ragasGrid = el('div', 'scale-ragas-grid scale-world-grid');

    function renderWorldCards(tabId: ScaleTraditionId) {
      ragasGrid.innerHTML = '';
      const matchedScales = findMatchingWorldScales(ragaChroma, tonicPc, tabId, 12);

      matchedScales.forEach((scaleMatch: ScoredWorldScale) => {
        const isCurrent = selectedScale === scaleMatch.id || selectedScale === scaleMatch.name.toLowerCase();
        const card = el('div', `raga-card ${isCurrent ? 'raga-card--active' : ''}`);

        const top = el('div', 'raga-card__header');
        const regionMeta = WORLD_REGIONS.find((r) => r.id === scaleMatch.tradition);
        const flagStr = regionMeta ? regionMeta.flag : '🌐';

        top.append(el('span', 'raga-card__name', `${flagStr} ${scaleMatch.name}`));
        top.append(el('span', 'raga-card__pct', `${scaleMatch.matchPercent}% Match`));
        card.append(top);

        const sub = el('div', 'raga-card__thaat', `${scaleMatch.subCategory || scaleMatch.tradition}${scaleMatch.nativeName ? ` · ${scaleMatch.nativeName}` : ''}`);
        card.append(sub);

        if (scaleMatch.phraseNotation) {
          if (scaleMatch.phraseNotation.ascending) {
            const ascRow = el('div', 'raga-card__phrase raga-card__phrase--aaroh');
            ascRow.append(el('span', 'raga-phrase__tag', '▲ Asc:'));
            ascRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.ascending));
            card.append(ascRow);
          }
          if (scaleMatch.phraseNotation.descending) {
            const descRow = el('div', 'raga-card__phrase raga-card__phrase--avaroh');
            descRow.append(el('span', 'raga-phrase__tag', '▼ Desc:'));
            descRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.descending));
            card.append(descRow);
          }
        }

        if (scaleMatch.mood || scaleMatch.timeOfDay || scaleMatch.suggestedRhythm) {
          const metaRow = el('div', 'raga-card__meta');
          if (scaleMatch.timeOfDay) metaRow.append(el('span', 'raga-card__time', `🕒 ${scaleMatch.timeOfDay}`));
          if (scaleMatch.mood) metaRow.append(el('span', 'raga-card__mood', `✨ ${scaleMatch.mood}`));
          if (scaleMatch.suggestedRhythm) metaRow.append(el('span', 'raga-card__rhythm', `🥁 ${scaleMatch.suggestedRhythm.split('/')[0]}`));
          card.append(metaRow);
        }

        // Actions: Audition & Drag MIDI
        const actions = el('div', 'raga-card__actions');

        const cardSessionId = `camelot-world-card-${scaleMatch.id || scaleMatch.name}`;
        let currentResetModalScaleUi: (() => void) | null = null;
        const resetPreviewBtn = () => {
          previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
          previewBtn.classList.remove('pill--solid');
        };

        const previewBtn = el('button', 'pill pill--sm raga-btn--preview');
        previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
        previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isScalePlaying(cardSessionId)) {
            stopScalePlayback();
            resetPreviewBtn();
            return;
          }
          document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
            b.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
            b.classList.remove('pill--solid');
          });
          if (typeof currentResetModalScaleUi === 'function') currentResetModalScaleUi();
          previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
          previewBtn.classList.add('pill--solid');
          const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
          const desc = scaleMatch.descendingPhrase || [...asc].reverse();
          playRagaSequence(tonicPc, asc, desc, selectedTuningA4, cardSessionId, resetPreviewBtn);
        });
        actions.append(previewBtn);

        const midiBtn = el('button', 'pill pill--sm pill--solid raga-btn--midi');
        midiBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="raga-btn__icon"><path d="M12 3v13M7 11l5 5 5-5M4 20h16"/></svg><span>Drag to DAW</span>`;
        midiBtn.title = 'Drag onto any DAW track or click to export MIDI containing scale phrasing';
        const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const desc = scaleMatch.descendingPhrase || [...asc].reverse();
        const rMidiBytes = generateWorldScaleMidi(tonicPc, asc, desc, { bpm: projectBpm || 120 });
        const cleanName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const rMidiFileName = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Scale_${cleanName}_${selectedTonic}.mid`;

        midiBtn.draggable = true;
        midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', rMidiFileName);
            e.dataTransfer.effectAllowed = 'copy';
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            e.dataTransfer.setDragImage(canvas, 0, 0);
          }
          if (window.api.dragMidi) await window.api.dragMidi(rMidiFileName, Array.from(rMidiBytes));
        });
        midiBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (window.api.saveMidi) {
            const saved = await window.api.saveMidi(rMidiFileName, Array.from(rMidiBytes));
            if (saved) toast('Scale MIDI exported', saved);
          } else {
            const blob = new Blob([rMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = rMidiFileName;
            a.click();
            URL.revokeObjectURL(url);
            toast('Scale MIDI exported', rMidiFileName);
          }
        });
        actions.append(midiBtn);
        card.append(actions);

        card.title = `Click to load ${scaleMatch.name} on the keyboard`;
        card.addEventListener('click', () => {
          stopScalePlayback();
          selectedScale = scaleMatch.id || scaleMatch.name.toLowerCase();
          if (scaleMatch.degrees) {
            DSP.SCALES[scaleMatch.id] = scaleMatch.degrees;
            DSP.SCALES[scaleMatch.name.toLowerCase()] = scaleMatch.degrees;
            DSP.THAAT_MAP[scaleMatch.id] = `${scaleMatch.subCategory || scaleMatch.tradition} (${scaleMatch.name})`;
          }
          updateInspector();
          const ascP = scaleMatch.ascendingPhrase || scaleMatch.degrees;
          const descP = scaleMatch.descendingPhrase || [...ascP].reverse();
          playRagaSequence(tonicPc, ascP, descP, selectedTuningA4);
        });

        ragasGrid.append(card);
      });
    }

    tabOptions.forEach((tab) => {
      const tabBtn = el('button', `scale-tradition-tab ${tab.id === activeTraditionTab ? 'scale-tradition-tab--active' : ''}`, tab.label);
      tabBtn.addEventListener('click', () => {
        activeTraditionTab = tab.id;
        tabsRow.querySelectorAll('.scale-tradition-tab').forEach((b: any) => b.classList.remove('scale-tradition-tab--active'));
        tabBtn.classList.add('scale-tradition-tab--active');
        renderWorldCards(tab.id);
      });
      tabsRow.append(tabBtn);
    });

    worldHeader.append(tabsRow);
    worldSection.append(worldHeader);
    renderWorldCards(activeTraditionTab);
    worldSection.append(ragasGrid);
    inspectorCol.append(worldSection);

    // Harmonic Mixing Transitions Card
    if (comp) {
      const harmSection = el('div', 'scale-harm-section');
      harmSection.append(el('h4', 'scale-notes__title', 'Harmonic DJ Mix Relations (In-Key Mixing)'));
      const harmGrid = el('div', 'scale-harm-grid');

      const relNote = CAMELOT_KEYS[comp.relative];
      const relMode = comp.relative.endsWith('B') ? 'Major' : 'Minor';
      harmGrid.append(harmItem('Relative Key (Equal)', comp.relative, `${relNote} ${relMode}`, 'rel', () => selectCode(comp.relative)));

      const upNote = CAMELOT_KEYS[comp.up];
      const upMode = comp.up.endsWith('B') ? 'Major' : 'Minor';
      harmGrid.append(harmItem('+1 Energy Boost (Fifth)', comp.up, `${upNote} ${upMode}`, 'up', () => selectCode(comp.up)));

      const downNote = CAMELOT_KEYS[comp.down];
      const downMode = comp.down.endsWith('B') ? 'Major' : 'Minor';
      harmGrid.append(harmItem('-1 Energy Drop (Fourth)', comp.down, `${downNote} ${downMode}`, 'down', () => selectCode(comp.down)));

      harmSection.append(harmGrid);
      inspectorCol.append(harmSection);
    }

    // Action buttons (Audition scale & Drag MIDI)
    const actionsRow = el('div', 'scale-modal-actions');
    const playScaleBtn = el('button', 'pill pill--solid scale-action-btn', '▶ Play Scale Preview');
    const modalScaleSessionId = 'camelot-modal-scale';
    const resetModalScaleUi = () => {
      playScaleBtn.textContent = '▶ Play Scale Preview';
      playScaleBtn.classList.remove('pill--active');
    };
    playScaleBtn.addEventListener('click', () => {
      if (isScalePlaying(modalScaleSessionId)) {
        stopScalePlayback();
        resetModalScaleUi();
        return;
      }
      playScaleBtn.textContent = '⏸ Pause Preview';
      playScaleBtn.classList.add('pill--active');
      playFullScale(tonicPc, degrees, selectedTuningA4, modalScaleSessionId, resetModalScaleUi);
    });
    actionsRow.append(playScaleBtn);

    const midiBtn = el('button', 'pill scale-midi-btn scale-action-btn', '⤓ Export Scale MIDI');
    const midiNotes = notesFor(tonicPc, degrees, 3);
    const midiBytes = scaleMidi(midiNotes, { bpm: projectBpm || 120, bars: 4 });
    const midiFileName = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${selectedTonic}_${selectedScale}.mid`;
    midiBtn.draggable = true;
    midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
      e.preventDefault();
      if (window.api.dragMidi) await window.api.dragMidi(midiFileName, Array.from(midiBytes));
    });
    midiBtn.addEventListener('click', async () => {
      if (window.api.saveMidi) {
        const saved = await window.api.saveMidi(midiFileName, Array.from(midiBytes));
        if (saved) toast('MIDI exported', saved);
      } else {
        const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = midiFileName;
        a.click();
        URL.revokeObjectURL(url);
        toast('MIDI exported', midiFileName);
      }
    });
    actionsRow.append(midiBtn);
    inspectorCol.append(actionsRow);
  }

  function harmItem(label: string, code: string, keyName: string, type: string, onClick: () => void) {
    const item = el('div', `harm-item harm-item--${type}`);
    item.append(el('div', 'harm-item__label', label));
    const val = el('div', 'harm-item__val');
    val.append(el('span', 'harm-item__code', code));
    val.append(el('span', 'harm-item__name', keyName));
    item.append(val);
    item.addEventListener('click', onClick);
    return item;
  }

  function selectCode(code: string) {
    selectedCode = code;
    selectedTonic = CAMELOT_KEYS[code] || selectedTonic;
    baseKeyScale = code.endsWith('B') ? 'major' : 'minor';
    selectedScale = baseKeyScale;
    renderWheel();
    updateInspector();
  }

  // Left Column: SVG Wheel Container
  const wheelCol = el('div', 'camelot-modal__wheel-col');
  const wheelRadius = 145;
  const wheel = wheelLayoutFn(wheelRadius);
  const svgNS = 'http://www.w3.org/2000/svg';

  function renderWheel() {
    wheelCol.innerHTML = '';
    const comp = camelotCompatible(selectedCode);
    const wheelSize = wheelRadius * 2 + 30;

    const svgWheel = document.createElementNS(svgNS, 'svg');
    svgWheel.setAttribute('class', 'camelot-wheel-modal');
    svgWheel.setAttribute('viewBox', `-${wheelSize / 2} -${wheelSize / 2} ${wheelSize} ${wheelSize}`);
    svgWheel.setAttribute('width', String(wheelSize));
    svgWheel.setAttribute('height', String(wheelSize));

    wheel.segments.forEach((seg) => {
      const isSelected = seg.code === selectedCode;
      const isCurrentSong = rec.camelot && seg.code === rec.camelot;
      const isRelative = comp && seg.code === comp.relative;
      const isNeighbor = comp && (seg.code === comp.up || seg.code === comp.down);

      let stateClass = 'wheel-modal-seg--default';
      if (isSelected) stateClass = 'wheel-modal-seg--selected';
      else if (isCurrentSong) stateClass = 'wheel-modal-seg--current-song';
      else if (isRelative) stateClass = 'wheel-modal-seg--relative';
      else if (isNeighbor) stateClass = 'wheel-modal-seg--neighbor';

      const x1_in = seg.innerRadius * Math.cos(seg.startAngle);
      const y1_in = seg.innerRadius * Math.sin(seg.startAngle);
      const x2_in = seg.innerRadius * Math.cos(seg.endAngle);
      const y2_in = seg.innerRadius * Math.sin(seg.endAngle);

      const x1_out = seg.outerRadius * Math.cos(seg.startAngle);
      const y1_out = seg.outerRadius * Math.sin(seg.startAngle);
      const x2_out = seg.outerRadius * Math.cos(seg.endAngle);
      const y2_out = seg.outerRadius * Math.sin(seg.endAngle);

      const pathData = [
        `M ${x1_in} ${y1_in}`,
        `L ${x1_out} ${y1_out}`,
        `A ${seg.outerRadius} ${seg.outerRadius} 0 0 1 ${x2_out} ${y2_out}`,
        `L ${x2_in} ${y2_in}`,
        `A ${seg.innerRadius} ${seg.innerRadius} 0 0 0 ${x1_in} ${y1_in}`,
        'Z'
      ].join(' ');

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'wheel-modal-slice-group');
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => selectCode(seg.code));

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('class', `wheel-modal-seg ${stateClass}`);
      g.appendChild(path);

      // Label (Camelot Code & Key Name)
      const lx = seg.labelRadius * Math.cos(seg.labelAngle);
      const ly = seg.labelRadius * Math.sin(seg.labelAngle);

      const textCode = document.createElementNS(svgNS, 'text');
      textCode.setAttribute('x', String(lx));
      textCode.setAttribute('y', String(ly - (seg.ring === 'A' ? 3 : 4)));
      textCode.setAttribute('text-anchor', 'middle');
      textCode.setAttribute('dominant-baseline', 'middle');
      textCode.setAttribute('class', `wheel-modal-code ${isSelected ? 'wheel-modal-code--active' : ''}`);
      textCode.textContent = seg.code;
      g.appendChild(textCode);

      const textKey = document.createElementNS(svgNS, 'text');
      textKey.setAttribute('x', String(lx));
      textKey.setAttribute('y', String(ly + (seg.ring === 'A' ? 7 : 7)));
      textKey.setAttribute('text-anchor', 'middle');
      textKey.setAttribute('dominant-baseline', 'middle');
      textKey.setAttribute('class', `wheel-modal-key ${isSelected ? 'wheel-modal-key--active' : ''}`);
      textKey.textContent = `${seg.key}${seg.ring === 'A' ? 'm' : ''}`;
      g.appendChild(textKey);

      svgWheel.appendChild(g);
    });

    // Center Hub
    const centerCircle = document.createElementNS(svgNS, 'circle');
    centerCircle.setAttribute('cx', '0');
    centerCircle.setAttribute('cy', '0');
    centerCircle.setAttribute('r', String(wheelRadius * 0.38));
    centerCircle.setAttribute('class', 'wheel-modal-center');
    svgWheel.appendChild(centerCircle);

    const centerCode = document.createElementNS(svgNS, 'text');
    centerCode.setAttribute('x', '0');
    centerCode.setAttribute('y', '-10');
    centerCode.setAttribute('text-anchor', 'middle');
    centerCode.setAttribute('dominant-baseline', 'middle');
    centerCode.setAttribute('class', 'wheel-modal-center-code');
    centerCode.textContent = selectedCode;
    svgWheel.appendChild(centerCode);

    const centerKey = document.createElementNS(svgNS, 'text');
    centerKey.setAttribute('x', '0');
    centerKey.setAttribute('y', '6');
    centerKey.setAttribute('text-anchor', 'middle');
    centerKey.setAttribute('dominant-baseline', 'middle');
    centerKey.setAttribute('class', 'wheel-modal-center-key');
    centerKey.textContent = `${selectedTonic} ${selectedScale === 'major' ? 'maj' : selectedScale === 'minor' ? 'min' : selectedScale}`;
    svgWheel.appendChild(centerKey);

    const centerHz = document.createElementNS(svgNS, 'text');
    centerHz.setAttribute('x', '0');
    centerHz.setAttribute('y', '18');
    centerHz.setAttribute('text-anchor', 'middle');
    centerHz.setAttribute('dominant-baseline', 'middle');
    centerHz.setAttribute('class', 'wheel-modal-center-hz');
    centerHz.textContent = `${selectedTuningA4} Hz`;
    svgWheel.appendChild(centerHz);

    wheelCol.appendChild(svgWheel);

    // Legend below wheel
    const legend = el('div', 'wheel-legend');
    legend.append(legendItem('Selected Key', 'selected'));
    if (rec.camelot) legend.append(legendItem('Current Track', 'current'));
    legend.append(legendItem('Relative Key', 'relative'));
    legend.append(legendItem('Harmonic +/- 1', 'neighbor'));
    wheelCol.appendChild(legend);
  }

  function legendItem(text: string, type: string) {
    const item = el('div', 'wheel-legend__item');
    item.append(el('span', `wheel-legend__dot wheel-legend__dot--${type}`));
    item.append(el('span', 'wheel-legend__text', text));
    return item;
  }

  renderWheel();
  updateInspector();

  body.append(wheelCol);
  body.append(inspectorCol);
  dialog.append(body);
  overlay.append(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);

  document.body.append(overlay);
}

function renderMiniStickyKeyboard(tonicPc: number, degrees: number[]) {
  if (tonicPc === -1 || !degrees) return null;
  const kb = kbLayoutFn(1, 8, 20);
  const highlightedKeys = kbHighlightFn(kb.keys, tonicPc, degrees);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgKb = document.createElementNS(svgNS, 'svg');
  svgKb.setAttribute('class', 'scale-keyboard mini-scale-keyboard');
  svgKb.setAttribute('viewBox', `0 0 ${kb.width} ${kb.height}`);
  svgKb.setAttribute('width', String(kb.width));
  svgKb.setAttribute('height', String(kb.height));

  highlightedKeys.filter((k) => k.type === 'white').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width - 1));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '1');
    rect.setAttribute('class', `scale-key scale-key--white scale-key--${k.state}`);
    svgKb.appendChild(rect);
  });

  highlightedKeys.filter((k) => k.type === 'black').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '1');
    rect.setAttribute('class', `scale-key scale-key--black scale-key--${k.state}`);
    svgKb.appendChild(rect);
  });

  return svgKb;
}

function renderProjectHarmony(entry, rec, projectBpm) {
  let tonic = rec.tonic;
  let scale = rec.scale;
  const camelot = rec.camelot;

  if (!tonic && rec.key) {
    const match = String(rec.key).trim().match(/^([A-Ga-g][#b♭]?)/);
    if (match) tonic = match[1];
    if (rec.key.includes('min')) scale = scale || 'minor';
    else if (rec.key.includes('maj')) scale = scale || 'major';
  }

  const isDemo = !tonic || !scale || DSP.NOTES.indexOf(tonic) === -1;
  const effectiveTonic = isDemo ? 'A' : tonic;
  const effectiveScale = isDemo ? 'minor' : scale;
  const effectiveCamelot = isDemo ? '8A' : (camelot || '8A');
  const tonicPc = DSP.NOTES.indexOf(effectiveTonic);
  const degrees = (effectiveScale && DSP.SCALES[effectiveScale]) || DSP.SCALES.minor;

  const container = el('div', `page__harmony ${isDemo ? 'page__harmony--demo' : ''}`);

  // Left column: Keyboard + Drag MIDI button
  const kbCol = el('div', 'harmony__keyboard-col');

  if (isDemo) {
    const demoBanner = el('div', 'harmony__demo-banner');
    demoBanner.append(el('span', 'harmony__demo-pill', 'Demo Preview · A min (8A)'));
    demoBanner.append(el('span', 'harmony__demo-note', 'Analyse audio to detect real key'));
    demoBanner.title = "Audition / Demo scale (A Minor 8A). Analysing any render or audio file will automatically detect and populate your project's authentic key & Raagas.";
    kbCol.append(demoBanner);
  }

  // Keyboard
  const kb = kbLayoutFn(2, 13, 50);
  const highlightedKeys = kbHighlightFn(kb.keys, tonicPc, degrees);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svgKb = document.createElementNS(svgNS, 'svg');
  svgKb.setAttribute('class', 'scale-keyboard');
  svgKb.setAttribute('viewBox', `0 0 ${kb.width} ${kb.height}`);
  svgKb.setAttribute('width', String(kb.width));
  svgKb.setAttribute('height', String(kb.height));

  // Render whites first
  highlightedKeys.filter((k) => k.type === 'white').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width - 1));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '2');
    rect.setAttribute('class', `scale-key scale-key--white scale-key--${k.state}`);
    const degName = k.degree ? (DEGREE_NAMES[((k.pc - tonicPc) % 12 + 12) % 12] || `${k.degree}`) : 'out of scale';
    rect.innerHTML = `<title>${k.name} (${degName})</title>`;
    svgKb.appendChild(rect);
  });

  // Render blacks on top
  highlightedKeys.filter((k) => k.type === 'black').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '2');
    rect.setAttribute('class', `scale-key scale-key--black scale-key--${k.state}`);
    const degName = k.degree ? (DEGREE_NAMES[((k.pc - tonicPc) % 12 + 12) % 12] || `${k.degree}`) : 'out of scale';
    rect.innerHTML = `<title>${k.name} (${degName})</title>`;
    svgKb.appendChild(rect);
  });

  svgKb.style.cursor = 'pointer';
  svgKb.setAttribute('title', 'Click to open Camelot Harmonic Wheel & Scale Inspector');
  svgKb.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    openCamelotModal(entry, { ...rec, tonic: effectiveTonic, scale: effectiveScale, camelot: effectiveCamelot, key: isDemo ? 'A min' : rec.key }, projectBpm);
  });

  kbCol.append(svgKb);

  // Drag MIDI button
  const midiBtn = el('button', 'pill pill--sm scale-midi-btn', '⤓ Drag MIDI to DAW');
  midiBtn.title = 'Drag to your DAW track or click to export MIDI file';
  midiBtn.draggable = true;

  const midiNotes = notesFor(tonicPc, degrees, 3);
  const midiBytes = scaleMidi(midiNotes, { bpm: projectBpm || 120, bars: 4 });
  const midiFileName = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${effectiveTonic}_${effectiveScale || 'scale'}.mid`;

  midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if (window.api.dragMidi) {
      await window.api.dragMidi(midiFileName, Array.from(midiBytes));
    }
  });

  midiBtn.addEventListener('click', async () => {
    if (window.api.saveMidi) {
      const saved = await window.api.saveMidi(midiFileName, Array.from(midiBytes));
      if (saved) toast('MIDI exported', saved);
    } else {
      const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = midiFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast('MIDI exported', midiFileName);
    }
  });

  kbCol.append(midiBtn);

  // World Scales & Regional Suggestions Box below keyboard
  const ragaChroma = new Float64Array(12);
  degrees.forEach((d) => {
    ragaChroma[(tonicPc + d) % 12] = 1.0;
  });
  const userTraditions = (settings && settings.scaleTraditions) || ['all'];
  const suggestedWorldScales = findMatchingWorldScales(ragaChroma, tonicPc, userTraditions, 4);

  if (suggestedWorldScales && suggestedWorldScales.length > 0) {
    const isSingleIndian = userTraditions.length === 1 && userTraditions[0] === 'indian';
    const isSingleArabic = userTraditions.length === 1 && userTraditions[0] === 'arabic';
    const isSingleChinese = userTraditions.length === 1 && userTraditions[0] === 'chinese';
    const isSingleWestern = userTraditions.length === 1 && userTraditions[0] === 'western';
    const boxTitle = isSingleIndian
      ? 'Raagas:'
      : isSingleArabic
        ? 'Maqamat:'
        : isSingleChinese
          ? 'Pentatonics:'
          : isSingleWestern
            ? 'Western Scales:'
            : 'Suggestions:';

    const ragasBox = el('div', 'harmony__ragas-box');
    const ragasTitle = el('span', 'harmony__ragas-title', boxTitle);
    ragasBox.append(ragasTitle);

    const ragasList = el('div', 'harmony__ragas-list');
    suggestedWorldScales.slice(0, 3).forEach((scaleMatch: ScoredWorldScale) => {
      const chip = el('button', 'harmony__raga-chip');
      const regionMeta = WORLD_REGIONS.find((r) => r.id === scaleMatch.tradition);
      const flagStr = regionMeta ? regionMeta.flag : '🌐';

      chip.append(el('span', 'harmony__raga-drag-icon', '⋮⋮'));
      chip.append(el('span', 'harmony__scale-flag', flagStr));
      chip.append(el('span', 'harmony__raga-name', scaleMatch.name));
      chip.append(el('span', 'harmony__raga-pct', `${scaleMatch.matchPercent}%`));
      
      const ascStr = scaleMatch.phraseNotation?.ascending ? `\n▲ Ascending: ${scaleMatch.phraseNotation.ascending}` : '';
      const descStr = scaleMatch.phraseNotation?.descending ? `\n▼ Descending: ${scaleMatch.phraseNotation.descending}` : '';
      const moodStr = scaleMatch.mood ? ` · ${scaleMatch.mood}` : '';
      chip.title = `${scaleMatch.name} (${scaleMatch.subCategory || scaleMatch.tradition})${moodStr}${ascStr}${descStr}\n\nDrag to DAW track or Click to inspect & export MIDI`;
      
      const ascPhrase = scaleMatch.ascendingPhrase || scaleMatch.degrees;
      const descPhrase = scaleMatch.descendingPhrase || [...ascPhrase].reverse();
      const rMidiBytes = generateWorldScaleMidi(tonicPc, ascPhrase, descPhrase, { bpm: projectBpm || 120 });
      const cleanScaleName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const rMidiFileName = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Scale_${cleanScaleName}_${effectiveTonic || 'C'}.mid`;

      chip.draggable = true;
      chip.addEventListener('dragstart', async (e: DragEvent) => {
        e.preventDefault();
        if (window.api.dragMidi) await window.api.dragMidi(rMidiFileName, Array.from(rMidiBytes));
      });

      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openCamelotModal(entry, { ...rec, tonic: effectiveTonic, camelot: effectiveCamelot, scale: scaleMatch.id || scaleMatch.name.toLowerCase() }, projectBpm);
      });
      ragasList.append(chip);
    });
    ragasBox.append(ragasList);
    kbCol.append(ragasBox);
  }

  container.append(kbCol);

  // Right column: Camelot wheel with expand interaction
  const wheelCol = el('div', 'harmony__wheel-col');
  wheelCol.title = 'Click to expand Camelot wheel & inspect all scales';
  wheelCol.style.cursor = 'pointer';
  wheelCol.addEventListener('click', () => openCamelotModal(entry, { ...rec, tonic: effectiveTonic, scale: effectiveScale, camelot: effectiveCamelot, key: isDemo ? 'A min' : rec.key }, projectBpm));

  const wheelRadius = 40;
  const wheel = wheelLayoutFn(wheelRadius);
  const comp = effectiveCamelot ? camelotCompatible(effectiveCamelot) : null;

  const svgWheel = document.createElementNS(svgNS, 'svg');
  const wheelSize = wheelRadius * 2 + 12;
  svgWheel.setAttribute('class', 'camelot-wheel');
  svgWheel.setAttribute('viewBox', `-${wheelSize / 2} -${wheelSize / 2} ${wheelSize} ${wheelSize}`);
  svgWheel.setAttribute('width', String(wheelSize));
  svgWheel.setAttribute('height', String(wheelSize));

  wheel.segments.forEach((seg) => {
    const isCurrent = effectiveCamelot && seg.code === effectiveCamelot;
    const isRelative = comp && seg.code === comp.relative;
    const isNeighbor = comp && (seg.code === comp.up || seg.code === comp.down);

    let stateClass = 'wheel-seg--dim';
    if (isCurrent) stateClass = 'wheel-seg--current';
    else if (isRelative) stateClass = 'wheel-seg--relative';
    else if (isNeighbor) stateClass = 'wheel-seg--neighbor';

    const x1_in = seg.innerRadius * Math.cos(seg.startAngle);
    const y1_in = seg.innerRadius * Math.sin(seg.startAngle);
    const x2_in = seg.innerRadius * Math.cos(seg.endAngle);
    const y2_in = seg.innerRadius * Math.sin(seg.endAngle);

    const x1_out = seg.outerRadius * Math.cos(seg.startAngle);
    const y1_out = seg.outerRadius * Math.sin(seg.startAngle);
    const x2_out = seg.outerRadius * Math.cos(seg.endAngle);
    const y2_out = seg.outerRadius * Math.sin(seg.endAngle);

    const pathData = [
      `M ${x1_in} ${y1_in}`,
      `L ${x1_out} ${y1_out}`,
      `A ${seg.outerRadius} ${seg.outerRadius} 0 0 1 ${x2_out} ${y2_out}`,
      `L ${x2_in} ${y2_in}`,
      `A ${seg.innerRadius} ${seg.innerRadius} 0 0 0 ${x1_in} ${y1_in}`,
      'Z'
    ].join(' ');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', `wheel-segment ${stateClass}`);
    path.innerHTML = `<title>${seg.code} (${seg.key} ${seg.mode}) · Click to expand wheel</title>`;
    svgWheel.appendChild(path);
  });

  const centerCircle = document.createElementNS(svgNS, 'circle');
  centerCircle.setAttribute('cx', '0');
  centerCircle.setAttribute('cy', '0');
  centerCircle.setAttribute('r', String(wheelRadius * 0.38));
  centerCircle.setAttribute('class', 'wheel-center');
  svgWheel.appendChild(centerCircle);

  const centerText = document.createElementNS(svgNS, 'text');
  centerText.setAttribute('x', '0');
  centerText.setAttribute('y', camelot ? '-2' : '0');
  centerText.setAttribute('text-anchor', 'middle');
  centerText.setAttribute('dominant-baseline', 'middle');
  centerText.setAttribute('class', 'wheel-center-text');
  centerText.textContent = camelot || tonic || '';
  svgWheel.appendChild(centerText);

  if (camelot) {
    const centerSub = document.createElementNS(svgNS, 'text');
    centerSub.setAttribute('x', '0');
    centerSub.setAttribute('y', '9');
    centerSub.setAttribute('text-anchor', 'middle');
    centerSub.setAttribute('dominant-baseline', 'middle');
    centerSub.setAttribute('class', 'wheel-center-sub');
    centerSub.textContent = tonic ? `${tonic} ${rec.key?.includes('maj') ? 'maj' : 'min'}` : '';
    svgWheel.appendChild(centerSub);
  }

  wheelCol.append(svgWheel);

  const expandBtn = el('button', 'harmony__expand-btn', '⤢ All Scales');
  expandBtn.title = 'View full Camelot wheel & explore all 24 scales';
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCamelotModal(entry, rec, projectBpm);
  });
  wheelCol.append(expandBtn);

  if (!camelot && (rec.modal || scale)) {
    const modalBadge = el('div', 'wheel-modal-note', 'Modal · outside 5ths');
    wheelCol.append(modalBadge);
  }

  container.append(wheelCol);
  return container;
}

/* =========================== project page ========================== */

// Audit the open set for missing samples and paint the result into the header
// facts + a detail callout. Cached per session so tab switches don't re-scan;
// the cache is cleared on a rescan (refresh()).
const sampleAuditCollapsed = new Set<string>();

function isSampleAuditCollapsed(entry: any): boolean {
  if (!entry) return false;
  const key = entry.sessionPath || entry.path || '';
  if (!key) return false;
  if (sampleAuditCollapsed.has(key)) return true;
  try {
    return localStorage.getItem('daw_buddy_sample_audit_collapsed:' + key) === 'true';
  } catch {
    return false;
  }
}

function setSampleAuditCollapsed(entry: any, collapsed: boolean) {
  if (!entry) return;
  const key = entry.sessionPath || entry.path || '';
  if (!key) return;
  if (collapsed) {
    sampleAuditCollapsed.add(key);
    try { localStorage.setItem('daw_buddy_sample_audit_collapsed:' + key, 'true'); } catch {}
  } else {
    sampleAuditCollapsed.delete(key);
    try { localStorage.removeItem('daw_buddy_sample_audit_collapsed:' + key); } catch {}
  }
}

function runSampleAudit(entry, facts, box) {
  const cached = sampleAuditCache.get(entry.sessionPath);
  if (cached) {
    paintSampleAudit(cached, facts, box, entry);
    return;
  }
  window.api
    .auditSamples(entry.sessionPath)
    .then((res) => {
      if (!res) return;
      if (sampleAuditCache.size > 50) {
        const firstKey = sampleAuditCache.keys().next().value;
        if (firstKey) sampleAuditCache.delete(firstKey);
      }
      sampleAuditCache.set(entry.sessionPath, res);
      if (openProject === entry) paintSampleAudit(res, facts, box, entry);
    })
    .catch(() => {});
}

function paintSampleAudit(res, facts, box, entry?: any) {
  if (!res.supported || res.error || res.referenced === 0) return;
  box.innerHTML = '';

  const projectEntry = entry || openProject;
  const initiallyCollapsed = isSampleAuditCollapsed(projectEntry);

  if (res.missing && res.missing.length) {
    const n = res.missing.length;
    const chip = fact('Missing samples', String(n));
    chip.classList.add('statchip--alert');
    facts.append(chip);

    const callout = el(
      'div',
      `callout callout--alert sample-audit__callout${initiallyCollapsed ? ' sample-audit__callout--collapsed' : ''}`
    );

    const header = el('div', 'sample-audit__header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
    header.title = initiallyCollapsed ? 'Click to expand missing samples' : 'Click to collapse missing samples';

    const title = el('b', 'sample-audit__title', `${n} referenced sample${n === 1 ? '' : 's'} not found on disk`);

    const toggle = el('button', 'sample-audit__toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Toggle missing samples list');
    toggle.innerHTML = `<svg class="sample-audit__chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

    header.append(title, toggle);
    callout.append(header);

    const body = el('div', 'sample-audit__body');
    const list = el('div', 'sample-audit__list');
    res.missing.slice(0, 40).forEach((m) => {
      const item = el('div', 'sample-audit__item');
      item.append(el('span', 'sample-audit__name', m.name || '(unnamed)'));
      if (m.relativePath) item.append(el('span', 'sample-audit__path', m.relativePath));
      list.append(item);
    });
    body.append(list);
    if (n > 40) body.append(el('div', 'muted sample-audit__more', `…and ${n - 40} more`));
    callout.append(body);

    const toggleCollapse = (e?: Event) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const isCollapsed = callout.classList.toggle('sample-audit__callout--collapsed');
      setSampleAuditCollapsed(projectEntry, isCollapsed);
      header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      header.title = isCollapsed ? 'Click to expand missing samples' : 'Click to collapse missing samples';
    };

    header.addEventListener('click', toggleCollapse);
    header.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse();
      }
    });

    box.append(callout);
  } else {
    // All references resolve — a quiet, reassuring chip.
    facts.append(fact('Samples', `${res.present} ✓`));
  }
}

function openProjectColorPicker(entry: any, rec: any) {
  document.querySelectorAll('.color-picker-overlay').forEach((node) => node.remove());

  const overlay = el('div', 'modal-overlay color-picker-overlay');
  const dialog = el('div', 'color-picker-modal');

  const header = el('div', 'color-picker-modal__header');
  const titleGroup = el('div', 'color-picker-modal__titles');
  titleGroup.append(el('h3', 'color-picker-modal__title', 'Assign Project Color'));
  titleGroup.append(
    el(
      'p',
      'color-picker-modal__subtitle',
      'Color code projects for visual priority cue (Ableton Track Matrix)'
    )
  );
  header.append(titleGroup);

  const closeBtn = el('button', 'round color-picker-modal__close', '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(closeBtn);
  dialog.append(header);

  const body = el('div', 'color-picker-modal__body');
  const grid = el('div', 'ableton-color-grid');

  const currentCustom = rec.customColor;
  const currentAuto = getAbletonProjectColor(entry.sessionPath || entry.path || entry.name).hex;
  const activeHex = (currentCustom || currentAuto || '').toLowerCase();

  ABLETON_PALETTE_GRID.forEach((color) => {
    const swatch = el('button', 'ableton-color-swatch');
    swatch.style.backgroundColor = color.hex;
    swatch.style.color = color.hex;
    swatch.title = color.name;
    if (activeHex === color.hex.toLowerCase()) {
      swatch.classList.add('is-selected');
    }

    swatch.addEventListener('click', async () => {
      await saveRecord(entry.path, { customColor: color.hex });
      overlay.remove();
      render();
    });

    grid.append(swatch);
  });

  body.append(grid);

  const footer = el('div', 'color-picker-modal__footer');
  const resetBtn = el('button', 'pill pill--sm', 'Reset to Auto Color');
  resetBtn.addEventListener('click', async () => {
    await saveRecord(entry.path, { customColor: null });
    overlay.remove();
    render();
  });
  footer.append(resetBtn);

  body.append(footer);
  dialog.append(body);
  overlay.append(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  document.body.append(overlay);
}

function renderProjectPage() {
  const entry = openProject;
  const rec = record(entry.path);
  viewEl.innerHTML = '';

  const customColor = rec.customColor;
  const autoColor = getAbletonProjectColor(entry.sessionPath || entry.path || entry.name);
  const projColor = customColor ? { hex: customColor, ink: '#ffffff' } : autoColor;

  // Dynamic project color mapping (waveform, header, buttons, and active accents match project clip color)
  if (customColor || currentThemeStyle() === 'ableton') {
    document.body.style.setProperty('--amber', projColor.hex);
    document.body.style.setProperty('--amber-ink', projColor.ink || '#ffffff');
    document.body.style.setProperty('--sage', projColor.hex);
    document.body.style.setProperty('--accent-glow', `0 0 18px ${projColor.hex}66`);
    document.documentElement.style.setProperty('--amber', projColor.hex);
    document.documentElement.style.setProperty('--amber-ink', projColor.ink || '#ffffff');
    document.documentElement.style.setProperty('--sage', projColor.hex);
    document.documentElement.style.setProperty('--accent-glow', `0 0 18px ${projColor.hex}66`);
    Player.draw();
  } else {
    document.body.style.removeProperty('--amber');
    document.body.style.removeProperty('--amber-ink');
    document.body.style.removeProperty('--sage');
    document.body.style.removeProperty('--accent-glow');
    document.documentElement.style.removeProperty('--amber');
    document.documentElement.style.removeProperty('--amber-ink');
    document.documentElement.style.removeProperty('--sage');
    document.documentElement.style.removeProperty('--accent-glow');
    applyAppearance();
    Player.draw();
  }

  let tonic = rec.tonic;
  let scale = rec.scale;
  if (!tonic && rec.key) {
    const match = String(rec.key).trim().match(/^([A-Ga-g][#b♭]?)/);
    if (match) tonic = match[1];
    if (rec.key.includes('min')) scale = scale || 'minor';
    else if (rec.key.includes('maj')) scale = scale || 'major';
  }
  const tonicPc = tonic ? DSP.NOTES.indexOf(tonic) : -1;
  const degrees = (scale && DSP.SCALES[scale]) || (rec.key?.includes('min') ? DSP.SCALES.minor : DSP.SCALES.major);
  const scaleName = tonic && scale ? `${tonic} ${scale}` : (rec.key || '');
  const projectBpm = bpmFor(entry);

  /* Sticky Collapsible Mini Project Header Bar */
  const stickyBar = el('div', 'page__sticky-bar');
  stickyBar.id = 'projectStickyBar';

  const stickyLeft = el('div', 'sticky-bar__left');
  const stickyArt = el('div', 'sticky-bar__art', projectBpm !== null ? formatBpm(projectBpm) : '♪');
  stickyLeft.append(stickyArt);

  const stickyInfo = el('div', 'sticky-bar__info');
  const stickyTitleLine = el('div', 'sticky-bar__title-line');
  if (entry.daw) {
    const dawBadge = el('span', 'badge badge--daw', entry.daw);
    if (customColor || currentThemeStyle() === 'ableton') {
      dawBadge.style.borderColor = `${projColor.hex}44`;
      dawBadge.style.color = projColor.hex;
    }
    stickyTitleLine.append(dawBadge);
  }
  stickyTitleLine.append(el('span', 'sticky-bar__name', entry.name));
  stickyInfo.append(stickyTitleLine);

  const stickyMeta = el('div', 'sticky-bar__meta');
  if (projectBpm !== null) stickyMeta.append(el('span', 'sticky-bar__chip', `${formatBpm(projectBpm)} BPM`));
  const projectSig = timeSignatureFor(entry);
  if (projectSig) stickyMeta.append(el('span', 'sticky-bar__chip', projectSig));
  if (rec.key) {
    stickyMeta.append(el('span', 'sticky-bar__chip', `${rec.key}${rec.camelot ? ` (${rec.camelot})` : ''}`));
  }
  if (scaleName) {
    stickyMeta.append(el('span', 'sticky-bar__scale-name', scaleName));
  }
  stickyInfo.append(stickyMeta);
  stickyLeft.append(stickyInfo);
  stickyBar.append(stickyLeft);

  const stickyRight = el('div', 'sticky-bar__right');
  const miniKb = renderMiniStickyKeyboard(tonicPc, degrees);
  if (miniKb) {
    const kbWrap = el('div', 'sticky-bar__mini-kb');
    kbWrap.style.cursor = 'pointer';
    kbWrap.title = 'Open Camelot Harmonic Wheel & Scale Inspector';
    kbWrap.append(miniKb);
    kbWrap.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      openCamelotModal(entry, rec, projectBpm);
    });
    stickyRight.append(kbWrap);
  }

  const stickyActions = el('div', 'sticky-bar__actions');
  const stickyOpen = el('button', 'pill pill--sm pill--solid', 'Open');
  stickyOpen.disabled = !entry.sessionPath;
  stickyOpen.addEventListener('click', () => openWithGuard(entry));
  stickyActions.append(stickyOpen);

  const stickyColorBtn = el('button', 'pill pill--sm color-picker-trigger');
  const stickyDot = el('span', 'color-picker-trigger__dot');
  stickyDot.style.backgroundColor = projColor.hex;
  stickyDot.style.boxShadow = `0 0 6px ${projColor.hex}`;
  stickyColorBtn.append(stickyDot);
  stickyColorBtn.title = 'Assign project color';
  stickyColorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectColorPicker(entry, rec);
  });
  stickyActions.append(stickyColorBtn);

  stickyRight.append(stickyActions);
  stickyBar.append(stickyRight);

  viewEl.append(stickyBar);

  viewEl.onscroll = () => {
    const bar = document.getElementById('projectStickyBar');
    if (bar) {
      if (viewEl.scrollTop > 120) {
        bar.classList.add('is-visible');
      } else {
        bar.classList.remove('is-visible');
      }
    }
  };

  const crumbs = el('div', 'breadcrumbs');
  const backToProjects = el('button', 'breadcrumb__link', 'Projects');
  backToProjects.addEventListener('click', () => goList(null));
  crumbs.append(backToProjects);
  const places = String(entry.location || '').split(/[\\/]/).filter(Boolean).slice(-3);
  places.forEach((place) => {
    crumbs.append(el('span', 'breadcrumb__sep', '/'));
    crumbs.append(el('span', 'breadcrumb__part', place));
  });
  crumbs.append(el('span', 'breadcrumb__sep', '/'));
  crumbs.append(el('span', 'breadcrumb__current', entry.name));
  viewEl.append(crumbs);

  /* header */
  const head = el('div', 'page__head');
  const headMain = el('div', 'page__headmain');
  const art = el('div', 'page__art', projectBpm !== null ? formatBpm(projectBpm) : '♪');
  headMain.append(art);

  const titles = el('div', 'page__titles');
  titles.append(el('div', 'page__kicker', entry.daw || 'Project'));
  titles.append(el('h1', 'page__title', entry.name));

  const facts = el('div', 'page__facts');
  if (projectBpm !== null) {
    const bChip = fact('BPM', formatBpm(projectBpm));
    bChip.dataset.analysisChip = 'bpm';
    facts.append(bChip);
  }
  else if (entry.bpmError) facts.append(fact('BPM', 'not readable'));
  if (projectSig) {
    const talaInfo = DSP.TALA_MAP[projectSig] || (rec.tala ? { name: rec.tala } : null);
    const sigChip = fact('Time Sig', `${projectSig}${talaInfo ? ` (${talaInfo.name.split('/')[0].trim()})` : ''}`);
    sigChip.style.cursor = 'pointer';
    sigChip.title = 'Click to change time signature / Indian Tala';
    sigChip.addEventListener('click', () => openTimeSignaturePicker(entry, rec));
    facts.append(sigChip);
  }
  if (rec.key) {
    const kChip = fact('Key', `${rec.key}${rec.camelot ? ` (${rec.camelot})` : ''}`);
    kChip.dataset.analysisChip = 'key';
    facts.append(kChip);
  } else if (rec.tonic && rec.scale) {
    const kChip = fact('Scale', `Tonic ${rec.tonic} · ${rec.scale}`);
    kChip.dataset.analysisChip = 'key';
    facts.append(kChip);
  } else {
    const kChip = fact('Key', '—');
    kChip.dataset.analysisChip = 'key';
    kChip.style.display = 'none';
    facts.append(kChip);
  }
  if (rec.genre) {
    const genreChip = fact('Genre', rec.genre);
    genreChip.style.cursor = 'pointer';
    genreChip.title = 'Click to change project genre';
    genreChip.addEventListener('click', () => openGenrePicker(entry, rec));
    facts.append(genreChip);
  }
  facts.append(fact('Saves', String(entry.backupCount)));
  facts.append(fact('Audio', String(entry.audioCount)));
  facts.append(fact('Modified', timeAgo(entry.modified)));
  if (entry.packaged) facts.append(fact('Exported', timeAgo(entry.packagedAt)));
  titles.append(facts);
  headMain.append(titles);
  head.append(headMain);

  const harmony = renderProjectHarmony(entry, rec, projectBpm);
  if (harmony) head.append(harmony);

  viewEl.append(head);

  /* actions */
  const actions = el('div', 'page__actions');

  const open = el('button', 'pill pill--solid', 'Open project');
  open.disabled = !entry.sessionPath;
  open.addEventListener('click', () => openWithGuard(entry));
  actions.append(open);

  const reveal = el('button', 'pill', `Show in ${settings.fileManager}`);
  reveal.addEventListener('click', () =>
    window.api.reveal(entry.sessionPath)
  );
  actions.append(reveal);

  const fav = el('button', 'pill', rec.favourite ? '♥ Favourite' : '♡ Favourite');
  if (rec.favourite) fav.classList.add('is-on');
  fav.addEventListener('click', async () => {
    await saveRecord(entry.path, { favourite: !rec.favourite });
    render();
    renderCollections();
  });
  actions.append(fav);

  const genreBtn = el('button', 'pill', rec.genre ? `🏷 ${rec.genre}` : '+ Genre');
  if (rec.genre) genreBtn.classList.add('is-on');
  genreBtn.title = 'Specify / change project genre';
  genreBtn.addEventListener('click', () => openGenrePicker(entry, rec));
  actions.append(genreBtn);

  const sigBtn = el('button', 'pill', projectSig ? `Meter: ${projectSig}` : 'Meter: 4/4');
  if (rec.timeSignature) sigBtn.classList.add('is-on');
  sigBtn.title = 'Change project time signature and Indian Tala';
  sigBtn.addEventListener('click', () => openTimeSignaturePicker(entry, rec));
  actions.append(sigBtn);

  const colorBtn = el('button', 'pill color-picker-trigger');
  const swatchIcon = el('span', 'color-picker-trigger__dot');
  swatchIcon.style.backgroundColor = projColor.hex;
  swatchIcon.style.boxShadow = `0 0 8px ${projColor.hex}`;
  colorBtn.append(swatchIcon);
  colorBtn.append(el('span', null, rec.customColor ? 'Custom Color' : 'Color'));
  colorBtn.title = 'Assign custom priority color for this project (Ableton Track Matrix)';
  colorBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    openProjectColorPicker(entry, rec);
  });
  actions.append(colorBtn);

  /* Audio-synced Metronome widget, DAW Soundset Picker & Drag to DAW Click Track */
  const metroGroup = el('div', 'project-metro-group');
  const metroBtn = el('button', 'pill pill--metro');
  const updateMetroBtnText = () => {
    const soundId = Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton';
    const soundDef = getMetronomeSoundset(soundId);
    metroBtn.innerHTML = `<span>⏱ Metronome</span><span class="metro-sound-indicator" title="Current sound: ${soundDef.name} (Right-click to change)">▾</span>`;
  };
  updateMetroBtnText();
  metroBtn.title = 'Audio-synced metronome click (Left-click to toggle, Right-click to choose DAW sound)';

  const metroSigWrap = el('div', 'project-metro-sigs');

  // Metronome Soundset Popup Menu
  let soundPop: HTMLElement | null = null;
  const closeSoundPop = () => {
    if (soundPop) {
      soundPop.remove();
      soundPop = null;
    }
  };

  const openSoundPop = (anchorEl: HTMLElement) => {
    closeSoundPop();
    soundPop = el('div', 'metro-sound-pop');
    
    const head = el('div', 'metro-sound-pop__head');
    head.append(el('span', null, 'Metronome Sound (DAW)'));
    const closeBtn = el('button', 'round', '✕');
    closeBtn.style.fontSize = '10px';
    closeBtn.style.padding = '2px 4px';
    closeBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeSoundPop();
    });
    head.append(closeBtn);
    soundPop.append(head);

    const currentSoundId = Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton';
    const soundsets = getMetronomeSoundsets();

    soundsets.forEach((s) => {
      const item = el('button', `metro-sound-item ${s.id === currentSoundId ? 'is-selected' : ''}`);
      item.type = 'button';

      const info = el('div', 'metro-sound-item__info');
      const title = el('div', 'metro-sound-item__title');
      title.append(el('span', null, s.name));
      if (s.id === currentSoundId) {
        title.append(el('span', 'mono', '✓'));
      }
      info.append(title);
      info.append(el('div', 'metro-sound-item__desc', s.description));
      item.append(info);

      const preview = el('button', 'metro-sound-item__preview', '▶');
      preview.type = 'button';
      preview.title = `Audition ${s.name} click`;
      preview.addEventListener('click', async (e: MouseEvent) => {
        e.stopPropagation();
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        await loadSoundsetBuffers(s.id, ac);
        // Play 1 downbeat + 3 upbeats
        playMetronomePulse(ac, s.id, true, false, 0.9);
        setTimeout(() => playMetronomePulse(ac, s.id, false, false, 0.75), 180);
        setTimeout(() => playMetronomePulse(ac, s.id, false, false, 0.75), 360);
        setTimeout(() => playMetronomePulse(ac, s.id, false, false, 0.75), 540);
      });
      item.append(preview);

      item.addEventListener('click', () => {
        if (Player.setMetronomeSound) {
          Player.setMetronomeSound(s.id);
        }
        updateMetroBtnText();
        closeSoundPop();
        toast('Metronome Sound', `Switched to ${s.name}`);
      });

      soundPop.append(item);
    });

    metroGroup.append(soundPop);

    const outsideClick = (e: MouseEvent) => {
      if (soundPop && !soundPop.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
        closeSoundPop();
        document.removeEventListener('pointerdown', outsideClick);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', outsideClick), 10);
  };

  metroBtn.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openSoundPop(metroBtn);
  });

  // Drag Metronome to DAW Button
  const metroDragBtn = el('button', 'pill pill--metro-drag');
  metroDragBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 11l5 5 5-5M4 20h16"/></svg><span>Drag Click</span>`;
  metroDragBtn.title = 'Drag metronome click audio (.wav) or MIDI to your DAW (Right-click to toggle Audio vs MIDI)';
  metroDragBtn.draggable = true;

  let dragFormat: 'audio' | 'midi' = 'audio';

  const triggerMetronomeDrag = async (e: DragEvent) => {
    e.preventDefault();
    const effectiveBpm = projectBpm || (Player.getMetronomeBpm && Player.getMetronomeBpm()) || 120;
    const effectiveSig = Player.getMetronomeSignature() || projectSig || '4/4';
    const soundId = Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton';
    const cleanProj = (entry.name || 'Click').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanSig = effectiveSig.replace('/', '-');

    if (dragFormat === 'audio') {
      const fileName = `${cleanProj}_Metronome_${effectiveBpm}BPM_${cleanSig}.wav`;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', fileName);
        e.dataTransfer.effectAllowed = 'copy';
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        e.dataTransfer.setDragImage(canvas, 0, 0);
      }
      const wavBytes = await generateMetronomeWav(soundId, effectiveBpm, effectiveSig, 4);
      if (window.api && window.api.dragAudio) {
        await window.api.dragAudio(fileName, Array.from(wavBytes));
      }
    } else {
      const midiFileName = `${cleanProj}_Metronome_${effectiveBpm}BPM_${cleanSig}.mid`;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', midiFileName);
        e.dataTransfer.effectAllowed = 'copy';
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        e.dataTransfer.setDragImage(canvas, 0, 0);
      }
      const midiBytes = generateMetronomeMidi(effectiveBpm, effectiveSig, 8);
      if (window.api && window.api.dragMidi) {
        await window.api.dragMidi(midiFileName, Array.from(midiBytes));
      }
    }
  };

  metroDragBtn.addEventListener('dragstart', triggerMetronomeDrag);

  metroDragBtn.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragFormat = dragFormat === 'audio' ? 'midi' : 'audio';
    metroDragBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 11l5 5 5-5M4 20h16"/></svg><span>Drag ${dragFormat.toUpperCase()}</span>`;
    toast('Drag Metronome', `Format switched to ${dragFormat === 'audio' ? 'Audio (.wav)' : 'MIDI (.mid)'}`);
  });

  metroDragBtn.addEventListener('click', async (e: MouseEvent) => {
    e.stopPropagation();
    const effectiveBpm = projectBpm || (Player.getMetronomeBpm && Player.getMetronomeBpm()) || 120;
    const effectiveSig = Player.getMetronomeSignature() || projectSig || '4/4';
    const soundId = Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton';
    const cleanProj = (entry.name || 'Click').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanSig = effectiveSig.replace('/', '-');

    if (dragFormat === 'audio') {
      const fileName = `${cleanProj}_Metronome_${effectiveBpm}BPM_${cleanSig}.wav`;
      const wavBytes = await generateMetronomeWav(soundId, effectiveBpm, effectiveSig, 4);
      if (window.api && window.api.dragAudio) {
        await window.api.dragAudio(fileName, Array.from(wavBytes));
      } else {
        const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else {
      const midiFileName = `${cleanProj}_Metronome_${effectiveBpm}BPM_${cleanSig}.mid`;
      const midiBytes = generateMetronomeMidi(effectiveBpm, effectiveSig, 8);
      if (window.api && window.api.saveMidi) {
        await window.api.saveMidi(midiFileName, Array.from(midiBytes));
      }
    }
  });

  const updateMetroUI = () => {
    const isPlaying = Player.isPlaying();
    const isMetroOn = Player.isMetronome();
    const activeSig = Player.getMetronomeSignature() || projectSig || '4/4';

    metroBtn.classList.toggle('is-on', isMetroOn);
    if (!isPlaying) {
      metroBtn.classList.add('is-disabled-audio');
      metroBtn.title = 'Metronome active when audio plays (press ▶ on any render or audio file to sync - Right-click to change sound)';
    } else {
      metroBtn.classList.remove('is-disabled-audio');
      metroBtn.title = 'Toggle audio-synced metronome click (Right-click to change sound)';
    }

    metroSigWrap.innerHTML = '';
    if (isMetroOn) {
      metroSigWrap.style.display = 'inline-flex';
      let sigOptions: string[];
      if (projectSig === '6/8' || projectSig === '3/4' || activeSig === '6/8' || activeSig === '3/4') {
        sigOptions = ['6/8', '3/4'];
      } else if (projectSig === '7/8' || projectSig === '7/4' || activeSig === '7/8' || activeSig === '7/4') {
        sigOptions = ['7/8', '7/4'];
      } else if (projectSig === '5/8' || projectSig === '5/4' || activeSig === '5/8' || activeSig === '5/4') {
        sigOptions = ['5/8', '5/4'];
      } else if (projectSig) {
        sigOptions = [projectSig, '4/4'];
      } else {
        sigOptions = ['4/4', '3/4'];
      }

      sigOptions.forEach((sig) => {
        const btn = el('button', `pill pill--sm metro-sig-pill ${activeSig === sig ? 'is-on pill--solid' : ''}`, sig);
        btn.title = `Switch metronome to ${sig}`;
        btn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          Player.setMetronomeSignature(sig);
          updateMetroUI();
        });
        metroSigWrap.append(btn);
      });
    } else {
      metroSigWrap.style.display = 'none';
    }
  };

  metroBtn.addEventListener('click', () => {
    if (projectBpm !== null) {
      Player.setMetronomeBpm(projectBpm);
    }
    if (projectSig) {
      Player.setMetronomeSignature(projectSig);
    }
    Player.setMetronome(!Player.isMetronome());
    updateMetroUI();
  });

  metroGroup.append(metroBtn, metroSigWrap, metroDragBtn);
  actions.append(metroGroup);
  updateMetroUI();
  updateMetroUI();

  /* Scale Modulation / Change Detector Button */
  const cachedScaleMod = projectScaleModCache.get(entry.path) || null;
  const scaleModBtn = el('button', `pill pill--scale-mod ${cachedScaleMod ? 'is-on' : ''}`);
  scaleModBtn.innerHTML = cachedScaleMod
    ? `🎼 Scale changes (${cachedScaleMod.uniqueKeys.length} ${cachedScaleMod.uniqueKeys.length === 1 ? 'key' : 'keys'})`
    : '🎼 Detect scale changes';
  scaleModBtn.title = 'Deliberately scan for scale changes, key modulations, and relative raagas across track timeline';

  // If there is already a cached report for this project, display the bar above the waveform
  renderScaleModBar(cachedScaleMod, entry);

  scaleModBtn.addEventListener('click', async () => {
    const restoreBtn = setBtnLoading(scaleModBtn as HTMLButtonElement, 'Analysing scale changes…');

    try {
      let channelData: Float32Array | null = null;
      let sampleRate = 44100;

      // 1. Check if audio is already decoded or playing in player for this project
      const currentLoaded = Player.getCurrent();
      const decodedBuf = Player.getDecoded();

      const isCurrentForThisProject = currentLoaded && (
        currentLoaded.project === entry.name ||
        (typeof currentLoaded.project === 'object' && (
          currentLoaded.project?.name === entry.name ||
          currentLoaded.project?.path === entry.path ||
          currentLoaded.project?.sessionPath === entry.sessionPath
        )) ||
        currentLoaded.path.includes(entry.name) ||
        (entry.path && currentLoaded.path.startsWith(entry.path)) ||
        (entry.folder && currentLoaded.path.startsWith(entry.folder)) ||
        (entry.isGroup && Array.isArray(entry.versions) && entry.versions.some((v: any) => currentLoaded.path.includes(v.name) || currentLoaded.path.startsWith(v.path)))
      );

      if (decodedBuf && isCurrentForThisProject) {
        channelData = decodedBuf.getChannelData(0);
        sampleRate = decodedBuf.sampleRate;
      } else if (currentLoaded && isCurrentForThisProject && currentLoaded.path) {
        const buf = await Player.decode({ path: currentLoaded.path, name: currentLoaded.name });
        if (buf) {
          channelData = buf.getChannelData(0);
          sampleRate = buf.sampleRate;
        }
      }

      // 2. Otherwise find the main render/audio file in this project
      if (!channelData) {
        const renderRes = await window.api.findRenders(
          entry.sessionPath,
          entry.root,
          stemsFolderFor(entry),
          siblingsOf(entry)
        );

        let audioFileToAnalyze = renderRes?.renders?.[0]?.primary?.path || renderRes?.renders?.[0]?.files?.[0]?.path || null;

        // If grouped project and no render found in primary session, check sibling versions
        if (!audioFileToAnalyze && entry.isGroup && Array.isArray(entry.versions)) {
          for (const ver of entry.versions) {
            if (ver.sessionPath === entry.sessionPath) continue;
            try {
              const verRes = await window.api.findRenders(
                ver.sessionPath,
                ver.root || entry.root,
                stemsFolderFor(ver),
                siblingsOf(ver)
              );
              const verFile = verRes?.renders?.[0]?.primary?.path || verRes?.renders?.[0]?.files?.[0]?.path;
              if (verFile) {
                audioFileToAnalyze = verFile;
                break;
              }
            } catch {}
          }
        }

        if (!audioFileToAnalyze && entry.sessionPath) {
          const siblings = siblingsOf(entry);
          const firstAudio = siblings.find((s: string) => /\.(wav|mp3|flac|aif|aiff)$/i.test(s));
          if (firstAudio) audioFileToAnalyze = firstAudio;
        }

        if (!audioFileToAnalyze && entry.folder) {
          try {
            const allAudio = await window.api.listAllAudio(entry.folder);
            if (allAudio && allAudio.length > 0) {
              audioFileToAnalyze = allAudio[0].path || allAudio[0];
            }
          } catch {}
        }

        if (!audioFileToAnalyze) {
          restoreBtn();
          toast('Scale Change Detector', 'No audio file or bounce found in this project to analyze.');
          return;
        }

        const bytes = await window.api.readMedia(audioFileToAnalyze);
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuf: ArrayBuffer =
          bytes instanceof ArrayBuffer
            ? bytes.slice(0)
            : ArrayBuffer.isView(bytes) && bytes.buffer instanceof ArrayBuffer
              ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
              : (new Uint8Array(bytes)).buffer as ArrayBuffer;
        const decoded = await ac.decodeAudioData(arrayBuf);
        channelData = decoded.getChannelData(0);
        sampleRate = decoded.sampleRate;
        await ac.close();
      }

      if (!channelData || channelData.length === 0) {
        restoreBtn();
        toast('Scale Change Detector', 'Could not decode audio samples for scale change analysis.', true);
        return;
      }

      // Run sliding-window scale modulation analysis OFF the main thread
      const report = await detectScaleModulationsInBackground(channelData, sampleRate);
      projectScaleModCache.set(entry.path, report);

      restoreBtn();
      scaleModBtn.classList.add('is-on');
      scaleModBtn.innerHTML = `🎼 Scale changes (${report.uniqueKeys.length} ${report.uniqueKeys.length === 1 ? 'key' : 'keys'})`;

      renderScaleModBar(report, entry);

      if (report.hasModulation) {
        toast('Scale Changes Detected', `Found modulations: ${report.uniqueKeys.join(' ➔ ')}! Click a section to seek · Double-click to inspect.`);
      } else {
        toast('Scale Analysis', `Steady tonal center: ${report.uniqueKeys[0] || 'track'}. Click sections to audition.`);
      }
    } catch (err: any) {
      console.error('Scale modulation analysis failed:', err);
      toast('Scale Detector Error', err.message || String(err), true);
      restoreBtn();
    }
  });

  actions.append(scaleModBtn);

  Player.onChange(() => {
    updateMetroUI();
  });

  viewEl.append(actions);

  /* missing-media audit (Ableton sets only, best-effort) */
  const auditBox = el('div', 'sample-audit');
  viewEl.append(auditBox);
  runSampleAudit(entry, facts, auditBox);

  /* tabs */
  const tabs = el('div', 'tabs project-tabs');
  tabs.style.padding = '0 12px 18px';
  const projectTabs = [
    ['projectfiles', 'Project files'],
    ['renders', 'Renders'],
    ['stems', 'Stems'],
    ['notes', 'Notes & variations'],
    ['tools', 'Tools'],
    ['allaudio', 'All audio']
  ];
  if (entry.videoCount > 0) projectTabs.splice(1, 0, ['videos', 'Videos']);
  if (bpmFor(entry) !== null || record(entry.path).camelot) projectTabs.push(['matches', 'Matches']);

  projectTabs.forEach(([key, label]) => {
    const tab = el('button', 'pill', label);
    if (projectTab === key) tab.classList.add('is-on');
    tab.addEventListener('click', () => {
      if (key === 'tools') projectTool = null;
      projectTab = key;
      render();
    });
    tabs.append(tab);
  });
  viewEl.append(tabs);

  setTimeout(() => {
    if (view === 'project' && openProject) {
      startProjectWalkthrough();
    }
  }, 300);

  if (projectTab === 'projectfiles') return renderProjectFilesTab(entry);
  if (projectTab === 'videos') return renderVideosTab(entry);
  if (projectTab === 'renders') return renderRendersTab(entry);
  if (projectTab === 'stems') return renderStemsTab(entry);
  if (projectTab === 'notes') return renderNotesTab(entry);
  if (projectTab === 'tools') return renderProjectToolsTab(entry);
  if (projectTab === 'allaudio') return renderAllAudioTab(entry);
  if (projectTab === 'matches') return renderMatchesTab(entry);
  return renderProjectFilesTab(entry);
}

/**
 * Cross-project harmonic + tempo matches for this project. Excludes the
 * project's own folder so it surfaces genuinely different work you could mix
 * or collab with. Logic + tests live in matching.ts.
 */
function renderMatchesTab(entry) {
  const rec = record(entry.path);
  const target = { ...entry, bpm: bpmFor(entry) };
  const others = entries
    .filter((e) => e.folder !== entry.folder)
    .map((e) => ({ ...e, bpm: bpmFor(e) }));
  const matches = findMatches(target, rec, others, (e) => record(e.path));

  const section = el('div', 'section');
  section.append(headRow('Compatible projects'));
  section.append(
    el(
      'div',
      'callout',
      'Projects that mix well with this one — the same or a neighbouring Camelot key, and a matching tempo (half- and double-time count). Analyse a render on a project to detect its key.'
    )
  );

  if (!matches.length) {
    section.append(el('p', 'muted', 'No harmonically compatible projects found yet.'));
    viewEl.append(section);
    return;
  }

  const list = el('div');
  matches.slice(0, 60).forEach((m) => {
    const r = record(m.entry.path);
    // Same full-width themed row as the other project tabs (a <div class="filerow">,
    // not a native <button> — that was rendering as narrow white cards).
    const row = el('div', 'filerow');

    // Icon cell: the Camelot key, or the tempo, so the match reason is visible
    // at a glance.
    row.append(
      el('div', 'projectfile__icon', r.camelot || (m.entry.bpm ? formatBpm(m.entry.bpm) : '♪'))
    );

    const middle = el('div');
    middle.append(el('div', 'filerow__name', m.entry.name));
    const bits = [
      m.entry.bpm ? `${formatBpm(m.entry.bpm)} BPM` : null,
      r.key ? `${r.key}${r.camelot ? ` (${r.camelot})` : ''}` : null,
      m.entry.location
    ].filter(Boolean);
    const meta = el('div', 'filerow__meta', bits.join('  ·  '));
    // Keep the (often long) location on one line; full path on hover.
    meta.style.whiteSpace = 'nowrap';
    meta.style.overflow = 'hidden';
    meta.style.textOverflow = 'ellipsis';
    if (m.entry.location) meta.title = m.entry.location;
    middle.append(meta);
    row.append(middle);

    // Reason chip (accent) + spacer to fill the 4-column filerow grid.
    const reason = [m.keyRelation, m.tempoRelation].filter(Boolean).join(' · ');
    row.append(reason ? el('span', 'badge badge--match', reason) : el('span'));
    row.append(el('span'));

    row.addEventListener('click', () => goProject(m.entry));
    list.append(row);
  });
  section.append(list);
  viewEl.append(section);
}

function renderProjectToolsTab(entry) {
  if (projectTool) {
    const backBar = el('div', 'tool-back');
    const back = el('button', 'breadcrumb__link', '← All tools');
    back.addEventListener('click', () => {
      projectTool = null;
      render();
    });
    backBar.append(back);
    viewEl.append(backBar);

    if (projectTool === 'randomizer') return renderRandomizerTool(entry);
    if (projectTool === 'rename' || projectTool === 'batch-rename' || projectTool === 'smart-rename') {
      if (renamerSubMode === 'smart') return renderSmartRenameTab(entry);
      return renderRenameTab(entry);
    }
    if (projectTool === 'silence') return renderSilenceTab(entry);
    if (projectTool === 'trim') return renderTrimTab(entry);
    if (projectTool === 'qc') return renderQcTab(entry);
  }

  const section = el('div', 'section');
  section.append(headRow('Tools', 'Choose a job when you need it. Keeping these utilities together leaves the project page focused on the music, files and versions.', 'tools'));

  const grid = el('div', 'tool-grid');
  [
    {
      key: 'randomizer',
      icon: 'dice',
      title: 'Producer Randomizer & Genre Challenge',
      text: 'Generate random musical ideas: key, scale, matching Indian Raagas, BPM, Tala meter, and 48+ genre challenges.'
    },
    {
      key: 'rename',
      icon: 'sparkles',
      title: 'Renamer',
      text: 'AI-assisted Smart stem classifier and bulk batch filename pattern tool.'
    },
    {
      key: 'silence',
      icon: 'scissors',
      title: 'Strip silence',
      text: 'Find trailing silence in WAV files and make trimmed copies without touching the originals.'
    },
    {
      key: 'trim',
      icon: 'crop',
      title: 'Trim audio',
      text: 'Drag handles on the waveform to crop a WAV to a chosen region, audition it, and save a copy.'
    },
    {
      key: 'qc',
      icon: 'check',
      title: 'Check audio',
      text: 'Flag quiet files, silent files and loops that may drift or click when repeated.'
    }
  ].forEach((tool) => {
    const card = el('button', 'tool-card');
    card.type = 'button';
    card.append(svgIcon(tool.icon, 'tool-card__icon', 20));
    const copy = el('span', 'tool-card__copy');
    copy.append(el('b', 'tool-card__title', tool.title));
    copy.append(el('span', 'tool-card__text', tool.text));
    card.append(copy, el('span', 'tool-card__open', 'Open →'));
    card.addEventListener('click', () => {
      projectTool = tool.key;
      render();
    });
    grid.append(card);
  });
  section.append(grid);
  viewEl.append(section);
}

/* ------------------------------ videos ---------------------------- */

function renderVideosTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Videos', basename(entry.folder)));

  const list = el('div');
  list.append(el('p', 'muted', 'Reading video files…'));
  section.append(list);
  viewEl.append(section);

  window.api
    .listVideos(entry.folder)
    .then((files) => {
      list.innerHTML = '';
      if (!files.length) {
        list.append(el('p', 'muted', 'No video files remain in this folder. Press Rescan to update the tab.'));
        return;
      }

      files.forEach((file) => {
        const row = el('div', 'filerow');
        row.append(el('div', 'projectfile__icon', file.ext.replace('.', '').toUpperCase()));

        const middle = el('div');
        middle.append(el('div', 'filerow__name', file.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            `${formatBytes(file.size)}  ·  ${timeAgo(file.modified)}`
          )
        );
        row.append(middle, el('span'));

        const actions = el('div', 'filerow__actions');
        const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
        reveal.addEventListener('click', (event) => {
          event.stopPropagation();
          window.api.reveal(file.path);
        });

        const open = el('button', 'pill pill--solid pill--sm', 'Open');
        open.addEventListener('click', async (event) => {
          event.stopPropagation();
          const error = await window.api.open(file.path);
          if (error) toast('Could not open video', error, true);
        });
        actions.append(reveal, open);
        row.append(actions);

        row.title = file.path;
        row.addEventListener('dblclick', () => window.api.open(file.path));
        list.append(row);
      });
    })
    .catch((error) => {
      list.innerHTML = '';
      list.append(el('p', 'muted', error.message));
    });
}

function fact(label, value) {
  const node = el('div', 'statchip');
  node.append(el('span', 'statchip__label', label));
  node.append(el('span', 'statchip__value', value));
  return node;
}

async function openWithGuard(entry) {
  const result = await window.api.openProject(entry.sessionPath, entry.name);
  if (result.cancelled) return;
  if (result.error) toast('Could not open', result.error, true);
}

/* --------------------------- project files ------------------------ */

function renderProjectFilesTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Project files', basename(entry.folder)));
  section.append(
    el(
      'div',
      'callout',
      'Every DAW project file in this folder. Open the programmed version when you need to change the arrangement, or the bounced version when you need to render stems.'
    )
  );

  const files = entries
    .filter((candidate) => candidate.folder === entry.folder)
    .slice()
    .sort((a, b) => b.modified - a.modified);

  if (files.length === 0) {
    section.append(el('p', 'muted', 'No project files found in this folder.'));
    viewEl.append(section);
    return;
  }

  files.forEach((file) => {
    const row = el('div', 'filerow');

    const item: SelectedItem = {
      id: file.sessionPath,
      name: basename(file.sessionPath),
      path: file.sessionPath,
      size: file.size,
      type: 'project'
    };

    row.append(createSelectHandle(item));

    row.append(
      el('div', 'projectfile__icon', file.ext.replace('.', '').toUpperCase())
    );

    const middle = el('div');
    middle.append(el('div', 'filerow__name', basename(file.sessionPath)));
    middle.append(
      el(
        'div',
        'filerow__meta',
        [
          file.daw,
          file.bpm !== null ? `${formatBpm(file.bpm)} BPM` : null,
          `${file.backupCount} save${file.backupCount === 1 ? '' : 's'}`,
          timeAgo(file.modified),
          formatBytes(file.size)
        ]
          .filter(Boolean)
          .join('  ·  ')
      )
    );
    row.append(middle);

    row.append(
      file.sessionPath === entry.sessionPath
        ? el('span', 'badge badge--packaged', 'Current page')
        : el('span')
    );

    const dragHint = el('span', 'filerow__drag-hint', '⤓ Drag');
    dragHint.title = 'Drag project session file';
    row.append(dragHint);

    const actions = el('div', 'filerow__actions');
    const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
    reveal.addEventListener('click', (event) => {
      event.stopPropagation();
      window.api.reveal(file.sessionPath);
    });

    const open = el('button', 'pill pill--solid pill--sm', 'Open');
    open.addEventListener('click', async (event) => {
      event.stopPropagation();
      await openWithGuard(file);
    });
    actions.append(reveal, open);
    row.append(actions);

    row.title = file.sessionPath;
    row.addEventListener('dblclick', () => openWithGuard(file));
    attachDraggableAndSelectable(row, item);
    section.append(row);
  });

  viewEl.append(section);
}

/* ------------------------------ renders --------------------------- */

function renderRendersTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Renders'));
  const list = el('div');
  section.append(list);
  viewEl.append(section);

  loadRenders(entry, list);
}

function renderRendersList(entry: any, container: HTMLElement, result: any) {
  container.innerHTML = '';

  if (!result || !result.renders || !result.renders.length) {
    container.append(
      el(
        'p',
        'muted',
        `No render found matching "${entry.name}". Looked in this folder and in Renders, Bounces and Stems folders up to the root.`
      )
    );
    return;
  }

  // Grouped by where they were found, so Renders, Bounces and loose files
  // stay visually separate instead of merging into one long list.
  const byPlace = new Map();
  result.renders.forEach((render: any) => {
    const where = render.where || 'Elsewhere';
    if (!byPlace.has(where)) byPlace.set(where, []);
    byPlace.get(where).push(render);
  });

  for (const [where, list] of byPlace) {
    const heading = el('div', 'page__kicker', where);
    heading.style.margin = '14px 0 6px';
    container.append(heading);
    list.forEach((render: any) => container.append(buildRenderRow(entry, render)));
  }
}

async function loadRenders(entry: any, container: HTMLElement) {
  const cacheKey = entry.sessionPath || entry.path;
  const cached = projectRendersCache.get(cacheKey);

  if (cached) {
    renderRendersList(entry, container, cached);
  } else {
    container.append(el('p', 'muted', 'Looking for audio…'));
  }

  try {
    const result = await window.api.findRenders(
      entry.sessionPath,
      entry.root,
      stemsFolderFor(entry),
      siblingsOf(entry)
    );

    projectRendersCache.set(cacheKey, result);

    if (container.isConnected) {
      const cachedPaths = cached?.renders?.map((r: any) => r.primary?.path).join('|');
      const newPaths = result?.renders?.map((r: any) => r.primary?.path).join('|');
      if (!cached || cachedPaths !== newPaths) {
        renderRendersList(entry, container, result);
      }
    }
  } catch (err) {
    if (!cached && container.isConnected) {
      container.innerHTML = '';
      container.append(el('p', 'muted', 'Could not search for renders.'));
    }
  }
}

function buildRenderRow(entry, render) {
  const row = el('div', 'filerow');

  const item: SelectedItem = {
    id: render.primary.path,
    name: render.label,
    path: render.primary.path,
    size: render.size,
    type: 'render'
  };

  row.append(createSelectHandle(item));

  const isAnalysed = isFileAnalysed(render.primary.path, render.primary.name, entry);
  const analyse = el('button', `pill pill--sm ${isAnalysed ? 'is-analysed' : ''}`, isAnalysed ? 'Analysed' : 'Analyse');
  if (isAnalysed) {
    analyse.title = 'Already analysed (stored in Knowledge Base). Click to re-analyse.';
  }
  analyse.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, render, analyse, { interactive: true });
  });

  const play = el('button', 'filerow__play', '▶');
  play.addEventListener('click', async (event) => {
    event.stopPropagation();
    await Player.load(render.primary, { autoplay: true, project: entry || openProject });
    if (entry) {
      await analyseRender(entry, { primary: render.primary }, analyse, { refresh: false, interactive: false });
    }
  });
  row.append(play);

  const middle = el('div');
  const nameRow = el('div', 'filerow__name-row');
  nameRow.append(el('span', 'filerow__name', render.label));

  // Draggable & click-to-analyse format buttons (WAV, MP3, FLAC, AIFF)
  const formatFiles = render.files && render.files.length ? render.files : [render.primary];
  const sortedFormats = [...formatFiles].sort((a, b) => {
    if (a.ext === '.wav') return -1;
    if (b.ext === '.wav') return 1;
    return (a.ext || '').localeCompare(b.ext || '');
  });

  const pillsWrap = el('span', 'format-pills');
  sortedFormats.forEach((fmtFile) => {
    const extClean = (fmtFile.ext || '').replace('.', '').toUpperCase();
    const pill = el('button', `format-pill format-pill--${extClean.toLowerCase()}`, extClean);
    pill.title = `Single click: play & analyse ${extClean} (${formatBytes(fmtFile.size)}) · Hold & drag directly to WhatsApp/DAW`;
    pill.draggable = true;

    pill.addEventListener('dragstart', async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.api && window.api.dragFiles) {
        await window.api.dragFiles([fmtFile.path]);
      }
    });

    pill.addEventListener('click', async (e: MouseEvent) => {
      e.stopPropagation();
      // Single click: load, analyse, and play that specific format!
      await Player.load(fmtFile, { autoplay: true, project: entry || openProject });
      if (entry) {
        await analyseRender(entry, { primary: fmtFile }, analyse, { refresh: false, interactive: false });
      }
    });

    pillsWrap.append(pill);
  });
  nameRow.append(pillsWrap);
  middle.append(nameRow);

  middle.append(
    el(
      'div',
      'filerow__meta',
      [
        render.part,
        formatBytes(render.size),
        timeAgo(render.modified)
      ]
        .filter(Boolean)
        .join('  ·  ')
    )
  );
  row.append(middle);

  row.append(
    render.version !== null
      ? el('span', 'badge badge--packaged', `v${render.version}`)
      : el('span')
  );

  const dragHint = el('span', 'filerow__drag-hint', '⤓ Drag');
  dragHint.title = 'Drag file into DAW or Explorer';
  row.append(dragHint);

  row.append(analyse);

  row.dataset.path = render.primary.path;
  row.addEventListener('dblclick', async () => {
    await Player.load(render.primary, { autoplay: true, project: entry || openProject });
    if (entry) {
      await analyseRender(entry, { primary: render.primary }, analyse, { refresh: false, interactive: false });
    }
  });
  attachDraggableAndSelectable(row, item);
  return row;
}

/* ------------------------------- stems --------------------------- */

function renderStemsTab(entry) {
  const section = el('div', 'section');
  const rec = record(entry.path);
  section.append(headRow('Stems', rec.stemsPath ? basename(rec.stemsPath) : 'No folder selected'));

  const controls = el('div', 'tabs');
  if (rec.stemsPath) {
    const reveal = el('button', 'pill pill--solid', `Open folder in ${settings.fileManager}`);
    reveal.addEventListener('click', () => window.api.reveal(rec.stemsPath));
    controls.append(reveal);
  }

  const choose = el(
    'button',
    'pill',
    rec.stemsPath ? 'Change stems folder' : 'Choose stems folder'
  );
  choose.addEventListener('click', async () => {
    const updated = await window.api.chooseStems(entry.path);
    if (updated) {
      records[entry.path] = updated;
      render();
    }
  });
  controls.append(choose);

  if (rec.stemsPath) {
    const renameStemsBtn = el('button', 'pill', '⚡ Smart Rename stems');
    renameStemsBtn.title = 'Open Smart Renamer with this stems folder';
    renameStemsBtn.addEventListener('click', () => {
      smartRenameFolder = rec.stemsPath;
      projectTab = 'tools';
      projectTool = 'rename';
      renamerSubMode = 'smart';
      render();
    });
    controls.append(renameStemsBtn);
  }
  section.append(controls);

  if (!rec.stemsPath) {
    section.append(
      el(
        'div',
        'callout',
        'Choose the folder where you keep this project’s stems. Its audio files will then appear here.'
      )
    );
    viewEl.append(section);
    return;
  }

  /* Stems Search & Quick Filter Controls */
  const searchWrap = el('div', 'stems-search-bar');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'stems-search-input';
  searchInput.placeholder = '🔍 Search stems (e.g. Battery, Keyscape, Omnisphere, GTR, Vox)…';

  const clearSearchBtn = el('button', 'pill pill--sm', 'Clear');
  clearSearchBtn.style.display = 'none';

  const searchCount = el('span', 'stems-search-count', '');
  searchWrap.append(searchInput, clearSearchBtn, searchCount);
  section.append(searchWrap);

  const quickFilters = el('div', 'stems-quick-filters');
  section.append(quickFilters);

  const list = el('div');
  const cachedStems = projectStemsCache.get(rec.stemsPath);
  if (!cachedStems) {
    list.append(el('p', 'muted', 'Reading stems folder…'));
  }
  section.append(list);
  viewEl.append(section);

  loadStems(entry, rec.stemsPath, list, searchInput, searchCount, clearSearchBtn as HTMLButtonElement, quickFilters);
}

async function loadStems(
  entry: any,
  folder: string,
  container: HTMLElement,
  searchInput: HTMLInputElement,
  searchCount: HTMLElement,
  clearSearchBtn: HTMLButtonElement,
  quickFilters: HTMLElement
) {
  function renderStemsContent(files: any[]) {
    container.innerHTML = '';

    if (!files.length) {
      container.append(el('p', 'muted', 'No WAV, MP3, AIFF, FLAC or OGG files found in this folder.'));
      searchCount.textContent = '0 stems';
      quickFilters.innerHTML = '';
      return;
    }

    // Extract unique instrument / stem prefixes for quick filter tags
    const prefixCounts = new Map<string, number>();
    for (const f of files) {
      const clean = f.name.replace(/\.[^.]+$/, '');
      const tokens = clean.split(/[^a-zA-Z0-9]+/).filter((t: string) => t.length >= 3 && !/^\d+$/.test(t));
      if (tokens.length > 0) {
        const topToken = tokens[0];
        prefixCounts.set(topToken, (prefixCounts.get(topToken) || 0) + 1);
      }
    }

    // Build quick filter buttons
    quickFilters.innerHTML = '';
    const allPill = el('button', 'pill pill--sm is-active', `All (${files.length})`) as HTMLButtonElement;
    quickFilters.append(allPill);

    const topPrefixes = [...prefixCounts.entries()]
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const filterButtons: HTMLButtonElement[] = [allPill];

    topPrefixes.forEach(([name, count]) => {
      const pill = el('button', 'pill pill--sm', `${name} (${count})`) as HTMLButtonElement;
      pill.addEventListener('click', () => {
        searchInput.value = name;
        applyFilter();
        searchInput.focus();
      });
      quickFilters.append(pill);
      filterButtons.push(pill);
    });

    allPill.addEventListener('click', () => {
      searchInput.value = '';
      applyFilter();
      searchInput.focus();
    });

    function applyFilter() {
      const q = (searchInput.value || '').trim().toLowerCase();
      clearSearchBtn.style.display = q ? 'inline-block' : 'none';

      // Update active state on filter pills
      filterButtons.forEach((b) => {
        const bText = (b.textContent || '').split(' ')[0].toLowerCase();
        if (!q && b === allPill) b.classList.add('is-active');
        else if (q && bText === q) b.classList.add('is-active');
        else b.classList.remove('is-active');
      });

      const filtered = q
        ? files.filter((f: any) => f.name.toLowerCase().includes(q) || (f.relPath && f.relPath.toLowerCase().includes(q)))
        : files;

      searchCount.textContent = `Showing ${filtered.length} of ${files.length} stems`;

      container.innerHTML = '';
      if (!filtered.length) {
        container.append(el('p', 'muted', `No stems matching "${q}".`));
        return;
      }

      filtered.forEach((file: any) => container.append(buildStemRow(entry, file)));
    }

    searchInput.oninput = () => applyFilter();
    clearSearchBtn.onclick = () => {
      searchInput.value = '';
      searchInput.focus();
      applyFilter();
    };

    applyFilter();
  }

  const cached = projectStemsCache.get(folder);
  if (cached) {
    renderStemsContent(cached);
  }

  try {
    const files = await window.api.listAllAudio(folder);
    projectStemsCache.set(folder, files);

    if (container.isConnected) {
      const cachedPaths = cached?.map((f: any) => f.path).join('|');
      const newPaths = files?.map((f: any) => f.path).join('|');
      if (!cached || cachedPaths !== newPaths) {
        renderStemsContent(files);
      }
    }
  } catch (err) {
    if (!cached && container.isConnected) {
      container.innerHTML = '';
      container.append(el('p', 'muted', 'Could not read stems folder.'));
    }
  }
}

function buildStemRow(entry, file) {
  const row = el('div', 'filerow');

  const item: SelectedItem = {
    id: file.path,
    name: file.name,
    path: file.path,
    size: file.size,
    type: 'stem'
  };

  row.append(createSelectHandle(item));

  const play = el('button', 'filerow__play', '▶');
  play.addEventListener('click', (event) => {
    event.stopPropagation();
    Player.load(file, { project: entry || openProject });
  });
  row.append(play);

  const middle = el('div');
  const nameRow = el('div', 'filerow__name-row');
  nameRow.append(el('span', 'filerow__name', file.name));

  const extClean = (file.ext || '').replace('.', '').toUpperCase();
  if (extClean) {
    const pill = el('button', `format-pill format-pill--${extClean.toLowerCase()}`, extClean);
    pill.title = `Hold & Drag ${extClean} directly · Click to audition (${formatBytes(file.size)})`;
    pill.draggable = true;
    pill.addEventListener('dragstart', async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.api && window.api.dragFiles) {
        await window.api.dragFiles([file.path]);
      }
    });
    pill.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      Player.load(file, { project: entry || openProject });
    });
    const pillsWrap = el('span', 'format-pills');
    pillsWrap.append(pill);
    nameRow.append(pillsWrap);
  }
  middle.append(nameRow);

  middle.append(
    el(
      'div',
      'filerow__meta',
      [file.folder, formatBytes(file.size), timeAgo(file.modified)]
        .filter(Boolean)
        .join('  ·  ')
    )
  );
  row.append(middle, el('span'));

  const dragHint = el('span', 'filerow__drag-hint', '⤓ Drag');
  dragHint.title = 'Drag stem into DAW or Explorer';
  row.append(dragHint);

  const actions = el('div', 'filerow__actions');
  actions.append(analyseAudioButton(entry, file));
  const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
  reveal.addEventListener('click', (event) => {
    event.stopPropagation();
    window.api.reveal(file.path);
  });
  actions.append(reveal);
  row.append(actions);
  row.dataset.path = file.path;
  row.addEventListener('dblclick', () => Player.load(file, { project: entry || openProject }));
  attachDraggableAndSelectable(row, item);
  return row;
}

function analyseAudioButton(entry, file) {
  const isAnalysed = isFileAnalysed(file.path, file.name, entry);
  const button = el('button', `pill pill--sm ${isAnalysed ? 'is-analysed' : ''}`, isAnalysed ? 'Analysed' : 'Analyse');
  if (isAnalysed) {
    button.title = 'Already analysed (stored in Knowledge Base). Click to re-analyse.';
  }
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, { primary: file }, button, { refresh: false, interactive: true });
  });
  return button;
}

async function analyseRender(
  entry: any,
  renderItem: any,
  buttonEl?: HTMLElement | null,
  { refresh = true, force = false, interactive = false }: { refresh?: boolean; force?: boolean; interactive?: boolean } = {}
) {
  const file = renderItem?.primary;
  if (!file) return null;

  const existing = getFileAnalysis(file.path, file.name, entry);

  if (existing && !force) {
    if (interactive) {
      let desc = '';
      if (existing.key) desc += `Key: ${existing.key}${existing.camelot ? ` (${existing.camelot})` : ''}`;
      else if (existing.tonic && existing.scale) desc += `Scale: Tonic ${existing.tonic} · ${existing.scale}`;
      if (existing.bpm) desc += `${desc ? ' · ' : ''}BPM: ${Math.round(existing.bpm * 10) / 10}`;
      if (existing.timeSignature) desc += ` · Meter: ${existing.timeSignature}`;

      const confirmed = await showConfirmModal({
        title: 'Re-analyse Audio?',
        icon: '🎧',
        message: `"${file.name}" has already been analysed and is stored in your knowledge base.`,
        details: desc || 'Analysis data is cached in knowledge base',
        confirmText: 'Yes, Re-analyse',
        cancelText: 'No (Keep Cached)'
      });

      if (!confirmed) {
        if (entry) {
          await storeAnalysis(entry, file, existing);
          if (refresh) patchAnalysisUI(entry, existing);
        }
        toast('Using Knowledge Base', `"${file.name}" is already analysed`);
        return existing;
      }
    } else {
      // Non-interactive load (playback / pill click / dblclick): immediately apply knowledge base result
      if (entry) {
        await storeAnalysis(entry, file, existing);
        if (refresh) patchAnalysisUI(entry, existing);
      }
      return existing;
    }
  }

  const restoreBtn = buttonEl ? setBtnLoading(buttonEl as HTMLButtonElement, 'Reading…') : () => {};

  try {
    const current = Player.getCurrent();
    let decoded =
      current && current.path === file.path && Player.getDecoded()
        ? Player.getDecoded()
        : await Player.decode(file);

    if (!decoded) {
      decoded = await Player.load(file, { autoplay: false, project: entry || openProject });
    }

    if (!decoded) {
      toast('Analysis failed', 'That file could not be decoded.', true);
      restoreBtn();
      return null;
    }

    if (buttonEl) buttonEl.innerHTML = '<span class="btn-spinner"></span> Analysing…';
    const result = await analyseAudioFile(file, decoded);

    // Save to in-memory knowledge base cache
    audioAnalysisCache.set(file.path, result);

    // Save to persistent file record
    await saveRecord(file.path, {
      analysis: result,
      key: result.key,
      camelot: result.camelot,
      keyConfidence: result.keyConfidence,
      keyAlternate: result.keyAlternate,
      tonic: result.tonic,
      tonicConfidence: result.tonicConfidence,
      scale: result.scale,
      scaleConfidence: result.scaleConfidence,
      modal: result.modal,
      detectedBpm: result.bpm,
      detectedTimeSignature: result.timeSignature || null,
      detectedTala: result.tala ? result.tala.name : null,
      chordProgression: result.chordProgression,
      analysedFrom: file.name
    });

    if (entry) {
      await storeAnalysis(entry, file, result);
    }

    showAnalysisResult(entry || { name: file.name }, result);
    if (refresh) patchAnalysisUI(entry, result);

    if (buttonEl) {
      buttonEl.classList.add('is-analysed');
      buttonEl.textContent = 'Analysed';
      buttonEl.title = 'Already analysed (stored in Knowledge Base). Click to re-analyse.';
    }

    return result;
  } catch (error: any) {
    toast('Analysis failed', error.message || String(error), true);
    return null;
  } finally {
    restoreBtn();
  }
}

/* ------------------------------------------------------------------
   patchAnalysisUI — surgically update key/BPM chips and project
   harmony hero in place after analysis, with randomized reveal animation.
   ------------------------------------------------------------------ */
const REVEAL_CLASSES = ['reveal-smoke', 'reveal-glass', 'reveal-poster', 'reveal-pop'] as const;

function pickReveal() {
  return REVEAL_CLASSES[Math.floor(Math.random() * REVEAL_CLASSES.length)];
}

function animateChip(chip: HTMLElement) {
  // Remove all reveal classes first (handles replaying when same chip gets new data)
  REVEAL_CLASSES.forEach(c => chip.classList.remove(c));
  // Force reflow so CSS animation replays even if same class is re-added
  void chip.offsetWidth;
  chip.classList.add(pickReveal());
  // Clean up animation class after it finishes to allow future re-animation
  chip.addEventListener('animationend', () => {
    REVEAL_CLASSES.forEach(c => chip.classList.remove(c));
  }, { once: true });
}

function patchAnalysisUI(entry: any, result: any) {
  if (!result) return;

  // 1. Update detail-page key chip:
  const keyChip = document.querySelector<HTMLElement>('.statchip[data-analysis-chip="key"]');
  if (keyChip) {
    const label = keyChip.querySelector('.statchip__label') as HTMLElement;
    const value = keyChip.querySelector('.statchip__value') as HTMLElement;
    if (result.key) {
      if (label) label.textContent = 'Key';
      if (value) value.textContent = `${result.key}${result.camelot ? ` (${result.camelot})` : ''}`;
    } else if (result.tonic && result.scale) {
      if (label) label.textContent = 'Scale';
      if (value) value.textContent = `Tonic ${result.tonic} · ${result.scale}`;
    }
    keyChip.style.display = '';
    animateChip(keyChip);
  }

  // 2. Update BPM stat chip:
  const bpmChip = document.querySelector<HTMLElement>('.statchip[data-analysis-chip="bpm"]');
  if (bpmChip && result.bpm) {
    const value = bpmChip.querySelector('.statchip__value') as HTMLElement;
    if (value) value.textContent = String(Math.round(result.bpm));
    animateChip(bpmChip);
  }

  // 3. Update project hero harmony container (.page__harmony) in place!
  // This updates the SVG keyboard, Camelot mini wheel, and World Scale / Raaga suggestions!
  if (entry) {
    const oldHarmony = document.querySelector<HTMLElement>('.page__harmony');
    if (oldHarmony && oldHarmony.parentElement) {
      const rec = record(entry.path);
      const effectiveBpm = bpmFor(entry) || result.bpm;
      const newHarmony = renderProjectHarmony(entry, rec, effectiveBpm);
      oldHarmony.replaceWith(newHarmony);
      animateChip(newHarmony);
    }
  }

  // 4. Also update sticky bar chip if visible:
  const stickyBar = document.getElementById('projectStickyBar');
  if (stickyBar) {
    const stickyChips = stickyBar.querySelectorAll<HTMLElement>('.sticky-bar__chip');
    stickyChips.forEach(chip => {
      const txt = chip.textContent || '';
      if (txt.includes('BPM') && result.bpm) {
        chip.textContent = `${Math.round(result.bpm)} BPM`;
        animateChip(chip);
      }
    });
    let keyBarChip = stickyBar.querySelector<HTMLElement>('.sticky-bar__chip[data-sticky-key]');
    if (!keyBarChip && result.key) {
      keyBarChip = document.createElement('span');
      keyBarChip.className = 'sticky-bar__chip';
      keyBarChip.dataset.stickyKey = '1';
      const meta = stickyBar.querySelector('.sticky-bar__meta');
      if (meta) meta.append(keyBarChip);
    }
    if (keyBarChip && result.key) {
      keyBarChip.textContent = `${result.key}${result.camelot ? ` (${result.camelot})` : ''}`;
      animateChip(keyBarChip);
    }
  }

  // 5. Update any in-list row that happens to be visible (keycell__key / keycell__camelot)
  const allKeyRows = document.querySelectorAll<HTMLElement>('.keycell__key');
  allKeyRows.forEach(cell => {
    if (result.key) cell.textContent = result.key;
    else if (result.tonic) cell.textContent = result.tonic;
  });
  const allCamelotRows = document.querySelectorAll<HTMLElement>('.keycell__camelot');
  allCamelotRows.forEach(cell => {
    if (result.camelot) cell.textContent = result.camelot;
    else if (result.scale) cell.textContent = result.scale;
  });
}

function ensureAnalysisWorker() {
  if (analysisWorker) return analysisWorker;

  analysisWorker = new Worker('./analysis-worker.js');
  analysisWorker.addEventListener('message', (event) => {
    const pending = pendingAnalysis.get(event.data.id);
    if (!pending) return;
    pendingAnalysis.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.result);
  });
  analysisWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The background analyser stopped unexpectedly.');
    pendingAnalysis.forEach((pending) => pending.reject(error));
    pendingAnalysis.clear();
    analysisWorker.terminate();
    analysisWorker = null;
  });
  return analysisWorker;
}

function analyseDecodedInBackground(decoded: AudioBuffer): Promise<any> {
  const worker = ensureAnalysisWorker();
  const id = ++analysisRequestId;
  const samples = new Float32Array(decoded.getChannelData(0));

  return new Promise<any>((resolve, reject) => {
    pendingAnalysis.set(id, { resolve, reject });
    worker.postMessage(
      { id, type: 'analyse', samples, sampleRate: decoded.sampleRate },
      [samples.buffer]
    );
  });
}

/** Runs DSP.detectScaleModulations off the main thread. */
function detectScaleModulationsInBackground(channelData: Float32Array, sampleRate: number): Promise<any> {
  const worker = ensureAnalysisWorker();
  const id = ++analysisRequestId;
  const samples = new Float32Array(channelData); // copy so original buffer stays valid

  return new Promise((resolve, reject) => {
    pendingAnalysis.set(id, { resolve, reject });
    worker.postMessage(
      { id, type: 'detectScaleModulations', samples, sampleRate },
      [samples.buffer]
    );
  });
}

/**
 * Show a spinner on a button while work is in progress.
 * Returns a restore function that puts the button back to its original state.
 */
function setBtnLoading(btn: HTMLButtonElement, label: string): () => void {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = `<span class="btn-spinner"></span> ${label}`;
  return () => {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = original;
  };
}

function analyseAudioFile(file, decoded) {
  const existing = analysisJobs.get(file.path);
  if (existing) return existing;

  const job = analyseDecodedInBackground(decoded).finally(() => {
    if (analysisJobs.get(file.path) === job) analysisJobs.delete(file.path);
  });
  analysisJobs.set(file.path, job);
  return job;
}

async function storeAnalysis(entry, file, result) {
  if (result.timeSignature) {
    Player.setMetronomeSignature(result.timeSignature);
  }
  if (result.bpm && !bpmFor(entry)) {
    Player.setMetronomeBpm(result.bpm);
  }
  await saveRecord(entry.path, {
    key: result.key,
    camelot: result.camelot,
    keyConfidence: result.keyConfidence,
    keyAlternate: result.keyAlternate,
    tonic: result.tonic,
    tonicConfidence: result.tonicConfidence,
    scale: result.scale,
    scaleConfidence: result.scaleConfidence,
    modal: result.modal,
    detectedBpm: result.bpm,
    detectedTimeSignature: result.timeSignature || null,
    detectedTala: result.tala ? result.tala.name : null,
    chordProgression: result.chordProgression,
    analysis: result,
    analysedFrom: file.name
  });
}

function showAnalysisResult(entry, result) {
  let keyDescription;
  if (result.key) {
    keyDescription = `${result.key}${result.camelot ? ` (${result.camelot})` : ''}`;
  } else if (result.tonic && result.scale) {
    keyDescription = `Tonic ${result.tonic} · ${result.scale}`;
  } else {
    keyDescription = 'Key not detected';
  }

  const talaText = result.tala
    ? `${result.timeSignature} (${result.tala.name.split('/')[0].trim()})`
    : result.timeSignature || '';

  const detected = [
    keyDescription,
    result.bpm ? `${result.bpm} BPM` : 'BPM not detected',
    talaText
  ]
    .filter(Boolean)
    .join(' · ');

  const drift = entry.bpm && result.bpm ? Math.abs(entry.bpm - result.bpm) : null;

  toast(
    'Audio analysed',
    detected +
      (drift !== null && drift > 1.5
        ? ` — session says ${formatBpm(entry.bpm)}, worth a look`
        : '')
  );
}

async function analysePlayedAudio(entry, file, decoded) {
  if (analysisJobs.has(file.path)) return;

  activePlayAnalysis.set(entry.path, file.path);
  render();

  try {
    const result = await analyseAudioFile(file, decoded);
    await storeAnalysis(entry, file, result);
    showAnalysisResult(entry, result);
  } catch (error) {
    toast('Background analysis failed', error.message || String(error), true);
  } finally {
    if (activePlayAnalysis.get(entry.path) === file.path) {
      activePlayAnalysis.delete(entry.path);
      render();
    }
  }
}

/* ------------------------------- notes ---------------------------- */

function renderNotesTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Notes', entry.name));

  section.append(
    el(
      'div',
      'callout',
      'Saved as a text file next to the project, named after this version and the time you last edited it. Each session file keeps its own note.'
    )
  );

  const area = el('textarea', 'notes');
  area.placeholder = 'Mix notes, references, what to fix next time…';
  const status = el('div', 'notestatus', 'Loading…');
  activeNoteEditor = { sessionPath: entry.sessionPath, area };

  let dirty = false;
  window.api.loadNote(entry.sessionPath).then(({ text, file }) => {
    if (!dirty) area.value = text || '';
    status.textContent = file ? basename(file) : 'No note file yet';
  });

  area.addEventListener('input', () => {
    dirty = true;
    status.textContent = 'Typing…';
    const prior = noteTimers.get(entry.sessionPath);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(async () => {
      noteTimers.delete(entry.sessionPath);
      const { file } = await window.api.saveNote(entry.sessionPath, area.value);
      status.textContent = file ? `Saved · ${basename(file)}` : 'Note cleared';
    }, 500);
    noteTimers.set(entry.sessionPath, timer);
  });

  section.append(area, status);

  // Other versions in the same folder, each with its own note.
  const mates = siblingsOf(entry);
  if (mates.length > 0) {
    const others = el('div');
    others.style.marginTop = '22px';
    others.append(el('div', 'page__kicker', `${mates.length} other variation(s) here`));
    entries
      .filter((other) => other.folder === entry.folder && other.path !== entry.path)
      .forEach((other) => {
        const link = el('div', 'filerow');
        link.append(el('span'));
        const middle = el('div');
        middle.append(el('div', 'filerow__name', other.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            `${other.bpm !== null ? formatBpm(other.bpm) + ' BPM  ·  ' : ''}${timeAgo(other.modified)}`
          )
        );
        link.append(middle, el('span'), el('span'));
        link.addEventListener('click', () => goProject(other));
        others.append(link);
      });
    section.append(others);
  }

  viewEl.append(section);
}

/* ------------------------------ rename ---------------------------- */

let renameFolder: string | null = null;
let renameMode = 'simple';
let renamerSubMode: 'smart' | 'bulk' = 'smart';

function renderRenamerSwitcher(entry: any = null, activeMode: 'smart' | 'bulk' = 'smart') {
  const switcher = el('div', 'renamer-mode-switcher');
  
  const smartBtn = el(
    'button',
    `renamer-mode-btn ${activeMode === 'smart' ? 'is-active' : ''}`,
    '✨ Smart renamer'
  );
  smartBtn.type = 'button';
  smartBtn.title = 'AI-assisted instrument classification for stems';
  smartBtn.addEventListener('click', () => {
    renamerSubMode = 'smart';
    if (renameFolder && !smartRenameFolder) smartRenameFolder = renameFolder;
    render();
  });

  const bulkBtn = el(
    'button',
    `renamer-mode-btn ${activeMode === 'bulk' ? 'is-active' : ''}`,
    '📝 Bulk renamer'
  );
  bulkBtn.type = 'button';
  bulkBtn.title = 'Batch pattern replace, numbering & templates';
  bulkBtn.addEventListener('click', () => {
    renamerSubMode = 'bulk';
    if (smartRenameFolder && !renameFolder) renameFolder = smartRenameFolder;
    render();
  });

  switcher.append(smartBtn, bulkBtn);
  return switcher;
}

function renderStandaloneRename() {
  viewEl.innerHTML = '';
  if (renamerSubMode === 'smart') {
    renderSmartRenameTab(null);
  } else {
    renderRenameTab(null);
  }
}

function renderRenameTab(entry = null) {
  if (!renameFolder && entry) renameFolder = entry.folder;
  if (!renameFolder && smartRenameFolder) renameFolder = smartRenameFolder;
  const projectName = entry ? entry.name : renameFolder ? basename(renameFolder) : 'chosen folder';
  const projectBpm = entry ? bpmFor(entry) : null;
  const projectRecord = entry ? record(entry.path) : {};

  const section = el('div', 'section');
  section.append(headRow('Renamer', 'Clean up prefixes/suffixes or apply token templates across audio files', 'rename'));
  section.append(renderRenamerSwitcher(entry, 'bulk'));

  /* which folder */
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Renaming files in'));
  const folderPath = el('div', 'mono', renameFolder || 'Choose a folder to begin');
  folderPath.style.margin = '6px 0 10px';
  folderPath.style.wordBreak = 'break-all';
  folderBar.append(folderPath);

  const pick = el(
    'button',
    `pill${renameFolder ? ' pill--sm' : ' pill--solid'}`,
    renameFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      renameFolder = chosen;
      render();
    }
  });
  const bar = el('div', 'tabs');
  bar.append(pick);
  if (entry) {
    const useProject = el('button', 'pill pill--sm', "This project's folder");
    useProject.addEventListener('click', () => {
      renameFolder = entry.folder;
      render();
    });
    bar.append(useProject);
  }
  folderBar.append(bar);
  section.append(folderBar);

  /* controls */
  /* mode: simple or template */
  const modeRow = el('div', 'tabs');
  modeRow.style.marginBottom = '12px';
  const simpleBtn = el(
    'button',
    `pill${renameMode === 'simple' ? ' is-on' : ''}`,
    'Remove & add'
  );
  const templateBtn = el(
    'button',
    `pill${renameMode === 'template' ? ' is-on' : ''}`,
    'Template'
  );
  modeRow.append(simpleBtn, templateBtn);
  section.append(modeRow);

  simpleBtn.addEventListener('click', () => {
    renameMode = 'simple';
    render();
  });
  templateBtn.addEventListener('click', () => {
    renameMode = 'template';
    render();
  });

  const controls = el('div', 'grid2');

  const removeField = fieldInput('Remove this text');
  removeField.input.placeholder = 'e.g. Demo_';
  controls.append(removeField.wrap);

  const addField = fieldInput('Add this text');
  addField.input.placeholder = 'e.g. MIX_';
  controls.append(addField.wrap);
  section.append(controls);

  /* prefix or suffix — either, never both */
  const where = el('div', 'fieldrow');
  where.append(el('label', null, 'Add it to the'));
  const choice = el('div', 'tabs');
  let position = 'prefix';

  const prefixBtn = el('button', 'pill is-on', 'Beginning');
  const suffixBtn = el('button', 'pill', 'End');

  function setPosition(next) {
    position = next;
    prefixBtn.classList.toggle('is-on', next === 'prefix');
    suffixBtn.classList.toggle('is-on', next === 'suffix');
    build();
  }
  prefixBtn.addEventListener('click', () => setPosition('prefix'));
  suffixBtn.addEventListener('click', () => setPosition('suffix'));

  choice.append(prefixBtn, suffixBtn);
  where.append(choice);
  section.append(where);

  /* template mode controls */
  const templateWrap = el('div');
  const templateField = fieldInput('Template');
  templateField.input.placeholder = '{project}_{name}_{n:02}';
  templateField.input.value = '{project}_{name}_{n:02}';
  templateWrap.append(templateField.wrap);

  const tokens = el('div', 'callout');
  tokens.append(el('div', 'page__kicker', 'Tokens'));
  const tokenList = el('div', 'mono');
  tokenList.style.cssText = 'font-size:11.5px;line-height:1.9;margin-top:6px';
  [
    ['{name}', 'the existing filename'],
    ['{project}', projectName],
    ['{parent}', renameFolder ? basename(renameFolder) : 'chosen folder'],
    ['{bpm}', projectBpm !== null ? String(projectBpm) : 'not available'],
    ['{key}', projectRecord.camelot || projectRecord.key || 'not available'],
    ['{date}', new Date().toISOString().slice(0, 10)],
    ['{n}, {n:02}', 'a counter, optionally padded']
  ].forEach(([token, meaning]) => {
    const line = el('div');
    line.append(el('span', null, token.padEnd(14)));
    line.append(el('span', 'muted', ` ${meaning}`));
    tokenList.append(line);
  });
  tokens.append(tokenList);
  templateWrap.append(tokens);

  if (renameMode === 'template') section.append(templateWrap);

  const summary = el('p', 'muted');
  const preview = el('div', 'preview');
  section.append(summary, preview);

  const actions = el('div', 'tabs');
  actions.style.marginTop = '14px';
  const applyBtn = el('button', 'pill pill--solid', 'Apply rename');
  const undoBtn = el('button', 'pill', 'Undo last');
  actions.append(applyBtn, undoBtn);
  section.append(actions);
  viewEl.append(section);

  let plan = null;

  async function build() {
    let files;
    try {
      files = await window.api.renameList(renameFolder, [
        '.wav',
        '.mp3',
        '.aiff',
        '.flac'
      ]);
    } catch (err) {
      summary.textContent = err.message;
      applyBtn.disabled = true;
      return;
    }

    plan = await window.api.renamePlan(
      files,
      renameMode === 'template'
        ? {
            operation: 'applyTemplate',
            template: templateField.input.value,
            projectName,
            parentFolder: basename(renameFolder),
            bpm: projectBpm,
            key: projectRecord.camelot || projectRecord.key,
            startAt: 1
          }
        : {
            operation: 'removeAndAdd',
            remove: removeField.input.value,
            add: addField.input.value,
            position
          }
    );

    preview.innerHTML = '';
    summary.textContent = `${plan.changing} of ${files.length} files would change${
      plan.problems ? ` · ${plan.problems} problem(s)` : ''
    }`;

    plan.rows.slice(0, 100).forEach((row) => {
      const node = el('div', 'prev');
      node.append(el('div', 'prev__from', row.from));
      if (row.problem) node.append(el('div', 'prev__problem', `⚠ ${row.problem}`));
      else {
        node.append(
          el(
            'div',
            row.changed ? 'prev__to' : 'prev__to prev__to--same',
            row.changed ? `→ ${row.to}` : '→ unchanged'
          )
        );
      }
      preview.append(node);
    });

    applyBtn.disabled = plan.changing === 0;
  }

  [removeField, addField, templateField].forEach((f) =>
    f.input.addEventListener('input', () => build())
  );

  // Hide whichever set of controls the current mode doesn't use.
  controls.hidden = renameMode === 'template';
  where.hidden = renameMode === 'template';

  applyBtn.addEventListener('click', async () => {
    if (!plan) return;
    const result = await window.api.renameApply(plan);
    toast(
      'Renamed',
      `${result.renamed} file(s)${result.failed.length ? `, ${result.failed.length} failed` : ''}`,
      result.failed.length > 0
    );
    build();
  });

  undoBtn.addEventListener('click', async () => {
    const result = await window.api.renameUndo();
    toast('Undo', `${result.reverted} file(s) put back`);
    build();
  });

  build();
}

function fieldInput(label) {
  const wrap = el('div', 'fieldrow');
  wrap.append(el('label', null, label));
  const input = el('input', 'input');
  input.type = 'text';
  wrap.append(input);
  return { wrap, input };
}


/* -------------------------- smart renamer ------------------------- */

let smartRenameFolder: string | null = null;
let smartFiles: Array<{ name: string; path: string }> = [];
let smartItems: Array<{
  name: string;
  path: string;
  matched: boolean;
  category: string | null;
  subtype: string | null;
  confidence: number;
  matchedOn: string | null;
  contested: boolean;
  articulation: string | null;
  userCategory?: string | null;
  userSubtype?: string | null;
  customName?: string | null;
  audioFeatures?: any;
  audioCategory?: string | null;
  audioSubtype?: string | null;
  audioConfidence?: number;
}> = [];
let smartCategoriesList: Array<{ category: string; subtypes: string[] }> = [];
let smartSelectedPath: string | null = null;
let smartSelectedSet = new Set<string>();
let smartSortMode: 'priority' | 'name' = 'priority';
let smartManifests: any[] = [];

function renderStandaloneSmartRename() {
  viewEl.innerHTML = '';
  renderSmartRenameTab(null);
}

/**
 * Reusable Typable Combobox for Category selection & custom name input with live suggestions.
 */
function createSmartCombobox(options: {
  currentCategory: string | null;
  currentSubtype: string | null;
  currentCustomName?: string | null;
  placeholder?: string;
  categoriesList: Array<{ category: string; subtypes: string[] }>;
  isBatch?: boolean;
  onApply: (result: { category: string | null; subtype: string | null; customName?: string | null }) => void;
}): HTMLElement {
  const wrap = el('div', `smart-combobox${options.isBatch ? ' smart-combobox--batch' : ''}`);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'smart-combobox__input';
  input.placeholder = options.placeholder || 'Type category or custom…';

  let initialDisplay = '';
  if (options.currentCustomName) {
    initialDisplay = options.currentCustomName;
  } else if (options.currentCategory && options.currentSubtype) {
    initialDisplay = `${options.currentCategory} / ${options.currentSubtype}`;
  } else if (options.currentCategory) {
    initialDisplay = `${options.currentCategory} (generic)`;
  }
  input.value = initialDisplay;

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'smart-combobox__arrow';
  arrow.innerHTML = '▼';
  arrow.title = 'Choose or search categories';

  const menu = el('div', 'smart-combobox__menu');
  wrap.append(input, arrow, menu);

  function parseInput(val: string): { category: string | null; subtype: string | null; customName?: string | null } {
    const raw = (val || '').trim();
    if (!raw || raw === '— Unresolved —' || raw.toLowerCase() === 'unresolved' || raw === '-') {
      return { category: null, subtype: null, customName: null };
    }

    // 1. Check exact category / subtype match (e.g. "drums / kick", "drums:kick", "drums_kick")
    const slashMatch = raw.split(/[\/:]/).map((s) => s.trim());
    if (slashMatch.length === 2) {
      const [c, s] = slashMatch;
      const foundCat = options.categoriesList.find((x) => x.category.toLowerCase() === c.toLowerCase());
      if (foundCat) {
        const foundSub = foundCat.subtypes.find((x) => x.toLowerCase() === s.toLowerCase());
        return { category: foundCat.category, subtype: foundSub || s.toLowerCase(), customName: null };
      }
    }

    // 2. Check exact category match (e.g. "drums", "percs", "percs (generic)")
    const cleanCat = raw.replace(/\s*\(generic\)\s*/i, '').trim().toLowerCase();
    const foundCat = options.categoriesList.find((x) => x.category.toLowerCase() === cleanCat);
    if (foundCat) {
      return { category: foundCat.category, subtype: null, customName: null };
    }

    // 3. Check if input matches any known subtype across categories (e.g. "tom", "snare", "tabla", "808", "lead")
    for (const c of options.categoriesList) {
      const foundSub = c.subtypes.find((s) => s.toLowerCase() === cleanCat);
      if (foundSub) {
        return { category: c.category, subtype: foundSub, customName: null };
      }
    }

    // 4. Check if user typed an exact filename ending with an audio extension
    if (/\.[a-zA-Z0-9]{2,5}$/.test(raw)) {
      return { category: null, subtype: null, customName: raw };
    }

    // 5. Otherwise treat as custom category / stem prefix
    return { category: raw, subtype: null, customName: null };
  }

  function renderMenuItems(filterQuery: string = '') {
    menu.innerHTML = '';
    const q = (filterQuery || '').trim().toLowerCase();

    // 1. Reset / Unresolved option
    const unresItem = el('div', 'smart-combobox__item is-unresolved');
    unresItem.innerHTML = '<span>— Unresolved —</span><span class="smart-combobox__item-tag">Reset</span>';
    unresItem.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = '';
      closeMenu();
      options.onApply({ category: null, subtype: null, customName: null });
    });
    menu.append(unresItem);

    // 2. Filtered Predefined Categories & Subtypes
    let exactMatchFound = false;
    for (const c of options.categoriesList) {
      const catMatches = !q || c.category.toLowerCase().includes(q);
      const matchingSubtypes = c.subtypes.filter(
        (s) => !q || s.toLowerCase().includes(q) || `${c.category} ${s}`.toLowerCase().includes(q)
      );

      if (catMatches || matchingSubtypes.length > 0) {
        const groupTitle = el('div', 'smart-combobox__group', c.category);
        menu.append(groupTitle);

        if (catMatches) {
          if (c.category.toLowerCase() === q) exactMatchFound = true;
          const genericItem = el('div', 'smart-combobox__item');
          genericItem.innerHTML = `<span>${c.category} (generic)</span><span class="smart-combobox__item-tag">Main</span>`;
          genericItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = `${c.category} (generic)`;
            closeMenu();
            options.onApply({ category: c.category, subtype: null, customName: null });
          });
          menu.append(genericItem);
        }

        for (const s of matchingSubtypes) {
          if (`${c.category} / ${s}`.toLowerCase() === q || s.toLowerCase() === q) exactMatchFound = true;
          const subItem = el('div', 'smart-combobox__item');
          subItem.innerHTML = `<span>${c.category} / <strong>${s}</strong></span><span class="smart-combobox__item-tag">${s}</span>`;
          subItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = `${c.category} / ${s}`;
            closeMenu();
            options.onApply({ category: c.category, subtype: s, customName: null });
          });
          menu.append(subItem);
        }
      }
    }

    // 3. Custom text suggestion if user typed something not explicitly identical to a standard category
    if (q && q !== 'unresolved' && !exactMatchFound) {
      const customItem = el('div', 'smart-combobox__item is-custom');
      customItem.innerHTML = `<span>⚡ Use custom: "<strong>${filterQuery}</strong>"</span><span class="smart-combobox__item-tag">Custom</span>`;
      customItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const parsed = parseInput(filterQuery);
        closeMenu();
        options.onApply(parsed);
      });
      menu.append(customItem);
    }
  }

  function openMenu() {
    renderMenuItems(input.value);
    menu.classList.add('is-open');
  }

  function closeMenu() {
    menu.classList.remove('is-open');
  }

  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
      input.focus();
      input.select();
    }
  });

  input.addEventListener('focus', () => {
    openMenu();
  });

  input.addEventListener('input', () => {
    renderMenuItems(input.value);
    menu.classList.add('is-open');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const parsed = parseInput(input.value);
      closeMenu();
      options.onApply(parsed);
    } else if (e.key === 'Escape') {
      closeMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target as Node)) {
      closeMenu();
    }
  });

  return wrap;
}

async function renderSmartRenameTab(entry: any = null) {
  if (!smartRenameFolder && entry) smartRenameFolder = entry.folder;
  if (!smartRenameFolder && renameFolder) smartRenameFolder = renameFolder;

  const section = el('div', 'section');
  section.append(headRow('Renamer', 'Classify & rename cryptic stems into mix-ready instrument categories', 'smart-rename'));
  section.append(renderRenamerSwitcher(entry, 'smart'));

  /* which folder */
  const folderBar = el('div', 'callout');
  folderBar.append(
    el(
      'div',
      'page__kicker',
      'Classify & rename cryptic stems into mix-ready instrument categories'
    )
  );
  const folderPath = el(
    'div',
    'mono',
    smartRenameFolder || 'Choose a folder to begin'
  );
  folderPath.style.margin = '6px 0 10px';
  folderPath.style.wordBreak = 'break-all';
  folderBar.append(folderPath);

  const pick = el(
    'button',
    `pill${smartRenameFolder ? ' pill--sm' : ' pill--solid'}`,
    smartRenameFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      smartRenameFolder = chosen;
      smartSelectedPath = null;
      smartSelectedSet.clear();
      render();
    }
  });

  const bar = el('div', 'tabs');
  bar.append(pick);
  if (entry) {
    const useProject = el('button', 'pill pill--sm', "This project's folder");
    useProject.addEventListener('click', () => {
      smartRenameFolder = entry.folder;
      smartSelectedPath = null;
      smartSelectedSet.clear();
      render();
    });
    bar.append(useProject);
  }

  const rescanBtn = el('button', 'pill pill--sm', 'Rescan folder');
  rescanBtn.addEventListener('click', () => loadFolder());
  bar.append(rescanBtn);

  folderBar.append(bar);
  section.append(folderBar);

  /* Manifests / Undo bar */
  const manifestContainer = el('div');
  manifestContainer.style.marginBottom = '10px';
  section.append(manifestContainer);

  /* Controls / Actions toolbar */
  const toolbar = el('div', 'tabs');
  toolbar.style.marginBottom = '12px';

  const analyseNamesBtn = el('button', 'pill pill--solid', '⚡ Analyse names');
  const analyseAudioBtn = el('button', 'pill', '🎧 Analyse audio features');

  const sortToggle = el(
    'button',
    'pill',
    smartSortMode === 'priority' ? 'Sort: Unresolved first' : 'Sort: Folder order'
  );
  sortToggle.addEventListener('click', () => {
    smartSortMode = smartSortMode === 'priority' ? 'name' : 'priority';
    sortToggle.textContent =
      smartSortMode === 'priority' ? 'Sort: Unresolved first' : 'Sort: Folder order';
    renderPanes();
  });

  toolbar.append(analyseNamesBtn, analyseAudioBtn, sortToggle);
  section.append(toolbar);

  /* Batch Actions Container */
  const batchContainer = el('div');
  section.append(batchContainer);

  /* Panes container */
  const panes = el('div', 'smart-panes');

  const leftPane = el('div', 'smart-pane smart-pane--left');
  const leftHead = el('div', 'smart-pane__header');
  const leftTitle = el('div', null);
  leftTitle.style.display = 'flex';
  leftTitle.style.alignItems = 'center';
  leftTitle.style.gap = '8px';

  const leftCheckAll = document.createElement('input');
  leftCheckAll.type = 'checkbox';
  leftCheckAll.className = 'smart-check';
  leftCheckAll.title = 'Select / Deselect all files';

  const leftTitleText = el('span', null, 'Original files');
  leftTitle.append(leftCheckAll, leftTitleText);

  const leftSub = el('span', 'smart-pane__sub', 'Click to arm audio');
  leftHead.append(leftTitle, leftSub);
  const leftBody = el('div', 'smart-pane__body');
  leftPane.append(leftHead, leftBody);

  const rightPane = el('div', 'smart-pane smart-pane--right');
  const rightHead = el('div', 'smart-pane__header');
  const rightTitle = el('span', null, 'Suggested name & Category');
  const rightSub = el('span', 'smart-pane__sub', 'Live indexed output');
  rightHead.append(rightTitle, rightSub);
  const rightBody = el('div', 'smart-pane__body');
  rightPane.append(rightHead, rightBody);

  panes.append(leftPane, rightPane);
  section.append(panes);

  /* Footer / Commit toolbar */
  const footBar = el('div', 'callout');
  footBar.style.marginTop = '14px';
  const summary = el('p', 'muted');
  summary.style.margin = '0 0 10px 0';
  const commitActions = el('div', 'tabs');
  const commitBtn = el('button', 'pill pill--solid', 'Rename files');
  const undoLastBtn = el('button', 'pill', 'Undo last rename');
  commitActions.append(commitBtn, undoLastBtn);
  footBar.append(summary, commitActions);
  section.append(footBar);

  viewEl.append(section);

  async function loadFolder() {
    if (!smartRenameFolder) {
      summary.textContent = 'Choose a folder to begin classifying stems.';
      commitBtn.disabled = true;
      return;
    }
    try {
      smartFiles = await window.api.renameList(smartRenameFolder, [
        '.wav',
        '.mp3',
        '.aiff',
        '.aif',
        '.flac'
      ]);
      smartCategoriesList = await window.api.smartCategories();
      try {
        smartManifests = await window.api.renameManifests(smartRenameFolder);
      } catch {
        smartManifests = [];
      }
      renderManifests();
      await runNameAnalysis();
    } catch (err: any) {
      summary.textContent = `Error reading folder: ${err.message}`;
    }
  }

  function renderManifests() {
    manifestContainer.innerHTML = '';
    if (!smartManifests || smartManifests.length === 0) return;
    const box = el('div', 'callout');
    box.style.padding = '10px 14px';
    const kick = el('div', 'page__kicker', 'Previous rename history');
    const list = el('div', 'manifest-list');
    smartManifests.slice(0, 3).forEach((m) => {
      const pill = el('button', 'manifest-pill');
      pill.type = 'button';
      const dateStr = m.manifest.at ? new Date(m.manifest.at).toLocaleDateString() : 'recent';
      pill.textContent = `↩ Revert ${m.manifest.count} files (${dateStr})${m.manifest.undone ? ' · already reverted' : ''}`;
      if (m.manifest.undone) pill.disabled = true;
      pill.addEventListener('click', async () => {
        const res = await window.api.renameManifestRevert(smartRenameFolder, m.file);
        if (res.ok) {
          toast('Manifest Reverted', `Restored ${res.reverted} file names`);
          await loadFolder();
        } else {
          toast('Revert Failed', res.message || 'Could not revert manifest', true);
        }
      });
      list.append(pill);
    });
    box.append(kick, list);
    manifestContainer.append(box);
  }

  async function runNameAnalysis() {
    if (smartFiles.length === 0) {
      smartItems = [];
      smartSelectedSet.clear();
      renderPanes();
      return;
    }
    const { results } = await window.api.smartClassify(smartRenameFolder, smartFiles);
    smartItems = results.map((r: any) => ({
      name: r.name,
      path: r.path,
      matched: r.matched,
      category: r.category,
      subtype: r.subtype,
      confidence: r.confidence,
      matchedOn: r.matchedOn,
      contested: r.contested,
      articulation: r.articulation,
      userCategory: null,
      userSubtype: null,
      customName: null
    }));
    smartSelectedSet.clear();
    renderPanes();
  }

  async function runAudioAnalysis() {
    if (smartItems.length === 0) return;
    const restoreBtn = setBtnLoading(analyseAudioBtn as HTMLButtonElement, 'Analysing audio…');
    let measured = 0;
    for (const item of smartItems) {
      const isWav = item.name.toLowerCase().endsWith('.wav');
      if (isWav) {
        try {
          const res = await window.api.smartAudioFeatures(item.path);
          if (res && res.ok) {
            item.audioFeatures = res.features;
            item.audioCategory = res.category;
            item.audioSubtype = res.subtype;
            item.audioConfidence = res.confidence;
            if (!item.matched && res.category) {
              item.category = res.category;
              item.subtype = res.subtype;
              item.confidence = res.confidence;
              item.matchedOn = 'audio feature';
            }
            measured++;
          }
        } catch {
          /* ignore single file error */
        }
      }
    }
    restoreBtn();
    toast('Audio Analysis', `Extracted features & verified ${measured} file(s)`);
    renderPanes();
  }

  analyseNamesBtn.addEventListener('click', () => runNameAnalysis());
  analyseAudioBtn.addEventListener('click', () => runAudioAnalysis());

  function pathExt(fname: string) {
    const i = fname.lastIndexOf('.');
    return i !== -1 ? fname.slice(i) : '';
  }

  function computeOutputNames() {
    const counts = new Map<string, number>();
    const planRows: Array<{ path: string; from: string; to: string; changed: boolean; problem: string | null; item: any }> = [];

    const ordered = [...smartItems].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const item of ordered) {
      const ext = pathExt(item.name);
      const cat = item.userCategory !== undefined && item.userCategory !== null ? item.userCategory : item.category;
      const sub = item.userSubtype !== undefined && item.userSubtype !== null ? item.userSubtype : item.subtype;

      if (!cat) {
        const targetName = item.customName || item.name;
        planRows.push({
          path: item.path,
          from: item.name,
          to: targetName,
          changed: targetName !== item.name,
          problem: null,
          item
        });
        continue;
      }

      let key = sub ? `${cat}_${sub}` : cat;

      // Smart vocal modifier / artist preservation (e.g. "vox lals", "vox ritesh", "vocal lalasa")
      if (cat === 'vox' || cat === 'vocal') {
        const cleanStem = item.name.replace(/\.[^.]+$/, '');
        const tokens = cleanStem
          .split(/[^a-zA-Z0-9]+/)
          .map((t: string) => t.toLowerCase())
          .filter((t: string) => t.length >= 3 && !/^\d+$/.test(t));
        const ignoredTokens = new Set([
          'vox',
          'vocal',
          'vocals',
          'leadvox',
          'lead',
          'main',
          'raw',
          'dry',
          'wet',
          'take',
          'comp',
          'audio',
          'track',
          'stem',
          'consolidated'
        ]);
        const artistToken = tokens.find((t: string) => !ignoredTokens.has(t));
        if (artistToken) {
          key = sub && sub !== 'lead' ? `${cat}_${artistToken}_${sub}` : `${cat}_${artistToken}`;
        }
      }

      const currentCount = (counts.get(key) || 0) + 1;
      counts.set(key, currentCount);

      const targetName = item.customName || `${key}_${currentCount}${ext}`;
      planRows.push({
        path: item.path,
        from: item.name,
        to: targetName,
        changed: targetName !== item.name,
        problem: null,
        item
      });
    }

    const seen = new Map<string, string>();
    for (const r of planRows) {
      const lk = r.to.toLowerCase();
      if (seen.has(lk)) {
        r.problem = `Same new name as "${seen.get(lk)}"`;
      } else {
        seen.set(lk, r.from);
      }
    }

    return planRows;
  }

  function renderPanes() {
    leftBody.innerHTML = '';
    rightBody.innerHTML = '';
    batchContainer.innerHTML = '';

    const planRows = computeOutputNames();
    const rowsByPath = new Map(planRows.map((r) => [r.path, r]));

    leftTitleText.textContent = `Original files (${smartItems.length})${smartSelectedSet.size > 0 ? ` · ${smartSelectedSet.size} selected` : ''}`;

    // Update Header Select All Checkbox state
    leftCheckAll.checked = smartItems.length > 0 && smartSelectedSet.size === smartItems.length;
    leftCheckAll.indeterminate = smartSelectedSet.size > 0 && smartSelectedSet.size < smartItems.length;
    leftCheckAll.onchange = () => {
      if (leftCheckAll.checked) {
        smartItems.forEach((it) => smartSelectedSet.add(it.path));
      } else {
        smartSelectedSet.clear();
      }
      renderPanes();
    };

    /* Render Batch Bar if 1 or more files are selected */
    if (smartSelectedSet.size > 0) {
      const batchBar = el('div', 'smart-batch-bar');
      const batchInfo = el('div', 'smart-batch-bar__info');
      batchInfo.innerHTML = `<span>☑ <strong>${smartSelectedSet.size}</strong> of ${smartItems.length} files selected</span>`;

      const batchActions = el('div', 'smart-batch-bar__actions');

      let currentBatchChoice: { category: string | null; subtype: string | null; customName?: string | null } = {
        category: null,
        subtype: null,
        customName: null
      };

      const batchCombobox = createSmartCombobox({
        currentCategory: null,
        currentSubtype: null,
        placeholder: 'Batch category (e.g. percs, drums / tom)…',
        categoriesList: smartCategoriesList,
        isBatch: true,
        onApply: (res) => {
          currentBatchChoice = res;
          applyBatchChoice(res);
        }
      });

      const applyBtn = el('button', 'pill pill--solid pill--sm', `Apply to ${smartSelectedSet.size} files`);
      applyBtn.addEventListener('click', () => {
        applyBatchChoice(currentBatchChoice);
      });

      async function applyBatchChoice(choice: { category: string | null; subtype: string | null; customName?: string | null }) {
        let count = 0;
        for (const item of smartItems) {
          if (smartSelectedSet.has(item.path)) {
            item.userCategory = choice.category;
            item.userSubtype = choice.subtype;
            item.customName = choice.customName || null;
            item.confidence = 1.0;
            count++;

            if (choice.category) {
              const tokens = (item.name || '').split(/[^a-zA-Z0-9]+/).filter((t: string) => t.length > 2);
              await window.api.userDictLearn(tokens, choice.category, choice.subtype || null);
            }
          }
        }
        const label = choice.category ? (choice.subtype ? `${choice.category}_${choice.subtype}` : choice.category) : choice.customName || 'Unresolved';
        toast('Batch Rename Applied', `Set "${label}" for ${count} selected files`);
        renderPanes();
      }

      const selectUnresolvedBtn = el('button', 'pill pill--sm', 'Select Unresolved');
      selectUnresolvedBtn.addEventListener('click', () => {
        smartSelectedSet.clear();
        smartItems.forEach((it) => {
          const cat = it.userCategory !== undefined && it.userCategory !== null ? it.userCategory : it.category;
          if (!cat) smartSelectedSet.add(it.path);
        });
        renderPanes();
      });

      const invertBtn = el('button', 'pill pill--sm', 'Invert');
      invertBtn.addEventListener('click', () => {
        smartItems.forEach((it) => {
          if (smartSelectedSet.has(it.path)) smartSelectedSet.delete(it.path);
          else smartSelectedSet.add(it.path);
        });
        renderPanes();
      });

      const clearBtn = el('button', 'pill pill--sm', 'Clear Selection');
      clearBtn.addEventListener('click', () => {
        smartSelectedSet.clear();
        renderPanes();
      });

      batchActions.append(batchCombobox, applyBtn, selectUnresolvedBtn, invertBtn, clearBtn);
      batchBar.append(batchInfo, batchActions);
      batchContainer.append(batchBar);
    }

    let displayItems = [...smartItems];
    if (smartSortMode === 'priority') {
      displayItems.sort((a, b) => {
        const rank = (item: any) => {
          const cat = item.userCategory !== undefined && item.userCategory !== null ? item.userCategory : item.category;
          if (!cat) return 0;
          if (item.confidence < 0.8) return 1;
          return 2;
        };
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
    } else {
      displayItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }

    let changingCount = 0;
    let unresolvedCount = 0;

    for (const item of displayItems) {
      const planRow = rowsByPath.get(item.path);
      const isSelected = item.path === smartSelectedPath;
      const isChecked = smartSelectedSet.has(item.path);
      const cat = item.userCategory !== undefined && item.userCategory !== null ? item.userCategory : item.category;
      const sub = item.userSubtype !== undefined && item.userSubtype !== null ? item.userSubtype : item.subtype;
      const isChanged = planRow ? planRow.changed : false;
      if (isChanged && !planRow?.problem) changingCount++;
      if (!cat) unresolvedCount++;

      /* Left Row */
      const lRow = el('div', `smart-row${isSelected ? ' is-selected' : ''}${isChecked ? ' is-checked' : ''}${cat ? ' is-matched' : ' is-unresolved'}`);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'smart-check';
      check.checked = isChecked;
      check.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      check.addEventListener('change', () => {
        if (check.checked) smartSelectedSet.add(item.path);
        else smartSelectedSet.delete(item.path);
        renderPanes();
      });

      const lName = el('span', 'smart-row__name', item.name);
      lName.title = item.name;

      let badgeType = 'smart-badge--miss';
      let badgeText = '? Unresolved';
      if (cat) {
        if (item.confidence >= 0.8) {
          badgeType = 'smart-badge--ok';
          badgeText = `✔ ${sub ? `${cat}_${sub}` : cat}`;
        } else {
          badgeType = 'smart-badge--warn';
          badgeText = `⚠ ${sub ? `${cat}_${sub}` : cat}`;
        }
      }
      const lBadge = el('span', `smart-badge ${badgeType}`, badgeText);
      lRow.append(check, lName, lBadge);

      lRow.addEventListener('click', () => {
        smartSelectedPath = item.path;
        Player.load({ path: item.path, name: item.name, ext: pathExt(item.name) });
        renderPanes();
      });
      leftBody.append(lRow);

      /* Right Row */
      const rRow = el('div', `smart-row${isSelected ? ' is-selected' : ''}${isChecked ? ' is-checked' : ''}`);
      const suggestedText = planRow ? planRow.to : item.name;
      const rName = el('span', 'smart-row__name', suggestedText);
      rName.title = suggestedText;
      rName.style.fontWeight = isChanged ? '600' : 'normal';
      if (isChanged) rName.style.color = 'var(--amber)';

      /* Searchable Typable Combobox for Category */
      const rowCombobox = createSmartCombobox({
        currentCategory: cat,
        currentSubtype: sub,
        currentCustomName: item.customName,
        categoriesList: smartCategoriesList,
        onApply: async (res) => {
          item.userCategory = res.category;
          item.userSubtype = res.subtype;
          item.customName = res.customName || null;
          item.confidence = 1.0;
          const tokens = (item.name || '').split(/[^a-zA-Z0-9]+/).filter((t: string) => t.length > 2);
          if (item.userCategory) {
            await window.api.userDictLearn(tokens, item.userCategory, item.userSubtype || null);
          }
          renderPanes();
        }
      });

      // Cross-verification pill if audio analysis suggests a distinct instrument
      let audioInsightPill: HTMLElement | null = null;
      if (item.audioCategory) {
        const audioFull = item.audioSubtype ? `${item.audioCategory} / ${item.audioSubtype}` : item.audioCategory;
        const currentFull = sub ? `${cat} / ${sub}` : (cat || '');
        if (audioFull !== currentFull) {
          audioInsightPill = el('button', 'smart-audio-insight-pill', `⚡ Sounds like: ${audioFull}`);
          audioInsightPill.title = `Audio analysis detected ${audioFull}. Click to apply.`;
          audioInsightPill.addEventListener('click', (e) => {
            e.stopPropagation();
            item.userCategory = item.audioCategory;
            item.userSubtype = item.audioSubtype;
            item.customName = null;
            item.confidence = 1.0;
            renderPanes();
          });
        }
      }

      let reasonText = '';
      if (item.userCategory || item.customName) reasonText = 'Manual override';
      else if (item.matchedOn) reasonText = `Matched "${item.matchedOn}"`;
      else if (item.audioFeatures) reasonText = `Audio centroid ${item.audioFeatures.centroid}Hz`;
      const rReason = el('span', 'smart-reason', reasonText);

      const rightControls = el('div', null);
      rightControls.style.display = 'flex';
      rightControls.style.alignItems = 'center';
      rightControls.style.gap = '6px';
      rightControls.append(rowCombobox);
      if (audioInsightPill) rightControls.append(audioInsightPill);
      rightControls.append(rReason);

      rRow.append(rName, rightControls);

      rRow.addEventListener('click', (e) => {
        if (e.target && ((e.target as HTMLElement).closest('.smart-combobox'))) return;
        smartSelectedPath = item.path;
        Player.load({ path: item.path, name: item.name, ext: pathExt(item.name) });
        renderPanes();
      });
      rightBody.append(rRow);
    }

    summary.textContent = `${changingCount} of ${smartItems.length} files will be renamed · ${unresolvedCount} unresolved (kept original)`;
    commitBtn.disabled = changingCount === 0;
    commitBtn.textContent = `Rename ${changingCount} files`;

    commitBtn.onclick = async () => {
      const plan = {
        rows: planRows.map((r) => ({
          path: r.path,
          from: r.from,
          to: r.to,
          changed: r.changed,
          problem: r.problem
        })),
        changing: changingCount,
        problems: planRows.filter((r) => r.problem).length,
        tool: 'smart-rename'
      };
      const outcome = await window.api.renameApply(plan, { tool: 'smart-rename' });
      toast('Smart Rename Applied', `Renamed ${outcome.renamed} file(s)${outcome.failed && outcome.failed.length ? ` (${outcome.failed.length} failed)` : ''}`, Boolean(outcome.failed && outcome.failed.length > 0));
      await loadFolder();
    };

    undoLastBtn.onclick = async () => {
      const outcome = await window.api.renameUndo();
      toast('Undo', `${outcome.reverted} file(s) restored`);
      await loadFolder();
    };
  }

  loadFolder();
}

/* ------------------------- audio finishing ----------------------- */

function renderAudioFinishing() {
  viewEl.innerHTML = '';

  const section = el('div', 'section');
  section.append(headRow('Audio finishing'));
  section.append(
    el(
      'div',
      'callout callout--warn',
      'Normalizes WAV peak level and optionally trims long files to an exact beat/bar length. Finished copies are written to the output folder; originals are never changed. Short files are never stretched or padded.'
    )
  );

  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Reading WAVs from'));
  const folderPath = el('div', 'mono', finishFolder || 'Choose a folder to begin');
  folderPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(folderPath);
  const choose = el(
    'button',
    `pill${finishFolder ? ' pill--sm' : ' pill--solid'}`,
    finishFolder ? 'Choose a different folder' : 'Choose folder'
  );
  choose.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (!chosen) return;
    finishFolder = chosen;
    finishResults = [];
    finishChosen = new Set();
    render();
  });
  folderBar.append(choose);
  section.append(folderBar);

  let normalize = true;
  let trimToBars = true;
  const modeRow = el('div', 'tabs');
  const normalizeBtn = el('button', 'pill is-on', 'Normalize peak');
  const trimBtn = el('button', 'pill is-on', 'Fit to bars');
  modeRow.append(normalizeBtn, trimBtn);
  section.append(modeRow);

  const controls = el('div', 'grid2');
  const peak = fieldInput('Target peak (dB)');
  peak.input.type = 'number';
  peak.input.step = '0.1';
  peak.input.value = '-1';
  const bpm = fieldInput('BPM');
  bpm.input.type = 'number';
  bpm.input.min = '20';
  bpm.input.max = '400';
  bpm.input.value = '120';
  const bars = fieldInput('Bars');
  bars.input.type = 'number';
  bars.input.min = '1';
  bars.input.value = '4';
  const beats = fieldInput('Beats per bar');
  beats.input.type = 'number';
  beats.input.min = '1';
  beats.input.value = '4';
  controls.append(peak.wrap, bpm.wrap, bars.wrap, beats.wrap);
  section.append(controls);

  const actions = el('div', 'tabs');
  const analyseBtn = el('button', 'pill pill--solid', 'Analyse folder');
  const selectAllBtn = el('button', 'pill', 'Select all');
  const clearBtn = el('button', 'pill', 'Clear selection');
  const processBtn = el('button', 'pill', 'Create finished copies');
  analyseBtn.disabled = !finishFolder;
  selectAllBtn.disabled = true;
  clearBtn.disabled = true;
  processBtn.disabled = true;
  actions.append(analyseBtn, selectAllBtn, clearBtn, processBtn);
  section.append(actions);

  const status = el('p', 'muted');
  finishProgressStatus = status;
  status.style.marginTop = '12px';
  if (!finishFolder) status.textContent = 'Choose any folder containing WAV files.';
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  function currentOptions() {
    return {
      normalize,
      trimToBars,
      targetPeakDb: Number(peak.input.value),
      bpm: Number(bpm.input.value),
      bars: Number(bars.input.value),
      beatsPerBar: Number(beats.input.value)
    };
  }

  function updateButtons() {
    const selectable = finishResults.filter((result) => !result.error && result.changing).length;
    selectAllBtn.disabled = selectable === 0 || finishChosen.size === selectable;
    clearBtn.disabled = finishChosen.size === 0;
    processBtn.disabled = finishChosen.size === 0;
    processBtn.textContent = finishChosen.size
      ? `Create finished copies (${finishChosen.size})`
      : 'Create finished copies';
  }

  function paint() {
    list.innerHTML = '';
    if (!finishResults.length) {
      updateButtons();
      return;
    }

    const changing = finishResults.filter((result) => !result.error && result.changing);
    status.textContent = `${changing.length} of ${finishResults.length} file(s) would change`;

    finishResults.forEach((result, index) => {
      const row = el('div', 'dupe');
      const check = el('input', 'check');
      check.type = 'checkbox';
      check.disabled = Boolean(result.error || !result.changing);
      check.checked = finishChosen.has(index);
      check.addEventListener('change', () => {
        if (check.checked) finishChosen.add(index);
        else finishChosen.delete(index);
        updateButtons();
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'dupe__name', result.name || basename(result.path)));
      const details = result.error
        ? `Skipped — ${result.error}`
        : [
            `${result.duration.toFixed(2)}s`,
            Number.isFinite(result.peakDb) ? `${result.peakDb.toFixed(1)} dB peak` : 'silent',
            result.tooShort ? 'shorter than requested length' : null,
            result.gainLimited ? 'boost limited to +24 dB' : null
          ].filter(Boolean).join(' · ');
      middle.append(el('div', 'dupe__where', details));
      row.append(middle);
      row.append(
        el(
          'div',
          'dupe__num',
          result.error || !normalize ? '—' : `${result.gainDb >= 0 ? '+' : ''}${result.gainDb.toFixed(1)} dB`
        )
      );
      row.append(
        el(
          'div',
          'dupe__num dupe__num--waste',
          result.error || !trimToBars || result.trimSeconds <= 0
            ? '—'
            : `-${result.trimSeconds.toFixed(2)}s`
        )
      );
      list.append(row);
    });
    updateButtons();
  }

  function invalidate() {
    finishResults = [];
    finishChosen = new Set();
    status.textContent = 'Settings changed — analyse again to preview the result.';
    paint();
  }

  normalizeBtn.addEventListener('click', () => {
    normalize = !normalize;
    normalizeBtn.classList.toggle('is-on', normalize);
    peak.input.disabled = !normalize;
    invalidate();
  });
  trimBtn.addEventListener('click', () => {
    trimToBars = !trimToBars;
    trimBtn.classList.toggle('is-on', trimToBars);
    [bpm.input, bars.input, beats.input].forEach((input) => { input.disabled = !trimToBars; });
    invalidate();
  });
  [peak.input, bpm.input, bars.input, beats.input].forEach((input) => {
    input.addEventListener('input', invalidate);
  });

  analyseBtn.addEventListener('click', async () => {
    if (!finishFolder) return;
    if (!normalize && !trimToBars) {
      toast('Choose an action', 'Turn on Normalize peak, Fit to bars, or both.', true);
      return;
    }
    if (trimToBars && (!(Number(bpm.input.value) > 0) || !(Number(bars.input.value) > 0))) {
      toast('Check the musical length', 'BPM and Bars must be greater than zero.', true);
      return;
    }

    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    finishResults = [];
    finishChosen = new Set();
    list.innerHTML = '';
    try {
      const files = await window.api.finishList(finishFolder);
      finishResults = await window.api.finishAnalyse(files.map((file) => file.path), currentOptions());
      finishChosen = new Set(
        finishResults
          .map((result, index) => (!result.error && result.changing ? index : -1))
          .filter((index) => index >= 0)
      );
      paint();
    } catch (error) {
      status.textContent = error.message || String(error);
    } finally {
      analyseBtn.disabled = false;
      analyseBtn.textContent = 'Analyse folder';
    }
  });

  selectAllBtn.addEventListener('click', () => {
    finishChosen = new Set(
      finishResults
        .map((result, index) => (!result.error && result.changing ? index : -1))
        .filter((index) => index >= 0)
    );
    paint();
  });
  clearBtn.addEventListener('click', () => {
    finishChosen = new Set();
    paint();
  });
  processBtn.addEventListener('click', async () => {
    const paths = [...finishChosen].map((index) => finishResults[index].path);
    if (!paths.length) return;
    processBtn.disabled = true;
    processBtn.textContent = 'Processing…';
    const result = await window.api.finishProcess(paths, currentOptions());
    if (!result.cancelled) {
      const changed = result.results.filter((item) => item.modified).length;
      const failed = result.results.filter((item) => !item.success).length;
      toast('Finished copies created', `${changed} file(s)` + (failed ? ` · ${failed} failed` : ''), failed > 0);
      if (changed) status.textContent = `Finished copies are in ${result.outputRoot}`;
    }
    processBtn.disabled = false;
    updateButtons();
  });

  paint();
}

/* --------------------------- waveform trim ------------------------ */

let trimFolder = null;
let trimFile = null; // { path, name, size }
let trimStart = 0; // seconds
let trimEnd = null; // seconds, null until a file's length is known
let trimDuration = 0; // authoritative length from trim:analyse (WAV frames / sr)
let trimPeaks = null; // Float32Array of 0..1 peaks, or null while decoding
let trimLoadToken = 0; // guards against a slow decode landing after a newer pick

function buildTrimPeaks(buffer, buckets) {
  const data = buffer.getChannelData(0);
  const n = data.length;
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(n / buckets));
  let max = 0;
  for (let b = 0; b < buckets; b += 1) {
    const start = b * size;
    let peak = 0;
    for (let i = 0; i < size && start + i < n; i += 1) {
      const v = Math.abs(data[start + i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let b = 0; b < buckets; b += 1) peaks[b] /= max;
  return peaks;
}

async function selectTrimFile(file) {
  trimFile = file;
  trimPeaks = null;
  trimStart = 0;
  trimEnd = null;
  trimDuration = 0;
  const token = ++trimLoadToken;
  render(); // reflect the selection + a "decoding" state immediately

  // Authoritative shape from the WAV itself (frames / sample rate).
  const info = await window.api.trimAnalyse(file.path);
  if (token !== trimLoadToken) return;
  if (info.error) {
    toast('Cannot read file', info.error, true);
    return;
  }
  trimDuration = info.duration;
  trimStart = 0;
  trimEnd = info.duration;

  // Decode for the waveform + wire the audio element for region audition.
  const decoded = await Player.load(file, { autoplay: false });
  if (token !== trimLoadToken) return;
  if (decoded) trimPeaks = buildTrimPeaks(decoded, 1000);
  render();
}

function renderTrimTab(entry = null) {
  if (!trimFolder && entry) trimFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Trim audio', 'Crop a WAV to a chosen region and save a copy'));
  section.append(
    el(
      'div',
      'callout',
      'Drag the two handles to choose a region, audition it on a loop, then export a trimmed copy. WAV sources only — other formats can be auditioned but not yet exported. Your original is never touched.'
    )
  );

  /* folder */
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Reading WAVs from'));
  const folderPath = el('div', 'mono', trimFolder || 'Choose a folder to begin');
  folderPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(folderPath);

  const bar = el('div', 'tabs');
  const pick = el(
    'button',
    `pill${trimFolder ? ' pill--sm' : ' pill--solid'}`,
    trimFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      trimFolder = chosen;
      trimFile = null;
      trimPeaks = null;
      render();
    }
  });
  bar.append(pick);
  if (entry) {
    const useProject = el('button', 'pill pill--sm', "This project's folder");
    useProject.addEventListener('click', () => {
      trimFolder = entry.folder;
      trimFile = null;
      trimPeaks = null;
      render();
    });
    bar.append(useProject);
  }
  folderBar.append(bar);
  section.append(folderBar);

  /* file list */
  const fileWrap = el('div');
  section.append(fileWrap);

  /* editor */
  const editor = el('div');
  editor.style.marginTop = '14px';
  section.append(editor);
  viewEl.append(section);

  if (trimFolder) {
    fileWrap.append(el('p', 'muted', 'Loading WAV files…'));
    window.api.silenceList(trimFolder).then((files) => {
      fileWrap.innerHTML = '';
      if (!files.length) {
        fileWrap.append(el('div', 'callout callout--warn', 'No WAV files in this folder.'));
        return;
      }
      const listEl = el('div', 'trim-files');
      files.forEach((file) => {
        const item = el('button', 'trim-file');
        if (trimFile && trimFile.path === file.path) item.classList.add('is-on');
        item.append(el('span', 'trim-file__name', file.name));
        item.append(el('span', 'trim-file__size', formatBytes(file.size)));
        item.addEventListener('click', () => selectTrimFile(file));
        listEl.append(item);
      });
      fileWrap.append(listEl);
    });
  }

  if (trimFile) buildTrimEditor(editor);
}

function buildTrimEditor(mount) {
  mount.innerHTML = '';
  if (!trimPeaks || !trimEnd) {
    mount.append(el('p', 'muted', 'Decoding waveform…'));
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'trim-canvas';
  mount.append(canvas);

  const readout = el('div', 'trim-readout');
  mount.append(readout);

  const controls = el('div', 'tabs');
  const audition = el('button', 'pill pill--solid', '▶ Audition region');
  const stop = el('button', 'pill', '■ Stop');
  const reset = el('button', 'pill pill--sm', 'Reset region');
  const exportBtn = el('button', 'pill pill--sm', 'Export trimmed copy');
  controls.append(audition, stop, reset, exportBtn);
  mount.append(controls);

  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#9dde64';

  const isWav = /\.wav$/i.test(trimFile.name);
  if (!isWav) {
    const note = el(
      'div',
      'muted',
      'This is not a WAV — you can audition the region, but export is WAV-only for now.'
    );
    note.style.marginTop = '8px';
    mount.append(note);
  }

  function fmtTime(s) {
    if (!Number.isFinite(s)) return '0:00.000';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function updateReadout() {
    readout.innerHTML = '';
    readout.append(el('span', 'trim-readout__item', `Start ${fmtTime(trimStart)}`));
    readout.append(el('span', 'trim-readout__item', `End ${fmtTime(trimEnd)}`));
    readout.append(
      el('span', 'trim-readout__item trim-readout__len', `Length ${fmtTime(Math.max(0, trimEnd - trimStart))}`)
    );
    exportBtn.disabled = !isWav || !(trimEnd - trimStart > 0.01);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = 160;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const mid = h / 2;
    const amp = h * 0.44;
    const step = w / trimPeaks.length;
    const x0 = (trimStart / trimDuration) * w;
    const x1 = (trimEnd / trimDuration) * w;

    function wave(color, clipX0, clipX1) {
      c.save();
      c.beginPath();
      c.rect(clipX0, 0, Math.max(0, clipX1 - clipX0), h);
      c.clip();
      c.beginPath();
      for (let i = 0; i < trimPeaks.length; i += 1) {
        const x = i * step;
        const y = trimPeaks[i] * amp;
        if (i === 0) c.moveTo(x, mid - y);
        else c.lineTo(x, mid - y);
      }
      for (let i = trimPeaks.length - 1; i >= 0; i -= 1) {
        c.lineTo(i * step, mid + trimPeaks[i] * amp);
      }
      c.closePath();
      c.fillStyle = color;
      c.fill();
      c.restore();
    }

    wave('rgba(150,160,150,0.32)', 0, w); // the whole file, dimmed
    wave(accent, x0, x1); // the chosen region, in the theme accent
    c.fillStyle = 'rgba(0,0,0,0.34)'; // darken the discarded ends
    c.fillRect(0, 0, x0, h);
    c.fillRect(x1, 0, w - x1, h);
    c.strokeStyle = accent;
    c.lineWidth = 2;
    [x0, x1].forEach((x) => {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    });
  }

  let dragging = null;
  function xToSec(clientX) {
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * trimDuration;
  }
  function moveHandle(clientX) {
    const sec = xToSec(clientX);
    const minGap = 0.02;
    if (dragging === 'start') trimStart = Math.max(0, Math.min(sec, trimEnd - minGap));
    else trimEnd = Math.min(trimDuration, Math.max(sec, trimStart + minGap));
    draw();
    updateReadout();
  }
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const x0 = (trimStart / trimDuration) * w;
    const x1 = (trimEnd / trimDuration) * w;
    dragging = Math.abs(x - x0) <= Math.abs(x - x1) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId);
    moveHandle(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) moveHandle(e.clientX);
  });
  canvas.addEventListener('pointerup', () => {
    dragging = null;
  });

  audition.addEventListener('click', () => Player.playRegion(trimStart, trimEnd, { loop: true }));
  stop.addEventListener('click', () => Player.stopRegion());
  reset.addEventListener('click', () => {
    trimStart = 0;
    trimEnd = trimDuration;
    draw();
    updateReadout();
  });
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    try {
      const res = await window.api.trimProcess(trimFile.path, trimStart, trimEnd);
      if (res && res.success) toast('Trimmed copy saved', res.output);
      else toast('Trim failed', (res && res.error) || 'Unknown error', true);
    } catch (err) {
      toast('Trim failed', String((err && err.message) || err), true);
    }
    exportBtn.textContent = 'Export trimmed copy';
    updateReadout();
  });

  // Draw after layout so clientWidth is settled.
  requestAnimationFrame(draw);
  updateReadout();
}

/* ----------------------------- silence ---------------------------- */

let silenceFolder = null;
let silenceResults = [];
let silenceChosen = new Set<number>();

function renderStandaloneSilence() {
  viewEl.innerHTML = '';
  renderSilenceTab(null);
}

function renderSilenceTab(entry = null) {
  if (!silenceFolder && entry) silenceFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Strip silence'));
  section.append(
    el(
      'div',
      'callout callout--warn',
      'Trims silence from the beginning, end or both sides of WAV files. Your originals are never touched — trimmed copies are written to the output folder. Analyse first to see exactly what would be cut.'
    )
  );

  /* folder */
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Reading WAVs from'));
  const folderPath = el('div', 'mono', silenceFolder || 'Choose a folder to begin');
  folderPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(folderPath);

  const bar = el('div', 'tabs');
  const pick = el(
    'button',
    `pill${silenceFolder ? ' pill--sm' : ' pill--solid'}`,
    silenceFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      silenceFolder = chosen;
      silenceResults = [];
      silenceChosen = new Set();
      render();
    }
  });
  bar.append(pick);
  if (entry) {
    const useProject = el('button', 'pill pill--sm', "This project's folder");
    useProject.addEventListener('click', () => {
      silenceFolder = entry.folder;
      silenceResults = [];
      silenceChosen = new Set();
      render();
    });
    bar.append(useProject);
  }
  folderBar.append(bar);
  section.append(folderBar);

  /* settings */
  const controls = el('div', 'grid2');

  const whereWrap = el('div', 'fieldrow');
  whereWrap.append(el('label', null, 'Remove silence from'));
  const whereRow = el('div', 'tabs');
  let where = 'Both';
  const startBtn = el('button', 'pill', 'Beginning');
  const endBtn = el('button', 'pill', 'End');
  const bothBtn = el('button', 'pill is-on', 'Both');
  function setWhere(next) {
    where = next;
    startBtn.classList.toggle('is-on', next === 'Start');
    endBtn.classList.toggle('is-on', next === 'End');
    bothBtn.classList.toggle('is-on', next === 'Both');
    invalidateSilencePreview();
  }
  startBtn.addEventListener('click', () => setWhere('Start'));
  endBtn.addEventListener('click', () => setWhere('End'));
  bothBtn.addEventListener('click', () => setWhere('Both'));
  whereRow.append(startBtn, endBtn, bothBtn);
  whereWrap.append(whereRow);
  controls.append(whereWrap);

  const detectWrap = el('div', 'fieldrow');
  detectWrap.append(el('label', null, 'Detection'));
  const detectRow = el('div', 'tabs');
  let detection = 'RMS';
  const rmsBtn = el('button', 'pill is-on', 'RMS');
  rmsBtn.title = 'Averages over a window. Ignores isolated clicks.';
  const peakBtn = el('button', 'pill', 'Peak');
  peakBtn.title = 'A single sample above the floor counts as audio.';
  rmsBtn.addEventListener('click', () => {
    detection = 'RMS';
    rmsBtn.classList.add('is-on');
    peakBtn.classList.remove('is-on');
    invalidateSilencePreview();
  });
  peakBtn.addEventListener('click', () => {
    detection = 'Peak';
    peakBtn.classList.add('is-on');
    rmsBtn.classList.remove('is-on');
    invalidateSilencePreview();
  });
  detectRow.append(rmsBtn, peakBtn);
  detectWrap.append(detectRow);
  controls.append(detectWrap);

  const threshold = fieldInput('Threshold (dB)');
  threshold.input.value = '-72';
  controls.append(threshold.wrap);

  const tail = fieldInput('Leave safety padding (ms)');
  tail.input.value = '10';
  tail.input.title =
    'Cutting at the exact sample where audio drops below the threshold truncates a decaying waveform and clicks. A few ms of padding avoids that.';
  controls.append(tail.wrap);

  section.append(controls);

  const actions = el('div', 'tabs');
  actions.style.marginTop = '6px';
  const analyseBtn = el('button', 'pill pill--solid', 'Analyse folder');
  analyseBtn.disabled = !silenceFolder;
  const processBtn = el('button', 'pill', 'Process selected');
  processBtn.disabled = true;
  actions.append(analyseBtn, processBtn);
  section.append(actions);

  const status = el('p', 'muted');
  silenceProgressStatus = status;
  status.style.marginTop = '12px';
  if (!silenceFolder) status.textContent = 'Choose any folder containing WAV files.';
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  function options() {
    return {
      detection,
      where,
      thresholdDb: Number(threshold.input.value) || -72,
      headMs: Number(tail.input.value) || 10,
      tailMs: Number(tail.input.value) || 10
    };
  }

  function paint() {
    list.innerHTML = '';
    const usable = silenceResults.filter((r) => !r.error && !r.skip);

    if (silenceResults.length === 0) return;

    const total = usable.reduce((sum, r) => sum + r.removable, 0);
    status.textContent =
      `${usable.length} of ${silenceResults.length} file(s) have removable silence — ` +
      `${total.toFixed(1)}s in total`;

    silenceResults.forEach((result, index) => {
      const row = el('div', 'dupe');

      const check = el('input', 'check');
      check.type = 'checkbox';
      check.disabled = Boolean(result.error || result.skip);
      check.checked = silenceChosen.has(index);
      check.addEventListener('change', () => {
        if (check.checked) silenceChosen.add(index);
        else silenceChosen.delete(index);
        processBtn.disabled = silenceChosen.size === 0;
        processBtn.textContent = `Process selected (${silenceChosen.size})`;
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'dupe__name', result.name || basename(result.path)));
      middle.append(
        el(
          'div',
          'dupe__where',
          result.error
            ? `Skipped — ${result.error}`
            : result.skip
              ? result.reason
              : `${result.duration.toFixed(1)}s · ${result.sampleRate / 1000}k ${result.bits}-bit ${result.channels === 1 ? 'mono' : 'stereo'}`
        )
      );
      row.append(middle);

      row.append(
        el(
          'div',
          'dupe__num',
          result.error || result.skip
            ? '—'
            : `Start −${result.leadingRemovable.toFixed(2)}s`
        )
      );
      row.append(
        el(
          'div',
          'dupe__num dupe__num--waste',
          result.error || result.skip
            ? ''
            : `End −${result.trailingRemovable.toFixed(2)}s`
        )
      );

      list.append(row);
    });
  }

  function invalidateSilencePreview() {
    if (!silenceResults.length) return;
    silenceResults = [];
    silenceChosen = new Set();
    processBtn.disabled = true;
    processBtn.textContent = 'Process selected';
    list.innerHTML = '';
    status.textContent = 'Settings changed — analyse again to preview the cut.';
  }

  threshold.input.addEventListener('input', invalidateSilencePreview);
  tail.input.addEventListener('input', invalidateSilencePreview);

  analyseBtn.addEventListener('click', async () => {
    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    list.innerHTML = '';
    silenceChosen = new Set();
    processBtn.disabled = true;

    try {
      const files = await window.api.silenceList(silenceFolder);
      if (files.length === 0) {
        status.textContent = 'No WAV files in this folder.';
        silenceResults = [];
      } else {
        status.textContent = `Reading ${files.length} file(s)…`;
        silenceResults = await window.api.silenceAnalyse(
          files.map((f) => f.path),
          options()
        );
        // Everything with something to trim starts ticked.
        silenceResults.forEach((r, i) => {
          if (!r.error && !r.skip) silenceChosen.add(i);
        });
        processBtn.disabled = silenceChosen.size === 0;
        processBtn.textContent = `Process selected (${silenceChosen.size})`;
        paint();
      }
    } catch (err) {
      status.textContent = err.message;
    }

    analyseBtn.disabled = false;
    analyseBtn.textContent = 'Analyse folder';
  });

  processBtn.addEventListener('click', async () => {
    const paths = [...silenceChosen].map((i) => silenceResults[i].path);
    if (paths.length === 0) return;

    processBtn.disabled = true;
    processBtn.textContent = 'Processing…';

    try {
      const outcome = await window.api.silenceProcess(paths, options());
      if (!outcome.cancelled) {
        const done = outcome.results.filter((r) => r.success && r.modified);
        const failed = outcome.results.filter((r) => !r.success);
        const seconds = done.reduce((sum, r) => sum + (r.secondsRemoved || 0), 0);
        toast(
          'Silence removed',
          `${done.length} file(s), ${seconds.toFixed(1)}s trimmed` +
            (failed.length ? ` · ${failed.length} skipped` : ''),
          failed.length > 0
        );
      }
    } catch (err) {
      toast('Could not process', err.message, true);
    }

    processBtn.disabled = false;
    processBtn.textContent = `Process selected (${silenceChosen.size})`;
  });

  paint();
}

/* -------------------------- vocal timeline -------------------------- */

let vocalTab = 'split';
let vocalFolder = null;
let vocalFiles = [];
let vocalSelected = new Set();
let vocalSplitPreviews = new Map();
let vocalManifestPath = null;
let vocalBlocksFolder = null;
let vocalRebuildPreview = null;

function renderStandaloneVocal() {
  viewEl.innerHTML = '';

  const section = el('div', 'section');
  section.append(headRow('Vocal reconstruction'));
  section.append(
    el(
      'div',
      'callout callout--warn',
      'Splits a long vocal into phrases for external processing, then rebuilds them onto the original timeline. Originals are never touched — everything is written beside the source file.'
    )
  );

  const tabBar = el('div', 'tabs');
  const splitTabBtn = el('button', `pill${vocalTab === 'split' ? ' is-on' : ''}`, 'Split vocal');
  const rebuildTabBtn = el('button', `pill${vocalTab === 'rebuild' ? ' is-on' : ''}`, 'Rebuild timeline');
  splitTabBtn.addEventListener('click', () => {
    vocalTab = 'split';
    render();
  });
  rebuildTabBtn.addEventListener('click', () => {
    vocalTab = 'rebuild';
    render();
  });
  tabBar.append(splitTabBtn, rebuildTabBtn);
  section.append(tabBar);

  viewEl.append(section);

  if (vocalTab === 'split') renderVocalSplitTab(section);
  else renderVocalRebuildTab(section);
}

function renderVocalSplitTab(section) {
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Reading WAVs from'));
  const folderPath = el('div', 'mono', vocalFolder || 'Choose a folder to begin');
  folderPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(folderPath);

  const pickBar = el('div', 'tabs');
  const pick = el(
    'button',
    `pill${vocalFolder ? ' pill--sm' : ' pill--solid'}`,
    vocalFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      vocalFolder = chosen;
      vocalSelected = new Set();
      vocalSplitPreviews = new Map();
      try {
        vocalFiles = await window.api.vocalListWav(chosen);
      } catch (err) {
        vocalFiles = [];
      }
      render();
    }
  });
  pickBar.append(pick);
  folderBar.append(pickBar);
  section.append(folderBar);

  if (vocalFolder) {
    const fileList = el('div', 'vocal-file-list');
    if (vocalFiles.length === 0) {
      fileList.append(el('p', 'muted', 'No WAV files in this folder.'));
    } else {
      const selectionBar = el('div', 'tabs vocal-selection-bar');
      const selectAllBtn = el('button', 'pill pill--sm', 'Select all');
      const clearBtn = el('button', 'pill pill--sm', 'Clear');
      const selectionCount = el(
        'span',
        'muted',
        `${vocalSelected.size} of ${vocalFiles.length} selected`
      );
      selectAllBtn.disabled = vocalSelected.size === vocalFiles.length;
      clearBtn.disabled = vocalSelected.size === 0;
      selectAllBtn.addEventListener('click', () => {
        vocalSelected = new Set(vocalFiles.map((file) => file.path));
        vocalSplitPreviews = new Map();
        render();
      });
      clearBtn.addEventListener('click', () => {
        vocalSelected = new Set();
        vocalSplitPreviews = new Map();
        render();
      });
      selectionBar.append(selectAllBtn, clearBtn, selectionCount);
      fileList.append(selectionBar);

      vocalFiles.forEach((file) => {
        const row = el('label', `vocal-file-row${vocalSelected.has(file.path) ? ' is-on' : ''}`);
        const check = el('input', 'check');
        check.type = 'checkbox';
        check.checked = vocalSelected.has(file.path);
        check.addEventListener('change', () => {
          if (check.checked) vocalSelected.add(file.path);
          else vocalSelected.delete(file.path);
          vocalSplitPreviews = new Map();
          render();
        });
        const fileCopy = el('span', 'vocal-file-row__copy');
        const name = el('span', 'vocal-file-row__name', file.name);
        name.title = file.name;
        fileCopy.append(name, el('span', 'vocal-file-row__meta', formatBytes(file.size)));
        row.append(check, fileCopy);
        fileList.append(row);
      });
    }
    section.append(fileList);
  }

  if (vocalSelected.size === 0) {
    viewEl.append(section);
    return;
  }

  const controls = el('div', 'grid2');

  const detectWrap = el('div', 'fieldrow');
  detectWrap.append(el('label', null, 'Detection'));
  const detectRow = el('div', 'tabs');
  let detection = 'RMS';
  const rmsBtn = el('button', 'pill is-on', 'RMS');
  const peakBtn = el('button', 'pill', 'Peak');
  rmsBtn.addEventListener('click', () => {
    detection = 'RMS';
    rmsBtn.classList.add('is-on');
    peakBtn.classList.remove('is-on');
  });
  peakBtn.addEventListener('click', () => {
    detection = 'Peak';
    peakBtn.classList.add('is-on');
    rmsBtn.classList.remove('is-on');
  });
  detectRow.append(rmsBtn, peakBtn);
  detectWrap.append(detectRow);
  controls.append(detectWrap);

  const threshold = fieldInput('Silence threshold (dB)');
  threshold.input.value = '-72';
  controls.append(threshold.wrap);

  const minSilence = fieldInput('Minimum gap to split on (ms)');
  minSilence.input.value = '400';
  minSilence.input.title = 'Silences shorter than this stay inside a phrase instead of splitting it.';
  controls.append(minSilence.wrap);

  const pad = fieldInput('Keep padding (ms)');
  pad.input.value = '50';
  pad.input.title = 'Extra silence kept on each side of a phrase so it isn’t cut too tight.';
  controls.append(pad.wrap);

  section.append(controls);

  function options() {
    return {
      detection,
      thresholdDb: Number(threshold.input.value) || -72,
      minSilenceMs: Number(minSilence.input.value) || 400,
      padMs: Number(pad.input.value) || 50
    };
  }

  const actions = el('div', 'tabs');
  actions.style.marginTop = '6px';
  const analyseBtn = el('button', 'pill pill--solid', `Analyse selected (${vocalSelected.size})`);
  const splitBtn = el('button', 'pill', 'Split selected');
  splitBtn.disabled = true;
  actions.append(analyseBtn, splitBtn);
  section.append(actions);

  const status = el('p', 'muted');
  status.style.marginTop = '12px';
  const results = el('div');
  section.append(status, results);

  viewEl.append(section);

  analyseBtn.addEventListener('click', async () => {
    const selectedFiles = vocalFiles.filter((file) => vocalSelected.has(file.path));
    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    results.innerHTML = '';
    splitBtn.disabled = true;
    vocalSplitPreviews = new Map();

    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      status.textContent = `Analysing ${index + 1} of ${selectedFiles.length} — ${file.name}`;
      try {
        const preview = await window.api.vocalSplitAnalyse(file.path, options());
        vocalSplitPreviews.set(file.path, preview);

        const row = el('div', 'vocal-analysis-row');
        const copy = el('div');
        copy.append(el('div', 'vocal-file-row__name', file.name));
        const summary = preview.error
          ? preview.error
          : preview.skip
            ? preview.reason
            : `${preview.blockCount} block(s) · ${preview.duration.toFixed(1)}s`;
        copy.append(el('div', 'vocal-file-row__meta', summary));
        row.append(copy);
        results.append(row);
      } catch (err) {
        vocalSplitPreviews.set(file.path, { path: file.path, error: err.message });
        const row = el('div', 'vocal-analysis-row');
        row.append(el('div', 'vocal-file-row__name', file.name));
        row.append(el('div', 'vocal-analysis-row__error', err.message));
        results.append(row);
      }
    }

    const ready = selectedFiles.filter((file) => {
      const preview = vocalSplitPreviews.get(file.path);
      return preview && !preview.error && !preview.skip && preview.blockCount > 0;
    });
    status.textContent = `${ready.length} of ${selectedFiles.length} selected file(s) ready to split`;
    splitBtn.disabled = ready.length === 0;
    splitBtn.textContent = `Split selected (${ready.length})`;

    analyseBtn.disabled = false;
    analyseBtn.textContent = `Analyse selected (${vocalSelected.size})`;
  });

  splitBtn.addEventListener('click', async () => {
    const paths = vocalFiles
      .filter((file) => vocalSelected.has(file.path))
      .filter((file) => {
        const preview = vocalSplitPreviews.get(file.path);
        return preview && !preview.error && !preview.skip && preview.blockCount > 0;
      })
      .map((file) => file.path);
    if (paths.length === 0) return;

    splitBtn.disabled = true;
    splitBtn.textContent = 'Splitting…';

    try {
      const outcome = await window.api.vocalSplitBatch(paths, options());
      if (!outcome.cancelled) {
        const done = outcome.results.filter((result) => result.success && result.modified);
        const skipped = outcome.results.filter((result) => !result.success || !result.modified);
        const blocks = done.reduce((sum, result) => sum + (result.blockCount || 0), 0);
        toast(
          'Vocals split',
          `${done.length} file(s) · ${blocks} block(s) written` +
            (skipped.length ? ` · ${skipped.length} skipped` : ''),
          skipped.length > 0
        );
      }
    } catch (err) {
      toast('Could not split', err.message, true);
    }

    splitBtn.disabled = false;
    splitBtn.textContent = `Split selected (${paths.length})`;
  });
}

function renderVocalRebuildTab(section) {
  const manifestBar = el('div', 'callout');
  manifestBar.append(el('div', 'page__kicker', 'Manifest'));
  const manifestPathEl = el('div', 'mono', vocalManifestPath || 'Choose the manifest.json from a split job');
  manifestPathEl.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  manifestBar.append(manifestPathEl);

  const manifestActions = el('div', 'tabs');
  const pickManifest = el('button', 'pill pill--solid', vocalManifestPath ? 'Change manifest' : 'Choose manifest');
  pickManifest.addEventListener('click', async () => {
    const chosen = await window.api.vocalPickManifest();
    if (chosen) {
      vocalManifestPath = chosen;
      vocalRebuildPreview = null;
      render();
    }
  });
  manifestActions.append(pickManifest);
  manifestBar.append(manifestActions);
  section.append(manifestBar);

  const blocksBar = el('div', 'callout');
  blocksBar.append(el('div', 'page__kicker', 'Processed blocks folder'));
  const blocksPath = el('div', 'mono', vocalBlocksFolder || 'Choose the folder holding the processed blocks');
  blocksPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  blocksBar.append(blocksPath);

  const blocksActions = el('div', 'tabs');
  const pickBlocks = el('button', 'pill pill--solid', vocalBlocksFolder ? 'Change folder' : 'Choose folder');
  pickBlocks.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      vocalBlocksFolder = chosen;
      vocalRebuildPreview = null;
      render();
    }
  });
  blocksActions.append(pickBlocks);
  blocksBar.append(blocksActions);
  section.append(blocksBar);

  const actions = el('div', 'tabs');
  actions.style.marginTop = '6px';
  const analyseBtn = el('button', 'pill pill--solid', 'Analyse');
  analyseBtn.disabled = !vocalManifestPath || !vocalBlocksFolder;
  const rebuildBtn = el('button', 'pill', 'Rebuild timeline');
  rebuildBtn.disabled = !vocalRebuildPreview;
  actions.append(analyseBtn, rebuildBtn);
  section.append(actions);

  const status = el('p', 'muted');
  status.style.marginTop = '12px';
  const results = el('div');
  section.append(status, results);

  viewEl.append(section);

  function paintPreview() {
    results.innerHTML = '';
    if (!vocalRebuildPreview) return;

    status.textContent =
      `${vocalRebuildPreview.readyCount} of ${vocalRebuildPreview.blockCount} block(s) ready` +
      (vocalRebuildPreview.flaggedCount ? ` — ${vocalRebuildPreview.flaggedCount} flagged` : '') +
      (vocalRebuildPreview.unexpected.length ? ` — ${vocalRebuildPreview.unexpected.length} unrecognised file(s)` : '');

    vocalRebuildPreview.blocks.forEach((block) => {
      const row = el('div', 'dupe');
      row.append(el('div', 'dupe__name', block.id));
      row.append(el('div', 'dupe__where', block.status + (block.detail ? ` — ${block.detail}` : '')));
      results.append(row);
    });
  }

  analyseBtn.addEventListener('click', async () => {
    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    rebuildBtn.disabled = true;
    results.innerHTML = '';

    try {
      vocalRebuildPreview = await window.api.vocalRebuildAnalyse(vocalManifestPath, vocalBlocksFolder);
      rebuildBtn.disabled = vocalRebuildPreview.readyCount === 0;
      paintPreview();
    } catch (err) {
      status.textContent = err.message;
    }

    analyseBtn.disabled = false;
    analyseBtn.textContent = 'Analyse';
  });

  rebuildBtn.addEventListener('click', async () => {
    rebuildBtn.disabled = true;
    rebuildBtn.textContent = 'Rebuilding…';

    try {
      const outcome = await window.api.vocalRebuild(vocalManifestPath, vocalBlocksFolder, {});
      if (!outcome.cancelled) {
        toast(
          'Timeline rebuilt',
          `${outcome.accepted.length} block(s) placed at ${basename(outcome.output)}` +
            (outcome.flagged.length ? ` — ${outcome.flagged.length} flagged, see report` : ''),
          outcome.flagged.some((f) => !f.informational)
        );
      }
    } catch (err) {
      toast('Could not rebuild', err.message, true);
    }

    rebuildBtn.disabled = false;
    rebuildBtn.textContent = 'Rebuild timeline';
  });

  paintPreview();
}

/* ------------------------------- QC ------------------------------- */

let qcFolder = null;

function renderQcTab(entry) {
  if (!qcFolder) qcFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Check audio'));
  section.append(
    el(
      'div',
      'callout',
      'Reads every WAV in the folder and flags two things: files too quiet to sit in a mix, and loops whose length is not a whole number of beats — those drift or click when looped. Nothing is written.'
    )
  );

  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Checking'));
  const fp = el('div', 'mono', qcFolder);
  fp.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(fp);
  const bar = el('div', 'tabs');
  const pick = el('button', 'pill pill--sm', 'Choose folder');
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      qcFolder = chosen;
      render();
    }
  });
  const useProject = el('button', 'pill pill--sm', "This project's folder");
  useProject.addEventListener('click', () => {
    qcFolder = entry.folder;
    render();
  });
  bar.append(pick, useProject);
  folderBar.append(bar);
  section.append(folderBar);

  const controls = el('div', 'grid2');
  const quiet = fieldInput('Flag peaks below (dB)');
  quiet.input.value = '-12';
  const tol = fieldInput('Grid tolerance (% of a beat)');
  tol.input.value = '2';
  controls.append(quiet.wrap, tol.wrap);
  section.append(controls);

  const scanBtn = el('button', 'pill pill--solid', 'Check folder');
  const actions = el('div', 'tabs');
  actions.append(scanBtn);
  section.append(actions);

  const status = el('p', 'muted');
  qcProgressStatus = status;
  status.style.marginTop = '12px';
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Checking…';
    list.innerHTML = '';

    try {
      const result = await window.api.qcScan(qcFolder, {
        quietPeakDb: Number(quiet.input.value) || -12,
        gridTolerance: (Number(tol.input.value) || 2) / 100
      });

      status.textContent =
        `${result.scanned} file(s) checked · ${result.withIssues} with issues` +
        (result.unreadable ? ` · ${result.unreadable} unreadable` : '');

      const flagged = result.results.filter((r) => r.error || (r.issues && r.issues.length));
      if (flagged.length === 0) {
        list.append(el('p', 'muted', 'Nothing flagged — every file looks fine.'));
      }

      flagged.forEach((file) => {
        const row = el('div', 'filerow');

        const play = el('button', 'filerow__play', '▶');
        play.addEventListener('click', (event) => {
          event.stopPropagation();
          Player.load({ path: file.path, name: file.name, ext: '.wav' });
        });
        row.append(play);

        const middle = el('div');
        middle.append(el('div', 'filerow__name', file.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            file.error
              ? file.error
              : (file.issues || []).map((i) => i.detail).join('  ·  ')
          )
        );
        row.append(middle);

        const kinds = (file.issues || []).map((i) => i.kind);
        row.append(
          kinds.length
            ? el('span', 'badge badge--packaged', kinds.join(' + '))
            : el('span', 'badge', 'unreadable')
        );
        const actions = el('div', 'filerow__actions');
        if (file.duration) actions.append(el('span', 'cell', `${file.duration.toFixed(2)}s`));
        if (!file.error) {
          actions.append(
            analyseAudioButton(entry, { path: file.path, name: file.name, ext: '.wav' })
          );
        }
        row.append(actions);

        row.dataset.path = file.path;
        if (!file.error) {
          row.addEventListener('click', () =>
            Player.load({ path: file.path, name: file.name, ext: '.wav' })
          );
        }
        list.append(row);
      });
    } catch (err) {
      status.textContent = err.message;
    }

    scanBtn.disabled = false;
    scanBtn.textContent = 'Check folder';
  });

}

/* --------------------------- all audio ---------------------------- */

function renderAllAudioList(list: HTMLElement, entry: any, files: any[]) {
  list.innerHTML = '';
  if (files.length === 0) {
    list.append(el('p', 'muted', 'No audio anywhere below this folder.'));
    return;
  }

  const byFolder = new Map();
  files.forEach((file) => {
    if (!byFolder.has(file.where)) byFolder.set(file.where, []);
    byFolder.get(file.where).push(file);
  });

  const total = files.reduce((sum, f) => sum + f.size, 0);
  list.append(
    el(
      'p',
      'muted',
      `${files.length} file(s) across ${byFolder.size} folder(s) · ${formatBytes(total)}`
    )
  );

  for (const [folder, group] of byFolder) {
    const heading = el('div', 'page__kicker', folder);
    heading.style.margin = '16px 0 6px';
    list.append(heading);

    group.slice(0, 200).forEach((file: any) => {
      const row = el('div', 'filerow');

      const item: SelectedItem = {
        id: file.path,
        name: file.name,
        path: file.path,
        size: file.size,
        type: 'audio'
      };

      row.append(createSelectHandle(item));

      const play = el('button', 'filerow__play', '▶');
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        Player.load(file);
      });
      row.append(play);

      const middle = el('div');
      const nameRow = el('div', 'filerow__name-row');
      nameRow.append(el('span', 'filerow__name', file.name));

      const extClean = (file.ext || '').replace('.', '').toUpperCase();
      if (extClean) {
        const pill = el('button', `format-pill format-pill--${extClean.toLowerCase()}`, extClean);
        pill.title = `Hold & Drag ${extClean} directly · Click to audition (${formatBytes(file.size)})`;
        pill.draggable = true;
        pill.addEventListener('dragstart', async (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.api && window.api.dragFiles) {
            await window.api.dragFiles([file.path]);
          }
        });
        pill.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          Player.load(file);
        });
        const pillsWrap = el('span', 'format-pills');
        pillsWrap.append(pill);
        nameRow.append(pillsWrap);
      }
      middle.append(nameRow);

      middle.append(
        el(
          'div',
          'filerow__meta',
          `${formatBytes(file.size)}  ·  ${timeAgo(file.modified)}`
        )
      );
      row.append(middle);

      const dragHint = el('span', 'filerow__drag-hint', '⤓ Drag');
      dragHint.title = 'Drag audio file into DAW or Explorer';
      row.append(dragHint);

      const actions = el('div', 'filerow__actions');
      actions.append(analyseAudioButton(entry, file));
      const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
      reveal.addEventListener('click', (event) => {
        event.stopPropagation();
        window.api.reveal(file.path);
      });
      actions.append(reveal);
      row.append(actions);

      row.dataset.path = file.path;
      row.addEventListener('dblclick', () => Player.load(file));
      attachDraggableAndSelectable(row, item);
      list.append(row);
    });
  }
}

function renderAllAudioTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('All audio'));
  section.append(
    el(
      'div',
      'callout',
      'Every audio file anywhere below this project folder, flattened into one list. Samples, Backup and Freeze are skipped — those hold source material, not renders.'
    )
  );

  const list = el('div');
  section.append(list);
  viewEl.append(section);

  const cached = projectAllAudioCache.get(entry.folder);
  if (cached) {
    renderAllAudioList(list, entry, cached);
  } else {
    list.append(el('p', 'muted', 'Looking…'));
  }

  window.api
    .deepAudio(entry.folder)
    .then((files) => {
      projectAllAudioCache.set(entry.folder, files);
      if (list.isConnected) {
        const cachedPaths = cached?.map((f: any) => f.path).join('|');
        const newPaths = files?.map((f: any) => f.path).join('|');
        if (!cached || cachedPaths !== newPaths) {
          renderAllAudioList(list, entry, files);
        }
      }
    })
    .catch((err) => {
      if (!cached && list.isConnected) {
        list.innerHTML = '';
        list.append(el('p', 'muted', err.message));
      }
    });
}

/* ============================= ID3 editor ========================== */

function renderId3Editor() {
  viewEl.innerHTML = '';
  const section = el('div', 'section');
  section.append(headRow('ID3 editor', id3Folder ? basename(id3Folder) : null));
  section.append(
    el(
      'div',
      'callout',
      'Choose a sample-pack folder. DAW Buddy finds MP3s in its subfolders and lets you replace their metadata with clean information or remove it completely. WAV, FLAC and AIFF files are left alone because ID3 is an MP3 tagging system.'
    )
  );

  const folderActions = el('div', 'tabs');
  const chooseBtn = el('button', 'pill pill--solid', id3Folder ? 'Change folder' : 'Choose folder');
  const revealBtn = el('button', 'pill', `Open folder in ${settings.fileManager}`);
  revealBtn.hidden = !id3Folder;
  revealBtn.addEventListener('click', () => window.api.reveal(id3Folder));
  folderActions.append(chooseBtn, revealBtn);
  section.append(folderActions);

  const editor = el('div', 'callout');
  editor.append(el('div', 'page__kicker', 'Clean metadata to write'));
  editor.append(
    el(
      'p',
      'muted',
      'These fields replace the existing tag, including unwanted author information and artwork. Blank fields are removed — except Title, which defaults to each file’s own name. Type a Title to set the same one on every file (include {filename} to keep the name too).'
    )
  );

  const fieldsGrid = el('div', 'grid2');
  const title = fieldInput('Title');
  title.input.placeholder = 'Each file keeps its own name';
  const artist = fieldInput('Artist');
  const album = fieldInput('Album');
  const albumArtist = fieldInput('Album artist');
  const composer = fieldInput('Composer / author');
  const publisher = fieldInput('Publisher');
  const copyright = fieldInput('Copyright');
  const genre = fieldInput('Genre');
  const year = fieldInput('Year');
  const comment = fieldInput('Comment');
  [title, artist, album, albumArtist, composer, publisher, copyright, genre, year, comment].forEach((field) =>
    fieldsGrid.append(field.wrap)
  );
  editor.append(fieldsGrid);
  section.append(editor);

  const selectionActions = el('div', 'tabs');
  const allBtn = el('button', 'pill pill--sm', 'Select all');
  const taggedBtn = el('button', 'pill pill--sm', 'Select tagged');
  const noneBtn = el('button', 'pill pill--sm', 'Select none');
  const writeBtn = el('button', 'pill pill--solid', 'Write clean metadata');
  const removeBtn = el('button', 'pill pill--danger', 'Remove all metadata');
  writeBtn.disabled = true;
  removeBtn.disabled = true;
  selectionActions.append(allBtn, taggedBtn, noneBtn, writeBtn, removeBtn);
  section.append(selectionActions);

  const status = el('p', 'muted', id3Folder ? 'Checking MP3s…' : 'Choose a folder to begin.');
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  function selectedFiles() {
    return id3Files.filter((file) => id3Selected.has(file.path) && !file.error);
  }

  function updateButtons() {
    const count = selectedFiles().length;
    writeBtn.disabled = count === 0;
    removeBtn.disabled = count === 0;
    writeBtn.textContent = count ? `Write metadata (${count})` : 'Write clean metadata';
    removeBtn.textContent = count ? `Remove metadata (${count})` : 'Remove all metadata';
  }

  function paintFiles() {
    list.innerHTML = '';
    if (!id3Files.length) {
      if (id3Folder) list.append(el('p', 'muted', 'No MP3 files found in this folder or its subfolders.'));
      updateButtons();
      return;
    }

    const tagged = id3Files.filter((file) => file.bytesRemovable > 0).length;
    const unreadable = id3Files.filter((file) => file.error).length;
    status.textContent =
      `${id3Files.length} MP3(s) · ${tagged} carrying metadata · ${id3Selected.size} selected` +
      (unreadable ? ` · ${unreadable} unreadable` : '');

    id3Files.slice(0, 500).forEach((file) => {
      const row = el('div', 'filerow');
      const check = el('input', 'check');
      check.type = 'checkbox';
      check.disabled = Boolean(file.error);
      check.checked = id3Selected.has(file.path);
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) id3Selected.add(file.path);
        else id3Selected.delete(file.path);
        paintFiles();
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'filerow__name', file.name));
      middle.append(
        el(
          'div',
          'filerow__meta',
          file.error ? file.error : id3FieldSummary(file.fields, file.bytesRemovable)
        )
      );
      row.append(middle);
      row.append(
        file.bytesRemovable > 0
          ? el('span', 'badge badge--packaged', 'tagged')
          : el('span', 'badge', 'clean')
      );

      const actions = el('div', 'filerow__actions');
      actions.append(el('span', 'cell', formatBytes(file.size)));
      const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
      reveal.addEventListener('click', (event) => {
        event.stopPropagation();
        window.api.reveal(file.path);
      });
      actions.append(reveal);
      row.append(actions);
      row.addEventListener('click', () => {
        if (file.error) return;
        if (id3Selected.has(file.path)) id3Selected.delete(file.path);
        else id3Selected.add(file.path);
        paintFiles();
      });
      list.append(row);
    });
    if (id3Files.length > 500) {
      list.append(
        el(
          'p',
          'muted',
          `Showing the first 500 files to keep the window fast. Selection buttons still apply to all ${id3Files.length}.`
        )
      );
    }
    updateButtons();
  }

  async function scan() {
    if (!id3Folder) return;
    status.textContent = 'Reading MP3 metadata…';
    list.innerHTML = '';
    try {
      id3Files = await window.api.id3Inspect(id3Folder);
      id3Selected = new Set(
        id3Files.filter((file) => !file.error && file.bytesRemovable > 0).map((file) => file.path)
      );
      paintFiles();
    } catch (error) {
      status.textContent = error.message;
      id3Files = [];
      id3Selected = new Set();
      updateButtons();
    }
  }

  chooseBtn.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (!chosen) return;
    id3Folder = chosen;
    id3Files = [];
    id3Selected = new Set();
    render();
  });

  allBtn.addEventListener('click', () => {
    id3Selected = new Set(id3Files.filter((file) => !file.error).map((file) => file.path));
    paintFiles();
  });
  taggedBtn.addEventListener('click', () => {
    id3Selected = new Set(
      id3Files.filter((file) => !file.error && file.bytesRemovable > 0).map((file) => file.path)
    );
    paintFiles();
  });
  noneBtn.addEventListener('click', () => {
    id3Selected = new Set();
    paintFiles();
  });

  writeBtn.addEventListener('click', async () => {
    const chosen = selectedFiles();
    if (!chosen.length) return;
    if (!window.confirm(`Replace the metadata in ${chosen.length} selected MP3 file(s)?\n\nThe audio itself will not change.`)) return;

    writeBtn.disabled = true;
    removeBtn.disabled = true;
    writeBtn.textContent = 'Writing…';
    const jobs = chosen.map((file) => {
      const filename = file.name.replace(/\.mp3$/i, '');
      return {
        path: file.path,
        fields: {
          title: title.input.value.trim()
            ? title.input.value.replace(/{filename}/g, filename)
            : filename,
          artist: artist.input.value,
          album: album.input.value,
          albumArtist: albumArtist.input.value,
          composer: composer.input.value,
          publisher: publisher.input.value,
          copyright: copyright.input.value,
          genre: genre.input.value,
          year: year.input.value,
          comment: comment.input.value
        }
      };
    });
    const results = await window.api.id3Write(jobs);
    const changed = results.filter((result) => result.changed).length;
    const failed = results.filter((result) => result.error).length;
    toast('Metadata written', `${changed} file(s)` + (failed ? ` · ${failed} failed` : ''), failed > 0);
    await scan();
  });

  removeBtn.addEventListener('click', async () => {
    const chosen = selectedFiles();
    if (!chosen.length) return;
    if (!window.confirm(`Remove all metadata from ${chosen.length} selected MP3 file(s)?\n\nThe audio itself will not change.`)) return;

    writeBtn.disabled = true;
    removeBtn.disabled = true;
    removeBtn.textContent = 'Removing…';
    const results = await window.api.id3Strip(chosen.map((file) => file.path));
    const changed = results.filter((result) => result.changed).length;
    const failed = results.filter((result) => result.error).length;
    toast('Metadata removed', `${changed} file(s)` + (failed ? ` · ${failed} failed` : ''), failed > 0);
    await scan();
  });

  if (id3Folder) scan();
}

function id3FieldSummary(fields, bytes) {
  const labels = [
    fields && fields.title ? `Title: ${fields.title}` : null,
    fields && fields.artist ? `Artist: ${fields.artist}` : null,
    fields && fields.album ? `Album: ${fields.album}` : null,
    fields && fields.composer ? `Author: ${fields.composer}` : null,
    fields && fields.genre ? `Genre: ${fields.genre}` : null,
    fields && fields.year ? `Year: ${fields.year}` : null
  ].filter(Boolean);
  if (labels.length) return labels.join('  ·  ');
  return bytes > 0 ? 'Metadata present (no common text fields)' : 'No metadata';
}

/* ========================== disk insights ========================= */

/* ============================= this week ========================== */

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// The oldest calendar day that still counts as "this week": today plus the six
// days before it. Anchored to the start of the day so the filter boundary lines
// up with the day buckets in dayLabel — no stray same-weekday overlap.
function weekCutoff() {
  return startOfDay(Date.now()) - 6 * 86400000;
}

function dayLabel(ms) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
}

function renderThisWeek() {
  viewEl.innerHTML = '';
  const section = el('div', 'section');

  const cutoff = weekCutoff();
  const recent = entries
    .filter((entry) => entry.modified >= cutoff)
    .sort((a, b) => b.modified - a.modified);

  const folders = new Set(recent.map((entry) => entry.folder).filter(Boolean));
  const daws = new Set(recent.map((entry) => entry.daw).filter(Boolean));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const subtitle = recent.length
    ? [plural(recent.length, 'project') + ' touched', plural(folders.size, 'folder')]
        .concat(daws.size ? [plural(daws.size, 'DAW')] : [])
        .join('  ·  ')
    : 'Nothing in the last seven days';
  section.append(headRow('This week', subtitle));

  if (!recent.length) {
    section.append(
      el(
        'div',
        'callout',
        'No projects have been modified in the last seven days. As soon as you save a session, it turns up here.'
      )
    );
    viewEl.append(section);
    return;
  }

  // Column labels matching the main list grid, so rows read the same way.
  const head = el('div', 'thead');
  ['Name', 'BPM', 'Key', 'Audio', 'Saves', 'Modified'].forEach((label) =>
    head.append(el('span', 'th', label))
  );
  section.append(head);

  let currentLabel = null;
  recent.forEach((entry) => {
    const label = dayLabel(entry.modified);
    if (label !== currentLabel) {
      currentLabel = label;
      section.append(el('div', 'dayhead', label));
    }
    section.append(buildRow(entry));
  });

  viewEl.append(section);
}

function renderDiskInsights() {
  viewEl.innerHTML = '';

  const section = el('div', 'section');
  section.append(headRow('Disk insights'));
  section.append(
    el(
      'div',
      'callout',
      'A read-only size check of the folders that contain your DAW project files. Nothing is changed or deleted. Junctions and cloud links are skipped, and the scan stops safely at 250,000 files.'
    )
  );

  const actions = el('div', 'tabs');
  const scanBtn = el('button', 'pill pill--solid', diskState ? 'Scan again' : 'Scan disk usage');
  const cancelBtn = el('button', 'pill', 'Cancel scan');
  cancelBtn.hidden = !diskScanning;
  scanBtn.disabled = diskScanning;
  actions.append(scanBtn, cancelBtn);
  section.append(actions);

  const status = el('p', 'muted');
  status.style.marginTop = '12px';
  diskProgressStatus = status;
  section.append(status);

  const results = el('div');
  section.append(results);
  viewEl.append(section);

  function paint() {
    results.innerHTML = '';
    if (!diskState) {
      status.textContent = diskScanning
        ? 'Preparing folder scan…'
        : 'Run the scan to find your largest project and Imported-sample folders.';
      return;
    }

    const measured = diskState.projects.reduce((sum, item) => sum + item.bytes, 0);
    const flags = [
      diskState.cancelled ? 'cancelled early' : null,
      diskState.truncated ? 'stopped at the 250,000-file safety limit' : null,
      diskState.errors ? `${diskState.errors} unreadable folder/file(s)` : null
    ].filter(Boolean);
    status.textContent =
      `${diskState.foldersScanned} of ${diskState.totalFolders} folder(s) measured · ` +
      `${diskState.filesScanned} files · ${formatBytes(measured)}` +
      (flags.length ? ` · ${flags.join(' · ')}` : '');

    results.append(diskInsightList('Largest project folders', diskState.projects));
    if (diskState.imported.length) {
      results.append(diskInsightList('Largest Samples / Imported folders', diskState.imported));
    }
  }

  scanBtn.addEventListener('click', async () => {
    const folders = [...new Set(entries.map((entry) => entry.folder).filter(Boolean))];
    if (!folders.length) {
      toast('Nothing to scan', 'No project folders are currently indexed.', true);
      return;
    }

    diskScanning = true;
    diskState = null;
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    cancelBtn.hidden = false;
    paint();

    try {
      diskState = await window.api.diskScan(folders);
    } catch (error) {
      toast('Disk scan failed', error.message || String(error), true);
    } finally {
      diskScanning = false;
      renderDiskInsights();
    }
  });

  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling…';
    status.textContent = 'Stopping after the current folder read…';
    await window.api.diskCancel();
  });

  paint();
}

function diskInsightList(title, items) {
  const block = el('div');
  const heading = el('h3', null, title);
  heading.style.margin = '28px 0 10px';
  block.append(heading);

  if (!items.length) {
    block.append(el('p', 'muted', 'No folders measured.'));
    return block;
  }

  items.slice(0, 100).forEach((item) => {
    const row = el('div', 'filerow');
    row.append(el('span'));

    const middle = el('div', 'filerow__main');
    middle.append(el('div', 'filerow__name', item.name || basename(item.folder)));
    middle.append(
      el('div', 'filerow__meta', `${item.folder}  ·  ${item.files} file(s)`)
    );
    row.append(middle);
    row.append(el('div', 'dupe__num dupe__num--waste', formatBytes(item.bytes)));

    const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
    reveal.addEventListener('click', () => window.api.reveal(item.folder));
    row.append(reveal);
    block.append(row);
  });

  return block;
}

/* ============================== dedupe ============================= */

function renderDedupe() {
  viewEl.innerHTML = '';

  const head = el('div', 'section');
  head.append(headRow('Sample cleanup'));
  head.append(
    el(
      'div',
      'callout callout--warn',
      'Only Samples/Imported is examined — the pack material Collect All copied in. Processed, Recorded, stems and bounces are never touched, because those exist nowhere else. Duplicates are replaced with links, not deleted: every path keeps working and every session still opens.'
    )
  );

  const actions = el('div', 'tabs');
  const scanBtn = el('button', 'pill pill--solid', 'Scan for duplicates');
  const selectAllBtn = el('button', 'pill', 'Select all');
  const clearBtn = el('button', 'pill', 'Clear selection');
  const linkBtn = el('button', 'pill', 'Link selected');
  selectAllBtn.disabled = true;
  clearBtn.disabled = true;
  linkBtn.disabled = true;
  actions.append(scanBtn, selectAllBtn, clearBtn, linkBtn);
  head.append(actions);

  const status = el('p', 'muted');
  dedupeProgressStatus = status;
  status.style.marginTop = '12px';
  head.append(status);

  const list = el('div');
  head.append(list);
  viewEl.append(head);

  function updateSelectionControls() {
    const count = dedupeState.chosen.size;
    const total = dedupeState.groups.length;
    selectAllBtn.disabled = total === 0 || count === total;
    selectAllBtn.textContent = total ? `Select all (${total})` : 'Select all';
    clearBtn.disabled = count === 0;
    linkBtn.disabled = count === 0;
    linkBtn.textContent = count ? `Link selected (${count})` : 'Link selected';
  }

  function paint() {
    list.innerHTML = '';
    const { groups } = dedupeState;
    if (groups.length === 0) return;

    const total = groups.reduce((sum, g) => sum + g.wasted, 0);
    status.textContent = `${groups.length} duplicate group(s) across ${dedupeState.folders} Imported folder(s) — ${formatBytes(total)} reclaimable`;

    const header = el('div', 'dupe');
    header.append(el('span'));
    header.append(el('span', 'th', 'Sample'));
    header.append(el('span', 'th', 'Copies'));
    header.append(el('span', 'th', 'Wasted'));
    list.append(header);

    groups.slice(0, 400).forEach((group, index) => {
      const row = el('div', 'dupe');

      const check = el('input', 'check');
      check.type = 'checkbox';
      check.checked = dedupeState.chosen.has(index);
      check.addEventListener('change', () => {
        if (check.checked) dedupeState.chosen.add(index);
        else dedupeState.chosen.delete(index);
        updateSelectionControls();
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'dupe__name', group.files[0].name));
      middle.append(
        el(
          'div',
          'dupe__where',
          group.files.map((f) => f.project).join(', ') +
            (group.crossVolume ? '  ·  spans drives, only same-drive copies link' : '')
        )
      );
      row.append(middle);

      row.append(el('div', 'dupe__num', `${group.count} × ${formatBytes(group.size)}`));
      row.append(el('div', 'dupe__num dupe__num--waste', formatBytes(group.wasted)));

      list.append(row);
    });
  }

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    status.textContent = 'Looking for Imported folders…';
    list.innerHTML = '';

    const result = await window.api.dedupeScan();
    dedupeState = { ...result, chosen: new Set<number>() };

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan again';
    updateSelectionControls();

    if (result.groups.length === 0) {
      status.textContent = `Nothing duplicated. ${result.scanned} sample(s) checked across ${result.folders} Imported folder(s).`;
      return;
    }
    paint();
  });

  selectAllBtn.addEventListener('click', () => {
    dedupeState.chosen = new Set(dedupeState.groups.map((group, index) => index));
    updateSelectionControls();
    paint();
  });

  clearBtn.addEventListener('click', () => {
    dedupeState.chosen = new Set();
    updateSelectionControls();
    paint();
  });

  linkBtn.addEventListener('click', async () => {
    const chosen = [...dedupeState.chosen].map((i) => dedupeState.groups[i]);
    if (chosen.length === 0) return;

    const result = await window.api.dedupeLink(chosen);
    if (result.cancelled) return;

    toast(
      'Linked',
      `${result.linked} copies replaced with links · ${formatBytes(result.reclaimed)} reclaimed`
    );
    dedupeState.chosen = new Set();
    updateSelectionControls();
    paint();
  });

  updateSelectionControls();
  paint();
}

/* ============================== records ============================ */

function record(key) {
  return (
    records[key] || {
      note: '',
      stemsPath: null,
      key: null,
      camelot: null,
      keyConfidence: 0,
      favourite: false
    }
  );
}

/** Prefer the tempo written in the DAW project; use audio analysis as fallback. */
function bpmFor(entry) {
  if (entry && entry.bpm !== null && entry.bpm !== undefined) return entry.bpm;
  const detected = entry ? Number(record(entry.path).detectedBpm) : NaN;
  return Number.isFinite(detected) && detected > 0 ? detected : null;
}

/** Prefer manual/saved time signature, then project metadata, then detected meter. */
function timeSignatureFor(entry) {
  if (!entry) return null;
  const rec = record(entry.path);
  if (rec && rec.timeSignature) return rec.timeSignature;
  if (entry && entry.timeSignature) return entry.timeSignature;
  if (rec && rec.detectedTimeSignature) return rec.detectedTimeSignature;
  return null;
}

function openTimeSignaturePicker(entry: any, rec: any) {
  document.querySelectorAll('.sig-picker-overlay').forEach((node) => node.remove());

  const overlay = el('div', 'modal-overlay sig-picker-overlay');
  const dialog = el('div', 'color-picker-modal');
  dialog.style.maxWidth = '680px';

  const header = el('div', 'color-picker-modal__header');
  const titleGroup = el('div', 'color-picker-modal__titles');
  titleGroup.append(el('h3', 'color-picker-modal__title', 'Select Time Signature & Indian Tala'));
  titleGroup.append(
    el(
      'p',
      'color-picker-modal__subtitle',
      'Assign musical meter and Indian Tala rhythm cycle for this project'
    )
  );
  header.append(titleGroup);

  const closeBtn = el('button', 'round color-picker-modal__close', '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(closeBtn);
  dialog.append(header);

  const body = el('div', 'color-picker-modal__body');
  const currentSig = timeSignatureFor(entry);

  const grid = el('div', 'sig-picker-grid');

  Object.entries(DSP.TALA_MAP).forEach(([sig, tala]: [string, any]) => {
    const card = el('div', `sig-picker-card${currentSig === sig ? ' is-active' : ''}`);
    const cardHead = el('div', 'sig-picker-card__head');
    cardHead.append(el('span', 'sig-picker-card__sig', sig));
    cardHead.append(el('span', 'sig-picker-card__name', tala.name.split('/')[0].trim()));
    card.append(cardHead);

    card.append(el('div', 'sig-picker-card__vibhag', `Matras: ${tala.matras} (${tala.vibhag})`));
    card.append(el('div', 'sig-picker-card__desc', tala.description));

    card.addEventListener('click', async () => {
      await saveRecord(entry.path, {
        timeSignature: sig,
        tala: tala.name
      });
      overlay.remove();
      render();
    });
    grid.append(card);
  });

  body.append(grid);

  const footer = el('div', 'color-picker-modal__footer');
  const resetBtn = el('button', 'pill pill--sm', 'Reset to project default');
  resetBtn.addEventListener('click', async () => {
    await saveRecord(entry.path, { timeSignature: null, tala: null });
    overlay.remove();
    render();
  });
  footer.append(resetBtn);
  body.append(footer);

  dialog.append(body);
  overlay.append(dialog);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  document.body.append(overlay);
}

function openGenrePicker(entry: any, rec: any) {
  document.querySelectorAll('.genre-picker-overlay').forEach((node) => node.remove());

  const overlay = el('div', 'modal-overlay genre-picker-overlay');
  const dialog = el('div', 'genre-picker-modal');

  const header = el('div', 'genre-picker-modal__header');
  const titleGroup = el('div');
  titleGroup.append(el('h3', 'genre-picker-modal__title', 'Assign Project Genre'));
  titleGroup.append(
    el(
      'p',
      'genre-picker-modal__subtitle',
      'Categorise your track by genre for fast searching & filtering (e.g. Afro House, Riddim, Colour Bass, Liquid DnB)'
    )
  );
  header.append(titleGroup);

  const closeBtn = el('button', 'round color-picker-modal__close', '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(closeBtn);
  dialog.append(header);

  // Search input
  const searchBar = el('div', 'genre-picker-search-bar');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'genre-search-input';
  searchInput.placeholder = 'Search genres (e.g. Afro, Dubstep, Riddim, Colour Bass, House, DnB)...';
  searchBar.append(searchInput);
  dialog.append(searchBar);

  // Category tabs
  const categories = [
    'All',
    'Botanica & Organic',
    'Bollywood & Indian',
    'Afro & Latin',
    'House',
    'Dubstep & Bass',
    'Drum & Bass',
    'Hip Hop & Urban',
    'Techno & Trance',
    'Electronic & Experimental'
  ];
  let activeCategory = 'All';
  let searchQuery = '';

  const catTabs = el('div', 'genre-cat-tabs');
  categories.forEach((cat) => {
    const tab = el('button', `genre-cat-tab ${cat === activeCategory ? 'is-active' : ''}`, cat);
    tab.addEventListener('click', () => {
      activeCategory = cat;
      catTabs.querySelectorAll('.genre-cat-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      renderGenreList();
    });
    catTabs.append(tab);
  });
  dialog.append(catTabs);

  // Body / Grid
  const body = el('div', 'genre-picker-modal__body');
  dialog.append(body);

  function renderGenreList() {
    body.innerHTML = '';
    const q = searchQuery.toLowerCase().trim();
    const filtered = DSP.GENRE_DATABASE.filter((g: any) => {
      const matchCat = activeCategory === 'All' || g.category === activeCategory;
      const matchQ = !q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || g.category.toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (filtered.length === 0) {
      body.append(el('div', 'muted', `No predefined genres match "${searchQuery}". You can type any custom genre below.`));
      return;
    }

    const grid = el('div', 'genre-grid');
    filtered.forEach((genre: any) => {
      const isSelected = rec.genre && (rec.genre.toLowerCase() === genre.name.toLowerCase() || rec.genre.toLowerCase() === genre.id.toLowerCase());
      const card = el('div', `genre-card ${isSelected ? 'is-selected' : ''}`);
      card.append(el('div', 'genre-card__name', genre.name));
      card.append(el('div', 'genre-card__bpm', `${genre.typicalBpm[0]}–${genre.typicalBpm[1]} BPM · ${genre.category}`));
      card.append(el('div', 'genre-card__desc', genre.description));

      card.addEventListener('click', async () => {
        await saveRecord(entry.path, { genre: genre.name });
        overlay.remove();
        render();
        toast('Genre Assigned', `${genre.name} assigned to ${entry.name}`);
      });
      grid.append(card);
    });
    body.append(grid);
  }

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderGenreList();
  });

  renderGenreList();

  // Custom genre row & Clear action
  const customRow = el('div', 'genre-custom-row');
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'genre-custom-input';
  customInput.placeholder = 'Or enter a custom genre (e.g. Cyber-Phonk, Melodic Riddim)...';
  if (rec.genre) customInput.value = rec.genre;
  customRow.append(customInput);

  const applyCustomBtn = el('button', 'pill pill--solid', 'Apply');
  applyCustomBtn.addEventListener('click', async () => {
    const val = customInput.value.trim();
    if (val) {
      await saveRecord(entry.path, { genre: val });
      overlay.remove();
      render();
      toast('Custom Genre Set', `${val} assigned to ${entry.name}`);
    }
  });
  customRow.append(applyCustomBtn);

  if (rec.genre) {
    const clearBtn = el('button', 'pill pill--sm', 'Clear');
    clearBtn.title = 'Remove genre tag';
    clearBtn.addEventListener('click', async () => {
      await saveRecord(entry.path, { genre: null });
      overlay.remove();
      render();
      toast('Genre Cleared', `Genre tag removed from ${entry.name}`);
    });
    customRow.append(clearBtn);
  }

  dialog.append(customRow);
  overlay.append(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  document.body.append(overlay);
  requestAnimationFrame(() => searchInput.focus());
}

async function saveRecord(key, patch) {
  const updated = await window.api.setRecord(key, patch);
  records[key] = updated;
  return updated;
}

/* ============================== settings =========================== */

function renderRootList() {
  const list = $('rootList');
  list.innerHTML = '';

  if (settings.roots.length === 0) {
    list.append(el('p', 'muted', 'Nothing added yet.'));
    return;
  }

  settings.roots.forEach((root) => {
    const item = el('div', 'root');
    const text = el('div');
    text.append(el('div', 'root__name', basename(root)));
    text.append(el('div', 'root__path', root));
    item.append(text);
    item.append(
      el('div', 'root__count', String(entries.filter((e) => e.root === root).length))
    );

    const remove = el('button', 'pill pill--sm', 'Remove');
    remove.addEventListener('click', async () => {
      settings = await window.api.removeRoot(root);
      applySettings();
      refresh();
    });
    item.append(remove);
    list.append(item);
  });
}

$('addRoot').addEventListener('click', async () => {
  const result = await window.api.addRoot();
  settings = result.settings;
  applySettings();
  result.messages.forEach((message) => toast('Folder list', message));
  refresh();
});

let ignoreTimer = null;
$('ignoreInput').addEventListener('input', () => {
  if (ignoreTimer) clearTimeout(ignoreTimer);
  ignoreTimer = setTimeout(async () => {
    settings = await window.api.updateSettings({
      ignore: $('ignoreInput')
        .value.split(',')
        .map((n) => n.trim())
        .filter(Boolean)
    });
    refresh();
  }, 600);
});

let webhookTimer = null;
if ($('webhookInput')) {
  $('webhookInput').addEventListener('input', () => {
    if (webhookTimer) clearTimeout(webhookTimer);
    webhookTimer = setTimeout(async () => {
      settings = await window.api.updateSettings({ webhookUrl: $('webhookInput').value });
    }, 600);
  });
}

$('alwaysOnTop').addEventListener('change', async () => {
  settings = await window.api.updateSettings({ alwaysOnTop: $('alwaysOnTop').checked });
});

const followLinksEl = $('followLinks');
if (followLinksEl) {
  followLinksEl.addEventListener('change', async () => {
    settings = await window.api.updateSettings({
      followLinks: followLinksEl.checked
    });
    refresh();
  });
}

$('pollWatching').addEventListener('change', async () => {
  settings = await window.api.updateSettings({ pollWatching: $('pollWatching').checked });
});

// Give the footer actions the same icon + label treatment as the nav items.
// Called from boot() — not at module load — because it reads the ICONS const,
// which is in its temporal dead zone until its declaration runs further down.
function decorateAction(id: string, iconName: string, label: string) {
  const btn = $(id);
  if (!btn) return;
  btn.textContent = '';
  btn.append(svgIcon(iconName, 'side-action__icon'));
  btn.append(el('span', 'side-action__label', label));
}

$('openDataDir').addEventListener('click', () => window.api.reveal(settings.dataDir));

const enableCrashLogsEl = $('enableCrashLogs');
if (enableCrashLogsEl) {
  enableCrashLogsEl.addEventListener('change', async () => {
    const enabled = enableCrashLogsEl.checked;
    if (window.api && window.api.crashlogSetEnabled) {
      await window.api.crashlogSetEnabled(enabled);
    }
  });
}

const openCrashLogsDirEl = $('openCrashLogsDir');
if (openCrashLogsDirEl) {
  openCrashLogsDirEl.addEventListener('click', async () => {
    if (window.api && window.api.crashlogOpenFolder) {
      await window.api.crashlogOpenFolder();
    }
  });
}

$('openSettings').addEventListener('click', openSheet);
$('closeSettings').addEventListener('click', closeSheet);
scrimEl.addEventListener('click', closeSheet);

const checkUpdatesBtn = $('checkUpdatesBtn');
if (checkUpdatesBtn) {
  checkUpdatesBtn.addEventListener('click', () => {
    window.api.openExternal('https://github.com/hrdsht/daw_buddy/releases');
  });
}

const openRegionGlobeBtn = $('openRegionGlobeSetup');
if (openRegionGlobeBtn) {
  openRegionGlobeBtn.addEventListener('click', () => {
    showRegionOnboardingModal({
      currentRegion: settings.region || 'indian',
      currentTraditions: settings.scaleTraditions || ['all'],
      isUpdateOrSettings: true,
      onSave: async (result) => {
        settings = await window.api.updateSettings({
          region: result.region,
          scaleTraditions: result.scaleTraditions,
          regionSetupComplete: true
        });
        applySettings();
        render();
        toast('Preferences Updated', `Set region to ${result.region}`);
      },
      playSynthNote: (pc, oct, a4) => playSynthNote(pc, oct, a4 || 440)
    });
  });
}

const settingRegionSelectEl = $('settingRegionSelect') as HTMLSelectElement | null;
if (settingRegionSelectEl) {
  settingRegionSelectEl.addEventListener('change', async () => {
    const newRegion = settingRegionSelectEl.value as ScaleTraditionId;
    settings = await window.api.updateSettings({
      region: newRegion,
      regionSetupComplete: true
    });
    applySettings();
    render();
    const regObj = WORLD_REGIONS.find((r) => r.id === newRegion);
    toast('Region Updated', `Primary music region set to ${regObj ? regObj.name : newRegion}`);
  });
}

const settingScaleTraditionSelectEl = $('settingScaleTraditionSelect') as HTMLSelectElement | null;
if (settingScaleTraditionSelectEl) {
  settingScaleTraditionSelectEl.addEventListener('change', async () => {
    const val = settingScaleTraditionSelectEl.value;
    if (val === 'custom') {
      if (openRegionGlobeBtn) openRegionGlobeBtn.click();
      return;
    }
    const newTraditions = val === 'all' ? ['all'] : [val as ScaleTraditionId];
    settings = await window.api.updateSettings({
      scaleTraditions: newTraditions,
      regionSetupComplete: true
    });
    applySettings();
    render();
    const label = val === 'western' ? 'Western Scales Only' : val === 'all' ? 'All World Traditions' : `${val} traditions`;
    toast('Scale Suggestions Updated', `Suggestions set to ${label}`);
  });
}

/* ---- Metronome Settings & DAW Drag Box --------------------------- */
function getEffectiveMetronomeBpm(): number {
  const current = Player.getCurrent();
  if (current && current.bpm && current.bpm > 30 && current.bpm < 400) {
    return Math.round(current.bpm);
  }
  if (openProject && openProject.bpm && openProject.bpm > 30 && openProject.bpm < 400) {
    return Math.round(openProject.bpm);
  }
  const inputEl = $('metroSettingBpm') as HTMLInputElement;
  if (inputEl && Number(inputEl.value) > 30 && Number(inputEl.value) < 400) {
    return Number(inputEl.value);
  }
  return 128; // Default 128 BPM if no audio was played last
}

const settingMetronomeSoundSelectEl = $('settingMetronomeSoundSelect') as HTMLSelectElement | null;
const metroSettingBpmEl = $('metroSettingBpm') as HTMLInputElement | null;
const metroSettingSigEl = $('metroSettingSig') as HTMLSelectElement | null;
const metroSettingBarsEl = $('metroSettingBars') as HTMLSelectElement | null;

if (metroSettingBpmEl && !metroSettingBpmEl.value) {
  metroSettingBpmEl.value = String(getEffectiveMetronomeBpm());
}

let auditionTimerId: any = null;
let auditionAudioCtx: AudioContext | null = null;
let isAuditioning = false;
let auditionPulseIndex = 0;

function stopMetroAudition() {
  if (auditionTimerId) {
    clearInterval(auditionTimerId);
    auditionTimerId = null;
  }
  if (auditionAudioCtx) {
    try { auditionAudioCtx.close(); } catch {}
    auditionAudioCtx = null;
  }
  isAuditioning = false;
  auditionPulseIndex = 0;
  if (auditionMetroSoundBtn) {
    const sig = metroSettingSigEl?.value || '4/4';
    auditionMetroSoundBtn.innerHTML = `<span>▶</span><span>Audition ${sig} Loop</span>`;
    auditionMetroSoundBtn.classList.remove('is-active');
  }
}

async function startMetroAudition() {
  stopMetroAudition();

  const soundId = settingMetronomeSoundSelectEl ? settingMetronomeSoundSelectEl.value : (Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton');
  const bpm = getEffectiveMetronomeBpm();
  const sig = metroSettingSigEl?.value || '4/4';

  auditionAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (auditionAudioCtx.state === 'suspended') {
    await auditionAudioCtx.resume().catch(() => {});
  }
  await loadSoundsetBuffers(soundId, auditionAudioCtx);

  // If main player is playing, pause it so only audition click is heard
  if (Player.isPlaying()) {
    Player.toggle();
  }

  isAuditioning = true;
  auditionPulseIndex = 0;

  if (auditionMetroSoundBtn) {
    auditionMetroSoundBtn.innerHTML = `<span>⏸</span><span>Stop Audition (${sig} · ${bpm} BPM)</span>`;
    auditionMetroSoundBtn.classList.add('is-active');
  }

  // Calculate interval in seconds for the selected time signature
  const safeBpm = bpm > 20 && bpm < 400 ? bpm : 128;
  const quarterSec = 60 / safeBpm;
  let intervalSec = quarterSec;
  if (sig === '6/8' || sig === '7/8' || sig === '5/8' || sig === '12/8') {
    intervalSec = quarterSec / 2; // eighth notes
  } else if (sig === '3/4' || sig === '4/4' || sig === '5/4') {
    intervalSec = quarterSec; // quarter notes
  }

  // Pulse accent logic
  function getPulseAccents(timeSig: string, index: number): { isDownbeat: boolean; isAccent: boolean } {
    if (timeSig === '6/8') {
      const beat = index % 6;
      return { isDownbeat: beat === 0, isAccent: beat === 3 };
    }
    if (timeSig === '3/4') {
      const beat = index % 3;
      return { isDownbeat: beat === 0, isAccent: false };
    }
    if (timeSig === '7/8') {
      const beat = index % 7;
      return { isDownbeat: beat === 0, isAccent: beat === 3 || beat === 5 };
    }
    if (timeSig === '5/4') {
      const beat = index % 5;
      return { isDownbeat: beat === 0, isAccent: beat === 3 };
    }
    if (timeSig === '12/8') {
      const beat = index % 12;
      return { isDownbeat: beat === 0, isAccent: beat === 3 || beat === 6 || beat === 9 };
    }
    // Default 4/4
    const beat = index % 4;
    return { isDownbeat: beat === 0, isAccent: beat === 2 };
  }

  // Play immediately on click
  const { isDownbeat, isAccent } = getPulseAccents(sig, auditionPulseIndex);
  playMetronomePulse(auditionAudioCtx, soundId, isDownbeat, isAccent, 0.9);
  auditionPulseIndex++;

  // Loop continuously
  const intervalMs = Math.max(50, Math.round(intervalSec * 1000));
  auditionTimerId = setInterval(() => {
    if (!isAuditioning || !auditionAudioCtx) return;
    const { isDownbeat: db, isAccent: acc } = getPulseAccents(sig, auditionPulseIndex);
    playMetronomePulse(auditionAudioCtx, soundId, db, acc, 0.85);
    auditionPulseIndex++;
  }, intervalMs);
}

if (settingMetronomeSoundSelectEl) {
  if (Player.getMetronomeSound) {
    settingMetronomeSoundSelectEl.value = Player.getMetronomeSound();
  }
  settingMetronomeSoundSelectEl.addEventListener('change', () => {
    const val = settingMetronomeSoundSelectEl.value;
    if (Player.setMetronomeSound) {
      Player.setMetronomeSound(val);
    }
    const def = getMetronomeSoundset(val);
    toast('Metronome Sound', `Default soundset set to ${def.name}`);
    if (isAuditioning) {
      startMetroAudition();
    }
  });
}

const auditionMetroSoundBtn = $('auditionMetroSoundBtn');
if (auditionMetroSoundBtn) {
  auditionMetroSoundBtn.addEventListener('click', () => {
    if (isAuditioning) {
      stopMetroAudition();
    } else {
      startMetroAudition();
    }
  });
}

if (metroSettingSigEl) {
  metroSettingSigEl.addEventListener('change', () => {
    if (isAuditioning) {
      startMetroAudition();
    } else if (auditionMetroSoundBtn) {
      auditionMetroSoundBtn.innerHTML = `<span>▶</span><span>Audition ${metroSettingSigEl.value} Loop</span>`;
    }
  });
}

if (metroSettingBpmEl) {
  metroSettingBpmEl.addEventListener('input', () => {
    if (isAuditioning) {
      startMetroAudition();
    }
  });
}

// Stop audition when main player starts playing
Player.onChange(({ playing }: any) => {
  if (playing && isAuditioning) {
    stopMetroAudition();
  }
});

const dragMetroAudioBtn = $('dragMetroAudioBtn');
if (dragMetroAudioBtn) {
  dragMetroAudioBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    const bpm = parseInt(metroSettingBpmEl?.value || '', 10) || getEffectiveMetronomeBpm();
    const sig = metroSettingSigEl?.value || '4/4';
    const bars = parseInt(metroSettingBarsEl?.value || '', 10) || 4;
    const soundId = settingMetronomeSoundSelectEl?.value || (Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton');
    const cleanSig = sig.replace('/', '-');
    const fileName = `Metronome_${soundId}_${bpm}BPM_${cleanSig}_${bars}Bars.wav`;

    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', fileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
    const wavBytes = await generateMetronomeWav(soundId, bpm, sig, bars);
    if (window.api && window.api.dragAudio) {
      await window.api.dragAudio(fileName, Array.from(wavBytes));
    }
  });

  dragMetroAudioBtn.addEventListener('click', async () => {
    const bpm = parseInt(metroSettingBpmEl?.value || '', 10) || getEffectiveMetronomeBpm();
    const sig = metroSettingSigEl?.value || '4/4';
    const bars = parseInt(metroSettingBarsEl?.value || '', 10) || 4;
    const soundId = settingMetronomeSoundSelectEl?.value || (Player.getMetronomeSound ? Player.getMetronomeSound() : 'ableton');
    const cleanSig = sig.replace('/', '-');
    const fileName = `Metronome_${soundId}_${bpm}BPM_${cleanSig}_${bars}Bars.wav`;

    const wavBytes = await generateMetronomeWav(soundId, bpm, sig, bars);
    if (window.api && window.api.dragAudio) {
      await window.api.dragAudio(fileName, Array.from(wavBytes));
    } else {
      const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

const dragMetroMidiBtn = $('dragMetroMidiBtn');
if (dragMetroMidiBtn) {
  dragMetroMidiBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    const bpm = parseInt(metroSettingBpmEl?.value || '', 10) || getEffectiveMetronomeBpm();
    const sig = metroSettingSigEl?.value || '4/4';
    const bars = parseInt(metroSettingBarsEl?.value || '', 10) || 4;
    const cleanSig = sig.replace('/', '-');
    const fileName = `Metronome_${bpm}BPM_${cleanSig}_${bars}Bars.mid`;

    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', fileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
    const midiBytes = generateMetronomeMidi(bpm, sig, bars);
    if (window.api && window.api.dragMidi) {
      await window.api.dragMidi(fileName, Array.from(midiBytes));
    }
  });

  dragMetroMidiBtn.addEventListener('click', async () => {
    const bpm = parseInt(metroSettingBpmEl?.value || '', 10) || getEffectiveMetronomeBpm();
    const sig = metroSettingSigEl?.value || '4/4';
    const bars = parseInt(metroSettingBarsEl?.value || '', 10) || 4;
    const cleanSig = sig.replace('/', '-');
    const fileName = `Metronome_${bpm}BPM_${cleanSig}_${bars}Bars.mid`;
    const midiBytes = generateMetronomeMidi(bpm, sig, bars);
    if (window.api && window.api.saveMidi) {
      await window.api.saveMidi(fileName, Array.from(midiBytes));
    }
  });
}

const animScaleRangeSlider = $('animScaleRangeSlider') as HTMLInputElement | null;
if (animScaleRangeSlider) {
  animScaleRangeSlider.addEventListener('input', async () => {
    const stepIdx = parseInt(animScaleRangeSlider.value, 10);
    const scaleSteps = [0, 0.25, 0.5, 1.0];
    const scaleLabels = ['0x (Instant / Off)', '0.25x (Ultra Fast)', '0.50x (Snappy)', '1.0x (Full Default)'];
    const chosenScale = scaleSteps[stepIdx] ?? 1.0;
    const isReduced = chosenScale < 1.0;

    const animValueDisplay = $('animScaleDisplayValue');
    if (animValueDisplay) {
      animValueDisplay.textContent = scaleLabels[stepIdx] || `${chosenScale}x`;
    }

    settings = await window.api.updateSettings({
      reducedAnimation: isReduced,
      animationScale: chosenScale
    });
    applySettings();
    toast('Animation Scale', `UI animation speed set to ${scaleLabels[stepIdx]}`);
  });
}

function startCurrentViewTour(force = true) {
  if (view === 'project' && openProject) {
    startProjectWalkthrough(force);
  } else {
    startFeatureWalkthrough(force);
  }
}

if ($('openTour')) {
  $('openTour').addEventListener('click', () => startCurrentViewTour(true));
}

if ($('startTourBtn')) {
  $('startTourBtn').addEventListener('click', () => {
    closeSheet();
    startCurrentViewTour(true);
  });
}

$('openTools').addEventListener('click', () => {
  navigationHistory.visit(captureLocation());
  view = 'tools';
  viewEl.scrollTop = 0;
  render();
});

function openStandaloneTool(nextView) {
  navigationHistory.visit(captureLocation());
  view = nextView;

  if (nextView === 'rename' || nextView === 'batch-rename') renameFolder = null;
  if (nextView === 'smart-rename') {
    smartRenameFolder = null;
    smartFiles = [];
    smartItems = [];
    smartSelectedPath = null;
  }
  if (nextView === 'silence') {
    silenceFolder = null;
    silenceResults = [];
    silenceChosen = new Set();
  }
  if (nextView === 'vocal') {
    vocalTab = 'split';
    vocalFolder = null;
    vocalFiles = [];
    vocalSelected = new Set();
    vocalSplitPreviews = new Map();
    vocalManifestPath = null;
    vocalBlocksFolder = null;
    vocalRebuildPreview = null;
  }

  if (nextView === 'scale-tool') {
    scaleToolState.error = null;
  }

  if (nextView === 'randomizer') {
    if (!randomizerState) rollRandomIdea('all');
  }

  viewEl.scrollTop = 0;
  render();
}

/* ======================= Scale & Raaga Detector Tool ======================= */

let scaleToolState: {
  file: { name: string; size: number; isMidi: boolean } | null;
  analyzing: boolean;
  result: any | null;
  error: string | null;
  activeScale: string | null;
  activeTonic: string | null;
} = {
  file: null,
  analyzing: false,
  result: null,
  error: null,
  activeScale: null,
  activeTonic: null
};

function parseMidiChromaAndTempo(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 14 || bytes[0] !== 0x4d || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
    throw new Error('Not a valid Standard MIDI File (.mid)');
  }

  const numTracks = (bytes[10] << 8) | bytes[11];
  const ticksPerQuarter = (bytes[12] << 8) | bytes[13] || 480;
  let bpm = 120;
  let hasTempoMeta = false;
  const chromaCounts = new Float64Array(12);
  let totalEvents = 0;

  const timedNotes: Array<{ tick: number; note: number; vel: number }> = [];

  let offset = 14;
  for (let t = 0; t < numTracks && offset < bytes.length; t++) {
    if (bytes[offset] !== 0x4d || bytes[offset + 1] !== 0x54 || bytes[offset + 2] !== 0x72 || bytes[offset + 3] !== 0x6b) {
      break;
    }
    const trackLen = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
    offset += 8;
    const trackEnd = offset + trackLen;

    let runningStatus = 0;
    let currentTicks = 0;
    while (offset < trackEnd && offset < bytes.length) {
      // Read variable-length delta time
      let delta = 0;
      while (offset < bytes.length) {
        const b = bytes[offset++];
        delta = (delta << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      currentTicks += delta;

      if (offset >= bytes.length) break;

      let status = bytes[offset];
      if (status & 0x80) {
        runningStatus = status;
        offset++;
      } else {
        status = runningStatus;
      }

      const msgType = status & 0xf0;

      if (status === 0xff) {
        const metaType = bytes[offset++];
        let metaLen = 0;
        while (offset < bytes.length) {
          const b = bytes[offset++];
          metaLen = (metaLen << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }

        if (metaType === 0x51 && metaLen === 3 && offset + 3 <= bytes.length) {
          const usPerQuarter = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
          if (usPerQuarter > 0) {
            bpm = Math.round(60000000 / usPerQuarter);
            hasTempoMeta = true;
          }
        }
        offset += metaLen;
      } else if (status === 0xf0 || status === 0xf7) {
        let sysexLen = 0;
        while (offset < bytes.length) {
          const b = bytes[offset++];
          sysexLen = (sysexLen << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        offset += sysexLen;
      } else if (msgType === 0x90) {
        const note = bytes[offset++];
        const vel = bytes[offset++];
        if (vel > 0) {
          chromaCounts[note % 12] += 1;
          totalEvents++;
          timedNotes.push({ tick: currentTicks, note, vel });
        }
      } else if (msgType === 0x80 || msgType === 0xa0 || msgType === 0xb0 || msgType === 0xe0) {
        offset += 2;
      } else if (msgType === 0xc0 || msgType === 0xd0) {
        offset += 1;
      }
    }
    offset = trackEnd;
  }

  if (totalEvents === 0) {
    throw new Error('No MIDI Note-On events found in file.');
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chromaCounts[i];
  const normalizedChroma = new Float64Array(12);
  for (let i = 0; i < 12; i++) normalizedChroma[i] = chromaCounts[i] / (sum || 1);

  let bestTonic = 0;
  let bestTonicScore = -1;
  for (let i = 0; i < 12; i++) {
    if (normalizedChroma[i] > bestTonicScore) {
      bestTonicScore = normalizedChroma[i];
      bestTonic = i;
    }
  }

  const clean = DSP.suppressHarmonics(normalizedChroma);
  const tonicResult = DSP.findTonic(clean, [normalizedChroma]);
  const tonicPc = tonicResult.tonicPc >= 0 ? tonicResult.tonicPc : bestTonic;
  const scaleResult = DSP.findScale(clean, tonicPc);
  const ragas = DSP.findMatchingRagas(clean, tonicPc, 6);

  const NOTES = DSP.NOTES;
  const tonicNote = NOTES[tonicPc];
  const scaleName = scaleResult.scale;
  const isMajor = scaleName === 'major' || scaleName === 'lydian' || scaleName === 'mixolydian';
  const camelot = isMajor
    ? { C: '8B', G: '9B', D: '10B', A: '11B', E: '12B', B: '1B', 'F#': '2B', 'C#': '3B', 'G#': '4B', 'D#': '5B', 'A#': '6B', F: '7B' }[tonicNote] || '8B'
    : { A: '8A', E: '9A', B: '10A', 'F#': '11A', 'C#': '12A', 'G#': '1A', 'D#': '2A', 'A#': '3A', F: '4A', C: '5A', G: '6A', D: '7A' }[tonicNote] || '8A';

  // MIDI Chord progression extraction across timeline
  const secondsPerTick = (60 / bpm) / ticksPerQuarter;
  const windowTicks = Math.max(ticksPerQuarter, Math.round(ticksPerQuarter * 2)); // 2 beats
  const maxTick = timedNotes.length > 0 ? Math.max(...timedNotes.map((n) => n.tick)) : 0;
  const totalMidiDuration = (maxTick + windowTicks) * secondsPerTick;

  const rawMidiChords: Array<{ startSec: number; endSec: number; rootPc: number; quality: string; score: number }> = [];

  for (let t = 0; t <= maxTick; t += windowTicks) {
    const endTick = t + windowTicks;
    const notesInWindow = timedNotes.filter((n) => n.tick >= t && n.tick < endTick);
    if (notesInWindow.length === 0) continue;

    const winChroma = new Float64Array(12);
    notesInWindow.forEach((n) => {
      winChroma[n.note % 12] += 1;
    });

    let bestRoot = 0;
    let bestQuality = 'maj';
    let bestScore = -Infinity;

    for (let r = 0; r < 12; r++) {
      for (const [qKey, tmpl] of Object.entries(DSP.CHORD_TEMPLATES)) {
        let matchScore = 0;
        let penalty = 0;
        const inChordSet = new Set(tmpl.intervals.map((iv) => (r + iv) % 12));
        for (let pc = 0; pc < 12; pc++) {
          if (inChordSet.has(pc)) {
            matchScore += winChroma[pc];
          } else {
            penalty += winChroma[pc] * 0.4;
          }
        }
        matchScore += winChroma[r] * 0.3;
        const score = (matchScore - penalty) / (tmpl.intervals.length + 0.4);
        if (score > bestScore) {
          bestScore = score;
          bestRoot = r;
          bestQuality = qKey;
        }
      }
    }

    if (bestScore > 0.2) {
      rawMidiChords.push({
        startSec: Math.round(t * secondsPerTick * 10) / 10,
        endSec: Math.round(endTick * secondsPerTick * 10) / 10,
        rootPc: bestRoot,
        quality: bestQuality,
        score: bestScore
      });
    }
  }

  // Merge consecutive identical chords
  const mergedMidiSegments: any[] = [];
  if (rawMidiChords.length > 0) {
    let cur = rawMidiChords[0];
    let curStart = cur.startSec;
    let curEnd = cur.endSec;
    let curScoreSum = cur.score;
    let curCount = 1;

    for (let i = 1; i < rawMidiChords.length; i++) {
      const next = rawMidiChords[i];
      if (next.rootPc === cur.rootPc && next.quality === cur.quality) {
        curEnd = next.endSec;
        curScoreSum += next.score;
        curCount++;
      } else {
        const dur = Math.round((curEnd - curStart) * 10) / 10;
        const rootName = NOTES[cur.rootPc];
        const tmpl = (DSP.CHORD_TEMPLATES as any)[cur.quality] || (DSP.CHORD_TEMPLATES as any).maj;
        const chordName = `${rootName}${tmpl.nameSuffix}`;
        const roman = DSP.getRomanNumeral(cur.rootPc, cur.quality, tonicPc, !isMajor);
        const noteNames = tmpl.intervals.map((iv: number) => NOTES[(cur.rootPc + iv) % 12]);
        const midiNotes = tmpl.intervals.map((iv: number) => 60 + cur.rootPc + iv);

        mergedMidiSegments.push({
          startTime: curStart,
          endTime: curEnd,
          duration: dur,
          chord: chordName,
          root: rootName,
          rootPc: cur.rootPc,
          quality: cur.quality,
          roman,
          notes: noteNames,
          midiNotes,
          confidence: Math.round((curScoreSum / curCount) * 100) / 100
        });

        cur = next;
        curStart = next.startSec;
        curEnd = next.endSec;
        curScoreSum = next.score;
        curCount = 1;
      }
    }

    const dur = Math.round((curEnd - curStart) * 10) / 10;
    const rootName = NOTES[cur.rootPc];
    const tmpl = (DSP.CHORD_TEMPLATES as any)[cur.quality] || (DSP.CHORD_TEMPLATES as any).maj;
    const chordName = `${rootName}${tmpl.nameSuffix}`;
    const roman = DSP.getRomanNumeral(cur.rootPc, cur.quality, tonicPc, !isMajor);
    const noteNames = tmpl.intervals.map((iv: number) => NOTES[(cur.rootPc + iv) % 12]);
    const midiNotes = tmpl.intervals.map((iv: number) => 60 + cur.rootPc + iv);

    mergedMidiSegments.push({
      startTime: curStart,
      endTime: curEnd,
      duration: dur,
      chord: chordName,
      root: rootName,
      rootPc: cur.rootPc,
      quality: cur.quality,
      roman,
      notes: noteNames,
      midiNotes,
      confidence: Math.round((curScoreSum / curCount) * 100) / 100
    });
  }

  const chordProgression = {
    duration: totalMidiDuration,
    chordCount: mergedMidiSegments.length,
    segments: mergedMidiSegments,
    summary: mergedMidiSegments.map((s) => s.chord).join(' → ') || 'N/A',
    romanSummary: mergedMidiSegments.map((s) => s.roman).join(' – ') || 'N/A',
    uniqueChords: Array.from(new Set(mergedMidiSegments.map((s) => s.chord)))
  };

  return {
    isMidi: true,
    noteCount: totalEvents,
    bpm: bpm,
    bpmConfidence: hasTempoMeta ? 0.95 : 0.65,
    key: `${tonicNote} ${isMajor ? 'maj' : 'min'}`,
    camelot: camelot,
    tonic: tonicNote,
    tonicPc: tonicPc,
    tonicConfidence: 0.9,
    scale: scaleName,
    scaleConfidence: scaleResult.confidence,
    degrees: scaleResult.degrees,
    tuningA4: 440,
    tuningCents: 0,
    thaat: DSP.THAAT_MAP[scaleName] || null,
    ragas: ragas,
    chordProgression
  };
}

async function handleScaleToolFile(file: File) {
  const isMidi = /\.midi?$/i.test(file.name);
  scaleToolState.file = { name: file.name, size: file.size, isMidi };
  scaleToolState.analyzing = true;
  scaleToolState.error = null;
  scaleToolState.result = null;
  scaleToolState.activeScale = null;
  scaleToolState.activeTonic = null;
  render();

  try {
    if (isMidi) {
      const buffer = await file.arrayBuffer();
      const result = parseMidiChromaAndTempo(buffer);
      scaleToolState.result = result;
      scaleToolState.activeScale = result.scale;
      scaleToolState.activeTonic = result.tonic;
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;
      // Run heavy DSP analysis in the background worker — never blocks the UI
      const analysis = await analyseDecodedInBackground(audioBuffer);
      await audioCtx.close();

      scaleToolState.result = {
        isAudio: true,
        durationSeconds: duration,
        ...analysis
      };
      scaleToolState.activeScale = analysis.scale;
      scaleToolState.activeTonic = analysis.tonic;
    }
  } catch (err: any) {
    console.error('Scale tool analysis error:', err);
    scaleToolState.error = err?.message || 'Failed to analyze file. Please make sure it is a valid audio or MIDI file.';
  } finally {
    scaleToolState.analyzing = false;
    render();
  }
}

function renderScaleMidiTool() {
  viewEl.innerHTML = '';

  const section = el('div', 'section scale-tool-page');
  
  // Breadcrumb / Header
  const breadcrumb = el('div', 'breadcrumbs');
  const back = el('button', 'breadcrumb__link', '← All tools');
  back.addEventListener('click', () => {
    navigationHistory.visit(captureLocation());
    view = 'tools';
    render();
  });
  breadcrumb.append(back, el('span', 'breadcrumb__sep', '/'), el('span', 'breadcrumb__current', 'Scale & Raaga Detector'));
  section.append(breadcrumb);

  section.append(headRow('Scale & Raaga Detector', 'Drop any audio sample or MIDI file to instantly detect BPM, scale, concert tuning, and matching Indian Raagas.', 'scale-tool'));

  // Dropzone card
  const dropZone = el('div', `scale-dropzone ${scaleToolState.analyzing ? 'scale-dropzone--analyzing' : ''}`);
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.wav,.mp3,.flac,.ogg,.aif,.aiff,.mid,.midi,.m4a';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleScaleToolFile(fileInput.files[0]);
    }
  });

  const dropContent = el('div', 'scale-dropzone__content');
  dropContent.append(svgIcon('music', 'scale-dropzone__icon', 36));
  
  if (scaleToolState.analyzing) {
    dropContent.append(el('h4', 'scale-dropzone__title', 'Analyzing musical content...'));
    dropContent.append(el('p', 'scale-dropzone__subtitle', 'Extracting spectral chromagram, tempo onsets & Indian Raaga sequences'));
    const spinner = el('div', 'spinner scale-dropzone__spinner');
    dropContent.append(spinner);
  } else {
    dropContent.append(el('h4', 'scale-dropzone__title', 'Drop Audio Sample or MIDI file here'));
    dropContent.append(el('p', 'scale-dropzone__subtitle', 'Supports WAV, MP3, FLAC, AIFF, OGG & Standard MIDI (.mid)'));
    const browseBtn = el('button', 'pill pill--solid', 'Browse file...');
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    dropContent.append(browseBtn);
  }

  dropZone.append(fileInput, dropContent);

  // Drag & drop handlers
  dropZone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.add('scale-dropzone--over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('scale-dropzone--over');
  });
  dropZone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove('scale-dropzone--over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleScaleToolFile(e.dataTransfer.files[0]);
    }
  });

  section.append(dropZone);

  // If error occurred
  if (scaleToolState.error) {
    const errorBox = el('div', 'callout callout--danger', `⚠️ ${scaleToolState.error}`);
    section.append(errorBox);
  }

  // If analysis result available
  if (scaleToolState.result && scaleToolState.file) {
    const res = scaleToolState.result;
    const tonicPc = res.tonicPc ?? (res.tonic ? DSP.NOTES.indexOf(res.tonic) : 0);
    const selectedTonic = scaleToolState.activeTonic || res.tonic || 'C';
    const selectedScale = scaleToolState.activeScale || res.scale || 'major';
    const degrees = DSP.SCALES[selectedScale.toLowerCase()] || res.degrees || DSP.SCALES.major;
    const tuningA4 = res.tuningA4 || 440;

    const resultBox = el('div', 'scale-results-box');

    // File info header
    const fileHeader = el('div', 'scale-file-header');
    fileHeader.append(el('div', 'scale-file-header__title', `🎵 ${scaleToolState.file.name}`));
    fileHeader.append(el('div', 'scale-file-header__meta', `${scaleToolState.file.isMidi ? 'MIDI File' : 'Audio Sample'} · ${formatBytes(scaleToolState.file.size)}${res.durationSeconds ? ` · ${res.durationSeconds.toFixed(1)}s` : ''}`));
    resultBox.append(fileHeader);

    // Primary Metrics Grid
    const metricsGrid = el('div', 'scale-metrics-grid');

    // BPM Card
    const bpmCard = el('div', 'scale-metric-card');
    bpmCard.append(el('div', 'scale-metric__label', 'Detected Tempo'));
    bpmCard.append(el('div', 'scale-metric__val scale-metric__val--bpm', `${formatBpm(res.bpm || 120)} BPM`));
    bpmCard.append(el('div', 'scale-metric__sub', `${Math.round((res.bpmConfidence || 0.8) * 100)}% Confidence`));
    metricsGrid.append(bpmCard);

    // Key & Camelot Card
    const keyCard = el('div', 'scale-metric-card');
    keyCard.append(el('div', 'scale-metric__label', 'Key & Camelot'));
    const camelotTag = res.camelot ? `<span class="scale-camelot-badge">${res.camelot}</span> ` : '';
    const keyHtml = el('div', 'scale-metric__val');
    keyHtml.innerHTML = `${camelotTag}${selectedTonic} ${selectedScale}`;
    keyCard.append(keyHtml);
    keyCard.append(el('div', 'scale-metric__sub', res.thaat ? `${res.thaat}` : (res.modal ? 'Modal Scale' : 'Western Standard')));
    metricsGrid.append(keyCard);

    // Concert Tuning Card
    const tuningCard = el('div', 'scale-metric-card');
    tuningCard.append(el('div', 'scale-metric__label', 'Concert Tuning'));
    const isDetuned = Math.abs(tuningA4 - 440) > 0.5;
    const tuningCentsStr = res.tuningCents ? ` (${res.tuningCents > 0 ? '+' : ''}${res.tuningCents.toFixed(1)}¢)` : '';
    tuningCard.append(el('div', `scale-metric__val ${isDetuned ? 'scale-metric__val--detuned' : ''}`, `A4 = ${tuningA4.toFixed(1)} Hz`));
    tuningCard.append(el('div', 'scale-metric__sub', isDetuned ? `Detuned${tuningCentsStr}` : 'Standard 440Hz'));
    metricsGrid.append(tuningCard);

    resultBox.append(metricsGrid);

    // Interactive 2-octave Scale Keyboard & Audition Section
    const kbSection = el('div', 'scale-kb-section');
    kbSection.append(el('h4', 'scale-notes__title', `Interactive Scale Keyboard: ${selectedTonic} ${selectedScale}`));

    const kb = kbLayoutFn(2, 19, 70);
    const highlightedKeys = kbHighlightFn(kb.keys, tonicPc, degrees);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgKb = document.createElementNS(svgNS, 'svg');
    svgKb.setAttribute('class', 'scale-keyboard');
    svgKb.setAttribute('viewBox', `0 0 ${kb.width} ${kb.height}`);
    svgKb.setAttribute('width', '100%');
    svgKb.setAttribute('height', '76');

    // Render whites first
    highlightedKeys.filter((k) => k.type === 'white').forEach((k) => {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(k.x));
      rect.setAttribute('y', String(k.y));
      rect.setAttribute('width', String(k.width - 1));
      rect.setAttribute('height', String(k.height));
      rect.setAttribute('rx', '3');
      rect.setAttribute('class', `scale-key scale-key--white scale-key--${k.state}`);
      const degInterval = ((k.pc - tonicPc) % 12 + 12) % 12;
      const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
      const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
      rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
      rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, tuningA4));
      svgKb.appendChild(rect);
    });

    // Render blacks on top
    highlightedKeys.filter((k) => k.type === 'black').forEach((k) => {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(k.x));
      rect.setAttribute('y', String(k.y));
      rect.setAttribute('width', String(k.width));
      rect.setAttribute('height', String(k.height));
      rect.setAttribute('rx', '3');
      rect.setAttribute('class', `scale-key scale-key--black scale-key--${k.state}`);
      const degInterval = ((k.pc - tonicPc) % 12 + 12) % 12;
      const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
      const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
      rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
      rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, tuningA4));
      svgKb.appendChild(rect);
    });

    kbSection.append(svgKb);

    // 2. Interactive 6-String Guitar Fretboard (below keyboard in scale tool)
    const toolSvgFb = renderFretboardSvg(tonicPc, degrees, tuningA4);
    kbSection.append(toolSvgFb);

    // Scale Action buttons: Play Scale, Play Drone, Drag Scale MIDI
    const scaleActions = el('div', 'scale-modal-actions');
    
    const playScaleBtn = el('button', 'pill pill--solid scale-action-btn', '▶ Play Scale');
    const toolScaleSessionId = 'world-tool-scale';
    const resetToolScaleUi = () => {
      playScaleBtn.textContent = '▶ Play Scale';
      playScaleBtn.classList.remove('pill--active');
    };
    playScaleBtn.addEventListener('click', () => {
      if (isScalePlaying(toolScaleSessionId)) {
        stopScalePlayback();
        resetToolScaleUi();
        return;
      }
      playScaleBtn.textContent = '■ Stop Scale';
      playScaleBtn.classList.add('pill--active');
      playFullScale(tonicPc, degrees, tuningA4, toolScaleSessionId, resetToolScaleUi);
    });
    scaleActions.append(playScaleBtn);

    const droneBtn = el('button', 'pill scale-action-btn', `🔊 Root Drone (${selectedTonic})`);
    droneBtn.addEventListener('click', () => playSynthNote(tonicPc, 3, tuningA4, 2.5));
    scaleActions.append(droneBtn);

    const scaleMidiBtn = el('button', 'pill scale-midi-btn scale-action-btn', '⤓ Drag Scale MIDI to DAW');
    const sMidiNotes = notesFor(tonicPc, degrees, 3);
    const sMidiBytes = scaleMidi(sMidiNotes, { bpm: res.bpm || 120, bars: 4 });
    const sMidiFileName = `${scaleToolState.file.name.replace(/\.[^/.]+$/, '')}_Scale_${selectedTonic}_${selectedScale}.mid`;
    scaleMidiBtn.draggable = true;
    scaleMidiBtn.addEventListener('dragstart', async (e: DragEvent) => {
      e.preventDefault();
      if (window.api.dragMidi) await window.api.dragMidi(sMidiFileName, Array.from(sMidiBytes));
    });
    scaleMidiBtn.addEventListener('click', async () => {
      if (window.api.saveMidi) {
        const saved = await window.api.saveMidi(sMidiFileName, Array.from(sMidiBytes));
        if (saved) toast('Scale MIDI exported', saved);
      } else {
        const blob = new Blob([sMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sMidiFileName;
        a.click();
        URL.revokeObjectURL(url);
        toast('Scale MIDI exported', sMidiFileName);
      }
    });
    scaleActions.append(scaleMidiBtn);

    kbSection.append(scaleActions);
    resultBox.append(kbSection);

    // Full-Length Chord Progression Section
    const progData = res.chordProgression;
    if (progData && progData.segments && progData.segments.length > 0) {
      const progSection = el('div', 'scale-progression-section');
      
      const progHeader = el('div', 'scale-progression-header');
      const titleWrapper = el('div');
      titleWrapper.append(el('h4', 'scale-notes__title', '🎼 Full-Length Chord Progression'));
      titleWrapper.append(el('div', 'scale-progression-meta', `${progData.chordCount} Chords Detected · Key of ${selectedTonic} ${selectedScale}`));
      progHeader.append(titleWrapper);

      // Roman Numeral & Chord Formula Badge
      if (progData.romanSummary && progData.romanSummary !== 'N/A') {
        const formulaBadge = el('div', 'scale-progression-formula', `Harmonic Flow: ${progData.romanSummary}`);
        progHeader.append(formulaBadge);
      }
      progSection.append(progHeader);

      // Timeline Flow Strip
      const timelineScroll = el('div', 'scale-progression-scroll');
      const timelineStrip = el('div', 'scale-progression-timeline');

      let isProgPlaying = false;
      let progPlayTimeout: any = null;

      const formatProgTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
      };

      progData.segments.forEach((seg: any) => {
        const chordCard = el('div', 'chord-card');
        chordCard.setAttribute('title', `Click to audition ${seg.chord} (${(seg.notes || []).join(' - ')})`);

        const chordBadge = el('div', `chord-badge chord-badge--${seg.quality || 'maj'}`);
        chordBadge.append(el('span', 'chord-name', seg.chord));
        if (seg.roman) {
          chordBadge.append(el('span', 'chord-roman', seg.roman));
        }
        chordCard.append(chordBadge);

        const timeLabel = el('div', 'chord-time', `${formatProgTime(seg.startTime)} – ${formatProgTime(seg.endTime)}`);
        chordCard.append(timeLabel);

        if (seg.notes && seg.notes.length > 0) {
          const notesList = el('div', 'chord-notes', seg.notes.join(' · '));
          chordCard.append(notesList);
        }

        // Click to audition chord
        chordCard.addEventListener('click', () => {
          if (isProgPlaying) {
            isProgPlaying = false;
            if (progPlayTimeout) clearTimeout(progPlayTimeout);
            playProgBtn.textContent = '▶ Play Progression';
            playProgBtn.classList.remove('pill--active');
          }
          const allCards = timelineStrip.querySelectorAll('.chord-card');
          allCards.forEach((c) => c.classList.remove('chord-card--active', 'chord-card--playing'));
          chordCard.classList.add('chord-card--active');
          setTimeout(() => chordCard.classList.remove('chord-card--active'), Math.min(1200, (seg.duration || 1.2) * 1000));
          playSynthChord(seg.midiNotes, tuningA4, Math.min(2.0, Math.max(0.8, seg.duration || 1.2)));
        });

        timelineStrip.append(chordCard);
      });

      timelineScroll.append(timelineStrip);
      progSection.append(timelineScroll);

      // Action Buttons for Progression
      const progActions = el('div', 'scale-modal-actions scale-progression-actions');
      
      const playProgBtn = el('button', 'pill pill--solid scale-action-btn', '▶ Play Progression');
      playProgBtn.addEventListener('click', () => {
        if (isProgPlaying) {
          isProgPlaying = false;
          if (progPlayTimeout) clearTimeout(progPlayTimeout);
          stopActiveChord(0.045);
          playProgBtn.textContent = '▶ Play Progression';
          playProgBtn.classList.remove('pill--active');
          const cards = timelineStrip.querySelectorAll('.chord-card');
          cards.forEach((c) => c.classList.remove('chord-card--playing'));
          return;
        }

        isProgPlaying = true;
        playProgBtn.textContent = '■ Stop Progression';
        playProgBtn.classList.add('pill--active');

        let step = 0;
        const playNext = () => {
          if (!isProgPlaying || step >= progData.segments.length) {
            isProgPlaying = false;
            playProgBtn.textContent = '▶ Play Progression';
            playProgBtn.classList.remove('pill--active');
            const cards = timelineStrip.querySelectorAll('.chord-card');
            cards.forEach((c) => c.classList.remove('chord-card--playing'));
            return;
          }
          const s = progData.segments[step];
          const cards = timelineStrip.querySelectorAll('.chord-card');
          cards.forEach((c, i) => {
            if (i === step) {
              c.classList.add('chord-card--playing');
              (c as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            } else {
              c.classList.remove('chord-card--playing');
            }
          });

          playSynthChord(s.midiNotes, tuningA4, Math.min(2.0, Math.max(0.8, s.duration || 1.2)));
          step++;
          const delayMs = Math.max(400, Math.min(3000, (s.duration || 1.2) * 1000));
          progPlayTimeout = setTimeout(playNext, delayMs);
        };
        playNext();
      });
      progActions.append(playProgBtn);

      // Drag MIDI Progression to DAW Button
      const progMidiBtn = el('button', 'pill scale-midi-btn scale-action-btn', '⤓ Drag Progression MIDI to DAW');
      const pMidiItems = progData.segments.map((s: any) => ({
        midiNotes: s.midiNotes,
        durationSec: s.duration
      }));
      const pMidiBytes = progressionMidi(pMidiItems, { bpm: res.bpm || 120 });
      const pMidiFileName = `${scaleToolState.file.name.replace(/\.[^/.]+$/, '')}_Progression_${selectedTonic}_${selectedScale}.mid`;

      progMidiBtn.draggable = true;
      progMidiBtn.addEventListener('dragstart', async (e: DragEvent) => {
        e.preventDefault();
        if (window.api.dragMidi) await window.api.dragMidi(pMidiFileName, Array.from(pMidiBytes));
      });

      progMidiBtn.addEventListener('click', async () => {
        if (window.api.saveMidi) {
          const saved = await window.api.saveMidi(pMidiFileName, Array.from(pMidiBytes));
          if (saved) toast('Chord Progression MIDI exported', saved);
        } else {
          const blob = new Blob([pMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = pMidiFileName;
          a.click();
          URL.revokeObjectURL(url);
          toast('Chord Progression MIDI exported', pMidiFileName);
        }
      });
      progActions.append(progMidiBtn);

      progSection.append(progActions);
      resultBox.append(progSection);
    }

    // World Musical Traditions & Scales Explorer in Scale Tool
    const baseScale = res.scale || 'major';
    const baseDegrees = DSP.SCALES[baseScale.toLowerCase()] || res.degrees || DSP.SCALES.major;
    const toolChroma = new Float64Array(12);
    baseDegrees.forEach((d) => {
      toolChroma[(tonicPc + d) % 12] = 1.0;
    });

    let activeToolTab: ScaleTraditionId = 'all';
    const worldSection = el('div', 'scale-ragas-section scale-world-section');
    
    const worldHeader = el('div', 'scale-world-header');
    worldHeader.append(el('h4', 'scale-notes__title', 'World Musical Traditions & Scale Suggestions'));

    const tabsRow = el('div', 'scale-tradition-tabs');
    const tabOptions: { id: ScaleTraditionId; label: string }[] = [
      { id: 'all', label: '✨ All Traditions' },
      { id: 'indian', label: '🇮🇳 Indian Raagas' },
      { id: 'arabic', label: '🇪🇬 Arabic Maqamat' },
      { id: 'chinese', label: '🇨🇳 Chinese & East Asian' },
      { id: 'western', label: '🌐 Western & Jazz' },
      { id: 'mediterranean', label: '🇪🇸 Mediterranean' }
    ];

    const ragasGrid = el('div', 'scale-ragas-grid scale-world-grid');

    function renderToolWorldCards(tabId: ScaleTraditionId) {
      ragasGrid.innerHTML = '';
      const matchedScales = findMatchingWorldScales(toolChroma, tonicPc, tabId, 12);

      matchedScales.forEach((scaleMatch: ScoredWorldScale) => {
        const isCurrent = selectedScale === scaleMatch.id || selectedScale === scaleMatch.name.toLowerCase();
        const card = el('div', `raga-card ${isCurrent ? 'raga-card--active' : ''}`);

        const top = el('div', 'raga-card__header');
        const regionMeta = WORLD_REGIONS.find((r) => r.id === scaleMatch.tradition);
        const flagStr = regionMeta ? regionMeta.flag : '🌐';

        top.append(el('span', 'raga-card__name', `${flagStr} ${scaleMatch.name}`));
        top.append(el('span', 'raga-card__pct', `${scaleMatch.matchPercent}% Match`));
        card.append(top);

        const sub = el('div', 'raga-card__thaat', `${scaleMatch.subCategory || scaleMatch.tradition}${scaleMatch.nativeName ? ` · ${scaleMatch.nativeName}` : ''}`);
        card.append(sub);

        if (scaleMatch.phraseNotation) {
          if (scaleMatch.phraseNotation.ascending) {
            const ascRow = el('div', 'raga-card__phrase raga-card__phrase--aaroh');
            ascRow.append(el('span', 'raga-phrase__tag', '▲ Asc:'));
            ascRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.ascending));
            card.append(ascRow);
          }
          if (scaleMatch.phraseNotation.descending) {
            const descRow = el('div', 'raga-card__phrase raga-card__phrase--avaroh');
            descRow.append(el('span', 'raga-phrase__tag', '▼ Desc:'));
            descRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.descending));
            card.append(descRow);
          }
        }

        if (scaleMatch.mood || scaleMatch.timeOfDay || scaleMatch.suggestedRhythm) {
          const metaRow = el('div', 'raga-card__meta');
          if (scaleMatch.timeOfDay) metaRow.append(el('span', 'raga-card__time', `🕒 ${scaleMatch.timeOfDay}`));
          if (scaleMatch.mood) metaRow.append(el('span', 'raga-card__mood', `✨ ${scaleMatch.mood}`));
          if (scaleMatch.suggestedRhythm) metaRow.append(el('span', 'raga-card__rhythm', `🥁 ${scaleMatch.suggestedRhythm.split('/')[0]}`));
          card.append(metaRow);
        }

        const actions = el('div', 'raga-card__actions');

        const cardSessionId = `scale-world-card-${scaleMatch.id || scaleMatch.name}`;
        const resetPreviewBtn = () => {
          previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
          previewBtn.classList.remove('pill--solid');
        };

        const previewBtn = el('button', 'pill pill--sm raga-btn--preview');
        previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
        previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isScalePlaying(cardSessionId)) {
            stopScalePlayback();
            resetPreviewBtn();
            return;
          }
          document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
            b.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
            b.classList.remove('pill--solid');
          });
          resetToolScaleUi();
          previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
          previewBtn.classList.add('pill--solid');
          const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
          const desc = scaleMatch.descendingPhrase || [...asc].reverse();
          playRagaSequence(tonicPc, asc, desc, tuningA4, cardSessionId, resetPreviewBtn);
        });
        actions.append(previewBtn);

        const midiBtn = el('button', 'pill pill--sm pill--solid raga-btn--midi', '⤓ Drag to DAW');
        midiBtn.title = 'Drag onto any DAW track or click to export MIDI containing scale phrasing';
        const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const desc = scaleMatch.descendingPhrase || [...asc].reverse();
        const rMidiBytes = generateWorldScaleMidi(tonicPc, asc, desc, { bpm: res.bpm || 120 });
        const cleanName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const rMidiFileName = `${scaleToolState.file.name.replace(/\.[^/.]+$/, '')}_Scale_${cleanName}_${selectedTonic}.mid`;

        midiBtn.draggable = true;
        midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
          e.preventDefault();
          if (window.api.dragMidi) await window.api.dragMidi(rMidiFileName, Array.from(rMidiBytes));
        });
        midiBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (window.api.saveMidi) {
            const saved = await window.api.saveMidi(rMidiFileName, Array.from(rMidiBytes));
            if (saved) toast('Scale MIDI exported', saved);
          } else {
            const blob = new Blob([rMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = rMidiFileName;
            a.click();
            URL.revokeObjectURL(url);
            toast('Scale MIDI exported', rMidiFileName);
          }
        });
        actions.append(midiBtn);
        card.append(actions);

        card.title = `Click to select ${scaleMatch.name}`;
        card.addEventListener('click', () => {
          stopScalePlayback();
          scaleToolState.activeScale = scaleMatch.id || scaleMatch.name.toLowerCase();
          if (scaleMatch.degrees) {
            DSP.SCALES[scaleMatch.id] = scaleMatch.degrees;
            DSP.SCALES[scaleMatch.name.toLowerCase()] = scaleMatch.degrees;
            DSP.THAAT_MAP[scaleMatch.id] = `${scaleMatch.subCategory || scaleMatch.tradition} (${scaleMatch.name})`;
          }
          render();
          const ascP = scaleMatch.ascendingPhrase || scaleMatch.degrees;
          const descP = scaleMatch.descendingPhrase || [...ascP].reverse();
          playRagaSequence(tonicPc, ascP, descP, tuningA4);
        });

        ragasGrid.append(card);
      });
    }

    tabOptions.forEach((tab) => {
      const tabBtn = el('button', `scale-tradition-tab ${tab.id === activeToolTab ? 'scale-tradition-tab--active' : ''}`, tab.label);
      tabBtn.addEventListener('click', () => {
        activeToolTab = tab.id;
        tabsRow.querySelectorAll('.scale-tradition-tab').forEach((b: any) => b.classList.remove('scale-tradition-tab--active'));
        tabBtn.classList.add('scale-tradition-tab--active');
        renderToolWorldCards(tab.id);
      });
      tabsRow.append(tabBtn);
    });

    worldHeader.append(tabsRow);
    worldSection.append(worldHeader);
    renderToolWorldCards(activeToolTab);
    worldSection.append(ragasGrid);
    resultBox.append(worldSection);

    section.append(resultBox);
  }

  viewEl.append(section);
  setTimeout(() => startToolWalkthrough('scale-tool', false), 150);
}

/* ======================= Music Randomizer Tool ======================= */

interface RandomizerState {
  tonic: string;
  tonicPc: number;
  scaleName: string;
  degrees: number[];
  bpm: number;
  timeSignature: string;
  tala: any | null;
  raga: any | null;
  ragas: any[];
  camelot: string;
  tuningA4: number;
  thaat: string | null;
  genre: any;
}

let randomizerState: RandomizerState | null = null;

const COMMON_MUSICAL_BPMS = [
  68, 72, 74, 76, 80, 84, 88, 90, 92, 96, 100, 104, 108, 110, 115, 120, 124, 128, 132, 136, 140, 144, 150, 156, 160
];

const TIME_SIGNATURE_POOL = ['4/4', '3/4', '6/8', '7/8', '5/8', '5/4', '12/8'];

function rollRandomIdea(target: 'all' | 'key' | 'bpm' | 'meter' | 'genre' = 'all') {
  let nextTonic = randomizerState?.tonic || 'C';
  let nextTonicPc = randomizerState?.tonicPc ?? 0;
  let nextScaleName = randomizerState?.scaleName || 'major';
  let nextDegrees = randomizerState?.degrees || DSP.SCALES.major;
  let nextThaat = randomizerState?.thaat || null;
  let nextBpm = randomizerState?.bpm ?? 120;
  let nextTimeSig = randomizerState?.timeSignature ?? '4/4';
  let nextGenre = randomizerState?.genre || DSP.GENRE_DATABASE[0];

  if (target === 'all' || target === 'genre' || !randomizerState) {
    const randomGenreIdx = Math.floor(Math.random() * DSP.GENRE_DATABASE.length);
    nextGenre = DSP.GENRE_DATABASE[randomGenreIdx];
  }

  if (target === 'all' || target === 'key' || !randomizerState) {
    nextTonicPc = Math.floor(Math.random() * 12);
    nextTonic = DSP.NOTES[nextTonicPc];

    // Combine authentic world scales based on user tradition preferences
    const userTraditions = (settings && settings.scaleTraditions) || ['all'];
    const candidates = userTraditions.includes('all')
      ? WORLD_SCALES_DATABASE
      : WORLD_SCALES_DATABASE.filter((s) => userTraditions.includes(s.tradition));
    const pickedScale = (candidates.length > 0 ? candidates : WORLD_SCALES_DATABASE)[
      Math.floor(Math.random() * (candidates.length || WORLD_SCALES_DATABASE.length))
    ];

    nextScaleName = pickedScale.name;
    nextDegrees = pickedScale.degrees;
    nextThaat = pickedScale.subCategory || pickedScale.tradition;
    if (target === 'all' && pickedScale.suggestedRhythm) {
      const matchSig = TIME_SIGNATURE_POOL.find((ts) => pickedScale.suggestedRhythm?.includes(ts));
      if (matchSig) nextTimeSig = matchSig;
    }
  }

  if (target === 'all' || target === 'bpm' || !randomizerState) {
    if (target === 'all' && nextGenre && nextGenre.typicalBpm) {
      const [lo, hi] = nextGenre.typicalBpm;
      const candidates = COMMON_MUSICAL_BPMS.filter((b) => b >= lo - 4 && b <= hi + 4);
      nextBpm = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : Math.floor(lo + Math.random() * (hi - lo + 1));
    } else {
      nextBpm = COMMON_MUSICAL_BPMS[Math.floor(Math.random() * COMMON_MUSICAL_BPMS.length)];
    }
  }

  if (target === 'meter') {
    const remainingSigs = TIME_SIGNATURE_POOL.filter((s) => s !== nextTimeSig);
    nextTimeSig = remainingSigs[Math.floor(Math.random() * remainingSigs.length)] || '4/4';
  }

  // Calculate Camelot
  const isMajor = nextScaleName === 'major' || nextScaleName === 'lydian' || nextScaleName === 'mixolydian' || (DSP.SCALES[nextScaleName] && DSP.SCALES[nextScaleName][2] === 4);
  const camelot = isMajor
    ? { C: '8B', G: '9B', D: '10B', A: '11B', E: '12B', B: '1B', 'F#': '2B', 'C#': '3B', 'G#': '4B', 'D#': '5B', 'A#': '6B', F: '7B' }[nextTonic] || '8B'
    : { A: '8A', E: '9A', B: '10A', 'F#': '11A', 'C#': '12A', 'G#': '1A', 'D#': '2A', 'A#': '3A', F: '4A', C: '5A', G: '6A', D: '7A' }[nextTonic] || '8A';

  // Compute Chroma and matching ragas
  const ragaChroma = new Float64Array(12);
  nextDegrees.forEach((d) => {
    ragaChroma[(nextTonicPc + d) % 12] = 1.0;
  });
  const matchingRagas = DSP.findMatchingRagas(ragaChroma, nextTonicPc, 6);
  const activeRaga = matchingRagas.find((r) => r.name.toLowerCase() === nextScaleName.toLowerCase()) || matchingRagas[0] || null;

  // Tala Info
  const talaInfo = DSP.TALA_MAP[nextTimeSig] || null;

  randomizerState = {
    tonic: nextTonic,
    tonicPc: nextTonicPc,
    scaleName: nextScaleName,
    degrees: nextDegrees,
    bpm: nextBpm,
    timeSignature: nextTimeSig,
    tala: talaInfo,
    raga: activeRaga,
    ragas: matchingRagas,
    camelot,
    tuningA4: 440,
    thaat: nextThaat,
    genre: nextGenre
  };

  // Sync metronome settings
  Player.setMetronomeBpm(nextBpm);
  Player.setMetronomeSignature(nextTimeSig);
}

function renderRandomizerTool(entry: any = null) {
  if (!randomizerState) {
    rollRandomIdea('all');
  }

  viewEl.innerHTML = '';
  const section = el('div', 'section randomizer-page');

  // Breadcrumbs
  const breadcrumb = el('div', 'breadcrumbs');
  if (entry) {
    const backProj = el('button', 'breadcrumb__link', `← ${entry.name}`);
    backProj.addEventListener('click', () => {
      projectTool = null;
      render();
    });
    breadcrumb.append(backProj, el('span', 'breadcrumb__sep', '/'), el('span', 'breadcrumb__current', 'Music Randomizer'));
  } else {
    const back = el('button', 'breadcrumb__link', '← All tools');
    back.addEventListener('click', () => {
      navigationHistory.visit(captureLocation());
      view = 'tools';
      render();
    });
    breadcrumb.append(back, el('span', 'breadcrumb__sep', '/'), el('span', 'breadcrumb__current', 'Music Randomizer'));
  }
  section.append(breadcrumb);

  // Hero Card with Randomize Roll Action
  const hero = el('div', 'randomizer-hero');
  const heroHead = el('div', 'section__head');
  const heroTitles = el('div', 'section__head-titles');
  heroTitles.append(el('h3', 'randomizer-hero__title', '🎲 Producer Idea Randomizer & Genre Challenge'));
  heroTitles.append(el('p', 'randomizer-hero__desc', 'Instantly generate fresh musical starting points: key, scale, accompanying Indian Raagas with time-of-day moods, BPM, suggested time signatures, and genre challenges.'));
  heroHead.append(heroTitles);

  const tutBtn = el('button', 'pill pill--sm tool-tour-btn', '❓ Tutorial');
  tutBtn.title = 'Start interactive tutorial for Randomizer';
  tutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startToolWalkthrough('randomizer', true);
  });
  heroHead.append(tutBtn);
  hero.append(heroHead);

  const rollBtn = el('button', 'randomizer-roll-btn');
  rollBtn.append(svgIcon('dice', '', 20));
  rollBtn.append(document.createTextNode('Randomize Idea (Roll)'));
  rollBtn.addEventListener('click', () => {
    rollRandomIdea('all');
    renderRandomizerTool(entry);
    playSynthNote(randomizerState!.tonicPc, 4, 440, 0.4);
  });
  hero.append(rollBtn);

  // Quick Reroll Pill Group
  const rerollGroup = el('div', 'randomizer-reroll-group');

  const traditionSelect = el('select', 'input input--sm randomizer-tradition-select') as HTMLSelectElement;
  traditionSelect.style.width = 'auto';
  traditionSelect.style.cursor = 'pointer';
  traditionSelect.style.padding = '4px 10px';
  traditionSelect.style.fontSize = '12px';
  traditionSelect.style.borderRadius = '20px';
  traditionSelect.title = 'Filter Randomizer scale pool by musical tradition';

  const userTraditions = (settings && settings.scaleTraditions) || ['all'];
  const activeTradVal = userTraditions.includes('all') ? 'all' : (userTraditions.length === 1 ? userTraditions[0] : 'custom');

  const tradOptions: { value: string; label: string }[] = [
    { value: 'all', label: '✨ All World Scales' },
    { value: 'western', label: '🌐 Western Scales Only' },
    { value: 'indian', label: '🇮🇳 Indian Classical Raagas' },
    { value: 'arabic', label: '🇪🇬 Arabic Maqamat' },
    { value: 'chinese', label: '🇨🇳 Chinese Pentatonics' },
    { value: 'mediterranean', label: '🇪🇸 Mediterranean & Flamenco' },
    { value: 'celtic', label: '🇮🇪 Celtic Folk' }
  ];

  tradOptions.forEach((opt) => {
    const optEl = document.createElement('option');
    optEl.value = opt.value;
    optEl.textContent = opt.label;
    if (opt.value === activeTradVal) optEl.selected = true;
    traditionSelect.appendChild(optEl);
  });

  traditionSelect.addEventListener('change', async () => {
    const val = traditionSelect.value;
    const newTrads = val === 'all' ? ['all'] : [val as ScaleTraditionId];
    settings = await window.api.updateSettings({
      scaleTraditions: newTrads
    });
    rollRandomIdea('key');
    renderRandomizerTool(entry);
    toast('Randomizer Pool Updated', `Scale pool set to ${tradOptions.find(o => o.value === val)?.label || val}`);
  });

  rerollGroup.append(traditionSelect);
  
  const rerollGenreBtn = el('button', 'pill pill--sm', '🎧 Reroll Genre');
  rerollGenreBtn.addEventListener('click', () => {
    rollRandomIdea('genre');
    renderRandomizerTool(entry);
  });
  rerollGroup.append(rerollGenreBtn);

  const rerollKeyBtn = el('button', 'pill pill--sm', '🎵 Reroll Key & Scale');
  rerollKeyBtn.addEventListener('click', () => {
    rollRandomIdea('key');
    renderRandomizerTool(entry);
    playSynthNote(randomizerState!.tonicPc, 4, 440, 0.4);
  });
  rerollGroup.append(rerollKeyBtn);

  const rerollBpmBtn = el('button', 'pill pill--sm', '⏱ Reroll BPM');
  rerollBpmBtn.addEventListener('click', () => {
    rollRandomIdea('bpm');
    renderRandomizerTool(entry);
  });
  rerollGroup.append(rerollBpmBtn);

  const rerollMeterBtn = el('button', 'pill pill--sm', '🪘 Reroll Time Signature');
  rerollMeterBtn.addEventListener('click', () => {
    rollRandomIdea('meter');
    renderRandomizerTool(entry);
  });
  rerollGroup.append(rerollMeterBtn);

  hero.append(rerollGroup);
  section.append(hero);

  const state = randomizerState!;
  const resultBox = el('div', 'scale-results-box');

  const currentWorldDef = WORLD_SCALES_DATABASE.find(
    (s) => s.name.toLowerCase() === state.scaleName.toLowerCase() || s.id.toLowerCase() === state.scaleName.toLowerCase()
  );
  const regionObj = currentWorldDef ? WORLD_REGIONS.find((r) => r.id === currentWorldDef.tradition) : null;
  const flagPrefix = regionObj ? `${regionObj.flag} ` : '';
  const subCategoryText = currentWorldDef?.subCategory || state.thaat || (regionObj ? regionObj.name : 'World Scale');

  // Primary Metrics Grid
  const metricsGrid = el('div', 'scale-metrics-grid');

  // 1. Genre Challenge Card
  const genreCard = el('div', 'scale-metric-card randomizer-genre-card');
  genreCard.append(el('div', 'scale-metric__label', 'Genre Challenge'));
  if (state.genre) {
    genreCard.append(el('span', 'randomizer-genre-badge', state.genre.category));
    genreCard.append(el('div', 'scale-metric__val', state.genre.name));
    genreCard.append(el('div', 'scale-metric__sub', `Typical: ${state.genre.typicalBpm[0]}–${state.genre.typicalBpm[1]} BPM`));
    genreCard.append(el('div', 'genre-card__desc', state.genre.description));
  } else {
    genreCard.append(el('div', 'scale-metric__val', 'Open Inspiration'));
  }
  metricsGrid.append(genreCard);

  // 2. BPM Card
  const bpmCard = el('div', 'scale-metric-card');
  bpmCard.append(el('div', 'scale-metric__label', 'Tempo (BPM)'));
  bpmCard.append(el('div', 'scale-metric__val scale-metric__val--bpm', `${state.bpm} BPM`));
  const isMetroOn = Player.isMetronome();
  const metroToggleBtn = el('button', `pill pill--sm ${isMetroOn ? 'pill--solid pill--metro is-on' : ''}`, isMetroOn ? '⏹ Stop Metronome' : '⏱ Start Metronome');
  metroToggleBtn.style.marginTop = '8px';
  metroToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Player.setMetronomeBpm(state.bpm);
    Player.setMetronomeSignature(state.timeSignature);
    Player.setMetronome(!Player.isMetronome());
    renderRandomizerTool(entry);
  });
  bpmCard.append(metroToggleBtn);
  metricsGrid.append(bpmCard);

  // 3. Key & Camelot Card (with interactive audition action and direct DAW MIDI drag)
  const keyCard = el('div', 'scale-metric-card scale-metric-card--actionable');
  keyCard.append(el('div', 'scale-metric__label', 'Key & Scale (Drag to DAW)'));
  const camelotTag = `<span class="scale-camelot-badge">${state.camelot}</span> `;
  const keyHtml = el('div', 'scale-metric__val');
  keyHtml.innerHTML = `${camelotTag}${flagPrefix}${state.tonic} ${state.scaleName}`;
  keyCard.append(keyHtml);
  keyCard.append(el('div', 'scale-metric__sub', `${subCategoryText}${currentWorldDef?.nativeName ? ` · ${currentWorldDef.nativeName}` : ''}`));

  // Generate MIDI bytes for Key & Scale
  const cleanScaleName = state.scaleName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const keyScaleMidiFileName = `Random_${state.tonic}_${cleanScaleName}_${state.bpm}BPM.mid`;
  let keyScaleMidiBytes: Uint8Array;
  if (currentWorldDef && (currentWorldDef.ascendingPhrase || currentWorldDef.degrees)) {
    const asc = currentWorldDef.ascendingPhrase || currentWorldDef.degrees;
    const desc = currentWorldDef.descendingPhrase || [...asc].reverse();
    keyScaleMidiBytes = generateWorldScaleMidi(state.tonicPc, asc, desc, { bpm: state.bpm });
  } else if (state.raga && (state.raga.aarohanaDegrees || state.raga.degrees)) {
    const aaroh = state.raga.aarohanaDegrees || state.raga.degrees;
    const avaroh = state.raga.avarohanaDegrees || [...aaroh].reverse();
    keyScaleMidiBytes = ragaMidi(state.tonicPc, aaroh, avaroh, { bpm: state.bpm });
  } else {
    const notes = notesFor(state.tonicPc, state.degrees, 3);
    keyScaleMidiBytes = scaleMidi(notes, { bpm: state.bpm, bars: 4 });
  }

  // Make the Key Card itself draggable to DAW
  keyCard.draggable = true;
  keyCard.title = `Drag "${state.tonic} ${state.scaleName}" MIDI directly into your DAW, or click to audition`;
  keyCard.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if (window.api.dragMidi) await window.api.dragMidi(keyScaleMidiFileName, Array.from(keyScaleMidiBytes));
  });

  const keyActionsRow = el('div', 'scale-metric-card-actions');
  keyActionsRow.style.display = 'flex';
  keyActionsRow.style.gap = '6px';
  keyActionsRow.style.marginTop = '8px';
  keyActionsRow.style.flexWrap = 'wrap';

  const playKeyBtn = el('button', 'pill pill--sm', '▶ Audition Scale');
  playKeyBtn.title = 'Play full scale notes and tonic tone (Click to stop)';

  const playScaleBtn = el('button', 'pill pill--solid scale-action-btn', '▶ Play Scale');
  playScaleBtn.title = 'Play full scale notes (Click to stop)';

  const playScaleSessionId = 'randomizer-main-scale';
  const resetScaleUi = () => {
    playKeyBtn.textContent = '▶ Audition Scale';
    playKeyBtn.classList.remove('pill--solid');
    playScaleBtn.textContent = '▶ Play Scale';
    playScaleBtn.classList.remove('pill--active');
  };

  const playScaleAction = () => {
    if (isScalePlaying(playScaleSessionId)) {
      stopScalePlayback();
      resetScaleUi();
      return;
    }
    document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
      b.textContent = '▶ Audition';
      b.classList.remove('pill--solid');
    });
    playKeyBtn.textContent = '⏸ Pause Scale';
    playKeyBtn.classList.add('pill--solid');
    playScaleBtn.textContent = '⏸ Pause Scale';
    playScaleBtn.classList.add('pill--active');

    if (currentWorldDef && (currentWorldDef.ascendingPhrase || currentWorldDef.degrees)) {
      const asc = currentWorldDef.ascendingPhrase || currentWorldDef.degrees;
      const desc = currentWorldDef.descendingPhrase || [...asc].reverse();
      playRagaSequence(state.tonicPc, asc, desc, state.tuningA4, playScaleSessionId, resetScaleUi);
    } else if (state.raga && (state.raga.aarohanaDegrees || state.raga.degrees)) {
      const aaroh = state.raga.aarohanaDegrees || state.raga.degrees;
      const avaroh = state.raga.avarohanaDegrees || [...aaroh].reverse();
      playRagaSequence(state.tonicPc, aaroh, avaroh, state.tuningA4, playScaleSessionId, resetScaleUi);
    } else {
      playFullScale(state.tonicPc, state.degrees, state.tuningA4, playScaleSessionId, resetScaleUi);
    }
  };

  playKeyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playScaleAction();
  });
  keyActionsRow.append(playKeyBtn);

  const dragScaleMidiBtn = el('button', 'pill pill--sm scale-midi-btn', '⤓ Drag MIDI to DAW');
  dragScaleMidiBtn.title = 'Drag onto any DAW track (or click to export) Scale MIDI';
  dragScaleMidiBtn.draggable = true;
  dragScaleMidiBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.api.dragMidi) await window.api.dragMidi(keyScaleMidiFileName, Array.from(keyScaleMidiBytes));
  });
  dragScaleMidiBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (window.api.saveMidi) {
      const saved = await window.api.saveMidi(keyScaleMidiFileName, Array.from(keyScaleMidiBytes));
      if (saved) toast('Scale MIDI exported', saved);
    } else {
      const blob = new Blob([keyScaleMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = keyScaleMidiFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast('Scale MIDI exported', keyScaleMidiFileName);
    }
  });
  keyActionsRow.append(dragScaleMidiBtn);

  keyCard.append(keyActionsRow);
  keyCard.addEventListener('click', (e) => {
    // Only toggle playback if clicked on the card background, not child controls
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      playScaleAction();
    }
  });
  metricsGrid.append(keyCard);

  // 4. Time Signature & Tala Card (with interactive rhythm pulse audition action and Metronome Click MIDI drag)
  const meterCard = el('div', 'scale-metric-card scale-metric-card--actionable');
  meterCard.append(el('div', 'scale-metric__label', 'Time Signature & Rhythm (Drag to DAW)'));
  meterCard.append(el('div', 'scale-metric__val', state.timeSignature));
  if (state.tala) {
    const talaDiv = el('div', 'randomizer-tala-detail');
    talaDiv.append(el('div', null, `🪘 ${state.tala.name} (${state.tala.matras} Matras · ${state.tala.vibhag})`));
    if (state.tala.bols) {
      talaDiv.append(el('div', 'randomizer-tala-bols', state.tala.bols));
    }
    meterCard.append(talaDiv);
  } else if (currentWorldDef?.suggestedRhythm) {
    meterCard.append(el('div', 'scale-metric__sub', `🥁 ${currentWorldDef.suggestedRhythm}`));
  } else {
    meterCard.append(el('div', 'scale-metric__sub', 'Standard Meter'));
  }

  // Generate 8-Bar Metronome Click Guide MIDI for this time signature & BPM
  const cleanMeterName = state.timeSignature.replace('/', '_');
  const rhythmGuideFileName = `Metronome_${cleanMeterName}_${state.bpm}BPM_Guide.mid`;
  const rhythmGuideBytes = rhythmGuideMidi(state.bpm, state.timeSignature, { bars: 8 });

  // Make the Time Signature card itself draggable to DAW
  meterCard.draggable = true;
  meterCard.title = `Drag 8-Bar ${state.timeSignature} (${state.bpm} BPM) Metronome Guide MIDI into your DAW, or click to toggle pulse`;
  meterCard.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if (window.api.dragMidi) await window.api.dragMidi(rhythmGuideFileName, Array.from(rhythmGuideBytes));
  });

  const meterActionsRow = el('div', 'scale-metric-card-actions');
  meterActionsRow.style.display = 'flex';
  meterActionsRow.style.gap = '6px';
  meterActionsRow.style.marginTop = '8px';
  meterActionsRow.style.flexWrap = 'wrap';

  const isMeterPlaying = Player.isMetronome();
  const meterPlayBtn = el('button', `pill pill--sm ${isMeterPlaying ? 'pill--solid pill--metro is-on' : ''}`, isMeterPlaying ? '⏹ Stop Rhythm' : `🥁 Play Rhythm (${state.timeSignature})`);
  meterPlayBtn.title = `Audition ${state.timeSignature} meter rhythm pattern in real-time`;
  meterPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Player.setMetronomeBpm(state.bpm);
    Player.setMetronomeSignature(state.timeSignature);
    Player.setMetronome(!Player.isMetronome());
    renderRandomizerTool(entry);
  });
  meterActionsRow.append(meterPlayBtn);

  const dragRhythmBtn = el('button', 'pill pill--sm scale-midi-btn', `⤓ Drag Rhythm MIDI (${state.timeSignature})`);
  dragRhythmBtn.title = `Drag 8-Bar ${state.timeSignature} Click/Metronome MIDI to DAW track to align samples visually`;
  dragRhythmBtn.draggable = true;
  dragRhythmBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.api.dragMidi) await window.api.dragMidi(rhythmGuideFileName, Array.from(rhythmGuideBytes));
  });
  dragRhythmBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (window.api.saveMidi) {
      const saved = await window.api.saveMidi(rhythmGuideFileName, Array.from(rhythmGuideBytes));
      if (saved) toast('Rhythm MIDI exported', saved);
    } else {
      const blob = new Blob([rhythmGuideBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = rhythmGuideFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast('Rhythm MIDI exported', rhythmGuideFileName);
    }
  });
  meterActionsRow.append(dragRhythmBtn);

  meterCard.append(meterActionsRow);
  meterCard.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      Player.setMetronomeBpm(state.bpm);
      Player.setMetronomeSignature(state.timeSignature);
      Player.setMetronome(!Player.isMetronome());
      renderRandomizerTool(entry);
    }
  });
  metricsGrid.append(meterCard);

  // 5. Mood & Expression Card
  const moodCard = el('div', 'scale-metric-card');
  moodCard.append(el('div', 'scale-metric__label', 'Mood & Expression'));
  if (currentWorldDef?.mood || (state.raga && state.raga.mood)) {
    const mText = currentWorldDef?.mood || state.raga?.mood;
    moodCard.append(el('div', 'scale-metric__val', `✨ ${mText}`));
    const tText = currentWorldDef?.timeOfDay || state.raga?.time || 'Universal / Anytime';
    moodCard.append(el('div', 'scale-metric__sub', `🕒 ${tText}`));
  } else {
    moodCard.append(el('div', 'scale-metric__val', 'Expressive & Inspiring'));
    moodCard.append(el('div', 'scale-metric__sub', 'Universal / Anytime'));
  }
  metricsGrid.append(moodCard);

  resultBox.append(metricsGrid);

  // Interactive 2-octave Scale Keyboard & Audition Section
  const kbSection = el('div', 'scale-kb-section');
  kbSection.append(el('h4', 'scale-notes__title', `Interactive Scale Keyboard: ${state.tonic} ${state.scaleName}`));

  const kb = kbLayoutFn(2, 19, 70);
  const highlightedKeys = kbHighlightFn(kb.keys, state.tonicPc, state.degrees);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgKb = document.createElementNS(svgNS, 'svg');
  svgKb.setAttribute('class', 'scale-keyboard');
  svgKb.setAttribute('viewBox', `0 0 ${kb.width} ${kb.height}`);
  svgKb.setAttribute('width', '100%');
  svgKb.setAttribute('height', '76');

  // Render whites first
  highlightedKeys.filter((k) => k.type === 'white').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width - 1));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '3');
    rect.setAttribute('class', `scale-key scale-key--white scale-key--${k.state}`);
    const degInterval = ((k.pc - state.tonicPc) % 12 + 12) % 12;
    const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
    const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
    rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
    rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, state.tuningA4));
    svgKb.appendChild(rect);
  });

  // Render blacks on top
  highlightedKeys.filter((k) => k.type === 'black').forEach((k) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(k.x));
    rect.setAttribute('y', String(k.y));
    rect.setAttribute('width', String(k.width));
    rect.setAttribute('height', String(k.height));
    rect.setAttribute('rx', '3');
    rect.setAttribute('class', `scale-key scale-key--black scale-key--${k.state}`);
    const degInterval = ((k.pc - state.tonicPc) % 12 + 12) % 12;
    const degName = k.degree ? (DEGREE_NAMES[degInterval] || `${k.degree}`) : 'out of scale';
    const sargam = k.degree ? (SARGAM_NAMES[degInterval] || '') : '';
    rect.innerHTML = `<title>${k.name} (${degName}${sargam ? ` · ${sargam}` : ''})</title>`;
    rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, state.tuningA4));
    svgKb.appendChild(rect);
  });

  kbSection.append(svgKb);

  // Scale Action buttons
  const scaleActions = el('div', 'scale-modal-actions');
  
  playScaleBtn.addEventListener('click', () => {
    playScaleAction();
  });
  scaleActions.append(playScaleBtn);

  const droneBtn = el('button', 'pill scale-action-btn', `🔊 Root Drone (${state.tonic})`);
  droneBtn.addEventListener('click', () => playSynthNote(state.tonicPc, 3, state.tuningA4, 2.5));
  scaleActions.append(droneBtn);

  const scaleMidiBtn = el('button', 'pill scale-midi-btn scale-action-btn', '⤓ Drag Scale MIDI to DAW');
  const sMidiNotes = notesFor(state.tonicPc, state.degrees, 3);
  const sMidiBytes = scaleMidi(sMidiNotes, { bpm: state.bpm, bars: 4 });
  const sMidiFileName = `Random_${state.tonic}_${state.scaleName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${state.bpm}BPM.mid`;
  scaleMidiBtn.draggable = true;
  scaleMidiBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if (window.api.dragMidi) await window.api.dragMidi(sMidiFileName, Array.from(sMidiBytes));
  });
  scaleMidiBtn.addEventListener('click', async () => {
    if (window.api.saveMidi) {
      const saved = await window.api.saveMidi(sMidiFileName, Array.from(sMidiBytes));
      if (saved) toast('Scale MIDI exported', saved);
    } else {
      const blob = new Blob([sMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = sMidiFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast('Scale MIDI exported', sMidiFileName);
    }
  });
  scaleActions.append(scaleMidiBtn);

  kbSection.append(scaleActions);
  resultBox.append(kbSection);

  // World Musical Traditions & Scales Explorer in Randomizer
  const ragaChroma = new Float64Array(12);
  state.degrees.forEach((d) => {
    ragaChroma[(state.tonicPc + d) % 12] = 1.0;
  });

  let activeRandTab: ScaleTraditionId = 'all';
  const worldSection = el('div', 'scale-ragas-section scale-world-section');
  
  const worldHeader = el('div', 'scale-world-header');
  worldHeader.append(el('h4', 'scale-notes__title', 'World Musical Traditions & Scale Ideas'));

  const tabsRow = el('div', 'scale-tradition-tabs');
  const tabOptions: { id: ScaleTraditionId; label: string }[] = [
    { id: 'all', label: '✨ All Traditions' },
    { id: 'indian', label: '🇮🇳 Indian Raagas' },
    { id: 'arabic', label: '🇪🇬 Arabic Maqamat' },
    { id: 'chinese', label: '🇨🇳 Chinese & East Asian' },
    { id: 'western', label: '🌐 Western & Jazz' },
    { id: 'mediterranean', label: '🇪🇸 Mediterranean' }
  ];

  const ragasGrid = el('div', 'scale-ragas-grid scale-world-grid');

  function renderRandomizerWorldCards(tabId: ScaleTraditionId) {
    ragasGrid.innerHTML = '';
    const matchedScales = findMatchingWorldScales(ragaChroma, state.tonicPc, tabId, 12);

    matchedScales.forEach((scaleMatch: ScoredWorldScale) => {
      const isCurrent = state.scaleName.toLowerCase() === scaleMatch.name.toLowerCase() || state.scaleName.toLowerCase() === scaleMatch.id.toLowerCase();
      const card = el('div', `raga-card ${isCurrent ? 'raga-card--active' : ''}`);

      const top = el('div', 'raga-card__header');
      const regionMeta = WORLD_REGIONS.find((r) => r.id === scaleMatch.tradition);
      const flagStr = regionMeta ? regionMeta.flag : '🌐';

      top.append(el('span', 'raga-card__name', `${flagStr} ${scaleMatch.name}`));
      top.append(el('span', 'raga-card__pct', `${scaleMatch.matchPercent}% Match`));
      card.append(top);

      const sub = el('div', 'raga-card__thaat', `${scaleMatch.subCategory || scaleMatch.tradition}${scaleMatch.nativeName ? ` · ${scaleMatch.nativeName}` : ''}`);
      card.append(sub);

      if (scaleMatch.phraseNotation) {
        if (scaleMatch.phraseNotation.ascending) {
          const ascRow = el('div', 'raga-card__phrase raga-card__phrase--aaroh');
          ascRow.append(el('span', 'raga-phrase__tag', '▲ Asc:'));
          ascRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.ascending));
          card.append(ascRow);
        }
        if (scaleMatch.phraseNotation.descending) {
          const descRow = el('div', 'raga-card__phrase raga-card__phrase--avaroh');
          descRow.append(el('span', 'raga-phrase__tag', '▼ Desc:'));
          descRow.append(el('span', 'raga-phrase__notes', scaleMatch.phraseNotation.descending));
          card.append(descRow);
        }
      }

      if (scaleMatch.mood || scaleMatch.timeOfDay || scaleMatch.suggestedRhythm) {
        const metaRow = el('div', 'raga-card__meta');
        if (scaleMatch.timeOfDay) metaRow.append(el('span', 'raga-card__time', `🕒 ${scaleMatch.timeOfDay}`));
        if (scaleMatch.mood) metaRow.append(el('span', 'raga-card__mood', `✨ ${scaleMatch.mood}`));
        if (scaleMatch.suggestedRhythm) metaRow.append(el('span', 'raga-card__rhythm', `🥁 ${scaleMatch.suggestedRhythm.split('/')[0]}`));
        card.append(metaRow);
      }

      // Suggested Time Signature button if available
      if (scaleMatch.suggestedRhythm) {
        const matchedSig = TIME_SIGNATURE_POOL.find((ts) => scaleMatch.suggestedRhythm?.includes(ts));
        if (matchedSig && matchedSig !== state.timeSignature) {
          const suggPill = el('button', 'randomizer-raga-sugg-pill');
          suggPill.append(document.createTextNode(`⏱ Suggested: ${matchedSig} (${scaleMatch.suggestedRhythm.split('/')[0].trim()})`));
          suggPill.title = `Click to set time signature to ${matchedSig} and sync metronome`;
          suggPill.addEventListener('click', (e) => {
            e.stopPropagation();
            state.timeSignature = matchedSig;
            state.tala = DSP.TALA_MAP[matchedSig] || null;
            Player.setMetronomeSignature(matchedSig);
            renderRandomizerTool(entry);
            toast('Meter Updated', `Set to ${matchedSig} for ${scaleMatch.name}`);
          });
          card.append(suggPill);
        }
      }

      const actions = el('div', 'raga-card__actions');

      const cardSessionId = `randomizer-world-card-${scaleMatch.id || scaleMatch.name}`;
      const resetPreviewBtn = () => {
        previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
        previewBtn.classList.remove('pill--solid');
      };

      const previewBtn = el('button', 'pill pill--sm raga-btn--preview');
      previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
      previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isScalePlaying(cardSessionId)) {
          stopScalePlayback();
          resetPreviewBtn();
          return;
        }
        document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
          b.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Audition</span>`;
          b.classList.remove('pill--solid');
        });
        resetScaleUi();
        previewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="raga-btn__icon"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
        previewBtn.classList.add('pill--solid');
        const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const desc = scaleMatch.descendingPhrase || [...asc].reverse();
        playRagaSequence(state.tonicPc, asc, desc, state.tuningA4, cardSessionId, resetPreviewBtn);
      });
      actions.append(previewBtn);

      const midiBtn = el('button', 'pill pill--sm pill--solid raga-btn--midi');
      midiBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="raga-btn__icon"><path d="M12 3v13M7 11l5 5 5-5M4 20h16"/></svg><span>Drag to DAW</span>`;
      midiBtn.title = 'Drag onto any DAW track or click to export MIDI';
      const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
      const desc = scaleMatch.descendingPhrase || [...asc].reverse();
      const rMidiBytes = generateWorldScaleMidi(state.tonicPc, asc, desc, { bpm: state.bpm });
      const cleanName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const rMidiFileName = `Random_Scale_${cleanName}_${state.tonic}_${state.bpm}BPM.mid`;

      midiBtn.draggable = true;
      midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
        e.preventDefault();
        if (window.api.dragMidi) await window.api.dragMidi(rMidiFileName, Array.from(rMidiBytes));
      });
      midiBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.api.saveMidi) {
          const saved = await window.api.saveMidi(rMidiFileName, Array.from(rMidiBytes));
          if (saved) toast('Scale MIDI exported', saved);
        } else {
          const blob = new Blob([rMidiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = rMidiFileName;
          a.click();
          URL.revokeObjectURL(url);
          toast('Scale MIDI exported', rMidiFileName);
        }
      });
      actions.append(midiBtn);
      card.append(actions);

      card.title = `Click to load ${scaleMatch.name} into Randomizer`;
      card.addEventListener('click', () => {
        stopScalePlayback();
        state.scaleName = scaleMatch.name;
        state.degrees = scaleMatch.degrees;
        state.thaat = scaleMatch.subCategory || scaleMatch.tradition;
        state.raga = scaleMatch.tradition === 'indian' ? scaleMatch : null;
        if (scaleMatch.suggestedRhythm) {
          const matchSig = TIME_SIGNATURE_POOL.find((ts) => scaleMatch.suggestedRhythm?.includes(ts));
          if (matchSig) {
            state.timeSignature = matchSig;
            state.tala = DSP.TALA_MAP[matchSig] || null;
            Player.setMetronomeSignature(matchSig);
          }
        }
        renderRandomizerTool(entry);
        const ascP = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const descP = scaleMatch.descendingPhrase || [...ascP].reverse();
        playRagaSequence(state.tonicPc, ascP, descP, state.tuningA4);
      });

      ragasGrid.append(card);
    });
  }

  tabOptions.forEach((tab) => {
    const tabBtn = el('button', `scale-tradition-tab ${tab.id === activeRandTab ? 'scale-tradition-tab--active' : ''}`, tab.label);
    tabBtn.addEventListener('click', () => {
      activeRandTab = tab.id;
      tabsRow.querySelectorAll('.scale-tradition-tab').forEach((b: any) => b.classList.remove('scale-tradition-tab--active'));
      tabBtn.classList.add('scale-tradition-tab--active');
      renderRandomizerWorldCards(tab.id);
    });
    tabsRow.append(tabBtn);
  });

  worldHeader.append(tabsRow);
  worldSection.append(worldHeader);
  renderRandomizerWorldCards(activeRandTab);
  worldSection.append(ragasGrid);
  resultBox.append(worldSection);

  // YouTube Challenge & Reference Explorer (Opens predefined queries directly in default web browser)
  const ytSection = el('div', 'randomizer-yt-section');
  
  const ytHead = el('div', 'randomizer-yt-head');
  const ytTitleRow = el('div', 'randomizer-yt-title-row');
  ytTitleRow.append(svgIcon('youtube', 'randomizer-yt-icon', 22));
  ytTitleRow.append(el('h4', 'randomizer-yt-title', 'YouTube Inspiration & Reference Explorer'));
  ytHead.append(ytTitleRow);
  ytHead.append(
    el(
      'p',
      'randomizer-yt-desc',
      'Instant search queries pre-crafted for your default web browser to explore reference tracks, live DJ sets, and raaga song references. (Zero internet traffic inside DAW Buddy).'
    )
  );
  ytSection.append(ytHead);

  const genreName = state.genre ? state.genre.name : 'Electronic';
  const isRaga = Boolean(state.raga);
  const ragaOrScale = state.raga ? state.raga.name : state.scaleName;

  const ytCardsGrid = el('div', 'randomizer-yt-grid');

  const openInBrowser = async (query: string) => {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (window.api && window.api.openExternal) {
      await window.api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  // 1. Reference Tracks
  const q1 = `${genreName} music playlist top tracks`;
  const ytCard1 = el('div', 'randomizer-yt-card');
  ytCard1.append(el('div', 'randomizer-yt-card__tag', '🎧 Reference Tracks'));
  ytCard1.append(el('div', 'randomizer-yt-card__query', `"${genreName}" Top Playlists`));
  ytCard1.append(el('div', 'randomizer-yt-card__desc', 'Audition top releases, arrangement structure, and mix references.'));
  const btn1 = el('button', 'pill pill--sm pill--yt', 'Open in Browser ↗');
  btn1.addEventListener('click', () => openInBrowser(q1));
  ytCard1.append(btn1);
  ytCardsGrid.append(ytCard1);

  // 2. Live Sets & Boiler Room
  const q2 = `${genreName} live set boiler room mix`;
  const ytCard2 = el('div', 'randomizer-yt-card');
  ytCard2.append(el('div', 'randomizer-yt-card__tag', '🔥 Live Vibe & DJ Sets'));
  ytCard2.append(el('div', 'randomizer-yt-card__query', `"${genreName}" Live Sets`));
  ytCard2.append(el('div', 'randomizer-yt-card__desc', 'Experience club sound systems, crowd pacing, and transition energy.'));
  const btn2 = el('button', 'pill pill--sm pill--yt', 'Open in Browser ↗');
  btn2.addEventListener('click', () => openInBrowser(q2));
  ytCard2.append(btn2);
  ytCardsGrid.append(ytCard2);

  // 3. Raaga / Scale Song Reference (feasible raaga song query)
  const q3 = isRaga
    ? `raaga ${state.raga.name} songs`
    : `${state.tonic} ${state.scaleName} songs popular melody`;
  const ytCard3 = el('div', 'randomizer-yt-card');
  ytCard3.append(el('div', 'randomizer-yt-card__tag', isRaga ? '🪘 Raaga Songs & Melodies' : '🎼 Scale Song References'));
  ytCard3.append(
    el(
      'div',
      'randomizer-yt-card__query',
      isRaga ? `Raaga ${state.raga.name} Songs` : `${state.tonic} ${state.scaleName} Songs`
    )
  );
  ytCard3.append(
    el(
      'div',
      'randomizer-yt-card__desc',
      isRaga
        ? `Audition classic compositions, film melodies, and iconic songs based on ${state.raga.name}.`
        : `Audition popular songs and melodies written in ${state.tonic} ${state.scaleName}.`
    )
  );
  const btn3 = el('button', 'pill pill--sm pill--yt', 'Open in Browser ↗');
  btn3.addEventListener('click', () => openInBrowser(q3));
  ytCard3.append(btn3);
  ytCardsGrid.append(ytCard3);

  // 4. Production Masterclass
  const q4 = `how to make ${genreName} in FL Studio Ableton ${state.bpm} bpm tutorial`;
  const ytCard4 = el('div', 'randomizer-yt-card');
  ytCard4.append(el('div', 'randomizer-yt-card__tag', '🎹 Production Masterclass'));
  ytCard4.append(el('div', 'randomizer-yt-card__query', `How to Produce ${genreName} (${state.bpm} BPM)`));
  ytCard4.append(el('div', 'randomizer-yt-card__desc', 'Explore sound design, drum patterns, and mixing techniques.'));
  const btn4 = el('button', 'pill pill--sm pill--yt', 'Open in Browser ↗');
  btn4.addEventListener('click', () => openInBrowser(q4));
  ytCard4.append(btn4);
  ytCardsGrid.append(ytCard4);

  ytSection.append(ytCardsGrid);

  // Custom Search Query Bar
  const customSearchRow = el('div', 'randomizer-yt-custom-row');
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'randomizer-yt-input';
  customInput.value = isRaga ? `Raaga ${state.raga.name} songs` : `${genreName} ${state.tonic} ${state.scaleName} ${state.bpm} bpm`;
  customSearchRow.append(customInput);

  const customSearchBtn = el('button', 'pill pill--solid pill--yt-main', '🔍 Search YouTube in Browser');
  customSearchBtn.addEventListener('click', () => {
    const term = customInput.value.trim();
    if (term) openInBrowser(term);
  });
  customSearchRow.append(customSearchBtn);
  ytSection.append(customSearchRow);

  resultBox.append(ytSection);

  section.append(resultBox);
  viewEl.append(section);
  setTimeout(() => startToolWalkthrough('randomizer', false), 150);
}

/* ======================= Slowed + Reverb Studio ======================= */

let slowedReverbState: {
  file: { name: string; size: number; path?: string; rawBuffer?: ArrayBuffer } | null;
  sourceBuffer: AudioBuffer | null;
  renderedBuffer: AudioBuffer | null;
  renderedAtSampleRate: number;
  renderedAtRate: number;
  renderedAtMix: number;
  options: SlowedReverbOptions;
  isProcessing: boolean;
  statusText: string;
  statusType: 'info' | 'success' | 'error';
  player: SlowedReverbWaveformPlayer | null;
} = {
  file: null,
  sourceBuffer: null,
  renderedBuffer: null,
  renderedAtSampleRate: 44100,
  renderedAtRate: 0.87,
  renderedAtMix: 0.35,
  options: { ...DEFAULT_SLOWED_REVERB_OPTIONS },
  isProcessing: false,
  statusText: '',
  statusType: 'info',
  player: null
};

function buildSlowedReverbInterface(container: HTMLElement, isModal = false, onCloseModal?: () => void) {
  container.innerHTML = '';
  const root = el('div', 'slowed-reverb-container');

  // Status & notifications
  const statusBox = el('div', 'sr-status-box sr-status-box--info') as HTMLElement;
  statusBox.style.display = 'none';

  function updateStatus(text?: string, type?: 'info' | 'success' | 'error') {
    if (text) {
      slowedReverbState.statusText = text;
      if (type) slowedReverbState.statusType = type;
    }
    if (!slowedReverbState.statusText) {
      statusBox.style.display = 'none';
      return;
    }
    statusBox.style.display = 'block';
    statusBox.className = `sr-status-box sr-status-box--${slowedReverbState.statusType}`;
    statusBox.textContent = slowedReverbState.statusText;
  }

  // Dropzone
  const dropzone = el('div', 'sr-dropzone');
  dropzone.append(el('div', 'sr-dropzone__icon', '📂'));
  dropzone.append(el('div', 'sr-dropzone__title', 'Drop Audio File (WAV, MP3, FLAC, M4A, OGG) or Click to Browse'));
  dropzone.append(el('div', 'sr-dropzone__sub', 'Drag & drop an audio file from your DAW or computer'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.ogg,.aif,.aiff';
  fileInput.style.display = 'none';
  dropzone.append(fileInput);

  dropzone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
  });

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('sr-dropzone--over');
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('sr-dropzone--over');
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('sr-dropzone--over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await loadAudioFile(files[0]);
    }
  };

  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      await loadAudioFile(fileInput.files[0]);
    }
  });

  // Active File Info Box
  const fileInfoBox = el('div', 'sr-file-loaded-box') as HTMLElement;
  fileInfoBox.style.display = 'none';

  async function loadAudioFile(fileOrBlob: File | { name: string; size: number; path?: string; arrayBuffer: () => Promise<ArrayBuffer> }) {
    updateStatus('⏳ Reading and decoding audio file...', 'info');
    processBtn.disabled = true;

    try {
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

      slowedReverbState.file = {
        name: fileOrBlob.name,
        size: fileOrBlob.size,
        path: (fileOrBlob as any).path,
        rawBuffer: arrayBuffer
      };
      slowedReverbState.sourceBuffer = decodedBuffer;
      slowedReverbState.renderedBuffer = null;

      // Update file info display
      fileInfoBox.innerHTML = '';
      const infoLeft = el('div', 'sr-file-info');
      infoLeft.append(el('div', 'sr-file-name', `🎵 ${fileOrBlob.name}`));
      infoLeft.append(
        el(
          'div',
          'sr-file-meta',
          `${formatSrDuration(decodedBuffer.duration)} · ${decodedBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono'} · ${decodedBuffer.sampleRate} Hz · ${formatSrBytes(fileOrBlob.size)}`
        )
      );

      const changeBtn = el('button', 'pill pill--sm', 'Change File');
      changeBtn.addEventListener('click', () => fileInput.click());

      fileInfoBox.append(infoLeft, changeBtn);
      fileInfoBox.style.display = 'flex';
      dropzone.style.display = 'none';
      if (currentAudioBanner) currentAudioBanner.style.display = 'none';

      processBtn.disabled = false;
      updateStatus(`Loaded "${fileOrBlob.name}" — Click "Process Track" to render`, 'info');
    } catch (err: any) {
      updateStatus(`❌ Could not decode audio: ${err.message || err}`, 'error');
      processBtn.disabled = true;
    }
  }

  // Pre-fill active player track if available
  let currentAudioBanner: HTMLElement | null = null;
  const currentTrack = Player.getCurrent();
  const existingDecoded = Player.getDecoded();
  const trackName = currentTrack?.name || (currentTrack?.path ? basename(currentTrack.path) : (openProject ? openProject.name : null));

  if ((currentTrack || existingDecoded) && !slowedReverbState.sourceBuffer) {
    const banner = el('div', 'sr-current-audio-banner') as HTMLElement;
    const bannerLeft = el('div', 'sr-current-audio-info');
    const isPlaying = Player.isPlaying();
    bannerLeft.append(
      el('div', 'sr-current-audio-badge', isPlaying ? '▶ Playing in Player' : '🎧 Loaded in Player')
    );
    bannerLeft.append(
      el('div', 'sr-current-audio-name', `Use "${trackName || 'Current Audio'}"?`)
    );

    const useBtn = el('button', 'pill pill--solid sr-use-current-btn', '⚡ Use This Audio') as HTMLButtonElement;
    useBtn.type = 'button';
    useBtn.title = `Load "${trackName || 'Current Audio'}" into Slowed + Reverb Studio`;

    useBtn.addEventListener('click', async (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        updateStatus(`⏳ Loading "${trackName || 'Current Audio'}"...`, 'info');
        // Priority 1: If audio buffer is already decoded in memory, use it immediately!
        const buf = Player.getDecoded();
        if (buf) {
          slowedReverbState.file = {
            name: trackName || 'CurrentAudio.wav',
            size: Math.round(buf.duration * buf.sampleRate * buf.numberOfChannels * 2),
            path: currentTrack?.path
          };
          slowedReverbState.sourceBuffer = buf;
          slowedReverbState.renderedBuffer = null;

          fileInfoBox.innerHTML = '';
          const infoLeft = el('div', 'sr-file-info');
          infoLeft.append(el('div', 'sr-file-name', `🎵 ${slowedReverbState.file.name}`));
          infoLeft.append(
            el(
              'div',
              'sr-file-meta',
              `${formatSrDuration(buf.duration)} · ${buf.numberOfChannels === 2 ? 'Stereo' : 'Mono'} · ${buf.sampleRate} Hz`
            )
          );
          const changeBtn = el('button', 'pill pill--sm', 'Change File');
          changeBtn.addEventListener('click', () => {
            fileInput.click();
          });
          fileInfoBox.append(infoLeft, changeBtn);
          fileInfoBox.style.display = 'flex';
          dropzone.style.display = 'none';
          banner.style.display = 'none';
          processBtn.disabled = false;
          updateStatus(`Loaded "${slowedReverbState.file.name}" — Click "Process Track" to render`, 'info');
          return;
        }

        // Priority 2: If path is available, read directly via window.api.readMedia
        if (currentTrack?.path && window.api && window.api.readMedia) {
          const rawBytes = await window.api.readMedia(currentTrack.path);
          if (rawBytes) {
            const blob = new Blob([rawBytes], { type: 'audio/wav' });
            const fileObj = new File([blob], trackName || 'CurrentAudio.wav', { type: 'audio/wav' });
            await loadAudioFile(fileObj);
            banner.style.display = 'none';
            return;
          }
        }

        // Priority 3: Fetch blob from src
        if (currentTrack?.src) {
          const response = await fetch(currentTrack.src);
          const blob = await response.blob();
          const fileObj = new File([blob], trackName || 'CurrentAudio.wav', { type: blob.type || 'audio/wav' });
          await loadAudioFile(fileObj);
          banner.style.display = 'none';
          return;
        }

        updateStatus('Could not read audio from player. Please drop the file manually.', 'error');
      } catch (err: any) {
        updateStatus(`Failed to load audio: ${err.message || err}`, 'error');
      }
    });

    banner.append(bannerLeft, useBtn);
    currentAudioBanner = banner;
  }

  // Controls Grid
  const controlsGrid = el('div', 'sr-controls-grid');

  // 1. Speed & Pitch Card
  const speedCard = el('div', 'sr-card');
  const speedHeader = el('div', 'sr-card__header');
  const speedTitle = el('div', 'sr-card__title', 'Speed / Pitch Rate');
  const speedVal = el('div', 'sr-card__val', slowedReverbState.options.isSemitones ? `${slowedReverbState.options.semitones} st` : `${slowedReverbState.options.speedPercent}%`);
  speedHeader.append(speedTitle, speedVal);

  const modeSwitchRow = el('div', 'sr-switch-wrap');
  const modePctBtn = el('button', `sr-seg-btn ${!slowedReverbState.options.isSemitones ? 'is-active' : ''}`, 'Speed (%)');
  const modeSemiBtn = el('button', `sr-seg-btn ${slowedReverbState.options.isSemitones ? 'is-active' : ''}`, 'Slow by Pitch (st)');
  modeSwitchRow.append(modePctBtn, modeSemiBtn);

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'sr-slider';

  function updateSpeedSliderBounds() {
    if (slowedReverbState.options.isSemitones) {
      speedSlider.min = '-12';
      speedSlider.max = '0';
      speedSlider.step = '1';
      speedSlider.value = String(slowedReverbState.options.semitones);
      speedVal.textContent = `${slowedReverbState.options.semitones} st`;
    } else {
      speedSlider.min = '50';
      speedSlider.max = '100';
      speedSlider.step = '1';
      speedSlider.value = String(slowedReverbState.options.speedPercent);
      speedVal.textContent = `${slowedReverbState.options.speedPercent}%`;
    }
  }
  updateSpeedSliderBounds();

  modePctBtn.addEventListener('click', () => {
    if (!slowedReverbState.options.isSemitones) return;
    slowedReverbState.options.isSemitones = false;
    slowedReverbState.options.speedPercent = Math.round(semitonesToPercent(slowedReverbState.options.semitones));
    modePctBtn.classList.add('is-active');
    modeSemiBtn.classList.remove('is-active');
    updateSpeedSliderBounds();
  });

  modeSemiBtn.addEventListener('click', () => {
    if (slowedReverbState.options.isSemitones) return;
    slowedReverbState.options.isSemitones = true;
    slowedReverbState.options.semitones = Math.round(percentToSemitones(slowedReverbState.options.speedPercent));
    modeSemiBtn.classList.add('is-active');
    modePctBtn.classList.remove('is-active');
    updateSpeedSliderBounds();
  });

  speedSlider.addEventListener('input', () => {
    const val = Number(speedSlider.value);
    if (slowedReverbState.options.isSemitones) {
      slowedReverbState.options.semitones = val;
      speedVal.textContent = `${val} st`;
    } else {
      slowedReverbState.options.speedPercent = val;
      speedVal.textContent = `${val}%`;
    }
  });

  speedCard.append(speedHeader, modeSwitchRow, speedSlider);

  // 2. Reverb Mix Card
  const reverbCard = el('div', 'sr-card');
  const reverbHeader = el('div', 'sr-card__header');
  reverbHeader.append(el('div', 'sr-card__title', 'Reverb Mix (Wet / Dry)'));
  const reverbVal = el('div', 'sr-card__val', `${slowedReverbState.options.reverbMix}%`);
  reverbHeader.append(reverbVal);

  const reverbSlider = document.createElement('input');
  reverbSlider.type = 'range';
  reverbSlider.className = 'sr-slider';
  reverbSlider.min = '0';
  reverbSlider.max = '100';
  reverbSlider.step = '1';
  reverbSlider.value = String(slowedReverbState.options.reverbMix);

  reverbSlider.addEventListener('input', () => {
    const val = Number(reverbSlider.value);
    slowedReverbState.options.reverbMix = val;
    reverbVal.textContent = `${val}%`;
  });

  reverbCard.append(reverbHeader, reverbSlider);

  // 3. Audio Quality & Format Settings Card
  const qualityCard = el('div', 'sr-card');
  qualityCard.append(el('div', 'sr-card__title', 'Audio Quality & Export Formats'));

  // Sample Rate
  const srLabel = el('div', 'sr-file-meta', 'Sample Rate:');
  const srRow = el('div', 'sr-segmented-row');
  const sr44Btn = el('button', `sr-seg-btn ${slowedReverbState.options.sampleRate === 44100 ? 'is-active' : ''}`, '44.1 kHz (Default)');
  const sr48Btn = el('button', `sr-seg-btn ${slowedReverbState.options.sampleRate === 48000 ? 'is-active' : ''}`, '48.0 kHz');
  sr44Btn.addEventListener('click', () => {
    slowedReverbState.options.sampleRate = 44100;
    sr44Btn.classList.add('is-active');
    sr48Btn.classList.remove('is-active');
    updateSaveBtnLabels();
  });
  sr48Btn.addEventListener('click', () => {
    slowedReverbState.options.sampleRate = 48000;
    sr48Btn.classList.add('is-active');
    sr44Btn.classList.remove('is-active');
    updateSaveBtnLabels();
  });
  srRow.append(sr44Btn, sr48Btn);

  // WAV Bit Depth
  const bitLabel = el('div', 'sr-file-meta', 'WAV Bit Depth:');
  const bitRow = el('div', 'sr-segmented-row');
  const bit16Btn = el('button', `sr-seg-btn ${slowedReverbState.options.wavBitDepth === 16 ? 'is-active' : ''}`, '16-bit (Default)');
  const bit24Btn = el('button', `sr-seg-btn ${slowedReverbState.options.wavBitDepth === 24 ? 'is-active' : ''}`, '24-bit PCM');
  const bit32Btn = el('button', `sr-seg-btn ${slowedReverbState.options.wavBitDepth === 32 ? 'is-active' : ''}`, '32-bit Float');

  bit16Btn.addEventListener('click', () => {
    slowedReverbState.options.wavBitDepth = 16;
    bit16Btn.classList.add('is-active');
    bit24Btn.classList.remove('is-active');
    bit32Btn.classList.remove('is-active');
    updateSaveBtnLabels();
  });
  bit24Btn.addEventListener('click', () => {
    slowedReverbState.options.wavBitDepth = 24;
    bit24Btn.classList.add('is-active');
    bit16Btn.classList.remove('is-active');
    bit32Btn.classList.remove('is-active');
    updateSaveBtnLabels();
  });
  bit32Btn.addEventListener('click', () => {
    slowedReverbState.options.wavBitDepth = 32;
    bit32Btn.classList.add('is-active');
    bit16Btn.classList.remove('is-active');
    bit24Btn.classList.remove('is-active');
    updateSaveBtnLabels();
  });
  bitRow.append(bit16Btn, bit24Btn, bit32Btn);

  // MP3 Bitrate
  const mp3LabelRow = el('div', 'sr-card__header');
  mp3LabelRow.append(el('div', 'sr-file-meta', 'MP3 Bitrate:'));
  const mp3ValDisplay = el('div', 'sr-card__val', `${slowedReverbState.options.mp3Bitrate} kbps`);
  mp3LabelRow.append(mp3ValDisplay);

  const mp3Slider = document.createElement('input');
  mp3Slider.type = 'range';
  mp3Slider.className = 'sr-slider';
  mp3Slider.min = '0';
  mp3Slider.max = '4';
  mp3Slider.step = '1';

  const bitrates = [128, 160, 192, 256, 320];
  const currentIdx = bitrates.indexOf(slowedReverbState.options.mp3Bitrate);
  mp3Slider.value = String(currentIdx !== -1 ? currentIdx : 2);

  mp3Slider.addEventListener('input', () => {
    const kbps = bitrates[Number(mp3Slider.value)] || 192;
    slowedReverbState.options.mp3Bitrate = kbps;
    mp3ValDisplay.textContent = `${kbps} kbps`;
    updateSaveBtnLabels();
  });

  qualityCard.append(srLabel, srRow, bitLabel, bitRow, mp3LabelRow, mp3Slider);

  controlsGrid.append(speedCard, reverbCard, qualityCard);

  // Process Action Button
  const processBtn = el('button', 'sr-btn-process', '🚀 Process Slowed + Reverb Track') as HTMLButtonElement;
  processBtn.type = 'button';
  processBtn.disabled = !slowedReverbState.sourceBuffer;

  // Waveform Box & Player
  const waveformBox = el('div', 'sr-waveform-box') as HTMLElement;
  waveformBox.style.display = 'none';

  const canvas = document.createElement('canvas');
  canvas.className = 'sr-waveform-canvas';
  canvas.width = 640;
  canvas.height = 90;

  const transportRow = el('div', 'sr-transport-row');
  const transportLeft = el('div', 'sr-transport-left');

  const playBtn = el('button', 'sr-play-btn', '▶ Play') as HTMLButtonElement;
  const timeDisplay = el('div', 'sr-time-display', '0:00 / 0:00');
  transportLeft.append(playBtn, timeDisplay);

  const seekHint = el('div', 'sr-seek-hint', 'Click waveform to seek');
  transportRow.append(transportLeft, seekHint);

  waveformBox.append(canvas, transportRow);

  // Waveform player controller
  const waveformPlayer = new SlowedReverbWaveformPlayer(
    canvas,
    (cur, total) => {
      timeDisplay.textContent = `${formatSrDuration(cur)} / ${formatSrDuration(total)}`;
      playBtn.innerHTML = waveformPlayer.getIsPlaying() ? '⏸ Pause' : '▶ Play';
    },
    () => {
      // Pause main DAW Buddy player if it is currently playing
      if (Player.isPlaying()) {
        Player.toggle();
      }
    }
  );
  slowedReverbState.player = waveformPlayer;

  // If the user starts playing a track on the main player, pause slowed-reverb playback
  Player.onChange(({ playing }: any) => {
    if (playing && waveformPlayer.getIsPlaying()) {
      waveformPlayer.pause();
      playBtn.innerHTML = '▶ Play';
    }
  });

  playBtn.addEventListener('click', () => {
    waveformPlayer.togglePlay();
    playBtn.innerHTML = waveformPlayer.getIsPlaying() ? '⏸ Pause' : '▶ Play';
  });

  // Export Buttons Row
  const exportRow = el('div', 'sr-export-row') as HTMLElement;
  exportRow.style.display = 'none';

  const saveWavBtn = el('button', 'sr-save-btn sr-save-btn--wav') as HTMLButtonElement;
  const saveMp3Btn = el('button', 'sr-save-btn sr-save-btn--mp3') as HTMLButtonElement;

  function updateSaveBtnLabels() {
    saveWavBtn.innerHTML = `💾 Save WAV (${slowedReverbState.options.wavBitDepth}-bit · ${slowedReverbState.options.sampleRate / 1000}kHz)`;
    saveMp3Btn.innerHTML = `🎵 Save MP3 (${slowedReverbState.options.mp3Bitrate}kbps · ${slowedReverbState.options.sampleRate / 1000}kHz)`;
  }
  updateSaveBtnLabels();

  exportRow.append(saveWavBtn, saveMp3Btn);

  // Check if re-render is needed
  function needsReRender(targetSampleRate: number): boolean {
    if (!slowedReverbState.renderedBuffer) return true;
    const currentRate = getPlaybackRate(
      slowedReverbState.options.isSemitones,
      slowedReverbState.options.isSemitones ? slowedReverbState.options.semitones : slowedReverbState.options.speedPercent
    );
    const currentMix = slowedReverbState.options.reverbMix / 100;
    if (slowedReverbState.renderedAtSampleRate !== targetSampleRate) return true;
    if (Math.abs(slowedReverbState.renderedAtRate - currentRate) > 0.0001) return true;
    if (Math.abs(slowedReverbState.renderedAtMix - currentMix) > 0.0001) return true;
    return false;
  }

  // Core Processing Routine
  async function runProcess(targetSampleRate?: number): Promise<AudioBuffer | null> {
    if (!slowedReverbState.sourceBuffer) {
      toast('No Audio File', 'Please load an audio file first', true);
      return null;
    }

    const sr = targetSampleRate || slowedReverbState.options.sampleRate;
    const playbackRate = getPlaybackRate(
      slowedReverbState.options.isSemitones,
      slowedReverbState.options.isSemitones ? slowedReverbState.options.semitones : slowedReverbState.options.speedPercent
    );
    const reverbPercent = slowedReverbState.options.reverbMix / 100;

    processBtn.disabled = true;
    processBtn.innerHTML = '⚙️ Rendering Offline Audio...';
    updateStatus(`⚙️ Rendering Slowed + Reverb (${(playbackRate * 100).toFixed(0)}% speed · ${sr} Hz)...`, 'info');

    try {
      const rendered = await renderSlowedReverbAudio(slowedReverbState.sourceBuffer, {
        playbackRate,
        reverbPercent,
        sampleRate: sr
      });

      slowedReverbState.renderedBuffer = rendered;
      slowedReverbState.renderedAtSampleRate = sr;
      slowedReverbState.renderedAtRate = playbackRate;
      slowedReverbState.renderedAtMix = reverbPercent;

      updateStatus(`✅ Render Complete! (${formatSrDuration(rendered.duration)} · ${sr} Hz · Ready to save)`, 'success');
      processBtn.disabled = false;
      processBtn.innerHTML = '🚀 Re-Process Track';

      waveformPlayer.loadBuffer(rendered);
      waveformBox.style.display = 'flex';
      exportRow.style.display = 'flex';

      return rendered;
    } catch (err: any) {
      updateStatus(`❌ Rendering failed: ${err.message || err}`, 'error');
      processBtn.disabled = false;
      processBtn.innerHTML = '🚀 Process Slowed + Reverb Track';
      return null;
    }
  }

  processBtn.addEventListener('click', () => runProcess());

  // Save Handlers
  saveWavBtn.addEventListener('click', async () => {
    if (!slowedReverbState.sourceBuffer) return;
    saveWavBtn.disabled = true;

    try {
      let buf = slowedReverbState.renderedBuffer;
      if (needsReRender(slowedReverbState.options.sampleRate)) {
        buf = await runProcess(slowedReverbState.options.sampleRate);
        if (!buf) {
          saveWavBtn.disabled = false;
          return;
        }
      }

      const bitDepth = slowedReverbState.options.wavBitDepth;
      updateStatus(`📦 Encoding ${bitDepth}-bit WAV at ${slowedReverbState.options.sampleRate} Hz...`, 'info');

      const wavBytes = encodeWavBuffer(buf!, bitDepth);
      const baseName = (slowedReverbState.file?.name || 'track').replace(/\.[^/.]+$/, '');
      const defaultName = `${baseName}_slowed_reverb_${bitDepth}bit.wav`;

      if (window.api && window.api.saveAudio) {
        const savedPath = await window.api.saveAudio(defaultName, wavBytes, 'wav');
        if (savedPath) {
          toast('WAV Exported', `Saved to ${basename(savedPath)}`);
          updateStatus(`✅ Saved WAV to: ${savedPath}`, 'success');
        } else {
          updateStatus('Export cancelled', 'info');
        }
      } else {
        const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
        toast('WAV Saved', defaultName);
        updateStatus(`✅ Downloaded ${defaultName}`, 'success');
      }
    } catch (err: any) {
      updateStatus(`❌ WAV save error: ${err.message || err}`, 'error');
    } finally {
      saveWavBtn.disabled = false;
    }
  });

  saveMp3Btn.addEventListener('click', async () => {
    if (!slowedReverbState.sourceBuffer) return;
    saveMp3Btn.disabled = true;

    try {
      let buf = slowedReverbState.renderedBuffer;
      if (needsReRender(slowedReverbState.options.sampleRate)) {
        buf = await runProcess(slowedReverbState.options.sampleRate);
        if (!buf) {
          saveMp3Btn.disabled = false;
          return;
        }
      }

      const bitrate = slowedReverbState.options.mp3Bitrate;
      updateStatus(`📦 Encoding ${bitrate}kbps MP3 at ${slowedReverbState.options.sampleRate} Hz...`, 'info');

      const mp3Bytes = await encodeMp3Buffer(buf!, bitrate);
      const baseName = (slowedReverbState.file?.name || 'track').replace(/\.[^/.]+$/, '');
      const defaultName = `${baseName}_slowed_reverb_${bitrate}k.mp3`;

      if (window.api && window.api.saveAudio) {
        const savedPath = await window.api.saveAudio(defaultName, mp3Bytes, 'mp3');
        if (savedPath) {
          toast('MP3 Exported', `Saved to ${basename(savedPath)}`);
          updateStatus(`✅ Saved MP3 to: ${savedPath}`, 'success');
        } else {
          updateStatus('Export cancelled', 'info');
        }
      } else {
        const blob = new Blob([mp3Bytes.buffer as ArrayBuffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
        toast('MP3 Saved', defaultName);
        updateStatus(`✅ Downloaded ${defaultName}`, 'success');
      }
    } catch (err: any) {
      updateStatus(`❌ MP3 save error: ${err.message || err}`, 'error');
    } finally {
      saveMp3Btn.disabled = false;
    }
  });

  // Restore if buffer already present
  if (slowedReverbState.file && slowedReverbState.sourceBuffer) {
    fileInfoBox.style.display = 'flex';
    dropzone.style.display = 'none';
    processBtn.disabled = false;
    if (slowedReverbState.renderedBuffer) {
      waveformPlayer.loadBuffer(slowedReverbState.renderedBuffer);
      waveformBox.style.display = 'flex';
      exportRow.style.display = 'flex';
    }
  }

  root.append(statusBox);
  if (currentAudioBanner) root.append(currentAudioBanner);
  root.append(dropzone, fileInfoBox, controlsGrid, processBtn, waveformBox, exportRow);
  container.append(root);
}

function renderSlowedReverbTool() {
  viewEl.innerHTML = '';
  const section = el('div', 'section');
  section.append(
    headRow(
      'Slowed + Reverb Studio',
      'Slow down any audio track by speed or pitch and immerse it in lush algorithmic stereo reverb.',
      'slowed-reverb'
    )
  );

  buildSlowedReverbInterface(section, false);
  viewEl.append(section);
}

function openSlowedReverbModal() {
  const existingOverlay = document.getElementById('slowedReverbModalOverlay');
  if (existingOverlay) existingOverlay.remove();

  const overlay = el('div', 'slowed-reverb-modal-overlay');
  overlay.id = 'slowedReverbModalOverlay';

  const modal = el('div', 'slowed-reverb-modal');

  const header = el('div', 'slowed-reverb-modal__header');
  const titles = el('div', 'slowed-reverb-modal__titles');
  titles.append(el('h3', 'slowed-reverb-modal__title', '✨ Slowed + Reverb Studio'));
  titles.append(el('div', 'slowed-reverb-modal__sub', 'Algorithmic resampled slow-down with lush Freeverb'));

  const closeBtn = el('button', 'pill pill--sm', '✕ Close');
  header.append(titles, closeBtn);

  modal.append(header);

  const closeModal = () => {
    if (slowedReverbState.player) {
      slowedReverbState.player.stop();
    }
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKeyDown);

  buildSlowedReverbInterface(modal, true, closeModal);
  overlay.append(modal);
  document.body.append(overlay);
}

// Global listener for verb button popup invocation
window.addEventListener('open-slowed-reverb-modal', () => {
  openSlowedReverbModal();
});

function renderStandaloneTools() {
  viewEl.innerHTML = '';

  const section = el('div', 'section');
  section.append(headRow('Tools', 'All the utility jobs live here, so the sidebar stays calm and the tools are easier to find when you actually need them.', 'tools'));

  const grid = el('div', 'tool-grid');
  [
    {
      view: 'slowed-reverb',
      icon: 'activity',
      title: 'Slowed + Reverb Studio',
      text: 'Slow down tracks by speed or pitch and immerse them in lush algorithmic stereo reverb.'
    },
    {
      view: 'randomizer',
      icon: 'dice',
      title: 'Producer Randomizer & Genre Challenge',
      text: 'Generate random musical ideas: key, scale, matching Indian Raagas, BPM, Tala meter, and 48+ genre challenges.'
    },
    {
      view: 'scale-tool',
      icon: 'music',
      title: 'Scale & Raaga Detector',
      text: 'Drop any audio sample or MIDI file to instantly guess BPM, musical key, scale, tuning, and Indian Raagas.'
    },
    {
      view: 'dedupe',
      icon: 'copy',
      title: 'Sample cleanup',
      text: 'Find duplicate imported samples and safely replace extra copies with links.'
    },
    {
      view: 'disk',
      icon: 'harddrive',
      title: 'Disk insights',
      text: 'See which project folders use the most storage without changing or deleting anything.'
    },
    {
      view: 'id3',
      icon: 'tag',
      title: 'ID3 editor',
      text: 'Add, replace or remove metadata across many MP3 files at once.'
    },
    {
      view: 'rename',
      icon: 'sparkles',
      title: 'Renamer',
      text: 'AI-assisted Smart stem classifier and bulk batch filename pattern tool.'
    },
    {
      view: 'finish',
      icon: 'activity',
      title: 'Audio finishing',
      text: 'Normalise WAV files and optionally fit long audio to an exact beat or bar length.'
    },
    {
      view: 'silence',
      icon: 'scissors',
      title: 'Strip silence',
      text: 'Detect leading or trailing silence and create trimmed copies while preserving originals.'
    },
    {
      view: 'vocal',
      icon: 'mic',
      title: 'Vocal reconstruction',
      text: 'Split long vocals for external processing, then rebuild them at their exact original timing.'
    }
  ].forEach((tool) => {
    const card = el('button', 'tool-card');
    card.type = 'button';
    card.append(svgIcon(tool.icon, 'tool-card__icon', 20));
    const copy = el('span', 'tool-card__copy');
    copy.append(el('b', 'tool-card__title', tool.title));
    copy.append(el('span', 'tool-card__text', tool.text));
    card.append(copy, el('span', 'tool-card__open', 'Open →'));
    card.addEventListener('click', () => openStandaloneTool(tool.view));
    grid.append(card);
  });

  section.append(grid);
  viewEl.append(section);
}

function openSheet() {
  const metroSoundSelect = $('settingMetronomeSoundSelect') as HTMLSelectElement | null;
  if (metroSoundSelect && Player.getMetronomeSound) {
    metroSoundSelect.value = Player.getMetronomeSound();
  }
  const metroBpmInput = $('metroSettingBpm') as HTMLInputElement | null;
  if (metroBpmInput) {
    metroBpmInput.value = String(getEffectiveMetronomeBpm());
  }
  sheetEl.hidden = false;
  scrimEl.hidden = false;
}
function closeSheet() {
  stopMetroAudition();
  sheetEl.hidden = true;
  scrimEl.hidden = true;
}

/* ============================== wiring ============================= */

$('rescan').addEventListener('click', refresh);

/* ---- Search hint bubble (▾ button) --------------------------------- */
(function () {
  const hintBtn = $('searchHintBtn') as HTMLButtonElement;
  const hintBubble = $('searchHintBubble') as HTMLElement;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  function openBubble() {
    hintBubble.hidden = false;
    hintBtn.classList.add('is-open');
  }
  function closeBubble() {
    hintBubble.hidden = true;
    hintBtn.classList.remove('is-open');
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }
  function toggleBubble() {
    if (hintBubble.hidden) openBubble(); else closeBubble();
  }

  // Click toggles
  hintBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBubble(); });

  // Hover for 2 s → auto open
  hintBtn.addEventListener('mouseenter', () => {
    if (hintBubble.hidden) hoverTimer = setTimeout(openBubble, 2000);
  });
  hintBtn.addEventListener('mouseleave', () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  });

  // Close on outside click or Escape
  document.addEventListener('click', (e) => {
    if (!hintBubble.hidden && !hintBtn.contains(e.target as Node) && !hintBubble.contains(e.target as Node)) closeBubble();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBubble(); });
})();

let searchDebounceTimer: any = null;
searchEl.addEventListener('input', () => {
  if (view !== 'list') view = 'list';
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    render();
  }, 60);
});

favFilterEl.addEventListener('click', () => {
  favOnly = !favOnly;
  favFilterEl.classList.toggle('is-on', favOnly);
  view = 'list';
  render();
  renderCollections();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!sheetEl.hidden) return closeSheet();
    if (view !== 'list') navigateBack();
  }
  if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    Player.toggle();
  }
});

window.addEventListener('beforeunload', () => {
  if (!activeNoteEditor) return;
  const timer = noteTimers.get(activeNoteEditor.sessionPath);
  if (timer) {
    clearTimeout(timer);
    noteTimers.delete(activeNoteEditor.sessionPath);
  }
  // Invoking sends the request to the main process immediately. The main
  // process tracks the resulting write and waits for it during shutdown.
  window.api
    .saveNote(activeNoteEditor.sessionPath, activeNoteEditor.area.value)
    .catch(() => {});
});

/* ------------------------- audition controls ---------------------- */

/**
 * The drone needs a key, and the key comes from analysing a render — so the
 * button stays disabled until there's something to play. Better than a button
 * that silently does nothing.
 */
const droneBtn = $('droneBtn');
const verbBtn = $('verbBtn');
const clipBtn = $('clipBtn');

droneBtn.addEventListener('click', () => {
  if (Player.isDroning()) {
    Player.stopDrone();
    droneBtn.classList.remove('is-on');
    return;
  }

  const note = droneNoteFor(
    records,
    activeAuditionPath,
    openProject && openProject.path,
    selected
  );

  if (!note) {
    toast(
      'No key yet',
      'Analyse a render first — the drone plays the root note it finds.',
      true
    );
    return;
  }

  if (Player.startDrone(note)) {
    droneBtn.classList.add('is-on');
    toast('Drone', `Holding ${note} underneath`);
  }
});

let lastMouseNavigation = { direction: '', at: 0 };
function handleMouseNavigation(direction) {
  const now = performance.now();
  // Some Logitech/Chromium combinations emit both app-command and mouseup.
  if (lastMouseNavigation.direction === direction && now - lastMouseNavigation.at < 80) return;
  lastMouseNavigation = { direction, at: now };
  if (direction === 'back') navigateBack();
  else navigateForward();
}

window.api.onNavigateBack(() => handleMouseNavigation('back'));
window.api.onNavigateForward(() => handleMouseNavigation('forward'));

// Fallback for devices/drivers that expose buttons 4/5 directly to Chromium.
window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    handleMouseNavigation(event.button === 3 ? 'back' : 'forward');
  },
  { capture: true }
);

verbBtn.addEventListener('click', () => {
  const on = verbBtn.classList.toggle('is-on');
  Player.setReverb(on ? 0.35 : 0);
});

clipBtn.addEventListener('click', () => {
  const on = clipBtn.classList.toggle('is-on');
  Player.setSoftClip(on ? 0.4 : 0);
});

Player.onChange(({ path: playing }) => {
  document.querySelectorAll('.row, .filerow').forEach((node) => {
    node.classList.remove('is-playing');
  });
  if (!playing) return;
  document.querySelectorAll('.filerow').forEach((node) => {
    if ((node as HTMLElement).dataset.path === playing) node.classList.add('is-playing');
  });
});

Player.onNeedTrack(() => {
  preloadLatestRender({ autoplay: true });
});

const nowPlayingTitleEl = document.getElementById('nowPlaying');
if (nowPlayingTitleEl) {
  nowPlayingTitleEl.addEventListener('click', () => {
    const current = Player.getCurrent();
    if (!current) return;

    // 1. If project object is attached
    if (current.project && typeof current.project === 'object' && current.project.sessionPath) {
      goProject(current.project);
      return;
    }

    // 2. Find matching project entry by path/folder
    const targetPath = typeof current.project === 'string' ? current.project : current.path;
    if (targetPath) {
      const match = (entries || []).find((e) => {
        if (e.path === targetPath || e.sessionPath === targetPath) return true;
        if (e.folder && targetPath.toLowerCase().startsWith(e.folder.toLowerCase())) return true;
        if (e.root && targetPath.toLowerCase().startsWith(e.root.toLowerCase())) return true;
        return false;
      });
      if (match) {
        goProject(match);
        return;
      }
    }

    // 3. Fallback: match by title / stem
    if (current.name) {
      const cleanName = current.name.toLowerCase();
      const match = (entries || []).find((e) => {
        const pName = (e.name || '').toLowerCase();
        return pName && (cleanName.includes(pName) || pName.includes(cleanName));
      });
      if (match) {
        goProject(match);
      }
    }
  });
}

window.api.onBounce((bounce) => {
  toast('New bounce', `${bounce.label} · ${bounce.formats.join(' + ').toUpperCase()}`);
  if (view === 'list') refresh();
  else if (view === 'project') render();
});

window.api.onSilenceProgress(({ done, total, phase }) => {
  if (silenceProgressStatus) {
    silenceProgressStatus.textContent =
      `${phase === 'analyse' ? 'Analysing' : 'Processing'} ${done} of ${total}…`;
  }
});

window.api.onProjectsUpdated((result) => {
  applyProjectResult(result, { background: true });
});

window.api.onFinishProgress(({ done, total, phase }) => {
  if (finishProgressStatus) {
    finishProgressStatus.textContent =
      `${phase === 'analyse' ? 'Analysing' : 'Processing'} ${done} of ${total}…`;
  }
});

window.api.onQcProgress(({ done, total }) => {
  if (qcProgressStatus) qcProgressStatus.textContent = `Reading ${done} of ${total}…`;
});

window.api.onDedupeProgress(({ done, total }) => {
  if (dedupeProgressStatus) {
    dedupeProgressStatus.textContent = `Comparing ${done} of ${total} candidates…`;
  }
});

window.api.onDiskProgress(({ foldersDone, totalFolders, filesScanned, maxFiles }) => {
  if (diskProgressStatus && diskScanning) {
    diskProgressStatus.textContent =
      `Measured ${foldersDone} of ${totalFolders} folder(s) · ` +
      `${filesScanned} of ${maxFiles} maximum files…`;
  }
});

window.api.onNoteRenamed(() => {
  /* the status line updates on next load; nothing to do here */
});

/* ============================== helpers ============================ */

function el(tag: string, className?: string | null, text?: any): any {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// Minimal inline line-icons (Lucide-style), drawn in currentColor so they track
// the theme accent. Used to give the sidebar and actions a modern, legible feel.
const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  files: '<path d="M4 4a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><polyline points="13 2 13 7 18 7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  // tool-card icons
  sparkles: '<path d="M12 3l1.9 4.8L18 9.7l-4.1 1.9L12 16l-1.9-4.4L6 9.7l4.1-1.9z"/><path d="M19 14l.8 1.9L22 16.6l-2.2.9L19 20l-.8-2.5L16 16.6l2.2-.7z"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  harddrive: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><circle cx="15.5" cy="8.5" r="1.5"/><circle cx="8.5" cy="15.5" r="1.5"/><circle cx="15.5" cy="15.5" r="1.5"/><circle cx="12" cy="12" r="1.5"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 6 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.4 13.5H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10.5 3.4V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88z"/>'
};

function svgIcon(name: string, cls = 'coll__icon', size = 16): any {
  const span = el('span', cls);
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

function headRow(title, subtitle?, toolKey?: string) {
  const head = el('div', 'section__head');
  const titles = el('div', 'section__head-titles');
  titles.append(el('h3', null, title));
  if (subtitle) titles.append(el('span', 'muted', subtitle));
  head.append(titles);

  if (toolKey) {
    const tutBtn = el('button', 'pill pill--sm tool-tour-btn', '❓ Tutorial');
    tutBtn.type = 'button';
    tutBtn.title = 'Start interactive tutorial for this tool';
    tutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startToolWalkthrough(toolKey, true);
    });
    head.append(tutBtn);
  }

  return head;
}

function showSpinner(title, body) {
  viewEl.innerHTML = '';
  const wrap = el('div', 'empty');
  wrap.append(el('div', 'spinner'));
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  viewEl.append(wrap);
}

function renderEmpty(title, body) {
  const wrap = el('div', 'empty');
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  const btn = el('button', 'pill pill--solid', 'Open settings');
  btn.addEventListener('click', openSheet);
  wrap.append(btn);
  viewEl.append(wrap);
}

function sep() {
  return settings && settings.platform === 'win32' ? '\\' : '/';
}

function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function shortName(p) {
  return basename(p);
}

function formatBpm(bpm) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function timeAgo(ms) {
  if (!ms) return '—';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

let currentToastNode: HTMLElement | null = null;
let currentToastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(title: string, body: string, isAlert?: boolean) {
  if (!toastsEl) return;

  const prevToast = currentToastNode;
  if (currentToastTimer) {
    clearTimeout(currentToastTimer);
    currentToastTimer = null;
  }

  const node = el('div', `toast${isAlert ? ' toast--alert' : ''}`);
  node.title = 'Click to dismiss';
  node.append(el('div', 'toast__title', title));
  node.append(el('div', 'toast__body', body));

  const dismissThisToast = () => {
    if (!node.isConnected) return;
    if (currentToastTimer && currentToastNode === node) {
      clearTimeout(currentToastTimer);
      currentToastTimer = null;
    }
    node.classList.remove('toast--bump-in', 'toast--enter');
    node.classList.add('toast--bump-out');
    setTimeout(() => {
      if (node.isConnected) node.remove();
      if (currentToastNode === node) currentToastNode = null;
    }, 280);
  };

  const closeBtn = el('button', 'toast__close', '✕');
  closeBtn.title = 'Dismiss notification';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissThisToast();
  });
  node.append(closeBtn);
  node.addEventListener('click', dismissThisToast);

  if (prevToast && prevToast.isConnected) {
    // Bump out the old notification to the right
    prevToast.classList.remove('toast--bump-in', 'toast--exit');
    prevToast.classList.add('toast--bump-out');
    setTimeout(() => {
      if (prevToast.isConnected) prevToast.remove();
    }, 320);

    // Bump in the new notification from the left
    node.classList.add('toast--bump-in');
  }

  currentToastNode = node;
  toastsEl.append(node);

  currentToastTimer = setTimeout(() => {
    if (node.isConnected && currentToastNode === node) {
      node.classList.add('toast--exit');
      setTimeout(() => {
        if (node.isConnected) node.remove();
        if (currentToastNode === node) currentToastNode = null;
      }, 250);
    }
  }, 5000);
}

/* ==================================================================
   DRAG-AND-DROP & MULTI-SELECTION SYSTEM
   ================================================================== */

interface SelectedItem {
  id: string;
  name: string;
  path: string;
  size?: number;
  type?: string;
}

const SelectionState = {
  active: false,
  items: new Map<string, SelectedItem>(),
  lastSelectedId: null as string | null,

  enable() {
    this.active = true;
    document.body.classList.add('multi-select-mode');
    updateSelectionBar();
    updateSelectionHighlights();
  },

  disable() {
    this.active = false;
    this.items.clear();
    this.lastSelectedId = null;
    document.body.classList.remove('multi-select-mode');
    removeSelectionBar();
    updateSelectionHighlights();
  },

  toggle(item: SelectedItem) {
    if (this.items.has(item.id)) {
      this.items.delete(item.id);
      if (this.items.size === 0) {
        this.disable();
        return;
      }
    } else {
      if (!this.active) {
        this.active = true;
        document.body.classList.add('multi-select-mode');
      }
      this.items.set(item.id, item);
      this.lastSelectedId = item.id;
    }
    updateSelectionBar();
    updateSelectionHighlights();
  },

  select(item: SelectedItem) {
    if (!this.active) {
      this.active = true;
      document.body.classList.add('multi-select-mode');
    }
    this.items.set(item.id, item);
    this.lastSelectedId = item.id;
    updateSelectionBar();
    updateSelectionHighlights();
  },

  selectAll(items: SelectedItem[]) {
    if (!this.active) {
      this.active = true;
      document.body.classList.add('multi-select-mode');
    }
    items.forEach((item) => this.items.set(item.id, item));
    updateSelectionBar();
    updateSelectionHighlights();
  },

  isSelected(id: string) {
    return this.items.has(id);
  },

  count() {
    return this.items.size;
  },

  getFilePaths(): string[] {
    return (Array.from(this.items.values()) as SelectedItem[])
      .map((i) => i.path)
      .filter(Boolean);
  },

  getTotalSize(): number {
    return (Array.from(this.items.values()) as SelectedItem[]).reduce((sum: number, i) => sum + (i.size || 0), 0);
  }
};

function updateSelectionHighlights() {
  document.querySelectorAll('[data-selectable-id]').forEach((node: any) => {
    const id = node.getAttribute('data-selectable-id');
    const isSelected = SelectionState.isSelected(id);
    node.classList.toggle('is-multi-selected', isSelected);
    const cb = node.querySelector('.filerow__select-handle, .row__select-handle');
    if (cb) {
      cb.classList.toggle('is-checked', isSelected);
    }
  });
}

function updateSelectionBar() {
  let bar = document.querySelector('.floating-selection-bar') as HTMLElement;
  if (!bar) {
    bar = el('div', 'floating-selection-bar');
    document.body.append(bar);
  }

  const count = SelectionState.count();
  if (count === 0) {
    bar.remove();
    return;
  }

  const totalSize = SelectionState.getTotalSize();
  const filePaths = SelectionState.getFilePaths();

  bar.innerHTML = '';

  const left = el('div', 'selection-bar__info');
  left.append(el('span', 'selection-bar__badge', `${count}`));
  left.append(
    el(
      'span',
      'selection-bar__label',
      `${count} file${count === 1 ? '' : 's'} selected${totalSize ? ` · ${formatBytes(totalSize)}` : ''}`
    )
  );
  bar.append(left);

  const actions = el('div', 'selection-bar__actions');

  // Drag button (draggable itself to initiate multi-drag!)
  const dragBtn = el('button', 'pill pill--solid selection-bar__drag-btn', `⤓ Drag ${count} to DAW`);
  dragBtn.title = 'Click or drag this button directly into your DAW or a folder!';
  dragBtn.draggable = true;
  dragBtn.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    if (window.api.dragFiles) {
      await window.api.dragFiles(filePaths);
    }
  });
  dragBtn.addEventListener('click', async () => {
    if (window.api.dragFiles) {
      await window.api.dragFiles(filePaths);
    }
  });
  actions.append(dragBtn);

  // Copy paths button
  const copyBtn = el('button', 'pill', '📋 Copy Paths');
  copyBtn.title = 'Copy all selected file paths to clipboard';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(filePaths.join('\n'));
    toast('Copied', `${count} path${count === 1 ? '' : 's'} copied to clipboard`);
  });
  actions.append(copyBtn);

  // Reveal first in Explorer
  if (filePaths.length > 0) {
    const revealBtn = el('button', 'pill', `Show in ${settings.fileManager}`);
    revealBtn.addEventListener('click', () => {
      window.api.reveal(filePaths[0]);
    });
    actions.append(revealBtn);
  }

  // Clear / Done button
  const clearBtn = el('button', 'pill pill--ghost', '✕ Clear');
  clearBtn.title = 'Clear selection (Esc)';
  clearBtn.addEventListener('click', () => SelectionState.disable());
  actions.append(clearBtn);

  bar.append(actions);
}

function removeSelectionBar() {
  document.querySelectorAll('.floating-selection-bar').forEach((n) => n.remove());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && SelectionState.active) {
    SelectionState.disable();
  }
});

function createSelectHandle(item: SelectedItem) {
  const handle = el('div', `filerow__select-handle ${SelectionState.isSelected(item.id) ? 'is-checked' : ''}`);
  handle.title = 'Click to select · Long-press to multi-select';
  handle.innerHTML = `<span class="select-handle__check">✓</span>`;
  handle.addEventListener('click', (e) => {
    e.stopPropagation();
    SelectionState.toggle(item);
  });
  return handle;
}

function attachDraggableAndSelectable(rowElement: HTMLElement, item: SelectedItem) {
  rowElement.draggable = true;
  rowElement.setAttribute('data-selectable-id', item.id);
  rowElement.classList.add('draggable-row');

  if (SelectionState.isSelected(item.id)) {
    rowElement.classList.add('is-multi-selected');
  }

  // Native File Dragging
  rowElement.addEventListener('dragstart', async (e: DragEvent) => {
    e.preventDefault();
    let pathsToDrag = [item.path];
    if (SelectionState.active && SelectionState.isSelected(item.id)) {
      pathsToDrag = SelectionState.getFilePaths();
    }

    if (window.api.dragFiles) {
      await window.api.dragFiles(pathsToDrag);
    }
  });

  // Long-press detection (450ms)
  let pressTimer: any = null;
  let startX = 0;
  let startY = 0;
  let isLongPress = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('.filerow__select-handle') ||
      target.closest('.row__select-handle')
    ) {
      return;
    }

    isLongPress = false;
    startX = e.clientX;
    startY = e.clientY;

    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      isLongPress = true;
      SelectionState.toggle(item);
      rowElement.classList.add('row--pulse-select');
      setTimeout(() => rowElement.classList.remove('row--pulse-select'), 300);
      try {
        if ('vibrate' in navigator) navigator.vibrate(40);
      } catch {}
    }, 450);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
      clearTimeout(pressTimer);
    }
  };

  const onPointerUp = () => {
    clearTimeout(pressTimer);
  };

  rowElement.addEventListener('pointerdown', onPointerDown);
  rowElement.addEventListener('pointermove', onPointerMove);
  rowElement.addEventListener('pointerup', onPointerUp);
  rowElement.addEventListener('pointercancel', onPointerUp);

  // When multi-select mode is active, clicking row toggles selection
  rowElement.addEventListener('click', (e) => {
    if (isLongPress) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || SelectionState.active) {
      const target = e.target as HTMLElement;
      if (!target.closest('button') && !target.closest('a')) {
        e.preventDefault();
        e.stopPropagation();
        SelectionState.toggle(item);
      }
    }
  });
}

// Low CPU idle mode: throttle when window is hidden/minimized
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // When window is minimized, stop scale auditioning loops to free up AudioContext CPU
    stopScalePlayback();
  }
});


boot();
