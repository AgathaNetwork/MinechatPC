// Mobile chat detail page - simplified version
const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const currentChatId = ref(null);
    const currentChatTitle = ref('');
    const currentChatFaceUrl = ref('');
    const currentChatMeta = ref(null);
    const messages = ref([]);
    const msgById = reactive({});
    const userNameCache = reactive({});
    const userFaceCache = reactive({});
    const userMinecraftCache = reactive({});
    const selfUserId = ref(null);

    // --- Read receipts (client-side reporting) ---
    // Every 0.5s, batch-report read message ids for the currently open chat.
    let readReportTimer = null;
    const readQueueByChat = Object.create(null); // chatId -> Set(messageId)
    const readSentByChat = Object.create(null); // chatId -> Set(messageId)

    function ensureIdSet(map, key) {
      try {
        const k = key !== undefined && key !== null ? String(key) : '';
        if (!k) return null;
        if (!map[k]) map[k] = new Set();
        return map[k];
      } catch (e) {
        return null;
      }
    }

    function isSelfChatMeta(chatMeta) {
      try {
        if (!chatMeta || typeof chatMeta !== 'object') return false;
        if (!selfUserId.value) return false;
        const ids = extractMemberIdsFromChat(chatMeta);
        if (!Array.isArray(ids) || ids.length === 0) return false;
        const sid = String(selfUserId.value);
        return ids.map(String).filter(Boolean).every((id) => id === sid);
      } catch (e) {
        return false;
      }
    }

    function apiHttpBase() {
      try {
        return String(apiBase.value || '').trim().replace(/\/$/, '');
      } catch (e) {
        return '';
      }
    }

    function shouldReportReadForCurrentChat() {
      try {
        if (!currentChatId.value) return false;
        if (String(currentChatId.value) === 'global') return false;
        if (!token.value) return false;
        if (!selfUserId.value) return false;
        if (isSelfChatMeta(currentChatMeta.value)) return false;
        return true;
      } catch (e) {
        return false;
      }
    }

    function queueReadForCurrentChat() {
      try {
        if (!shouldReportReadForCurrentChat()) return;
        const chatId = String(currentChatId.value);
        const q = ensureIdSet(readQueueByChat, chatId);
        const sent = ensureIdSet(readSentByChat, chatId);
        if (!q || !sent) return;
        const arr = Array.isArray(messages.value) ? messages.value : [];
        for (const m of arr) {
          if (!m || !m.id) continue;
          const mid = String(m.id);
          if (!mid) continue;
          const fromUser = m.from_user || m.fromUser || m.from;
          if (fromUser && String(fromUser) === String(selfUserId.value)) continue;
          if (sent.has(mid)) continue;
          q.add(mid);
        }
      } catch (e) {}
    }

    async function flushReadReportOnce() {
      try {
        if (!shouldReportReadForCurrentChat()) return;
        const chatId = String(currentChatId.value);
        const q = ensureIdSet(readQueueByChat, chatId);
        const sent = ensureIdSet(readSentByChat, chatId);
        if (!q || !sent) return;

        queueReadForCurrentChat();

        const ids = Array.from(q.values()).filter(Boolean);
        if (ids.length === 0) return;
        const batch = ids.slice(0, 500);

        const url = `${apiHttpBase()}/messages/read/batch`;
        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: batch }),
        });
        if (!res || !res.ok) return;

        for (const id of batch) {
          q.delete(id);
          sent.add(id);
        }
      } catch (e) {}
    }

    function startReadReporter() {
      try {
        if (readReportTimer) return;
        readReportTimer = setInterval(() => {
          try { flushReadReportOnce(); } catch (e) {}
        }, 500);
      } catch (e) {}
    }

    function stopReadReporter() {
      try {
        if (readReportTimer) clearInterval(readReportTimer);
      } catch (e) {}
      readReportTimer = null;
    }

    const fileInputEl = ref(null);
    const inputAreaEl = ref(null);

    const msgInput = ref('');
    const msgInputEl = ref(null);
    const imagePreviewVisible = ref(false);
    const imagePreviewUrl = ref('');
    const imagePreviewScale = ref(1);
    const imagePreviewX = ref(0);
    const imagePreviewY = ref(0);
    const imagePreviewMoved = ref(false);

    const videoPreviewVisible = ref(false);
    const videoPreviewUrl = ref('');

    let imgDragActive = false;
    let imgDragStartX = 0;
    let imgDragStartY = 0;
    let imgDragOriginX = 0;
    let imgDragOriginY = 0;

    let imgPinchActive = false;
    let imgPinchStartDist = 0;
    let imgPinchStartScale = 1;
    let imgPinchStartCenterX = 0;
    let imgPinchStartCenterY = 0;
    let imgPinchOriginX = 0;
    let imgPinchOriginY = 0;
    let imgPinchLastCenterX = 0;
    let imgPinchLastCenterY = 0;

    let imgTapCandidate = false;
    let imgTapStartX = 0;
    let imgTapStartY = 0;

    let maskTapCandidate = false;
    let maskTapStartX = 0;
    let maskTapStartY = 0;
    const messagesEl = ref(null);
    const chatLoading = ref(false);

    // --- Global chat watermark (username + seconds) ---
    let globalWatermarkCtl = null;
    let globalWatermarkThemeKey = '';
    let globalWatermarkCfgKey = '';

    function currentThemeKey() {
      try {
        const root = document.documentElement;
        const t = root && root.dataset ? String(root.dataset.theme || '') : '';
        if (t) return t;
      } catch (e) {}
      try {
        const root = document.documentElement;
        if (root && root.classList && root.classList.contains('dark')) return 'dark';
      } catch (e) {}
      return 'light';
    }

    function watermarkColorForTheme(themeKey) {
      if (String(themeKey || '').toLowerCase() === 'dark') return 'rgba(255, 255, 255, 0.12)';
      return 'rgba(0, 0, 0, 0.08)';
    }

    function clampInt(n, min, max) {
      const v = Math.round(Number(n));
      if (!Number.isFinite(v)) return min;
      return Math.max(min, Math.min(max, v));
    }

    function computeMobileWatermarkTileOptions(themeKey) {
      try {
        const vw = Math.max(1, Number(window.innerWidth || document.documentElement.clientWidth || 360));
        const vh = Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 640));

        // Fixed small font for mobile watermark.
        const fontPx = 8;
        // Sync gap with smaller font to keep density reasonable.
        const gapX = clampInt(vw * 0.70, 180, 320) / 2;
        const gapY = clampInt(vh * 0.28, 110, 220) / 2;

        return {
          color: watermarkColorForTheme(themeKey),
          font: `${fontPx}px sans-serif`,
          rotateDeg: -22,
          gapX,
          gapY,
        };
      } catch (e) {
        return {
          color: watermarkColorForTheme(themeKey),
          font: '8px sans-serif',
          rotateDeg: -22,
          gapX: 140,
          gapY: 80,
        };
      }
    }

    function watermarkUserLabel() {
      try {
        const u = String(localStorage.getItem('username') || '').trim();
        if (u) return u;
      } catch (e) {}
      try {
        const id = selfUserId.value !== null && selfUserId.value !== undefined ? String(selfUserId.value) : '';
        if (id) return id;
      } catch (e) {}
      return 'Minechat';
    }

    function syncGlobalWatermarkEnabled() {
      try {
        const el = messagesEl.value;
        const wm = window.MinechatWatermark;
        if (!el || !wm || typeof wm.create !== 'function') return;

        const themeKey = currentThemeKey();
        const tileOptions = computeMobileWatermarkTileOptions(themeKey);
        const cfgKey = `${themeKey}:${tileOptions.font}:${tileOptions.gapX}:${tileOptions.gapY}`;

        if (globalWatermarkCtl && (themeKey !== globalWatermarkThemeKey || cfgKey !== globalWatermarkCfgKey)) {
          try { globalWatermarkCtl.destroy(); } catch (e0) {}
          globalWatermarkCtl = null;
        }

        if (!globalWatermarkCtl) {
          globalWatermarkThemeKey = themeKey;
          globalWatermarkCfgKey = cfgKey;
          globalWatermarkCtl = wm.create({
            targetEl: el,
            enabled: false,
            getText: () => `${watermarkUserLabel()} ${wm.formatNowSeconds()}`,
            tileOptions,
          });
        }

        globalWatermarkCtl.setEnabled(isGlobalChat.value);
      } catch (e) {}
    }

    // --- Chat content cache (App: sqlite via plus.sqlite; fallback: localStorage) ---
    // Goal: instant render from cache, then reconcile with server (authoritative) results.
    const CHAT_CACHE_VERSION = 1;
    const CHAT_CACHE_MAX_MESSAGES = 200;
    const CHAT_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

    const cacheHydratedChatId = ref(null);
    let cacheSaveTimer = null;
    let cacheSavePending = false;

    function cacheTokenScope() {
      try {
        const t = token.value || localStorage.getItem('token') || '';
        const s = String(t || '');
        return s ? s.slice(0, 16) : 'anon';
      } catch (e) {
        return 'anon';
      }
    }

    function chatCacheKey(chatId) {
      try {
        const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
        if (!cid) return '';
        return `mc:chat_detail_cache:v${CHAT_CACHE_VERSION}:${cacheTokenScope()}:${cid}`;
      } catch (e) {
        return '';
      }
    }

    function getMcCache() {
      try {
        return window.McCache && typeof window.McCache.getJson === 'function' ? window.McCache : null;
      } catch (e) {
        return null;
      }
    }

    function stripForCacheMessage(m) {
      try {
        if (!m || typeof m !== 'object') return null;
        const id = m.id !== undefined && m.id !== null ? String(m.id) : '';
        if (!id) return null;

        // Keep only JSON-safe fields used by UI & reconciliation.
        const out = {
          id,
          type: m.type || 'text',
          content: m.content,
          from_user: m.from_user ?? m.fromUser ?? m.from,
          created_at: m.created_at ?? m.createdAt,
          replied_to: m.replied_to ?? m.repliedTo,
          read: m.read,
          readCount: m.readCount,
          meta: m.meta,
          __status: m.__status,
        };
        return out;
      } catch (e) {
        return null;
      }
    }

    function trimMessagesForCache(list) {
      try {
        const arr = Array.isArray(list) ? list : [];
        if (arr.length <= CHAT_CACHE_MAX_MESSAGES) return arr;
        return arr.slice(-CHAT_CACHE_MAX_MESSAGES);
      } catch (e) {
        return [];
      }
    }

    async function saveChatCacheNow(chatId) {
      try {
        const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
        if (!cid) return;

        const key = chatCacheKey(cid);
        if (!key) return;

        const rawMsgs = Array.isArray(messages.value) ? messages.value : [];
        const trimmed = trimMessagesForCache(rawMsgs);
        const cachedMsgs = trimmed
          .map(stripForCacheMessage)
          .filter(Boolean);

        // Snapshot minimal user profile cache for fast avatar/name rendering.
        const userIds = new Set();
        try {
          if (selfUserId.value) userIds.add(String(selfUserId.value));
          const meta = currentChatMeta.value;
          const members = meta && (meta.members || meta.memberIds || meta.member_ids);
          if (Array.isArray(members)) {
            for (const m of members) {
              const id = m !== undefined && m !== null ? String(m) : '';
              if (id) userIds.add(id);
            }
          }
        } catch (e) {}

        try {
          for (const m of cachedMsgs) {
            const from = m && (m.from_user ?? m.fromUser ?? m.from);
            if (from !== undefined && from !== null && String(from)) userIds.add(String(from));
          }
        } catch (e) {}

        const users = {};
        try {
          const arr = Array.from(userIds.values()).filter(Boolean).slice(0, 120);
          for (const id of arr) {
            const name = userNameCache[id];
            const face = userFaceCache[id];
            const mc = userMinecraftCache[id];
            if (name || face || mc) {
              users[id] = {
                name: name || '',
                faceUrl: face || '',
                minecraft: mc || '',
              };
            }
          }
        } catch (e) {}

        const payload = {
          v: CHAT_CACHE_VERSION,
          t: Date.now(),
          chatId: cid,
          title: currentChatTitle.value || '',
          faceUrl: currentChatFaceUrl.value || '',
          meta: currentChatMeta.value && typeof currentChatMeta.value === 'object' ? currentChatMeta.value : null,
          messages: cachedMsgs,
          users,
          selfUserId: selfUserId.value ? String(selfUserId.value) : null,
        };

        const mc = getMcCache();
        if (mc && typeof mc.setJson === 'function') {
          try { await mc.setJson(key, payload, payload.t); } catch (e0) {}
          try { await mc.prunePrefix(`mc:chat_detail_cache:v${CHAT_CACHE_VERSION}:`, 60); } catch (e1) {}
        } else {
          // Fallback (web): localStorage
          try { localStorage.setItem(key, JSON.stringify(payload)); } catch (e2) {}
        }
      } catch (e) {}
    }

    function scheduleChatCacheSave(chatId) {
      try {
        const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
        if (!cid) return;
        cacheSavePending = true;
        if (cacheSaveTimer) return;
        cacheSaveTimer = setTimeout(() => {
          cacheSaveTimer = null;
          if (!cacheSavePending) return;
          cacheSavePending = false;
          try { saveChatCacheNow(cid); } catch (e0) {}
        }, 650);
      } catch (e) {}
    }

    async function loadChatCache(chatId) {
      try {
        const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
        if (!cid) return null;
        const key = chatCacheKey(cid);
        if (!key) return null;
        const mc = getMcCache();
        let data = null;
        if (mc && typeof mc.getJson === 'function') {
          data = await mc.getJson(key);
        } else {
          try { data = JSON.parse(localStorage.getItem(key) || ''); } catch (e0) { data = null; }
        }
        if (!data || typeof data !== 'object') return null;
        if (Number(data.v) !== CHAT_CACHE_VERSION) return null;
        const ts = Number(data.t) || 0;
        if (!ts || Date.now() - ts > CHAT_CACHE_TTL_MS) return null;
        if (String(data.chatId || '') !== cid) return null;
        if (!Array.isArray(data.messages)) return null;
        return data;
      } catch (e) {
        return null;
      }
    }

    async function hydrateChatFromCache(chatId) {
      try {
        const cached = await loadChatCache(chatId);
        if (!cached) return false;

        // Restore selfUserId ASAP to avoid cached messages rendering on the wrong side.
        try {
          if (!selfUserId.value) {
            const sid =
              (cached.selfUserId !== undefined && cached.selfUserId !== null && String(cached.selfUserId)
                ? String(cached.selfUserId)
                : null) || tryExtractSelfUserIdFromToken();
            if (sid) selfUserId.value = String(sid);
          }
        } catch (e0) {}

        const cid = String(chatId);
        currentChatId.value = cid;
        currentChatTitle.value = String(cached.title || currentChatTitle.value || '');
        currentChatFaceUrl.value = String(cached.faceUrl || currentChatFaceUrl.value || '');
        currentChatMeta.value = cached.meta && typeof cached.meta === 'object' ? cached.meta : currentChatMeta.value;

        // Restore cached user name/face map for instant avatar rendering.
        try {
          const u = cached.users && typeof cached.users === 'object' ? cached.users : null;
          if (u) {
            for (const [id, info] of Object.entries(u)) {
              if (!id) continue;
              const obj = info && typeof info === 'object' ? info : null;
              if (!obj) continue;
              if (obj.name && !userNameCache[id]) userNameCache[id] = String(obj.name);
              if (obj.faceUrl && !userFaceCache[id]) userFaceCache[id] = String(obj.faceUrl);
              if (obj.minecraft && !userMinecraftCache[id]) userMinecraftCache[id] = String(obj.minecraft);
            }
          }
        } catch (e) {}

        const isGlobal = cid === 'global';
        const list = (Array.isArray(cached.messages) ? cached.messages : [])
          .filter((m) => m && m.id && !isAuditRecalledMessage(m))
          .map((m) => {
            const mm = normalizeMessage(m, isGlobal);
            try {
              if (mm && selfUserId.value) {
                const from = mm.from_user || mm.fromUser || mm.from || mm.author;
                if (from !== undefined && from !== null && String(from) === String(selfUserId.value)) mm.__own = true;
              }
            } catch (e1) {}
            return mm;
          });

        // Rebuild msgById for reply/scroll lookup.
        messages.value = [];
        for (const k of Object.keys(msgById)) delete msgById[k];
        for (const m of list) {
          if (!m || !m.id) continue;
          msgById[String(m.id)] = m;
        }
        messages.value = list;

        cacheHydratedChatId.value = cid;
        chatLoading.value = false;
        return true;
      } catch (e) {
        return false;
      }
    }

    // Group management
    const groupManageVisible = ref(false);
    const groupManageLoading = ref(false);
    const groupActionLoading = ref(false);
    const groupOwnerId = ref(null);
    const groupAdmins = ref([]);
    const groupEditName = ref('');
    const inviteSelected = ref([]);
    const adminSelected = ref([]);
    const transferOwnerId = ref('');
    const allUsersList = ref([]);

    const groupAvatarInputEl = ref(null);

    const loadingMore = ref(false);
    const noMoreBefore = ref(false);
    const PAGE_LIMIT = 20;
    const INITIAL_LIMIT = 50;
    const isGlobalChat = computed(() => currentChatId.value === 'global');

    const isSelfChat = computed(() => {
      try {
        if (isGlobalChat.value) return false;
        return isSelfChatMeta(currentChatMeta.value);
      } catch (e) {
        return false;
      }
    });

    const isGroupChat = computed(() => {
      try {
        if (!currentChatMeta.value || typeof currentChatMeta.value !== 'object') return false;
        return String(currentChatMeta.value.type || '').toLowerCase() === 'group';
      } catch (e) {
        return false;
      }
    });

    const isDirectChat = computed(() => {
      try {
        if (isGlobalChat.value) return false;
        if (isGroupChat.value) return false;
        if (isSelfChat.value) return false;

        const t = String((currentChatMeta.value && currentChatMeta.value.type) || '').toLowerCase();
        if (t === 'single' || t === 'direct' || t === 'dm' || t === 'private') return true;

        const ids = extractMemberIdsFromChat(currentChatMeta.value);
        return Array.isArray(ids) && ids.length === 2;
      } catch (e) {
        return false;
      }
    });

    function readBoolFor(m) {
      try {
        if (!m || typeof m !== 'object') return null;
        const raw =
          m.read ??
          m.isRead ??
          m.is_read ??
          m.read_status ??
          (m.meta ? m.meta.read : undefined) ??
          (m.meta ? m.meta.isRead : undefined);

        if (raw === undefined || raw === null || raw === '') return null;
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'number') return raw > 0;
        const s = String(raw).toLowerCase().trim();
        if (s === '1' || s === 'true' || s === 'read' || s === '已读') return true;
        if (s === '0' || s === 'false' || s === 'unread' || s === '未读') return false;
        return null;
      } catch (e) {
        return null;
      }
    }

    function showReadStatus(m) {
      try {
        if (isGlobalChat.value) return false;
        if (isSelfChat.value) return false;
        if (!isDirectChat.value) return false;
        if (!isOwnMessage(m)) return false;
        if (!m || typeof m !== 'object') return false;
        if (isRecalledMessage(m)) return false;

        const raw =
          m.read ??
          m.isRead ??
          m.is_read ??
          m.read_status ??
          (m.meta ? m.meta.read : undefined) ??
          (m.meta ? m.meta.isRead : undefined);
        return !(raw === undefined || raw === null || raw === '');
      } catch (e) {
        return false;
      }
    }

    function readStatusTextFor(m) {
      const b = readBoolFor(m);
      if (b === null) return '';
      return b ? '已读' : '未读';
    }

    async function openReadersDialog(m) {
      try {
        if (!m || typeof m !== 'object') return;
        if (isGlobalChat.value) return;
        if (isSelfChat.value) return;
        if (!isOwnMessage(m)) return;
        if (!m.id) return;
        if (m.__status === 'sending') {
          try { ElementPlus.ElMessage.warning('消息发送中，暂无详情'); } catch (e0) {}
          return;
        }
        const mid = String(m.id);
        if (!mid || mid.startsWith('local-') || mid.startsWith('temp_')) {
          try { ElementPlus.ElMessage.warning('消息尚未确认，暂无详情'); } catch (e1) {}
          return;
        }

        readersDialogVisible.value = true;
        readersLoading.value = true;
        readersMessageId.value = mid;
        readersList.value = [];

        const res = await safeFetch(`${apiBase.value}/messages/${encodeURIComponent(mid)}/readers`);
        if (!res || !res.ok) {
          if (res && res.status === 403) {
            try { ElementPlus.ElMessage.error('仅发送者可查看已读详情'); } catch (e2) {}
          }
          readersLoading.value = false;
          return;
        }
        const data = await res.json().catch(() => null);
        const ids = (data && (data.readerIds || data.readers || data.userIds)) || [];
        const readerIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];

        try {
          await fetchMissingUserNames(new Set(readerIds));
        } catch (e3) {}

        readersList.value = readerIds.map((id) => {
          const name = userLabel(id) || '未知玩家';
          const faceUrl = getCachedFaceUrl(id);
          return { id, name, faceUrl };
        });
      } catch (e) {
        console.error(e);
      } finally {
        try { readersLoading.value = false; } catch (e4) {}
      }
    }

    function closeReadersDialog() {
      readersDialogVisible.value = false;
    }

    function readCountFor(m) {
      try {
        if (!m || typeof m !== 'object') return 0;
        const raw = m.readCount ?? m.read_count ?? (m.meta ? m.meta.readCount : undefined);
        const n = Number(raw);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
      } catch (e) {
        return 0;
      }
    }

    function showReadCount(m) {
      try {
        if (isGlobalChat.value) return false;
        if (isSelfChat.value) return false;
        if (!isGroupChat.value) return false;
        if (!isOwnMessage(m)) return false;
        if (!m || typeof m !== 'object') return false;
        if (isRecalledMessage(m)) return false;

        const raw = m.readCount ?? m.read_count ?? (m.meta ? m.meta.readCount : undefined);
        if (raw === undefined || raw === null || raw === '') return false;
        return true;
      } catch (e) {
        return false;
      }
    }

    const groupIsOwner = computed(() => {
      if (!selfUserId.value || !groupOwnerId.value) return false;
      return String(selfUserId.value) === String(groupOwnerId.value);
    });

    const groupIsAdmin = computed(() => {
      if (!selfUserId.value) return false;
      const sid = String(selfUserId.value);
      return (groupAdmins.value || []).map(String).includes(sid);
    });

    const canMentionAll = computed(() => {
      return !!(groupIsOwner.value || groupIsAdmin.value);
    });

    const groupCanManage = computed(() => {
      return !!(groupIsOwner.value || groupIsAdmin.value);
    });

    const groupMembers = computed(() => {
      try {
        const m = currentChatMeta.value && (currentChatMeta.value.members || currentChatMeta.value.memberIds);
        const arr = Array.isArray(m) ? m.map(String) : [];
        const owner = groupOwnerId.value ? String(groupOwnerId.value) : null;
        if (owner && arr.includes(owner)) return [owner].concat(arr.filter((x) => x !== owner));
        return arr;
      } catch (e) {
        return [];
      }
    });

    function userLabel(userId) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return '';
        return userNameCache[id] || '未知玩家';
      } catch (e) {
        return '未知玩家';
      }
    }

    function userMinecraftId(userId) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return '';
        return userMinecraftCache[id] ? String(userMinecraftCache[id]) : '';
      } catch (e) {
        return '';
      }
    }
    function normalizeMemberId(raw) {
      try {
        if (raw === undefined || raw === null) return '';
        if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
        if (typeof raw === 'object') {
          const direct = raw.id ?? raw.userId ?? raw.user_id ?? raw.uid ?? raw._id;
          if (direct !== undefined && direct !== null) return String(direct);
          const u = raw.user ?? raw.member ?? raw.profile;
          if (u !== undefined && u !== null) {
            if (typeof u === 'string' || typeof u === 'number') return String(u);
            if (typeof u === 'object') {
              const nested = u.id ?? u.userId ?? u.user_id ?? u.uid ?? u._id;
              if (nested !== undefined && nested !== null) return String(nested);
            }
          }
          return '';
        }
        return String(raw);
      } catch (e) {
        return '';
      }
    }

    function normalizeMembersArray(members) {
      try {
        if (!Array.isArray(members)) return [];
        return members.map(normalizeMemberId).filter((x) => !!x);
      } catch (e) {
        return [];
      }
    }

    function extractMemberIdsFromChat(chatLike) {
      try {
        if (!chatLike || typeof chatLike !== 'object') return [];
        const raw = chatLike.members ?? chatLike.memberIds ?? chatLike.member_ids;
        if (!Array.isArray(raw)) return [];
        return normalizeMembersArray(raw);
      } catch (e) {
        return [];
      }
    }

    async function ensureGroupMembersLoaded() {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return;
        if (!currentChatId.value || currentChatId.value === 'global') return;
        const existing = groupMembers.value || [];
        if (Array.isArray(existing) && existing.length >= 2) return;

        const cid = String(currentChatId.value);
        try {
          await Promise.allSettled([refreshGroupInfo(cid), loadGroupAdmins(cid)]);
        } catch (e0) {}

        try {
          const ids = (groupMembers.value || []).map(String).filter(Boolean);
          if (ids.length > 0) await fetchMissingUserNames(new Set(ids));
        } catch (e3) {}
      } catch (e) {}
    }

    const inviteOptions = computed(() => {
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: u.username || u.displayName || u.name || userNameCache[String(u.id)] || '未知玩家',
        }))
        .filter((u) => !members.has(String(u.id)));
    });

    const adminOptions = computed(() => {
      const owner = groupOwnerId.value ? String(groupOwnerId.value) : '';
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: u.username || u.displayName || u.name || userNameCache[String(u.id)] || '未知玩家',
        }))
        .filter((u) => members.has(String(u.id)) && String(u.id) !== owner);
    });

    const transferOptions = computed(() => {
      const owner = groupOwnerId.value ? String(groupOwnerId.value) : '';
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: u.username || u.displayName || u.name || userNameCache[String(u.id)] || '未知玩家',
        }))
        .filter((u) => members.has(String(u.id)) && String(u.id) !== owner);
    });
    const socket = ref(null);
    const joinedChatId = ref(null);
    const replyTarget = ref(null);

    // Read details dialog (reader list)
    const readersDialogVisible = ref(false);
    const readersLoading = ref(false);
    const readersMessageId = ref('');
    const readersList = ref([]); // [{ id, name, faceUrl }]

    const emojiPanelVisible = ref(false);
    const emojiPacks = ref([]);
    const morePanelVisible = ref(false);

    const playerCardDialogVisible = ref(false);
    const playerCardUsersLoading = ref(false);
    const playerCardSending = ref(false);
    const playerCardSelectedUserId = ref('');
    const playerCardQuery = ref('');

    const coordinateDialogVisible = ref(false);
    const coordinateSending = ref(false);
    const coordinateForm = reactive({
      name: '',
      dimension: 'world',
      x: '',
      y: '',
      z: '',
      description: '',
    });

    // Coordinate import from Home
    const coordinateHomeLoading = ref(false);
    const coordinateHomeSelected = ref('');
    const coordinateHomes = ref([]); // [{ name, worldKey, worldLabel, x, y, z }]

    const longPressTimer = ref(null);
    const longPressTarget = ref(null);
    const ctxMenuVisible = ref(false);
    const ctxMenuX = ref(0);
    const ctxMenuY = ref(0);
    const ctxMenuMsg = ref(null);

    // Forward
    const forwardDialogVisible = ref(false);
    const forwardSending = ref(false);
    const forwardTargetChatId = ref('');
    const forwardSourceMsg = ref(null);
    const forwardChats = ref([]); // chat list for selecting forward target

    const forwardTargets = computed(() => {
      const list = Array.isArray(forwardChats.value) ? forwardChats.value : [];
      return list.filter((c) => c && String(c.id || '') && String(c.id) !== 'global');
    });

    const mentionDialogVisible = ref(false);
    const mentionSelectAll = ref(false);
    const mentionSelectIds = ref([]); // [userId]
    const mentionQuery = ref('');
    const pendingMentions = ref([]); // [{ userId, label }]
    const pendingMentionAll = ref(false);
    const mentionDialogSuppressOnce = ref(false);
    const mentionTriggerIndex = ref(null);

    function setMentionSelected(userId, selected) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return;
        const current = Array.isArray(mentionSelectIds.value) ? mentionSelectIds.value.map(String) : [];
        const next = new Set(current.filter(Boolean));
        if (selected) next.add(id);
        else next.delete(id);
        mentionSelectIds.value = Array.from(next);
      } catch (e) {}
    }

    function toggleMentionSelected(userId) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return;
        const current = Array.isArray(mentionSelectIds.value) ? mentionSelectIds.value.map(String) : [];
        setMentionSelected(id, !current.includes(id));
      } catch (e) {}
    }

    // Rich-input (contenteditable) mention marker/chips
    let mentionMarkerEl = null;

    function isRichInputActive() {
      try {
        const el = msgInputEl.value;
        return !!(el && el.nodeType === 1 && el.isContentEditable);
      } catch (e) {
        return false;
      }
    }

    function getRichInputEl() {
      try {
        if (!isRichInputActive()) return null;
        return msgInputEl.value;
      } catch (e) {
        return null;
      }
    }

    function focusRichInput() {
      nextTick(() => {
        try {
          const el = getRichInputEl();
          if (el && typeof el.focus === 'function') el.focus();
        } catch (e) {}
      });
    }

    function setCaretAfterNode(node) {
      try {
        const root = getRichInputEl();
        if (!root) return;
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel) return;
        const r = document.createRange();
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {}
    }

    function setCaretInTextNodeEnd(textNode) {
      try {
        const root = getRichInputEl();
        if (!root) return;
        if (!textNode || textNode.nodeType !== 3) return;
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel) return;
        const r = document.createRange();
        const len = textNode.textContent ? textNode.textContent.length : 0;
        r.setStart(textNode, len);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {}
    }

    function getSelectionRangeInRoot(root) {
      try {
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0) return null;
        const r = sel.getRangeAt(0);
        if (!r) return null;
        if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
        return r;
      } catch (e) {
        return null;
      }
    }

    function isMentionChipNode(n) {
      try {
        return !!(n && n.nodeType === 1 && n.classList && n.classList.contains('mc-mention-chip'));
      } catch (e) {
        return false;
      }
    }

    function ensureLeadingCaretAnchor() {
      try {
        const root = getRichInputEl();
        if (!root) return;
        const first = root.firstChild;
        if (!first) return;
        if (!isMentionChipNode(first) && !(first.nodeType === 1 && first.classList && first.classList.contains('mc-mention-marker'))) return;
        if (first.previousSibling) return;
        if (first.nodeType === 3) return;
        root.insertBefore(document.createTextNode('\u200B'), first);
      } catch (e) {}
    }

    function createMentionChipEl(opts) {
      const { userId, label, isAll } = opts || {};
      const span = document.createElement('span');
      span.className = 'mc-mention-chip';
      span.setAttribute('contenteditable', 'false');
      if (isAll) span.dataset.mentionAll = '1';
      if (userId !== undefined && userId !== null) span.dataset.userId = String(userId);
      if (label !== undefined && label !== null) span.dataset.label = String(label);
      span.textContent = isAll ? '@全体' : `@${String(label || '')}`;
      return span;
    }

    function ensureMentionMarkerAtCaret() {
      try {
        const root = getRichInputEl();
        if (!root) return null;
        if (mentionMarkerEl && !root.contains(mentionMarkerEl)) mentionMarkerEl = null;
        if (mentionMarkerEl) return mentionMarkerEl;

        const marker = document.createElement('span');
        marker.className = 'mc-mention-marker';
        marker.dataset.mentionMarker = '1';
        marker.textContent = '\u200B';
        marker.setAttribute('contenteditable', 'false');

        const r = getSelectionRangeInRoot(root);
        if (r) {
          r.deleteContents();
          r.insertNode(marker);
        } else {
          root.appendChild(marker);
        }

        mentionMarkerEl = marker;
        setCaretAfterNode(marker);
        return marker;
      } catch (e) {
        return null;
      }
    }

    function replaceMentionMarkerWithText(text) {
      try {
        const root = getRichInputEl();
        if (!root) return;
        if (!mentionMarkerEl || !root.contains(mentionMarkerEl)) {
          mentionMarkerEl = null;
          return;
        }
        const t = document.createTextNode(String(text || ''));
        mentionMarkerEl.parentNode.insertBefore(t, mentionMarkerEl);
        mentionMarkerEl.remove();
        mentionMarkerEl = null;
        setCaretAfterNode(t);
      } catch (e) {
        mentionMarkerEl = null;
      }
    }

    function replaceMentionMarkerWithChips(parts) {
      try {
        const root = getRichInputEl();
        if (!root) return;
        if (!mentionMarkerEl || !root.contains(mentionMarkerEl)) {
          mentionMarkerEl = null;
          return;
        }

        const frag = document.createDocumentFragment();
        let lastSpace = null;
        for (const p of parts || []) {
          if (!p) continue;
          const chip = createMentionChipEl(p);
          const space = document.createTextNode('\u00A0');
          frag.appendChild(chip);
          frag.appendChild(space);
          lastSpace = space;
        }

        mentionMarkerEl.parentNode.insertBefore(frag, mentionMarkerEl);
        mentionMarkerEl.remove();
        mentionMarkerEl = null;

        ensureLeadingCaretAnchor();

        if (lastSpace) setCaretInTextNodeEnd(lastSpace);
      } catch (e) {
        mentionMarkerEl = null;
      }
    }

    function syncStateFromRichInput() {
      try {
        const root = getRichInputEl();
        if (!root) return;
        ensureLeadingCaretAnchor();
        msgInput.value = String(root.innerText || '').replace(/\u200B/g, '');

        const chips = Array.from(root.querySelectorAll('.mc-mention-chip'));
        let mentionAll = false;
        const mentions = [];
        for (const el of chips) {
          if (!el || !el.dataset) continue;
          if (el.dataset.mentionAll === '1') {
            mentionAll = true;
            continue;
          }
          const id = el.dataset.userId ? String(el.dataset.userId) : '';
          const label = el.dataset.label ? String(el.dataset.label) : '';
          if (!id) continue;
          mentions.push({ userId: id, label: label || userLabel(id) || '未知玩家' });
        }
        const uniq = [];
        const seen = new Set();
        for (const m of mentions) {
          const k = String(m.userId);
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(m);
        }
        pendingMentionAll.value = mentionAll;
        pendingMentions.value = uniq;
      } catch (e) {}
    }

    function clearRichInputDom() {
      try {
        const root = getRichInputEl();
        if (!root) return;
        root.innerHTML = '';
        mentionMarkerEl = null;
      } catch (e) {}
    }

    function deleteAdjacentMentionChip(isBackspace) {
      try {
        const root = getRichInputEl();
        if (!root) return false;
        const r = getSelectionRangeInRoot(root);
        if (!r || !r.collapsed) return false;

        let container = r.startContainer;
        let offset = r.startOffset;
        if (container && container.nodeType === 3) {
          const len = container.textContent ? container.textContent.length : 0;
          if (isBackspace && offset > 0) return false;
          if (!isBackspace && offset < len) return false;
        }

        function prevNode(n) {
          if (!n) return null;
          if (n.previousSibling) return n.previousSibling;
          if (n.parentNode && n.parentNode !== root) return prevNode(n.parentNode);
          return null;
        }
        function nextNode(n) {
          if (!n) return null;
          if (n.nextSibling) return n.nextSibling;
          if (n.parentNode && n.parentNode !== root) return nextNode(n.parentNode);
          return null;
        }

        let candidate = null;
        if (container && container.nodeType === 1) {
          const children = container.childNodes || [];
          if (isBackspace) candidate = offset > 0 ? children[offset - 1] : prevNode(container);
          else candidate = offset < children.length ? children[offset] : nextNode(container);
        } else if (container && container.nodeType === 3) {
          candidate = isBackspace ? prevNode(container) : nextNode(container);
        }
        if (!candidate) return false;

        if (candidate.nodeType === 3 && /^\s+$/.test(candidate.textContent || '')) {
          candidate = isBackspace ? prevNode(candidate) : nextNode(candidate);
          if (!candidate) return false;
        }
        if (!isMentionChipNode(candidate)) return false;

        const spaceNode = isBackspace ? candidate.nextSibling : candidate.previousSibling;
        if (spaceNode && spaceNode.nodeType === 3 && /^\s+$/.test(spaceNode.textContent || '')) {
          try { spaceNode.remove(); } catch (e2) {}
        }
        candidate.remove();
        ensureLeadingCaretAnchor();
        syncStateFromRichInput();
        return true;
      } catch (e) {
        return false;
      }
    }

    const pendingMentionBadges = computed(() => {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return [];
        const tokens = [];
        if (pendingMentionAll.value) tokens.push('@全体');
        const list = Array.isArray(pendingMentions.value) ? pendingMentions.value : [];
        for (const it of list) {
          if (!it || !it.label) continue;
          tokens.push(`@${String(it.label)}`);
        }
        return Array.from(new Set(tokens.filter(Boolean)));
      } catch (e) {
        return [];
      }
    });

    const mentionOptions = computed(() => {
      try {
        if (isGlobalChat.value) return [];
        if (!isGroupChat.value) return [];
        const sid = selfUserId.value ? String(selfUserId.value) : '';
        const ids = (groupMembers.value || []).map(String).filter((id) => id && id !== sid);
        const list = ids.map((id) => {
          const label = userLabel(id);
          const mc = userMinecraftId(id);
          return { id, label, mc };
        });

        return list;
      } catch (e) {
        return [];
      }
    });

    // Mention candidates: keep the same base data source as group management (groupMembers).
    const mentionMemberIds = computed(() => {
      try {
        if (isGlobalChat.value) return [];
        if (!isGroupChat.value) return [];
        const sid = selfUserId.value ? String(selfUserId.value) : '';

        return (groupMembers.value || []).map(String).filter((id) => id && id !== sid);
      } catch (e) {
        return [];
      }
    });

    function parseTailMentionQuery(text) {
      try {
        const s = String(text || '');
        const m = s.match(/(^|\s)@([^\s@]*)$/);
        if (!m) return null;
        return { prefix: m[1] || '', query: m[2] || '' };
      } catch (e) {
        return null;
      }
    }

    function shouldOpenMentionDialog(text) {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return false;
        const s = String(text || '');
        return /(^|\s)@$/.test(s);
      } catch (e) {
        return false;
      }
    }

    function openMentionDialog() {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return;
        try { ensureGroupMembersLoaded(); } catch (e0) {}
        try { emojiPanelVisible.value = false; } catch (e2) {}
        mentionQuery.value = '';
        mentionSelectAll.value = false;
        mentionSelectIds.value = [];
        mentionDialogVisible.value = true;
        mentionDialogSuppressOnce.value = false;
      } catch (e) {}
    }

    function cancelMentionDialog() {
      try {
        mentionDialogVisible.value = false;
        mentionTriggerIndex.value = null;
        if (isRichInputActive() && mentionMarkerEl) {
          replaceMentionMarkerWithText('@');
          syncStateFromRichInput();
        }
        mentionDialogSuppressOnce.value = true;
      } catch (e) {}
    }

    function getNativeMsgInputEl() {
      try {
        const comp = msgInputEl.value;
        if (!comp) return null;
        if (comp && comp.nodeType === 1 && comp.isContentEditable) return comp;
        const root = comp.$el && comp.$el.querySelector ? comp.$el : null;
        if (root) {
          const el = root.querySelector('input,textarea');
          if (el) return el;
        }
        if (comp.input && typeof comp.input === 'object') return comp.input;
        if (comp.textarea && typeof comp.textarea === 'object') return comp.textarea;
        return null;
      } catch (e) {
        return null;
      }
    }

    function focusMsgInputAndSetCaret(pos) {
      nextTick(() => {
        try {
          const comp = msgInputEl.value;
          if (comp && typeof comp.focus === 'function') comp.focus();
        } catch (e) {}

        try {
          const el = getNativeMsgInputEl();
          if (!el) return;
          if (el && el.nodeType === 1 && el.isContentEditable) return;
          if (typeof pos !== 'number' || !Number.isFinite(pos)) return;
          const p = Math.max(0, Math.min(el.value ? el.value.length : (String(msgInput.value || '').length), pos));
          if (typeof el.setSelectionRange === 'function') el.setSelectionRange(p, p);
        } catch (e2) {}
      });
    }

    function stripMentionTriggerChar() {
      try {
        const idxRaw = mentionTriggerIndex.value;
        mentionTriggerIndex.value = null;
        const idx = Number(idxRaw);
        if (!Number.isFinite(idx)) return;
        const s = String(msgInput.value || '');
        if (!s) return;

        if (idx >= 0 && idx < s.length && s[idx] === '@') {
          msgInput.value = s.slice(0, idx) + s.slice(idx + 1);
          return idx;
        }
        if (idx - 1 >= 0 && idx - 1 < s.length && s[idx - 1] === '@') {
          msgInput.value = s.slice(0, idx - 1) + s.slice(idx);
          return idx - 1;
        }
        return null;
      } catch (e) {
        try { mentionTriggerIndex.value = null; } catch (e2) {}
        return null;
      }
    }

    function confirmMentionDialog() {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return cancelMentionDialog();

        const allowAll = !!(canMentionAll && canMentionAll.value);

        if (isRichInputActive()) {
          const ids = Array.isArray(mentionSelectIds.value) ? mentionSelectIds.value.map(String).filter(Boolean) : [];
          const uniqueIds = Array.from(new Set(ids));
          const parts = [];
          if (allowAll && mentionSelectAll.value) parts.push({ isAll: true, userId: '__all__', label: '全体' });
          for (const id of uniqueIds) {
            const name = userLabel(id) || '未知玩家';
            parts.push({ isAll: false, userId: String(id), label: String(name) });
          }
          if (parts.length === 0) return cancelMentionDialog();

          pendingMentionAll.value = !!(allowAll && mentionSelectAll.value);
          const list = Array.isArray(pendingMentions.value) ? pendingMentions.value.slice() : [];
          for (const id of uniqueIds) {
            const name = userLabel(id) || '未知玩家';
            const idx = list.findIndex((x) => x && String(x.userId) === String(id));
            if (idx >= 0) list[idx] = { userId: String(id), label: String(name) };
            else list.push({ userId: String(id), label: String(name) });
          }
          pendingMentions.value = list;

          mentionDialogVisible.value = false;
          mentionSelectAll.value = false;
          mentionSelectIds.value = [];
          mentionDialogSuppressOnce.value = false;

          replaceMentionMarkerWithChips(parts);
          syncStateFromRichInput();
          focusRichInput();
          return;
        }

        const ids = Array.isArray(mentionSelectIds.value) ? mentionSelectIds.value.map(String).filter(Boolean) : [];
        const uniqueIds = Array.from(new Set(ids));
        const parts = [];
        if (allowAll && mentionSelectAll.value) parts.push('@全体');
        for (const id of uniqueIds) {
          const name = userLabel(id) || '未知玩家';
          parts.push(`@${name}`);
        }

        if (parts.length === 0) return cancelMentionDialog();

        // Replace the trigger '@' (wherever it was typed) with inline @tokens.
        const insertion = parts.join(' ') + ' ';
        const caretPos = stripMentionTriggerChar();
        try {
          const base = String(msgInput.value || '');
          const at = typeof caretPos === 'number' && Number.isFinite(caretPos) ? caretPos : base.length;
          msgInput.value = base.slice(0, at) + insertion + base.slice(at);
        } catch (e0) {}

        pendingMentionAll.value = !!(allowAll && mentionSelectAll.value);
        const list = Array.isArray(pendingMentions.value) ? pendingMentions.value.slice() : [];
        for (const id of uniqueIds) {
          const name = userLabel(id) || '未知玩家';
          const idx = list.findIndex((x) => x && String(x.userId) === String(id));
          if (idx >= 0) list[idx] = { userId: String(id), label: String(name) };
          else list.push({ userId: String(id), label: String(name) });
        }
        pendingMentions.value = list;

        mentionDialogVisible.value = false;
        mentionSelectAll.value = false;
        mentionSelectIds.value = [];
        mentionDialogSuppressOnce.value = false;

        const nextPos = (typeof caretPos === 'number' && Number.isFinite(caretPos) ? caretPos : String(msgInput.value || '').length) + insertion.length;
        focusMsgInputAndSetCaret(nextPos);
      } catch (e) {
        try { cancelMentionDialog(); } catch (e2) {}
      }
    }

    function removeMentionTokenAt(text, cursorPos, isBackspace) {
      try {
        const s = String(text || '');
        const pos = Math.max(0, Math.min(s.length, Number(cursorPos) || 0));

        const tokens = [];
        if (pendingMentionAll.value) tokens.push('@全体');
        try {
          const list = Array.isArray(pendingMentions.value) ? pendingMentions.value : [];
          for (const it of list) {
            if (!it || !it.label) continue;
            tokens.push(`@${String(it.label)}`);
          }
        } catch (e2) {}
        const uniq = Array.from(new Set(tokens.filter(Boolean))).sort((a, b) => b.length - a.length);
        if (uniq.length === 0) return null;

        function isWs(ch) {
          return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
        }

        for (const tok of uniq) {
          let from = 0;
          while (from <= s.length) {
            const idx = s.indexOf(tok, from);
            if (idx === -1) break;
            const start = idx;
            const end = idx + tok.length;
            const beforeOk = start === 0 || isWs(s[start - 1]);
            const afterOk = end === s.length || isWs(s[end]);
            if (beforeOk && afterOk) {
              const hit = isBackspace ? (start < pos && pos <= end) : (start <= pos && pos < end);
              if (hit) {
                let delStart = start;
                let delEnd = end;
                if (delEnd < s.length && s[delEnd] === ' ') delEnd += 1;
                else if (delStart > 0 && s[delStart - 1] === ' ') delStart -= 1;
                const next = s.slice(0, delStart) + s.slice(delEnd);
                const nextPos = delStart;
                return { next, nextPos };
              }
            }
            from = idx + tok.length;
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function cleanupPendingMentionsAfterEdit(text) {
      try {
        const s = String(text || '');
        if (!s.includes('@全体')) pendingMentionAll.value = false;
        const list = Array.isArray(pendingMentions.value) ? pendingMentions.value : [];
        pendingMentions.value = list.filter((x) => x && x.label && s.includes(`@${String(x.label)}`));
      } catch (e) {}
    }

    function onMsgInputKeydown(ev) {
      try {
        if (!ev) return;
        const key = ev.key;

        // Rich-input mode
        if (isRichInputActive()) {
          if (isGlobalChat.value || !isGroupChat.value) return;

          // Enter to send. Shift+Enter keeps default behavior.
          if (key === 'Enter') {
            try {
              if (ev.isComposing || ev.keyCode === 229) return;
            } catch (e0) {}
            if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (mentionDialogVisible.value) return;
            ev.preventDefault();
            try { sendText(); } catch (e1) {}
            return;
          }

          if (key === '@') {
            ev.preventDefault();
            ensureMentionMarkerAtCaret();
            setTimeout(() => {
              try {
                if (!mentionDialogVisible.value) openMentionDialog();
              } catch (e3) {}
            }, 0);
            return;
          }

          if (key === 'Backspace' || key === 'Delete') {
            const removed = deleteAdjacentMentionChip(key === 'Backspace');
            if (removed) {
              ev.preventDefault();
              return;
            }
          }
          return;
        }

        if (isGlobalChat.value || !isGroupChat.value) return;

        // Typing '@' anywhere triggers the mention picker in group chats.
        if (key === '@') {
          try {
            const target = ev.target;
            if (target && target.selectionStart !== undefined) {
              mentionTriggerIndex.value = Number(target.selectionStart) || 0;
            } else {
              mentionTriggerIndex.value = null;
            }
          } catch (e2) {
            mentionTriggerIndex.value = null;
          }

          try {
            setTimeout(() => {
              try {
                if (!mentionDialogVisible.value) openMentionDialog();
              } catch (e3) {}
            }, 0);
          } catch (e4) {}
          return;
        }

        if (key !== 'Backspace' && key !== 'Delete') return;
        const target = ev.target;
        if (!target) return;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (start === undefined || end === undefined) return;
        if (start !== end) return;

        const res = removeMentionTokenAt(msgInput.value, start, key === 'Backspace');
        if (!res) return;
        ev.preventDefault();
        msgInput.value = res.next;
        cleanupPendingMentionsAfterEdit(msgInput.value);
        nextTick(() => {
          try { target.setSelectionRange(res.nextPos, res.nextPos); } catch (e2) {}
        });
      } catch (e) {}
    }

    function insertMention(userId, label) {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return;
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return;
        const name = String(label || userLabel(id) || '未知玩家');

        if (isRichInputActive()) {
          const root = getRichInputEl();
          if (!root) return;
          const r = getSelectionRangeInRoot(root);
          const chip = createMentionChipEl({ userId: id, label: name, isAll: false });
          const space = document.createTextNode('\u00A0');
          if (r) {
            r.deleteContents();
            r.insertNode(space);
            r.insertNode(chip);
            setCaretInTextNodeEnd(space);
          } else {
            root.appendChild(chip);
            root.appendChild(space);
            setCaretInTextNodeEnd(space);
          }

          ensureLeadingCaretAnchor();

          const list = Array.isArray(pendingMentions.value) ? pendingMentions.value.slice() : [];
          const idx = list.findIndex((x) => x && String(x.userId) === id);
          if (idx >= 0) list[idx] = { userId: id, label: name };
          else list.push({ userId: id, label: name });
          pendingMentions.value = list;

          mentionDialogVisible.value = false;
          mentionQuery.value = '';
          syncStateFromRichInput();
          focusRichInput();
          return;
        }

        // If user just typed '@' to open dialog, strip it first; then insert inline token at caret.
        let caretPos = stripMentionTriggerChar();
        const el = getNativeMsgInputEl();
        if (caretPos === null || caretPos === undefined) {
          try {
            if (el && el.selectionStart !== undefined) caretPos = Number(el.selectionStart) || 0;
          } catch (e0) {}
        }

        const insertion = `@${name} `;
        try {
          const base = String(msgInput.value || '');
          const at = typeof caretPos === 'number' && Number.isFinite(caretPos) ? caretPos : base.length;
          msgInput.value = base.slice(0, at) + insertion + base.slice(at);
          caretPos = at + insertion.length;
        } catch (e1) {}

        const list = Array.isArray(pendingMentions.value) ? pendingMentions.value.slice() : [];
        const idx = list.findIndex((x) => x && String(x.userId) === id);
        if (idx >= 0) list[idx] = { userId: id, label: name };
        else list.push({ userId: id, label: name });
        pendingMentions.value = list;

        mentionDialogVisible.value = false;
        mentionQuery.value = '';

        focusMsgInputAndSetCaret(caretPos);
      } catch (e) {}
    }

    function onMsgInputInput() {
      try {
        if (isRichInputActive()) {
          syncStateFromRichInput();
          return;
        }
        cleanupPendingMentionsAfterEdit(msgInput.value);
      } catch (e) {}
    }

    function onMsgInputPaste(ev) {
      try {
        if (!isRichInputActive()) return;
        if (!ev || !ev.clipboardData) return;
        const text = ev.clipboardData.getData('text/plain');
        if (text === undefined || text === null) return;
        ev.preventDefault();

        const root = getRichInputEl();
        if (!root) return;
        const r = getSelectionRangeInRoot(root);
        const node = document.createTextNode(String(text));
        if (r) {
          r.deleteContents();
          r.insertNode(node);
          setCaretAfterNode(node);
        } else {
          root.appendChild(node);
          setCaretAfterNode(node);
        }
        syncStateFromRichInput();
      } catch (e) {}
    }

    function normalizeFaceUrl(raw) {
      try {
        const u = String(raw || '').trim();
        if (!u) return '';
        if (/^(data:|blob:|https?:\/\/)/i.test(u)) return u;
        if (u.startsWith('/api/')) return u;
        if (u.startsWith('/')) {
          const base = String(apiBase.value || '').replace(/\/$/, '');
          if (base && base !== '/') return base + u;
          return u;
        }
        const base = String(apiBase.value || '').replace(/\/$/, '');
        if (base && base !== '/') return base + '/' + u;
        return u;
      } catch (e) {
        return '';
      }
    }

    function extractChatAvatarUrl(chat) {
      try {
        if (!chat || typeof chat !== 'object') return '';
        const raw = chat.avatarUrl || chat.avatar_url || chat.avatar || '';
        return normalizeFaceUrl(raw);
      } catch (e) {
        return '';
      }
    }

    const replyPreview = computed(() => {
      if (!replyTarget.value) return '';
      const tag = messagePreviewTag(replyTarget.value);
      if (tag) {
        const suffix = messagePreviewSuffix(replyTarget.value);
        return suffix ? `${tag} ${suffix}` : tag;
      }
      return messagePreviewText(replyTarget.value) || '消息';
    });

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function apiGroupBase() {
      return String(apiBase.value || '').replace(/\/$/, '');
    }

    function buildMessagesUrl(chatId, opts) {
      const before = opts && opts.beforeId ? `before=${encodeURIComponent(opts.beforeId)}&` : '';
      const lim = opts && opts.limit ? opts.limit : PAGE_LIMIT;
      const limit = `limit=${encodeURIComponent(lim)}`;
      if (chatId === 'global') return `${apiBase.value}/global/messages?${before}${limit}`;
      return `${apiBase.value}/chats/${encodeURIComponent(chatId)}/messages?${before}${limit}`;
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

    function getCachedFaceUrl(userId) {
      if (!userId) return '';
      return userFaceCache[String(userId)] || '';
    }

    async function loadUsersIndex() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const users = await res.json();
        users.forEach(u => {
          const id = String(u.id);
          userNameCache[id] = u.username || u.displayName || userNameCache[id] || '未知玩家';
          const mc = u.minecraft_id || u.minecraftId || u.minecraft_uuid || u.minecraftUuid || '';
          if (mc) userMinecraftCache[id] = String(mc);
          const face = normalizeFaceUrl(u.faceUrl || u.face_url || u.face || u.face_key || '');
          if (face) userFaceCache[id] = face;
        });
      } catch (e) {}

      // If we already have a chat open (possibly hydrated from cache), persist the improved avatar/name cache.
      try {
        if (currentChatId.value) scheduleChatCacheSave(currentChatId.value);
      } catch (e) {}
    }

    async function fetchMissingUserNames(ids) {
      try {
        const missing = Array.from(ids || []).map(String).filter((id) => id && !userNameCache[id]);
        if (missing.length === 0) return;
        await Promise.allSettled(
          missing.map(async (id) => {
            try {
              const res = await safeFetch(`${apiBase.value}/users/${encodeURIComponent(id)}`);
              if (!res.ok) throw new Error('no user');
              const u = await res.json().catch(() => null);
              userNameCache[id] = (u && (u.username || u.displayName || u.name)) || userNameCache[id] || '未知玩家';
              try {
                const mc = (u && (u.minecraft_id || u.minecraftId || u.minecraft_uuid || u.minecraftUuid)) || '';
                if (mc) userMinecraftCache[id] = String(mc);
              } catch (e2) {}
              try {
                const face = normalizeFaceUrl((u && (u.faceUrl || u.face_url || u.face || u.face_key)) || '');
                if (face) userFaceCache[id] = face;
              } catch (e3) {}
            } catch (e) {
              userNameCache[id] = userNameCache[id] || '未知玩家';
            }
          })
        );
      } catch (e) {}
    }

    async function loadAllUsersList() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return;
        allUsersList.value = list
          .filter((u) => u && typeof u === 'object' && (u.id !== undefined && u.id !== null))
          .map((u) => ({ id: String(u.id), username: u.username || u.displayName || u.name || String(u.id) }));
      } catch (e) {}
    }

    async function refreshGroupInfo(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(chatId)}`);
        if (!res.ok) return;
        const meta = await res.json().catch(() => null);
        if (meta && typeof meta === 'object') {
          currentChatMeta.value = meta;
          if (String(meta.type || '').toLowerCase() === 'group') {
            currentChatTitle.value = meta.displayName || meta.name || '群聊';
            groupOwnerId.value = meta.created_by !== undefined && meta.created_by !== null ? String(meta.created_by) : groupOwnerId.value;

            try {
              const av = extractChatAvatarUrl(meta);
              if (av) currentChatFaceUrl.value = av;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    async function loadGroupAdmins(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(chatId)}/admins`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') return;
        groupOwnerId.value = data.ownerId !== undefined && data.ownerId !== null ? String(data.ownerId) : groupOwnerId.value;
        groupAdmins.value = Array.isArray(data.admins) ? data.admins.map(String) : [];
      } catch (e) {}
    }

    function openGroupAvatarPicker() {
      try {
        if (!groupCanManage.value) return;
        const el = groupAvatarInputEl.value;
        if (!el) return;
        el.value = '';
        el.click();
      } catch (e) {}
    }

    async function onGroupAvatarSelected(evt) {
      try {
        const input = evt && evt.target;
        const file = input && input.files && input.files[0];
        if (!file) return;
        await uploadGroupAvatar(file);
      } finally {
        try {
          if (evt && evt.target) evt.target.value = '';
        } catch (e) {}
      }
    }

    async function uploadGroupAvatar(file) {
      if (!groupCanManage.value) return;
      if (!currentChatId.value || currentChatId.value === 'global') return;
      if (!file) return;
      if (file.type && !String(file.type).startsWith('image/')) {
        ElementPlus.ElMessage.error('请选择图片文件');
        return;
      }

      groupActionLoading.value = true;
      try {
        const fd = new FormData();
        fd.append('file', file, file.name || 'avatar.png');
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}/avatar`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) throw new Error('upload avatar failed');
        const updated = await res.json().catch(() => null);
        if (updated && typeof updated === 'object') {
          currentChatMeta.value = Object.assign({}, currentChatMeta.value || {}, updated);
          try {
            const av = extractChatAvatarUrl(updated);
            if (av) currentChatFaceUrl.value = av;
          } catch (e) {}
        }
        ElementPlus.ElMessage.success('群头像已更新');
      } catch (e) {
        ElementPlus.ElMessage.error('设置群头像失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function openGroupManage() {
      if (!isGroupChat.value || !currentChatId.value || currentChatId.value === 'global') return;
      // Prevent stale privilege state from a previous chat.
      groupOwnerId.value = null;
      groupAdmins.value = [];
      adminSelected.value = [];
      groupManageVisible.value = true;
      groupManageLoading.value = true;
      inviteSelected.value = [];
      transferOwnerId.value = '';
      try {
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value), loadAllUsersList()]);
        const meta = currentChatMeta.value;
        groupEditName.value = (meta && (meta.name || meta.displayName)) ? String(meta.name || meta.displayName) : '';
        adminSelected.value = (groupAdmins.value || []).map(String);
      } finally {
        groupManageLoading.value = false;
      }
    }

    async function saveGroupName() {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupEditName.value || '').trim() || null }),
        });
        if (!res.ok) throw new Error('save name failed');
        const updated = await res.json().catch(() => null);
        if (updated && typeof updated === 'object') {
          currentChatMeta.value = updated;
          currentChatTitle.value = updated.displayName || updated.name || '群聊';
          ElementPlus.ElMessage.success('已保存');
        }
      } catch (e) {
        ElementPlus.ElMessage.error('保存失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function inviteToGroup() {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      const ids = (inviteSelected.value || []).map(String).filter(Boolean);
      if (ids.length === 0) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: ids }),
        });
        if (!res.ok) throw new Error('invite failed');
        inviteSelected.value = [];
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已邀请');
      } catch (e) {
        ElementPlus.ElMessage.error('邀请失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function kickFromGroup(userId) {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      const uid = userId !== undefined && userId !== null ? String(userId) : '';
      if (!uid) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: [uid] }),
        });
        if (!res.ok) throw new Error('kick failed');
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已移除');
      } catch (e) {
        ElementPlus.ElMessage.error('移除失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function saveGroupAdmins() {
      if (!groupIsOwner.value) {
        try { ElementPlus.ElMessage.warning('仅群主可设置管理员'); } catch (e) {}
        return;
      }
      if (!currentChatId.value) return;
      const ids = (adminSelected.value || []).map(String).filter(Boolean);
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}/admins`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admins: ids }),
        });
        if (!res.ok) throw new Error('save admins failed');
        const data = await res.json().catch(() => null);
        groupOwnerId.value = data && data.ownerId ? String(data.ownerId) : groupOwnerId.value;
        groupAdmins.value = data && Array.isArray(data.admins) ? data.admins.map(String) : groupAdmins.value;
        ElementPlus.ElMessage.success('已保存');
      } catch (e) {
        ElementPlus.ElMessage.error('保存失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function transferGroupOwner() {
      if (!groupIsOwner.value) return;
      if (!currentChatId.value) return;
      const nid = transferOwnerId.value ? String(transferOwnerId.value) : '';
      if (!nid) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(currentChatId.value)}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newOwnerId: nid }),
        });
        if (!res.ok) throw new Error('transfer failed');
        transferOwnerId.value = '';
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已转让');
      } catch (e) {
        ElementPlus.ElMessage.error('转让失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function dissolveGroupChat() {
      if (!groupIsOwner.value) return;
      if (!currentChatId.value || currentChatId.value === 'global') return;
      if (groupActionLoading.value) return;

      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定解散该群聊吗？解散后将删除该群聊及其消息记录。',
          '解散群聊',
          {
            cancelButtonText: '取消',
            distinguishCancelAndClose: true,
          }
        );
      } catch (e) {
        return;
      }

      groupActionLoading.value = true;
      try {
        const chatId = String(currentChatId.value);
        const res = await safeFetch(`${apiGroupBase()}/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        if (!res.ok) {
          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e2) {}
          if (!err) err = `解散失败 (${res.status})`;
          throw new Error(err);
        }

        groupManageVisible.value = false;
        ElementPlus.ElMessage.success('群聊已解散');
        goBack();
      } catch (e) {
        const msg = e && e.message ? String(e.message) : '解散失败';
        ElementPlus.ElMessage.error(msg);
      } finally {
        groupActionLoading.value = false;
      }
    }

    function decodeJwtPayload(jwt) {
      try {
        const parts = String(jwt || '').split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
        const json = decodeURIComponent(
          atob(base64 + pad)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function tryExtractSelfUserIdFromToken() {
      try {
        const t = token.value || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : '') || '';
        if (!t) return null;
        const payload = decodeJwtPayload(t);
        if (!payload || typeof payload !== 'object') return null;
        const candidate = payload.userId || payload.uid || payload.id || payload.sub;
        if (candidate === undefined || candidate === null || String(candidate) === '') return null;
        return String(candidate);
      } catch (e) {
        return null;
      }
    }

    async function resolveSelfUserId() {
      // 1) Prefer extracting from JWT token (no network)
      if (token.value) {
        const payload = decodeJwtPayload(token.value);
        if (payload && typeof payload === 'object') {
          const candidate = payload.userId || payload.uid || payload.id || payload.sub;
          if (candidate !== undefined && candidate !== null && String(candidate) !== '') {
            selfUserId.value = String(candidate);
            return selfUserId.value;
          }
        }
      }

      // 2) Try common "me" endpoints (best-effort)
      const endpoints = ['/users/me', '/me', '/auth/me', '/api/users/me', '/api/me', '/api/auth/me'];
      for (const ep of endpoints) {
        try {
          const url = ep.startsWith('/api/') ? ep : `${apiBase.value}${ep}`;
          const res = await safeFetch(url);
          if (!res.ok) continue;
          const data = await res.json().catch(() => null);
          if (!data || typeof data !== 'object') continue;
          const candidate =
            data.userId ||
            data.uid ||
            data.id ||
            (data.user && (data.user.id || data.user.userId));
          if (candidate !== undefined && candidate !== null && String(candidate) !== '') {
            selfUserId.value = String(candidate);
            return selfUserId.value;
          }
        } catch (e) {
          // ignore and continue
        }
      }

      selfUserId.value = null;
      return null;
    }

    async function resolveSelfProfile() {
      // Best-effort: try /users/me first (matches desktop)
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me && typeof me === 'object') {
            const id = me.id || me.userId || me.uid;
            if (id !== undefined && id !== null) selfUserId.value = String(id);
            const name = me.username || me.displayName;
            if (name && selfUserId.value) userNameCache[selfUserId.value] = String(name);
            const face = normalizeFaceUrl(me.faceUrl || me.face_url || me.face || '');
            if (face && selfUserId.value) userFaceCache[selfUserId.value] = String(face);
            return;
          }
        }
      } catch (e) {}

      await resolveSelfUserId();
    }

    function normalizeMessage(m, isGlobal) {
      if (!m) return m;
      if (!m.id) m.id = String(Math.random());
      if (!m.type) m.type = 'text';
      // unify author id (desktop behavior)
      if (m.from && !m.from_user) m.from_user = m.from;
      if (m.from_user === undefined && m.fromUser) m.from_user = m.fromUser;
      // unify reply field (desktop behavior)
      if (m.repliedTo !== undefined && m.replied_to === undefined) m.replied_to = m.repliedTo;
      if (m.created_at === undefined && m.createdAt) m.created_at = m.createdAt;
      return m;
    }

    function messageAuthorName(m) {
      if (!m) return '';
      const from = m.from_user || m.fromUser || m.from;
      if (!from) return '';
      if (String(from) === String(selfUserId.value)) return '我';
      return userNameCache[String(from)] || '对方';
    }

    function messageAuthorFaceUrl(m) {
      if (!m || isOwnMessage(m)) return '';
      const from = m.from_user || m.fromUser || m.from;
      return from ? getCachedFaceUrl(from) : '';
    }

    function isRecalledMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (String(m.type || '') === 'recalled') return true;
        const c = m.content;
        if (c && typeof c === 'object' && c.recalled === true) return true;
        return false;
      } catch (e) {
        return false;
      }
    }

    function isAuditRecalledMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (String(m.type || '') === 'audit_recalled') return true;
        const c = m.content;
        if (c && typeof c === 'object' && c.auditRecalled === true) return true;
        return false;
      } catch (e) {
        return false;
      }
    }

    function recallNoticeText(m) {
      try {
        if (!m) return '消息已撤回';
        if (isOwnMessage(m)) return '你撤回了一条消息';
        const name = messageAuthorName(m) || '对方';
        return `${name}撤回了一条消息`;
      } catch (e) {
        return '消息已撤回';
      }
    }

    function isGalleryImageMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        const t = String(m.type || '').toLowerCase();
        return t === 'gallery_image' || t === 'galleryimage' || t === 'gallery';
      } catch (e) {
        return false;
      }
    }

    function galleryImageIdFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return null;
        const c = m.content;
        if (c && typeof c === 'object') {
          const v = c.id !== undefined && c.id !== null ? Number(c.id) : NaN;
          return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
        }
        const s = String(c || '').trim();
        if (!s) return null;
        if (/^\d+$/.test(s)) {
          const n = Number(s);
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        }
        if (s.startsWith('{') && s.endsWith('}')) {
          const j = JSON.parse(s);
          const v = j && j.id !== undefined && j.id !== null ? Number(j.id) : NaN;
          return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
        }
      } catch (e) {}
      return null;
    }

    const galleryMsgCache = reactive({}); // id -> { id, name, url }
    const galleryMsgLoading = reactive({});

    async function ensureGalleryInfo(id) {
      const gid = Number(id);
      if (!Number.isFinite(gid) || gid <= 0) return;
      const key = String(Math.floor(gid));
      if (galleryMsgCache[key]) return;
      if (galleryMsgLoading[key]) return;
      galleryMsgLoading[key] = true;
      try {
        const res = await safeFetch(`${apiBase.value}/aggallery/getDetail?id=${encodeURIComponent(key)}`);
        if (!res.ok) return;
        const d = await res.json().catch(() => null);
        if (!d || typeof d !== 'object') return;
        const name = d.name ? String(d.name) : '';
        const url = d.url ? String(d.url) : '';
        galleryMsgCache[key] = { id: Number(d.id) || Number(key), name, url };
      } catch (e) {
      } finally {
        try { delete galleryMsgLoading[key]; } catch (e2) {}
      }
    }

    function galleryInfoFor(m) {
      const id = galleryImageIdFromMessage(m);
      if (!id) return { id: null, name: '', url: '', loading: false };
      const key = String(id);
      if (!galleryMsgCache[key]) ensureGalleryInfo(id);
      const cached = galleryMsgCache[key];
      return {
        id,
        name: cached && cached.name ? String(cached.name) : '',
        url: cached && cached.url ? String(cached.url) : '',
        loading: !!galleryMsgLoading[key],
      };
    }

    function openGalleryFromMessage(m) {
      try {
        const id = galleryImageIdFromMessage(m);
        if (!id) return;
        window.location.href = `/m/gallery.html?detail=${encodeURIComponent(String(id))}`;
      } catch (e) {}
    }

    function messageTextPreview(m) {
      if (!m) return '';
      if (isAuditRecalledMessage(m)) return '';
      if (isRecalledMessage(m)) return '[消息已撤回]';
      if (isGalleryImageMessage(m)) {
        const id = galleryImageIdFromMessage(m);
        return id ? `[相册] #${id}` : '[相册]';
      }
      if (m.type === 'text') {
        const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
        return String(t);
      }
      if (String(m.type || '').toLowerCase() === 'coordinate') {
        try {
          const c = m.content && typeof m.content === 'object' ? m.content : null;
          if (!c) return '[坐标]';
          const name = String(c.name || '').trim();
          const dimRaw = String(c.dimension || '').trim();
          const dim = dimRaw === 'world' ? '主世界' : dimRaw === 'world_nether' ? '下界' : dimRaw === 'world_the_end' ? '末地' : dimRaw;
          const x = c.x;
          const y = c.y;
          const z = c.z;
          const desc = c.description !== undefined && c.description !== null ? String(c.description).trim() : '';
          const head = `[坐标]${name ? ' ' + name : ''}${dim ? ' (' + dim + ')' : ''}`;
          const xyz = `${x},${y},${z}`;
          return head + ' ' + xyz + (desc ? ' - ' + desc : '');
        } catch (e) {
          return '[坐标]';
        }
      }
      return '';
    }

    function messageTextRaw(m) {
      try {
        if (!m || typeof m !== 'object') return '';
        if (m.type !== 'text') return '';
        const c = m.content;
        if (c && typeof c === 'object') {
          if (c.text !== undefined && c.text !== null) return String(c.text);
          return '';
        }
        if (c === null || c === undefined) return '';
        return String(c);
      } catch (e) {
        return '';
      }
    }

    function mentionTokensFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return [];
        if (m.type !== 'text') return [];
        const c = m.content;
        if (!c || typeof c !== 'object') return [];

        const tokens = [];
        const mentionAll = !!(c.mentionAll || c.mention_all);
        if (mentionAll) tokens.push('@全体');

        const mentions = Array.isArray(c.mentions) ? c.mentions : [];
        for (const it of mentions) {
          const userId = it && typeof it === 'object' ? (it.userId || it.user_id || it.id) : it;
          const id = userId !== undefined && userId !== null ? String(userId) : '';
          if (!id) continue;
          const name = userLabel(id) || '未知玩家';
          tokens.push(`@${name}`);
        }
        return Array.from(new Set(tokens.filter(Boolean)));
      } catch (e) {
        return [];
      }
    }

    function messageTextParts(m) {
      try {
        const text = messageTextRaw(m);
        let tokens = mentionTokensFromMessage(m);
        tokens = Array.from(new Set((tokens || []).filter(Boolean)));
        tokens.sort((a, b) => b.length - a.length);

        if (tokens.length > 0 && (!text || !tokens.some((t) => text.includes(t)))) {
          const parts = tokens.map((t) => ({ t: 'mention', v: t }));
          if (text) parts.push({ t: 'text', v: ' ' + text });
          return parts;
        }

        if (!text) return tokens.length > 0 ? tokens.map((t) => ({ t: 'mention', v: t })) : [{ t: 'text', v: '' }];

        tokens = tokens.filter((t) => t && text.includes(t));
        tokens = Array.from(new Set(tokens));
        tokens.sort((a, b) => b.length - a.length);
        if (tokens.length === 0) return [{ t: 'text', v: text }];

        const parts = [];
        let pos = 0;
        while (pos < text.length) {
          let bestIdx = -1;
          let bestTok = '';
          for (const tok of tokens) {
            const idx = text.indexOf(tok, pos);
            if (idx === -1) continue;
            if (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && tok.length > bestTok.length)) {
              bestIdx = idx;
              bestTok = tok;
            }
          }

          if (bestIdx === -1) {
            parts.push({ t: 'text', v: text.slice(pos) });
            break;
          }
          if (bestIdx > pos) parts.push({ t: 'text', v: text.slice(pos, bestIdx) });
          parts.push({ t: 'mention', v: bestTok });
          pos = bestIdx + bestTok.length;
        }
        return parts;
      } catch (e) {
        return [{ t: 'text', v: messageTextPreview(m) }];
      }
    }

    function truncatePreviewText(s, maxLen) {
      try {
        const max = maxLen || 120;
        const str = String(s || '');
        if (!str) return '';
        return str.length > max ? str.slice(0, max) + '…' : str;
      } catch (e) {
        return '';
      }
    }

    function previewTagAndSuffixFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return { tag: '', suffix: '' };
        if (isRecalledMessage(m)) return { tag: '已撤回', suffix: '' };

        function fixUtf8Mojibake(s) {
          try {
            const str = String(s || '');
            if (!str) return '';
            const looksSuspicious = /[\u0080-\u009f]/.test(str) || /[\u00c2-\u00ff]/.test(str);
            if (!looksSuspicious) return str;
            if (typeof TextDecoder === 'undefined') return str;
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            if (!decoded) return str;
            const origHasCjk = /[\u4e00-\u9fff]/.test(str);
            const decodedHasCjk = /[\u4e00-\u9fff]/.test(decoded);
            const decodedHasReplacement = /\uFFFD/.test(decoded);
            const origHasControls = /[\u0000-\u001f\u007f-\u009f]/.test(str);
            const decodedHasControls = /[\u0000-\u001f\u007f-\u009f]/.test(decoded);
            if (!decodedHasReplacement && (decodedHasCjk || (!origHasCjk && origHasControls && !decodedHasControls))) {
              return decoded;
            }
            return str;
          } catch (e) {
            return String(s || '');
          }
        }

        function displayFilename(raw) {
          try {
            const str = String(raw || '');
            if (!str) return '';
            return fixUtf8Mojibake(str);
          } catch (e) {
            return '';
          }
        }

        const t = String(m.type || '').toLowerCase();
        if (t === 'gallery_image' || t === 'galleryimage' || t === 'gallery') {
          const id = galleryImageIdFromMessage(m);
          const info = id ? galleryMsgCache[String(id)] : null;
          const suffix = info && info.name ? String(info.name) : (id ? `#${id}` : '');
          return { tag: '相册', suffix };
        }
        if (t === 'emoji' || t === 'sticker') {
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          return { tag: '表情', suffix: fn };
        }
        if (t === 'file') {
          const mime = m.content && (m.content.mimetype || m.content.type) ? String(m.content.mimetype || m.content.type) : '';
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          const tag = /^image\//i.test(mime) ? '图片' : /^video\//i.test(mime) ? '视频' : '文件';
          return { tag, suffix: fn };
        }

        if (t === 'video') {
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          return { tag: '视频', suffix: fn };
        }

        if (t === 'player_card') {
          const name =
            (m.content && typeof m.content === 'object' && (m.content.name || m.content.username || m.content.displayName)) || '';
          return { tag: '名片', suffix: name ? String(name) : '' };
        }

        if (t === 'coordinate') {
          const name = (m.content && typeof m.content === 'object' && m.content.name) ? String(m.content.name) : '';
          return { tag: '坐标', suffix: name ? String(name) : '' };
        }

        return { tag: '', suffix: '' };
      } catch (e) {
        return { tag: '', suffix: '' };
      }
    }

    function messagePreviewTag(m) {
      try {
        return previewTagAndSuffixFromMessage(m).tag || '';
      } catch (e) {
        return '';
      }
    }

    function messagePreviewSuffix(m) {
      try {
        return previewTagAndSuffixFromMessage(m).suffix || '';
      } catch (e) {
        return '';
      }
    }

    function messagePreviewText(m) {
      try {
        if (!m || typeof m !== 'object') return '';
        if (isRecalledMessage(m)) return '';
        if (String(m.type || '') === 'text') {
          const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return truncatePreviewText(String(t), 120);
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    function isOwnMessage(m) {
      if (!m || !selfUserId.value) return false;
      const from = m.from_user || m.fromUser || m.from || m.author;
      if (m.__own) return true;
      return String(from) === String(selfUserId.value);
    }

    function repliedRefMessage(m) {
      if (!m || !m.replied_to) return null;
      if (typeof m.replied_to === 'object') return m.replied_to;
      return msgById[m.replied_to] || null;
    }

    function scrollToMessage(messageId) {
      try {
        const el = document.querySelector(`.msg-wrapper[data-id="${messageId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevBg = el.style.background;
        const prevShadow = el.style.boxShadow;
        const prevRadius = el.style.borderRadius;
        el.style.borderRadius = '10px';
        el.style.background = 'var(--mc-active-bg)';
        el.style.boxShadow = '0 0 0 6px var(--mc-active-bg)';
        setTimeout(() => {
          el.style.background = prevBg;
          el.style.boxShadow = prevShadow;
          el.style.borderRadius = prevRadius;
        }, 800);
      } catch (e) {}
    }

    function isImageFile(m) {
      if (!m || m.type !== 'file' || !m.content) return false;
      const mime = m.content.mimetype || m.content.type || '';
      return /^image\//i.test(mime);
    }

    function isVideoFile(m) {
      if (!m || m.type !== 'file' || !m.content) return false;
      const mime = m.content.mimetype || m.content.type || '';
      return /^video\//i.test(mime);
    }

    function fixUtf8Mojibake(s) {
      try {
        const str = String(s || '');
        if (!str) return '';
        const looksSuspicious = /[\u0080-\u009f]/.test(str) || /[\u00c2-\u00ff]/.test(str);
        if (!looksSuspicious) return str;
        if (typeof TextDecoder === 'undefined') return str;
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (!decoded) return str;
        const origHasCjk = /[\u4e00-\u9fff]/.test(str);
        const decodedHasCjk = /[\u4e00-\u9fff]/.test(decoded);
        const decodedHasReplacement = /\uFFFD/.test(decoded);
        const origHasControls = /[\u0000-\u001f\u007f-\u009f]/.test(str);
        const decodedHasControls = /[\u0000-\u001f\u007f-\u009f]/.test(decoded);
        if (!decodedHasReplacement && (decodedHasCjk || (!origHasCjk && origHasControls && !decodedHasControls))) {
          return decoded;
        }
        return str;
      } catch (e) {
        return String(s || '');
      }
    }

    function messageFilename(m) {
      try {
        if (!m || !m.content) return '';
        const raw = m.content.filename || '';
        return fixUtf8Mojibake(String(raw));
      } catch (e) {
        return '';
      }
    }

    function fileDisplayUrl(m) {
      if (!m || !m.content) return '';
      return m.content.__localUrl || m.content.thumbnailUrl || m.content.url || '';
    }

    function fileOriginalUrl(m) {
      try {
        if (!m || !m.content) return '';
        if (m.content.__localUrl) return m.content.__localUrl;
        return m.content.url || m.content.thumbnailUrl || '';
      } catch (e) {
        return '';
      }
    }

    function bubbleBackground(m) {
      if (!m) return 'var(--mc-surface)';
      if (isRecalledMessage(m)) return 'var(--el-fill-color-lighter)';
      if (m.__status === 'sending') return 'var(--mc-active-bg)';
      if (m.__status === 'failed') return 'var(--el-color-danger-light-9)';
      return 'var(--mc-surface)';
    }

    function removeMessageById(messageId) {
      if (!messageId) return;
      if (msgById[messageId]) delete msgById[messageId];
      messages.value = (messages.value || []).filter((m) => m && m.id !== messageId);
    }

    function contentSignature(m) {
      try {
        if (!m) return '';
        const t = m.type || 'text';
        if (t === 'text') {
          const txt = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return 'text:' + String(txt);
        }
        if (t === 'emoji') {
          const pid = (m.content && (m.content.packId || m.content.pack_id)) || '';
          const url = (m.content && m.content.url) || '';
          return 'emoji:' + String(pid) + ':' + String(url);
        }
        if (t === 'file') {
          const fn = (m.content && m.content.filename) || '';
          const mm = (m.content && (m.content.mimetype || m.content.type)) || '';
          return 'file:' + String(fn) + ':' + String(mm);
        }
        if (t === 'player_card') {
          const c = m.content;
          if (c && typeof c === 'object') {
            const uid = c.uid || c.userId || c.id || '';
            const name = c.name || c.username || c.displayName || '';
            return 'player_card:' + String(uid || '') + ':' + String(name || '');
          }
          return 'player_card:' + String(c || '');
        }
        return String(t) + ':' + String(m.content || '');
      } catch (e) {
        return '';
      }
    }

    function findOptimisticForAck(serverMsg) {
      try {
        if (!serverMsg || typeof serverMsg !== 'object') return null;
        normalizeMessage(serverMsg, currentChatId.value === 'global');
        if (!selfUserId.value) return null;
        const from = serverMsg.from_user;
        if (!from) return null;
        if (String(from) !== String(selfUserId.value)) return null;

        const sig = contentSignature(serverMsg);
        const now = parseMessageTime(serverMsg) ? parseMessageTime(serverMsg).getTime() : Date.now();

        const arr = messages.value || [];
        for (let i = arr.length - 1; i >= 0; i--) {
          const m = arr[i];
          if (!m || !m.id) continue;
          if (m.__status !== 'sending') continue;
          if (m.__own !== true) continue;
          if ((m.type || 'text') !== (serverMsg.type || 'text')) continue;

          const ms = parseMessageTime(m) ? parseMessageTime(m).getTime() : Date.now();
          if (Math.abs(now - ms) > 60 * 1000) continue;
          if (contentSignature(m) !== sig) continue;
          return m;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function ackOptimisticMessage(tempId, serverMsg, isGlobal) {
      try {
        const optimistic = msgById[tempId];
        if (!optimistic) return;
        if (!serverMsg || typeof serverMsg !== 'object') {
          optimistic.__status = 'sent';
          return;
        }

        normalizeMessage(serverMsg, !!isGlobal);
        const serverId = serverMsg.id;
        if (!serverId) {
          optimistic.__status = 'sent';
          return;
        }

        // socket may have already inserted this server message
        if (msgById[serverId]) {
          try {
            Object.assign(msgById[serverId], serverMsg);
            msgById[serverId].__status = 'sent';
          } catch (e) {}
          if (tempId !== serverId) {
            removeMessageById(tempId);
          }
          return;
        }

        // move mapping tempId -> serverId
        delete msgById[tempId];
        optimistic.__status = 'sent';
        optimistic.id = serverId;
        if (serverMsg.type) optimistic.type = serverMsg.type;
        if (serverMsg.from_user) optimistic.from_user = serverMsg.from_user;
        if (serverMsg.created_at || serverMsg.createdAt) optimistic.created_at = serverMsg.created_at || serverMsg.createdAt;
        if (serverMsg.replied_to !== undefined) optimistic.replied_to = serverMsg.replied_to;

        if (serverMsg.content !== undefined) {
          if (optimistic.type === 'file' && optimistic.content && optimistic.content.__localUrl) {
            const localUrl = optimistic.content.__localUrl;
            optimistic.content = Object.assign({}, serverMsg.content);
            optimistic.content.__localUrl = localUrl;
          } else {
            optimistic.content = serverMsg.content;
          }
        }

        // Merge read fields if server provided them (keep optimistic defaults otherwise).
        try {
          const rawRc = serverMsg.readCount ?? serverMsg.read_count ?? (serverMsg.meta ? serverMsg.meta.readCount : undefined);
          if (!(rawRc === undefined || rawRc === null || rawRc === '')) {
            const n = Number(rawRc);
            if (Number.isFinite(n)) optimistic.readCount = Math.max(0, Math.floor(n));
          }
        } catch (e4) {}
        try {
          const rawRead = serverMsg.read ?? serverMsg.isRead ?? serverMsg.is_read ?? (serverMsg.meta ? serverMsg.meta.read : undefined);
          if (!(rawRead === undefined || rawRead === null || rawRead === '')) {
            optimistic.read = !!rawRead;
          }
        } catch (e5) {}

        msgById[serverId] = optimistic;
      } catch (e) {
        // ignore
      }
    }

    function parseMessageTime(m) {
      if (!m) return null;
      const candidates = [
        m.createdAt,
        m.created_at,
        m.sentAt,
        m.sent_at,
        m.timestamp,
        m.time,
        m.ts,
      ];
      const v = candidates.find((x) => x !== undefined && x !== null && x !== '');
      if (v === undefined) return null;
      if (typeof v === 'number') {
        const ms = v < 1e12 ? v * 1000 : v;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
      const s = String(v);
      if (/^\d+$/.test(s)) {
        const num = Number(s);
        const ms = num < 1e12 ? num * 1000 : num;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    function formatTime(m) {
      const d = parseMessageTime(m);
      if (!d) return '';
      const yyyy = String(d.getFullYear());
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}年${MM}月${dd}日 ${hh}:${mm}:${ss}`;
    }

    function shouldShowTimeDivider(idx) {
      try {
        const gapMs = 5 * 60 * 1000;
        const list = Array.isArray(messages.value) ? messages.value : [];
        if (idx === undefined || idx === null) return false;
        const i = Number(idx);
        if (!Number.isFinite(i) || i <= 0) return false;
        const prev = list[i - 1];
        const cur = list[i];
        const prevD = parseMessageTime(prev);
        const curD = parseMessageTime(cur);
        if (!prevD || !curD) return false;
        const diff = curD.getTime() - prevD.getTime();
        return diff > gapMs;
      } catch (e) {
        return false;
      }
    }

    function toggleMessageTime(m) {
      if (!m) return;
      m.__showTime = !m.__showTime;
    }

    function onTouchStart(m, event) {
      longPressTarget.value = m;
      longPressTimer.value = setTimeout(() => {
        if (longPressTarget.value === m) {
          showContextMenu(m, event);
        }
      }, 500);
    }

    function updateInputAreaHeightVar() {
      try {
        const el = inputAreaEl.value;
        if (!el) return;
        const h = el.offsetHeight || 0;
        document.documentElement.style.setProperty('--input-area-height', `${h}px`);
      } catch (e) {}
    }

    function restoreViewportScale() {
      try {
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        meta.setAttribute(
          'content',
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
        );
      } catch (e) {}
    }

    function onTouchMove() {
      if (longPressTimer.value) {
        clearTimeout(longPressTimer.value);
        longPressTimer.value = null;
      }
      longPressTarget.value = null;
    }

    function onTouchEnd() {
      if (longPressTimer.value) {
        clearTimeout(longPressTimer.value);
        longPressTimer.value = null;
      }
      longPressTarget.value = null;
    }

    function showContextMenu(m, event) {
      // 全服会话：仅允许复制纯文本；没有可用动作时不显示空菜单
      try {
        if (isGlobalChat.value && !canCopyText(m)) return;
      } catch (e) {}

      ctxMenuMsg.value = m;
      
      // 获取触摸位置
      const touch = event.touches[0] || event.changedTouches[0];
      let x = touch.clientX;
      let y = touch.clientY;
      
      // 确保菜单不会超出屏幕
      const menuWidth = 140;
      let itemCount = 0;
      try {
        if (canCopyText(m)) itemCount += 1;
        if (!isGlobalChat.value) itemCount += 1; // reply
        if (!isGlobalChat.value && canForwardMessage(m)) itemCount += 1;
        if (canRecallMessage(m)) itemCount += 1;
        if (canCollectEmoji(m)) itemCount += 1;
      } catch (e) {}
      const menuHeight = Math.max(60, 18 + itemCount * 40);
      
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = y - menuHeight - 10;
      }
      
      ctxMenuX.value = x;
      ctxMenuY.value = y;
      ctxMenuVisible.value = true;
      
      // 给震动反馈（如果支持）
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    function canRecallMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isGlobalChat.value) return false;
        if (!isOwnMessage(m)) return false;
        if (isRecalledMessage(m)) return false;
        if (!m.id) return false;
        const id = String(m.id);
        if (id.startsWith('local-') || id.startsWith('temp_')) return false;
        if (m.__status === 'sending') return false;

        const d = parseMessageTime(m);
        if (!d) return false;
        const age = Date.now() - d.getTime();
        return age >= 0 && age <= 2 * 60 * 1000;
      } catch (e) {
        return false;
      }
    }

    function applyMessageUpdate(chatId, updated) {
      try {
        if (!updated || typeof updated !== 'object') return;
        if (!updated.id) return;

        if (isAuditRecalledMessage(updated)) {
          const mid = String(updated.id);
          try { delete msgById[mid]; } catch (e0) {}
          try {
            const list = Array.isArray(messages.value) ? messages.value : [];
            const next = list.filter((m) => !(m && m.id && String(m.id) === mid));
            if (next.length !== list.length) messages.value = next;
          } catch (e1) {}
          return;
        }

        normalizeMessage(updated, chatId === 'global');
        if (msgById[updated.id]) {
          try { Object.assign(msgById[updated.id], updated); } catch (e) {}
        } else if (currentChatId.value && chatId && String(chatId) === String(currentChatId.value)) {
          msgById[updated.id] = updated;
          messages.value.push(updated);
        }
      } catch (e) {}
    }

    async function postRecallRequest(messageId) {
      const mid = messageId !== undefined && messageId !== null ? String(messageId) : '';
      if (!mid) throw new Error('missing messageId');

      const endpoints = [];
      endpoints.push(`${apiBase.value}/messages/${encodeURIComponent(mid)}/recall`);
      if (currentChatId.value) {
        endpoints.push(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages/${encodeURIComponent(mid)}/recall`);
      }
      endpoints.push(`${apiBase.value}/chats/${encodeURIComponent(mid)}/recall`);

      let lastErr = null;
      for (const url of endpoints) {
        try {
          const res = await safeFetch(url, { method: 'POST' });
          if (res.ok) return await res.json().catch(() => ({}));
          if (res.status === 404) continue;

          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e) {}
          if (!err) err = `撤回失败 (${res.status})`;
          lastErr = new Error(err);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('撤回失败');
    }

    async function ctxRecall() {
      const msg = ctxMenuMsg.value;
      hideContextMenu();
      try {
        if (!canRecallMessage(msg)) {
          try { ElementPlus.ElMessage.warning('只能撤回 2 分钟内发送的消息'); } catch (e) {}
          return;
        }
        const result = await postRecallRequest(msg.id);
        const updated = (result && result.message) ? result.message : null;
        if (updated) applyMessageUpdate(updated.chatId || updated.chat_id || currentChatId.value, updated);
      } catch (e) {
        const m = e && e.message ? String(e.message) : '撤回失败';
        try { ElementPlus.ElMessage.error(m); } catch (e2) {}
      }
    }

    function openImagePreview(url) {
      try {
        const u = String(url || '').trim();
        if (!u) return;
        imagePreviewUrl.value = u;
        imagePreviewVisible.value = true;
        imagePreviewScale.value = 1;
        imagePreviewX.value = 0;
        imagePreviewY.value = 0;
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function openVideoPreview(url) {
      try {
        const u = String(url || '').trim();
        if (!u) return;
        videoPreviewUrl.value = u;
        videoPreviewVisible.value = true;
      } catch (e) {}
    }

    function closeVideoPreview() {
      try {
        videoPreviewVisible.value = false;
        videoPreviewUrl.value = '';
      } catch (e) {}
    }

    function requestCloseVideoPreview() {
      try {
        // Avoid closing due to synthetic taps after gestures.
        if (imgDragActive || imgPinchActive) return;
        closeVideoPreview();
      } catch (e) {}
    }

    function closeImagePreview() {
      try {
        imagePreviewVisible.value = false;
        imagePreviewUrl.value = '';
        imagePreviewScale.value = 1;
        imagePreviewX.value = 0;
        imagePreviewY.value = 0;
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function requestCloseImagePreview() {
      try {
        // 防止拖动/捏合结束后产生的合成 click 误触关闭
        if (imgDragActive || imgPinchActive) return;
        if (imagePreviewMoved.value) {
          imagePreviewMoved.value = false;
          return;
        }
        closeImagePreview();
      } catch (e) {}
    }

    function clampImageScale(s) {
      const v = Number(s);
      if (!Number.isFinite(v)) return 1;
      return Math.min(5, Math.max(1, v));
    }

    function resetImagePreviewTransform() {
      imagePreviewScale.value = 1;
      imagePreviewX.value = 0;
      imagePreviewY.value = 0;
      imagePreviewMoved.value = false;
    }

    const imagePreviewStyle = computed(() => {
      const x = Number(imagePreviewX.value) || 0;
      const y = Number(imagePreviewY.value) || 0;
      const s = Number(imagePreviewScale.value) || 1;
      return {
        transform: `translate(${x}px, ${y}px) scale(${s})`,
      };
    });

    function onImagePreviewToggle() {
      try {
        closeImagePreview();
      } catch (e) {}
    }

    function touchPoint(t) {
      return { x: Number(t && t.clientX) || 0, y: Number(t && t.clientY) || 0 };
    }

    function touchDistance(t1, t2) {
      const a = touchPoint(t1);
      const b = touchPoint(t2);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function touchCenter(t1, t2) {
      const a = touchPoint(t1);
      const b = touchPoint(t2);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function onImagePreviewTouchStart(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (touches.length === 2) {
          imgTapCandidate = false;
          imgPinchActive = true;
          imgDragActive = false;
          imgPinchStartDist = touchDistance(touches[0], touches[1]) || 1;
          imgPinchStartScale = Number(imagePreviewScale.value) || 1;
          const c = touchCenter(touches[0], touches[1]);
          imgPinchStartCenterX = c.x;
          imgPinchStartCenterY = c.y;
          imgPinchLastCenterX = c.x;
          imgPinchLastCenterY = c.y;
          imgPinchOriginX = Number(imagePreviewX.value) || 0;
          imgPinchOriginY = Number(imagePreviewY.value) || 0;
          return;
        }
        if (touches.length === 1) {
          imgTapCandidate = true;
          imgTapStartX = Number(touches[0].clientX) || 0;
          imgTapStartY = Number(touches[0].clientY) || 0;

          imgDragActive = true;
          imgPinchActive = false;
          imgDragStartX = Number(touches[0].clientX) || 0;
          imgDragStartY = Number(touches[0].clientY) || 0;
          imgDragOriginX = Number(imagePreviewX.value) || 0;
          imgDragOriginY = Number(imagePreviewY.value) || 0;
        }
      } catch (e) {}
    }

    function onImagePreviewTouchMove(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (imgPinchActive && touches.length === 2) {
          const target = ev.currentTarget || ev.target;
          const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
          const c = touchCenter(touches[0], touches[1]);

          // Pan following the moving pinch center.
          const panDx = c.x - imgPinchLastCenterX;
          const panDy = c.y - imgPinchLastCenterY;
          imgPinchLastCenterX = c.x;
          imgPinchLastCenterY = c.y;
          if (Math.abs(panDx) > 1 || Math.abs(panDy) > 1) imagePreviewMoved.value = true;

          const dist = touchDistance(touches[0], touches[1]) || 1;
          const desiredScale = clampImageScale(imgPinchStartScale * (dist / imgPinchStartDist));
          const oldScale = Number(imagePreviewScale.value) || 1;

          if (Math.abs(desiredScale - oldScale) > 0.01) imagePreviewMoved.value = true;

          // First: scale around current two-finger center.
          if (rect && desiredScale !== oldScale) {
            const px = c.x - rect.left;
            const py = c.y - rect.top;
            const curX = Number(imagePreviewX.value) || 0;
            const curY = Number(imagePreviewY.value) || 0;
            imagePreviewX.value = curX + px * (1 - desiredScale / oldScale);
            imagePreviewY.value = curY + py * (1 - desiredScale / oldScale);
            imagePreviewScale.value = desiredScale;
          } else if (!rect) {
            imagePreviewScale.value = desiredScale;
          }

          // Then: apply pan.
          imagePreviewX.value = (Number(imagePreviewX.value) || 0) + panDx;
          imagePreviewY.value = (Number(imagePreviewY.value) || 0) + panDy;

          if (desiredScale === 1) {
            imagePreviewX.value = 0;
            imagePreviewY.value = 0;
          }

          return;
        }

        if (imgDragActive && touches.length === 1) {
          const x = Number(touches[0].clientX) || 0;
          const y = Number(touches[0].clientY) || 0;

          if (imgTapCandidate) {
            const mdx = x - imgTapStartX;
            const mdy = y - imgTapStartY;
            if (Math.abs(mdx) > 8 || Math.abs(mdy) > 8) imgTapCandidate = false;
          }

          const dx = x - imgDragStartX;
          const dy = y - imgDragStartY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imagePreviewMoved.value = true;
          imagePreviewX.value = imgDragOriginX + dx;
          imagePreviewY.value = imgDragOriginY + dy;
        }
      } catch (e) {}
    }

    function onImagePreviewTouchEnd(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (touches.length === 0) {
          if (imgTapCandidate) {
            imgTapCandidate = false;
            imgDragActive = false;
            imgPinchActive = false;
            closeImagePreview();
            return;
          }
          imgTapCandidate = false;
          imgDragActive = false;
          imgPinchActive = false;
        }
        if (touches.length === 1) {
          imgPinchActive = false;
          imgDragActive = true;
          imgDragStartX = Number(touches[0].clientX) || 0;
          imgDragStartY = Number(touches[0].clientY) || 0;
          imgDragOriginX = Number(imagePreviewX.value) || 0;
          imgDragOriginY = Number(imagePreviewY.value) || 0;
        }
      } catch (e) {}
    }

    function onMaskTouchStart(ev) {
      try {
        const t = ev && ev.touches && ev.touches[0] ? ev.touches[0] : null;
        maskTapCandidate = true;
        maskTapStartX = Number(t && t.clientX) || 0;
        maskTapStartY = Number(t && t.clientY) || 0;
      } catch (e) {}
    }

    function onMaskTouchMove(ev) {
      try {
        if (!maskTapCandidate) return;
        const t = ev && ev.touches && ev.touches[0] ? ev.touches[0] : null;
        const x = Number(t && t.clientX) || 0;
        const y = Number(t && t.clientY) || 0;
        if (Math.abs(x - maskTapStartX) > 8 || Math.abs(y - maskTapStartY) > 8) {
          maskTapCandidate = false;
        }
      } catch (e) {}
    }

    function onMaskTouchEnd() {
      try {
        if (!maskTapCandidate) return;
        maskTapCandidate = false;
        requestCloseImagePreview();
      } catch (e) {}
    }

    function hideContextMenu() {
      ctxMenuVisible.value = false;
      ctxMenuMsg.value = null;
    }

    function ctxReply() {
      if (ctxMenuMsg.value) {
        setReplyTarget(ctxMenuMsg.value);
      }
      hideContextMenu();
    }

    async function ctxCopy() {
      const msg = ctxMenuMsg.value;
      if (!canCopyText(msg)) return;
      hideContextMenu();
      try {
        await copyToClipboardText(messageTextPreview(msg));
        try { ElementPlus.ElMessage.success('已复制'); } catch (e) {}
      } catch (e) {
        try { ElementPlus.ElMessage.error('复制失败'); } catch (e2) {}
      }
    }

    function canSaveAttachment(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isRecalledMessage(m)) return false;
        const t = String(m.type || '').toLowerCase();
        if (t === 'file' || t === 'video' || t === 'emoji' || t === 'sticker') {
          const url = fileOriginalUrl(m) || fileDisplayUrl(m);
          return !!(url && String(url).trim());
        }
        if (isImageFile(m) || isVideoFile(m)) {
          const url = fileOriginalUrl(m) || fileDisplayUrl(m);
          return !!(url && String(url).trim());
        }
        return false;
      } catch (e) { return false; }
    }

    async function downloadAttachment(msg) {
      try {
        if (!msg) throw new Error('empty');
        const url = fileOriginalUrl(msg) || fileDisplayUrl(msg);
        if (!url) throw new Error('no url');
        let filename = (msg.content && (msg.content.filename || msg.content.name)) || '';
        if (!filename) {
          try {
            const u = new URL(url, window.location.href);
            const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
            filename = seg || (u.search ? ('file' + u.search) : 'download');
          } catch (e) {
            filename = 'download';
          }
        }

        try {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) throw new Error('fetch failed');
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (e) {} }, 5000);
          try { document.body.removeChild(a); } catch (e) {}
          return;
        } catch (e) {
          window.open(url, '_blank');
          return;
        }
      } catch (e) {
        try { ElementPlus.ElMessage.error('保存失败'); } catch (e2) {}
      }
    }

    async function ctxSave() {
      try {
        const msg = ctxMenuMsg.value;
        if (!canSaveAttachment(msg)) return;
        hideContextMenu();
        await downloadAttachment(msg);
        try { ElementPlus.ElMessage.success('已开始下载'); } catch (e) {}
      } catch (e) {}
    }

    function canMentionFromMessage(m) {
      try {
        if (isGlobalChat.value) return false;
        if (!isGroupChat.value) return false;
        if (!m || typeof m !== 'object') return false;
        const from = m.from_user || m.fromUser || m.from || '';
        if (!from) return false;
        if (selfUserId.value && String(from) === String(selfUserId.value)) return false;
        return true;
      } catch (e) {
        return false;
      }
    }

    function ctxMention() {
      try {
        const m = ctxMenuMsg.value;
        if (!canMentionFromMessage(m)) return;
        const from = m.from_user || m.fromUser || m.from;
        const id = String(from);
        const label = messageAuthorName(m) || userLabel(id) || '未知玩家';
        hideContextMenu();
        insertMention(id, label);
      } catch (e) {
        try { hideContextMenu(); } catch (e2) {}
      }
    }

    function ctxForward() {
      try {
        const msg = ctxMenuMsg.value;
        hideContextMenu();
        openForwardDialog(msg);
      } catch (e) {
        try { hideContextMenu(); } catch (e2) {}
      }
    }

    function canCollectEmoji(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (!m.id) return false;
        const t = String(m.type || '').toLowerCase();
        return t === 'emoji' || t === 'sticker';
      } catch (e) {
        return false;
      }
    }

    function canForwardMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isGlobalChat.value) return false;
        if (isRecalledMessage(m)) return false;
        if (!m.id) return false;
        const id = String(m.id);
        if (id.startsWith('local-') || id.startsWith('temp_')) return false;
        if (m.__status === 'sending') return false;

        const t = String(m.type || '').toLowerCase();
        if (t === 'recalled') return false;

        if (t === 'text' || t === 'emoji' || t === 'sticker' || t === 'coordinate' || t === 'player_card' || t === 'file' || t === 'video') {
          if (t === 'file' || t === 'video') {
            const c = m.content;
            return !!(c && typeof c === 'object' && (c.url || c.__localUrl));
          }
          return true;
        }

        return !!String(messageTextPreview(m) || '').trim();
      } catch (e) {
        return false;
      }
    }

    function forwardSourcePreviewText(m) {
      try {
        if (!m) return '';
        const tag = messagePreviewTag(m);
        const suffix = messagePreviewSuffix(m);
        if (tag) return suffix ? `[${tag}] ${suffix}` : `[${tag}]`;
        const t = String(messagePreviewText(m) || messageTextPreview(m) || '').trim();
        return t || '（消息）';
      } catch (e) {
        return '（消息）';
      }
    }

    async function loadForwardChats() {
      const res = await safeFetch(`${apiBase.value}/chats`);
      if (!res.ok) throw new Error('load chats failed');
      const list = await res.json().catch(() => []);
      forwardChats.value = Array.isArray(list) ? list : [];
    }

    async function openForwardDialog(msg) {
      try {
        if (!canForwardMessage(msg)) {
          try { ElementPlus.ElMessage.warning('该消息不支持转发'); } catch (e0) {}
          return;
        }
        if (!Array.isArray(forwardChats.value) || forwardChats.value.length === 0) {
          try { await loadForwardChats(); } catch (e1) {}
        }
        forwardSourceMsg.value = msg;
        forwardTargetChatId.value = '';
        forwardDialogVisible.value = true;
      } catch (e) {
        try { forwardDialogVisible.value = false; } catch (e2) {}
      }
    }

    async function confirmForward() {
      try {
        if (forwardSending.value) return;
        const src = forwardSourceMsg.value;
        const targetId = String(forwardTargetChatId.value || '').trim();
        if (!src) return;
        if (!targetId) return ElementPlus.ElMessage.warning('请选择目标会话');
        if (targetId === 'global') return ElementPlus.ElMessage.warning('不可转发到全服聊天');

        const target = (forwardTargets.value || []).find((x) => x && String(x.id) === targetId);
        const targetName = target ? String(target.displayName || target.name || '') : '目标会话';

        try {
          await ElementPlus.ElMessageBox.confirm(
            `确认转发到「${targetName}」？\n\n内容：${forwardSourcePreviewText(src)}`,
            '转发',
            {
              confirmButtonText: '确认转发',
              cancelButtonText: '取消',
              type: 'warning',
              closeOnClickModal: false,
              closeOnPressEscape: true,
            }
          );
        } catch (e2) {
          return;
        }

        forwardSending.value = true;
        const res = await safeFetch(`${apiBase.value}/messages/forward`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: String(src.id || ''), chatId: String(targetId) }),
        });
        if (!res.ok) {
          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e3) {}
          if (!err) err = `转发失败 (${res.status})`;
          throw new Error(err);
        }
        await res.json().catch(() => null);
        forwardDialogVisible.value = false;
        ElementPlus.ElMessage.success('已转发');
      } catch (e) {
        const m = e && e.message ? String(e.message) : '转发失败';
        try { ElementPlus.ElMessage.error(m); } catch (e2) {}
      } finally {
        forwardSending.value = false;
      }
    }

    function cancelForwardDialog() {
      try {
        forwardDialogVisible.value = false;
      } catch (e) {}
    }

    function canCopyText(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isRecalledMessage(m)) return false;
        const t = String(m.type || '').toLowerCase();
        if (t === 'file' || t === 'emoji' || t === 'sticker') return false;
        const txt = String(messageTextPreview(m) || '').trim();
        return !!txt;
      } catch (e) {
        return false;
      }
    }

    async function copyToClipboardText(text) {
      const s = String(text || '');
      if (!s) throw new Error('empty');

      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(s);
          return;
        }
      } catch (e) {
        // fall through
      }

      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('copy failed');
    }

    async function ctxCollectEmoji() {
      const msg = ctxMenuMsg.value;
      if (!canCollectEmoji(msg)) return;
      hideContextMenu();

      try {
        const res = await safeFetch(`${apiBase.value}/emoji/collect/${encodeURIComponent(msg.id)}`, {
          method: 'POST',
        });
        if (res.ok) {
          try { ElementPlus.ElMessage.success('已添加到表情包'); } catch (e) {}
          try { await loadEmojiPacks(); } catch (e2) {}
          return;
        }

        let err = '';
        try {
          const data = await res.json().catch(() => null);
          err = data && (data.error || data.message) ? String(data.error || data.message) : '';
        } catch (e) {}
        if (!err) err = `操作失败 (${res.status})`;
        try {
          if (res.status === 400) ElementPlus.ElMessage.warning(err);
          else ElementPlus.ElMessage.error(err);
        } catch (e2) {}
      } catch (e) {
        try { ElementPlus.ElMessage.error('添加失败'); } catch (e2) {}
      }
    }

    function setReplyTarget(m) {
      if (isGlobalChat.value) return;
      replyTarget.value = m;
    }

    function connectSocket() {
      if (socket.value?.connected) return;
      const rawApiBase = String(apiBase.value || '').trim();
      const useDirect = /^https?:\/\//i.test(rawApiBase);
      let socketUrl = window.location.origin;
      try {
        if (useDirect) socketUrl = new URL(rawApiBase).origin;
      } catch (e) {
        if (useDirect) socketUrl = rawApiBase.replace(/\/$/, '');
      }
      const socketPath = useDirect ? '/socket.io' : '/api/socket.io';

      const opts = {
        path: socketPath,
        transports: ['websocket', 'polling'],
        withCredentials: true,
      };
      const t = token.value;
      if (t) opts.auth = { token: t };

      const s = window.io(socketUrl, opts);
      socket.value = s;

      function extractChatFromPayload(payload) {
        try {
          if (!payload) return null;
          if (payload.chat && typeof payload.chat === 'object') return payload.chat;
          if (payload.data && payload.data.chat && typeof payload.data.chat === 'object') return payload.data.chat;
          if (payload.id && payload.type) return payload;
          return null;
        } catch (e) {
          return null;
        }
      }

      function extractChatIdFromPayload(payload) {
        try {
          if (!payload) return null;
          const cid = payload.chatId || payload.chat_id || payload.id;
          if (cid !== undefined && cid !== null && String(cid)) return String(cid);
          const chat = extractChatFromPayload(payload);
          if (chat && (chat.id !== undefined && chat.id !== null)) return String(chat.id);
          return null;
        } catch (e) {
          return null;
        }
      }

      async function refreshCurrentChatMetaIfAffected(chatId) {
        try {
          const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
          if (!cid) return;
          if (!currentChatId.value || String(currentChatId.value) !== cid) return;
          if (cid === 'global') return;

          const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
          if (!metaRes.ok) return;
          const meta = await metaRes.json().catch(() => null);
          if (!meta || typeof meta !== 'object') return;

          currentChatMeta.value = meta;
          currentChatTitle.value = meta.displayName || meta.name || currentChatTitle.value;
          if (String(meta.type || '').toLowerCase() === 'group') {
            currentChatTitle.value = meta.displayName || meta.name || '群聊';
            groupOwnerId.value = meta.created_by !== undefined && meta.created_by !== null ? String(meta.created_by) : groupOwnerId.value;
            try { loadGroupAdmins(cid); } catch (e) {}
          }
        } catch (e) {}
      }

      s.on('connect', () => {
        if (currentChatId.value && currentChatId.value !== joinedChatId.value) {
          s.emit('join', currentChatId.value);
          joinedChatId.value = currentChatId.value;
        }
      });

      s.on('message.created', async (msg) => {
        try {
          const chatId = msg.chatId || msg.chat_id;
          if (!currentChatId.value) return;
          if (chatId && String(chatId) !== String(currentChatId.value)) return;

          if (isAuditRecalledMessage(msg)) return;

          normalizeMessage(msg, currentChatId.value === 'global');
          if (!msg.id) return;

          // already have this server message
          if (msgById[msg.id]) {
            try {
              Object.assign(msgById[msg.id], msg);
            } catch (e) {}
            return;
          }

          // treat incoming self message as ACK for optimistic one (desktop behavior)
          const optimistic = findOptimisticForAck(msg);
          if (optimistic && optimistic.id) {
            ackOptimisticMessage(optimistic.id, msg, currentChatId.value === 'global');
          } else {
            msgById[msg.id] = msg;
            messages.value.push(msg);
          }

          try { scheduleChatCacheSave(currentChatId.value); } catch (e0) {}

          await nextTick();
          if (messagesEl.value) {
            messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
          }

          try { queueReadForCurrentChat(); } catch (e0) {}
        } catch (e) {}
      });

      // 监听后端的全服消息事件名，保持与 message.created 相同的本地行为
      s.on('global.message.created', async (msg) => {
        try {
          // 如果当前打开的不是全服会话则忽略
          if (!currentChatId.value || String(currentChatId.value) !== 'global') return;

          if (isAuditRecalledMessage(msg)) return;

          normalizeMessage(msg, true);
          if (!msg.id) return;

          if (msgById[msg.id]) {
            try { Object.assign(msgById[msg.id], msg); } catch (e) {}
            return;
          }

          const optimistic = findOptimisticForAck(msg);
          if (optimistic && optimistic.id) {
            ackOptimisticMessage(optimistic.id, msg, true);
          } else {
            msgById[msg.id] = msg;
            messages.value.push(msg);
          }

          try { scheduleChatCacheSave('global'); } catch (e0) {}

          await nextTick();
        } catch (e) {}
      });

      function onMessageUpdatedLike(payload) {
        try {
          const chatId = payload && (payload.chatId || payload.chat_id);
          const updated = payload && payload.message ? payload.message : payload;
          if (!updated || typeof updated !== 'object') return;

          const cid = chatId || updated.chatId || updated.chat_id || null;
          if (!currentChatId.value) return;
          if (cid && String(cid) !== String(currentChatId.value)) return;

          applyMessageUpdate(cid || currentChatId.value, updated);
        } catch (e) {}
      }

      s.on('message.recalled', onMessageUpdatedLike);
      s.on('message.updated', onMessageUpdatedLike);

      // --- Read receipt realtime events ---
      // Note: server sends absolute readCount (not a delta).
      function applyReadEventToLocalState(payload) {
        try {
          const cid = payload && (payload.chatId || payload.chat_id);
          const current = currentChatId.value;
          if (cid && current && String(cid) !== String(current)) return;

          const messageId = payload && (payload.messageId || payload.id);
          const userId = payload && (payload.userId || payload.uid);
          if (!messageId) return;

          const mid = String(messageId);
          const m = msgById[mid];
          if (!m) return;

          // Single chat: mark my outgoing messages as read when the other user reads.
          try {
            const fromUser = m.from_user || m.fromUser || m.from;
            if (selfUserId.value && fromUser && String(fromUser) === String(selfUserId.value)) {
              if (userId && String(userId) !== String(selfUserId.value)) {
                const rawRead = payload && (payload.read ?? payload.isRead ?? payload.is_read);
                if (rawRead === undefined || rawRead === null || rawRead === '') m.read = true;
                else m.read = !!rawRead;
              }
            }
          } catch (e1) {}

          // Group chat: overwrite absolute readCount.
          try {
            if (isGroupChat.value) {
              const raw =
                payload && (payload.readCount ?? payload.read_count ?? payload.count ?? payload.readers ?? payload.readUsers);
              const n = Number(raw);
              if (Number.isFinite(n)) {
                m.readCount = Math.max(0, Math.floor(n));
              }
            }
          } catch (e2) {}

          // Trigger reactive update for messages list.
          try {
            const list = Array.isArray(messages.value) ? messages.value : [];
            const idx = list.findIndex((x) => x && x.id && String(x.id) === mid);
            if (idx >= 0) {
              list.splice(idx, 1, Object.assign({}, list[idx], m));
              messages.value = list;
            }
          } catch (e3) {}
        } catch (e) {}
      }

      s.on('message.read', (payload) => {
        try {
          applyReadEventToLocalState(payload || {});
        } catch (e) {}
      });

      s.on('message.read.batch', (payload) => {
        try {
          const p = payload || {};
          const baseChatId = p.chatId || p.chat_id;
          const baseUserId = p.userId || p.uid;

          const items = Array.isArray(p.items)
            ? p.items
            : (Array.isArray(p.messages) ? p.messages : (Array.isArray(p.list) ? p.list : null));
          if (items && Array.isArray(items)) {
            for (const it of items) {
              if (!it) continue;
              const mid = it.messageId || it.id;
              if (!mid) continue;
              applyReadEventToLocalState({
                chatId: baseChatId,
                messageId: mid,
                userId: baseUserId,
                readCount: it.readCount ?? it.read_count ?? it.count,
                read: it.read ?? it.isRead ?? it.is_read,
              });
            }
            return;
          }

          const ids = Array.isArray(p.messageIds) ? p.messageIds : (Array.isArray(p.ids) ? p.ids : []);
          const countsMap = p.counts || p.readCounts || p.read_counts;
          for (const id of ids) {
            const k = id !== undefined && id !== null ? String(id) : '';
            const rc = countsMap && k ? (countsMap[k] ?? countsMap[Number(k)]) : undefined;
            applyReadEventToLocalState({ chatId: baseChatId, messageId: id, userId: baseUserId, readCount: rc });
          }
        } catch (e) {}
      });

      // --- Group/chat lifecycle events (affect current chat UI) ---
      s.on('chat.updated', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          // If payload contains full chat, update title quickly; still refresh meta best-effort.
          const chat = extractChatFromPayload(payload);
          if (chat && currentChatId.value && String(currentChatId.value) === String(cid)) {
            const t = String(chat.type || '').toLowerCase();
            if (t === 'group') {
              currentChatTitle.value = chat.displayName || chat.name || '群聊';
            } else {
              currentChatTitle.value = chat.displayName || chat.name || currentChatTitle.value;
            }
            if (chat.created_by !== undefined && chat.created_by !== null) {
              groupOwnerId.value = String(chat.created_by);
            }
            currentChatMeta.value = Object.assign({}, currentChatMeta.value || {}, chat);
          }
          await refreshCurrentChatMetaIfAffected(cid);
        } catch (e) {}
      });

      s.on('chat.renamed', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          if (!currentChatId.value || String(currentChatId.value) !== String(cid)) return;
          const name = payload && (payload.name !== undefined ? payload.name : payload.chatName);
          if (name !== undefined) {
            const isGroup = String((currentChatMeta.value && currentChatMeta.value.type) || '').toLowerCase() === 'group';
            currentChatTitle.value = isGroup ? (name || '群聊') : (String(name) || currentChatTitle.value);
          }
          await refreshCurrentChatMetaIfAffected(cid);
        } catch (e) {}
      });

      s.on('chat.admins.changed', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          if (!currentChatId.value || String(currentChatId.value) !== String(cid)) return;
          if (payload && payload.ownerId !== undefined && payload.ownerId !== null) {
            groupOwnerId.value = String(payload.ownerId);
          }
          if (payload && Array.isArray(payload.admins)) {
            groupAdmins.value = payload.admins.map(String);
          } else {
            try { loadGroupAdmins(cid); } catch (e2) {}
          }
        } catch (e) {}
      });

      s.on('chat.owner.changed', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          if (!currentChatId.value || String(currentChatId.value) !== String(cid)) return;
          const ownerId = payload && (payload.ownerId !== undefined ? payload.ownerId : payload.newOwnerId);
          if (ownerId !== undefined && ownerId !== null) groupOwnerId.value = String(ownerId);
          try { loadGroupAdmins(cid); } catch (e2) {}
          await refreshCurrentChatMetaIfAffected(cid);
        } catch (e) {}
      });

      s.on('chat.members.added', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          await refreshCurrentChatMetaIfAffected(cid);
        } catch (e) {}
      });

      s.on('chat.members.removed', async (payload) => {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          await refreshCurrentChatMetaIfAffected(cid);
        } catch (e) {}
      });

      function handleChatRemovedLike(payload, tip) {
        try {
          const cid = extractChatIdFromPayload(payload);
          if (!cid) return;
          if (!currentChatId.value || String(currentChatId.value) !== String(cid)) return;
          try {
            if (tip) ElementPlus.ElMessage.warning(tip);
          } catch (e2) {}
          goBack();
        } catch (e) {}
      }

      s.on('chat.dissolved', (p) => handleChatRemovedLike(p, '群聊已解散'));
      s.on('chat.deleted', (p) => handleChatRemovedLike(p, '会话已删除'));
      s.on('chat.kicked', (p) => handleChatRemovedLike(p, '你已被移出群聊'));
    }

    function joinSocketRoom(chatId) {
      if (socket.value?.connected) {
        socket.value.emit('join', chatId);
        joinedChatId.value = chatId;
      }
    }

    function scrollMessagesToBottom() {
      try {
        const el = messagesEl.value;
        if (!el) return;
        const doScroll = () => {
          try {
            const top = el.scrollHeight;
            if (typeof el.scrollTo === 'function') {
              el.scrollTo({ top, behavior: 'auto' });
            } else {
              el.scrollTop = top;
            }
          } catch (e) {}
        };

        // iOS/WebView sometimes needs multiple layout frames before scrollHeight is stable.
        doScroll();
        requestAnimationFrame(() => doScroll());
        setTimeout(() => doScroll(), 60);
      } catch (e) {}
    }

    function messageSortKey(m) {
      try {
        if (!m || typeof m !== 'object') return 0;
        const raw = m.created_at ?? m.createdAt;
        const ms = raw ? Date.parse(String(raw)) : NaN;
        if (!Number.isNaN(ms) && ms > 0) return ms;
        // fallback: temp_ or numeric id may contain time-ish
        const id = m.id !== undefined && m.id !== null ? String(m.id) : '';
        const m2 = id.match(/(\d{10,13})/);
        if (m2 && m2[1]) {
          const n = Number(m2[1]);
          if (!Number.isNaN(n) && n > 0) return n;
        }
        return 0;
      } catch (e) {
        return 0;
      }
    }

    function mergeMessagesServerFirst(serverMsgs, cachedMsgs) {
      try {
        const merged = [];
        const byId = Object.create(null);

        function textContentOf(m) {
          try {
            if (!m) return '';
            const c = m.content;
            if (c === null || c === undefined) return '';
            if (typeof c === 'string') return c;
            if (typeof c === 'object') {
              if (c.text !== undefined && c.text !== null) return String(c.text);
              if (c.content !== undefined && c.content !== null) return String(c.content);
            }
            return '';
          } catch (e) {
            return '';
          }
        }

        function fingerprintOf(m) {
          try {
            const from = m && (m.from_user ?? m.fromUser ?? m.from);
            const type = String((m && m.type) || 'text').toLowerCase();
            if (type !== 'text') return '';
            const text = textContentOf(m).trim();
            if (!from || !text) return '';
            return `${String(from)}|text|${text.slice(0, 200)}`;
          } catch (e) {
            return '';
          }
        }

        function isOptimisticTemp(m) {
          try {
            if (!m || !m.id) return false;
            const id = String(m.id);
            if (/^temp_/.test(id)) return true;
            const st = String(m.__status || '').toLowerCase();
            return st === 'sending' || st === 'failed';
          } catch (e) {
            return false;
          }
        }

        const serverFpTimes = Object.create(null);

        const sArr = Array.isArray(serverMsgs) ? serverMsgs : [];
        const cArr = Array.isArray(cachedMsgs) ? cachedMsgs : [];

        for (const m of sArr) {
          if (!m || !m.id || isAuditRecalledMessage(m)) continue;
          const id = String(m.id);
          byId[id] = m;
          merged.push(m);

          const fp = fingerprintOf(m);
          if (fp) {
            const t = messageSortKey(m);
            if (!serverFpTimes[fp]) serverFpTimes[fp] = [];
            serverFpTimes[fp].push(t);
          }
        }

        //补上缓存里有、服务端暂未返回的消息（例如未 ACK 的 temp 消息/网络抖动）。
        for (const m of cArr) {
          if (!m || !m.id || isAuditRecalledMessage(m)) continue;
          const id = String(m.id);
          if (byId[id]) continue;

          // Drop cached optimistic temp if server already has the same message.
          if (isOptimisticTemp(m)) {
            const fp = fingerprintOf(m);
            if (fp && Array.isArray(serverFpTimes[fp]) && serverFpTimes[fp].length > 0) {
              const t = messageSortKey(m);
              const hit = serverFpTimes[fp].some((x) => Math.abs((Number(x) || 0) - (Number(t) || 0)) <= 1000 * 60 * 3);
              if (hit) continue;
            }
          }

          byId[id] = m;
          merged.push(m);
        }

        merged.sort((a, b) => messageSortKey(a) - messageSortKey(b));
        return trimMessagesForCache(merged);
      } catch (e) {
        return trimMessagesForCache(serverMsgs);
      }
    }

    async function openChat(id) {
      const alreadyHydrated =
        cacheHydratedChatId.value &&
        String(cacheHydratedChatId.value) === String(id) &&
        Array.isArray(messages.value) &&
        messages.value.length > 0;

      // If we already rendered from cache, avoid blocking UI with a big spinner.
      chatLoading.value = !alreadyHydrated;
      currentChatId.value = id;
      if (!alreadyHydrated) currentChatMeta.value = null;
      const isGlobal = id === 'global';

      loadingMore.value = false;
      noMoreBefore.value = false;

      try {
        if (isGlobal) {
          currentChatTitle.value = '全服';
          currentChatFaceUrl.value = '/img/Ag_0404.png';
        } else {
          const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(id)}`);
          if (metaRes.ok) {
            const chatMeta = await metaRes.json().catch(() => null);
            if (!chatMeta || typeof chatMeta !== 'object') {
              // keep going to message loading
            } else {
            currentChatMeta.value = chatMeta;
            currentChatTitle.value = chatMeta.displayName || chatMeta.name || '';
            const isGroup = String(chatMeta.type || '').toLowerCase() === 'group';
            if (isGroup) {
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '群聊';
              groupOwnerId.value = chatMeta.created_by !== undefined && chatMeta.created_by !== null ? String(chatMeta.created_by) : groupOwnerId.value;
              try { loadGroupAdmins(id); } catch (e) {}

              try {
                const av = extractChatAvatarUrl(chatMeta);
                if (av) currentChatFaceUrl.value = av;
              } catch (e) {}
            }
            const members = chatMeta.members || chatMeta.memberIds || [];
            if (!isGroup && selfUserId.value) {
              const selfId = String(selfUserId.value);
              if (Array.isArray(members) && members.length === 1 && String(members[0]) === selfId) {
                currentChatFaceUrl.value = getCachedFaceUrl(selfId);
                if (!currentChatTitle.value) currentChatTitle.value = '我';
              } else if (Array.isArray(members) && members.length === 2) {
                const a = String(members[0]);
                const b = String(members[1]);
                if (a === selfId && b === selfId) {
                  currentChatFaceUrl.value = getCachedFaceUrl(selfId);
                  if (!currentChatTitle.value) currentChatTitle.value = '我';
                } else {
                  const otherId = [a, b].find((m) => String(m) !== selfId);
                  if (otherId) {
                    currentChatFaceUrl.value = getCachedFaceUrl(otherId);
                    if (!currentChatTitle.value) {
                      currentChatTitle.value = userNameCache[otherId] || '对方';
                    }
                  }
                }
              }
            }
            }
          }
        }

        const msgUrl = buildMessagesUrl(id, { limit: INITIAL_LIMIT });
        
        const res = await safeFetch(msgUrl);
        if (!res.ok) throw new Error('加载消息失败');
        let msgs = await res.json();

        // Safety: if backend ignores limit and returns full history, only render latest initial page.
        if (Array.isArray(msgs) && msgs.length > INITIAL_LIMIT) msgs = msgs.slice(-INITIAL_LIMIT);

        // Silent audit recall: never render these messages.
        if (Array.isArray(msgs)) msgs = msgs.filter((m) => !isAuditRecalledMessage(m));

        // Reconcile: server is authoritative, cache is a fast preview.
        const cachedSnapshot = alreadyHydrated ? (Array.isArray(messages.value) ? messages.value.slice() : []) : [];

        msgs.forEach(m => {
          normalizeMessage(m, isGlobal);
        });

        const merged = mergeMessagesServerFirst(msgs, cachedSnapshot);
        messages.value = [];
        for (const k of Object.keys(msgById)) delete msgById[k];
        for (const m of merged) {
          if (m && m.id && !isAuditRecalledMessage(m)) msgById[String(m.id)] = m;
        }
        messages.value = merged;

        noMoreBefore.value = !Array.isArray(msgs) || msgs.length < INITIAL_LIMIT;

        try { scheduleChatCacheSave(id); } catch (e0) {}

        await nextTick();
        scrollMessagesToBottom();

        try {
          queueReadForCurrentChat();
          flushReadReportOnce();
        } catch (e) {}

        connectSocket();
        joinSocketRoom(id);
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('无法打开会话');
      } finally {
        chatLoading.value = false;
        await nextTick();
        scrollMessagesToBottom();

        // After a successful open, this chat is now hydrated (regardless of source).
        try { cacheHydratedChatId.value = String(id); } catch (e) {}
      }
    }

    async function loadMoreMessages() {
      if (!currentChatId.value) return;
      if (loadingMore.value || noMoreBefore.value) return;
      if (!messagesEl.value) return;
      const first = (messages.value || [])[0];
      if (!first || !first.id) return;

      loadingMore.value = true;
      const beforeId = first.id;
      const isGlobal = currentChatId.value === 'global';

      try {
        const url = buildMessagesUrl(currentChatId.value, { beforeId, limit: PAGE_LIMIT });

        const prevScrollHeight = messagesEl.value.scrollHeight;
        const prevScrollTop = messagesEl.value.scrollTop;

        const res = await safeFetch(url);
        if (!res.ok) throw new Error('load more failed');
        let more = await res.json().catch(() => null);
        if (!Array.isArray(more) || more.length === 0) {
          noMoreBefore.value = true;
          return;
        }

        if (Array.isArray(more)) more = more.filter((m) => !isAuditRecalledMessage(m));

        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id && !isAuditRecalledMessage(m)) msgById[m.id] = m;
        });

        messages.value = more.concat(messages.value).filter((m) => !isAuditRecalledMessage(m)).map((m) => normalizeMessage(m, isGlobal));

        try { scheduleChatCacheSave(currentChatId.value); } catch (e0) {}

        await nextTick();
        const newScrollHeight = messagesEl.value.scrollHeight;
        messagesEl.value.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;

        if (more.length < PAGE_LIMIT) noMoreBefore.value = true;
      } catch (e) {
        // ignore
      } finally {
        loadingMore.value = false;
      }
    }

    async function sendText() {
      try {
        if (isRichInputActive()) syncStateFromRichInput();
      } catch (e) {}
      const text = (msgInput.value || '').trim();
      if (!currentChatId.value) return;

      // Snapshot mentions (group chat only) - independent from text.
      let mentionIds = [];
      let mentionAll = false;
      try {
        if (!isGlobalChat.value && isGroupChat.value) {
          const list = Array.isArray(pendingMentions.value) ? pendingMentions.value : [];
          mentionIds = list.filter((x) => x && x.userId).map((x) => String(x.userId));
          mentionIds = Array.from(new Set(mentionIds.filter(Boolean)));
          mentionAll = !!pendingMentionAll.value;
        }
      } catch (e) {
        mentionIds = [];
        mentionAll = false;
      }

      if (!text && !(mentionAll || mentionIds.length > 0)) return;

      // Some browsers/WebViews change zoom during input; force restore to 1x.
      restoreViewportScale();

      const tempId = 'temp_' + Date.now() + '_' + Math.random();
      const optimisticMsg = {
        id: tempId,
        type: 'text',
        content:
          !isGlobalChat.value && isGroupChat.value && (mentionAll || mentionIds.length > 0)
            ? { text, mentions: mentionIds.map((id) => ({ userId: id })), mentionAll: !!mentionAll }
            : { text },
        from_user: selfUserId.value,
        created_at: new Date().toISOString(),
        __status: 'sending',
        __own: true,
      };

      // Ensure read UI can render immediately for newly sent messages.
      try {
        if (!isGlobalChat.value && !isSelfChat.value) {
          if (isGroupChat.value) optimisticMsg.readCount = 0;
          else if (isDirectChat.value) optimisticMsg.read = false;
        }
      } catch (e) {}

      if (replyTarget.value && !isGlobalChat.value) {
        optimisticMsg.replied_to = replyTarget.value.id;
      }

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);

      try { scheduleChatCacheSave(currentChatId.value); } catch (e0) {}
      msgInput.value = '';
      clearRichInputDom();
      pendingMentions.value = [];
      pendingMentionAll.value = false;
      mentionDialogVisible.value = false;
      mentionSelectAll.value = false;
      mentionSelectIds.value = [];
      mentionQuery.value = '';
      clearReplyTarget();

      restoreViewportScale();

      await nextTick();
      if (messagesEl.value) {
        messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }

      try {
        const isGlobal = currentChatId.value === 'global';
        const url = isGlobal
          ? `${apiBase.value}/global/messages`
          : `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`;

        const body = isGlobal
          ? { content: text }
          : {
              type: 'text',
              content:
                mentionAll || mentionIds.length > 0
                  ? { text, mentions: mentionIds.map((id) => ({ userId: id })), mentionAll: !!mentionAll }
                  : text,
            };
        if (!isGlobal && optimisticMsg.replied_to) body.repliedTo = optimisticMsg.replied_to;

        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const serverMsg = await res.json();
          ackOptimisticMessage(tempId, serverMsg, isGlobal);
        } else {
          optimisticMsg.__status = 'failed';
        }
      } catch (e) {
        optimisticMsg.__status = 'failed';
      } finally {
        restoreViewportScale();
      }
    }

    // Mention picker state reset on chat switch.
    try {
      watch([currentChatId, isGroupChat], () => {
        mentionDialogVisible.value = false;
        mentionSelectAll.value = false;
        mentionSelectIds.value = [];
        mentionDialogSuppressOnce.value = false;
        mentionTriggerIndex.value = null;
        mentionQuery.value = '';
        pendingMentions.value = [];
        pendingMentionAll.value = false;

        morePanelVisible.value = false;
        playerCardDialogVisible.value = false;
        playerCardSelectedUserId.value = '';
        playerCardQuery.value = '';

        coordinateDialogVisible.value = false;
        coordinateSending.value = false;
        resetCoordinateForm();
      });
    } catch (e) {}

    function openFilePicker() {
      if (isGlobalChat.value) return;
      try {
        const el = fileInputEl.value;
        if (!el) return;
        el.value = '';
        el.click();
      } catch (e) {}
    }

    async function onFileSelected(ev) {
      try {
        const files = ev && ev.target && ev.target.files;
        const file = files && files[0];
        if (!file) return;
        await sendFile(file);
      } finally {
        try {
          if (ev && ev.target) ev.target.value = '';
        } catch (e) {}
      }
    }

    async function sendFile(file) {
      if (!currentChatId.value) return;
      if (isGlobalChat.value) return;

      restoreViewportScale();

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let localUrl = '';
      try {
        localUrl = URL.createObjectURL(file);
      } catch (e) {}

      const optimisticMsg = {
        id: tempId,
        type: 'file',
        content: {
          url: '',
          __localUrl: localUrl,
          filename: file.name,
          mimetype: file.type,
        },
        from_user: selfUserId.value || '__me__',
        created_at: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };

      // Ensure read UI can render immediately for newly sent messages.
      try {
        if (!isGlobalChat.value && !isSelfChat.value) {
          if (isGroupChat.value) optimisticMsg.readCount = 0;
          else if (isDirectChat.value) optimisticMsg.read = false;
        }
      } catch (e) {}

      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value.id;

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      restoreViewportScale();

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'file');
        if (replyTarget.value) fd.append('repliedTo', replyTarget.value.id || String(replyTarget.value));

        const res = await safeFetch(
          `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`,
          {
            method: 'POST',
            body: fd,
          }
        );
        if (!res.ok) throw new Error('send file failed');
        const serverMsg = await res.json().catch(() => null);
        if (serverMsg) {
          ackOptimisticMessage(tempId, serverMsg, false);
        } else {
          optimisticMsg.__status = 'failed';
        }
        clearReplyTarget();
      } catch (e) {
        optimisticMsg.__status = 'failed';
        try {
          ElementPlus.ElMessage.error('发送文件失败');
        } catch (e2) {}
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        restoreViewportScale();
      }
    }

    function clearReplyTarget() {
      replyTarget.value = null;
    }

    function toggleEmojiPanel() {
      const next = !emojiPanelVisible.value;
      emojiPanelVisible.value = next;
      if (next) morePanelVisible.value = false;
    }

    function toggleMorePanel() {
      const next = !morePanelVisible.value;
      morePanelVisible.value = next;
      if (next) emojiPanelVisible.value = false;
    }

    function fuzzyUserMatch(u, q) {
      try {
        const query = String(q || '').trim().toLowerCase();
        if (!query) return true;
        const name = String((u && u.username) || '').toLowerCase();
        return name.includes(query);
      } catch (e) {
        return false;
      }
    }

    const playerCardOptions = computed(() => {
      try {
        const q = playerCardQuery.value || '';
        return (allUsersList.value || [])
          .filter((u) => u && u.id)
          .filter((u) => fuzzyUserMatch(u, q))
          .slice(0, 5)
          .map((u) => ({ id: String(u.id), username: String(u.username || u.displayName || u.name || u.id) }));
      } catch (e) {
        return [];
      }
    });

    async function ensureUsersLoadedForPlayerCard() {
      try {
        if (playerCardUsersLoading.value) return;
        if (Array.isArray(allUsersList.value) && allUsersList.value.length > 0) return;
        playerCardUsersLoading.value = true;
        await loadAllUsersList();
      } finally {
        playerCardUsersLoading.value = false;
      }
    }

    async function openPlayerCardDialog() {
      if (isGlobalChat.value) return;
      morePanelVisible.value = false;
      playerCardDialogVisible.value = true;
      playerCardSelectedUserId.value = '';
      playerCardQuery.value = '';
      await ensureUsersLoadedForPlayerCard();
    }

    function cancelPlayerCardDialog() {
      playerCardDialogVisible.value = false;
      playerCardSending.value = false;
    }

    function onPlayerCardQuery(q) {
      playerCardQuery.value = String(q || '');
    }

    async function confirmSendPlayerCard() {
      if (isGlobalChat.value) return;
      if (!currentChatId.value) return;

      const userId = playerCardSelectedUserId.value ? String(playerCardSelectedUserId.value) : '';
      if (!userId) {
        try {
          ElementPlus.ElMessage.warning('请选择一个玩家');
        } catch (e) {}
        return;
      }

      playerCardSending.value = true;
      morePanelVisible.value = false;

      const tempId = 'temp_pc_' + Date.now() + '_' + Math.random();
      const selected = (allUsersList.value || []).find((u) => String(u.id) === String(userId));
      const optimisticMsg = {
        id: tempId,
        type: 'player_card',
        content: { uid: userId, name: selected ? selected.username : userId },
        from_user: selfUserId.value,
        created_at: new Date().toISOString(),
        __status: 'sending',
        __own: true,
      };

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);

      playerCardDialogVisible.value = false;

      await nextTick();
      try {
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      } catch (e) {}

      try {
        const url = `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/player-card`;
        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, false);
        } else {
          optimisticMsg.__status = 'failed';
        }
      } catch (e) {
        optimisticMsg.__status = 'failed';
      } finally {
        playerCardSending.value = false;
        await nextTick();
        try {
          if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        } catch (e) {}
      }
    }

    function resetCoordinateForm() {
      try {
        coordinateForm.name = '';
        coordinateForm.dimension = 'world';
        coordinateForm.x = '';
        coordinateForm.y = '';
        coordinateForm.z = '';
        coordinateForm.description = '';
        coordinateHomeSelected.value = '';
      } catch (e) {}
    }

    function isVanillaWorldKeyForHome(v) {
      const s = String(v || '').trim();
      return s === 'world' || s === 'world_nether' || s === 'world_the_end';
    }

    function worldLabelFromHomeKey(k) {
      const key = String(k || '').trim();
      if (key === 'world') return '主世界';
      if (key === 'world_nether') return '下界';
      if (key === 'world_the_end') return '末地';
      return key || '-';
    }

    function normalizeWorldKeyFromHome(homeObj) {
      try {
        if (!homeObj || typeof homeObj !== 'object') return '';
        const wn = homeObj['world-name'] || homeObj.world_name || homeObj.worldName || '';
        if (isVanillaWorldKeyForHome(wn)) return String(wn).trim();
        const w = homeObj.world || '';
        if (isVanillaWorldKeyForHome(w)) return String(w).trim();
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
            const xNum = Number(h.x);
            const yNum = Number(h.y);
            const zNum = Number(h.z);
            return {
              name: String(name),
              worldKey: worldKey || '',
              worldLabel: worldLabelFromHomeKey(worldKey),
              x: Number.isFinite(xNum) ? String(Math.round(xNum)) : h.x === undefined || h.x === null ? '' : String(h.x),
              y: Number.isFinite(yNum) ? String(Math.round(yNum)) : h.y === undefined || h.y === null ? '' : String(h.y),
              z: Number.isFinite(zNum) ? String(Math.round(zNum)) : h.z === undefined || h.z === null ? '' : String(h.z),
            };
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      } catch (e) {
        return [];
      }
    }

    async function loadCoordinateHomes(force) {
      try {
        if (coordinateHomeLoading.value) return;
        if (!force && Array.isArray(coordinateHomes.value) && coordinateHomes.value.length > 0) return;
        coordinateHomeLoading.value = true;
        const res = await safeFetch(`${apiBase.value}/info/getPlayerData`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        coordinateHomes.value = parseHomesFromPlayerData(data);
      } catch (e) {
        try { ElementPlus.ElMessage.error('Home 加载失败'); } catch (e2) {}
      } finally {
        coordinateHomeLoading.value = false;
      }
    }

    function importCoordinateFromHome() {
      try {
        const homeName = String(coordinateHomeSelected.value || '').trim();
        if (!homeName) {
          try { ElementPlus.ElMessage.warning('请选择 Home'); } catch (e0) {}
          return;
        }
        const list = Array.isArray(coordinateHomes.value) ? coordinateHomes.value : [];
        const h = list.find((x) => x && String(x.name) === homeName);
        if (!h) {
          try { ElementPlus.ElMessage.warning('未找到该 Home'); } catch (e1) {}
          return;
        }

        const allowedDims = new Set(['world', 'world_nether', 'world_the_end']);
        const worldKey = String(h.worldKey || '').trim();
        if (worldKey && allowedDims.has(worldKey)) {
          coordinateForm.dimension = worldKey;
        } else if (worldKey) {
          try { ElementPlus.ElMessage.warning('该 Home 的世界不支持（仅主世界/下界/末地）'); } catch (e2) {}
        }
        coordinateForm.name = String(h.name || '').trim();
        coordinateForm.x = String(h.x ?? '').trim();
        coordinateForm.y = String(h.y ?? '').trim();
        coordinateForm.z = String(h.z ?? '').trim();
      } catch (e) {}
    }

    function openCoordinateDialog() {
      if (isGlobalChat.value) return;
      if (!currentChatId.value) return;
      morePanelVisible.value = false;
      coordinateSending.value = false;
      resetCoordinateForm();
      loadCoordinateHomes(false);
      coordinateDialogVisible.value = true;
    }

    function cancelCoordinateDialog() {
      coordinateDialogVisible.value = false;
      coordinateSending.value = false;
      resetCoordinateForm();
    }

    function parseFiniteNumberInput(v) {
      try {
        if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? v : null;
        const s = String(v ?? '').trim();
        if (!s) return null;
        if (!/^-?\d+$/.test(s)) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      } catch (e) {
        return null;
      }
    }

    async function confirmSendCoordinate() {
      if (isGlobalChat.value) return;
      if (!currentChatId.value) return;

      const name = String(coordinateForm.name || '').trim();
      const dimension = String(coordinateForm.dimension || '').trim();
      const x = parseFiniteNumberInput(coordinateForm.x);
      const y = parseFiniteNumberInput(coordinateForm.y);
      const z = parseFiniteNumberInput(coordinateForm.z);
      const descriptionRaw = String(coordinateForm.description || '').trim();
      const description = descriptionRaw ? descriptionRaw : null;

      if (!name) {
        try { ElementPlus.ElMessage.warning('请输入坐标点名称'); } catch (e) {}
        return;
      }
      if (!dimension) {
        try { ElementPlus.ElMessage.warning('请输入维度'); } catch (e) {}
        return;
      }

      try {
        const allowedDims = new Set(['world', 'world_nether', 'world_the_end']);
        if (!allowedDims.has(dimension)) {
          try { ElementPlus.ElMessage.warning('请选择维度（主世界/下界/末地）'); } catch (e2) {}
          return;
        }
      } catch (e) {}
      if (x === null || y === null || z === null) {
        try { ElementPlus.ElMessage.warning('请输入有效的 X / Y / Z 整数'); } catch (e) {}
        return;
      }

      coordinateSending.value = true;
      morePanelVisible.value = false;

      const tempId = 'temp_coord_' + Date.now() + '_' + Math.random();
      const content = { name, dimension, x, y, z, description };
      const optimisticMsg = {
        id: tempId,
        type: 'coordinate',
        content,
        from_user: selfUserId.value,
        created_at: new Date().toISOString(),
        __status: 'sending',
        __own: true,
      };

      // Ensure read UI can render immediately for newly sent messages.
      try {
        if (!isGlobalChat.value && !isSelfChat.value) {
          if (isGroupChat.value) optimisticMsg.readCount = 0;
          else if (isDirectChat.value) optimisticMsg.read = false;
        }
      } catch (e) {}

      if (replyTarget.value && !isGlobalChat.value) {
        optimisticMsg.replied_to = replyTarget.value.id;
      }

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);

      coordinateDialogVisible.value = false;
      resetCoordinateForm();
      clearReplyTarget();

      await nextTick();
      try {
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      } catch (e) {}

      try {
        const url = `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`;
        const body = { type: 'coordinate', content };
        if (optimisticMsg.replied_to) body.repliedTo = optimisticMsg.replied_to;

        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res && res.ok) {
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, false);
        } else {
          optimisticMsg.__status = 'failed';
          try { ElementPlus.ElMessage.error('发送坐标失败'); } catch (e) {}
        }
      } catch (e) {
        optimisticMsg.__status = 'failed';
        try { ElementPlus.ElMessage.error('发送坐标失败'); } catch (e2) {}
      } finally {
        coordinateSending.value = false;
        await nextTick();
        try {
          if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        } catch (e) {}
      }
    }

    function buildCoordinateMapUrlFromMessage(m) {
      try {
        if (!m || !m.content) return '';
        const dim = String(m.content.dimension || '').trim();
        if (!dim) return '';
        const x = Number(m.content.x);
        const y = Number(m.content.y);
        const z = Number(m.content.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return '';
        const yy = Number.isFinite(y) ? y : 0;

        const qs = new URLSearchParams({
          world: dim,
          x: String(Math.round(x)),
          y: String(Math.round(yy)),
          z: String(Math.round(z)),
        });
        return `/m/map.html?${qs.toString()}`;
      } catch (e) {
        return '';
      }
    }

    function openCoordinateOnMap(m) {
      try {
        const url = buildCoordinateMapUrlFromMessage(m);
        if (!url) {
          try { ElementPlus.ElMessage.warning('坐标信息不完整'); } catch (e0) {}
          return;
        }
        window.location.href = url;
      } catch (e) {
        try { window.location.href = '/m/map.html'; } catch (e2) {}
      }
    }

    async function loadEmojiPacks() {
      try {
        const res = await safeFetch(`${apiBase.value}/emoji`);
        if (res.ok) {
          const packs = await res.json();
          emojiPacks.value = (Array.isArray(packs) ? packs : []).map(p => ({
            id: p.id,
            url:
              p.url ||
              p.downloadUrl ||
              p.download_url ||
              `${apiBase.value}/emoji/${encodeURIComponent(p.id)}/download`,
            name: p.name || (p.meta && p.meta.filename) || p.filename || '',
          }));
        }
      } catch (e) {}
    }

    async function sendEmoji(pack) {
      if (!currentChatId.value || isGlobalChat.value) return;
      
      emojiPanelVisible.value = false;
      
      try {
        const url = `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`;
        const body = {
          type: 'emoji',
          content: { packId: pack.id, url: pack.url },
        };
        if (replyTarget.value) body.repliedTo = replyTarget.value.id;

        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        clearReplyTarget();
      } catch (e) {
        ElementPlus.ElMessage.error('发送表情失败');
      }
    }

    function goBack() {
      window.location.href = '/m/chats.html';
    }

    function goEmojiManage() {
      window.location.href = '/m/emojis.html';
    }

    function onMessagesScroll() {
      try {
        if (!messagesEl.value) return;
        if (messagesEl.value.scrollTop < 80) {
          loadMoreMessages();
        }

        try { queueReadForCurrentChat(); } catch (e0) {}
      } catch (e) {}
    }

    onMounted(async () => {
      // Keep consistent with the original rendering: set input-area height var once early.
      // This avoids cached render showing a bottom gap and then shifting when the var updates later.
      await nextTick();
      updateInputAreaHeightVar();
      window.addEventListener('resize', updateInputAreaHeightVar);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateInputAreaHeightVar);
        window.visualViewport.addEventListener('scroll', updateInputAreaHeightVar);
      }

      // 1) Read chatId immediately and hydrate from cache for instant render.
      const params = new URLSearchParams(window.location.search);
      const chatId = params.get('chat');
      if (chatId) {
        try {
          if (!selfUserId.value) {
            const sid = tryExtractSelfUserIdFromToken();
            if (sid) selfUserId.value = String(sid);
          }
        } catch (e0) {}
        try { await hydrateChatFromCache(chatId); } catch (e) {}
        // After cache hydration, scroll to bottom once (same as original after message render).
        try {
          await nextTick();
          scrollMessagesToBottom();
        } catch (e2) {}
      }

      // 2) Then load runtime config + user index and reconcile with server.
      await fetchConfig();
      await loadUsersIndex();
      await resolveSelfProfile();
      await loadEmojiPacks();

      if (chatId) {
        await openChat(chatId);
      }

      try {
        await nextTick();
        syncGlobalWatermarkEnabled();
      } catch (e) {}

      // Recompute watermark on orientation/size changes.
      try {
        window.addEventListener('resize', syncGlobalWatermarkEnabled);
      } catch (e) {}
      try {
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', syncGlobalWatermarkEnabled);
        }
      } catch (e) {}

      try { startReadReporter(); } catch (e) {}

      // 点击页面其他地方关闭上下文菜单
      document.addEventListener('click', () => {
        hideContextMenu();
      });
    });

    onBeforeUnmount(() => {
      try { stopReadReporter(); } catch (e) {}

      try { window.removeEventListener('resize', syncGlobalWatermarkEnabled); } catch (e) {}
      try {
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', syncGlobalWatermarkEnabled);
        }
      } catch (e) {}

      try {
        if (globalWatermarkCtl && typeof globalWatermarkCtl.destroy === 'function') {
          globalWatermarkCtl.destroy();
        }
      } catch (e) {}
    });

    watch(isGlobalChat, () => {
      try { syncGlobalWatermarkEnabled(); } catch (e) {}
    });

    return {
      currentChatTitle,
      currentChatFaceUrl,
      messages,
      msgInput,
      msgInputEl,
      pendingMentionBadges,
      imagePreviewVisible,
      imagePreviewUrl,
      imagePreviewStyle,
      fileInputEl,
      inputAreaEl,
      messagesEl,
      chatLoading,
      loadingMore,
      isGlobalChat,
      isSelfChat,
      replyTarget,
      replyPreview,
      emojiPanelVisible,
      emojiPacks,
      morePanelVisible,
      toggleMorePanel,
      playerCardDialogVisible,
      playerCardUsersLoading,
      playerCardSending,
      playerCardSelectedUserId,
      playerCardOptions,
      onPlayerCardQuery,
      openPlayerCardDialog,
      cancelPlayerCardDialog,
      confirmSendPlayerCard,

      coordinateDialogVisible,
      coordinateSending,
      coordinateForm,
      coordinateHomeLoading,
      coordinateHomeSelected,
      coordinateHomes,
      openCoordinateDialog,
      cancelCoordinateDialog,
      confirmSendCoordinate,
      openCoordinateOnMap,
      importCoordinateFromHome,
      // group management
      isGroupChat,
      isDirectChat,
      openGroupManage,
      groupAvatarInputEl,
      openGroupAvatarPicker,
      onGroupAvatarSelected,
      groupManageVisible,
      groupManageLoading,
      groupActionLoading,
      groupOwnerId,
      groupAdmins,
      groupEditName,
      groupMembers,
      groupIsOwner,
      canMentionAll,
      groupCanManage,
      inviteSelected,
      inviteOptions,
      adminSelected,
      adminOptions,
      transferOwnerId,
      transferOptions,
      saveGroupName,
      inviteToGroup,
      kickFromGroup,
      saveGroupAdmins,
      transferGroupOwner,
      dissolveGroupChat,
      userLabel,
      userMinecraftId,
      selfUserId,
      ctxMenuVisible,
      ctxMenuX,
      ctxMenuY,
      ctxMenuMsg,
      canCollectEmoji,
      canCopyText,
      canForwardMessage,
      canMentionFromMessage,
      ctxCollectEmoji,
      messageAuthorName,
      messageAuthorFaceUrl,
      messagePreviewTag,
      messagePreviewSuffix,
      messagePreviewText,
      messageTextPreview,
      messageTextParts,
      isGalleryImageMessage,
      galleryInfoFor,
      openGalleryFromMessage,
      isRecalledMessage,
      recallNoticeText,
      isOwnMessage,
      isImageFile,
      isVideoFile,
      messageFilename,
      fileDisplayUrl,
      fileOriginalUrl,
      canSaveAttachment,
      downloadAttachment,
      ctxSave,
      bubbleBackground,
      formatTime,
      shouldShowTimeDivider,
      showReadCount,
      readCountFor,
      showReadStatus,
      readStatusTextFor,
      readersDialogVisible,
      readersLoading,
      readersList,
      openReadersDialog,
      closeReadersDialog,
      repliedRefMessage,
      scrollToMessage,
      toggleMessageTime,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onMsgInputKeydown,
      onMsgInputInput,
      onMsgInputPaste,
      ctxReply,
      ctxCopy,
      ctxMention,
      ctxForward,
      canRecallMessage,
      ctxRecall,
      setReplyTarget,
      sendText,
      openFilePicker,
      onFileSelected,
      clearReplyTarget,
      toggleEmojiPanel,
      sendEmoji,
      openImagePreview,
      closeImagePreview,
      requestCloseImagePreview,
      videoPreviewVisible,
      videoPreviewUrl,
      openVideoPreview,
      closeVideoPreview,
      requestCloseVideoPreview,
      onImagePreviewToggle,
      onImagePreviewTouchStart,
      onImagePreviewTouchMove,
      onImagePreviewTouchEnd,
      onMaskTouchStart,
      onMaskTouchMove,
      onMaskTouchEnd,
      goBack,
      goEmojiManage,
      onMessagesScroll,
      // mentions
      mentionDialogVisible,
      mentionSelectAll,
      mentionSelectIds,
      mentionQuery,
      mentionOptions,
      mentionMemberIds,
      setMentionSelected,
      toggleMentionSelected,
      confirmMentionDialog,
      cancelMentionDialog,

      // forward
      forwardDialogVisible,
      forwardSending,
      forwardTargetChatId,
      forwardSourceMsg,
      forwardTargets,
      forwardSourcePreviewText,
      openForwardDialog,
      confirmForward,
      cancelForwardDialog,
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
