import { applyAppearance } from './dom';

const savedStyle = localStorage.getItem('dawBuddyThemeStyle') || 'minimalist';
const savedAccent = localStorage.getItem('dawBuddyAccent') || (savedStyle === 'minimalist' ? 'cyan' : 'green');
const savedSurface = localStorage.getItem('dawBuddySurface') || 'dark';
applyAppearance(savedAccent, savedSurface, savedStyle);

const titleEl = document.getElementById('miniTitle') as HTMLElement;
const projectEl = document.getElementById('miniProject') as HTMLElement;
const timeEl = document.getElementById('miniTime') as HTMLElement;
const playBtn = document.getElementById('miniPlayPause') as HTMLButtonElement;
const repeatBtn = document.getElementById('miniRepeat') as HTMLButtonElement;
const dragBtn = document.getElementById('miniDragBtn') as HTMLButtonElement;
const minimizeMainBtn = document.getElementById('miniMinimizeMain') as HTMLButtonElement;
const expandBtn = document.getElementById('miniExpand') as HTMLButtonElement;
const closeBtn = document.getElementById('miniClose') as HTMLButtonElement;
const waveWrap = document.getElementById('miniWaveWrap') as HTMLElement;
const canvas = document.getElementById('miniWave') as HTMLCanvasElement;
const playhead = document.getElementById('miniPlayhead') as HTMLElement;
const ctx = canvas.getContext('2d');

let currentTrackPath = '';
let currentDuration = 0;
let currentPeaks: number[] | null = null;
let currentProgress = 0;
let isPlaying = false;

function generateDemoPeaks(buckets = 300): number[] {
  const out: number[] = new Array(buckets);
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
    } else {
      env = 0.3 + 0.3 * (1 - norm);
    }
    out[i] = Math.max(0.04, Math.min(0.98, env * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.7)))));
  }
  return out;
}

const fallbackDemoPeaks = generateDemoPeaks(300);

let cachedAmberHex = '';
let cachedAmberTime = 0;
let cachedAmberIsLight = false;
function getAmberColor(): string {
  const isLight =
    typeof document !== 'undefined' &&
    (document.body.classList.contains('theme-light') ||
      document.body.getAttribute('data-surface') === 'light' ||
      document.body.dataset.surface === 'light');
  const now = Date.now();
  if (!cachedAmberHex || now - cachedAmberTime > 500 || cachedAmberIsLight !== isLight) {
    let val =
      (typeof window !== 'undefined'
        ? getComputedStyle(document.body).getPropertyValue('--amber').trim()
        : '') || (isLight ? '#008fa0' : '#00f0ff');

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

function formatTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function drawWaveform(peaks: number[] | null, progress: number) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const isLight =
    typeof document !== 'undefined' &&
    (document.body.classList.contains('theme-light') ||
      document.body.getAttribute('data-surface') === 'light' ||
      document.body.dataset.surface === 'light');
  const mid = height / 2;

  // Center line
  ctx.strokeStyle = isLight ? 'rgba(18, 23, 20, 0.16)' : 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
  const effectivePeaks = (peaks && peaks.length > 0) ? peaks : null;
  if (!effectivePeaks || effectivePeaks.length === 0) return;

  const playedX = width * Math.max(0, Math.min(1, progress));

  // Sample-accurate symmetric waveform shape
  const path = new Path2D();
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

  // Unplayed background wave
  ctx.save();
  ctx.fillStyle = isLight ? 'rgba(18, 23, 20, 0.28)' : 'rgba(255, 255, 255, 0.22)';
  ctx.fill(path);
  ctx.restore();

  // Played progress wave (clipped to left of playhead)
  if (playedX > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, height);
    ctx.clip();
    const amberColor = getAmberColor();
    ctx.fillStyle = amberColor;
    ctx.fill(path);
    ctx.restore();
  }

  // Playhead line
  ctx.strokeStyle = isLight ? '#121714' : '#f3f2f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(playedX, 1);
  ctx.lineTo(playedX, height - 1);
  ctx.stroke();
}

// Initial draw with fallback waveform
drawWaveform(currentPeaks, currentProgress);

// Receive sync updates from main process
if (window.api && window.api.onPlayerSync) {
  window.api.onPlayerSync((data: any) => {
    if (!data) return;
    if (data.name) titleEl.textContent = data.name;
    if (data.project) projectEl.textContent = data.project;
    if (data.path) currentTrackPath = data.path;
    if (typeof data.duration === 'number') currentDuration = data.duration;
    if (data.peaks) currentPeaks = data.peaks;
    if (typeof data.playing === 'boolean') {
      isPlaying = data.playing;
      playBtn.textContent = isPlaying ? '⏸' : '▶';
    }
    if (typeof data.repeat === 'boolean' && repeatBtn) {
      repeatBtn.classList.toggle('is-on', data.repeat);
    }
    if (typeof data.currentTime === 'number') {
      timeEl.textContent = `${formatTime(data.currentTime)} / ${formatTime(currentDuration)}`;
      currentProgress = currentDuration > 0 ? data.currentTime / currentDuration : 0;
      drawWaveform(currentPeaks, currentProgress);
    } else {
      drawWaveform(currentPeaks, currentProgress);
    }
  });
}

// Button listeners
playBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('togglePlayPause');
  }
});

if (repeatBtn) {
  repeatBtn.addEventListener('click', () => {
    if (window.api && window.api.sendPlayerCommand) {
      window.api.sendPlayerCommand('toggleRepeat');
    }
  });
}

if (minimizeMainBtn) {
  minimizeMainBtn.addEventListener('click', () => {
    if (window.api && window.api.sendPlayerCommand) {
      window.api.sendPlayerCommand('minimizeMain');
    }
  });
}

expandBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('expand');
  }
});

closeBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('closeMini');
  }
});

// Seek on wave click
waveWrap.addEventListener('click', (e: MouseEvent) => {
  const rect = waveWrap.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('seek', fraction);
  }
});

// Drag to DAW
dragBtn.addEventListener('dragstart', async (e: DragEvent) => {
  if (!currentTrackPath) return;
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', currentTrackPath);
    e.dataTransfer.effectAllowed = 'copy';
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);
  }
  if (window.api && window.api.dragFiles) {
    await window.api.dragFiles([currentTrackPath]);
  }
});

window.addEventListener('resize', () => {
  drawWaveform(currentPeaks, currentProgress);
});
