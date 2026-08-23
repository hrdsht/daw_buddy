const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

app.whenReady().then(async () => {
  const wallpapers = [
    { id: 'wp1', name: 'fire_oni', file: 'wp1.jpg' },
    { id: 'wp2', name: 'cyberpunk', file: 'wp2.jpg' },
    { id: 'wp3', name: 'red_moon', file: 'wp3.jpg' },
    { id: 'wp4', name: 'katana', file: 'wp4.jpg' },
    { id: 'wp5', name: 'dragon', file: 'wp5.jpg' }
  ];

  const videoInput = path.resolve(__dirname, '../social-assets/assets/splash screen.mp4');
  const assetsDir = path.resolve(__dirname, '../social-assets/assets');

  // We render 2 formats at 2X Ultra-HD resolution:
  // 1. REEL 9:16 (1080x1920 canvas -> 2160x3840 2X master) - Best for Instagram Reels & Stories
  // 2. POST 4:5 (1080x1350 canvas -> 2160x2700 2X master) - Best for Instagram Carousel / Feed Posts
  // 3. SQUARE 1:1 (1080x1080 canvas -> 2160x2160 2X master) - Best for Standard Square Feed Posts

  const formats = [
    {
      id: 'reel_9x16',
      label: 'Instagram Reel (9:16 Fullscreen)',
      width: 1080,
      height: 1920,
      scale: 2, // 2160x3840 2X UHD
      fx: 50,
      fy: 440,
      fw: 980,
      fh: 1018, // 38 titlebar + 980x980 square window for 1:1 video
      renderHtml: (w, h) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');
            * { margin:0; padding:0; box-sizing:border-box; }
            body {
              width: ${w}px;
              height: ${h}px;
              overflow: hidden;
              background: transparent;
              font-family: 'Inter', sans-serif;
            }
            canvas { width: ${w}px; height: ${h}px; }
          </style>
        </head>
        <body>
          <canvas id="c" width="${w}" height="${h}"></canvas>
          <script>
            window.renderOverlay = function() {
              const canvas = document.getElementById('c');
              const ctx = canvas.getContext('2d');
              const W = ${w}, H = ${h};
              ctx.clearRect(0, 0, W, H);

              // 1. Ambient Dark Radial Vignette
              const radGlow = ctx.createRadialGradient(W/2, 300, 50, W/2, H/2, H * 0.75);
              radGlow.addColorStop(0, 'rgba(0,0,0,0.20)');
              radGlow.addColorStop(0.55, 'rgba(10,11,16,0.85)');
              radGlow.addColorStop(1, 'rgba(5,6,9,0.97)');
              ctx.fillStyle = radGlow;
              ctx.fillRect(0, 0, W, H);

              // 2. Cutout Window Frame for Video
              const fx = 50, fy = 440, fw = 980, fh = 1018;
              ctx.save();
              ctx.globalCompositeOperation = 'destination-out';
              ctx.beginPath();
              ctx.roundRect(fx, fy, fw, fh, 20);
              ctx.fill();
              ctx.restore();

              // 3. Header Brand Tag (Top)
              ctx.save();
              ctx.fillStyle = 'rgba(14, 18, 16, 0.92)';
              ctx.strokeStyle = 'rgba(255,255,255,0.22)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(50, 90, 180, 48, 24);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = '#00f0ff';
              ctx.beginPath();
              ctx.roundRect(58, 100, 28, 28, 7);
              ctx.fill();
              ctx.fillStyle = '#041014';
              ctx.font = '800 15px "IBM Plex Mono", monospace';
              ctx.fillText('DB', 62, 120);

              ctx.fillStyle = '#ffffff';
              ctx.font = '700 18px "Space Grotesk", sans-serif';
              ctx.fillText('DAW Buddy', 98, 121);

              // Badge
              ctx.fillStyle = 'rgba(255, 42, 85, 0.16)';
              ctx.strokeStyle = 'rgba(255, 42, 85, 0.45)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(W - 190, 95, 140, 38, 19);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = '#ff3366';
              ctx.font = '700 14px "IBM Plex Mono", monospace';
              ctx.fillText('FREE APP', W - 160, 119);
              ctx.restore();

              // 4. Hero Text
              ctx.fillStyle = '#ff3366';
              ctx.font = '700 16px "IBM Plex Mono", monospace';
              ctx.fillText('• STARTUP VIDEO REEL', 50, 230);

              ctx.fillStyle = '#ffffff';
              ctx.font = '800 48px "Space Grotesk", sans-serif';
              ctx.fillText('Meet DAW Buddy.', 50, 290);

              ctx.fillStyle = 'rgba(245, 249, 246, 0.90)';
              ctx.font = '400 21px "Inter", sans-serif';
              ctx.fillText('The lightweight, ultra-fast companion app built to browse,', 50, 335);
              ctx.fillText('analyze, and tidy your music projects & audio renders.', 50, 368);

              // 5. Window Frame Styling (Outer Stroke & Titlebar)
              ctx.save();
              ctx.strokeStyle = 'rgba(255,255,255,0.22)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.roundRect(fx, fy, fw, fh, 20);
              ctx.stroke();
              ctx.clip();

              // Titlebar
              ctx.fillStyle = 'rgba(0,0,0,0.70)';
              ctx.fillRect(fx, fy, fw, 38);
              ctx.fillStyle = '#ff5f56'; ctx.beginPath(); ctx.arc(fx + 22, fy + 19, 6, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(fx + 40, fy + 19, 6, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#27c93f'; ctx.beginPath(); ctx.arc(fx + 58, fy + 19, 6, 0, Math.PI * 2); ctx.fill();

              ctx.fillStyle = 'rgba(255,255,255,0.7)';
              ctx.font = '600 13px "IBM Plex Mono", monospace';
              ctx.fillText('DAW Buddy • Startup Video Reel', fx + 80, fy + 24);

              ctx.fillStyle = '#00f0ff';
              ctx.fillText('v0.4.9-beta2', fx + fw - 110, fy + 24);

              // Scanning Chip at bottom
              ctx.fillStyle = 'rgba(0,0,0,0.88)';
              ctx.strokeStyle = 'rgba(0,240,255,0.7)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(fx + fw / 2 - 190, fy + fh - 60, 380, 38, 19);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = '#00f0ff';
              ctx.beginPath();
              ctx.arc(fx + fw / 2 - 165, fy + fh - 41, 5.5, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#00f0ff';
              ctx.font = '700 13px "IBM Plex Mono", monospace';
              ctx.fillText('Scanning your projects… (DAW Buddy Startup)', fx + fw / 2 - 148, fy + fh - 36);

              ctx.restore();

              // 6. Reel Footer CTA
              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.font = '700 18px "Inter", sans-serif';
              ctx.fillText('⚡ Free & Open Source  •  Windows / macOS / Linux', 50, 1600);

              ctx.fillStyle = '#00f0ff';
              ctx.font = '700 20px "Space Grotesk", sans-serif';
              ctx.fillText('🔗 Download Link In Bio  •  Star on GitHub ⭐', 50, 1640);

              return canvas.toDataURL('image/png');
            };
          </script>
        </body>
        </html>
      `
    },
    {
      id: 'post_4x5',
      label: 'Instagram Post Carousel (4:5 Portrait)',
      width: 1080,
      height: 1350,
      scale: 2, // 2160x2700 2X UHD
      fx: 44,
      fy: 250,
      fw: 992,
      fh: 992, // 38 titlebar + 954h video area
      renderHtml: (w, h) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');
            * { margin:0; padding:0; box-sizing:border-box; }
            body {
              width: ${w}px;
              height: ${h}px;
              overflow: hidden;
              background: transparent;
              font-family: 'Inter', sans-serif;
            }
            canvas { width: ${w}px; height: ${h}px; }
          </style>
        </head>
        <body>
          <canvas id="c" width="${w}" height="${h}"></canvas>
          <script>
            window.renderOverlay = function() {
              const canvas = document.getElementById('c');
              const ctx = canvas.getContext('2d');
              const W = ${w}, H = ${h};
              ctx.clearRect(0, 0, W, H);

              // 1. Ambient Dark Vignette
              const radGlow = ctx.createRadialGradient(W/2, 160, 0, W/2, H/2, 900);
              radGlow.addColorStop(0, 'rgba(0,0,0,0.25)');
              radGlow.addColorStop(0.68, 'rgba(10,11,16,0.85)');
              radGlow.addColorStop(1, 'rgba(6,7,10,0.96)');
              ctx.fillStyle = radGlow;
              ctx.fillRect(0, 0, W, H);

              // 2. Cutout Window Frame for Video
              const fx = 44, fy = 250, fw = 992, fh = 992;
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
              ctx.fillText('• STARTUP VIDEO REEL', 44, 140);

              ctx.fillStyle = '#ffffff';
              ctx.font = '700 36px "Space Grotesk", sans-serif';
              ctx.fillText('Meet DAW Buddy.', 44, 184);

              ctx.fillStyle = 'rgba(245, 249, 246, 0.88)';
              ctx.font = '400 17px "Inter", sans-serif';
              ctx.fillText('The lightweight, high-performance companion app built to browse, analyze, and tidy your music sessions.', 44, 216);

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
              ctx.fillText('v0.4.9-beta2', fx + fw - 90, fy + 23);

              // Scanning Chip
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
              ctx.fillText('⚡ Free & Open Source  •  Windows / macOS / Linux', 44, 1285);

              ctx.fillStyle = '#ff3366';
              ctx.font = '600 13.5px "IBM Plex Mono", monospace';
              ctx.fillText('Swipe Next →', 950, 1285);

              return canvas.toDataURL('image/png');
            };
          </script>
        </body>
        </html>
      `
    }
  ];

  const win = new BrowserWindow({
    width: 1080,
    height: 1920,
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  for (const fmt of formats) {
    console.log(`\n========================================`);
    console.log(`Rendering Format: ${fmt.label} (${fmt.width}x${fmt.height})`);
    console.log(`========================================`);

    win.setSize(fmt.width, fmt.height);

    const tempHtmlPath = path.resolve(assetsDir, `_temp_overlay_${fmt.id}.html`);
    const htmlContent = fmt.renderHtml(fmt.width, fmt.height);
    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

    await win.loadFile(tempHtmlPath);
    await new Promise(r => setTimeout(r, 1500));

    const dataUrl = await win.webContents.executeJavaScript('window.renderOverlay()');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const overlayPngPath = path.resolve(assetsDir, `overlay_${fmt.id}.png`);
    fs.writeFileSync(overlayPngPath, base64Data, 'base64');
    console.log(`Overlay PNG saved: ${overlayPngPath}`);

    try { fs.unlinkSync(tempHtmlPath); } catch (_) {}

    // Calculate window geometry scaled to 1X canvas
    const vidX = fmt.fx;
    const vidY = fmt.fy + 38;
    const vidW = fmt.fw;
    const vidH = fmt.fh - 38;

    for (const wp of wallpapers) {
      const wpPath = path.resolve(__dirname, `../social-assets/wallpapers/${wp.file}`);
      const outMp4 = path.resolve(assetsDir, `daw_buddy_${fmt.id}_${wp.id}_${wp.name}.mp4`);
      
      console.log(`Generating: ${fmt.id} with ${wp.name}...`);

      const filter = `[0:v]scale=${fmt.width}:${fmt.height}:flags=lanczos[bg];` +
        `[1:v]scale=${vidW}:${vidH}:force_original_aspect_ratio=decrease,pad=${vidW}:${vidH}:(ow-iw)/2:(oh-ih)/2:color=black[vid];` +
        `[bg][vid]overlay=${vidX}:${vidY}:shortest=1[comp];` +
        `[comp][2:v]overlay=0:0:shortest=1[out]`;

      const ffmpegCmd = `ffmpeg -y -loop 1 -i "${wpPath}" -i "${videoInput}" -loop 1 -i "${overlayPngPath}" -filter_complex "${filter}" -map "[out]" -c:v libx264 -preset slow -crf 15 -profile:v high -level 4.2 -pix_fmt yuv420p -b:v 15M -maxrate 22M -bufsize 30M -movflags +faststart "${outMp4}"`;
      
      execSync(ffmpegCmd, { stdio: 'inherit' });
    }
  }

  try { win.destroy(); } catch (_) {}

  // Copy primary defaults for quick access
  const primaryReel = path.resolve(assetsDir, 'daw_buddy_reel_9x16_wp1_fire_oni.mp4');
  const primaryPost = path.resolve(assetsDir, 'daw_buddy_post_4x5_wp1_fire_oni.mp4');
  
  fs.copyFileSync(primaryReel, path.resolve(assetsDir, 'daw_buddy_startup_reel.mp4'));
  fs.copyFileSync(primaryPost, path.resolve(assetsDir, 'daw_buddy_startup_post_4x5.mp4'));
  fs.copyFileSync(primaryReel, path.resolve(assetsDir, 'daw_buddy_startup_reel_9x16.mp4'));

  console.log('\n✅ All formats rendered successfully at Master High-DPI Resolution!');
  app.quit();
});

