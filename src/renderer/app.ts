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
  wheelLayout as wheelLayoutFn,
  compatible as camelotCompatible,
  codeFor,
  CAMELOT_KEYS,
  DEGREE_NAMES,
  SARGAM_NAMES
} from './scaleview';
import { scaleMidi, notesFor, ragaMidi, rhythmGuideMidi } from './midiwrite';
import {
  ScaleTraditionId,
  WORLD_REGIONS,
  WORLD_SCALES_DATABASE,
  findMatchingWorldScales,
  generateWorldScaleMidi,
  ScoredWorldScale
} from './world-scales';
import { showRegionOnboardingModal } from './onboarding';

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

// Settings — Theme style switch (Minimalist vs Studio Classic)
if ($('themeStyles')) {
  $('themeStyles').addEventListener('click', (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest('.style-btn') as HTMLElement;
    if (btn) {
      const style = btn.getAttribute('data-style') || 'minimalist';
      const defaultAccent = style === 'minimalist' ? 'cyan' : 'green';
      applyAppearance(defaultAccent, currentSurface(), style);
    }
  });
}

// Settings — Minimalist & Classic accent swatches
['minimalistSwatches', 'classicSwatches'].forEach((id) => {
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

// Settings — Reset theme to default (Dark Minimalist with Cyan accent)
if ($('resetTheme')) {
  $('resetTheme').addEventListener('click', () => applyAppearance('cyan', 'dark', 'minimalist'));
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
const navigationHistory = new NavigationHistory();

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

  // If user hasn't configured region & world scales yet, display the interactive 3D Globe wizard on first run or after update!
  const APP_VERSION = '0.4.3';
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

  renderRootList();
}

async function refresh() {
  sampleAuditCache.clear();
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

  list.forEach((entry) => {
    viewEl.append(buildRow(entry));

    if (entry.isGroup && expanded.has(entry.path)) {
      entry.versions.forEach((version) => viewEl.append(buildVersionRow(version)));
    }
  });
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
      `${open ? '▾' : '▸'} ${entry.versionCount} versions`
    );
    badge.title = 'Every version of this in the same folder';
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      if (open) expanded.delete(entry.path);
      else expanded.add(entry.path);
      render();
    });
    line.append(badge);
  } else if (!entry.isGroup && entry.siblingCount > 1 && !groupVersionsOn) {
    line.append(el('span', 'badge', `${entry.siblingCount} in folder`));
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

async function playNewest(entry) {
  // The Play button stops the row click from bubbling. Record the project
  // explicitly so the drone follows this audio, not an older highlighted row.
  selected = entry.path;
  activeAuditionPath = entry.path;
  const result = await window.api.findRenders(
    entry.sessionPath,
    entry.root,
    stemsFolderFor(entry),
    siblingsOf(entry)
  );
  if (!result.renders.length) {
    toast('No audio', `No render found for ${entry.name}`, true);
    return;
  }
  const file = result.renders[0].primary;
  const decoded = await Player.load(file);
  if (decoded) analysePlayedAudio(entry, file, decoded);
}

let isPreloadingRender = false;

async function preloadLatestRender({ autoplay = false } = {}) {
  if (Player.getCurrent() || isPreloadingRender) return;
  isPreloadingRender = true;

  try {
    // 1. If viewing a specific project, try its newest render first
    if (view === 'project' && openProject && openProject.audioCount > 0) {
      const result = await window.api.findRenders(
        openProject.sessionPath,
        openProject.root,
        stemsFolderFor(openProject),
        siblingsOf(openProject)
      );
      if (result && result.renders && result.renders.length > 0) {
        const file = result.renders[0].primary;
        if (file) {
          selected = openProject.path;
          activeAuditionPath = openProject.path;
          const decoded = await Player.load(file, { autoplay });
          if (decoded) analysePlayedAudio(openProject, file, decoded);
          return;
        }
      }
    }

    // 2. Otherwise find the top project in the list (newest first) and load its newest render
    const candidates = (entries || []).filter((e) => e.audioCount > 0);
    for (const entry of candidates) {
      if (Player.getCurrent()) return;
      const result = await window.api.findRenders(
        entry.sessionPath,
        entry.root,
        stemsFolderFor(entry),
        siblingsOf(entry)
      );
      if (result && result.renders && result.renders.length > 0) {
        const file = result.renders[0].primary;
        if (file) {
          selected = entry.path;
          activeAuditionPath = entry.path;
          const decoded = await Player.load(file, { autoplay });
          if (decoded) analysePlayedAudio(entry, file, decoded);
          return;
        }
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
function getAudioContext(): AudioContext | null {
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

function stopScalePlayback() {
  if (!currentScaleSession) return;
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
    return { osc, gain };
  } catch (err) {
    console.error('Audio synth error:', err);
    return null;
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
    titleText += ' — Click to view relative raagas & audition';
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

    segEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      Player.seek(seg.startSec);
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
  const selectedTuningA4 = rec.tuningA4 || 440;

  const inspectorCol = el('div', 'camelot-modal__inspector');

  function updateInspector() {
    inspectorCol.innerHTML = '';

    const tonicPc = DSP.NOTES.indexOf(selectedTonic);
    const degrees = DSP.SCALES[selectedScale] || (selectedCode.endsWith('B') ? DSP.SCALES.major : DSP.SCALES.minor);
    const thaat = DSP.THAAT_MAP[selectedScale] || (selectedCode.endsWith('B') ? 'Bilawal (Major)' : 'Asavari (Natural Minor)');
    const comp = camelotCompatible(selectedCode);

    // Inspector Top Card
    const topCard = el('div', 'scale-inspect-card');
    const headerRow = el('div', 'scale-inspect__header');

    const keyBadge = el('div', 'scale-inspect__key-badge');
    keyBadge.append(el('span', 'scale-inspect__camelot-num', selectedCode));
    keyBadge.append(el('span', 'scale-inspect__key-name', `${selectedTonic} ${selectedScale === 'major' ? 'Major' : selectedScale === 'minor' ? 'Minor' : selectedScale}`));
    headerRow.append(keyBadge);

    const thaatBadge = el('div', 'scale-inspect__thaat-badge', thaat);
    headerRow.append(thaatBadge);
    topCard.append(headerRow);

    // 2-octave Interactive Piano Keyboard
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
      rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, selectedTuningA4));
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
      rect.addEventListener('click', () => playSynthNote(k.pc, 4 + k.octave, selectedTuningA4));
      svgKb.appendChild(rect);
    });

    topCard.append(svgKb);
    inspectorCol.append(topCard);

    // Notes & Sargam Grid
    const notesSection = el('div', 'scale-notes-section');
    notesSection.append(el('h4', 'scale-notes__title', 'Scale Notes & Indian Sargam Solfege'));

    const notesGrid = el('div', 'scale-notes-grid');
    degrees.forEach((interval) => {
      const notePc = (tonicPc + interval) % 12;
      const noteName = DSP.NOTES[notePc];
      const sargam = SARGAM_NAMES[interval] || '';
      const degName = DEGREE_NAMES[interval] || '';
      const octave = interval < 12 ? (notePc < tonicPc ? 5 : 4) : (4 + Math.floor(interval / 12));
      const midiVal = 12 * (octave + 1) + notePc;
      const freq = (selectedTuningA4 * Math.pow(2, (midiVal - 69) / 12)).toFixed(1);

      const noteCard = el('div', `note-badge-card ${interval === 0 ? 'note-badge-card--tonic' : ''}`);
      noteCard.append(el('div', 'note-badge__name', noteName));
      noteCard.append(el('div', 'note-badge__sargam', sargam.split(' ')[0]));
      noteCard.append(el('div', 'note-badge__degree', degName));
      noteCard.append(el('div', 'note-badge__freq', `${freq} Hz`));
      noteCard.addEventListener('click', () => playSynthNote(notePc, octave, selectedTuningA4));
      notesGrid.append(noteCard);
    });
    notesSection.append(notesGrid);
    inspectorCol.append(notesSection);

    // World Musical Traditions & Scales Explorer Box
    const ragaChroma = new Float64Array(12);
    degrees.forEach((d) => {
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
        const resetPreviewBtn = () => {
          previewBtn.textContent = '▶ Audition';
          previewBtn.classList.remove('pill--solid');
        };

        const previewBtn = el('button', 'pill pill--sm raga-btn--preview', '▶ Audition');
        previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isScalePlaying(cardSessionId)) {
            stopScalePlayback();
            resetPreviewBtn();
            return;
          }
          document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
            b.textContent = '▶ Audition';
            b.classList.remove('pill--solid');
          });
          resetModalScaleUi();
          previewBtn.textContent = '⏸ Pause';
          previewBtn.classList.add('pill--solid');
          const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
          const desc = scaleMatch.descendingPhrase || [...asc].reverse();
          playRagaSequence(tonicPc, asc, desc, selectedTuningA4, cardSessionId, resetPreviewBtn);
        });
        actions.append(previewBtn);

        const midiBtn = el('button', 'pill pill--sm pill--solid raga-btn--midi', '⤓ Drag to DAW');
        midiBtn.title = 'Drag onto any DAW track or click to export MIDI containing scale phrasing';
        const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const desc = scaleMatch.descendingPhrase || [...asc].reverse();
        const rMidiBytes = generateWorldScaleMidi(tonicPc, asc, desc, { bpm: projectBpm || 120 });
        const cleanName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const rMidiFileName = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Scale_${cleanName}_${selectedTonic}.mid`;

        midiBtn.draggable = true;
        midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
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
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', midiFileName);
        e.dataTransfer.effectAllowed = 'copy';
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        e.dataTransfer.setDragImage(canvas, 0, 0);
      }
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
    selectedScale = code.endsWith('B') ? 'major' : 'minor';
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
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', midiFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
function runSampleAudit(entry, facts, box) {
  const cached = sampleAuditCache.get(entry.sessionPath);
  if (cached) {
    paintSampleAudit(cached, facts, box);
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
      if (openProject === entry) paintSampleAudit(res, facts, box);
    })
    .catch(() => {});
}

function paintSampleAudit(res, facts, box) {
  if (!res.supported || res.error || res.referenced === 0) return;
  box.innerHTML = '';

  if (res.missing && res.missing.length) {
    const n = res.missing.length;
    const chip = fact('Missing samples', String(n));
    chip.classList.add('statchip--alert');
    facts.append(chip);

    const callout = el('div', 'callout callout--alert');
    callout.append(
      el('b', null, `${n} referenced sample${n === 1 ? '' : 's'} not found on disk`)
    );
    const list = el('div', 'sample-audit__list');
    res.missing.slice(0, 40).forEach((m) => {
      const item = el('div', 'sample-audit__item');
      item.append(el('span', 'sample-audit__name', m.name || '(unnamed)'));
      if (m.relativePath) item.append(el('span', 'sample-audit__path', m.relativePath));
      list.append(item);
    });
    callout.append(list);
    if (n > 40) callout.append(el('div', 'muted', `…and ${n - 40} more`));
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
  if (projectBpm !== null) facts.append(fact('BPM', formatBpm(projectBpm)));
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
    facts.append(fact('Key', `${rec.key}${rec.camelot ? ` (${rec.camelot})` : ''}`));
  } else if (rec.tonic && rec.scale) {
    facts.append(fact('Scale', `Tonic ${rec.tonic} · ${rec.scale}`));
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

  /* Audio-synced Metronome widget */
  const metroGroup = el('div', 'project-metro-group');
  const metroBtn = el('button', 'pill pill--metro', '⏱ Metronome');
  metroBtn.title = 'Audio-synced metronome click (active during audio playback)';

  const metroSigWrap = el('div', 'project-metro-sigs');

  const updateMetroUI = () => {
    const isPlaying = Player.isPlaying();
    const isMetroOn = Player.isMetronome();
    const activeSig = Player.getMetronomeSignature() || projectSig || '4/4';

    metroBtn.classList.toggle('is-on', isMetroOn);
    if (!isPlaying) {
      metroBtn.classList.add('is-disabled-audio');
      metroBtn.title = 'Metronome active when audio plays (press ▶ on any render or audio file to sync)';
    } else {
      metroBtn.classList.remove('is-disabled-audio');
      metroBtn.title = 'Toggle audio-synced metronome click';
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

  metroGroup.append(metroBtn, metroSigWrap);
  actions.append(metroGroup);
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
    scaleModBtn.classList.add('is-loading');
    scaleModBtn.textContent = '⏳ Analyzing scale changes...';

    try {
      let channelData: Float32Array | null = null;
      let sampleRate = 44100;

      // 1. Check if audio is already decoded in player for this project
      const currentLoaded = Player.getCurrent();
      const decodedBuf = Player.getDecoded();

      if (decodedBuf && currentLoaded && (currentLoaded.project === entry.name || currentLoaded.path.includes(entry.name) || currentLoaded.path.startsWith(entry.path))) {
        channelData = decodedBuf.getChannelData(0);
        sampleRate = decodedBuf.sampleRate;
      } else {
        // 2. Otherwise find the main render/audio file in this project
        const renderRes = await window.api.findRenders(
          entry.sessionPath,
          entry.root,
          stemsFolderFor(entry),
          siblingsOf(entry)
        );

        let audioFileToAnalyze = renderRes.renders && renderRes.renders.length > 0
          ? renderRes.renders[0].path
          : null;

        if (!audioFileToAnalyze && entry.sessionPath) {
          const siblings = siblingsOf(entry);
          const firstAudio = siblings.find((s: string) => /\.(wav|mp3|flac|aif|aiff)$/i.test(s));
          if (firstAudio) audioFileToAnalyze = firstAudio;
        }

        if (!audioFileToAnalyze) {
          toast('Scale Change Detector', 'No audio file or bounce found in this project to analyze.');
          scaleModBtn.classList.remove('is-loading');
          scaleModBtn.innerHTML = '🎼 Detect scale changes';
          return;
        }

        const bytes = await window.api.readMedia(audioFileToAnalyze);
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ac.decodeAudioData(bytes);
        channelData = decoded.getChannelData(0);
        sampleRate = decoded.sampleRate;
      }

      if (!channelData || channelData.length === 0) {
        toast('Scale Change Detector', 'Could not decode audio samples for scale change analysis.', true);
        scaleModBtn.classList.remove('is-loading');
        scaleModBtn.innerHTML = '🎼 Detect scale changes';
        return;
      }

      // Run sliding-window scale modulation analysis
      const report = DSP.detectScaleModulations(channelData, sampleRate);
      projectScaleModCache.set(entry.path, report);

      scaleModBtn.classList.remove('is-loading');
      scaleModBtn.classList.add('is-on');
      scaleModBtn.innerHTML = `🎼 Scale changes (${report.uniqueKeys.length} ${report.uniqueKeys.length === 1 ? 'key' : 'keys'})`;

      renderScaleModBar(report, entry);

      if (report.hasModulation) {
        toast('Scale Changes Detected', `Found modulations: ${report.uniqueKeys.join(' ➔ ')}! Click sections above waveform to inspect.`);
      } else {
        toast('Scale Analysis', `Steady tonal center detected in ${report.uniqueKeys[0] || 'track'}. Scale line displayed above waveform.`);
      }
    } catch (err: any) {
      console.error('Scale modulation analysis failed:', err);
      toast('Scale Detector Error', err.message || String(err), true);
      scaleModBtn.classList.remove('is-loading');
      scaleModBtn.innerHTML = '🎼 Detect scale changes';
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
    ['notes', 'Notes & versions'],
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

async function loadRenders(entry, container) {
  container.append(el('p', 'muted', 'Looking for audio…'));

  const result = await window.api.findRenders(
    entry.sessionPath,
    entry.root,
    stemsFolderFor(entry),
    siblingsOf(entry)
  );

  container.innerHTML = '';

  if (!result.renders.length) {
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
  result.renders.forEach((render) => {
    const where = render.where || 'Elsewhere';
    if (!byPlace.has(where)) byPlace.set(where, []);
    byPlace.get(where).push(render);
  });

  for (const [where, list] of byPlace) {
    const heading = el('div', 'page__kicker', where);
    heading.style.margin = '14px 0 6px';
    container.append(heading);
    list.forEach((render) => container.append(buildRenderRow(entry, render)));
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

  const analyse = el('button', 'pill pill--sm', 'Analyse');
  analyse.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, render, analyse);
  });

  const play = el('button', 'filerow__play', '▶');
  play.addEventListener('click', async (event) => {
    event.stopPropagation();
    await Player.load(render.primary, { autoplay: true });
    if (entry) {
      await analyseRender(entry, { primary: render.primary }, analyse, { refresh: false });
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
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', fmtFile.path);
        e.dataTransfer.effectAllowed = 'copy';
      }
      if (window.api && window.api.dragFiles) {
        await window.api.dragFiles([fmtFile.path]);
      }
    });

    pill.addEventListener('click', async (e: MouseEvent) => {
      e.stopPropagation();
      // Single click: load, analyse, and play that specific format!
      await Player.load(fmtFile, { autoplay: true });
      if (entry) {
        await analyseRender(entry, { primary: fmtFile }, analyse, { refresh: false });
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
    await Player.load(render.primary, { autoplay: true });
    if (entry) {
      await analyseRender(entry, { primary: render.primary }, analyse, { refresh: false });
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

  const list = el('div');
  list.append(el('p', 'muted', 'Reading stems folder…'));
  section.append(list);
  viewEl.append(section);
  loadStems(entry, rec.stemsPath, list);
}

async function loadStems(entry, folder, container) {
  const files = await window.api.listAllAudio(folder);
  container.innerHTML = '';

  if (!files.length) {
    container.append(el('p', 'muted', 'No WAV, MP3, AIFF, FLAC or OGG files found in this folder.'));
    return;
  }

  files.forEach((file) => container.append(buildStemRow(entry, file)));
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
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', file.path);
        e.dataTransfer.effectAllowed = 'copy';
      }
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
  row.addEventListener('dblclick', () => Player.load(file));
  attachDraggableAndSelectable(row, item);
  return row;
}

function analyseAudioButton(entry, file) {
  const button = el('button', 'pill pill--sm', 'Analyse');
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, { primary: file }, button, { refresh: false });
  });
  return button;
}

async function analyseRender(entry, renderItem, buttonEl, { refresh = true } = {}) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Reading…';

  try {
    const current = Player.getCurrent();
    const decoded =
      current && current.path === renderItem.primary.path && Player.getDecoded()
        ? Player.getDecoded()
        : await Player.load(renderItem.primary, { autoplay: false });

    if (!decoded) {
      toast('Analysis failed', 'That file could not be decoded.', true);
      return;
    }

    buttonEl.textContent = 'Analysing…';
    const result = await analyseAudioFile(renderItem.primary, decoded);
    await storeAnalysis(entry, renderItem.primary, result);
    showAnalysisResult(entry, result);
    if (refresh) render();
  } catch (error) {
    toast('Analysis failed', error.message || String(error), true);
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Analyse';
  }
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

function analyseDecodedInBackground(decoded) {
  const worker = ensureAnalysisWorker();
  const id = ++analysisRequestId;
  const samples = new Float32Array(decoded.getChannelData(0));

  return new Promise((resolve, reject) => {
    pendingAnalysis.set(id, { resolve, reject });
    worker.postMessage(
      { id, samples, sampleRate: decoded.sampleRate },
      [samples.buffer]
    );
  });
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
    others.append(el('div', 'page__kicker', `${mates.length} other version(s) here`));
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
let smartSortMode: 'priority' | 'name' = 'priority';
let smartManifests: any[] = [];

function renderStandaloneSmartRename() {
  viewEl.innerHTML = '';
  renderSmartRenameTab(null);
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

  /* Panes container */
  const panes = el('div', 'smart-panes');

  const leftPane = el('div', 'smart-pane smart-pane--left');
  const leftHead = el('div', 'smart-pane__header');
  const leftTitle = el('span', null, 'Original files');
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
    renderPanes();
  }

  async function runAudioAnalysis() {
    if (smartItems.length === 0) return;
    analyseAudioBtn.disabled = true;
    analyseAudioBtn.textContent = 'Analysing audio...';
    let measured = 0;
    for (const item of smartItems) {
      const isWav = item.name.toLowerCase().endsWith('.wav');
      if (isWav && (!item.matched || item.confidence < 0.8)) {
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
    analyseAudioBtn.disabled = false;
    analyseAudioBtn.textContent = '🎧 Analyse audio features';
    toast('Audio Analysis', `Extracted features for ${measured} file(s)`);
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

      const key = sub ? `${cat}_${sub}` : cat;
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

    const planRows = computeOutputNames();
    const rowsByPath = new Map(planRows.map((r) => [r.path, r]));

    leftTitle.textContent = `Original files (${smartItems.length})`;

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
      const cat = item.userCategory !== undefined && item.userCategory !== null ? item.userCategory : item.category;
      const sub = item.userSubtype !== undefined && item.userSubtype !== null ? item.userSubtype : item.subtype;
      const isChanged = planRow ? planRow.changed : false;
      if (isChanged && !planRow?.problem) changingCount++;
      if (!cat) unresolvedCount++;

      /* Left Row */
      const lRow = el('div', `smart-row${isSelected ? ' is-selected' : ''}${cat ? ' is-matched' : ' is-unresolved'}`);
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
      lRow.append(lName, lBadge);

      lRow.addEventListener('click', () => {
        smartSelectedPath = item.path;
        Player.load({ path: item.path, name: item.name, ext: pathExt(item.name) });
        renderPanes();
      });
      leftBody.append(lRow);

      /* Right Row */
      const rRow = el('div', `smart-row${isSelected ? ' is-selected' : ''}`);
      const suggestedText = planRow ? planRow.to : item.name;
      const rName = el('span', 'smart-row__name', suggestedText);
      rName.title = suggestedText;
      rName.style.fontWeight = isChanged ? '600' : 'normal';
      if (isChanged) rName.style.color = 'var(--amber)';

      const select = document.createElement('select');
      select.className = 'smart-select';
      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = '— Unresolved —';
      select.appendChild(defOpt);

      for (const c of smartCategoriesList) {
        const opt = document.createElement('option');
        opt.value = c.category;
        opt.textContent = `${c.category} (generic)`;
        if (cat === c.category && !sub) opt.selected = true;
        select.appendChild(opt);

        for (const s of c.subtypes) {
          const subOpt = document.createElement('option');
          subOpt.value = `${c.category}:${s}`;
          subOpt.textContent = `${c.category} / ${s}`;
          if (cat === c.category && sub === s) subOpt.selected = true;
          select.appendChild(subOpt);
        }
      }

      select.addEventListener('change', async (e: any) => {
        const val = e.target.value;
        if (!val) {
          item.userCategory = null;
          item.userSubtype = null;
        } else if (val.includes(':')) {
          const [c, s] = val.split(':');
          item.userCategory = c;
          item.userSubtype = s;
        } else {
          item.userCategory = val;
          item.userSubtype = null;
        }
        item.confidence = 1.0;
        const tokens = (item.name || '').split(/[^a-zA-Z0-9]+/).filter((t: string) => t.length > 2);
        if (item.userCategory) {
          await window.api.userDictLearn(tokens, item.userCategory, item.userSubtype || null);
        }
        renderPanes();
      });

      let reasonText = '';
      if (item.userCategory) reasonText = 'Manual override';
      else if (item.matchedOn) reasonText = `Matched "${item.matchedOn}"`;
      else if (item.audioFeatures) reasonText = `Audio centroid ${item.audioFeatures.centroid}Hz`;
      const rReason = el('span', 'smart-reason', reasonText);

      rRow.append(rName, select, rReason);

      rRow.addEventListener('click', (e) => {
        if (e.target && ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'OPTION')) return;
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

/**
 * Every audio file below this project, however deep — the flattened view.
 * Grouped by the folder each came from so it stays readable.
 */
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

  list.append(el('p', 'muted', 'Looking…'));

  window.api
    .deepAudio(entry.folder)
    .then((files) => {
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

        group.slice(0, 200).forEach((file) => {
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
              e.stopPropagation();
              if (e.dataTransfer) {
                e.dataTransfer.setData('text/plain', file.path);
                e.dataTransfer.effectAllowed = 'copy';
              }
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
    })
    .catch((err) => {
      list.innerHTML = '';
      list.append(el('p', 'muted', err.message));
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
  let bpm = 120;
  let hasTempoMeta = false;
  const chromaCounts = new Float64Array(12);
  let totalEvents = 0;

  let offset = 14;
  for (let t = 0; t < numTracks && offset < bytes.length; t++) {
    if (bytes[offset] !== 0x4d || bytes[offset + 1] !== 0x54 || bytes[offset + 2] !== 0x72 || bytes[offset + 3] !== 0x6b) {
      break;
    }
    const trackLen = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
    offset += 8;
    const trackEnd = offset + trackLen;

    let runningStatus = 0;
    while (offset < trackEnd && offset < bytes.length) {
      // Read variable-length delta time
      while (offset < bytes.length) {
        const b = bytes[offset++];
        if (!(b & 0x80)) break;
      }

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
    ragas: ragas
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
      const channelData = audioBuffer.getChannelData(0);
      const analysis = DSP.analyse(channelData, sampleRate);
      await audioCtx.close();

      scaleToolState.result = {
        isAudio: true,
        durationSeconds: audioBuffer.duration,
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
      playScaleBtn.textContent = '⏸ Pause Scale';
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
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', sMidiFileName);
        e.dataTransfer.effectAllowed = 'copy';
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        e.dataTransfer.setDragImage(canvas, 0, 0);
      }
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

    // World Musical Traditions & Scales Explorer in Scale Tool
    const toolChroma = new Float64Array(12);
    degrees.forEach((d) => {
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

        const cardSessionId = `tool-world-card-${scaleMatch.id || scaleMatch.name}`;
        const resetPreviewBtn = () => {
          previewBtn.textContent = '▶ Audition';
          previewBtn.classList.remove('pill--solid');
        };

        const previewBtn = el('button', 'pill pill--sm raga-btn--preview', '▶ Audition');
        previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isScalePlaying(cardSessionId)) {
            stopScalePlayback();
            resetPreviewBtn();
            return;
          }
          document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
            b.textContent = '▶ Audition';
            b.classList.remove('pill--solid');
          });
          resetToolScaleUi();
          previewBtn.textContent = '⏸ Pause';
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
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', keyScaleMidiFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', keyScaleMidiFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', rhythmGuideFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', rhythmGuideFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', sMidiFileName);
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
        previewBtn.textContent = '▶ Audition';
        previewBtn.classList.remove('pill--solid');
      };

      const previewBtn = el('button', 'pill pill--sm raga-btn--preview', '▶ Audition');
      previewBtn.title = 'Audition authentic ascending & descending melodic phrasing (Click to stop)';
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isScalePlaying(cardSessionId)) {
          stopScalePlayback();
          resetPreviewBtn();
          return;
        }
        document.querySelectorAll('.raga-btn--preview').forEach((b: any) => {
          b.textContent = '▶ Audition';
          b.classList.remove('pill--solid');
        });
        resetScaleUi();
        previewBtn.textContent = '⏸ Pause';
        previewBtn.classList.add('pill--solid');
        const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
        const desc = scaleMatch.descendingPhrase || [...asc].reverse();
        playRagaSequence(state.tonicPc, asc, desc, state.tuningA4, cardSessionId, resetPreviewBtn);
      });
      actions.append(previewBtn);

      const midiBtn = el('button', 'pill pill--sm pill--solid raga-btn--midi', '⤓ Drag to DAW');
      midiBtn.title = 'Drag onto any DAW track or click to export MIDI';
      const asc = scaleMatch.ascendingPhrase || scaleMatch.degrees;
      const desc = scaleMatch.descendingPhrase || [...asc].reverse();
      const rMidiBytes = generateWorldScaleMidi(state.tonicPc, asc, desc, { bpm: state.bpm });
      const cleanName = scaleMatch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const rMidiFileName = `Random_Scale_${cleanName}_${state.tonic}_${state.bpm}BPM.mid`;

      midiBtn.draggable = true;
      midiBtn.addEventListener('dragstart', async (e: DragEvent) => {
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

function renderStandaloneTools() {
  viewEl.innerHTML = '';

  const section = el('div', 'section');
  section.append(headRow('Tools', 'All the utility jobs live here, so the sidebar stays calm and the tools are easier to find when you actually need them.', 'tools'));

  const grid = el('div', 'tool-grid');
  [
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
  sheetEl.hidden = false;
  scrimEl.hidden = false;
}
function closeSheet() {
  sheetEl.hidden = true;
  scrimEl.hidden = true;
}

/* ============================== wiring ============================= */

$('rescan').addEventListener('click', refresh);
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

function toast(title, body, isAlert?) {
  const node = el('div', `toast${isAlert ? ' toast--alert' : ''}`);
  node.append(el('div', 'toast__title', title));
  node.append(el('div', 'toast__body', body));
  toastsEl.append(node);
  setTimeout(() => node.remove(), 7000);
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
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', filePaths.join('\n'));
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
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
    let pathsToDrag = [item.path];
    if (SelectionState.active && SelectionState.isSelected(item.id)) {
      pathsToDrag = SelectionState.getFilePaths();
    }

    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', pathsToDrag.join('\n'));
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
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

boot();
