/* Diet Dash — personal nutrition tracker. All data local (localStorage).
   Food lookups via Open Food Facts (no key). */
'use strict';

const VERSION = 'v1.0.0';
const LS = 'dietdash.v1';

/* ---------- nutrient model ----------
   Every food stores nutrients PER SERVING. A log entry = food + qty multiplier. */
const NUTRIENTS = [
  { key:'kcal', name:'Calories', unit:'',   goal:'cap',   dflt:2000 },
  { key:'sodium', name:'Sodium', unit:'mg', goal:'cap',   dflt:1500 },
  { key:'protein', name:'Protein', unit:'g', goal:'floor', dflt:120 },
  { key:'sugar', name:'Added sugar', unit:'g', goal:'cap', dflt:36 },
  { key:'fiber', name:'Fiber', unit:'g', goal:'floor', dflt:30 },
  { key:'fat', name:'Total fat', unit:'g', goal:'info', dflt:70 },
  { key:'satfat', name:'Sat fat', unit:'g', goal:'cap', dflt:20 },
  { key:'chol', name:'Cholesterol', unit:'mg', goal:'cap', dflt:300 },
  { key:'potassium', name:'Potassium', unit:'mg', goal:'info', dflt:3400 },
];
const NKEYS = NUTRIENTS.map(n=>n.key);

/* ---------- state ---------- */
const defaultState = () => ({
  pantry: [],           // {id,name,brand,serving,src,verified, nutr:{...}}
  log: [],              // {id,foodId,name,brand,ts,qty, nutr:{...per-serving snapshot...}}
  targets: Object.fromEntries(NUTRIENTS.map(n=>[n.key,n.dflt])),
  window: { start: 12, len: 8 },   // 8-hour window starting noon
  usdaKey: 'DEMO_KEY',             // free key from fdc.nal.usda.gov/api-key-signup
});

let state = load();
let viewDate = startOfDay(new Date());   // which day the Today view shows
let currentTab = 'today';

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS));
    if(!raw) return defaultState();
    const d = defaultState();
    return {
      pantry: raw.pantry||[], log: raw.log||[],
      targets: Object.assign(d.targets, raw.targets||{}),
      window: Object.assign(d.window, raw.window||{}),
      usdaKey: raw.usdaKey || d.usdaKey,
    };
  }catch(e){ return defaultState(); }
}
function save(){ localStorage.setItem(LS, JSON.stringify(state)); }
function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

/* ---------- date helpers ---------- */
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function dayKey(d){ const x=new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
function sameDay(ts,d){ return dayKey(ts)===dayKey(d); }
function fmtTime(ts){ return new Date(ts).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
function fmtDay(d){
  const today=startOfDay(new Date());
  if(dayKey(d)===dayKey(today)) return 'Today';
  const y=new Date(today); y.setDate(y.getDate()-1);
  if(dayKey(d)===dayKey(y)) return 'Yesterday';
  return new Date(d).toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
}

/* ---------- aggregation ---------- */
function entriesFor(d){ return state.log.filter(e=>sameDay(e.ts,d)).sort((a,b)=>a.ts-b.ts); }
function totalsFor(d){
  const t=Object.fromEntries(NKEYS.map(k=>[k,0]));
  for(const e of entriesFor(d)) for(const k of NKEYS) t[k]+=(e.nutr[k]||0)*e.qty;
  return t;
}
function inWindow(ts){
  const h = new Date(ts).getHours()+new Date(ts).getMinutes()/60;
  const s=state.window.start, e=s+state.window.len;
  if(e<=24) return h>=s && h<e;
  return h>=s || h < (e-24);   // window wraps past midnight
}

/* ---------- rendering ---------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const el=(t,c,h)=>{const x=document.createElement(t); if(c)x.className=c; if(h!=null)x.innerHTML=h; return x;};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const rnd=(v,k)=> k==='kcal'||k==='sodium'||k==='chol'||k==='potassium' ? Math.round(v) : Math.round(v*10)/10;

function barClass(k, val, tgt){
  const n = NUTRIENTS.find(x=>x.key===k);
  if(n.goal==='info' || !tgt) return 'info';
  const p = val/tgt;
  if(n.goal==='cap')   return p>1 ? 'over' : p>0.85 ? 'warn' : 'good';
  /* floor */          return p>=1 ? 'good' : p>=0.6 ? 'warn' : 'over';
}

function statCard(k, val, tgt){
  const n=NUTRIENTS.find(x=>x.key===k);
  const cls=barClass(k,val,tgt);
  const pct=tgt? Math.min(100, Math.round(val/tgt*100)) : 0;
  const goalCls = n.goal==='floor'?'floor':n.goal==='cap'?'cap':'';
  const tgtLabel = n.goal==='info' ? 'monitor'
    : (n.goal==='floor'?'floor ':'max ')+rnd(tgt,k)+n.unit;
  return `<div class="stat ${goalCls}">
    <div class="top"><span class="name">${esc(n.name)}</span>
      <span class="val">${rnd(val,k)}<small>${n.unit}</small></span></div>
    <div class="tgt">${tgtLabel}${tgt&&n.goal!=='info'?' · '+pct+'%':''}</div>
    <div class="bar ${cls}"><i style="width:${tgt?Math.min(100,val/tgt*100):0}%"></i></div>
  </div>`;
}

function renderToday(){
  const totals=totalsFor(viewDate);
  const grid=$('#ringsGrid');
  grid.innerHTML = NUTRIENTS.map(n=>statCard(n.key, totals[n.key], state.targets[n.key])).join('');

  // eating window strip
  const ents=entriesFor(viewDate);
  const strip=$('#windowStrip');
  if(ents.length){
    const first=new Date(ents[0].ts), last=new Date(ents[ents.length-1].ts);
    const span=((last-first)/3600000);
    const out=ents.filter(e=>!inWindow(e.ts)).length;
    const dayStart=startOfDay(viewDate).getTime();
    const pos=ts=>((ts-dayStart)/86400000)*100;
    const ws=state.window.start, wl=state.window.len;
    const winLeft=(ws/24)*100, winW=(Math.min(wl,24-ws)/24)*100;
    strip.innerHTML=`
      <div class="wlabel"><span>Eating window</span>
        <span><b>${fmtTime(first)}</b> → <b>${fmtTime(last)}</b> · ${span.toFixed(1)}h span</span></div>
      <div class="wtrack">
        <div class="wfill" style="left:${winLeft}%;width:${winW}%"></div>
        ${ents.map(e=>`<div class="wdot" style="left:${pos(e.ts)}%"></div>`).join('')}
      </div>
      ${out? `<div class="wflag">⚠ ${out} ${out>1?'items':'item'} outside your ${wl}h window</div>`:''}`;
    strip.hidden=false;
  } else {
    strip.innerHTML=`<div class="wlabel"><span>Eating window</span><span>${state.window.len}h from ${hourLabel(state.window.start)}</span></div><div class="wtrack"></div>`;
  }

  // log list
  const list=$('#logList');
  if(!ents.length){ list.innerHTML=`<li class="empty">Nothing logged ${fmtDay(viewDate).toLowerCase()}. Tap “+ Add food”.</li>`; return; }
  list.innerHTML=ents.map(e=>{
    const kcal=Math.round((e.nutr.kcal||0)*e.qty);
    const sod=Math.round((e.nutr.sodium||0)*e.qty);
    return `<li class="logitem ${inWindow(e.ts)?'':'out'}" data-log="${e.id}">
      <span class="time">${fmtTime(e.ts)}</span>
      <span class="mid"><div class="nm">${esc(e.name)}</div>
        <div class="sub">${e.qty!==1?e.qty+'× · ':''}${sod}mg sodium${e.brand?' · '+esc(e.brand):''}</div></span>
      <span class="kcal">${kcal}</span></li>`;
  }).join('');
}

function hourLabel(h){ const ap=h>=12?'pm':'am'; let hh=h%12; if(hh===0)hh=12; return hh+ap; }

function renderWeek(){
  const days=[]; const base=startOfDay(new Date());
  for(let i=6;i>=0;i--){ const d=new Date(base); d.setDate(d.getDate()-i); days.push(d); }
  const tb=$('#weekTable');
  const th=`<div class="wrow head"><span>Day</span><span>Cal</span><span>Sodium</span><span>Protein</span></div>`;
  const rows=days.map(d=>{
    const t=totalsFor(d);
    const isT=dayKey(d)===dayKey(base);
    const dn=d.toLocaleDateString([], {weekday:'short'});
    return `<div class="wrow ${isT?'today':''}">
      <span class="d">${dn}</span>
      <span class="cell"><b>${Math.round(t.kcal)}</b></span>
      <span class="cell">${pillFor('sodium',t.sodium)}</span>
      <span class="cell">${pillFor('protein',t.protein)}</span></div>`;
  }).join('');
  tb.innerHTML=th+rows;

  // averages (only over days that have entries)
  const active=days.filter(d=>entriesFor(d).length);
  const n=active.length||1;
  const avg=Object.fromEntries(NKEYS.map(k=>[k, active.reduce((s,d)=>s+totalsFor(d)[k],0)/n]));
  $('#weekAvg').innerHTML = NUTRIENTS.map(nn=>statCard(nn.key, avg[nn.key], state.targets[nn.key])).join('');
}

function pillFor(k,val){
  const tgt=state.targets[k]; const cls=barClass(k,val,tgt);
  return `<span class="pill ${cls}">${rnd(val,k)}</span>`;
}

function renderPantry(q=''){
  const list=$('#pantryList');
  const banner=$('#pantryBanner');
  if(banner){
    const un=state.pantry.filter(p=>!p.verified).length;
    banner.innerHTML = un ? `<div class="pantry-banner">
      <span><b>${un}</b> item${un>1?'s':''} still on estimates</span>
      <button class="chip-btn" id="bannerMatch">Match to real products</button></div>` : '';
    const bm=$('#bannerMatch'); if(bm) bm.onclick=openReconcile;
  }
  const items=state.pantry
    .filter(p=>!q || (p.name+' '+(p.brand||'')).toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>a.name.localeCompare(b.name));
  if(!state.pantry.length){ list.innerHTML=`<li class="empty">Your pantry is empty.<br><br>
    <button class="chip-btn" id="emptyLoadSeed">Load HEB / Costco starter pantry</button><br><br>
    …or tap “+ New”, or add foods as you log them.</li>`;
    const b=$('#emptyLoadSeed'); if(b) b.onclick=loadStarterPantry; return; }
  if(!items.length){ list.innerHTML=`<li class="empty">No matches.</li>`; return; }
  list.innerHTML=items.map(p=>`
    <li class="pantryitem" data-food="${p.id}">
      <span class="mid"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc(p.serving||'1 serving')} · ${Math.round(p.nutr.kcal||0)} cal · ${Math.round(p.nutr.sodium||0)}mg Na
          <span class="src ${p.verified?'verified':''}">${p.verified?'✓ verified':esc(p.src||'manual')}</span></div></span>
      <button class="log" data-logfood="${p.id}">Log</button>
    </li>`).join('');
}

function renderSettings(){
  const tf=$('#targetForm');
  tf.innerHTML=NUTRIENTS.map(n=>`
    <label>${esc(n.name)}${n.unit?' ('+n.unit+')':''}${n.goal==='floor'?' ▲':n.goal==='cap'?' ▼':' •'}
      <input type="number" inputmode="decimal" data-target="${n.key}" value="${state.targets[n.key]}"></label>`).join('');
  tf.oninput=e=>{ const k=e.target.dataset.target; if(!k)return;
    state.targets[k]=parseFloat(e.target.value)||0; save(); };

  const ws=$('#winStart'); ws.innerHTML='';
  for(let h=0;h<24;h++){ const o=el('option',null,hourLabel(h)); o.value=h; if(h===state.window.start)o.selected=true; ws.appendChild(o); }
  ws.onchange=()=>{ state.window.start=+ws.value; save(); };
  const wl=$('#winLen'); wl.value=state.window.len;
  wl.onchange=()=>{ state.window.len=Math.max(1,Math.min(24,+wl.value||8)); save(); };

  $('#medNote').innerHTML=`<b>Heads up:</b> your sodium target is set to the AHA’s 1,500&nbsp;mg ideal for people on blood-pressure meds, and potassium is set to “monitor” (not a floor) — ACE inhibitors like lisinopril can raise potassium. Confirm both targets with Dr.&nbsp;Lee.`;

  $('#loadSeedBtn').onclick=loadStarterPantry;
  $('#reconcileBtn').onclick=openReconcile;

  const kf=$('#usdaKeyField');
  kf.innerHTML=`<label>USDA food-search API key
    <input id="usdaKeyInput" type="text" spellcheck="false" value="${esc(state.usdaKey||'')}" placeholder="DEMO_KEY"></label>`;
  $('#usdaKeyInput').onchange=e=>{ state.usdaKey=e.target.value.trim()||'DEMO_KEY'; save(); toast('Key saved'); };

  $('#version').textContent='Diet Dash '+VERSION;
}

function render(){
  if(currentTab==='today') renderToday();
  else if(currentTab==='week') renderWeek();
  else if(currentTab==='pantry') renderPantry($('#pantrySearch').value||'');
  else if(currentTab==='settings') renderSettings();
  $('#dayLabel').textContent=fmtDay(viewDate);
  $('#dayNav').style.visibility = currentTab==='today' ? 'visible':'hidden';
}

/* ---------- tab + day nav ---------- */
$$('.tab').forEach(b=>b.onclick=()=>{
  currentTab=b.dataset.view;
  $$('.tab').forEach(x=>x.classList.toggle('active',x===b));
  $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+currentTab));
  render();
});
$('#prevDay').onclick=()=>{ viewDate.setDate(viewDate.getDate()-1); render(); };
$('#nextDay').onclick=()=>{ const t=startOfDay(new Date()); if(dayKey(viewDate)!==dayKey(t)){ viewDate.setDate(viewDate.getDate()+1); render(); } };
$('#dayLabel').onclick=()=>{ viewDate=startOfDay(new Date()); render(); };

/* ---------- sheet ---------- */
function openSheet(html){ $('#sheetBody').innerHTML=html; $('#sheet').hidden=false; }
function closeSheet(){ $('#sheet').hidden=true; $('#sheetBody').innerHTML=''; }
$('#sheet').addEventListener('click', e=>{ if(e.target.dataset.close!==undefined) closeSheet(); });

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 1800); }

/* ---------- ADD FOOD FLOW ---------- */
$('#addFromToday').onclick=openAddFlow;
$('#newFoodBtn').onclick=()=>openFoodEditor(null);

function openAddFlow(){
  openSheet(`
    <h2>Add food</h2>
    ${state.pantry.length?`<div class="field"><label>From your pantry</label>
      <input id="quickPantry" type="search" placeholder="Type a staple you’ve saved…"></div>
      <ul class="results" id="pantryQuick"></ul>`:''}
    <div class="field"><label>Search food database (USDA)</label>
      <input id="offSearch" type="search" placeholder="e.g. Kirkland almonds, HEB rotisserie chicken…" autofocus></div>
    <ul class="results" id="offResults"></ul>
    <div class="field"><label>Or scan / type a barcode (UPC)</label>
      <button id="scanBtn" class="scan-cta">📷 Scan a barcode</button>
      <div class="barcode-row">
        <input id="barcodeInput" type="tel" inputmode="numeric" placeholder="…or type the UPC digits">
        <button id="barcodeGo" class="pick">Go</button>
      </div>
      <div id="barcodeMsg" class="searching" hidden></div></div>
    <button class="linkbtn" id="manualNew">+ Enter a food manually</button>`);
  $('#manualNew').onclick=()=>openFoodEditor(null);
  $('#scanBtn').onclick=openScanner;

  const bc=$('#barcodeInput'), bmsg=$('#barcodeMsg');
  const doBarcode=()=>{ const code=(bc.value||'').replace(/\D/g,''); if(code.length<6){ bmsg.hidden=false; bmsg.textContent='Enter at least 6 digits.'; return; }
    bmsg.hidden=false; bmsg.textContent='Looking up…';
    fetchByBarcode(code).then(res=>{ if(res.food){ bmsg.hidden=true; openFoodEditor(res.food,true); }
      else bmsg.textContent=res.error+' Enter it manually below.'; }); };
  $('#barcodeGo').onclick=doBarcode;
  bc.addEventListener('keydown', e=>{ if(e.key==='Enter') doBarcode(); });

  const pq=$('#quickPantry');
  if(pq){ pq.oninput=()=>{
    const q=pq.value.toLowerCase();
    const box=$('#pantryQuick');
    if(!q){ box.innerHTML=''; return; }
    const hits=state.pantry.filter(p=>(p.name+' '+(p.brand||'')).toLowerCase().includes(q)).slice(0,8);
    box.innerHTML=hits.map(p=>resultRow(p.name,p.brand,`${Math.round(p.nutr.kcal||0)} cal · ${Math.round(p.nutr.sodium||0)}mg Na`,`pan:${p.id}`)).join('');
  }; }

  const os=$('#offSearch');
  let timer;
  os.oninput=()=>{ clearTimeout(timer); const q=os.value.trim();
    const box=$('#offResults');
    if(q.length<3){ box.innerHTML=''; return; }
    box.innerHTML=`<li class="searching">Searching…</li>`;
    timer=setTimeout(()=>usdaSearch(q, box), 350);
  };

  $('#sheetBody').addEventListener('click', e=>{
    const pick=e.target.closest('[data-pick]'); if(!pick) return;
    const v=pick.dataset.pick;
    if(v.startsWith('pan:')){ const p=state.pantry.find(x=>x.id===v.slice(4)); if(p) openLogEditor(p); }
    else if(v.startsWith('db:')){ const f=offCache[v.slice(3)]; if(f) openFoodEditor(f, true); }
  });
}

function resultRow(name,brand,sub,pick){
  return `<li class="result"><span class="mid"><div class="nm">${esc(name)}</div>
    <div class="sub">${brand?esc(brand)+' · ':''}${esc(sub)}</div></span>
    <button class="pick" data-pick="${pick}">Add</button></li>`;
}

/* ---------- food database lookups ----------
   Name search -> USDA FoodData Central (CORS-ok, free key).
   Barcode     -> Open Food Facts product API (CORS-ok, no key). */
const offCache={};

async function usdaFetchFoods(query, opts={}){
  const key=state.usdaKey||'DEMO_KEY';
  const types=opts.brandedOnly?'Branded':'Branded,Foundation,SR%20Legacy';
  const url=`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}`+
    `&dataType=${types}&pageSize=${opts.pageSize||20}&api_key=${encodeURIComponent(key)}`;
  const r=await fetch(url);
  if(r.status===429||r.status===403){ const e=new Error('rate'); e.rate=true; throw e; }
  if(!r.ok){ const e=new Error('http'); e.status=r.status; throw e; }
  const j=await r.json();
  return (j.foods||[]).map(usdaToFood).filter(Boolean);
}

async function usdaSearch(q, box){
  try{
    const foods=await usdaFetchFoods(q,{});
    if(!foods.length){ box.innerHTML=`<li class="searching">No matches. Try fewer words, a barcode, or enter it manually.</li>`; return; }
    box.innerHTML=foods.slice(0,15).map(f=>{
      offCache[f._k]=f;
      return resultRow(f.name, f.brand, `${Math.round(f.nutr.kcal||0)} cal · ${Math.round(f.nutr.sodium||0)}mg Na / ${f.serving}`, 'db:'+f._k);
    }).join('');
  }catch(e){
    if(e&&e.rate){ box.innerHTML=`<li class="searching">The shared demo key is rate-limited. Add your own free USDA key in Settings (takes 1 min).</li>`; return; }
    box.innerHTML=`<li class="searching">Lookup failed (${e&&e.status?e.status:'offline?'}). You can still enter it manually.</li>`;
  }
}

// USDA nutrient IDs -> our keys. Prefer added sugar (1235) over total sugar (2000).
const USDA_IDS={ kcal:[1008,2047,2048], protein:[1003], fat:[1004], satfat:[1258],
  fiber:[1079], sugar:[1235,2000], sodium:[1093], chol:[1253], potassium:[1092] };
function usdaToFood(f){
  const by={}; for(const n of (f.foodNutrients||[])) if(n.nutrientId!=null && by[n.nutrientId]==null) by[n.nutrientId]=n.value;
  const pick=ids=>{ for(const id of ids) if(by[id]!=null) return num(by[id]); return 0; };
  // Branded search values are per 100 g/ml; scale to the serving.
  const ss=num(f.servingSize);
  const unit=(f.servingSizeUnit||'').toLowerCase();
  const scale = (ss && (unit==='g'||unit==='ml')) ? ss/100 : 1;   // per-100 -> per-serving
  const per=k=>Math.round(pick(USDA_IDS[k])*scale*100)/100;
  const nutr=Object.fromEntries(NKEYS.map(k=>[k, per(k)]));
  if(!nutr.kcal && !nutr.protein && !nutr.sodium) return null;
  const serving = ss ? `${f.householdServingFullText?f.householdServingFullText+' ':''}(${rnd(ss)}${unit||'g'})`.trim()
    : (f.householdServingFullText || '100 g');
  return {
    _k:'usda'+f.fdcId, name:(f.description||'Food').replace(/\s+/g,' ').slice(0,80),
    brand:(f.brandName||f.brandOwner||'').split(',')[0].trim(),
    serving, src:'USDA', code:f.gtinUpc||null, verified:false, nutr,
  };
}

async function fetchByBarcode(code){
  try{
    const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`+
      `?fields=code,product_name,brands,serving_size,serving_quantity,nutriments,quantity`;
    const r=await fetch(url); const j=await r.json();
    if(j.status!==1 || !j.product || !j.product.product_name) return {error:'No product found for that barcode.', code};
    const f=offToFood(j.product);
    if(!f) return {error:'Found the product but no nutrition data.', code};
    return {food:f};
  }catch(e){ return {error:'Barcode lookup failed (offline?).', code}; }
}

/* ---------- camera barcode scanner ----------
   Native BarcodeDetector where present (Android/desktop Chrome); ZXing fallback
   for iOS Safari. UPC-A/UPC-E/EAN-13/EAN-8 (grocery formats) only, for speed. */
let scan=null, scanBusy=false;
function ensureZXing(){
  return new Promise(resolve=>{
    if(window.ZXing) return resolve(true);
    const s=document.createElement('script'); s.src='vendor/zxing.min.js';
    s.onload=()=>resolve(!!window.ZXing); s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
}
async function openScanner(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('No camera available — type the barcode'); return; }
  scanBusy=false;
  const ov=el('div','scanner-wrap');
  ov.innerHTML=`
    <video id="scanVideo" playsinline autoplay muted></video>
    <div class="scan-frame"><span class="scan-line"></span></div>
    <div class="scan-hint" id="scanHint">Line up the barcode inside the box</div>
    <button class="scan-close" id="scanClose">Cancel</button>`;
  document.body.appendChild(ov);
  scan={overlay:ov};
  $('#scanClose').onclick=closeScanner;
  const video=$('#scanVideo');
  const fmts=['upc_a','upc_e','ean_13','ean_8'];
  let detFormats=[];
  if('BarcodeDetector' in window){
    try{ const sup=await window.BarcodeDetector.getSupportedFormats();
      detFormats=fmts.filter(f=>sup.includes(f)); }catch(e){}
  }
  try{
    if(detFormats.length){
      scan.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
      video.srcObject=scan.stream; await video.play();
      scan.detector=new window.BarcodeDetector({formats:detFormats});
      const tick=async()=>{
        if(!scan) return;
        try{ const codes=await scan.detector.detect(video);
          if(codes && codes.length && codes[0].rawValue) return onScan(codes[0].rawValue);
        }catch(e){}
        scan.raf=requestAnimationFrame(tick);
      };
      tick();
    } else {
      const ok=await ensureZXing();
      if(!ok || !scan){ if(scan) $('#scanHint').textContent='Scanner unavailable — type the barcode instead'; return; }
      const hints=new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,
        [ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8]);
      scan.reader=new ZXing.BrowserMultiFormatReader(hints);
      scan.controls=await scan.reader.decodeFromConstraints(
        {video:{facingMode:{ideal:'environment'}}}, video,
        (result)=>{ if(result) onScan(result.getText()); });
    }
  }catch(e){
    closeScanner();
    toast(e && e.name==='NotAllowedError' ? 'Camera permission blocked — type the barcode' : 'Camera unavailable — type the barcode');
  }
}
function closeScanner(){
  if(!scan) return;
  const s=scan; scan=null;
  try{ if(s.raf) cancelAnimationFrame(s.raf); }catch(e){}
  try{ if(s.controls && s.controls.stop) s.controls.stop(); }catch(e){}
  try{ if(s.reader && s.reader.reset) s.reader.reset(); }catch(e){}
  try{ if(s.stream) s.stream.getTracks().forEach(t=>t.stop()); }catch(e){}
  try{ s.overlay.remove(); }catch(e){}
}
async function onScan(raw){
  if(scanBusy) return; scanBusy=true;
  const code=String(raw||'').replace(/\D/g,'');
  closeScanner();
  if(navigator.vibrate) try{ navigator.vibrate(60); }catch(e){}
  if(code.length<6){ scanBusy=false; toast('Could not read that barcode'); return; }
  toast('Scanned '+code);
  const res=await fetchByBarcode(code);
  if(res.food){ openFoodEditor(res.food, true); }
  else {
    toast(res.error+' Enter it manually.');
    openFoodEditor({ name:'', brand:'', serving:'1 serving', src:'manual', code,
      nutr:Object.fromEntries(NKEYS.map(k=>[k,0])) }, false);
  }
  scanBusy=false;
}

// Convert an OFF product to our per-serving food object.
function offToFood(p){
  const n=p.nutriments||{};
  // prefer per-serving values; else derive from per-100g × servingQty
  const sq = num(p.serving_quantity);   // grams per serving, if given
  const hasServing = n['energy-kcal_serving']!=null || n['proteins_serving']!=null;
  const per = (baseServ, base100) => {
    if(hasServing && n[baseServ]!=null) return num(n[baseServ]);
    if(n[base100]!=null && sq) return num(n[base100])*sq/100;
    if(n[base100]!=null) return num(n[base100]); // fall back to per-100g as the serving
    return 0;
  };
  const nutr={
    kcal:   per('energy-kcal_serving','energy-kcal_100g'),
    protein:per('proteins_serving','proteins_100g'),
    sugar:  per('sugars_serving','sugars_100g'),
    fiber:  per('fiber_serving','fiber_100g'),
    fat:    per('fat_serving','fat_100g'),
    satfat: per('saturated-fat_serving','saturated-fat_100g'),
    // OFF sodium is in grams -> mg. cholesterol/potassium likewise in g.
    sodium:   per('sodium_serving','sodium_100g')*1000,
    chol:     per('cholesterol_serving','cholesterol_100g')*1000,
    potassium:per('potassium_serving','potassium_100g')*1000,
  };
  if(!nutr.kcal && !nutr.protein && !nutr.sodium) return null;
  let serving = p.serving_size || (sq? sq+' g' : (p.quantity||'1 serving'));
  return {
    _k: p.code || uid(),
    name: p.product_name.slice(0,80),
    brand: (p.brands||'').split(',')[0].trim(),
    serving, src:'openfoodfacts', code:p.code, verified:false,
    nutr: Object.fromEntries(Object.entries(nutr).map(([k,v])=>[k, Math.round(v*100)/100])),
  };
}
const num=v=>{ const x=parseFloat(v); return isFinite(x)?x:0; };

/* ---------- FOOD EDITOR (create/verify a pantry item) ---------- */
function openFoodEditor(food, fromSearch){
  const f = food || { name:'', brand:'', serving:'1 serving', src:'manual', verified:false,
    nutr:Object.fromEntries(NKEYS.map(k=>[k,0])) };
  const fields = NUTRIENTS.map(n=>`
    <div class="field"><label>${esc(n.name)}${n.unit?' ('+n.unit+')':''} / serving</label>
      <input type="number" inputmode="decimal" step="any" data-n="${n.key}" value="${f.nutr[n.key]||0}"></div>`).join('');
  openSheet(`
    <h2>${food?'Confirm food':'New food'}</h2>
    ${fromSearch?`<p class="note">From Open Food Facts. <b>Check these against the physical label</b> the first time — community data can be off. Then save it verified.</p>`:''}
    <div class="field"><label>Name</label><input id="fName" value="${esc(f.name)}" placeholder="e.g. Kirkland Rotisserie Chicken"></div>
    <div class="row2">
      <div class="field"><label>Brand</label><input id="fBrand" value="${esc(f.brand||'')}"></div>
      <div class="field"><label>Serving size</label><input id="fServing" value="${esc(f.serving||'')}" placeholder="e.g. 3 oz (85g)"></div>
    </div>
    <div class="row2">${fields}</div>
    <button class="primary" id="saveFood">${food?'Save to pantry & log it':'Save to pantry'}</button>
    <button class="linkbtn" id="saveOnly">Save to pantry only</button>`);

  function collect(){
    const nutr=Object.fromEntries(NKEYS.map(k=>[k, num($(`[data-n="${k}"]`).value)]));
    return { id:f.id||uid(), name:$('#fName').value.trim()||'Unnamed food',
      brand:$('#fBrand').value.trim(), serving:$('#fServing').value.trim()||'1 serving',
      src:f.src||'manual', code:f.code, verified:true, nutr };
  }
  const upsert=(item)=>{ const i=state.pantry.findIndex(p=>p.id===item.id || (item.code && p.code===item.code));
    if(i>=0) state.pantry[i]=item; else state.pantry.push(item); save(); return item; };

  $('#saveFood').onclick=()=>{ const item=upsert(collect());
    if(food || fromSearch){ openLogEditor(item); } else { closeSheet(); toast('Saved to pantry'); render(); } };
  $('#saveOnly').onclick=()=>{ upsert(collect()); closeSheet(); toast('Saved to pantry'); render(); };
}

/* ---------- LOG EDITOR (choose qty + time) ---------- */
function openLogEditor(food, existing){
  const now=existing? new Date(existing.ts) : new Date();
  const qty=existing? existing.qty : 1;
  const timeVal=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dateVal=dayKey(existing?new Date(existing.ts):viewDate);
  openSheet(`
    <h2>${esc(food.name)}</h2>
    <p class="note">${esc(food.serving||'1 serving')} · ${Math.round(food.nutr.kcal||0)} cal · ${Math.round(food.nutr.sodium||0)}mg sodium per serving</p>
    <div class="field"><label>Servings</label>
      <input id="qty" type="number" inputmode="decimal" step="any" value="${qty}">
      <div class="qty-steppers">
        ${[0.5,1,1.5,2,3].map(v=>`<button data-q="${v}">${v}×</button>`).join('')}
      </div></div>
    <div class="row2">
      <div class="field"><label>Date</label><input id="lDate" type="date" value="${dateVal}"></div>
      <div class="field"><label>Time</label><input id="lTime" type="time" value="${timeVal}"></div>
    </div>
    <div class="nutro-preview" id="preview"></div>
    <button class="primary" id="logIt">${existing?'Update entry':'Log it'}</button>
    ${existing?`<button class="delbtn" id="delIt">Delete entry</button>`:''}`);

  const updatePreview=()=>{
    const q=num($('#qty').value)||1;
    $('#preview').innerHTML=['kcal','sodium','protein'].map(k=>{
      const n=NUTRIENTS.find(x=>x.key===k);
      return `<div class="np"><div class="n">${n.name}</div><div class="v">${rnd((food.nutr[k]||0)*q,k)}${n.unit}</div></div>`;
    }).join('');
  };
  $('#qty').oninput=updatePreview; updatePreview();
  $$('.qty-steppers button').forEach(b=>b.onclick=()=>{ $('#qty').value=b.dataset.q;
    $$('.qty-steppers button').forEach(x=>x.classList.toggle('on',x===b)); updatePreview(); });

  $('#logIt').onclick=()=>{
    const q=num($('#qty').value)||1;
    const [Y,M,D]=$('#lDate').value.split('-').map(Number);
    const [h,m]=$('#lTime').value.split(':').map(Number);
    const ts=new Date(Y,M-1,D,h,m).getTime();
    if(existing){ Object.assign(existing,{qty:q,ts,name:food.name,brand:food.brand,nutr:food.nutr}); }
    else { state.log.push({ id:uid(), foodId:food.id, name:food.name, brand:food.brand, ts, qty:q,
      nutr:{...food.nutr} }); }
    save(); closeSheet();
    viewDate=startOfDay(new Date(ts)); currentTab='today';
    $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='today'));
    $$('.view').forEach(v=>v.classList.toggle('active',v.id==='view-today'));
    render(); toast(existing?'Entry updated':'Logged');
  };
  if(existing) $('#delIt').onclick=()=>{ state.log=state.log.filter(e=>e.id!==existing.id); save(); closeSheet(); render(); toast('Deleted'); };
}

/* ---------- list interactions ---------- */
$('#logList').addEventListener('click', e=>{
  const li=e.target.closest('[data-log]'); if(!li) return;
  const entry=state.log.find(x=>x.id===li.dataset.log); if(!entry) return;
  openLogEditor({ name:entry.name, brand:entry.brand, serving:'1 serving', nutr:entry.nutr }, entry);
});
$('#pantryList').addEventListener('click', e=>{
  const logBtn=e.target.closest('[data-logfood]');
  if(logBtn){ const p=state.pantry.find(x=>x.id===logBtn.dataset.logfood); if(p) openLogEditor(p); return; }
  const item=e.target.closest('[data-food]');
  if(item){ const p=state.pantry.find(x=>x.id===item.dataset.food); if(p) openFoodEditor(p); }
});
$('#pantrySearch').oninput=e=>renderPantry(e.target.value);

/* ---------- starter pantry ---------- */
async function loadStarterPantry(){
  try{
    const r=await fetch('pantry-seed.json'); const j=await r.json();
    const have=new Set(state.pantry.map(p=>(p.name||'').toLowerCase().trim()));
    let added=0;
    for(const f of (j.foods||[])){
      const nm=(f.name||'').toLowerCase().trim();
      if(!nm || have.has(nm)) continue;
      const nutr=Object.fromEntries(NKEYS.map(k=>[k, num((f.nutr||{})[k])]));
      state.pantry.push({ id:uid(), name:f.name, brand:f.brand||'', serving:f.serving||'1 serving',
        src:f.src||'seed', code:f.code||null, verified:!!f.verified, nutr });
      have.add(nm); added++;
    }
    save(); render();
    toast(added? `Added ${added} foods to pantry` : 'Pantry already up to date');
  }catch(e){ toast('Could not load starter pantry'); }
}

/* ---------- reconcile: match estimates to real branded SKUs ("Did you mean?") ---------- */
function storeTokens(brand){
  const b=(brand||'').toLowerCase();
  if(b.includes('kirkland')||b.includes('costco')) return ['kirkland','costco'];
  if(b.includes('heb')||b.includes('h-e-b')||b.includes('h e b')) return ['h-e-b','h e butt','heb'];
  return [];
}
function brandScore(food, tokens){
  const b=(food.brand||'').toLowerCase();
  if(tokens.length && tokens.some(t=>b.includes(t))) return 3;          // matches THIS item's store
  if(/kirkland|h-e-b|h e butt|costco/.test(b)) return 2;                // any HEB/Costco SKU
  if(b) return 1;                                                        // some other brand
  return 0;
}
// Reduce a pantry name to its core food words so USDA relevance isn't hijacked by
// qualifiers ("aged 90 day", "boneless skinless", numbers, parentheticals).
const RECON_STOP=/\b(aged|day|days|replacement|refill|unsalted|organic|precooked|boneless|skinless|brewed|low|sodium|full|fat|for|with|the)\b/gi;
function cleanQuery(name){
  let s=(name||'').replace(/\(.*?\)/g,' ')     // drop parentheticals
    .replace(/[0-9]+([\/.][0-9]+)?/g,' ')       // drop numbers / 80/20 / 90
    .replace(RECON_STOP,' ')
    .replace(/\s+/g,' ').trim();
  const words=s.split(' ').filter(Boolean).slice(0,3).join(' ');
  return words || name;
}

let rec=null;
function openReconcile(){
  const items=state.pantry.filter(p=>!p.verified);
  if(!items.length){ toast('All items already verified'); return; }
  rec={ids:items.map(p=>p.id), idx:0, cache:{}, current:[]};
  showReconcile();
}
async function showReconcile(){
  if(!rec) return;
  if(rec.idx>=rec.ids.length){ closeSheet(); render(); toast('Done matching'); return; }
  const id=rec.ids[rec.idx];
  const item=state.pantry.find(p=>p.id===id);
  if(!item){ rec.idx++; return showReconcile(); }
  const est=`${esc(item.serving)} · ${Math.round(item.nutr.kcal)} cal · ${Math.round(item.nutr.sodium)}mg Na · ${rnd(item.nutr.protein,'protein')}g protein`;
  openSheet(`
    <div class="rec-head"><span>Match ${rec.idx+1} of ${rec.ids.length}</span>
      <button class="linkbtn" id="recDone" style="width:auto;padding:6px 12px">Done</button></div>
    <h2>${esc(item.name)}</h2>
    <p class="note">Your estimate: ${est}</p>
    <ul class="results" id="recCands"><li class="searching">Finding real HEB / Costco products…</li></ul>
    <div class="rec-actions">
      <button class="ghost-btn" id="recKeep">Keep estimate</button>
      <button class="ghost-btn" id="recSkip">Skip →</button>
    </div>`);
  $('#recDone').onclick=()=>{ rec=null; closeSheet(); render(); };
  $('#recKeep').onclick=()=>{ rec.idx++; showReconcile(); };
  $('#recSkip').onclick=()=>{ rec.idx++; showReconcile(); };

  const box=$('#recCands');
  let foods;
  try{ foods = rec.cache[id] || (rec.cache[id]=await usdaFetchFoods(cleanQuery(item.name),{brandedOnly:true,pageSize:15})); }
  catch(e){
    box.innerHTML = (e&&e.rate)
      ? `<li class="searching">Rate-limited by the shared demo key. Add your own free USDA key in Settings, then reopen this.</li>`
      : `<li class="searching">Lookup failed. Keep your estimate or skip.</li>`;
    return;
  }
  const tokens=storeTokens(item.brand);
  foods=[...foods].sort((a,b)=>brandScore(b,tokens)-brandScore(a,tokens));
  rec.current=foods;
  if(!foods.length){ box.innerHTML=`<li class="searching">No branded match found — keep your estimate.</li>`; }
  else{
    box.innerHTML=foods.slice(0,6).map((f,i)=>{
      const strong=brandScore(f,tokens)>=2;
      const tag=f.brand?`<span class="src ${strong?'verified':''}">${esc(f.brand)}</span>`:'';
      return `<li class="result"><span class="mid"><div class="nm">${esc(f.name)} ${tag}</div>
        <div class="sub">${esc(f.serving)} · ${Math.round(f.nutr.kcal||0)} cal · ${Math.round(f.nutr.sodium||0)}mg Na · ${rnd(f.nutr.protein,'protein')}g protein</div></span>
        <button class="pick" data-adopt="${i}">Use</button></li>`;
    }).join('');
    $$('#recCands [data-adopt]').forEach(btn=>btn.onclick=()=>adoptMatch(item, rec.current[+btn.dataset.adopt]));
  }
  // prefetch next item's candidates for speed
  const nid=rec.ids[rec.idx+1];
  if(nid && !rec.cache[nid]){ const nitem=state.pantry.find(p=>p.id===nid);
    if(nitem) usdaFetchFoods(cleanQuery(nitem.name),{brandedOnly:true,pageSize:15}).then(fs=>{rec.cache[nid]=fs;}).catch(()=>{}); }
}
function adoptMatch(item, food){
  if(!food){ return; }
  item.brand=food.brand||item.brand;
  item.serving=food.serving;
  item.src=food.src||'USDA';
  item.code=food.code||item.code;
  item.nutr={...food.nutr};
  item.verified=true;
  save();
  rec.idx++;
  toast('Matched ✓');
  showReconcile();
}

/* ---------- import / export ---------- */
$('#exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=el('a'); a.href=URL.createObjectURL(blob);
  a.download=`diet-dash-${dayKey(new Date())}.json`; a.click(); URL.revokeObjectURL(a.href);
};
$('#importBtn').onclick=()=>$('#importFile').click();
$('#importFile').onchange=e=>{
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=()=>{ try{ const raw=JSON.parse(r.result);
    state={ pantry:raw.pantry||[], log:raw.log||[],
      targets:Object.assign(defaultState().targets, raw.targets||{}),
      window:Object.assign(defaultState().window, raw.window||{}) };
    save(); render(); toast('Imported'); }
    catch(err){ toast('Bad file'); } };
  r.readAsText(file);
};

/* ---------- boot ---------- */
render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
