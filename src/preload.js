const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agathaWindowControls', {
	minimize: () => ipcRenderer.send('agatha-window-control', 'minimize'),
	toggleMaximize: () => ipcRenderer.send('agatha-window-control', 'toggleMaximize'),
	close: () => ipcRenderer.send('agatha-window-control', 'close'),
	openSettings: () => ipcRenderer.send('agatha-window-control', 'openSettings')
});
