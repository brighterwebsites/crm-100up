# Cutover — going live

**What this is:** everything that must happen before Fred runs the business
from the CRM, and the order it happens in. Extracted from
`2026-09-20_mvp-plan.md` on 2026-09-21 so there is one place to look on the
night rather than a section inside a status document.

**Where it stands.** Every build item is done. What is left is verification,
one schema decision, and a date from Fred.

## Open items

| # | Item | Owner | Blocks |
|---|---|---|---|
| C1 | **A V46 freeze date from Fred** | Fred | Everything. Parity against a moving target is not parity, and the export must be the final state |
| C2 | **Custom SMTP actually sends** — both CyberPersons credentials read `LAST USED: Never` and resets are not arriving | Vanessa | Password resets and invites. See §3.2 of the MVP plan for the diagnosis |
| C3 | **`jobs.value` readable by installers** (`bugs.md` #15) | Dev | Only the first *real* installer account, not cutover itself |
| C4 | **Ground Mount BOM parity spot-check** against V46 | Vanessa | Quoting a ground mount with confidence. Freshly ported arithmetic, never run twice |
| C5 | **Rehearse the import** end to end | Vanessa | Nothing, but it converts an 11pm surprise into a Tuesday one |
| C6 | Work through **`refinements.md`** and decide which are pre-cutover | Both | Fred's day-one impression |

Verified and closed: installer read lockdown (`bugs.md` #14), the `noindex`
header, and the stale-tab update banner. All three were checked against the
live deployment rather than assumed.

---

### Verify before cutover (three things, none of them long)

1. ~~**Bug #14, live.**~~ **VERIFIED 2026-09-21** — signed in as Installer One
   in incognito, called the REST API directly with that session's JWT. All
   eight cost and procurement tables returned `[]`; `stocks_visible` returned
   13 rows with every cost and `qty` at `0`. **It did surface one thing the
   lockdown did not cover** — `jobs.value` is readable for an installer's own
   jobs, now `docs/bugs.md` #15, gated the same way: fix before any real
   installer account. Old text kept below for the method.

   ~~Log in as the test installer and hit the
   REST API directly for `stocks`, `suppliers`, `purchase_orders` and
   `pricing_settings`. Each should return empty or refuse. This is the one fix
   that was never re-tested after the change, and it is the one that matters
   if a real installer ever gets an account.~~
2. ~~**The noindex header.**~~ **Done 2026-09-21** — `curl -I` returns
   `x-robots-tag: noindex, nofollow, noarchive`.
3. **A real password reset lands in an inbox.** **REOPENED 2026-09-21.**
   Briefly marked done on the strength of a reset Vanessa received after
   configuring SMTP. New evidence undercuts that: the CyberPersons panel shows
   **both** SMTP credentials as `LAST USED: Never`, and resets are not
   arriving now. The reset she received is dated 15 Sept, which is consistent
   with it having gone out through **Supabase's built-in sender** rather than
   custom SMTP — in which case custom SMTP has never successfully sent and was
   never actually verified.

   **Decisive check:** open that 15 Sept email → *Show original* → read
   `Return-Path` and the `Received:` chain. `mail.cyberpersons.com` means
   custom SMTP works and the panel's "last used" is simply not tracked.
   Anything else (a Supabase or SES-style host) means custom SMTP has never
   sent and this item was never done.

   Then **Dashboard → Logs → Auth**, which records whether a send was
   attempted and what the SMTP server answered. A rejected send is invisible
   in the UI — Auth deliberately reports success on a password reset whatever
   happens, so as not to leak which addresses exist.

   Note also **"Minimum interval per user: 60"** in the SMTP settings: repeat
   reset requests for the same address inside 60 seconds are dropped silently,
   and Supabase applies an hourly cap on top. Repeatedly clicking reset while
   debugging produces exactly the symptom being debugged.
4. ~~**The update-banner mechanism.**~~ **Done 2026-09-21** —
   `curl -s .../version.json` returns a live build id, so the stale-tab check
   has something to compare against. Worth knowing because `isStale()` fails
   safe to "not stale": a missing `version.json` would look exactly like a
   working check.

---

### Rehearse it first — this week, not on the night

**The import is a complete replacement, not an increment.** `--truncate`
clears the operational tables and reloads everything, so every run produces
the same end state. Run it ten times and you get the same database.

That makes a full rehearsal free, and nothing in the CRM is real, so a failed
one costs nothing either. **Do it before the night**, when a surprise is a
Tuesday afternoon problem rather than an 11pm one.

```bash
# 1. Report only. Read it properly.
python scripts/import_from_export.py --export <fresh>.json --dry-run

# 2. Generate the SQL.
python scripts/import_from_export.py --export <fresh>.json     --emit-sql import.sql --truncate
```

Then paste `import.sql` into the **Supabase SQL editor**, which runs as
`postgres`. That matters: `private.guard_stock_qty()` and RLS both key off
`current_user`, so as an app user the stock quantities fail silently while
everything else succeeds. There is no local `psql` on this machine, so the
SQL editor is the route.

**What the rehearsal is actually testing** — the dry run against the
2026-06-25 export came back clean, so the *shape* is known good. A fresh
export may not be:

- a supplier whose name no longer matches anything (reported as a problem)
- a stock id in the export that is not in the live catalogue (the SQL
  **aborts** — deliberately, because the catalogue cannot be rebuilt from the
  export)
- a job at a stage/step that no longer exists (aborts)
- stock renamed since (a notice, not an error — the id is what binds)
- duplicate customers where one household has several jobs (expected, by
  design; merge by hand afterwards if Fred wants)

Each of those is a five-minute fix found early and an ugly surprise found
late.

**Rehearse the whole thing, not just the import:** apply it, then open the app
and check a few jobs against V46 — dates, stock allocations, stage. That is
the step that catches a mapping error the SQL was perfectly happy with.

---

### The cutover itself

Order matters; the middle step is the irreversible one.

1. **Freeze V46.** No further edits to the HTML or the assumptions JSON. Parity
   against a moving target is not parity — this was already flagged as
   question 3 in `docs/fred-feedback-2026-08-12.md` and never answered. Agree a date
   with Fred.
2. **Fresh export** from V46 (the Stock CRM backup button), not the
   2026-06-25 file.
3. **Dry run the importer** against that export and read the report:
   `python scripts/import_from_export.py --export <fresh>.json --dry-run`.
   Expect duplicate-customer notes where one household has several jobs — that
   is by design, and they are merged by hand afterwards if Fred wants.
4. **Emit and review the SQL** with `--emit-sql` and `--truncate`. Read the
   clear-down section before running it. It empties the operational tables and
   leaves the catalogue alone, but read it anyway.
5. **Apply it as `postgres`**, in one transaction. `private.guard_stock_qty()`
   and RLS both key off `current_user`; as an app user the stock quantities
   silently fail.
6. **Restore real customer emails** — or decide not to. The import writes the
   real addresses from the export, replacing the
   `support+…@brighterwebsites.com.au` dummies. From that moment anything that
   sends can reach a real customer. Nothing sends automatically today
   ("NO alerts"), so this is safe, but it is the moment it stops being safe by
   accident.
7. **Spot-check** a job's dates, its stock allocations and its stage against
   V46 before telling Fred to switch.

---

### After cutover, the rules change

The "ship schema changes in one go" licence in §6 ends here. Once Fred depends
on the app, a column drop has to follow the frontend deploy that stopped using
it, or the live app breaks mid-save.

---
