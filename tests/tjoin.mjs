/*
 * Joining a shift somebody already logged.
 *
 * Several cooks work a batch together and each used to log the whole of it under their own name,
 * so one 698-dish night arrived as four entries and the dashboard read 2.792. The server now
 * joins a matching submission to the shift already on the record and credits the sender as a
 * helper instead of writing a second one.
 *
 * What is tested here is that the cook is TOLD. A join nobody expected has to be visible on the
 * phone that caused it, not discovered weeks later by somebody reconciling a bonus.
 *
 * The path is resolved from this file rather than hard-coded, so the suite runs wherever the
 * repository is checked out.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const R = []; const ok = (n, c, d = "") => R.push({ t: c ? "PASS" : "FAIL", n, d });

const boot = () => new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost:8765/', pretendToBeVisual: true,
}).window;

function fill(w, emp = 'Anny') {
  w.document.getElementById('date').value = w.getTodayLocal();
  const i = w.document.getElementById('dish_A'); i.value = '12';
  i.dispatchEvent(new w.Event('input'));
  [...w.document.querySelectorAll('.emp-chip')].find(c => c.dataset.name === emp).click();
  [...w.document.querySelectorAll('.role-tab')][0].click();
}
const reply = (w, body) => { w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const title = w => w.document.getElementById('successTitle').textContent;
const detail = w => w.document.getElementById('successDetail').textContent;

// ───────── the server joined this to a colleague's shift ─────────
{
  const w = boot();
  reply(w, JSON.stringify({ ok: true, joined: true, entryId: 'abc',
    leadEmployee: 'Sreyas', totalDishes: 688, alreadyCredited: false }));
  fill(w); w.submitForm(); await sleep(60);

  ok("joined: success screen is shown", w.document.getElementById('successScreen').classList.contains('visible'));
  ok("joined: title says you are on the shift, not 'Saved!'",
    title(w) === "You're on this shift", title(w));
  ok("joined: names the cook who logged it", detail(w).includes('Sreyas'), detail(w));
  ok("joined: shows the shift's own total, not what was typed",
    detail(w).includes('688'), detail(w));
  ok("joined: says it was counted once", /counted once/i.test(detail(w)), detail(w));
  /*
   * The entry on the record belongs to the colleague and the id this phone generated was never
   * used, so undo would have quietly done nothing — and taking somebody else's shift away is not
   * what that button should do either.
   */
  ok("joined: undo is NOT offered", w.document.getElementById('undoBtn').hidden === true);
  ok("joined: draft still cleared", w.localStorage.getItem('bb_assembly_draft_v1') === null);
}

// ───────── already credited: a second tap of the same thing ─────────
{
  const w = boot();
  reply(w, JSON.stringify({ ok: true, joined: true, entryId: 'abc',
    leadEmployee: 'Sreyas', totalDishes: 688, alreadyCredited: true }));
  fill(w); w.submitForm(); await sleep(60);
  ok("already on it: says nothing was double counted",
    /nothing was counted twice/i.test(detail(w)), detail(w));
  ok("already on it: undo still not offered", w.document.getElementById('undoBtn').hidden === true);
}

// ───────── an ordinary save is untouched ─────────
{
  const w = boot();
  reply(w, JSON.stringify({ ok: true, entryId: 'xyz', totalDishes: 12 }));
  fill(w); w.submitForm(); await sleep(60);
  ok("normal save: title is still 'Saved!'", title(w) === 'Saved!', title(w));
  ok("normal save: shows the dishes back", /12/.test(detail(w)), detail(w));
  ok("normal save: undo IS offered", w.document.getElementById('undoBtn').hidden === false);
}

// ───────── the next entry starts clean ─────────
{
  const w = boot();
  reply(w, JSON.stringify({ ok: true, joined: true, entryId: 'abc',
    leadEmployee: 'Sreyas', totalDishes: 688, alreadyCredited: false }));
  fill(w); w.submitForm(); await sleep(60);
  w.resetForm();
  ok("reset: title goes back to 'Saved!' for the next entry", title(w) === 'Saved!', title(w));
  ok("reset: form is back", w.document.getElementById('formSection').style.display === '');
}

for (const r of R) console.log(`${r.t === 'PASS' ? '✓' : '✗'} ${r.n}${r.t === 'PASS' ? '' : '  → ' + r.d}`);
const bad = R.filter(r => r.t === 'FAIL').length;
console.log(`\n${R.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
