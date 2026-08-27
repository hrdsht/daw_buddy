'use strict';

/**
 * Pure DOM creation, formatting, and UI presentation helpers.
 */

export const $ = (id: string): any => document.getElementById(id);

export function el(tag: string, className?: string | null, text?: any): any {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const BASIC_ICONS: Record<string, string> = {
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.2 18.2 21 12 17.8 5.8 21 7 14.2 2 9.3 8.9 8.3 12 2"/>'
};

export function svgIcon(name: string, className = 'coll__icon', size = 16) {
  const span = el('span', className);
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}" aria-hidden="true">${BASIC_ICONS[name] || ''}</svg>`;
  return span;
}

export function headRow(title: string, subtitle?: string | null) {
  const head = el('div', 'section__head');
  head.append(el('h3', null, title));
  if (subtitle) head.append(el('span', 'muted', subtitle));
  return head;
}

export function showSpinner(container: HTMLElement, title: string, body: string) {
  container.innerHTML = '';
  const wrap = el('div', 'empty');
  wrap.append(el('div', 'spinner'));
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  container.append(wrap);
}

export function renderEmpty(container: HTMLElement, title: string, body: string, onOpenSettings?: () => void) {
  const wrap = el('div', 'empty');
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  if (onOpenSettings) {
    const btn = el('button', 'pill pill--solid', 'Open settings');
    btn.addEventListener('click', onOpenSettings);
    wrap.append(btn);
  }
  container.append(wrap);
}

export function basename(p: string | null | undefined): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function shortName(p: string | null | undefined): string {
  return basename(p);
}

export function formatBpm(bpm: number | null | undefined): string {
  if (bpm === null || bpm === undefined) return '—';
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

export function formatTimeSignature(sig: string | null | undefined): string {
  if (!sig) return '—';
  return sig;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function timeAgo(ms: number | null | undefined): string {
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

export function toast(title: string, body: string, isAlert = false) {
  const toastsEl = $('toasts');
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

export const THEME_STYLES = ['minimalist', 'ableton', 'classic', 'bloo'];
export const MINIMALIST_ACCENTS = ['cyan', 'mint', 'lime', 'pink', 'mono'];
export const ABLETON_ACCENTS = ['mint', 'magenta', 'yellow', 'sky', 'lavender', 'amber', 'coral'];
export const CLASSIC_ACCENTS = ['green', 'blue', 'yellow', 'amber', 'red'];
export const BLOO_ACCENTS = ['bloo', 'cyan', 'sky', 'indigo', 'amber'];
export const ACCENTS = Array.from(new Set([...MINIMALIST_ACCENTS, ...ABLETON_ACCENTS, ...CLASSIC_ACCENTS, ...BLOO_ACCENTS]));
export const SURFACES = ['dark', 'light', 'amoled'];

export const ABLETON_CLIP_PALETTE = [
  { name: 'Solar Yellow', hex: '#ffdf33', ink: '#1a1600' },
  { name: 'Ochre Amber', hex: '#e06c1b', ink: '#ffffff' },
  { name: 'Coral Peach', hex: '#f78c80', ink: '#240a07' },
  { name: 'Hot Magenta', hex: '#ff2e93', ink: '#ffffff' },
  { name: 'Neon Mint', hex: '#00d699', ink: '#001f14' },
  { name: 'Electric Cyan', hex: '#00e5ff', ink: '#002026' },
  { name: 'Electric Sky', hex: '#29a9ff', ink: '#001529' },
  { name: 'Lavender Violet', hex: '#9d7aff', ink: '#110526' },
  { name: 'Lime Track', hex: '#9be62a', ink: '#142103' },
  { name: 'Warm Orange', hex: '#ff851b', ink: '#261100' },
  { name: 'Bubblegum Pink', hex: '#ff66b2', ink: '#2b0015' },
  { name: 'Deep Purple', hex: '#7952f5', ink: '#ffffff' },
  { name: 'Seafoam Green', hex: '#2ee6a8', ink: '#002619' },
  { name: 'Pastel Blue', hex: '#63b3ed', ink: '#081e2e' },
  { name: 'Goldenrod', hex: '#f6ad55', ink: '#281300' },
  { name: 'Teal Wave', hex: '#319795', ink: '#ffffff' }
];

export const ABLETON_PALETTE_GRID = [
  // Pastels & Neons (from Ableton track matrix)
  { name: 'Light Salmon', hex: '#ff9999', ink: '#2b0000' },
  { name: 'Warm Apricot', hex: '#ffaa55', ink: '#2b1100' },
  { name: 'Ochre Yellow', hex: '#d4aa00', ink: '#1f1600' },
  { name: 'Banana Yellow', hex: '#ffff66', ink: '#222200' },
  { name: 'Lime Green', hex: '#aaff00', ink: '#142100' },
  { name: 'Neon Green', hex: '#00ff33', ink: '#002607' },
  { name: 'Mint Seafoam', hex: '#00ff99', ink: '#002614' },
  { name: 'Electric Cyan', hex: '#00ffff', ink: '#002626' },
  { name: 'Sky Blue', hex: '#66ccff', ink: '#001a2b' },
  { name: 'Cornflower Blue', hex: '#6688ff', ink: '#ffffff' },
  { name: 'Soft Lavender', hex: '#bb99ff', ink: '#1a0d33' },
  { name: 'Hot Violet', hex: '#cc55ff', ink: '#ffffff' },
  { name: 'Bubblegum Pink', hex: '#ff66cc', ink: '#2b001a' },

  // Saturated & Deep Tones
  { name: 'Crimson Red', hex: '#ff3333', ink: '#ffffff' },
  { name: 'Flame Orange', hex: '#ff6600', ink: '#ffffff' },
  { name: 'Golden Amber', hex: '#e69900', ink: '#ffffff' },
  { name: 'Solar Yellow', hex: '#ffea00', ink: '#221e00' },
  { name: 'Chartreuse', hex: '#88dd00', ink: '#131e00' },
  { name: 'Forest Green', hex: '#00bb33', ink: '#ffffff' },
  { name: 'Teal Green', hex: '#00cc88', ink: '#002416' },
  { name: 'Turquoise', hex: '#00bbee', ink: '#00222b' },
  { name: 'Royal Cyan', hex: '#0088ff', ink: '#ffffff' },
  { name: 'Cobalt Blue', hex: '#0044ff', ink: '#ffffff' },
  { name: 'Deep Purple', hex: '#6622cc', ink: '#ffffff' },
  { name: 'Electric Magenta', hex: '#ee0088', ink: '#ffffff' },
  { name: 'Hot Pink', hex: '#ff0066', ink: '#ffffff' },

  // Studio Earth Tones
  { name: 'Coral Rose', hex: '#d96666', ink: '#ffffff' },
  { name: 'Terracotta', hex: '#d98855', ink: '#ffffff' },
  { name: 'Mustard', hex: '#c29944', ink: '#ffffff' },
  { name: 'Olive Green', hex: '#99aa44', ink: '#ffffff' },
  { name: 'Sage Green', hex: '#55aa77', ink: '#ffffff' },
  { name: 'Steel Blue', hex: '#5588aa', ink: '#ffffff' },
  { name: 'Iris Blue', hex: '#5566bb', ink: '#ffffff' },
  { name: 'Plum Violet', hex: '#8855aa', ink: '#ffffff' },
  { name: 'Berry Wine', hex: '#aa4477', ink: '#ffffff' }
];

export function getAbletonProjectColor(sessionPathOrName: string) {
  if (sessionPathOrName && sessionPathOrName.startsWith('#')) {
    return { name: 'Custom', hex: sessionPathOrName, ink: '#ffffff' };
  }
  let hash = 0;
  const str = sessionPathOrName || 'project';
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % ABLETON_PALETTE_GRID.length;
  return ABLETON_PALETTE_GRID[idx];
}

export function currentSurface(): 'dark' | 'light' | 'amoled' {
  if (document.body.classList.contains('theme-amoled')) return 'amoled';
  if (document.body.classList.contains('theme-light')) return 'light';
  return 'dark';
}

export function currentThemeStyle(): 'minimalist' | 'ableton' | 'classic' | 'bloo' {
  const style = document.body.dataset.themeStyle;
  if (style === 'ableton') return 'ableton';
  if (style === 'classic') return 'classic';
  if (style === 'bloo') return 'bloo';
  return 'minimalist';
}

export function applyAppearance(accent?: string, surface?: string, themeStyle?: string) {
  if (!themeStyle) {
    themeStyle = localStorage.getItem('dawBuddyThemeStyle') || 'minimalist';
  }
  if (!THEME_STYLES.includes(themeStyle)) themeStyle = 'minimalist';

  if (!accent) {
    accent = localStorage.getItem('dawBuddyAccent') || (themeStyle === 'minimalist' ? 'cyan' : (themeStyle === 'ableton' ? 'mint' : (themeStyle === 'bloo' ? 'bloo' : 'green')));
  }
  if (!ACCENTS.includes(accent)) {
    accent = themeStyle === 'minimalist' ? 'cyan' : (themeStyle === 'ableton' ? 'mint' : (themeStyle === 'bloo' ? 'bloo' : 'green'));
  }

  if (!surface) {
    surface = localStorage.getItem('dawBuddySurface') || 'dark';
  }
  if (!SURFACES.includes(surface)) surface = 'dark';

  document.body.dataset.themeStyle = themeStyle;
  document.body.dataset.accent = accent;
  document.body.classList.toggle('theme-light', surface === 'light');
  document.body.classList.toggle('theme-amoled', surface === 'amoled');
  document.body.classList.toggle('theme-classic', themeStyle === 'classic');
  document.body.classList.toggle('theme-minimalist', themeStyle === 'minimalist');
  document.body.classList.toggle('theme-ableton', themeStyle === 'ableton');
  document.body.classList.toggle('theme-bloo', themeStyle === 'bloo');

  const themeToggleEl = $('themeToggle');
  const light = surface === 'light';
  if (themeToggleEl) {
    const textSpan = themeToggleEl.querySelector('.theme-text');
    const label = light ? 'Dark mode' : 'Light mode';
    if (textSpan) {
      textSpan.textContent = label;
    } else {
      themeToggleEl.innerHTML = `<span class="theme-text">${label}</span><span class="pill-gear-hint" id="themeGearHint" title="Theme Lab (Right-click or click ⚙)">⚙</span>`;
    }
    themeToggleEl.setAttribute('aria-pressed', String(light));
  }

  // Update theme style buttons in settings
  document.querySelectorAll('#themeStyles .style-btn').forEach((node: any) =>
    node.classList.toggle('is-on', node.getAttribute('data-style') === themeStyle)
  );

  // Toggle swatch sets visibility
  const minSwatches = $('minimalistSwatches');
  const abletonSwatches = $('abletonSwatches');
  const classicSwatches = $('classicSwatches');
  const blooSwatches = $('blooSwatches');
  if (minSwatches) minSwatches.hidden = themeStyle !== 'minimalist';
  if (abletonSwatches) abletonSwatches.hidden = themeStyle !== 'ableton';
  if (classicSwatches) classicSwatches.hidden = themeStyle !== 'classic';
  if (blooSwatches) blooSwatches.hidden = themeStyle !== 'bloo';

  // Highlight active swatches and surface buttons
  const isAccentMatch = (btnAccent: string | null) => {
    if (!btnAccent || !accent) return false;
    if (btnAccent === accent) return true;
    if ((btnAccent === 'pink' && accent === 'magenta') || (btnAccent === 'magenta' && accent === 'pink')) return true;
    if ((btnAccent === 'mint' && accent === 'green') || (btnAccent === 'green' && accent === 'mint')) return true;
    if ((btnAccent === 'sky' && accent === 'blue') || (btnAccent === 'blue' && accent === 'sky')) return true;
    if ((btnAccent === 'coral' && accent === 'red') || (btnAccent === 'red' && accent === 'coral')) return true;
    if ((btnAccent === 'lavender' && accent === 'indigo') || (btnAccent === 'indigo' && accent === 'lavender')) return true;
    return false;
  };

  document.querySelectorAll('.swatch').forEach((node: any) =>
    node.classList.toggle('is-on', isAccentMatch(node.getAttribute('data-accent')))
  );
  document.querySelectorAll('#surfaceModes .surface-btn').forEach((node: any) =>
    node.classList.toggle('is-on', node.getAttribute('data-surface') === surface)
  );

  localStorage.setItem('dawBuddyThemeStyle', themeStyle);
  localStorage.setItem('dawBuddyAccent', accent);
  localStorage.setItem('dawBuddySurface', surface);

  applyThemeTuning();
}

export function applyThemeTuning(brightness?: number, contrast?: number) {
  if (brightness === undefined || isNaN(brightness)) {
    const saved = localStorage.getItem('dawBuddyBrightness');
    brightness = saved !== null ? Number(saved) : 100;
  }
  if (contrast === undefined || isNaN(contrast)) {
    const saved = localStorage.getItem('dawBuddyContrast');
    contrast = saved !== null ? Number(saved) : 100;
  }

  const bVal = Math.max(50, Math.min(150, Math.round(brightness)));
  const cVal = Math.max(50, Math.min(150, Math.round(contrast)));

  if (bVal === 100 && cVal === 100) {
    document.documentElement.removeAttribute('data-custom-filter');
    document.documentElement.style.removeProperty('--theme-brightness');
    document.documentElement.style.removeProperty('--theme-contrast');
  } else {
    document.documentElement.setAttribute('data-custom-filter', 'true');
    document.documentElement.style.setProperty('--theme-brightness', String(bVal / 100));
    document.documentElement.style.setProperty('--theme-contrast', String(cVal / 100));
  }

  localStorage.setItem('dawBuddyBrightness', String(bVal));
  localStorage.setItem('dawBuddyContrast', String(cVal));

  const bSlider = $('themeBrightnessSlider') as HTMLInputElement | null;
  const bText = $('themeBrightnessValue');
  if (bSlider) bSlider.value = String(bVal);
  if (bText) bText.textContent = `${bVal}%`;

  const cSlider = $('themeContrastSlider') as HTMLInputElement | null;
  const cText = $('themeContrastValue');
  if (cSlider) cSlider.value = String(cVal);
  if (cText) cText.textContent = `${cVal}%`;
}

/**
 * Detects FL Studio redundant bounce artifacts (Master and Current channels)
 */
export function isFlStudioArtifact(fname: string): boolean {
  if (!fname) return false;
  const base = fname.replace(/\.[^.]+$/, '').trim();
  return /(^|[_\s\-])(master|current)$/i.test(base);
}

/**
 * Formats stem category and sequential index based on selected naming format mode.
 */
export function formatStemOutputName(
  cat: string,
  sub: string | null,
  index: number,
  ext: string,
  formatMode: 'snake' | 'title' | 'padded' | 'hyphen' = 'snake',
  customName?: string | null,
  artistToken?: string | null
): string {
  if (customName) return customName;

  let base = cat;
  if (artistToken) {
    base = sub && sub !== 'lead' ? `${cat}_${artistToken}_${sub}` : `${cat}_${artistToken}`;
  } else if (sub) {
    base = `${cat}_${sub}`;
  }

  if (formatMode === 'title') {
    const titleBase = base
      .split(/[_-]+/)
      .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
      .filter(Boolean)
      .join(' ');
    return `${titleBase} ${index}${ext}`;
  }

  if (formatMode === 'padded') {
    const titleBase = base
      .split(/[_-]+/)
      .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
      .filter(Boolean)
      .join(' ');
    const paddedIndex = index < 10 ? `0${index}` : `${index}`;
    return `${titleBase} ${paddedIndex}${ext}`;
  }

  if (formatMode === 'hyphen') {
    const cleanBase = base.toLowerCase().replace(/_/g, '-');
    const paddedIndex = index < 10 ? `0${index}` : `${index}`;
    return `${cleanBase}-${paddedIndex}${ext}`;
  }

  // Default snake_case
  return `${base}_${index}${ext}`;
}
