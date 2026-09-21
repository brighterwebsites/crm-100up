# 100UP CRM — documentation

Reorganised 2026-09-21. Four live registers, a design reference, and an
archive. If you are adding something, the question is *which register*, and
the answer is usually decided by **who wants it and whether it is broken**:

| Register | What goes in it | Test |
|---|---|---|
| **[bugs.md](bugs.md)** | Defects. Something does not work as designed | "This is wrong" |
| **[refinements.md](refinements.md)** | Built but incomplete, mislabelled, or not yet how the business needs it | "This works, but not properly" |
| **[cutover.md](cutover.md)** | Everything that must happen to go live, and in what order | "This blocks go-live" |
| **[feature-wishlist.md](feature-wishlist.md)** | Parked ideas. **Not** Fred requirements | "Nice one day; nobody asked" |

The line between **bugs** and **refinements** is the one people get wrong.
A defect means the code fails its own intent. A refinement means the intent
was incomplete. "The Backup button exports V46-shaped JSON" is a refinement —
it does exactly what it was written to do, and what it was written to do is no
longer right.

The line between **refinements** and **wishlist** is whether Fred would
eventually raise it. If he would, it is a refinement.

---

## Also in this folder

| File | What it is |
|---|---|
| **[2026-09-20_mvp-plan.md](2026-09-20_mvp-plan.md)** | The September push, as it happened: repo state, what shipped, and every decision taken without asking Fred with the reasoning attached. Historical record, but the decision log is live |
| **[fred-feedback-2026-08-12.md](fred-feedback-2026-08-12.md)** | Vanessa's update **to** Fred with his replies interleaved, plus his 2026-09-20 email verbatim. **Primary source** for what Fred actually asked for. Attribution inside is not marked — see the note at the top |

## `design/` — how things that exist were built

Reference, not plans. Read these when changing the thing they describe.

| Doc | Covers | Status |
|---|---|---|
| [2026-08-11_design-brief.md](design/2026-08-11_design-brief.md) | The visual system: tokens, type, colour, the mono-for-numbers rule | Current. `index.css` implements it |
| [installer-model-design.md](design/installer-model-design.md) | Step permissions, `installer_can_set`, job step dates | **Partly superseded** — Fred's 2026-09-20 email made installers fully read-only (`20260920100001`). The mechanism it describes is intact and dormant |
| [pipeline-attention-design.md](design/pipeline-attention-design.md) | Needs-attention panel, follow-up rules, pulsing dots | Current, built |
| [stock-take-design.md](design/stock-take-design.md) | Count sheet → counts → apply, and why `stocks.qty` is read-only to the app | Current, built |
| [goods-receipt-design.md](design/goods-receipt-design.md) | Receiving against a PO, invoice extraction, GST reconciliation | Current, built |
| [quote-configurator-design.md](design/quote-configurator-design.md) | Assumptions → product-driven configurator | **Partly built.** `system_configs` and the engine landed; the Assumptions editing UI did not |
| [wp-quick-system-estimate-spec.md](design/wp-quick-system-estimate-spec.md) | Public estimator on 100up.com.au, fed from this repo's pricing | Not built. Lives in `100up-tools` |
| [ai-in-crm-design.md](design/ai-in-crm-design.md) | AI/MCP: one tool layer, MCP surface before in-app chat, the security model | Not built. Post-cutover |

## `archive/` — superseded

Kept for provenance, never as current truth. See
[archive/README.md](archive/README.md) for what each was and what replaced it.

---

## Ground truth beats all of it

`supabase/migrations/*.sql` is the schema. Documentation goes stale; applied
migrations do not. When a doc and a migration disagree, the migration is
right and the doc needs fixing.
