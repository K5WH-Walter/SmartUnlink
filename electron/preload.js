const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartunlink', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Radio CRUD
  getRadios:       () => ipcRenderer.invoke('get-radios'),
  getConfig:       () => ipcRenderer.invoke('get-config'),
  addRadio:        (radio)          => ipcRenderer.invoke('add-radio', radio),
  updateRadio:     (radio)          => ipcRenderer.invoke('update-radio', radio),
  deleteRadio:     (radioId)        => ipcRenderer.invoke('delete-radio', radioId),
  setRadioEnabled: (radioId, enabled) => ipcRenderer.invoke('set-radio-enabled', { radioId, enabled }),

  // LAN discovery
  getDiscovered:   () => ipcRenderer.invoke('get-discovered'),
  onRadioDiscovered: (cb) => {
    ipcRenderer.on('radio-discovered', (event, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('radio-discovered');
  },

  // Version auto-detect
  fetchRadioVersion: (ip) => ipcRenderer.invoke('fetch-radio-version', ip),

  // Settings
  setBroadcastInterval: (interval) => ipcRenderer.invoke('set-broadcast-interval', interval),
  getConfigPath:        ()          => ipcRenderer.invoke('get-config-path'),
  openConfigFolder:     ()          => ipcRenderer.invoke('open-config-folder'),

  // Broadcast events
  onBroadcastTick:  (cb) => {
    ipcRenderer.on('broadcast-tick',  (event, data)  => cb(data));
    return () => ipcRenderer.removeAllListeners('broadcast-tick');
  },
  onBroadcastError: (cb) => {
    ipcRenderer.on('broadcast-error', (event, error) => cb(error));
    return () => ipcRenderer.removeAllListeners('broadcast-error');
  }
});
