// Mobile me page
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);
    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);

    const theme = ref((window.MinechatTheme && window.MinechatTheme.get && window.MinechatTheme.get()) || 'light');
    const themeDark = computed({
      get() {
        return theme.value === 'dark';
      },
      set(v) {
        const t = v ? 'dark' : 'light';
        theme.value = t;
        try {
          if (window.MinechatTheme && window.MinechatTheme.set) window.MinechatTheme.set(t);
        } catch (e) {}
      },
    });
    const loading = ref(false);
    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');
    const selfMinecraftUuid = ref('');
    const selfLevel = ref(null);
    const selfRegisteredAt = ref('');
    const selfLastLoginAt = ref('');
    const selfOnline = ref(null);
    const updating = ref(false);
    const lastResult = ref('');
    const lastError = ref('');

    const idDialogVisible = ref(false);
    const idLoading = ref(false);
    const idDocName = ref('');
    const idDocNumber = ref('');
    const idError = ref('');

    const idRows = computed(() => {
      return [
        { k: '证件姓名', v: idDocName.value || '-' },
        { k: '证件号码', v: idDocNumber.value || '-' },
      ];
    });

    const historyDialogVisible = ref(false);
    const historyLoading = ref(false);
    const historyList = ref([]);
    const historyError = ref('');

    // Account services: Paste (openid.pastes)
    const pasteDialogVisible = ref(false);
    const pasteLoading = ref(false);
    const pasteSaving = ref(false);
    const pasteError = ref('');
    const pasteResult = ref('');
    const pasteExistingMarkdown = ref('');
    const pasteExistingTimeText = ref('');
    const pasteEditMarkdown = ref('');

    function escapeHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(url) {
      const u = String(url || '').trim();
      if (!u) return '';
      if (/^https?:\/\//i.test(u)) return u;
      if (/^mailto:/i.test(u)) return u;
      return '';
    }

    function renderMarkdown(md) {
      const input = String(md || '').replace(/\r\n/g, '\n');
      if (!input.trim()) return '';

      const blocks = [];
      const placeholder = (i) => `@@CODEBLOCK_${i}@@`;
      let text = input.replace(/```([\w-]+)?\n([\s\S]*?)\n```/g, (m, lang, code) => {
        const html = `<pre><code>${escapeHtml(code)}</code></pre>`;
        const idx = blocks.push(html) - 1;
        return placeholder(idx);
      });

      text = escapeHtml(text);

      text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      text = text.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      text = text.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

      text = text.replace(/\[([^\]]+?)\]\(([^\)]+?)\)/g, (m, label, url) => {
        const safe = sanitizeUrl(url);
        if (!safe) return label;
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });

      text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
      text = text.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

      text = text.replace(/^(?:\s*[-*]\s+.+\n?)+/gm, (block) => {
        const items = block
          .trimEnd()
          .split(/\n/)
          .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
          .filter(Boolean)
          .map((it) => `<li>${it}</li>`)
          .join('');
        return items ? `<ul>${items}</ul>` : block;
      });

      const parts = text
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      text = parts
        .map((p) => {
          if (/^<\/?(h1|h2|h3|ul|pre)/.test(p)) return p;
          return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');

      text = text.replace(/@@CODEBLOCK_(\d+)@@/g, (m, i) => blocks[Number(i)] || '');
      return text;
    }

    const pastePreviewHtml = computed(() => {
      try {
        return renderMarkdown(pasteEditMarkdown.value);
      } catch (e) {
        return '';
      }
    });

    // Game services: Home query
    const homeDialogVisible = ref(false);
    const homeLoading = ref(false);
    const homeError = ref('');
    const homeNameQuery = ref('');
    const homeWorldFilter = ref(''); // '', 'world', 'world_nether', 'world_the_end'
    const homesList = ref([]); // [{ name, worldKey, worldLabel, x, y, z, yaw, pitch }]

    // Game services: Playtime records
    const playtimeDialogVisible = ref(false);
    const playtimeLoading = ref(false);
    const playtimeError = ref('');
    const playtimeSummaryText = ref('');
    const playtimeDaySecondsMap = ref({});

    // App settings (for uni-app App-Plus webview)
    const appDialogVisible = ref(false);
    const appDialogTab = ref('general');
    const cacheSizeText = ref('');
    const cacheBusy = ref(false);
    const appInfo = ref({});
    const isAppEnv = ref(false);

    function readQueryParam(name) {
      try {
        const key = String(name || '').trim();
        if (!key) return '';
        const raw = String(window.location && window.location.search ? window.location.search : '');
        if (!raw || raw === '?') return '';
        const s = raw.startsWith('?') ? raw.slice(1) : raw;
        const parts = s.split('&').filter(Boolean);
        for (const p of parts) {
          const idx = p.indexOf('=');
          const k = idx >= 0 ? p.slice(0, idx) : p;
          if (k !== key) continue;
          const v = idx >= 0 ? p.slice(idx + 1) : '';
          return decodeURIComponent(v || '');
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    const appBuildTime = ref('');

    function refreshAppBuildTimeFromUrl() {
      // 由 Uniapp WebView 侧注入（每次构建会变化）
      const v = readQueryParam('mc_app_build_time') || readQueryParam('mc_build_time');
      if (v) {
        appBuildTime.value = safeStr(v || '');
        return;
      }
      try {
        const ls = window.localStorage ? window.localStorage.getItem('mc_app_build_time') : '';
        appBuildTime.value = safeStr(ls || '');
      } catch (e) {
        appBuildTime.value = '';
      }
    }

    refreshAppBuildTimeFromUrl();

    function detectAppEnv() {
      try {
        isAppEnv.value = !!(window.plus && window.plus.runtime);
      } catch (e) {
        isAppEnv.value = false;
      }
    }

    detectAppEnv();
    try {
      document.addEventListener('plusready', detectAppEnv, false);
    } catch (e) {}

    function formatBytes(n) {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0) return '0B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let idx = 0;
      let num = v;
      while (num >= 1024 && idx < units.length - 1) {
        num /= 1024;
        idx += 1;
      }
      return `${num.toFixed(idx === 0 ? 0 : 2)}${units[idx]}`;
    }

    function guessEnvLabel() {
      return isAppEnv.value ? 'App(plus)' : '浏览器';
    }

    function safeStr(v) {
      if (v === null || v === undefined) return '';
      return String(v);
    }

    function readBasicInfo() {
      const ua = safeStr(navigator.userAgent);
      const lang = safeStr(navigator.language);
      const platform = safeStr(navigator.platform);
      const screenText = window.screen ? `${screen.width}×${screen.height}` : '';

      return {
        env: guessEnvLabel(),
        ua,
        platform,
        lang,
        screen: screenText,
      };
    }

    function readPlusInfoBestEffort() {
      try {
        const osName = window.plus && plus.os ? safeStr(plus.os.name) : '';
        const osVersion = window.plus && plus.os ? safeStr(plus.os.version) : '';
        const model = window.plus && plus.device ? safeStr(plus.device.model) : '';
        const vendor = window.plus && plus.device ? safeStr(plus.device.vendor) : '';
        const uuid = window.plus && plus.device ? safeStr(plus.device.uuid) : '';
        const storageLen = window.plus && plus.storage && plus.storage.getLength ? safeStr(plus.storage.getLength()) : '';
        return { osName, osVersion, model, vendor, uuid, storageLen };
      } catch (e) {
        return { osName: '', osVersion: '', model: '', vendor: '', uuid: '', storageLen: '' };
      }
    }

    function getRuntimeProperty() {
      return new Promise((resolve) => {
        try {
          if (!window.plus || !plus.runtime || !plus.runtime.getProperty) return resolve(null);
          plus.runtime.getProperty(plus.runtime.appid, (info) => resolve(info || null));
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function refreshSystemInfo() {
      const base = readBasicInfo();
      const plusInfo = isAppEnv.value ? readPlusInfoBestEffort() : {};
      const rt = isAppEnv.value ? await getRuntimeProperty() : null;

      appInfo.value = {
        环境: base.env || '-',
        平台: base.platform || '-',
        语言: base.lang || '-',
        屏幕: base.screen || '-',
        系统: plusInfo.osName ? `${plusInfo.osName}${plusInfo.osVersion ? ' ' + plusInfo.osVersion : ''}` : '-',
        设备: plusInfo.model || '-',
        厂商: plusInfo.vendor || '-',
        AppID: (rt && (rt.appid || rt.id)) ? safeStr(rt.appid || rt.id) : (isAppEnv.value ? safeStr(plus.runtime && plus.runtime.appid) : '-') || '-',
        版本: rt && (rt.version || rt.versionName) ? safeStr(rt.version || rt.versionName) : '-',
        Build: rt && (rt.versionCode || rt.build) ? safeStr(rt.versionCode || rt.build) : '-',
        PlusStorage条目: plusInfo.storageLen || '-',
        UA: base.ua || '-',
      };
    }

    const appInfoRows = computed(() => {
      const obj = appInfo.value || {};
      return Object.keys(obj).map((k) => ({ k, v: safeStr(obj[k]) || '-' }));
    });

    const appAboutRows = computed(() => {
      const obj = appInfo.value || {};
      const version = safeStr(obj['版本'] || '');
      const build = safeStr(obj['Build'] || '');
      const appid = safeStr(obj['AppID'] || '');
      const buildTime = safeStr(appBuildTime.value || '');

      return [
        { k: 'AppID', v: appid || '-' },
        { k: '版本', v: version || '-' },
        { k: 'Build', v: build || '-' },
        { k: '编译时间', v: buildTime || '-' },
      ];
    });

    function calculatePlusCacheSize() {
      return new Promise((resolve) => {
        try {
          if (!window.plus || !plus.cache || !plus.cache.calculate) return resolve(null);
          plus.cache.calculate((size) => resolve(size));
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function refreshAppCache() {
      cacheBusy.value = true;
      try {
        if (!isAppEnv.value) {
          cacheSizeText.value = '';
          return;
        }
        const size = await calculatePlusCacheSize();
        cacheSizeText.value = size === null ? '不支持' : formatBytes(size);
      } finally {
        cacheBusy.value = false;
      }
    }

    function clearPlusCache() {
      return new Promise((resolve) => {
        try {
          if (!window.plus || !plus.cache || !plus.cache.clear) return resolve(false);
          plus.cache.clear(() => resolve(true));
        } catch (e) {
          resolve(false);
        }
      });
    }

    async function clearAppCache() {
      if (!isAppEnv.value) {
        ElementPlus.ElMessage.info('当前环境不支持清理 App 缓存');
        return;
      }

      try {
        if (ElementPlus && ElementPlus.ElMessageBox && ElementPlus.ElMessageBox.confirm) {
          await ElementPlus.ElMessageBox.confirm(
            '清理 App 缓存后将退出账号并重启 App，需要重新登录。是否继续？',
            '确认清理 App 缓存',
            {
              confirmButtonText: '继续',
              cancelButtonText: '取消',
              type: 'warning',
            }
          );
        } else {
          const ok = window.confirm('清理 App 缓存后将退出账号并重启 App，需要重新登录。是否继续？');
          if (!ok) return;
        }
      } catch (e) {
        // 用户取消
        return;
      }

      cacheBusy.value = true;
      try {
        const ok = await clearPlusCache();
        if (ok) ElementPlus.ElMessage.success('已清理 App 缓存，即将重启 App');
        else ElementPlus.ElMessage.warning('未能清理 App 缓存（可能不支持）');
        await refreshAppCache();
      } finally {
        cacheBusy.value = false;
      }

      try {
        setTimeout(() => logout(), 300);
      } catch (e) {}
    }

    function clearWebStorage() {
      (async () => {
        try {
          if (ElementPlus && ElementPlus.ElMessageBox && ElementPlus.ElMessageBox.confirm) {
            await ElementPlus.ElMessageBox.confirm(
              '清理网页本地存储后将退出账号并重启 App，需要重新登录。是否继续？',
              '确认清理网页本地存储',
              {
                confirmButtonText: '继续',
                cancelButtonText: '取消',
                type: 'warning',
              }
            );
          } else {
            const ok = window.confirm('清理网页本地存储后将退出账号并重启 App，需要重新登录。是否继续？');
            if (!ok) return;
          }
        } catch (e) {
          // 用户取消
          return;
        }

        try { localStorage.clear(); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        ElementPlus.ElMessage.success('已清理网页本地存储，即将重启 App');
        try {
          setTimeout(() => logout(), 300);
        } catch (e) {}
      })();
    }

    async function clearCookies() {
      try {
        if (ElementPlus && ElementPlus.ElMessageBox && ElementPlus.ElMessageBox.confirm) {
          await ElementPlus.ElMessageBox.confirm(
            '清理 Cookie 后将退出账号并重启 App，且丢失登录态，需要重新登录。是否继续？',
            '确认清理 Cookie（会退出账号并重启）',
            {
              confirmButtonText: '继续',
              cancelButtonText: '取消',
              type: 'warning',
            }
          );
        } else {
          const ok = window.confirm('清理 Cookie 后将退出账号并重启 App，且丢失登录态，需要重新登录。是否继续？');
          if (!ok) return;
        }
      } catch (e) {
        // 用户取消
        return;
      }

      try {
        const raw = String(document.cookie || '');
        const names = raw
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => x.split('=')[0].trim())
          .filter(Boolean);
        const uniq = Array.from(new Set(names));
        for (const n of uniq) {
          document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        }
        ElementPlus.ElMessage.success('已尝试清理 Cookie，即将重启 App');
      } catch (e) {
        ElementPlus.ElMessage.warning('清理 Cookie 失败');
        return;
      }

      try {
        setTimeout(() => logout(), 300);
      } catch (e) {}
    }

    function waitForPlusReady(timeoutMs) {
      const t = Number(timeoutMs);
      const timeout = Number.isFinite(t) ? t : 1500;
      if (isAppEnv.value) return Promise.resolve(true);
      return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve(false);
        }, timeout);
        try {
          document.addEventListener(
            'plusready',
            () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              detectAppEnv();
              resolve(true);
            },
            { once: true }
          );
        } catch (e) {
          clearTimeout(timer);
          resolve(false);
        }
      });
    }

    async function openAppDialog() {
      appDialogVisible.value = true;
      appDialogTab.value = 'general';
      refreshAppBuildTimeFromUrl();
      await waitForPlusReady(1500);
      await refreshSystemInfo();
      await refreshAppCache();
    }

    const playtimeHasAny = computed(() => {
      const m = playtimeDaySecondsMap.value;
      return !!m && typeof m === 'object' && Object.keys(m).length > 0;
    });

    function monthTitle(y, m) {
      return `${y}年${String(m).padStart(2, '0')}月`;
    }

    function monthKey(y, m) {
      return `${y}-${String(m).padStart(2, '0')}`;
    }

    function daysInMonth(y, m) {
      return new Date(y, m, 0).getDate();
    }

    function ymdFromParts(y, m, d) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    let _playtimeColorsCache = null;

    function parseCssColorToRgb(color) {
      try {
        const s = String(color || '').trim();
        if (!s) return null;
        if (s.startsWith('#')) {
          const hex = s.slice(1);
          if (hex.length === 3) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            return [r, g, b];
          }
          if (hex.length === 6) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return [r, g, b];
          }
          return null;
        }
        const m = s.match(/rgba?\(([^)]+)\)/i);
        if (m) {
          const parts = m[1]
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
          if (parts.length < 3) return null;
          const r = Math.round(Number(parts[0]));
          const g = Math.round(Number(parts[1]));
          const b = Math.round(Number(parts[2]));
          if (![r, g, b].every((n) => Number.isFinite(n))) return null;
          return [r, g, b];
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function readCssVarRgb(varName) {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
        return parseCssColorToRgb(v);
      } catch (e) {
        return null;
      }
    }

    function getPlaytimeThemeColors() {
      if (_playtimeColorsCache) return _playtimeColorsCache;
      const primary = readCssVarRgb('--el-color-primary');
      const base = readCssVarRgb('--el-fill-color-lighter') || readCssVarRgb('--el-fill-color-light');
      _playtimeColorsCache = { primary, base };
      return _playtimeColorsCache;
    }

    function mixRgb(baseRgb, topRgb, t) {
      const tt = Math.max(0, Math.min(1, Number(t) || 0));
      const r = Math.round(baseRgb[0] + (topRgb[0] - baseRgb[0]) * tt);
      const g = Math.round(baseRgb[1] + (topRgb[1] - baseRgb[1]) * tt);
      const b = Math.round(baseRgb[2] + (topRgb[2] - baseRgb[2]) * tt);
      return `rgb(${r}, ${g}, ${b})`;
    }

    function computeMixPct(seconds, maxSeconds) {
      const s = Number(seconds) || 0;
      const max = Number(maxSeconds) || 0;
      if (s <= 0) return 0;
      if (max <= 0) return 100;
      const r = Math.max(0, Math.min(1, s / max));
      return Math.max(1, Math.round(r * 100));
    }

    const playtimeMonthBlocks = computed(() => {
      const map = playtimeDaySecondsMap.value || {};
      const keys = Object.keys(map).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
      if (!keys.length) return [];
      keys.sort();

      let globalMax = 0;
      for (const k of keys) {
        const s = Number(map[k]) || 0;
        if (s > globalMax) globalMax = s;
      }

      const minDate = new Date(`${keys[0]}T00:00:00`);
      const maxDate = new Date(`${keys[keys.length - 1]}T00:00:00`);
      if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) return [];

      const blocks = [];
      let y = minDate.getFullYear();
      let m = minDate.getMonth() + 1;
      const endY = maxDate.getFullYear();
      const endM = maxDate.getMonth() + 1;

      while (y < endY || (y === endY && m <= endM)) {
        const dim = daysInMonth(y, m);
        const first = new Date(`${ymdFromParts(y, m, 1)}T00:00:00`);
        const offset = first.getDay();

        const cells = [];
        for (let i = 0; i < 42; i += 1) {
          const dayNum = i - offset + 1;
          if (dayNum < 1 || dayNum > dim) {
            cells.push({ key: `${monthKey(y, m)}-pad-${i}`, kind: 'pad', title: '', level: -1 });
            continue;
          }
          const dayKey = ymdFromParts(y, m, dayNum);
          const seconds = Number(map[dayKey]) || 0;
          const mixPct = computeMixPct(seconds, globalMax);
          const durationText = seconds > 0 ? formatDurationSecondsDetailed(seconds) : '';
          const title = seconds > 0 ? `${dayKey} ${durationText}` : `${dayKey} 无记录`;
          cells.push({ key: `${monthKey(y, m)}-${dayKey}`, kind: 'day', dayKey, seconds, title, mixPct, durationText });
        }

        blocks.push({ key: monthKey(y, m), title: monthTitle(y, m), cells });

        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }

      return blocks;
    });

    function playtimeCellStyle(cell) {
      const base = { width: '14px', height: '14px', borderRadius: '3px', boxSizing: 'border-box' };
      if (!cell || cell.kind === 'pad') return Object.assign({}, base, { background: 'transparent' });

      const seconds = Number(cell.seconds) || 0;
      if (seconds <= 0) {
        return Object.assign({}, base, { background: 'var(--el-fill-color-lighter)', border: '1px solid var(--el-border-color-lighter)' });
      }

      const colors = getPlaytimeThemeColors();
      const pct = Math.max(0, Math.min(100, Number(cell.mixPct) || 0));
      const t = pct / 100;
      const bg = colors && colors.primary && colors.base ? mixRgb(colors.base, colors.primary, t) : 'var(--el-color-primary-light-7)';

      return Object.assign({}, base, { background: bg, border: '1px solid var(--el-border-color-lighter)', cursor: 'pointer' });
    }

    function isVanillaWorldKey(v) {
      const s = String(v || '').trim();
      return s === 'world' || s === 'world_nether' || s === 'world_the_end';
    }

    function worldLabelFromKey(k) {
      const key = String(k || '').trim();
      if (key === 'world') return '主世界';
      if (key === 'world_nether') return '下界';
      if (key === 'world_the_end') return '末地';
      return key || '-';
    }

    const filteredHomes = computed(() => {
      try {
        const nameQ = String(homeNameQuery.value || '').trim().toLowerCase();
        const worldQ = String(homeWorldFilter.value || '').trim();
        const list = Array.isArray(homesList.value) ? homesList.value : [];
        return list.filter((h) => {
          const nameOk = !nameQ || String(h.name || '').toLowerCase().includes(nameQ);
          const worldOk = !worldQ || String(h.worldKey || '') === worldQ;
          return nameOk && worldOk;
        });
      } catch (e) {
        return homesList.value || [];
      }
    });

    const selfDisplayName = computed(() => selfUsername.value || selfUserId.value || '未登录');
    const selfIdHint = computed(() => {
      const uuid = (selfMinecraftUuid.value || '').trim();
      return uuid ? uuid : '';
    });
    const selfInitial = computed(() => {
      const name = selfUsername.value || selfUserId.value || '?';
      return name.charAt(0).toUpperCase();
    });

    const selfRegisterHint = computed(() => {
      const v = (selfRegisteredAt.value || '').trim();
      if (!v) return '';
      const dt = parseDate(v);
      if (!dt) return '';
      return formatYmd(dt);
    });

    const selfLastLoginHint = computed(() => {
      const v = (selfLastLoginAt.value || '').trim();
      if (!v) return '';
      const dt = parseDate(v);
      if (!dt) return '';
      return formatYmdHm(dt);
    });

    const selfOnlineDisplay = computed(() => {
      return !!selfOnline.value;
    });

    const profileRows = computed(() => {
      const levelText = selfLevel.value === null || selfLevel.value === undefined || selfLevel.value === '' ? '-' : String(selfLevel.value);
      return [
        { k: '等级', v: levelText },
        { k: '注册时间', v: selfRegisterHint.value || '-' },
        { k: '上次上线', v: selfLastLoginHint.value || '-' },
      ];
    });

    function parseDate(v) {
      try {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') {
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        const s = String(v).trim();
        if (!s) return null;
        const n = Number(s);
        if (!Number.isNaN(n) && n > 0 && s.length >= 10) {
          const d = new Date(n);
          if (!isNaN(d.getTime())) return d;
        }
        const d2 = new Date(s);
        return isNaN(d2.getTime()) ? null : d2;
      } catch (e) {
        return null;
      }
    }

    function formatYmd(d) {
      try {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      } catch (e) {
        return '';
      }
    }

    function formatYmdHm(d) {
      try {
        const ymd = formatYmd(d);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return ymd ? `${ymd} ${hh}:${mm}` : '';
      } catch (e) {
        return '';
      }
    }

    function tokenValue() {
      const t = (token.value || '').trim();
      return t ? t : null;
    }

    function clearBadToken() {
      token.value = null;
      try {
        localStorage.removeItem('token');
      } catch (e) {}
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());
      // 同源反代下始终带上 cookie，兼容仅 cookie/session 鉴权
      opt.credentials = 'include';

      const res = await fetch(url, opt);
      if (res.status === 401) {
        let txt = '';
        try {
          txt = await res.clone().text();
        } catch (e) {}
        if (/invalid token/i.test(txt)) {
          clearBadToken();
        }
      }
      return res;
    }

    function formatTsForHint(ts) {
      try {
        const t = Number(ts);
        if (!Number.isFinite(t) || t <= 0) return '';
        const ms = t > 1e12 ? t : t * 1000;
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        return formatYmdHm(d);
      } catch (e) {
        return '';
      }
    }

    function openPasteDialog() {
      pasteDialogVisible.value = true;
      pasteError.value = '';
      pasteResult.value = '';
      if (isLoggedIn.value) loadPasteExisting(true);
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function loadPasteExisting(fillEditIfEmpty) {
      if (pasteLoading.value) return;
      pasteLoading.value = true;
      pasteError.value = '';
      pasteResult.value = '';
      try {
        const u = String(selfUsername.value || '').trim();
        if (!u) throw new Error('未识别到用户名');

        const res = await safeFetch(`${apiBase.value}/info/playerPaste?username=${encodeURIComponent(u)}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object' || Number(data.return) !== 1 || !data.content) {
          pasteExistingMarkdown.value = '';
          pasteExistingTimeText.value = '';
          if (fillEditIfEmpty && !String(pasteEditMarkdown.value || '').trim()) pasteEditMarkdown.value = '';
          return;
        }

        pasteExistingMarkdown.value = String(data.content || '');
        pasteExistingTimeText.value = formatTsForHint(data.time);
        if (fillEditIfEmpty && !String(pasteEditMarkdown.value || '').trim()) pasteEditMarkdown.value = pasteExistingMarkdown.value;
      } catch (e) {
        pasteError.value = e && e.message ? e.message : String(e);
      } finally {
        pasteLoading.value = false;
      }
    }

    async function savePaste() {
      if (pasteSaving.value) return;
      pasteSaving.value = true;
      pasteError.value = '';
      pasteResult.value = '';
      try {
        const text = String(pasteEditMarkdown.value || '');
        if (!text.trim()) throw new Error('内容不能为空');

        const res = await safeFetch(`${apiBase.value}/info/playerPaste`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const code = data && typeof data === 'object' ? data.error : '';
          const detail = data && typeof data === 'object' ? (data.detail || '') : '';
          if (code === 'TEXT_AUDIT_NOT_CONFIGURED') {
            throw new Error(detail || '文本审核未配置，暂不允许上传');
          }
          if (code === 'TEXT_AUDIT_BLOCKED') {
            throw new Error('文本未通过审核，请修改后重试');
          }
          if (code === 'CONTENT_TOO_LARGE') throw new Error(detail || '内容过长');
          throw new Error((data && typeof data === 'object' && (data.detail || data.error)) ? String(data.detail || data.error) : `HTTP ${res.status}`);
        }

        pasteResult.value = '已提交并通过审核（以服务器返回为准）';
        ElementPlus.ElMessage.success('提交成功');
        await loadPasteExisting(false);
      } catch (e) {
        pasteError.value = e && e.message ? e.message : String(e);
        ElementPlus.ElMessage.error('提交失败');
      } finally {
        pasteSaving.value = false;
      }
    }

    function extractCreatedAt(obj) {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
          obj.createdAt,
          obj.created_at,
          obj.createTime,
          obj.create_time,
          obj.registeredAt,
          obj.registered_at,
          obj.regTime,
          obj.reg_time,
        ];
        for (const c of candidates) {
          if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    async function checkSession() {
      try {
        const res = await fetch(`${apiBase.value}/chats`, { credentials: 'include' });
        sessionOk.value = res.ok;
        return res.ok;
      } catch (e) {
        sessionOk.value = false;
        return false;
      }
    }

    function decodeJwtPayload(jwt) {
      try {
        const parts = String(jwt || '').split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function extractMinecraftUuid(obj) {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
          obj.minecraftUuid,
          obj.minecraft_uuid,
          obj.minecraftUUID,
          obj.mcUuid,
          obj.mc_uuid,
          obj.uuid,
        ];
        for (const c of candidates) {
          if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    async function loadSelf() {
      if (loading.value) return;
      loading.value = true;
      try {
        await checkSession();

        // Prefer /users/me (desktop-compatible)
        let res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me`);
        }
        if (!res.ok) return;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return;

        const id = me.id || me.userId || me.uid;
        selfUserId.value = id !== undefined && id !== null ? String(id) : '';
        selfUsername.value = me.username || me.displayName || me.name || '';
        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(me);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(me);
        if (created) selfRegisteredAt.value = created;

        // If backend doesn't return username, try resolve from token + /users list
        if (!selfUsername.value) {
          const t = tokenValue();
          const payload = t ? decodeJwtPayload(t) : null;
          const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
          if (meId) {
            const listRes = await safeFetch(`${apiBase.value}/users`);
            if (listRes.ok) {
              const list = await listRes.json().catch(() => null);
              if (Array.isArray(list)) {
                const u = list.find(x => x && String(x.id) === String(meId));
                if (u) {
                  selfUsername.value = u.username || u.displayName || selfUsername.value;
                  const f = u.faceUrl || u.face_url || u.face;
                  if (f && !selfFaceUrl.value) selfFaceUrl.value = String(f);

                  const uuid2 = extractMinecraftUuid(u);
                  if (uuid2 && !selfMinecraftUuid.value) selfMinecraftUuid.value = uuid2;

                  const created2 = extractCreatedAt(u);
                  if (created2 && !selfRegisteredAt.value) selfRegisteredAt.value = created2;
                }
              }
            }
          }
        }

        // extra info from /info (best effort)
        try {
          const r1 = await safeFetch(`${apiBase.value}/info/getPlayerData`);
          if (r1.ok) {
            const data = await r1.json().catch(() => null);
            if (data && typeof data === 'object') {
              if (data.level !== undefined && data.level !== null && String(data.level).trim()) {
                const n = Number(data.level);
                selfLevel.value = Number.isNaN(n) ? data.level : n;
              }

              const auth = data.authme;
              if (auth && typeof auth === 'object') {
                if (auth.regdate !== undefined && auth.regdate !== null && String(auth.regdate).trim()) {
                  selfRegisteredAt.value = String(auth.regdate).trim();
                }
                if (auth.lastlogin !== undefined && auth.lastlogin !== null && String(auth.lastlogin).trim()) {
                  selfLastLoginAt.value = String(auth.lastlogin).trim();
                }
                if (auth.isLogged !== undefined && auth.isLogged !== null && String(auth.isLogged).trim()) {
                  const v = String(auth.isLogged).trim();
                  selfOnline.value = v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'online';
                }
              }
            }
          }
        } catch (e) {}

        try {
          if (selfOnline.value === null) {
            const r2 = await safeFetch(`${apiBase.value}/info/getOnlineStatus`);
            if (r2.ok) {
              const data2 = await r2.json().catch(() => null);
              const list = data2 && typeof data2 === 'object' && Array.isArray(data2.list) ? data2.list : null;
              if (list && list.length) {
                const key = String(selfUsername.value || '').trim();
                if (key) {
                  const row = list.find((x) => x && String(x.realname || x.name || x.username || '').trim().toLowerCase() === key.toLowerCase());
                  if (row) {
                    const v = row.isLogged;
                    selfOnline.value = String(v).trim() === '1' || String(v).trim().toLowerCase() === 'true' || String(v).trim().toLowerCase() === 'online';
                  }
                }
              }
            }
          }
        } catch (e) {}
      } catch (e) {}
      finally {
        loading.value = false;
      }
    }

    async function updateFace() {
      lastResult.value = '';
      lastError.value = '';
      updating.value = true;

      try {
        // Desktop-compatible endpoint
        let res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me/update-face`, { method: 'POST' });
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || '更新失败');
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
        }
        lastResult.value = '头像更新成功';
        
        await loadSelf();
        ElementPlus.ElMessage.success('头像更新成功');
      } catch (e) {
        lastError.value = e.message || '更新失败';
        ElementPlus.ElMessage.error(lastError.value);
      } finally {
        updating.value = false;
      }
    }

    function openIdDialog() {
      idDialogVisible.value = true;
      idError.value = '';
      idDocName.value = '';
      idDocNumber.value = '';
      if (isLoggedIn.value) runIdQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runIdQuery() {
      if (idLoading.value) return;
      idLoading.value = true;
      idError.value = '';
      idDocName.value = '';
      idDocNumber.value = '';
      try {
        const res = await safeFetch(`${apiBase.value}/info/getId`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        const name = data && typeof data === 'object' ? (data.realname || data.name || '') : '';
        const id = data && typeof data === 'object' ? (data.id || data.card || data.idcard || '') : '';
        if (name) idDocName.value = String(name);
        if (id) idDocNumber.value = String(id);
      } catch (e) {
        idError.value = e && e.message ? e.message : String(e);
      } finally {
        idLoading.value = false;
      }
    }

    function openHistoryDialog() {
      historyDialogVisible.value = true;
      historyError.value = '';
      historyList.value = [];
      if (isLoggedIn.value) runHistoryQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runHistoryQuery() {
      if (historyLoading.value) return;
      historyLoading.value = true;
      historyError.value = '';
      historyList.value = [];
      try {
        // Backend endpoint: /users/me/login-history
        let res = await safeFetch(`${apiBase.value}/users/me/login-history`);
        if (!res.ok && res.status === 404) {
          res = await safeFetch(`${apiBase.value}/info/getLoginHistory`);
        }

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const data = await res.json().catch(() => null);
        const rawHistory = data && typeof data === 'object' && Array.isArray(data.history) ? data.history : [];
        historyList.value = rawHistory.map((r) => {
          const ip = r && typeof r === 'object' ? (r.ip || r.IP || r.addr || '') : '';
          const t = r && typeof r === 'object' ? (r.time || r.created_at || r.createdAt || '') : '';
          const dt = parseDate(t);
          return {
            time: dt ? formatYmdHm(dt) : (t ? String(t) : '-'),
            ip: ip ? String(ip) : '-',
          };
        });
      } catch (e) {
        historyError.value = e && e.message ? e.message : String(e);
      } finally {
        historyLoading.value = false;
      }
    }

    function normalizeWorldKeyFromHome(homeObj) {
      try {
        if (!homeObj || typeof homeObj !== 'object') return '';
        const wn = homeObj['world-name'] || homeObj.world_name || homeObj.worldName || '';
        if (isVanillaWorldKey(wn)) return String(wn).trim();
        const w = homeObj.world || '';
        if (isVanillaWorldKey(w)) return String(w).trim();
        const s1 = String(wn || '').trim();
        if (s1) return s1;
        return String(w || '').trim();
      } catch (e) {
        return '';
      }
    }

    function parseHomesFromPlayerData(data) {
      try {
        const homesRoot = data && typeof data === 'object' ? data.homes : null;
        const homesObj = homesRoot && typeof homesRoot === 'object' ? homesRoot.homes : null;
        if (!homesObj || typeof homesObj !== 'object') return [];

        const entries = Object.entries(homesObj).filter(([k, v]) => k && v && typeof v === 'object');
        return entries
          .map(([name, h]) => {
            const worldKey = normalizeWorldKeyFromHome(h);
            const x = h.x;
            const y = h.y;
            const z = h.z;

            const xNum = Number(x);
            const yNum = Number(y);
            const zNum = Number(z);
            return {
              name: String(name),
              worldKey: worldKey || '',
              worldLabel: worldLabelFromKey(worldKey),
              x: Number.isFinite(xNum) ? String(Math.round(xNum)) : x === undefined || x === null ? '' : String(x),
              y: Number.isFinite(yNum) ? String(Math.round(yNum)) : y === undefined || y === null ? '' : String(y),
              z: Number.isFinite(zNum) ? String(Math.round(zNum)) : z === undefined || z === null ? '' : String(z),
            };
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      } catch (e) {
        return [];
      }
    }

    function openHomeDialog() {
      homeDialogVisible.value = true;
      homeError.value = '';
      homeNameQuery.value = '';
      homeWorldFilter.value = '';
      homesList.value = [];
      if (isLoggedIn.value) runHomeQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runHomeQuery() {
      if (homeLoading.value) return;
      homeLoading.value = true;
      homeError.value = '';
      homesList.value = [];
      try {
        const res = await safeFetch(`${apiBase.value}/info/getPlayerData`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        homesList.value = parseHomesFromPlayerData(data);
      } catch (e) {
        homeError.value = e && e.message ? e.message : String(e);
      } finally {
        homeLoading.value = false;
      }
    }

    function openPlaytimeDialog() {
      playtimeDialogVisible.value = true;
      playtimeError.value = '';
      playtimeSummaryText.value = '';
      playtimeDaySecondsMap.value = {};
      if (isLoggedIn.value) runPlaytimeQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    function normalizeTsMs(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (n < 10_000_000_000) return n * 1000;
      return n;
    }

    function ymdKeyFromMs(ms) {
      const d = new Date(ms);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }

    function formatDurationSeconds(seconds) {
      const n = Math.max(0, Math.floor(Number(seconds) || 0));
      const totalMin = Math.floor(n / 60);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (h <= 0) return `${m}分`;
      return `${h}小时${m}分`;
    }

    function formatDurationSecondsDetailed(seconds) {
      const n = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = Math.floor(n / 3600);
      const m = Math.floor((n % 3600) / 60);
      const s = n % 60;
      if (h <= 0 && m <= 0) return `${s}秒`;
      if (h <= 0) return `${m}分${s}秒`;
      return `${h}小时${m}分${s}秒`;
    }

    function ymdDashedFromCompact(yyyymmdd) {
      const s = String(yyyymmdd || '').trim();
      if (!/^\d{8}$/.test(s)) return '';
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }

    function playtimeDayText(day) {
      try {
        const key = String(day || '').slice(0, 10);
        const sec = Number(playtimeDaySecondsMap.value && playtimeDaySecondsMap.value[key]);
        if (!Number.isFinite(sec) || sec <= 0) return '';
        return formatDurationSeconds(sec);
      } catch (e) {
        return '';
      }
    }

    function addDurationByDay(map, startMs, endMs) {
      let s = startMs;
      const e = endMs;
      while (s < e) {
        const d = new Date(s);
        const next = new Date(d);
        next.setHours(24, 0, 0, 0);
        const chunkEnd = Math.min(e, next.getTime());
        const key = ymdKeyFromMs(s);
        map[key] = (map[key] || 0) + (chunkEnd - s);
        s = chunkEnd;
      }
    }

    function isJoinEvent(ev) {
      const s = String(ev || '').trim().toLowerCase();
      return s === 'join' || s === 'login' || s === 'enter' || s.includes('join') || s.includes('login');
    }

    function isQuitEvent(ev) {
      const s = String(ev || '').trim().toLowerCase();
      return s === 'quit' || s === 'logout' || s === 'leave' || s.includes('quit') || s.includes('logout');
    }

    async function runPlaytimeQuery() {
      if (playtimeLoading.value) return;
      playtimeLoading.value = true;
      playtimeError.value = '';
      playtimeSummaryText.value = '';
      playtimeDaySecondsMap.value = {};
      try {
        const res = await safeFetch(`${apiBase.value}/activity/getPlayerOnlineRecords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const payload = await res.json().catch(() => null);
        const data = payload && (payload.data || payload.items || payload.list);

        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const map = {};
          let totalSeconds = 0;
          let days = 0;
          for (const [k, v] of Object.entries(data)) {
            const key = ymdDashedFromCompact(k);
            const sec = Number(v);
            if (!key || !Number.isFinite(sec) || sec <= 0) continue;
            map[key] = Math.floor(sec);
            totalSeconds += Math.floor(sec);
            days += 1;
          }
          playtimeDaySecondsMap.value = map;
          playtimeSummaryText.value = days ? `总计 ${formatDurationSeconds(totalSeconds)}，有效天数 ${days}` : '';
          return;
        }

        // Backward-compat: array join/quit records
        const list = Array.isArray(data) ? data : [];
        const rows = list
          .map((r) => {
            const ts = normalizeTsMs(r && (r.timestamp ?? r.time ?? r.ts));
            return { ts, event: r && (r.event_type ?? r.eventType ?? r.event) };
          })
          .filter((r) => r.ts);
        rows.sort((a, b) => a.ts - b.ts);

        const durationByDay = {};
        let lastJoin = null;
        for (const r of rows) {
          if (isJoinEvent(r.event)) {
            lastJoin = r.ts;
            continue;
          }
          if (isQuitEvent(r.event)) {
            if (lastJoin && r.ts > lastJoin) {
              const dur = r.ts - lastJoin;
              if (dur > 0 && dur < 3 * 24 * 60 * 60 * 1000) {
                addDurationByDay(durationByDay, lastJoin, r.ts);
              }
            }
            lastJoin = null;
          }
        }
        const map = {};
        let totalSeconds = 0;
        for (const [k, ms] of Object.entries(durationByDay)) {
          const sec = Math.floor((Number(ms) || 0) / 1000);
          if (sec <= 0) continue;
          map[k] = sec;
          totalSeconds += sec;
        }
        playtimeDaySecondsMap.value = map;
        playtimeSummaryText.value = Object.keys(map).length ? `总计 ${formatDurationSeconds(totalSeconds)}，有效天数 ${Object.keys(map).length}` : '';
      } catch (e) {
        playtimeError.value = e && e.message ? e.message : String(e);
      } finally {
        playtimeLoading.value = false;
      }
    }

    async function logout() {
      try {
        await safeFetch(`${apiBase.value}/auth/logout`, { method: 'POST' });
      } catch (e) {}
      
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('faceUrl');
      } catch (e) {}

      try {
        if (isAppEnv.value && window.plus && plus.runtime && typeof plus.runtime.restart === 'function') {
          plus.runtime.restart();
          return;
        }
      } catch (e) {}

      window.location.href = '/';
    }

    function goEmojiManage() {
      window.location.href = '/m/emojis.html';
    }

    function gotoInfo() {
      window.location.href = '/m/info.html';
    }

    function gotoMaterials() {
      window.location.href = '/m/materials.html';
    }

    function gotoBigMap() {
      window.location.href = '/m/map.html';
    }

    function gotoDisk() {
      window.location.href = '/m/disk.html';
    }

    onMounted(async () => {
      await fetchConfig();
      await loadSelf();
    });

    return {
      isLoggedIn,
      loading,
      themeDark,
      selfDisplayName,
      selfIdHint,
      selfInitial,
      selfFaceUrl,
      selfMinecraftUuid,
      selfLevel,
      selfRegisterHint,
      selfLastLoginHint,
      selfOnline,
      selfOnlineDisplay,
      profileRows,
      updating,
      lastResult,
      lastError,
      updateFace,
      logout,
      goEmojiManage,
      gotoInfo,
      gotoMaterials,
      gotoBigMap,
      gotoDisk,

      // account dialogs
      idDialogVisible,
      idLoading,
      idRows,
      idError,
      openIdDialog,
      runIdQuery,

      historyDialogVisible,
      historyLoading,
      historyList,
      historyError,
      openHistoryDialog,
      runHistoryQuery,

      pasteDialogVisible,
      pasteLoading,
      pasteSaving,
      pasteError,
      pasteResult,
      pasteExistingTimeText,
      pasteEditMarkdown,
      pastePreviewHtml,
      openPasteDialog,
      loadPasteExisting,
      savePaste,

      // game services
      homeDialogVisible,
      homeLoading,
      homeError,
      homeNameQuery,
      homeWorldFilter,
      filteredHomes,
      openHomeDialog,
      runHomeQuery,

      playtimeDialogVisible,
      playtimeLoading,
      playtimeError,
      playtimeSummaryText,
      playtimeHasAny,
      playtimeMonthBlocks,
      playtimeCellStyle,
      openPlaytimeDialog,
      runPlaytimeQuery,

      // app settings
      appDialogVisible,
      appDialogTab,
      isAppEnv,
      cacheSizeText,
      cacheBusy,
      appInfoRows,
      appAboutRows,
      openAppDialog,
      refreshAppCache,
      clearAppCache,
      clearWebStorage,
      clearCookies,
    };
  },
});

try {
  const icons = window.ElementPlusIconsVue;
  if (icons && typeof icons === 'object') {
    for (const [key, component] of Object.entries(icons)) {
      app.component(key, component);
    }
  }
} catch (e) {}

app.use(ElementPlus).mount('#app');
