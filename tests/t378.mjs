import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot({fetchImpl=null,storage={}}={}) {
  const inj = html.replace('<script>', `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  const impl = fetchImpl || (()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')}));
  return new JSDOM(inj,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true,
    beforeParse(win){
      // The roster probe doubles as the "is the backend patched" check, and undo
      // stays hidden unless it is. Answer with an `employees` key so these tests
      // exercise undo rather than the guard (tguard.mjs covers the guard).
      win.fetch=(u,o)=>String(u).includes('view=roster')
        ? Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true,"employees":["Joel","Anny"]}')})
        : impl(u,o);
    }}).window;
}
function fill(w,{emp='Joel',role='Main',counts={},from='',to=''}={}){
  const l=w.eval('DISH_LETTERS[0]');
  const c=Object.keys(counts).length?counts:{[l]:'60'};
  w.document.getElementById('date').value=w.getTodayLocal();
  for(const k in c){const e=w.document.getElementById('dish_'+k);e.value=c[k];e.dispatchEvent(new w.Event('input'));}
  if(from){const e=w.document.getElementById('startTime');e.value=from;e.dispatchEvent(new w.Event('change'));}
  if(to){const e=w.document.getElementById('endTime');e.value=to;e.dispatchEvent(new w.Event('change'));}
  [...w.document.querySelectorAll('.emp-chip')].find(x=>x.dataset.name===emp).click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role===role).click();
}
// ---- #3 shift time + throughput ----
{
  const w=boot();
  ok("time fields exist", !!w.document.getElementById('startTime') && !!w.document.getElementById('endTime'));
  fill(w,{counts:{[w.eval('DISH_LETTERS[0]')]:'60'},from:'08:00',to:'12:00'});
  const rl=w.document.getElementById('rateLine').textContent;
  ok("shows duration", /4h 00m/.test(rl), rl);
  ok("computes dishes/hour", /15\.0 dishes\/hour/.test(rl), rl);
}
{ // overnight shift is the normal case here
  const w=boot(); fill(w,{counts:{[w.eval('DISH_LETTERS[0]')]:'70'},from:'21:00',to:'04:00'});
  const rl=w.document.getElementById('rateLine').textContent;
  ok("overnight shift is 7h, not negative", /7h 00m/.test(rl), rl);
  ok("overnight rate is 10/h", /10\.0 dishes\/hour/.test(rl), rl);
}
{ // implausible span warns rather than poisoning the data
  const w=boot(); fill(w,{counts:{[w.eval('DISH_LETTERS[0]')]:'10'},from:'23:00',to:'22:00'});
  const el=w.document.getElementById('rateLine');
  ok("23h span is flagged", el.classList.contains('warn') && /check the times/i.test(el.textContent), el.textContent);
}
{ // optional: no times means no rate, and submit still works
  let sent=null;
  const w=boot({fetchImpl:(u,o)=>{sent=JSON.parse(o.body);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  fill(w); w.submitForm(); await sleep(70);
  ok("times are optional", !!sent, "submitted");
  ok("shiftMinutes null when unset", sent.shiftMinutes===null, String(sent.shiftMinutes));
  ok("rate line empty when unset", w.document.getElementById('rateLine').textContent==='');
}
{ // times reach the payload and survive a reload
  let sent=null;
  const w=boot({fetchImpl:(u,o)=>{sent=JSON.parse(o.body);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  fill(w,{from:'21:30',to:'04:30'}); w.submitForm(); await sleep(70);
  ok("start/end/minutes in payload", sent.startTime==='21:30'&&sent.endTime==='04:30'&&sent.shiftMinutes===420,
     `${sent.startTime} ${sent.endTime} ${sent.shiftMinutes}`);
}
{
  const w1=boot(); fill(w1,{from:'21:00',to:'03:00'});
  const d=w1.localStorage.getItem('bb_assembly_draft_v1');
  const w2=boot({storage:{bb_assembly_draft_v1:d}});
  ok("times survive a reload", w2.document.getElementById('startTime').value==='21:00' && w2.document.getElementById('endTime').value==='03:00');
  ok("rate recomputed after restore", /6h 00m/.test(w2.document.getElementById('rateLine').textContent), w2.document.getElementById('rateLine').textContent);
}
// ---- #7 undo ----
{
  const calls=[];
  const w=boot({fetchImpl:(u,o)=>{calls.push(JSON.parse(o.body));return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  fill(w); w.submitForm(); await sleep(70);
  const ub=w.document.getElementById('undoBtn');
  ok("undo offered after a save", !ub.hidden);
  ok("undo shows a countdown", /\(\d+s\)/.test(ub.textContent), ub.textContent);
  w.undoLast(); await sleep(70);
  ok("undo posts a void_entry", calls.length===2 && calls[1].type==='void_entry', JSON.stringify(calls.map(c=>c.type)));
  ok("void carries the same entryId", calls[1].entryId===calls[0].entryId);
  ok("confirms it was undone", /undone/i.test(w.document.querySelector('.success-title').textContent));
  ok("undo button hidden after use", w.document.getElementById('undoBtn').hidden);
  ok("local record removed so no false dupe warning", JSON.parse(w.localStorage.getItem('bb_last_sent_v1')||'[]').length===0);
}
{ // failed undo must not claim success
  // Route by URL, not by call order: the page also fetches the roster on load,
  // so a counter no longer identifies which request is which.
  let posts=0;
  const w=boot({fetchImpl:(u,o)=>{
    if(String(u).includes('view=roster')) return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"status":"ok"}')});
    posts++;
    return posts===1
      ? Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')})
      : Promise.resolve({ok:false,status:500,text:()=>Promise.resolve('boom')});
  }});
  fill(w); w.submitForm(); await sleep(70);
  w.undoLast(); await sleep(70);
  ok("failed undo says so", /Could not undo/i.test(w.document.getElementById('errorMsg').textContent), w.document.getElementById('errorMsg').textContent.slice(0,50));
  ok("failed undo offers a retry", /retry/i.test(w.document.getElementById('undoBtn').textContent));
  ok("failed undo does NOT claim the entry is gone", !/undone/i.test(w.document.querySelector('.success-title').textContent));
}
{ // reset disarms the window
  const w=boot(); fill(w); w.submitForm(); await sleep(70);
  w.resetForm();
  ok("reset hides undo", w.document.getElementById('undoBtn').hidden);
}
// ---- #8 duplicate-day warning ----
{
  const w=boot(); fill(w); w.submitForm(); await sleep(70);
  w.resetForm();
  [...w.document.querySelectorAll('.emp-chip')].find(x=>x.dataset.name==='Joel').click();
  const db=w.document.getElementById('dupeBanner');
  ok("warns that Joel already submitted", db.classList.contains('visible'), db.textContent.slice(0,70));
  ok("warning names the person and time", /Joel already submitted/.test(db.textContent) && /\d\d:\d\d/.test(db.textContent));
  ok("warning does not block a second shift", !w.document.getElementById('submitBtn').disabled);
  ok("says carry on if it is a second shift", /second shift/i.test(db.textContent));
}
{ // a different person is not warned
  const w=boot(); fill(w); w.submitForm(); await sleep(70);
  w.resetForm();
  [...w.document.querySelectorAll('.emp-chip')].find(x=>x.dataset.name==='Anny').click();
  ok("different person is not warned", !w.document.getElementById('dupeBanner').classList.contains('visible'));
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
