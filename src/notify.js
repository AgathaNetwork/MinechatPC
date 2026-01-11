// notify.js
// 连接/notify WebSocket并系统通知
const { app, BrowserWindow, Notification } = require('electron');
const notifier = require('node-notifier');
const util = require('util');
const fs = require('fs');
const path = require('path');
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

  // 这里假设API服务和前端在同一主机
  const token = await getToken();
  // 固定后端 host，避免自动检测失败
  const wsBase = 'https://front-dev.agatha.org.cn';
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
      secure: true,
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
      const title = payload.message.content?.text || '你有新消息';
      const message = `来自会话 ${payload.chatId}`;
      // 使用node-notifier调用Windows原生通知
      notifier.notify({
        title,
        message,
        appID: 'Minechat',
        icon: undefined // 可自定义图标
      });
    }
  });
}

module.exports = { startNotifyListener };
