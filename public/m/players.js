// Mobile players page
const { createApp, ref, reactive, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const users = ref([]);
    const q = ref('');
    const selfUserId = ref(null);
    const usersLoading = ref(false);

    const groupMode = ref(false);
    const groupName = ref('');
    const selectedMap = reactive({});
    const createGroupLoading = ref(false);

    const briefDialogVisible = ref(false);
    const briefLoading = ref(false);
    const briefError = ref('');
    const briefRows = ref([]);
    const briefDisplayName = ref('');
    const briefUuid = ref('');
    const briefFaceUrl = ref('');
    const briefInitial = ref('');

    const briefPasteMarkdown = ref('');
    const briefPasteHtml = ref('');
    const briefPasteTimeText = ref('');

    const openDiskUserId = ref(null);
    const userDiskState = reactive({});
    const diskFileDialogVisible = ref(false);
    const diskFileDialogFile = ref(null);

    function fixMojibakeName(input) {
      const s = String(input === undefined || input === null ? '' : input);
      if (!s) return s;
      if (/[\u4e00-\u9fff]/.test(s)) return s;
      if (!/[ÃÂåæçèéêëìíîïñòóôöõùúûüýÿ]/.test(s)) return s;
      try {
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i) & 0xff;
        const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const cjkCount = (t) => (String(t).match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjkCount(fixed) > cjkCount(s)) return fixed;
      } catch (e) {}
      return s;
    }

    function formatBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n < 0) return '-';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = n;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      const digits = i === 0 ? 0 : i === 1 ? 1 : 2;
      return `${v.toFixed(digits)} ${units[i]}`;
    }

    function escapeHtml(s){
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(url){
      const u = String(url || '').trim();
      if(!u) return '';
      if(/^https?:\/\//i.test(u)) return u;
      if(/^mailto:/i.test(u)) return u;
      return '';
    }

    function renderMarkdown(md){
      const input = String(md || '').replace(/\r\n/g,'\n');
      if(!input.trim()) return '';

      const blocks = [];
      const placeholder = (i)=>`@@CODEBLOCK_${i}@@`;
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
        if(!safe) return label;
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });

      text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
      text = text.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

      text = text.replace(/^(?:\s*[-*]\s+.+\n?)+/gm, (block) => {
        const items = block
          .trimEnd()
          .split(/\n/)
          .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
          .filter(Boolean)
          .map(it => `<li>${it}</li>`)
          .join('');
        return items ? `<ul>${items}</ul>` : block;
      });

      const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      text = parts.map(p => {
        if(/^<\/?(h1|h2|h3|ul|pre)/.test(p)) return p;
        return `<p>${p.replace(/\n/g,'<br>')}</p>`;
      }).join('\n');

      text = text.replace(/@@CODEBLOCK_(\d+)@@/g, (m, i) => blocks[Number(i)] || '');
      return text;
    }

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

    const filtered = computed(() => {
      const query = (q.value || '').trim().toLowerCase();
      if (!query) return users.value;
      return users.value.filter(u => {
        const username = (u.username || '').toLowerCase();
        const id = (u.id || '').toLowerCase();
        const mc = (u.mcUuid || '').toLowerCase();
        return username.includes(query) || id.includes(query) || mc.includes(query);
      });
    });

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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = token.value;
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());
      // 只在没有 token 时才使用 credentials（依赖 cookie）
      if (!token.value) {
        opt.credentials = 'include';
      }
      return fetch(url, opt);
    }

    function isUserDiskOpen(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      return !!id && String(openDiskUserId.value || '') === id;
    }

    function ensureUserDiskEntry(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if (!id) return null;
      if (!userDiskState[id]) {
        userDiskState[id] = { loading: false, error: '', files: [] };
      }
      return userDiskState[id];
    }

    function getUserDiskLoading(userId) {
      const e = ensureUserDiskEntry(userId);
      return e ? !!e.loading : false;
    }

    function getUserDiskError(userId) {
      const e = ensureUserDiskEntry(userId);
      return e ? String(e.error || '') : '';
    }

    function getUserDiskFiles(userId) {
      const e = ensureUserDiskEntry(userId);
      return e && Array.isArray(e.files) ? e.files : [];
    }

    async function loadUserDisk(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if (!id) return;
      const entry = ensureUserDiskEntry(id);
      entry.loading = true;
      entry.error = '';
      try {
        if (!apiBase.value) await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/disk/user/${encodeURIComponent(id)}?limit=100`, { method: 'GET' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `请求失败：${res.status}`);
        }
        const data = await res.json().catch(() => null);
        const arr = Array.isArray(data) ? data : [];
        entry.files = arr.map((x) => {
          const d = parseDate(x.created_at);
          return {
            id: x.id,
            name: fixMojibakeName(x.name),
            size: x.size,
            sizeText: formatBytes(x.size),
            createdAtText: d ? formatYmdHm(d) : '',
          };
        });
      } catch (e) {
        entry.error = e?.message || String(e);
        entry.files = [];
      } finally {
        entry.loading = false;
      }
    }

    async function refreshUserDisk(userId) {
      await loadUserDisk(userId);
    }

    async function toggleUserDisk(u) {
      const id = u && u.id !== undefined && u.id !== null ? String(u.id) : '';
      if (!id) return;
      if (String(openDiskUserId.value || '') === id) {
        openDiskUserId.value = null;
        return;
      }
      openDiskUserId.value = id;
      await loadUserDisk(id);
    }

    function openDiskFileDetail(f) {
      diskFileDialogFile.value = f || null;
      diskFileDialogVisible.value = true;
    }

    async function downloadDiskFile(f) {
      const id = f && f.id !== undefined && f.id !== null ? String(f.id) : '';
      if (!id) return;
      try {
        if (!apiBase.value) await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/disk/${encodeURIComponent(id)}/download`, { method: 'GET' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `请求失败：${res.status}`);
        }
        const blob = await res.blob();
        const name = String((f && f.name) || 'file');
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          try { URL.revokeObjectURL(url); } catch (e) {}
        }
      } catch (e) {
        ElementPlus.ElMessage.error(e?.message || String(e));
      }
    }

    async function loadUsers() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const all = await res.json();
        users.value = all.map(u => ({
          ...u,
          faceUrl: u.faceUrl || u.face_url || u.face || u.face_key || '',
          mcUuid: extractMinecraftUuid(u),
        }));
      } catch (e) {}
    }

    async function resolveSelfProfile() {
      try {
        const res = await safeFetch(`${apiBase.value}/me`);
        if (!res.ok) return;
        const me = await res.json();
        selfUserId.value = me.id;
      } catch (e) {}
    }

    function enterGroupMode() {
      groupMode.value = true;
      groupName.value = '';
      for (const k of Object.keys(selectedMap)) delete selectedMap[k];
    }

    function cancelGroupMode() {
      groupMode.value = false;
      groupName.value = '';
      for (const k of Object.keys(selectedMap)) delete selectedMap[k];
    }

    function isSelected(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      return id ? !!selectedMap[id] : false;
    }

    function setSelected(userId, val) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if (!id) return;
      selectedMap[id] = !!val;
    }

    const selectedCount = computed(() => {
      try {
        return Object.values(selectedMap).filter(Boolean).length;
      } catch (e) {
        return 0;
      }
    });

    async function createGroupChat() {
      if (createGroupLoading.value) return;
      const picked = Object.entries(selectedMap)
        .filter(([, v]) => !!v)
        .map(([k]) => String(k));
      const selfId = selfUserId.value ? String(selfUserId.value) : null;
      const members = picked.filter((id) => !selfId || String(id) !== String(selfId));
      if (members.length < 2) {
        ElementPlus.ElMessage.warning('创建群聊需要至少选择 2 位其他玩家');
        return;
      }

      createGroupLoading.value = true;
      try {
        const base = String(apiBase.value || '').replace(/\/$/, '');
        const res = await safeFetch(`${base}/chats/group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupName.value || '').trim() || null, members }),
        });
        if (!res.ok) throw new Error('创建群聊失败');
        const chat = await res.json().catch(() => null);
        const chatId =
          (chat && (chat.id || chat.chatId)) ||
          (chat && chat.chat && (chat.chat.id || chat.chat.chatId)) ||
          null;
        if (!chatId) throw new Error('no chatId');
        window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chatId)}`;
      } catch (e) {
        ElementPlus.ElMessage.error('创建群聊失败');
      } finally {
        createGroupLoading.value = false;
      }
    }

    async function openChat(userId) {
      try {
        // Prefer desktop-compatible endpoint
        let res = await safeFetch(`${apiBase.value}/chats/with/${encodeURIComponent(userId)}`, {
          method: 'POST',
        });

        if (!res.ok && (res.status === 404 || res.status === 405)) {
          // Fallback to older/mobile endpoint if backend differs
          res = await safeFetch(`${apiBase.value}/chats/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ members: [userId] }),
          });
        }

        if (!res.ok) throw new Error('创建会话失败');
        const data = await res.json().catch(() => null);
        const chatId =
          (data && (data.chatId || data.id)) ||
          (data && data.chat && (data.chat.id || data.chat.chatId)) ||
          null;
        if (!chatId) throw new Error('no chatId');
        window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chatId)}`;
      } catch (e) {
        ElementPlus.ElMessage.error('无法创建会话');
      }
    }

    async function openBrief(user) {
      briefDialogVisible.value = true;
      briefLoading.value = true;
      briefError.value = '';
      briefRows.value = [];
      briefPasteMarkdown.value = '';
      briefPasteHtml.value = '';
      briefPasteTimeText.value = '';

      const name = user && (user.username || user.id) ? String(user.username || user.id) : '';
      const uuid = user && (user.mcUuid || user.minecraftUuid || user.uuid) ? String(user.mcUuid || user.minecraftUuid || user.uuid) : '';
      const face = user && (user.faceUrl || user.face_url || user.face) ? String(user.faceUrl || user.face_url || user.face) : '';

      briefDisplayName.value = name || '未知玩家';
      briefUuid.value = uuid || '';
      briefFaceUrl.value = face || '';
      briefInitial.value = (briefDisplayName.value || '?').slice(0, 1).toUpperCase();

      if (!name) {
        briefError.value = '缺少用户名';
        briefLoading.value = false;
        return;
      }

      try {
        const [briefRes, pasteRes] = await Promise.all([
          safeFetch(`${apiBase.value}/info/playerBrief?username=${encodeURIComponent(name)}`),
          safeFetch(`${apiBase.value}/info/playerPaste?username=${encodeURIComponent(name)}`),
        ]);

        if (!briefRes.ok) {
          const txt = await briefRes.text().catch(() => '');
          throw new Error(txt || `HTTP ${briefRes.status}`);
        }

        const data = await briefRes.json().catch(() => null);
        if (!data || typeof data !== 'object' || Number(data.return) !== 1) {
          briefError.value = '未查询到玩家信息';
          return;
        }

        const levelText = data.level === null || data.level === undefined || data.level === '' ? '-' : String(data.level);
        const regDt = parseDate(data.regDate);
        const lastDt = parseDate(data.lastLogin);
        briefRows.value = [
          { k: '等级', v: levelText },
          { k: '注册时间', v: regDt ? formatYmd(regDt) : '-' },
          { k: '上次上线', v: lastDt ? formatYmdHm(lastDt) : '-' },
        ];

        if (pasteRes && pasteRes.ok) {
          const p = await pasteRes.json().catch(() => null);
          if (p && typeof p === 'object' && Number(p.return) === 1 && p.content) {
            briefPasteMarkdown.value = String(p.content);
            briefPasteHtml.value = renderMarkdown(briefPasteMarkdown.value);
            const t = Number(p.time);
            if (Number.isFinite(t)) {
              const ms = t > 1e12 ? t : t * 1000;
              const dt = new Date(ms);
              if (!isNaN(dt.getTime())) briefPasteTimeText.value = `时间：${formatYmdHm(dt)}`;
            }
          }
        }
      } catch (e) {
        briefError.value = e && e.message ? e.message : String(e);
      } finally {
        briefLoading.value = false;
      }
    }

    function onInput() {
      // Auto filter on input change
    }

    onMounted(async () => {
      usersLoading.value = true;
      try {
        await fetchConfig();
        await resolveSelfProfile();
        await loadUsers();
      } finally {
        usersLoading.value = false;
      }
    });

    return {
      users,
      filtered,
      q,
      openChat,
      openBrief,
      onInput,
      usersLoading,

      // brief dialog
      briefDialogVisible,
      briefLoading,
      briefError,
      briefRows,
      briefDisplayName,
      briefUuid,
      briefFaceUrl,
      briefInitial,
      briefPasteMarkdown,
      briefPasteHtml,
      briefPasteTimeText,

      toggleUserDisk,
      isUserDiskOpen,
      getUserDiskLoading,
      getUserDiskError,
      getUserDiskFiles,
      refreshUserDisk,
      openDiskFileDetail,
      downloadDiskFile,
      diskFileDialogVisible,
      diskFileDialogFile,

      // group
      selfUserId,
      groupMode,
      groupName,
      selectedCount,
      createGroupLoading,
      enterGroupMode,
      cancelGroupMode,
      isSelected,
      setSelected,
      createGroupChat,
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
