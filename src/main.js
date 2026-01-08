const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const START_URL = 'https://front-dev.agatha.org.cn';
const PERSIST_PARTITION = 'persist:agatha-front';

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
