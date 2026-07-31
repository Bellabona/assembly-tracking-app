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
          'dish_letter', 'dish_name', 'qty',
          'comment', 'entry_id', 'client_time', 'tz', 'app_version'];
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
            it.letter || '', it.dish || '', Number(it.qty) || 0,
            data.comment || '', data.entryId || '',
            data.clientTime || '', data.tz || '', data.appVersion || ''];
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
 * OPTIONAL health check. Your deployment already answers GET with
 *   {"status":"ok","message":"Assembly Tracking API is running"}
 * so only add this if you do not already have a doGet.
 */
function doGet() {
  return jsonOut({ status: 'ok', message: 'Assembly Tracking API is running' });
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
