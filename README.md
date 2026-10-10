# Wavy LCOS — Lifecycle Client Operating System

Internal workspace for Wavy Studios' lifecycle (email/SMS) team. One client, one two-week cycle, with the AI agent working on the same records as the team and never past "in review".

Stack: Next.js 16 (App Router, server actions) · Postgres with row-level security (Supabase-compatible) · `postgres` driver · Anthropic SDK for drafts · Playwright for end-to-end checks.

## What is in the MVP

| Screen | Path | Does |
| --- | --- | --- |
| Agency Home | `/` | Approval queue, new findings, overdue tasks, open commitments, meetings, recent agent runs |
| Client Overview | `/clients/[slug]` | Objective, current cycle, scorecard, integration status (connected / pending / upload / link), open client dependencies |
| Onboarding | `/clients/[slug]/onboarding`, `/onboarding/[id]` | Private client links (no login, 30-day expiry, extend/revoke/reopen); review each answer → promote to a Proposed fact citing the questionnaire, or skip |
| Client form | `/onboard/[token]` | Public 9-section questionnaire (questions in `src/lib/onboarding/questions.ts`), autosave, submit |
| Source of Truth | `/clients/[slug]/facts` | Facts by category with Proposed → Verified → Approved → Stale, sources, versions; admin approves sensitive categories |
| Audit | `/clients/[slug]/audit` | Weighted 8-area audit template, findings with confirm / promote / dismiss, "Run health review now" |
| Flows | `/clients/[slug]/flows` | Klaviyo inventory (read-only sync), documented logic, rebuild status, proposed changes with approve → apply (publish permission) → verify |
| Calendar & briefs | `/clients/[slug]/calendar`, `/briefs/[id]` | Cycles, slots, briefs, immutable copy versions, QA checklist, admin approval on a version, client approval evidence |
| Meetings | `/clients/[slug]/meetings/[id]` | Pre-read (agent draft), decisions, commitments with owner + due date mirrored to ClickUp |
| Playbook | `/playbook` | 22 SOP records (9 MVP ones in full) and the audit template |
| Agent activity | `/agent`, `/agent/runs/[id]` | Jobs, run log with inputs/outputs/records touched, actions awaiting approval |

Rules the database enforces (see `supabase/migrations/0002_rls.sql` and `supabase/tests/rls_and_rules.sql`): client isolation by assignment; contributors cannot approve or change status; admins approve sensitive facts, cycle plans, and briefs; approval is on a copy version and a content edit resets it; copy versions are immutable; the agent can only create Proposed facts, New findings, drafts, and copy that cites Approved facts; applying a live flow change needs the separate `can_publish` flag (nobody has it in the MVP); duplicate agent runs are blocked by an idempotency key; a client link writes only through `app.onboarding_*` functions (token, status and expiry checked), client answers are kept as given, and only leads/admins review them.

## Run locally

```bash
cp .env.example .env.local            # AUTH_MODE=dev, DATABASE_URL to a local Postgres
scripts/db-reset-local.sh             # migrations + auth stub + seed (Atrakt, team, SOPs)
npm install && npm run dev            # http://localhost:3000 — pick a seeded team member to sign in
```

Checks:

```bash
npm run test:db      # 85 RLS and rule checks against a fresh database
npm run build && npm run start &
npm run test:e2e     # 42 Playwright checks across every screen and role
```

## Deploy on Supabase + Vercel (or any Node host)

1. Create a Supabase project. Run `supabase/migrations/*.sql` in order (SQL editor or `supabase db push`). Do **not** run anything in `supabase/local/`.
2. Create the team users in Supabase Auth (email + password or magic link). The `handle_new_user` trigger creates a profile as `contributor`; set roles in `public.profiles` (`admin` for Sako, `account_lead` for Drew and JeanClaude). Then run `supabase/seed/0001_agency.sql` and `0002_atrakt.sql` after replacing the fixed user ids with the real `auth.users` ids (search for `00000000-0000-4000-8000-00000000000`).
3. Environment: `DATABASE_URL` = the project's Postgres connection string (the app sets `request.jwt.claim.sub` per request, which Supabase's `auth.uid()` reads); `AUTH_MODE=supabase` with the project URL and anon key; `KLAVIYO_API_KEY__atrakt` (read-only private key); `CLICKUP_API_TOKEN` and `CLICKUP_LIST_ID__atrakt`; `ANTHROPIC_API_KEY` (optional — without it the agent produces deterministic templates and says so); `CRON_SECRET`.
4. Schedule `POST /api/jobs/run` with header `x-cron-secret` daily (Vercel Cron, Supabase cron, GitHub Actions). It runs every enabled scheduled job once per client per day.

Credentials live only in environment variables; `public.integration_secrets` holds references, never tokens, and has no RLS policies (service role only).

## Layout

```
supabase/migrations/   schema, RLS + triggers, auth hook, audit functions
supabase/seed/         agency (profiles, SOPs, audit template) and Atrakt (facts, flows, audit, findings, jobs)
supabase/local/        Postgres-only stand-ins for Supabase auth (never deploy)
supabase/tests/        SQL rule tests
src/lib/db.ts          withUser (RLS as the signed-in user) · withAgent (service role, app.actor=agent) · withService
src/lib/agent/         runner (idempotency, retries, run log, failure task) and jobs
src/lib/integrations/  Klaviyo (read-only), ClickUp (task mirror), secrets (env only)
src/app/               screens and server actions
scripts/               db-reset-local.sh, smoke.mjs
```

## Not in the MVP

Sending, editing live flows or segments, suppressing profiles, client logins, One Text API, Shopify reads (connector pending), automated reporting emails, Fireflies auto-import. All are designed into the schema (see the PRD) and gated behind approval records.

## Operating model additions (migration 0006)

Adopted from the October 2026 audit of the Atrakt hub:

- **Evidence model** — every fact and finding carries an `evidence_class` (stated, observed, inferred, modeled, proposed) and, for figures, a `metric_basis` naming a key from the metric dictionary with its window, time basis and population. Observed/inferred/modeled facts cannot be Verified without a basis or a snapshot. Corrections supersede (`superseded_by` + `correction_note`) and mark the old fact Stale.
- **Snapshots** — every agent read (`flow_report_30d`, `campaign_report_30d`, `flow_inventory`, `flow_message_html`) is stored immutably with a content hash; agent findings must cite one.
- **Flow messages and the nightly link check** (`link_check`, 05:30 PT) — each live message's subject, sender and links; Severity 1 findings for links off the client's `approved_domains`, `old_brand_terms` in copy, or an old-brand sender name, pointing at the exact message and HTML snapshot.
- **Decision register** — open decisions with owner side/role, options, what they unlock and a due date; linked to the findings, briefs or journeys they block; closed only with an outcome and who decided.
- **Target journeys** — seven stages next to the Klaviyo flows; steps with entry, anchor, delay, do-not-send rules and `[[TOKEN]]` bindings that must resolve to Approved facts before approval; going live needs publish permission.
- **Experiments** — predeclared tests (control, primary metric, readout date, approval) whose design is frozen once running.
- **Metric dictionary** (`/playbook/metrics`) — one definition per number; caveats live there, not on every figure.
- **Contact policy** on the client (weekly caps, promotion streak, quiet hours, collision rule), enforced by the database when a cycle plan is approved; slots carry priority, audience rule, exclusions and `replaces_slot_id` for conditional sends.
- **Design handoff** on briefs (context, copy notes, design direction, delivery, ready check) released only when complete.
- **Targets** — floor / record / stretch per metric with gated levers; modeled evidence, admin-approved.
