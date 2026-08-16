'use strict';

const video = document.getElementById('splashVideo');
let sent = false;

function finish() {
  if (sent) return;
  sent = true;
  window.splashApi.finished();
}

video.addEventListener('ended', finish, { once: true });
video.addEventListener('error', finish, { once: true });

// Autoplay is expected because the animation is muted. If the operating
// system blocks it anyway, do not leave the user trapped behind the splash.
video.play().catch(() => setTimeout(finish, 2500));
setTimeout(finish, 12000);
