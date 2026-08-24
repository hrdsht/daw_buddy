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
  outputFolder?: string | null;
}

export function showRegionOnboardingModal(options: {
  currentRegion?: ScaleTraditionId;
  currentTraditions?: ScaleTraditionId[];
  initialOutputFolder?: string | null;
  isUpdateOrSettings?: boolean;
  onSave: (result: OnboardingResult) => void;
  playSynthNote?: (pc: number, octave: number, a4?: number) => void;
}) {
  const existingOverlay = document.getElementById('regionOnboardingOverlay');
  if (existingOverlay) existingOverlay.remove();

  let currentStep = 1; // 1 = Globe / Scales, 2 = Storage Setup
  let selectedRegion: ScaleTraditionId = options.currentRegion || 'indian'; // Default India
  let selectedTraditions: Set<ScaleTraditionId> = new Set(
    options.currentTraditions && options.currentTraditions.length > 0
      ? options.currentTraditions
      : ['all']
  );
  let chosenOutputFolder = options.initialOutputFolder || '';

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
    localStorage.setItem('dawBuddyRegionSetupVersion', '0.5.0-beta.3');
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

  // --- Body (Step 1 Container: Globe + Config Panel) ---
  const step1Body = document.createElement('div');
  step1Body.className = 'onboarding-body';

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

  step1Body.append(globeCol);

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
  step1Body.append(configCol);
  modal.append(step1Body);

  // --- Body (Step 2 Container: Storage & Output Setup) ---
  const step2Body = document.createElement('div');
  step2Body.className = 'onboarding-storage-body';
  step2Body.style.display = 'none';

  const storageHeader = document.createElement('div');
  storageHeader.className = 'onboarding-storage-header';
  storageHeader.innerHTML = `
    <div class="onboarding-storage-icon">💾</div>
    <div>
      <h3 class="onboarding-section__title" style="font-size: 16px; margin: 0;">Where should DAW Buddy save your rendered audio?</h3>
      <p style="font-size: 12.5px; color: var(--dim); margin: 4px 0 0 0;">Choose your central export directory. DAW Buddy will automatically create organized subfolders for each studio tool.</p>
    </div>
  `;
  step2Body.append(storageHeader);

  const pathCard = document.createElement('div');
  pathCard.className = 'onboarding-path-card';

  const pathDisplay = document.createElement('div');
  pathDisplay.className = 'onboarding-path-display';
  pathDisplay.innerHTML = `<span class="onboarding-path-icon">📁</span> <span class="onboarding-path-text">${chosenOutputFolder || 'Fetching default Music folder...'}</span>`;

  const browseBtn = document.createElement('button');
  browseBtn.className = 'pill pill--sm';
  browseBtn.innerHTML = '📂 Browse Folder';
  browseBtn.addEventListener('click', async () => {
    if (window.api && window.api.pickFolder) {
      const picked = await window.api.pickFolder();
      if (picked) {
        chosenOutputFolder = picked;
        updatePathDisplay();
      }
    }
  });

  pathCard.append(pathDisplay, browseBtn);
  step2Body.append(pathCard);

  function updatePathDisplay() {
    const textSpan = pathDisplay.querySelector('.onboarding-path-text');
    if (textSpan) textSpan.textContent = chosenOutputFolder;
  }

  // Subfolders Preview
  const foldersPreview = document.createElement('div');
  foldersPreview.className = 'onboarding-folders-preview';
  foldersPreview.innerHTML = `
    <div class="onboarding-folders-title">Automatic Subfolders Created in this Location:</div>
    <div class="onboarding-folders-grid">
      <div class="onboarding-folder-item"><span class="onboarding-folder-tag">📁 Format Converter/</span> <span class="onboarding-folder-desc">Split parts & audio format conversions</span></div>
      <div class="onboarding-folder-item"><span class="onboarding-folder-tag">📁 Slowed + Reverb/</span> <span class="onboarding-folder-desc">Rendered slowed & ambient masters</span></div>
      <div class="onboarding-folder-item"><span class="onboarding-folder-tag">📁 Audio Finishing/</span> <span class="onboarding-folder-desc">Normalised & fit WAV audio</span></div>
      <div class="onboarding-folder-item"><span class="onboarding-folder-tag">📁 Trimmed/</span> <span class="onboarding-folder-desc">Silence-stripped audio copies</span></div>
      <div class="onboarding-folder-item"><span class="onboarding-folder-tag">📁 Vocal Stems/</span> <span class="onboarding-folder-desc">Reconstructed vocal blocks</span></div>
    </div>
  `;
  step2Body.append(foldersPreview);
  modal.append(step2Body);

  // Initialize default music path if none provided
  if (!chosenOutputFolder && window.api && window.api.outputGetDefaultMusicPath) {
    window.api.outputGetDefaultMusicPath().then((defaultPath: string) => {
      if (defaultPath && !chosenOutputFolder) {
        chosenOutputFolder = defaultPath;
        updatePathDisplay();
      }
    });
  }

  // --- Footer Actions ---
  const footer = document.createElement('div');
  footer.className = 'onboarding-footer';

  const noteText = document.createElement('span');
  noteText.className = 'onboarding-footer__note';
  noteText.textContent = '💡 You can change your region and storage location anytime from Settings.';
  footer.append(noteText);

  const footerBtns = document.createElement('div');
  footerBtns.style.display = 'flex';
  footerBtns.style.gap = '8px';

  const backBtn = document.createElement('button');
  backBtn.className = 'pill pill--sm';
  backBtn.textContent = '← Back';
  backBtn.style.display = 'none';
  backBtn.addEventListener('click', () => {
    currentStep = 1;
    step1Body.style.display = 'flex';
    step2Body.style.display = 'none';
    backBtn.style.display = 'none';
    title.textContent = 'Welcome to DAW Buddy — Choose Your Tradition';
    subtitle.textContent = 'Select your home region to customize musical scale recommendations, or explore all rich musical traditions of the world.';
    nextOrSaveBtn.textContent = options.isUpdateOrSettings ? 'Save Preferences' : 'Next: Output Folder →';
  });

  const nextOrSaveBtn = document.createElement('button');
  nextOrSaveBtn.className = 'pill pill--solid onboarding-save-btn';
  nextOrSaveBtn.textContent = options.isUpdateOrSettings ? 'Save Preferences' : 'Next: Output Folder →';

  nextOrSaveBtn.addEventListener('click', () => {
    if (currentStep === 1 && !options.isUpdateOrSettings) {
      // Move to Step 2
      currentStep = 2;
      step1Body.style.display = 'none';
      step2Body.style.display = 'flex';
      backBtn.style.display = 'inline-flex';
      title.textContent = 'DAW Buddy Setup — Storage & Output Directory';
      subtitle.textContent = 'Confirm where rendered audio, conversions, and stems should be saved.';
      nextOrSaveBtn.textContent = 'Launch DAW Buddy 🚀';
      return;
    }

    // Save configuration
    const traditionsArray = selectedTraditions.has('all')
      ? ['all']
      : Array.from(selectedTraditions);

    options.onSave({
      region: selectedRegion,
      scaleTraditions: traditionsArray as ScaleTraditionId[],
      outputFolder: chosenOutputFolder || null
    });

    globe.destroy();
    overlay.classList.add('onboarding-overlay--closing');
    setTimeout(() => overlay.remove(), 250);
  });

  footerBtns.append(backBtn, nextOrSaveBtn);
  footer.append(footerBtns);
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

