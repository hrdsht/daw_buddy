'use strict';

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

  let audioContext = null;
  let sourceNode = null;
  let dryGain = null;
  let wetGain = null;
  let convolver = null;
  let shaper = null;
  let droneOsc = null;
  let droneGain = null;
  let chainBuilt = false;
  let peaks = null;
  let current = null; // { path, name }
  let decoded = null; // AudioBuffer
  let listeners = [];
  let loadSerial = 0;

  audio.volume = Number(volumeEl.value);

  /* ------------------------- audition chain ---------------------- */

  /**
   * Playback runs through an optional reverb and soft clipper, and a separate
   * oscillator can hold the root note underneath.
   *
   *   <audio> -> shaper -> dry ----+
   *                    \-> convolver -> wet -+-> out
   *   oscillator -> droneGain --------------/
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
    convolver.buffer = makeImpulse(1.8, 2.2);

    dryGain = audioContext.createGain();
    wetGain = audioContext.createGain();
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;

    droneGain = audioContext.createGain();
    droneGain.gain.value = 0;

    sourceNode.connect(shaper);
    shaper.connect(dryGain);
    shaper.connect(convolver);
    convolver.connect(wetGain);

    dryGain.connect(audioContext.destination);
    wetGain.connect(audioContext.destination);
    droneGain.connect(audioContext.destination);

    chainBuilt = true;
  }

  /**
   * A reverb impulse, generated rather than loaded.
   *
   * Noise decaying exponentially is a crude but convincing tail — it's what a
   * real impulse response mostly is once you strip the room's character out.
   * Shipping an actual IR file would sound better and cost a few hundred KB;
   * this is for auditioning a dry sample, not for mixing.
   */
  function makeImpulse(seconds, decay) {
    const rate = audioContext.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = audioContext.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
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

  function setReverb(mix) {
    buildChain();
    wetGain.gain.value = mix;
    dryGain.gain.value = 1 - mix * 0.4; // reverb adds, doesn't replace
  }

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

  /* --------------------------- loading --------------------------- */

  async function load(file, { autoplay = true } = {}) {
    const serial = ++loadSerial;
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

    if (!peaks || peaks.length === 0) return;

    const progress = duration() > 0 ? audio.currentTime / duration() : 0;
    const playedX = width * progress;

    // One filled shape: across the top, back along the bottom, closed.
    const path = new Path2D();
    const step = width / (peaks.length - 1);
    const amp = mid * 0.92;

    path.moveTo(0, mid - peaks[0] * amp);
    for (let i = 1; i < peaks.length; i += 1) {
      const x = i * step;
      const y = mid - peaks[i] * amp;
      const prevX = (i - 1) * step;
      const prevY = mid - peaks[i - 1] * amp;
      // Quadratic through the midpoint — this is what turns a jagged comb
      // into a curve without losing the shape of the track.
      path.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
    }
    for (let i = peaks.length - 1; i >= 0; i -= 1) {
      const x = i * step;
      const y = mid + peaks[i] * amp;
      const prevX = Math.min(peaks.length - 1, i + 1) * step;
      const prevY = mid + peaks[Math.min(peaks.length - 1, i + 1)] * amp;
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
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, height);
    ctx.clip();
    const lit = ctx.createLinearGradient(0, 0, 0, height);
    lit.addColorStop(0, 'rgba(240, 166, 58, 0.85)');
    lit.addColorStop(0.5, '#f0a63a');
    lit.addColorStop(1, 'rgba(240, 166, 58, 0.85)');
    ctx.fillStyle = lit;
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.fill(path);
    ctx.restore();

    // Playhead
    ctx.strokeStyle = '#f3f2f0';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(playedX, 4);
    ctx.lineTo(playedX, height - 4);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /* -------------------------- transport -------------------------- */

  function play() {
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    audio.play().catch(() => {
      /* a load was cancelled by another load — harmless */
    });
  }

  function toggle() {
    if (!current) return;
    if (audio.paused) play();
    else audio.pause();
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

  function tick() {
    if (current && duration() > 0) {
      timeEl.textContent = `${clock(audio.currentTime)} / ${clock(duration())}`;
      draw();
    }
    requestAnimationFrame(tick);
  }

  canvas.addEventListener('click', (event) => {
    if (!current || duration() === 0) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration();
    draw();
  });

  playBtn.addEventListener('click', toggle);

  volumeEl.addEventListener('input', () => {
    audio.volume = Number(volumeEl.value);
  });

  audio.addEventListener('play', () => {
    playBtn.innerHTML = '&#10074;&#10074;';
    emit();
  });
  audio.addEventListener('pause', () => {
    playBtn.innerHTML = '&#9654;';
    emit();
  });
  audio.addEventListener('ended', () => {
    playBtn.innerHTML = '&#9654;';
    emit();
  });

  window.addEventListener('resize', draw);

  function emit() {
    listeners.forEach((fn) =>
      fn({ path: current && current.path, playing: !audio.paused })
    );
  }

  requestAnimationFrame(tick);
  draw();

  return {
    load,
    toggle,
    setReverb,
    setSoftClip,
    startDrone,
    stopDrone,
    isDroning: () => Boolean(droneOsc),
    getDecoded: () => decoded,
    getCurrent: () => current,
    onChange: (fn) => listeners.push(fn)
  };
})();

export { Player };
