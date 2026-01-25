// Mobile emojis management page
const { createApp, ref, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const packs = ref([]);
    const name = ref('');
    const selectedFile = ref(null);
    const fileInput = ref(null);

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
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

    function authHeaders() {
      const h = {};
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());

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

    async function loadPacks() {
      try {
        const res = await safeFetch(`${apiBase.value}/emoji`);
        if (!res.ok) return;
        const data = await res.json();
        packs.value = (Array.isArray(data) ? data : []).map(p => ({
          ...p,
          url:
            p.url ||
            p.downloadUrl ||
            p.download_url ||
            `${apiBase.value}/emoji/${encodeURIComponent(p.id)}/download`,
        }));
      } catch (e) {}
    }

    function selectFile() {
      fileInput.value?.click();
    }

    function onFileChange(e) {
      const files = e.target?.files;
      if (files && files.length > 0) {
        selectedFile.value = files[0];
      }
    }

    async function upload() {
      if (!selectedFile.value) return;

      try {
        const form = new FormData();
        form.append('file', selectedFile.value);
        if (name.value) form.append('name', name.value);

        const res = await safeFetch(`${apiBase.value}/emoji`, { method: 'POST', body: form });

        if (!res.ok) throw new Error('上传失败');

        ElementPlus.ElMessage.success('上传成功');
        name.value = '';
        selectedFile.value = null;
        if (fileInput.value) fileInput.value.value = '';
        await loadPacks();
      } catch (e) {
        ElementPlus.ElMessage.error(e.message || '上传失败');
      }
    }

    async function del(id) {
      try {
        await ElementPlus.ElMessageBox.confirm('确定要删除这个表情包吗？', '确认删除', {
          type: 'warning',
        });

        const res = await safeFetch(`${apiBase.value}/emoji/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('删除失败');

        ElementPlus.ElMessage.success('删除成功');
        await loadPacks();
      } catch (e) {
        if (e !== 'cancel') {
          ElementPlus.ElMessage.error(e.message || '删除失败');
        }
      }
    }

    function goBack() {
      window.history.back();
    }

    onMounted(async () => {
      await fetchConfig();
      await loadPacks();
    });

    return {
      packs,
      name,
      selectedFile,
      fileInput,
      selectFile,
      onFileChange,
      upload,
      del,
      goBack,
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
