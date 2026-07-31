import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(){
  const d=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true});
  return d.window;
}
function fill(w,{emp='Joel',role='Main',counts={A:'12',C:'30'}}={}){
  w.document.getElementById('date').value=w.getTodayLocal();
  for(const l in counts){const i=w.document.getElementById('dish_'+l);i.value=counts[l];i.dispatchEvent(new w.Event('input'));}
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name===emp).click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role===role).click();
}

// ---- #13 payload carries dish NAMES ----
{
  const w=boot(); let sent=null;
  w.fetch=(u,o)=>{sent=JSON.parse(o.body);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true,"row":9}')});};
  fill(w); w.submitForm(); await sleep(60);
  const names = w.eval('JSON.stringify(DISH_NAMES)'); const DN=JSON.parse(names);
  ok("legacy `dishes` string unchanged (existing sheet safe)", sent.dishes==='A:12 | C:30', sent.dishes);
  ok("items[] present", Array.isArray(sent.items) && sent.items.length===2, JSON.stringify(sent.items||null).slice(0,80));
  ok("items carry the real dish NAME", sent.items[0].dish===DN.A && sent.items[1].dish===DN.C,
     sent.items[0].dish+" / "+sent.items[1].dish);
  ok("items carry letter + integer qty", sent.items[0].letter==='A' && sent.items[0].qty===12 && typeof sent.items[0].qty==='number');
  ok("appVersion sent", !!sent.appVersion, sent.appVersion);
  ok("clientTime is ISO", /^\d{4}-\d{2}-\d{2}T/.test(sent.clientTime||''), sent.clientTime);
  ok("tz sent", typeof sent.tz==='string');
  ok("history is now self-describing (name present for every item)", sent.items.every(i=>i.dish && i.dish.length>3));
  // success screen shows names, not letters
  const detail=w.document.getElementById('successDetail').textContent;
  ok("confirmation shows dish names not letters", detail.includes(DN.A.slice(0,12)) && !detail.includes('A:12'), detail.slice(0,90));
}

// ---- #11 idempotency ----
{
  const w=boot(); const ids=[];
  w.fetch=(u,o)=>{ids.push(JSON.parse(o.body).entryId);return Promise.resolve({ok:false,status:500,text:()=>Promise.resolve('boom')});};
  fill(w);
  w.submitForm(); await sleep(50);   // fails
  w.submitForm(); await sleep(50);   // retry same entry
  w.submitForm(); await sleep(50);   // retry again
  ok("retries of a failed submit REUSE one id (no duplicate rows)", ids.length===3 && new Set(ids).size===1, JSON.stringify(ids));
  ok("id is non-trivial", (ids[0]||'').length>=16, ids[0]);
}
{
  const w=boot(); const ids=[];
  w.fetch=(u,o)=>{ids.push(JSON.parse(o.body).entryId);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});};
  fill(w); w.submitForm(); await sleep(60);
  w.resetForm();
  fill(w,{emp:'Anny',role:'Assist',counts:{B:'5'}}); w.submitForm(); await sleep(60);
  ok("a genuinely NEW entry gets a DIFFERENT id", ids.length===2 && ids[0]!==ids[1], JSON.stringify(ids));
}
// double-tap in the same tick must not fire two different ids
{
  const w=boot(); const ids=[];
  w.fetch=(u,o)=>{ids.push(JSON.parse(o.body).entryId);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});};
  fill(w); w.submitForm(); w.submitForm(); await sleep(80);
  ok("double-tap cannot create two distinct ids", new Set(ids).size<=1, JSON.stringify(ids));
}
// ---- escaping: a dish name with markup must not inject ----
{
  const w=boot(); 
  w.fetch=()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});
  w.eval('DISH_NAMES.A = "<b>X</b> Chick & Rice";');   // short: survives shortDish()
  fill(w,{counts:{A:'3'}}); w.submitForm(); await sleep(60);
  const el=w.document.getElementById('successDetail');
  ok("markup in a dish name is escaped, not injected", el.querySelectorAll('b').length===0 && el.textContent.includes("<b>X</b>"), el.innerHTML.slice(0,120));
  ok("ampersand survives as text", el.textContent.includes('&'), el.textContent.slice(0,60));
}

let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
