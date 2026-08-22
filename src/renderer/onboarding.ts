'use strict';

/**
 * Onboarding & Regional Scale Setup Wizard
 * 
 * Displays an interactive 3D Globe with regional selection, scale suggestion
 * preferences, and cultural audio previews on first launch or upon manual trigger.
 */

import { InteractiveGlobe } from './globe';
import {
  ScaleTraditionId,
  WORLD_REGIONS,
  WORLD_SCALES_DATABASE,
  WorldRegion,
  generateWorldScaleMidi
} from './world-scales';

export interface OnboardingResult {
  region: ScaleTraditionId;
  scaleTraditions: ScaleTraditionId[];
}

export function showRegionOnboardingModal(options: {
  currentRegion?: ScaleTraditionId;
  currentTraditions?: ScaleTraditionId[];
  isUpdateOrSettings?: boolean;
  onSave: (result: OnboardingResult) => void;
  playSynthNote?: (pc: number, octave: number, a4?: number) => void;
}) {
  const existingOverlay = document.getElementById('regionOnboardingOverlay');
  if (existingOverlay) existingOverlay.remove();

  let selectedRegion: ScaleTraditionId = options.currentRegion || 'indian'; // Default India as requested
  let selectedTraditions: Set<ScaleTraditionId> = new Set(
    options.currentTraditions && options.currentTraditions.length > 0
      ? options.currentTraditions
      : ['all']
  );

  const overlay = document.createElement('div');
  overlay.id = 'regionOnboardingOverlay';
  overlay.className = 'onboarding-overlay';

  const modal = document.createElement('div');
  modal.className = 'onboarding-modal';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'onboarding-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'onboarding-header__title-row';

  const title = document.createElement('h2');
  title.className = 'onboarding-header__title';
  title.textContent = options.isUpdateOrSettings
    ? 'Musical Traditions & Regional Scales'
    : 'Welcome to DAW Buddy — Choose Your Tradition';
  titleRow.append(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'onboarding-header__close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', () => {
    localStorage.setItem('dawBuddyRegionSetupComplete', 'true');
    localStorage.setItem('dawBuddyRegionSetupVersion', '0.4.9-beta');
    globe.destroy();
    overlay.remove();
  });
  titleRow.append(closeBtn);

  const subtitle = document.createElement('p');
  subtitle.className = 'onboarding-header__subtitle';
  subtitle.textContent =
    'Select your home region to customize musical scale recommendations, or explore all rich musical traditions of the world.';

  header.append(titleRow, subtitle);
  modal.append(header);

  // --- Body (Globe + Config Panel) ---
  const body = document.createElement('div');
  body.className = 'onboarding-body';

  // Left Column: 3D Interactive Globe
  const globeCol = document.createElement('div');
  globeCol.className = 'onboarding-globe-col';

  const globeContainer = document.createElement('div');
  globeContainer.className = 'onboarding-globe-wrapper';
  globeCol.append(globeContainer);

  const globeHint = document.createElement('div');
  globeHint.className = 'onboarding-globe-hint';
  globeHint.innerHTML = '<span>🌐 Drag to spin 3D globe</span> · <span>Click any pin to select</span>';
  globeCol.append(globeHint);

  const globe = new InteractiveGlobe({
    container: globeContainer,
    size: 340,
    initialRegion: selectedRegion,
    onSelectRegion: (region) => {
      selectedRegion = region.id;
      updateRegionSelectionUI();
    }
  });

  body.append(globeCol);

  // Right Column: Regional Selector & Scale System Preferences
  const configCol = document.createElement('div');
  configCol.className = 'onboarding-config-col';

  // Section 1: Region Cards
  const regionSection = document.createElement('div');
  regionSection.className = 'onboarding-section';

  const regionTitle = document.createElement('h3');
  regionTitle.className = 'onboarding-section__title';
  regionTitle.textContent = '1. Select Your Region';
  regionSection.append(regionTitle);

  const regionGrid = document.createElement('div');
  regionGrid.className = 'onboarding-region-grid';

  WORLD_REGIONS.forEach((reg) => {
    const card = document.createElement('button');
    card.className = `onboarding-region-card ${reg.id === selectedRegion ? 'onboarding-region-card--active' : ''}`;
    card.dataset.regionId = reg.id;

    const top = document.createElement('div');
    top.className = 'onboarding-region-card__top';
    top.innerHTML = `<span class="onboarding-region-flag">${reg.flag}</span> <span class="onboarding-region-name">${reg.name}</span>`;
    card.append(top);

    const desc = document.createElement('div');
    desc.className = 'onboarding-region-desc';
    desc.textContent = reg.description;
    card.append(desc);

    card.addEventListener('click', () => {
      selectedRegion = reg.id;
      globe.flyToRegion(reg.id, true);
      updateRegionSelectionUI();
    });

    regionGrid.append(card);
  });

  regionSection.append(regionGrid);
  configCol.append(regionSection);

  // Section 2: Scale Suggestion Systems
  const scaleSection = document.createElement('div');
  scaleSection.className = 'onboarding-section';

  const scaleTitle = document.createElement('h3');
  scaleTitle.className = 'onboarding-section__title';
  scaleTitle.textContent = '2. What Scales Should Be Suggested in Your DAW?';
  scaleSection.append(scaleTitle);

  const scaleOptions = document.createElement('div');
  scaleOptions.className = 'onboarding-scale-options';

  const presetRow = document.createElement('div');
  presetRow.className = 'onboarding-presets-row';
  presetRow.style.display = 'flex';
  presetRow.style.gap = '8px';
  presetRow.style.flexWrap = 'wrap';

  const presetAllBtn = document.createElement('button');
  presetAllBtn.className = `onboarding-pill ${selectedTraditions.has('all') ? 'onboarding-pill--active' : ''}`;
  presetAllBtn.style.flex = '1';
  presetAllBtn.innerHTML = '✨ <strong>All World Traditions</strong> (Global)';
  presetAllBtn.addEventListener('click', () => {
    selectedTraditions = new Set(['all']);
    updateScaleSelectionUI();
  });

  const presetWesternBtn = document.createElement('button');
  const isOnlyWestern = selectedTraditions.size === 1 && selectedTraditions.has('western') && !selectedTraditions.has('all');
  presetWesternBtn.className = `onboarding-pill ${isOnlyWestern ? 'onboarding-pill--active' : ''}`;
  presetWesternBtn.style.flex = '1';
  presetWesternBtn.innerHTML = '🌐 <strong>Western Only</strong> (Major, Minor, Modes, Blues)';
  presetWesternBtn.addEventListener('click', () => {
    selectedTraditions = new Set(['western']);
    updateScaleSelectionUI();
  });

  presetRow.append(presetAllBtn, presetWesternBtn);
  scaleOptions.append(presetRow);

  const checkboxesWrapper = document.createElement('div');
  checkboxesWrapper.className = 'onboarding-checkbox-grid';

  const traditionChoices: { id: ScaleTraditionId; label: string; icon: string }[] = [
    { id: 'indian', label: 'Indian Classical (Raagas & Thaats)', icon: '🇮🇳' },
    { id: 'arabic', label: 'Arabic & Egyptian (Maqamat)', icon: '🇪🇬' },
    { id: 'chinese', label: 'Chinese & East Asian (5 Pentatonic Modes)', icon: '🇨🇳' },
    { id: 'western', label: 'Western Classical, Modes & Jazz', icon: '🌐' },
    { id: 'mediterranean', label: 'Mediterranean & Spanish Flamenco', icon: '🇪🇸' },
    { id: 'celtic', label: 'Celtic & Nordic Folk', icon: '🇮🇪' }
  ];

  traditionChoices.forEach((t) => {
    const labelEl = document.createElement('label');
    labelEl.className = 'onboarding-checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = t.id;
    checkbox.checked = selectedTraditions.has('all') || selectedTraditions.has(t.id);

    checkbox.addEventListener('change', () => {
      if (selectedTraditions.has('all')) {
        selectedTraditions = new Set(traditionChoices.map((tc) => tc.id));
      }
      if (checkbox.checked) {
        selectedTraditions.add(t.id);
      } else {
        selectedTraditions.delete(t.id);
      }
      if (selectedTraditions.size === 0) {
        selectedTraditions.add('western'); // Fallback
      }
      updateScaleSelectionUI();
    });

    labelEl.append(checkbox, document.createTextNode(` ${t.icon} ${t.label}`));
    checkboxesWrapper.append(labelEl);
  });

  scaleOptions.append(checkboxesWrapper);
  scaleSection.append(scaleOptions);
  configCol.append(scaleSection);

  // Section 3: Live Preview & Audition
  const previewSection = document.createElement('div');
  previewSection.className = 'onboarding-preview-section';

  const previewInfo = document.createElement('div');
  previewInfo.className = 'onboarding-preview-info';
  previewSection.append(previewInfo);

  const auditionBtn = document.createElement('button');
  auditionBtn.className = 'pill pill--sm onboarding-audition-btn';
  auditionBtn.innerHTML = '▶ Audition Selected Tradition';
  auditionBtn.addEventListener('click', () => {
    playTraditionSample(selectedRegion, options.playSynthNote);
  });
  previewSection.append(auditionBtn);

  configCol.append(previewSection);
  body.append(configCol);
  modal.append(body);

  // --- Footer Actions ---
  const footer = document.createElement('div');
  footer.className = 'onboarding-footer';

  const noteText = document.createElement('span');
  noteText.className = 'onboarding-footer__note';
  noteText.textContent = '💡 You can change your region and scale preferences anytime from Settings.';
  footer.append(noteText);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'pill pill--solid onboarding-save-btn';
  saveBtn.textContent = options.isUpdateOrSettings ? 'Save Preferences' : 'Launch DAW Buddy';
  saveBtn.addEventListener('click', () => {
    const traditionsArray = selectedTraditions.has('all')
      ? ['all']
      : Array.from(selectedTraditions);

    options.onSave({
      region: selectedRegion,
      scaleTraditions: traditionsArray as ScaleTraditionId[]
    });

    globe.destroy();
    overlay.classList.add('onboarding-overlay--closing');
    setTimeout(() => overlay.remove(), 250);
  });

  footer.append(saveBtn);
  modal.append(footer);
  overlay.append(modal);
  document.body.append(overlay);

  function updateRegionSelectionUI() {
    regionGrid.querySelectorAll('.onboarding-region-card').forEach((card: any) => {
      if (card.dataset.regionId === selectedRegion) {
        card.classList.add('onboarding-region-card--active');
      } else {
        card.classList.remove('onboarding-region-card--active');
      }
    });

    const activeReg = WORLD_REGIONS.find((r) => r.id === selectedRegion) || WORLD_REGIONS[0];
    previewInfo.innerHTML = `<strong>Selected: ${activeReg.flag} ${activeReg.name}</strong> · <em>${activeReg.sampleInstruments.join(', ')}</em>`;
  }

  function updateScaleSelectionUI() {
    const isAll = selectedTraditions.has('all');
    const isOnlyWestern = selectedTraditions.size === 1 && selectedTraditions.has('western') && !isAll;

    if (isAll) {
      presetAllBtn.classList.add('onboarding-pill--active');
      presetWesternBtn.classList.remove('onboarding-pill--active');
      checkboxesWrapper.querySelectorAll('input').forEach((input) => {
        input.checked = true;
      });
    } else {
      presetAllBtn.classList.remove('onboarding-pill--active');
      if (isOnlyWestern) {
        presetWesternBtn.classList.add('onboarding-pill--active');
      } else {
        presetWesternBtn.classList.remove('onboarding-pill--active');
      }
      checkboxesWrapper.querySelectorAll('input').forEach((input) => {
        input.checked = selectedTraditions.has(input.value as ScaleTraditionId);
      });
    }
  }

  updateRegionSelectionUI();
  updateScaleSelectionUI();
}

function playTraditionSample(
  regionId: ScaleTraditionId,
  playSynthNote?: (pc: number, octave: number, a4?: number) => void
) {
  if (!playSynthNote) return;

  const sampleScale =
    WORLD_SCALES_DATABASE.find((s) => s.tradition === regionId) || WORLD_SCALES_DATABASE[0];
  const phrase = sampleScale.ascendingPhrase || sampleScale.degrees;

  phrase.forEach((interval, idx) => {
    setTimeout(() => {
      const pc = (0 + interval) % 12;
      const oct = 4 + Math.floor(interval / 12);
      playSynthNote(pc, oct, 440);
    }, idx * 190);
  });
}
