const { app, BrowserWindow, Menu, ipcMain, session, shell, Tray } = require('electron');
const { startNotifyListener } = require('./notify');
const { startModImageImportListener, DEFAULT_HOST: MOD_IMPORT_DEFAULT_HOST, DEFAULT_PORT: MOD_IMPORT_DEFAULT_PORT } = require('./modImageImportListener');
const { startLocalWebServer } = require('./localWebServer');
const { getRuntimeConfig } = require('./runtimeConfig');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Force a consistent display name (tray tooltip, etc.).
app.setName('Minechat');
// Ensure Windows notifications show app name by setting AppUserModelID
try {
  if (typeof app.setAppUserModelId === 'function') app.setAppUserModelId('Minechat');
} catch (e) {}

// Prevent multiple instances.
// If the app is already running (even in tray), block launching another one.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  try { app.quit(); } catch (e) {}
}

let START_URL = '';
const PERSIST_PARTITION = 'persist:agatha-front';
const APP_HOSTNAME = '127.0.0.1';
const LOCAL_WEB_HOST = APP_HOSTNAME;
let localWebServer = null;

// Local listener for Minecraft mod -> MinechatPC.
// Allow overriding via env for debugging.
const MOD_IMPORT_HOST = process.env.MINECHAT_MOD_IMPORT_HOST || MOD_IMPORT_DEFAULT_HOST;
const MOD_IMPORT_PORT = Number.parseInt(process.env.MINECHAT_MOD_IMPORT_PORT || '', 10) || MOD_IMPORT_DEFAULT_PORT;

let modImportListener = null;
const modImportQueue = [];
let modImportProcessing = false;
let pendingImportFilePath = null;

function installSelectFileAutofill() {
  // Intentionally kept as a no-op for now.
  // The previous implementation attempt called this during startup; leaving it
  // defined prevents main-process crashes that would hide the window.
}

function enqueueImport(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return;
  modImportQueue.push(p);
  // Fire-and-forget; internal try/catch prevents startup impact.
  flushImportQueue();
}

async function flushImportQueue() {
  if (modImportProcessing) return;
  modImportProcessing = true;
  try {
    while (modImportQueue.length > 0) {
      const next = modImportQueue.shift();
      try {
        await handleImportedImagePath(next);
      } catch {
        // ignore
      }
    }
  } finally {
    modImportProcessing = false;
  }
}

async function handleImportedImagePath(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingImportFilePath = filePath;
    return;
  }

  const normalized = String(filePath || '').trim();
  if (!normalized) return;

  try {
    const st = fs.statSync(normalized);
    if (!st.isFile()) return;
  } catch {
    return;
  }

  pendingImportFilePath = normalized;

  // Bring app to front.
  try { raiseWindowToFront(mainWindow); } catch {}

  // Navigate to gallery page and open upload dialog.
  const galleryUrl = new URL('/gallery.html', START_URL).toString();
  const wc = mainWindow.webContents;
  const current = wc.getURL();
  if (current !== galleryUrl) {
    try {
      await wc.loadURL(galleryUrl);
    } catch {
      // If navigation fails, keep pending path for later retry.
      return;
    }
  }

  await tryOpenGalleryUploadDialog(wc);
  await trySetGalleryUploadFile(wc, pendingImportFilePath);
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPredicate(wc, predicateJs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await wc.executeJavaScript(`(function(){ try { return !!(${predicateJs}); } catch { return false; } })()`);
      if (ok) return true;
    } catch {
      // ignore
    }
    await delay(150);
  }
  return false;
}

async function tryOpenGalleryUploadDialog(wc) {
  // Click the primary "上传" button to open the upload dialog.
  try {
    await wc.executeJavaScript(`(function(){
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(b => (b.innerText || '').includes('上传'));
      if (target) target.click();
      return !!target;
    })()`);
  } catch {
    // ignore
  }

  // Wait until dialog appears.
  await waitForPredicate(
    wc,
    `document.querySelector('.mc-upload-dialog') && getComputedStyle(document.querySelector('.mc-upload-dialog')).display !== 'none'`,
    5000
  );
}

async function trySetGalleryUploadFile(wc, filePath) {
  const p = String(filePath || '').trim();
  if (!p) return false;

  // Wait for the file input to be present (Element Plus upload creates a hidden input[type=file]).
  const ready = await waitForPredicate(
    wc,
    `document.querySelector('.mc-upload-dialog input[type="file"]') || document.querySelector('input[type="file"]')`,
    5000
  );
  if (!ready) return false;

  // Use Chrome DevTools Protocol to set the file input value.
  // This avoids relying on any Vue internals or global functions.
  const selectorCandidates = [
    '.mc-upload-dialog input[type="file"]',
    '.el-dialog input[type="file"]',
    'input[type="file"]'
  ];

  for (const selector of selectorCandidates) {
    const ok = await setFileInputFilesViaCdp(wc, selector, [p]);
    if (ok) return true;
  }
  return false;
}

async function setFileInputFilesViaCdp(wc, selector, filePaths) {
  if (!wc || wc.isDestroyed()) return false;

  let didAttach = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      didAttach = true;
    }
  } catch {
    return false;
  }

  try {
    const doc = await wc.debugger.sendCommand('DOM.getDocument', { depth: 1 });
    const rootNodeId = doc && doc.root && doc.root.nodeId ? doc.root.nodeId : null;
    if (!rootNodeId) return false;

    const q = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector });
    const nodeId = q && q.nodeId ? q.nodeId : null;
    if (!nodeId) return false;

    await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: filePaths });

    try {
      await wc.executeJavaScript(`(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  } finally {
    if (didAttach) {
      try { wc.debugger.detach(); } catch {}
    }
  }
}

const EXACT_ALLOWED_HOSTS = new Set([
  // Local embedded web server.
  '127.0.0.1',
  'localhost',

  // Microsoft identity endpoints (common set).
  'login.microsoftonline.com',
  'login.live.com',
  'account.live.com',
  'login.windows.net',
  'graph.microsoft.com',
  'aadcdn.msauth.net',
  'aadcdn.msftauth.net',
  'aadcdn.microsoftonline-p.com'
]);

function getConfiguredBackendHostnames() {
  const out = new Set();
  try {
    const conf = getRuntimeConfig();
    const bases = [conf?.apiBase, conf?.apiProxyBase].filter(Boolean);
    for (const base of bases) {
      try {
        const u = new URL(String(base));
        if (u.hostname) out.add(u.hostname);
      } catch {
        // ignore invalid base
      }
    }
  } catch {
    // ignore
  }
  return out;
}

const ALLOWED_HOST_SUFFIXES = [
  // Covers regional and tenant-specific Microsoft Online hosts.
  '.microsoftonline.com',
  '.microsoftonline-p.com',
  '.msauth.net',
  '.msftauth.net',
  // Live/MSA login and related domains.
  '.live.com',
  '.live.net',
  // Azure AD / Microsoft identity supporting hosts.
  '.windows.net',
  '.msidentity.com',
  // Static assets often served via Microsoft-owned domains.
  '.microsoft.com',
  // Some AADCDN assets are served via AzureEdge.
  '.azureedge.net'
];

function isAllowedHost(hostname) {
  if (!hostname) return false;
  if (EXACT_ALLOWED_HOSTS.has(hostname)) return true;
  // Allow configured backend host (for auth redirects like /auth/microsoft).
  // This keeps the login flow inside the main window instead of opening a new window.
  if (getConfiguredBackendHostnames().has(hostname)) return true;
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

function isAuthCallbackLikeUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only treat cross-origin navigations as candidates.
    if (isAllowedHost(url.hostname)) return false;

    // The backend typically redirects back with these parameters.
    const sp = url.searchParams;
    const hasAuthParams =
      sp.has('ok') ||
      sp.has('token') ||
      sp.has('error') ||
      sp.has('detail') ||
      sp.has('userId') ||
      sp.has('username') ||
      sp.has('faceUrl') ||
      sp.has('chats') ||
      sp.has('registered');

    if (!hasAuthParams) return false;

    // Usually redirects to a top-level entry page.
    const p = (url.pathname || '/').toLowerCase();
    return p === '/' || p === '/index.html' || p === '/login' || p === '/login.html';
  } catch {
    return false;
  }
}

function rewriteAuthCallbackToLocal(urlString) {
  const from = new URL(urlString);
  const target = new URL('/', START_URL || 'http://127.0.0.1/');
  target.search = from.search;
  target.hash = from.hash;
  return target.toString();
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
  sess.webRequest.onHeadersReceived({ urls: [`http://${APP_HOSTNAME}/*`, `http://localhost/*`] }, (details, callback) => {
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

function getCookieUrlForRemoval(cookie) {
  try {
    const domain = String(cookie?.domain || '').replace(/^\./, '');
    const pathPart = String(cookie?.path || '/') || '/';
    const scheme = cookie?.secure ? 'https://' : 'http://';
    return `${scheme}${domain}${pathPart}`;
  } catch {
    return null;
  }
}

async function clearSessionForLogout(sess, webContents) {
  if (!sess) return;

  // Clear cookies (best-effort) – some Electron/Chromium builds can be picky.
  try {
    const cookies = await sess.cookies.get({});
    await Promise.allSettled(
      (cookies || []).map(async (c) => {
        try {
          const url = getCookieUrlForRemoval(c);
          if (!url) return;
          await sess.cookies.remove(url, c.name);
        } catch {
          // ignore
        }
      })
    );
  } catch {
    // ignore
  }

  // Clear storages including service worker / CacheStorage / localStorage.
  // Include cookies too as a stronger fallback.
  try {
    await sess.clearStorageData({
      storages: ['appcache', 'cachestorage', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'shadercache'],
      quotas: ['temporary', 'persistent', 'syncable']
    });
  } catch {
    try {
      await sess.clearStorageData();
    } catch {
      // ignore
    }
  }

  // Clear HTTP cache and (if supported) compiled code cache.
  try {
    await sess.clearCache();
  } catch {
    // ignore
  }

  try {
    if (webContents && typeof webContents.clearCodeCaches === 'function') {
      await webContents.clearCodeCaches();
    }
  } catch {
    // ignore
  }
}

async function performNativeLogout(targetWindow) {
  const win = targetWindow && !targetWindow.isDestroyed() ? targetWindow : mainWindow;
  if (!win || win.isDestroyed()) return { ok: false, error: 'window_unavailable' };

  const sess = win.webContents?.session;
  try {
    await clearSessionForLogout(sess, win.webContents);
  } catch {
    // ignore
  }

  // Load the login page (index) with a cache-busting query.
  const u = new URL('/', START_URL);
  u.searchParams.set('logout', '1');
  u.searchParams.set('ts', String(Date.now()));

  try {
    await win.webContents.loadURL(u.toString());
  } catch {
    // ignore
  }

  try { raiseWindowToFront(win); } catch {}

  return { ok: true };
}

function installLogoutAutoClear(sess) {
  if (!sess || sess.__agathaLogoutAutoClearInstalled) return;
  sess.__agathaLogoutAutoClearInstalled = true;

  // Fallback: if the web app does manage to call /auth/logout, also clear the
  // persistent session locally so the next page load can't auto-login.
  const filter = { urls: ['*://*/auth/logout*'] };

  const trigger = async () => {
    try {
      await performNativeLogout(mainWindow);
    } catch {
      // ignore
    }
  };

  try {
    sess.webRequest.onCompleted(filter, (details) => {
      try {
        const method = String(details?.method || '').toUpperCase();
        if (method && method !== 'POST') return;
      } catch {
        // ignore
      }
      trigger();
    });
    sess.webRequest.onErrorOccurred(filter, () => trigger());
  } catch {
    // ignore
  }
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
    #__agatha_window_controls button.__agatha_pin {
      width: 54px;
    }
    #__agatha_window_controls button.__agatha_pin svg {
      width: 13px;
      height: 13px;
      transition: transform 120ms ease;
      transform-origin: 50% 50%;
      transform: translateY(-1px) rotate(45deg);
    }
    #__agatha_window_controls button.__agatha_pin:not(.__pinned) svg {
        transform: translateY(-1px) rotate(0deg);
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
      const api = window.agathaWindowControls;
      if (!api) return;

      const existingWrap = document.getElementById('__agatha_window_controls');
      if (existingWrap) {
        const btn = existingWrap.querySelector('button.__agatha_pin');
        if (btn && typeof api.getAlwaysOnTop === 'function') {
          Promise.resolve(api.getAlwaysOnTop())
            .then((res) => {
              const pinned = !!(res && res.alwaysOnTop);
              btn.classList.toggle('__pinned', pinned);
              btn.title = pinned ? '取消置顶' : '图钉（置顶）';
            })
            .catch(() => {});
        }
        return;
      }

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

      const svgPin = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1241" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'
        + '<g transform="translate(0,1241) scale(0.1,-0.1)" fill="currentColor" stroke="none">'
        + '<path d="M4844 12400 c-466 -59 -1070 -356 -1769 -869 -1108 -813 -2221 -2052 -2748 -3061 -239 -456 -353 -872 -317 -1151 28 -215 127 -372 285 -456 29 -15 51 -32 49 -38 -2 -6 72 -30 178 -59 331 -89 552 -169 816 -297 1102 -532 1953 -1554 2546 -3057 310 -787 557 -1761 686 -2712 l21 -155 67 -63 c412 -388 1060 -472 1872 -243 41 12 86 24 100 27 13 3 29 9 36 15 6 5 14 6 17 2 4 -3 7 -1 7 5 0 6 6 9 14 6 8 -3 17 0 21 5 3 6 11 9 16 6 5 -4 9 -2 9 4 0 6 7 8 15 5 8 -4 15 -1 15 5 0 6 7 8 17 4 11 -4 14 -3 9 5 -5 8 -2 10 8 6 9 -3 16 -1 16 5 0 6 7 8 15 5 8 -4 15 -1 15 5 0 6 7 8 17 4 11 -5 14 -3 8 6 -6 10 -2 11 15 6 15 -5 20 -4 16 4 -5 7 -1 9 8 5 9 -3 16 -1 16 6 0 6 4 9 9 6 12 -8 42 4 36 14 -6 9 25 23 33 15 3 -3 -1 -5 -8 -5 -7 0 -11 -2 -8 -5 8 -8 128 46 123 55 -6 9 25 23 33 15 3 -3 -1 -5 -8 -5 -7 0 -11 -3 -7 -6 6 -7 417 191 417 200 0 4 -72 -30 -161 -75 -89 -44 -163 -79 -165 -77 -2 2 76 43 172 91 97 48 173 83 169 77 -9 -15 50 15 220 113 531 304 1134 738 1655 1190 174 151 390 350 386 355 -3 2 -74 -58 -158 -135 -580 -527 -1174 -975 -1760 -1326 -170 -102 -339 -197 -327 -184 3 4 76 47 163 97 635 363 1281 843 1930 1433 78 70 144 127 147 127 5 0 1693 -1782 2034 -2146 l40 -43 372 352 c204 194 373 355 375 358 2 4 -465 502 -1036 1107 -572 605 -1041 1107 -1042 1116 -1 8 5 21 14 28 15 12 16 11 3 -4 -7 -10 -11 -18 -9 -18 5 0 88 94 228 260 35 41 53 66 39 55 -14 -11 -5 0 20 24 26 24 37 38 26 31 -11 -7 0 7 25 30 25 23 36 37 25 30 -11 -7 -2 4 20 24 22 20 37 36 33 36 -3 0 8 15 24 33 48 50 394 515 515 692 574 834 925 1613 1030 2285 26 164 26 555 0 690 -60 314 -168 538 -373 775 l-42 48 -278 -16 c-553 -32 -967 -30 -1399 8 -1252 111 -2291 474 -3110 1089 -694 520 -1212 1218 -1520 2046 -70 188 -105 301 -180 578 -45 169 -74 259 -81 252 -6 -6 -21 14 -43 55 -62 121 -190 216 -345 257 -82 21 -253 30 -352 18z m5966 -9033 c0 -2 -12 -14 -27 -28 l-28 -24 24 28 c23 25 31 32 31 24z m-60 -70 c0 -2 -17 -19 -37 -38 l-38 -34 34 38 c33 34 41 42 41 34z m-70 -80 c0 -2 -19 -21 -42 -42 l-43 -40 40 43 c36 39 45 47 45 39z" />'
        + '</g>'
        + '</svg>';

      const setPinnedUi = (btn, pinned) => {
        btn.classList.toggle('__pinned', !!pinned);
        btn.title = pinned ? '取消置顶' : '图钉（置顶）';
      };

      const btnPin = document.createElement('button');
      btnPin.type = 'button';
      btnPin.title = '图钉（置顶）';
      btnPin.className = '__agatha_pin';
      btnPin.innerHTML = svgPin;
      btnPin.addEventListener('click', async () => {
        if (!api || typeof api.toggleAlwaysOnTop !== 'function') return;
        try {
          const res = await api.toggleAlwaysOnTop();
          setPinnedUi(btnPin, !!(res && res.alwaysOnTop));
        } catch {
          // ignore
        }
      });

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

      wrap.appendChild(btnPin);
      wrap.appendChild(btnSettings);
      wrap.appendChild(btnMin);
      wrap.appendChild(btnMax);
      wrap.appendChild(btnClose);

      if (typeof api.getAlwaysOnTop === 'function') {
        Promise.resolve(api.getAlwaysOnTop())
          .then((res) => setPinnedUi(btnPin, !!(res && res.alwaysOnTop)))
          .catch(() => {});
      }

      document.documentElement.appendChild(wrap);

      // Intercept "登出" clicks in the embedded web app.
      // The web app triggers logout then navigates to '/', but in Electron the
      // logout request can be cancelled by navigation; we do a native logout
      // to guarantee cookies/storage are cleared.
      try {
        if (!window.__agathaLogoutClickInterceptorInstalled) {
          window.__agathaLogoutClickInterceptorInstalled = true;
          document.addEventListener('click', (ev) => {
            try {
              const t = ev.target;
              const el = t && typeof t.closest === 'function' ? t.closest('button,a') : null;
              if (!el) return;
              const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
              if (!text) return;

              const isLogout =
                text === '登出' ||
                text.includes('登出') ||
                text.includes('退出登录') ||
                text.includes('注销') ||
                /\blog\s*out\b/i.test(text) ||
                /\blogout\b/i.test(text);
              if (!isLogout) return;

              if (api && typeof api.logout === 'function') {
                ev.preventDefault();
                ev.stopPropagation();
                try { api.logout(); } catch (e) {}
              }
            } catch (e) {
              // ignore
            }
          }, true);
        }
      } catch (e) {
        // ignore
      }
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
let pendingShowMainWindow = false;

function raiseWindowToFront(win) {
  if (!win || win.isDestroyed()) return;

  let previousAlwaysOnTop = false;
  try {
    previousAlwaysOnTop = typeof win.isAlwaysOnTop === 'function' ? win.isAlwaysOnTop() : false;
  } catch {
    previousAlwaysOnTop = false;
  }

  try {
    if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  } catch {}

  try {
    win.show();
  } catch {}

  // On Windows, focus alone is often insufficient due to OS focus-stealing
  // prevention. Temporarily setting always-on-top is a reliable workaround.
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    try { win.setAlwaysOnTop(true); } catch {}
  }

  try {
    if (typeof win.moveTop === 'function') win.moveTop();
  } catch {}

  try {
    win.focus();
  } catch {}

  try {
    if (typeof app.focus === 'function') app.focus({ steal: true });
  } catch {}

  // Restore user's original always-on-top preference.
  setTimeout(() => {
    try {
      win.setAlwaysOnTop(previousAlwaysOnTop);
    } catch {
      // ignore
    }
  }, 1500);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) mainWindow.restore();
  } catch (e) {}
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

function pickFolderBytes(cacheInfo, folderName) {
  try {
    const list = cacheInfo && Array.isArray(cacheInfo.diskCacheFolders) ? cacheInfo.diskCacheFolders : [];
    const hit = list.find((x) => x && x.name === folderName);
    const bytes = hit && typeof hit.bytes === 'number' ? hit.bytes : null;
    return formatBytes(bytes);
  } catch {
    return null;
  }
}

async function getOfflineCacheInfoForPersistentSession() {
  // Offline cache is primarily stored in CacheStorage, with SW scripts in Service Worker.
  const cacheInfo = await getCacheInfoForPersistentSession();
  const cacheStorageBytes = pickFolderBytes(cacheInfo, 'CacheStorage');
  const serviceWorkerBytes = pickFolderBytes(cacheInfo, 'Service Worker');
  const total =
    (typeof cacheStorageBytes === 'number' ? cacheStorageBytes : 0) +
    (typeof serviceWorkerBytes === 'number' ? serviceWorkerBytes : 0);

  return {
    cacheStorageBytes,
    serviceWorkerBytes,
    offlineTotalBytes: formatBytes(total)
  };
}

async function clearOfflineCacheForPersistentSession() {
  const sess = session.fromPartition(PERSIST_PARTITION);

  // Clear SW + CacheStorage only (do not clear cookies).
  await sess.clearStorageData({
    storages: ['cachestorage', 'serviceworkers']
  });

  // Best-effort: also clear HTTP cache metadata. This does not clear cookies.
  try {
    await sess.clearCache();
  } catch {
    // ignore
  }

  return { ok: true };
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

    // If an auth provider/backend tries to open a callback URL in a new window,
    // force it back to the local bundled UI instead.
    if (isAuthCallbackLikeUrl(url)) {
      try {
        const rewritten = rewriteAuthCallbackToLocal(url);
        win.webContents.loadURL(rewritten);
      } catch {
        // ignore
      }
      return { action: 'deny' };
    }

    // For other domains, still open in Electron (per requirement), but as a
    // separate window without tying it to the opener.
    openInElectronWindow(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    // Keep main window on allowed hosts; open everything else in a new Electron window.
    if (!isAllowedUrl(url)) {
      // Backend might still redirect to an old/remote front entry page.
      // Detect callback params and rewrite to local UI, fully decoupling from any old front host.
      if (isAuthCallbackLikeUrl(url)) {
        event.preventDefault();
        try {
          const rewritten = rewriteAuthCallbackToLocal(url);
          win.webContents.loadURL(rewritten);
        } catch {
          // ignore
        }
        return;
      }
      event.preventDefault();
      openInElectronWindow(url);
    }
  });

  return win;
}

app.whenReady().then(async () => {
  // Only the primary instance should continue initialization.
  if (!gotSingleInstanceLock) return;

  // Start embedded local web server to serve the bundled public/ assets.
  // This keeps all UI resources local while still allowing the UI to call the backend via /config.
  try {
    const publicDir = path.join(__dirname, '..', 'public');
    localWebServer = await startLocalWebServer({
      publicDir,
      host: LOCAL_WEB_HOST,
      port: 0,
      getConfig: getRuntimeConfig
    });
    START_URL = localWebServer.baseUrl;
  } catch (e) {
    console.error('[main] failed to start local web server', e);
    try { app.quit(); } catch {}
    return;
  }

  // Install caching policy on the persistent session.
  // Attaching once ensures it applies to main window + popups.
  const persistentSession = session.fromPartition(PERSIST_PARTITION);
  installPermanentCacheHeaders(persistentSession);

  // Ensure logout truly logs out in the persistent session.
  installLogoutAutoClear(persistentSession);

  // Install file chooser autofill for "mod -> Minechat" image import.
  installSelectFileAutofill(persistentSession);

  mainWindow = createMainWindow();
  createTray();

  // 启动通知监听（仅主实例）
  try { startNotifyListener(); } catch (e) {}

  // Start local listener for Minecraft mod to send image file paths.
  // The mod can call:
  //   POST http://127.0.0.1:28188/pc/gallery/import  body: {"path":"C:\\path\\to\\image.png"}
  // or:
  //   GET  http://127.0.0.1:28188/pc/gallery/import?path=C%3A%5Cpath%5Cto%5Cimage.png
    try {
      modImportListener = startModImageImportListener({
        host: MOD_IMPORT_HOST,
        port: MOD_IMPORT_PORT,
        onImport: enqueueImport
      });
    } catch (e) {
      modImportListener = null;
    }

    if (pendingShowMainWindow) {
      pendingShowMainWindow = false;
      showMainWindow();
    }

    // If a mod sent a path before UI was ready, process it now.
    try {
      flushImportQueue();
    } catch {
      // ignore
    }

    ipcMain.handle('agatha-settings:get-cache-info', async () => {
      return getCacheInfoForPersistentSession();
    });

    ipcMain.handle('agatha-settings:get-offline-cache-info', async () => {
      return getOfflineCacheInfoForPersistentSession();
    });

    ipcMain.handle('agatha-settings:clear-offline-cache', async () => {
      return clearOfflineCacheForPersistentSession();
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

  // IPC: native logout from injected click interceptor.
  ipcMain.handle('agatha-session:logout', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      return await performNativeLogout(win);
    } catch {
      return { ok: false, error: 'logout_failed' };
    }
  });

  ipcMain.handle('agatha-window-always-on-top', async (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { alwaysOnTop: false };

    const current = typeof win.isAlwaysOnTop === 'function' ? win.isAlwaysOnTop() : false;
    if (action === 'toggle') {
      const next = !current;
      try {
        // Keep it simple: enable/disable always-on-top.
        win.setAlwaysOnTop(next);
        if (next) {
          win.show();
          win.focus();
        }
      } catch {
        // ignore
      }
      return { alwaysOnTop: typeof win.isAlwaysOnTop === 'function' ? win.isAlwaysOnTop() : next };
    }

    // action === 'get'
    return { alwaysOnTop: current };
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    showMainWindow();
  });
});

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    // Someone tried to run a second instance: focus existing.
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
    } else {
      pendingShowMainWindow = true;
    }
  });
}

app.on('window-all-closed', () => {
  // Do not quit when all windows are closed; the app lives in the tray.
  // It should only fully exit via the tray "退出" action.
});

app.on('before-quit', () => {
  isQuitting = true;
  try {
    if (modImportListener && typeof modImportListener.close === 'function') {
      modImportListener.close();
    }
  } catch {
    // ignore
  }

  try {
    if (localWebServer && typeof localWebServer.close === 'function') {
      localWebServer.close();
    }
  } catch {
    // ignore
  }
});
