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
 * 3. Paste `doPost` and `jsonOut` from this file in alongside it.
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
  try {
    var row = handleEntry(e);

    // handleEntry may or may not report a row number; both are fine.
    var payload = { ok: true, status: 'ok' };
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
  }
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
