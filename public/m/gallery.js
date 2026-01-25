// Mobile gallery page
const { createApp, ref, computed, onMounted, watch } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);

    const loading = ref(false);
    const loadingMore = ref(false);
    const loadError = ref('');

    const items = ref([]);
    const page = ref(1);
    const noMore = ref(false);

    const worldDict = ref([]);
    const typeDict = ref([]);

    const year = ref('');
    const world = ref(null);
    const type = ref(null);
    const q = ref('');

    const filterGuard = ref(false);

    function clearOtherFilters(active) {
      if (filterGuard.value) return;
      filterGuard.value = true;
      try {
        if (active !== 'q') q.value = '';
        if (active !== 'year') year.value = '';
        if (active !== 'world') world.value = null;
        if (active !== 'type') type.value = null;
      } finally {
        filterGuard.value = false;
      }
    }

    watch(
      q,
      (v) => {
        const s = String(v || '').trim();
        if (s) clearOtherFilters('q');
      },
      { flush: 'sync' }
    );

    watch(
      year,
      (v) => {
        const s = String(v || '').trim();
        if (s) clearOtherFilters('year');
      },
      { flush: 'sync' }
    );

    watch(
      world,
      (v) => {
        const has = v !== null && v !== undefined && String(v).trim() !== '';
        if (has) clearOtherFilters('world');
      },
      { flush: 'sync' }
    );

    watch(
      type,
      (v) => {
        const has = v !== null && v !== undefined && String(v).trim() !== '';
        if (has) clearOtherFilters('type');
      },
      { flush: 'sync' }
    );

    const detailVisible = ref(false);
    const detailLoading = ref(false);
    const detailError = ref('');
    const detail = ref(null);

    // Share (send gallery image id as a structured message)
    const shareVisible = ref(false);
    const shareSending = ref(false);
    const shareChatsLoading = ref(false);
    const shareTargetChatId = ref('');
    const shareSourceId = ref('');
    const shareChats = ref([]);

    const shareTargets = computed(() => {
      try {
        const list = Array.isArray(shareChats.value) ? shareChats.value : [];
        return list
          .filter((c) => c && c.id !== undefined && c.id !== null && String(c.id) !== 'global')
          .map((c) => {
            const id = String(c.id);
            const name = c.displayName || c.name || id;
            return { id, name: String(name) };
          });
      } catch (e) {
        return [];
      }
    });

    async function loadShareChats() {
      if (shareChatsLoading.value) return;
      shareChatsLoading.value = true;
      try {
        await fetchConfig();
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) {
          if (res.status === 401) throw new Error('请先登录');
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `加载会话失败：${res.status}`);
        }
        const list = await res.json().catch(() => []);
        shareChats.value = Array.isArray(list) ? list : [];
      } finally {
        shareChatsLoading.value = false;
      }
    }

    async function openShare(id) {
      const n = Number(id);
      if (!Number.isFinite(n) || n <= 0) {
        try { ElementPlus.ElMessage.warning('无效的图片 ID'); } catch (e) {}
        return;
      }
      shareSourceId.value = String(Math.floor(n));
      shareTargetChatId.value = '';
      shareVisible.value = true;
      try {
        await loadShareChats();
      } catch (e) {
        try { ElementPlus.ElMessage.error(e && e.message ? e.message : '无法加载会话'); } catch (e2) {}
      }
    }

    async function confirmShare() {
      if (shareSending.value) return;
      const chatId = String(shareTargetChatId.value || '').trim();
      const gid = Number(shareSourceId.value);
      if (!chatId) {
        try { ElementPlus.ElMessage.warning('请选择会话'); } catch (e) {}
        return;
      }
      if (!Number.isFinite(gid) || gid <= 0) {
        try { ElementPlus.ElMessage.warning('无效的图片 ID'); } catch (e) {}
        return;
      }
      if (chatId === 'global') {
        try { ElementPlus.ElMessage.warning('不支持发送到全服聊天'); } catch (e) {}
        return;
      }

      shareSending.value = true;
      try {
        await fetchConfig();
        const url = `${apiBase.value}/chats/${encodeURIComponent(chatId)}/messages`;
        const payload = { type: 'gallery_image', content: { id: Math.floor(gid) } };
        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          if (res.status === 401) throw new Error('请先登录');
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `发送失败：${res.status}`);
        }
        try { ElementPlus.ElMessage.success('已发送'); } catch (e) {}
        shareVisible.value = false;
      } catch (e) {
        try { ElementPlus.ElMessage.error(e && e.message ? e.message : '发送失败'); } catch (e2) {}
      } finally {
        shareSending.value = false;
      }
    }

    const worldOptions = computed(() => {
      const list = Array.isArray(worldDict.value) ? worldDict.value : [];
      return list
        .map((x) => ({ value: x && x.id !== undefined ? Number(x.id) : null, label: x && x.name ? String(x.name) : '' }))
        .filter((x) => x.value !== null && x.label);
    });

    const typeOptions = computed(() => {
      const list = Array.isArray(typeDict.value) ? typeDict.value : [];
      return list
        .map((x) => ({ value: x && x.id !== undefined ? Number(x.id) : null, label: x && x.name ? String(x.name) : '' }))
        .filter((x) => x.value !== null && x.label);
    });

    function tokenValue() {
      const t = (token.value || '').trim();
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

    function ymdhmFromTs(v) {
      try {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return '-';
        const ms = n < 1e12 ? n * 1000 : n;
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '-';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${dd} ${hh}:${mm}`;
      } catch (e) {
        return '-';
      }
    }

    function worldNameFromId(id) {
      const list = Array.isArray(worldDict.value) ? worldDict.value : [];
      const it = list.find((x) => x && String(x.id) === String(id));
      return it && it.name ? String(it.name) : (id !== null && id !== undefined ? String(id) : '-');
    }

    function typeNameFromId(id) {
      const list = Array.isArray(typeDict.value) ? typeDict.value : [];
      const it = list.find((x) => x && String(x.id) === String(id));
      return it && it.name ? String(it.name) : (id !== null && id !== undefined ? String(id) : '-');
    }

    function normalizeImageUrl(rawUrl, imgBase) {
      const u = String(rawUrl || '').trim();
      if (!u) return '';

      const base = String(imgBase || '').trim().replace(/\/+$/, '');
      const hasAbsoluteBase = /^https?:\/\//i.test(base);

      if (/^https?:\/\//i.test(u)) {
        if (!hasAbsoluteBase) return u;
        try {
          const src = new URL(u);
          const dst = new URL(base);

          const knownOrigins = new Set([
            'https://api-gallery-img.agatha.org.cn',
            'https://api-gallery.agatha.org.cn',
          ]);
          if (!knownOrigins.has(src.origin)) return u;

          const dstPath = dst.pathname.replace(/\/+$/, '');
          let path = src.pathname || '/';
          if (!path.startsWith('/')) path = '/' + path;
          if (dstPath && path.startsWith(dstPath + '/')) {
            path = path.slice(dstPath.length);
          }
          return dst.origin + dstPath + path + (src.search || '') + (src.hash || '');
        } catch (e) {
          return u;
        }
      }

      if (!base) return u;
      if (u.startsWith('/')) return base + u;
      return base + '/' + u;
    }

    function getEffectiveImgBase(conf) {
      // 本地化后：数据库直接存 OSS 的绝对 URL，不需要额外 base。
      return '';
    }

    function buildListEndpoint(pageNum) {
      const p = Number(pageNum) || 1;
      const y = String(year.value || '').trim();
      const w = world.value !== null && world.value !== undefined && String(world.value).trim() !== '' ? Number(world.value) : null;
      const t = type.value !== null && type.value !== undefined && String(type.value).trim() !== '' ? Number(type.value) : null;
      const qq = String(q.value || '').trim();

      if (qq) return `${apiBase.value}/aggallery/getIndexByName?page=${encodeURIComponent(p)}&q=${encodeURIComponent(qq)}`;
      if (y) return `${apiBase.value}/aggallery/getIndexByYear?page=${encodeURIComponent(p)}&year=${encodeURIComponent(y)}`;
      if (w !== null && Number.isFinite(w)) return `${apiBase.value}/aggallery/getIndexByWorld?page=${encodeURIComponent(p)}&world=${encodeURIComponent(w)}`;
      if (t !== null && Number.isFinite(t)) return `${apiBase.value}/aggallery/getIndexByType?page=${encodeURIComponent(p)}&type=${encodeURIComponent(t)}`;
      return `${apiBase.value}/aggallery/getIndex?page=${encodeURIComponent(p)}`;
    }

    async function loadDicts() {
      try {
        const [wRes, tRes] = await Promise.all([
          safeFetch(`${apiBase.value}/aggallery/getWorldDict`),
          safeFetch(`${apiBase.value}/aggallery/getTypeDict`),
        ]);
        if (wRes.ok) worldDict.value = (await wRes.json().catch(() => [])) || [];
        if (tRes.ok) typeDict.value = (await tRes.json().catch(() => [])) || [];
      } catch (e) {}
    }

    async function loadPage(pageNum, append) {
      const p = Number(pageNum) || 1;
      if (!append) {
        loading.value = true;
        loadError.value = '';
      } else {
        loadingMore.value = true;
      }

      try {
        const conf = await fetchConfig();
        const imgBase = getEffectiveImgBase(conf);

        const url = buildListEndpoint(p);
        const res = await safeFetch(url);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`${res.status} ${txt}`);
        }
        const raw = await res.json().catch(() => []);
        const list = Array.isArray(raw) ? raw : [];

        const normalized = list.map((x) => {
          const id = x && x.id !== undefined ? x.id : null;
          const name = x && x.name ? String(x.name) : '';
          const uploader = x && x.uploader ? String(x.uploader) : '';
          const ts = x && (x.timestamp || x.time || x.createdAt) ? Number(x.timestamp || x.time || x.createdAt) : null;
          const yy = x && (x.year !== undefined && x.year !== null) ? String(x.year) : '';
          const w = x && (x.world !== undefined && x.world !== null) ? Number(x.world) : null;
          const t = x && (x.type !== undefined && x.type !== null) ? Number(x.type) : null;
          const annotation = x && x.annotation ? String(x.annotation) : '';
          const thumbUrl = normalizeImageUrl(x && x.url, imgBase);

          return {
            id,
            name,
            year: yy,
            world: w,
            type: t,
            worldName: worldNameFromId(w),
            typeName: typeNameFromId(t),
            annotation,
            uploaderText: uploader ? `${uploader}` : '-',
            timeText: ts ? ymdhmFromTs(ts) : '-',
            thumbUrl,
          };
        });

        if (append) items.value = items.value.concat(normalized);
        else items.value = normalized;

        page.value = p;
        noMore.value = normalized.length < 5;
      } catch (e) {
        loadError.value = e && e.message ? e.message : String(e);
      } finally {
        loading.value = false;
        loadingMore.value = false;
      }
    }

    async function applyFilters() {
      noMore.value = false;
      await loadPage(1, false);
    }

    function resetFilters() {
      year.value = '';
      world.value = null;
      type.value = null;
      q.value = '';
      applyFilters();
    }

    async function loadMore() {
      if (loading.value || loadingMore.value || noMore.value) return;
      await loadPage((Number(page.value) || 1) + 1, true);
    }

    function safeJsonParse(v, fallback) {
      try {
        if (!v) return fallback;
        if (typeof v === 'object') return v;
        return JSON.parse(String(v));
      } catch (e) {
        return fallback;
      }
    }

    function buildMapUrl(pos) {
      try {
        if (!pos || typeof pos !== 'object') return '';
        const world = String(pos.world || '').trim();
        if (!world || world === 'none') return '';
        const x = Number(pos.x);
        const y = Number(pos.y);
        const z = Number(pos.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return '';

        const yy = Number.isFinite(y) ? y : 0;
        const qs = new URLSearchParams({
          world: world,
          x: String(Math.round(x)),
          y: String(Math.round(yy)),
          z: String(Math.round(z)),
        });
        return `/m/map.html?${qs.toString()}`;
      } catch (e) {
        return '';
      }
    }

    function worldDisplayNameFromCode(code) {
      const c = String(code || '').trim();
      if (!c) return '';
      if (c === 'world') return '主世界';
      if (c === 'world_nether') return '下界';
      if (c === 'world_the_end') return '末地';
      return c;
    }

    function buildPositionRows(pos) {
      if (!pos || typeof pos !== 'object') return [];
      const world = String(pos.world || '').trim();
      if (!world || world === 'none') return [];
      const x = pos.x;
      const y = pos.y;
      const z = pos.z;
      return [
        { k: '世界', v: worldDisplayNameFromCode(world) },
        { k: 'X', v: x !== null && x !== undefined ? String(x) : '-' },
        { k: 'Y', v: y !== null && y !== undefined ? String(y) : '-' },
        { k: 'Z', v: z !== null && z !== undefined ? String(z) : '-' },
      ];
    }

    function kvRows(obj) {
      if (!obj || typeof obj !== 'object') return [];
      const rows = [];
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        const vv = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push({ k, v: vv });
      }
      return rows;
    }

    function formatSizeFromKB(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return v === null || v === undefined ? '' : String(v);

      const units = ['KB', 'MB', 'GB', 'TB'];
      let value = n;
      let idx = 0;
      while (value >= 1000 && idx < units.length - 1) {
        value /= 1000;
        idx += 1;
      }

      let text;
      if (idx === 0) {
        text = String(Math.round(value));
      } else if (value >= 100) {
        text = value.toFixed(0);
      } else if (value >= 10) {
        text = value.toFixed(1);
      } else {
        text = value.toFixed(2);
      }
      text = text.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
      return `${text}${units[idx]}`;
    }

    function buildMetadataRows(metadata) {
      if (!metadata || typeof metadata !== 'object') return [];

      const labelMap = { name: '文件名', size: '大小', h: '高度', w: '宽度' };
      const orderedKeys = ['name', 'size', 'h', 'w'];
      const rows = [];

      for (const k of orderedKeys) {
        if (!(k in metadata)) continue;
        const v = metadata[k];
        if (v === null || v === undefined) continue;
        const vv = k === 'size' ? formatSizeFromKB(v) : (typeof v === 'string' ? v : JSON.stringify(v));
        rows.push({ k: labelMap[k], v: String(vv) });
      }

      for (const [k, v] of Object.entries(metadata)) {
        if (v === null || v === undefined) continue;
        if (orderedKeys.includes(k)) continue;
        const vv = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push({ k: String(k), v: String(vv) });
      }

      return rows;
    }

    function buildShaderRows(shader) {
      if (!shader || typeof shader !== 'object') return [];
      const labelMap = { name: '光影名', config: '配置' };
      const orderedKeys = ['name', 'config'];
      const rows = [];

      for (const k of orderedKeys) {
        if (!(k in shader)) continue;
        const v = shader[k];
        if (v === null || v === undefined) continue;
        const vv = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push({ k: labelMap[k], v: String(vv) });
      }

      for (const [k, v] of Object.entries(shader)) {
        if (v === null || v === undefined) continue;
        if (orderedKeys.includes(k)) continue;
        const vv = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push({ k: String(k), v: String(vv) });
      }

      return rows;
    }

    async function openDetail(it) {
      detailVisible.value = true;
      detailLoading.value = true;
      detailError.value = '';
      detail.value = null;

      try {
        const conf = await fetchConfig();
        const imgBase = getEffectiveImgBase(conf);

        const id = it && it.id !== undefined ? it.id : null;
        if (!id) throw new Error('无效 ID');
        const res = await safeFetch(`${apiBase.value}/aggallery/getDetail?id=${encodeURIComponent(id)}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`${res.status} ${txt}`);
        }
        const d = await res.json().catch(() => null);
        if (!d || typeof d !== 'object') throw new Error('返回数据异常');

        const players = safeJsonParse(d.players, []);
        const position = safeJsonParse(d.position, null);
        const shader = safeJsonParse(d.shader, null);
        const metadata = safeJsonParse(d.metadata, null);

        const mapUrl = buildMapUrl(position);
        const positionRows = buildPositionRows(position);

        detail.value = {
          id: d.id,
          name: d.name ? String(d.name) : '',
          year: d.year !== undefined && d.year !== null ? String(d.year) : '',
          world: d.world !== undefined && d.world !== null ? Number(d.world) : null,
          type: d.type !== undefined && d.type !== null ? Number(d.type) : null,
          worldName: worldNameFromId(d.world),
          typeName: typeNameFromId(d.type),
          uploader: d.uploader ? String(d.uploader) : '',
          annotation: d.annotation ? String(d.annotation) : '',
          imageUrl: normalizeImageUrl(d.url, imgBase),
          players: Array.isArray(players) ? players.map((x) => String(x)).filter(Boolean) : [],
          position: mapUrl ? { mapUrl } : null,
          positionRows,
          metadataRows: buildMetadataRows(metadata),
          shaderRows: buildShaderRows(shader),
        };
      } catch (e) {
        detailError.value = e && e.message ? e.message : String(e);
      } finally {
        detailLoading.value = false;
      }
    }

    function openDetailOnMap() {
      try {
        const d = detail.value;
        const url = d && d.position && d.position.mapUrl ? String(d.position.mapUrl) : '';
        if (!url) {
          try { ElementPlus.ElMessage.warning('没有可用的坐标信息'); } catch (e0) {}
          return;
        }
        window.location.href = url;
      } catch (e) {}
    }

    function setYear(v) {
      year.value = v ? String(v) : '';
      q.value = '';
      applyFilters();
    }

    function setWorld(v) {
      const n = Number(v);
      world.value = Number.isFinite(n) ? n : null;
      q.value = '';
      applyFilters();
    }

    function setType(v) {
      const n = Number(v);
      type.value = Number.isFinite(n) ? n : null;
      q.value = '';
      applyFilters();
    }

    onMounted(async () => {
      await fetchConfig();
      await loadDicts();
      await loadPage(1, false);

      // Open detail from query: /m/gallery.html?detail=123
      try {
        const params = new URLSearchParams(window.location.search || '');
        const id = params.get('detail');
        if (id) {
          const n = Number(id);
          if (Number.isFinite(n) && n > 0) {
            await openDetail({ id: Math.floor(n) });
          }
        }
      } catch (e) {}
    });

    return {
      year,
      world,
      type,
      q,
      items,
      loading,
      loadingMore,
      loadError,
      noMore,
      worldOptions,
      typeOptions,
      applyFilters,
      resetFilters,
      loadMore,
      openDetail,
      openDetailOnMap,
      detailVisible,
      detailLoading,
      detailError,
      detail,

      // share
      shareVisible,
      shareSending,
      shareChatsLoading,
      shareTargets,
      shareTargetChatId,
      shareSourceId,
      openShare,
      confirmShare,
      setYear,
      setWorld,
      setType,
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
