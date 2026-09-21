# Archive

Superseded documents. **Never current truth.** Kept because knowing why
something was built the way it was is worth more than a tidy folder, and
because several of these are cited from migration comments that will outlive
them.

Moved here 2026-09-21.

| File | What it was | What replaced it |
|---|---|---|
| [`2026-07_layout-specs/`](2026-07_layout-specs/) | Seven screen specs written in July, before the app existed: main layout, pipeline, customers, stock, customer jobs, purchase orders, assumptions | **The built app.** These were design input, not description. Where the build diverged, the build won — `refinements.md` R2 cites `Customers-layout.md` putting Save at the top of the card where the live UI puts it at the bottom. Read them as *original intent*, useful when deciding whether a difference was deliberate |
| [`2026-07-29_status-gap-and-decisions.md`](2026-07-29_status-gap-and-decisions.md) | Status, gap register, and 37 decision questions for Fred | `2026-09-20_mvp-plan.md` for status, `fred-feedback-2026-08-12.md` for his answers. **Written deliberately for a client meeting at short notice, and it did its job** — a good account of how the project looked in July |
| [`phase-a-implementation-plan.md`](phase-a-implementation-plan.md) | The August product-catalogue work, "ready to execute" | Executed. The migrations are the record: `20260811100001` through `20260811180001` |
| [`schema-restructure-proposal.md`](schema-restructure-proposal.md) | Phase 2 schema design — customers split out of jobs, date clarity, notifications | Partly implemented (`20260719000001`), partly overtaken. **The migrations are truth**; this describes a shape the schema only partly took |
| [`phase-b-parity-gate.md`](phase-b-parity-gate.md) | Ten scenarios the rebuilt engine had to reproduce against V46, and the list of differences that should PASS | **Accepted by Fred 2026-09-20 without the scenario run** — "within the parameters tested and how Fred plans to use it, it works fine". The *procedure* is history. The **expected-divergence list in §2 is still referenced** by `bugs.md` and by comments in `quoteEngine.ts`, so it stays readable |
| [`notes.md`](notes.md) | Six strategic points, roughly ordered by cost of getting them wrong — commercial and IP first | Not superseded by another doc, and **not a technical register**. Archived because it is a standing business conversation rather than project state. Worth re-reading before the commercial discussion, not during a build |

---

## A note on the layout specs

They are the only record of several deliberate decisions that now look
arbitrary in the code — filter wording, where actions sit on a card, which
columns a table shows. Before "fixing" something in the UI that looks odd,
check whether it was specified that way. Sometimes it was, and the spec is
wrong now; sometimes the build drifted. Different fixes.
