(function () {
  const KEY = 'minechat_theme';

  function normalizeTheme(v) {
    const t = String(v || '').toLowerCase().trim();
    return t === 'dark' ? 'dark' : 'light';
  }

  function getTheme() {
    try {
      return normalizeTheme(localStorage.getItem(KEY) || 'light');
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    const t = normalizeTheme(theme);
    const root = document.documentElement;
    if (t === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      root.dataset.theme = t;
    } catch (e) {}
    return t;
  }

  function setTheme(theme) {
    const t = applyTheme(theme);
    try {
      localStorage.setItem(KEY, t);
    } catch (e) {}
    return t;
  }

  function initTheme() {
    applyTheme(getTheme());
  }

  initTheme();

  window.MinechatTheme = {
    KEY,
    get: getTheme,
    set: setTheme,
    apply: applyTheme,
    init: initTheme,
  };

  // 静态资源离线缓存（Service Worker）
  // 说明：SW 的缓存策略会“无视服务器缓存时间”，命中后不会再发起网络请求。
  try {
    if ('serviceWorker' in navigator) {
      // updateViaCache: 'all' 允许浏览器在更新检查时使用缓存（减少不必要的网络）。
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js', { updateViaCache: 'all' })
          .catch(() => {});
      });
    }
  } catch (e) {}
})();
