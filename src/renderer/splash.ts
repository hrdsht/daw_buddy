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
  video.addEventListener('ended', finish, { once: true });
  video.addEventListener('error', (e) => {
    console.warn('[splash] Video playback failed, switching to fallback:', e);
    if (fallback) fallback.style.display = 'flex';
    if (video) video.style.display = 'none';
    setTimeout(finish, 1500);
  }, { once: true });

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn('[splash] Autoplay error:', err);
      if (fallback) fallback.style.display = 'flex';
      if (video) video.style.display = 'none';
      setTimeout(finish, 1500);
    });
  }
} else {
  setTimeout(finish, 1200);
}

document.addEventListener('click', finish, { once: true });
document.addEventListener('keydown', finish, { once: true });

// Hard fallback so the app never gets stuck on the splash screen
setTimeout(finish, 3800);
