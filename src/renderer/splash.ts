'use strict';

const video = document.getElementById('splashVideo') as HTMLVideoElement | null;
const fallback = document.getElementById('splashFallback');
const skipBtn = document.getElementById('splashSkipBtn');
let sent = false;

function finish(closeImmediately = false) {
  if (sent) return;
  sent = true;
  if (video) {
    video.pause();
    video.removeAttribute('src');
  }
  if ((window as any).splashApi && (window as any).splashApi.finished) {
    (window as any).splashApi.finished();
  }
  // A user-requested skip must not depend on an IPC round trip. Closing the
  // splash also resolves the supervisor's splash gate via its `closed` event.
  if (closeImmediately) window.close();
}

if (skipBtn) {
  const skip = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  };
  // pointerdown fires before click and avoids the button feeling stuck while
  // the video decoder is busy. click remains as keyboard/accessibility fallback.
  skipBtn.addEventListener('pointerdown', skip, { once: true, capture: true });
  skipBtn.addEventListener('click', skip, { once: true });
}

if (video) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;

  video.addEventListener('ended', () => {
    finish();
  }, { once: true });

  video.addEventListener('error', (e) => {
    console.warn('[splash] Video playback failed, switching to fallback:', e);
    if (fallback) fallback.style.display = 'flex';
    if (video) video.style.display = 'none';
    setTimeout(finish, 2000);
  }, { once: true });

  const tryPlay = () => {
    video.muted = true;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('[splash] Autoplay error:', err);
        setTimeout(() => {
          if (!sent && fallback && video.paused) {
            fallback.style.display = 'flex';
            video.style.display = 'none';
          }
        }, 800);
      });
    }
  };

  if (video.readyState >= 2) {
    tryPlay();
  } else {
    video.addEventListener('loadeddata', tryPlay, { once: true });
    video.addEventListener('canplay', tryPlay, { once: true });
    tryPlay();
  }
} else {
  setTimeout(finish, 2000);
}

document.addEventListener('click', () => finish(), { once: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
    finish();
  }
}, { once: true });

// Hard safety fallback matching video length (9s)
setTimeout(finish, 9000);

