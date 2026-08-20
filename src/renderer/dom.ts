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

export function toast(title: string, body: string, isAlert = false) {
  const toastsEl = $('toasts');
  if (!toastsEl) return;
  const node = el('div', `toast${isAlert ? ' toast--alert' : ''}`);
  node.append(el('div', 'toast__title', title));
  node.append(el('div', 'toast__body', body));
  toastsEl.append(node);
  setTimeout(() => node.remove(), 7000);
}

export const THEME_STYLES = ['minimalist', 'ableton', 'classic'];
export const MINIMALIST_ACCENTS = ['cyan', 'mint', 'lime', 'pink', 'mono'];
export const ABLETON_ACCENTS = ['mint', 'magenta', 'yellow', 'sky', 'lavender', 'amber', 'coral'];
export const CLASSIC_ACCENTS = ['green', 'blue', 'yellow', 'amber', 'red'];
export const ACCENTS = Array.from(new Set([...MINIMALIST_ACCENTS, ...ABLETON_ACCENTS, ...CLASSIC_ACCENTS]));
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
  const idx = Math.abs(hash) % ABLETON_CLIP_PALETTE.length;
  return ABLETON_CLIP_PALETTE[idx];
}

export function currentSurface(): 'dark' | 'light' | 'amoled' {
  if (document.body.classList.contains('theme-amoled')) return 'amoled';
  if (document.body.classList.contains('theme-light')) return 'light';
  return 'dark';
}

export function currentThemeStyle(): 'minimalist' | 'ableton' | 'classic' {
  const style = document.body.dataset.themeStyle;
  if (style === 'ableton') return 'ableton';
  if (style === 'classic') return 'classic';
  return 'minimalist';
}

export function applyAppearance(accent?: string, surface?: string, themeStyle?: string) {
  if (!themeStyle) {
    themeStyle = localStorage.getItem('dawBuddyThemeStyle') || 'minimalist';
  }
  if (!THEME_STYLES.includes(themeStyle)) themeStyle = 'minimalist';

  if (!accent) {
    accent = localStorage.getItem('dawBuddyAccent') || (themeStyle === 'minimalist' ? 'cyan' : (themeStyle === 'ableton' ? 'mint' : 'green'));
  }
  if (!ACCENTS.includes(accent)) {
    accent = themeStyle === 'minimalist' ? 'cyan' : (themeStyle === 'ableton' ? 'mint' : 'green');
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

  const themeToggleEl = $('themeToggle');
  const light = surface === 'light';
  if (themeToggleEl) {
    themeToggleEl.textContent = light ? 'Dark mode' : 'Light mode';
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
  if (minSwatches) minSwatches.hidden = themeStyle !== 'minimalist';
  if (abletonSwatches) abletonSwatches.hidden = themeStyle !== 'ableton';
  if (classicSwatches) classicSwatches.hidden = themeStyle !== 'classic';

  // Highlight active swatches and surface buttons
  document.querySelectorAll('.swatch').forEach((node: any) =>
    node.classList.toggle('is-on', node.getAttribute('data-accent') === accent)
  );
  document.querySelectorAll('#surfaceModes .surface-btn').forEach((node: any) =>
    node.classList.toggle('is-on', node.getAttribute('data-surface') === surface)
  );

  localStorage.setItem('dawBuddyThemeStyle', themeStyle);
  localStorage.setItem('dawBuddyAccent', accent);
  localStorage.setItem('dawBuddySurface', surface);
}
