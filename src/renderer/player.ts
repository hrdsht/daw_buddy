'use strict';

import {
  DEFAULT_REVERB_SETTINGS,
  equalPowerReverbGains,
  formatReverbFrequency,
  normalizeReverbSettings
} from './reverb';

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

  let audioContext = null;
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
  let impulseTimer = null;
  let reverbSettings = loadReverbSettings();

  let metronomeEnabled = false;
  let metronomeSig = '4/4';
  let metronomeBpm: number | null = null;
  let lastMetronomeTickIndex = -1;

  // Demo / Placeholder waveform state when no real audio is loaded yet
  const DEMO_DURATION = 180; // 3:00 min demo audio
  const demoPeaks = generateDemoPeaks(300);
  let demoProgress = 0;
  let isDemoPlaying = false;
  let demoRafId: number | null = null;
  let demoStartTime = 0;
  let demoOsc: OscillatorNode | null = null;
  let demoGainNode: GainNode | null = null;

  function generateDemoPeaks(buckets = 300): Float32Array {
    const out = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      const norm = i / buckets;
      let env = 0.5;
      if (norm < 0.15) {
        env = 0.2 + 0.6 * (norm / 0.15);
      } else if (norm < 0.35) {
        env = 0.65 + 0.15 * Math.sin(norm * 40);
      } else if (norm < 0.55) {
        env = 0.85 + 0.12 * Math.cos(norm * 50);
      } else if (norm < 0.7) {
        env = 0.45 + 0.2 * Math.sin(norm * 30);
      } else if (norm < 0.9) {
        env = 0.92 + 0.08 * Math.sin(norm * 60);
      } else {
        env = 0.8 * (1 - (norm - 0.9) / 0.1) + 0.1;
      }
      const beat = Math.pow(Math.abs(Math.sin(norm * Math.PI * 32)), 4) * 0.25;
      const sub = Math.sin(norm * Math.PI * 8) * 0.1;
      const noise = ((Math.sin(i * 997 + i * i * 13) + 1) / 2) * 0.2;
      out[i] = Math.max(0.12, Math.min(0.98, (env + beat + sub + noise) * 0.8));
    }
    return smooth(out, 2);
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
    // Browsers start a context suspended until the user has interacted.
    if (audioContext.state === 'suspended') audioContext.resume();
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

  /**
   * Soft clipping via tanh. Hard clipping squares off the peaks and sounds
   * like damage; tanh bends them, which is what a saturator does.
   */
  function makeClipCurve(amount) {
    const samples = 8192;
    const curve = new Float32Array(samples);
    const drive = 1 + amount * 12;

    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
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

  verbBtn.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (reverbPanel.hidden) openReverbPanel();
    else closeReverbPanel();
  });

  Object.entries(reverbInputs).forEach(([name, input]) => {
    input.addEventListener('input', () => updateReverbFromControls(name));
  });

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

  function setSoftClip(amount) {
    buildChain();
    shaper.curve = amount > 0 ? makeClipCurve(amount) : null;
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
    if (!droneOsc) return;
    try {
      droneGain.gain.cancelScheduledValues(audioContext.currentTime);
      droneGain.gain.setValueAtTime(droneGain.gain.value, audioContext.currentTime);
      droneGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
      droneOsc.forEach((osc) => osc.stop(audioContext.currentTime + 0.15));
    } catch {
      /* already stopped */
    }
    droneOsc = null;
  }

  function getPulseInterval(sig: string, bpm: number): number {
    const safeBpm = bpm > 20 && bpm < 400 ? bpm : 120;
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

  function playClick(isDownbeat = false, isAccent = false) {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    const freq = isDownbeat ? 1400 : isAccent ? 1050 : 800;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.035);

    const clickVol = isDownbeat ? 0.9 : isAccent ? 0.75 : 0.6;
    gain.gain.setValueAtTime(clickVol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(now);
    osc.stop(now + 0.04);
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

  /* --------------------------- loading --------------------------- */

  async function load(file, { autoplay = true } = {}) {
    if (isDemoPlaying) stopDemoPlayback();
    const serial = ++loadSerial;
    clearRegion(); // a new file starts as whole-file playback
    current = { path: file.path, name: file.name };
    titleEl.textContent = file.name;
    timeEl.textContent = 'Loading…';
    peaks = null;
    decoded = null;
    draw();
    emit();

    let bytes;
    try {
      bytes = await window.api.readMedia(file.path);
    } catch (err) {
      if (serial === loadSerial) timeEl.textContent = 'Could not read file';
      return null;
    }
    if (serial !== loadSerial) return null;

    // One copy for the audio element, one for decoding — decodeAudioData
    // takes ownership of the buffer it's given and leaves it empty.
    const forPlayback = bytes.slice(0);

    const blob = new Blob([forPlayback], { type: guessType(file.name) });
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(blob);

    try {
      if (!audioContext) audioContext = new AudioContext();
      const nextDecoded = await audioContext.decodeAudioData(bytes);
      if (serial !== loadSerial) return null;
      decoded = nextDecoded;
      peaks = buildPeaks(nextDecoded, 900);
      draw();
    } catch (err) {
      if (serial === loadSerial) timeEl.textContent = 'Cannot decode this format';
    }

    if (serial !== loadSerial) return null;
    if (autoplay) play();
    emit();
    return decoded;
  }

  function guessType(name) {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'aiff' || ext === 'aif') return 'audio/aiff';
    return 'audio/wav';
  }

  /**
   * Reduces millions of samples to a few hundred min/max pairs — one per
   * horizontal pixel bucket. Drawing every sample would be both slower and
   * less readable.
   */
  function buildPeaks(buffer, buckets) {
    const channel = buffer.getChannelData(0);
    const size = Math.floor(channel.length / buckets);
    const out = new Float32Array(buckets);

    for (let b = 0; b < buckets; b += 1) {
      const start = b * size;
      const end = Math.min(start + size, channel.length);
      let peak = 0;
      // Step through rather than reading every sample; at this resolution
      // the difference is invisible and it's several times faster.
      for (let i = start; i < end; i += 4) {
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

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;

    // Centre line, always visible so an empty player still looks intentional
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const effectivePeaks = peaks || demoPeaks;
    if (!effectivePeaks || effectivePeaks.length === 0) return;

    const progress = current
      ? (duration() > 0 ? audio.currentTime / duration() : 0)
      : demoProgress;
    const playedX = width * progress;

    // One filled shape: across the top, back along the bottom, closed.
    const path = new Path2D();
    const step = width / (effectivePeaks.length - 1);
    const amp = mid * 0.92;

    path.moveTo(0, mid - effectivePeaks[0] * amp);
    for (let i = 1; i < effectivePeaks.length; i += 1) {
      const x = i * step;
      const y = mid - effectivePeaks[i] * amp;
      const prevX = (i - 1) * step;
      const prevY = mid - effectivePeaks[i - 1] * amp;
      // Quadratic through the midpoint — this is what turns a jagged comb
      // into a curve without losing the shape of the track.
      path.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
    }
    for (let i = effectivePeaks.length - 1; i >= 0; i -= 1) {
      const x = i * step;
      const y = mid + effectivePeaks[i] * amp;
      const prevX = Math.min(effectivePeaks.length - 1, i + 1) * step;
      const prevY = mid + effectivePeaks[Math.min(effectivePeaks.length - 1, i + 1)] * amp;
      path.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
    }
    path.closePath();

    // Unplayed portion
    ctx.save();
    const dim = ctx.createLinearGradient(0, 0, 0, height);
    dim.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    dim.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)');
    dim.addColorStop(1, 'rgba(255, 255, 255, 0.16)');
    ctx.fillStyle = dim;
    ctx.fill(path);
    ctx.restore();

    // Played portion, clipped to everything left of the playhead
    if (playedX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playedX, height);
      ctx.clip();
      const amberHex = getAmberColor();
      const lit = ctx.createLinearGradient(0, 0, 0, height);
      lit.addColorStop(0, amberHex);
      lit.addColorStop(0.5, amberHex);
      lit.addColorStop(1, amberHex);
      ctx.fillStyle = lit;
      ctx.shadowColor = 'rgba(0, 0, 0, 0)';
      ctx.shadowBlur = 0;
      ctx.fill(path);
      ctx.restore();
    }

    // Playhead
    ctx.strokeStyle = '#f3f2f0';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(playedX, 4);
    ctx.lineTo(playedX, height - 4);
    ctx.stroke();

    // Subtle Demo Waveform watermark label when idle/onboarding
    if (!current) {
      ctx.save();
      ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
      ctx.fillText('DEMO WAVEFORM PREVIEW', 10, 14);
      ctx.restore();
    }
  }

  let cachedAmberHex = '';
  let cachedAmberTime = 0;
  function getAmberColor(): string {
    const now = Date.now();
    if (!cachedAmberHex || now - cachedAmberTime > 1000) {
      cachedAmberHex =
        (typeof window !== 'undefined'
          ? getComputedStyle(document.body).getPropertyValue('--amber').trim()
          : '') || '#00f0ff';
      cachedAmberTime = now;
    }
    return cachedAmberHex;
  }

  /* -------------------------- transport -------------------------- */

  function startDemoPlayback() {
    isDemoPlaying = true;
    playBtn.innerHTML = '&#10074;&#10074;';
    demoStartTime = performance.now() - (demoProgress * DEMO_DURATION * 1000);
    buildChain();
    demoTick();
  }

  function stopDemoPlayback() {
    isDemoPlaying = false;
    playBtn.innerHTML = '&#9654;';
    if (demoRafId !== null) {
      cancelAnimationFrame(demoRafId);
      demoRafId = null;
    }
    draw();
  }

  function demoTick() {
    if (!isDemoPlaying) return;
    const now = performance.now();
    const elapsedSec = (now - demoStartTime) / 1000;
    demoProgress = elapsedSec / DEMO_DURATION;
    if (demoProgress >= 1) {
      demoProgress = 0;
      stopDemoPlayback();
      return;
    }
    if (timeEl) {
      timeEl.textContent = `${clock(demoProgress * DEMO_DURATION)} / ${clock(DEMO_DURATION)}`;
    }
    draw();
    demoRafId = requestAnimationFrame(demoTick);
  }

  function play() {
    if (isDemoPlaying) stopDemoPlayback();
    // A plain play is always the whole file — drop any trim region first.
    clearRegion();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    audio.play().catch(() => {
      /* a load was cancelled by another load — harmless */
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
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
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

  function toggle() {
    if (current) {
      if (audio.paused) play();
      else audio.pause();
    } else {
      if (isDemoPlaying) stopDemoPlayback();
      else startDemoPlayback();
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
        currentTime: audio.currentTime,
        duration: duration(),
        peaks: peaks ? Array.from(peaks).slice(0, 160) : null,
        reverb: reverbEnabled,
        drone: Boolean(droneOsc)
      });
    }
  }

  let isTicking = false;
  let rafId: number | null = null;

  function startTick() {
    if (!isTicking) {
      isTicking = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  function stopTick() {
    isTicking = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
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
        const bpm = metronomeBpm || (current && current.bpm) || 120;
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
      if (!audio.paused && now - lastBroadcast > 200) {
        lastBroadcast = now;
        broadcastState();
      }
    }
    if (!audio.paused) {
      rafId = requestAnimationFrame(tick);
    } else {
      isTicking = false;
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
    } else if (!current) {
      // Interactive scrubbing on demo waveform
      demoProgress = clickRatio;
      if (isDemoPlaying) {
        demoStartTime = performance.now() - (demoProgress * DEMO_DURATION * 1000);
      }
      if (timeEl) {
        timeEl.textContent = `${clock(demoProgress * DEMO_DURATION)} / ${clock(DEMO_DURATION)}`;
      }
      draw();
    }
  });

  playBtn.addEventListener('click', toggle);

  volumeEl.addEventListener('input', () => {
    audio.volume = Number(volumeEl.value);
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
  });
  audio.addEventListener('ended', () => {
    lastMetronomeTickIndex = -1;
    playBtn.innerHTML = '&#9654;';
    stopTick();
    draw();
    emit();
    broadcastState();
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
    setReverb,
    setSoftClip,
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
    isPlaying: () => !audio.paused && Boolean(current),
    getDecoded: () => decoded,
    getCurrent: () => current,
    playRegion,
    stopRegion,
    seek,
    draw,
    onChange: (fn) => listeners.push(fn)
  };
})();

export { Player };
