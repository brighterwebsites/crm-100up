# 100UP Solar CRM — Status, Gap Register & Decision Questions

**Date:** 29 July 2026
**Prepared for:** Fred — 100UP Solar
**Prepared by:** Brighter Websites
**Status of this document:** Pass 1 of 2. This document establishes *where we are* and *what we need to decide*. The development roadmap (Pass 2) is written after the decisions in Section 6 are answered.

---

## 1. How to use this document

Read Sections 2–5 before the meeting so the status is not a surprise. Section 6 is the working agenda — it is a list of questions, not a list of recommendations. Several of them have no obviously right answer, and getting them wrong is expensive to unwind later, so they are being asked now rather than assumed.

Section 7 shows the provisional shape of the roadmap. It is deliberately not sequenced or sized, because the answers in Section 6 change both.

---

## 2. Where we are, in one paragraph

The original 100UP Suite was a single file that ran entirely inside one browser, on one machine, with all data held in that browser's local storage. Over the last several weeks that has been rebuilt as a proper multi-user web application: a real database, real user accounts with different permission levels, and a hosted website that any authorised person can log into from any device. **The CRM half of the original tool — jobs, pipeline, stock, suppliers, ordering, compliance documents — has been rebuilt and extended.** 
The Quote Designer half — the six calculators — has **not** been rebuilt yet and still lives only in the original file. The two halves currently work as a pair: Fred quotes in the old file, then pastes the result into the new CRM.


---

## 3. What has been built

### 3.1 Foundation — new capability that did not exist before

| Capability | What it means operationally | Status |
|---|---|---|
| Hosted web application | Accessible from any device with a login, not tied to one browser on one machine | Live |
| Central database | One shared set of data; no more "which browser has the real version" | Live |
| User accounts & sign-in | Email/password, self-service password reset | Live |
| Two permission levels | **Admin** (Fred) sees everything; **Installer** sees only their assigned jobs and can only change job notes and fault notes | Live |
| Live updates between users | If two people are in the system, each sees the other's changes without refreshing | Live |
| Enforced process rules | The database itself refuses invalid pipeline moves. This closes a known defect in the old tool where setting an install date by hand silently skipped stock consumption | Live |
| Audit log of pipeline events | Every stage change is recorded with who did it and when | Recorded, not yet viewable in the app |
| Data backup export | One-click download of everything in the old file's format | Live |

### 3.2 CRM — rebuilt

| Screen | What a user can do | Status |
|---|---|---|
| **Pipeline** | Full board view across all 19 steps, with summary counts and filters (active, alerts, stale, stock short, job type) | Complete |
| **Customer Jobs** | Search jobs, open a job, create a new job | Complete |
| **Job detail** | Advance / step back / reschedule; edit customer and site details; view and manage allocated parts; fill the installer job order; produce documents | Complete |
| **Customers** | Separate customer records with contact details, and a view of all jobs for that customer | **New** — the old tool had no customer entity; contact details were copied onto every job |
| **Stock** | Search, filter by category, add/edit/delete items, record on-hand quantity, record cost, record CES specifications (manufacturer, model, kW/kWh/watts) | Complete, and richer than before |
| **Order List** | What is short, grouped by supplier, with the affected customers; assign a preferred supplier; copy a parts list; print a PO; **save it as a tracked PO** | Complete |
| **Purchase Orders** | List and view saved POs with their line items and status | **New** — view only |
| **Suppliers** | Add/edit/delete suppliers and see stock received history | Complete |
| **Receive Stock** | Paste an invoice as structured data, match lines to stock, confirm and increment on-hand | Complete (paste method only) |
| **Settings** | Configure the outbound email service and send a test email | Complete (uncommitted — see 3.4) |

### 3.3 Documents and outputs — rebuilt

Copy job details to clipboard, CES compliance summary as a formatted email table, purchase order printing, and the installer job order form are all working. These follow the same clipboard-and-print pattern as the original, deliberately.

### 3.4 Work in progress, not yet committed

The Settings page, the email sending service, and the secure credential store are built and working but are still sitting as uncommitted changes on the development machine. They need to be committed and deployed. Practically this means the email capability exists but is not yet live for anyone else.

---

## 4. Gap register — what the original tools still do that the new system does not

### 4.1 Quote Designer (`100UP_suite_V46.html`) — six tools, none rebuilt

This is the single largest gap. All six appear in the new app's menu as "not ported yet" placeholders.

| Tool | Business purpose | Status in new system |
|---|---|---|
| **Quick Estimate** | Ballpark price from bedroom or occupant count, with and without generator backup; produces customer-ready quote text | Not started |
| **Calculator** (single phase) | The main quoting engine — panels, battery, inverter, roof/ground mount, Sigenergy vs Deye side by side, full cost breakdown, rebates, final price, and the parts list that flows into the CRM | Not started |
| **3 Phase** | Same as above for three-phase sites, with different inverter range and oversizing rules | Not started |
| **Assumptions** | The master cost and sizing table that drives every calculation — panel cost, battery cost, inverter costs, rebate rates, margin, GST, labour, sizing limits, CES panel details | **Data is in the database. There is no screen to edit it.** Only the 24-hour load profile is editable |
| **Ground Mount BOM** | Parts list and cost for a ground-mount array, with a supplier CSV export | Not started |
| **Simulation** | Hour-by-hour July worst-case battery simulation proving the system survives the hardest month, with daily and hourly evidence tables | Not started |

**Practical impact today:** Fred cannot produce a quote in the new system. He must open the old file, calculate, then paste the result into the CRM via the "Link quote" screen. The receiving end of that handoff is built; the sending end is not.

**Second-order impact:** because the assumptions table has no editing screen, cost changes must currently be made in the old file, and there is no guarantee the old file and the new database agree.

### 4.2 CRM features present in the original but not rebuilt

| Feature | What it did | Why it matters |
|---|---|---|
| **Inspector list** | One click copied a list of jobs where CES was submitted but not yet received, sorted by how long they had been waiting — a chase list | Small feature, real operational value |
| **Merge duplicate stock items** | Detected and merged stock records that were the same part under different names | Was needed because part naming drifted. May be less needed now, but the underlying naming problem is unsolved |
| **Add standard parts** | Seeded the stock catalogue with the canonical part list matching the calculators | Directly tied to the calculator/stock question in Section 6 |
| **SMS job order** | Sent the installer job order as a text message from a phone | Field workflow |
| **Combined PO across all suppliers** | Single printed PO covering everything short | Per-supplier printing exists; the combined version does not |

### 4.3 Procurement — half-built by design

Purchase orders can be created from the Order List and viewed, but the loop does not close:

- There is **no way to receive stock against an open purchase order**. The "partially received" status exists in the database and is never used.
- The ad-hoc Receive Stock path (paste an invoice) **does not record what you paid**. Unit cost is read from the pasted invoice and then discarded.
- Consequently `last cost` on a stock item is a number Fred types in by hand, not a number the system knows.

This is the root of a broader issue covered in Section 6.

### 4.4 Data migration — script is out of date

An import script exists that reads the legacy JSON export (`100UP_stock-crm_2026-06-25.json` — 18 jobs, 17 stock items, 3 suppliers) and loads it into the database. **It was written against the original database design and has not been updated** for the changes made since (separate customer records, renamed date fields, merged stock specifications, purchase orders). It will not run successfully against the current database as written.

It also has no customer-deduplication step, which was identified as necessary when customers were split out from jobs. If two jobs in the legacy data belong to the same person, they will import as two separate customers unless that is handled.

**This is a hard blocker on go-live** and needs to be scheduled, not discovered.

### 4.5 Assumptions file (`100UP_assumptions_2026-06-20.json`)

The 45 values in this file — panel wattage and cost, battery sizes and costs, nine separate inverter costs, gateway and mounting costs, rebate rates and tiers, margin, GST, labour, sizing limits, and the 24-hour load profile — are all present as columns in the database and seeded. Only the load profile has a working editor. Everything else is currently unreachable through the interface.

### 4.6 Known defects carried forward

| Issue | Status |
|---|---|
| Typing `0` into simulation inputs silently reverted to a default | Fixed in the old file; must not be reintroduced when rebuilt |
| Simulation "quick fill" buttons showed live battery sizes but hard-coded panel counts and unit combinations | Open — needs a design decision at rebuild time |
| Assumption costs and actual stock costs can drift apart with no link between them | Open — see Section 6, Theme A |
| "Alerts" and "Stale" filters exist in the interface but nothing ever sets those flags | Carried into the new pipeline screen. Rules never defined |
| CES manufacturer legal names for Sigenergy and Trina are unverified against CEC listings | Open |
| Notification email and phone fields exist on user records with no screen to set them | Open |
| Custom line items on the installer job order are stored and exported but cannot be edited | Open |

---

## 5. Risk summary

| Risk | Consequence | Current exposure |
|---|---|---|
| Two systems in parallel | Cost changes made in one place, not the other; quotes priced on stale figures | **Live now** |
| Import script out of date | Go-live slips, or data is imported incorrectly and has to be unwound | **Live now** |
| Old file still holds real data | Every day of delay adds records that must be migrated | **Live now** |
| Product model decisions unresolved | Calculator rebuild may need to be redone if the catalogue model changes afterwards | **Blocks Phase 2 work** |
| Unverified CES manufacturer names | Compliance submission rejected | Low frequency, high consequence |

---

## 6. Decision questions for Fred

These are grouped by theme. Each question notes what it unblocks. Where the answer is genuinely a spectrum rather than yes/no, options are given to make the trade-off concrete — but the options are a starting point for discussion, not a shortlist.

### Theme A — Products, pricing and the calculator/stock relationship

This is the theme that most affects the shape of the remaining build, and it is the one raised as the worked example.

**Background for the conversation.** Today the calculators do not know that stock items exist. A calculator works out that a job needs, say, a 12kW Sigenergy inverter, and then *builds a product name as text* from a template. The CRM then tries to match that text against the names in the stock list using pattern matching. Cost figures used in the calculation are typed into the assumptions table by hand and have no connection to what was actually paid for the item. Changing a model number means changing the name template, the matching pattern, and possibly the assumptions structure — three separate places.

There is a spectrum of how tightly the calculator should be bound to the stock catalogue:

- **Level 1 — Linked, manual refresh.** The assumption row points at a specific stock item. Cost and specifications stay as editable numbers on the assumption, but a "refresh from stock" button pulls the current values across. Fred stays in control of when planning prices change.
- **Level 2 — Linked, live.** The calculator reads cost and specs directly from the stock item every time. No manual step, no drift, but a supplier price change silently moves quote prices.
- **Level 3 — Fully configurable catalogue.** Products are defined as data with attributes (type = inverter, brand, kW, phase, cost). The calculator selects from whatever matches the rules. New brands and models become a data-entry job rather than a development job.

Level 3 is the most flexible and by a distance the most expensive, and it is only worth it if the product range actually changes often enough to justify it.

**Questions:**

1. How often does the product range actually change? In the last twelve months, how many times has an inverter, battery or panel model been discontinued, superseded, or swapped?
2. When a model is superseded, is it usually a like-for-like swap at the same tier, or does it change the sizing options available?
3. Is the two-brand structure — Sigenergy premium, Deye budget — permanent? If a third brand came along, would you expect to add it yourself, or is a developer change acceptable?
4. Do you ever quote a product you don't stock and have never stocked? For example, quoting something on a customer's specific request, or a large job where you'd order in.
5. Should the price used in a quote be the last price you paid, an average, or a separate planning price you set deliberately? What is the actual behaviour you want when a supplier price rises mid-quarter?
6. Who is responsible for keeping quoting prices current, and how would you want to be prompted that a price is stale?
7. When a supplier price changes, should quotes already sent be repriced, or frozen at the price they were quoted?
8. Does freight, delivery or any other landed cost need to be inside the item cost, or is that covered by the fixed site costs and margin?
9. Panels are the simplest case — one item, one cost, one specification. Should we solve panels first as a proof of the approach before touching the inverter and battery families?
10. The parts list a calculator produces currently names panels generically as "Solar panel 475W" with no brand. The CES compliance form needs the actual manufacturer and model. Should the quote carry the specific panel product all the way through?

### Theme B — Stock, procurement and cost

11. Should receiving stock always be against a purchase order, or does the ad-hoc "an invoice arrived, add it to stock" path need to stay?
12. Do partial deliveries actually happen? If a PO of 20 panels arrives as 12 then 8, does the system need to track that, or is it easier to just close it when it's all in?
13. **Do you need to record serial numbers** for inverters and batteries? This matters well beyond stock control — it affects CES submissions, warranty claims, and being able to answer "which unit went to which customer" two years later.
14. Do you want minimum stock levels and automatic reorder prompts, or is the current "what's short for booked jobs" view sufficient?
15. Is stock ever held anywhere other than one location? Van stock, a second shed, material left on site between days?
16. Stock is currently consumed when a job moves to "Install in progress". Is that the right moment? What happens to parts that were allocated but came back unused?
17. Xero and purchase orders remains unresolved. Two paths were identified: a full Xero integration, or a "quick entry" helper that pre-fills fields for you to paste in manually. Which is worth paying for? How many POs a month are we talking about?
18. Where does the truth live for what you paid — Xero, or the CRM? If it's Xero, does the CRM need to know at all?

### Theme C — Jobs, pipeline and people

19. Are the 19 pipeline steps still accurate? Is any step routinely skipped, done out of order, or effectively dead?
20. Repeat customers and service jobs: if you go back to a site you installed two years ago, is that the same customer record with a second job? Do you need to see install history when you arrive?
21. Who else will have a login, and what should each be able to do? Installers currently see only their assigned jobs and can only change notes. Is there an office admin role coming?
22. Do you need to assign jobs to specific installers, and do you need a calendar or schedule view rather than a pipeline board?
23. The old tool had "Alerts" and "Stale" filters that never actually worked — nothing set the flags. What should trigger them? Is 21 days without movement the right threshold, and should it differ by stage?
24. Multi-day installs: start and completion dates are captured. Do you need day-by-day crew allocation, or is start-and-finish enough?
25. Do installers need the app to work with no signal on site? Rural Victoria makes this a real question, and it is a significant architectural decision if the answer is yes.

### Theme D — Compliance and documents

26. Walk through the actual CES submission end to end. Is it genuinely a copy-paste into an email, or is there a portal? Are serial numbers required on submission?
27. Who owns keeping manufacturer legal names correct against CEC listings? Sigenergy and Trina are currently unverified in the system.
28. Rebate submission and receipt are pipeline steps but the system holds no evidence trail. Does it need to hold reference numbers, submission dates, or documents?
29. The installer job order is printed or texted today. Would installers rather work from the app on their phone, with sign-off and photos captured in it?
30. Does the customer ever need a document out of this system — a quote PDF, an install certificate — or does Xero own everything customer-facing?

### Theme E — Quoting as a business process

31. Today a quote is calculated, copied into Xero, and separately pasted into the CRM. Should a quote become a proper record inside the CRM — saved against the job, versioned, with a status?
32. Do you need quote history? If a customer is quoted three configurations over two months, is it useful to see all three and which one they took?
33. Do you want to record why a quote was lost?
34. Quick Estimate produces customer-ready text. plan still becoming a form on the website that captures a lead directly into the pipeline?

### Theme F — Cutover

35. When do you want to stop using the old file entirely? A cutover date drives everything else — the longer both run, the more data has to be migrated and reconciled.
36. Is there anything in the old file that you'd be genuinely stuck without on day one of the new system?
37. If you had to choose: finish the calculators first, or finish procurement and cost tracking first? Which is costing you more time or money right now?

---

## 7. Provisional roadmap shape

Not sequenced or sized. Sequencing depends on Section 6, particularly questions 1–10 and 37.

| Phase | Theme | Notes |
|---|---|---|
| **0** | Commit and deploy work in progress; update and test the data import; agree a cutover date | Not optional, and not dependent on any decision. Should start regardless |
| **A** | Assumptions editing screen | Removes the reason to keep opening the old file for pricing. Small, high relief |
| **B** | Product and catalogue model | The Theme A decision, implemented. Everything in Phase C sits on top of this, so it goes first |
| **C** | Calculator rebuild | Likely in order: Calculator → 3 Phase → Quick Estimate → Simulation → Ground Mount BOM. Each is a discrete deliverable |
| **D** | Close the procurement loop | Receive against PO, capture real cost, partial deliveries |
| **E** | Notifications and automation | Email is built; nothing sends yet. Needs the Theme C answers on who gets told what |
| **F** | Field and mobile experience | Only if question 25 and 29 say it is needed |
| **G** | Smaller carried-forward items | Inspector list, combined PO, stale rules, custom job order lines, CEC name verification |

---

## 8. What we need out of the session

1. Answers, or at least a direction, on Theme A. It gates the largest phase of work.
2. A cutover date, or the constraints that determine one.
3. A priority call on question 37.
4. Confirmation of who else will use the system and in what capacity.

Everything else can be resolved asynchronously.
