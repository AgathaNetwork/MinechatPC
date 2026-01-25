// Vue 3 + Element Plus "Me" page
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');

    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

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
    const updating = ref(false);

    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');
    const selfMinecraftUuid = ref('');

    const selfLevel = ref(null);
    const selfRegisteredAt = ref('');
    const selfLastLoginAt = ref('');
    const selfOnline = ref(null);

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
    const playtimeDaySecondsMap = ref({}); // { 'YYYY-MM-DD': seconds }

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
        const offset = first.getDay(); // 0..6 (Sun..Sat)

        const cells = [];
        for (let i = 0; i < 42; i += 1) {
          const dayNum = i - offset + 1;
          if (dayNum < 1 || dayNum > dim) {
            cells.push({
              key: `${monthKey(y, m)}-pad-${i}`,
              kind: 'pad',
              title: '',
              level: -1,
            });
            continue;
          }
          const dayKey = ymdFromParts(y, m, dayNum);
          const seconds = Number(map[dayKey]) || 0;
          const mixPct = computeMixPct(seconds, globalMax);
          const durationText = seconds > 0 ? formatDurationSecondsDetailed(seconds) : '';
          const title = seconds > 0 ? `${dayKey} ${durationText}` : `${dayKey} 无记录`;
          cells.push({
            key: `${monthKey(y, m)}-${dayKey}`,
            kind: 'day',
            dayKey,
            seconds,
            title,
            mixPct,
            durationText,
          });
        }

        blocks.push({
          key: monthKey(y, m),
          title: monthTitle(y, m),
          cells,
        });

        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }

      return blocks;
    });

    function playtimeCellStyle(cell) {
      const base = {
        width: '14px',
        height: '14px',
        borderRadius: '3px',
        boxSizing: 'border-box',
      };
      if (!cell || cell.kind === 'pad') {
        return Object.assign({}, base, { background: 'transparent' });
      }

      const seconds = Number(cell.seconds) || 0;
      if (seconds <= 0) {
        return Object.assign({}, base, {
          background: 'var(--el-fill-color-lighter)',
          border: '1px solid var(--el-border-color-lighter)',
        });
      }

      const colors = getPlaytimeThemeColors();
      const pct = Math.max(0, Math.min(100, Number(cell.mixPct) || 0));
      const t = pct / 100;
      const bg = colors && colors.primary && colors.base ? mixRgb(colors.base, colors.primary, t) : 'var(--el-color-primary-light-7)';

      return Object.assign({}, base, {
        background: bg,
        border: '1px solid var(--el-border-color-lighter)',
        cursor: 'pointer',
      });
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

    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);

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

    const selfDisplayName = computed(() => {
      if (selfUsername.value) return selfUsername.value;
      if (selfUserId.value) return selfUserId.value;
      return '未识别用户';
    });

    const selfInitial = computed(() => {
      const s = selfUsername.value || selfUserId.value || '?';
      return String(s).slice(0, 1).toUpperCase();
    });

    const selfIdHint = computed(() => {
      const uuid = (selfMinecraftUuid.value || '').trim();
      if (!uuid) return '';
      return uuid;
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
      // 按需求：不显示“未知”，未知时当作离线
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

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);

      const res = await fetch(url, opt);
      const canRetry = allowRetry !== false;
      if (canRetry && res.status === 401) {
        let txt = '';
        try {
          txt = await res.clone().text();
        } catch (e) {}
        if (/invalid token/i.test(txt)) {
          clearBadToken();
          const opt2 = Object.assign({}, opt);
          const h2 = Object.assign({}, opt2.headers || {});
          delete h2.Authorization;
          delete h2.authorization;
          opt2.headers = h2;
          return fetch(url, opt2);
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
      // Best-effort load current approved paste, and fill edit if empty.
      if (isLoggedIn.value) loadPasteExisting(true);
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function loadPasteExisting(fillEditIfEmpty) {
      if (pasteLoading.value) return;
      pasteLoading.value = true;
      pasteError.value = '';
      pasteResult.value = '';
      try {
        if (!selfUsername.value) {
          // best-effort
          await tryLoadSelfFromMe();
        }
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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
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

    async function tryLoadSelfFromMe() {
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok) return false;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return false;

        const id = me.id || me.userId || me.uid;
        if (id !== undefined && id !== null) selfUserId.value = String(id);
        selfUsername.value = me.username || me.displayName || selfUsername.value;

        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(me);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(me);
        if (created) selfRegisteredAt.value = created;

        return true;
      } catch (e) {
        return false;
      }
    }

    async function tryLoadSelfFromUsersList() {
      const t = tokenValue();
      if (!t) return false;
      const payload = decodeJwtPayload(t);
      const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
      if (!meId) return false;

      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return false;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return false;
        const u = list.find((x) => x && String(x.id) === String(meId));
        if (!u) return false;

        selfUserId.value = String(u.id);
        selfUsername.value = u.username || u.displayName || selfUsername.value;
        const face = u.faceUrl || u.face_url || u.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(u);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(u);
        if (created) selfRegisteredAt.value = created;
        return true;
      } catch (e) {
        return false;
      }
    }

    async function tryLoadExtraFromInfo() {
      try {
        if (!apiBase.value) return;
        if (!isLoggedIn.value) return;

        // Level / playerName
        const r1 = await safeFetch(`${apiBase.value}/info/getPlayerData`);
        if (r1.ok) {
          const data = await r1.json().catch(() => null);
          if (data && typeof data === 'object') {
            if (data.level !== undefined && data.level !== null && String(data.level).trim()) {
              const n = Number(data.level);
              selfLevel.value = Number.isNaN(n) ? data.level : n;
            }
            const pn = data.playerName || data.username;
            if (pn && !selfUsername.value) selfUsername.value = String(pn);

            // authme: 注册时间/上次上线/在线状态
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
              // 有些库返回 realname
              const rn = auth.realname;
              if (rn && !selfUsername.value) selfUsername.value = String(rn);
            }
          }
        }

        // Online status list (best effort)
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
      } catch (e) {
        // best-effort only
      }
    }

    async function reloadSelf() {
      if (loading.value || updating.value) return;
      loading.value = true;
      lastError.value = '';
      try {
        await checkSession();
        const ok = (await tryLoadSelfFromMe()) || (await tryLoadSelfFromUsersList());
        if (!ok) {
          // best-effort only; keep page usable
        }

        await tryLoadExtraFromInfo();
      } finally {
        loading.value = false;
      }
    }

    async function updateFace() {
      if (updating.value || loading.value) return;
      updating.value = true;
      lastResult.value = '';
      lastError.value = '';
      try {
        const res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
          lastResult.value = '头像更新成功';
        } else {
          lastResult.value = '头像更新成功';
        }
        ElementPlus.ElMessage.success('已触发更新');
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        lastError.value = msg;
        ElementPlus.ElMessage.error('更新失败');
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
          // Backward-compatible fallback (old Minechat /info API)
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
        // If neither matches vanilla keys, prefer world-name (human readable) then fallback to world.
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
      // heuristics: seconds vs milliseconds
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

        // New API: { YYYYMMDD: seconds }
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

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'gallery') window.location.href = '/gallery.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    function gotoLogin() {
      window.location.href = '/';
    }

    function gotoMaterials() {
      window.location.href = '/materials.html';
    }

    function gotoBigMap() {
      window.location.href = '/map.html';
    }

    function gotoTotp() {
      window.location.href = '/totp.html';
    }

    function gotoDisk() {
      window.location.href = '/disk.html';
    }
    
      function gotoInfo() {
        window.location.href = '/info.html';
      }

    async function logout() {
      token.value = null;
      try {
        localStorage.removeItem('token');
      } catch (e) {}
      sessionOk.value = false;
      try {
        const base = apiAuthBase.value || apiBase.value;
        fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch (e) {}
      window.location.href = '/';
    }

    onMounted(async () => {
      await fetchConfig();
      await reloadSelf();
    });

    return {
      // state
      loading,
      updating,
      isLoggedIn,
      themeDark,
      selfUserId,
      selfUsername,
      selfFaceUrl,
      selfMinecraftUuid,
      selfLevel,
      selfRegisteredAt,
      selfRegisterHint,
      selfLastLoginAt,
      selfLastLoginHint,
      selfOnline,
      selfOnlineDisplay,
      profileRows,
      selfDisplayName,
      selfInitial,
      selfIdHint,
      lastResult,
      lastError,

      // account dialogs
      idDialogVisible,
      idLoading,
      idRows,
      idError,
      historyDialogVisible,
      historyLoading,
      historyList,
      historyError,

      pasteDialogVisible,
      pasteLoading,
      pasteSaving,
      pasteError,
      pasteResult,
      pasteExistingTimeText,
      pasteEditMarkdown,
      pastePreviewHtml,

      // game services
      homeDialogVisible,
      homeLoading,
      homeError,
      homeNameQuery,
      homeWorldFilter,
      filteredHomes,

      playtimeDialogVisible,
      playtimeLoading,
      playtimeError,
      playtimeSummaryText,
      playtimeHasAny,
      playtimeMonthBlocks,
      playtimeCellStyle,

      // actions
      onNav,
      gotoLogin,
      gotoMaterials,
      gotoBigMap,
      gotoTotp,
      gotoDisk,
      gotoInfo,
      logout,
      reloadSelf,
      updateFace,

      openIdDialog,
      runIdQuery,
      openHistoryDialog,
      runHistoryQuery,

      openPasteDialog,
      loadPasteExisting,
      savePaste,

      openHomeDialog,
      runHomeQuery,

      openPlaytimeDialog,
      runPlaytimeQuery,
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
