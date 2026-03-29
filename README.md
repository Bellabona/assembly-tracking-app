# Bellabona – Assembly Tracking

A lightweight web app for Bellabona kitchen staff to log daily assembly work. Entries are submitted via a simple form and saved directly to Google Sheets for reporting and analysis.

**Live app:** https://bellabona.github.io/assembly-tracking-app/

**Data sheet:** https://docs.google.com/spreadsheets/d/1cLzfmY04J7RDsZsuLSh2qz_f-b9m8eyrj-BPY5AhHo0/

---

## How it works

1. Open the app on your phone or computer
2. The date is pre-filled to today (change it if needed)
3. Tap the employees who worked together on this batch
4. Enter the quantity for each dish letter (A–Z) you assembled
5. Select your role (Main / Assist / Support)
6. Add an optional comment, then hit **Submit**
7. A green confirmation screen confirms the save — tap **Submit another entry** to log the next batch

You can submit multiple times per day (once per dish batch or per team combination).

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
  "Salman", "Ranjith", "Sreekanth"
];
```

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
