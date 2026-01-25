// Vue 3 + Element Plus login page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const tokenInput = ref(localStorage.getItem('token') || '');
    const checking = ref(false);
    const hasSession = ref(false);
    const loggingIn = ref(false);
    const totpUsername = ref(localStorage.getItem('username') || '');
    const totpCode = ref('');
    const totpLoggingIn = ref(false);

    const authOk = ref(null); // null | true | false
    const authUserId = ref('');
    const authUsername = ref('');
    const authFaceUrl = ref('');
    const authChatsCount = ref(null);
    const authError = ref('');
    const authDetail = ref('');

    function base64UrlToJson(str) {
      try {
        const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function clearAuthState() {
      authOk.value = null;
      authUserId.value = '';
      authUsername.value = '';
      authFaceUrl.value = '';
      authChatsCount.value = null;
      authError.value = '';
      authDetail.value = '';
    }

    function processAuthRedirectUrl(href, opts) {
      try {
        const url = new URL(href || window.location.href);
        const sp = url.searchParams;
        if (!sp.has('ok')) return false;

        clearAuthState();

        const ok = sp.get('ok') === '1';
        authOk.value = ok;

        if (ok) {
          const token = sp.get('token') || '';
          const userId = sp.get('userId') || '';
          const username = sp.get('username') || '';
          const faceUrl = sp.get('faceUrl') || '';
          const chats = sp.get('chats') || '';

          if (token) {
            try { localStorage.setItem('token', token); } catch (e) {}
            tokenInput.value = token;
            // Try to notify outer container (electron / app shell / parent) about the token
            try {
              console.log('[login] obtained token, calling sendTokenToHost', token && token.slice ? token.slice(0,8)+'...' : token);
              sendTokenToHost(token);
            } catch (e) { console.warn('[login] sendTokenToHost failed', e); }
          }
          if (username) {
            try { localStorage.setItem('username', username); } catch (e) {}
          }
          if (faceUrl) {
            try { localStorage.setItem('faceUrl', faceUrl); } catch (e) {}
          }

          authUserId.value = userId;
          authUsername.value = username;
          authFaceUrl.value = faceUrl;

          if (chats) {
            const parsed = base64UrlToJson(chats);
            if (Array.isArray(parsed)) authChatsCount.value = parsed.length;
            try { sessionStorage.setItem('chats_cache', JSON.stringify(parsed)); } catch (e) {}
          }
        } else {
          authError.value = sp.get('error') || '登录失败';
          authDetail.value = sp.get('detail') || '';
        }

        // Clear query params (keep page clean). Only do it for current window.
        const fromPopup = opts && opts.fromPopup;
        if (!fromPopup) {
          try {
            const clean = url.origin + url.pathname + url.hash;
            window.history.replaceState({}, document.title, clean);
          } catch (e) {}
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    function processRegisterSuccessHint(href) {
      try {
        const url = new URL(href || window.location.href);
        const sp = url.searchParams;

        let hinted = false;
        // Query flag (optional)
        if (sp.get('registered') === '1') {
          hinted = true;
          try {
            ElementPlus.ElMessage.success('注册成功，请继续登录');
          } catch (e) {}
        }

        // sessionStorage flag (preferred, single-use)
        try {
          const key = 'minechat_register_success_once';
          const raw = sessionStorage.getItem(key);
          if (raw) {
            sessionStorage.removeItem(key);
            let u = '';
            try {
              const obj = JSON.parse(raw);
              u = obj && obj.username ? String(obj.username) : '';
            } catch (e) {
              // ignore
            }
            try {
              ElementPlus.ElMessage.success(u ? `实名完成：${u}，请继续登录` : '实名完成，请继续登录');
            } catch (e) {}
            hinted = true;
          }
        } catch (e) {}

        // Clean URL if we used query param
        if (hinted && sp.has('registered')) {
          try {
            sp.delete('registered');
            const clean = url.origin + url.pathname + (sp.toString() ? `?${sp.toString()}` : '') + url.hash;
            window.history.replaceState({}, document.title, clean);
          } catch (e) {}
        }
      } catch (e) {}
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }

    async function checkSession() {
      try {
        const res = await fetch(`${apiBase.value}/chats`, { credentials: 'include' });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    function isMobileDevice() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    }

    function gotoChat() {
      if (isMobileDevice()) {
        window.location.href = '/m/chats.html';
      } else {
        window.location.href = '/chat.html';
      }
    }

    function gotoRegister() {
      window.location.href = '/register.html';
    }

    async function loginWithTotp() {
      if (totpLoggingIn.value) return;
      const username = String(totpUsername.value || '').trim();
      const code = String(totpCode.value || '').trim();
      if (!username) return ElementPlus.ElMessage.warning('请输入用户名');
      if (!code) return ElementPlus.ElMessage.warning('请输入 TOTP');

      totpLoggingIn.value = true;
      try {
        await fetchConfig();
        clearAuthState();
        const base = apiBase.value || apiAuthBase.value;

        const res = await fetch(`${base}/auth/totp/login`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, totp: code }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : `登录失败：${res.status}`;
          throw new Error(msg);
        }

        const token = data && data.token ? String(data.token) : '';
        const user = data && data.user ? data.user : null;
        const chats = data && data.chats ? data.chats : null;
        const faceUrl = user && user.faceUrl ? String(user.faceUrl) : '';
        const uname = user && user.username ? String(user.username) : username;

        if (token) {
          try { localStorage.setItem('token', token); } catch (e) {}
          tokenInput.value = token;
          try { sendTokenToHost(token); } catch (e) {}
        }
        if (uname) {
          try { localStorage.setItem('username', uname); } catch (e) {}
        }
        if (faceUrl) {
          try { localStorage.setItem('faceUrl', faceUrl); } catch (e) {}
        }
        if (chats) {
          try { sessionStorage.setItem('chats_cache', JSON.stringify(chats)); } catch (e) {}
        }

        // clear code after success
        totpCode.value = '';
        gotoChat();
      } catch (e) {
        try { ElementPlus.ElMessage.error(e?.message || String(e)); } catch (e2) {}
      } finally {
        totpLoggingIn.value = false;
      }
    }

    async function logoutSession() {
      try {
        await fetch(`${apiBase.value}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) {}
      hasSession.value = false;
    }

    function openLoginPopup() {
      if (loggingIn.value) return;
      loggingIn.value = true;
      // No popup: redirect current page to start OAuth.
      // Prefer same-origin proxy (/api) to avoid CORS issues.
      const base = apiBase.value || apiAuthBase.value;
      try { clearAuthState(); } catch (e) {}
      window.location.href = `${base}/auth/microsoft`;
    }

    function applyToken() {
      const t = tokenInput.value.trim();
      if (!t) return ElementPlus.ElMessage.warning('请输入 token');
      localStorage.setItem('token', t);
      try { console.log('[login] applyToken calling sendTokenToHost', t && t.slice ? t.slice(0,8)+'...' : t); sendTokenToHost(t); } catch (e) { console.warn('[login] sendTokenToHost failed', e); }
      gotoChat();
    }

    function sendTokenToHost(token) {
      const msg = { type: 'minechat-token', token: String(token || '') };
      // Attempt various common host-bridge mechanisms, logging each attempt
      try {
        if (window.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.postMessage', msg);
            window.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.postMessage not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost postMessage error', e); }

      try {
        if (window.top && window.top !== window && window.top.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.top.postMessage', msg);
            window.top.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.top.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.top.postMessage not available or same as window');
        }
      } catch (e) { console.warn('[login] sendTokenToHost top.postMessage error', e); }

      try {
        if (window.parent && window.parent !== window && window.parent.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.parent.postMessage', msg);
            window.parent.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.parent.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.parent.postMessage not available or same as window');
        }
      } catch (e) { console.warn('[login] sendTokenToHost parent.postMessage error', e); }

      try {
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
          console.log('[login] sendTokenToHost: posting to chrome.webview.postMessage', msg);
          window.chrome.webview.postMessage(msg);
        } else {
          console.log('[login] sendTokenToHost: chrome.webview.postMessage not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost chrome.webview error', e); }

      try {
        if (window.external && typeof window.external.invoke === 'function') {
          console.log('[login] sendTokenToHost: calling window.external.invoke', msg);
          window.external.invoke(JSON.stringify(msg));
        } else {
          console.log('[login] sendTokenToHost: window.external.invoke not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost external.invoke error', e); }
    }

    onMounted(async () => {
      checking.value = true;
      await fetchConfig();

      // Show one-time hint after registration
      processRegisterSuccessHint(window.location.href);

      // If backend redirected to this page with auth params, apply them.
      const handledAuthRedirect = processAuthRedirectUrl(window.location.href);

      hasSession.value = await checkSession();

      // If we already have a valid session cookie, skip the login screen.
      // Do NOT auto-navigate when we are showing an explicit auth result.
      if (!handledAuthRedirect && authOk.value === null && hasSession.value) {
        try { gotoChat(); } catch (e) {}
        return;
      }
      checking.value = false;
    });

    return {
      tokenInput,
      checking,
      loggingIn,
      hasSession,
      openLoginPopup,
      gotoRegister,
      totpUsername,
      totpCode,
      totpLoggingIn,
      loginWithTotp,
      applyToken,
      gotoChat,
      logoutSession,

      authOk,
      authUserId,
      authUsername,
      authFaceUrl,
      authChatsCount,
      authError,
      authDetail,
    };
  },
}).use(ElementPlus).mount('#app');
