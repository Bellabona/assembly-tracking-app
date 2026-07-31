# Bellabona – Assembly Tracking

A lightweight web app for Bellabona kitchen staff to log daily assembly work. Entries are submitted via a simple form and saved directly to Google Sheets for reporting and analysis.

**Live app:** https://bellabona.github.io/assembly-tracking-app/

**Data sheet:** https://docs.google.com/spreadsheets/d/1cLzfmY04J7RDsZsuLSh2qz_f-b9m8eyrj-BPY5AhHo0/

---

## How it works

1. Open the app on your phone or computer
2. The date is pre-filled to today (change it if needed)
3. Tap the employees who worked together on this batch
4. Enter the quantity for each dish letter you assembled (only the letters that
   actually have a dish this week get a tile)
5. Select your role (Main / Assist / Support)
6. Add an optional comment, then hit **Submit**
7. A green confirmation screen confirms the save — tap **Submit another entry** to log the next batch

You can submit multiple times per day (once per dish batch or per team combination).

A running **Total** sits above the Submit button so a slipped extra digit (40 typed
as 400) is visible before submitting. Counts must be whole numbers and are capped
per dish per entry (`MAX_PER_DISH` in `index.html`); file a second entry if you
genuinely assembled more.

Whatever is typed is kept in the phone's local storage while the form is open, so
a locked screen, a backgrounded browser or an accidental reload does not lose the
numbers. The draft is discarded on a confirmed save, on **+ New Entry**, the next
day, after 18 hours, and whenever the weekly dish list changes (letters are
reassigned to different dishes every week, so last week's counts must never be
re-attached to this week's letters).

The green screen only appears when the backend actually confirms the save. If the
save fails, the numbers stay on screen with a red message naming the reason, so
the entry can be retried instead of silently disappearing.

---

## Data structure

Each submission appends a row to `Sheet1` in the linked Google Sheet with these columns:

| Column | Description |
|--------|-------------|
| Date | Submission date (YYYY-MM-DD) |
| Employee | Name(s) of employees who worked together |
| Dishes | Dish codes and quantities, e.g. `A:55 | B:6 | J:11` |
| Role | Main / Assist / Support |
| Comment | Optional free-text note |

---

## Modifying the app

### Add or remove employees

Edit the `EMPLOYEES` array near the top of `index.html`:

```js
const EMPLOYEES = [
  "Joel", "Jash", "Varush", "Richa", "Hamid",
  "Salman", "Ranjith", "Sreekanth", "Anny", "Alfiya", "Manisha"
];
```

### Dish names and images (weekly, automated)

A separate scheduled task rewrites the `DISH_NAMES`, `DISH_IMAGES` and sometimes
`EMPLOYEES` blocks in `index.html` every week and commits
`Auto-update dish names + images (week DD.MM-DD.MM Berlin)`.

**Do not reshape those three blocks.** Keep the `const` names, the bare
single-uppercase-letter keys, the 4/6-space indentation, the
`// AUTO-UPDATED by weekly scheduled task` comments and the
`// -- Dish names/images for Berlin (week ...)` header lines exactly as they are,
including their odd leading whitespace. The task finds them by literal text and a
naive string splice; re-indenting or restructuring them will break it or silently
empty them. Add new code above `const EMPLOYEES` (ideally right after `<script>`)
or below the `};` that closes `DISH_IMAGES` - never in between.

Everything else in the page derives the dish list from `DISH_NAMES` at runtime, so
a week with 22 dishes, gaps in the middle, or a `Z` needs no follow-up edit.

### After the weekly task runs: rebuild the thumbnails

**Required step, easy to forget.** `DISH_IMAGES` points at full-resolution S3
images (~1.5 MB each, ~35 MB for a week of 24 dishes) that the page renders into
~80px tiles on kitchen phones. `tools/make-thumbs.sh` pre-builds ~13 kB local
WebP thumbs under `thumbs/` and updates the `THUMB_UUIDS` manifest line in
`index.html`:

```sh
tools/make-thumbs.sh
git add thumbs/ index.html
git commit -m "Rebuild dish thumbnails"
git push
```

- Requires macOS (`sips`), `cwebp` (`brew install webp`) and `curl`.
- Safe to re-run any time; existing, decodable thumbs are skipped.
- Commit `thumbs/` **and** `index.html` together, so a deployed `index.html` never
  lists a thumb that was not deployed with it.
- Thumbs are keyed by the S3 image **uuid**, never by dish letter, because the
  weekly task reassigns letters to different dishes. A letter-keyed thumb would
  silently show the wrong photo.
- If you skip this step nothing breaks: uuids missing from the manifest are
  requested straight from S3. The page is just slow for that week.
- If one tile looks wrong: `rm thumbs/<uuid>.webp && tools/make-thumbs.sh`
  (or `FORCE=1 tools/make-thumbs.sh` to rebuild everything).
- There is deliberately no `.gitignore` in this repo. Do not add one, and never
  exclude `thumbs/`.

### Change the Google Sheets endpoint

The form posts to a Google Apps Script web app. If you need to re-deploy the Apps Script, update the `SCRIPT_URL` constant in `index.html`:

```js
const SCRIPT_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";
```

---

## Deployment

The app is hosted via **GitHub Pages** from the `main` branch. Any commit to `main` automatically updates the live URL within ~1 minute.

To deploy a change:
1. Edit `index.html` directly on GitHub (or clone the repo, edit locally, and push)
2. GitHub Pages picks up the change automatically

---

## Tech stack

- Plain HTML + CSS + vanilla JavaScript (no build step, no dependencies)
- Google Apps Script as the backend (receives POST requests and appends to Sheets)
- GitHub Pages for hosting
