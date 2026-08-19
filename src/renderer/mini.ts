'use strict';

/**
 * Compact Tray / Menu-Bar Mini Player script.
 * Runs in its own lightweight always-on-top window, synchronized with main player.
 */

const titleEl = document.getElementById('miniTitle') as HTMLElement;
const projectEl = document.getElementById('miniProject') as HTMLElement;
const timeEl = document.getElementById('miniTime') as HTMLElement;
const playBtn = document.getElementById('miniPlayPause') as HTMLButtonElement;
const verbBtn = document.getElementById('miniVerb') as HTMLButtonElement;
const droneBtn = document.getElementById('miniDrone') as HTMLButtonElement;
const dragBtn = document.getElementById('miniDragBtn') as HTMLButtonElement;
const closeBtn = document.getElementById('miniClose') as HTMLButtonElement;
const expandBtn = document.getElementById('miniExpand') as HTMLButtonElement;
const waveWrap = document.getElementById('miniWaveWrap') as HTMLElement;
const canvas = document.getElementById('miniWave') as HTMLCanvasElement;
const playhead = document.getElementById('miniPlayhead') as HTMLElement;
const ctx = canvas.getContext('2d');

let currentTrackPath = '';
let currentDuration = 0;
let currentPeaks: number[] | null = null;
let isPlaying = false;

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

  const mid = height / 2;

  // Center line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  if (!peaks || peaks.length === 0) return;

  const playedX = width * progress;

  // Unplayed background wave
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  const step = width / (peaks.length - 1);
  const amp = mid * 0.9;

  ctx.beginPath();
  ctx.moveTo(0, mid - peaks[0] * amp);
  for (let i = 1; i < peaks.length; i += 1) {
    const x = i * step;
    const y = mid - peaks[i] * amp;
    const prevX = (i - 1) * step;
    const prevY = mid - peaks[i - 1] * amp;
    ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
  }
  for (let i = peaks.length - 1; i >= 0; i -= 1) {
    const x = i * step;
    const y = mid + peaks[i] * amp;
    const prevX = Math.min(peaks.length - 1, i + 1) * step;
    const prevY = mid + peaks[Math.min(peaks.length - 1, i + 1)] * amp;
    ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
  }
  ctx.closePath();
  ctx.fill();

  // Played progress wave (clipped)
  if (playedX > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, height);
    ctx.clip();
    ctx.fillStyle = '#9dde64';
    ctx.fill();
    ctx.restore();
  }
}

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
    if (typeof data.reverb === 'boolean') {
      verbBtn.classList.toggle('is-on', data.reverb);
    }
    if (typeof data.drone === 'boolean') {
      droneBtn.classList.toggle('is-on', data.drone);
    }
    if (typeof data.currentTime === 'number') {
      timeEl.textContent = `${formatTime(data.currentTime)} / ${formatTime(currentDuration)}`;
      const progress = currentDuration > 0 ? data.currentTime / currentDuration : 0;
      playhead.style.left = `${Math.min(100, Math.max(0, progress * 100))}%`;
      drawWaveform(currentPeaks, progress);
    }
  });
}

// Button listeners
playBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('togglePlayPause');
  }
});

verbBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('toggleVerb');
  }
});

droneBtn.addEventListener('click', () => {
  if (window.api && window.api.sendPlayerCommand) {
    window.api.sendPlayerCommand('toggleDrone');
  }
});

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
  }
  if (window.api && window.api.dragFiles) {
    await window.api.dragFiles([currentTrackPath]);
  }
});

window.addEventListener('resize', () => {
  drawWaveform(currentPeaks, 0);
});
