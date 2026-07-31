import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot({fetchImpl=null,storage={}}={}) {
  const inj = html.replace('<script>', `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  const impl = fetchImpl || (()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')}));
  return new JSDOM(inj,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true,
    beforeParse(win){ win.fetch=impl; }}).window;
}
const L = w => w.eval('DISH_LETTERS[0]');

// ---- #5 +1 / +10 ----
{
  const w=boot(); const l=L(w);
  const tile=w.document.getElementById('tile_'+l);
  const [p1,p10]=[...tile.querySelectorAll('.bump-btn')];
  ok("every tile has +1 and +10", w.document.querySelectorAll('.dish .bump-btn').length === w.document.querySelectorAll('.dish').length*2);
  p1.click();
  ok("+1 sets 1", w.document.getElementById('dish_'+l).value==='1');
  p10.click(); p10.click();
  ok("+10 accumulates to 21", w.document.getElementById('dish_'+l).value==='21', w.document.getElementById('dish_'+l).value);
  ok("tile highlights", tile.classList.contains('has-value'));
  ok("running total follows the buttons", w.document.getElementById('totalLine').textContent.includes('21'), w.document.getElementById('totalLine').textContent);
  ok("draft saved from a button press", !!w.localStorage.getItem('bb_assembly_draft_v1'));
  // ceiling respected
  const max=w.eval('MAX_PER_DISH');
  w.document.getElementById('dish_'+l).value=String(max-3);
  p10.click();
  ok("+10 clamps at the ceiling", Number(w.document.getElementById('dish_'+l).value)===max, w.document.getElementById('dish_'+l).value);
  // typing still works
  const inp=w.document.getElementById('dish_'+l); inp.value='7'; inp.dispatchEvent(new w.Event('input'));
  ok("typing still works", w.document.getElementById('totalLine').textContent.includes('7'));
  // tapping a bump button must not open the keyboard
  const l2=w.eval('DISH_LETTERS[1]');
  const tile2=w.document.getElementById('tile_'+l2);
  tile2.querySelector('.bump-btn').click();
  ok("bump does not put the tile into typing mode", !tile2.classList.contains('editing'));
}
// ---- #6 glove mode ----
{
  const w=boot();
  const t=w.document.getElementById('gloveToggle');
  ok("toggle present", !!t);
  ok("off by default", !w.document.body.classList.contains('glove'));
  ok("aria-pressed false", t.getAttribute('aria-pressed')==='false');
  t.click();
  ok("glove mode on", w.document.body.classList.contains('glove'));
  ok("aria-pressed true", t.getAttribute('aria-pressed')==='true');
  ok("persisted", w.localStorage.getItem('bb_glove_v1')==='1');
  t.click();
  ok("toggles back off", !w.document.body.classList.contains('glove') && w.localStorage.getItem('bb_glove_v1')==='0');
}
{
  const w=boot({storage:{bb_glove_v1:'1'}});
  ok("glove mode restored on next load", w.document.body.classList.contains('glove'));
  ok("toggle reflects restored state", w.document.getElementById('gloveToggle').getAttribute('aria-pressed')==='true');
}
// ---- #4 waste ----
{
  let sent=null;
  const w=boot({fetchImpl:(u,o)=>{sent=JSON.parse(o.body);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  const l=L(w), l2=w.eval('DISH_LETTERS[1]');
  ok("every tile has a waste field", w.document.querySelectorAll('.dish .waste-inp').length===w.document.querySelectorAll('.dish').length);
  const set=(id,v)=>{const e=w.document.getElementById(id);e.value=v;e.dispatchEvent(new w.Event('input'));};
  set('dish_'+l,'20'); set('waste_'+l,'3');
  ok("waste tints the tile", w.document.getElementById('tile_'+l).classList.contains('has-waste'));
  ok("total shows waste separately", /20 dishes.*3 waste/.test(w.document.getElementById('totalLine').textContent), w.document.getElementById('totalLine').textContent);
  ok("waste is NOT added to the dish total", !/23/.test(w.document.getElementById('totalLine').textContent));
  // waste-only dish (dropped tray before any were finished)
  set('waste_'+l2,'5');
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
  w.submitForm(); await sleep(80);
  ok("waste rides along on the item", sent.items.find(i=>i.letter===l)?.waste===3, JSON.stringify(sent.items.find(i=>i.letter===l)));
  ok("waste-only dish still produces an item row", !!sent.items.find(i=>i.letter===l2 && i.qty===0 && i.waste===5), JSON.stringify(sent.items.find(i=>i.letter===l2)));
  ok("totalWaste summed", sent.totalWaste===8, String(sent.totalWaste));
  ok("legacy dishes string excludes waste-only dish", sent.dishes===l+':20', sent.dishes);
}
// ---- waste-only entry is submittable ----
{
  let sent=null;
  const w=boot({fetchImpl:(u,o)=>{sent=JSON.parse(o.body);return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});}});
  const l=L(w);
  const e=w.document.getElementById('waste_'+l); e.value='4'; e.dispatchEvent(new w.Event('input'));
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
  w.submitForm(); await sleep(80);
  ok("an entry that is only waste can be submitted", !!sent && sent.totalWaste===4, sent?JSON.stringify(sent.items):'not sent');
  ok("no false 'enter a quantity' error", !w.document.getElementById('errorMsg').classList.contains('visible'));
}
// ---- waste validation + draft round-trip ----
{
  const w=boot(); const l=L(w);
  const e=w.document.getElementById('waste_'+l); e.value='2.5'; e.dispatchEvent(new w.Event('input'));
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
  w.submitForm(); await sleep(50);
  ok("decimal waste is refused", w.document.getElementById('errorMsg').classList.contains('visible') && /whole numbers/i.test(w.document.getElementById('errorMsg').textContent), w.document.getElementById('errorMsg').textContent.slice(0,60));
}
{
  const w1=boot(); const l=L(w1);
  const set=(id,v)=>{const e=w1.document.getElementById(id);e.value=v;e.dispatchEvent(new w1.Event('input'));};
  w1.document.getElementById('date').value=w1.getTodayLocal();
  set('dish_'+l,'9'); set('waste_'+l,'2');
  const draft=w1.localStorage.getItem('bb_assembly_draft_v1');
  const w2=boot({storage:{bb_assembly_draft_v1:draft}});
  ok("waste survives a reload", w2.document.getElementById('waste_'+l).value==='2', w2.document.getElementById('waste_'+l).value);
  ok("waste tint restored", w2.document.getElementById('tile_'+l).classList.contains('has-waste'));
  ok("total restored with waste", /9 dishes.*2 waste/.test(w2.document.getElementById('totalLine').textContent), w2.document.getElementById('totalLine').textContent);
  w2.resetForm();
  ok("reset clears waste", w2.document.getElementById('waste_'+l).value==='');
  ok("reset clears waste tint", !w2.document.getElementById('tile_'+l).classList.contains('has-waste'));
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
