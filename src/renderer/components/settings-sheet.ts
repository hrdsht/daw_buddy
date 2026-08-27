'use strict';

import {
  applyAppearance,
  applyThemeTuning,
  currentSurface,
  currentThemeStyle,
  THEME_STYLES,
  MINIMALIST_ACCENTS,
  ABLETON_ACCENTS,
  CLASSIC_ACCENTS,
  BLOO_ACCENTS,
  ACCENTS,
  SURFACES,
  toast
} from '../dom';
import {
  ScaleTraditionId,
  WORLD_REGIONS
} from '../world-scales';
import { showRegionOnboardingModal } from '../onboarding';

const $ = (id: string): any => document.getElementById(id);

export interface SettingsSheetContext {
  getSettings: () => any;
  updateSettings: (patch: Record<string, any>) => Promise<any>;
  onSettingsApplied: () => void;
  playSynthNote?: (pc: number, octave: number, a4?: number) => void;
}

export function initSettingsSheet(ctx: SettingsSheetContext) {
  const sheetEl = $('sheet');
  const scrimEl = $('scrim');
  const openBtn = $('openSettings');
  const closeBtn = $('closeSettings');

  const openSheet = () => {
    if (sheetEl) sheetEl.hidden = false;
    if (scrimEl) scrimEl.hidden = false;
  };

  const closeSheet = () => {
    if (sheetEl) sheetEl.hidden = true;
    if (scrimEl) scrimEl.hidden = true;
  };

  if (openBtn) openBtn.addEventListener('click', openSheet);
  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (scrimEl) scrimEl.addEventListener('click', closeSheet);

  // Appearance style buttons
  const styleContainer = $('themeStyles');
  if (styleContainer) {
    styleContainer.addEventListener('click', async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.style-btn') as HTMLElement;
      if (!btn || !btn.dataset.style) return;
      const newStyle = btn.dataset.style;
      const curAcc = document.body.dataset.accent || 'cyan';
      const curSurf = currentSurface();
      applyAppearance(curAcc, curSurf, newStyle);
      await ctx.updateSettings({ themeStyle: newStyle });
      ctx.onSettingsApplied();
    });
  }

  // Crash log toggles
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

  // GitHub update check
  const checkUpdatesBtn = $('checkUpdatesBtn');
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', () => {
      window.api.openExternal('https://github.com/hrdsht/daw_buddy/releases');
    });
  }

  // Regional Globe setup
  const openRegionGlobeBtn = $('openRegionGlobeSetup');
  if (openRegionGlobeBtn) {
    openRegionGlobeBtn.addEventListener('click', () => {
      const s = ctx.getSettings() || {};
      showRegionOnboardingModal({
        currentRegion: s.region || 'indian',
        currentTraditions: s.scaleTraditions || ['all'],
        isUpdateOrSettings: true,
        onSave: async (result) => {
          await ctx.updateSettings({
            region: result.region,
            scaleTraditions: result.scaleTraditions,
            regionSetupComplete: true
          });
          ctx.onSettingsApplied();
          toast('Preferences Updated', `Set region to ${result.region}`);
        },
        playSynthNote: ctx.playSynthNote
      });
    });
  }

  // Region dropdown
  const settingRegionSelectEl = $('settingRegionSelect') as HTMLSelectElement | null;
  if (settingRegionSelectEl) {
    settingRegionSelectEl.addEventListener('change', async () => {
      const newRegion = settingRegionSelectEl.value as ScaleTraditionId;
      await ctx.updateSettings({
        region: newRegion,
        regionSetupComplete: true
      });
      ctx.onSettingsApplied();
      const regObj = WORLD_REGIONS.find((r) => r.id === newRegion);
      toast('Region Updated', `Primary music region set to ${regObj ? regObj.name : newRegion}`);
    });
  }

  // Scale tradition dropdown
  const settingScaleTraditionSelectEl = $('settingScaleTraditionSelect') as HTMLSelectElement | null;
  if (settingScaleTraditionSelectEl) {
    settingScaleTraditionSelectEl.addEventListener('change', async () => {
      const val = settingScaleTraditionSelectEl.value;
      if (val === 'custom') {
        if (openRegionGlobeBtn) openRegionGlobeBtn.click();
        return;
      }
      const newTraditions = val === 'all' ? ['all'] : [val as ScaleTraditionId];
      await ctx.updateSettings({
        scaleTraditions: newTraditions,
        regionSetupComplete: true
      });
      ctx.onSettingsApplied();
      const label = val === 'western' ? 'Western Scales Only' : val === 'all' ? 'All World Traditions' : `${val} traditions`;
      toast('Scale Suggestions Updated', `Suggestions set to ${label}`);
    });
  }

  return { openSheet, closeSheet };
}
