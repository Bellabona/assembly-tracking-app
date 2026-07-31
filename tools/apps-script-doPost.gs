/**
 * PASTE-IN PATCH for the Assembly Tracking Apps Script.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * index.html cannot currently tell a successful save from a failed one.
 *
 * When an Apps Script web app throws an uncaught exception it does NOT return
 * an HTTP error. It returns HTTP 200 with an HTML error page. The old client
 * did `.then(() => showSuccess())`, so a failed write showed staff the green
 * checkmark and the entry was silently gone.
 *
 * The client now inspects the response body and rejects HTML error pages and
 * explicit JSON errors. That closes the common case, but it is still inference:
 * an empty 200, or a body this script never intended as a confirmation, still
 * reads as success. The only way to make it exact is for doPost to SAY so.
 *
 * Once this patch is in, the client's `looksLikeSaveFailure()` has an
 * unambiguous contract to check:
 *     success -> {"ok": true,  "row": 128}
 *     failure -> {"ok": false, "status": "error", "error": "..."}
 *
 * ---------------------------------------------------------------------------
 * HOW TO APPLY  (about two minutes)
 * ---------------------------------------------------------------------------
 * 1. Open the Apps Script project bound to the Assembly Tracking sheet.
 * 2. Rename your existing `doPost` to `handleEntry`. Change nothing inside it,
 *    except make it return the row number it wrote if that is easy -- e.g.
 *    `return sheet.getLastRow();`. If that is awkward, return nothing; the
 *    wrapper below copes.
 * 3. Paste everything from this file in alongside it.
 *
 *    NOTHING YOU ALREADY HAVE CHANGES. Your existing sheet keeps its columns and
 *    its one-row-per-entry shape, so every report built on it is unaffected. This
 *    patch is purely additive and does three things:
 *      a) returns real JSON so the client can confirm a save (see WHY below);
 *      b) ignores a replayed entryId, so a double tap or a retry after an
 *         ambiguous failure cannot append the same shift twice;
 *      c) writes one row per dish to a NEW tab, 'AssemblyItems', carrying the
 *         dish NAME. Letters are reassigned weekly -- in the 03.08 menu 21 of 22
 *         letters changed dish -- so letter-only history cannot be interpreted
 *         after the fact. The tab is created automatically on first use.
 *    If the per-dish write ever fails, the entry itself is still saved and still
 *    reported as saved: that path is deliberately non-fatal.
 * 4. Deploy > Manage deployments > edit the active deployment > Deploy.
 *    IMPORTANT: keep the SAME deployment so the /exec URL does not change --
 *    that URL is hardcoded as SCRIPT_URL in index.html.
 * 5. Verify from a terminal. This writes a real row, so delete it afterwards:
 *
 *      curl -sL -X POST \
 *        -H 'Content-Type: text/plain;charset=utf-8' \
 *        -d '{"date":"2026-01-01","employees":["TEST"],"dishes":"A:1","role":"Main","comment":"delete me"}' \
 *        'https://script.google.com/macros/s/AKfycbyvz8zUDJp7D3Ei4aqS3qQ9rp8clITa1_Vy8o_mVnqC2K6TXntM5CKYvklfaIJ4fQ8tnw/exec'
 *
 *    Expected: {"ok":true,"row":<n>}
 *
 * The client already handles both shapes, so applying this cannot break the
 * deployed page, and the page keeps working if you never apply it.
 */


/**
 * Wraps the existing write so the client gets a definite answer either way.
 * Every path returns JSON, and any throw becomes an explicit failure instead
 * of an HTML page that merely looks like one.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Two phones submitting at the same instant would otherwise interleave their
    // appendRow calls and could both pass the duplicate check below.
    lock.waitLock(20000);

    var data = JSON.parse(e.postData.contents);

    // --- HACCP checks from kitchen-tasks.html ------------------------------
    // Those ticks used to live only in one phone's localStorage, which is not a
    // retainable record. They now post here. Append-only, including unticks: an
    // audit trail that drops a retraction is worse than no trail.
    if (data.type === 'haccp_check') {
      return jsonOut({ ok: true, status: 'ok', row: appendHaccpCheck_(data) });
    }

    // --- Undo, from the 60s window after a save ----------------------------
    // Marks the entry void rather than deleting rows. An append-only log is what
    // makes this sheet trustworthy: a silent delete would change numbers under
    // anyone who had already read them, and would leave no trace that an entry
    // ever existed. Filter voided = "" in reports to exclude them.
    if (data.type === 'void_entry') {
      return jsonOut({ ok: true, status: 'ok', voided: voidEntry_(data) });
    }

    // --- Idempotency -------------------------------------------------------
    // The client sends one entryId per attempt and reuses it across retries, so
    // a double tap or a retry after an ambiguous failure lands here twice with
    // the same id. Recognise it and report success WITHOUT writing again.
    if (data.entryId && alreadyRecorded_(data.entryId)) {
      return jsonOut({ ok: true, status: 'ok', duplicate: true });
    }

    var row = handleEntry(e);

    // --- Durable per-dish rows --------------------------------------------
    // Additive: handleEntry still writes your original row to your original
    // sheet, so existing reports are untouched. This adds one row per dish to a
    // SEPARATE tab, carrying the dish NAME so the history stays interpretable
    // after the weekly task reassigns letters.
    var items = 0;
    try {
      items = appendItemRows_(data);
    } catch (itemErr) {
      // A failure here must not lose the entry that already saved successfully.
      console.error('per-dish rows failed (entry itself saved): ' +
                    (itemErr && itemErr.stack ? itemErr.stack : itemErr));
    }

    var payload = { ok: true, status: 'ok', items: items };
    if (typeof row === 'number' && isFinite(row)) {
      payload.row = row;
    }
    return jsonOut(payload);

  } catch (err) {
    // Log it so a failed shift entry is diagnosable after the fact:
    // Apps Script dashboard > Executions.
    console.error('assembly entry failed: ' + (err && err.stack ? err.stack : err));

    return jsonOut({
      ok: false,
      status: 'error',
      error: String((err && err.message) ? err.message : err)
    });

  } finally {
    try { lock.releaseLock(); } catch (e2) { /* never mask the real result */ }
  }
}


/** Name of the additive per-dish tab. Your existing sheet is never touched. */
var ITEMS_SHEET = 'AssemblyItems';

/** Append-only log of HACCP ticks from kitchen-tasks.html. */
var HACCP_SHEET = 'HaccpChecks';


function haccpHeader_() {
  return ['recorded_at', 'plan_date', 'kitchen', 'week', 'operator',
          'check_kind', 'station', 'dish_letter', 'label', 'done',
          'client_time', 'tz', 'device', 'check_id', 'app_version'];
}


/**
 * Appends one row per tick or untick. Returns the row number written.
 *
 * Deliberately append-only rather than one row per check that gets overwritten:
 * for monitoring records you want the history, including who unticked what and
 * when. `check_id` makes each row individually traceable and lets the client
 * retry safely -- a replay is a rare duplicate row in a log, which is harmless,
 * whereas a dropped check is not.
 */
function appendHaccpCheck_(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HACCP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HACCP_SHEET);
    sh.appendRow(haccpHeader_());
    sh.setFrozenRows(1);
  }
  sh.appendRow([
    new Date(), data.planDate || '', data.kitchen || '', data.week || '',
    data.operator || '', data.checkKind || '', data.station || '',
    data.dishLetter || '', data.label || '', data.done ? 'YES' : 'no',
    data.clientTime || '', data.tz || '', data.device || '',
    data.checkId || '', data.appVersion || ''
  ]);
  return sh.getLastRow();
}


/**
 * True if this entryId has been written before.
 *
 * Uses the Items tab's entry_id column as the source of truth rather than a
 * cache, so dedupe still works after a script restart or a cache eviction.
 */
function alreadyRecorded_(entryId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ITEMS_SHEET);
  if (!sh || sh.getLastRow() < 2) return false;

  var col = itemsHeader_().indexOf('entry_id') + 1;
  if (col < 1) return false;

  var ids = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(entryId)) return true;
  }
  return false;
}


function itemsHeader_() {
  return ['recorded_at', 'entry_date', 'employee', 'role',
          'dish_letter', 'dish_name', 'qty', 'waste',
          'start_time', 'end_time', 'shift_minutes',
          'comment', 'entry_id', 'client_time', 'tz', 'app_version', 'voided'];
}


/**
 * Marks every AssemblyItems row for an entryId as void. Returns how many rows.
 *
 * Nothing is deleted, so the log stays append-only and an undo is itself visible.
 * Exclude voided rows in reports with a `voided = ""` filter.
 */
function voidEntry_(data) {
  if (!data.entryId) return 0;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ITEMS_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;

  var header = itemsHeader_();
  var idCol    = header.indexOf('entry_id') + 1;
  var voidCol  = header.indexOf('voided') + 1;
  if (idCol < 1 || voidCol < 1) return 0;

  var n = sh.getLastRow() - 1;
  var ids = sh.getRange(2, idCol, n, 1).getValues();
  var stamp = 'VOID ' + new Date().toISOString() + ' (' + (data.reason || 'undo') + ')';
  var count = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(data.entryId)) {
      sh.getRange(2 + i, voidCol).setValue(stamp);
      count++;
    }
  }
  return count;
}


/**
 * Appends one row per dish. Returns how many rows were written.
 *
 * Why one row per dish instead of "A:12 | C:30" in a single cell: every report
 * you will want (per dish, per person, per week, dish mix, throughput) is a
 * plain pivot table over this shape, and impossible over a packed string.
 *
 * Why dish_name is stored and not just dish_letter: letters are reassigned every
 * week. In the 03.08 menu 21 of 22 letters changed dish, so a letter alone
 * cannot be interpreted after the fact.
 */
function appendItemRows_(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ITEMS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ITEMS_SHEET);
    sh.appendRow(itemsHeader_());
    sh.setFrozenRows(1);
  }

  var items = data.items;

  // Older clients (a phone with a cached page) send only the packed `dishes`
  // string. Parse it so their entries still land here -- without the dish name,
  // which is exactly the gap this tab exists to close.
  if (!items || !items.length) {
    items = [];
    String(data.dishes || '').split('|').forEach(function (part) {
      var m = String(part).trim().match(/^([A-Z])\s*:\s*(\d+)$/);
      if (m) items.push({ letter: m[1], dish: '', qty: Number(m[2]) });
    });
  }
  if (!items.length) return 0;

  var now = new Date();
  var employee = (data.employees || []).join(', ');
  var rows = items.map(function (it) {
    return [now, data.date || '', employee, data.role || '',
            it.letter || '', it.dish || '', Number(it.qty) || 0, Number(it.waste) || 0,
            data.startTime || '', data.endTime || '',
            (typeof data.shiftMinutes === 'number' ? data.shiftMinutes : ''),
            data.comment || '', data.entryId || '',
            data.clientTime || '', data.tz || '', data.appVersion || '',
            ''];   // voided: empty until an undo stamps it
  });

  // One setValues beats N appendRow calls: fewer round trips, and the block
  // either lands or does not, so a timeout cannot leave half an entry.
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}


/** Always answer as real JSON, never as an HTML page. */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * GET endpoints. Your deployment already answers a bare GET with
 *   {"status":"ok","message":"Assembly Tracking API is running"}
 * and that behaviour is preserved, so replacing your existing doGet is safe.
 *
 *   ?view=roster   -> { ok, employees: [...] }        the current roster
 *   ?view=today    -> { ok, date, totals, byPerson, byDish, ... }  supervisor view
 *   ?date=YYYY-MM-DD with view=today for any other day.
 *
 * Read-only. Voided rows are excluded from every figure.
 */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var view = String(p.view || '').toLowerCase();

    if (view === 'roster') {
      return jsonOut({ ok: true, employees: rosterFromSheet_() });
    }
    if (view === 'today' || view === 'summary') {
      return jsonOut(summaryFor_(p.date || todayIso_()));
    }
    return jsonOut({ status: 'ok', message: 'Assembly Tracking API is running' });

  } catch (err) {
    console.error('doGet failed: ' + (err && err.stack ? err.stack : err));
    return jsonOut({ ok: false, status: 'error', error: String((err && err.message) || err) });
  }
}


function todayIso_() {
  return Utilities.formatDate(new Date(),
    Session.getScriptTimeZone() || 'Europe/Berlin', 'yyyy-MM-dd');
}


/**
 * The roster, from an optional 'Roster' tab with a header and one name per row in
 * a column called `employee` (or the first column).
 *
 * Returns [] when that tab does not exist, which is the signal the client uses to
 * keep its own list. That is deliberate: an empty roster must never be mistaken
 * for "nobody works here", which would lock the kitchen out of the HACCP
 * checklist.
 */
function rosterFromSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  if (!sh || sh.getLastRow() < 2) return [];

  var width = Math.max(1, sh.getLastColumn());
  var header = sh.getRange(1, 1, 1, width).getValues()[0]
                 .map(function (h) { return String(h).trim().toLowerCase(); });
  var col = header.indexOf('employee') + 1;
  if (col < 1) col = header.indexOf('name') + 1;
  if (col < 1) col = 1;

  var vals = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
  var out = [], seen = {};
  for (var i = 0; i < vals.length; i++) {
    var n = String(vals[i][0]).trim();
    if (!n || seen[n.toLowerCase()]) continue;
    seen[n.toLowerCase()] = true;
    out.push(n);
  }
  return out;
}


/**
 * Everything the supervisor view needs for one date, in a single request.
 *
 * Aggregated here rather than in the browser so a phone is not pulling months of
 * rows to add up one day. Reads AssemblyItems, which is the tab with dish names
 * and per-dish rows -- the packed legacy string cannot be aggregated reliably.
 */
function summaryFor_(dateStr) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ITEMS_SHEET);
  var empty = { ok: true, date: dateStr, hasData: false, totalDishes: 0, totalWaste: 0,
                entries: 0, byPerson: [], byDish: [], generatedAt: new Date().toISOString() };
  if (!sh || sh.getLastRow() < 2) return empty;

  var header = itemsHeader_();
  var width  = Math.max(header.length, sh.getLastColumn());
  var rows   = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();

  var iDate = header.indexOf('entry_date'), iEmp = header.indexOf('employee'),
      iRole = header.indexOf('role'), iName = header.indexOf('dish_name'),
      iLet  = header.indexOf('dish_letter'), iQty = header.indexOf('qty'),
      iWaste = header.indexOf('waste'), iMin = header.indexOf('shift_minutes'),
      iVoid = header.indexOf('voided'), iId = header.indexOf('entry_id');

  var people = {}, dishes = {}, entryIds = {}, totalQty = 0, totalWaste = 0, any = false;

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (String(row[iDate]).indexOf(dateStr) !== 0 &&
        formatCell_(row[iDate]) !== dateStr) continue;
    if (iVoid >= 0 && String(row[iVoid] || '').length) continue;   // undone

    any = true;
    var emp   = String(row[iEmp] || '').trim() || '(unnamed)';
    var qty   = Number(row[iQty]) || 0;
    var waste = Number(row[iWaste]) || 0;
    var dish  = String(row[iName] || '').trim() || ('Dish ' + String(row[iLet] || '?'));

    totalQty += qty; totalWaste += waste;
    if (iId >= 0) entryIds[String(row[iId])] = true;

    if (!people[emp]) people[emp] = { employee: emp, dishes: 0, waste: 0, minutes: 0, role: '' };
    people[emp].dishes += qty;
    people[emp].waste  += waste;
    if (iRole >= 0 && row[iRole]) people[emp].role = String(row[iRole]);
    // shift_minutes repeats on every row of one entry, so take the max rather
    // than summing, or a 7h shift with 20 dishes would read as 140 hours.
    if (iMin >= 0 && Number(row[iMin]) > people[emp].minutes) {
      people[emp].minutes = Number(row[iMin]);
    }

    if (!dishes[dish]) dishes[dish] = { dish: dish, letter: String(row[iLet] || ''), qty: 0, waste: 0 };
    dishes[dish].qty   += qty;
    dishes[dish].waste += waste;
  }

  if (!any) return empty;

  var byPerson = Object.keys(people).map(function (k) {
    var p = people[k];
    p.perHour = p.minutes > 0 ? Math.round((p.dishes / (p.minutes / 60)) * 10) / 10 : null;
    return p;
  }).sort(function (a, b) { return b.dishes - a.dishes; });

  var byDish = Object.keys(dishes).map(function (k) { return dishes[k]; })
                     .sort(function (a, b) { return b.qty - a.qty; });

  return {
    ok: true, date: dateStr, hasData: true,
    totalDishes: totalQty, totalWaste: totalWaste,
    entries: Object.keys(entryIds).length,
    people: byPerson.length,
    byPerson: byPerson, byDish: byDish,
    generatedAt: new Date().toISOString()
  };
}


/** Sheets may hand back a Date object or a string for entry_date. */
function formatCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Europe/Berlin', 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}


/* ---------------------------------------------------------------------------
 * REFERENCE ONLY -- do not paste this over a working handleEntry.
 *
 * This is what the client sends, so you can check your column order against
 * it. The body is JSON, sent as text/plain to keep it a CORS-simple request:
 *
 *   {
 *     "date":      "2026-07-31",          // yyyy-mm-dd, from the date picker
 *     "employees": ["Joel"],              // always exactly one name
 *     "dishes":    "A:12 | C:30",         // letter:qty, pipe separated
 *     "role":      "Main, Assist",        // one or more, comma separated
 *     "comment":   "optional free text"
 *   }
 *
 * Two things worth knowing if you ever rework the sheet:
 *
 *  - `dishes` being one packed string is painful to pivot. One row per
 *    person-per-dish (date, name, role, dish_letter, dish_name, qty) makes
 *    every report you will eventually want a plain pivot table.
 *  - Store the dish NAME, not just the letter. Letters are reassigned weekly,
 *    so today's "A" is not next month's "A" and letter-only history cannot be
 *    interpreted after the fact.
 *
 * function handleEntry(e) {
 *   var data  = JSON.parse(e.postData.contents);
 *   var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Entries');
 *   sheet.appendRow([
 *     new Date(),                    // server timestamp
 *     data.date,
 *     (data.employees || []).join(', '),
 *     data.dishes,
 *     data.role,
 *     data.comment || ''
 *   ]);
 *   return sheet.getLastRow();
 * }
 * ------------------------------------------------------------------------- */
