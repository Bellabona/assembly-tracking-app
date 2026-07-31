import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
const html = readFileSync('/Users/abbassalloum/assembly-tracking-app/index.html','utf8');
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot({storage={},lang='en-GB'}={}) {
  const inj = html.replace('<script>', `<script>try{${Object.entries(storage).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}\n`);
  return new JSDOM(inj,{runScripts:'dangerously',url:'http://localhost:8765/',pretendToBeVisual:true,
    beforeParse(win){
      Object.defineProperty(win.navigator,'language',{value:lang,configurable:true});
      win.fetch=(u)=>String(u).includes('view=roster')
        ? Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"status":"ok"}')})
        : Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"ok":true}')});
    }}).window;
}
// ---- switcher + coverage ----
{
  const w=boot();
  ok("EN/DE buttons present", w.document.querySelectorAll('.lang-btn').length===2);
  ok("defaults to EN for an en browser", w.eval('LANG')==='en');
  ok("EN marked pressed", w.document.querySelector('.lang-btn[data-lang=en]').getAttribute('aria-pressed')==='true');
  ok("English labels", /Dishes assembled/.test(w.document.getElementById('labDishes').textContent));

  w.setLang('de');
  ok("switches to DE", w.eval('LANG')==='de');
  ok("html lang attribute updated", w.document.documentElement.lang==='de');
  ok("date label translated", w.document.getElementById('labDate').textContent==='Datum', w.document.getElementById('labDate').textContent);
  ok("team label translated", /Namen antippen/.test(w.document.getElementById('labTeam').textContent));
  ok("dishes label translated", /Montierte Gerichte/.test(w.document.getElementById('labDishes').textContent));
  ok("role label translated", w.document.getElementById('labRole').textContent==='Rolle');
  ok("hours label translated", /Arbeitszeit/.test(w.document.getElementById('labHours').textContent));
  ok("from/to translated", w.document.getElementById('labFrom').textContent==='Von' && w.document.getElementById('labTo').textContent==='Bis');
  ok("comment label translated", /Kommentar/.test(w.document.getElementById('labComment').textContent));
  ok("placeholder translated", /Notizen/.test(w.document.getElementById('comment').placeholder));
  ok("submit button translated", w.document.getElementById('submitBtn').textContent==='Eintrag senden', w.document.getElementById('submitBtn').textContent);
  ok("glove toggle translated", /Handschuhmodus/.test(w.document.getElementById('gloveToggle').textContent));
  ok("waste labels translated", [...w.document.querySelectorAll('.waste-lab')].every(e=>e.textContent==='Ausschuss'));
  ok("total line translated", /^Gesamt:/.test(w.document.getElementById('totalLine').textContent), w.document.getElementById('totalLine').textContent);
  ok("new-entry button translated", /Neuer Eintrag/.test(w.document.querySelector('.btn-again').textContent));
  ok("DE now marked pressed", w.document.querySelector('.lang-btn[data-lang=de]').getAttribute('aria-pressed')==='true');
  ok("persisted", w.localStorage.getItem('bb_lang_v1')==='de');
}
// ---- switching mid-entry must not lose data ----
{
  const w=boot(); const l=w.eval('DISH_LETTERS[0]');
  const e=w.document.getElementById('dish_'+l); e.value='42'; e.dispatchEvent(new w.Event('input'));
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  w.setLang('de');
  ok("counts survive a language switch", w.document.getElementById('dish_'+l).value==='42');
  ok("selection survives", w.document.querySelector('.emp-chip.checked')?.dataset.name==='Joel');
  ok("total re-rendered in German with the same number", /Gesamt: 42/.test(w.document.getElementById('totalLine').textContent),
     w.document.getElementById('totalLine').textContent);
}
// ---- stored choice beats the browser ----
{
  const w=boot({storage:{bb_lang_v1:'de'},lang:'en-GB'});
  ok("stored DE wins over an EN browser", w.eval('LANG')==='de');
}
{
  const w=boot({lang:'de-DE'});
  ok("a German browser starts in DE", w.eval('LANG')==='de');
}
{ // not auto-flipped by the browser once a choice exists
  const w=boot({storage:{bb_lang_v1:'en'},lang:'de-DE'});
  ok("stored EN is not overridden by a DE browser", w.eval('LANG')==='en');
}
// ---- errors and rate line translate ----
{
  const w=boot(); w.setLang('de');
  w.document.getElementById('date').value='';
  w.submitForm(); await sleep(40);
  ok("validation error in German", /Datum auswählen/.test(w.document.getElementById('errorMsg').textContent),
     w.document.getElementById('errorMsg').textContent);
}
{
  const w=boot(); w.setLang('de');
  const l=w.eval('DISH_LETTERS[0]');
  const e=w.document.getElementById('dish_'+l); e.value='2.5'; e.dispatchEvent(new w.Event('input'));
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
  w.submitForm(); await sleep(40);
  ok("decimal error in German", /ganze Zahlen/.test(w.document.getElementById('errorMsg').textContent),
     w.document.getElementById('errorMsg').textContent.slice(0,60));
}
{
  const w=boot(); w.setLang('de');
  const l=w.eval('DISH_LETTERS[0]');
  const e=w.document.getElementById('dish_'+l); e.value='60'; e.dispatchEvent(new w.Event('input'));
  const s=w.document.getElementById('startTime'); s.value='08:00'; s.dispatchEvent(new w.Event('change'));
  const en=w.document.getElementById('endTime'); en.value='12:00'; en.dispatchEvent(new w.Event('change'));
  ok("rate line in German", /Gerichte\/Stunde/.test(w.document.getElementById('rateLine').textContent),
     w.document.getElementById('rateLine').textContent);
}
// ---- saved / queued screens translate ----
{
  const w=boot(); w.setLang('de');
  const l=w.eval('DISH_LETTERS[0]');
  const e=w.document.getElementById('dish_'+l); e.value='5'; e.dispatchEvent(new w.Event('input'));
  w.document.getElementById('date').value=w.getTodayLocal();
  [...w.document.querySelectorAll('.emp-chip')].find(c=>c.dataset.name==='Joel').click();
  [...w.document.querySelectorAll('.role-tab')].find(t=>t.dataset.role==='Main').click();
  w.submitForm(); await sleep(70);
  ok("undo button in German", /zurücknehmen/.test(w.document.getElementById('undoBtn').textContent),
     w.document.getElementById('undoBtn').textContent);
  w.resetForm();
  ok("reset restores the German 'Saved' wording", w.document.querySelector('.success-title').textContent==='Gespeichert!',
     w.document.querySelector('.success-title').textContent);
}
// ---- no key falls through to English rather than showing a raw key ----
{
  const w=boot();
  ok("unknown key falls back readably", w.eval('t("definitelyNotAKey")')==='definitelyNotAKey');
  ok("every EN key has a DE translation",
     w.eval('Object.keys(STRINGS.en).filter(k=>!STRINGS.de[k]).length')===0,
     w.eval('JSON.stringify(Object.keys(STRINGS.en).filter(k=>!STRINGS.de[k]))'));
  ok("no DE key missing from EN",
     w.eval('Object.keys(STRINGS.de).filter(k=>!STRINGS.en[k]).length')===0);
}
let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
