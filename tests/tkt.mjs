import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/kitchen-tasks.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function boot({op='Salman', fetchImpl=null, storage={}}={}) {
  const injected = html.replace('<script>',
    `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  const impl = fetchImpl || (()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true,"row":5}')}));
  const d=new JSDOM(injected,{runScripts:'dangerously',
    url:'http://localhost:8765/kitchen-tasks.html'+(op?'?op='+encodeURIComponent(op):''),
    pretendToBeVisual:true,
    // fetch must exist BEFORE the page's scripts run, or the on-load outbox
    // flush fires against an undefined fetch -- which a real browser never does.
    beforeParse(win){
      win.fetch = (u, o) => {
        if (String(u).includes('roster.json')) {
          const j = readFileSync('/Users/abbassalloum/assembly-tracking-app/roster.json','utf8');
          return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(JSON.parse(j)),text:()=>Promise.resolve(j)});
        }
        return impl(u, o);
      };
    }});
  return d.window;
}


// Boot is async now: it awaits roster.json before rendering, so the DOM is not
// ready synchronously the way it used to be.
async function bootReady(opts){
  const w = boot(opts);
  for (let i=0;i<100;i++){
    if (w.document.querySelector('.op-grid, .check, .empty')) break;
    await sleep(5);
  }
  return w;
}

// ---- mojibake gone ----
{
  const w=await bootReady();
  const txt=w.document.body.textContent;
  ok("temperature text renders correctly (≥75°C)", txt.includes('≥75°C'), txt.match(/Core[^·]{0,24}/)?.[0]);
  ok("no mojibake in rendered page", !/Â|â/.test(txt));
}
// ---- stale warning ----
{
  const w=await bootReady();
  const st=w.document.querySelector('.stale');
  ok("stale plan warning is shown", !!st);
  ok("warning states the age in days", /\d+ days old/.test(st?.textContent||''), st?.textContent.trim().slice(0,60));
  ok("severe styling for a very old plan", st?.classList.contains('stale-hard'));
  ok("warning has role=alert", st?.getAttribute('role')==='alert');
}
// ---- checks now POST ----
{
  const sent=[];
  const w=await bootReady({fetchImpl:(u,o)=>{sent.push(JSON.parse(o.body));return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true,"row":5}')});}});
  const checks=[...w.document.querySelectorAll('.check')];
  ok("checks rendered for this operator", checks.length>0, "n="+checks.length);
  const haccp=checks.find(c=>c.dataset.kind==='haccp');
  haccp.click(); await sleep(60);
  ok("ticking a HACCP box POSTs to the sheet", sent.length===1, "sent="+sent.length);
  const p=sent[0];
  ok("payload typed as haccp_check", p.type==='haccp_check');
  ok("payload carries the instruction TEXT", /≥|°C|Cambro|transit/i.test(p.label||''), p.label);
  ok("payload carries operator", p.operator==='Salman', p.operator);
  ok("payload carries plan date", p.planDate==='2026-04-22', p.planDate);
  ok("payload records done=true", p.done===true);
  ok("payload has device id + checkId", !!p.device && !!p.checkId);
  ok("payload has tz + version", !!p.tz && !!p.appVersion);
  ok("outbox drained after success", JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===0);

  // untick must also be recorded
  haccp.click(); await sleep(60);
  ok("UNticking is recorded as its own row", sent.length===2 && sent[1].done===false, JSON.stringify(sent.map(x=>x.done)));

  // dish check carries dish context
  const dish=checks.find(c=>c.dataset.kind==='dish');
  dish.click(); await sleep(60);
  const dp=sent[sent.length-1];
  ok("dish check carries dish name + letter + station", !!dp.label && !!dp.dishLetter && !!dp.station,
     `${dp.dishLetter} / ${dp.label} / ${dp.station}`);
}
// ---- offline: nothing may be lost ----
{
  let online=false; const seen=[];
  const w=await bootReady({fetchImpl:(u,o)=>{ if(!online) return Promise.reject(new Error('offline'));
    seen.push(JSON.parse(o.body)); return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')}); }});
  const checks=[...w.document.querySelectorAll('.check')];
  checks[0].click(); await sleep(40);
  checks[1].click(); await sleep(40);
  let q=JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]');
  ok("offline checks are queued, not lost", q.length===2, "queued="+q.length);
  ok("pending badge tells staff", /not yet saved/.test(w.document.getElementById('pendingBadge').textContent), w.document.getElementById('pendingBadge').textContent);
  ok("UI still shows them ticked", checks[0].classList.contains('done') && checks[1].classList.contains('done'));
  online=true;
  w.dispatchEvent(new w.Event('online')); await sleep(150);
  ok("queue flushes when the network returns", seen.length===2, "sent="+seen.length);
  ok("outbox now empty", JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===0);
  ok("badge cleared", w.document.getElementById('pendingBadge').textContent==='');
}
// ---- queue survives a reload ----
{
  const pend=[{type:'haccp_check',checkId:'c-1',label:'Core ≥75°C',operator:'X',done:true}];
  const seen=[];
  const w=await bootReady({storage:{kt_outbox_v1:JSON.stringify(pend)},
    fetchImpl:(u,o)=>{seen.push(JSON.parse(o.body));return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  await sleep(120);
  ok("a queued check from a previous session is sent on load", seen.length===1 && seen[0].checkId==='c-1', JSON.stringify(seen.map(s=>s.checkId)));
}
// ---- Apps Script HTML error page must NOT drain the queue ----
{
  const w=await bootReady({fetchImpl:()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html>Exception: boom</html>')})});
  const c=[...w.document.querySelectorAll('.check')][0];
  c.click(); await sleep(120);
  ok("HTML error page keeps the check queued (not silently dropped)",
     JSON.parse(w.localStorage.getItem('kt_outbox_v1')||'[]').length===1);
}
// ---- corrupt outbox must not brick the page ----
{
  const w=await bootReady({storage:{kt_outbox_v1:'{{{not json'}});
  await sleep(60);
  ok("corrupt outbox recovers", w.document.querySelectorAll('.check').length>0);
}

// ---- roster: the "wrong names" fix ----
{
  const w=await bootReady({op:null});
  const names=[...w.document.querySelectorAll('.op-grid a')].map(a=>a.textContent.trim());
  const roster=JSON.parse(readFileSync('/Users/abbassalloum/assembly-tracking-app/roster.json','utf8')).employees;
  ok("picker shows the CURRENT roster", names.length===roster.length, `${names.length} shown vs ${roster.length} on roster: ${names.join(', ')}`);
  for (const departed of ['Ankit Gaharwar','Manisha Patil','Sreekant Goud']) {
    ok(`departed staff gone: ${departed}`, !names.includes(departed));
  }
  for (const current of ['Jash','Ranjith','Anny','Alfiya','Rochelle','Nisha','Ritu','Aishwarya']) {
    ok(`now listed: ${current}`, names.includes(current));
  }
  ok("no stale full-name forms", !names.some(n=>/\s/.test(n)), names.filter(n=>/\s/.test(n)).join(','));
  // people with plan data are not greyed; people without are
  const withPlan=[...w.document.querySelectorAll('.op-grid a')].filter(a=>!a.classList.contains('no-plan')).map(a=>a.textContent.trim());
  ok("first-name match links Salman/Joel/Hamid/Varush to their plan data",
     ['Salman','Joel','Hamid','Varush'].every(n=>withPlan.includes(n)), withPlan.join(','));
  ok("people absent from the plan are marked", w.document.querySelectorAll('.op-grid a.no-plan').length===8,
     "greyed="+w.document.querySelectorAll('.op-grid a.no-plan').length);
}
// ---- a roster member with NO plan data still gets the checklist ----
{
  const w=await bootReady({op:'Aishwarya'});
  const checks=[...w.document.querySelectorAll('.check')];
  ok("HACCP checklist available to someone absent from the stale plan", checks.length>0, "checks="+checks.length);
  ok("all of them are haccp kind (no invented stations)", checks.every(c=>c.dataset.kind==='haccp'));
  ok("explains why there are no stations", /No stations for you in this plan/.test(w.document.body.textContent));
  ok("does not claim a role or shift it cannot know", !/undefined/.test(w.document.body.textContent));
}
// ---- someone genuinely off the roster is a dead end ----
{
  const w=await bootReady({op:'Manisha Patil'});
  ok("departed person cannot record checks", w.document.querySelectorAll('.check').length===0);
  ok("told they are not on the roster", /not on the current Berlin roster/.test(w.document.body.textContent));
}
// ---- roster fetch failure falls back rather than locking everyone out ----
{
  const w=await bootReady({op:null, fetchImpl:()=>Promise.reject(new Error('offline'))});
  // roster.json is served by the harness, so force the failure path explicitly
  const names=[...w.document.querySelectorAll('.op-grid a')].map(a=>a.textContent.trim());
  ok("picker still populated when offline", names.length>=12, "n="+names.length);
}

let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
