// Vue 3 + Element Plus register page
const { createApp, ref, computed, onMounted, onBeforeUnmount } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const loading = ref(false);

    const msLogging = ref(false);
    const msUsername = ref('');
    const minecraftId = ref('');

    const idName = ref('');
    const idNumber = ref('');
    const starting = ref(false);

    const zimUrl = ref('');
    const qrImageUrl = ref('');

    const bizId = ref('');
    const token = ref('');
    const flowStatus = ref('');
    const flowUpdatedAt = ref(null);

    const errorMsg = ref('');
    const errorDetail = ref('');

    let pollTimer = null;

    function setRegisteredHintOnce(username) {
      try {
        const key = 'minechat_register_success_once';
        sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), username: String(username || '') }));
      } catch (e) {}
    }

    function isMobileDevice() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    }

    const isMobile = computed(() => isMobileDevice());

    const hasMsProfile = computed(() => !!String(msUsername.value || '').trim());
    const hasZimUrl = computed(() => !!String(zimUrl.value || '').trim());
    const showIdForm = computed(() => hasMsProfile.value && !hasZimUrl.value);

    function gotoLogin() {
      window.location.href = isMobileDevice() ? '/m/login.html' : '/index.html';
    }

    function resetFlow() {
      try { stopPolling(); } catch (e) {}
      idName.value = '';
      idNumber.value = '';
      zimUrl.value = '';
      qrImageUrl.value = '';
      bizId.value = '';
      token.value = '';
      flowStatus.value = '';
      flowUpdatedAt.value = null;
      clearErrors();
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }

    function clearErrors() {
      errorMsg.value = '';
      errorDetail.value = '';
    }

    function processRegisterRedirectUrl(href) {
      try {
        const url = new URL(href || window.location.href);
        const sp = url.searchParams;

        // Microsoft register callback
        if (sp.has('ok')) {
          const ok = sp.get('ok') === '1';
          if (ok) {
            msUsername.value = sp.get('username') || '';
            minecraftId.value = sp.get('minecraftId') || '';
            // New MS profile means we should reset any previous flow state.
            resetFlow();
            clearErrors();
          } else {
            errorMsg.value = sp.get('error') || '获取用户名失败';
            errorDetail.value = sp.get('detail') || '';
          }
        }

        // ZIM return redirect
        if (sp.get('step') === 'done') {
          bizId.value = sp.get('bizId') || '';
          token.value = sp.get('token') || '';
          if (bizId.value && token.value) {
            startPolling();
          }
        }

        // Keep page clean
        try {
          const clean = url.origin + url.pathname + url.hash;
          window.history.replaceState({}, document.title, clean);
        } catch (e) {}
      } catch (e) {}
    }

    function startMsRegister() {
      if (msLogging.value) return;
      msLogging.value = true;
      clearErrors();
      const base = apiBase.value || apiAuthBase.value;
      window.location.href = `${base}/auth/microsoft?mode=register`;
    }

    function normalizeIdNumber(s) {
      return String(s || '').trim().toUpperCase();
    }

    function looksLikeChineseId(s) {
      return /^[0-9]{17}[0-9X]$/.test(normalizeIdNumber(s));
    }

    async function startFace() {
      if (starting.value) return;
      clearErrors();

      const username = String(msUsername.value || '').trim();
      const name = String(idName.value || '').trim();
      const idn = normalizeIdNumber(idNumber.value);

      if (!username) return ElementPlus.ElMessage.warning('请先使用 Microsoft 获取游戏名');
      if (!name) return ElementPlus.ElMessage.warning('请输入姓名');
      if (!idn) return ElementPlus.ElMessage.warning('请输入身份证号');
      if (!looksLikeChineseId(idn)) return ElementPlus.ElMessage.warning('身份证号格式不正确');

      starting.value = true;
      try {
        const base = apiBase.value || apiAuthBase.value;
        const res = await fetch(`${base}/idverify/zim/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, idName: name, idNumber: idn }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : `发起认证失败：${res.status}`;
          throw new Error(msg);
        }

        if (data && data.already) {
          flowStatus.value = 'passed';
          try { ElementPlus.ElMessage.success('该用户已实名，正在跳转到登录…'); } catch (e) {}
          setRegisteredHintOnce(msUsername.value);
          setTimeout(() => gotoLogin(), 900);
          return;
        }

        const rurl = data && data.redirectUrl ? String(data.redirectUrl) : '';
        bizId.value = data && data.bizId ? String(data.bizId) : '';
        token.value = data && data.token ? String(data.token) : '';

        zimUrl.value = rurl;
        qrImageUrl.value = '';

        if (bizId.value && token.value) startPolling();

        if (!rurl) throw new Error('后端未返回跳转地址');

        // Mobile: directly jump to ZIM page.
        // Desktop: show QR code for phone scanning.
        if (isMobileDevice()) {
          window.location.href = rurl;
        } else {
          try { ElementPlus.ElMessage.success('请使用手机扫码完成扫脸认证'); } catch (e) {}
          try {
            const qrRes = await fetch(`${base}/idverify/qr.png?text=${encodeURIComponent(rurl)}`);
            if (qrRes.ok) {
              const blob = await qrRes.blob();
              qrImageUrl.value = URL.createObjectURL(blob);
            }
          } catch (e) {}
        }
      } catch (e) {
        try { ElementPlus.ElMessage.error(e?.message || String(e)); } catch (e2) {}
      } finally {
        starting.value = false;
      }
    }

    async function copyZimUrl() {
      const url = String(zimUrl.value || '').trim();
      if (!url) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        ElementPlus.ElMessage.success('已复制链接');
      } catch (e) {
        try { ElementPlus.ElMessage.warning('复制失败，请手动复制'); } catch (e2) {}
      }
    }

    function openZimUrl() {
      const url = String(zimUrl.value || '').trim();
      if (!url) return;
      try { window.open(url, '_blank', 'noopener'); } catch (e) { window.location.href = url; }
    }

    async function pollOnce() {
      if (!bizId.value || !token.value) return;
      try {
        const base = apiBase.value || apiAuthBase.value;
        const url = `${base}/idverify/flow/status?bizId=${encodeURIComponent(bizId.value)}&token=${encodeURIComponent(token.value)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        if (!res.ok) return;
        if (data && data.status) {
          flowStatus.value = String(data.status);
          flowUpdatedAt.value = data.updatedAt || null;

          if (flowStatus.value === 'passed') {
            stopPolling();
            try { ElementPlus.ElMessage.success('实名完成，正在跳转到登录…'); } catch (e) {}
            setRegisteredHintOnce(msUsername.value);
            setTimeout(() => gotoLogin(), 900);
          }
        }
      } catch (e) {}
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      stopPolling();
      pollOnce();
      pollTimer = setInterval(pollOnce, 2000);
    }

    const step = computed(() => {
      // Element Plus Steps uses 0-based index.
      if (flowStatus.value === 'passed') return 3;
      if (bizId.value && token.value) return 2;
      if (msUsername.value) return 1;
      return 0;
    });

    const canLogin = computed(() => flowStatus.value === 'passed');

    const flowInfo = computed(() => {
      if (!bizId.value || !token.value) return null;
      const st = String(flowStatus.value || 'pending');
      if (st === 'passed') {
        return { type: 'success', title: '实名完成：现在可以去登录了', detail: '' };
      }
      if (st === 'failed') {
        return { type: 'error', title: '实名未通过', detail: '请重新发起认证或联系管理员。' };
      }
      if (st === 'init_failed') {
        return { type: 'error', title: '发起认证失败', detail: '请返回并重试。' };
      }
      if (st === 'notified') {
        return { type: 'warning', title: '已收到回调，但未解析到通过/失败', detail: '请检查后端是否收到了正确的结果字段。' };
      }
      return { type: 'info', title: '完成认证后会自动跳转。', detail: flowUpdatedAt.value ? `更新时间：${flowUpdatedAt.value}` : '' };
    });

    onMounted(async () => {
      loading.value = true;
      await fetchConfig();
      processRegisterRedirectUrl(window.location.href);
      loading.value = false;
      // If user came back and we already have pending flow info, keep polling.
      if (bizId.value && token.value) startPolling();
    });

    onBeforeUnmount(() => stopPolling());

    return {
      apiBase,
      loading,
      msLogging,
      msUsername,
      minecraftId,
      idName,
      idNumber,
      starting,
      zimUrl,
      qrImageUrl,
      isMobile,
      hasMsProfile,
      hasZimUrl,
      showIdForm,
      bizId,
      token,
      flowStatus,
      step,
      flowInfo,
      canLogin,
      errorMsg,
      errorDetail,
      startMsRegister,
      startFace,
      copyZimUrl,
      openZimUrl,
      resetFlow,
      gotoLogin,
    };
  },
}).use(ElementPlus).mount('#app');
