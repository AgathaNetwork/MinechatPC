const { app, BrowserWindow, Menu, ipcMain, session, shell, Tray } = require('electron');
const { startNotifyListener } = require('./notify');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Force a consistent display name (tray tooltip, etc.).
app.setName('Minechat');
// 启动通知监听
app.whenReady().then(() => {
  startNotifyListener();
});

const START_URL = 'https://front-dev.agatha.org.cn';
const PERSIST_PARTITION = 'persist:agatha-front';
const APP_HOSTNAME = 'front-dev.agatha.org.cn';

const EXACT_ALLOWED_HOSTS = new Set([
  'front-dev.agatha.org.cn',

  // Microsoft identity endpoints (common set).
  'login.microsoftonline.com',
  'login.live.com',
  'account.live.com',
  'aadcdn.msauth.net',
  'aadcdn.msftauth.net'
]);

const ALLOWED_HOST_SUFFIXES = [
  // Covers regional and tenant-specific Microsoft Online hosts.
  '.microsoftonline.com',
  '.msauth.net',
  '.msftauth.net'
];

function isAllowedHost(hostname) {
  if (!hostname) return false;
  if (EXACT_ALLOWED_HOSTS.has(hostname)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isAllowedUrl(urlString) {
  try {
    const url = new URL(urlString);
    return isAllowedHost(url.hostname);
  } catch {
    return false;
  }
}

function shouldForcePermanentCache(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname !== APP_HOSTNAME) return false;

    const pathname = url.pathname.toLowerCase();
    return (
      pathname.endsWith('.html') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.bmp') ||
      pathname.endsWith('.js')
    );
  } catch {
    return false;
  }
}

function installPermanentCacheHeaders(sess) {
  if (sess.__agathaPermanentCacheInstalled) return;
  sess.__agathaPermanentCacheInstalled = true;

  // Force long-lived cache for specific static resource types.
  // Note: This does not affect cookies; it only changes response caching headers.
  sess.webRequest.onHeadersReceived({ urls: [`https://${APP_HOSTNAME}/*`] }, (details, callback) => {
    if (!shouldForcePermanentCache(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...(details.responseHeaders || {}) };

    delete headers['cache-control'];
    delete headers['Cache-Control'];
    delete headers['pragma'];
    delete headers['Pragma'];
    delete headers['expires'];
    delete headers['Expires'];

    // "Permanent" in practice: very long max-age + immutable.
    const tenYearsSeconds = 60 * 60 * 24 * 365 * 10;
    headers['Cache-Control'] = [`public, max-age=${tenYearsSeconds}, immutable`];

    const expiresAt = new Date(Date.now() + tenYearsSeconds * 1000).toUTCString();
    headers['Expires'] = [expiresAt];

    callback({ responseHeaders: headers });
  });
}

async function clearAllCaches(sess, webContents) {
  // Clear HTTP cache + SW/CacheStorage/shader caches; do NOT clear cookies.
  await sess.clearCache();
  await sess.clearStorageData({
    storages: ['appcache', 'cachestorage', 'serviceworkers', 'shadercache']
  });

  // Chromium code cache (JS bytecode cache). Not cookies.
  if (webContents && typeof webContents.clearCodeCaches === 'function') {
    await webContents.clearCodeCaches();
  }
}

function installContextMenu(win) {
  // Disable web page context menu entirely.
  win.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });
}

function installWindowControlsOverlay(win) {
  // Frameless windows need a draggable region and custom buttons.
  const DEFAULT_DRAG_LEFT_PX = 450;
  const TITLEBAR_HEIGHT_PX = 60;

  const css = `
    #__agatha_window_controls_bar {
      position: fixed;
      top: 0;
      left: ${DEFAULT_DRAG_LEFT_PX}px;
      right: 0;
      height: ${TITLEBAR_HEIGHT_PX}px;
      z-index: 2147483647;
      -webkit-app-region: drag;
      background: transparent;
    }
    #__agatha_window_controls {
      position: fixed;
      top: 0;
      right: 0;
      height: ${TITLEBAR_HEIGHT_PX}px;
      display: flex;
      align-items: stretch;
      z-index: 2147483647;
      -webkit-app-region: no-drag;
      user-select: none;
    }
    #__agatha_window_controls button {
      width: 46px;
      height: ${TITLEBAR_HEIGHT_PX}px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: default;
      padding: 0;
      margin: 0;
    }
    #__agatha_window_controls button svg {
      width: 14px;
      height: 14px;
      display: block;
      margin: 0 auto;
      opacity: 0.92;
    }
    #__agatha_window_controls button.__agatha_min svg {
      width: 14px;
      height: 14px;
    }
    #__agatha_window_controls button.__agatha_max svg {
      width: 14px;
      height: 14px;
    }
    #__agatha_window_controls button.__agatha_close svg {
      width: 14px;
      height: 14px;
    }
    #__agatha_window_controls button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    #__agatha_window_controls button:active {
      background: rgba(255, 255, 255, 0.18);
    }
    #__agatha_window_controls button.__agatha_close:hover {
      background: rgba(232, 17, 35, 0.9);
      color: #fff;
    }
    #__agatha_window_controls button.__agatha_close:active {
      background: rgba(199, 0, 0, 0.9);
      color: #fff;
    }
  `;

  const js = `
    (() => {
      if (document.getElementById('__agatha_window_controls')) return;

      const api = window.agathaWindowControls;
      if (!api) return;

      const bar = document.createElement('div');
      bar.id = '__agatha_window_controls_bar';
      document.documentElement.appendChild(bar);

      const wrap = document.createElement('div');
      wrap.id = '__agatha_window_controls';

      const svgMin = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">'
        + '<path d="M2 6.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" fill="none" />'
        + '</svg>';

      const svgMax = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">'
        + '<rect x="2.2" y="2.2" width="5.6" height="5.6" stroke="currentColor" stroke-width="1.2" fill="none" />'
        + '</svg>';

      const svgClose = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">'
        + '<path d="M2.4 2.4l5.2 5.2M7.6 2.4L2.4 7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" fill="none" />'
        + '</svg>';

      const svgGear = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        + '<path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 12.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L1.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L1.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM11 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />'
        + '</svg>';

      const btnSettings = document.createElement('button');
      btnSettings.type = 'button';
      btnSettings.title = '设置';
      btnSettings.className = '__agatha_settings';
      btnSettings.innerHTML = svgGear;
	  btnSettings.addEventListener('click', () => api.openSettings());

      const btnMin = document.createElement('button');
      btnMin.type = 'button';
      btnMin.title = '最小化';
      btnMin.className = '__agatha_min';
      btnMin.innerHTML = svgMin;
      btnMin.addEventListener('click', () => api.minimize());

      const btnMax = document.createElement('button');
      btnMax.type = 'button';
      btnMax.title = '最大化/还原';
      btnMax.className = '__agatha_max';
      btnMax.innerHTML = svgMax;
      btnMax.addEventListener('click', () => api.toggleMaximize());

      const btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.title = '关闭';
      btnClose.className = '__agatha_close';
      btnClose.innerHTML = svgClose;
      btnClose.addEventListener('click', () => api.close());

      wrap.appendChild(btnSettings);
      wrap.appendChild(btnMin);
      wrap.appendChild(btnMax);
      wrap.appendChild(btnClose);

      document.documentElement.appendChild(wrap);
    })();
  `;

  const inject = async () => {
    try {
      // Only inject controls on the main app host to avoid interfering with
      // third-party auth pages (which may have different layouts).
      const currentUrl = win.webContents.getURL();
      const parsedUrl = currentUrl ? new URL(currentUrl) : null;
      const hostname = parsedUrl ? parsedUrl.hostname : '';
      if (hostname !== APP_HOSTNAME) {
        // When navigating away (e.g. Microsoft login), any previously inserted
        // CSS may be dropped by Chromium. Clear keys so returning to the app
        // host re-injects styles even if the path is the same.
        win.__agathaWindowControlsCssDocKey = null;
        win.__agathaWindowControlsCssKey = null;
        return;
      }

      const pathname = (parsedUrl?.pathname || '').toLowerCase();
      const dragLeftPx = pathname === '/' || pathname === '/index.html' ? 0 : DEFAULT_DRAG_LEFT_PX;

      // `insertCSS` is not guaranteed to persist across full navigations.
      // Re-inject once per document URL to keep the controls styled.
      const docKey = `${parsedUrl.origin}${parsedUrl.pathname}`;
      if (win.__agathaWindowControlsCssDocKey !== docKey) {
        if (win.__agathaWindowControlsCssKey && typeof win.webContents.removeInsertedCSS === 'function') {
          try {
            await win.webContents.removeInsertedCSS(win.__agathaWindowControlsCssKey);
          } catch {
            // ignore
          }
        }

        win.__agathaWindowControlsCssKey = await win.webContents.insertCSS(css);
        win.__agathaWindowControlsCssDocKey = docKey;
      }

      await win.webContents.executeJavaScript(js, true);

      // Update draggable area left offset without reinjecting CSS.
      await win.webContents.executeJavaScript(
        `(() => { const el = document.getElementById('__agatha_window_controls_bar'); if (el) el.style.left = '${dragLeftPx}px'; })();`,
        true
      );
    } catch {
      // ignore
    }
  };

  win.webContents.on('dom-ready', inject);
  win.webContents.on('did-navigate', inject);
  win.webContents.on('did-navigate-in-page', inject);
}

function createBrowserWindow({ url, isPopup = false } = {}) {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  const win = new BrowserWindow({
    width: isPopup ? 520 : 1200,
    height: isPopup ? 720 : 800,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Critical: keep all windows in the same persistent session
      // so auth cookies (e.g. contextID) match across redirects/popups.
      partition: PERSIST_PARTITION
    }
  });

  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  installContextMenu(win);
  installWindowControlsOverlay(win);

  if (!isPopup) {
    win.setMinimumSize(800, 600);
  }

  if (url) {
    win.loadURL(url);
  }

  return win;
}

let tray = null;
let mainWindow = null;
let isQuitting = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else showMainWindow();
}

function createTray() {
  if (tray) return tray;

  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('Minechat');

  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => toggleMainWindow()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  return tray;
}

let settingsWindow = null;

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  return bytes;
}

async function dirSizeBytes(dirPath) {
  let total = 0;
  const stack = [dirPath];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          const st = await fs.promises.stat(fullPath);
          total += st.size || 0;
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  return total;
}

async function getCacheInfoForPersistentSession() {
  const sess = session.fromPartition(PERSIST_PARTITION);

  let httpCacheBytes = null;
  try {
    httpCacheBytes = await sess.getCacheSize();
  } catch {
    httpCacheBytes = null;
  }

  // Best-effort: sum known cache folders under the partition storage path.
  let storagePath = null;
  try {
    if (typeof sess.getStoragePath === 'function') {
      storagePath = sess.getStoragePath();
    }
  } catch {
    storagePath = null;
  }

  const diskCacheFolders = [];
  let diskCacheTotalBytes = null;
  if (storagePath) {
    const candidates = [
      { name: 'Cache', rel: 'Cache' },
      { name: 'Code Cache', rel: 'Code Cache' },
      { name: 'GPUCache', rel: 'GPUCache' },
      { name: 'Service Worker', rel: 'Service Worker' },
      { name: 'CacheStorage', rel: 'CacheStorage' }
    ];

    let total = 0;
    for (const c of candidates) {
      const p = path.join(storagePath, c.rel);
      try {
        const st = await fs.promises.stat(p);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      const bytes = await dirSizeBytes(p);
      diskCacheFolders.push({ name: c.name, bytes });
      total += bytes;
    }
    diskCacheTotalBytes = total;
  }

  return {
    httpCacheBytes: formatBytes(httpCacheBytes),
    diskCacheTotalBytes: formatBytes(diskCacheTotalBytes),
    diskCacheFolders
  };
}

function getPersistentSessionStoragePath() {
  try {
    const sess = session.fromPartition(PERSIST_PARTITION);
    if (typeof sess.getStoragePath === 'function') {
      return sess.getStoragePath();
    }
  } catch {
    // ignore
  }
  return null;
}

function formatBytesForDisplay(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const digits = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getSystemInfo() {
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || null;

  let timeZone = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = null;
  }

  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: cpuModel,
    cpuCount: cpus.length || null,
    totalMem: formatBytesForDisplay(os.totalmem()),
    freeMem: formatBytesForDisplay(os.freemem()),
    appVersion: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    timeZone
  };
}

function getBuildInfo() {
  try {
    const p = path.join(__dirname, 'build-info.json');
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const buildTimeIso = typeof obj.buildTimeIso === 'string' ? obj.buildTimeIso : '';
    const buildTimeMs = typeof obj.buildTimeMs === 'number' ? obj.buildTimeMs : 0;
    return {
      buildTimeIso: buildTimeIso || null,
      buildTimeMs: buildTimeMs > 0 ? buildTimeMs : null
    };
  } catch {
    return null;
  }
}

function createOrFocusSettingsWindow(parentWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    parent: parentWindow || undefined,
    modal: false,
    // Use native frame to keep it simple.
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: PERSIST_PARTITION
    }
  });

  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  return settingsWindow;
}

function openInElectronWindow(url) {
  // Always open in Electron (never default browser), but keep it isolated
  // from the main app unless it's on an allowed auth/app host.
  const popup = createBrowserWindow({ url, isPopup: true });
  return popup;
}

function createMainWindow() {
  // Remove the application menu (and menu bar) entirely.
  Menu.setApplicationMenu(null);

  const win = createBrowserWindow({ url: START_URL, isPopup: false });

  // Close button (X) should only hide the window; quit only from tray menu.
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Microsoft auth often requires a real popup with opener relationship.
    // Allow popups for allowed hosts and force them to share the same session.
    if (isAllowedUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            partition: PERSIST_PARTITION
          }
        }
      };
    }

    // For other domains, still open in Electron (per requirement), but as a
    // separate window without tying it to the opener.
    openInElectronWindow(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    // Keep main window on allowed hosts; open everything else in a new Electron window.
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      openInElectronWindow(url);
    }
  });

  return win;
}

app.whenReady().then(() => {
  // Install caching policy on the persistent session.
  // Attaching once ensures it applies to main window + popups.
  const persistentSession = session.fromPartition(PERSIST_PARTITION);
  installPermanentCacheHeaders(persistentSession);

  mainWindow = createMainWindow();
  createTray();

  ipcMain.handle('agatha-settings:get-cache-info', async () => {
    return getCacheInfoForPersistentSession();
  });

  ipcMain.handle('agatha-settings:open-cache-folder', async () => {
    const storagePath = getPersistentSessionStoragePath();
    if (!storagePath) return { ok: false, error: 'storagePath_unavailable' };
    const err = await shell.openPath(storagePath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('agatha-settings:get-system-info', async () => {
    return getSystemInfo();
  });

  ipcMain.handle('agatha-settings:get-app-info', async () => {
    const build = getBuildInfo();
    return {
      appVersion: app.getVersion(),
      buildTimeIso: build?.buildTimeIso || null,
      buildTimeMs: build?.buildTimeMs || null
    };
  });

  // IPC: window controls from the injected overlay (not cookies).
  ipcMain.on('agatha-window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    if (action === 'minimize') win.minimize();
    else if (action === 'toggleMaximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    else if (action === 'openSettings') createOrFocusSettingsWindow(win);
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Do not quit when all windows are closed; the app lives in the tray.
  // It should only fully exit via the tray "退出" action.
});

app.on('before-quit', () => {
  isQuitting = true;
});
