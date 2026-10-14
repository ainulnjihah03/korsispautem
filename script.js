'use strict';
(() => {
  // Kandungan bersama dibaca daripada data/kandungan.json.
  const TYPES = ['Images', 'Videos', 'Documents', 'Design Files', 'Other', 'Links'];
  const BM = {'To Do':'Belum Mula','In Progress':'Sedang Dilaksanakan','Review':'Dalam Semakan','Completed':'Selesai','Overdue':'Lewat','Low':'Rendah','Medium':'Sederhana','High':'Tinggi','Images':'Gambar','Videos':'Video','Documents':'Dokumen','Design Files':'Fail Reka Bentuk','Other':'Lain-lain','Links':'Pautan','light':'Cerah','dark':'Gelap'};
  const compareAZ = (a,b) => String(a).localeCompare(String(b),'ms',{sensitivity:'base',numeric:true});
  const labelBM = value => BM[value] || value;
  const TITLE_BM = {'Mid-Sem Break':'Cuti Pertengahan Semester','Study Week':'Minggu Ulang Kaji','Final Exam':'Peperiksaan Akhir','Welcome Back for new Sem (Kuliah Semester II)':'Selamat Kembali ke Semester Baharu (Kuliah Semester II)'};
  function bahasaTugasan(task) {
    const title = TITLE_BM[task.title];
    const assignedTo = {'Junior 1':'Ahli Baharu 1','Junior 2':'Ahli Baharu 2'}[task.assignedTo] || task.assignedTo;
    return {...task, assignedTo, ...(title ? {title, description:typeof task.description==='string'?task.description.replace(task.title,title):task.description} : {})};
  }
  const $ = (s, root = document) => root.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')}`;
  const now = () => new Date().toISOString();
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const date = s => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('ms-MY', {day:'numeric',month:'short',year:'numeric'}) : '—';
  const bytes = n => n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
  const initials = s => s.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  // Calendar-day differences use Malaysian dates and UTC arithmetic, avoiding DST offsets.
  function postingDays(t, reference=today()) {
    return t.dueDate ? Math.round((Date.parse(t.dueDate+'T00:00:00Z')-Date.parse(reference+'T00:00:00Z'))/86400000) : null;
  }
  function postingMessage(t, reference=today()) {
    const days=postingDays(t,reference);
    if(days===null)return '';
    if(days===0)return 'Siaran hari ini';
    if(days===1)return 'Siaran esok';
    if(days>=2&&days<=3)return `Siaran dalam ${days} hari`;
    if(days<0)return `Tarikh siaran telah berlalu ${-days} hari`;
    return '';
  }
  function compareTasks(a,b,sort='asc',reference=today()) {
    const shared=t=>t.assignedTo.trim().toUpperCase()==='SEMUA';
    if(shared(a)!==shared(b))return shared(a)?-1:1;
    const old=t=>postingDays(t,reference)!==null&&postingDays(t,reference)<=-3;
    if(old(a)!==old(b))return old(a)?1:-1;
    if(!a.dueDate)return b.dueDate?1:0;
    if(!b.dueDate)return -1;
    return sort==='asc'?a.dueDate.localeCompare(b.dueDate):b.dueDate.localeCompare(a.dueDate);
  }
  function postingNotice(t) {
    const text=postingMessage(t),days=postingDays(t);
    return text?`<span class="posting-notice ${days>=0?'posting-soon':'posting-past'}">${icon(days>=0?'bell':'calendar-check')} ${esc(text)}</span>`:'';
  }
  const options = (items, selected) => items.map(x=>`<option value="${esc(x)}" ${x===selected?'selected':''}>${esc(labelBM(x))}</option>`).join('');
  const button = (action, text, ico, extra = '') => `<button type="button" class="button" data-action="${action}" ${extra}>${ico?icon(ico):''}${text}</button>`;
  let state, db, page = 'tasks', detailId = null, busy = false, storageOK = true, renderVersion = 0;
  let galleryQuery='', galleryFolder='', albumId=null, videoQuery='';
  let taskFilter = {q:'',member:'',sort:'asc'}, mediaFilter = {q:'',type:'',task:''};
  const urls = new Map(); let previewURL;
  function notify(message) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').classList.remove('visible'),5000); }
  function warning(message) { $('#storage-warning').hidden=false;$('#storage-warning').textContent=message; }
  function validURL(value) { try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw 0;return u.href;}catch{throw new Error('Masukkan URL http:// atau https:// yang sah tanpa maklumat log masuk.');} }
  function validDate(value) {return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;}
  function validate(data) {
    if(!data||data.version!==1||!Array.isArray(data.tasks)||data.tasks.length>10000)throw new Error('Format JSON tidak disokong (versi 1 dan senarai tugasan diperlukan).');
    const seen=new Set(); const checkId=id=>{if(typeof id!=='string'||!id||id.length>150||seen.has(id))throw new Error('ID kosong, tidak sah atau berulang dalam JSON.');seen.add(id);};
    const str=(x,max,required=false)=>{if(typeof x!=='string'||x.length>max||(required&&!x.trim()))throw new Error('Medan teks dalam JSON tidak sah atau terlalu panjang.');return x;};
    const timestamp=x=>{if(typeof x!=='string'||!Number.isFinite(Date.parse(x)))throw new Error('Tarikh metadata tidak sah.');return x;};
    const tasks=data.tasks.map(source=>{const t=bahasaTugasan(source);checkId(t.id);if((t.dueDate !== '' && !validDate(t.dueDate))||!Array.isArray(t.attachments)||!Array.isArray(t.links))throw new Error('Status, keutamaan, tarikh atau senarai lampiran/pautan tidak sah.');return {id:t.id,title:str(t.title,200,true),description:str(t.description,10000),assignedTo:str(t.assignedTo,150,true),dueDate:t.dueDate,schedule:str(t.schedule??'',100),notes:str(t.notes,15000),createdAt:timestamp(t.createdAt),attachments:t.attachments.map(a=>{checkId(a.id);if(!TYPES.slice(0,-1).includes(a.category)||!Number.isSafeInteger(a.size)||a.size<0)throw new Error('Metadata attachment tidak sah.');return {id:a.id,name:str(a.name,500,true),type:str(a.type,200),size:a.size,category:a.category,createdAt:timestamp(a.createdAt),path:str(a.path,1000,true),missing:false};}),links:t.links.map(l=>{checkId(l.id);return {id:l.id,title:str(l.title,200,true),url:validURL(str(l.url,5000,true)),description:str(l.description,5000),createdAt:timestamp(l.createdAt)};})};});
    return {version:1,videos:Array.isArray(data.videos)?validate({version:1,tasks:data.videos}).tasks:[],albums:Array.isArray(data.albums)?validate({version:1,tasks:data.albums}).tasks:undefined,seedRevision:typeof data.seedRevision==='string'?data.seedRevision:'',tasks,settings:{workspace:str(data.settings?.workspace??'Kor SISPA UTeM',100,true),theme:data.settings?.theme==='dark'?'dark':'light'},garbage:Array.isArray(data.garbage)?data.garbage.filter(x=>typeof x==='string'&&!seen.has(x)):[]};
  }
  function applyTetapan() {document.body.classList.toggle('dark',state.settings.theme==='dark');$('#theme-toggle span').textContent=state.settings.theme==='dark'?'Mod Cerah':'Mod Gelap';$('#nav-count').textContent=state.tasks.length;document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});$('#breadcrumb').textContent=page==='tasks'?'Semua Tugasan':page==='gallery'?'Gambar':page==='videos'?'Video':'Bahan Media';}
  function heading(title,sub,action='') {return `<div class="page-heading"><div><div class="eyebrow">KOR SISPA UTeM · PASUKAN MEDIA</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${action}</div>`;}
  function empty(title,sub) {return `<div class="empty">${icon('folder-open')}<h3>${title}</h3><p>${sub}</p></div>`;}
  function memberColor(name) {
    const key = name.trim().toLowerCase();
    const colors = {darwish:'#2457a7',natasha:'#7542a3',rashidah:'#087970',wahidah:'#a53670',iskandar:'#b85206','junior 1':'#39752a','junior 2':'#4c45a0','ahli baharu 1':'#39752a','ahli baharu 2':'#4c45a0',semua:'#546171'};
    if (colors[key]) return colors[key];
    const hash = Array.from(key).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
    return `hsl(${hash%360} 58% 34%)`;
  }
  function memberBadge(name) {
    return `<span class="member-chip" style="--member-color:${memberColor(name)}"><span class="avatar">${esc(initials(name))}</span><span>${esc(name)}</span></span>`;
  }
  function taskCard(t) {
    return `<article class="task-card task-row" style="--member-color:${memberColor(t.assignedTo)}">
      <div class="card-main" role="button" tabindex="0" data-action="details" data-id="${esc(t.id)}" aria-label="Lihat ${esc(t.title)}">
        <div class="task-summary"><h3>${esc(t.title)}</h3><p class="description">${esc(t.description)||'Tiada penerangan ditambah.'}</p></div>
        <div class="assignee">${memberBadge(t.assignedTo)}</div>
        <div class="due">${icon('calendar-days')}<span>${t.dueDate?date(t.dueDate):esc(t.schedule||'Belum ditetapkan')}</span></div>
        <div class="card-top">${postingNotice(t)}</div>
      </div>
    </article>`;
  }
  function taskResults() {
    const tasks=state.tasks.filter(t=>`${t.title} ${t.description} ${t.assignedTo} ${t.notes}`.toLowerCase().includes(taskFilter.q.toLowerCase())&&(!taskFilter.member||t.assignedTo===taskFilter.member));
    tasks.sort((a,b)=>compareTasks(a,b,taskFilter.sort));
    const upcoming=tasks.filter(t=>{const d=postingDays(t);return d!==null&&d>=0&&d<=3;}).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const reminders=upcoming.length?`<aside class="posting-alerts" aria-label="Peringatan siaran"><h2>${icon('bell')} Peringatan siaran</h2>${upcoming.map(t=>`<button class="posting-alert-item" data-action="details" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong><span>${esc(t.assignedTo)} · ${date(t.dueDate)} · ${postingMessage(t)}</span></button>`).join('')}</aside>`:'';
    $('#task-results').innerHTML=reminders+`<div class="results-label"><span>${tasks.length} tugasan${tasks.length!==state.tasks.length?` daripada ${state.tasks.length}`:''}</span><span>Tugasan Exco Multimedia Sepanjang Sesi 2026/2027</span></div><div class="task-grid">${tasks.map(taskCard).join('')||empty('Tiada tugasan','Ubah carian atau penapis anda.')}</div>`;
  }
  function quickResources(sortAZ=false) {
    const resources = [
      ['Siaran Instagram', 'Templat Canva', 'image', 'https://canva.link/c83pqovyfd5tv69', 'Buka Canva'],
      ['Siaran Instagram 1×3', 'Templat Canva', 'table-columns', 'https://canva.link/4g11ixuve9zssti', 'Buka Canva'],
      ['Cerita Instagram', 'Templat Canva', 'mobile-screen', 'https://canva.link/b2krpiejv1sunz4', 'Buka Canva'],
      ['Grid Gambar Instagram', 'Pisahkan gambar untuk grid Instagram', 'table-cells', 'https://carouselmaker.co/en/tools/free-instagram-image-splitter', 'Buka Pemisah Gambar']
    ];
    if(sortAZ)resources.sort((a,b)=>compareAZ(a[0],b[0]));
    return `<section class="quick-resources" aria-labelledby="resources-title"><div class="resources-heading"><h2 id="resources-title">Templat dan Alat</h2><p>Akses pantas untuk menyediakan siaran Instagram.</p></div><div class="resource-shortcuts">${resources.map(([title,description,symbol,url,cta])=>`<a class="resource-shortcut" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(title)} — ${cta} (tab baharu)"><span class="shortcut-icon">${icon(symbol)}</span><span class="shortcut-text"><strong>${esc(title)}</strong><small>${esc(description)}</small><span class="shortcut-cta">${cta} ${icon('arrow-up-right-from-square')}</span></span></a>`).join('')}</div></section>`;
  }
  function render() {renderVersion++;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();applyTetapan();const root=$('#content');if(page==='tasks'){root.innerHTML=heading('Semua Tugasan','Jadual tugasan EXCO Multimedia Kor SISPA UTeM · Sesi 2026/2027',`<div class="heading-actions"><button class="button" data-action="download-pdf" title="Muat turun jadual semua tugasan">${icon('file-pdf')} Muat Turun PDF</button></div>`)+quickResources()+`<div class="toolbar"><label class="search"><span class="visually-hidden">Cari Tugasan</span>${icon('magnifying-glass')}<input id="task-search" placeholder="Cari tugasan, ahli, kata kunci…" value="${esc(taskFilter.q)}"></label><select id="member-filter" aria-label="Tapis mengikut ahli"><option value="">Semua ahli</option>${options([...new Set(state.tasks.map(t=>t.assignedTo))].sort(),taskFilter.member)}</select><select id="task-sort" aria-label="Susun mengikut tarikh siaran"><option value="asc" ${taskFilter.sort==='asc'?'selected':''}>Tarikh siaran: terdekat</option><option value="desc" ${taskFilter.sort==='desc'?'selected':''}>Tarikh siaran: terjauh</option></select></div><div id="task-results"></div>`;taskResults();}
    else if(page==='gallery'){renderGallery();}
    else if(page==='videos'){renderVideos();}
    else if(page==='library'){root.innerHTML=heading('Bahan Media','Semua fail dan rujukan dalam satu koleksi tersusun.','')+`<div class="toolbar"><label class="search"><span class="visually-hidden">Cari bahan media</span>${icon('magnifying-glass')}<input id="media-search" placeholder="Cari fail dan pautan…" value="${esc(mediaFilter.q)}"></label><select id="media-type" aria-label="Tapis mengikut jenis media"><option value="">Semua jenis media</option>${options([...new Set(['Senarai Tugasan','Links',...state.tasks.flatMap(t=>t.attachments.map(a=>a.category))])],mediaFilter.type)}</select><select id="media-task" aria-label="Tapis mengikut bahan"><option value="">Semua bahan</option>${[{id:'agm-2026-2027',title:AGM_TITLE},{id:'certificate-templates',title:'TEMPLAT SIJIL'},{id:'instagram-templates',title:'TEMPLAT DAN SAIZ SIARAN INSTAGRAM'},{id:'carta-organisasi-2026-2027',title:'CARTA ORGANISASI SESI 2026/2027'},...state.tasks.filter(t=>t.attachments.length||t.links.length)].sort((a,b)=>compareAZ(a.title,b.title)).map(t=>`<option value="${esc(t.id)}" ${mediaFilter.task===t.id?'selected':''}>${esc(t.title)}</option>`).join('')}</select></div><div id="media-results"></div>`;mediaResults();}
  }
  function renderVideos() {
    $('#content').innerHTML=heading('Video','Koleksi video dan lagu Kor SISPA UTeM.')+`<form id="video-search-form" class="toolbar" role="search"><label class="search">${icon('magnifying-glass')}<span class="visually-hidden">Cari video</span><input id="video-search" type="search" placeholder="Cari tajuk atau nama video…" value="${esc(videoQuery)}"></label><button type="submit" class="button primary">${icon('magnifying-glass')} Cari</button><button type="button" class="button" data-action="video-clear">Kosongkan Carian</button></form><div id="video-results" aria-live="polite"></div>`;
    videoResults();
  }
  function videoResults() {
    const query=videoQuery.trim().toLowerCase();
    const videos=state.videos.flatMap(t=>[...t.attachments.filter(a=>a.category==='Videos'),...t.links.map(l=>({...l,name:l.title,category:'Links'}))].map(a=>({a,t}))).filter(({a,t})=>`${t.title} ${t.description} ${a.name}`.toLowerCase().includes(query)).sort((x,y)=>compareAZ(x.t.title,y.t.title)||compareAZ(x.a.name,y.a.name));
    $('#video-results').innerHTML=`<div class="media-grid">${videos.map(({a,t})=>mediaCard(a,t)).join('')||empty(query?'Tiada padanan video':'Belum ada video',query?'Cuba kata kunci lain.':'Video yang diterbitkan akan dipaparkan di sini.')}</div>`;
    hydrateThumbs($('#video-results'));
  }
  function mediaCard(a,t) {const isLink=a.category==='Links';return `<article class="media-card"><button class="media-preview" data-action="${isLink?'open-link':'preview'}" data-id="${esc(t.id)}" data-file="${esc(a.id)}" aria-label="${isLink?'Buka':'Pratonton'} ${esc(a.name||a.title)}" ${!isLink?`data-thumb="${esc(a.id)}"`:''}>${icon(isLink?'link':a.category==='Images'?'image':a.category==='Videos'?'film':a.category==='Design Files'?'pen-ruler':'file-lines')}</button><div class="media-info"><h3 title="${esc(a.name||a.title)}">${esc(a.name||a.title)}</h3><p>${labelBM(a.category)} ${!isLink?'· '+bytes(a.size):''}</p><p>${esc(t.title)} · ${date(a.createdAt)}</p>${a.missing?'<p class="missing">Fail binari tiada — metadata sahaja</p>':''}<div class="media-actions">${button(isLink?'open-link':'download',isLink?'Buka':'Muat Turun',isLink?'arrow-up-right-from-square':'download',`data-id="${esc(t.id)}" data-file="${esc(a.id)}"`)}${isLink?button('copy-link','Salin','copy',`data-id="${esc(t.id)}" data-file="${esc(a.id)}"`):''}</div></div></article>`;}
  const AGM_TITLE='ANNUAL GRAND MEETING (AGM) SESI 2026/2027';
  const AGM_TASKS=[
    'Menyediakan kad jemputan AGM.',
    'Menyediakan slaid pembentangan AGM.',
    'Menyediakan templat posting dan story Instagram untuk AGM.',
    'Menghasilkan video montaj berdurasi 2–3 minit yang merangkumi semua program Kor SISPA UTeM.',
    'Mengadakan sesi fotografi untuk ahli Majlis Tertinggi (MT) dan EXCO.',
    'Melaksanakan liputan fotografi dan rakaman video sepanjang AGM dengan penglibatan semua ahli.'
  ];
  function agmCopyText(index) {
    return `${index+1}. ${AGM_TASKS[index]}${index===0?'\nPautan kad jemputan: https://canva.link/jadia4cdwg42o8m':index===1?'\nPautan slaid: https://canva.link/n5yhrcql5i2alcz':''}`;
  }
  function showAGM() {
    modal(AGM_TITLE,`<div class="agm-toolbar"><div><span class="eyebrow">PERSEDIAAN DAN LIPUTAN</span><h3>Senarai Tugasan</h3></div><button class="button primary" data-action="agm-copy-all">${icon('copy')} Salin Semua</button></div><ol class="agm-task-list">${AGM_TASKS.map((task,index)=>`<li><span class="agm-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div class="agm-task-content"><p>${esc(task)}</p>${index===0?`<a class="agm-canva" href="https://canva.link/jadia4cdwg42o8m" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right-from-square')} Buka Kad Jemputan AGM di Canva</a>`:index===1?`<a class="agm-canva" href="https://canva.link/n5yhrcql5i2alcz" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right-from-square')} Buka Slaid AGM di Canva</a>`:''}</div></li>`).join('')}</ol>`);
  }
  async function copyAGM(index) {
    const text=index===null?`${AGM_TITLE}\n\n${AGM_TASKS.map((_,i)=>agmCopyText(i)).join('\n\n')}`:agmCopyText(index);
    try{await navigator.clipboard.writeText(text);notify(index===null?'Semua tugasan AGM disalin.':'Tugasan disalin.');}
    catch{modal('Salin Tugasan AGM',`<label class="field">Pilih dan salin teks berikut<textarea id="agm-copy-text" rows="12" readonly>${esc(text)}</textarea></label>`,button('agm-resources','Kembali ke Tugasan','arrow-left'));$('#agm-copy-text').focus();$('#agm-copy-text').select();}
  }
  const CERTIFICATE_LINKS=[
    ['SIJIL WATIKAH PELANTIKAN','https://canva.link/sf7h5m0ujllsa6v'],
    ['SIJIL PENGHARGAAN','https://canva.link/v1xweuf5d112qbf'],
    ['SIJIL PENGHARGAAN JAWATANKUASA KEPIMPINAN','https://canva.link/3f5hoy0g1cuhvax']
  ].sort((a,b)=>compareAZ(a[0],b[0]));
  function showCertificates(){
    modal('TEMPLAT SIJIL',`<div class="album-grid">${CERTIFICATE_LINKS.map(([title,url])=>`<a class="album-card" href="${url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><span class="album-cover">${icon('award')}</span><span class="album-name">${esc(title)}</span><span class="album-role">Templat sijil dalam Canva</span><span class="album-count">Buka Canva ${icon('arrow-up-right-from-square')}</span></a>`).join('')}</div>`);
  }
  function mediaResults() {const all=state.tasks.flatMap(t=>[...t.attachments,...t.links.map(l=>({...l,category:'Links'}))].map(a=>({a,t}))).filter(({a,t})=>(!mediaFilter.type||a.category===mediaFilter.type)&&(!mediaFilter.task||t.id===mediaFilter.task)&&`${a.name||a.title} ${a.description||''} ${t.title}`.toLowerCase().includes(mediaFilter.q.toLowerCase()));const showInstagram=(!mediaFilter.type||mediaFilter.type==='Links')&&(!mediaFilter.task||mediaFilter.task==='instagram-templates')&&'templat dan saiz siaran instagram posting ig 1x3 story cerita grid gambar canva'.includes(mediaFilter.q.trim().toLowerCase());const folder=showInstagram?`<div class="album-grid"><button class="album-card" data-action="instagram-resources"><span class="album-cover">${icon('folder-open')}</span><span class="album-name">TEMPLAT DAN SAIZ SIARAN INSTAGRAM</span><span class="album-role">Siaran, siaran 1×3, cerita dan grid gambar</span><span class="album-count">4 pautan ${icon('chevron-right')}</span></button></div>`:'';const showChart=(!mediaFilter.type||mediaFilter.type==='Links')&&(!mediaFilter.task||mediaFilter.task==='carta-organisasi-2026-2027')&&'carta organisasi sesi 2026/2027 canva'.includes(mediaFilter.q.trim().toLowerCase());const chart=showChart?`<div class="album-grid"><a class="album-card" href="https://canva.link/pv7kcqqeu1rliya" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><span class="album-cover">${icon('sitemap')}</span><span class="album-name">CARTA ORGANISASI SESI 2026/2027</span><span class="album-role">Templat carta organisasi dalam Canva</span><span class="album-count">Buka Canva ${icon('arrow-up-right-from-square')}</span></a></div>`:'';all.sort((x,y)=>compareAZ(x.a.name||x.a.title,y.a.name||y.a.title));const showAGM=(!mediaFilter.type||mediaFilter.type==='Senarai Tugasan')&&(!mediaFilter.task||mediaFilter.task==='agm-2026-2027')&&`${AGM_TITLE} ${AGM_TASKS.join(' ')}`.toLowerCase().includes(mediaFilter.q.trim().toLowerCase());const agm=showAGM?`<div class="album-grid"><button class="album-card" data-action="agm-resources"><span class="album-cover">${icon('folder-open')}</span><span class="album-name">${AGM_TITLE}</span><span class="album-role">Senarai tugasan persediaan dan liputan AGM</span><span class="album-count">6 tugasan ${icon('chevron-right')}</span></button></div>`:'';const showCertificates=(!mediaFilter.type||mediaFilter.type==='Links')&&(!mediaFilter.task||mediaFilter.task==='certificate-templates')&&`templat sijil canva ${CERTIFICATE_LINKS.map(([title])=>title).join(' ')}`.toLowerCase().includes(mediaFilter.q.trim().toLowerCase());const certificates=showCertificates?`<div class="album-grid"><button class="album-card" data-action="certificate-resources"><span class="album-cover">${icon('folder-open')}</span><span class="album-name">TEMPLAT SIJIL</span><span class="album-role">Sijil watikah pelantikan dan penghargaan</span><span class="album-count">3 pautan ${icon('chevron-right')}</span></button></div>`:'';$('#media-results').innerHTML=agm+chart+folder+certificates+`<div class="media-grid">${all.map(({a,t})=>mediaCard(a,t)).join('')||((showAGM||showInstagram||showChart||showCertificates)?'':empty('Tiada bahan media','Bahan yang diterbitkan akan dipaparkan di sini.'))}</div>`;hydrateThumbs($('#media-results'));}
  async function hydrateThumbs(root) {for(const el of root.querySelectorAll('[data-thumb]')){const id=el.dataset.thumb;const a=[...state.tasks,...(state.albums||[]),...(state.videos||[])].flatMap(t=>t.attachments).find(a=>a.id===id);if(!a||a.missing||!['Images','Videos'].includes(a.category))continue;try{if(!el.isConnected)continue;const url=publishedURL(a.path);const media=document.createElement(a.category==='Images'?'img':'video');media.src=url;if(media.tagName==='IMG'){media.alt=a.name;media.loading='lazy';}else{media.muted=true;media.preload='metadata';}el.replaceChildren(media);if(a.category==='Videos')el.insertAdjacentHTML('beforeend',`<span class="play-badge">${icon('play')}</span>`);}catch{/* Full error is shown on explicit open. */}}}
  function modal(title,body,actions='',formId='') {$('#modal-content').innerHTML=`${formId?`<form id="${formId}">`:''}<div class="modal-header"><h2 id="modal-title">${title}</h2><button type="button" class="icon-button" data-action="close" aria-label="Tutup">${icon('xmark')}</button></div><div class="modal-body">${body}</div><p class="form-error" role="alert"></p>${actions?`<div class="modal-actions">${actions}</div>`:''}${formId?'</form>':''}`;if(!$('#modal').open)$('#modal').showModal();}
  const cancel = () => button('close','Batal');
  function showDetails(id) {const t=state.tasks.find(t=>t.id===id);if(!t)return;detailId=id;modal(esc(t.title),`<div class="detail-meta"><div><small>Ahli bertanggungjawab</small>${memberBadge(t.assignedTo)}</div><div><small>Tarikh siaran</small><span>${t.dueDate?date(t.dueDate):esc(t.schedule||'Belum ditetapkan')}</span></div></div>${postingNotice(t)}<div class="section-title"><h3>Penerangan</h3></div><p class="detail-text">${esc(t.description)||'Tiada penerangan.'}</p><div class="section-title"><h3>Nota dan arahan</h3></div><p class="detail-text">${esc(t.notes)||'Tiada nota tambahan.'}</p><p class="help">Tarikh dicipta: ${date(t.createdAt)}</p>`,'');hydrateThumbs($('#modal-content'));}
  async function previewFile(taskId,fileId,download=false) {const a=[...state.tasks,...(state.albums||[]),...(state.videos||[])].find(t=>t.id===taskId)?.attachments.find(a=>a.id===fileId);if(!a)return;if(a.category==='Videos'){
      const url=publishedURL(a.path);
      if(download){const link=document.createElement('a');link.href=url;link.download=a.name;link.click();return;}
      $('#preview-content').innerHTML=`<div class="modal-header"><h2 id="preview-title">${esc(a.name)}</h2><button class="icon-button" data-action="close-preview" aria-label="Tutup pratonton">${icon('xmark')}</button></div><div class="modal-body"><video class="preview-video" src="${esc(url)}" controls playsinline preload="metadata"></video><p class="help" id="video-playback-error" hidden>Video tidak dapat dimainkan. Cuba muat turun fail untuk membukanya.</p></div><div class="modal-actions"><a class="button primary" href="${esc(url)}" download="${esc(a.name)}">${icon('download')} Muat Turun · ${bytes(a.size)}</a></div>`;
      $('video',$('#preview')).addEventListener('error',()=>{$('#video-playback-error').hidden=false;},{once:true});$('#preview').showModal();return;
    }const response=await fetch(publishedURL(a.path));if(!response.ok)throw new Error('Fail tidak tersedia. Sila maklumkan kepada penyelaras.');const url=URL.createObjectURL(await response.blob());if(download){const link=document.createElement('a');link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}if(previewURL)URL.revokeObjectURL(previewURL);previewURL=url;const ext=a.name.split('.').pop().toLowerCase();let body;if(a.category==='Images')body=`<img class="preview-image" src="${url}" alt="${esc(a.name)}">`;else if(a.category==='Videos')body=`<video class="preview-video" src="${url}" controls playsinline></video><p class="help">Jika format pengekodan video tidak disokong, muat turun untuk dimainkan pada peranti anda.</p>`;else if(ext==='pdf')body=`<iframe class="preview-pdf" title="Pratonton PDF" src="${url}"></iframe>`;else body=`<div class="empty">${icon('file-lines')}<h3>${esc(a.name)}</h3><p>Pratonton tidak tersedia untuk format ini. Muat turun untuk membuka fail.</p></div>`;$('#preview-content').innerHTML=`<div class="modal-header"><h2 id="preview-title">${esc(a.name)}</h2><button class="icon-button" data-action="close-preview" aria-label="Tutup pratonton">${icon('xmark')}</button></div><div class="modal-body">${body}</div><div class="modal-actions"><a class="button primary" href="${url}" download="${esc(a.name)}">${icon('download')} Muat Turun · ${bytes(a.size)}</a></div>`;$('#preview').showModal();}
  const GALLERY_FOLDERS = [["pegawai-bersekutu", "PEGAWAI BERSEKUTU KOR SISPA UTeM"], ["pegawai-apm", "PEGAWAI ANGKATAN PERTAHANAN AWAM (KOR SISPA UTeM)"], ["skuad-senior", "SKUAD SENIOR SESI 2026/2027"], ["skuad-intermediate", "SKUAD INTERMEDIATE SESI 2026/2027"], ["skuad-junior", "SKUAD JUNIOR SESI 2026/2027"]];
  const CHART_ROOT='carta-organisasi-2026-2027';
  GALLERY_FOLDERS.push([CHART_ROOT,'CARTA ORGANISASI SESI 2026/2027']);
  const CHART_FOLDERS=[
    ['carta-kepimpinan','JAWATANKUASA KEPIMPINAN KOR SISPA UTeM'],
    ['carta-pegawai-bersekutu','PEGAWAI BERSEKUTU KOR SISPA UTeM'],
    ['carta-pegawai-apm','PEGAWAI ANGKATAN PERTAHANAN AWAM (KOR SISPA UTeM)']
  ];
  const isChartFolder=id=>CHART_FOLDERS.some(([key])=>key===id);
  const albumGroup = group => [...GALLERY_FOLDERS,...CHART_FOLDERS].find(([id])=>id===group)?.[1]||group;
  function renderGallery() {
    $('#content').innerHTML=heading('Gambar',galleryFolder?esc(albumGroup(galleryFolder)):'Pilih folder untuk melihat gambar.',galleryFolder?button('gallery-back',isChartFolder(galleryFolder)?'Carta Organisasi 2026/2027':'Semua Folder','arrow-left'):'')+
      `<form id="gallery-search-form" class="toolbar" role="search"><label class="search">${icon('magnifying-glass')}<span class="visually-hidden">Cari gambar</span><input id="gallery-search" type="search" value="${esc(galleryQuery)}" placeholder="Cari nama, jawatan atau folder…"></label><button type="submit" class="button primary">${icon('magnifying-glass')} Cari</button><button type="button" class="button" data-action="gallery-clear">Kosongkan Carian</button></form><div id="gallery-results" aria-live="polite"></div>`;
    galleryResults();
  }
  function galleryResults() {
    const query=galleryQuery.trim().toLowerCase();
    let foldersHTML='';
    if(!galleryFolder||galleryFolder===CHART_ROOT){
      const visibleFolders=galleryFolder===CHART_ROOT?CHART_FOLDERS:(query?[...GALLERY_FOLDERS,...CHART_FOLDERS]:GALLERY_FOLDERS);
      foldersHTML=`<div class="album-grid">${visibleFolders.filter(([id,title])=>!query||title.toLowerCase().includes(query)).sort((a,b)=>compareAZ(a[1],b[1])).map(([id,title])=>{const albums=state.albums.filter(a=>id===CHART_ROOT?isChartFolder(a.assignedTo):a.assignedTo===id);const count=albums.reduce((n,a)=>n+a.attachments.length,0);return `<button class="album-card gallery-folder" data-action="gallery-folder" data-id="${id}"><span class="album-cover">${icon('folder-open')}</span><span class="album-name">${esc(title)}</span><span class="album-role">${id===CHART_ROOT?'3 subfolder':`${albums.length} album · ${count} gambar`}</span><span class="album-count">Buka folder ${icon('chevron-right')}</span></button>`;}).join('')}</div>`;
      if(!query){$('#gallery-results').innerHTML=foldersHTML;return;}
    }
    const albums=(state.albums||[]).filter(a=>(!galleryFolder||(galleryFolder===CHART_ROOT?isChartFolder(a.assignedTo):a.assignedTo===galleryFolder))&&`${a.title} ${a.description} ${albumGroup(a.assignedTo)}`.toLowerCase().includes(query)).sort((a,b)=>compareAZ(a.title,b.title));
    $('#gallery-results').innerHTML=foldersHTML+`<p class="help">${albums.length} album</p><div class="album-grid">${albums.map(a=>{const cover=a.attachments.find(f=>f.category==='Images'&&!f.missing);return `<button class="album-card" data-action="gallery-open" data-id="${esc(a.id)}"><span class="album-cover" ${cover?`data-thumb="${esc(cover.id)}"`:''}>${icon('user')}</span><span class="album-name">${esc(a.title)}</span><span class="album-role">${esc(a.description)}</span><span class="album-count">${a.attachments.length} gambar ${a.attachments.length?'':'· Belum diterbitkan'}</span></button>`;}).join('')||empty('Tiada gambar',galleryQuery?'Tiada padanan untuk carian anda.':'Gambar untuk folder ini belum ditambah.')}</div>`;
    hydrateThumbs($('#gallery-results'));
  }
  function showAlbum(id) {
    const a=state.albums.find(a=>a.id===id);if(!a)return;albumId=id;detailId=null;
    modal(esc(a.title),`<p class="detail-text">${esc(a.description)}</p><p class="help">${albumGroup(a.assignedTo)} · ${a.attachments.length} fail</p><div class="media-grid">${[...a.attachments].sort((x,y)=>compareAZ(x.name,y.name)).map(f=>mediaCard(f,a)).join('')||empty('Belum ada fail','Bahan untuk album ini belum diterbitkan.')}</div>`,'');
    hydrateThumbs($('#modal-content'));
  }
  async function downloadTaskPDF(returnBlob = false) {
    if (!state.tasks.length) { notify('Tiada tugasan untuk dieksport ke PDF.'); return; }
    
    // Render locally with native canvas: no server, external PDF library, or font dependency.
    // Raster pages preserve names in any script supported by the pelayar's system fonts.
    const tasks = [...state.tasks].sort((a,b) => {
      if (!a.dueDate) return b.dueDate ? -1 : 0;
      if (!b.dueDate) return 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    const pageWidth = 595, pageHeight = 842, margin = 32;
    const widths = [95, 331, 105], lineHeight = 11, pages = [];
    let canvas, ctx, y;
    function wrap(text, width) {
      const lines = []; let line = '';
      for (const char of String(text)) {
        if (char === '\n') { lines.push(line); line = ''; continue; }
        const candidate = line + char;
        if (ctx.measureText(candidate).width > width && line) {
          const space = line.lastIndexOf(' ');
          if (space > line.length / 2) { lines.push(line.slice(0,space)); line = line.slice(space+1) + char; }
          else { lines.push(line); line = char; }
        } else line = candidate;
      }
      lines.push(line); return lines;
    }
    function startPage() {
      canvas = document.createElement('canvas'); canvas.width = pageWidth*2; canvas.height = pageHeight*2;
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Pelayar tidak menyokong penjanaan PDF.');
      ctx.scale(2,2); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,pageWidth,pageHeight);
      ctx.fillStyle = '#E65100'; ctx.fillRect(margin,27,35,3);
      ctx.font = 'bold 14px Arial, sans-serif'; ctx.fillStyle = '#252525';
      ctx.fillText('JADUAL TUGASAN EXCO MULTIMEDIA',margin,51);
      ctx.font = 'bold 11px Arial, sans-serif';
      const workspaceLines = wrap(state.settings.workspace + ' | SESI 2026/2027',531);
      workspaceLines.forEach((line,i)=>ctx.fillText(line,margin,70+i*lineHeight));
      y = 83 + (workspaceLines.length-1)*lineHeight;
      ctx.fillStyle = '#E65100'; ctx.fillRect(margin,y,531,24);
      ctx.font = 'bold 10px Arial, sans-serif'; ctx.fillStyle = '#fff';
      let x=margin;
      ['TARIKH','TUGASAN / POSTER','AHLI'].forEach((label,i)=>{ctx.fillText(label,x+8,y+16);x+=widths[i];});
      y += 24;
    }
    function finishPage() {
      ctx.fillStyle = '#6b7280'; ctx.font = '8px Arial, sans-serif';
      ctx.fillText('SISPA MediaHub | Semua ' + tasks.length + ' tugasan | ' + date(today()),margin,812);
      ctx.textAlign = 'right'; ctx.fillText('Halaman ' + (pages.length+1),563,812); ctx.textAlign = 'left';
      const binary = atob(canvas.toDataURL('image/jpeg',0.94).split(',')[1]);
      pages.push(Uint8Array.from(binary,c=>c.charCodeAt(0)));
      canvas.width=0; canvas.height=0;
    }
    startPage();
    for (let index=0; index<tasks.length; index++) {
      const t=tasks[index];
      const label = t.dueDate ? t.dueDate.split('-').reverse().join('/') : (t.schedule || 'Belum ditetapkan');
      ctx.font = '10px Arial, sans-serif';
      const cells = [label,t.title,t.assignedTo].map((value,i)=>wrap(value,widths[i]-16));
      const height = Math.max(19,Math.max(...cells.map(lines=>lines.length))*lineHeight+8);
      if (y+height > 790) { finishPage(); startPage(); }
      ctx.font = '10px Arial, sans-serif';
      ctx.fillStyle = index%2 ? '#f5f6f8' : '#fff'; ctx.fillRect(margin,y,531,height);
      let x=margin;
      cells.forEach((lines,i)=>{
        ctx.strokeStyle='#d5d8dd';ctx.lineWidth=0.5;ctx.strokeRect(x,y,widths[i],height);
        ctx.fillStyle='#252525';lines.forEach((line,j)=>ctx.fillText(line,x+8,y+13+j*lineHeight));
        x+=widths[i];
      });
      y+=height;
    }
    finishPage();
    // Small PDF 1.4 writer. Binary image lengths and xref offsets are counted in bytes.
    const encoder=new TextEncoder(), chunks=[], offsets=[0]; let length=0;
    const append=part=>{const bytes=typeof part==='string'?encoder.encode(part):part;chunks.push(bytes);length+=bytes.length;};
    const object=(id,body)=>{offsets[id]=length;append(`${id} 0 obj\n${body}\nendobj\n`);};
    append('%PDF-1.4\n');
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
    pages.forEach((jpeg,i)=>{
      const pageId=3+i*3, imageId=pageId+1, contentId=pageId+2;
      object(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      offsets[imageId]=length;
      append(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1190 /Height 1684 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      append(jpeg);append('\nendstream\nendobj\n');
      const content='q 595 0 0 842 0 0 cm /Im0 Do Q\n';
      object(contentId,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    });
    const xref=length, count=3+pages.length*3;
    append(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for(let i=1;i<count;i++)append(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const pdf = new Blob(chunks,{type:'application/pdf'});
    if(returnBlob)return pdf;
    const url=URL.createObjectURL(pdf);
    const link=document.createElement('a'); link.href=url;link.download=`Jadual-Tugasan-EXCO-Media-2026-2027-${today()}.pdf`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notify(`PDF ${tasks.length} tugasan berjaya dijana.`);
  }

  function publishedURL(path) {
    if(typeof path!=='string'||!(path.startsWith('bahan/')||path.startsWith('images/'))||path.includes('\\')||path.split('/').some(part=>part==='..'||part==='.'||!part))throw new Error('Lokasi fail bahan tidak sah.');
    return new URL(path.split('/').map(encodeURIComponent).join('/'),document.baseURI).href;
  }
  async function handleAction(b) {
    if(!state)return;
    const action=b.dataset.action,id=b.dataset.id,file=b.dataset.file;
    if(action==='close'){$('#modal').close();detailId=null;albumId=null;}
    else if(action==='close-preview')$('#preview').close();
    else if(action==='details')showDetails(id);
    else if(action==='agm-resources')showAGM();
    else if(action==='agm-copy-all')await copyAGM(null);
    else if(action==='certificate-resources')showCertificates();
    else if(action==='instagram-resources'){modal('TEMPLAT DAN SAIZ SIARAN INSTAGRAM',quickResources(true),'<a class="button" href="bahan/templat-instagram/pautan-instagram.txt" download> Muat Turun Senarai Pautan</a>');}
    else if(action==='gallery-open')showAlbum(id);
    else if(action==='gallery-folder'&&[...GALLERY_FOLDERS,...CHART_FOLDERS].some(([key])=>key===id)){galleryFolder=id;galleryQuery='';render();}
    else if(action==='video-clear'){videoQuery='';$('#video-search').value='';videoResults();$('#video-search').focus();}
    else if(action==='gallery-clear'){galleryQuery='';$('#gallery-search').value='';galleryResults();$('#gallery-search').focus();}
    else if(action==='gallery-back'){galleryFolder=isChartFolder(galleryFolder)?CHART_ROOT:'';galleryQuery='';render();}
    else if(action==='preview'||action==='download')await previewFile(id,file,action==='download');
    else if(action==='download-pdf')await downloadTaskPDF();
    else if(action==='open-link'||action==='copy-link'){
      const link=[...state.tasks,...state.albums,...state.videos].find(t=>t.id===id)?.links.find(l=>l.id===file);if(!link)return;
      const url=validURL(link.url);
      if(action==='open-link'){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.click();}
      else{try{await navigator.clipboard.writeText(url);notify('Pautan disalin.');}catch{prompt('Salin pautan ini:',url);}}
    }
  }
  async function guarded(work) {if(busy)return;busy=true;document.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);try{await work();}catch(e){const error=$('.form-error');if($('#modal').open&&error)error.textContent=e.message;notify(e.message||'Operasi gagal. Sila cuba semula.');}finally{busy=false;document.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=false);}}
  document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav&&state&&!busy&&['tasks','library','gallery','videos'].includes(nav.dataset.page)){page=nav.dataset.page;render();return;}const b=e.target.closest('[data-action]');if(b)guarded(()=>handleAction(b));});
  document.addEventListener('keydown',e=>{const b=e.target.closest('.card-main');if(b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();guarded(()=>handleAction(b));}});
  document.addEventListener('submit',e=>{if(e.target.id==='video-search-form'){e.preventDefault();videoQuery=$('#video-search').value;videoResults();}if(e.target.id==='gallery-search-form'){e.preventDefault();galleryQuery=$('#gallery-search').value;galleryResults();}});
  document.addEventListener('input',e=>{if(e.target.id==='video-search'){videoQuery=e.target.value;videoResults();}if(e.target.id==='gallery-search'){galleryQuery=e.target.value;galleryResults();}if(e.target.id==='task-search'){taskFilter.q=e.target.value;taskResults();}if(e.target.id==='media-search'){mediaFilter.q=e.target.value;mediaResults();}});
  document.addEventListener('change',e=>{const el=e.target;const mapping={'member-filter':['member',taskFilter,taskResults],'task-sort':['sort',taskFilter,taskResults],'media-type':['type',mediaFilter,mediaResults],'media-task':['task',mediaFilter,mediaResults]};if(mapping[el.id]){const [key,obj,fn]=mapping[el.id];obj[key]=el.value;fn();}});
  $('#theme-toggle').addEventListener('click',()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';try{localStorage.setItem('sispa-theme',state.settings.theme);}catch{}applyTetapan();});
  $('#modal').addEventListener('cancel',e=>{if(busy)e.preventDefault();else detailId=null;});
  $('#preview').addEventListener('close',()=>{const video=$('video',$('#preview'));if(video)video.pause();$('#preview-content').replaceChildren();if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;});
  async function init() {
    try {
      const response=await fetch('data/kandungan.json',{cache:'no-store'});
      if(!response.ok)throw new Error('Fail kandungan tidak dapat dimuatkan.');
      state=validate(await response.json());state.albums=state.albums||[];
      const ids=new Set();
      for(const item of [...state.tasks,...state.albums,...state.videos]){
        for(const id of [item.id,...item.attachments.map(a=>a.id),...item.links.map(l=>l.id)]){
          if(ids.has(id))throw new Error('ID kandungan berulang.');ids.add(id);
        }
        item.attachments.forEach(a=>publishedURL(a.path));
      }
      try{state.settings.theme=localStorage.getItem('sispa-theme')==='dark'?'dark':'light';}catch{}
      render();
    }catch(error){warning('Kandungan tidak dapat dipaparkan. '+error.message);$('#content').innerHTML=empty('Kandungan belum tersedia','Sila muat semula halaman atau hubungi penyelaras.');}
  }
  function refreshPostingDates(){if(state&&page==='tasks'&&$('#task-results')&&!busy){taskResults();if(detailId&&$('#modal').open)showDetails(detailId);}}
  setInterval(refreshPostingDates,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPostingDates();});
  init();
})();
