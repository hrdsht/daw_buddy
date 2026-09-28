'use strict';

/**
 * BPM Tap Tempo & Delay Calculator Engine
 *
 * Supports:
 * - Tap Tempo with outlier rejection & jitter filtering
 * - Fractional delay calculations with selectable numerator & denominator (e.g. 1/4, 1/8, 1/256)
 * - Straight, Dotted, and Triplet note modifications
 * - Millisecond (ms), Second (s), Frequency (Hz), and Sample conversions (44.1k, 48k, 96k)
 * - Interactive cheat sheet matrix for instant reference
 */

export type DelayModifier = 'straight' | 'dotted' | 'triplet';

export interface TapCalculationResult {
  bpm: number;
  confidence: 'low' | 'med' | 'high';
  count: number;
  avgIntervalMs: number;
}

export interface DelayTimeResult {
  bpm: number;
  numerator: number;
  denominator: number;
  modifier: DelayModifier;
  ms: number;
  seconds: number;
  hz: number;
  samples44k: number;
  samples48k: number;
  samples96k: number;
}

export interface DelayTableRow {
  fractionLabel: string;
  denominator: number;
  straightMs: number;
  dottedMs: number;
  tripletMs: number;
  hz: number;
}

export const SUPPORTED_DENOMINATORS: number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];
export const COMMON_NUMERATORS: number[] = [1, 2, 3, 4, 5, 7, 8, 16];

/**
 * Calculates delay time in milliseconds for any fraction N/D at a given BPM.
 *
 * Standard formula:
 * Whole note (1/1) = 4 beats = 240,000 / BPM ms.
 * Quarter note (1/4) = 1 beat = 60,000 / BPM ms.
 * Any fraction (N/D) = (N/D) * (240,000 / BPM) = (60,000 / BPM) * (4 * N / D) ms.
 *
 * Modifiers:
 * - Straight: factor 1.0
 * - Dotted: factor 1.5 (3/2)
 * - Triplet: factor 2/3 (0.666667)
 */
export function calculateDelayMs(
  bpm: number,
  numerator: number = 1,
  denominator: number = 4,
  modifier: DelayModifier = 'straight'
): number {
  const safeBpm = Math.max(1, Math.min(999, isNaN(bpm) ? 120 : bpm));
  const safeNum = Math.max(1, Math.min(256, isNaN(numerator) ? 1 : Math.round(numerator)));
  const safeDenom = Math.max(1, Math.min(1024, isNaN(denominator) ? 4 : Math.round(denominator)));

  // Base straight delay in milliseconds
  const beatMs = 60000 / safeBpm;
  const straightMs = beatMs * ((4 * safeNum) / safeDenom);

  let factor = 1.0;
  if (modifier === 'dotted') {
    factor = 1.5;
  } else if (modifier === 'triplet') {
    factor = 2 / 3;
  }

  const result = straightMs * factor;
  return Math.round(result * 1000) / 1000;
}

/**
 * Calculates frequency in Hertz (Hz) corresponding to a delay period in milliseconds.
 * Useful for LFO rates, chorus/flanger sync, and modulation sweeps.
 */
export function calculateHz(ms: number): number {
  if (ms <= 0) return 0;
  const hz = 1000 / ms;
  return Math.round(hz * 1000) / 1000;
}

/**
 * Calculates the number of audio samples corresponding to a millisecond duration.
 */
export function calculateSamples(ms: number, sampleRate: number): number {
  if (ms <= 0 || sampleRate <= 0) return 0;
  return Math.round((ms / 1000) * sampleRate);
}

/**
 * Formats milliseconds for clean display (e.g., 500.00 ms or 7.81 ms).
 */
export function formatMs(ms: number): string {
  if (isNaN(ms) || ms < 0) return '0.00 ms';
  if (ms >= 100) {
    return ms.toFixed(1) + ' ms';
  } else if (ms >= 10) {
    return ms.toFixed(2) + ' ms';
  } else {
    return ms.toFixed(3) + ' ms';
  }
}

/**
 * Formats Hertz for clean display (e.g., 2.00 Hz or 128.00 Hz).
 */
export function formatHz(hz: number): string {
  if (isNaN(hz) || hz < 0) return '0.00 Hz';
  if (hz >= 100) return hz.toFixed(1) + ' Hz';
  return hz.toFixed(2) + ' Hz';
}
 
/**
 * Increments or decrements either the integer or decimal portion of a BPM value.
 * Scrolling over the decimal portion is clamped between 0 and 9 and will NEVER carry over to the integer.
 * e.g. 104.9 + 0.1 decimal step stays at 104.9 (does not roll over to 105).
 */
export function stepBpmDigit(bpm: number, target: 'int' | 'dec', delta: number): number {
  const safeBpm = isNaN(bpm) ? 120 : bpm;
  const intPart = Math.floor(safeBpm);
  const currentDec = Math.round((safeBpm - intPart) * 10);
  if (target === 'int') {
    const newInt = Math.max(20, Math.min(400, intPart + delta));
    return Math.round((newInt + currentDec / 10) * 10) / 10;
  } else {
    const newDec = Math.max(0, Math.min(9, currentDec + delta));
    return Math.round((intPart + newDec / 10) * 10) / 10;
  }
}

/**
 * Full calculation bundle for a specific setting.
 */
export function getDelayDetails(
  bpm: number,
  numerator: number = 1,
  denominator: number = 4,
  modifier: DelayModifier = 'straight'
): DelayTimeResult {
  const ms = calculateDelayMs(bpm, numerator, denominator, modifier);
  const seconds = Math.round((ms / 1000) * 10000) / 10000;
  const hz = calculateHz(ms);
  const samples44k = calculateSamples(ms, 44100);
  const samples48k = calculateSamples(ms, 48000);
  const samples96k = calculateSamples(ms, 96000);

  return {
    bpm,
    numerator,
    denominator,
    modifier,
    ms,
    seconds,
    hz,
    samples44k,
    samples48k,
    samples96k
  };
}

/**
 * Generates reference matrix table of common note divisions for the given BPM.
 */
export function getQuickDelayTable(bpm: number): DelayTableRow[] {
  const rows: DelayTableRow[] = [];
  const denominators = SUPPORTED_DENOMINATORS;

  for (const denom of denominators) {
    const straight = calculateDelayMs(bpm, 1, denom, 'straight');
    const dotted = calculateDelayMs(bpm, 1, denom, 'dotted');
    const triplet = calculateDelayMs(bpm, 1, denom, 'triplet');
    const hz = calculateHz(straight);

    rows.push({
      fractionLabel: `1/${denom}`,
      denominator: denom,
      straightMs: straight,
      dottedMs: dotted,
      tripletMs: triplet,
      hz
    });
  }

  return rows;
}

/**
 * Computes BPM from an array of tap timestamps (performance.now or Date.now).
 * Filters jitter and computes moving average.
 */
export function calculateBpmFromTaps(tapTimes: number[]): TapCalculationResult | null {
  if (!tapTimes || tapTimes.length < 2) {
    return null;
  }

  // Calculate delta intervals between consecutive taps
  const intervals: number[] = [];
  for (let i = 1; i < tapTimes.length; i++) {
    const dt = tapTimes[i] - tapTimes[i - 1];
    // Ignore absurd intervals (< 100ms or > 2500ms)
    if (dt >= 100 && dt <= 2500) {
      intervals.push(dt);
    }
  }

  if (intervals.length === 0) {
    return null;
  }

  // If we have >= 4 intervals, trim extreme outliers (max & min)
  let cleanIntervals = intervals.slice();
  if (cleanIntervals.length >= 4) {
    const sorted = [...cleanIntervals].sort((a, b) => a - b);
    cleanIntervals = sorted.slice(1, sorted.length - 1);
  }

  const avgIntervalMs = cleanIntervals.reduce((sum, v) => sum + v, 0) / cleanIntervals.length;
  if (avgIntervalMs <= 0) return null;

  const rawBpm = 60000 / avgIntervalMs;
  const bpm = Math.round(rawBpm * 10) / 10;
  const clampedBpm = Math.max(20, Math.min(400, bpm));

  let confidence: 'low' | 'med' | 'high' = 'low';
  if (intervals.length >= 4) {
    confidence = 'high';
  } else if (intervals.length >= 2) {
    confidence = 'med';
  }

  return {
    bpm: clampedBpm,
    confidence,
    count: tapTimes.length,
    avgIntervalMs: Math.round(avgIntervalMs * 10) / 10
  };
}

/**
 * Interactive Tap Tempo Engine state manager.
 */
export class TapTempoEngine {
  private taps: number[] = [];
  private maxIdleMs: number = 2500;
  private maxTapsToKeep: number = 10;

  public tap(timestamp: number = performance.now()): TapCalculationResult | null {
    if (this.taps.length > 0) {
      const last = this.taps[this.taps.length - 1];
      if (timestamp - last > this.maxIdleMs) {
        // Reset sequence if user paused
        this.taps = [];
      }
    }

    this.taps.push(timestamp);
    if (this.taps.length > this.maxTapsToKeep) {
      this.taps.shift();
    }

    return calculateBpmFromTaps(this.taps);
  }

  public reset(): void {
    this.taps = [];
  }

  public getTapCount(): number {
    return this.taps.length;
  }
}

export interface BpmToolOptions {
  onSearchBpm?: (bpm: number) => void;
  getActiveProjectBpm?: () => number | null;
}

/**
 * Controller connecting the DOM with the BPM Tap and Delay engine.
 */
export class BpmToolController {
  private currentBpm: number = 120.0;
  private currentNumerator: number = 1;
  private currentDenominator: number = 4;
  private currentModifier: DelayModifier = 'straight';
  private tapEngine = new TapTempoEngine();
  private pulseTimer: any = null;
  private audioCtx: any = null;
  private options: BpmToolOptions;

  // DOM Elements
  private btn: HTMLButtonElement | null = null;
  private badge: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private resetBtn: HTMLButtonElement | null = null;
  private intDisplay: HTMLElement | null = null;
  private decDisplay: HTMLElement | null = null;
  private statusMsg: HTMLElement | null = null;
  private pulseDot: HTMLElement | null = null;
  private tapBtn: HTMLButtonElement | null = null;
  private tapCounter: HTMLElement | null = null;
  private directInput: HTMLInputElement | null = null;
  private halfBtn: HTMLButtonElement | null = null;
  private doubleBtn: HTMLButtonElement | null = null;
  private copyBpmBtn: HTMLButtonElement | null = null;
  private searchFilterBtn: HTMLButtonElement | null = null;
  private projectSyncWrap: HTMLElement | null = null;
  private projectSyncVal: HTMLElement | null = null;
  private syncProjectBtn: HTMLButtonElement | null = null;
  private numSelect: HTMLSelectElement | null = null;
  private denomSelect: HTMLSelectElement | null = null;
  private resultCard: HTMLElement | null = null;
  private resultMs: HTMLElement | null = null;
  private resultSec: HTMLElement | null = null;
  private resultHz: HTMLElement | null = null;
  private fractionBadge: HTMLElement | null = null;
  private copyMsBtn: HTMLButtonElement | null = null;
  private copyHint: HTMLElement | null = null;
  private samples44k: HTMLElement | null = null;
  private samples48k: HTMLElement | null = null;
  private samples96k: HTMLElement | null = null;
  private matrixBody: HTMLElement | null = null;
  private scrollDisplay: HTMLElement | null = null;
  private scrollInt: HTMLElement | null = null;
  private scrollDot: HTMLElement | null = null;
  private scrollDec: HTMLElement | null = null;

  constructor(options: BpmToolOptions = {}) {
    this.options = options;
  }

  public init(): void {
    if (typeof document === 'undefined') return;

    this.btn = document.getElementById('bpmToolBtn') as HTMLButtonElement;
    this.badge = document.getElementById('bpmPillBadge');
    this.panel = document.getElementById('bpmToolPanel');
    if (!this.btn || !this.panel) return;

    this.closeBtn = document.getElementById('bpmPanelCloseBtn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('bpmPanelResetBtn') as HTMLButtonElement;
    this.intDisplay = document.getElementById('bpmDisplayInteger');
    this.decDisplay = document.getElementById('bpmDisplayDecimal');
    this.statusMsg = document.getElementById('bpmStatusMsg');
    this.pulseDot = document.getElementById('bpmPulseDot');
    this.tapBtn = document.getElementById('bpmTapBtn') as HTMLButtonElement;
    this.tapCounter = document.getElementById('bpmTapCounter');
    this.scrollDisplay = document.getElementById('bpmScrollDisplay');
    this.scrollInt = document.getElementById('bpmScrollInt');
    this.scrollDot = document.getElementById('bpmScrollDot');
    this.scrollDec = document.getElementById('bpmScrollDec');
    this.directInput = document.getElementById('bpmDirectInput') as HTMLInputElement;
    this.halfBtn = document.getElementById('bpmHalfBtn') as HTMLButtonElement;
    this.doubleBtn = document.getElementById('bpmDoubleBtn') as HTMLButtonElement;
    this.copyBpmBtn = document.getElementById('bpmCopyBpmBtn') as HTMLButtonElement;
    this.searchFilterBtn = document.getElementById('bpmSearchFilterBtn') as HTMLButtonElement;
    this.projectSyncWrap = document.getElementById('bpmProjectSyncWrap');
    this.projectSyncVal = document.getElementById('bpmProjectSyncVal');
    this.syncProjectBtn = document.getElementById('bpmSyncProjectBtn') as HTMLButtonElement;
    this.numSelect = document.getElementById('delayNumeratorSelect') as HTMLSelectElement;
    this.denomSelect = document.getElementById('delayDenominatorSelect') as HTMLSelectElement;
    this.resultCard = document.getElementById('delayResultCard');
    this.resultMs = document.getElementById('delayResultMs');
    this.resultSec = document.getElementById('delayResultSec');
    this.resultHz = document.getElementById('delayResultHz');
    this.fractionBadge = document.getElementById('delayFractionBadge');
    this.copyMsBtn = document.getElementById('delayCopyMsBtn') as HTMLButtonElement;
    this.copyHint = document.getElementById('delayCopyHint');
    this.samples44k = document.getElementById('delaySamples44k');
    this.samples48k = document.getElementById('delaySamples48k');
    this.samples96k = document.getElementById('delaySamples96k');
    this.matrixBody = document.getElementById('delayMatrixBody');

    this.bindEvents();
    this.updateAllUI();
  }

  private bindEvents(): void {
    // Open/Close toggle
    this.btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.resetBtn?.addEventListener('click', () => {
      this.setBpm(120.0);
      this.tapEngine.reset();
      if (this.statusMsg) this.statusMsg.textContent = 'Reset to 120.0 BPM';
      if (this.tapCounter) this.tapCounter.textContent = 'Tap rhythmically';
    });

    // Tap button
    this.tapBtn?.addEventListener('click', () => {
      this.handleTap();
    });

    // Steppers / Nudge buttons
    const nudgeBtns = this.panel?.querySelectorAll('[data-nudge]');
    nudgeBtns?.forEach((b) => {
      b.addEventListener('click', (e) => {
        const delta = parseFloat((e.currentTarget as HTMLElement).getAttribute('data-nudge') || '0');
        this.setBpm(this.currentBpm + delta);
      });
    });

    // Direct input
    this.directInput?.addEventListener('input', () => {
      const val = parseFloat(this.directInput?.value || '120');
      if (!isNaN(val) && val >= 20 && val <= 400) {
        this.currentBpm = val;
        this.updateBpmDisplay();
        this.updateDelayUI();
      }
    });

    // Wheel over integer (±1 BPM)
    const onWheelInt = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY < 0 ? 1 : -1;
      this.stepInteger(dir);
    };
    this.scrollInt?.addEventListener('wheel', onWheelInt as EventListener, { passive: false });
    this.intDisplay?.addEventListener('wheel', onWheelInt as EventListener, { passive: false });

    // Wheel over decimal (±0.1 BPM, strictly clamped .0 to .9, no carry-over to integer)
    const onWheelDec = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY < 0 ? 1 : -1;
      this.stepDecimal(dir);
    };
    this.scrollDec?.addEventListener('wheel', onWheelDec as EventListener, { passive: false });
    this.scrollDot?.addEventListener('wheel', onWheelDec as EventListener, { passive: false });
    this.decDisplay?.addEventListener('wheel', onWheelDec as EventListener, { passive: false });

    // Click on scrollDisplay to switch to typing directly
    this.scrollDisplay?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.scrollDisplay && this.directInput) {
        this.scrollDisplay.style.display = 'none';
        this.directInput.style.display = 'inline-block';
        this.directInput.focus();
        this.directInput.select();
      }
    });

    this.directInput?.addEventListener('blur', () => {
      if (this.scrollDisplay && this.directInput) {
        this.directInput.style.display = 'none';
        this.scrollDisplay.style.display = 'inline-flex';
      }
    });

    this.directInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        this.directInput?.blur();
      }
    });

    // Wheel support directly on input as well
    this.directInput?.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = this.directInput!.getBoundingClientRect();
        const isDecimalSide = e.clientX - rect.left > rect.width * 0.58;
        const dir = e.deltaY < 0 ? 1 : -1;
        if (isDecimalSide) {
          this.stepDecimal(dir);
        } else {
          this.stepInteger(dir);
        }
      },
      { passive: false }
    );

    // Half / Double
    this.halfBtn?.addEventListener('click', () => {
      this.setBpm(this.currentBpm / 2);
    });
    this.doubleBtn?.addEventListener('click', () => {
      this.setBpm(this.currentBpm * 2);
    });

    // Copy BPM
    this.copyBpmBtn?.addEventListener('click', () => {
      const bpmStr = this.currentBpm.toFixed(1).replace(/\.0$/, '');
      this.copyToClipboard(bpmStr, this.copyBpmBtn, '✓ Copied!');
    });

    // Search Filter
    this.searchFilterBtn?.addEventListener('click', () => {
      const bpmInt = Math.round(this.currentBpm);
      if (this.options.onSearchBpm) {
        this.options.onSearchBpm(bpmInt);
      } else {
        const searchInput = document.getElementById('search') as HTMLInputElement;
        if (searchInput) {
          searchInput.value = `bpm:${bpmInt}`;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.focus();
        }
      }
      this.close();
    });

    // Project sync button
    this.syncProjectBtn?.addEventListener('click', () => {
      const pBpm = this.options.getActiveProjectBpm ? this.options.getActiveProjectBpm() : null;
      if (pBpm && pBpm > 0) {
        this.setBpm(pBpm);
        if (this.statusMsg) this.statusMsg.textContent = `Synced to Project (${pBpm} BPM)`;
      }
    });

    // Modifier Pills (Straight, Dotted, Triplet)
    const modPills = this.panel?.querySelectorAll('[data-modifier]');
    modPills?.forEach((pill) => {
      pill.addEventListener('click', (e) => {
        const mod = (e.currentTarget as HTMLElement).getAttribute('data-modifier') as DelayModifier;
        if (mod) {
          this.currentModifier = mod;
          modPills.forEach((p) => p.classList.remove('is-active'));
          (e.currentTarget as HTMLElement).classList.add('is-active');
          this.updateDelayUI();
        }
      });
    });

    // Numerator Select
    this.numSelect?.addEventListener('change', () => {
      const val = parseInt(this.numSelect?.value || '1', 10);
      if (!isNaN(val)) {
        this.currentNumerator = val;
        this.syncNumeratorQuickPills();
        this.updateDelayUI();
      }
    });

    // Numerator Quick Pills
    const numPills = this.panel?.querySelectorAll('[data-num]');
    numPills?.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const num = parseInt((e.currentTarget as HTMLElement).getAttribute('data-num') || '1', 10);
        if (!isNaN(num)) {
          this.currentNumerator = num;
          if (this.numSelect) this.numSelect.value = String(num);
          this.syncNumeratorQuickPills();
          this.updateDelayUI();
        }
      });
    });

    // Denominator Select
    this.denomSelect?.addEventListener('change', () => {
      const val = parseInt(this.denomSelect?.value || '4', 10);
      if (!isNaN(val)) {
        this.currentDenominator = val;
        this.syncDenominatorQuickBar();
        this.updateDelayUI();
      }
    });

    // Denominator Quick Bar
    const denomBtns = this.panel?.querySelectorAll('[data-denom]');
    denomBtns?.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const denom = parseInt((e.currentTarget as HTMLElement).getAttribute('data-denom') || '4', 10);
        if (!isNaN(denom)) {
          this.currentDenominator = denom;
          if (this.denomSelect) this.denomSelect.value = String(denom);
          this.syncDenominatorQuickBar();
          this.updateDelayUI();
        }
      });
    });

    // Copy Result Ms
    this.copyMsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyCurrentDelayMs();
    });

    this.resultCard?.addEventListener('click', () => {
      this.copyCurrentDelayMs();
    });

    // Global keyboard shortcuts (Space / T to tap when open, Esc to close)
    document.addEventListener('keydown', (e) => {
      if (!this.panel || this.panel.hidden) return;

      if (e.key === 'Escape') {
        this.close();
        return;
      }

      // Ignore when user is typing in text inputs or selects
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      if (e.key === 't' || e.key === 'T' || e.key === ' ') {
        e.preventDefault();
        this.handleTap();
      }
    });

    // Outside click to close
    document.addEventListener('click', (e) => {
      if (
        this.panel &&
        !this.panel.hidden &&
        !this.panel.contains(e.target as Node) &&
        !this.btn?.contains(e.target as Node)
      ) {
        this.close();
      }
    });
  }

  public open(): void {
    if (!this.panel || !this.btn) return;

    // Check project BPM sync availability
    this.checkProjectBpm();

    this.panel.hidden = false;
    this.btn.classList.add('is-active');
    this.btn.setAttribute('aria-expanded', 'true');

    // Position panel relative to button
    const rect = this.btn.getBoundingClientRect();
    const panelWidth = 660;
    const padding = 16;
    let left = rect.left - 40;
    if (left + panelWidth > window.innerWidth - padding) {
      left = window.innerWidth - panelWidth - padding;
    }
    if (left < padding) left = padding;

    this.panel.style.top = `${rect.bottom + 8}px`;
    this.panel.style.left = `${left}px`;

    this.startPulse();
    this.tapBtn?.focus();
  }

  public close(): void {
    if (!this.panel || !this.btn) return;
    this.panel.hidden = true;
    this.btn.classList.remove('is-active');
    this.btn.setAttribute('aria-expanded', 'false');
    this.stopPulse();
  }

  public toggle(): void {
    if (!this.panel) return;
    if (this.panel.hidden) {
      this.open();
    } else {
      this.close();
    }
  }

  public setBpm(bpm: number): void {
    const clamped = Math.max(20, Math.min(400, Math.round(bpm * 10) / 10));
    this.currentBpm = clamped;
    this.updateAllUI();
    this.startPulse();
  }

  public stepInteger(deltaInt: number): void {
    this.setBpm(stepBpmDigit(this.currentBpm, 'int', deltaInt));
  }

  public stepDecimal(deltaDec: number): void {
    this.setBpm(stepBpmDigit(this.currentBpm, 'dec', deltaDec));
  }

  public getBpm(): number {
    return this.currentBpm;
  }

  private handleTap(): void {
    const result = this.tapEngine.tap();
    this.playTick();

    // Trigger visual pad animation
    if (this.tapBtn) {
      this.tapBtn.classList.remove('is-tapped');
      // Trigger reflow
      void this.tapBtn.offsetWidth;
      this.tapBtn.classList.add('is-tapped');
      setTimeout(() => this.tapBtn?.classList.remove('is-tapped'), 150);
    }

    if (this.pulseDot) {
      this.pulseDot.classList.add('is-pulsing');
      setTimeout(() => this.pulseDot?.classList.remove('is-pulsing'), 150);
    }

    if (result) {
      this.setBpm(result.bpm);
      const confLabel = result.confidence === 'high' ? 'Stable' : 'Locking in';
      if (this.statusMsg) {
        this.statusMsg.textContent = `${result.count} taps · ${result.bpm.toFixed(1)} BPM (${confLabel})`;
      }
      if (this.tapCounter) {
        this.tapCounter.textContent = `${result.count} taps recorded · ${result.avgIntervalMs} ms avg`;
      }
    } else {
      const count = this.tapEngine.getTapCount();
      if (this.statusMsg) {
        this.statusMsg.textContent = `Tap again to measure (${count}/4)...`;
      }
      if (this.tapCounter) {
        this.tapCounter.textContent = `Tap ${4 - count > 0 ? 4 - count : 1} more time(s)`;
      }
    }
  }

  private updateAllUI(): void {
    this.updateBpmDisplay();
    this.updateDelayUI();
  }

  private updateBpmDisplay(): void {
    const intPart = Math.floor(this.currentBpm);
    const decDigit = Math.round((this.currentBpm - intPart) * 10);
    const decPart = `.${decDigit}`;

    if (this.intDisplay) this.intDisplay.textContent = String(intPart);
    if (this.decDisplay) this.decDisplay.textContent = decPart;
    if (this.scrollInt) this.scrollInt.textContent = String(intPart);
    if (this.scrollDec) this.scrollDec.textContent = String(decDigit);
    if (this.directInput) this.directInput.value = this.currentBpm.toFixed(1);
    if (this.badge) this.badge.textContent = String(Math.round(this.currentBpm));
  }

  private updateDelayUI(): void {
    const details = getDelayDetails(
      this.currentBpm,
      this.currentNumerator,
      this.currentDenominator,
      this.currentModifier
    );

    if (this.resultMs) this.resultMs.textContent = details.ms.toFixed(2);
    if (this.resultSec) this.resultSec.textContent = `${details.seconds.toFixed(4)} s`;
    if (this.resultHz) this.resultHz.textContent = `${details.hz.toFixed(2)} Hz`;

    const modName = this.currentModifier.charAt(0).toUpperCase() + this.currentModifier.slice(1);
    if (this.fractionBadge) {
      this.fractionBadge.textContent = `${this.currentNumerator}/${this.currentDenominator} ${modName}`;
    }

    if (this.samples44k) this.samples44k.textContent = `${details.samples44k.toLocaleString()} spls`;
    if (this.samples48k) this.samples48k.textContent = `${details.samples48k.toLocaleString()} spls`;
    if (this.samples96k) this.samples96k.textContent = `${details.samples96k.toLocaleString()} spls`;

    this.renderMatrixTable();
  }

  private syncNumeratorQuickPills(): void {
    const pills = this.panel?.querySelectorAll('[data-num]');
    pills?.forEach((p) => {
      const n = parseInt(p.getAttribute('data-num') || '0', 10);
      if (n === this.currentNumerator) {
        p.classList.add('is-active');
      } else {
        p.classList.remove('is-active');
      }
    });
  }

  private syncDenominatorQuickBar(): void {
    const btns = this.panel?.querySelectorAll('[data-denom]');
    btns?.forEach((b) => {
      const d = parseInt(b.getAttribute('data-denom') || '0', 10);
      if (d === this.currentDenominator) {
        b.classList.add('is-active');
      } else {
        b.classList.remove('is-active');
      }
    });
  }

  private renderMatrixTable(): void {
    if (!this.matrixBody) return;
    const rows = getQuickDelayTable(this.currentBpm);

    let html = '';
    for (const r of rows) {
      const isSelected = r.denominator === this.currentDenominator && this.currentNumerator === 1;
      html += `
        <tr class="delay-matrix-row ${isSelected ? 'is-selected' : ''}" data-row-denom="${r.denominator}">
          <td class="delay-m-note"><strong>${r.fractionLabel}</strong></td>
          <td class="delay-m-val ${this.currentModifier === 'straight' && isSelected ? 'is-active-cell' : ''}" data-mod="straight" data-ms="${r.straightMs}">
            ${formatMs(r.straightMs)}
          </td>
          <td class="delay-m-val ${this.currentModifier === 'dotted' && isSelected ? 'is-active-cell' : ''}" data-mod="dotted" data-ms="${r.dottedMs}">
            ${formatMs(r.dottedMs)}
          </td>
          <td class="delay-m-val ${this.currentModifier === 'triplet' && isSelected ? 'is-active-cell' : ''}" data-mod="triplet" data-ms="${r.tripletMs}">
            ${formatMs(r.tripletMs)}
          </td>
          <td class="delay-m-hz">${formatHz(r.hz)}</td>
        </tr>
      `;
    }

    this.matrixBody.innerHTML = html;

    // Attach click handlers to table cells to set fraction & copy ms immediately
    const cells = this.matrixBody.querySelectorAll('td.delay-m-val');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const row = target.closest('tr');
        const denom = parseInt(row?.getAttribute('data-row-denom') || '4', 10);
        const mod = target.getAttribute('data-mod') as DelayModifier;
        const ms = target.getAttribute('data-ms') || '0';

        this.currentNumerator = 1;
        this.currentDenominator = denom;
        if (mod) this.currentModifier = mod;

        if (this.numSelect) this.numSelect.value = '1';
        if (this.denomSelect) this.denomSelect.value = String(denom);

        // Update modifier pills
        const modPills = this.panel?.querySelectorAll('[data-modifier]');
        modPills?.forEach((p) => {
          if (p.getAttribute('data-modifier') === mod) {
            p.classList.add('is-active');
          } else {
            p.classList.remove('is-active');
          }
        });

        this.syncNumeratorQuickPills();
        this.syncDenominatorQuickBar();
        this.updateDelayUI();

        // Copy ms to clipboard with quick highlight
        this.copyToClipboard(parseFloat(ms).toFixed(2), target, '✓');
      });
    });
  }

  private copyCurrentDelayMs(): void {
    const details = getDelayDetails(
      this.currentBpm,
      this.currentNumerator,
      this.currentDenominator,
      this.currentModifier
    );
    const msStr = details.ms.toFixed(2);
    this.copyToClipboard(msStr, this.copyMsBtn, '✓ Copied!', () => {
      if (this.copyHint) {
        const orig = this.copyHint.textContent;
        this.copyHint.textContent = `✓ Copied ${msStr} ms!`;
        setTimeout(() => {
          if (this.copyHint) this.copyHint.textContent = orig;
        }, 1800);
      }
    });
  }

  private copyToClipboard(
    text: string,
    targetEl: HTMLElement | null,
    tempFeedback: string,
    callback?: () => void
  ): void {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
    }

    if (targetEl) {
      const orig = targetEl.innerHTML;
      targetEl.textContent = tempFeedback;
      targetEl.classList.add('is-copied');
      setTimeout(() => {
        targetEl.innerHTML = orig;
        targetEl.classList.remove('is-copied');
      }, 1500);
    }

    if (callback) callback();
  }

  public checkProjectBpm(): void {
    if (!this.projectSyncWrap || !this.projectSyncVal) return;
    const pBpm = this.options.getActiveProjectBpm ? this.options.getActiveProjectBpm() : null;
    if (pBpm && pBpm > 0 && Math.abs(pBpm - this.currentBpm) >= 0.5) {
      this.projectSyncVal.textContent = String(Math.round(pBpm * 10) / 10);
      this.projectSyncWrap.style.display = 'block';
    } else {
      this.projectSyncWrap.style.display = 'none';
    }
  }

  private startPulse(): void {
    this.stopPulse();
    const intervalMs = Math.max(150, 60000 / this.currentBpm);
    this.pulseTimer = setInterval(() => {
      if (this.pulseDot) {
        this.pulseDot.classList.add('is-pulsing');
        setTimeout(() => this.pulseDot?.classList.remove('is-pulsing'), 120);
      }
    }, intervalMs);
  }

  private stopPulse(): void {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  private playTick(): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, this.audioCtx.currentTime + 0.025);
      gain.gain.setValueAtTime(0.35, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.025);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.025);
    } catch (_) {}
  }
}

/**
 * Global singleton helper for initializing the tool.
 */
let globalBpmTool: BpmToolController | null = null;

export function initBpmTool(options: BpmToolOptions = {}): BpmToolController {
  if (!globalBpmTool) {
    globalBpmTool = new BpmToolController(options);
    globalBpmTool.init();
  }
  return globalBpmTool;
}

