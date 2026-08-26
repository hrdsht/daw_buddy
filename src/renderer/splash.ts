'use strict';

const video = document.getElementById('splashVideo') as HTMLVideoElement | null;
const fallback = document.getElementById('splashFallback');
let sent = false;

function finish() {
  if (sent) return;
  sent = true;
  if ((window as any).splashApi && (window as any).splashApi.finished) {
    (window as any).splashApi.finished();
  }
}

if (video) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;

  video.addEventListener('ended', () => {
    setTimeout(finish, 100);
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
  setTimeout(finish, 1500);
}

document.addEventListener('click', finish, { once: true });
document.addEventListener('keydown', finish, { once: true });

// Hard fallback so the app never gets stuck indefinitely
setTimeout(finish, 4500);
