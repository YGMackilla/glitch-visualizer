// Bridge between the visualizer page and the app:
//  - appAudio: music audio captured from allowed apps (per-app loopback, never the mic)
//  - appTheme: your saved setup (name, pictures, words) stored as theme.json in the app's settings folder
const { contextBridge, ipcRenderer } = require('electron');
if (process.platform === 'win32') contextBridge.exposeInMainWorld('appAudio', {
  onChunk: cb => ipcRenderer.on('pcm', (_e, pid, data) => cb(pid, data)),
  onStatus: cb => ipcRenderer.on('apps', (_e, list) => cb(list)),
  onDecks: cb => ipcRenderer.on('decks', (_e, d) => cb(d))
});
try {
  contextBridge.exposeInMainWorld('appTheme', {
    load: () => ipcRenderer.invoke('theme-load'),
    save: t => ipcRenderer.invoke('theme-save', t)
  });
} catch (e) {}
try { contextBridge.exposeInMainWorld('appPlatform', String(process.platform)); } catch (e) {}
