const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('offworkRadar', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  runScan: () => ipcRenderer.invoke('scan:run'),
  openMap: () => ipcRenderer.invoke('map:open'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  onScanUpdate: (callback) => {
    const listener = (_event, scan) => callback(scan);
    ipcRenderer.on('scan:update', listener);
    return () => ipcRenderer.removeListener('scan:update', listener);
  }
});
