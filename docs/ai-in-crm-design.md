# AI in the CRM — design

**Date:** 21 September 2026
**Status:** Design. Nothing here is built. Post-cutover work.
**Supersedes:** the AI half of `.cursor/plans/feedback_and_crm_ai_bb3bbf3e.plan.md`
(the feedback-desk half of that plan shipped on 2026-09-21).

---

## 1. Where we are

| Piece | State |
|---|---|
| Anthropic key | In `integrations`, admin-only, service-role readable |
| `aiComplete` (`supabase/functions/_shared/ai.ts`) | Working |
| Only caller | `extract-invoice` — reads a supplier invoice on Receive Stock |
| Logging | Every call to `ai_call_log`; usage card in Settings |

So the plumbing exists and has exactly one consumer. Everything below is about
giving Fred a way to *ask questions of his own data*.

---

## 2. The decision: build the MCP server before the in-app chat

The original plan had in-app chat as the product, with a remote MCP connector
as the same tools exposed externally. **That is the right architecture and the
wrong order.**

| | In-app chat | Remote MCP |
|---|---|---|
| To build | Chat UI, thread persistence, streaming, tool-call rendering, error states | A Worker, auth, the tools |
| Who pays for tokens | **The CRM**, on our Anthropic key, forever | **Fred**, through his own subscription |
| Chat quality | Whatever we build | Claude's own interface |
| Model choice | Whatever we wire | His |

**Confirmed 2026-09-21: Fred has Claude Max.** That removes the only real
objection — the whole approach was contingent on him having a subscription
worth using.

He also has ChatGPT Pro, which matters more than it first appears. **MCP is a
protocol, not a Claude feature.** Building an MCP server means Fred uses
whichever assistant he prefers, now or later. Building an in-app chat means we
choose for him and own that choice forever. (OpenAI has added MCP support for
connectors — verify the current state before promising it, but the
architectural point stands regardless: a protocol server outlives any one
client.)

The tool layer is identical either way, so an in-app chat later reuses all of
it. Nothing is wasted by starting at the other end.

**Remaining risk, and it is a real one:** adding a custom connector in
Claude.ai settings is a genuine ask for someone whose watchword is "don't
over-complicate". Mitigation: Vanessa sets it up with him once, and it is a
one-time step. If he will not use it, the in-app chat is the fallback and the
tools are already built.

**Either way, MCP-first pays immediately** — it gives Vanessa CRM querying
from Claude Code the day it ships, which in-app chat never would.

---

## 3. Architecture

```
  Claude.ai / ChatGPT / Claude Code          (later) In-app chat
                │                                     │
                └──────────────┬──────────────────────┘
                               │
                     CRM tool server (MCP)
                  read tools · write tools · actions
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       RLS'd queries    SECURITY DEFINER    send-email
                             RPCs           (test-mode aware)
```

**Rules before AI.** Tools return structured data; the model reasons over it.
Anything consequential goes through the RPCs that already guard it —
`advance_job_stage`, `set_step_date`, `receive_goods`, `apply_stock_take` —
never a raw table write from a model. Those functions exist because the old
app let a date bypass stock consumption; an AI writing directly to tables
would reintroduce exactly that class of bug, at speed.

**Where it runs.** Cloudflare Worker, same account as the app, at something
like `mcp.offgridcrm.100up.com.au`. Streamable HTTP transport. A Supabase Edge
Function would also work; Cloudflare wins on being where the app already is
and on request logging.

> **Gotcha for the in-app surface only.** A zone-level Content-Security-Policy
> on `100up.com.au` applies to the CRM and is **not in this repo**. Its
> `connect-src` is an allowlist naming `'self'` and the Supabase project, so
> an in-app chat calling an MCP server on a different subdomain would be
> blocked by the browser before the request left. Add the origin to the zone
> CSP, or serve the MCP endpoint under the app's own origin. Claude.ai and
> ChatGPT are unaffected — they call the server from Anthropic's or OpenAI's
> cloud, not from Fred's browser.

---

## 4. Security — the part to get right

This is a **public HTTPS endpoint with database access**. It deserves more
care than the rest of the build put together.

`docs/bugs.md` #14 is the lesson to carry in: writes were locked down from day
one and **reads were what nobody checked** — 22 tables served every cost and
margin to any authenticated user for two months. An MCP server is a brand-new
read surface. It gets built the way #14 should have been.

**Non-negotiables:**

1. **Its own identity, not admin.** A dedicated Postgres role or a service
   identity whose grants are the tool surface and nothing more. "Runs as
   admin and we are careful in the tool code" is how #14 happened.
2. **Column allowlist, not a denylist.** Every tool names the columns it
   returns. A denylist fails open the moment a column is added — and this
   schema gains columns most weeks.
3. **Never reachable:** `integrations.secret`, anything in `private.*`
   (including `customer_email_backup`), `ai_call_log` prompt bodies,
   `auth.users`.
4. **Every tool call logged** — tool, arguments, row count, caller, timestamp
   — the way `ai_call_log` logs model calls. Without it there is no answer to
   "what did it look at".
5. **Rate limited**, per token and globally.
6. **Row caps** on every list tool, with explicit pagination. No unbounded
   `select *`.

**Auth — the open decision.**

| Option | For | Against |
|---|---|---|
| **OAuth 2.1** (Claude connector advanced settings) | Proper flow, revocable, per-user, no long-lived secret | Real work: authorization server, dynamic client registration, token lifecycle |
| **Long-lived token** Fred pastes once | Quick | A credential with database access living in a third party's cloud, indefinitely, and rotation nobody will do |

**Recommendation: a scoped bearer token for v1, treated as a secret with
teeth** — issued per person, stored hashed, revocable from Settings, expiring
on a set date so rotation is forced rather than hoped for, and mapped to the
restricted identity above rather than to an admin session. Move to OAuth when
there is a second tenant, at which point it stops being optional.

The important part is not which option: it is that **the token's blast radius
is the read allowlist**, not the database. Get that right and the auth choice
becomes a convenience question.

---

## 5. Phases

| Phase | Fred gets | Tools | Gate |
|---|---|---|---|
| **0** — done | Invoice read on Receive Stock | `extract-invoice` | Live |
| **1** | Ask questions about his data | `crm_list_jobs`, `crm_get_job`, `crm_list_stock`, `crm_list_customers`, `crm_pipeline_summary`, `crm_list_purchase_orders` — read-only, allowlisted columns, row caps | After cutover |
| **2** | Change things by asking | Narrow writes onto existing RPCs: `crm_set_step_date`, `crm_advance_job`, `crm_update_notes`. Each returns what it *would* do and requires an explicit confirming call | After Phase 1 has been used enough to be trusted |
| **3** | Act | `crm_send_email` (through `send-email`, so test mode still applies), draft a CES summary | After Phase 2 |

Phase 1 is where most of the value is. Resist shipping 2 and 3 together with
it — a read-only assistant that is occasionally wrong costs nothing, and a
writing one that is occasionally wrong costs a job.

---

## 6. Out of scope: the AI does not change the system

Worth writing in Fred-facing words, because it is the thing he is most likely
to ask for once Phase 1 impresses him.

> The assistant can read your CRM and, later, update job records. It cannot
> change how the system *works* — it can't edit the app, deploy changes, alter
> the database structure or touch the hosting. Those need code review, testing
> and someone accountable for the result. Ask Vanessa for those.

The reasoning, for us: wiring GitHub, Cloudflare and the Supabase Management
API into an agent reachable from a chat box is an enormous security surface
for very little gain, when Claude Code already does exactly that job locally
with a human watching. **The MCP path grows data tools and business-action
tools. It does not become a deploy bot.**

---

## 7. In-app chat, if it is ever needed

Only if Fred will not use a connector. Sketch, so the decision is cheap later:

- "Ask CRM" panel, admin-only, same tool layer.
- Threads in `ai_chat_threads` / `ai_chat_messages`; session-only for v1.
- Tool results rendered as compact tables, with which tool ran shown.
- Cost on the CRM's Anthropic key, visible in the existing usage card — and
  that cost is the reason this is the fallback and not the plan.

---

## 8. Open questions

1. **Does Fred actually want this?** He has Claude Max, which means he *can*.
   Nobody has asked whether querying the CRM in a chat is something he wants
   or a solution looking for a problem. Worth asking before building Phase 1,
   because the honest answer might be "he wants better reports", which is a
   different and cheaper build.
2. **Token budget.** Phase 1 on MCP costs the CRM nothing. If the in-app
   fallback ever happens, it needs a cap in `ai_call_log`, which has none.
3. **Does read-only mean current-state-only?** "What did this job look like in
   July" needs `job_events`, which is a bigger read surface than the tables.
   Defer to Phase 2.

---

## 9. Sequencing

Nothing here starts before cutover. The order when it does:

1. Ask Fred question 8.1.
2. Tool layer + restricted identity + logging — the part that has to be right.
3. Phase 1 read tools, MCP transport, token auth.
4. Set it up with Fred in one sitting.
5. Phase 2 only once Phase 1 has been genuinely used.
