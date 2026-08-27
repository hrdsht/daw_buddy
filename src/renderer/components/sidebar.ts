'use strict';

import { el, svgIcon } from '../dom';

const $ = (id: string): any => document.getElementById(id);

export interface SidebarContext {
  getEntries: () => any[];
  getRecords: () => Record<string, any>;
  getSettings: () => any;
  getFilterRoot: () => string | null;
  getFilterDaw: () => string | null;
  getFavOnly: () => boolean;
  setFilterRoot: (root: string | null) => void;
  setFilterDaw: (daw: string | null) => void;
  setFavOnly: (fav: boolean) => void;
  onNavigate: () => void;
  onOpenTour: () => void;
  onOpenTools: () => void;
  onOpenSettings: () => void;
}

export function initSidebar(ctx: SidebarContext) {
  const openTourBtn = $('openTour');
  const openToolsBtn = $('openTools');
  const openSettingsBtn = $('openSettings');

  if (openTourBtn) {
    openTourBtn.addEventListener('click', ctx.onOpenTour);
  }
  if (openToolsBtn) {
    openToolsBtn.addEventListener('click', ctx.onOpenTools);
  }
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', ctx.onOpenSettings);
  }
}

export function renderCollectionsNav(containerEl: HTMLElement, ctx: SidebarContext) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const entries = ctx.getEntries() || [];
  const records = ctx.getRecords() || {};
  const favOnly = ctx.getFavOnly();
  const filterRoot = ctx.getFilterRoot();
  const filterDaw = ctx.getFilterDaw();

  // All Projects
  const allItem = el('button', `collection-item${!favOnly && !filterRoot && !filterDaw ? ' is-active' : ''}`);
  allItem.append(svgIcon('disc', 'collection-icon'));
  allItem.append(el('span', 'collection-name', 'All Projects'));
  allItem.append(el('span', 'collection-count', String(entries.length)));
  allItem.addEventListener('click', () => {
    ctx.setFavOnly(false);
    ctx.setFilterRoot(null);
    ctx.setFilterDaw(null);
    ctx.onNavigate();
  });
  containerEl.append(allItem);

  // Favourites
  const favCount = entries.filter((e) => records[e.path] && records[e.path].fav).length;
  const favItem = el('button', `collection-item${favOnly ? ' is-active' : ''}`);
  favItem.append(svgIcon('star', 'collection-icon'));
  favItem.append(el('span', 'collection-name', 'Favourites'));
  favItem.append(el('span', 'collection-count', String(favCount)));
  favItem.addEventListener('click', () => {
    ctx.setFavOnly(true);
    ctx.setFilterRoot(null);
    ctx.setFilterDaw(null);
    ctx.onNavigate();
  });
  containerEl.append(favItem);

  // DAW Sections
  const dawCounts: Record<string, number> = {};
  entries.forEach((e) => {
    if (e.daw) {
      dawCounts[e.daw] = (dawCounts[e.daw] || 0) + 1;
    }
  });

  const daws = Object.keys(dawCounts).sort();
  if (daws.length > 0) {
    const dawsHeader = el('div', 'collection-header', 'DAWs');
    containerEl.append(dawsHeader);

    daws.forEach((d) => {
      const dawItem = el('button', `collection-item${filterDaw === d ? ' is-active' : ''}`);
      dawItem.append(svgIcon('folder', 'collection-icon'));
      dawItem.append(el('span', 'collection-name', d));
      dawItem.append(el('span', 'collection-count', String(dawCounts[d])));
      dawItem.addEventListener('click', () => {
        ctx.setFavOnly(false);
        ctx.setFilterRoot(null);
        ctx.setFilterDaw(d);
        ctx.onNavigate();
      });
      containerEl.append(dawItem);
    });
  }
}
