const { app, BrowserWindow, Menu, session } = require('electron');
const path = require('path');

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

function installSystemContextMenu(win) {
  // Right-click on title bar / non-client area.
  win.on('system-context-menu', (event) => {
    event.preventDefault();

    const canMaximize = win.maximizable !== false;
    const canMinimize = win.minimizable !== false;
    const isMaximized = win.isMaximized();
    const isMinimized = win.isMinimized();

    const template = [
      {
        label: '更新',
        click: async () => {
          try {
            await clearAllCaches(win.webContents.session, win.webContents);
          } finally {
            win.webContents.reload();
          }
        }
      },
      { type: 'separator' },
      {
        label: '还原',
        enabled: isMaximized || isMinimized,
        click: () => {
          if (isMinimized) win.restore();
          if (win.isMaximized()) win.unmaximize();
        }
      },
      {
        label: '最小化',
        enabled: canMinimize && !isMinimized,
        click: () => win.minimize()
      },
      {
        label: '最大化',
        enabled: canMaximize && !isMaximized,
        click: () => win.maximize()
      },
      { type: 'separator' },
      {
        label: '关闭',
        click: () => win.close()
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    // Let Electron decide the position based on the cursor.
    menu.popup({ window: win });
  });
}

function createBrowserWindow({ url, isPopup = false } = {}) {
  const win = new BrowserWindow({
    width: isPopup ? 520 : 1200,
    height: isPopup ? 720 : 800,
    show: false,
    autoHideMenuBar: true,
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
  installSystemContextMenu(win);

  if (url) {
    win.loadURL(url);
  }

  return win;
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

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed.
  if (process.platform !== 'darwin') app.quit();
});
