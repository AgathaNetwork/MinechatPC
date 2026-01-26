const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agathaWindowControls', {
	minimize: () => ipcRenderer.send('agatha-window-control', 'minimize'),
	toggleMaximize: () => ipcRenderer.send('agatha-window-control', 'toggleMaximize'),
	close: () => ipcRenderer.send('agatha-window-control', 'close'),
	openSettings: () => ipcRenderer.send('agatha-window-control', 'openSettings'),
	logout: () => ipcRenderer.invoke('agatha-session:logout'),
	getAlwaysOnTop: () => ipcRenderer.invoke('agatha-window-always-on-top', 'get'),
	toggleAlwaysOnTop: () => ipcRenderer.invoke('agatha-window-always-on-top', 'toggle')
});

// Dedicated token bridge (renderer -> main), for notify and other main-process services.
contextBridge.exposeInMainWorld('minechatAuth', {
	setToken: (token) => {
		try { ipcRenderer.send('minechat-auth:setToken', String(token || '')); } catch (e) {}
	},
	clearToken: () => {
		try { ipcRenderer.send('minechat-auth:setToken', ''); } catch (e) {}
	},
	getToken: async () => {
		try { return await ipcRenderer.invoke('minechat-auth:getToken'); } catch (e) { return ''; }
	}
});

// Compatibility: login.js already calls this name.
contextBridge.exposeInMainWorld('sendTokenToHost', (token) => {
	try { ipcRenderer.send('minechat-auth:setToken', String(token || '')); } catch (e) {}
});

function syncExistingTokenOnce() {
	try {
		const t = String((globalThis.localStorage && globalThis.localStorage.getItem('token')) || '').trim();
		if (t) ipcRenderer.send('minechat-auth:setToken', t);
	} catch (e) {
		// ignore
	}
}

// Ensure token is available to main-process services even when user skips login.
try {
	// DOMContentLoaded is early enough for localStorage.
	globalThis.addEventListener('DOMContentLoaded', () => syncExistingTokenOnce(), { once: true });
	// Also attempt immediately (in case preload runs after DOM is ready).
	syncExistingTokenOnce();

	// If another window/tab updates token, this event fires.
	globalThis.addEventListener('storage', (e) => {
		try {
			if (e && e.key === 'token') syncExistingTokenOnce();
		} catch (err) {}
	});
} catch (e) {
	// ignore
}
