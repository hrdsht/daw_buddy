/**
 * DAW Buddy - Interactive Feature Walkthrough Tour
 * 
 * Provides an accessible, non-intrusive step-by-step visual guide
 * with directional arrow pointers and spotlight highlights.
 * Does NOT force clicks on elements; explains features clearly.
 */

export interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  beforeStep?: () => void | Promise<void>;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: '#search',
    title: 'Smart Search & Harmonic Filters',
    description:
      'Search projects by title, BPM ranges (bpm:120-130), Camelot harmonic keys (key:8A), DAWs (daw:ableton), or custom tags (note:vocal).',
    position: 'bottom'
  },
  {
    target: '#collections',
    title: 'Collections & DAW Libraries',
    description:
      'Quickly browse projects by This Week, Favourites, or auto-detected DAW formats (Ableton, FL Studio, Logic, Bitwig, Pro Tools, and Studio One).',
    position: 'right'
  },
  {
    target: '#openTools',
    title: 'Integrated Audio Tools Suite',
    description:
      'Access the Scale & Raaga Detector, Smart Stem Renamer, Vocal Round-Trip Analyzer, Silence Stripper, Sample Auditor, Audio Finisher, and Lossless Trimmer.',
    position: 'top'
  },
  {
    target: '.player',
    title: 'Real-time Transport & Waveform',
    description:
      'Scrub interactive audio waveforms, audition with custom Reverb, engage root-note Drone synths, and monitor with safety soft clipping.',
    position: 'top'
  },
  {
    target: '#view',
    title: 'Zero-Friction Drag & Drop',
    description:
      'Grab audio files, stems, or individual [ MP3 ] and [ WAV ] format buttons and drag them directly into your DAW, WhatsApp, or Discord.',
    position: 'top'
  },
  {
    target: '#themeToggle',
    title: 'Themes & Ableton Priority Matrix',
    description:
      'Switch between Dark Minimalist, Ableton Live (with pure AMOLED), and Studio Classic. Assign 32-color Ableton clip priority tags to any project.',
    position: 'bottom'
  }
];

export const PROJECT_TOUR_STEPS: TourStep[] = [
  {
    target: '.page__headmain, .page__head',
    title: 'Project Overview & DAW Fast Launch',
    description:
      'View project tempo (BPM), detected musical scale, track counts, and save history. Click "Open project" to launch directly into Ableton, FL Studio, or Logic.',
    position: 'bottom'
  },
  {
    target: '.page__harmony, .harmony__keyboard-col',
    title: 'Interactive Scale & Raaga Keyboard',
    description:
      'Displays the active musical scale and root note. If not yet analysed, this shows an interactive Demo Preview (A Minor · 8A) so you can audition notes. Analysing any audio file or render will automatically populate your authentic key and scale!',
    position: 'bottom'
  },
  {
    target: '.harmony__ragas-box',
    title: 'Indian Raagas (Aarohana & Avarohana) & DAW Drag',
    description:
      'Displays matching Indian Classical Raagas with full ascending (Aarohana) and descending (Avarohana) swara sequences. Drag any Raaga chip directly onto an instrument track in your DAW to generate the melody phrase!',
    position: 'top'
  },
  {
    target: '.project-tabs',
    title: 'Populated Renders & Bounces',
    description:
      'All exported mixdowns, master bounces, and audio renders for this project are automatically discovered and populated here.',
    position: 'bottom',
    beforeStep: () => {
      const rendersBtn = Array.from(document.querySelectorAll('.project-tabs button')).find((b) =>
        b.textContent?.trim().toLowerCase().includes('renders')
      ) as HTMLButtonElement;
      if (rendersBtn) rendersBtn.click();
    }
  },
  {
    target: '.format-pills, .filerow',
    title: 'Drag & Drop Audio Formats (WAV, MP3, FLAC)',
    description:
      'Grab any [ WAV ], [ MP3 ], or [ FLAC ] pill and drag it straight into your DAW, Discord, or WhatsApp without digging through Windows Explorer.',
    position: 'top'
  },
  {
    target: '.filerow__actions, .filerow .pill--sm',
    title: 'On-Demand Audio & Stem Analysis',
    description:
      'Click "Analyse" on any render or audio file to detect its exact tempo (BPM), musical key, Camelot code, and Indian Raagas in the background.',
    position: 'top'
  },
  {
    target: '.project-tabs',
    title: 'Multitrack Stems Management',
    description:
      'Switch to the Stems tab to preview and manage all isolated track stems. You can play stems, drag them to your DAW, or use the Smart Renamer tool to organize cryptic stem names.',
    position: 'bottom',
    beforeStep: () => {
      const stemsBtn = Array.from(document.querySelectorAll('.project-tabs button')).find((b) =>
        b.textContent?.trim().toLowerCase().includes('stems')
      ) as HTMLButtonElement;
      if (stemsBtn) stemsBtn.click();
    }
  },
  {
    target: '.player',
    title: 'Real-Time Audio Player & Space Reverb',
    description:
      'Audition mixdowns without launching heavy DAW software. Scrub the interactive waveform, adjust listening volume, or engage the space reverb simulator.',
    position: 'top'
  }
];

export const TOOL_TOUR_STEPS: Record<string, TourStep[]> = {
  randomizer: [
    {
      target: '.randomizer-roll-btn, .randomizer-hero, .section',
      title: '🎲 Producer Idea Generator',
      description: 'Click "Roll New Idea" to instantly randomize your Key, Scale, matching Indian Raaga, BPM, Time Signature, and Genre challenge.',
      position: 'bottom'
    },
    {
      target: '.randomizer-genre-card, .randomizer-genre-badge, .genre-badge',
      title: '🎧 Curated Genre Challenge',
      description: 'Test your production skills with 48+ genres across 9 categories (Botanica, Bollywood, Afro House, Riddim, DnB, etc.) with typical tempo guidelines.',
      position: 'bottom'
    },
    {
      target: '.scale-keyboard-card, .scale-modal-actions, .scale-midi-btn',
      title: '🎹 Scale Audition & MIDI Drag',
      description: 'Play scale notes with the live synth, trigger root drones, or drag the generated Scale MIDI file straight into your DAW.',
      position: 'top'
    },
    {
      target: '.scale-ragas-section, .raga-card, .scale-ragas-grid',
      title: '🪘 Suggested Indian Classical Raagas & Talas',
      description: 'Explore matching Raagas with ascending (Aarohana) and descending (Avarohana) swara phrases, accompanying time signatures, and direct MIDI export.',
      position: 'top'
    },
    {
      target: '.randomizer-yt-section, .randomizer-yt-grid',
      title: '📺 YouTube Inspiration Explorer',
      description: 'Click pre-crafted search queries to audition reference tracks, live sets, fusion challenges, and production masterclasses in your default browser.',
      position: 'top'
    }
  ],
  'scale-tool': [
    {
      target: '.scale-dropzone, #scaleDropzone, .section',
      title: '🎵 Audio & MIDI File Dropzone',
      description: 'Drop any audio sample (WAV, MP3, FLAC, AIFF) or MIDI file here to start high-resolution harmonic and tempo analysis.',
      position: 'bottom'
    },
    {
      target: '.scale-results-card, .scale-results-facts, .section',
      title: '📊 Real-Time DSP Detection',
      description: 'Instantly identifies root tonic, scale mode, Camelot wheel code, BPM, concert tuning (A4 deviation in cents), and measure meter.',
      position: 'bottom'
    },
    {
      target: '.scale-notes-row, .scale-ragas-section, .section',
      title: '🎹 Interactive Keyboard & Raagas',
      description: 'Audition notes on the piano keyboard, inspect Sargam swaras, and drag generated melody MIDI clips directly into your DAW.',
      position: 'top'
    }
  ],
  tools: [
    {
      target: '.tool-grid, .tool-card, .section',
      title: '🛠️ Audio Engineering Suite',
      description: 'All specialized studio utilities live here: Music Randomizer, Scale & Raaga Detector, Smart Stem Renamer, Audio Finisher, Silence Stripper, and more.',
      position: 'bottom'
    }
  ],
  'smart-rename': [
    {
      target: '.smart-rename-folder, .btn--choose-folder, .folder-picker-bar, .section',
      title: '📁 Pick Stems Directory',
      description: 'Select the folder containing cryptic stem exports from your DAW or collaborators.',
      position: 'bottom'
    },
    {
      target: '.smart-items-table, .smart-category-col, .smart-rename-list, .section',
      title: '✨ Intelligent Instrument Classification',
      description: 'Automatically categorizes audio files into standard Kick, Snare, Bass, Leads, Vocals, Guitars, Synths, and FX categories.',
      position: 'bottom'
    },
    {
      target: '.smart-rename-actions, .btn--apply-rename, .section',
      title: '📝 Safe Rename & Rollback Manifest',
      description: 'Preview changes before applying. A rollback log manifest is created so you can undo renames anytime.',
      position: 'top'
    }
  ],
  silence: [
    {
      target: '.silence-controls, .silence-slider, .section',
      title: '🎚️ Silence Threshold & Padding',
      description: 'Set the silence dB threshold and configure millisecond safety padding to preserve natural acoustic attacks.',
      position: 'bottom'
    },
    {
      target: '.silence-actions, .btn--strip-silence, .section',
      title: '✂️ Non-Destructive Silence Trimming',
      description: 'Trims leading dead air and trailing silence, writing safe processed copies while leaving original recordings untouched.',
      position: 'top'
    }
  ],
  finish: [
    {
      target: '.finisher-controls, .section',
      title: '🎛️ Peak Normalization & Bar Fitting',
      description: 'Normalize WAV bounces to target peak dB (e.g. -0.1 dB) and optionally fit or pad audio to exact bar lengths.',
      position: 'bottom'
    }
  ],
  vocal: [
    {
      target: '.vocal-tabs, .vocal-split-panel, .section',
      title: '🎙️ Vocal Silence Split',
      description: 'Splits long vocal recordings at silent pauses into manageable blocks ready for external tuning plugins or cloud tools.',
      position: 'bottom'
    },
    {
      target: '.vocal-rebuild-panel, .section',
      title: '🧩 Sample-Accurate Rebuild',
      description: 'Reassembles tuned vocal chunks back into a single continuous track with sample-accurate original timing.',
      position: 'top'
    }
  ],
  dedupe: [
    {
      target: '.dedupe-controls, .dedupe-scan-btn, .section',
      title: '💾 Duplicate Sample Auditor',
      description: 'Scans sample libraries for duplicate audio files and replaces redundant copies with hard-links to save disk space without breaking DAW projects.',
      position: 'bottom'
    }
  ],
  disk: [
    {
      target: '.disk-controls, .disk-table, .section',
      title: '📊 Project Storage Insights',
      description: 'Visualize which project folders and render archives consume the most space without modifying any files.',
      position: 'bottom'
    }
  ],
  id3: [
    {
      target: '.id3-controls, .id3-table, .section',
      title: '🏷️ Bulk MP3 Tag Editor',
      description: 'Inspect, write, and clean ID3v2 tags (Artist, Title, Album, Key, BPM, Genre) across multiple MP3 files at once.',
      position: 'bottom'
    }
  ]
};

export const TOUR_VERSION = '0.4.1-beta.1';
let activeStepIndex = 0;
let overlayEl: HTMLElement | null = null;
let currentTourMode: 'home' | 'project' | 'tool' = 'home';
let currentToolKey: string = 'randomizer';

export function isTourActive(): boolean {
  return Boolean(overlayEl);
}

export function isProjectPageActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('.page__headmain, .page__head, .page__harmony, #projectStickyBar, .project-tabs'));
}

export function hasSeenToolTour(toolKey: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(`dawBuddyToolTourSeen_${toolKey}`) === TOUR_VERSION;
}

export function startToolWalkthrough(toolKey: string, force = false) {
  const steps = TOOL_TOUR_STEPS[toolKey] || TOOL_TOUR_STEPS.tools;
  if (!steps || steps.length === 0) return;

  const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem(`dawBuddyToolTourSeen_${toolKey}`) : null;
  if (!force && lastSeen === TOUR_VERSION) {
    return;
  }

  currentTourMode = 'tool';
  currentToolKey = toolKey;
  activeStepIndex = 0;
  cleanupTour();
  renderTourStep(activeStepIndex);
}

export function startFeatureWalkthrough(force = false) {
  if (isProjectPageActive()) {
    startProjectWalkthrough(force);
    return;
  }

  const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem('dawBuddyTourSeenVersion') : null;
  if (!force && lastSeen === TOUR_VERSION) {
    return;
  }

  currentTourMode = 'home';
  activeStepIndex = 0;
  cleanupTour();
  renderTourStep(activeStepIndex);
}

export function startProjectWalkthrough(force = false) {
  if (!isProjectPageActive()) {
    startFeatureWalkthrough(force);
    return;
  }

  const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem('dawBuddyProjectTourSeenVersion') : null;
  if (!force && lastSeen === TOUR_VERSION) {
    return;
  }

  currentTourMode = 'project';
  activeStepIndex = 0;
  cleanupTour();
  renderTourStep(activeStepIndex);
}

export function completeTour() {
  if (currentTourMode === 'project') {
    localStorage.setItem('dawBuddyProjectTourSeenVersion', TOUR_VERSION);
  } else if (currentTourMode === 'tool') {
    localStorage.setItem(`dawBuddyToolTourSeen_${currentToolKey}`, TOUR_VERSION);
  } else {
    localStorage.setItem('dawBuddyTourSeenVersion', TOUR_VERSION);
  }
  cleanupTour();
}

function cleanupTour() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  document.querySelectorAll('.tour-highlight-active').forEach((el) => {
    el.classList.remove('tour-highlight-active');
  });
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', handleResize);
}

function handleKeydown(e: KeyboardEvent) {
  if (!overlayEl) return;
  if (e.key === 'Escape') {
    completeTour();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    nextStep();
  } else if (e.key === 'ArrowLeft') {
    prevStep();
  }
}

function handleResize() {
  if (overlayEl) {
    renderTourStep(activeStepIndex);
  }
}

function getSteps(): TourStep[] {
  if (currentTourMode === 'project') return PROJECT_TOUR_STEPS;
  if (currentTourMode === 'tool') return TOOL_TOUR_STEPS[currentToolKey] || TOOL_TOUR_STEPS.tools;
  return TOUR_STEPS;
}

function nextStep() {
  const steps = getSteps();
  if (activeStepIndex < steps.length - 1) {
    activeStepIndex++;
    renderTourStep(activeStepIndex);
  } else {
    completeTour();
  }
}

function prevStep() {
  if (activeStepIndex > 0) {
    activeStepIndex--;
    renderTourStep(activeStepIndex);
  }
}

async function renderTourStep(index: number) {
  cleanupTour();

  const steps = getSteps();
  const step = steps[index];
  if (!step) return;

  if (step.beforeStep) {
    try {
      await step.beforeStep();
    } catch (err) {
      console.warn('Tour beforeStep error:', err);
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  const targetEl = document.querySelector(step.target) as HTMLElement;
  if (!targetEl) {
    // If target not in current view, advance or finish
    if (index < steps.length - 1) {
      renderTourStep(index + 1);
    } else {
      completeTour();
    }
    return;
  }

  targetEl.classList.add('tour-highlight-active');
  try {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (_) {}

  overlayEl = document.createElement('div');
  overlayEl.className = 'tour-overlay';

  // Backdrop SVG with spotlight cutout
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tour-spotlight-svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
  mask.setAttribute('id', 'tour-spotlight-mask');

  const whiteRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  whiteRect.setAttribute('x', '0');
  whiteRect.setAttribute('y', '0');
  whiteRect.setAttribute('width', '100%');
  whiteRect.setAttribute('height', '100%');
  whiteRect.setAttribute('fill', 'white');
  mask.appendChild(whiteRect);

  const rect = targetEl.getBoundingClientRect();
  const pad = 6;
  const cutX = Math.max(0, rect.left - pad);
  const cutY = Math.max(0, rect.top - pad);
  const cutW = rect.width + pad * 2;
  const cutH = rect.height + pad * 2;

  const cutRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  cutRect.setAttribute('x', String(cutX));
  cutRect.setAttribute('y', String(cutY));
  cutRect.setAttribute('width', String(cutW));
  cutRect.setAttribute('height', String(cutH));
  cutRect.setAttribute('rx', '8');
  cutRect.setAttribute('ry', '8');
  cutRect.setAttribute('fill', 'black');
  mask.appendChild(cutRect);

  svg.appendChild(mask);

  const darkRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  darkRect.setAttribute('x', '0');
  darkRect.setAttribute('y', '0');
  darkRect.setAttribute('width', '100%');
  darkRect.setAttribute('height', '100%');
  darkRect.setAttribute('fill', 'rgba(0, 0, 0, 0.72)');
  darkRect.setAttribute('mask', 'url(#tour-spotlight-mask)');
  svg.appendChild(darkRect);

  overlayEl.appendChild(svg);

  // Spotlight animated border ring
  const ring = document.createElement('div');
  ring.className = 'tour-spotlight-ring';
  ring.style.left = `${cutX}px`;
  ring.style.top = `${cutY}px`;
  ring.style.width = `${cutW}px`;
  ring.style.height = `${cutH}px`;
  overlayEl.appendChild(ring);

  // Tooltip card with directional arrow
  const card = document.createElement('div');
  card.className = 'tour-card';

  // Arrow element
  const arrow = document.createElement('div');
  arrow.className = 'tour-card__arrow';
  card.appendChild(arrow);

  // Header (Step count + Skip)
  const head = document.createElement('div');
  head.className = 'tour-card__head';

  const badge = document.createElement('span');
  badge.className = 'tour-card__badge';
  badge.textContent = `Step ${index + 1} of ${steps.length}`;
  head.appendChild(badge);

  const skipBtn = document.createElement('button');
  skipBtn.className = 'tour-card__skip';
  skipBtn.textContent = 'Skip Tour';
  skipBtn.title = 'Dismiss walkthrough (Esc)';
  skipBtn.addEventListener('click', completeTour);
  head.appendChild(skipBtn);

  card.appendChild(head);

  // Content
  const title = document.createElement('h4');
  title.className = 'tour-card__title';
  title.textContent = step.title;
  card.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'tour-card__desc';
  desc.textContent = step.description;
  card.appendChild(desc);

  // Footer Navigation
  const foot = document.createElement('div');
  foot.className = 'tour-card__foot';

  const dots = document.createElement('div');
  dots.className = 'tour-card__dots';
  steps.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = `tour-card__dot ${i === index ? 'is-active' : ''}`;
    dots.appendChild(dot);
  });
  foot.appendChild(dots);

  const navBtns = document.createElement('div');
  navBtns.className = 'tour-card__nav';

  if (index > 0) {
    const backBtn = document.createElement('button');
    backBtn.className = 'tour-btn tour-btn--subtle';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', prevStep);
    navBtns.appendChild(backBtn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'tour-btn tour-btn--primary';
  nextBtn.textContent = index === steps.length - 1 ? 'Got it! Finish' : 'Next →';
  nextBtn.addEventListener('click', nextStep);
  navBtns.appendChild(nextBtn);

  foot.appendChild(navBtns);
  card.appendChild(foot);

  overlayEl.appendChild(card);
  document.body.appendChild(overlayEl);

  // Position Card & Arrow relative to target
  positionTourCard(card, arrow, rect, step.position || 'bottom');

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleResize);
}

function positionTourCard(
  card: HTMLElement,
  arrow: HTMLElement,
  targetRect: DOMRect,
  preferredPos: 'top' | 'bottom' | 'left' | 'right'
) {
  const cardW = 340;
  const pad = 14;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let pos = preferredPos;
  let top = 0;
  let left = 0;

  const cardH = card.offsetHeight || 200;

  if (pos === 'bottom') {
    top = targetRect.bottom + pad;
    left = targetRect.left + targetRect.width / 2 - cardW / 2;
    if (top + cardH > viewportH - 20) {
      pos = 'top';
    }
  }

  if (pos === 'top') {
    top = targetRect.top - cardH - pad;
    left = targetRect.left + targetRect.width / 2 - cardW / 2;
    if (top < 20) {
      pos = 'bottom';
      top = targetRect.bottom + pad;
    }
  }

  if (pos === 'right') {
    left = targetRect.right + pad;
    top = targetRect.top + targetRect.height / 2 - cardH / 2;
    if (left + cardW > viewportW - 20) {
      pos = 'bottom';
      top = targetRect.bottom + pad;
      left = targetRect.left;
    }
  }

  if (pos === 'left') {
    left = targetRect.left - cardW - pad;
    top = targetRect.top + targetRect.height / 2 - cardH / 2;
    if (left < 20) {
      pos = 'bottom';
      top = targetRect.bottom + pad;
      left = targetRect.left;
    }
  }

  left = Math.max(16, Math.min(viewportW - cardW - 16, left));
  top = Math.max(16, Math.min(viewportH - cardH - 16, top));

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.setAttribute('data-position', pos);

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const arrowX = Math.max(20, Math.min(cardW - 20, targetCenterX - left));
  arrow.style.setProperty('--arrow-x', `${arrowX}px`);
}
