// Mobile disk page (Vue 3 + Element Plus)
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);

    const loading = ref(false);
    const uploading = ref(false);
    const lastError = ref('');

    const uploadName = ref('');
    const uploadInput = ref(null);

    const files = ref([]);

    const isLoggedIn = computed(() => !!tokenValue());

    function tokenValue() {
      const t = String(token.value || '').trim();
      return t ? t : null;
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
      if (!tokenValue()) {
        opt.credentials = 'include';
      }
      return fetch(url, opt);
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function fixMojibakeName(input) {
      const s = String(input === undefined || input === null ? '' : input);
      if (!s) return s;
      // If it already contains CJK, assume it's fine.
      if (/[\u4e00-\u9fff]/.test(s)) return s;

      // Heuristic: common mojibake from UTF-8 bytes decoded as latin1.
      if (!/[ÃÂåæçèéêëìíîïñòóôöõùúûüýÿ]/.test(s)) return s;

      try {
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i) & 0xff;
        const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

        const cjkCount = (t) => (String(t).match(/[\u4e00-\u9fff]/g) || []).length;
        const a = cjkCount(s);
        const b = cjkCount(fixed);
        if (b > a) return fixed;
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

    async function refresh() {
      loading.value = true;
      lastError.value = '';
      try {
        if (!apiBase.value) await fetchConfig();

        const res = await safeFetch(`${apiBase.value}/disk?limit=200`, { method: 'GET' });
        if (!res.ok) {
          if (res.status === 401) throw new Error('请先登录');
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `请求失败：${res.status}`);
        }

        const data = await res.json().catch(() => null);
        const arr = Array.isArray(data) ? data : [];
        files.value = arr.map((x) => ({
          id: x.id,
          name: fixMojibakeName(x.name),
          size: x.size,
          sizeText: formatBytes(x.size),
          created_at: x.created_at,
          updated_at: x.updated_at,
        }));
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        loading.value = false;
      }
    }

    async function upload() {
      lastError.value = '';
      const input = uploadInput.value;
      const file = input && input.files && input.files[0] ? input.files[0] : null;
      if (!file) {
        lastError.value = '请选择要上传的文件';
        return;
      }

      if (file.size > 20 * 1024 * 1024) {
        lastError.value = '文件过大（最大 20MB）';
        return;
      }

      uploading.value = true;
      try {
        if (!apiBase.value) await fetchConfig();

        const fd = new FormData();
        fd.append('file', file);
        const n = String(uploadName.value || '').trim();
        fd.append('name', n || String(file.name || 'file'));

        const res = await safeFetch(`${apiBase.value}/disk/upload`, { method: 'POST', body: fd });
        const txt = await res.text().catch(() => '');
        const data = (() => {
          try {
            return txt ? JSON.parse(txt) : null;
          } catch {
            return null;
          }
        })();

        if (!res.ok) {
          const msg = data && (data.error || data.detail) ? String(data.error || data.detail) : `请求失败：${res.status}`;
          throw new Error(msg);
        }

        uploadName.value = '';
        try {
          if (input) input.value = '';
        } catch (e) {}

        try {
          ElementPlus.ElMessage.success('上传成功');
        } catch (e) {}
        await refresh();
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        uploading.value = false;
      }
    }

    async function downloadFile(row) {
      if (!row || !row.id) return;
      lastError.value = '';
      try {
        if (!apiBase.value) await fetchConfig();

        const res = await safeFetch(`${apiBase.value}/disk/${encodeURIComponent(row.id)}/download`, { method: 'GET' });
        if (!res.ok) {
          if (res.status === 401) throw new Error('请先登录');
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `请求失败：${res.status}`);
        }

        const blob = await res.blob();
        const name = String(row.name || 'file');
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
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
        }
      } catch (e) {
        lastError.value = e?.message || String(e);
      }
    }

    async function renameFile(row) {
      if (!row || !row.id) return;
      lastError.value = '';

      let name = '';
      try {
        const r = await ElementPlus.ElMessageBox.prompt('新文件名（不支持文件夹）', '重命名', {
          inputValue: String(row.name || ''),
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入文件名',
          inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return '文件名不能为空';
            if (t.length > 255) return '文件名过长';
            return true;
          },
        });
        name = String(r && r.value !== undefined ? r.value : '').trim();
      } catch (e) {
        return;
      }

      if (!name) return;

      try {
        loading.value = true;
        const res = await safeFetch(`${apiBase.value}/disk/${encodeURIComponent(row.id)}/name`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const txt = await res.text().catch(() => '');
        const data = (() => {
          try {
            return txt ? JSON.parse(txt) : null;
          } catch {
            return null;
          }
        })();

        if (!res.ok) {
          const msg = data && (data.error || data.detail) ? String(data.error || data.detail) : `请求失败：${res.status}`;
          throw new Error(msg);
        }

        try {
          ElementPlus.ElMessage.success('已重命名');
        } catch (e) {}
        await refresh();
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        loading.value = false;
      }
    }

    async function deleteFile(row) {
      if (!row || !row.id) return;
      lastError.value = '';

      try {
        await ElementPlus.ElMessageBox.confirm(`确定删除 “${row.name || ''}” 吗？`, '删除确认', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          dangerouslyUseHTMLString: false,
        });
      } catch (e) {
        return;
      }

      try {
        loading.value = true;
        const res = await safeFetch(`${apiBase.value}/disk/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        const txt = await res.text().catch(() => '');
        const data = (() => {
          try {
            return txt ? JSON.parse(txt) : null;
          } catch {
            return null;
          }
        })();

        if (!res.ok) {
          const msg = data && (data.error || data.detail) ? String(data.error || data.detail) : `请求失败：${res.status}`;
          throw new Error(msg);
        }

        try {
          ElementPlus.ElMessage.success('已删除');
        } catch (e) {}
        await refresh();
      } catch (e) {
        lastError.value = e?.message || String(e);
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      await fetchConfig().catch(() => {});
      await refresh();
    });

    return {
      isLoggedIn,
      apiBase,
      loading,
      uploading,
      lastError,
      uploadName,
      uploadInput,
      files,
      refresh,
      upload,
      downloadFile,
      renameFile,
      deleteFile,
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
