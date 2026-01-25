function normalizeBaseUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

function getRuntimeConfig() {
  // API base should point to the Minechat backend (not the web frontend).
  // Configure via env vars at runtime.
  const apiBase = normalizeBaseUrl(
    process.env.MINECHAT_API_BASE ||
      process.env.MINECHAT_BACKEND_BASE ||
      process.env.MINECHAT_SERVER_BASE ||
      'https://back-dev.agatha.org.cn'
  );

  // Optional: if you use a reverse proxy for CORS/cookies, set this separately.
  const apiProxyBase = normalizeBaseUrl(process.env.MINECHAT_API_PROXY_BASE || '');

  return {
    apiBase,
    apiProxyBase
  };
}

function getWsBase() {
  // WebSocket (socket.io) should connect to the real backend origin.
  // The local /api HTTP proxy is for fetch() calls only.
  const conf = getRuntimeConfig();
  return conf.apiBase || '';
}

module.exports = {
  getRuntimeConfig,
  getWsBase
};
