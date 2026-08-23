'use strict';

import {
  DEFAULT_REVERB_SETTINGS,
  equalPowerReverbGains,
  formatReverbFrequency,
  normalizeReverbSettings
} from './reverb';
import {
  DEFAULT_CLIPPER_SETTINGS,
  makeClipCurve,
  normalizeClipperSettings,
  ClipperSettings,
  ClipperCurve
} from './clipper';
import {
  METRONOME_SOUNDSETS,
  playMetronomePulse,
  loadSoundsetBuffers,
  preloadAllMetronomeSoundsets
} from './metronome-sounds';

/**
 * Playback and waveform drawing.
 *
 * The file is read by the main process and handed over as raw bytes. The
 * browser engine decodes wav / mp3 / flac natively — that decoded PCM is used
 * for three things at once: playing the audio, drawing the waveform, and
 * feeding the tempo/key analysis in dsp.js. Decode once, use three times.
 *
 * The waveform is deliberately not the hairline-per-pixel style. Peaks are
 * collected per bucket, smoothed with a moving average, then drawn as one
 * filled shape through quadratic curves — so it reads as a shape rather than
 * a comb of vertical lines.
 */

const Player = (() => {
  const canvas = document.getElementById('wave') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const audio = new Audio();
  const titleEl = document.getElementById('nowPlaying');
  const timeEl = document.getElementById('nowTime');
  const playBtn = document.getElementById('playPause');
  const volumeEl = document.getElementById('volume') as HTMLInputElement;
  const metroBtn = document.getElementById('metroBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const verbBtn = document.getElementById('verbBtn');
  const reverbPanel = document.getElementById('reverbPanel');
  const reverbReset = document.getElementById('reverbReset');
  const reverbInputs = {
    decay: document.getElementById('reverbDecay') as HTMLInputElement,
    size: document.getElementById('reverbSize') as HTMLInputElement,
    preDelay: document.getElementById('reverbPreDelay') as HTMLInputElement,
    lowCut: document.getElementById('reverbLowCut') as HTMLInputElement,
    highCut: document.getElementById('reverbHighCut') as HTMLInputElement,
    mix: document.getElementById('reverbMix') as HTMLInputElement
  };
  const reverbOutputs = {
    decay: document.getElementById('reverbDecayValue') as HTMLOutputElement,
    size: document.getElementById('reverbSizeValue') as HTMLOutputElement,
    preDelay: document.getElementById('reverbPreDelayValue') as HTMLOutputElement,
    lowCut: document.getElementById('reverbLowCutValue') as HTMLOutputElement,
    highCut: document.getElementById('reverbHighCutValue') as HTMLOutputElement,
    mix: document.getElementById('reverbMixValue') as HTMLOutputElement
  };

  const clipBtn = document.getElementById('clipBtn');
  const clipPanel = document.getElementById('clipPanel');
  const clipReset = document.getElementById('clipReset');
  const clipCurveCanvas = document.getElementById('clipCurveCanvas') as HTMLCanvasElement;
  const clipCurveCtx = clipCurveCanvas ? clipCurveCanvas.getContext('2d') : null;
  const clipGainInput = document.getElementById('clipGain') as HTMLInputElement;
  const clipGainValue = document.getElementById('clipGainValue') as HTMLOutputElement;
  const clipCeilingInput = document.getElementById('clipCeiling') as HTMLInputElement;
  const clipCeilingValue = document.getElementById('clipCeilingValue') as HTMLOutputElement;
  const clipCurveOptions = document.getElementById('clipCurveOptions');

  let cachedAmberHex = '';
  let cachedAmberTime = 0;
  let cachedAmberIsLight = false;
  function getAmberColor(): string {
    const isLight =
      typeof document !== 'undefined' &&
      (document.body.classList.contains('theme-light') ||
        document.body.getAttribute('data-surface') === 'light' ||
        document.body.dataset.surface === 'light' ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('dawBuddySurface') === 'light'));
    const now = Date.now();
    if (!cachedAmberHex || now - cachedAmberTime > 500 || cachedAmberIsLight !== isLight) {
      let val =
        (typeof window !== 'undefined'
          ? getComputedStyle(document.body).getPropertyValue('--amber').trim()
          : '') || (isLight ? '#008fa0' : '#00f0ff');

      // Guard: in light mode, if --amber is white/near-white (e.g. from mono theme or unapplied override), use high-contrast dark charcoal
      if (isLight) {
        const lower = val.toLowerCase();
        if (
          lower === '#ffffff' ||
          lower === '#fff' ||
          lower === 'white' ||
          lower === 'rgb(255, 255, 255)' ||
          lower === 'rgba(255, 255, 255, 1)' ||
          lower === '#f5f9f6' ||
          lower === '#f4f7f5'
        ) {
          val = '#121714';
        }
      }
      cachedAmberHex = val;
      cachedAmberTime = now;
      cachedAmberIsLight = isLight;
    }
    return cachedAmberHex;
  }

  let audioContext = null;
  let audioContextIdleTimer = null;

  function schedulePlayerAudioContextSuspend() {
    if (audioContextIdleTimer) clearTimeout(audioContextIdleTimer);
    audioContextIdleTimer = setTimeout(() => {
      if (audioContext && audioContext.state === 'running' && audio.paused && !droneOsc && !standaloneTimer && !metronomeEnabled) {
        audioContext.suspend().catch(() => {});
      }
    }, 2500);
  }

  function ensurePlayerAudioContextRunning() {
    if (audioContextIdleTimer) {
      clearTimeout(audioContextIdleTimer);
      audioContextIdleTimer = null;
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  }

  let sourceNode = null;
  let dryGain = null;
  let wetGain = null;
  let convolver = null;
  let wetLowCut = null;
  let wetHighCut = null;
  let shaper = null;
  let droneOsc = null;
  let droneGain = null;
  let chainBuilt = false;
  let peaks = null;
  let current = null; // { path, name }
  let decoded = null; // AudioBuffer
  let listeners = [];
  let loadSerial = 0;
  let reverbEnabled = false;
  let repeatEnabled = false;
  let impulseTimer = null;
  let reverbSettings = loadReverbSettings();

  let clipperEnabled = false;
  let clipperSettings = loadClipperSettings();

  let metronomeEnabled = false;
  let metronomeSig = '4/4';
  let metronomeBpm: number | null = null;
  let lastMetronomeTickIndex = -1;

  // High-performance LRU audio & waveform caches
  const PEAKS_CACHE_LIMIT = 150;
  const DECODED_CACHE_LIMIT = 10;
  const BLOB_URL_CACHE_LIMIT = 10;

  const peaksCache = new Map<string, Float32Array>();
  const decodedCache = new Map<string, AudioBuffer>();
  const blobUrlCache = new Map<string, string>();

  function addToLruMap<K, V>(map: Map<K, V>, key: K, value: V, limit: number, onEvict?: (k: K, v: V) => void) {
    if (map.has(key)) map.delete(key);
    else if (map.size >= limit) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestVal = map.get(oldestKey);
        map.delete(oldestKey);
        if (onEvict && oldestVal !== undefined) onEvict(oldestKey, oldestVal);
      }
    }
    map.set(key, value);
  }

  // Pre-cached Path2D per peaks & canvas dimension for 60/144fps zero-cost rendering
  let cachedWavePath: Path2D | null = null;
  let cachedWavePeaks: Float32Array | null = null;
  let cachedWaveWidth = 0;
  let cachedWaveHeight = 0;

  // Progressive waveform analysis sweep state (reveals waveform from left to right as analysis finishes)
  let sweepProgress = 1.0;
  let isSweeping = false;
  let sweepRafId: number | null = null;

  function startSweepAnimation(rawPeaks: Float32Array) {
    peaks = rawPeaks;
    isSweeping = true;
    sweepProgress = 0;

    if (sweepRafId !== null) {
      cancelAnimationFrame(sweepRafId);
      sweepRafId = null;
    }

    const durationMs = 380; // Smooth 380ms visual analysis sweep
    const startTime = performance.now();

    function sweepStep(now: number) {
      const elapsed = now - startTime;
      sweepProgress = Math.min(1, elapsed / durationMs);
      draw();

      if (sweepProgress < 1) {
        sweepRafId = requestAnimationFrame(sweepStep);
      } else {
        isSweeping = false;
        sweepProgress = 1.0;
        sweepRafId = null;
        draw();
        broadcastState();
      }
    }

    sweepRafId = requestAnimationFrame(sweepStep);
  }

  // Region audition (the trim editor). When regionEnd is set, playback stops or
  // loops at that point. This is a SHARED singleton, so every normal transport
  // path — play(), a scrub, a new load() — must clear it, or the next full-file
  // play would truncate at a stale end. See clearRegion().
  let regionStart = 0;
  let regionEnd = null; // seconds, or null for normal whole-file playback
  let regionLoop = false;

  function clearRegion() {
    regionStart = 0;
    regionEnd = null;
    regionLoop = false;
  }

  audio.volume = Number(volumeEl.value);

  /* ------------------------- audition chain ---------------------- */

  /**
   * Playback runs through an optional reverb and soft clipper, and a separate
   * oscillator can hold the root note underneath.
   *
   *   <audio> -> shaper -> dry --------------------------+
   *                    \-> convolver -> HP -> LP -> wet -+-> out
   *   oscillator -> droneGain --------------------------/
   *
   * Built once, on first use. Creating an AudioContext before the user has
   * interacted with the page gets it suspended by the browser.
   */
  function buildChain() {
    if (!audioContext) audioContext = new AudioContext();
    ensurePlayerAudioContextRunning();
    if (chainBuilt) return;

    sourceNode = audioContext.createMediaElementSource(audio);

    shaper = audioContext.createWaveShaper();
    shaper.curve = null; // null = pass through untouched

    convolver = audioContext.createConvolver();
    convolver.buffer = makeImpulse(
      reverbSettings.decay,
      reverbSettings.size,
      reverbSettings.preDelay
    );

    wetLowCut = audioContext.createBiquadFilter();
    wetLowCut.type = 'highpass';
    wetLowCut.Q.value = Math.SQRT1_2;

    wetHighCut = audioContext.createBiquadFilter();
    wetHighCut.type = 'lowpass';
    wetHighCut.Q.value = Math.SQRT1_2;

    dryGain = audioContext.createGain();
    wetGain = audioContext.createGain();
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;

    droneGain = audioContext.createGain();
    droneGain.gain.value = 0;

    sourceNode.connect(shaper);
    shaper.connect(dryGain);
    shaper.connect(convolver);
    convolver.connect(wetLowCut);
    wetLowCut.connect(wetHighCut);
    wetHighCut.connect(wetGain);

    dryGain.connect(audioContext.destination);
    wetGain.connect(audioContext.destination);
    droneGain.connect(audioContext.destination);

    chainBuilt = true;
    applyReverbTone();
  }

  /**
   * A reverb impulse, generated rather than loaded.
   *
   * Noise decaying exponentially is a crude but convincing tail — it's what a
   * real impulse response mostly is once you strip the room's character out.
   * Shipping an actual IR file would sound better and cost a few hundred KB;
   * this is for auditioning a dry sample, not for mixing.
   */
  function makeImpulse(decaySeconds, sizePercent, preDelayMs) {
    const rate = audioContext.sampleRate;
    const roomSize = sizePercent / 100;
    const preDelaySeconds = preDelayMs / 1000;
    const length = Math.max(1, Math.floor(rate * (decaySeconds + preDelaySeconds)));
    const preDelaySamples = Math.floor(rate * preDelaySeconds);
    const impulse = audioContext.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = preDelaySamples; i < length; i += 1) {
        const elapsed = (i - preDelaySamples) / rate;
        // -60 dB at the requested decay time, the usual RT60 definition.
        const envelope = Math.exp((-6.9078 * elapsed) / decaySeconds);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }

      // A few room-size-dependent early reflections keep Size perceptually
      // distinct from simply making the tail longer.
      [0.011, 0.019, 0.031, 0.043].forEach((spacing, index) => {
        const sample =
          preDelaySamples + Math.floor(rate * (0.002 + spacing * (0.35 + roomSize)));
        if (sample < length) {
          const side = channel === 0 ? 1 : index % 2 === 0 ? 0.82 : 1;
          data[sample] += (0.42 - index * 0.07) * side;
        }
      });
    }
    return impulse;
  }

  function loadClipperSettings(): ClipperSettings {
    try {
      const saved = JSON.parse(localStorage.getItem('daw-buddy.clipper-settings.v1') || '{}');
      return normalizeClipperSettings(saved);
    } catch {
      return { ...DEFAULT_CLIPPER_SETTINGS };
    }
  }

  function saveClipperSettings() {
    try {
      localStorage.setItem(
        'daw-buddy.clipper-settings.v1',
        JSON.stringify(clipperSettings)
      );
    } catch {
      // Auditioning still works if storage is unavailable.
    }
  }

  function applyClipperSettings() {
    if (!chainBuilt) return;
    if (clipperEnabled) {
      shaper.curve = makeClipCurve(
        clipperSettings.curve,
        clipperSettings.gainDb,
        clipperSettings.ceilingDb
      );
    } else {
      shaper.curve = null;
    }
    drawClipVisualizer();
  }

  function syncClipperControls() {
    if (clipGainInput) clipGainInput.value = String(clipperSettings.gainDb);
    if (clipGainValue) clipGainValue.textContent = (clipperSettings.gainDb > 0 ? '+' : '') + clipperSettings.gainDb.toFixed(1) + ' dB';
    if (clipCeilingInput) clipCeilingInput.value = String(clipperSettings.ceilingDb);
    if (clipCeilingValue) clipCeilingValue.textContent = clipperSettings.ceilingDb.toFixed(1) + ' dB';

    if (clipCurveOptions) {
      clipCurveOptions.querySelectorAll('.clip-pill').forEach((btn: any) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-curve') === clipperSettings.curve);
      });
    }
    drawClipVisualizer();
  }


  function drawClipVisualizer(peakIn: number = 0) {
    if (!clipCurveCanvas || !clipCurveCtx) return;
    const w = clipCurveCanvas.width;
    const h = clipCurveCanvas.height;
    const c = clipCurveCtx;

    c.clearRect(0, 0, w, h);

    // Background
    c.fillStyle = '#080a0f';
    c.fillRect(0, 0, w, h);

    const midX = w / 2;
    const midY = h / 2;

    // Grid lines
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c.lineWidth = 1;
    c.setLineDash([2, 2]);

    // Center axes
    c.beginPath();
    c.moveTo(0, midY);
    c.lineTo(w, midY);
    c.moveTo(midX, 0);
    c.lineTo(midX, h);
    c.stroke();

    // Linear reference line (y = x)
    c.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    c.beginPath();
    c.moveTo(8, h - 8);
    c.lineTo(w - 8, 8);
    c.stroke();
    c.setLineDash([]);

    // Ceiling threshold lines
    const C = Math.pow(10, clipperSettings.ceilingDb / 20);
    const ceilYTop = midY - C * (midY - 8);
    const ceilYBot = midY + C * (midY - 8);

    c.strokeStyle = 'rgba(255, 75, 75, 0.35)';
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(0, ceilYTop);
    c.lineTo(w, ceilYTop);
    c.moveTo(0, ceilYBot);
    c.lineTo(w, ceilYBot);
    c.stroke();
    c.setLineDash([]);

    // Transfer curve
    const steps = 120;
    const curvePoints: [number, number][] = [];
    const G = Math.pow(10, clipperSettings.gainDb / 20);

    for (let i = 0; i <= steps; i++) {
      const xNorm = (i / steps) * 2 - 1; // -1 to +1
      const u = xNorm * G;
      let yNorm = 0;

      switch (clipperSettings.curve) {
        case 'hard':
          yNorm = Math.max(-1, Math.min(1, u));
          break;
        case 'tanh':
          yNorm = G > 0.001 ? Math.tanh(u) / Math.tanh(G) : Math.tanh(u);
          break;
        case 'cubic': {
          const uc = Math.max(-1.5, Math.min(1.5, u));
          yNorm = Math.max(-1, Math.min(1, uc - (uc * uc * uc) / 6.75));
          break;
        }
        case 'atan':
          yNorm = G > 0.001 ? Math.atan(u) / Math.atan(G) : Math.atan(u);
          break;
        case 'quintic': {
          const norm = G / Math.pow(1 + Math.pow(G, 4), 0.25);
          const out = u / Math.pow(1 + Math.pow(Math.abs(u), 4), 0.25);
          yNorm = norm > 0.0001 ? out / norm : out;
          yNorm = Math.max(-1, Math.min(1, yNorm));
          break;
        }
        default:
          yNorm = Math.max(-1, Math.min(1, u));
          break;
      }

      yNorm *= C;
      const px = midX + xNorm * (midX - 8);
      const py = midY - yNorm * (midY - 8);
      curvePoints.push([px, py]);
    }

    // Glow fill under positive curve
    const amberHex = getAmberColor();
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

    c.beginPath();
    c.moveTo(curvePoints[0][0], curvePoints[0][1]);
    for (let i = 1; i < curvePoints.length; i++) {
      c.lineTo(curvePoints[i][0], curvePoints[i][1]);
    }
    c.lineTo(w - 8, midY);
    c.lineTo(8, midY);
    c.closePath();
    c.fillStyle = grad;
    c.fill();

    // Curve stroke
    c.strokeStyle = amberHex || '#00f0ff';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(curvePoints[0][0], curvePoints[0][1]);
    for (let i = 1; i < curvePoints.length; i++) {
      c.lineTo(curvePoints[i][0], curvePoints[i][1]);
    }
    c.stroke();

    // Live peak dot & drop line
    if (peakIn > 0.01) {
      const pClamped = Math.min(1, peakIn);
      const px = midX + pClamped * (midX - 8);
      const u = pClamped * G;
      let yPeak = 0;
      if (clipperSettings.curve === 'hard') yPeak = Math.max(-1, Math.min(1, u));
      else if (clipperSettings.curve === 'tanh') yPeak = G > 0.001 ? Math.tanh(u) / Math.tanh(G) : Math.tanh(u);
      else if (clipperSettings.curve === 'cubic') yPeak = Math.max(-1, Math.min(1, Math.max(-1.5, Math.min(1.5, u)) - Math.pow(Math.max(-1.5, Math.min(1.5, u)), 3) / 6.75));
      else if (clipperSettings.curve === 'atan') yPeak = G > 0.001 ? Math.atan(u) / Math.atan(G) : Math.atan(u);
      else yPeak = Math.max(-1, Math.min(1, (u / Math.pow(1 + Math.pow(Math.abs(u), 4), 0.25)) / (G / Math.pow(1 + Math.pow(G, 4), 0.25))));
      yPeak *= C;
      const py = midY - yPeak * (midY - 8);

      c.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      c.lineWidth = 1;
      c.setLineDash([2, 2]);
      c.beginPath();
      c.moveTo(px, midY);
      c.lineTo(px, py);
      c.stroke();
      c.setLineDash([]);

      c.fillStyle = '#ffffff';
      c.shadowColor = amberHex || '#00f0ff';
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(px, py, 4, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
  }

  function closeClipperPanel() {
    if (clipPanel) {
      clipPanel.hidden = true;
      clipPanel.setAttribute('hidden', '');
    }
    if (clipBtn) clipBtn.setAttribute('aria-expanded', 'false');
  }

  function openClipperPanel() {
    syncClipperControls();
    if (clipPanel) {
      clipPanel.hidden = false;
      clipPanel.removeAttribute('hidden');
      if (clipBtn) {
        clipBtn.setAttribute('aria-expanded', 'true');
        const buttonRect = clipBtn.getBoundingClientRect();
        const panelRect = clipPanel.getBoundingClientRect();
        const left = Math.min(
          window.innerWidth - panelRect.width - 12,
          Math.max(12, buttonRect.right - panelRect.width)
        );
        clipPanel.style.left = `${left}px`;
        clipPanel.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
      }
      drawClipVisualizer();
    }
  }

  function loadReverbSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('daw-buddy.reverb-settings.v1') || '{}');
      return normalizeReverbSettings(saved);
    } catch {
      return { ...DEFAULT_REVERB_SETTINGS };
    }
  }

  function saveReverbSettings() {
    try {
      localStorage.setItem(
        'daw-buddy.reverb-settings.v1',
        JSON.stringify(reverbSettings)
      );
    } catch {
      // Auditioning still works if storage is unavailable.
    }
  }

  function applyReverbTone() {
    if (!chainBuilt) return;
    const now = audioContext.currentTime;
    wetLowCut.frequency.setTargetAtTime(reverbSettings.lowCut, now, 0.015);
    wetHighCut.frequency.setTargetAtTime(reverbSettings.highCut, now, 0.015);
  }

  function applyReverbLevel() {
    if (!chainBuilt) return;
    const gains = reverbEnabled
      ? equalPowerReverbGains(reverbSettings.mix)
      : { dry: 1, wet: 0 };
    const now = audioContext.currentTime;
    dryGain.gain.setTargetAtTime(gains.dry, now, 0.015);
    wetGain.gain.setTargetAtTime(gains.wet, now, 0.015);
  }

  function rebuildImpulseSoon() {
    if (!chainBuilt) return;
    clearTimeout(impulseTimer);
    impulseTimer = setTimeout(() => {
      convolver.buffer = makeImpulse(
        reverbSettings.decay,
        reverbSettings.size,
        reverbSettings.preDelay
      );
    }, 80);
  }

  function setReverb(mix) {
    buildChain();
    reverbEnabled = mix > 0;
    applyReverbLevel();
  }

  function syncReverbControls() {
    Object.entries(reverbInputs).forEach(([name, input]) => {
      input.value = String(reverbSettings[name]);
    });
    reverbOutputs.decay.textContent = `${reverbSettings.decay.toFixed(1)} s`;
    reverbOutputs.size.textContent = `${Math.round(reverbSettings.size)}%`;
    reverbOutputs.preDelay.textContent = `${Math.round(reverbSettings.preDelay)} ms`;
    reverbOutputs.lowCut.textContent = formatReverbFrequency(reverbSettings.lowCut);
    reverbOutputs.highCut.textContent = formatReverbFrequency(reverbSettings.highCut);
    reverbOutputs.mix.textContent = `${Math.round(reverbSettings.mix)}%`;
    const knob = reverbInputs.mix.nextElementSibling as HTMLElement;
    knob.parentElement.style.setProperty('--mix-turn', `${reverbSettings.mix * 2.7}deg`);
  }

  function enableReverbFromControl() {
    reverbEnabled = true;
    if (verbBtn) verbBtn.classList.add('is-on');
    buildChain();
    applyReverbLevel();
  }

  function updateReverbFromControls(changed) {
    const previous = reverbSettings;
    reverbSettings = normalizeReverbSettings({
      decay: Number(reverbInputs.decay.value),
      size: Number(reverbInputs.size.value),
      preDelay: Number(reverbInputs.preDelay.value),
      lowCut: Number(reverbInputs.lowCut.value),
      highCut: Number(reverbInputs.highCut.value),
      mix: Number(reverbInputs.mix.value)
    });
    syncReverbControls();
    saveReverbSettings();
    enableReverbFromControl();
    applyReverbTone();
    if (
      changed === 'decay' ||
      changed === 'size' ||
      changed === 'preDelay' ||
      previous.decay !== reverbSettings.decay ||
      previous.size !== reverbSettings.size ||
      previous.preDelay !== reverbSettings.preDelay
    ) {
      rebuildImpulseSoon();
    }
  }

  function closeReverbPanel() {
    reverbPanel.hidden = true;
    if (verbBtn) verbBtn.setAttribute('aria-expanded', 'false');
  }

  function openReverbPanel() {
    syncReverbControls();
    reverbPanel.hidden = false;
    if (verbBtn) {
      verbBtn.setAttribute('aria-expanded', 'true');
      const buttonRect = verbBtn.getBoundingClientRect();
      const panelRect = reverbPanel.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - panelRect.width - 12,
        Math.max(12, buttonRect.right - panelRect.width)
      );
      reverbPanel.style.left = `${left}px`;
      reverbPanel.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
    }
    if (reverbInputs.decay) reverbInputs.decay.focus();
  }

  if (verbBtn) {
    verbBtn.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target && target.closest('#verbSlowedHint')) {
        event.stopPropagation();
        event.preventDefault();
        closeReverbPanel();
        window.dispatchEvent(new CustomEvent('open-slowed-reverb-modal'));
        return;
      }
      if (target && target.closest('.chip-gear-hint')) {
        event.stopPropagation();
        event.preventDefault();
        if (reverbPanel.hidden) openReverbPanel();
        else closeReverbPanel();
      }
    }, { capture: true });

    verbBtn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (reverbPanel.hidden) openReverbPanel();
      else closeReverbPanel();
    });
  }

  const openModalBtn = document.getElementById('openSlowedReverbModalBtn');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      closeReverbPanel();
      window.dispatchEvent(new CustomEvent('open-slowed-reverb-modal'));
    });
  }

  Object.entries(reverbInputs).forEach(([name, input]) => {
    input.addEventListener('input', () => updateReverbFromControls(name));
  });

  // Professional DAW Vertical Drag (Y-axis only) & Mouse Wheel Controller for Reverb Mix Knob
  const mixKnobWrap = (reverbInputs.mix.closest('.reverb-knob-wrap') as HTMLElement) || reverbInputs.mix.parentElement;
  if (mixKnobWrap) {
    let isDragging = false;
    let startY = 0;
    let startVal = 35;

    const setMixValue = (newVal: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(newVal)));
      reverbInputs.mix.value = String(clamped);
      updateReverbFromControls('mix');
    };

    mixKnobWrap.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return; // Only primary left-click
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      startY = e.clientY;
      startVal = Number(reverbInputs.mix.value) || 0;
      mixKnobWrap.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ns-resize';
      mixKnobWrap.style.cursor = 'ns-resize';
    });

    mixKnobWrap.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      // Strictly Y-axis: Dragging UP (startY - clientY > 0) increases mix, dragging DOWN decreases mix.
      // 140px drag delta spans 0% to 100% full sweep (Hold Shift for precision mode).
      const deltaY = startY - e.clientY;
      const sensitivity = e.shiftKey ? 0.25 : 0.72;
      const nextVal = startVal + deltaY * sensitivity;
      setMixValue(nextVal);
    });

    const endDrag = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        try { mixKnobWrap.releasePointerCapture(e.pointerId); } catch {}
        document.body.style.cursor = '';
        mixKnobWrap.style.cursor = 'ns-resize';
      }
    };

    mixKnobWrap.addEventListener('pointerup', endDrag);
    mixKnobWrap.addEventListener('pointercancel', endDrag);

    // Mouse Scroll Wheel Support (Wheel UP -> Increase, Wheel DOWN -> Decrease)
    mixKnobWrap.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const currentVal = Number(reverbInputs.mix.value) || 0;
      const step = e.shiftKey ? 1 : (Math.abs(e.deltaY) > 50 ? 5 : 2);
      const direction = e.deltaY < 0 ? 1 : -1;
      setMixValue(currentVal + direction * step);
    }, { passive: false });

    // Double-click to reset mix to default
    mixKnobWrap.addEventListener('dblclick', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMixValue(DEFAULT_REVERB_SETTINGS.mix || 35);
    });
  }

  reverbReset.addEventListener('click', () => {
    reverbSettings = { ...DEFAULT_REVERB_SETTINGS };
    syncReverbControls();
    saveReverbSettings();
    enableReverbFromControl();
    applyReverbTone();
    rebuildImpulseSoon();
  });

  document.addEventListener('pointerdown', (event) => {
    if (
      !reverbPanel.hidden &&
      !reverbPanel.contains(event.target as Node) &&
      !verbBtn.contains(event.target as Node)
    ) {
      closeReverbPanel();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !reverbPanel.hidden) {
      closeReverbPanel();
      verbBtn.focus();
    }
  });

  syncReverbControls();

  if (clipBtn) {
    clipBtn.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target && target.closest('.chip-gear-hint')) {
        event.stopPropagation();
        event.preventDefault();
        if (clipPanel && clipPanel.hidden) openClipperPanel();
        else closeClipperPanel();
      }
    }, { capture: true });

    clipBtn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (clipPanel && clipPanel.hidden) openClipperPanel();
      else closeClipperPanel();
    });
  }

  if (clipGainInput) {
    clipGainInput.addEventListener('input', () => {
      clipperSettings.gainDb = Number(clipGainInput.value);
      if (clipGainValue) clipGainValue.textContent = (clipperSettings.gainDb > 0 ? '+' : '') + clipperSettings.gainDb.toFixed(1) + ' dB';
      saveClipperSettings();
      if (clipperEnabled) applyClipperSettings();
      else drawClipVisualizer();
    });
  }

  if (clipCeilingInput) {
    clipCeilingInput.addEventListener('input', () => {
      clipperSettings.ceilingDb = Number(clipCeilingInput.value);
      if (clipCeilingValue) clipCeilingValue.textContent = clipperSettings.ceilingDb.toFixed(1) + ' dB';
      saveClipperSettings();
      if (clipperEnabled) applyClipperSettings();
      else drawClipVisualizer();
    });
  }

  if (clipCurveOptions) {
    clipCurveOptions.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.clip-pill') as HTMLElement;
      if (btn) {
        const curve = btn.getAttribute('data-curve') as ClipperCurve;
        if (curve) {
          clipperSettings.curve = curve;
          clipCurveOptions.querySelectorAll('.clip-pill').forEach((p: any) => {
            p.classList.toggle('is-active', p === btn);
          });
          saveClipperSettings();
          if (clipperEnabled) applyClipperSettings();
          else drawClipVisualizer();
        }
      }
    });
  }

  if (clipReset) {
    clipReset.addEventListener('click', () => {
      clipperSettings = { ...DEFAULT_CLIPPER_SETTINGS };
      syncClipperControls();
      saveClipperSettings();
      if (clipperEnabled) applyClipperSettings();
      else drawClipVisualizer();
    });
  }

  document.addEventListener('pointerdown', (event) => {
    if (
      clipPanel &&
      !clipPanel.hidden &&
      !clipPanel.contains(event.target as Node) &&
      clipBtn &&
      !clipBtn.contains(event.target as Node)
    ) {
      closeClipperPanel();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && clipPanel && !clipPanel.hidden) {
      closeClipperPanel();
      if (clipBtn) clipBtn.focus();
    }
  });

  syncClipperControls();

  function setSoftClip(enabledOrAmount: boolean | number = true) {
    buildChain();
    if (typeof enabledOrAmount === 'boolean') {
      clipperEnabled = enabledOrAmount;
    } else if (typeof enabledOrAmount === 'number') {
      clipperEnabled = enabledOrAmount > 0;
      if (enabledOrAmount > 0) {
        clipperSettings.gainDb = Math.max(0, Math.min(18, enabledOrAmount * 12));
        syncClipperControls();
      }
    }
    applyClipperSettings();
    if (clipBtn) clipBtn.classList.toggle('is-on', clipperEnabled);
    broadcastState();
  }

  /**
   * Holds the root note underneath whatever's playing, so a sample can be
   * heard in musical context. Two detuned saws and a sub, which reads as a
   * pad rather than a test tone.
   */
  const NOTE_OFFSETS = {
    C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
    'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11
  };

  function noteToFrequency(note, octave = 3) {
    const semitone = NOTE_OFFSETS[note];
    if (semitone === undefined) return null;
    // A4 = 440Hz is MIDI 69; MIDI 12 is C0.
    const midi = 12 * (octave + 1) + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function startDrone(note, level = 0.12) {
    buildChain();
    stopDrone();

    const frequency = noteToFrequency(note);
    if (!frequency) return false;

    droneOsc = [];
    [0, -6, 12].forEach((cents, index) => {
      const osc = audioContext.createOscillator();
      osc.type = index === 2 ? 'sine' : 'sawtooth';
      osc.frequency.value = index === 2 ? frequency / 2 : frequency;
      osc.detune.value = cents;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;

      osc.connect(filter);
      filter.connect(droneGain);
      osc.start();
      droneOsc.push(osc);
    });

    // Fade in — an oscillator starting at full level clicks.
    droneGain.gain.setValueAtTime(0, audioContext.currentTime);
    droneGain.gain.linearRampToValueAtTime(level, audioContext.currentTime + 0.15);
    return true;
  }

  function stopDrone() {
    if (!droneOsc) {
      schedulePlayerAudioContextSuspend();
      return;
    }
    try {
      droneGain.gain.cancelScheduledValues(audioContext.currentTime);
      droneGain.gain.setValueAtTime(droneGain.gain.value, audioContext.currentTime);
      droneGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
      droneOsc.forEach((osc) => osc.stop(audioContext.currentTime + 0.15));
    } catch {
      /* already stopped */
    }
    droneOsc = null;
    schedulePlayerAudioContextSuspend();
  }

  function getPulseInterval(sig: string, bpm: number): number {
    const safeBpm = bpm > 20 && bpm < 400 ? bpm : 128;
    const quarterSec = 60 / safeBpm;

    if (sig === '6/8') {
      return quarterSec / 2; // 6 eighths
    }
    if (sig === '3/4') {
      return quarterSec; // 3 quarters
    }
    if (sig === '7/8' || sig === '5/8' || sig === '12/8') {
      return quarterSec / 2;
    }
    return quarterSec;
  }

  function getPulseAccent(sig: string, pulseIndex: number): { isDownbeat: boolean; isAccent: boolean } {
    if (sig === '6/8') {
      const beatInBar = pulseIndex % 6;
      return { isDownbeat: beatInBar === 0, isAccent: beatInBar === 3 };
    }
    if (sig === '3/4') {
      const beatInBar = pulseIndex % 3;
      return { isDownbeat: beatInBar === 0, isAccent: false };
    }
    if (sig === '7/8') {
      const beatInBar = pulseIndex % 7;
      return { isDownbeat: beatInBar === 0, isAccent: beatInBar === 3 || beatInBar === 5 };
    }
    if (sig === '5/8') {
      const beatInBar = pulseIndex % 5;
      return { isDownbeat: beatInBar === 0, isAccent: beatInBar === 2 };
    }
    if (sig === '12/8') {
      const beatInBar = pulseIndex % 12;
      return { isDownbeat: beatInBar === 0, isAccent: beatInBar === 3 || beatInBar === 6 || beatInBar === 9 };
    }
    const beatInBar = pulseIndex % 4;
    return { isDownbeat: beatInBar === 0, isAccent: beatInBar === 2 };
  }

  let metronomeSound = 'ableton';
  try {
    const saved = localStorage.getItem('dawBuddyMetronomeSound');
    if (saved) metronomeSound = saved;
  } catch {}

  function setMetronomeSound(soundId: string) {
    metronomeSound = soundId || 'ableton';
    try {
      localStorage.setItem('dawBuddyMetronomeSound', metronomeSound);
    } catch {}
    if (audioContext && metronomeSound !== 'synth') {
      loadSoundsetBuffers(metronomeSound, audioContext).catch(() => {});
    }
    emit();
    broadcastState();
  }

  function getMetronomeSound(): string {
    return metronomeSound;
  }

  function playClick(isDownbeat = false, isAccent = false) {
    if (!audioContext) audioContext = new AudioContext();
    ensurePlayerAudioContextRunning();
    playMetronomePulse(audioContext, metronomeSound, isDownbeat, isAccent, 0.85);
  }

  let standaloneTimer: any = null;
  let standalonePulseIndex = 0;

  function startStandaloneMetro() {
    stopStandaloneMetro();
    standalonePulseIndex = 0;
    const bpm = metronomeBpm || 120;
    const intervalSec = getPulseInterval(metronomeSig, bpm);
    const { isDownbeat, isAccent } = getPulseAccent(metronomeSig, standalonePulseIndex);
    playClick(isDownbeat, isAccent);
    standalonePulseIndex += 1;

    standaloneTimer = setInterval(() => {
      if (!metronomeEnabled || !audio.paused) {
        stopStandaloneMetro();
        return;
      }
      const { isDownbeat: isDb, isAccent: isAc } = getPulseAccent(metronomeSig, standalonePulseIndex);
      playClick(isDb, isAc);
      standalonePulseIndex += 1;
    }, intervalSec * 1000);
  }

  function stopStandaloneMetro() {
    if (standaloneTimer) {
      clearInterval(standaloneTimer);
      standaloneTimer = null;
    }
    schedulePlayerAudioContextSuspend();
  }

  function setMetronome(enabled: boolean) {
    metronomeEnabled = enabled;
    lastMetronomeTickIndex = -1;
    if (metroBtn) metroBtn.classList.toggle('is-on', metronomeEnabled);
    if (metronomeEnabled && audio.paused) {
      startStandaloneMetro();
    } else {
      stopStandaloneMetro();
    }
    emit();
  }

  function setMetronomeSignature(sig: string) {
    metronomeSig = sig || '4/4';
    lastMetronomeTickIndex = -1;
    if (metronomeEnabled && audio.paused) startStandaloneMetro();
    emit();
  }

  function setMetronomeBpm(bpm: number | null) {
    metronomeBpm = bpm;
    lastMetronomeTickIndex = -1;
    if (metronomeEnabled && audio.paused) startStandaloneMetro();
  }

  if (metroBtn) {
    metroBtn.addEventListener('click', () => {
      buildChain();
      setMetronome(!metronomeEnabled);
    });
  }

  function toArrayBuffer(buf: any): ArrayBuffer {
    if (!buf) return new ArrayBuffer(0);
    if (buf instanceof ArrayBuffer) {
      return buf.slice(0);
    }
    if (ArrayBuffer.isView(buf)) {
      const view = buf as Uint8Array;
      const b = view.buffer;
      if (b instanceof ArrayBuffer) {
        return b.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(b as any, view.byteOffset, view.byteLength));
      return copy.buffer;
    }
    if (typeof buf === 'object' && buf && buf.buffer instanceof ArrayBuffer) {
      return buf.buffer.slice(buf.byteOffset || 0, (buf.byteOffset || 0) + (buf.byteLength || buf.length || 0));
    }
    const fallback = new Uint8Array(buf as any);
    return fallback.buffer.slice(fallback.byteOffset, fallback.byteOffset + fallback.byteLength);
  }

  /* --------------------------- loading --------------------------- */

  async function load(file, { autoplay = true, project = null }: { autoplay?: boolean; project?: any } = {}) {
    const serial = ++loadSerial;
    clearRegion(); // a new file starts as whole-file playback
    const proj = project || (file && (file.project || file.where || file.folder)) || null;
    current = { path: file.path, name: file.name, project: proj };
    titleEl.textContent = file.name;
    titleEl.title = 'Click to open project';

    // Check if waveform peaks and/or decoded audio are already in memory
    const cachedPeaks = peaksCache.get(file.path);
    const cachedDecoded = decodedCache.get(file.path);
    const cachedBlobUrl = blobUrlCache.get(file.path);

    if (cachedPeaks) {
      peaks = cachedPeaks;
      decoded = cachedDecoded || null;
      isSweeping = false;
      sweepProgress = 1.0;
      timeEl.textContent = cachedDecoded ? `${clock(0)} / ${clock(cachedDecoded.duration)}` : 'Ready';
      draw();
      emit();
    } else {
      peaks = null;
      decoded = null;
      isSweeping = false;
      sweepProgress = 0.0;
      timeEl.textContent = 'Loading…';
      draw();
      emit();
    }

    // 1. Audio element playback source
    let rawBytes: any = null;
    if (cachedBlobUrl) {
      if (audio.src !== cachedBlobUrl) {
        audio.src = cachedBlobUrl;
      }
      if (autoplay) play();
    } else {
      try {
        rawBytes = await window.api.readMedia(file.path);
      } catch (err) {
        if (serial === loadSerial) timeEl.textContent = 'Could not read file';
        return null;
      }
      if (serial !== loadSerial) return null;

      // Direct zero-copy Blob creation from ArrayBuffer or Uint8Array
      const blob = new Blob([rawBytes], { type: guessType(file.name) });
      const newUrl = URL.createObjectURL(blob);
      addToLruMap(blobUrlCache, file.path, newUrl, BLOB_URL_CACHE_LIMIT, (_, oldUrl) => URL.revokeObjectURL(oldUrl));
      audio.src = newUrl;

      // Priority 1: Start audio playback IMMEDIATELY without waiting for decoding or analysis
      if (autoplay) play();
    }

    // 2. Waveform decoding & peak extraction
    if (!cachedDecoded || !cachedPeaks) {
      try {
        if (!rawBytes) {
          rawBytes = await window.api.readMedia(file.path);
        }
        if (serial !== loadSerial || !rawBytes) return decoded;

        const forDecoding = toArrayBuffer(rawBytes);
        if (!audioContext) audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});
        const nextDecoded = await audioContext.decodeAudioData(forDecoding);
        if (serial !== loadSerial) return nextDecoded;
        decoded = nextDecoded;
        addToLruMap(decodedCache, file.path, nextDecoded, DECODED_CACHE_LIMIT);

        if (!peaksCache.has(file.path)) {
          const rawPeaks = buildPeaks(nextDecoded, 900);
          addToLruMap(peaksCache, file.path, rawPeaks, PEAKS_CACHE_LIMIT);
          startSweepAnimation(rawPeaks);
        } else {
          peaks = peaksCache.get(file.path)!;
          isSweeping = false;
          sweepProgress = 1.0;
          draw();
        }
        timeEl.textContent = `${clock(audio.currentTime || 0)} / ${clock(nextDecoded.duration)}`;
        emit();
        broadcastState();
      } catch (err) {
        console.error('[Player] decodeAudioData error:', err);
        if (serial === loadSerial && !cachedPeaks) timeEl.textContent = 'Cannot decode this format';
      }
    } else {
      decoded = cachedDecoded;
    }

    if (serial !== loadSerial) return decoded;
    emit();
    return decoded;
  }

  async function decode(file: { path: string; name?: string }): Promise<AudioBuffer | null> {
    if (!file || !file.path) return null;
    const cached = decodedCache.get(file.path);
    if (cached) return cached;

    try {
      const rawBytes = await window.api.readMedia(file.path);
      if (!rawBytes) return null;
      const forDecoding = toArrayBuffer(rawBytes);
      if (!audioContext) audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});
      const buf = await audioContext.decodeAudioData(forDecoding);
      addToLruMap(decodedCache, file.path, buf, DECODED_CACHE_LIMIT);
      return buf;
    } catch (err) {
      console.error('[Player] decode error:', err);
      return null;
    }
  }

  function guessType(name) {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'aiff' || ext === 'aif') return 'audio/aiff';
    return 'audio/wav';
  }

  /**
   * Ultra-fast peak extraction with adaptive subsampling.
   */
  function buildPeaks(buffer, buckets) {
    const channel = buffer.getChannelData(0);
    const len = channel.length;
    const size = Math.floor(len / buckets);
    const out = new Float32Array(buckets);
    const step = Math.max(1, Math.floor(size / 32));

    for (let b = 0; b < buckets; b += 1) {
      const start = b * size;
      const end = Math.min(start + size, len);
      let peak = 0;
      for (let i = start; i < end; i += step) {
        const v = channel[i] < 0 ? -channel[i] : channel[i];
        if (v > peak) peak = v;
      }
      out[b] = peak;
    }

    return smooth(out, 2);
  }

  function smooth(data, radius) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const j = i + k;
        if (j < 0 || j >= data.length) continue;
        sum += data[j];
        count += 1;
      }
      out[i] = sum / count;
    }
    return out;
  }

  /* --------------------------- drawing --------------------------- */

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width <= 0 || height <= 0) return;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLight =
      typeof document !== 'undefined' &&
      (document.body.classList.contains('theme-light') ||
        document.body.getAttribute('data-surface') === 'light' ||
        document.body.dataset.surface === 'light' ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('dawBuddySurface') === 'light'));
    const mid = height / 2;

    // Centre line, always visible so an empty player still looks intentional
    ctx.strokeStyle = isLight ? 'rgba(18, 23, 20, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const effectivePeaks = peaks;

    if (!effectivePeaks || effectivePeaks.length === 0) {
      // Empty baseline when no audio is loaded or while audio is initially reading
      return;
    }

    const progress = duration() > 0 ? audio.currentTime / duration() : 0;
    const playedX = width * progress;
    const sweepLimitX = isSweeping ? width * sweepProgress : width;

    // Fast cached Path2D reuse across 60/144fps animation frames
    let path: Path2D;
    if (
      cachedWavePath &&
      cachedWavePeaks === effectivePeaks &&
      cachedWaveWidth === width &&
      cachedWaveHeight === height
    ) {
      path = cachedWavePath;
    } else {
      path = new Path2D();
      const len = effectivePeaks.length;
      const step = width / Math.max(1, len - 1);
      const amp = mid * 0.92;

      // Top half: 0 -> len - 1
      path.moveTo(0, mid - Math.max(0.015, effectivePeaks[0]) * amp);
      for (let i = 1; i < len; i += 1) {
        const x = i * step;
        const y = mid - Math.max(0.015, effectivePeaks[i]) * amp;
        path.lineTo(x, y);
      }

      // Bottom half: len - 1 -> 0
      for (let i = len - 1; i >= 0; i -= 1) {
        const x = i * step;
        const y = mid + Math.max(0.015, effectivePeaks[i]) * amp;
        path.lineTo(x, y);
      }
      path.closePath();

      cachedWavePath = path;
      cachedWavePeaks = effectivePeaks;
      cachedWaveWidth = width;
      cachedWaveHeight = height;
    }

    // Clip waveform rendering to the progressive sweep boundary (left to right)
    ctx.save();
    if (sweepLimitX < width) {
      ctx.beginPath();
      ctx.rect(0, 0, sweepLimitX, height);
      ctx.clip();
    }

    // Unplayed portion (crisp high-contrast fill for both light & dark surfaces)
    ctx.fillStyle = isLight
      ? 'rgba(18, 23, 20, 0.28)'
      : 'rgba(255, 255, 255, 0.22)';
    ctx.fill(path);

    // Played portion, clipped to everything left of the playhead (and within sweep)
    const effectivePlayedX = Math.min(playedX, sweepLimitX);
    if (effectivePlayedX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, effectivePlayedX, height);
      ctx.clip();
      const amberHex = getAmberColor();
      ctx.fillStyle = amberHex;
      ctx.fill(path);
      ctx.restore();
    }

    ctx.restore(); // Restore sweep clip

    // If sweeping, draw a scanning beam & glow line at the sweep head
    if (isSweeping && sweepLimitX > 0 && sweepLimitX < width) {
      const amberHex = getAmberColor();
      ctx.save();

      // Glowing scan line
      ctx.strokeStyle = amberHex;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sweepLimitX, 2);
      ctx.lineTo(sweepLimitX, height - 2);
      ctx.stroke();

      // Subtle sweep trail
      const glow = ctx.createLinearGradient(Math.max(0, sweepLimitX - 24), 0, sweepLimitX, 0);
      glow.addColorStop(0, 'rgba(0, 240, 255, 0)');
      glow.addColorStop(1, isLight ? 'rgba(0, 143, 160, 0.25)' : 'rgba(0, 240, 255, 0.3)');
      ctx.fillStyle = glow;
      ctx.fillRect(Math.max(0, sweepLimitX - 24), 2, 24, height - 4);

      ctx.restore();
    }

    // Playhead
    if (!isSweeping || playedX <= sweepLimitX) {
      ctx.strokeStyle = isLight ? '#121714' : '#f3f2f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playedX, 2);
      ctx.lineTo(playedX, height - 2);
      ctx.stroke();
    }
  }


  /* -------------------------- transport -------------------------- */

  function play() {
    // A plain play is always the whole file — drop any trim region first.
    clearRegion();
    ensurePlayerAudioContextRunning();
    audio.loop = repeatEnabled;
    audio.play().catch(() => {
      /* a load was cancelled by another load — harmless */
    });
  }

  function setRepeat(enabled: boolean) {
    repeatEnabled = Boolean(enabled);
    audio.loop = repeatEnabled;
    if (repeatBtn) repeatBtn.classList.toggle('is-on', repeatEnabled);
    emit();
    broadcastState();
  }

  if (repeatBtn) {
    repeatBtn.addEventListener('click', () => {
      setRepeat(!repeatEnabled);
    });
  }

  /**
   * Audition just [startSec, endSec] — used by the trim editor. Runs through the
   * same <audio> element (and its reverb/drone chain); the tick loop enforces
   * the end. `loop` keeps the region playing so you can fine-tune the handles.
   */
  function playRegion(startSec, endSec, { loop = true } = {}) {
    if (!current || duration() === 0) return;
    regionStart = Math.max(0, startSec || 0);
    regionEnd = Math.min(duration(), endSec == null ? duration() : endSec);
    regionLoop = loop;
    if (regionEnd - regionStart < 0.01) return; // nothing to hear
    ensurePlayerAudioContextRunning();
    audio.currentTime = regionStart;
    audio.play().catch(() => {});
  }

  function stopRegion() {
    audio.pause();
    clearRegion();
  }

  function seek(seconds) {
    if (!current || duration() === 0) return;
    clearRegion();
    audio.currentTime = Math.max(0, Math.min(duration(), seconds || 0));
    draw();
    broadcastState();
  }

  let onNeedTrackHandler: (() => void) | null = null;

  function toggle() {
    if (current) {
      if (audio.paused) play();
      else audio.pause();
    } else if (onNeedTrackHandler) {
      onNeedTrackHandler();
    }
  }

  function duration() {
    return Number.isFinite(audio.duration) ? audio.duration : 0;
  }

  function clock(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  let lastBroadcast = 0;
  function broadcastState() {
    if (window.api && window.api.broadcastPlayerState) {
      window.api.broadcastPlayerState({
        playing: !audio.paused,
        name: current ? current.name : 'No audio loaded',
        project: current ? current.project || current.where || '' : '',
        path: current ? current.path : '',
        currentTime: current ? audio.currentTime : 0,
        duration: current ? duration() : 0,
        peaks: peaks ? Array.from(peaks) : null,
        repeat: repeatEnabled,
        reverb: reverbEnabled,
        drone: Boolean(droneOsc)
      });
    }
  }

  let isTicking = false;
  let rafId: number | null = null;
  let bgTimerId: any = null;

  function startTick() {
    if (!isTicking) {
      isTicking = true;
      rafId = requestAnimationFrame(tick);
    }
    if (!bgTimerId) {
      bgTimerId = setInterval(backgroundTick, 100);
    }
  }

  function stopTick() {
    isTicking = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (bgTimerId !== null) {
      clearInterval(bgTimerId);
      bgTimerId = null;
    }
  }

  function backgroundTick() {
    if (audio.paused) {
      stopTick();
      return;
    }
    if (current && duration() > 0) {
      // Enforce a trim region: loop back to the start, or stop and release it.
      if (regionEnd !== null && !audio.paused && audio.currentTime >= regionEnd) {
        if (regionLoop) audio.currentTime = regionStart;
        else stopRegion();
      }
      const now = Date.now();
      if (now - lastBroadcast > 100) {
        lastBroadcast = now;
        broadcastState();
      }
    }
  }

  function tick() {
    if (!isTicking) return;
    if (current && duration() > 0) {
      // Enforce a trim region: loop back to the start, or stop and release it.
      if (regionEnd !== null && !audio.paused && audio.currentTime >= regionEnd) {
        if (regionLoop) audio.currentTime = regionStart;
        else stopRegion();
      }
      if (metronomeEnabled && !audio.paused) {
        const bpm = metronomeBpm || (current && current.bpm) || 128;
        const interval = getPulseInterval(metronomeSig, bpm);
        const currentPulse = Math.floor(audio.currentTime / interval);
        if (currentPulse !== lastMetronomeTickIndex && currentPulse >= 0) {
          lastMetronomeTickIndex = currentPulse;
          const { isDownbeat, isAccent } = getPulseAccent(metronomeSig, currentPulse);
          playClick(isDownbeat, isAccent);
        }
      }
      timeEl.textContent = `${clock(audio.currentTime)} / ${clock(duration())}`;
      draw();
      const now = Date.now();
      if (!audio.paused && now - lastBroadcast > 100) {
        lastBroadcast = now;
        broadcastState();
      }
    }
    if (!audio.paused) {
      rafId = requestAnimationFrame(tick);
    } else {
      isTicking = false;
      if (bgTimerId !== null) {
        clearInterval(bgTimerId);
        bgTimerId = null;
      }
    }
  }

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

    if (current && duration() > 0) {
      clearRegion(); // scrubbing the main player leaves trim-region mode
      lastMetronomeTickIndex = -1;
      audio.currentTime = clickRatio * duration();
      draw();
      broadcastState();
    }
  });

  playBtn.addEventListener('click', toggle);

  volumeEl.addEventListener('input', () => {
    audio.volume = Number(volumeEl.value);
  });

  audio.addEventListener('loadedmetadata', () => {
    if (current && !peaks) {
      timeEl.textContent = `${clock(audio.currentTime)} / ${clock(duration())}`;
      draw();
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (!audio.paused && current && duration() > 0) {
      const now = Date.now();
      if (now - lastBroadcast > 100) {
        lastBroadcast = now;
        broadcastState();
      }
    }
  });

  audio.addEventListener('play', () => {
    lastMetronomeTickIndex = -1;
    playBtn.innerHTML = '&#10074;&#10074;';
    startTick();
    emit();
    broadcastState();
  });
  audio.addEventListener('pause', () => {
    lastMetronomeTickIndex = -1;
    playBtn.innerHTML = '&#9654;';
    stopTick();
    draw();
    emit();
    broadcastState();
    schedulePlayerAudioContextSuspend();
  });
  audio.addEventListener('ended', () => {
    if (repeatEnabled) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    lastMetronomeTickIndex = -1;
    playBtn.innerHTML = '&#9654;';
    stopTick();
    draw();
    emit();
    broadcastState();
    schedulePlayerAudioContextSuspend();
  });

  window.addEventListener('resize', draw);

  function emit() {
    listeners.forEach((fn) =>
      fn({ path: current && current.path, playing: !audio.paused })
    );
  }

  // Handle commands arriving from tray or mini-player window
  if (typeof window !== 'undefined' && window.api && window.api.onPlayerCommand) {
    window.api.onPlayerCommand(({ cmd, arg }: any) => {
      if (cmd === 'togglePlayPause') {
        toggle();
      } else if (cmd === 'seek') {
        if (duration() > 0) {
          lastMetronomeTickIndex = -1;
          audio.currentTime = Math.max(0, Math.min(duration(), (arg || 0) * duration()));
          draw();
          broadcastState();
        }
      } else if (cmd === 'toggleRepeat') {
        setRepeat(typeof arg === 'boolean' ? arg : !repeatEnabled);
      } else if (cmd === 'toggleVerb') {
        setReverb(!reverbEnabled);
        if (verbBtn) verbBtn.classList.toggle('is-on', reverbEnabled);
        broadcastState();
      } else if (cmd === 'toggleDrone') {
        if (droneOsc) stopDrone();
        else if (current) startDrone('C');
        broadcastState();
      }
    });
  }

  draw();

  return {
    load,
    toggle,
    setRepeat,
    isRepeat: () => repeatEnabled,
    setReverb,
    setSoftClip,
    setClipperEnabled: (on: boolean) => setSoftClip(on),
    isClipperEnabled: () => clipperEnabled,
    openClipperPanel,
    closeClipperPanel,
    startDrone,
    stopDrone,
    broadcastState,
    isDroning: () => Boolean(droneOsc),
    setMetronome,
    isMetronome: () => metronomeEnabled,
    setMetronomeSignature,
    getMetronomeSignature: () => metronomeSig,
    setMetronomeBpm,
    getMetronomeBpm: () => metronomeBpm,
    setMetronomeSound,
    getMetronomeSound,
    getMetronomeSoundsets: () => METRONOME_SOUNDSETS,
    isPlaying: () => !audio.paused && Boolean(current),
    getDecoded: () => decoded,
    getCurrent: () => current,
    decode,
    playRegion,
    stopRegion,
    seek,
    draw,
    onChange: (fn) => listeners.push(fn),
    onNeedTrack: (fn: () => void) => { onNeedTrackHandler = fn; }
  };
})();

export { Player };
