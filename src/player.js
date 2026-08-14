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
  const canvas = document.getElementById('wave');
  const ctx = canvas.getContext('2d');
  const audio = new Audio();
  const titleEl = document.getElementById('nowPlaying');
  const timeEl = document.getElementById('nowTime');
  const playBtn = document.getElementById('playPause');
  const volumeEl = document.getElementById('volume');

  let audioContext = null;
  let peaks = null;
  let current = null; // { path, name }
  let decoded = null; // AudioBuffer
  let listeners = [];

  audio.volume = Number(volumeEl.value);

  /* --------------------------- loading --------------------------- */

  async function load(file, { autoplay = true } = {}) {
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
      timeEl.textContent = 'Could not read file';
      return null;
    }

    // One copy for the audio element, one for decoding — decodeAudioData
    // takes ownership of the buffer it's given and leaves it empty.
    const forPlayback = bytes.slice(0);

    const blob = new Blob([forPlayback], { type: guessType(file.name) });
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(blob);

    try {
      if (!audioContext) audioContext = new AudioContext();
      decoded = await audioContext.decodeAudioData(bytes);
      peaks = buildPeaks(decoded, 900);
      draw();
    } catch (err) {
      timeEl.textContent = 'Cannot decode this format';
    }

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
    getDecoded: () => decoded,
    getCurrent: () => current,
    onChange: (fn) => listeners.push(fn)
  };
})();

window.Player = Player;
