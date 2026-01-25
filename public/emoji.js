// Vue 3 emoji management page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup(){
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const selfFaceUrl = ref('');
    const name = ref('');
    const packs = ref([]);

    const selectedFile = ref(null);
    const uploadFiles = ref([]);

    function tokenValue(){
      const t = (token.value || '').trim();
      return t ? t : null;
    }

    function clearBadToken(){
      token.value = null;
      try{ localStorage.removeItem('token'); }catch(e){}
    }

    function authHeaders(extra){
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if(t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry){
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);
      const res = await fetch(url, opt);

      const canRetry = allowRetry !== false;
      if(canRetry && res.status === 401){
        let txt = '';
        try{ txt = await res.clone().text(); }catch(e){}
        if(/invalid token/i.test(txt)){
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

    function decodeJwtPayload(jwt){
      try{
        const parts = String(jwt || '').split('.');
        if(parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g,'+').replace(/_/g,'/');
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      }catch(e){
        return null;
      }
    }

    async function resolveSelfFace(){
      // 1) Best-effort /users/me
      try{
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if(res.ok){
          const me = await res.json().catch(()=>null);
          if(me && typeof me === 'object'){
            const face = me.faceUrl || me.face_url || me.face;
            if(face){ selfFaceUrl.value = String(face); return; }
          }
        }
      }catch(e){}

      // 2) Fallback: infer id from JWT and match in /users list
      const t = tokenValue();
      if(!t) return;
      const payload = decodeJwtPayload(t);
      const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
      if(!meId) return;
      try{
        const res = await safeFetch(`${apiBase.value}/users`);
        if(!res.ok) return;
        const list = await res.json().catch(()=>null);
        if(!Array.isArray(list)) return;
        const u = list.find(x => x && String(x.id) === String(meId));
        const face = u && (u.faceUrl || u.face_url || u.face);
        if(face) selfFaceUrl.value = String(face);
      }catch(e){}
    }

    async function fetchConfig(){
      const conf = await fetch('/config').then(r=>r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }
    async function loadPacks(){
      try{
        const r = await safeFetch(`${apiBase.value}/emoji`);
        if(r.ok) packs.value = await r.json();
      }catch(e){ console.error(e); }
    }

    function onUploadChange(file, fileList){
      try{
        selectedFile.value = (file && file.raw) ? file.raw : null;
        uploadFiles.value = Array.isArray(fileList) ? fileList.slice(-1) : [];
      }catch(e){
        selectedFile.value = null;
        uploadFiles.value = [];
      }
    }

    function onUploadRemove(){
      selectedFile.value = null;
      uploadFiles.value = [];
    }

    function onUploadExceed(files){
      // keep only the latest
      try{
        const last = Array.isArray(files) ? files[files.length - 1] : null;
        selectedFile.value = last || null;
        uploadFiles.value = [];
      }catch(e){}
    }

    async function upload(){
      const f = selectedFile.value;
      if(!f) return ElementPlus.ElMessage.warning('请选择文件');
      const fd = new FormData();
      fd.append('file', f);
      if(name.value) fd.append('name', name.value);
      try{
        const r = await safeFetch(`${apiBase.value}/emoji`, { method:'POST', body: fd });
        if(!r.ok) throw new Error('upload failed');
        name.value='';
        selectedFile.value = null;
        uploadFiles.value = [];
        await loadPacks();
      }catch(e){ console.error(e); alert('上传失败'); }
    }

    async function del(id){
      if(!confirm('删除该表情包？')) return;
      try{
        const r = await safeFetch(`${apiBase.value}/emoji/${encodeURIComponent(id)}`, { method:'DELETE' });
        if(!r.ok) throw new Error('delete failed');
        await loadPacks();
      }catch(e){ console.error(e); alert('删除失败'); }
    }

    function logout(){ token.value=null; localStorage.removeItem('token'); window.location.href = '/'; }

    function onNav(key){
      if(key === 'chat') window.location.href = '/chat.html';
      else if(key === 'gallery') window.location.href = '/gallery.html';
      else if(key === 'players') window.location.href = '/players.html';
      else if(key === 'me') window.location.href = '/me.html';
    }

    onMounted(async ()=>{ await fetchConfig(); await resolveSelfFace(); await loadPacks(); });
    return {
      name,
      packs,
      upload,
      del,
      logout,
      onNav,
      selfFaceUrl,
      selectedFile,
      uploadFiles,
      onUploadChange,
      onUploadRemove,
      onUploadExceed,
    };
  }
}).use(ElementPlus).mount('#app');
