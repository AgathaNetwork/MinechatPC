// notify.js
// 连接/notify WebSocket并系统通知
const { app, BrowserWindow, Notification } = require('electron');
const notifier = require('node-notifier');
const util = require('util');
const fs = require('fs');
const path = require('path');
const { getWsBase } = require('./runtimeConfig');
let socket = null;
let reconnectTimer = null;

async function getToken() {
  // 优先从应用数据目录的 token.txt 读取（如果存在），否则尝试从渲染进程的 localStorage 获取
  try {
    const data = fs.readFileSync(path.join(app.getPath('userData'), 'token.txt'), 'utf8');
    if (data && data.trim()) return data.trim();
  } catch (e) {}

  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.webContents) {
      const token = await win.webContents.executeJavaScript("localStorage.getItem('token')");
      return (token || '').trim();
    }
  } catch (e) {}

  return '';
}

async function connectNotifySocket(onNotify) {
  if (socket) {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), '[notify] socket disconnect\n');
    } catch (e) {}
    console.log('[notify] socket disconnect');
    socket.close();
    socket = null;
  }
  // 清理上一次的重试定时器（如果有）
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const token = await getToken();

  // 后端基址通过环境变量配置（避免硬编码前端域名）。
  const wsBase = getWsBase();
  if (!wsBase) {
    console.log('[notify] wsBase not configured; set MINECHAT_API_BASE (or MINECHAT_API_PROXY_BASE)');
    return;
  }
  try {
    require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket create: ${wsBase} path=/api/notify auth.token=${token ? 'yes' : 'no'}\n`);
  } catch (e) {}
  console.log(`[notify] socket create: ${wsBase} path=/api/notify`);

  const io = require('socket.io-client');
  try {
    socket = io(wsBase, {
      path: '/api/notify',
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      secure: /^https:/i.test(wsBase),
    });
  } catch (e) {
    try { require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket create error: ${e?.message || e}\n`); } catch (err) {}
    console.error('[notify] socket create error', e);
    return;
  }

  socket.on('connect', () => {
    reconnectTimer && clearTimeout(reconnectTimer);
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), '[notify] socket connect\n');
    } catch (e) {}
    console.log('[notify] socket connect');
  });

  socket.on('disconnect', (reason) => {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket disconnect: ${reason}\n`);
    } catch (e) {}
    console.log('[notify] socket disconnect', reason);
    // 使用 socket.io-client 内建重连，这里不再手动重连
  });

  socket.on('connect_error', (err) => {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket connect_error: ${err?.message || err}\n`);
    } catch (e) {}
    console.log('[notify] socket connect_error', err);
    // 如果连接未建立，启用回退重试：关闭当前 socket 并在 5s 后重建
    if (!socket || !socket.connected) {
      try { socket && socket.close(); } catch (e) {}
      socket = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          try { connectNotifySocket(onNotify); } catch (e) { console.error('[notify] reconnect error', e); }
        }, 5000);
      }
    }
  });

  // 监听后端通知事件
  socket.on('notify.message', (payload) => {
    try { if (typeof onNotify === 'function') onNotify(payload); } catch (e) {}
  });
}

function startNotifyListener() {
  connectNotifySocket((payload) => {
    // 打印payload到控制台和写入本地日志文件，便于调试
    const logStr = '[notify] payload: ' + util.inspect(payload, { depth: 5, colors: false });
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), logStr + '\n');
    } catch (e) {}
    console.log(logStr);
    if (payload && payload.message) {
      // 格式化消息预览：仅对文本消息显示全文内容，其他类型显示友好占位
      const msg = payload.message || {};
      function messagePreview(m) {
        try {
          if (!m) return '';
          const content = m.content;
          const t = String(m.type || (content && content.type) || '').toLowerCase();

          if (t === 'text' || t === '') {
            if (typeof content === 'string') return content;
            if (typeof content === 'number' || typeof content === 'boolean') return String(content);
            if (content && typeof content === 'object') {
              const v = content.text ?? content.body ?? content;
              if (typeof v === 'string') return v;
              if (typeof v === 'number' || typeof v === 'boolean') return String(v);
              return '';
            }
            return '';
          }

          if (t === 'emoji' || t === 'sticker') return '[表情]';

          if (t === 'file' || t === 'attachment') {
            if (content && typeof content === 'object' && content.filename) return `[文件] ${String(content.filename)}`;
            return '[文件]';
          }

          if (t === 'image' || (content && content.mimetype && /^image\//i.test(String(content.mimetype)))) return '[图片]';

          if (t === 'video') return '[视频]';

          if (t === 'coordinate') {
            if (content && typeof content === 'object' && content.name) return `[坐标] ${String(content.name)}`;
            return '[坐标]';
          }

          if (t === 'player_card' || t === 'playercard') return '[玩家名片]';

          // fallback: try to show any readable text-like field, otherwise a generic label
          if (typeof content === 'string') return content;
          if (typeof content === 'number' || typeof content === 'boolean') return String(content);
          if (content && typeof content === 'object') {
            const v = content.text ?? content.body ?? content.filename ?? '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
          }
          return '[非文本消息]';
        } catch (e) {
          return '';
        }
      }

      const messageText = messagePreview(msg);

      // 会话名称优先：payload.chatName || payload.chat?.name，回退显示 chatId
      const title = payload.chatName || (payload.chat && payload.chat.name) || `会话 ${payload.chatId}`;

      // 如果有活跃的 Electron 窗口（未销毁且可见），优先使用 Windows 原生窗口提醒（闪烁任务栏）;
      // 否则显示系统通知。使用 Electron `Notification` 优先，回退到 `node-notifier`。
      function focusMainWindow() {
        try {
          const wins = BrowserWindow.getAllWindows().filter(w => w && !w.isDestroyed());
          const win = wins.length > 0 ? wins[0] : null;
          if (win) {
            try {
              if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
            } catch (e) {}
            try { win.show(); } catch (e) {}
            try { win.focus(); } catch (e) {}
            return;
          }
          // 如果没有窗口，尝试让应用获得焦点（在 macOS 上可能会触发 activate 事件）
          try { app.focus && app.focus(); } catch (e) {}
        } catch (e) {}
      }

      function showSystemNotification(title, body) {
        try {
          let iconPath = path.join(process.cwd(), 'assets', 'icon.ico');
          if (!fs.existsSync(iconPath)) iconPath = undefined;
          if (Notification && typeof Notification === 'function') {
            try {
              const n = new Notification({ title, body: body || '', icon: iconPath });
              try { n.on('click', () => { focusMainWindow(); }); } catch (e) {}
              n.show();
              return;
            } catch (e) {
              // fallthrough to node-notifier
            }
          }
          // fallback to node-notifier: use per-call callback (wait:true) to catch clicks
          try {
            notifier.notify({ title, message: body || '你有新消息', appID: 'Minechat', icon: iconPath, wait: true }, (err, response, metadata) => {
              try { focusMainWindow(); } catch (e) {}
            });
          } catch (e) {}
        } catch (e) {}
      }

      const win = BrowserWindow.getAllWindows().find(w => w && !w.isDestroyed());
      if (win && typeof win.isVisible === 'function' && win.isVisible()) {
        try {
          // 如果窗口已有焦点，则不需要提醒
          const focused = (typeof win.isFocused === 'function') ? win.isFocused() : false;
          if (!focused) {
            // flashFrame 在 Windows 上会持续闪烁任务栏图标，直到窗口获得焦点或程序手动停止
            try { win.flashFrame(true); } catch (e) { throw e; }
          }
        } catch (e) {
          // flash failed -> show system notification
          showSystemNotification(title, messageText);
        }
      } else {
        // no visible window -> show system notification
        showSystemNotification(title, messageText);
      }
    }
  });
}

module.exports = { startNotifyListener };
