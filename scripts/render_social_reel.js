const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1080,
    height: 1350,
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  const wallpapers = [
    { id: 'wp1', name: 'fire_oni', file: 'wp1.jpg' },
    { id: 'wp2', name: 'cyberpunk', file: 'wp2.jpg' },
    { id: 'wp3', name: 'red_moon', file: 'wp3.jpg' },
    { id: 'wp4', name: 'katana', file: 'wp4.jpg' },
    { id: 'wp5', name: 'dragon', file: 'wp5.jpg' }
  ];

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
          width: 1080px;
          height: 1350px;
          overflow: hidden;
          background: transparent;
          font-family: 'Inter', sans-serif;
        }
        canvas { width: 1080px; height: 1350px; }
      </style>
    </head>
    <body>
      <canvas id="c" width="1080" height="1350"></canvas>
      <script>
        window.renderOverlay = function() {
          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, 1080, 1350);

          // 1. Ambient Dark Vignette
          const radGlow = ctx.createRadialGradient(540, 160, 0, 540, 600, 900);
          radGlow.addColorStop(0, 'rgba(0,0,0,0.30)');
          radGlow.addColorStop(0.68, 'rgba(10,11,16,0.85)');
          radGlow.addColorStop(1, 'rgba(6,7,10,0.96)');
          ctx.fillStyle = radGlow;
          ctx.fillRect(0, 0, 1080, 1350);

          // 2. Cutout Window Frame for Video (fx: 44, fy: 260, fw: 992, fh: 740)
          const fx = 44, fy = 260, fw = 992, fh = 740;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.roundRect(fx, fy, fw, fh, 16);
          ctx.fill();
          ctx.restore();

          // 3. Header Brand Tag
          ctx.save();
          ctx.fillStyle = 'rgba(14, 18, 16, 0.90)';
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(44, 44, 160, 42, 21);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#00f0ff';
          ctx.beginPath();
          ctx.roundRect(52, 53, 24, 24, 6);
          ctx.fill();
          ctx.fillStyle = '#041014';
          ctx.font = '800 13px "IBM Plex Mono", monospace';
          ctx.fillText('DB', 56, 70);

          ctx.fillStyle = '#ffffff';
          ctx.font = '700 16px "Space Grotesk", sans-serif';
          ctx.fillText('DAW Buddy', 86, 71);

          // Badge
          ctx.fillStyle = 'rgba(255, 42, 85, 0.16)';
          ctx.strokeStyle = 'rgba(255, 42, 85, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(940, 48, 96, 34, 17);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ff3366';
          ctx.font = '600 14px "IBM Plex Mono", monospace';
          ctx.fillText('01 / 16', 958, 70);
          ctx.restore();

          // 4. Hero Text
          ctx.fillStyle = '#ff3366';
          ctx.font = '600 15px "IBM Plex Mono", monospace';
          ctx.fillText('• STARTUP VIDEO REEL', 44, 150);

          ctx.fillStyle = '#ffffff';
          ctx.font = '700 38px "Space Grotesk", sans-serif';
          ctx.fillText('Meet DAW Buddy.', 44, 196);

          ctx.fillStyle = 'rgba(245, 249, 246, 0.88)';
          ctx.font = '400 18px "Inter", sans-serif';
          ctx.fillText('The lightweight, high-performance companion app built to browse, analyze, and tidy your music sessions.', 44, 230);

          // 5. Window Frame Styling (Outer Stroke & Titlebar)
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(fx, fy, fw, fh, 16);
          ctx.stroke();
          ctx.clip();

          // Titlebar
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(fx, fy, fw, 38);
          ctx.fillStyle = '#ff5f56'; ctx.beginPath(); ctx.arc(fx + 20, fy + 19, 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(fx + 36, fy + 19, 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#27c93f'; ctx.beginPath(); ctx.arc(fx + 52, fy + 19, 5.5, 0, Math.PI * 2); ctx.fill();

          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = '500 11.5px "IBM Plex Mono", monospace';
          ctx.fillText('DAW Buddy • Startup Video Reel', fx + 72, fy + 23);

          ctx.fillStyle = '#00f0ff';
          ctx.fillText('v0.4.9-beta', fx + fw - 90, fy + 23);

          // Overlay Scanning Chip at window bottom
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeStyle = 'rgba(0,240,255,0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(fx + fw / 2 - 160, fy + fh - 54, 320, 32, 16);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#00f0ff';
          ctx.beginPath();
          ctx.arc(fx + fw / 2 - 140, fy + fh - 38, 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#00f0ff';
          ctx.font = '600 11.5px "IBM Plex Mono", monospace';
          ctx.fillText('Scanning your projects… (DAW Buddy Startup)', fx + fw / 2 - 126, fy + fh - 34);

          ctx.restore();

          // 6. Slide Footer
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '600 14px "Inter", sans-serif';
          ctx.fillText('⚡ Free & Open Source  •  Windows / macOS / Linux', 44, 1310);

          ctx.fillStyle = '#ff3366';
          ctx.font = '600 13.5px "IBM Plex Mono", monospace';
          ctx.fillText('Swipe Next →', 950, 1310);

          return canvas.toDataURL('image/png');
        };
      </script>
    </body>
    </html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  await new Promise(r => setTimeout(r, 1200));

  const dataUrl = await win.webContents.executeJavaScript('window.renderOverlay()');
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const overlayPngPath = path.resolve(__dirname, '../social-assets/assets/overlay_frame.png');
  fs.writeFileSync(overlayPngPath, base64Data, 'base64');
  console.log('Overlay PNG saved to:', overlayPngPath);

  const videoInput = path.resolve(__dirname, '../social-assets/assets/splash screen.mp4');

  for (const wp of wallpapers) {
    const wpPath = path.resolve(__dirname, `../social-assets/wallpapers/${wp.file}`);
    const outMp4 = path.resolve(__dirname, `../social-assets/assets/daw_buddy_startup_reel_${wp.id}_${wp.name}.mp4`);
    
    console.log(`Rendering Reel for ${wp.id} (${wp.name})...`);

    // Window interior: x: 44, y: 298, w: 992, h: 702
    const ffmpegCmd = `ffmpeg -y -loop 1 -i "${wpPath}" -i "${videoInput}" -loop 1 -i "${overlayPngPath}" -filter_complex "[0:v]scale=1080:1350[bg];[1:v]scale=992:702:force_original_aspect_ratio=decrease,pad=992:702:(ow-iw)/2:(oh-ih)/2:color=black[vid];[bg][vid]overlay=44:298:shortest=1[comp];[comp][2:v]overlay=0:0:shortest=1[out]" -map "[out]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -r 30 "${outMp4}"`;
    
    execSync(ffmpegCmd, { stdio: 'inherit' });
  }

  // Copy wp1 version as default daw_buddy_startup_reel.mp4
  const defaultMp4 = path.resolve(__dirname, '../social-assets/assets/daw_buddy_startup_reel.mp4');
  const wp1Mp4 = path.resolve(__dirname, '../social-assets/assets/daw_buddy_startup_reel_wp1_fire_oni.mp4');
  fs.copyFileSync(wp1Mp4, defaultMp4);
  console.log('Default MP4 updated at:', defaultMp4);

  app.quit();
});
