const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agathaSettings', {
  getCacheInfo: () => ipcRenderer.invoke('agatha-settings:get-cache-info'),
  openCacheFolder: () => ipcRenderer.invoke('agatha-settings:open-cache-folder'),
  getSystemInfo: () => ipcRenderer.invoke('agatha-settings:get-system-info')
});
