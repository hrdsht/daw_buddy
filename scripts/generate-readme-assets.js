'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Enable 2x Retina / HiDPI rendering so all text, icons, and waveforms are ultra-crisp
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.commandLine.appendSwitch('high-dpi-support', '1');

const now = Date.now();

const mockEntries = [
  {
    name: 'Neon Horizons (VIP Mix)',
    folder: 'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons',
    path: 'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons\\Neon Horizons VIP.als',
    sessionPath: 'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons\\Neon Horizons VIP.als',
    root: 'D:\\Music\\Projects',
    location: 'VIPs/Neon Horizons',
    relPath: '2026/VIPs/Neon Horizons/Neon Horizons VIP.als',
    daw: 'Ableton Live',
    ext: '.als',
    mtime: now - 1000 * 60 * 25,
    modified: now - 1000 * 60 * 25,
    birthtime: now - 1000 * 60 * 60 * 24 * 7,
    size: 4521000,
    tempo: 128,
    bpm: 128,
    timeSignature: '4/4',
    health: 0.95,
    backupCount: 18,
    hasBackup: true,
    audioCount: 3,
    siblingCount: 1,
    renders: [
      { name: 'Neon Horizons VIP_Master_v2.wav', path: 'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons\\Neon Horizons VIP_Master_v2.wav', format: 'WAV', size: '64.2 MB', duration: 214 },
      { name: 'Neon Horizons VIP_Preview.mp3', path: 'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons\\Neon Horizons VIP_Preview.mp3', format: 'MP3', size: '8.4 MB', duration: 214 }
    ],
    tags: ['Mainstage', 'Festival', 'EDM']
  },
  {
    name: 'Monsoon Raaga Fusion (Bhairavi)',
    folder: 'D:\\Music\\Projects\\2026\\World\\Monsoon Fusion',
    path: 'D:\\Music\\Projects\\2026\\World\\Monsoon Fusion\\session.flp',
    sessionPath: 'D:\\Music\\Projects\\2026\\World\\Monsoon Fusion\\session.flp',
    root: 'D:\\Music\\Projects',
    location: 'World/Monsoon Fusion',
    relPath: '2026/World/Monsoon Fusion/session.flp',
    daw: 'FL Studio',
    ext: '.flp',
    mtime: now - 1000 * 60 * 110,
    modified: now - 1000 * 60 * 110,
    birthtime: now - 1000 * 60 * 60 * 24 * 3,
    size: 18200000,
    tempo: 140,
    bpm: 140,
    timeSignature: '16/16',
    health: 1.0,
    backupCount: 26,
    hasBackup: true,
    audioCount: 2,
    siblingCount: 1,
    renders: [
      { name: 'Monsoon_Bhairavi_Stems.wav', path: 'D:\\Music\\Projects\\2026\\World\\Monsoon Fusion\\Monsoon_Bhairavi_Stems.wav', format: 'WAV', size: '128 MB', duration: 320 }
    ],
    tags: ['Bhairavi', 'Fusion', 'Sitar']
  },
  {
    name: 'Midnight Mirage (Soul Vocal)',
    folder: 'D:\\Music\\Projects\\2026\\Downtempo\\Midnight Mirage.logicx',
    path: 'D:\\Music\\Projects\\2026\\Downtempo\\Midnight Mirage.logicx',
    sessionPath: 'D:\\Music\\Projects\\2026\\Downtempo\\Midnight Mirage.logicx',
    root: 'D:\\Music\\Projects',
    location: 'Downtempo/Midnight Mirage',
    relPath: '2026/Downtempo/Midnight Mirage.logicx',
    daw: 'Logic Pro',
    ext: '.logicx',
    mtime: now - 1000 * 60 * 60 * 5,
    modified: now - 1000 * 60 * 60 * 5,
    birthtime: now - 1000 * 60 * 60 * 24 * 10,
    size: 92400000,
    tempo: 115,
    bpm: 115,
    timeSignature: '4/4',
    health: 0.9,
    backupCount: 15,
    hasBackup: true,
    audioCount: 2,
    siblingCount: 1,
    renders: [
      { name: 'Midnight_Mirage_Rough.mp3', path: 'D:\\Music\\Projects\\2026\\Downtempo\\Midnight_Mirage_Rough.mp3', format: 'MP3', size: '7.6 MB', duration: 205 }
    ],
    tags: ['Soul', 'R&B', 'Vocal']
  },
  {
    name: 'Cyberpunk Skyline 2099',
    folder: 'D:\\Music\\Projects\\2026\\Bass\\Cyberpunk Skyline',
    path: 'D:\\Music\\Projects\\2026\\Bass\\Cyberpunk Skyline\\project.bwproject',
    sessionPath: 'D:\\Music\\Projects\\2026\\Bass\\Cyberpunk Skyline\\project.bwproject',
    root: 'D:\\Music\\Projects',
    location: 'Bass/Cyberpunk Skyline',
    relPath: '2026/Bass/Cyberpunk Skyline/project.bwproject',
    daw: 'Bitwig Studio',
    ext: '.bwproject',
    mtime: now - 1000 * 60 * 60 * 22,
    modified: now - 1000 * 60 * 60 * 22,
    birthtime: now - 1000 * 60 * 60 * 24 * 5,
    size: 7890000,
    tempo: 174,
    bpm: 174,
    timeSignature: '4/4',
    health: 1.0,
    backupCount: 34,
    hasBackup: true,
    audioCount: 2,
    siblingCount: 1,
    renders: [
      { name: 'Cyberpunk_2099_v3.wav', path: 'D:\\Music\\Projects\\2026\\Bass\\Cyberpunk Skyline\\Cyberpunk_2099_v3.wav', format: 'WAV', size: '82 MB', duration: 245 }
    ],
    tags: ['Drum & Bass', 'Neurofunk']
  },
  {
    name: 'Desert Caravan (Maqam Hijaz)',
    folder: 'D:\\Music\\Projects\\2026\\Cinematic\\Desert Caravan',
    path: 'D:\\Music\\Projects\\2026\\Cinematic\\Desert Caravan\\caravan.rpp',
    sessionPath: 'D:\\Music\\Projects\\2026\\Cinematic\\Desert Caravan\\caravan.rpp',
    root: 'D:\\Music\\Projects',
    location: 'Cinematic/Desert Caravan',
    relPath: '2026/Cinematic/Desert Caravan/caravan.rpp',
    daw: 'REAPER',
    ext: '.rpp',
    mtime: now - 1000 * 60 * 60 * 48,
    modified: now - 1000 * 60 * 60 * 48,
    birthtime: now - 1000 * 60 * 60 * 24 * 14,
    size: 1450000,
    tempo: 96,
    bpm: 96,
    timeSignature: '6/8',
    health: 0.8,
    backupCount: 12,
    hasBackup: true,
    audioCount: 1,
    siblingCount: 1,
    renders: [],
    tags: ['Arabic', 'Oud', 'Cinematic']
  },
  {
    name: 'Deep Ocean Organic House',
    folder: 'D:\\Music\\Projects\\2026\\House\\Deep Ocean',
    path: 'D:\\Music\\Projects\\2026\\House\\Deep Ocean\\song.cpr',
    sessionPath: 'D:\\Music\\Projects\\2026\\House\\Deep Ocean\\song.cpr',
    root: 'D:\\Music\\Projects',
    location: 'House/Deep Ocean',
    relPath: '2026/House/Deep Ocean/song.cpr',
    daw: 'Cubase',
    ext: '.cpr',
    mtime: now - 1000 * 60 * 60 * 72,
    modified: now - 1000 * 60 * 60 * 72,
    birthtime: now - 1000 * 60 * 60 * 24 * 20,
    size: 12300000,
    tempo: 122,
    bpm: 122,
    timeSignature: '4/4',
    health: 0.7,
    backupCount: 9,
    hasBackup: false,
    audioCount: 1,
    siblingCount: 1,
    renders: [],
    tags: ['Organic House', 'Deep']
  }
];

const mockRecords = {
  'D:\\Music\\Projects\\2026\\VIPs\\Neon Horizons\\Neon Horizons VIP.als': {
    favourite: true,
    key: 'F Minor',
    camelot: '4A',
    bpm: 128,
    genre: 'Festival EDM',
    tags: ['Mainstage', 'Festival', 'EDM'],
    note: 'Master limiter tweak complete. Checked on studio monitors & car test.'
  },
  'D:\\Music\\Projects\\2026\\World\\Monsoon Fusion\\session.flp': {
    favourite: true,
    key: 'C Bhairavi',
    camelot: '5A',
    bpm: 140,
    tala: 'Teental (16)',
    genre: 'Raaga Fusion',
    tags: ['Bhairavi', 'Fusion', 'Sitar'],
    note: 'Sitar lead recorded at 440 Hz, Teental 16 matras percussion.'
  },
  'D:\\Music\\Projects\\2026\\Downtempo\\Midnight Mirage.logicx': {
    favourite: true,
    key: 'A Minor',
    camelot: '8A',
    bpm: 115,
    genre: 'Neo Soul',
    tags: ['Soul', 'R&B', 'Vocal'],
    note: 'Vocal takes split with Vocal Reconstruction Suite, tuned & aligned.'
  },
  'D:\\Music\\Projects\\2026\\Bass\\Cyberpunk Skyline\\project.bwproject': {
    favourite: false,
    key: 'F# Minor',
    camelot: '11A',
    bpm: 174,
    genre: 'Neurofunk',
    tags: ['Drum & Bass', 'Neurofunk']
  },
  'D:\\Music\\Projects\\2026\\Cinematic\\Desert Caravan\\caravan.rpp': {
    favourite: false,
    key: 'D Hijaz',
    camelot: '7A',
    bpm: 96,
    genre: 'Arabic Cinematic',
    tags: ['Arabic', 'Oud', 'Cinematic']
  },
  'D:\\Music\\Projects\\2026\\House\\Deep Ocean\\song.cpr': {
    favourite: false,
    key: 'E Minor',
    camelot: '9A',
    bpm: 122,
    genre: 'Organic House',
    tags: ['Organic House', 'Deep']
  }
};

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '..', 'docs', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  ipcMain.handle('settings:get', async () => ({
    roots: ['D:\\Music\\Projects'],
    alwaysOnTop: false,
    listSort: { by: 'modified', dir: -1 },
    region: 'indian',
    scaleTraditions: ['all'],
    regionSetupComplete: true,
    ignore: ['Backup', 'Samples'],
    isMac: false,
    isLinux: false,
    dataDir: 'C:\\Users\\Producer\\AppData\\Roaming\\daw-buddy'
  }));

  ipcMain.handle('settings:update', async (_e, patch) => patch);
  ipcMain.handle('records:all', async () => mockRecords);
  ipcMain.handle('records:set', async () => true);
  ipcMain.handle('projects:scan', async () => ({
    entries: mockEntries,
    grouped: [],
    errors: [],
    truncated: false,
    foldersRead: 142
  }));
  ipcMain.handle('projects:browse', async () => ({
    entries: mockEntries,
    grouped: [],
    errors: [],
    truncated: false,
    foldersRead: 142
  }));
  ipcMain.handle('daws:running', async () => ['Ableton Live', 'FL Studio']);
  ipcMain.handle('notes:load', async (_e, p) => mockRecords[p]?.note || '');
  ipcMain.handle('renders:find', async (_e, p) => {
    const entry = mockEntries.find((e) => e.path === p);
    return { direct: entry?.renders || [], siblingRenders: [], otherAudio: [] };
  });
  ipcMain.handle('renders:all', async () => []);
  ipcMain.handle('videos:list', async () => []);
  ipcMain.handle('output:get', async () => 'D:\\Music\\Projects\\Bounces');

  const win = new BrowserWindow({
    width: 1360,
    height: 840,
    show: false,
    backgroundColor: '#0c1013',
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));

  // Wait 1.8s for all async timers and completely purge any tour overlays / blur filters
  await new Promise((r) => setTimeout(r, 1800));
  await win.webContents.executeJavaScript(`
    // Kill any active tour instances
    document.querySelectorAll('.tour-overlay, .tour-card, .tour-tooltip').forEach(el => el.remove());
    document.body.style.filter = 'none';
    document.documentElement.style.filter = 'none';
    const mainEl = document.querySelector('.main');
    if (mainEl) mainEl.style.filter = 'none';
  `);
  await new Promise((r) => setTimeout(r, 400));

  // 1. Pristine Razor-Sharp Dashboard
  const homeImg = await win.webContents.capturePage();
  const homePath = path.join(outDir, 'daw-buddy-dashboard.png');
  fs.writeFileSync(homePath, homeImg.toPNG());
  console.log('Saved Razor-Sharp Dashboard to:', homePath);

  // 2. Tools Hub View
  await win.webContents.executeJavaScript(`
    const toolsBtn = document.getElementById('openTools');
    if (toolsBtn) toolsBtn.click();
    document.querySelectorAll('.tour-overlay, .tour-card, .tour-tooltip').forEach(el => el.remove());
  `);
  await new Promise((r) => setTimeout(r, 800));
  const toolsImg = await win.webContents.capturePage();
  const toolsPath = path.join(outDir, 'daw-buddy-tools.png');
  fs.writeFileSync(toolsPath, toolsImg.toPNG());
  console.log('Saved Tools to:', toolsPath);

  // 3. Producer Randomizer Tool View
  await win.webContents.executeJavaScript(`
    const randCard = Array.from(document.querySelectorAll('.tool-card')).find(c => c.textContent.includes('Producer Randomizer'));
    if (randCard) randCard.click();
    setTimeout(() => {
      document.querySelectorAll('.tour-overlay, .tour-card, .tour-tooltip').forEach(el => el.remove());
    }, 150);
  `);
  await new Promise((r) => setTimeout(r, 1200));
  const randImg = await win.webContents.capturePage();
  const randPath = path.join(outDir, 'daw-buddy-randomizer.png');
  fs.writeFileSync(randPath, randImg.toPNG());
  console.log('Saved Producer Randomizer to:', randPath);

  // 4. 3D World Globe Modal
  await win.webContents.executeJavaScript(`
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.click();
    setTimeout(() => {
      const settingsBtn = document.getElementById('openSettings');
      if (settingsBtn) settingsBtn.click();
      setTimeout(() => {
        const globeBtn = document.getElementById('openRegionGlobeSetup');
        if (globeBtn) globeBtn.click();
      }, 300);
    }, 200);
  `);
  await new Promise((r) => setTimeout(r, 2000));
  const globeImg = await win.webContents.capturePage();
  const globePath = path.join(outDir, 'daw-buddy-globe.png');
  fs.writeFileSync(globePath, globeImg.toPNG());
  console.log('Saved 3D World Globe to:', globePath);

  app.quit();
});
