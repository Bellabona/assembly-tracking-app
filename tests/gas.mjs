import { readFileSync } from 'fs';
const R=[]; const ok=(n,c,d="")=>R.push({t:c?"PASS":"FAIL",n,d});

// ---- Minimal Google Apps Script environment -------------------------------
function makeEnv() {
  const sheets = {};
  function mkSheet(name){
    const rows=[];
    return { name, rows,
      appendRow:r=>rows.push(r.slice()),
      getLastRow:()=>rows.length,
      getLastColumn:()=>rows.reduce((m,r)=>Math.max(m,r.length),0),
      setFrozenRows(){},
      getRange:(r,c,nr,nc)=>({
        getValues:()=>Array.from({length:nr||1},(_,i)=>Array.from({length:nc||1},(_,j)=>(rows[r-1+i]||[])[c-1+j])),
        setValues:v=>{v.forEach((row,i)=>{rows[r-1+i]=row.slice();});},
        // real Apps Script Range has setValue for a single cell
        setValue:v=>{ if(!rows[r-1]) rows[r-1]=[]; rows[r-1][c-1]=v; },
        getValue:()=>(rows[r-1]||[])[c-1]
      })};
  }
  const ss={ getSheetByName:n=>sheets[n]||null, insertSheet:n=>(sheets[n]=mkSheet(n)) };
  const env={
    sheets,
    SpreadsheetApp:{ getActiveSpreadsheet:()=>ss },
    LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){}}) },
    Utilities:{ formatDate:(d,tz,fmt)=>{
      const p=n=>String(n).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    }},
    Session:{ getScriptTimeZone:()=>'Europe/Berlin' },
    ContentService:{ MimeType:{JSON:'json'},
      createTextOutput:t=>({_t:t,setMimeType(){return this;},getContent(){return this._t;}}) },
    console,
    // the user's existing doPost, renamed
    handleEntry:(e)=>{ const d=JSON.parse(e.postData.contents);
      const s=sheets['Entries']||(sheets['Entries']=mkSheet('Entries'));
      s.appendRow([new Date(),d.date,(d.employees||[]).join(', '),d.dishes,d.role,d.comment||'']);
      return s.getLastRow(); },
  };
  return env;
}
const src=readFileSync('/Users/abbassalloum/assembly-tracking-app/tools/apps-script-doPost.gs','utf8');
function run(env){
  const keys=Object.keys(env);
  // eslint-disable-next-line no-new-func
  const f=new Function(...keys, src + '\nreturn {doPost:doPost, doGet:doGet};');
  return f(...keys.map(k=>env[k]));
}
const post=(api,body)=>JSON.parse(api.doPost({postData:{contents:JSON.stringify(body)}}).getContent());

const ENTRY={date:'2026-07-31',employees:['Joel'],dishes:'A:12 | C:30',role:'Main',comment:'x',
  items:[{letter:'A',dish:'High-Protein Chicken and Rice Bowl',qty:12},
         {letter:'C',dish:'Club Sandwich',qty:30}],
  entryId:'e-1',clientTime:'2026-07-31T09:00:00Z',tz:'Europe/Berlin',appVersion:'2026.07.31'};

// ---- 1. happy path -------------------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const r=post(api,ENTRY);
  ok("returns ok:true with row + item count", r.ok===true && r.items===2 && typeof r.row==='number', JSON.stringify(r));
  ok("original sheet still gets exactly 1 row (reports unaffected)", env.sheets['Entries'].rows.length===1);
  const it=env.sheets['AssemblyItems'];
  ok("AssemblyItems tab created with header", it && it.rows[0][0]==='recorded_at');
  ok("one row per dish", it.rows.length===3, "rows="+it.rows.length);
  const H1=it.rows[0];
  ok("dish NAME stored", it.rows[1][H1.indexOf('dish_name')]==='High-Protein Chicken and Rice Bowl', it.rows[1][H1.indexOf('dish_name')]);
  ok("qty numeric", it.rows[1][H1.indexOf('qty')]===12 && typeof it.rows[1][H1.indexOf('qty')]==='number');
  ok("entry_id stored", it.rows[1][H1.indexOf('entry_id')]==='e-1', String(it.rows[1][H1.indexOf('entry_id')]));
  ok("tz + version stored", it.rows[1][H1.indexOf('tz')]==='Europe/Berlin' && it.rows[1][H1.indexOf('app_version')]==='2026.07.31', it.rows[1][H1.indexOf('tz')]+'/'+it.rows[1][H1.indexOf('app_version')]);
}
// ---- 2. idempotency ------------------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  post(api,ENTRY);
  const r2=post(api,ENTRY);
  ok("replay flagged duplicate", r2.ok===true && r2.duplicate===true, JSON.stringify(r2));
  ok("replay wrote NO extra item rows", env.sheets['AssemblyItems'].rows.length===3);
  ok("replay wrote NO extra entry row", env.sheets['Entries'].rows.length===1);
  const r3=post(api,{...ENTRY,entryId:'e-2'});
  ok("a different entryId DOES write", r3.ok===true && env.sheets['Entries'].rows.length===2);
}
// ---- 3. legacy client (no items[]) --------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const r=post(api,{date:'2026-07-31',employees:['Anny'],dishes:'B:7 | D:15',role:'Assist',entryId:'old-1'});
  ok("legacy packed string still produces per-dish rows", r.items===2, JSON.stringify(r));
  const it=env.sheets['AssemblyItems'];
  const H3=it.rows[0];
  ok("legacy rows keep letters", it.rows[1][H3.indexOf('dish_letter')]==='B' && it.rows[2][H3.indexOf('dish_letter')]==='D');
  ok("legacy rows have empty dish_name (the gap this closes)", it.rows[1][H3.indexOf('dish_name')]==='');
}
// ---- 4. failures -------------------------------------------------------
{
  const env=makeEnv();
  env.handleEntry=()=>{ throw new Error('Sheet not found'); };
  const api=run(env);
  const r=post(api,ENTRY);
  ok("throw in handleEntry -> explicit JSON error", r.ok===false && r.status==='error' && /Sheet not found/.test(r.error), JSON.stringify(r));
  ok("no partial item rows on failure", !env.sheets['AssemblyItems']);
}
{
  // per-dish write fails but the entry itself saved: must NOT lose the entry
  const env=makeEnv(); const api=run(env);
  const realInsert=env.SpreadsheetApp.getActiveSpreadsheet().insertSheet;
  env.SpreadsheetApp.getActiveSpreadsheet().insertSheet=()=>{throw new Error('quota');};
  const r=post(api,ENTRY);
  ok("item-row failure still reports the entry as SAVED", r.ok===true, JSON.stringify(r));
  ok("entry row was kept", env.sheets['Entries'].rows.length===1);
}
// ---- 5. doGet ----------------------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const g=JSON.parse(api.doGet().getContent());
  ok("doGet returns JSON status ok", g.status==='ok');
}

// ---- 6. HACCP check routing ---------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const chk={type:'haccp_check',checkId:'c-9',planDate:'2026-04-22',kitchen:'Berlin',week:'W17',
    operator:'Salman Iqbal',checkKind:'haccp',label:'Core temp \u226575\u00B0C after cook',
    done:true,clientTime:'2026-07-31T21:10:00Z',tz:'Europe/Berlin',device:'d-1',appVersion:'2026.07.31'};
  const r=post(api,chk);
  ok("haccp_check routed and stored", r.ok===true && typeof r.row==='number', JSON.stringify(r));
  const h=env.sheets['HaccpChecks'];
  ok("HaccpChecks tab created with header", h && h.rows[0][0]==='recorded_at');
  const H2=h.rows[0];
  ok("instruction text stored verbatim", h.rows[1][H2.indexOf('label')]==='Core temp \u226575\u00B0C after cook', h.rows[1][H2.indexOf('label')]);
  ok("done recorded as YES", h.rows[1][H2.indexOf('done')]==='YES');
  ok("operator + device + check_id stored", h.rows[1][H2.indexOf('operator')]==='Salman Iqbal' && h.rows[1][H2.indexOf('device')]==='d-1' && h.rows[1][H2.indexOf('check_id')]==='c-9');
  ok("haccp check did NOT touch the entries sheet", !env.sheets['Entries']);
  ok("haccp check did NOT touch AssemblyItems", !env.sheets['AssemblyItems']);
  // untick appends a second row rather than overwriting
  post(api,{...chk,checkId:'c-10',done:false});
  ok("untick appended as its own row (audit trail kept)", h.rows.length===3 && h.rows[2][H2.indexOf('done')]==='no', "rows="+h.rows.length);
}


// ---- 7. void_entry (undo) -----------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const E={...ENTRY, entryId:'v-1', startTime:'21:00', endTime:'04:00', shiftMinutes:420,
    items:[{letter:'A',dish:'Chicken Bowl',qty:12,waste:2},{letter:'C',dish:'Club Sandwich',qty:30,waste:0}]};
  post(api,E);
  const it=env.sheets['AssemblyItems'];
  const H=it.rows[0];
  ok("waste column stored", it.rows[1][H.indexOf('waste')]===2, String(it.rows[1][H.indexOf('waste')]));
  ok("shift times stored", it.rows[1][H.indexOf('start_time')]==='21:00' && it.rows[1][H.indexOf('shift_minutes')]===420);
  ok("voided starts empty", it.rows[1][H.indexOf('voided')]==='');
  const r=post(api,{type:'void_entry',entryId:'v-1',reason:'undo by user'});
  ok("void reports how many rows it marked", r.ok===true && r.voided===2, JSON.stringify(r));
  ok("rows are marked, not deleted (log stays append-only)", it.rows.length===3);
  ok("both rows stamped VOID", /^VOID /.test(it.rows[1][H.indexOf('voided')]) && /^VOID /.test(it.rows[2][H.indexOf('voided')]),
     String(it.rows[1][H.indexOf('voided')]).slice(0,30));
  ok("stamp records the reason", /undo by user/.test(it.rows[1][H.indexOf('voided')]));
  const r2=post(api,{type:'void_entry',entryId:'nope'});
  ok("voiding an unknown id marks nothing", r2.ok===true && r2.voided===0);
  ok("void did not touch the entries sheet", env.sheets['Entries'].rows.length===1);
}


// ---- 8. doGet: roster + summary ------------------------------------------
{
  const env=makeEnv(); const api=run(env);
  const get=(p)=>JSON.parse(api.doGet({parameter:p}).getContent());
  ok("bare GET keeps the old health check", get({}).status==='ok');
  ok("roster with no Roster tab returns empty (client keeps its list)",
     JSON.stringify(get({view:'roster'}).employees)==='[]');
  // add a Roster tab
  const rs=env.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Roster');
  rs.appendRow(['employee']); rs.appendRow(['Zara']); rs.appendRow(['Joel']); rs.appendRow(['']); rs.appendRow(['Joel']);
  const r=get({view:'roster'});
  ok("roster read from the sheet", JSON.stringify(r.employees)==='["Zara","Joel"]', JSON.stringify(r.employees));
  ok("blanks and duplicates dropped", r.employees.length===2);
}
{
  const env=makeEnv(); const api=run(env);
  const get=(p)=>JSON.parse(api.doGet({parameter:p}).getContent());
  ok("summary with no data says hasData:false", get({view:'today',date:'2026-07-31'}).hasData===false);

  post(api,{...ENTRY, entryId:'s-1', date:'2026-07-31', employees:['Joel'], role:'Main',
    startTime:'21:00', endTime:'04:00', shiftMinutes:420,
    items:[{letter:'C',dish:'Club Sandwich',qty:200,waste:10},{letter:'S',dish:'Vegan Dal',qty:60,waste:0}]});
  post(api,{...ENTRY, entryId:'s-2', date:'2026-07-31', employees:['Anny'], role:'Assist',
    startTime:'22:00', endTime:'02:00', shiftMinutes:240,
    items:[{letter:'S',dish:'Vegan Dal',qty:52,waste:4}]});
  post(api,{...ENTRY, entryId:'s-3', date:'2026-07-30', employees:['Joel'], role:'Main',
    items:[{letter:'C',dish:'Club Sandwich',qty:999,waste:0}]});

  const d=get({view:'today',date:'2026-07-31'});
  ok("totals only that date", d.totalDishes===312, String(d.totalDishes));
  ok("waste summed", d.totalWaste===14, String(d.totalWaste));
  ok("distinct entries counted", d.entries===2, String(d.entries));
  ok("people aggregated and sorted by volume", d.byPerson[0].employee==='Joel' && d.byPerson[0].dishes===260,
     JSON.stringify(d.byPerson.map(p=>p.employee+':'+p.dishes)));
  ok("shift minutes taken as max, not summed (would be 840)", d.byPerson[0].minutes===420, String(d.byPerson[0].minutes));
  ok("per-hour computed", d.byPerson[0].perHour===37.1, String(d.byPerson[0].perHour));
  ok("dish mix merges the same dish across people", d.byDish.find(x=>x.dish==='Vegan Dal').qty===112,
     JSON.stringify(d.byDish.map(x=>x.dish+':'+x.qty)));
  ok("dish mix sorted by volume", d.byDish[0].dish==='Club Sandwich');
  ok("other dates excluded", !JSON.stringify(d).includes('999'));

  // voiding must remove it from the summary
  post(api,{type:'void_entry',entryId:'s-2',reason:'undo'});
  const d2=get({view:'today',date:'2026-07-31'});
  ok("voided entry drops out of the totals", d2.totalDishes===260 && d2.totalWaste===10,
     d2.totalDishes+'/'+d2.totalWaste);
  ok("voided person drops out", d2.byPerson.length===1 && d2.byPerson[0].employee==='Joel');
  ok("voided dish qty reduced", d2.byDish.find(x=>x.dish==='Vegan Dal').qty===60, JSON.stringify(d2.byDish.map(x=>x.dish+':'+x.qty)));
}

let p=0,f=0; for(const r of R){r.t==='PASS'?(p++,console.log('  ✓ '+r.n)):(f++,console.log('  ✗ '+r.n+(r.d?'   -> '+r.d:'')));}
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
