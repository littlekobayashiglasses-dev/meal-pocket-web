(() => {
  'use strict';
  const apiOrigin = 'https://meal-pocket-taipei-20261125.almond-toast-9967.chatgpt.site';
  const oldKey = 'meal-pocket-v1';
  const defaults = ['工作地點・中壢', '常用地點・台北車站', '常用地點・板橋'];
  const fragment = new URLSearchParams(location.hash.slice(1));
  const rememberedKeyName = 'meal-pocket-share-link-v1';
  const rememberedEditName = 'meal-pocket-edit-link-v1';
  const explicitShare = fragment.has('share');
  const explicitEdit = fragment.has('edit');
  const explicitLink = explicitShare || explicitEdit;
  let rememberedKey = '', rememberedOwner = null;
  try { rememberedKey = localStorage.getItem(rememberedKeyName) || ''; rememberedOwner = JSON.parse(sessionStorage.getItem(rememberedEditName) || 'null'); } catch { /* Complete links work without storage. */ }
  // An explicit viewer link never inherits edit access from this browser.
  const shareKey = explicitLink ? (fragment.get('share') || '') : rememberedKey;
  const editKey = explicitLink ? (fragment.get('edit') || '') : (rememberedOwner?.share === shareKey ? rememberedOwner.edit : '') || '';
  let canEdit = false, accessRole = 'viewer', accessActor = null, onRemoteUpdate = null, lastAccessNotice = '';
  const effectiveAccess = () => ({role:blocked ? 'viewer' : accessRole, actor:blocked ? null : accessActor, canEdit:canEdit && !blocked});
  function publishAccess() {
    const access=effectiveAccess(); document.documentElement.dataset.listRole=access.role;
    const signature=JSON.stringify(access);
    if(signature!==lastAccessNotice) { lastAccessNotice=signature; if(typeof window.dispatchEvent==='function' && typeof Event==='function') window.dispatchEvent(new Event('meal-access-change')); }
  }
  window.addEventListener('hashchange', () => {
    const next = new URLSearchParams(location.hash.slice(1));
    if ((next.get('share') || '') !== (fragment.get('share') || '') || (next.get('edit') || '') !== (fragment.get('edit') || '') || next.has('edit') !== fragment.has('edit')) location.reload();
  });
  let revision = 0, cloudData = null, pendingKey = '', legacyPendingKey = '', migratedKey = '';
  let pending = null, running = false, blocked = false, counter = 0, copyNotice = '';
  const copy = value => JSON.parse(JSON.stringify(value));
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const isList = v => v && Array.isArray(v.places) && v.places.length && Array.isArray(v.restaurants);
  const hasOldInfo = v => isList(v) && (v.restaurants.length > 0 || JSON.stringify(v.places) !== JSON.stringify(defaults));
  const bar = document.createElement('section');
  bar.className = 'cloud-status';
  bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = '<span class="cloud-dot" aria-hidden="true"></span><span class="cloud-message">正在連接共用清單…</span><span class="cloud-actions"></span>';
  const style = document.createElement('style');
  style.textContent = '.cloud-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 20px;padding:12px 15px;border:1px solid #e8b8a7;border-radius:12px;background:#fff3ef;color:#652918;font-size:14px;line-height:1.55}.cloud-dot{width:9px;height:9px;border-radius:50%;background:#c94723;flex:none}.cloud-message{flex:1;min-width:180px}.cloud-actions{display:flex;gap:8px;flex-wrap:wrap}.cloud-actions button,.cloud-actions a{border:1px solid #c94723;border-radius:8px;background:#fff;color:#9c331b;padding:6px 10px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.cloud-actions input{min-width:0;max-width:100%;flex:1 1 220px;border:1px solid #c94723;border-radius:8px;background:#fff;color:#222;padding:7px 10px;font:inherit}.cloud-link-error{flex-basis:100%;color:#8a2410}.cloud-status[data-error="true"]{border-color:#9c331b;background:#fff0eb;color:#652918}.cloud-status[data-error="true"] .cloud-dot{background:#9c331b}';
  style.textContent += 'html[data-list-role="viewer"] .newBtn,html[data-list-role="viewer"] #addPlace,html[data-list-role="viewer"] #importBtn,html[data-list-role="viewer"] [data-edit],html[data-list-role="viewer"] [data-delete],html[data-list-role="collaborator"] #addPlace,html[data-list-role="collaborator"] #importBtn,html[data-list-role="collaborator"] [data-delete]{display:none!important}html[data-list-role="viewer"] .favorite:disabled,html[data-list-role="viewer"] .rating-btn:disabled{cursor:default;opacity:.8}';
  document.head.appendChild(style);
  function applyPermissions() {
    if (canEdit && !blocked) return;
    document.querySelectorAll('.favorite, .rating-btn').forEach(button => { if (!button.disabled) button.disabled = true; });
  }
  new MutationObserver(applyPermissions).observe(document.body, {childList:true, subtree:true});
  const main = document.querySelector('main');
  main.prepend(bar);
  const message = bar.querySelector('.cloud-message'), actions = bar.querySelector('.cloud-actions');
  function oldPendingBackups() {
    const backups = [];
    if (accessRole !== 'owner') return backups;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !(key.startsWith('meal-pocket-cloud-pending:') || (pendingKey && key.startsWith(pendingKey + '-backup:')) || (legacyPendingKey && key.startsWith(legacyPendingKey + '-backup:')))) continue;
        const data = read(key);
        if (isList(data)) backups.push(data);
      }
    } catch { /* Browser storage may be unavailable. */ }
    return backups;
  }
  function display(text, error = false, buttons = []) {
    message.textContent = text; bar.dataset.error = String(error); actions.replaceChildren();
    const oldBackups = oldPendingBackups();
    const backupButtons = oldBackups.map((data, index) => ({
      label: '下載舊版未同步備份' + (oldBackups.length > 1 ? ' ' + (index + 1) : ''),
      action: () => download(data, '舊版餐飲備份' + (oldBackups.length > 1 ? '-' + (index + 1) : '') + '.json')
    }));
    const recovered = (pendingKey ? read(pendingKey + '-last-recovered') : null) || (accessRole==='owner' && legacyPendingKey ? read(legacyPendingKey + '-last-recovered') : null);
    const recoveredButtons = isList(recovered) ? [
      {label:'下載上次合併前備份', action: () => download(recovered, '合併前餐飲名單.json')},
      ...(isList(cloudData) ? [{label:'查看上次合併前備份差異', action: () => showBackupDifferences(recovered)}] : [])
    ] : [];
    for (const spec of [...buttons, ...recoveredButtons, ...backupButtons]) {
      const el = document.createElement(spec.href ? 'a' : 'button');
      el.textContent = spec.label;
      if (spec.href) { el.href = spec.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      else { el.type = 'button'; el.addEventListener('click', spec.action); }
      actions.append(el);
    }
  }
  function showLinkEntry(messageText, recoverable = null) {
    const buttons = [];
    if (isList(recoverable)) buttons.push({label:'下載未同步備份',action:()=>download(recoverable,'未同步的餐飲名單.json')});
    if (/^[A-Za-z0-9_-]{32,128}$/.test(rememberedKey) && (rememberedKey !== shareKey || explicitEdit)) {
      buttons.push({label:'使用此瀏覽器已記住的連結', action: () => {
        location.hash = 'share=' + encodeURIComponent(rememberedKey) + (rememberedOwner?.share === rememberedKey && /^[A-Za-z0-9_-]{32,128}$/.test(rememberedOwner.edit || '') ? '&edit=' + encodeURIComponent(rememberedOwner.edit) : '');
        location.reload();
      }});
    }
    display(messageText, true, buttons);
    const input = document.createElement('input');
    input.type = 'url'; input.placeholder = '貼上完整共用連結';
    input.setAttribute('aria-label', '完整共用連結'); input.autocomplete = 'off';
    const error = document.createElement('span'); error.className = 'cloud-link-error'; error.setAttribute('role','status');
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '開啟清單';
    button.addEventListener('click', () => {
      try {
        const url = new URL(input.value.trim(), location.href);
        const params = new URLSearchParams(url.hash.slice(1));
        const key = params.get('share') || '', edit = params.get('edit') || '';
        if (!((url.origin === location.origin && url.pathname === location.pathname) || (url.origin === apiOrigin && url.pathname === '/')) || !/^[A-Za-z0-9_-]{32,128}$/.test(key) || (params.has('edit') && !/^[A-Za-z0-9_-]{32,128}$/.test(edit))) throw new Error('invalid');
        location.hash = 'share=' + encodeURIComponent(key) + (params.has('edit') ? '&edit=' + encodeURIComponent(edit) : '');
        location.reload();
      } catch { error.textContent = '連結格式不正確，請貼上此網站的完整共用連結。'; }
    });
    actions.append(input, button, error);
  }
  const pause = () => new Promise(() => {});
  const download = (value, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, ...value}, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  function lockUI(locked) { document.querySelector('header').inert = locked; for (const child of main.children) if (child !== bar) child.inert = locked; }
  lockUI(true);
  const infoNote = document.querySelector('.footnote');
  if (infoNote) infoNote.textContent = '共用連結可查看清單，只有持有私人編輯連結的人可以修改，無須登入。';
  const authHeaders = extra => ({'X-Share-Key': shareKey, ...(editKey ? {'X-Edit-Key': editKey} : {}), ...extra});
  // Menu files use the same capabilities as the list, without exposing keys in URLs.
  window.mealMenuFetch = (path, options = {}) => fetch(apiOrigin + path, {...options, credentials:'omit', headers:authHeaders(options.headers || {})});
  function merge(remote, local) {
    const places = [...remote.places];
    for (const p of local.places) if (!places.includes(p)) places.push(p);
    const ids = new Set(remote.restaurants.map(r => r.id));
    return {places, restaurants: [...remote.restaurants, ...local.restaurants.filter(r => !ids.has(r.id))]};
  }
  async function fetchCloud() {
    const response = await fetch(apiOrigin + '/api/meal-list', {cache:'no-store', credentials:'omit', headers:authHeaders()});
    if (response.status === 403 || response.status === 401) {
      blocked = true; lockUI(true);
      showLinkEntry('共用連結無效或不完整。請向分享者索取完整連結。');
      return null;
    }
    if (!response.ok) throw new Error('連線失敗');
    const result = await response.json();
    if (!isList(result.data) || !Number.isSafeInteger(result.revision) || typeof result.initialized !== 'boolean' || typeof result.canEdit !== 'boolean') throw new Error('清單資料無法讀取');
    if ((explicitEdit || editKey) && !result.canEdit) { blocked = true; lockUI(true); publishAccess(); const ownPending=pendingKey?read(pendingKey):null; showLinkEntry('編輯連結無效、已撤銷或不完整；未同步資料可下載備份。',ownPending); return null; }
    canEdit = result.canEdit;
    const role = ['owner','collaborator','viewer'].includes(result.role) ? result.role : (canEdit ? 'owner' : 'viewer');
    if ((role === 'viewer') === canEdit || (role === 'collaborator' && (!result.actor || typeof result.actor.id !== 'string'))) throw new Error('編輯權限無法讀取');
    accessRole=role; accessActor=result.actor || (role==='owner' ? {id:'owner',name:'本人',icon:'crane'} : null);
    return result;
  }
  async function copyLink() {
    const viewerUrl = location.origin + location.pathname + '#share=' + encodeURIComponent(shareKey);
    try { await navigator.clipboard.writeText(viewerUrl); copyNotice = '已複製唯讀連結，收到連結的人可以查看清單。'; }
    catch { window.prompt('請複製這個唯讀連結', viewerUrl); copyNotice = '請分享唯讀連結，私人編輯連結請自行保管。'; }
    readyStatus();
  }
  function hasLegacy() { try { return hasOldInfo(read(oldKey)) && !localStorage.getItem(migratedKey); } catch { return false; } }
  function readyStatus() {
    if (pending && canEdit) { if(running) { display('正在儲存至共用清單…'); return; } blocked=true; showPending(); return; }
    lockUI(false);
    publishAccess();
    applyPermissions();
    const buttons = [{label:'複製唯讀連結', action:copyLink}];
    if (!canEdit && pending) buttons.push({label:'下載未同步備份', action: () => download(pending, '未同步的餐飲名單.json')});
    if (canEdit && accessRole==='owner' && hasLegacy()) buttons.push({label:'匯入此裝置舊清單', action: () => importLocal(read(oldKey), 'legacy')});
    display(copyNotice || (accessRole==='owner' ? '管理模式：您可以管理所有店家和協作者。' : accessRole==='collaborator' ? `協作者：${accessActor.name}，可以新增及修改自己新增的店家。` : '查看模式：可以搜尋及查看店家，只有持有私人編輯連結的人可以修改。'), false, buttons);
  }
  // This comparison is intentionally read-only: it cannot infer which version
  // the user intended, and neither the current list nor the backup is modified.
  function showBackupDifferences(backup) {
    if (!isList(backup) || !isList(cloudData)) return;
    const oldDialog = document.getElementById('backup-differences-dialog');
    if (oldDialog) oldDialog.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'backup-differences-dialog';
    dialog.setAttribute('aria-label', '上次合併前備份差異');
    const title = document.createElement('h2');
    title.textContent = '上次合併前備份差異';
    const help = document.createElement('p');
    help.textContent = '依店家 ID 比較備份與目前共用清單；資料不同不代表哪一版本正確。本頁只供查看，不會套用或覆蓋任何變更；地點清單本身不在比較範圍。';
    const content = document.createElement('div');
    content.style.maxHeight = '55vh';
    content.style.overflowY = 'auto';
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
      return value;
    };
    const fields = {name:'店名',place:'地點',category:'類型',contributorName:'資訊提供者',contributorIcon:'提供者圖示',createdById:'新增者識別',createdBy:'新增者',updatedBy:'最後修改者',updatedAt:'修改時間',meals:'時段',price:'價格',hours:'營業時間',address:'地址',mapUrl:'地圖連結',notes:'備註',foodOpinion:'食物意見',rating:'評價',favorite:'收藏',createdAt:'加入日期',closedMode:'公休日設定',closedDays:'公休日',temporaryClosed:'暫停營業',menuUrls:'菜單連結',menuLinkDates:'菜單日期',menuImages:'菜單照片'};
    const valid = item => item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0;
    const local = backup.restaurants.filter(valid), remote = cloudData.restaurants.filter(valid);
    const localById = new Map(local.map(item => [item.id, item]));
    const remoteById = new Map(remote.map(item => [item.id, item]));
    const label = item => typeof item.name === 'string' && item.name.trim() ? item.name : '未命名店家';
    const localOnly = local.filter(item => !remoteById.has(item.id)).map(label);
    const remoteOnly = remote.filter(item => !localById.has(item.id)).map(label);
    const changed = [];
    for (const item of local) {
      const current = remoteById.get(item.id);
      if (!current) continue;
      const keys = [...new Set([...Object.keys(item), ...Object.keys(current)])].filter(key => key !== 'id').sort();
      const differences = keys.filter(key => JSON.stringify(canonical(item[key])) !== JSON.stringify(canonical(current[key])));
      if (differences.length) {
        const names = label(item) === label(current) ? label(item) : label(item) + '／' + label(current);
        changed.push(names + '：' + differences.map(key => fields[key] || key).join('、'));
      }
    }
    const unidentified = backup.restaurants.filter(item => !valid(item)).map(item => '備份：' + label(item || {}))
      .concat(cloudData.restaurants.filter(item => !valid(item)).map(item => '目前清單：' + label(item || {})));
    function section(name, rows) {
      const heading = document.createElement('h3');
      heading.textContent = name + '（' + rows.length + '）';
      content.append(heading);
      if (!rows.length) {
        const empty = document.createElement('p'); empty.textContent = '無'; content.append(empty); return;
      }
      const list = document.createElement('ul');
      for (const value of rows) { const row = document.createElement('li'); row.textContent = value; list.append(row); }
      content.append(list);
    }
    if (!localOnly.length && !remoteOnly.length && !changed.length && !unidentified.length) {
      const same = document.createElement('p'); same.textContent = '店家資料完全相同。'; content.append(same);
    } else {
      section('只在備份', localOnly);
      section('只在目前共用清單', remoteOnly);
      section('同一店家但欄位不同', changed);
      if (unidentified.length) section('缺少 ID、無法比對', unidentified);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'secondary'; close.textContent = '關閉';
    close.addEventListener('click', () => dialog.close());
    dialog.style.padding = '22px';
    dialog.append(title, help, content, close);
    document.body.append(dialog);
    dialog.showModal();
  }
  function showPending(problem = '') {
    blocked=true;
    lockUI(false);
    publishAccess();
    applyPermissions();
    display(problem || '這個裝置有尚未同步的變更，暫時以唯讀方式瀏覽。可下載備份、合併新增的店家，或保存備份後使用共用清單繼續編輯。這兩種方式都不會自動套用同一店家的未同步編輯和刪除，備份會保留在此裝置。', true, [
      {label:'下載未同步備份', action: () => download(pending, '未同步的餐飲名單.json')},
      ...(accessRole==='owner' ? [{label:'合併至共用清單', action: () => importLocal(pending, 'pending')}] : []),
      {label:'使用共用清單繼續編輯', action:archivePendingAndResume}
    ]);
  }
  function archiveLocalBackup(value) {
    const snapshot = JSON.stringify(value);
    const prefix = pendingKey + '-backup:' + Date.now() + ':';
    let index = 0, backupKey;
    do { backupKey = prefix + index++; } while (localStorage.getItem(backupKey) !== null);
    localStorage.setItem(backupKey, snapshot);
    if (localStorage.getItem(backupKey) !== snapshot) throw new Error('無法確認備份已儲存。');
  }
  function archivePendingAndResume() {
    if (!canEdit || !blocked || !isList(pending)) return;
    try {
      const snapshot = JSON.stringify(pending);
      const current = localStorage.getItem(pendingKey);
      if (!current || JSON.stringify(JSON.parse(current)) !== snapshot) throw new Error('此裝置的未同步資料已變動，請重新載入後再試。');
      archiveLocalBackup(pending);
      if (JSON.stringify(JSON.parse(localStorage.getItem(pendingKey))) !== snapshot) throw new Error('此裝置的未同步資料已變動，請重新載入後再試。');
      localStorage.removeItem(pendingKey);
      if (localStorage.getItem(pendingKey) !== null) throw new Error('無法完成切換，未同步資料仍保留。');
      location.reload();
    } catch (err) {
      showPending((err && err.message ? err.message : '無法保存未同步資料。') + ' 未同步資料仍保留，可先下載備份。');
    }
  }
  async function importLocal(local, type) {
    if (!canEdit || accessRole!=='owner') return;
    if (!isList(local)) { display('無法讀取裝置資料，請檢查備份。', true); return; }
    if (!confirm('將新增此裝置的地點和店家。相同店家保留共用清單版本，此裝置的編輯、評價與刪除不會套用。合併後仍可下載合併前備份。確定繼續嗎？')) return;
    try {
      display('正在合併並儲存清單…');
      const current = await fetchCloud();
      if (!current) return;
      if (!current.initialized) throw new Error('共用清單尚未建立。');
      const merged = merge(current.data, local);
      archiveLocalBackup(local);
      const response = await fetch(apiOrigin + '/api/meal-list', {method:'PUT', credentials:'omit', headers:authHeaders({'Content-Type':'application/json'}), body:JSON.stringify({revision:current.revision,data:merged})});
      if (response.status === 409) throw new Error('其他人剛更新，請重新合併。');
      if (!response.ok) throw new Error('無法儲存，裝置資料仍保留。');
      if (type === 'legacy') localStorage.setItem(migratedKey, '1');
      if (type === 'pending') {
        // Another tab may have written a newer snapshot while the network request
        // was in flight. Remove only the snapshot that was actually merged.
        const latestPending = localStorage.getItem(pendingKey);
        let matchesMergedSnapshot = false;
        try { matchesMergedSnapshot = latestPending != null && JSON.stringify(JSON.parse(latestPending)) === JSON.stringify(local); } catch { /* Keep unreadable or changed data. */ }
        if (matchesMergedSnapshot) localStorage.removeItem(pendingKey);
      }
      location.reload();
    } catch (err) {
      display(err.message || '合併失敗，裝置資料仍保留。', true,
        [{label:'下載裝置清單', action: () => download(local, '裝置餐飲備份.json')}, {label:'再試一次', action: () => importLocal(local, type)}]);
    }
  }
  async function push() {
    if (!canEdit || running || blocked || !pending) return;
    running = true;
    while (pending && !blocked) {
      const seq = counter, snapshot = copy(pending);
      display('正在儲存至共用清單…');
      try {
        const response = await fetch(apiOrigin + '/api/meal-list', {method:'PUT', credentials:'omit', headers:authHeaders({'Content-Type':'application/json'}), body:JSON.stringify({revision, data:snapshot})});
        if (response.status === 409) { blocked = true; showPending(); break; }
        if (response.status === 401 || response.status === 403) { blocked = true; lockUI(true); publishAccess(); display('沒有權限儲存這項變更，或編輯連結已失效；未同步資料保留在此瀏覽器。', true, [{label:'下載未同步備份',action:()=>download(pending,'未同步的餐飲名單.json')}]); break; }
        if (!response.ok) throw new Error('儲存失敗');
        const result=await response.json();
        revision = result.revision;
        cloudData = isList(result.data) ? result.data : snapshot;
        if (seq === counter) {
          pending = null; localStorage.removeItem(pendingKey);
          let displayed=true;
          try { if(onRemoteUpdate) onRemoteUpdate(copy(cloudData)); } catch { displayed=false; }
          if(displayed) readyStatus(); else display('已儲存，但畫面更新失敗；請重新整理查看。',true);
        }
        else { mergeServerAttribution(pending,cloudData); localStorage.setItem(pendingKey,JSON.stringify(pending)); }
      } catch {
        blocked = true; lockUI(true);
        display('暫時無法連線；變更保留在此瀏覽器，請確認網路後重試。', true, [
          {label:'重試同步', action:()=>{blocked=false;lockUI(false);push();}},
          {label:'下載未同步備份', action:()=>download(pending,'未同步的餐飲名單.json')}
        ]);
      }
    }
    running = false;
  }
  // The server owns creator/update metadata. Merge only those fields into a
  // newer unsent snapshot; never overwrite user edits made while PUT ran.
  function mergeServerAttribution(target, canonical) {
    if(!isList(target)||!isList(canonical))return;
    const known=new Map(canonical.restaurants.map(r=>[r.id,r]));
    for(const item of target.restaurants) { const server=known.get(item.id); if(!server)continue; for(const key of ['createdById','createdBy','updatedBy','updatedAt']) { if(server[key] == null) delete item[key]; else item[key]=server[key]; } }
  }
  async function editorsRequest(method, path, body) {
    if(accessRole!=='owner'||!canEdit||blocked) throw new Error('只有管理者可以管理協作者。');
    const response=await fetch(apiOrigin + path,{method,credentials:'omit',headers:authHeaders(body ? {'Content-Type':'application/json'} : {}),...(body ? {body:JSON.stringify(body)} : {})});
    let value={}; try { value=await response.json(); } catch { /* Surface a generic failure. */ }
    if(!response.ok)throw new Error(value.error||'無法管理協作者。');
    return value;
  }
  function editorLink(value) {
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(value.token||''))throw new Error('協作者連結無法取得。');
    return location.origin+location.pathname+'#share='+encodeURIComponent(shareKey)+'&edit='+encodeURIComponent(value.token);
  }
  window.mealSync = {
    getAccess() { return effectiveAccess(); },
    canEditRestaurant(r) { return !!r && canEdit && !blocked && (accessRole==='owner' || (accessRole==='collaborator' && r.createdById===accessActor?.id)); },
    async listEditors() { return editorsRequest('GET','/api/meal-editors'); },
    async getEditorLink(id) {
      const value=await editorsRequest('GET','/api/meal-editors?id='+encodeURIComponent(id));
      return {url:editorLink(value)};
    },
    async reissueEditor(id) {
      const value=await editorsRequest('PATCH','/api/meal-editors?id='+encodeURIComponent(id));
      if(!value.editor)throw new Error('協作者連結無法換發。');
      return {editor:value.editor,url:editorLink(value)};
    },
    async registerEditorToken(id,token) {
      const value=await editorsRequest('PATCH','/api/meal-editors?id='+encodeURIComponent(id),{mode:'adopt',token});
      if(!value.editor)throw new Error('協作者連結無法登記。');
      return {editor:value.editor,url:editorLink(value)};
    },
    async createEditor(name,icon) {
      const value=await editorsRequest('POST','/api/meal-editors',{name,icon});
      if(!value.editor)throw new Error('協作者連結無法建立。');
      const url=editorLink(value);
      return {editor:value.editor,url};
    },
    async revokeEditor(id) { return editorsRequest('DELETE','/api/meal-editors?id='+encodeURIComponent(id)); },
    async boot() {
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(shareKey)) {
        showLinkEntry('請貼上分享者提供的完整共用連結；這份清單不需登入。'); return pause();
      }
      if ((explicitEdit || editKey) && !/^[A-Za-z0-9_-]{32,128}$/.test(editKey)) { showLinkEntry('編輯連結無效或不完整，請使用正確的私人編輯連結。'); return pause(); }
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shareKey));
        const id = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2,'0')).join('');
        legacyPendingKey = 'meal-pocket-shared-pending:' + id; migratedKey = 'meal-pocket-shared-legacy:' + id;
        const keyHash=editKey ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(editKey))),v=>v.toString(16).padStart(2,'0')).join('') : '';
        pendingKey=legacyPendingKey+(keyHash ? ':key:'+keyHash : ':viewer');
        const result = await fetchCloud();
        if (!result) return pause();
        if (!result.initialized) {
          display('共用清單尚未建立，請稍後向分享者取得可使用的連結。', true);
          return pause();
        }
        // Only an authenticated, initialized list may replace a previously remembered capability.
        try { localStorage.setItem(rememberedKeyName, shareKey); rememberedKey = shareKey; if (canEdit) sessionStorage.setItem(rememberedEditName, JSON.stringify({share:shareKey, edit:editKey})); } catch { /* The active complete link remains usable. */ }
        if (!explicitLink) {
          fragment.set('share', shareKey);
          if (canEdit) fragment.set('edit', editKey);
          history.replaceState(null, '', location.pathname + location.search + '#' + fragment.toString());
        }
        revision = result.revision; cloudData = result.data;
        pending = read(pendingKey);
        // Old unsynchronized snapshots belong to the previous owner-only era.
        // Never expose or auto-merge them into a collaborator's session.
        if (!isList(pending) && accessRole === 'owner' && isList(read(legacyPendingKey))) { pendingKey=legacyPendingKey; pending=read(pendingKey); }
        if (!isList(pending)) pending = null;
        blocked = !!pending && canEdit;
        readyStatus();
        return cloudData;
      } catch {
        display('無法連接共用清單。請檢查網路後重試，原本裝置上的資料不會被清除。', true, [{label:'重新載入', action:()=>location.reload()}]);
        return pause();
      }
    },
    watch(onUpdate) {
      onRemoteUpdate=onUpdate;
      const check = async () => {
        if (document.hidden || (pending && canEdit) || blocked || document.querySelector('dialog[open]')) return;
        try {
          const next = await fetchCloud();
          if (next && next.initialized && !(pending && canEdit) && !blocked && !document.querySelector('dialog[open]') && next.revision > revision) {
            revision = next.revision; cloudData = next.data; onUpdate(next.data); readyStatus();
          }
        } catch { /* Keep showing the last successful copy; retry on next check. */ }
      };
      setInterval(check, 15000);
      document.addEventListener('visibilitychange', check);
    },
    save(data) {
      if (!canEdit || blocked) { alert('目前為查看模式，無法修改清單。'); return false; }
      try { mergeServerAttribution(data,cloudData); pending = copy(data); localStorage.setItem(pendingKey, JSON.stringify(pending)); counter++; }
      catch { alert('無法在此瀏覽器保留未同步資料，請確認儲存空間。'); return false; }
      if (blocked) showPending(); else push();
      return true;
    }
  };
})();
