import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const idx  = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const sumh = readFileSync('/Users/abbassalloum/assembly-tracking-app/summary.html','utf8');
const kt   = readFileSync('/Users/abbassalloum/assembly-tracking-app/kitchen-tasks.html','utf8');
const rosterJson = readFileSync('/Users/abbassalloum/assembly-tracking-app/roster.json','utf8');

function mk(html, fetchImpl, url='http://localhost:8765/') {
  return new JSDOM(html,{runScripts:'dangerously',url,pretendToBeVisual:true,
    beforeParse(win){ win.fetch=fetchImpl; }}).window;
}
const jsonRes = obj => Promise.resolve({ok:true,status:200,text:()=>Promise.resolve(JSON.stringify(obj)),json:()=>Promise.resolve(obj)});

// ---- #12 roster from the sheet (index.html) ----
{
  const w=mk(idx,(u)=>{
    if(String(u).includes('view=roster')) return jsonRes({ok:true,employees:['Zara','Bilal','Joel']});
    return jsonRes({ok:true});
  });
  await sleep(120);
  const names=[...w.document.querySelectorAll('.emp-chip')].map(c=>c.dataset.name);
  ok("entry form adopts the sheet roster", names.join(',')==='Zara,Bilal,Joel', names.join(','));
  ok("a brand-new hire needs no deploy", names.includes('Zara'));
}
{ // an EMPTY roster must never win
  const w=mk(idx,(u)=>{
    if(String(u).includes('view=roster')) return jsonRes({ok:true,employees:[]});
    return jsonRes({ok:true});
  });
  await sleep(120);
  ok("empty sheet roster is ignored", w.document.querySelectorAll('.emp-chip').length===12,
     "chips="+w.document.querySelectorAll('.emp-chip').length);
}
{ // backend not patched yet -> health-check JSON, no employees key
  const w=mk(idx,()=>jsonRes({status:'ok',message:'Assembly Tracking API is running'}));
  await sleep(120);
  ok("un-patched backend leaves the baked-in list alone", w.document.querySelectorAll('.emp-chip').length===12);
}
{ // HTML error page must not break the picker
  const w=mk(idx,()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html>Exception</html>')}));
  await sleep(120);
  ok("HTML error page tolerated", w.document.querySelectorAll('.emp-chip').length===12);
}
{ // must NOT rebuild under someone mid-entry
  let served=false;
  const w=mk(idx,(u)=>{
    if(String(u).includes('view=roster')){ served=true; return new Promise(r=>setTimeout(()=>r({ok:true,status:200,text:()=>Promise.resolve(JSON.stringify({ok:true,employees:['Zara']}))}),40)); }
    return jsonRes({ok:true});
  });
  await sleep(5);
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel')?.click();
  await sleep(150);
  const checked=w.document.querySelector('.emp-chip.checked');
  ok("does not rebuild chips under an active selection", !!checked && checked.dataset.name==='Joel',
     checked?checked.dataset.name:'selection lost');
}
// ---- #12 roster tiers (kitchen-tasks) ----
{
  const w=mk(kt,(u)=>{
    if(String(u).includes('view=roster')) return jsonRes({ok:true,employees:['Zara','Joel']});
    if(String(u).includes('roster.json')) return jsonRes(JSON.parse(rosterJson));
    return jsonRes({ok:true});
  },'http://localhost:8765/kitchen-tasks.html');
  for(let i=0;i<100 && !w.document.querySelector('.op-grid');i++) await sleep(5);
  const names=[...w.document.querySelectorAll('.op-grid a')].map(a=>a.textContent.trim());
  ok("HACCP picker prefers the sheet", names.length===2 && names.includes('Zara'), names.join(','));
  ok("source recorded as sheet", w.eval('ROSTER_SOURCE')==='sheet', w.eval('ROSTER_SOURCE'));
}
{ // sheet unavailable -> roster.json
  const w=mk(kt,(u)=>{
    if(String(u).includes('view=roster')) return Promise.reject(new TypeError('offline'));
    if(String(u).includes('roster.json')) return jsonRes(JSON.parse(rosterJson));
    return jsonRes({ok:true});
  },'http://localhost:8765/kitchen-tasks.html');
  for(let i=0;i<100 && !w.document.querySelector('.op-grid');i++) await sleep(5);
  ok("falls back to roster.json", w.eval('ROSTER_SOURCE')==='roster.json', w.eval('ROSTER_SOURCE'));
  ok("all 12 still listed", w.document.querySelectorAll('.op-grid a').length===12);
}
{ // both unavailable -> built-in, never empty
  const w=mk(kt,()=>Promise.reject(new TypeError('offline')),'http://localhost:8765/kitchen-tasks.html');
  for(let i=0;i<120 && !w.document.querySelector('.op-grid');i++) await sleep(5);
  ok("built-in last resort keeps the kitchen working", w.eval('ROSTER_SOURCE')==='built-in', w.eval('ROSTER_SOURCE'));
  ok("picker never empty", w.document.querySelectorAll('.op-grid a').length===12);
}
// ---- #2 supervisor view ----
const SUM={ok:true,date:'2026-07-31',hasData:true,totalDishes:312,totalWaste:14,entries:3,people:2,
  byPerson:[{employee:'Joel',role:'Main',dishes:200,waste:10,minutes:420,perHour:28.6},
            {employee:'Anny',role:'Assist',dishes:112,waste:4,minutes:240,perHour:28.0}],
  byDish:[{dish:'Club Sandwich',letter:'C',qty:200,waste:10},{dish:'Vegan Dal',letter:'S',qty:112,waste:4}],
  generatedAt:'2026-07-31T10:00:00Z'};
{
  const w=mk(sumh,(u)=>{ ok("requests the summary endpoint", String(u).includes('view=today')); return jsonRes(SUM); },
    'http://localhost:8765/summary.html');
  await sleep(150);
  const t=w.document.querySelector('main').textContent;
  ok("shows total dishes", /312/.test(t));
  ok("shows waste with a share of total", /14/.test(t) && /%/.test(t), (t.match(/[\d.]+%/)||[''])[0]);
  ok("lists both people", /Joel/.test(t) && /Anny/.test(t));
  ok("shows per-hour rate", /28\.6/.test(t));
  ok("shows shift length as hours", /7h 00m/.test(t), (t.match(/\dh \d\dm/)||[''])[0]);
  ok("lists dishes by name not letter", /Club Sandwich/.test(t) && /Vegan Dal/.test(t));
  ok("draws a share bar per dish", w.document.querySelectorAll('.bar').length===2);
  ok("notes voided rows are excluded", /[Vv]oided/.test(t));
}
{ // no data for the date
  const w=mk(sumh,()=>jsonRes({ok:true,date:'2026-07-30',hasData:false,totalDishes:0,totalWaste:0,entries:0,byPerson:[],byDish:[]}),
    'http://localhost:8765/summary.html');
  await sleep(150);
  ok("empty day says so plainly", /Nothing recorded/i.test(w.document.querySelector('main').textContent));
  ok("mentions entries may have been undone", /undone/i.test(w.document.querySelector('main').textContent));
}
{ // backend not patched -> health check JSON, no summary fields
  const w=mk(sumh,()=>jsonRes({status:'ok',message:'Assembly Tracking API is running'}),
    'http://localhost:8765/summary.html');
  await sleep(150);
  const t=w.document.querySelector('main').textContent;
  ok("un-patched backend explains what to do", /apps-script-doPost/.test(t), t.slice(0,120));
}
{ // HTML error page
  const w=mk(sumh,()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html>Exception</html>')}),
    'http://localhost:8765/summary.html');
  await sleep(150);
  ok("HTML error page reported, not rendered", /Could not load/i.test(w.document.querySelector('main').textContent));
}
{ // offline
  const w=mk(sumh,()=>Promise.reject(new TypeError('offline')),'http://localhost:8765/summary.html');
  await sleep(150);
  ok("offline reported", /Could not load/i.test(w.document.querySelector('main').textContent));
}
{ // XSS via a dish name coming from the sheet
  const w=mk(sumh,()=>jsonRes({...SUM,byDish:[{dish:'<img src=x onerror=alert(1)>',letter:'C',qty:5,waste:0}]}),
    'http://localhost:8765/summary.html');
  await sleep(150);
  ok("sheet data is escaped, not injected", w.document.querySelectorAll('#dishes img').length===0);
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
