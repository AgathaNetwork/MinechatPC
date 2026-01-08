const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const START_URL = 'https://front-dev.agatha.org.cn';
const ALLOWED_HOSTS = new Set([
  'front-dev.agatha.org.cn'
]);

function isAllowedUrl(urlString) {
  try {
    const url = new URL(urlString);
    return ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function createMainWindow() {
  // Remove the application menu (and menu bar) entirely.
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Use a named persistent partition so cookies/storage survive restarts.
      partition: 'persist:agatha-front'
    }
  });

  // Extra guard: ensure per-window menu bar stays hidden.
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Avoid popups. Open external links in default browser.
    if (!isAllowedUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    // Keep navigation inside allowed host; otherwise open externally.
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadURL(START_URL);

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
