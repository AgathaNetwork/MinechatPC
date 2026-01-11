// notify.js
// 连接/notify WebSocket并系统通知
const { Notification } = require('electron');
const notifier = require('node-notifier');
const util = require('util');
let socket = null;
let reconnectTimer = null;

function getToken() {
  // 假设token存储在本地文件或localStorage，需根据实际情况实现
  try {
    const data = fs.readFileSync(path.join(app.getPath('userData'), 'token.txt'), 'utf8');
    return data.trim();
  } catch {
    return '';
  }
}

function connectNotifySocket(onNotify) {
  if (socket) {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), '[notify] socket disconnect\n');
    } catch (e) {}
    console.log('[notify] socket disconnect');
    socket.close();
    socket = null;
  }
  // 这里假设API服务和前端在同一主机
  const token = getToken();
  // 自动获取electron窗口当前url的host，适配反代场景
  let wsHost = 'localhost:4000';
  try {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const url = win.webContents.getURL();
      const m = url.match(/^https?:\/\/(.*?)(\/|$)/);
      if (m && m[1]) wsHost = m[1];
    }
  } catch (e) {}
  const wsUrl = `ws://${wsHost}/api/notify?token=${encodeURIComponent(token)}`;
  try {
    require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket create: ${wsUrl}\n`);
  } catch (e) {}
  console.log(`[notify] socket create: ${wsUrl}`);
  socket = new (require('ws'))(wsUrl);

  socket.on('open', () => {
    reconnectTimer && clearTimeout(reconnectTimer);
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), '[notify] socket open\n');
    } catch (e) {}
    console.log('[notify] socket open');
  });
  socket.on('close', () => {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), '[notify] socket close\n');
    } catch (e) {}
    console.log('[notify] socket close');
    reconnectTimer = setTimeout(() => connectNotifySocket(onNotify), 5000);
  });
  socket.on('error', (err) => {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'notify-debug.log'), `[notify] socket error: ${err?.message || err}\n`);
    } catch (e) {}
    console.log('[notify] socket error', err);
    socket.close();
  });
  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'notify.message' && typeof onNotify === 'function') {
        onNotify(msg.payload);
      }
    } catch {}
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
