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
      'Access the Smart Stem Renamer, Vocal Round-Trip Analyzer, Silence Stripper, Sample Auditor, Audio Finisher, and Lossless Trimmer.',
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

const TOUR_VERSION = '0.1.0';
let activeStepIndex = 0;
let overlayEl: HTMLElement | null = null;

export function isTourActive(): boolean {
  return Boolean(overlayEl);
}

export function startFeatureWalkthrough(force = false) {
  const lastSeen = localStorage.getItem('dawBuddyTourSeenVersion');
  if (!force && lastSeen === TOUR_VERSION) {
    return;
  }

  activeStepIndex = 0;
  cleanupTour();
  renderTourStep(activeStepIndex);
}

export function completeTour() {
  localStorage.setItem('dawBuddyTourSeenVersion', TOUR_VERSION);
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

function nextStep() {
  if (activeStepIndex < TOUR_STEPS.length - 1) {
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

function renderTourStep(index: number) {
  cleanupTour();

  const step = TOUR_STEPS[index];
  if (!step) return;

  const targetEl = document.querySelector(step.target) as HTMLElement;
  if (!targetEl) {
    // If target not in current view, advance or finish
    if (index < TOUR_STEPS.length - 1) {
      renderTourStep(index + 1);
    }
    return;
  }

  targetEl.classList.add('tour-highlight-active');

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
  badge.textContent = `Step ${index + 1} of ${TOUR_STEPS.length}`;
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
  TOUR_STEPS.forEach((_, i) => {
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
  nextBtn.textContent = index === TOUR_STEPS.length - 1 ? 'Got it! Finish' : 'Next →';
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

  // Measure card height
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

  // Constrain inside viewport
  left = Math.max(16, Math.min(viewportW - cardW - 16, left));
  top = Math.max(16, Math.min(viewportH - cardH - 16, top));

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.setAttribute('data-position', pos);

  // Position arrow toward target center
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const arrowX = Math.max(20, Math.min(cardW - 20, targetCenterX - left));
  arrow.style.setProperty('--arrow-x', `${arrowX}px`);
}
