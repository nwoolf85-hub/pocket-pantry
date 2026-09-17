/* Diet Dash — personal nutrition tracker. All data local (localStorage).
   Food lookups via Open Food Facts (no key). */
'use strict';

const VERSION = 'v1.3.0';
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
  meals: [],            // {id,name,emoji,components:[{name,brand,serving,qty,nutr}],createdAt}
  log: [],              // {id,foodId,name,brand,ts,qty,nutr, isMeal?,components?,emoji?}
  targets: Object.fromEntries(NUTRIENTS.map(n=>[n.key,n.dflt])),
  window: { start: 12, len: 8 },   // 8-hour window starting noon
  usdaKey: 'DEMO_KEY',             // free key from fdc.nal.usda.gov/api-key-signup
  shop: { trip: [], checked: {} }, // shopping trip: meal ids + checked items
});

let state = load();
let viewDate = startOfDay(new Date());   // which day the Today view shows
let currentTab = 'today';
let pantryMode = 'foods';                // 'foods' | 'meals' (Pantry tab toggle)
let shopMode = 'list';                   // 'list' | 'ideas' (Shop tab toggle)

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS));
    if(!raw) return defaultState();
    const d = defaultState();
    return {
      pantry: raw.pantry||[], meals: raw.meals||[], log: raw.log||[],
      targets: Object.assign(d.targets, raw.targets||{}),
      window: Object.assign(d.window, raw.window||{}),
      usdaKey: raw.usdaKey || d.usdaKey,
      shop: Object.assign(d.shop, raw.shop||{}),
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
/* ---------- meals ---------- */
function mealTotals(meal){
  const t=Object.fromEntries(NKEYS.map(k=>[k,0]));
  for(const c of (meal.components||[])) for(const k of NKEYS) t[k]+=(c.nutr[k]||0)*(c.qty||1);
  return Object.fromEntries(NKEYS.map(k=>[k, Math.round(t[k]*100)/100]));
}
// Present a meal as a "food" so it flows through the log editor unchanged.
function mealAsFood(meal){
  return { id:meal.id, name:meal.name, brand:'Meal', serving:'1 serving',
    nutr:mealTotals(meal), isMeal:true, components:meal.components, emoji:meal.emoji };
}
// pretty fractions for portions
function fmtQty(q){
  const fr=[[0.25,'¼'],[0.333,'⅓'],[0.5,'½'],[0.667,'⅔'],[0.75,'¾']];
  for(const [v,s] of fr){ if(Math.abs(q-v)<0.02) return s; if(Math.abs(q-(1+v))<0.02) return '1'+s; }
  return String(Math.round(q*100)/100);
}
// snap a portion up/down through a set of friendly values
function stepQty(q,dir){
  const steps=[0.25,0.333,0.5,0.667,0.75,1,1.5,2,3,4];
  let idx=0,best=1e9; steps.forEach((v,i)=>{const d=Math.abs(v-q); if(d<best){best=d;idx=i;}});
  return steps[Math.max(0,Math.min(steps.length-1, idx+dir))];
}

// Recent + frequent, one-tap. Meals first (always shown), then foods by count/recency.
function quickAddItems(){
  const out=[], seen=new Set();
  for(const m of state.meals){ const k='m:'+m.name.toLowerCase(); if(seen.has(k))continue; seen.add(k);
    out.push({name:m.name, emoji:m.emoji, isMeal:true, mealId:m.id, nutr:mealTotals(m)}); }
  const byName={};
  for(const e of state.log){ if(e.isMeal) continue; const k=e.name.toLowerCase();
    if(!byName[k]) byName[k]={name:e.name, brand:e.brand, last:e.ts, count:0, nutr:e.nutr};
    byName[k].count++; if(e.ts>=byName[k].last){ byName[k].last=e.ts; byName[k].nutr=e.nutr; } }
  Object.values(byName).sort((a,b)=> b.count-a.count || b.last-a.last).forEach(f=>{
    const k='f:'+f.name.toLowerCase(); if(seen.has(k)||out.length>=10) return; seen.add(k);
    out.push({name:f.name, brand:f.brand, isMeal:false, nutr:f.nutr}); });
  return out.slice(0,10);
}
function logQuick(item){
  let nutr, components, name=item.name, isMeal=item.isMeal, emoji=item.emoji;
  if(item.mealId){ const m=state.meals.find(x=>x.id===item.mealId);
    if(m){ nutr=mealTotals(m); components=m.components.map(c=>({...c})); name=m.name; isMeal=true; emoji=m.emoji; } }
  if(!nutr) nutr={...item.nutr};
  const ts=Date.now();
  const entry={ id:uid(), name, brand:item.brand||'', ts, qty:1, nutr, isMeal:!!isMeal, components, emoji };
  state.log.push(entry); save();
  viewDate=startOfDay(new Date(ts));
  render();
  toastUndo('Logged '+name, ()=>{ state.log=state.log.filter(e=>e.id!==entry.id); save(); render(); });
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

let qaCache=[];
function renderQuickAdd(){
  const box=$('#quickAdd'); if(!box) return;
  qaCache=quickAddItems();
  if(!qaCache.length || dayKey(viewDate)!==dayKey(new Date())){ box.hidden=true; box.innerHTML=''; return; }
  box.hidden=false;
  box.innerHTML=`<div class="qa-label">Quick add</div>
    <div class="qa-row">${qaCache.map((it,i)=>`
      <button class="qa-chip ${it.isMeal?'meal':''}" data-qa="${i}">
        <span class="qa-nm">${it.emoji?it.emoji+' ':''}${esc(it.name)}</span>
        <span class="qa-cal">${Math.round(it.nutr.kcal||0)} cal${it.isMeal?' · meal':''}</span></button>`).join('')}</div>`;
}

function renderToday(){
  renderQuickAdd();
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
    const qlabel = e.qty!==1 ? fmtQty(e.qty)+'× · ' : '';
    const sub = e.isMeal
      ? `${qlabel}${sod}mg sodium${e.components?' · '+e.components.length+' ingredients':''}`
      : `${qlabel}${sod}mg sodium${e.brand?' · '+esc(e.brand):''}`;
    const caret = (e.isMeal && e.components) ? `<button class="li-caret" data-expand="${e.id}">▸</button>` : '';
    const breakdown = (e.isMeal && e.components) ? `<div class="li-breakdown" id="bd-${e.id}" hidden>${
      e.components.map(c=>`<div class="bd-row"><span>${fmtQty((c.qty||1)*e.qty)}× ${esc(c.name)}</span><span>${Math.round((c.nutr.kcal||0)*(c.qty||1)*e.qty)} cal</span></div>`).join('')}</div>` : '';
    return `<li class="logitem ${inWindow(e.ts)?'':'out'} ${e.isMeal?'ismeal':''}">
      <div class="li-main" data-log="${e.id}">
        <span class="time">${fmtTime(e.ts)}</span>
        <span class="mid"><div class="nm">${e.emoji?e.emoji+' ':''}${esc(e.name)}${e.isMeal?' <span class="meal-chip">meal</span>':''}</div>
          <div class="sub">${sub}</div></span>
        <span class="kcal">${kcal}</span>${caret}</div>
      ${breakdown}</li>`;
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
  const seg=$('#pantrySeg');
  if(seg){
    seg.innerHTML=`<button class="seg-btn ${pantryMode==='foods'?'on':''}" data-mode="foods">Foods</button>
      <button class="seg-btn ${pantryMode==='meals'?'on':''}" data-mode="meals">Meals${state.meals.length?' ('+state.meals.length+')':''}</button>`;
    $$('#pantrySeg [data-mode]').forEach(b=>b.onclick=()=>{ pantryMode=b.dataset.mode; renderPantry($('#pantrySearch').value||''); });
  }
  const nb=$('#newFoodBtn'); if(nb) nb.textContent = pantryMode==='meals' ? '+ Meal' : '+ New';
  const ps=$('#pantrySearch'); if(ps) ps.placeholder = pantryMode==='meals' ? 'Search your meals…' : 'Search your pantry…';
  if(pantryMode==='meals') return renderMealsList(q);

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

function renderMealsList(q=''){
  const list=$('#pantryList'); const banner=$('#pantryBanner'); if(banner) banner.innerHTML='';
  if(!state.meals.length){ list.innerHTML=`<li class="empty">No meals yet.<br><br>
    <button class="chip-btn" id="emptyNewMeal">+ Build a meal</button><br><br>
    A meal is a saved combo (e.g. your breakfast bowl) you log in one tap.</li>`;
    const b=$('#emptyNewMeal'); if(b) b.onclick=()=>openMealBuilder(null); return; }
  const meals=state.meals.filter(m=>!q || m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>a.name.localeCompare(b.name));
  if(!meals.length){ list.innerHTML=`<li class="empty">No matches.</li>`; return; }
  list.innerHTML=meals.map(m=>{ const t=mealTotals(m);
    return `<li class="pantryitem" data-meal="${m.id}">
      <span class="mid"><div class="nm">${m.emoji?m.emoji+' ':''}${esc(m.name)}</div>
        <div class="sub">${m.components.length} ingredients · ${Math.round(t.kcal)} cal · ${Math.round(t.sodium)}mg Na · ${rnd(t.protein,'protein')}g protein</div></span>
      <button class="log" data-logmeal="${m.id}">Log</button></li>`;
  }).join('');
}

/* ---------- MEAL BUILDER ---------- */
function openMealBuilder(meal){
  let comps = meal ? meal.components.map(c=>({...c, nutr:{...c.nutr}})) : [];
  openSheet(`
    <div class="rec-head"><span>${meal?'Edit meal':'New meal'}</span>
      ${meal?'<button class="linkbtn" id="mealDelete" style="width:auto;color:var(--over);padding:6px 12px">Delete</button>':''}</div>
    <div class="row2">
      <div class="field"><label>Meal name</label><input id="mealName" value="${esc(meal?meal.name:'')}" placeholder="e.g. Berry Protein Power Bowl"></div>
      <div class="field" style="max-width:84px"><label>Icon</label><input id="mealEmoji" value="${esc(meal?(meal.emoji||''):'')}" placeholder="🥣" maxlength="2"></div>
    </div>
    <div class="section-title" style="margin:10px 2px 6px"><span>Ingredients</span></div>
    <div id="mealComps"></div>
    <div class="field"><label>Add ingredient from your pantry</label>
      <input id="mealSearch" type="search" placeholder="Search a food you've saved…"></div>
    <ul class="results" id="mealAddResults"></ul>
    <div class="nutro-preview" id="mealTotals"></div>
    <button class="primary" id="mealSave">${meal?'Save changes':'Save meal'}</button>`);

  const paint=()=>{
    const box=$('#mealComps');
    if(!comps.length){ box.innerHTML=`<p class="note" style="margin:0 2px 8px">No ingredients yet — search below to add them.</p>`; }
    else box.innerHTML=comps.map((c,i)=>`
      <div class="mealcomp">
        <span class="mc-nm">${esc(c.name)}</span>
        <span class="mc-qty">
          <button data-cdec="${i}">−</button><b>${fmtQty(c.qty)}×</b><button data-cinc="${i}">+</button>
        </span>
        <span class="mc-cal">${Math.round((c.nutr.kcal||0)*c.qty)}</span>
        <button class="mc-del" data-crm="${i}" aria-label="Remove">✕</button>
      </div>`).join('');
    const t=Object.fromEntries(NKEYS.map(k=>[k,0]));
    for(const c of comps) for(const k of NKEYS) t[k]+=(c.nutr[k]||0)*c.qty;
    $('#mealTotals').innerHTML=['kcal','protein','fiber','sodium'].map(k=>{ const n=NUTRIENTS.find(x=>x.key===k);
      return `<div class="np"><div class="n">${n.name}</div><div class="v">${rnd(t[k],k)}${n.unit}</div></div>`; }).join('');
    $$('#mealComps [data-cinc]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.cinc; comps[i].qty=stepQty(comps[i].qty,1); paint(); });
    $$('#mealComps [data-cdec]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.cdec; comps[i].qty=stepQty(comps[i].qty,-1); paint(); });
    $$('#mealComps [data-crm]').forEach(b=>b.onclick=()=>{ comps.splice(+b.dataset.crm,1); paint(); });
  };
  paint();

  const ms=$('#mealSearch');
  ms.oninput=()=>{ const q=ms.value.toLowerCase().trim(); const box=$('#mealAddResults');
    if(!q){ box.innerHTML=''; return; }
    const hits=state.pantry.filter(p=>(p.name+' '+(p.brand||'')).toLowerCase().includes(q)).slice(0,8);
    box.innerHTML=hits.length? hits.map(p=>`<li class="result"><span class="mid"><div class="nm">${esc(p.name)}</div>
      <div class="sub">${esc(p.serving||'')} · ${Math.round(p.nutr.kcal||0)} cal</div></span>
      <button class="pick" data-addcomp="${p.id}">Add</button></li>`).join('')
      : `<li class="searching">No pantry match. Add it under Foods first.</li>`;
    $$('#mealAddResults [data-addcomp]').forEach(b=>b.onclick=()=>{ const p=state.pantry.find(x=>x.id===b.dataset.addcomp);
      if(p){ comps.push({ name:p.name, brand:p.brand||'', serving:p.serving||'1 serving', qty:1, nutr:{...p.nutr} });
        ms.value=''; box.innerHTML=''; paint(); ms.focus(); } });
  };

  $('#mealSave').onclick=()=>{
    const nm=$('#mealName').value.trim(); if(!nm){ toast('Name the meal first'); return; }
    if(!comps.length){ toast('Add at least one ingredient'); return; }
    const em=$('#mealEmoji').value.trim();
    if(meal){ meal.name=nm; meal.emoji=em; meal.components=comps; }
    else state.meals.push({ id:uid(), name:nm, emoji:em, components:comps, createdAt:Date.now() });
    save(); closeSheet(); pantryMode='meals'; render(); toast('Meal saved');
  };
  if(meal) $('#mealDelete').onclick=()=>{ state.meals=state.meals.filter(m=>m.id!==meal.id); save(); closeSheet(); render(); toast('Meal deleted'); };
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

/* ---------- SHOP tab: shopping list + ideas ---------- */
const STORES=['Costco','HEB'];
const shopKey=s=>s.toLowerCase().trim();

function renderShop(){
  const seg=$('#shopSeg');
  seg.innerHTML=`<button class="seg-btn ${shopMode==='list'?'on':''}" data-shopmode="list">Shopping list</button>
    <button class="seg-btn ${shopMode==='ideas'?'on':''}" data-shopmode="ideas">Ideas &amp; pairings</button>`;
  if(shopMode==='ideas') return renderIdeas();
  renderShopList();
}

function renderShopList(){
  const body=$('#shopBody');
  const meals=state.meals;
  const trip=state.shop.trip||[];
  const chips = meals.length ? `<div class="qa-label" style="margin-top:12px">Add recipes to your trip</div>
    <div class="qa-row" style="flex-wrap:wrap">${meals.map(m=>`
      <button class="qa-chip ${trip.includes(m.id)?'meal':''}" data-triptoggle="${m.id}">
        <span class="qa-nm">${m.emoji?m.emoji+' ':''}${esc(m.name)}</span>
        <span class="qa-cal">${trip.includes(m.id)?'✓ in list':'+ add'}</span></button>`).join('')}</div>`
    : `<p class="note">Build some meals first (Pantry → Meals) and they'll show up here to shop for.</p>`;

  // aggregate shopping items from selected meals
  const agg={};  // key -> {item, store, recipes:Set}
  for(const id of trip){
    const m=meals.find(x=>x.id===id); if(!m||!m.shopping) continue;
    for(const s of m.shopping){
      const k=shopKey(s.item);
      if(!agg[k]) agg[k]={item:s.item, store:STORES.includes(s.store)?s.store:'HEB', recipes:new Set()};
      agg[k].recipes.add(m.name);
    }
  }
  const all=Object.entries(agg);
  let listHtml='';
  if(!trip.length){
    listHtml=`<div class="empty">Tap a recipe above to start your list.</div>`;
  } else if(!all.length){
    listHtml=`<div class="empty">These recipes don't have shopping lists yet.</div>`;
  } else {
    for(const store of STORES){
      const items=all.filter(([k,v])=>v.store===store).sort((a,b)=>a[1].item.localeCompare(b[1].item));
      if(!items.length) continue;
      const done=items.filter(([k])=>state.shop.checked[k]).length;
      const allDone=done===items.length;
      listHtml+=`<div class="storegroup ${allDone?'alldone':''}">
        <div class="store-head"><span>${store}</span><span class="store-prog">${done}/${items.length}${allDone?' ✓':''}</span></div>
        ${allDone?`<div class="store-done">✓ Got everything at ${store}!</div>`:''}
        ${items.map(([k,v])=>`<label class="shopitem ${state.shop.checked[k]?'done':''}">
          <input type="checkbox" ${state.shop.checked[k]?'checked':''} data-check="${k}">
          <span class="si-name">${esc(v.item)}</span>
          ${v.recipes.size>1?`<span class="si-badge">${v.recipes.size} recipes</span>`:''}</label>`).join('')}
      </div>`;
    }
    listHtml+=`<div class="datarow" style="margin-top:14px">
      <button class="ghost-btn" data-clearchecked>Uncheck all</button>
      <button class="ghost-btn" data-cleartrip>New trip</button></div>`;
  }
  body.innerHTML=chips+listHtml;
}

const IDEAS=[
 {e:"🥬",t:"Serve your salads & proteins on",items:[
   "Butter or romaine lettuce cups — 0 carb, 0 sodium",
   "Cucumber rounds or celery sticks for crunch",
   "A halved avocado — scoop the salad right in",
   "Bell-pepper halves as edible bowls",
   "Siete grain-free tortillas or cheese crisps",
   "A bed of baby spinach or spring mix"]},
 {e:"🔁",t:"Low-carb swaps that still taste great",items:[
   "Bun → lettuce wrap or your keto bun",
   "Tortilla chips → Siete grain-free or cheese crisps",
   "Croutons → chopped walnuts or pecans",
   "Sugary dressing → olive oil + red wine vinegar, or Greek-yogurt ranch",
   "Soda / juice → sparkling water + lime, or a splash of Spindrift",
   "Rice or potato side → cauliflower rice or air-fried cauliflower"]},
 {e:"🌶️",t:"Flavor without the sodium",items:[
   "Tabasco (35mg/tsp) and fresh lime & lemon",
   "Smoked paprika, garlic powder, cumin, black pepper",
   "Fresh herbs — cilantro, dill, basil, green onion",
   "Jalapeño & red onion for bite",
   "Red wine or apple-cider vinegar for brightness",
   "Everything-but-the-salt seasoning"]},
 {e:"🍽️",t:"Mix-and-match combos from your pantry",items:[
   "Tuna or chicken salad + avocado + cucumber",
   "Hard-boiled eggs + avocado + hot sauce + smoked paprika",
   "Greek yogurt + berries + hemp & flax (your Power Bowl)",
   "Grass-fed sausage + sauerkraut + mustard + grilled peppers",
   "Steak or ground beef + blue cheese + sautéed mushrooms + asparagus",
   "Cottage cheese + cherry tomatoes + olive oil + black pepper"]},
 {e:"✅",t:"Best low-carb picks by group",items:[
   "Veg: leafy greens, cauliflower, broccoli, zucchini, cucumber, asparagus, peppers, avocado, olives, mushrooms",
   "Fruit: berries are best (straw / rasp / black); green apple in moderation; go easy on banana & grapes",
   "Nuts: walnuts, pecans, macadamia are lowest-carb; go lighter on cashews & pistachios",
   "Dairy: Greek yogurt, cheese, butter; keep milk modest (lactose = sugar)",
   "Fats: olive oil, avocado & avocado oil, butter — skip the seed oils"]},
];
function renderIdeas(){
  $('#shopBody').innerHTML=`
    <p class="note" style="margin-top:12px">Whole-food, lower-carb, lower-sugar, lower-sodium ideas to pair with what you already buy.</p>
    ${IDEAS.map(c=>`<div class="idea-card">
      <div class="idea-head">${c.e} ${esc(c.t)}</div>
      <ul class="idea-list">${c.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}
    <p class="note">Low-carb framework inspired by DietDoctor's visual guides — pairings tailored to your pantry.</p>`;
}

/* delegated Shop interactions */
$('#shopSeg').addEventListener('click', e=>{
  const b=e.target.closest('[data-shopmode]'); if(!b) return;
  shopMode=b.dataset.shopmode; renderShop();
});
$('#shopBody').addEventListener('click', e=>{
  const tt=e.target.closest('[data-triptoggle]');
  if(tt){ const id=tt.dataset.triptoggle; const i=state.shop.trip.indexOf(id);
    if(i>=0) state.shop.trip.splice(i,1); else state.shop.trip.push(id); save(); renderShopList(); return; }
  if(e.target.closest('[data-clearchecked]')){ state.shop.checked={}; save(); renderShopList(); return; }
  if(e.target.closest('[data-cleartrip]')){ state.shop.trip=[]; state.shop.checked={}; save(); renderShopList(); return; }
});
$('#shopBody').addEventListener('change', e=>{
  const cb=e.target.closest('[data-check]'); if(!cb) return;
  const k=cb.dataset.check;
  if(cb.checked) state.shop.checked[k]=true; else delete state.shop.checked[k];
  save();
  // update in place (no full re-render — keeps the list steady while shopping)
  const label=cb.closest('.shopitem'); if(label) label.classList.toggle('done', cb.checked);
  const group=cb.closest('.storegroup'); if(!group) return;
  const boxes=[...group.querySelectorAll('input[type=checkbox]')];
  const done=boxes.filter(b=>b.checked).length, tot=boxes.length, allDone=done===tot;
  group.classList.toggle('alldone', allDone);
  const prog=group.querySelector('.store-prog'); if(prog) prog.textContent=`${done}/${tot}${allDone?' ✓':''}`;
  let banner=group.querySelector('.store-done');
  const store=group.querySelector('.store-head span').textContent;
  if(allDone && !banner){ group.querySelector('.store-head').insertAdjacentHTML('afterend',`<div class="store-done">✓ Got everything at ${esc(store)}!</div>`); }
  else if(!allDone && banner){ banner.remove(); }
});

function render(){
  if(currentTab==='today') renderToday();
  else if(currentTab==='week') renderWeek();
  else if(currentTab==='pantry') renderPantry($('#pantrySearch').value||'');
  else if(currentTab==='shop') renderShop();
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

function toast(msg){ const t=$('#toast'); t.onclick=null; t.textContent=msg; t.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 1800); }
function toastUndo(msg, undoFn){
  const t=$('#toast'); t.innerHTML=esc(msg)+' · <b style="color:var(--gold)">Undo</b>'; t.hidden=false;
  t.onclick=()=>{ undoFn(); t.hidden=true; t.onclick=null; };
  clearTimeout(toast._t); toast._t=setTimeout(()=>{ t.hidden=true; t.onclick=null; }, 4200);
}

/* ---------- ADD FOOD FLOW ---------- */
$('#addFromToday').onclick=openAddFlow;
$('#newFoodBtn').onclick=()=>{ if(pantryMode==='meals') openMealBuilder(null); else openFoodEditor(null); };

function openAddFlow(){
  openSheet(`
    <h2>Add food</h2>
    ${state.meals.length?`<div class="section-title" style="margin:2px 2px 8px"><span>Your meals</span></div>
      <ul class="results" id="addMeals">${state.meals.map(m=>{ const t=mealTotals(m);
        return `<li class="result"><span class="mid"><div class="nm">${m.emoji?m.emoji+' ':''}${esc(m.name)}</div>
          <div class="sub">${m.components.length} ingredients · ${Math.round(t.kcal)} cal · ${Math.round(t.sodium)}mg Na</div></span>
          <button class="pick" data-mealadd="${m.id}">Log</button></li>`; }).join('')}</ul>`:''}
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
  $$('#addMeals [data-mealadd]').forEach(b=>b.onclick=()=>{ const m=state.meals.find(x=>x.id===b.dataset.mealadd); if(m) openLogEditor(mealAsFood(m)); });

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
      nutr:{...food.nutr}, isMeal:!!food.isMeal,
      components:food.components?food.components.map(c=>({...c})):undefined, emoji:food.emoji }); }
    save(); closeSheet();
    viewDate=startOfDay(new Date(ts)); currentTab='today';
    $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='today'));
    $$('.view').forEach(v=>v.classList.toggle('active',v.id==='view-today'));
    render(); toast(existing?'Entry updated':'Logged');
  };
  if(existing) $('#delIt').onclick=()=>{ state.log=state.log.filter(e=>e.id!==existing.id); save(); closeSheet(); render(); toast('Deleted'); };
}

/* ---------- list interactions ---------- */
$('#quickAdd').addEventListener('click', e=>{
  const c=e.target.closest('[data-qa]'); if(!c) return;
  const it=qaCache[+c.dataset.qa]; if(it) logQuick(it);
});
$('#logList').addEventListener('click', e=>{
  const cx=e.target.closest('[data-expand]');
  if(cx){ const bd=$('#bd-'+cx.dataset.expand); if(bd){ bd.hidden=!bd.hidden; cx.textContent=bd.hidden?'▸':'▾'; } return; }
  const li=e.target.closest('[data-log]'); if(!li) return;
  const entry=state.log.find(x=>x.id===li.dataset.log); if(!entry) return;
  openLogEditor({ name:entry.name, brand:entry.brand, serving:'1 serving', nutr:entry.nutr,
    isMeal:entry.isMeal, components:entry.components, emoji:entry.emoji }, entry);
});
$('#pantryList').addEventListener('click', e=>{
  const logMeal=e.target.closest('[data-logmeal]');
  if(logMeal){ const m=state.meals.find(x=>x.id===logMeal.dataset.logmeal); if(m) openLogEditor(mealAsFood(m)); return; }
  const mealItem=e.target.closest('[data-meal]');
  if(mealItem){ const m=state.meals.find(x=>x.id===mealItem.dataset.meal); if(m) openMealBuilder(m); return; }
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
    // seed meals (and retire any legacy flat "recipe" pantry item they supersede)
    let addedM=0;
    if(Array.isArray(j.meals) && j.meals.length){
      state.pantry=state.pantry.filter(p=>p.src!=='recipe');
      const haveM=new Set(state.meals.map(m=>(m.name||'').toLowerCase().trim()));
      for(const m of j.meals){
        const nm=(m.name||'').toLowerCase().trim(); if(!nm || haveM.has(nm)) continue;
        const comps=(m.components||[]).map(c=>({ name:c.name, brand:c.brand||'', serving:c.serving||'1 serving',
          qty:num(c.qty)||1, nutr:Object.fromEntries(NKEYS.map(k=>[k, num((c.nutr||{})[k])])) }));
        const shopping=Array.isArray(m.shopping)? m.shopping.map(s=>({item:s.item, store:s.store})) : undefined;
        state.meals.push({ id:uid(), name:m.name, emoji:m.emoji||'', components:comps, shopping, createdAt:Date.now() });
        haveM.add(nm); addedM++;
      }
    }
    save(); render();
    const parts=[]; if(added) parts.push(`${added} foods`); if(addedM) parts.push(`${addedM} meal${addedM>1?'s':''}`);
    toast(parts.length? 'Added '+parts.join(' + ') : 'Pantry already up to date');
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
    state={ pantry:raw.pantry||[], meals:raw.meals||[], log:raw.log||[],
      targets:Object.assign(defaultState().targets, raw.targets||{}),
      window:Object.assign(defaultState().window, raw.window||{}), usdaKey:raw.usdaKey||'DEMO_KEY',
      shop:Object.assign(defaultState().shop, raw.shop||{}) };
    save(); render(); toast('Imported'); }
    catch(err){ toast('Bad file'); } };
  r.readAsText(file);
};

/* ---------- boot ---------- */
render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
