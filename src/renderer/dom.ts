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

export const THEME_STYLES = ['minimalist', 'classic'];
export const MINIMALIST_ACCENTS = ['cyan', 'mint', 'lime', 'pink', 'mono'];
export const CLASSIC_ACCENTS = ['green', 'blue', 'yellow', 'amber', 'red'];
export const ACCENTS = [...MINIMALIST_ACCENTS, ...CLASSIC_ACCENTS];
export const SURFACES = ['dark', 'light', 'amoled'];

export function currentSurface(): 'dark' | 'light' | 'amoled' {
  if (document.body.classList.contains('theme-amoled')) return 'amoled';
  if (document.body.classList.contains('theme-light')) return 'light';
  return 'dark';
}

export function currentThemeStyle(): 'minimalist' | 'classic' {
  return document.body.dataset.themeStyle === 'classic' ? 'classic' : 'minimalist';
}

export function applyAppearance(accent?: string, surface?: string, themeStyle?: string) {
  if (!themeStyle) {
    themeStyle = localStorage.getItem('dawBuddyThemeStyle') || 'minimalist';
  }
  if (!THEME_STYLES.includes(themeStyle)) themeStyle = 'minimalist';

  if (!accent) {
    accent = localStorage.getItem('dawBuddyAccent') || (themeStyle === 'minimalist' ? 'cyan' : 'green');
  }
  if (!ACCENTS.includes(accent)) {
    accent = themeStyle === 'minimalist' ? 'cyan' : 'green';
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
  const classicSwatches = $('classicSwatches');
  if (minSwatches) minSwatches.hidden = themeStyle !== 'minimalist';
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
