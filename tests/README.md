# Tests

330 assertions across ten suites. They drive the real pages in jsdom and the Apps
Script against a stubbed SpreadsheetApp, so nothing here needs a browser, a Google
account, or a deploy.

## Running

    npm install jsdom          # once
    for t in tests/*.mjs; do node "$t"; done

`run.mjs` needs `tests/test.js` (assertions evaluated inside the page).

## What each covers

| suite      | area |
|------------|------|
| `run.mjs`  | tile rendering, thumbnails, totals, validation, draft signature |
| `e2e.mjs`  | submit success/failure paths, draft restore, stale-week and expiry guards |
| `t13.mjs`  | per-dish payload with dish names, idempotency, escaping |
| `tkt.mjs`  | HACCP page: roster tiers, durable checks, offline outbox, stale plan |
| `gas.mjs`  | Apps Script: dual-write, dedupe, void, HACCP rows, doGet roster + summary |
| `t10.mjs`  | offline submit queue, PWA wiring, queued-vs-rejected distinction |
| `t546.mjs` | +1/+10 buttons, glove mode, waste tracking |
| `t378.mjs` | shift hours and throughput, undo window, duplicate-day warning |
| `t122.mjs` | roster from the sheet, supervisor summary rendering |
| `t9.mjs`   | German/English, including that switching mid-entry loses nothing |

## Conventions worth keeping

Two mistakes cost time while writing these, both worth avoiding:

- **Never assert on hardcoded sheet column indices.** Adding `waste` shifted every
  column after it and broke assertions that were otherwise correct. Look columns
  up by header name.
- **Never identify a request by call order.** The pages fetch the roster on load,
  so "the first fetch" is no longer the submit. Route stubs by URL.

Also note `beforeParse` is required when a test depends on anything the page does
during boot: jsdom runs page scripts inside the constructor, so a `fetch` assigned
afterwards is too late.
