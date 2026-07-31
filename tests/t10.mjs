import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot({fetchImpl=null,storage={}}={}) {
  const inj = html.replace('<script>', `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  const impl = fetchImpl || (()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')}));
  const d=new JSDOM(inj,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true,
    beforeParse(win){ win.fetch=impl; }});
  return d.window;
}
function fill(w,{emp='Joel',role='Main',counts={A:'12',C:'30'}}={}){
  w.document.getElementById('date').value=w.getTodayLocal();
  for(const l in counts){const i=w.document.getElementById('dish_'+l);i.value=counts[l];i.dispatchEvent(new w.Event('input'));}
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name===emp).click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role===role).click();
}
// TypeError is what a real fetch throws when there is no network.
const netFail = ()=>Promise.reject(new TypeError('Failed to fetch'));

// ---- PWA wiring ----
{
  const w=boot();
  ok("manifest linked", !!w.document.querySelector('link[rel=manifest]'));
  ok("apple-touch-icon linked", !!w.document.querySelector('link[rel="apple-touch-icon"]'));
  ok("theme-color matches brand", w.document.querySelector('meta[name=theme-color]')?.content==='#062018');
}
// ---- offline submit is QUEUED, not lost ----
{
  const w=boot({fetchImpl:netFail});
  fill(w); w.submitForm(); await sleep(80);
  const q=JSON.parse(w.localStorage.getItem('bb_assembly_outbox_v1')||'[]');
  ok("offline submit queued", q.length===1, "q="+q.length);
  ok("queued payload keeps items[] with dish names", (q[0]?.payload?.items||[]).every(i=>i.dish), JSON.stringify(q[0]?.payload?.items||[]).slice(0,70));
  ok("queued payload keeps entryId (retry cannot duplicate)", !!q[0]?.payload?.entryId);
  ok("queued screen shown", w.document.getElementById('successScreen').classList.contains('visible'));
  const t=w.document.querySelector('.success-title');
  ok("does NOT claim it was saved to the sheet", t.textContent!=='Saved!' && /this phone/i.test(t.textContent), t.textContent);
  ok("queued screen is visually distinct (amber)", t.classList.contains('queued'));
  ok("detail says not in the sheet yet", /not in the sheet yet/i.test(w.document.getElementById('successDetail').textContent));
  ok("draft cleared (entry now lives in the outbox)", w.localStorage.getItem('bb_assembly_draft_v1')===null);
}
// ---- server rejection must NOT be queued ----
{
  const w=boot({fetchImpl:()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html>Exception: bad</html>')})});
  fill(w); w.submitForm(); await sleep(80);
  ok("sheet rejection is NOT queued (would just fail again)", JSON.parse(w.localStorage.getItem('bb_assembly_outbox_v1')||'[]').length===0);
  ok("rejection shows the error", w.document.getElementById('errorMsg').classList.contains('visible'));
  ok("rejection keeps the numbers on screen", w.document.getElementById('dish_A').value==='12');
  ok("rejection keeps the draft", !!w.localStorage.getItem('bb_assembly_draft_v1'));
}
// ---- queue flushes when the network returns ----
{
  let up=false; const sent=[];
  const w=boot({fetchImpl:(u,o)=>{ if(!up) return Promise.reject(new TypeError('Failed to fetch'));
    sent.push(JSON.parse(o.body)); return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')}); }});
  fill(w); w.submitForm(); await sleep(80);
  ok("banner warns while queued", w.document.getElementById('queueBanner').classList.contains('visible'),
     w.document.getElementById('queueBanner').textContent);
  up=true; w.dispatchEvent(new w.Event('online')); await sleep(150);
  ok("flushes on reconnect", sent.length===1, "sent="+sent.length);
  ok("outbox emptied", JSON.parse(w.localStorage.getItem('bb_assembly_outbox_v1')||'[]').length===0);
  ok("banner cleared", !w.document.getElementById('queueBanner').classList.contains('visible'));
}
// ---- a queued entry from a previous session sends on load ----
{
  const sent=[];
  const pre=[{id:'q-1',queuedAt:Date.now(),payload:{date:'2026-07-31',employees:['Joel'],dishes:'A:5',entryId:'q-1',items:[{letter:'A',dish:'X',qty:5}]}}];
  const w=boot({storage:{bb_assembly_outbox_v1:JSON.stringify(pre)},
    fetchImpl:(u,o)=>{sent.push(JSON.parse(o.body));return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  await sleep(150);
  ok("previous session's queued entry is sent on load", sent.length===1 && sent[0].entryId==='q-1', JSON.stringify(sent.map(s=>s.entryId)));
}
// ---- reset restores the success screen after a queued one ----
{
  const w=boot({fetchImpl:netFail});
  fill(w); w.submitForm(); await sleep(80);
  w.resetForm();
  const t=w.document.querySelector('.success-title'); const r=w.document.querySelector('.success-ring');
  ok("reset restores 'Saved!' wording", t.textContent==='Saved!' && !t.classList.contains('queued'), t.textContent);
  ok("reset restores the tick", r.textContent==='✓' && !r.classList.contains('queued'), r.textContent);
}
// ---- corrupt outbox must not brick the form ----
{
  const w=boot({storage:{bb_assembly_outbox_v1:'{{{nope'}});
  await sleep(60);
  ok("corrupt outbox recovers", w.document.querySelectorAll('.dish').length>0);
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
