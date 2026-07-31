import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});

function boot(storage) {
  const dom = new JSDOM(html, { runScripts:'dangerously', url:'http://localhost:8765/', pretendToBeVisual:true });
  const w = dom.window;
  if (storage) for (const k in storage) w.localStorage.setItem(k, storage[k]);
  return { dom, w };
}
// re-boot with pre-seeded storage requires seeding BEFORE scripts run; jsdom runs on construction,
// so instead we seed, then re-parse in a fresh dom sharing that origin's storage via explicit set.
function bootWithDraft(draftJson) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost:8765/' });
  dom.window.localStorage.setItem('bb_assembly_draft_v1', draftJson);
  // now build the real page in a NEW jsdom but inject the draft before script eval
  const d2 = new JSDOM(html.replace('<script>', `<script>try{localStorage.setItem('bb_assembly_draft_v1', ${JSON.stringify(draftJson)});}catch(e){}\n`),
    { runScripts:'dangerously', url:'http://localhost:8765/', pretendToBeVisual:true });
  return d2.window;
}

function fill(w, {emp='Joel', role='Main', counts={A:'12',C:'30'}, comment='e2e'}={}) {
  w.document.getElementById('date').value = w.getTodayLocal();
  for (const l in counts) { const i=w.document.getElementById('dish_'+l); i.value=counts[l]; i.dispatchEvent(new w.Event('input')); }
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name===emp).click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role===role).click();
  const c=w.document.getElementById('comment'); c.value=comment; c.dispatchEvent(new w.Event('input'));
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ================= SCENARIO 1: genuine success =================
{
  const { w } = boot();
  let sentBody=null;
  w.fetch = (u,o)=>{ sentBody=o.body; return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"status":"ok","row":42}')}); };
  fill(w);
  ok("S1 draft exists before submit", !!w.localStorage.getItem('bb_assembly_draft_v1'));
  w.submitForm(); await sleep(60);
  ok("S1 success screen shown", w.document.getElementById('successScreen').classList.contains('visible'));
  ok("S1 form hidden", w.document.getElementById('formSection').style.display === 'none');
  ok("S1 draft CLEARED after confirmed success", w.localStorage.getItem('bb_assembly_draft_v1') === null);
  const p = JSON.parse(sentBody);
  ok("S1 payload dishes correct", p.dishes === 'A:12 | C:30', p.dishes);
  ok("S1 payload employee correct", JSON.stringify(p.employees)==='["Joel"]', JSON.stringify(p.employees));
  // "+ New Entry"
  w.resetForm();
  ok("S1 reset clears counts", w.document.getElementById('dish_A').value === '');
  ok("S1 reset zeroes total", w.document.getElementById('totalLine').textContent.includes('0 dish'));
  ok("S1 reset re-enables submit", w.document.getElementById('submitBtn').disabled === false);
}

// ============ SCENARIO 2: Apps Script threw -> HTML error page at HTTP 200 ============
{
  const { w } = boot();
  w.fetch = ()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html><body>Exception: Sheet not found</body></html>')});
  fill(w);
  w.submitForm(); await sleep(60);
  ok("S2 success screen NOT shown (was the silent-data-loss bug)", !w.document.getElementById('successScreen').classList.contains('visible'));
  ok("S2 error is visible", w.document.getElementById('errorMsg').classList.contains('visible'));
  ok("S2 error says NOT saved", /NOT saved/i.test(w.document.getElementById('errorMsg').textContent));
  ok("S2 DRAFT PRESERVED", !!w.localStorage.getItem('bb_assembly_draft_v1'));
  ok("S2 counts still on screen", w.document.getElementById('dish_A').value === '12');
  ok("S2 submit button re-enabled for retry", w.document.getElementById('submitBtn').disabled === false);
  ok("S2 button label restored", w.document.getElementById('submitBtn').textContent === 'Submit Entry');
}

// ============ SCENARIO 3: HTTP 500 and network reject ============
for (const [name, f] of [["HTTP 500", ()=>Promise.resolve({ok:false,status:500,text:()=>Promise.resolve('boom')})],
                          ["network reject", ()=>Promise.reject(new Error('Failed to fetch'))]]) {
  const { w } = boot(); w.fetch = f; fill(w);
  w.submitForm(); await sleep(60);
  ok(`S3 ${name}: no success screen`, !w.document.getElementById('successScreen').classList.contains('visible'));
  ok(`S3 ${name}: draft preserved`, !!w.localStorage.getItem('bb_assembly_draft_v1'));
}

// ============ SCENARIO 4: draft restore across a reload ============
{
  const { w:w1 } = boot();
  fill(w1, {emp:'Ranjith', role:'Assist', counts:{B:'7',D:'15'}, comment:'restore me'});
  const draft = w1.localStorage.getItem('bb_assembly_draft_v1');
  const w2 = bootWithDraft(draft);
  ok("S4 counts restored", w2.document.getElementById('dish_B').value === '7' && w2.document.getElementById('dish_D').value === '15',
     w2.document.getElementById('dish_B').value + "/" + w2.document.getElementById('dish_D').value);
  ok("S4 has-value highlight restored", w2.document.getElementById('tile_B').classList.contains('has-value'));
  ok("S4 total recomputed (22)", w2.document.getElementById('totalLine').textContent.includes('22'),
     w2.document.getElementById('totalLine').textContent);
  const chip=[...w2.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Ranjith');
  ok("S4 employee chip re-checked", chip.classList.contains('checked'));
  const others=[...w2.document.querySelectorAll('.emp-chip')].filter(c=>c!==chip);
  ok("S4 other chips disabled (form is submittable)", others.every(c=>c.classList.contains('disabled')));
  ok("S4 roles ENABLED after restore", !w2.document.getElementById('roleTabs').classList.contains('disabled'));
  ok("S4 role tab re-activated", [...w2.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Assist').classList.contains('active'));
  ok("S4 comment restored", w2.document.getElementById('comment').value === 'restore me');
}

// ============ SCENARIO 5: stale-week draft must be DISCARDED ============
{
  const { w:w1 } = boot();
  fill(w1, {counts:{A:'99'}});
  const d = JSON.parse(w1.localStorage.getItem('bb_assembly_draft_v1'));
  d.signature = d.signature.replace(/^A=[^|]*/, 'A=LAST WEEKS COMPLETELY DIFFERENT DISH');
  const w2 = bootWithDraft(JSON.stringify(d));
  ok("S5 stale-week draft DISCARDED (no wrong-dish count)", w2.document.getElementById('dish_A').value === '',
     "value=" + w2.document.getElementById('dish_A').value);
  ok("S5 stale draft purged from storage", w2.localStorage.getItem('bb_assembly_draft_v1') === null);
}

// ============ SCENARIO 6: yesterday's draft expires ============
{
  const { w:w1 } = boot();
  fill(w1, {counts:{A:'50'}});
  const d = JSON.parse(w1.localStorage.getItem('bb_assembly_draft_v1'));
  d.day = '2020-01-01'; d.savedAt = Date.now() - 40*3600*1000;
  const w2 = bootWithDraft(JSON.stringify(d));
  ok("S6 yesterday's draft discarded", w2.document.getElementById('dish_A').value === '');
}

// ============ SCENARIO 7: corrupt draft must not crash the page ============
{
  const w = bootWithDraft('{not json at all');
  ok("S7 corrupt draft does not break the page", w.document.querySelectorAll('.dish').length === w.eval('Object.keys(DISH_NAMES).length'));
  ok("S7 corrupt draft purged", w.localStorage.getItem('bb_assembly_draft_v1') === null);
}

let pass=0,fail=0;
for (const r of R){ if(r.t==='PASS'){pass++;console.log('  ✓ '+r.n);} else {fail++;console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:''));} }
console.log(`\n${pass} passed, ${fail} failed, ${R.length} total`);
process.exit(fail?1:0);
