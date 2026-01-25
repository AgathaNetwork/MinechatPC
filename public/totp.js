// Vue 3 + Element Plus TOTP management page (desktop only)
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');

    const token = ref(localStorage.getItem('token') || null);
    const enabled = ref(false);
    const loading = ref(false);

    const lastError = ref('');

    const setupStarting = ref(false);
    const setupConfirming = ref(false);
    const disabling = ref(false);

    const setupToken = ref('');
    const setupSecret = ref('');
    const setupOtpAuthUrl = ref('');
    const setupUsername = ref('');
    const setupCode = ref('');

    const qrImageUrl = ref('');

    const disableCode = ref('');

    const isLoggedIn = computed(() => !!tokenValue());

    function tokenValue() {
      const t = String(token.value || '').trim();
      return t ? t : null;
    }

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);
      return fetch(url, opt);
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
      return conf;
    }

    function clearSetup() {
      setupToken.value = '';
      setupSecret.value = '';
      setupOtpAuthUrl.value = '';
      setupUsername.value = '';
      setupCode.value = '';
      lastError.value = '';

      try {
        const url = String(qrImageUrl.value || '').trim();
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
      } catch (e) {}
      qrImageUrl.value = '';
    }

    async function fetchQrPng() {
      const st = String(setupToken.value || '').trim();
      if (!st) return;

      try {
        const res = await safeFetch(`${apiBase.value}/totp/setup/qr?setupToken=${encodeURIComponent(st)}`);
        if (!res.ok) return;
        const blob = await res.blob();
        if (!blob || !String(blob.type || '').startsWith('image/')) return;

        try {
          const old = String(qrImageUrl.value || '').trim();
          if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
        } catch (e) {}

        qrImageUrl.value = URL.createObjectURL(blob);
      } catch (e) {
        // Non-blocking: user can still copy secret/otpauth url.
      }
    }

    async function refresh() {
      if (!isLoggedIn.value) return;
      loading.value = true;
      lastError.value = '';
      try {
        await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/totp/status`);
        if (!res.ok) {
          if (res.status === 401) throw new Error('请先登录');
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `请求失败：${res.status}`);
        }
        const data = await res.json().catch(() => null);
        enabled.value = !!(data && data.enabled);
        if (enabled.value) clearSetup();
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        loading.value = false;
      }
    }

    async function startSetup() {
      if (!isLoggedIn.value) return;
      setupStarting.value = true;
      lastError.value = '';
      try {
        await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/totp/setup/start`, { method: 'POST' });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : `请求失败：${res.status}`;
          throw new Error(msg);
        }
        setupToken.value = String(data.setupToken || '');
        setupSecret.value = String(data.secret || '');
        setupOtpAuthUrl.value = String(data.otpauthUrl || '');
        setupUsername.value = String(data.username || '');
        setupCode.value = '';

        await fetchQrPng();
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        setupStarting.value = false;
      }
    }

    async function confirmSetup() {
      if (!isLoggedIn.value) return;
      if (!setupToken.value) return;
      setupConfirming.value = true;
      lastError.value = '';
      try {
        await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/totp/setup/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setupToken: setupToken.value, code: setupCode.value }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : `请求失败：${res.status}`;
          throw new Error(msg);
        }
        enabled.value = true;
        clearSetup();
        try { ElementPlus.ElMessage.success('已启用 TOTP'); } catch (e) {}
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        setupConfirming.value = false;
      }
    }

    async function disableTotp() {
      if (!isLoggedIn.value) return;
      disabling.value = true;
      lastError.value = '';
      try {
        await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/totp/disable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: disableCode.value }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : `请求失败：${res.status}`;
          throw new Error(msg);
        }
        enabled.value = false;
        disableCode.value = '';
        try { ElementPlus.ElMessage.success('已关闭 TOTP'); } catch (e) {}
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        disabling.value = false;
      }
    }

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'gallery') window.location.href = '/gallery.html';
      else if (key === 'me') window.location.href = '/me.html';
      else if (key === 'totp') window.location.href = '/totp.html';
    }

    onMounted(async () => {
      await fetchConfig().catch(() => {});
      await refresh();
    });

    return {
      enabled,
      loading,
      lastError,

      setupStarting,
      setupConfirming,
      disabling,

      setupToken,
      setupSecret,
      setupOtpAuthUrl,
      setupUsername,
      setupCode,

      qrImageUrl,

      disableCode,

      isLoggedIn,
      refresh,
      startSetup,
      confirmSetup,
      disableTotp,
      clearSetup,
      onNav,
    };
  },
}).use(ElementPlus).mount('#app');
