// Vue 3 + Element Plus materials management page
const { createApp, ref, computed, onMounted, watch } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const selfFaceUrl = ref('');

    const items = ref([]);
    const loading = ref(false);
    const loadError = ref('');

    const createVisible = ref(false);
    const creating = ref(false);
    const createForm = ref({
      name: '',
      description: '',
      items: [{ name: '', count: 1 }],
    });

    const csvInputRef = ref(null);
    const csvDragging = ref(false);
    const csvParsing = ref(false);
    const csvError = ref('');
    const csvFileName = ref('');
    const csvEncoding = ref('auto');
    const lastCsvFile = ref(null);

    const csvHasFile = computed(() => !!lastCsvFile.value);

    const editVisible = ref(false);
    const editing = ref(false);
    const editForm = ref({ id: null, name: '', description: '' });

    const detailVisible = ref(false);
    const detailLoading = ref(false);
    const detailError = ref('');
    const detailData = ref(null);
    const detailItems = ref([]);

    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);

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

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'gallery') window.location.href = '/gallery.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    function gotoLogin() {
      window.location.href = '/';
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

    function formatTs(ts) {
      try {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '-';
        return new Date(n * 1000).toLocaleString();
      } catch (e) {
        return '-';
      }
    }

    function apiPath(p) {
      const base = String(apiBase.value || '').replace(/\/$/, '');
      const path = String(p || '');
      return base + path;
    }

    function managementUrl(path) {
      // Backend routes provided: agmaterialsManagement.js (POST /create|/edit|/done|/remove|/list)
      // Typical mount: /agmaterials/management
      return apiPath(`/agmaterials/management${path}`);
    }

    function publicUrl(path) {
      // Backend routes provided: agmaterialsPublic.js (GET /list|/detail|/setDone|...)
      // Typical mount: /agmaterials/public
      return apiPath(`/agmaterials/public${path}`);
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }

    async function resolveSelfFace() {
      try {
        const res = await safeFetch(apiPath('/users/me'));
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me && typeof me === 'object') {
            const face = me.faceUrl || me.face_url || me.face || me.face_key;
            if (face) selfFaceUrl.value = String(face);
          }
        }
      } catch (e) {}
    }

    async function checkSession() {
      // Try cookie-based session
      try {
        const res = await fetch(apiPath('/chats'), { credentials: 'include' });
        sessionOk.value = !!(res && res.ok);
      } catch (e) {
        sessionOk.value = false;
      }
    }

    async function reload() {
      if (!isLoggedIn.value) {
        loadError.value = '';
        items.value = [];
        return;
      }

      loading.value = true;
      loadError.value = '';
      try {
        const res = await safeFetch(managementUrl('/list'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const data = await res.json().catch(() => null);
        const list = data && (data.items || data.data || data.list);
        items.value = Array.isArray(list) ? list : [];
      } catch (e) {
        loadError.value = e && e.message ? e.message : String(e);
      } finally {
        loading.value = false;
      }
    }

    function resetCreateForm() {
      createForm.value = { name: '', description: '', items: [{ name: '', count: 1 }] };
    }

    function resetCsvState() {
      csvDragging.value = false;
      csvParsing.value = false;
      csvError.value = '';
      csvFileName.value = '';
      csvEncoding.value = 'auto';
      lastCsvFile.value = null;
      try {
        if (csvInputRef.value) csvInputRef.value.value = '';
      } catch (e) {}
    }

    function openCreate() {
      if (!isLoggedIn.value) {
        ElementPlus.ElMessage.warning('请先登录');
        return;
      }
      resetCreateForm();
      resetCsvState();
      createVisible.value = true;
    }

    function openCsvPicker() {
      if (csvParsing.value) return;
      try {
        if (csvInputRef.value) csvInputRef.value.click();
      } catch (e) {}
    }

    function onCsvInputChange(e) {
      const file = e && e.target && e.target.files && e.target.files[0];
      handleCsvFile(file);
    }

    function onCsvDrop(e) {
      csvDragging.value = false;
      const file = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleCsvFile(file);
    }

    function parseCsvText(csvText) {
      const text = String(csvText || '');
      const lines = text.split(/\r?\n/);
      const out = [];

      // Skip header row
      for (let i = 1; i < lines.length; i += 1) {
        const line = String(lines[i] || '').trim();
        if (!line) continue;

        // Simple CSV parsing (compatible with your old upload.html: assumes no commas in values)
        const values = line.split(',');
        if (values.length < 4) continue;

        const itemName = String(values[0] || '').replace(/"/g, '').trim();
        const missingCount = parseInt(String(values[2] || '').trim(), 10);
        if (!itemName) continue;
        if (Number.isNaN(missingCount) || missingCount <= 0) continue;

        out.push({ name: itemName, count: missingCount });
      }

      return out;
    }

    function readFileAsText(file, encoding) {
      return new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
          reader.readAsText(file, encoding);
        } catch (e) {
          reject(e);
        }
      });
    }

    async function parseCsvFileWithEncoding(file, encoding) {
      try {
        if (!file) return;
        const name = String(file.name || '');
        if (!name.toLowerCase().endsWith('.csv')) {
          ElementPlus.ElMessage.warning('请选择 CSV 文件');
          return;
        }

        csvFileName.value = name;
        csvError.value = '';
        csvParsing.value = true;

        const enc = String(encoding || 'auto');
        if (enc !== 'auto') {
          const raw = await readFileAsText(file, enc);
          const items2 = parseCsvText(raw);
          if (!items2 || items2.length === 0) {
            throw new Error('未解析到任何材料项，请确认 CSV 内容或尝试切换编码');
          }
          createForm.value.items = items2.map((x) => ({ name: x.name, count: x.count }));
          ElementPlus.ElMessage.success(`CSV 解析成功（${items2.length} 项，编码 ${enc}）`);
          return;
        }

        // auto: try common encodings and pick the best result
        const encodings = ['UTF-8', 'GBK', 'GB2312', 'Big5'];
        let best = { items: [], encoding: '', rawLen: 0 };
        for (const e2 of encodings) {
          let raw;
          try {
            raw = await readFileAsText(file, e2);
          } catch (e) {
            continue;
          }
          const items2 = parseCsvText(raw);
          const rawLen = String(raw || '').length;
          if (items2.length > best.items.length || (items2.length === best.items.length && rawLen > best.rawLen)) {
            best = { items: items2, encoding: e2, rawLen };
          }
        }

        if (!best.items || best.items.length === 0) {
          throw new Error('未解析到任何材料项，请确认 CSV 格式与内容（需要至少 4 列，使用第 1 列为名称、第 3 列为缺失数量）');
        }

        createForm.value.items = best.items.map((x) => ({ name: x.name, count: x.count }));
        ElementPlus.ElMessage.success(`CSV 解析成功（${best.items.length} 项，编码 ${best.encoding}）`);
      } catch (e) {
        csvError.value = e && e.message ? e.message : String(e);
      } finally {
        csvParsing.value = false;
      }
    }

    async function handleCsvFile(file) {
      if (!file) return;
      lastCsvFile.value = file;
      await parseCsvFileWithEncoding(file, csvEncoding.value);
    }

    async function reparseCsv() {
      if (!lastCsvFile.value) return;
      await parseCsvFileWithEncoding(lastCsvFile.value, csvEncoding.value);
    }

    watch(
      () => csvEncoding.value,
      async () => {
        if (!lastCsvFile.value) return;
        if (csvParsing.value) return;
        await reparseCsv();
      }
    );

    function addCreateRow() {
      createForm.value.items.push({ name: '', count: 1 });
    }

    function removeCreateRow(index) {
      createForm.value.items.splice(index, 1);
      if (createForm.value.items.length === 0) createForm.value.items.push({ name: '', count: 1 });
    }

    function normalizeCreateItems() {
      const raw = Array.isArray(createForm.value.items) ? createForm.value.items : [];
      const cleaned = raw
        .map((x) => ({
          name: String((x && x.name) || '').trim(),
          count: Number(x && x.count),
        }))
        .filter((x) => x.name && Number.isFinite(x.count) && x.count > 0);
      return cleaned;
    }

    async function submitCreate() {
      const name = String(createForm.value.name || '').trim();
      const description = String(createForm.value.description || '').trim();
      const listItems = normalizeCreateItems();

      if (!name) {
        ElementPlus.ElMessage.warning('标题不能为空');
        return;
      }
      if (!description) {
        ElementPlus.ElMessage.warning('描述不能为空');
        return;
      }
      if (!listItems.length) {
        ElementPlus.ElMessage.warning('请至少添加 1 条材料项');
        return;
      }

      creating.value = true;
      try {
        const res = await safeFetch(managementUrl('/create'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, json: listItems }),
        });

        const payloadText = await res.text().catch(() => '');
        let payload = null;
        try {
          payload = payloadText ? JSON.parse(payloadText) : null;
        } catch (e) {}

        if (!res.ok) {
          const msg = (payload && (payload.message || payload.error)) || payloadText || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        createVisible.value = false;
        ElementPlus.ElMessage.success('创建成功');
        await reload();
      } catch (e) {
        ElementPlus.ElMessage.error(e && e.message ? e.message : '创建失败');
      } finally {
        creating.value = false;
      }
    }

    function openEdit(row) {
      if (!row) return;
      editForm.value = {
        id: row.id,
        name: String(row.name || ''),
        description: String(row.description || ''),
      };
      editVisible.value = true;
    }

    async function submitEdit() {
      const id = editForm.value.id;
      const name = String(editForm.value.name || '').trim();
      const description = String(editForm.value.description || '').trim();

      if (!id) {
        ElementPlus.ElMessage.warning('缺少 id');
        return;
      }
      if (!name) {
        ElementPlus.ElMessage.warning('标题不能为空');
        return;
      }
      if (!description) {
        ElementPlus.ElMessage.warning('描述不能为空');
        return;
      }

      editing.value = true;
      try {
        const res = await safeFetch(managementUrl('/edit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, description }),
        });

        const txt = await res.text().catch(() => '');
        let payload = null;
        try {
          payload = txt ? JSON.parse(txt) : null;
        } catch (e) {}

        if (!res.ok) {
          const msg = (payload && (payload.message || payload.error)) || txt || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        editVisible.value = false;
        ElementPlus.ElMessage.success('保存成功');
        await reload();
      } catch (e) {
        ElementPlus.ElMessage.error(e && e.message ? e.message : '保存失败');
      } finally {
        editing.value = false;
      }
    }

    async function markDone(row) {
      if (!row || !row.id) return;
      try {
        await ElementPlus.ElMessageBox.confirm('确定要将该材料列表标记为完成吗？', '确认操作', {
          type: 'warning',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
        });
      } catch (e) {
        return;
      }

      try {
        const res = await safeFetch(managementUrl('/done'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        });

        const txt = await res.text().catch(() => '');
        let payload = null;
        try {
          payload = txt ? JSON.parse(txt) : null;
        } catch (e) {}

        if (!res.ok) {
          const msg = (payload && (payload.message || payload.error)) || txt || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        ElementPlus.ElMessage.success('已标记为完成');
        await reload();
      } catch (e) {
        ElementPlus.ElMessage.error(e && e.message ? e.message : '操作失败');
      }
    }

    async function removeItem(row) {
      if (!row || !row.id) return;
      try {
        await ElementPlus.ElMessageBox.confirm('确定要删除该材料列表吗？', '确认删除', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        });
      } catch (e) {
        return;
      }

      try {
        const res = await safeFetch(managementUrl('/remove'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        });

        const txt = await res.text().catch(() => '');
        let payload = null;
        try {
          payload = txt ? JSON.parse(txt) : null;
        } catch (e) {}

        if (!res.ok) {
          const msg = (payload && (payload.message || payload.error)) || txt || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        ElementPlus.ElMessage.success('删除成功');
        await reload();
      } catch (e) {
        ElementPlus.ElMessage.error(e && e.message ? e.message : '删除失败');
      }
    }

    function parseJsonArray(raw) {
      try {
        if (Array.isArray(raw)) return raw;
        if (raw === null || raw === undefined) return [];
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    async function openDetail(row) {
      if (!row || !row.id) return;
      detailVisible.value = true;
      detailLoading.value = true;
      detailError.value = '';
      detailData.value = null;
      detailItems.value = [];

      try {
        const res = await safeFetch(publicUrl(`/detail?id=${encodeURIComponent(row.id)}`), { method: 'GET' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const payload = await res.json().catch(() => null);
        const data = payload && (payload.data || payload.item || payload);
        if (!data || typeof data !== 'object') throw new Error('详情数据为空');

        detailData.value = data;
        detailItems.value = parseJsonArray(data.json);
      } catch (e) {
        detailError.value = e && e.message ? e.message : String(e);
      } finally {
        detailLoading.value = false;
      }
    }

    onMounted(async () => {
      await fetchConfig();
      await checkSession();
      await resolveSelfFace();
      await reload();
    });

    return {
      // nav
      onNav,
      gotoLogin,
      logout,

      // state
      isLoggedIn,
      selfFaceUrl,
      items,
      loading,
      loadError,

      // format
      formatTs,

      // list actions
      reload,
      openCreate,
      openEdit,
      openDetail,
      markDone,
      removeItem,

      // create
      createVisible,
      creating,
      createForm,
      csvInputRef,
      csvDragging,
      csvParsing,
      csvError,
      csvFileName,
      csvEncoding,
      csvHasFile,
      openCsvPicker,
      onCsvInputChange,
      onCsvDrop,
      reparseCsv,
      addCreateRow,
      removeCreateRow,
      submitCreate,

      // edit
      editVisible,
      editing,
      editForm,
      submitEdit,

      // detail
      detailVisible,
      detailLoading,
      detailError,
      detailData,
      detailItems,
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
