(() => {
const HOME={lat:39.084,lon:-77.153,label:"Rockville"};
const SYNC_EVERY=30*60*1000, NEW_FOR=7*24*3600*1000, PAGE=150;
// Maryland's bounding box cut into a 6 x 8 grid so each map request stays small.
const TILES=[]; {const S=37.88,N=39.73,W=-79.49,E=-75.04,R=6,C=8;
  for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=S+(N-S)*r/R,n=S+(N-S)*(r+1)/R,w=W+(E-W)*c/C,e=W+(E-W)*(c+1)/C;TILES.push({id:`tile-${r}-${c}`,bb:[s,w,n,e].map(x=>+x.toFixed(4))})}}

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};

let authed=false;
const myName=()=>(ls.get("cs.name")||"").trim();
let tiles=new Map(), done=new Map(), ready=false;
let view="todo", sort=ls.get("cs.sort")||"near", phoneOnly=ls.get("cs.phone")==="1", q="", shown=PAGE;
let syncing=false, lastErr="", paused=false;

/* ---------- business leads (additive; the restaurant flow above is untouched) ---------- */
let mode="restaurants";
let leads=[], leadsDone=new Map(), leadsLoaded=false;
let lq="", lcat="", lcounty="", lstatus="", lsort="score", lview="todo";
const expandedLeads=new Set();
const leaving=new Set();

/* ---------- helpers ---------- */
function miles(a,b){const R=3958.8,t=Math.PI/180,dl=(b.lat-a.lat)*t,dn=(b.lon-a.lon)*t;const x=Math.sin(dl/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function ago(t){if(!t)return"never";const m=Math.round((Date.now()-t)/60000);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" hr ago";return Math.round(h/24)+" days ago"}
function fmtPhone(p){const d=String(p).replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"");return d.length===10?`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`:p}
function cuisine(k){return k?k.split(";")[0].replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()):""}

/* OpenStreetMap sometimes lists one restaurant twice (a pin plus a building outline,
   or two pins). Treat same-name places within 150 m, or one name inside the other
   within 40 m, as one restaurant, and keep the copy with more details. */
const nkey=n=>String(n||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]/g,"");
const richness=it=>(it.a?1:0)+(it.c?1:0)+(it.p?2:0)+(it.k?1:0);
function meters(a,b){ if(!a.la||!b.la) return (a.a&&a.a===b.a&&a.c===b.c)?0:1e9; return Math.hypot((a.la-b.la)*111000,(a.lo-b.lo)*86000); }
function twinIndex(){
  const byName=new Map(), byCell=new Map();
  const cell=it=>it.la?`${Math.round(it.la*400)},${Math.round(it.lo*400)}`:"";
  return {
    find(it){
      const k=nkey(it.n);
      for(const o of byName.get(k)||[]) if(meters(o,it)<150) return o;
      if(k.length>=4&&it.la){ const [y,x]=cell(it).split(",").map(Number);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) for(const o of byCell.get(`${y+dy},${x+dx}`)||[]){
          const ok=nkey(o.n); if(ok.length>=4&&(ok.includes(k)||k.includes(ok))&&meters(o,it)<40) return o; } }
      return null;
    },
    add(it){ const k=nkey(it.n); if(!byName.has(k)) byName.set(k,[]); byName.get(k).push(it);
      const c=cell(it); if(c){ if(!byCell.has(c)) byCell.set(c,[]); byCell.get(c).push(it); } }
  };
}
function allTodo(){
  const doneIdx=twinIndex(); for(const d of done.values()) doneIdx.add(d);
  const idx=twinIndex(), out=[], pos=new Map(), seen=new Set();
  for(const t of tiles.values()) for(const it of (t.items||[])){
    if(seen.has(it.i)||done.has(it.i)) continue; seen.add(it.i);
    if(doneIdx.find(it)) continue;
    const twin=idx.find(it);
    if(twin){ if(richness(it)>richness(twin)){ const k=pos.get(twin.i); out[k]=it; pos.delete(twin.i); pos.set(it.i,k); idx.add(it); } continue; }
    idx.add(it); pos.set(it.i,out.length); out.push(it);
  }
  return out.filter(it=>!leaving.has(it.i));
}
function matches(it){
  if(phoneOnly&&!it.p) return false;
  if(!q) return true;
  return [it.n,it.c,it.k,it.a].join(" ").toLowerCase().includes(q);
}

/* ---------- render ---------- */
function counts(){
  if(mode==="leads"){
    const todo=leads.filter(l=>!leadsDone.has(l.id));
    const now=Date.now();
    const nw=leads.filter(l=>l.date_discovered&&now-new Date(l.date_discovered+"T00:00:00").getTime()<NEW_FOR).length;
    $("st-todo").textContent=todo.length.toLocaleString();
    $("st-done").textContent=leadsDone.size.toLocaleString();
    $("st-new").textContent=nw.toLocaleString();
    return;
  }
  const todo=allTodo(), now=Date.now();
  const nw=todo.filter(i=>i.f&&now-i.f<NEW_FOR).length;
  $("st-todo").textContent=todo.length.toLocaleString();
  $("st-done").textContent=done.size.toLocaleString();
  $("st-new").textContent=nw.toLocaleString();
}
function cardHTML(it,isDone){
  const isNew=!isDone&&it.f&&Date.now()-it.f<NEW_FOR;
  const d=it.la?Math.round(miles(HOME,{lat:it.la,lon:it.lo})):null;
  const meta=[cuisine(it.k),it.a].filter(Boolean).map(esc).join(", ");
  const g="https://www.google.com/search?q="+encodeURIComponent(`${it.n} ${it.c||""} MD`);
  const m="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(it.la?`${it.n} ${it.la},${it.lo}`:`${it.n} ${it.c||""} MD`);
  return `<div class="card-in">
    <div class="c-top"><span>${esc(it.c||"Town not listed")}</span><span>${d!==null?d+" mi":""}</span></div>
    <h3 class="c-name">${esc(it.n)}</h3>
    ${meta?`<p class="c-meta">${meta}</p>`:""}
    ${isNew?'<span class="c-new">New this week</span>':""}
    ${it.p?`<button class="c-phone" data-copy="${esc(fmtPhone(it.p))}">${esc(fmtPhone(it.p))}</button>`:`<a class="c-phone" href="${esc(g)}" target="_blank" rel="noopener" style="color:var(--muted);font-size:15px">No phone listed. Look it up</a>`}
    <div class="c-links"><a href="${esc(g)}" target="_blank" rel="noopener">Google</a><a href="${esc(m)}" target="_blank" rel="noopener">Map</a></div>
    <div class="c-foot">
      ${isDone?`<span style="flex:1">Called ${it.by?(it.by===myName()?"by you ":`by ${esc(it.by)} `):""}${esc(ago(it.doneAt))}</span><button class="gbtn" data-restore="${esc(it.i)}">Put back</button>`
      :`<button class="hold" data-hold="${esc(it.i)}" aria-label="Hold to mark ${esc(it.n)} as called">
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true"><circle class="track" cx="26" cy="26" r="25" fill="none" stroke-width="2"/><circle class="fill" cx="26" cy="26" r="25" fill="none" stroke-width="2.6" stroke-linecap="round"/></svg>
        <svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button><span>Hold when you've called</span>`}
    </div>
  </div>`;
}
function emptyHTML(){
  if(!ready) return `<div><b>Loading</b></div>`;
  if(view==="done") return `<div><b>No calls yet</b><p>Restaurants you check off show up here.</p></div>`;
  if(!tiles.size) return `<div><b>No restaurants loaded</b><p>Press Sync now or Import file.</p>${lastErr?`<p style="color:var(--error)">${esc(lastErr)}</p>`:""}</div>`;
  return `<div><b>${q||phoneOnly?"No matches":"All called"}</b>${q||phoneOnly?"<p>Try another search or clear Has phone.</p>":""}</div>`;
}
let carReset=false;
function render(){
  if(mode==="leads"){ counts(); renderLeads(); return; }
  counts();
  let items;
  if(view==="done") items=[...done.values()].filter(matches).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  else {
    items=allTodo().filter(matches);
    if(sort==="near") items.forEach(i=>i._d=i.la?miles(HOME,{lat:i.la,lon:i.lo}):1e9), items.sort((a,b)=>a._d-b._d);
    else if(sort==="town") items.sort((a,b)=>(a.c||"~").localeCompare(b.c||"~")||a.n.localeCompare(b.n));
    else items.sort((a,b)=>(b.f||0)-(a.f||0)||a.n.localeCompare(b.n));
  }
  const empty=!items.length;
  $("list").hidden=!empty; $("carousel").hidden=empty;
  if(empty) $("list").innerHTML=emptyHTML();
  Car.set(items,view==="done",carReset); carReset=false;
}

/* ---------- business leads ---------- */
// Figures hardcoded from lead-generation-agent/data/search_progress.json (2026-11-26).
const LEADS_PROGRESS={total:278,byStatus:{"No Website":155,"Social Media Only":71,"Website Unlinked":22,"Needs Verification":30,"Outdated Website":0},countiesSearched:24,countiesWithLeads:20,cities:57,categoryLabels:146,discoveredApprox:939,excludedApprox:661,sources:["browser.search place queries","Places details","Facebook","Instagram","Yelp","BBB / directories","Zola / The Knot","BuildZoom","FMCSA / SAFER"],notQueried:["Bing Maps","Yellow Pages","Chamber of Commerce directories"],stillNeeds:["Somerset County — not reached at all","Dorchester, Queen Anne's and Caroline counties — zero firm leads so far","Fitness — zero clean leads statewide","Quota-blocked searches are unsearched, not zero results"]};

// Every lead belongs to exactly one type tab, decided by keywords in its
// category string. Rules are checked in order; first match wins. Anything
// that matches nothing (e.g. Locksmith) falls through to "Other".
const LEAD_TYPE_TABS=["All","Home Services","Auto & Transport","Health & Beauty","Food","Retail & Boutiques","Pets","Professional Services","Other"];
const LEAD_TYPE_RULES=[
  ["Pets",["pet","dog trainer"]],
  ["Auto & Transport",["auto","mechanic","towing","detailing","car wash"]],
  ["Food",["bakery","cake","catering","food truck"]],
  ["Health & Beauty",["dental","dentist","barber","hair","beauty","spa","fitness","trainer"]],
  ["Retail & Boutiques",["dry clean","tailor","boutique","clothing","retail","sewing"]],
  ["Professional Services",["photograph","video","wedding","event plan","event rental","party","interior design","insurance","account","music","tutor","dance","martial arts","teacher","educational","piano","performing arts"]],
  ["Home Services",["landscap","plumb","hvac","roof","construction","clean","paint","electric","pressure wash","renovation","remodel","handyman","fence","deck","floor","concrete","masonry","tree","junk removal","window","gutter","carpet","pool","appliance","pest","moving","contractor","home improvement","kitchen","bath","demolition","stump","lawn","garden","mowing","patio"]],
  ["Retail & Boutiques",["upholstery"]],
];
function leadType(l){
  const c=String(l.category||"").toLowerCase();
  for(const [tab,keys] of LEAD_TYPE_RULES) if(keys.some(k=>c.includes(k))) return tab;
  return "Other";
}
let ltype="All";

function leadGoogleUrl(l){return "https://www.google.com/search?q="+encodeURIComponent(`${l.name} ${l.city||""} MD`)}
function leadMapUrl(l){return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(l.address?`${l.name} ${l.address}`:`${l.name} ${l.city||""} MD`)}
function statusClass(s){return "pill-"+String(s||"").toLowerCase().replace(/[^a-z]+/g,"-")}

function leadCardHTML(l,isDone){
  const open=expandedLeads.has(l.id);
  const d=leadsDone.get(l.id);
  const links=[["Google",leadGoogleUrl(l)],["Map",leadMapUrl(l)]];
  if(l.facebook) links.push(["Facebook",l.facebook]);
  if(l.instagram) links.push(["Instagram",l.instagram]);
  if(l.website) links.push(["Website",l.website]);
  return `<article class="lead-card glass" data-lead="${esc(l.id)}">
    <div class="lead-top"><span class="lead-score" title="Lead score">${esc(l.score)}</span><span class="lead-status ${statusClass(l.website_status)}">${esc(l.website_status)}</span></div>
    <h3 class="lead-name">${esc(l.name)}</h3>
    <p class="lead-meta">${esc(l.category)} · ${esc(l.city)}${l.county?", "+esc(l.county):""}</p>
    ${l.google_rating?`<p class="lead-rating">★ ${esc(l.google_rating)} (${esc(l.google_reviews||0)} reviews)</p>`:""}
    ${l.phone?`<button class="c-phone" data-copy="${esc(fmtPhone(l.phone))}">${esc(fmtPhone(l.phone))}</button>`:""}
    <button class="lead-more" data-lead-expand="${esc(l.id)}" aria-expanded="${open}">${open?"Hide details":"Why a website helps"}</button>
    ${open?`<div class="lead-detail">
      <p>${esc(l.why_website_helps)}</p>
      <p class="lead-reason">${esc(l.score_reason)}</p>
      <div class="c-links">${links.map(([t,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div>
      <p class="lead-src">Source: ${esc(l.source)}</p>
    </div>`:""}
    <div class="c-foot">
      ${isDone?`<span style="flex:1">Called ${d&&d.by?(d.by===myName()?"by you ":`by ${esc(d.by)} `):""}${d?esc(ago(d.doneAt)):""}</span><button class="gbtn" data-lead-restore="${esc(l.id)}">Put back</button>`
      :`<button class="gbtn primary" data-lead-call="${esc(l.id)}">Mark called</button>`}
    </div>
  </article>`;
}

function leadsInView(){
  return leads.filter(l=>lview==="done"?leadsDone.has(l.id):!leadsDone.has(l.id));
}
function typeCounts(){
  const counts={};
  for(const t of LEAD_TYPE_TABS) counts[t]=0;
  for(const l of leadsInView()) counts[leadType(l)]++;
  counts.All=leadsInView().length;
  return counts;
}
function renderTypeTabs(){
  const counts=typeCounts();
  $("lead-type-tabs").innerHTML=LEAD_TYPE_TABS.map(t=>`<button class="type-tab${t===ltype?" active":""}" data-ltype="${esc(t)}" aria-pressed="${t===ltype}">${esc(t)} <span class="type-count">${counts[t]}</span></button>`).join("");
}
function filteredLeads(){
  let out=leadsInView();
  if(ltype!=="All") out=out.filter(l=>leadType(l)===ltype);
  if(lcat) out=out.filter(l=>l.category===lcat);
  if(lcounty) out=out.filter(l=>l.county===lcounty);
  if(lstatus) out=out.filter(l=>l.website_status===lstatus);
  if(lq) out=out.filter(l=>[l.name,l.city,l.category,l.county].join(" ").toLowerCase().includes(lq));
  if(lsort==="score") out.sort((a,b)=>b.score-a.score);
  else if(lsort==="rating") out.sort((a,b)=>(b.google_rating||0)-(a.google_rating||0)||b.score-a.score);
  else if(lsort==="reviews") out.sort((a,b)=>(b.google_reviews||0)-(a.google_reviews||0)||b.score-a.score);
  else out.sort((a,b)=>a.name.localeCompare(b.name));
  return out;
}
function renderLeads(){
  if(!leadsLoaded){ $("leads-empty").hidden=false; $("leads-empty").innerHTML="<div><b>Loading</b></div>"; $("leads-grid").innerHTML=""; $("lead-type-tabs").innerHTML=""; return; }
  renderTypeTabs();
  const items=filteredLeads();
  const todo=leads.filter(l=>!leadsDone.has(l.id)).length;
  $("leads-count").textContent=`${items.length.toLocaleString()} of ${todo.toLocaleString()} to call`;
  $("leads-empty").hidden=items.length>0;
  if(!items.length) $("leads-empty").innerHTML=`<div><b>${lview==="done"?"No calls yet":"No matches"}</b><p>${lview==="done"?"Leads you check off show up here.":"Try another search or clear a filter."}</p></div>`;
  $("leads-grid").innerHTML=items.map(l=>leadCardHTML(l,leadsDone.has(l.id))).join("");
}
function fillSelect(el,values){
  const all=el.options[0]?el.options[0].text:"All";
  const cur=el.value;
  el.innerHTML=`<option value="">${esc(all)}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if(values.includes(cur)) el.value=cur;
}
function buildLeadFilters(){
  fillSelect($("lf-cat"),[...new Set(leads.map(l=>l.category))].sort());
  fillSelect($("lf-county"),[...new Set(leads.map(l=>l.county).filter(Boolean))].sort());
}
function renderProgress(){
  const p=LEADS_PROGRESS;
  const rows=Object.entries(p.byStatus).map(([k,v])=>`<li><span>${esc(k)}</span><b>${v}</b></li>`).join("");
  $("leads-progress-body").innerHTML=`
    <p>${p.total} verified leads from ${p.countiesSearched} counties searched (${p.countiesWithLeads} with leads), ${p.cities} cities, ${p.categoryLabels} category labels. About ${p.discoveredApprox} businesses were looked at in total (approximate); about ${p.excludedApprox} were excluded because they already have a website (approximate — per-sweep counts, not a deduplicated census).</p>
    <ul class="prog-list">${rows}</ul>
    <p><b>Sources explored:</b> ${p.sources.map(esc).join(", ")}.</p>
    <p><b>Not yet queried:</b> ${p.notQueried.map(esc).join(", ")}.</p>
    <p><b>Still needs research:</b></p>
    <ul>${p.stillNeeds.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`;
}
async function fetchLeads(){
  if(!authed) return;
  try{
    const j=await api("/api/leads");
    leads=j.leads||[]; leadsDone=new Map((j.done||[]).map(d=>[d.id,d])); leadsLoaded=true;
    buildLeadFilters(); renderProgress();
    if(mode==="leads") render();
  }catch(e){ if(e.code!=="auth") showToast("Couldn't load the business leads. Try again.",null); }
}
async function leadCheckOff(id){
  const l=leads.find(x=>x.id===id); if(!l) return;
  showToast(`Called ${l.name}`,null);
  try{ await api("/api/leads-done",{method:"POST",body:JSON.stringify({id,by:myName()})}); fetchLeads(); }
  catch(err){ if(err.code!=="auth") showToast("Couldn't save that check-off. Try again.",null); }
}
async function leadRestore(id){
  try{ await api("/api/leads-done?id="+encodeURIComponent(id),{method:"DELETE"}); fetchLeads(); }
  catch(err){ if(err.code!=="auth") showToast("Couldn't put that back. Try again.",null); }
}
function setMode(m){
  mode=m;
  $("mode-tabs").dataset.v=m==="leads"?"leads":"restaurants";
  pressGroup(["m-rest","m-leads"],m==="leads"?"m-leads":"m-rest");
  $("rest-bar").hidden=m==="leads";
  $("rest-sync").hidden=m==="leads";
  $("rest-section").hidden=m==="leads";
  $("leads-view").hidden=m!=="leads";
  $("count").textContent=m==="leads"?"Maryland businesses with no professional website":"Restaurants with no website listed";
  if(m==="leads") fetchLeads();
  render();
}
$("m-rest").onclick=()=>setMode("restaurants");
$("m-leads").onclick=()=>setMode("leads");
$("lv-todo").onclick=()=>{lview="todo";$("leads-tabs").dataset.v="todo";pressGroup(["lv-todo","lv-done"],"lv-todo");renderLeads()};
$("lv-done").onclick=()=>{lview="done";$("leads-tabs").dataset.v="done";pressGroup(["lv-todo","lv-done"],"lv-done");renderLeads()};
let lqt; $("lq").oninput=e=>{clearTimeout(lqt);lqt=setTimeout(()=>{lq=e.target.value.trim().toLowerCase();renderLeads()},120)};
$("lf-cat").onchange=e=>{lcat=e.target.value;renderLeads()};
$("lf-county").onchange=e=>{lcounty=e.target.value;renderLeads()};
$("lf-status").onchange=e=>{lstatus=e.target.value;renderLeads()};
$("lf-sort").onchange=e=>{lsort=e.target.value;renderLeads()};
$("lead-type-tabs").addEventListener("click",e=>{
  const b=e.target.closest("[data-ltype]"); if(!b) return;
  ltype=b.dataset.ltype; renderLeads();
});
document.addEventListener("click",e=>{
  const ex=e.target.closest("[data-lead-expand]"); if(ex){ const id=ex.dataset.leadExpand; expandedLeads.has(id)?expandedLeads.delete(id):expandedLeads.add(id); renderLeads(); return; }
  const c=e.target.closest("[data-lead-call]"); if(c){ leadCheckOff(c.dataset.leadCall); return; }
  const r=e.target.closest("[data-lead-restore]"); if(r){ leadRestore(r.dataset.leadRestore); return; }
});

/* ---------- curved carousel ---------- */
const Car=(()=>{
  const stage=$("stage"), track=$("track"), scrub=$("scrub"), counter=$("counter");
  const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let list=[], pos=0, target=0, nodes=new Map(), raf=0, drag=null, wheelT=0, doneView=null, scrubbing=false;
  let cw=260, R=640, step=.42, spacing=278;
  function measure(){
    const w=stage.clientWidth||700;
    cw=Math.round(Math.min(240,Math.max(200,w*.6))); spacing=cw+14;
    R=Math.max(cw*3.1,560); step=2*Math.asin(Math.min(.99,spacing/(2*R)));
    stage.style.setProperty("--cw",cw+"px");
  }
  const clampT=v=>Math.max(0,Math.min(Math.max(0,list.length-1),v));
  const kick=()=>{ if(!raf) raf=requestAnimationFrame(tick) };
  function make(it){
    const el=document.createElement("article");
    el.className="card"; el.dataset.id=it.i; el.setAttribute("aria-roledescription","slide");
    el.innerHTML=cardHTML(it,doneView);
    return {el,idx:0,shift:0,fade:RM?1:0,act:null,sig:JSON.stringify(it)};
  }
  function tick(){
    raf=0; let moving=false;
    if(!drag){ const d=target-pos; if(Math.abs(d)>.0008){ pos+=RM?d:d*.14; moving=true } else pos=target; }
    const lo=Math.max(0,Math.floor(pos)-7), hi=Math.min(list.length-1,Math.ceil(pos)+7), want=new Set();
    for(let i=lo;i<=hi;i++){ const it=list[i]; want.add(it.i); let n=nodes.get(it.i);
      if(!n){ n=make(it); nodes.set(it.i,n); track.appendChild(n.el); } n.idx=i; }
    for(const [id,n] of nodes){ if(!want.has(id)){ n.el.remove(); nodes.delete(id); } }
    for(const n of nodes.values()){
      if(Math.abs(n.shift)>.002){ n.shift*=RM?0:.82; moving=true } else n.shift=0;
      if(n.fade<1){ n.fade=Math.min(1,n.fade+.07); moving=true }
      const o=n.idx-pos+n.shift, a=o*step, aa=Math.abs(a);
      if(aa>1.5){ n.el.style.visibility="hidden"; continue }
      n.el.style.visibility="";
      const x=R*Math.sin(a), z=R*(Math.cos(a)-1);
      n.el.style.transform=`translate(-50%,-50%) translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${(a*57.2958).toFixed(2)}deg)`;
      n.el.style.zIndex=String(1000-Math.round(Math.abs(o)*10));
      n.el.style.setProperty("--dim",Math.min(.85,Math.abs(o)*.22).toFixed(3));
      n.el.style.opacity=(n.fade*Math.max(0,Math.min(1,(1.5-aa)/.4))).toFixed(3);
      const act=Math.abs(o)<.5;
      if(act!==n.act){ n.act=act; n.el.classList.toggle("active",act); n.el.setAttribute("aria-hidden",String(!act)); n.el.inert=!act; }
    }
    ui();
    if(moving) kick();
  }
  function ui(){
    const N=list.length, c=Math.round(clampT(target));
    counter.textContent=N?`${(c+1).toLocaleString()} of ${N.toLocaleString()}`:"";
    scrub.max=String(Math.max(1,N)); if(!scrubbing) scrub.value=String(c+1);
    $("prev").disabled=c<=0; $("next").disabled=c>=N-1;
  }
  function go(i){ const t=clampT(Math.round(i)); if(Math.abs(t-pos)>8) pos=t-Math.sign(t-pos)*6; target=t; kick(); }
  function set(items,isDone,reset){
    measure();
    if(isDone!==doneView||reset){ for(const n of nodes.values()) n.el.remove(); nodes.clear(); doneView=isDone; pos=target=0; }
    const next=new Map(items.map((it,i)=>[it.i,i]));
    for(const [id,n] of nodes){
      if(!next.has(id)){ n.el.remove(); nodes.delete(id); continue }
      const ni=next.get(id); n.shift+=n.idx-ni; n.idx=ni;
      const it=items[ni], sig=JSON.stringify(it);
      if(sig!==n.sig && !(holdState&&n.el.contains(holdState.btn))){ n.sig=sig; n.el.innerHTML=cardHTML(it,doneView); n.act=null; }
    }
    list=items; target=clampT(Math.round(target)); if(pos>list.length-1) pos=Math.max(0,list.length-1)+.6;
    kick();
  }
  /* drag */
  stage.addEventListener("pointerdown",e=>{
    if(e.button>0||e.target.closest("[data-hold],a,button,input")) return;
    drag={x:e.clientX,p:pos,lx:e.clientX,lt:performance.now(),v:0,moved:false,card:e.target.closest(".card")};
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove",e=>{
    if(!drag) return;
    const dx=e.clientX-drag.x; if(Math.abs(dx)>5&&!drag.moved){drag.moved=true;stage.classList.add("dragging")}
    if(!drag.moved) return;
    const now=performance.now(), dt=Math.max(1,now-drag.lt);
    drag.v=.75*drag.v+.25*(-(e.clientX-drag.lx)/spacing/dt); drag.lx=e.clientX; drag.lt=now;
    let p=drag.p-dx/spacing; const max=list.length-1;
    if(p<0) p*=.3; else if(p>max) p=max+(p-max)*.3;
    pos=p; kick();
  });
  function endDrag(){
    if(!drag) return;
    stage.classList.remove("dragging");
    if(drag.moved) target=clampT(Math.round(pos+drag.v*240));
    else if(drag.card){ const n=nodes.get(drag.card.dataset.id); if(n&&!n.act) target=n.idx; }
    drag=null; kick();
  }
  stage.addEventListener("pointerup",endDrag); stage.addEventListener("pointercancel",endDrag);
  /* wheel / trackpad */
  stage.addEventListener("wheel",e=>{
    const d=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY; if(!d) return;
    e.preventDefault();
    target=clampT(target+d/(e.deltaMode===1?4:spacing*.85));
    clearTimeout(wheelT); wheelT=setTimeout(()=>{target=clampT(Math.round(target));kick()},130); kick();
  },{passive:false});
  /* keys + buttons + scrubber */
  stage.addEventListener("keydown",e=>{
    if(e.target!==stage) return;
    if(e.key==="ArrowRight"){e.preventDefault();go(Math.round(target)+1)}
    else if(e.key==="ArrowLeft"){e.preventDefault();go(Math.round(target)-1)}
    else if(e.key==="Home"){e.preventDefault();go(0)}
    else if(e.key==="End"){e.preventDefault();go(list.length-1)}
  });
  $("prev").onclick=()=>go(Math.round(target)-1);
  $("next").onclick=()=>go(Math.round(target)+1);
  scrub.addEventListener("input",()=>{scrubbing=true;go(+scrub.value-1)});
  scrub.addEventListener("change",()=>{scrubbing=false});
  addEventListener("resize",()=>{measure();kick()});
  return {set};
})();

/* ---------- controls ---------- */
function pressGroup(ids,active){ids.forEach(id=>$(id).setAttribute("aria-pressed",String(id===active)))}
$("v-todo").onclick=()=>{carReset=true;view="todo";shown=PAGE;$("tabs").dataset.v="todo";pressGroup(["v-todo","v-done"],"v-todo");render()};
$("v-done").onclick=()=>{carReset=true;view="done";shown=PAGE;$("tabs").dataset.v="done";pressGroup(["v-todo","v-done"],"v-done");render()};
/* custom sort menu */
const menu=$("sortmenu"), mbtn=$("sort-btn"), opts=[...menu.querySelectorAll("[data-sort]")], hl=$("menu-hl");
function setSort(v){carReset=true;sort=v;ls.set("cs.sort",v);opts.forEach(o=>o.setAttribute("aria-checked",String(o.dataset.sort===v)));
  $("sort-label").textContent=opts.find(o=>o.dataset.sort===v).firstElementChild.firstChild.textContent;shown=PAGE;render()}
function moveHl(btn){if(!btn){hl.style.opacity=0;return}const li=btn.parentElement;hl.style.height=li.offsetHeight+"px";hl.style.transform=`translateY(${li.offsetTop}px)`;hl.style.opacity=1}
function openMenu(focusIdx){menu.classList.add("open");mbtn.setAttribute("aria-expanded","true");const cur=opts.findIndex(o=>o.dataset.sort===sort);const t=opts[focusIdx??Math.max(0,cur)];requestAnimationFrame(()=>{moveHl(t);t.focus({preventScroll:true})})}
function closeMenu(refocus){menu.classList.remove("open");mbtn.setAttribute("aria-expanded","false");moveHl(null);if(refocus)mbtn.focus()}
mbtn.onclick=()=>menu.classList.contains("open")?closeMenu():openMenu();
mbtn.onkeydown=e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();openMenu()}};
opts.forEach((o,k)=>{
  o.onmouseenter=()=>moveHl(o); o.onfocus=()=>moveHl(o);
  o.onclick=()=>{setSort(o.dataset.sort);closeMenu(true)};
  o.onkeydown=e=>{if(e.key==="ArrowDown"){e.preventDefault();opts[(k+1)%opts.length].focus()}
    else if(e.key==="ArrowUp"){e.preventDefault();opts[(k-1+opts.length)%opts.length].focus()}
    else if(e.key==="Escape"){e.preventDefault();closeMenu(true)}
    else if(e.key==="Tab"){closeMenu()}};
});
$("sort-list").onmouseleave=()=>{const f=opts.find(o=>o===document.activeElement);moveHl(f||null)};
document.addEventListener("pointerdown",e=>{if(menu.classList.contains("open")&&!menu.contains(e.target))closeMenu()});
opts.forEach(o=>o.setAttribute("aria-checked",String(o.dataset.sort===sort)));
$("sort-label").textContent=(opts.find(o=>o.dataset.sort===sort)||opts[0]).firstElementChild.firstChild.textContent;
$("f-phone").checked=phoneOnly;
$("f-phone").onchange=e=>{carReset=true;phoneOnly=e.target.checked;ls.set("cs.phone",phoneOnly?"1":"0");shown=PAGE;render()};
let qt; $("q").oninput=e=>{clearTimeout(qt);qt=setTimeout(()=>{q=e.target.value.trim().toLowerCase();carReset=true;shown=PAGE;render()},120)};

document.addEventListener("click",async e=>{
  const c=e.target.closest("[data-copy]"); if(c){try{await navigator.clipboard.writeText(c.dataset.copy);const o=c.textContent;c.textContent="Copied";setTimeout(()=>c.textContent=o,1200)}catch{}return}
  const r=e.target.closest("[data-restore]"); if(r){restore(r.dataset.restore);return}
  });

/* ---------- hold to confirm ---------- */
const HOLD_MS=650;
let holdState=null;
function startHold(btn){
  if(holdState||btn.classList.contains("done")) return;
  const t0=performance.now();
  holdState={btn,raf:0};
  const step=now=>{const p=Math.min(1,(now-t0)/HOLD_MS);btn.style.setProperty("--p",p);
    if(p>=1){finishHold(btn);return}
    holdState.raf=requestAnimationFrame(step)};
  holdState.raf=requestAnimationFrame(step);
}
function cancelHold(){
  if(!holdState) return; cancelAnimationFrame(holdState.raf);
  const b=holdState.btn; holdState=null;
  if(!b.classList.contains("done")){ b.style.transition="none"; let p=parseFloat(b.style.getPropertyValue("--p"))||0;
    const back=()=>{p=Math.max(0,p-.08);b.style.setProperty("--p",p);if(p>0)requestAnimationFrame(back)}; back(); }
}
function finishHold(btn){
  holdState=null; btn.classList.add("done");
  if(navigator.vibrate) try{navigator.vibrate(12)}catch{}
  checkOff(btn.dataset.hold, btn.closest(".card"));
}
document.addEventListener("pointerdown",e=>{const b=e.target.closest("[data-hold]");if(b){e.preventDefault();b.setPointerCapture?.(e.pointerId);startHold(b)}});
document.addEventListener("pointerup",cancelHold);
document.addEventListener("pointercancel",cancelHold);
document.addEventListener("keydown",e=>{const b=e.target.closest?.("[data-hold]");if(b&&(e.key===" "||e.key==="Enter")&&!e.repeat){e.preventDefault();startHold(b)}});
document.addEventListener("keyup",e=>{if(e.key===" "||e.key==="Enter")cancelHold()});

/* ---------- talking to the site's server ---------- */
async function api(path,opts={}){
  const r=await fetch(path,{...opts,credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&path!=="/api/login"){ lock(); throw Object.assign(new Error("Sign in"),{code:"auth"}); }
  if(!r.ok) throw Object.assign(new Error(j.error||"Something went wrong. Try again."),{code:j.code||"server"});
  return j;
}
let ver=-1, tver=-1, pollT=null, offline=false;
async function refresh(){
  try{
    const j=await api(`/api/state?v=${ver}&tv=${tver}`);
    if(offline){ offline=false; if(!syncing&&!paused) $("sync-info").innerHTML=syncInfo(); }
    if(j.same) return;
    ver=j.ver;
    if(j.tiles){ tver=j.tv; tiles=new Map(Object.entries(j.tiles)); }
    done=new Map((j.done||[]).map(d=>[d.i,d]));
    const p=!!(j.prefs&&j.prefs.paused); if(p!==paused){ paused=p; applyPause(); }
    ready=true;
    if(!syncing&&!paused) $("sync-info").innerHTML=syncInfo();
    if(holdState) counts(); else if(leaving.size) setTimeout(()=>{if(!holdState)render()},380); else render();
  }catch(e){
    if(e.code==="auth") return;
    if(e.code==="setup"){ ready=true; lastErr=e.message; $("sync-info").innerHTML=`<span class="err">${esc(e.message)}</span>`; render(); return; }
    offline=true; $("sync-info").innerHTML='<span class="err">Can\'t reach the server. Retrying.</span>';
  }
}
function startPolling(){ clearInterval(pollT); refresh(); pollT=setInterval(()=>{ if(document.visibilityState==="visible") refresh(); },8000); }
document.addEventListener("visibilitychange",()=>{ if(authed&&document.visibilityState==="visible") refresh(); });

/* ---------- sign in ---------- */
function lock(){
  authed=false; clearInterval(pollT); document.body.classList.add("locked"); $("login").hidden=false;
  $("login-name").value=myName(); setTimeout(()=>($("login-name").value?$("login-pass"):$("login-name")).focus(),50);
}
function unlock(){ authed=true; document.body.classList.remove("locked"); $("login").hidden=true; ver=-1; tver=-1; startPolling(); fetchLeads(); }
$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const go=$("login-go"); go.disabled=true; $("login-err").textContent="";
  try{
    ls.set("cs.name",$("login-name").value.trim());
    await api("/api/login",{method:"POST",body:JSON.stringify({password:$("login-pass").value})});
    $("login-pass").value=""; unlock();
  }catch(err){ $("login-err").textContent=err.message; }
  go.disabled=false;
});
$("signout").onclick=async()=>{ try{ await api("/api/logout",{method:"POST",body:"{}"}); }catch{} tiles=new Map(); done=new Map(); ready=false; render(); lock(); };

/* ---------- check off / undo ---------- */
function findItem(id){for(const t of tiles.values())for(const it of (t.items||[]))if(it.i===id)return it;for(const d of done.values())if(d.i===id)return d;return null}
function stripLocal(it){const {_d,by,doneAt,...rest}=it;return rest}
let toastTimer=null,lastDone=null;
async function checkOff(id,li){
  const it=findItem(id); if(!it) return;
  leaving.add(id);
  if(li) li.classList.add("leaving");
  setTimeout(()=>{counts()},0);
  showToast(`Called ${it.n}`,id);
  try{ await api("/api/done",{method:"POST",body:JSON.stringify({item:stripLocal(it),by:myName()})}); refresh(); }
  catch(err){ leaving.delete(id); if(err.code!=="auth") showToast("Couldn't save that check-off. Try again.",null); render(); return; }
  setTimeout(()=>{leaving.delete(id);},400);
}
async function restore(id){ try{ await api("/api/done?id="+encodeURIComponent(id),{method:"DELETE"}); refresh(); }catch(err){ if(err.code!=="auth") showToast("Couldn't put that back. Try again.",null); } }
function showToast(text,id){
  const t=$("toast"); $("toast-text").textContent=text; lastDone=id;
  $("toast-undo").hidden=!id;
  t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),6000);
}
$("toast-undo").onclick=()=>{ if(lastDone){restore(lastDone);lastDone=null} $("toast").classList.remove("show"); };

/* ---------- sync (the server asks OpenStreetMap, one region at a time) ---------- */
function setSync(state,label,info){ const b=$("sync"); b.dataset.state=state; $("sync-label").textContent=label; if(info!==undefined) $("sync-info").innerHTML=info; }
function syncInfo(){
  const times=[...tiles.values()].map(t=>t.syncedAt||0); if(!times.length) return lastErr?`<span class="err">${esc(lastErr)}</span>`:"Not synced yet";
  const newest=Math.max(...times);
  return `Updated ${esc(ago(newest))}${tiles.size<TILES.length?`, ${tiles.size} of ${TILES.length} regions`:""}${lastErr?` <span class="err">${esc(lastErr)}</span>`:""}`;
}
async function sync(){
  if(syncing||paused||!authed) return;
  syncing=true; lastErr=""; $("import-btn").disabled=true;
  const order=TILES.slice().sort((a,b)=>(tiles.get(a.id)?.syncedAt||0)-(tiles.get(b.id)?.syncedAt||0));
  let ok=0, added=0, failed=0;
  for(let k=0;k<order.length;k++){
    if(paused) break;
    setSync("busy",`Syncing ${k+1}/${order.length}`);
    try{ const r=await api("/api/sync",{method:"POST",body:JSON.stringify({tile:order[k].id})}); ok++; added+=r.added||0; }
    catch(e){ if(e.code==="auth") break; failed++; lastErr=e.message; if(failed>=3&&!ok) break; }
  }
  syncing=false; $("import-btn").disabled=false;
  await refresh();
  if(paused){ applyPause(); render(); return; }
  if(failed&&!ok){ lastErr="The map server is busy. Try again later."; setSync("idle","Try again",syncInfo()); }
  else { if(!failed) lastErr=""; setSync("ok",added?`${added} new`:"Up to date",syncInfo()); setTimeout(()=>setSync("idle","Sync now",syncInfo()),4000); }
  render();
}
$("sync").onclick=()=>sync();

/* ---------- import an Overpass Turbo export ---------- */
function keepTags(t){
  return t && t.name && (!t.amenity || t.amenity==="restaurant") && !t.website && !t["contact:website"] && !t.url && !t.brand && !t["brand:wikidata"];
}
function parseImport(text){
  const out=[]; const tt=text.trim();
  if(tt.startsWith("<")){
    const doc=new DOMParser().parseFromString(tt,"application/xml");
    if(doc.querySelector("parsererror")) throw new Error("format");
    for(const el of doc.querySelectorAll("osm > node, osm > way, osm > relation")){
      const tags={}; for(const t of el.querySelectorAll(":scope > tag")) tags[t.getAttribute("k")]=t.getAttribute("v");
      const c=el.querySelector(":scope > center");
      const lat=+(el.getAttribute("lat")||c?.getAttribute("lat")), lon=+(el.getAttribute("lon")||c?.getAttribute("lon"));
      out.push({type:el.tagName,id:el.getAttribute("id"),lat,lon,tags});
    }
    return out;
  }
  const j=JSON.parse(tt);
  if(Array.isArray(j.elements)) return j.elements.map(e=>({type:e.type,id:e.id,lat:e.lat??e.center?.lat,lon:e.lon??e.center?.lon,tags:e.tags||{}}));
  if(j.type==="FeatureCollection"&&Array.isArray(j.features)){
    for(const f of j.features){
      const pr=f.properties||{}; const ref=String(pr["@id"]||pr.id||f.id||""); const m=/^(node|way|relation)\/(\d+)$/.exec(ref);
      const tags=pr.tags||Object.fromEntries(Object.entries(pr).filter(([k])=>!k.startsWith("@")&&k!=="id"));
      const g=f.geometry; let pts=[];
      if(g?.type==="Point") pts=[g.coordinates];
      else if(g?.type==="LineString") pts=g.coordinates;
      else if(g?.type==="Polygon") pts=g.coordinates[0]||[];
      else if(g?.type==="MultiPolygon") pts=g.coordinates[0]?.[0]||[];
      if(!pts.length) continue;
      const lon=pts.reduce((a,p)=>a+p[0],0)/pts.length, lat=pts.reduce((a,p)=>a+p[1],0)/pts.length;
      out.push({type:m?m[1]:"node",id:m?m[2]:ref.replace(/\D/g,"")||String(out.length),lat,lon,tags});
    }
    return out;
  }
  throw new Error("format");
}
function tileFor(lat,lon){ return TILES.find(T=>lat>=T.bb[0]&&lat<=T.bb[2]&&lon>=T.bb[1]&&lon<=T.bb[3]); }
function toItem(el,prev,firstTime){
  const t=el.tags||{}; const id=`${el.type[0]}${el.id}`;
  const street=[t["addr:housenumber"],t["addr:street"]].filter(Boolean).join(" ");
  if(t["addr:state"]&&!/^(MD|Maryland)$/i.test(t["addr:state"])) return null;
  return {i:id,n:t.name,a:street,c:t["addr:city"]||"",p:t.phone||t["contact:phone"]||t["contact:mobile"]||"",k:t.cuisine||"",
    la:+(el.lat??el.center?.lat??0).toFixed(5)||null, lo:+(el.lon??el.center?.lon??0).toFixed(5)||null,
    f: prev?.f ?? (firstTime?0:Date.now())};
}
$("import-btn").onclick=()=>{
  if(syncing){ showToast("Wait for the current sync to finish",null); return; }
  $("import-file").click();
};
$("import-file").onchange=async e=>{
  const file=e.target.files[0]; e.target.value=""; if(!file) return;
  syncing=true; $("import-btn").disabled=true; setSync("busy","Importing"); $("sync-info").textContent=`Reading ${file.name}`;
  let total=0, added=0, failed=0, msg="";
  try{
    const els=parseImport(await file.text()).filter(el=>keepTags(el.tags)&&isFinite(el.lat)&&isFinite(el.lon));
    if(!els.length) throw new Error("empty");
    const buckets=new Map();
    for(const el of els){ const T=tileFor(el.lat,el.lon); if(!T) continue; const it=toItem(el,null,true); if(!it) continue; if(!buckets.has(T.id)) buckets.set(T.id,[]); buckets.get(T.id).push(it); }
    let k=0;
    for(const [tile,items] of buckets){
      k++; $("sync-info").textContent=`Saving region ${k} of ${buckets.size}`;
      try{ const r=await api("/api/import",{method:"POST",body:JSON.stringify({tile,items})}); added+=r.added||0; total+=items.length; }
      catch(err){ if(err.code==="auth") throw err; failed++; }
    }
    try{ await api("/api/import",{method:"POST",body:JSON.stringify({finish:true})}); }catch{}
    msg = failed ? `Imported most of the file, but ${failed} region${failed>1?"s":""} didn't save. Import again to retry.`
                 : `Imported ${total.toLocaleString()} restaurants${added?`, ${added} new`:""}`;
  }catch(err){
    msg = err.code==="auth" ? "Sign in again, then import the file."
        : err.message==="empty" ? "That file has no restaurants without websites in it."
        : err.message==="format" || err instanceof SyntaxError ? "That file isn't an Overpass Turbo export. Export it as raw OSM data or GeoJSON."
        : "Couldn't import that file. Try again.";
  }
  syncing=false; $("import-btn").disabled=false;
  carReset=true; await refresh();
  setSync("idle","Sync now",syncInfo()); showToast(msg,null); render();
};

/* ---------- pause ---------- */
function applyPause(){
  const p=$("pause"); p.setAttribute("aria-pressed",String(paused)); p.textContent=paused?"Resume sync":"Pause sync";
  $("sync").disabled=paused;
  if(paused){ setSync("idle",syncing?"Stopping":"Sync now"); $("sync-info").innerHTML=syncing?"Pausing after this region":"Paused. The daily update is off too."; }
  else if(!syncing) setSync("idle","Sync now",syncInfo());
}
$("pause").onclick=async()=>{
  paused=!paused; applyPause();
  try{ await api("/api/prefs",{method:"POST",body:JSON.stringify({paused})}); refresh(); }
  catch(err){ paused=!paused; applyPause(); if(err.code!=="auth") showToast("Couldn't change the sync setting. Try again.",null); }
};

/* ---------- start ---------- */
render();
document.body.classList.add("locked");
fetch("/api/state?v=-2",{credentials:"same-origin"}).then(r=>{ if(r.status===401) lock(); else unlock(); }).catch(()=>unlock());
})();
