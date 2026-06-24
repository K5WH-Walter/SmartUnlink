const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('smartunlink', {
  // Radio CRUD operations
  getRadios: () => ipcRenderer.invoke('get-radios'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  addRadio: (radio) => ipcRenderer.invoke('add-radio', radio),
  updateRadio: (radio) => ipcRenderer.invoke('update-radio', radio),
  deleteRadio: (radioId) => ipcRenderer.invoke('delete-radio', radioId),
  setRadioEnabled: (radioId, enabled) => ipcRenderer.invoke('set-radio-enabled', { radioId, enabled }),

  // Radio version auto-detect
  fetchRadioVersion: (ipAddress) => ipcRenderer.invoke('fetch-radio-version', ipAddress),

  // Configuration
  setBroadcastInterval: (interval) => ipcRenderer.invoke('set-broadcast-interval', interval),
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),

  // Event listeners
  onBroadcastTick: (callback) => {
    ipcRenderer.on('broadcast-tick', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('broadcast-tick');
  },
  onBroadcastError: (callback) => {
    ipcRenderer.on('broadcast-error', (event, error) => callback(error));
    return () => ipcRenderer.removeAllListeners('broadcast-error');
  }
});
