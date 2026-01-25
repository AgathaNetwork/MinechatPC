// Vue 3 + Element Plus chat page
const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const chats = ref([]);
    const chatsLoading = ref(false);
    const chatUnreadMap = reactive({});
    const currentChatId = ref(null);
    const currentChatTitle = ref('');
    const currentChatFaceUrl = ref('');
    const currentChatMeta = ref(null);

    // Local last-seen timestamps (fallback when backend does not provide hasUnread)
    const CHAT_SEEN_KEY = 'minechat.chatSeenAt.v1';

    function loadChatSeenMap() {
      try {
        const raw = localStorage.getItem(CHAT_SEEN_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return {};
        return obj;
      } catch (e) {
        return {};
      }
    }

    function saveChatSeenMap(map) {
      try {
        localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(map || {}));
      } catch (e) {}
    }

    function setChatSeenAtMs(chatId, ms) {
      try {
        const id = chatId !== undefined && chatId !== null ? String(chatId) : '';
        if (!id) return;
        const t = Number(ms || 0);
        const map = loadChatSeenMap();
        map[id] = t > 0 ? t : Date.now();
        saveChatSeenMap(map);
      } catch (e) {}
    }

    const messages = ref([]);
    const msgById = reactive({});
    const userNameCache = reactive({});
    const userFaceCache = reactive({});
    const userMinecraftCache = reactive({});

    const selfFaceUrl = ref('');
    const usersIndexLoaded = ref(false);

    // --- Presence (online users via socket broadcasts) ---
    // userId -> true
    const onlineUserMap = reactive({});

    function setOnlineSnapshot(ids) {
      try {
        for (const k of Object.keys(onlineUserMap)) {
          try { delete onlineUserMap[k]; } catch (e0) {}
        }
        const arr = Array.isArray(ids) ? ids : [];
        for (const id0 of arr) {
          const id = id0 !== undefined && id0 !== null ? String(id0) : '';
          if (!id) continue;
          onlineUserMap[id] = true;
        }
      } catch (e) {}
    }

    function setUserOnline(userId, isOnline) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return;
        if (isOnline) onlineUserMap[id] = true;
        else {
          try { delete onlineUserMap[id]; } catch (e0) {}
        }
      } catch (e) {}
    }

    function isUserOnline(userId) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        return id ? !!onlineUserMap[id] : false;
      } catch (e) {
        return false;
      }
    }

    function isChatPeerOnline(chat) {
      try {
        const peerId = getChatPeerId(chat);
        if (!peerId) return false;
        if (selfUserId.value && String(peerId) === String(selfUserId.value)) return false;
        // Only show for 1:1 chat avatars.
        const members = chat && (chat.members || chat.memberIds || chat.member_ids);
        if (!Array.isArray(members) || members.length !== 2) return false;
        return isUserOnline(peerId);
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

    const replyTarget = ref(null);

    // Read details dialog (reader list)
    const readersDialogVisible = ref(false);
    const readersLoading = ref(false);
    const readersMessageId = ref('');
    const readersList = ref([]); // [{ id, name, faceUrl }]

    const ctxMenuVisible = ref(false);
    const ctxMenuX = ref(0);
    const ctxMenuY = ref(0);
    const ctxMenuMsg = ref(null);

    // Forward message
    const forwardDialogVisible = ref(false);
    const forwardSending = ref(false);
    const forwardTargetChatId = ref('');
    const forwardSourceMsg = ref(null);

    const forwardTargets = computed(() => {
      try {
        const list = Array.isArray(chats.value) ? chats.value : [];
        return list
          .filter((c) => c && c.id !== undefined && c.id !== null && String(c.id) !== 'global')
          .map((c) => {
            const id = String(c.id);
            const name = c.displayName || c.name || '会话';
            return { id, name };
          });
      } catch (e) {
        return [];
      }
    });

    function forwardSourcePreviewText(m) {
      try {
        if (!m || typeof m !== 'object') return '';
        const tag = messagePreviewTag(m);
        const suffix = messagePreviewSuffix(m);
        if (tag) return suffix ? `${tag} ${suffix}` : tag;
        return messageTextPreview(m) || '消息';
      } catch (e) {
        return '';
      }
    }

    function buildForwardPayloadFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return null;
        if (isRecalledMessage(m)) return null;

        const t = String(m.type || '').toLowerCase();
        const type = t || 'text';
        let content = m.content;

        // For file messages: must have a remote url (can't forward local-only blobs).
        if (type === 'file') {
          const c = content && typeof content === 'object' ? Object.assign({}, content) : null;
          if (!c) return null;
          if (!c.url) return null;
          // drop local preview url
          try { delete c.__localUrl; } catch (e0) {}
          content = c;
        }

        // For video messages (if backend/client uses type=video): also require url.
        if (type === 'video') {
          const c = content && typeof content === 'object' ? Object.assign({}, content) : null;
          if (!c) return null;
          if (!c.url) return null;
          try { delete c.__localUrl; } catch (e0) {}
          content = c;
        }

        // For others, content can be string/object as-is.
        return { type, content };
      } catch (e) {
        return null;
      }
    }

    function canForwardMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isRecalledMessage(m)) return false;
        const t = String(m.type || '').toLowerCase();
        if (t === 'recalled') return false;
        if (t === 'text' || t === 'emoji' || t === 'sticker' || t === 'file' || t === 'coordinate' || t === 'player_card' || t === 'video') {
          // ensure file/video has remote url
          if (t === 'file' || t === 'video') {
            const c = m.content;
            return !!(c && typeof c === 'object' && (c.url || c.__localUrl));
          }
          return true;
        }
        // default: allow forwarding unknown types only if it has a safe preview string
        return !!messageTextPreview(m);
      } catch (e) {
        return false;
      }
    }

    async function openForwardDialog(msg) {
      try {
        if (isGlobalChat.value) return;
        if (!canForwardMessage(msg)) {
          try { ElementPlus.ElMessage.warning('该消息不支持转发'); } catch (e0) {}
          return;
        }

        // Ensure chat list exists for selecting target.
        if (!Array.isArray(chats.value) || chats.value.length === 0) {
          try { await loadChats(); } catch (e1) {}
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
        const src = forwardSourceMsg.value;
        const targetId = String(forwardTargetChatId.value || '').trim();
        if (!src) return;
        if (!targetId) return ElementPlus.ElMessage.warning('请选择目标会话');
        if (targetId === 'global') return ElementPlus.ElMessage.warning('不可转发到全服聊天');

        const target = (forwardTargets.value || []).find((x) => x && String(x.id) === targetId);
        const targetName = target ? String(target.name || '') : '目标会话';

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

    const emojiPanelVisible = ref(false);
    const emojiPacks = ref([]);

    const morePanelVisible = ref(false);

    const playerCardDialogVisible = ref(false);
    const playerCardUsersLoading = ref(false);
    const playerCardSending = ref(false);
    const playerCardSelectedUserId = ref('');
    const playerCardQuery = ref('');

    // Coordinate message
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

    function playerCardNoDataText() {
      const q = String(playerCardQuery.value || '').trim();
      return q ? '没有匹配的玩家（最多显示 5 条）' : '请输入关键词搜索（最多显示 5 条）';
    }

    function fuzzyUserMatch(u, query) {
      try {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return false;
        const tokens = q.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return false;

        // 按需求：仅对 username 做模糊匹配
        const name = String((u && u.username) || '').toLowerCase();
        return tokens.every((t) => name.includes(t));
      } catch (e) {
        return false;
      }
    }

    const playerCardOptions = computed(() => {
      try {
        const q = String(playerCardQuery.value || '').trim();
        if (!q) return [];
        const list = Array.isArray(allUsersList.value) ? allUsersList.value : [];
        const matched = list.filter((u) => fuzzyUserMatch(u, q));
        return matched.slice(0, 5);
      } catch (e) {
        return [];
      }
    });

    function onPlayerCardQuery(q) {
      playerCardQuery.value = String(q || '');
      // Changing query should not keep an old selection by accident.
      if (playerCardSelectedUserId.value) playerCardSelectedUserId.value = '';
    }

    const msgInput = ref('');
    const msgInputEl = ref(null);

    // Per-chat composer drafts (in-memory). Keyed by chatId string.
    // Stores rich-input HTML + reply snapshot, so switching chats won't lose unsent text/@mentions.
    const composerDrafts = Object.create(null);

    function normalizeChatDraftKey(chatId) {
      try {
        if (chatId === undefined || chatId === null) return '';
        return String(chatId);
      } catch (e) {
        return '';
      }
    }

    function snapshotReplyTargetForDraft(rt) {
      try {
        if (!rt) return null;
        // If it's already an id, keep it as a minimal object.
        if (typeof rt === 'string' || typeof rt === 'number') {
          const id = String(rt);
          return id ? { id } : null;
        }
        if (typeof rt !== 'object') return null;
        const id = rt.id !== undefined && rt.id !== null ? String(rt.id) : '';
        // Keep a small subset for preview + sending repliedTo.
        const snap = {
          id: id || undefined,
          type: rt.type,
          content: rt.content,
          from_user: rt.from_user,
          createdAt: rt.createdAt,
        };
        // If id is missing, still keep snapshot; sendText will fall back safely.
        return snap;
      } catch (e) {
        return null;
      }
    }

    function saveComposerDraftForChat(chatId) {
      try {
        const key = normalizeChatDraftKey(chatId);
        if (!key) return;

        let html = '';
        try {
          if (isRichInputActive()) {
            const root = getRichInputEl();
            if (root) html = String(root.innerHTML || '');
            // Keep reactive state in sync as well.
            syncStateFromRichInput();
          }
        } catch (e2) {}

        composerDrafts[key] = {
          html,
          reply: snapshotReplyTargetForDraft(replyTarget.value),
          ts: Date.now(),
        };
      } catch (e) {}
    }

    function clearComposerUIState() {
      try {
        msgInput.value = '';
      } catch (e) {}

      try {
        clearRichInputDom();
      } catch (e) {}

      try {
        pendingMentions.value = [];
        pendingMentionAll.value = false;
      } catch (e) {}

      try {
        mentionDialogVisible.value = false;
        mentionSelectAll.value = false;
        mentionSelectIds.value = [];
        mentionQuery.value = '';
        mentionDialogSuppressOnce.value = false;
        mentionTriggerIndex.value = null;
      } catch (e) {}

      try {
        clearReplyTarget();
      } catch (e) {}
    }

    function restoreComposerDraftForChat(chatId) {
      try {
        const key = normalizeChatDraftKey(chatId);
        if (!key) return;
        const d = composerDrafts[key];
        if (!d || typeof d !== 'object') return;

        // Restore rich-input HTML.
        try {
          const root = getRichInputEl();
          if (root) root.innerHTML = String(d.html || '');
          // Recompute msgInput/pendingMentions from DOM.
          syncStateFromRichInput();
        } catch (e2) {}

        // Restore reply target for non-global chats only.
        try {
          if (String(chatId) === 'global') {
            replyTarget.value = null;
          } else {
            replyTarget.value = d.reply || null;
          }
        } catch (e3) {}
      } catch (e) {}
    }

    // Paste-to-send confirmation
    const pasteConfirmBusy = ref(false);

    const imagePreviewVisible = ref(false);
    const imagePreviewUrl = ref('');
    const imagePreviewScale = ref(1);
    const imagePreviewX = ref(0);
    const imagePreviewY = ref(0);
    const imagePreviewDragging = ref(false);
    const imagePreviewMoved = ref(false);

    const videoPreviewVisible = ref(false);
    const videoPreviewUrl = ref('');

    let imgDragStartX = 0;
    let imgDragStartY = 0;
    let imgDragOriginX = 0;
    let imgDragOriginY = 0;

    const selfUserId = ref(null);

    // --- Read receipts (client-side reporting) ---
    // Every 0.5s, batch-report read message ids for the currently open chat.
    // Backend should return read fields when querying messages:
    // - self chat: no read info
    // - single chat: `read` (bool) for messages sent by self
    // - group chat: `readCount` (number)
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
        return Array.isArray(ids) && ids.length === 1 && String(ids[0]) === String(selfUserId.value);
      } catch (e) {
        return false;
      }
    }

    function shouldReportReadForCurrentChat() {
      try {
        if (!currentChatId.value) return false;
        if (String(currentChatId.value) === 'global') return false;
        if (!isLoggedIn.value) return false;
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

        // Keep queue fresh.
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
        // If the first node is a non-editable chip/marker, insert a leading ZWSP text node
        // so caret can be placed before it (e.g. at sentence start).
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
          // Use NBSP as an anchor so caret can stay inside a text node
          // (some browsers behave oddly with flex + contenteditable after non-editable chips).
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

    const messagesEl = ref(null);
    const chatLoading = ref(false);

    // --- Global chat watermark (username + seconds) ---
    let globalWatermarkCtl = null;
    let globalWatermarkThemeKey = '';

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
      // Light mode: make it lighter (more subtle)
      if (String(themeKey || '').toLowerCase() === 'dark') return 'rgba(255, 255, 255, 0.12)';
      return 'rgba(0, 0, 0, 0.08)';
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
        if (globalWatermarkCtl && themeKey !== globalWatermarkThemeKey) {
          try { globalWatermarkCtl.destroy(); } catch (e0) {}
          globalWatermarkCtl = null;
        }

        if (!globalWatermarkCtl) {
          globalWatermarkThemeKey = themeKey;
          globalWatermarkCtl = wm.create({
            targetEl: el,
            enabled: false,
            getText: () => `${watermarkUserLabel()} ${wm.formatNowSeconds()}`,
            tileOptions: {
              color: watermarkColorForTheme(themeKey),
              font: '16px sans-serif',
              rotateDeg: -22,
              gapX: 260,
              gapY: 200,
            },
          });
        }

        globalWatermarkCtl.setEnabled(isGlobalChat.value);
      } catch (e) {}
    }

    const isGlobalChat = computed(() => currentChatId.value === 'global');
    const isLoggedIn = computed(() => !!token.value || !!sessionOk.value);

    const isGroupChat = computed(() => {
      try {
        if (!currentChatMeta.value || typeof currentChatMeta.value !== 'object') return false;
        return String(currentChatMeta.value.type || '').toLowerCase() === 'group';
      } catch (e) {
        return false;
      }
    });

    const isSelfChat = computed(() => {
      try {
        if (isGlobalChat.value) return false;
        const sid = selfUserId.value ? String(selfUserId.value) : '';
        if (!sid) return false;

        // Prefer current meta; fallback to list item.
        let chatLike = currentChatMeta.value;
        if (!chatLike && currentChatId.value && currentChatId.value !== 'global') {
          chatLike = (chats.value || []).find((c) => c && String(c.id) === String(currentChatId.value));
        }

        const ids = extractMemberIdsFromChat(chatLike);
        if (!Array.isArray(ids) || ids.length === 0) return false;
        return ids.map(String).filter(Boolean).every((id) => id === sid);
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

        // Fallback: 2-member chat (and not self-chat).
        let chatLike = currentChatMeta.value;
        if (!chatLike && currentChatId.value && currentChatId.value !== 'global') {
          chatLike = (chats.value || []).find((c) => c && String(c.id) === String(currentChatId.value));
        }
        const ids = extractMemberIdsFromChat(chatLike);
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

        // Show when backend provided read flag (including false).
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
          const faceUrl = normalizeAssetUrl(getCachedFaceUrl(id));
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
        // Prefer hiding for recalled messages.
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
        let arr = currentChatMeta.value ? extractMemberIdsFromChat(currentChatMeta.value) : [];

        if (arr.length === 0 && currentChatId.value && currentChatId.value !== 'global') {
          const chatObj = (chats.value || []).find((c) => c && String(c.id) === String(currentChatId.value));
          arr = chatObj ? extractMemberIdsFromChat(chatObj) : arr;
        }
        // stable order: owner first, then others
        const owner = groupOwnerId.value ? String(groupOwnerId.value) : null;
        if (owner && arr.includes(owner)) {
          return [owner].concat(arr.filter((x) => x !== owner));
        }
        return arr;
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
          // Common shapes: {id}, {userId}, {user:{id}}, {user:"id"}
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

        // Common field names across API versions.
        let raw =
          chatLike.members ??
          chatLike.memberIds ??
          chatLike.member_ids ??
          chatLike.memberList ??
          chatLike.member_list ??
          chatLike.participants ??
          chatLike.participantIds ??
          chatLike.participant_ids ??
          chatLike.users ??
          chatLike.userIds ??
          chatLike.user_ids;

        // Some APIs nest the array under items/list/ids.
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          raw = raw.items ?? raw.list ?? raw.ids ?? raw.data ?? raw.rows ?? raw.members ?? raw.users;
        }

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
        // A real group should have at least 2 members; if we only have 0/1, treat it as not loaded.
        if (Array.isArray(existing) && existing.length >= 2) return;

        const cid = String(currentChatId.value);

        // Use the same loading strategy as group management.
        try {
          await Promise.allSettled([refreshGroupInfo(cid), loadGroupAdmins(cid)]);
        } catch (e0) {}

        try {
          const ids = (groupMembers.value || []).map(String).filter(Boolean);
          if (ids.length > 0) await fetchMissingUserNames(new Set(ids));
        } catch (e3) {}
      } catch (e) {}
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
        // Avoid overlapping with emoji panel.
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
        // Rich-input: if user cancels, keep a literal '@' where it was triggered.
        if (isRichInputActive() && mentionMarkerEl) {
          replaceMentionMarkerWithText('@');
          syncStateFromRichInput();
        }
        // Keep '@' so user can type literal '@'.
        // Suppress the auto-open once to avoid re-opening immediately.
        mentionDialogSuppressOnce.value = true;
      } catch (e) {}
    }

    function getNativeMsgInputEl() {
      try {
        const comp = msgInputEl.value;
        if (!comp) return null;
        // contenteditable mode
        if (comp && comp.nodeType === 1 && comp.isContentEditable) return comp;
        // Element Plus el-input renders native input/textarea inside.
        const root = comp.$el && comp.$el.querySelector ? comp.$el : null;
        if (root) {
          const el = root.querySelector('input,textarea');
          if (el) return el;
        }
        // Fallbacks (best-effort)
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
          // Rich input doesn't support selectionStart/setSelectionRange.
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
        // Fallback: sometimes cursor math differs by 1 depending on timing.
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

        const allowAll = !!canMentionAll.value;

        // Rich-input: replace marker with atomic mention chips.
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

        if (parts.length === 0) {
          return cancelMentionDialog();
        }

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

        // Place caret right after inserted tokens.
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

        // Find the token range the cursor is touching.
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
                // Also swallow one adjacent space to keep formatting clean.
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
          // Enter to send (Shift+Enter keeps default behavior).
          // This should work for global + single + group chats.
          if (key === 'Enter') {
            try {
              if (ev.isComposing || ev.keyCode === 229) return;
            } catch (e0) {}
            if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            // If mention dialog is open in group chat, don't send.
            if (!isGlobalChat.value && isGroupChat.value && mentionDialogVisible.value) return;
            ev.preventDefault();
            try { sendText(); } catch (e1) {}
            return;
          }

          // '@' mention picker only for group chats (non-global).
          if (key === '@') {
            if (isGlobalChat.value || !isGroupChat.value) return;
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

          // Open after the input value updates.
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
        if (start !== end) return; // keep default behavior for range deletes

        const res = removeMentionTokenAt(msgInput.value, start, key === 'Backspace');
        if (!res) return;
        ev.preventDefault();
        msgInput.value = res.next;
        cleanupPendingMentionsAfterEdit(msgInput.value);
        nextTick(() => {
          try {
            target.setSelectionRange(res.nextPos, res.nextPos);
          } catch (e2) {}
        });
      } catch (e) {}
    }

    function insertMention(userId, label) {
      try {
        if (isGlobalChat.value || !isGroupChat.value) return;
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return;
        const name = String(label || userLabel(id) || '未知玩家');

        // Rich-input: insert chip at caret.
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

    function normalizeAssetUrl(raw) {
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
        return normalizeAssetUrl(raw);
      } catch (e) {
        return '';
      }
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

    async function fetchChatMetaById(chatId) {
      try {
        const cid = chatId !== undefined && chatId !== null ? String(chatId).trim() : '';
        if (!cid) return null;
        
        // 兼容旧路径 /chats/:id
        const r2 = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
        if (r2.ok) return await r2.json().catch(() => null);

        return null;
      } catch (e) {
        return null;
      }
    }

    function apiHttpBase() {
      try {
        return String(apiBase.value || '').trim().replace(/\/$/, '');
      } catch (e) {
        return '';
      }
    }

    function normalizeChatIdFromMessage(m) {
      if (!m || typeof m !== 'object') return null;
      return m.chatId || m.chat_id || m.chat || null;
    }

    function isScrolledNearBottom(el) {
      try {
        if (!el) return true;
        const threshold = 120;
        return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      } catch (e) {
        return true;
      }
    }

    function upsertIncomingMessage(msg) {
      if (!msg || typeof msg !== 'object') return;

      // Silent audit recall: do not render at all.
      if (isAuditRecalledMessage(msg)) {
        try { removeLocalMessageById(String(msg.id || '')); } catch (e) {}
        return;
      }

      // normalize fields so UI can render
      normalizeMessage(msg, currentChatId.value === 'global');

      const id = msg.id;
      if (!id) return;

      // If we already have the message, merge/update in place
      if (msgById[id]) {
        const prev = msgById[id];
        Object.assign(prev, msg);
        return;
      }

      msgById[id] = msg;
      messages.value = messages.value.concat([msg]);
    }

    function removeLocalMessageById(messageId) {
      try {
        const mid = messageId !== undefined && messageId !== null ? String(messageId) : '';
        if (!mid) return;
        try { delete msgById[mid]; } catch (e0) {}
        const list = Array.isArray(messages.value) ? messages.value : [];
        const next = list.filter((m) => !(m && m.id && String(m.id) === mid));
        if (next.length !== list.length) messages.value = next;
      } catch (e) {}
    }

    function contentSignature(m) {
      try {
        if (!m) return '';
        if (m.type === 'text') {
          const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return 'text:' + String(t);
        }
        if (m.type === 'emoji') {
          const pid = m.content && (m.content.packId || m.content.pack_id) || '';
          const url = m.content && m.content.url || '';
          return 'emoji:' + String(pid) + ':' + String(url);
        }
        if (m.type === 'file') {
          const fn = m.content && m.content.filename || '';
          const mm = m.content && (m.content.mimetype || m.content.type) || '';
          return 'file:' + String(fn) + ':' + String(mm);
        }
        return String(m.type || '') + ':' + messageTextPreview(m);
      } catch (e) {
        return '';
      }
    }

    function findOptimisticForAck(serverMsg) {
      try {
        if (!serverMsg || typeof serverMsg !== 'object') return null;
        normalizeMessage(serverMsg, currentChatId.value === 'global');
        if (!selfUserId.value) return null;
        if (!serverMsg.from_user) return null;
        if (String(serverMsg.from_user) !== String(selfUserId.value)) return null;

        const sig = contentSignature(serverMsg);
        const now = parseMessageTime(serverMsg) ? parseMessageTime(serverMsg).getTime() : Date.now();

        const arr = messages.value || [];
        for (let i = arr.length - 1; i >= 0; i--) {
          const m = arr[i];
          if (!m || !m.id) continue;
          if (m.__status !== 'sending') continue;
          if (m.__own !== true) continue;
          if (m.type !== serverMsg.type) continue;

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

        // If the server message already exists (socket came first), drop optimistic one.
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

        // Move optimistic mapping from tempId -> serverId to prevent duplicates.
        delete msgById[tempId];

        optimistic.__status = 'sent';
        optimistic.id = serverId;
        optimistic.createdAt = serverMsg.created_at || serverMsg.createdAt || optimistic.createdAt;
        if (serverMsg.type) optimistic.type = serverMsg.type;
        if (serverMsg.from_user) optimistic.from_user = serverMsg.from_user;
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

    function removeMessageById(messageId) {
      if (!messageId) return;
      if (msgById[messageId]) delete msgById[messageId];
      messages.value = (messages.value || []).filter((m) => m && m.id !== messageId);
    }

    async function ensureUserCachesForMessages(msgs, isGlobal) {
      try {
        const ids = new Set();
        (msgs || []).forEach((m) => {
          if (!m) return;
          normalizeMessage(m, isGlobal);
          if (m.from_user) ids.add(m.from_user);
          if (!isGlobal && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) ids.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(ids);
      } catch (e) {}
    }

    function connectSocket() {
      try {
        if (socket.value && socket.value.connected) return;
        if (typeof window === 'undefined' || !window.io) return;

        function extractChatFromPayload(payload) {
          try {
            if (!payload) return null;
            if (payload.chat && typeof payload.chat === 'object') return payload.chat;
            if (payload.data && payload.data.chat && typeof payload.data.chat === 'object') return payload.data.chat;
            // Sometimes backend may emit the chat object directly.
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

        function normalizeIncomingChat(chat) {
          try {
            if (!chat || typeof chat !== 'object') return null;
            const c = Object.assign({}, chat);
            if (c.id !== undefined && c.id !== null) c.id = String(c.id);
            const t = String(c.type || '').toLowerCase();
            if (t === 'group') {
              if (!c.displayName) c.displayName = c.name || '群聊';
            }
            return c;
          } catch (e) {
            return null;
          }
        }

        function upsertChatInList(incomingChat) {
          try {
            const c = normalizeIncomingChat(incomingChat);
            if (!c || !c.id) return;

            // Safety: only accept chats we are a member of (if members are present).
            try {
              const me = selfUserId.value ? String(selfUserId.value) : null;
              const members = c.members || c.memberIds || c.member_ids;
              const ids = Array.isArray(members) ? normalizeMembersArray(members) : [];
              if (me && ids.length > 0) {
                if (!ids.includes(me)) return;
              }
            } catch (e2) {}

            const list = Array.isArray(chats.value) ? chats.value : [];
            const idx = list.findIndex((x) => x && String(x.id) === String(c.id));
            if (idx >= 0) {
              // Preserve lastMessage/unread flags if not provided.
              const existing = list[idx] || {};
              const merged = Object.assign({}, existing, c);
              if (existing.lastMessage && !merged.lastMessage) merged.lastMessage = existing.lastMessage;
              list.splice(idx, 1, merged);
            } else {
              list.push(c);
            }
            chats.value = list;
            resortChats();

            // Ensure 1:1 peer profile is available for displayName/avatar.
            try {
              const pid = getChatPeerId(c);
              if (pid) fetchMissingUserNames(new Set([pid]));
            } catch (e3) {}
          } catch (e) {}
        }

        function removeChatFromList(chatId) {
          try {
            const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
            if (!cid) return;
            chats.value = (chats.value || []).filter((c) => c && String(c.id) !== cid);
            try { delete chatUnreadMap[cid]; } catch (e) {}
          } catch (e) {}
        }

        async function refreshCurrentChatMetaIfAffected(chatId) {
          try {
            const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
            if (!cid) return;
            if (!currentChatId.value || String(currentChatId.value) !== cid) return;

            const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
            if (!metaRes.ok) return;
            const chatMeta = await metaRes.json().catch(() => null);
            if (!chatMeta || typeof chatMeta !== 'object') return;
            currentChatMeta.value = chatMeta;
            currentChatTitle.value = chatMeta.displayName || chatMeta.name || currentChatTitle.value;
            if (String(chatMeta.type || '').toLowerCase() === 'group') {
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '群聊';
              groupOwnerId.value = chatMeta.created_by !== undefined && chatMeta.created_by !== null ? String(chatMeta.created_by) : groupOwnerId.value;
              try { loadGroupAdmins(cid); } catch (e) {}
            }
          } catch (e) {}
        }

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

        const t = tokenValue();
        if (t) opts.auth = { token: t };

        function attachPresenceHandlers(sock) {
          try {
            if (!sock || typeof sock.on !== 'function') return;
            sock.on('presence.snapshot', (payload) => {
              try {
                const ids = payload && (payload.onlineUserIds || payload.online_user_ids || payload.users || payload.userIds);
                setOnlineSnapshot(ids);
              } catch (e) {}
            });
            sock.on('user.online', (payload) => {
              try {
                const uid = payload && (payload.userId || payload.user_id || payload.id);
                setUserOnline(uid, true);
              } catch (e) {}
            });
            sock.on('user.offline', (payload) => {
              try {
                const uid = payload && (payload.userId || payload.user_id || payload.id);
                setUserOnline(uid, false);
              } catch (e) {}
            });
            sock.on('disconnect', () => {
              try { setOnlineSnapshot([]); } catch (e) {}
            });
          } catch (e) {}
        }

        const s = window.io(socketUrl, opts);
        socket.value = s;

        try { attachPresenceHandlers(s); } catch (e0) {}

        s.on('connect', () => {
          // Join current chat room if already selected
          try {
            if (currentChatId.value && currentChatId.value !== joinedChatId.value) {
              s.emit('join', currentChatId.value);
              joinedChatId.value = currentChatId.value;
            }
          } catch (e) {}
        });

        s.on('connect_error', (err) => {
          const msg = (err && err.message) ? String(err.message) : String(err || '');
          // If token is invalid, drop it and retry relying on session cookie.
          if (/invalid token/i.test(msg)) {
            try { clearBadToken(); } catch (e) {}
            try { s.disconnect(); } catch (e) {}
            try {
              const s2 = window.io(socketUrl, {
                path: socketPath,
                transports: ['websocket', 'polling'],
                withCredentials: true,
              });
              socket.value = s2;
              try { attachPresenceHandlers(s2); } catch (e2) {}
            } catch (e) {}
          }
        });

        s.on('message.created', async (msg) => {
          try {
            const chatId = normalizeChatIdFromMessage(msg);
            const current = currentChatId.value;
            
            // 更新会话列表的最新消息和未读状态
            if (chatId && chatId !== 'global') {
              const chat = (chats.value || []).find(c => c && String(c.id) === String(chatId));
              if (chat) {
                chat.lastMessage = msg;
                const fromUser = msg && (msg.from_user || msg.fromUser || msg.from);
                const isSelfMsg = !!(selfUserId.value && fromUser && String(fromUser) === String(selfUserId.value));
                // 如果不是当前打开的会话，标记为未读
                if (!current || String(chatId) !== String(current)) {
                  if (!isSelfMsg) chatUnreadMap[chatId] = true;
                }

                resortChats();
              }
            }
            
            if (!current) return;
            if (chatId && String(chatId) !== String(current)) return;

            // If this is an echo of our optimistic send, treat it as ACK and merge.
            const candidate = findOptimisticForAck(msg);
            if (candidate && candidate.id) {
              ackOptimisticMessage(candidate.id, msg, current === 'global');
              await ensureUserCachesForMessages([msg], current === 'global');
              return;
            }

            const stickToBottom = isScrolledNearBottom(messagesEl.value);
            upsertIncomingMessage(msg);
            await ensureUserCachesForMessages([msg], current === 'global');
            try { queueReadForCurrentChat(); } catch (e0) {}
            await nextTick();
            if (stickToBottom && messagesEl.value) {
              messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
            }
          } catch (e) {}
        });

        // 后端对全服消息使用事件名 `global.message.created`，同时监听该事件以保持与 message.created 相同的行为
        s.on('global.message.created', async (msg) => {
          try {
            const chatId = 'global';
            const current = currentChatId.value;

            // 仅在全服页打开时将消息插入列表并处理 ACK/滚动等行为
            if (!current) return;
            if (String(chatId) !== String(current)) return;

            const candidate = findOptimisticForAck(msg);
            if (candidate && candidate.id) {
              ackOptimisticMessage(candidate.id, msg, current === 'global');
              await ensureUserCachesForMessages([msg], current === 'global');
              return;
            }

            const stickToBottom = isScrolledNearBottom(messagesEl.value);
            upsertIncomingMessage(msg);
            await ensureUserCachesForMessages([msg], current === 'global');
            try { queueReadForCurrentChat(); } catch (e0) {}
            await nextTick();
            if (stickToBottom && messagesEl.value) {
              messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
            }
          } catch (e) {}
        });

        async function onMessageUpdatedLike(payload) {
          try {
            const { chatId, message } = extractChatIdAndMessageFromUpdate(payload);
            if (!message) return;

            // Update chat list preview if needed.
            if (chatId && chatId !== 'global') {
              const chat = (chats.value || []).find((c) => c && String(c.id) === String(chatId));
              if (chat && chat.lastMessage && chat.lastMessage.id && message.id && String(chat.lastMessage.id) === String(message.id)) {
                chat.lastMessage = message;
              }
            }

            const current = currentChatId.value;
            if (!current) return;
            if (chatId && String(chatId) !== String(current)) return;

            applyMessageUpdate(chatId || current, message);
            await ensureUserCachesForMessages([message], current === 'global');
            await nextTick();
          } catch (e) {}
        }

        s.on('message.recalled', onMessageUpdatedLike);
        s.on('message.updated', onMessageUpdatedLike);

        // --- Read receipt realtime events ---
        // Payload shapes (best-effort compatibility):
        // - { messageId, userId, chatId }
        // - { chatId, messageIds, userId }
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

            // For single chat: mark my outgoing messages as read when the other user reads.
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

            // For group chat: server sends absolute readCount (not a delta).
            try {
              if (isGroupChat.value) {
                const raw =
                  payload &&
                  (payload.readCount ?? payload.read_count ?? payload.count ?? payload.readers ?? payload.readUsers);
                const n = Number(raw);
                if (Number.isFinite(n)) {
                  m.readCount = Math.max(0, Math.floor(n));
                }
              }
            } catch (e2) {}

            // Trigger reactive update for the messages list.
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
          try { applyReadEventToLocalState(payload || {}); } catch (e) {}
        });

        s.on('message.read.batch', (payload) => {
          try {
            const p = payload || {};
            const baseChatId = p.chatId || p.chat_id;
            const baseUserId = p.userId || p.uid;

            // Preferred: items/messages array with per-message readCount.
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

            // Fallback: ids + (optional) counts map.
            const ids = Array.isArray(p.messageIds) ? p.messageIds : (Array.isArray(p.ids) ? p.ids : []);
            const countsMap = p.counts || p.readCounts || p.read_counts;
            for (const id of ids) {
              const k = id !== undefined && id !== null ? String(id) : '';
              const rc = countsMap && k ? (countsMap[k] ?? countsMap[Number(k)]) : undefined;
              applyReadEventToLocalState({ chatId: baseChatId, messageId: id, userId: baseUserId, readCount: rc });
            }
          } catch (e) {}
        });

        s.on('message.deleted', (payload) => {
          try {
            const id = payload && (payload.id || payload.messageId);
            const chatId = payload && (payload.chatId || payload.chat_id);
            const current = currentChatId.value;
            if (chatId && current && String(chatId) !== String(current)) return;
            if (id) removeMessageById(id);
          } catch (e) {}
        });

        s.on('message.missed', async (payload) => {
          try {
            const chatId = payload && payload.chatId;
            const msgs = payload && payload.messages;
            if (!chatId || !Array.isArray(msgs)) return;
            const current = currentChatId.value;
            if (!current || String(chatId) !== String(current)) return;

            const stickToBottom = isScrolledNearBottom(messagesEl.value);
            for (const m of msgs) {
              upsertIncomingMessage(m);
            }
            await ensureUserCachesForMessages(msgs, current === 'global');
            await nextTick();
            if (stickToBottom && messagesEl.value) {
              messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
            }
          } catch (e) {}
        });

        // --- Group/chat lifecycle events (real-time updates) ---
        s.on('chat.created', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) upsertChatInList(chat);
            const cid = extractChatIdFromPayload(payload);
            if (cid) {
              // Ensure future room-join works if user opens it later.
              // (Desktop only joins current room; this is best-effort.)
              await refreshCurrentChatMetaIfAffected(cid);
            }
          } catch (e) {}
        });

        s.on('chat.updated', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) upsertChatInList(chat);
            const cid = extractChatIdFromPayload(payload);
            if (cid) await refreshCurrentChatMetaIfAffected(cid);
          } catch (e) {}
        });

        s.on('chat.renamed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            const chat = extractChatFromPayload(payload);
            if (chat) {
              upsertChatInList(chat);
            } else if (cid) {
              const list = Array.isArray(chats.value) ? chats.value : [];
              const idx = list.findIndex((c) => c && String(c.id) === String(cid));
              if (idx >= 0) {
                const name = payload && (payload.name !== undefined ? payload.name : payload.chatName);
                if (name !== undefined) {
                  const merged = Object.assign({}, list[idx], { name });
                  if (String(merged.type || '').toLowerCase() === 'group') {
                    merged.displayName = name || '群聊';
                  }
                  list.splice(idx, 1, merged);
                  chats.value = list;
                  resortChats();
                }
              }
            }
            if (cid) await refreshCurrentChatMetaIfAffected(cid);
          } catch (e) {}
        });

        s.on('chat.members.added', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            await refreshCurrentChatMetaIfAffected(cid);
            // Also refresh chat list entry best-effort (members may affect display).
            try {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta) upsertChatInList(meta);
              }
            } catch (e2) {}
          } catch (e) {}
        });

        s.on('chat.members.removed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            await refreshCurrentChatMetaIfAffected(cid);
            try {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta) upsertChatInList(meta);
              }
            } catch (e2) {}
          } catch (e) {}
        });

        s.on('chat.admins.changed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              if (payload && payload.ownerId !== undefined && payload.ownerId !== null) {
                groupOwnerId.value = String(payload.ownerId);
              }
              if (payload && Array.isArray(payload.admins)) {
                groupAdmins.value = payload.admins.map(String);
              }
            }
          } catch (e) {}
        });

        s.on('chat.owner.changed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              const ownerId = payload && (payload.ownerId !== undefined ? payload.ownerId : payload.newOwnerId);
              if (ownerId !== undefined && ownerId !== null) groupOwnerId.value = String(ownerId);
              try { loadGroupAdmins(cid); } catch (e2) {}
            }
          } catch (e) {}
        });

        async function handleChatRemovedEvent(payload, tip) {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            removeChatFromList(cid);
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              try {
                if (tip) ElementPlus.ElMessage.warning(tip);
              } catch (e2) {}
              await openChat('global');
            }
          } catch (e) {}
        }

        s.on('chat.dissolved', (payload) => handleChatRemovedEvent(payload, '群聊已解散'));
        s.on('chat.deleted', (payload) => handleChatRemovedEvent(payload, '会话已删除'));
        s.on('chat.kicked', (payload) => handleChatRemovedEvent(payload, '你已被移出群聊'));
      } catch (e) {
        // ignore
      }
    }

    function leaveSocketRoom(chatId) {
      try {
        if (!socket.value) return;
        if (!chatId) return;
        socket.value.emit('leave', chatId);
      } catch (e) {}
    }

    function joinSocketRoom(chatId) {
      try {
        if (!socket.value) return;
        if (!chatId) return;
        socket.value.emit('join', chatId);
        joinedChatId.value = chatId;
      } catch (e) {}
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

    function getCachedFaceUrl(userId) {
      if (!userId) return '';
      const v = userFaceCache[String(userId)];
      return v ? String(v) : '';
    }

    function messageAuthorFaceUrl(m) {
      if (!m || isOwnMessage(m)) return '';
      const fromUser = m.from_user || m.fromUser || m.from;
      if (!fromUser) return '';
      return getCachedFaceUrl(fromUser);
    }

    function formatLastMessage(chat) {
      if (!chat || !chat.lastMessage) return '';
      const msg = chat.lastMessage;
      if (isAuditRecalledMessage(msg)) return '';
      const text = messageTextPreview(msg);
      if (text) return text.length > 20 ? text.substring(0, 20) + '...' : text;
      if (msg.type === 'emoji') return '[表情]';
      if (msg.type === 'file') return '[文件]';
      return '';
    }

    // Fix common mojibake like "å±å¹...png" where UTF-8 bytes were decoded as Latin1.
    function fixUtf8Mojibake(s) {
      try {
        const str = String(s || '');
        if (!str) return '';

        // Only attempt when it contains lots of high bytes / control chars.
        const looksSuspicious = /[\u0080-\u009f]/.test(str) || /[\u00c2-\u00ff]/.test(str);
        if (!looksSuspicious) return str;

        if (typeof TextDecoder === 'undefined') return str;
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;

        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (!decoded) return str;

        // Heuristic: accept decode when it looks more like human text.
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

    function messageFilename(m) {
      try {
        if (!m || !m.content) return '';
        return displayFilename(m.content.filename || '');
      } catch (e) {
        return '';
      }
    }

    function isGroupChatItem(chat) {
      try {
        if (!chat) return false;
        return String(chat.type || '').toLowerCase() === 'group';
      } catch (e) {
        return false;
      }
    }

    function lastMessageSenderBadge(chat) {
      try {
        if (!isGroupChatItem(chat)) return '';
        const lm = chat && chat.lastMessage;
        if (!lm || typeof lm !== 'object') return '';
        const from = lm.from_user || lm.fromUser || lm.from || '';
        if (!from) return '';
        if (selfUserId.value && String(from) === String(selfUserId.value)) return '我';
        const name = userNameCache[String(from)];
        return name && name !== '未知玩家' ? String(name) : '未知玩家';
      } catch (e) {
        return '';
      }
    }

    function previewTagAndSuffixFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return { tag: '', suffix: '', text: '' };
        if (isAuditRecalledMessage(m)) return { tag: '', suffix: '', text: '' };
        if (isRecalledMessage(m)) return { tag: '已撤回', suffix: '', text: '' };

        const t = String(m.type || '').toLowerCase();
        if (t === 'gallery_image' || t === 'galleryimage' || t === 'gallery') {
          const id = galleryImageIdFromMessage(m);
          const info = id ? galleryMsgCache[String(id)] : null;
          const suffix = info && info.name ? String(info.name) : (id ? `#${id}` : '');
          return { tag: '相册', suffix, text: '' };
        }
        if (t === 'emoji' || t === 'sticker') {
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          return { tag: '表情', suffix: fn, text: '' };
        }
        if (t === 'file') {
          const mime = m.content && (m.content.mimetype || m.content.type) ? String(m.content.mimetype || m.content.type) : '';
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          const tag = /^image\//i.test(mime) ? '图片' : /^video\//i.test(mime) ? '视频' : '文件';
          return { tag, suffix: fn, text: '' };
        }

        if (t === 'video') {
          const fn = m.content && m.content.filename ? displayFilename(m.content.filename) : '';
          return { tag: '视频', suffix: fn, text: '' };
        }

        if (t === 'player_card' || t === 'playercard' || t === 'card') {
          const name = m.content && (m.content.name || m.content.username) ? String(m.content.name || m.content.username) : '';
          return { tag: '名片', suffix: name, text: '' };
        }

        if (t === 'coordinate') {
          const name = m.content && m.content.name !== undefined && m.content.name !== null ? String(m.content.name) : '';
          return { tag: '坐标', suffix: name, text: '' };
        }

        const txt = messageTextPreview(m);
        const str = txt ? String(txt) : '';
        return { tag: '', suffix: '', text: str };
      } catch (e) {
        return { tag: '', suffix: '', text: '' };
      }
    }

    function lastMessagePreviewTag(chat) {
      try {
        if (!chat || !chat.lastMessage) return '';
        return previewTagAndSuffixFromMessage(chat.lastMessage).tag || '';
      } catch (e) {
        return '';
      }
    }

    function lastMessagePreviewSuffix(chat) {
      try {
        if (!chat || !chat.lastMessage) return '';
        return previewTagAndSuffixFromMessage(chat.lastMessage).suffix || '';
      } catch (e) {
        return '';
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
        const p = previewTagAndSuffixFromMessage(m);
        if (p.tag) return '';
        const s = p.text ? String(p.text) : '';
        return s.length > 60 ? s.slice(0, 60) + '...' : s;
      } catch (e) {
        return '';
      }
    }

    function hasUnread(chatId) {
      return !!chatUnreadMap[chatId];
    }

    function parseAnyTimeToMs(v) {
      try {
        if (v === undefined || v === null || v === '') return 0;
        if (typeof v === 'number') {
          const ms = v < 1e12 ? v * 1000 : v;
          return Number.isFinite(ms) ? ms : 0;
        }
        const s = String(v);
        if (!s) return 0;
        if (/^\d+$/.test(s)) {
          const num = Number(s);
          const ms = num < 1e12 ? num * 1000 : num;
          return Number.isFinite(ms) ? ms : 0;
        }
        const d = new Date(s);
        const ms = d.getTime();
        return Number.isFinite(ms) ? ms : 0;
      } catch (e) {
        return 0;
      }
    }

    function chatLastActivityMs(chat) {
      try {
        if (!chat || typeof chat !== 'object') return 0;
        const lm = chat.lastMessage;
        const d = parseMessageTime(lm);
        if (d) return d.getTime();
        const v =
          chat.updatedAt ??
          chat.updated_at ??
          chat.lastActiveAt ??
          chat.last_active_at ??
          chat.createdAt ??
          chat.created_at;
        return parseAnyTimeToMs(v);
      } catch (e) {
        return 0;
      }
    }

    function sortChatsList(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      const filtered = arr.filter((c) => c && String(c.id) !== 'global');
      filtered.sort((a, b) => chatLastActivityMs(b) - chatLastActivityMs(a));
      return filtered;
    }

    function resortChats() {
      try {
        chats.value = sortChatsList(chats.value);
      } catch (e) {}
    }

    async function loadUsersIndex() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return;
        for (const u of list) {
          if (!u || typeof u !== 'object') continue;
          const id = u.id !== undefined && u.id !== null ? String(u.id) : '';
          if (!id) continue;
          userNameCache[id] = u.username || u.displayName || userNameCache[id] || '未知玩家';
          const mc = u.minecraft_id || u.minecraftId || u.minecraft_uuid || u.minecraftUuid || '';
          if (mc) userMinecraftCache[id] = String(mc);
          const face = u.faceUrl || u.face_url || u.face || u.face_key || '';
          if (face) userFaceCache[id] = face;
        }
        usersIndexLoaded.value = true;
      } catch (e) {
        // ignore
      }
    }

    async function resolveSelfProfile() {
      // Best-effort: try /users/me (if backend provides it)
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me && typeof me === 'object') {
            const id = me.id || me.userId || me.uid;
            if (id !== undefined && id !== null) selfUserId.value = String(id);
            const face = me.faceUrl || me.face_url || me.face || me.face_key;
            if (face) {
              selfFaceUrl.value = String(face);
              if (selfUserId.value) userFaceCache[String(selfUserId.value)] = String(face);
            }
            const name = me.username || me.displayName;
            if (name && selfUserId.value) userNameCache[selfUserId.value] = String(name);
            return;
          }
        }
      } catch (e) {}

      // Fallback: infer id, then use users index cache
      await resolveSelfUserId();
      if (selfUserId.value) {
        const face = getCachedFaceUrl(selfUserId.value);
        if (face) selfFaceUrl.value = face;
      }
    }

    async function resolveSelfUserId() {
      // 1) Prefer extracting from JWT token (no network)
      if (token.value) {
        const payload = decodeJwtPayload(token.value);
        if (payload && typeof payload === 'object') {
          const candidate = payload.userId || payload.uid || payload.id || payload.sub;
          if (candidate) {
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
          const candidate = data.userId || data.uid || data.id || (data.user && (data.user.id || data.user.userId));
          if (candidate) {
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

    function buildMessagesUrl(chatId, opts) {
      const before = opts && opts.beforeId ? `before=${encodeURIComponent(opts.beforeId)}&` : '';
      const limit = `limit=${encodeURIComponent(opts && opts.limit ? opts.limit : PAGE_LIMIT)}`;
      if (chatId === 'global') return `${apiBase.value}/global/messages?${before}${limit}`;
      return `${apiBase.value}/chats/${encodeURIComponent(chatId)}/messages?${before}${limit}`;
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }

    async function loadAllUsersList() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return;

        allUsersList.value = list
          .filter((u) => u && typeof u === 'object' && (u.id !== undefined && u.id !== null))
          .map((u) => ({
            id: String(u.id),
            username: u.username || u.displayName || u.name || String(u.id),
            // 对齐 /users 返回值字段
            minecraftUuid: (u.minecraftUuid || u.minecraft_uuid || u.minecraft_id || u.uuid || '') ? String(u.minecraftUuid || u.minecraft_uuid || u.minecraft_id || u.uuid) : '',
            faceUrl: normalizeAssetUrl(u.faceUrl || u.face_url || u.face || u.face_key || ''),
            // 兼容旧字段名（仅用于前端展示，不影响后端）
            mcUuid: (u.minecraftUuid || u.minecraft_uuid || u.minecraft_id || u.uuid || '') ? String(u.minecraftUuid || u.minecraft_uuid || u.minecraft_id || u.uuid) : '',
          }));
      } catch (e) {}
    }

    async function refreshGroupInfo(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}`);
        if (!res.ok) return;
        const meta = await res.json().catch(() => null);
        if (meta && typeof meta === 'object') {
          currentChatMeta.value = meta;
          if (String(meta.type || '').toLowerCase() === 'group') {
            currentChatTitle.value = meta.displayName || meta.name || '群聊';
            try {
              const av = extractChatAvatarUrl(meta);
              if (av) currentChatFaceUrl.value = av;
            } catch (e) {}
          }
          // Update chat list entry in-place
          try {
            const idx = (chats.value || []).findIndex((c) => c && String(c.id) === String(chatId));
            if (idx >= 0) {
              const prev = chats.value[idx];
              const next = Object.assign({}, prev, meta);
              chats.value.splice(idx, 1, next);
            }
          } catch (e2) {}
        }
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/avatar`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) throw new Error('upload avatar failed');
        const updated = await res.json().catch(() => null);
        if (updated && typeof updated === 'object') {
          currentChatMeta.value = Object.assign({}, currentChatMeta.value || {}, updated);
          try {
            const a = extractChatAvatarUrl(updated);
            if (a) currentChatFaceUrl.value = a;
          } catch (e) {}
          try {
            const idx = (chats.value || []).findIndex((c) => c && String(c.id) === String(currentChatId.value));
            if (idx >= 0) chats.value.splice(idx, 1, Object.assign({}, chats.value[idx], updated));
          } catch (e2) {}
        }
        ElementPlus.ElMessage.success('群头像已更新');
      } catch (e) {
        ElementPlus.ElMessage.error('设置群头像失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function loadGroupAdmins(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}/admins`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') return;
        groupOwnerId.value = data.ownerId !== undefined && data.ownerId !== null ? String(data.ownerId) : groupOwnerId.value;
        groupAdmins.value = Array.isArray(data.admins) ? data.admins.map(String) : [];
      } catch (e) {}
    }

    async function openGroupManage() {
      if (!isGroupChat.value || !currentChatId.value || currentChatId.value === 'global') return;
      // Prevent stale privilege state from a previous chat.
      // If loading admins fails, we must not accidentally treat someone as owner.
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupEditName.value || '').trim() || null }),
        });
        if (!res.ok) throw new Error('save name failed');
        const updated = await res.json().catch(() => null);
        if (updated && typeof updated === 'object') {
          currentChatMeta.value = updated;
          currentChatTitle.value = updated.displayName || updated.name || '群聊';
          try {
            const idx = (chats.value || []).findIndex((c) => c && String(c.id) === String(currentChatId.value));
            if (idx >= 0) chats.value.splice(idx, 1, Object.assign({}, chats.value[idx], updated));
          } catch (e2) {}
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/invite`, {
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/kick`, {
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/admins`, {
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/transfer`, {
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
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        if (!res.ok) {
          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e2) {}
          if (!err) err = `解散失败 (${res.status})`;
          throw new Error(err);
        }

        try {
          chats.value = (chats.value || []).filter((c) => c && String(c.id) !== String(chatId));
          try { delete chatUnreadMap[String(chatId)]; } catch (e3) {}
        } catch (e4) {}

        groupManageVisible.value = false;
        ElementPlus.ElMessage.success('群聊已解散');
        await openChat('global');
      } catch (e) {
        const msg = e && e.message ? String(e.message) : '解散失败';
        ElementPlus.ElMessage.error(msg);
      } finally {
        groupActionLoading.value = false;
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

    function openLoginPopup() {
      const base = apiAuthBase.value || apiBase.value;
      const popup = window.open(`${base}/auth/microsoft`, 'oauth', 'width=600,height=700');

      // Poll session instead of reading popup DOM (usually cross-origin).
      let tries = 0;
      const timer = setInterval(async () => {
        tries++;
        try {
          const ok = await checkSession();
          if (ok) {
            clearInterval(timer);
            try {
              if (popup && !popup.closed) popup.close();
            } catch (e) {}
            await loadUsersIndex();
            await resolveSelfProfile();
            await loadChats();
            return;
          }
        } catch (e) {}

        try {
          if (!popup || popup.closed) {
            clearInterval(timer);
            await checkSession();
            if (sessionOk.value) {
              await loadChats();
            }
            return;
          }
          const txt = popup.document.body && popup.document.body.innerText;
          if (!txt) return;
          let data;
          try {
            data = JSON.parse(txt);
          } catch (e) {
            return;
          }
          if (data && data.token) {
            token.value = data.token;
            localStorage.setItem('token', token.value);
            popup.close();
            clearInterval(timer);
            await loadUsersIndex();
            await resolveSelfProfile();
            await loadChats();
          }
        } catch (e) {
          // cross-origin until final redirect
        }

        // stop after ~2 minutes
        if (tries > 240) {
          clearInterval(timer);
        }
      }, 500);
    }

    async function logout() {
      token.value = null;
      localStorage.removeItem('token');
      sessionOk.value = false;
      try {
        if (socket.value) socket.value.disconnect();
      } catch (e) {}
      socket.value = null;
      joinedChatId.value = null;
      try {
        const base = apiAuthBase.value || apiBase.value;
        fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch (e) {}
      window.location.href = '/';
    }

    async function fetchMissingUserNames(ids) {
      const missing = Array.from(ids).filter((id) => id && !userNameCache[id]);
      if (missing.length === 0) return;
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await safeFetch(`${apiBase.value}/users/${encodeURIComponent(id)}`);
            if (!res.ok) throw new Error('no user');
            const u = await res.json();
            userNameCache[id] = u.username || u.displayName || '未知玩家';
            try {
              const mc = u && (u.minecraft_id || u.minecraftId || u.minecraft_uuid || u.minecraftUuid) || '';
              if (mc) userMinecraftCache[id] = String(mc);
            } catch (e2) {}
            const face = (u && (u.faceUrl || u.face_url || u.face)) || '';
            if (face) userFaceCache[id] = face;
          } catch (e) {
            userNameCache[id] = '未知玩家';
          }
        })
      );
    }

    function getChatPeerId(chat) {
      try {
        if (!chat || typeof chat !== 'object') return null;
        const membersRaw = Array.isArray(chat.members)
          ? chat.members
          : Array.isArray(chat.memberIds)
            ? chat.memberIds
            : Array.isArray(chat.member_ids)
              ? chat.member_ids
              : null;
        const members = membersRaw ? normalizeMembersArray(membersRaw) : null;
        if (!selfUserId.value) return null;
        const selfId = String(selfUserId.value);

        // Self-chat may be represented as [self] or [self, self]
        if (members && members.length === 1) {
          return String(members[0]) === selfId ? selfId : null;
        }
        if (members && members.length === 2) {
          const a = String(members[0]);
          const b = String(members[1]);
          if (a === selfId && b === selfId) return selfId;
          const otherId = [a, b].find((mid) => mid !== selfId);
          return otherId ? String(otherId) : null;
        }

        return null;
      } catch (e) {
        return null;
      }
    }

    function getChatName(chat) {
      try {
        if (!chat) return '';
        const t = chat.type !== undefined && chat.type !== null ? String(chat.type).toLowerCase() : '';
        if (t === 'group') return chat.displayName || chat.name || '群聊';

        if (chat.displayName) return chat.displayName;
        const peerId = getChatPeerId(chat);
        if (peerId && selfUserId.value && String(peerId) === String(selfUserId.value)) return '我';
        if (peerId && userNameCache[String(peerId)] && userNameCache[String(peerId)] !== '未知玩家') return userNameCache[String(peerId)];
        return chat.name || '会话';
      } catch (e) {
        return '';
      }
    }

    function getChatInitial(chat) {
      const name = String(getChatName(chat) || '').trim();
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    }

    function getChatAvatar(chat) {
      try {
        const t = chat && chat.type !== undefined && chat.type !== null ? String(chat.type).toLowerCase() : '';
        if (t === 'group') {
          const a = extractChatAvatarUrl(chat);
          if (a) return a;
        }
      } catch (e) {}

      const peerId = getChatPeerId(chat);
      if (!peerId) return '';
      if (selfUserId.value && String(peerId) === String(selfUserId.value)) {
        return selfFaceUrl.value || getCachedFaceUrl(peerId);
      }
      return getCachedFaceUrl(peerId);
    }

    function normalizeMessage(m, isGlobal) {
      if (!m || typeof m !== 'object') return m;
      // unify author id
      if (m.from && !m.from_user) m.from_user = m.from;
      // unify reply field
      if (m.repliedTo !== undefined && m.replied_to === undefined) m.replied_to = m.repliedTo;
      // global: backend may use `from`
      if (isGlobal && m.from && !m.from_user) m.from_user = m.from;
      return m;
    }

    function messageAuthorName(m) {
      const id = m && m.from_user;
      if (!id) return '';
      if (isOwnMessage(m)) return '我';
      return userNameCache[id] || '对方';
    }

    function isOwnMessage(m) {
      if (!m) return false;
      if (m.__own === true) return true;
      if (!m.from_user || !selfUserId.value) return false;
      return String(m.from_user) === String(selfUserId.value);
    }

    function isImageFile(m) {
      const mm = m && m.content && (m.content.mimetype || m.content.type);
      return !!mm && String(mm).startsWith('image/');
    }

    function isVideoFile(m) {
      const mm = m && m.content && (m.content.mimetype || m.content.type);
      return !!mm && String(mm).startsWith('video/');
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
        // images as text/image messages
        if (t === 'text') return false;
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

        // Try to fetch blob and save with filename (better UX); fall back to open in new tab
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
          // fallback: open in new tab
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
        hideCtxMenu();
        await downloadAttachment(msg);
        try { ElementPlus.ElMessage.success('已开始下载'); } catch (e) {}
      } catch (e) {}
    }

    function fileDisplayUrl(m) {
      if (!m || !m.content) return '';
      return m.content.__localUrl || m.content.thumbnailUrl || m.content.url || '';
    }

    function fileOriginalUrl(m) {
      try {
        if (!m || !m.content) return '';
        // For local optimistic message, use local blob.
        if (m.content.__localUrl) return m.content.__localUrl;
        // Prefer original file url for preview.
        return m.content.url || m.content.thumbnailUrl || '';
      } catch (e) {
        return '';
      }
    }

    function bubbleBackground(m) {
      // Use theme variables so it works for both light & dark.
      if (!m) return 'var(--mc-surface)';
      if (isAuditRecalledMessage(m)) return 'var(--mc-surface)';
      if (isRecalledMessage(m)) return 'var(--el-fill-color-lighter)';
      if (m.__status === 'sending') return 'var(--mc-active-bg)';
      if (m.__status === 'failed') return 'var(--el-color-danger-light-9)';
      return 'var(--mc-surface)';
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

    function previewFromStructuredContent(content) {
      try {
        if (!content || typeof content !== 'object') return '';

        // Gallery image payload: { id: 123 }
        if (content.id !== undefined && content.id !== null && Number.isFinite(Number(content.id))) {
          return '[相册]';
        }

        // Most common: { text: "..." }
        if (content.text !== undefined && content.text !== null) {
          const t = String(content.text);
          return t;
        }

        // Emoji-like payloads
        if (content.packId || content.pack_id) return '[表情]';

        // Some backends may wrap images as { key: "image/..." }
        if (content.key && /^image\//i.test(String(content.key))) return '[表情]';

        // File/image-like payloads
        const mime = content.mimetype || content.type || '';
        if (mime && /^image\//i.test(String(mime))) return '[图片]';
        if (mime && /^video\//i.test(String(mime))) return '[视频]';
        if (content.filename) return '[文件]';

        const url = content.url || content.thumbnailUrl || content.downloadUrl || '';
        if (url) {
          const u = String(url);
          if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return '[图片]';
          if (/\.(mp4|webm|mov|mkv)(\?|#|$)/i.test(u)) return '[视频]';
          return '[文件]';
        }

        return '[富文本]';
      } catch (e) {
        return '[富文本]';
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
        // tolerate JSON string
        if (s.startsWith('{') && s.endsWith('}')) {
          const j = JSON.parse(s);
          const v = j && j.id !== undefined && j.id !== null ? Number(j.id) : NaN;
          return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
        }
      } catch (e) {}
      return null;
    }

    const galleryMsgCache = reactive({}); // id -> { id, name, url }
    const galleryMsgLoading = reactive({}); // id -> true

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
        // ignore
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
        window.location.href = `/gallery.html?detail=${encodeURIComponent(String(id))}`;
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
      if (String(m.type || '').toLowerCase() === 'coordinate') {
        try {
          const c = m.content && typeof m.content === 'object' ? m.content : null;
          if (!c) return '[坐标]';
          const name = c.name !== undefined && c.name !== null ? String(c.name).trim() : '';
          const dimRaw = c.dimension !== undefined && c.dimension !== null ? String(c.dimension).trim() : '';
          const dim = dimRaw === 'world' ? '主世界' : dimRaw === 'world_nether' ? '下界' : dimRaw === 'world_the_end' ? '末地' : dimRaw;
          const x = Number(c.x);
          const y = Number(c.y);
          const z = Number(c.z);
          const xyzOk = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
          let s = '[坐标]';
          if (name) s += ' ' + name;
          if (dim) s += ` (${dim})`;
          if (xyzOk) s += ` ${x},${y},${z}`;
          const desc = c.description !== undefined && c.description !== null ? String(c.description).trim() : '';
          if (desc) s += ' - ' + desc;
          return s;
        } catch (e) {
          return '[坐标]';
        }
      }
      if (m.type === 'emoji' && m.content) {
        const fn = (m.content && m.content.filename) ? String(m.content.filename) : '';
        return fn ? '[表情] ' + fn : '[表情]';
      }
      if (m.type === 'file') {
        const fn = m.content && m.content.filename ? String(m.content.filename) : '';
        return fn ? '[文件] ' + fn : '[文件]';
      }
      if (m.content && typeof m.content === 'object') {
        // content might be {text:...} or other structured payload
        return previewFromStructuredContent(m.content);
      }
      if (m.content === null || m.content === undefined) return '';
      return String(m.content);
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

        // If message carries mentions but text doesn't embed any '@name', render mentions as a prefix.
        if (tokens.length > 0 && (!text || !tokens.some((t) => text.includes(t)))) {
          const parts = tokens.map((t) => ({ t: 'mention', v: t }));
          if (text) parts.push({ t: 'text', v: ' ' + text });
          return parts;
        }

        if (!text) return tokens.length > 0 ? tokens.map((t) => ({ t: 'mention', v: t })) : [{ t: 'text', v: '' }];

        // Inline parsing when tokens are embedded in text.
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

    function extractChatIdAndMessageFromUpdate(payload) {
      try {
        if (!payload) return { chatId: null, message: null };
        if (payload.message && typeof payload.message === 'object') {
          const chatId = payload.chatId || payload.chat_id || normalizeChatIdFromMessage(payload.message) || null;
          return { chatId, message: payload.message };
        }
        const chatId = normalizeChatIdFromMessage(payload) || payload.chatId || payload.chat_id || null;
        return { chatId, message: payload };
      } catch (e) {
        return { chatId: null, message: null };
      }
    }

    function applyMessageUpdate(chatId, updated) {
      try {
        if (!updated || typeof updated !== 'object') return;
        const id = updated.id;
        if (!id) return;

        // Silent audit recall: remove from list entirely.
        if (isAuditRecalledMessage(updated)) {
          removeLocalMessageById(String(id));
          if (chatId && chatId !== 'global') {
            const chat = (chats.value || []).find((c) => c && String(c.id) === String(chatId));
            if (chat && chat.lastMessage && chat.lastMessage.id && String(chat.lastMessage.id) === String(id)) {
              chat.lastMessage = null;
            }
          }
          return;
        }

        // normalize fields so UI can render
        normalizeMessage(updated, chatId === 'global');

        if (msgById[id]) {
          try {
            Object.assign(msgById[id], updated);
          } catch (e) {}
        } else if (currentChatId.value && chatId && String(chatId) === String(currentChatId.value)) {
          upsertIncomingMessage(updated);
        }

        // If this is the last message of a chat in list, update preview.
        if (chatId && chatId !== 'global') {
          const chat = (chats.value || []).find((c) => c && String(c.id) === String(chatId));
          if (chat && chat.lastMessage && chat.lastMessage.id && String(chat.lastMessage.id) === String(id)) {
            chat.lastMessage = updated;
          }
        }
      } catch (e) {}
    }

    async function postRecallRequest(messageId) {
      const mid = messageId !== undefined && messageId !== null ? String(messageId) : '';
      if (!mid) throw new Error('missing messageId');

      const endpoints = [];
      // Common patterns across different backends / router mounts.
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
      hideCtxMenu();
      try {
        if (!canRecallMessage(msg)) {
          ElementPlus.ElMessage.warning('只能撤回 2 分钟内发送的消息');
          return;
        }
        const result = await postRecallRequest(msg.id);
        const updated = (result && result.message) ? result.message : null;
        if (updated) {
          applyMessageUpdate(updated.chatId || updated.chat_id || currentChatId.value, updated);
        }
      } catch (e) {
        const m = e && e.message ? String(e.message) : '撤回失败';
        ElementPlus.ElMessage.error(m);
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
      // number-like
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

        // Light blue highlight with extra breathing room around the message.
        el.style.borderRadius = '10px';
        el.style.background = '#eef6ff';
        // spread shadow creates "padding" visually without shifting layout
        el.style.boxShadow = '0 0 0 6px rgba(238, 246, 255, 0.95)';
        setTimeout(() => {
          el.style.background = prevBg;
          el.style.boxShadow = prevShadow;
          el.style.borderRadius = prevRadius;
        }, 800);
      } catch (e) {}
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
        imagePreviewDragging.value = false;
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
        imagePreviewDragging.value = false;
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function requestCloseImagePreview() {
      try {
        if (imagePreviewDragging.value) return;
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
      imagePreviewDragging.value = false;
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

    function onImagePreviewWheel(ev) {
      try {
        if (!ev) return;
        const target = ev.currentTarget || ev.target;
        if (!target || !target.getBoundingClientRect) return;

        const rect = target.getBoundingClientRect();
        const cx = Number(ev.clientX) || 0;
        const cy = Number(ev.clientY) || 0;

        const oldScale = Number(imagePreviewScale.value) || 1;
        const delta = ev.deltaY;
        const factor = delta < 0 ? 1.1 : 0.9;
        const newScale = clampImageScale(oldScale * factor);
        if (newScale === oldScale) return;

        // With transform-origin: 0 0 and transform: translate(x,y) scale(s)
        // rect.left/top corresponds to the transformed origin (L0 + x, T0 + y).
        const px = cx - rect.left;
        const py = cy - rect.top;

        const curX = Number(imagePreviewX.value) || 0;
        const curY = Number(imagePreviewY.value) || 0;
        imagePreviewX.value = curX + px * (1 - newScale / oldScale);
        imagePreviewY.value = curY + py * (1 - newScale / oldScale);
        imagePreviewScale.value = newScale;

        if (newScale === 1) {
          imagePreviewX.value = 0;
          imagePreviewY.value = 0;
        }
      } catch (e) {}
    }

    function onImagePreviewMouseDown(ev) {
      try {
        if (!ev) return;
        imagePreviewDragging.value = true;
        imgDragStartX = ev.clientX;
        imgDragStartY = ev.clientY;
        imgDragOriginX = Number(imagePreviewX.value) || 0;
        imgDragOriginY = Number(imagePreviewY.value) || 0;
      } catch (e) {}
    }

    function onImagePreviewMouseMove(ev) {
      try {
        if (!imagePreviewDragging.value) return;
        if (!ev) return;
        const dx = ev.clientX - imgDragStartX;
        const dy = ev.clientY - imgDragStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imagePreviewMoved.value = true;
        imagePreviewX.value = imgDragOriginX + dx;
        imagePreviewY.value = imgDragOriginY + dy;
      } catch (e) {}
    }

    function onImagePreviewMouseUp() {
      try {
        imagePreviewDragging.value = false;
      } catch (e) {}
    }

    function setReplyTarget(m) {
      if (isGlobalChat.value) return;
      replyTarget.value = m;
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

    function showCtxMenu(ev, msg) {
      const isGlobal = !!isGlobalChat.value;
      if (isGlobal && !canCopyText(msg)) return;

      ctxMenuMsg.value = msg;
      let x = ev.clientX;
      let y = ev.clientY;
      // keep menu within viewport
      const menuWidth = 140;
      let itemCount = 0;
      try {
        if (canCopyText(msg)) itemCount += 1;
        if (!isGlobal) itemCount += 1; // reply
        if (!isGlobal && canForwardMessage(msg)) itemCount += 1;
        if (canRecallMessage(msg)) itemCount += 1;
        if (canCollectEmoji(msg)) itemCount += 1;
      } catch (e) {}
      const menuHeight = Math.max(60, 18 + itemCount * 32);
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
      if (x < 10) x = 10;
      if (y < 10) y = 10;
      ctxMenuX.value = x;
      ctxMenuY.value = y;
      ctxMenuVisible.value = true;
    }

    function hideCtxMenu() {
      ctxMenuVisible.value = false;
      ctxMenuMsg.value = null;
    }

    function onMessageContextMenu(ev, msg) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (e) {}
      showCtxMenu(ev, msg);
    }

    function ctxReply() {
      if (!ctxMenuMsg.value) return;
      setReplyTarget(ctxMenuMsg.value);
      hideCtxMenu();
    }

    function ctxForward() {
      try {
        const msg = ctxMenuMsg.value;
        hideCtxMenu();
        openForwardDialog(msg);
      } catch (e) {
        try { hideCtxMenu(); } catch (e2) {}
      }
    }

    async function ctxCopy() {
      const msg = ctxMenuMsg.value;
      if (!canCopyText(msg)) return;
      hideCtxMenu();
      try {
        await copyToClipboardText(messageTextPreview(msg));
        ElementPlus.ElMessage.success('已复制');
      } catch (e) {
        ElementPlus.ElMessage.error('复制失败');
      }
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
        hideCtxMenu();
        insertMention(id, label);
      } catch (e) {
        try { hideCtxMenu(); } catch (e2) {}
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

    async function ctxCollectEmoji() {
      const msg = ctxMenuMsg.value;
      if (!canCollectEmoji(msg)) return;
      hideCtxMenu();
      try {
        const res = await safeFetch(`${apiBase.value}/emoji/collect/${encodeURIComponent(msg.id)}`, {
          method: 'POST',
        });
        if (res.ok) {
          ElementPlus.ElMessage.success('已添加到表情包');
          if (emojiPanelVisible.value) {
            try {
              const r = await safeFetch(`${apiBase.value}/emoji`);
              if (r.ok) emojiPacks.value = await r.json();
            } catch (e2) {}
          }
          return;
        }

        let err = '';
        try {
          const data = await res.json().catch(() => null);
          err = data && (data.error || data.message) ? String(data.error || data.message) : '';
        } catch (e) {}
        if (!err) err = `操作失败 (${res.status})`;
        if (res.status === 400) ElementPlus.ElMessage.warning(err);
        else ElementPlus.ElMessage.error(err);
      } catch (e) {
        ElementPlus.ElMessage.error('添加失败');
      }
    }

    function clearReplyTarget() {
      replyTarget.value = null;
    }

    const replyPreview = computed(() => {
      if (!replyTarget.value) return '';
      const author = messageAuthorName(replyTarget.value);
      const txt = messageTextPreview(replyTarget.value);
      const shortTxt = txt.length > 200 ? txt.slice(0, 200) + '...' : txt;
      return (author ? author + ': ' : '') + shortTxt;
    });

    async function loadChats() {
      chatsLoading.value = true;
      try {
        if (!usersIndexLoaded.value) {
          await loadUsersIndex();
          await resolveSelfProfile();
        }
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) throw new Error('未登录或请求失败');
        const raw = await res.json();
        chats.value = sortChatsList(raw);

        // Initialize unread flags from server snapshot (covers offline期间收到消息的提示).
        try {
          const keep = new Set();
          const seenMap = loadChatSeenMap();
          (chats.value || []).forEach((c) => {
            if (!c || c.id === undefined || c.id === null) return;
            const cid = String(c.id);
            keep.add(cid);
            const isCurrent = currentChatId.value !== null && currentChatId.value !== undefined && String(currentChatId.value) === cid;
            if (isCurrent) {
              chatUnreadMap[cid] = false;
            } else if (c.hasUnread !== undefined) {
              chatUnreadMap[cid] = !!c.hasUnread;
            } else {
              // Fallback: compare lastMessage time with local last-seen
              try {
                const lm = c.lastMessage;
                if (!lm || typeof lm !== 'object') return;
                const from = lm.from_user || lm.fromUser || lm.from || '';
                if (selfUserId.value && from && String(from) === String(selfUserId.value)) return;
                const ts = parseAnyTimeToMs(lm.created_at || lm.createdAt || lm.time || lm.ts || 0);
                const seen = Number(seenMap[cid] || 0);
                if (ts > 0 && ts > seen) chatUnreadMap[cid] = true;
              } catch (e2) {}
            }
          });
          // Cleanup stale keys
          Object.keys(chatUnreadMap || {}).forEach((k) => {
            if (!keep.has(String(k))) delete chatUnreadMap[k];
          });
        } catch (e) {}

        // If we were asked to open a specific chat, but it doesn't appear in the list yet
        // (race condition / cached list / eventual consistency), fetch it best-effort and insert.
        try {
          const params = new URLSearchParams(window.location.search);
          const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
          const toOpen = openId || null;
          if (toOpen && toOpen !== 'global') {
            const exists = (chats.value || []).some((c) => c && String(c.id) === String(toOpen));
            if (!exists) {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(toOpen)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta && typeof meta === 'object') {
                  chats.value = sortChatsList((chats.value || []).concat([meta]));
                }
              }
            }
          }
        } catch (e) {}

        // Prefetch 1:1 peer profiles so chat list can show avatars.
        try {
          const peerIds = new Set();
          (chats.value || []).forEach((c) => {
            const pid = getChatPeerId(c);
            if (pid) peerIds.add(pid);
          });
          await fetchMissingUserNames(peerIds);
        } catch (e) {}

        // open initial chat
        const params = new URLSearchParams(window.location.search);
        const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
        const toOpen = openId || 'global';
        await openChat(toOpen);
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('加载会话失败，请检查登录状态');
      } finally {
        chatsLoading.value = false;
      }
    }

    async function openChat(id) {
      // Draft preservation across chat switching:
      // 1) Save previous chat's composer content (including reply/@ chips)
      // 2) Clear composer for the next chat
      try {
        const prev = currentChatId.value;
        if (prev !== undefined && prev !== null && String(prev) !== String(id)) {
          saveComposerDraftForChat(prev);
          clearComposerUIState();
        }
      } catch (e) {}

      // 立即显示加载动画
      chatLoading.value = true;

      // Reset paging UI state
      loadingMore.value = false;
      noMoreBefore.value = false;
      
      // 清除当前会话的未读标记
      if (id && id !== 'global') {
        chatUnreadMap[id] = false;
        try { setChatSeenAtMs(id, Date.now()); } catch (e) {}
      }
      
      // 等待下一个tick，确保UI更新
      await nextTick();
      
      // leave previous room
      try {
        if (joinedChatId.value && joinedChatId.value !== id) leaveSocketRoom(joinedChatId.value);
      } catch (e) {}

      currentChatId.value = id;
      currentChatMeta.value = null;
      emojiPanelVisible.value = false;
      morePanelVisible.value = false;
      currentChatFaceUrl.value = '';
      if (id === 'global') clearReplyTarget();

      const isGlobal = id === 'global';
      try {
        if (isGlobal) {
          currentChatTitle.value = '全服';
          currentChatFaceUrl.value = '/img/Ag_0404.png';
        } else {
          currentChatTitle.value = '';

          // Guess peer user for 1:1 chat and show avatar if available
          try {
            const chatObj = (chats.value || []).find((c) => c && c.id === id);
            let members = chatObj && Array.isArray(chatObj.members) ? normalizeMembersArray(chatObj.members) : null;
            if (!members || members.length === 0) {
              // some backends may use memberIds
              members = chatObj && Array.isArray(chatObj.memberIds) ? normalizeMembersArray(chatObj.memberIds) : members;
            }
            if (!members || members.length === 0) {
              members = chatObj && Array.isArray(chatObj.member_ids) ? normalizeMembersArray(chatObj.member_ids) : members;
            }
            if (members && members.length === 2 && selfUserId.value) {
              const otherId = members.find((mid) => String(mid) !== String(selfUserId.value));
              if (otherId) {
                currentChatFaceUrl.value = getCachedFaceUrl(otherId);
                if (!currentChatTitle.value) currentChatTitle.value = userNameCache[otherId] || '对方';
              }
            }
          } catch (e) {}

          try {
            const chatMeta = await fetchChatMetaById(id);
            if (chatMeta && typeof chatMeta === 'object') {
              currentChatMeta.value = chatMeta;
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '';

              if (String(chatMeta.type || '').toLowerCase() === 'group') {
                currentChatTitle.value = chatMeta.displayName || chatMeta.name || '群聊';
                groupOwnerId.value = chatMeta.created_by !== undefined && chatMeta.created_by !== null ? String(chatMeta.created_by) : groupOwnerId.value;
                // best-effort load admins async
                try { loadGroupAdmins(id); } catch (e) {}

                try {
                  const av = extractChatAvatarUrl(chatMeta);
                  if (av) currentChatFaceUrl.value = av;
                } catch (e) {}
              }

              try {
                const membersRaw = Array.isArray(chatMeta.members)
                  ? chatMeta.members
                  : Array.isArray(chatMeta.memberIds)
                    ? chatMeta.memberIds
                    : Array.isArray(chatMeta.member_ids)
                      ? chatMeta.member_ids
                      : null;
                const members = membersRaw ? normalizeMembersArray(membersRaw) : null;
                if (members && members.length === 2 && selfUserId.value) {
                  const otherId = members.find((mid) => String(mid) !== String(selfUserId.value));
                  if (otherId) {
                    const face = getCachedFaceUrl(otherId);
                    if (face) currentChatFaceUrl.value = face;
                    if (!currentChatTitle.value) currentChatTitle.value = userNameCache[otherId] || '对方';
                  }
                }
              } catch (e) {}
            }
          } catch (e) {}
        }

        const msgUrl = buildMessagesUrl(id, { limit: PAGE_LIMIT });
        const res = await safeFetch(msgUrl);
        if (!res.ok) throw new Error('加载消息失败');
        let msgs = await res.json();
        // Safety: if backend ignores limit and returns full history, only render latest page.
        if (Array.isArray(msgs) && msgs.length > PAGE_LIMIT) msgs = msgs.slice(-PAGE_LIMIT);

        // Silent audit recall: never render these messages.
        if (Array.isArray(msgs)) msgs = msgs.filter((m) => !isAuditRecalledMessage(m));

        // reset maps
        messages.value = [];
        for (const k of Object.keys(msgById)) delete msgById[k];

        msgs.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id && !isAuditRecalledMessage(m)) msgById[m.id] = m;
        });

        const userIds = new Set();
        msgs.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.from_user) userIds.add(m.from_user);
          if (!isGlobal && m && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) userIds.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(userIds);

        messages.value = msgs.slice().filter((m) => !isAuditRecalledMessage(m)).map((m) => normalizeMessage(m, isGlobal));
        noMoreBefore.value = !Array.isArray(msgs) || msgs.length < PAGE_LIMIT;

        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

        // Best-effort: opening chat means current loaded messages are read.
        try {
          queueReadForCurrentChat();
          flushReadReportOnce();
        } catch (e) {}

        // After chat loads, restore any saved draft for this chat.
        // This runs after the mention-reset watcher, so state stays consistent.
        try {
          restoreComposerDraftForChat(id);
        } catch (e) {}

        // join room after initial load
        try {
          connectSocket();
          joinSocketRoom(id);
        } catch (e) {}
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('无法打开会话');
      } finally {
        // 加载完成，隐藏动画
        chatLoading.value = false;
      }
    }

    async function loadMoreMessages() {
      if (!currentChatId.value) return;
      if (loadingMore.value || noMoreBefore.value) return;
      if (!messagesEl.value) return;
      const first = messages.value[0];
      if (!first || !first.id) return;

      loadingMore.value = true;
      const beforeId = first.id;
      const isGlobal = currentChatId.value === 'global';

      try {
        const url = buildMessagesUrl(currentChatId.value, { beforeId, limit: PAGE_LIMIT });

        const prevScrollHeight = messagesEl.value.scrollHeight;
        const prevScrollTop = messagesEl.value.scrollTop;

        const res = await safeFetch(url);
        if (!res.ok) throw new Error('加载更多消息失败');
        let more = await res.json();
        if (!more || more.length === 0) {
          noMoreBefore.value = true;
          return;
        }

        // Silent audit recall: never render these messages.
        if (Array.isArray(more)) more = more.filter((m) => !isAuditRecalledMessage(m));

        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id && !isAuditRecalledMessage(m)) msgById[m.id] = m;
        });

        const moreUserIds = new Set();
        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.from_user) moreUserIds.add(m.from_user);
          if (!isGlobal && m && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) moreUserIds.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(moreUserIds);

        messages.value = more.concat(messages.value).filter((m) => !isAuditRecalledMessage(m)).map((m) => normalizeMessage(m, isGlobal));

        await nextTick();
        const newScrollHeight = messagesEl.value.scrollHeight;
        messagesEl.value.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;

        if (more.length < PAGE_LIMIT) noMoreBefore.value = true;
      } catch (e) {
        console.error(e);
      } finally {
        loadingMore.value = false;
      }
    }

    function onMessagesScroll() {
      if (!messagesEl.value) return;
      if (messagesEl.value.scrollTop < 80) {
        loadMoreMessages();
      }

      try { queueReadForCurrentChat(); } catch (e) {}
    }

    async function sendText() {
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');

      // Rich-input: sync DOM -> state before reading.
      try {
        if (isRichInputActive()) syncStateFromRichInput();
      } catch (e) {}
      const text = (msgInput.value || '').trim();

      // Snapshot mentions (group chat only) - independent from text content.
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

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimisticMsg = {
        id: tempId,
        type: 'text',
        content:
          !isGlobalChat.value && isGroupChat.value && (mentionAll || mentionIds.length > 0)
            ? { text, mentions: mentionIds.map((id) => ({ userId: id })), mentionAll }
            : { text },
        from_user: selfUserId.value || '__me__',
        createdAt: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };

      // Ensure read UI can render immediately for newly sent messages.
      // - direct chat: show "未读" by default
      // - group chat: show 0 readers by default
      try {
        if (!isGlobalChat.value && !isSelfChat.value) {
          if (isGroupChat.value) optimisticMsg.readCount = 0;
          else if (isDirectChat.value) optimisticMsg.read = false;
        }
      } catch (e) {}

      if (!isGlobalChat.value && replyTarget.value) optimisticMsg.replied_to = replyTarget.value;
      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      msgInput.value = '';
      clearRichInputDom();
      pendingMentions.value = [];
      pendingMentionAll.value = false;
      mentionDialogVisible.value = false;
      mentionSelectAll.value = false;
      mentionSelectIds.value = [];
      mentionQuery.value = '';
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        if (isGlobalChat.value) {
          const res = await safeFetch(`${apiBase.value}/global/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          });
          if (!res.ok) throw new Error('发送失败');
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, true);
        } else {
          const payload = {
            type: 'text',
            content: mentionAll || mentionIds.length > 0 ? { text, mentions: mentionIds.map((id) => ({ userId: id })), mentionAll } : text,
          };
          if (replyTarget.value) payload.repliedTo = replyTarget.value.id || replyTarget.value;
          const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error('发送失败');
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, false);
          clearReplyTarget();
        }
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送消息失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
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

        coordinateDialogVisible.value = false;
        coordinateSending.value = false;
        resetCoordinateForm();
      });
    } catch (e) {}

    async function toggleEmojiPanel() {
      if (isGlobalChat.value) return;
      emojiPanelVisible.value = !emojiPanelVisible.value;
      if (emojiPanelVisible.value) morePanelVisible.value = false;
      if (!emojiPanelVisible.value) return;

      try {
        const res = await safeFetch(`${apiBase.value}/emoji`);
        if (!res.ok) throw new Error('load emoji failed');
        emojiPacks.value = await res.json();
      } catch (e) {
        console.error(e);
        emojiPacks.value = [];
      }
    }

    async function sendEmoji(pack) {
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');
      if (isGlobalChat.value) return ElementPlus.ElMessage.warning('全服聊天不支持表情包');

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimisticMsg = {
        id: tempId,
        type: 'emoji',
        content: {
          packId: pack.id,
          url: pack.url,
          filename: (pack.meta && pack.meta.filename) || pack.filename || '',
        },
        from_user: selfUserId.value || '__me__',
        createdAt: new Date().toISOString(),
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

      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value;
      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      emojiPanelVisible.value = false;
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        const payload = {
          type: 'emoji',
          content: {
            packId: pack.id,
            url: pack.url,
            filename: (pack.meta && pack.meta.filename) || pack.filename || '',
          },
        };
        if (replyTarget.value) payload.repliedTo = replyTarget.value.id || replyTarget.value;

        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('发送失败');
        const serverMsg = await res.json().catch(() => null);
        ackOptimisticMessage(tempId, serverMsg, false);
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送表情失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }
    }

    function openFilePicker() {
      if (isGlobalChat.value) return;
      try {
        const el = fileInputEl.value;
        if (!el) return;
        el.value = '';
        el.click();
      } catch (e) {}
    }

    function toggleMorePanel() {
      if (isGlobalChat.value) return;
      morePanelVisible.value = !morePanelVisible.value;
      if (morePanelVisible.value) emojiPanelVisible.value = false;
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
        try {
          ElementPlus.ElMessage.error('Home 加载失败');
        } catch (e2) {}
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

    async function openCoordinateDialog() {
      try {
        if (!currentChatId.value) {
          try { ElementPlus.ElMessage.warning('先选择会话'); } catch (e0) {}
          return;
        }
        if (isGlobalChat.value) {
          try { ElementPlus.ElMessage.warning('全服聊天不支持坐标'); } catch (e1) {}
          return;
        }
        morePanelVisible.value = false;
        resetCoordinateForm();
        await loadCoordinateHomes(false);
        coordinateDialogVisible.value = true;
      } catch (e) {}
    }

    function cancelCoordinateDialog() {
      coordinateDialogVisible.value = false;
      coordinateSending.value = false;
      resetCoordinateForm();
    }

    function parseFiniteNumberInput(v) {
      try {
        if (v === undefined || v === null) return NaN;
        const s = String(v).trim();
        if (!s) return NaN;
        if (!/^-?\d+$/.test(s)) return NaN;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : NaN;
      } catch (e) {
        return NaN;
      }
    }

    async function confirmSendCoordinate() {
      if (coordinateSending.value) return;
      try {
        if (!currentChatId.value) {
          try { ElementPlus.ElMessage.warning('先选择会话'); } catch (e0) {}
          return;
        }
        if (isGlobalChat.value) {
          try { ElementPlus.ElMessage.warning('全服聊天不支持坐标'); } catch (e1) {}
          return;
        }

        const name = String(coordinateForm.name || '').trim();
        const dimension = String(coordinateForm.dimension || '').trim();
        const x = parseFiniteNumberInput(coordinateForm.x);
        const y = parseFiniteNumberInput(coordinateForm.y);
        const z = parseFiniteNumberInput(coordinateForm.z);
        const descriptionRaw = String(coordinateForm.description || '').trim();
        const description = descriptionRaw ? descriptionRaw : null;

        if (!name) {
          try { ElementPlus.ElMessage.warning('请输入坐标点名称'); } catch (e2) {}
          return;
        }
        if (!dimension) {
          try { ElementPlus.ElMessage.warning('请输入维度'); } catch (e3) {}
          return;
        }

        const allowedDims = new Set(['world', 'world_nether', 'world_the_end']);
        if (!allowedDims.has(dimension)) {
          try { ElementPlus.ElMessage.warning('请选择维度（主世界/下界/末地）'); } catch (e3b) {}
          return;
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          try { ElementPlus.ElMessage.warning('请输入有效的 XYZ 整数'); } catch (e4) {}
          return;
        }

        coordinateSending.value = true;

        const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const optimisticMsg = {
          id: tempId,
          type: 'coordinate',
          content: { name, dimension, x, y, z, description },
          from_user: selfUserId.value || '__me__',
          createdAt: new Date().toISOString(),
          __own: true,
          __status: 'sending',
        };

        try {
          if (!isGlobalChat.value && !isSelfChat.value) {
            if (isGroupChat.value) optimisticMsg.readCount = 0;
            else if (isDirectChat.value) optimisticMsg.read = false;
          }
        } catch (e5) {}

        if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value;
        msgById[tempId] = optimisticMsg;
        messages.value = messages.value.concat([optimisticMsg]);

        // close modal early
        coordinateDialogVisible.value = false;

        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

        const payload = { type: 'coordinate', content: { name, dimension, x, y, z, description } };
        if (replyTarget.value) payload.repliedTo = replyTarget.value.id || replyTarget.value;

        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('发送失败');
        const serverMsg = await res.json().catch(() => null);
        ackOptimisticMessage(tempId, serverMsg, false);
        clearReplyTarget();
        resetCoordinateForm();
      } catch (e) {
        console.error(e);
        try {
          // best-effort: mark the latest pending coordinate as failed
          const list = Array.isArray(messages.value) ? messages.value : [];
          for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i];
            if (m && m.__status === 'sending' && String(m.type || '').toLowerCase() === 'coordinate') {
              m.__status = 'failed';
              break;
            }
          }
        } catch (e2) {}
        try { ElementPlus.ElMessage.error('发送坐标失败'); } catch (e3) {}
      } finally {
        coordinateSending.value = false;
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
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
        return `/map.html?${qs.toString()}`;
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
        try { window.location.href = '/map.html'; } catch (e2) {}
      }
    }

    async function ensureAllUsersLoadedForPlayerCard() {
      try {
        if (Array.isArray(allUsersList.value) && allUsersList.value.length > 0) return;
        playerCardUsersLoading.value = true;
        await loadAllUsersList();
      } catch (e) {
      } finally {
        playerCardUsersLoading.value = false;
      }
    }

    async function openPlayerCardDialog() {
      try {
        if (!currentChatId.value) {
          try { ElementPlus.ElMessage.warning('先选择会话'); } catch (e0) {}
          return;
        }
        if (isGlobalChat.value) {
          try { ElementPlus.ElMessage.warning('全服聊天不支持玩家名片'); } catch (e1) {}
          return;
        }
        morePanelVisible.value = false;
        playerCardDialogVisible.value = true;
        playerCardSelectedUserId.value = '';
        playerCardQuery.value = '';
        await ensureAllUsersLoadedForPlayerCard();
      } catch (e) {}
    }

    function cancelPlayerCardDialog() {
      playerCardDialogVisible.value = false;
      playerCardSelectedUserId.value = '';
      playerCardQuery.value = '';
    }

    async function confirmSendPlayerCard() {
      if (playerCardSending.value) return;
      try {
        if (!currentChatId.value) {
          try { ElementPlus.ElMessage.warning('先选择会话'); } catch (e0) {}
          return;
        }
        if (isGlobalChat.value) {
          try { ElementPlus.ElMessage.warning('全服聊天不支持玩家名片'); } catch (e1) {}
          return;
        }
        const uid = playerCardSelectedUserId.value ? String(playerCardSelectedUserId.value) : '';
        if (!uid) {
          try { ElementPlus.ElMessage.warning('请选择 1 位玩家'); } catch (e2) {}
          return;
        }

        playerCardSending.value = true;
        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/player-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid }),
        });
        if (!res.ok) {
          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e3) {}
          if (!err) {
            try { err = await res.text().catch(() => ''); } catch (e4) {}
          }
          if (!err) err = `发送失败 (${res.status})`;
          try {
            if (res.status === 400) ElementPlus.ElMessage.warning(err);
            else ElementPlus.ElMessage.error(err);
          } catch (e5) {}
          return;
        }

        const msg = await res.json().catch(() => null);
        try {
          const stickToBottom = isScrolledNearBottom(messagesEl.value);
          upsertIncomingMessage(msg);
          await ensureUserCachesForMessages([msg], false);
          await nextTick();
          if (stickToBottom && messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        } catch (e6) {}

        try { ElementPlus.ElMessage.success('已发送玩家名片'); } catch (e7) {}
        cancelPlayerCardDialog();
      } catch (e) {
        console.error(e);
        try { ElementPlus.ElMessage.error('发送玩家名片失败'); } catch (e8) {}
      } finally {
        playerCardSending.value = false;
      }
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
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');
      if (isGlobalChat.value) return ElementPlus.ElMessage.warning('全服聊天暂不支持发送文件');

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
        createdAt: new Date().toISOString(),
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

      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value;

      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'file');
        if (replyTarget.value) fd.append('repliedTo', replyTarget.value.id || String(replyTarget.value));

        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) throw new Error('发送失败');
        const serverMsg = await res.json().catch(() => null);
        ackOptimisticMessage(tempId, serverMsg, false);
        clearReplyTarget();
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送文件失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }
    }

    function clipboardFilesFromEvent(ev) {
      try {
        const dt = ev && ev.clipboardData;
        if (!dt) return [];

        const out = [];
        if (dt.items && dt.items.length) {
          for (const it of dt.items) {
            if (!it) continue;
            if (it.kind === 'file') {
              const f = it.getAsFile && it.getAsFile();
              if (f) out.push(f);
            }
          }
        }
        if (!out.length && dt.files && dt.files.length) {
          for (const f of dt.files) out.push(f);
        }
        return out;
      } catch (e) {
        return [];
      }
    }

    async function handlePasteToSend(ev) {
      try {
        // Only when a non-global chat is open.
        if (!currentChatId.value) return;
        if (isGlobalChat.value) return;

        const files = clipboardFilesFromEvent(ev);
        if (!files.length) return;

        if (pasteConfirmBusy.value) return;
        pasteConfirmBusy.value = true;

        // Prevent pasting placeholder text into inputs when files exist.
        try {
          ev.preventDefault();
          ev.stopPropagation();
        } catch (e) {}

        const list = files
          .map((f) => {
            const name = f && f.name ? String(f.name) : '文件';
            return name;
          })
          .join('\n');

        try {
          await ElementPlus.ElMessageBox.confirm(
            `检测到你粘贴了 ${files.length} 个文件：\n${list}\n\n是否发送到当前会话？`,
            '发送文件',
            {
              confirmButtonText: '发送',
              cancelButtonText: '取消',
              type: 'warning',
              closeOnClickModal: false,
              closeOnPressEscape: true,
            }
          );
        } catch (e) {
          return;
        }

        for (const f of files) {
          if (!f) continue;
          if (!currentChatId.value || isGlobalChat.value) break;
          await sendFile(f);
        }
      } finally {
        pasteConfirmBusy.value = false;
      }
    }

    function onChatClick(c) {
      openChat(c.id);
    }

    function openGlobal() {
      openChat('global');
    }

    function goEmojiManage() {
      window.location.href = '/emoji.html';
    }

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'gallery') window.location.href = '/gallery.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    onMounted(async () => {
      await fetchConfig();
      await checkSession();
      await loadUsersIndex();
      await resolveSelfProfile();
      if (isLoggedIn.value) {
        connectSocket();
        await loadChats();
        try { startReadReporter(); } catch (e) {}
      }

      try {
        await nextTick();
        syncGlobalWatermarkEnabled();
      } catch (e) {}

      try {
        document.addEventListener('paste', handlePasteToSend, true);
      } catch (e) {}

      // Image preview drag handlers
      try {
        window.addEventListener('mousemove', onImagePreviewMouseMove);
        window.addEventListener('mouseup', onImagePreviewMouseUp);
      } catch (e) {}

      // click outside closes emoji panel / ctx menu
      document.addEventListener('click', (ev) => {
        try {
          // Some environments may fire click after right-click; don't instantly close.
          if (ev && ev.button === 2) return;
          // Ignore modified clicks (e.g. Ctrl+Click on mac)
          if (ev && (ev.ctrlKey || ev.metaKey)) return;
        } catch (e) {}
        emojiPanelVisible.value = false;
        morePanelVisible.value = false;
        hideCtxMenu();
      });
    });

    onBeforeUnmount(() => {
      try {
        document.removeEventListener('paste', handlePasteToSend, true);
      } catch (e) {}

      try { stopReadReporter(); } catch (e) {}

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
      // state
      chats,
      chatsLoading,
      chatUnreadMap,
      currentChatId,
      currentChatTitle,
      currentChatFaceUrl,
      chatLoading,
      loadingMore,
      selfFaceUrl,
      messages,
      msgInput,
      msgInputEl,
      pendingMentionBadges,
      imagePreviewVisible,
      imagePreviewUrl,
      imagePreviewDragging,
      imagePreviewStyle,
      replyTarget,

      readersDialogVisible,
      readersLoading,
      readersList,
      openReadersDialog,
      closeReadersDialog,
      replyPreview,
      emojiPanelVisible,
      emojiPacks,
      morePanelVisible,
      playerCardDialogVisible,
      playerCardUsersLoading,
      playerCardSending,
      playerCardSelectedUserId,
      playerCardQuery,
      playerCardOptions,
      playerCardNoDataText,

      coordinateDialogVisible,
      coordinateSending,
      coordinateForm,
      coordinateHomeLoading,
      coordinateHomeSelected,
      coordinateHomes,
      fileInputEl,
      messagesEl,
      isGlobalChat,
      isLoggedIn,
      isGroupChat,
      isSelfChat,
      isDirectChat,

      ctxMenuVisible,
      ctxMenuX,
      ctxMenuY,
      ctxMenuMsg,
      forwardDialogVisible,
      forwardSending,
      forwardTargetChatId,
      forwardTargets,
      forwardSourceMsg,
      forwardSourcePreviewText,
      canForwardMessage,
      ctxForward,
      confirmForward,
      cancelForwardDialog,

      // helpers
      messageAuthorName,
      messageAuthorFaceUrl,
      messageTextPreview,
      messageTextParts,
      isGalleryImageMessage,
      galleryInfoFor,
      openGalleryFromMessage,
      isRecalledMessage,
      recallNoticeText,
      formatLastMessage,
      lastMessagePreviewTag,
      lastMessagePreviewSuffix,
      messagePreviewTag,
      messagePreviewSuffix,
      messagePreviewText,
      getChatName,
      getChatAvatar,
      getChatInitial,
      isChatPeerOnline,
      hasUnread,
      repliedRefMessage,
      scrollToMessage,
      isOwnMessage,
      bubbleBackground,
      formatTime,
      shouldShowTimeDivider,
      showReadCount,
      readCountFor,
      showReadStatus,
      readStatusTextFor,
      isImageFile,
      isVideoFile,
      fileDisplayUrl,
      fileOriginalUrl,
      canSaveAttachment,
      downloadAttachment,
      ctxSave,
      messageFilename,
      isGroupChatItem,
      lastMessageSenderBadge,
      openImagePreview,
      closeImagePreview,
      requestCloseImagePreview,
      videoPreviewVisible,
      videoPreviewUrl,
      openVideoPreview,
      closeVideoPreview,
      requestCloseVideoPreview,
      onImagePreviewToggle,
      onImagePreviewWheel,
      onImagePreviewMouseDown,

      // group management
      groupManageVisible,
      groupManageLoading,
      groupActionLoading,
      groupOwnerId,
      groupAdmins,
      groupEditName,
      inviteSelected,
      adminSelected,
      transferOwnerId,
      allUsersList,
      groupMembers,
      groupIsOwner,
      canMentionAll,
      groupCanManage,
      inviteOptions,
      adminOptions,
      transferOptions,
      userLabel,
      userMinecraftId,
      openGroupManage,
      groupAvatarInputEl,
      openGroupAvatarPicker,
      onGroupAvatarSelected,
      saveGroupName,
      inviteToGroup,
      kickFromGroup,
      saveGroupAdmins,
      transferGroupOwner,
      dissolveGroupChat,

      // actions
      openLoginPopup,
      logout,
      onChatClick,
      openGlobal,
      onMessageContextMenu,
      onMsgInputKeydown,
      onMsgInputInput,
      onMsgInputPaste,
      ctxReply,
      ctxCopy,
      canCopyText,
      canMentionFromMessage,
      ctxMention,
      canRecallMessage,
      ctxRecall,
      canCollectEmoji,
      ctxCollectEmoji,
      setReplyTarget,
      clearReplyTarget,
      onMessagesScroll,
      sendText,
      toggleEmojiPanel,
      toggleMorePanel,
      sendEmoji,
      openPlayerCardDialog,
      cancelPlayerCardDialog,
      confirmSendPlayerCard,
      openCoordinateDialog,
      cancelCoordinateDialog,
      confirmSendCoordinate,
      openCoordinateOnMap,
      importCoordinateFromHome,
      onPlayerCardQuery,
      openFilePicker,
      onFileSelected,
      goEmojiManage,
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
      onNav,
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
