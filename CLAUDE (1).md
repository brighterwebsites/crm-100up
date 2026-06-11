# CLAUDE.md — 100UP Stock CRM

## Project overview

`100UP_stock-crm` is a custom CRM for **100UP Solar**, a solar installation business run by Fred (Melbourne, AU). It manages jobs, stock inventory, and compliance documentation for solar installs.

The app is a **single self-contained HTML file** — inline JavaScript, inline CSS (CSS custom properties), no build step, no backend, no external database. All persistence is via browser `localStorage`. Font: DM Sans (Google Fonts).

Current version: **V10** (latest working file: `100UP_stock-crm_V10.html` or similar — confirm the latest file in the repo before editing).

## Core functionality

### Job pipeline
- Four stages: **1. Communication → 2. Quoting → 3. Installation → 4. Compliance & Close**, spread across 17 steps total.
- Jobs advance stage-by-stage via the `doAdvance` path.
- Install date scheduling with **clash detection**: booking an install date shows all booked dates and warns on same-day conflicts.

### Stock & inventory
- Stock items with allocation to jobs and **consumption on install completion** (triggered through `doAdvance`).
- Short-stock alerts.
- **Order List tab**: items needing procurement, with links to affected customers.
- Stock item names are aligned to canonical part names from `100UP_calculators_GEN_v63.html`.

### Documents & output
- **Job Order modal**: auto-generated reference numbers, parts lists, custom line items, print-to-PDF.
- **Purchase Order generation**: Print/Save PO in a new tab + "Copy parts list" to clipboard.
- **CES summary**: "📋 CES summary" button on Stage 4 jobs (and Stage 3 jobs with an install date). Opens a popup modal with a formatted HTML table copyable into email (Gmail/Outlook) for electrical safety certificate submissions. Driven by `CES_CATALOG`, which maps stock IDs to CES-grade specifications.
- **"Copy details"**: plain-text job info to clipboard for pasting into any comms app.
- JSON data export with date-stamped filenames, e.g. `100UP_stock-crm_2026-05-29.json`.

## Conventions & standing instructions

1. **Version every change.** Each update increments the version number, and the version must stay in sync in three places: the filename, the `<title>`, and the header badge (V8 → V9 → V10 → …). With git in play, commits now provide history, but the visible version badge convention should be kept unless Fred says otherwise — it's how he tracks which file is live in the browser.
2. **Always base changes on the latest working file** — never on an older or stale in-session copy. In the repo, that means the file at HEAD on the main branch.
3. **Minimal, targeted changes** are strongly preferred over broad rewrites. Don't refactor surrounding code unless asked.
4. **Output for compliance/comms is clipboard-oriented**: rich HTML tables (for email) or plain text. Not file exports. New features in this area should follow the same pattern.
5. **Features live inside the CRM** (buttons, modals) rather than as separate tools or scripts.
6. Keep the app a **single HTML file** — no bundlers, no external JS dependencies beyond what's already there.

## Known issues / gotchas

- **Stock consumption inconsistency**: consumption runs via the `doAdvance` path. Setting the install date directly via the detail field **bypasses** consumption logic. Known and tolerated for now — be careful not to make it worse; a fix would need to unify both paths.
- **CES catalog manufacturer names**: Deye and Jinko legal manufacturer names are **verified**. **Sigenergy and Trina entries are unconfirmed** and need checking against CEC listings before being treated as authoritative.
- `localStorage` is the only data store — clearing browser data wipes everything. JSON export is the backup mechanism.

## Open items / roadmap

- **Confirm Sigenergy and Trina legal manufacturer names** for `CES_CATALOG` accuracy (check CEC listings).
- **Possible Supabase migration** for multi-device / multi-user access. Discussed, not committed. If pursued, the single-file constraint will need rethinking.
- **Xero PO integration — unresolved.** CSV import was ruled out (Xero doesn't support CSV import for purchase orders). Two options on the table:
  - Full Xero API/OAuth integration (heavier lift, conflicts with the no-backend model).
  - A "Quick Entry" helper that pre-fills fields for manual copy-paste into Xero (lighter, fits existing clipboard-first patterns).

## Reference files

| File | Purpose |
|---|---|
| `100UP_calculators_GEN_v63.html` | Canonical part names for stock items |
| `Book3.xlsx` | Verified CES example (Ann Schluter job) — ground truth for CES summary format |
| `100UP_stock-crm_VXX.html` | The app itself — latest version is the working base |

## Working with this repo in Claude Code

- The latest `100UP_stock-crm_V*.html` is the source of truth. Verify which version is current before editing.
- After any change: bump the version (filename + title + badge), commit with a short message describing the feature/fix.
- Test by opening the file directly in a browser — there is no build or server step.
- Fred typically tests with real `localStorage` data; never change the localStorage key names or data schema without an explicit migration plan, or existing data will appear "lost".
