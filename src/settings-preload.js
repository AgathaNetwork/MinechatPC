const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agathaSettings', {
  getCacheInfo: () => ipcRenderer.invoke('agatha-settings:get-cache-info'),
  getOfflineCacheInfo: () => ipcRenderer.invoke('agatha-settings:get-offline-cache-info'),
  clearOfflineCache: () => ipcRenderer.invoke('agatha-settings:clear-offline-cache'),
  openCacheFolder: () => ipcRenderer.invoke('agatha-settings:open-cache-folder'),
  getSystemInfo: () => ipcRenderer.invoke('agatha-settings:get-system-info'),
  getAppInfo: () => ipcRenderer.invoke('agatha-settings:get-app-info')
});
