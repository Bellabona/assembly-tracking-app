import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const kt=readFileSync('/Users/abbassalloum/assembly-tracking-app/kitchen-tasks.html','utf8');
const idx=readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const roster=readFileSync('/Users/abbassalloum/assembly-tracking-app/roster.json','utf8');
const J=o=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve(JSON.stringify(o)),json:()=>Promise.resolve(o)});
// An UNPATCHED backend: bare health check, no `employees` key.
const UNPATCHED = { status:'ok', message:'Assembly Tracking API is running' };
const PATCHED   = { ok:true, employees:['Joel','Anny'] };

function bootKT(backend, {storage={}}={}) {
  const inj = kt.replace('<script>', `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  const posts=[];
  const w=new JSDOM(inj,{runScripts:'dangerously',url:'http://localhost:8765/kitchen-tasks.html?op=Joel',pretendToBeVisual:true,
    beforeParse(win){ win.fetch=(u,o)=>{
      if(String(u).includes('view=roster')) return J(backend);
      if(String(u).includes('roster.json')) return J(JSON.parse(roster));
      if(o&&o.method==='POST'){ posts.push(JSON.parse(o.body)); return J({result:'success'}); }
      return J({});
    };}}).window;
  return {w, posts};
}

// ---- UNPATCHED: a tick must NOT post ----
{
  const {w,posts}=bootKT(UNPATCHED);
  for(let i=0;i<120 && !w.document.querySelector('.check');i++) await sleep(5);
  const c=[...w.document.querySelectorAll('.check')][0];
  c.click(); await sleep(200);
  ok("unpatched backend: NO post (no junk row)", posts.length===0, "posts="+posts.length);
  ok("the tick is still queued, not lost", JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===1);
  ok("UI still shows it ticked", c.classList.contains('done'));
  const badge=w.document.getElementById('pendingBadge');
  ok("badge explains recording is not switched on", /not switched on yet/i.test(badge.textContent), badge.textContent.slice(0,80));
  ok("badge names the cause", /Apps Script patch/i.test(badge.textContent));
}
// ---- PATCHED: a tick posts normally ----
{
  const {w,posts}=bootKT(PATCHED);
  for(let i=0;i<120 && !w.document.querySelector('.check');i++) await sleep(5);
  [...w.document.querySelectorAll('.check')][0].click(); await sleep(250);
  ok("patched backend: check IS posted", posts.length===1, "posts="+posts.length);
  ok("posted as haccp_check", posts[0]?.type==='haccp_check');
  ok("outbox drained", JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===0);
}
// ---- queued backlog is held, then flushes once patched ----
{
  const pend=[{type:'haccp_check',checkId:'c-1',label:'Core ≥75°C',done:true}];
  const {w,posts}=bootKT(UNPATCHED,{storage:{kt_outbox_v1:JSON.stringify(pend)}});
  await sleep(220);
  ok("existing backlog is NOT flushed into junk", posts.length===0, "posts="+posts.length);
  ok("backlog preserved", JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===1);
}
{
  const pend=[{type:'haccp_check',checkId:'c-1',label:'Core ≥75°C',done:true}];
  const {w,posts}=bootKT(PATCHED,{storage:{kt_outbox_v1:JSON.stringify(pend)}});
  await sleep(250);
  ok("backlog flushes once the patch is live", posts.length===1 && posts[0].checkId==='c-1', "posts="+posts.length);
}
// ---- index.html: undo hidden while unpatched ----
function bootIdx(backend){
  const posts=[];
  const w=new JSDOM(idx,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true,
    beforeParse(win){ win.fetch=(u,o)=>{
      if(String(u).includes('view=roster')) return J(backend);
      if(o&&o.method==='POST'){ posts.push(JSON.parse(o.body)); return J({result:'success'}); }
      return J({});
    };}}).window;
  return {w,posts};
}
function fill(w){
  const l=w.eval('DISH_LETTERS[0]');
  const e=w.document.getElementById('dish_'+l); e.value='5'; e.dispatchEvent(new w.Event('input'));
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
}
{
  const {w,posts}=bootIdx(UNPATCHED);
  await sleep(120);
  fill(w); w.submitForm(); await sleep(120);
  ok("entry itself still submits (old doPost handles it)", posts.some(p=>p.dishes), "posts="+posts.length);
  ok("undo NOT offered while unpatched (would write junk)", w.document.getElementById('undoBtn').hidden);
  ok("no void_entry posted", !posts.some(p=>p.type==='void_entry'));
  ok("success screen still shown", w.document.getElementById('successScreen').classList.contains('visible'));
}
{
  const {w,posts}=bootIdx(PATCHED);
  await sleep(120);
  fill(w); w.submitForm(); await sleep(120);
  ok("undo IS offered once patched", !w.document.getElementById('undoBtn').hidden);
  w.undoLast(); await sleep(120);
  ok("void_entry posted when patched", posts.some(p=>p.type==='void_entry'));
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
