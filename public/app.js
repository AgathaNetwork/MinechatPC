let apiBase = '';
let apiAuthBase = '';
let token = localStorage.getItem('token') || null;
let currentChat = null;
let replyTarget = null; // message object or id to reply to
const userNameCache = {};
let currentMsgs = [];
let loadingMore = false;
let noMoreBefore = false;
const PAGE_LIMIT = 20;
let msgById = {};

async function fetchMissingUserNames(ids){
  const missing = Array.from(ids).filter(id => id && !userNameCache[id]);
  if(missing.length === 0) return;
  await Promise.allSettled(missing.map(async id => {
    try{
      const res = await fetch(`${apiBase}/users/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if(!res.ok) throw new Error('no user');
      const u = await res.json();
      userNameCache[id] = u.username || u.displayName || id;
    }catch(e){ userNameCache[id] = id; }
  }));
}

async function getUserName(id){
  if(!id) return '';
  if(userNameCache[id]) return userNameCache[id];
  try{
    const res = await fetch(`${apiBase}/users/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('no user');
    const u = await res.json();
    const name = u.username || u.displayName || id;
    userNameCache[id] = name;
    return name;
  }catch(e){
    // fallback to id
    userNameCache[id] = id;
    return id;
  }
}

function $(id){ return document.getElementById(id); }

async function init(){
  const conf = await fetch('/config').then(r=>r.json());
  apiAuthBase = conf.apiBase;
  apiBase = conf.apiProxyBase || conf.apiBase;
  setupAuth();
  // try to load chats using cookie-based session first
  try{
    const res = await fetch(`${apiBase}/chats`, { credentials: 'include' });
    if (res.ok) { showLoggedIn(); loadChats(); return; }
  }catch(e){}
  if (token) { showLoggedIn(); loadChats(); }
}

function setupAuth(){
  $('loginBtn').addEventListener('click', ()=>{
    const popup = window.open(`${apiAuthBase || apiBase}/auth/microsoft`, 'oauth', 'width=600,height=700');
    const timer = setInterval(()=>{
      try{
        if(!popup || popup.closed){ clearInterval(timer); return; }
        const txt = popup.document.body.innerText;
        if(txt){
          try{
            const data = JSON.parse(txt);
            if(data.token){
              token = data.token; localStorage.setItem('token', token);
              // if server set cookie in response, it will be stored; redirect to chat
              popup.close(); clearInterval(timer); window.location.href = '/chat.html';
            }
          }catch(e){ /* ignore non-json */ }
        }
      }catch(e){ /* cross-origin until final redirect */ }
    }, 500);
  });

  $('logoutBtn').addEventListener('click', ()=>{
    token = null; localStorage.removeItem('token');
    // attempt logout on server (optional) then return to login
    try{ fetch(`${apiAuthBase || apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(()=>{}); }catch(e){}
    window.location.href = '/';
  });

  $('applyToken').addEventListener('click', ()=>{
    const t = $('manualToken').value.trim();
    if(t){ token = t; localStorage.setItem('token', t); $('pasteToken').style.display='none'; showLoggedIn(); loadChats(); }
  });
}

function showLoggedIn(){
  $('loginBtn').style.display='none';
  $('logoutBtn').style.display='inline-block';
}
function showLoggedOut(){
  $('loginBtn').style.display='inline-block';
  $('logoutBtn').style.display='none';
  $('chatList').innerHTML=''; $('messages').innerHTML='';
}

async function loadChats(){
  try{
    const res = await fetch(`${apiBase}/chats`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('未登录或请求失败');
    const chats = await res.json();
    const ul = $('chatList'); ul.innerHTML='';
    chats.forEach(c=>{
      const li = document.createElement('li');
      // prefer server-provided displayName, fallback to name or member list
      li.textContent = c.displayName || c.name || (c.members||[]).join(',');
      li.dataset.id = c.id; li.addEventListener('click', ()=>openChat(c.id)); ul.appendChild(li);
    });
  }catch(e){ console.error(e); alert('加载会话失败，请检查 API 配置并确保已登录'); }
}

async function openChat(id){
  currentChat = id;
  const isGlobal = id === 'global';
  try{
    // set title: for global use fixed label, otherwise fetch chat meta
    const titleEl = $('chatTitle');
    if(isGlobal){ if(titleEl) titleEl.textContent = '全服'; }
    else {
      try{
        const metaRes = await fetch(`${apiBase}/chats/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(metaRes.ok){ const chatMeta = await metaRes.json(); if(titleEl) titleEl.textContent = chatMeta.displayName || chatMeta.name || ''; }
      }catch(e){ /* ignore meta fetch errors */ }
    }

    // choose messages endpoint
    const msgUrl = isGlobal ? `${apiBase}/global/messages` : `${apiBase}/chats/${id}/messages`;
    const res = await fetch(msgUrl, isGlobal ? { headers: { 'Authorization': `Bearer ${token}` } } : { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('加载消息失败');
    const msgs = await res.json();
    const cont = $('messages'); cont.innerHTML='';
    // prepare caches: msgById and gather user ids for batch fetch
    msgs.forEach(m => { if(m && m.id) msgById[m.id] = m; });
    const userIds = new Set();
    msgs.forEach(m => {
      // normalize global `from` -> `from_user`
      if(isGlobal && m.from && !m.from_user) m.from_user = m.from;
      if(m && m.from_user) userIds.add(m.from_user);
      if(!isGlobal && m && m.replied_to){ const ref = (typeof m.replied_to === 'object') ? m.replied_to : msgs.find(x=>x.id === m.replied_to) || msgById[m.replied_to]; if(ref && ref.from_user) userIds.add(ref.from_user); }
    });
    await fetchMissingUserNames(userIds);
    // render messages and include replied-to preview if present
      msgs.forEach(m=>{
      msgById[m.id] = m;
      const wrapper = document.createElement('div'); wrapper.className = 'msg-wrapper'; wrapper.dataset.id = m.id || '';
      // only show replied preview for normal chats (global doesn't support reply)
      if(!isGlobal && m.replied_to){
        let ref = (typeof m.replied_to === 'object') ? m.replied_to : msgs.find(x=>x.id === m.replied_to) || msgById[m.replied_to];
        if(ref){
          const q = document.createElement('div'); q.className = 'reply-quote';
          let refText = '';
          if (ref.type === 'emoji' && ref.content) {
            refText = '[表情] ' + (ref.content.filename || '');
          } else {
            refText = (typeof ref.content === 'object') ? (ref.content.text || JSON.stringify(ref.content)) : (ref.content || '');
          }
          const author = ref.from_user ? (userNameCache[ref.from_user] || ref.from_user) : '';
          q.textContent = (author ? (author + ': ') : '') + (refText || '[已回复]');
          if(typeof m.replied_to === 'string' || typeof m.replied_to === 'number'){
            q.style.cursor = 'pointer'; q.dataset.ref = m.replied_to;
            q.addEventListener('click', ()=>{ const target = document.querySelector(`.msg-wrapper[data-id="${m.replied_to}"]`); if(target){ target.scrollIntoView({ behavior: 'smooth', block: 'center' }); const prev = target.style.background; target.style.background = '#ffffcc'; setTimeout(()=>{ target.style.background = prev; }, 800); } });
          }
          wrapper.appendChild(q);
        }
      }
      const d = document.createElement('div'); d.className='msg';
      const author = m.from_user ? (userNameCache[m.from_user] || m.from_user) : '';
      // emoji message rendering
      if(m.type === 'emoji' && m.content && m.content.url){
        d.innerHTML = `<b>${author}</b>: <img src="${m.content.url}" alt="emoji" style="max-height:96px; display:inline-block; vertical-align:middle" />`;
      } else {
        const contentText = (m.type === 'text' && m.content && typeof m.content === 'object' && 'text' in m.content) ? m.content.text : ((typeof m.content === 'object') ? JSON.stringify(m.content) : (m.content||''));
        d.innerHTML = `<b>${author}</b>: ${contentText}`;
      }
      // context menu for reply only on non-global chats
      if(!isGlobal) d.addEventListener('contextmenu', (ev)=>{ ev.preventDefault(); showMsgContextMenu(ev.clientX, ev.clientY, m); });
      wrapper.appendChild(d);
      cont.appendChild(wrapper);
    });
    // store current messages and scroll to bottom on open
    currentMsgs = msgs.slice();
    noMoreBefore = msgs.length < PAGE_LIMIT;
    // attach scroll handler once
    attachScrollHandler();
    // show/hide emoji button and panel for global chat
    const emojiBtn = $('emojiBtn'); const emojiPanelEl = $('emojiPanel');
    if(emojiBtn) emojiBtn.style.display = isGlobal ? 'none' : 'inline-block';
    if(emojiPanelEl && isGlobal) emojiPanelEl.style.display = 'none';
    // if opening global chat, ensure reply UI cleared
    if(id === 'global') clearReplyTarget();
    // after rendering initial messages, scroll to bottom
    cont.scrollTop = cont.scrollHeight;
  }catch(e){ console.error(e); alert('无法打开会话，可能权限不足'); }
}

function attachScrollHandler(){
  const cont = $('messages'); if(!cont) return;
  if(cont._hasScrollHandler) return;
  cont.addEventListener('scroll', async ()=>{
    try{
      if(cont.scrollTop < 80 && !loadingMore && !noMoreBefore && currentChat){
        await loadMoreMessages();
      }
    }catch(e){ console.error(e); }
  });
  cont._hasScrollHandler = true;
}

async function loadMoreMessages(){
  if(!currentChat) return; if(loadingMore) return;
  const cont = $('messages'); if(!cont) return;
  const first = currentMsgs[0]; if(!first) return;
  loadingMore = true;
  const beforeId = first.id;
  try{
    const url = (currentChat === 'global') ? `${apiBase}/global/messages?before=${encodeURIComponent(beforeId)}&limit=${PAGE_LIMIT}` : `${apiBase}/chats/${currentChat}/messages?before=${encodeURIComponent(beforeId)}&limit=${PAGE_LIMIT}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('加载更多消息失败');
    const more = await res.json();
    if(!more || more.length === 0){ noMoreBefore = true; loadingMore = false; return; }
    const isGlobal = currentChat === 'global';
    // preserve scroll position
    const prevScrollHeight = cont.scrollHeight;
    const prevScrollTop = cont.scrollTop;
    // prepend DOM nodes for new messages
    const frag = document.createDocumentFragment();
    // add new msgs to msgById and batch fetch missing usernames
    more.forEach(m => { if(m && m.id) msgById[m.id] = m; });
    const moreUserIds = new Set();
    more.forEach(m => {
      // normalize global message author field
      if(isGlobal && m && m.from && !m.from_user) m.from_user = m.from;
      if(m && m.from_user) moreUserIds.add(m.from_user);
      if(!isGlobal && m && m.replied_to){
        const ref = (typeof m.replied_to === 'object') ? m.replied_to : msgById[m.replied_to] || null;
        if(ref && ref.from_user) moreUserIds.add(ref.from_user);
      }
    });
    await fetchMissingUserNames(moreUserIds);
    more.forEach(m=>{
      const wrapper = document.createElement('div'); wrapper.className = 'msg-wrapper'; wrapper.dataset.id = m.id || '';
      // for normal chats, render replied_to preview
      if(!isGlobal && m.replied_to){
        let q = document.createElement('div'); q.className = 'reply-quote';
        const ref = (typeof m.replied_to === 'object') ? m.replied_to : msgById[m.replied_to] || null;
        let refText = '';
        if (ref && ref.type === 'emoji' && ref.content) {
          refText = '[表情] ' + (ref.content.filename || '');
        } else {
          refText = ref ? ((typeof ref.content === 'object') ? (ref.content.text || JSON.stringify(ref.content)) : (ref.content||'')) : '';
        }
        const author = ref && ref.from_user ? (userNameCache[ref.from_user] || ref.from_user) : '';
        q.textContent = (author ? (author + ': ') : '') + (refText || '[已回复]');
        if(typeof m.replied_to === 'string' || typeof m.replied_to === 'number'){
          q.style.cursor = 'pointer'; q.dataset.ref = m.replied_to;
          q.addEventListener('click', ()=>{ const target = document.querySelector(`.msg-wrapper[data-id="${m.replied_to}"]`); if(target){ target.scrollIntoView({ behavior: 'smooth', block: 'center' }); const prev = target.style.background; target.style.background = '#ffffcc'; setTimeout(()=>{ target.style.background = prev; }, 800); } });
        }
        wrapper.appendChild(q);
      }
      const d = document.createElement('div'); d.className='msg';
      const author = m.from_user ? (userNameCache[m.from_user] || m.from_user) : '';
      if(m.type === 'emoji' && m.content && m.content.url){
        d.innerHTML = `<b>${author}</b>: <img src="${m.content.url}" alt="emoji" style="max-height:96px; display:inline-block; vertical-align:middle" />`;
      } else {
        const contentText = (isGlobal && m.type === 'text' && m.content && typeof m.content === 'object' && 'text' in m.content) ? m.content.text : ((typeof m.content === 'object') ? JSON.stringify(m.content) : (m.content||''));
        d.innerHTML = `<b>${author}</b>: ${contentText}`;
      }
      if(!isGlobal) d.addEventListener('contextmenu', (ev)=>{ ev.preventDefault(); showMsgContextMenu(ev.clientX, ev.clientY, m); });
      wrapper.appendChild(d);
      frag.appendChild(wrapper);
    });
    // insert before first child
    const firstChild = cont.firstChild;
    if(firstChild) cont.insertBefore(frag, firstChild); else cont.appendChild(frag);
    // update currentMsgs
    currentMsgs = more.concat(currentMsgs);
    // adjust scroll so user stays at same place
    const newScrollHeight = cont.scrollHeight;
    cont.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
    // if fewer than PAGE_LIMIT received, mark no more
    if(more.length < PAGE_LIMIT) noMoreBefore = true;
  }catch(e){ console.error(e); }
  loadingMore = false;
}

function showMsgContextMenu(x, y, msg){
  let menu = document.getElementById('msgContextMenu');
  if(!menu){
    menu = document.createElement('div'); menu.id = 'msgContextMenu';
    menu.style.position = 'fixed'; menu.style.zIndex = 9999; menu.style.background = '#fff'; menu.style.border = '1px solid #ccc'; menu.style.padding = '6px';
    document.body.appendChild(menu);
    document.addEventListener('click', ()=>{ if(menu) menu.style.display='none'; });
  }
  menu.innerHTML = '';
  const replyOpt = document.createElement('div'); replyOpt.textContent = '回复'; replyOpt.style.cursor='pointer'; replyOpt.style.padding='4px 8px';
  replyOpt.addEventListener('click', (ev)=>{ ev.stopPropagation(); setReplyTarget(msg); menu.style.display='none'; });
  menu.appendChild(replyOpt);
  menu.style.left = (x + 2) + 'px'; menu.style.top = (y + 2) + 'px'; menu.style.display = 'block';
}

function setReplyTarget(msg){
  replyTarget = msg;
  const preview = $('replyPreview'); const replyText = $('replyText');
  if(preview && replyText){
    // build preview text based on message type
    let txt = '';
    if(msg.type === 'emoji' && msg.content){
      txt = '[表情] ' + (msg.content.filename || '');
    } else if(typeof msg.content === 'object'){
      txt = msg.content.text || JSON.stringify(msg.content);
    } else {
      txt = msg.content || '';
    }
    // prefer cached username, otherwise show id then fetch and update
    if(msg.from_user && userNameCache[msg.from_user]){
      replyText.textContent = (userNameCache[msg.from_user] + ': ') + (txt.length > 200 ? (txt.slice(0,200) + '...') : txt);
      preview.style.display = 'block';
    }else if(msg.from_user){
      replyText.textContent = (msg.from_user + ': ') + (txt.length > 200 ? (txt.slice(0,200) + '...') : txt);
      preview.style.display = 'block';
      getUserName(msg.from_user).then(name=>{ replyText.textContent = (name + ': ') + (txt.length > 200 ? (txt.slice(0,200) + '...') : txt); }).catch(()=>{});
    }else{
      replyText.textContent = (txt.length > 200 ? (txt.slice(0,200) + '...') : txt);
      preview.style.display = 'block';
    }
  }
}

function clearReplyTarget(){
  replyTarget = null;
  const preview = $('replyPreview'); const replyText = $('replyText');
  if(preview && replyText){ preview.style.display='none'; replyText.textContent=''; }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await init();
  const form = $('sendForm');
  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault(); if(!currentChat) return alert('先选择会话');
    const text = $('msgInput').value.trim(); if(!text) return;
    try{
      if(currentChat === 'global'){
        // post plain text global message
        const res = await fetch(`${apiBase}/global/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ content: text })
        });
        if(!res.ok) throw new Error('发送失败');
        $('msgInput').value=''; openChat('global');
      }else{
        const payload = { type: 'text', content: text };
        if(replyTarget) payload.repliedTo = replyTarget.id || replyTarget;
        const res = await fetch(`${apiBase}/chats/${currentChat}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        if(!res.ok) throw new Error('发送失败');
        $('msgInput').value=''; clearReplyTarget(); openChat(currentChat);
      }
    }catch(e){ console.error(e); alert('发送消息失败'); }
  });

  // emoji panel toggle and loading packs
  const emojiBtn = $('emojiBtn'); const emojiPanel = $('emojiPanel'); const emojiList = $('emojiList');
  if(emojiBtn && emojiPanel && emojiList){
    emojiBtn.addEventListener('click', async (ev)=>{
      ev.stopPropagation(); emojiPanel.style.display = (emojiPanel.style.display === 'block') ? 'none' : 'block';
      if(emojiPanel.style.display === 'block'){
        // load user's packs
        try{
          const res = await fetch(`${apiBase}/emoji`, { headers: { 'Authorization': `Bearer ${token}` } });
          if(res.ok){ const packs = await res.json(); emojiList.innerHTML=''; packs.forEach(p=>{
            const b = document.createElement('button'); b.style.border='none'; b.style.background='transparent'; b.style.padding='4px';
            const img = document.createElement('img'); img.src = p.url; img.style.width='48px'; img.style.height='48px'; img.style.objectFit='contain';
            b.appendChild(img);
            b.addEventListener('click', async ()=>{
              // send emoji message to currentChat
              if(!currentChat) return alert('先选择会话');
              try{
                const payload = { type: 'emoji', content: { packId: p.id, url: p.url, filename: (p.meta && p.meta.filename) || '' } };
                const endpoint = (currentChat === 'global') ? `${apiBase}/global/messages` : `${apiBase}/chats/${currentChat}/messages`;
                if(currentChat === 'global'){
                  // global doesn't support emoji
                  return alert('全服聊天不支持表情包');
                }
                const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
                if(!r.ok) throw new Error('发送失败');
                emojiPanel.style.display='none'; openChat(currentChat);
              }catch(e){ console.error(e); alert('发送表情失败'); }
            });
            emojiList.appendChild(b);
          }); }
        }catch(e){ console.error(e); }
      }
    });
    document.addEventListener('click', ()=>{ if(emojiPanel) emojiPanel.style.display='none'; });
  }

  const cancelBtn = $('cancelReply'); if(cancelBtn) cancelBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); clearReplyTarget(); });
  // if URL contains ?open=<chatId> or hash #<chatId>, open that chat after init; otherwise open global chat by default
  try{
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
    const toOpen = openId || 'global';
    // small delay to ensure chats are loaded
    setTimeout(()=>{ try{ openChat(toOpen); }catch(e){ console.error('openChat error', e); } }, 200);
  }catch(e){ }

  // wire global chat button in the sidebar
  const globalBtn = $('globalChat'); if(globalBtn) globalBtn.addEventListener('click', ()=>openChat('global'));
});
