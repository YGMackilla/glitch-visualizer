// Glitch Visualizer — desktop app (OBS Window Capture friendly). Originally made by DJMackilla.
// AUDIO: it only ever hears MUSIC apps (Windows per-app loopback, see SOURCES below) —
// never your microphone, Discord, VRChat, games or the rest of the system.
const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, desktopCapturer } = require('electron');
const IS_WIN = process.platform === 'win32';
const path = require('path');
const { execFile } = require('child_process');
const alb = IS_WIN ? require('application-loopback') : null; // per-app capture is Windows-only
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---- diagnostics: write a log next to the .exe (GlitchVisualizer-log.txt) ----
const LOG = path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData'), 'GlitchVisualizer-log.txt');
function log(...a) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (e) {} }
try { fs.writeFileSync(LOG, ''); } catch (e) {}
log('start', process.versions.electron, process.platform, process.arch);
process.on('uncaughtException', e => log('MAIN uncaught', String(e && e.stack || e)));
app.on('child-process-gone', (e, d) => log('child-process-gone', d));

// ---- your setup (name, pictures, words) lives in theme.json in the app's settings folder ----
const THEME_FILE = path.join(app.getPath('userData'), 'theme.json');
function readTheme() { try { return JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log('theme read failed', String(e)); return null; } }
function writeTheme(t) { try { fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true }); fs.writeFileSync(THEME_FILE, JSON.stringify(t)); log('theme saved', (t && t.name) || ''); return true; } catch (err) { log('theme save failed', String(err)); return false; } }
log('theme file', THEME_FILE, fs.existsSync(THEME_FILE));
ipcMain.handle('theme-load', () => readTheme());
ipcMain.handle('theme-save', (e, t) => writeTheme(t));

// ---- local link for OBS Browser Source: http://localhost:17777 (this PC only) ----
const PORT = 17777;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else if (u === '/theme-save' && req.method === 'POST') {
    // fallback save path for the app window (also used if the preload bridge is unavailable)
    let body = ''; req.on('data', c => { body += c; if (body.length > 64e6) req.destroy(); });
    req.on('end', () => { let ok = false; try { ok = writeTheme(JSON.parse(body)); } catch (e) {} res.writeHead(ok ? 200 : 400, { 'Access-Control-Allow-Origin': '*' }); res.end(ok ? 'ok' : 'bad'); });
  } else if (u === '/theme-save' && req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end();
  } else if (u === '/theme.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    try { res.end(fs.readFileSync(THEME_FILE)); } catch (e) { res.end('null'); }
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server, path: '/audio' });
let lastStatus = '[]';
wss.on('error', () => {});
wss.on('connection', ws => { try { ws.send(lastStatus); if (lastDecks) ws.send(JSON.stringify({ decks: JSON.parse(lastDecks) })); } catch (e) {} });
server.on('error', () => {}); // port busy (second copy open) -> window still works
server.listen(PORT, '127.0.0.1');
function broadcastPcm(pid, d) {
  if (!wss.clients.size) return;
  const head = Buffer.alloc(4); head.writeUInt32LE(Number(pid) >>> 0, 0);
  const msg = Buffer.concat([head, d]);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
function broadcastStatus(list) {
  lastStatus = JSON.stringify(list);
  for (const c of wss.clients) if (c.readyState === 1) c.send(lastStatus);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// keep drawing even when covered by OBS/other windows (Chromium otherwise stops painting "occluded" windows -> black capture)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');
// macOS: let "Capture computer sound" grab system audio (macOS 13+)
if (process.platform === 'darwin') app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacCatapLoopbackAudioForScreenShare');

// ---- the allow-list -------------------------------------------------------
// Add your own app here if it's missing: { label: 'Name', exes: ['program.exe'] }
const SOURCES = [
  { label: 'Spotify',      exes: ['spotify.exe'] },
  { label: 'VirtualDJ',    exes: ['virtualdj.exe', 'virtualdj8.exe', 'virtualdj_pro.exe'] },
  { label: 'rekordbox',    exes: ['rekordbox.exe', 'rekordboxagent.exe'] },
  { label: 'Serato',       exes: ['serato dj pro.exe', 'serato dj lite.exe', 'serato dj.exe'] },
  { label: 'Traktor',      exes: ['traktor.exe', 'traktor pro 3.exe', 'traktor pro 4.exe'] },
  { label: 'Mixxx',        exes: ['mixxx.exe'] },
  { label: 'djay',         exes: ['djay.exe', 'djay pro.exe'] },
  { label: 'Apple Music',  exes: ['applemusic.exe', 'itunes.exe'] },
  { label: 'TIDAL',        exes: ['tidal.exe'] },
  { label: 'Deezer',       exes: ['deezer.exe'] },
  { label: 'Amazon Music', exes: ['amazon music.exe', 'amazonmusic.exe'] },
  { label: 'Music player', exes: ['foobar2000.exe', 'winamp.exe', 'musicbee.exe', 'aimp.exe', 'vlc.exe', 'mediamonkey.exe'] },
  { label: 'Media Player', exes: ['wmplayer.exe', 'microsoft.media.player.exe', 'music.ui.exe', 'video.ui.exe'] },
  // browsers count only while a window shows a music site
  { label: 'Browser music', exes: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'opera_gx.exe', 'vivaldi.exe', 'arc.exe'],
    needTitle: /youtube|soundcloud|spotify|bandcamp|mixcloud|apple music|tidal|deezer|audiomack|beatport|music/i }
];
// Hard block — never captured, even if something above matched by mistake
const BLOCKED_EXES = ['discord.exe', 'discordptb.exe', 'discordcanary.exe', 'discorddevelopment.exe', 'vrchat.exe', 'vrserver.exe', 'vrmonitor.exe', 'vrcompositor.exe', 'obs64.exe', 'obs32.exe', 'zoom.exe', 'teams.exe', 'ms-teams.exe', 'skype.exe'];
const BLOCKED_TITLE = /discord|vrchat|zoom|teams|meet\.google/i; // a browser showing one of these is skipped entirely
const ALL_EXES = SOURCES.flatMap(s => s.exes).filter(e => !BLOCKED_EXES.includes(e));
const sourceFor = exe => SOURCES.find(s => s.exes.includes(exe));

// binaries must run from outside the asar archive
if (alb) alb.setExecutablesRoot(path.join(__dirname, 'node_modules', 'application-loopback', 'bin').replace('app.asar', 'app.asar.unpacked'));

let win = null;
const captures = new Map(); // pid -> label

function listAllowedProcesses() {
  // pid;parentPid;name for allowed exes only
  const filter = ALL_EXES.map(n => `Name='${n}'`).join(' OR ');
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId);$($_.ParentProcessId);$($_.Name)" }`;
  return new Promise(res => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return res([]);
      res(out.split(/\r?\n/).map(l => l.trim().split(';')).filter(p => p.length === 3)
        .map(([pid, ppid, name]) => ({ pid, ppid, name: name.toLowerCase() })));
    });
  });
}

let polling = false;
async function poll() {
  if (!IS_WIN || polling) return; polling = true;
  try {
    const procs = await listAllowedProcesses();
    const byPid = new Map(procs.map(p => [p.pid, p]));
    // root processes only (child processes are covered by "include process tree")
    const roots = procs.filter(p => { const par = byPid.get(p.ppid); return !(par && par.name === p.name); });
    let windows = [];
    try { windows = await alb.getActiveWindowProcessIds(); } catch (e) {}
    const want = new Map();
    for (const r of roots) {
      if (BLOCKED_EXES.includes(r.name)) continue;
      const src = sourceFor(r.name); if (!src) continue;
      const titles = windows.filter(w => w.processId === r.pid).map(w => w.title || '');
      if (titles.some(t => BLOCKED_TITLE.test(t))) continue;
      if (src.needTitle && !windows.some(w => w.processId === r.pid && src.needTitle.test(w.title || ''))) continue;
      want.set(r.pid, src.label);
    }
    for (const [pid] of captures) if (!want.has(pid)) { alb.stopAudioCapture(pid); captures.delete(pid); }
    for (const [pid, label] of want) if (!captures.has(pid)) {
      try {
        alb.startAudioCapture(pid, { onData: d => { if (win && !win.isDestroyed()) win.webContents.send('pcm', pid, d); broadcastPcm(pid, d); } });
        captures.set(pid, label);
      } catch (e) {}
    }
    // which sources are live + their window titles (Spotify/YouTube show "Artist - Song" there)
    const list = [...captures.entries()].map(([pid, label]) => {
      const ws = windows.filter(w => w.processId === pid).map(w => w.title || '');
      const t = label === 'Browser music' ? (ws.find(x => sourceFor('chrome.exe').needTitle.test(x)) || '') : (ws.find(x => x.trim()) || '');
      return { label, title: BLOCKED_TITLE.test(t) ? '' : t };
    });
    if (win && !win.isDestroyed()) win.webContents.send('apps', list);
    broadcastStatus(list);
  } finally { polling = false; }
}
// ---- VirtualDJ now-mixing: read the last 2 tracks from VirtualDJ's live history file ----
const VDJ_HOMES = [path.join(process.env.LOCALAPPDATA || '', 'VirtualDJ'), path.join(app.getPath('documents'), 'VirtualDJ')];
let lastDecks = '';
function cleanTitle(p) {
  let t = path.win32.basename(p).replace(/\.[a-z0-9]{2,4}$/i, '');
  t = t.replace(/[\[(](official|lyric|lyrics|audio|video|visualizer|hq|hd|4k|free download|out now)[^\])]*[\])]/gi, '');
  return t.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
function newestM3u(dir, depth) {
  let best = null;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    let c = null;
    if (e.isDirectory() && depth > 0) c = newestM3u(f, depth - 1);
    else if (/\.m3u$/i.test(e.name)) { try { c = { f, m: fs.statSync(f).mtimeMs }; } catch (er) {} }
    if (c && (!best || c.m > best.m)) best = c;
  }
  return best;
}
function readDecks() {
  try {
    let hit = null;
    for (const h of VDJ_HOMES) { const n = newestM3u(path.join(h, 'History'), 2); if (n && (!hit || n.m > hit.m)) hit = n; }
    let out = { prev: '', cur: '', at: 0 };
    if (hit) {
      const lines = fs.readFileSync(hit.f, 'utf8').split(/\r?\n/);
      const tracks = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim(); if (!l || l.startsWith('#')) continue;
        const meta = lines[i - 1] || ''; const m = meta.match(/<lastplaytime>(\d+)</);
        tracks.push({ title: cleanTitle(l), at: m ? Number(m[1]) : Math.floor(hit.m / 1000) });
      }
      const last = tracks[tracks.length - 1], prev = tracks[tracks.length - 2];
      if (last && Date.now() / 1000 - last.at < 3 * 3600) out = { prev: prev ? prev.title : '', cur: last.title, at: last.at };
    }
    const j = JSON.stringify(out);
    if (j !== lastDecks) {
      lastDecks = j;
      if (win && !win.isDestroyed()) win.webContents.send('decks', out);
      for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify({ decks: out }));
    }
  } catch (e) {}
}

function stopAll() { if (!alb) return; for (const [pid] of captures) { try { alb.stopAudioCapture(pid); } catch (e) {} } captures.clear(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 720, useContentSize: true, backgroundColor: '#000000',
    title: 'Glitch Visualizer', autoHideMenuBar: true, minimizable: !IS_WIN,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenuBarVisibility(false);
  // Lock it down: no microphone, no screen/system-audio capture
  if (IS_WIN) {
    // Windows: music comes from the per-app capture above — no microphone, no screen/system capture
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => cb({}));
  } else {
    // Mac/Linux: the menu's "Capture computer sound" uses system audio, "Use audio input" uses a mic/interface
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['fullscreen', 'media', 'clipboard-sanitized-write'].includes(perm)));
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(src => cb({ video: src[0], audio: 'loopback' })).catch(() => cb({}));
    });
  }

  win.loadFile(path.join(__dirname, 'index.html'), { query: { app: '1' } });
  win.on('page-title-updated', e => e.preventDefault());
  const wc = win.webContents;
  wc.on('console-message', (e, level, message, line, src) => { if (level >= 2) log('PAGE', level === 3 ? 'error' : 'warn', message, (src || '').split('/').pop() + ':' + line); });
  wc.on('did-fail-load', (e, code, desc, url) => log('did-fail-load', code, desc, url));
  wc.on('preload-error', (e, p, err) => log('preload-error', String(err && err.stack || err)));
  wc.on('unresponsive', () => log('renderer unresponsive'));
  wc.on('render-process-gone', (e, d) => { log('render-process-gone', d); setTimeout(() => { if (win && !win.isDestroyed()) wc.reload(); }, 1000); });
  // watchdog: if the page stops advancing frames or goes fully black, log it and reload
  let lastFrame = -1, stuck = 0;
  setInterval(async () => {
    if (!win || win.isDestroyed()) return;
    try {
      const f = await Promise.race([wc.executeJavaScript('typeof frameNo!=="undefined"?frameNo:-1', true), new Promise(r => setTimeout(() => r(-2), 4000))]);
      const img = await wc.capturePage(); const bmp = img.toBitmap(); let lit = 0, n = 0;
      for (let i = 0; i < bmp.length; i += 4 * 211) { n++; if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 45) lit++; }
      const bad = f === -2 || f === lastFrame || lit < n * 0.01;
      if (bad) { stuck++; log('watchdog', { frame: f, lastFrame, lit, n, stuck }); } else stuck = 0;
      lastFrame = f;
      if (stuck >= 3) { log('watchdog: reloading page'); stuck = 0; lastFrame = -1; wc.reloadIgnoringCache(); }
    } catch (e) { log('watchdog error', String(e)); }
  }, 5000);
  wc.on('did-finish-load', () => {
    log('page loaded');
    setTimeout(async () => {
      try {
        const info = await wc.executeJavaScript('({w:innerWidth,h:innerHeight,frame:typeof frameNo!=="undefined"?frameNo:-1,mode:typeof mode!=="undefined"?mode:"?",appAudio:!!window.appAudio,appTheme:!!window.appTheme,dj:typeof DJ!=="undefined"?DJ:"?"})');
        log('page state', info);
        const img = await wc.capturePage();
        const sz = img.getSize(), bmp = img.toBitmap(); let lit = 0;
        for (let i = 0; i < bmp.length; i += 4 * 97) if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 60) lit++;
        log('capture', sz, 'lit-samples', lit, 'of', Math.floor(bmp.length / (4 * 97)));
        const gs = app.getGPUFeatureStatus(); log('gpu', gs);
      } catch (err) { log('diag failed', String(err)); }
    }, 6000);
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.on('did-finish-load', () => {
    poll(); lastDecks = ''; readDecks();
    const t = readTheme();
    wc.executeJavaScript('window.__injectTheme&&window.__injectTheme(' + JSON.stringify(t) + ')').then(r => log('theme injected', r)).catch(e => log('theme inject failed', String(e)));
  });
  if (IS_WIN) win.on('minimize', e => { e.preventDefault(); win.restore(); }); // stay capturable by OBS
  win.on('closed', () => { stopAll(); win = null; });
}

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
  setInterval(poll, 3000);
  setInterval(readDecks, 2000);
});
app.on('before-quit', stopAll);
app.on('window-all-closed', () => { stopAll(); app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
