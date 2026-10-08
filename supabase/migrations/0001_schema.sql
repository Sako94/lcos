-- LCOS schema v1 — Lifecycle Client Operating System (Wavy Studios)
-- Every client-scoped table carries client_id; isolation is enforced by RLS in 0002_rls.sql.
-- Secrets never live in these tables (see integration_secrets: service-role only).

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------- enums ----------
create type app.user_role as enum ('admin', 'account_lead', 'contributor');
create type app.integration_system as enum ('klaviyo', 'clickup', 'shopify', 'onetext', 'slack', 'fireflies', 'figma', 'gdrive');
create type app.integration_mode as enum ('read', 'write', 'upload', 'link', 'none');
create type app.integration_status as enum ('connected', 'pending', 'not_connected', 'error');
create type app.source_kind as enum ('transcript', 'upload', 'platform_report', 'link', 'note', 'contract');
create type app.fact_category as enum (
  'business_objective', 'stakeholders', 'products_launches', 'pricing_economics', 'customer_audience',
  'brand_voice', 'claims_compliance', 'offers_discounts', 'platforms_access', 'lists_segments_consent',
  'constraints_rules', 'assets_references');
create type app.fact_status as enum ('proposed', 'verified', 'approved', 'stale');
create type app.actor_kind as enum ('user', 'agent');
create type app.sop_wave as enum ('mvp', 'phase2', 'phase3');
create type app.sop_status as enum ('draft', 'approved', 'retired');
create type app.audit_kind as enum ('onboarding', 'quarterly', 'health_review');
create type app.audit_status as enum ('scheduled', 'prefilled', 'reviewed', 'published');
create type app.confidence as enum ('low', 'medium', 'high');
create type app.finding_status as enum ('new', 'confirmed', 'promoted', 'dismissed');
create type app.rebuild_status as enum (
  'not_started', 'documented', 'redesign', 'copy_ready', 'internal_review', 'client_approval', 'built_draft', 'live');
create type app.change_status as enum ('proposed', 'approved', 'applied', 'verified', 'rejected');
create type app.cycle_status as enum ('draft', 'internal_review', 'approved', 'active', 'closed');
create type app.channel as enum ('email', 'sms');
create type app.slot_purpose as enum ('education', 'product', 'promotion', 'launch', 'retention');
create type app.brief_status as enum (
  'draft', 'copy_review', 'qa', 'internal_approved', 'client_approved', 'scheduled', 'sent', 'cancelled');
create type app.meeting_status as enum ('planned', 'pre_read_sent', 'held', 'closed');
create type app.commitment_status as enum ('open', 'done', 'missed', 'dropped');
create type app.task_status as enum ('todo', 'in_progress', 'review', 'done', 'cancelled');
create type app.approval_decision as enum ('approved', 'rejected');
create type app.run_status as enum ('queued', 'running', 'succeeded', 'failed', 'needs_approval');
create type app.request_status as enum ('pending', 'approved', 'rejected', 'executed');

-- ---------- identity ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role app.user_role not null default 'contributor',
  can_publish boolean not null default false, -- Publisher permission: nobody holds it in MVP
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website text,
  objective text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.client_assignments (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_on_client app.user_role not null default 'contributor',
  primary key (client_id, user_id)
);

-- ---------- integrations (no secrets here) ----------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  system app.integration_system not null,
  mode app.integration_mode not null default 'none',
  status app.integration_status not null default 'not_connected',
  external_account_id text,
  external_account_name text,
  scope_note text,
  last_verified_at timestamptz,
  unique (client_id, system)
);

-- Service-role only. RLS enabled with no policies => invisible to app users.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  secret_ref text not null, -- reference into the secret store (Vault / env), never the token itself
  updated_at timestamptz not null default now()
);

-- ---------- sources ----------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind app.source_kind not null,
  title text not null,
  url text,
  external_id text,
  captured_at date,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------- Source of Truth ----------
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  category app.fact_category not null,
  statement text not null,
  status app.fact_status not null default 'proposed',
  source_id uuid references public.sources (id),
  source_quote text,
  proposed_by_kind app.actor_kind not null default 'user',
  proposed_by uuid references public.profiles (id),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  review_due date,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fact_versions (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.facts (id) on delete cascade,
  version int not null,
  statement text not null,
  status app.fact_status not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  change_note text
);
create index on public.fact_versions (fact_id, changed_at desc);

-- ---------- Playbook ----------
create table public.sops (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  name text not null,
  area text not null,
  wave app.sop_wave not null,
  purpose text not null,
  trigger_text text not null,
  inputs jsonb not null default '[]',
  steps jsonb not null default '[]',
  decision_rules jsonb not null default '[]',
  output text not null,
  checklist jsonb not null default '[]',
  owner_role app.user_role not null,
  approval_role app.user_role,
  screen text,
  version int not null default 1,
  status app.sop_status not null default 'draft',
  updated_at timestamptz not null default now()
);

create table public.client_sop_exceptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  sop_id uuid not null references public.sops (id) on delete cascade,
  exception text not null,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz
);

-- ---------- Audits ----------
create table public.audit_templates (
  version int primary key,
  areas jsonb not null, -- [{key, name, weight, checks, source, score1, score5}]
  created_at timestamptz not null default now()
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  template_version int not null references public.audit_templates (version),
  kind app.audit_kind not null,
  period_start date not null,
  period_end date not null,
  status app.audit_status not null default 'scheduled',
  scores jsonb not null default '{}', -- {area_key: {score, evidence_url, reason, set_by_kind}}
  overall numeric(5,1),
  run_by uuid references public.profiles (id),
  agent_run_id uuid,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  audit_id uuid references public.audits (id) on delete set null,
  area text not null,
  title text not null,
  detail text,
  evidence_url text,
  severity int not null check (severity between 1 and 3),
  confidence app.confidence not null default 'medium',
  impact int check (impact between 1 and 5),
  effort int check (effort between 1 and 5),
  status app.finding_status not null default 'new',
  dismiss_reason text,
  next_action text,
  created_by_kind app.actor_kind not null default 'user',
  created_by uuid references public.profiles (id),
  agent_run_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- Flows ----------
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  external_id text not null,
  name text not null,
  trigger_type text,
  external_status text,
  archived boolean not null default false,
  documented_logic text,
  rebuild_status app.rebuild_status not null default 'not_started',
  design_url text,
  last_synced_at timestamptz,
  unique (client_id, external_id)
);

create table public.proposed_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  flow_id uuid not null references public.flows (id) on delete cascade,
  title text not null,
  before_logic text,
  after_logic text not null,
  rationale text,
  status app.change_status not null default 'proposed',
  proposed_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  applied_by uuid references public.profiles (id),
  applied_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Cycles, calendar, briefs ----------
create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  objective text,
  status app.cycle_status not null default 'draft',
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.calendar_slots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  send_on date not null,
  channel app.channel not null,
  purpose app.slot_purpose not null,
  title text not null,
  segment text,
  offer_fact_id uuid references public.facts (id),
  notes text
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  slot_id uuid references public.calendar_slots (id) on delete set null,
  title text not null,
  goal text,
  segment text,
  offer_fact_id uuid references public.facts (id),
  key_message text,
  proof text,
  cta text,
  design_notes text,
  design_url text,
  status app.brief_status not null default 'draft',
  current_copy_version int not null default 0,
  qa_checklist jsonb not null default '[]', -- [{item, passed, checked_by, checked_at}]
  internal_approved_version int,
  internal_approved_by uuid references public.profiles (id),
  internal_approved_at timestamptz,
  client_approval_evidence_url text,
  client_approved_at timestamptz,
  owner_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immutable: no update policy, trigger blocks updates.
create table public.copy_versions (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  version int not null,
  subject_lines jsonb not null default '[]',
  preview_text text,
  body text,
  sms_body text,
  fact_ids uuid[] not null default '{}',
  created_by_kind app.actor_kind not null default 'user',
  created_by uuid references public.profiles (id),
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  unique (brief_id, version)
);

-- ---------- Meetings ----------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  scheduled_at timestamptz not null,
  pre_read text,
  agenda text,
  transcript_url text,
  status app.meeting_status not null default 'planned',
  created_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  statement text not null,
  decided_by text, -- free text: may be the client
  recorded_by uuid references public.profiles (id),
  changes_fact_id uuid references public.facts (id),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid references public.profiles (id),
  due_on date,
  status app.task_status not null default 'todo',
  linked_type text,
  linked_id uuid,
  clickup_task_id text unique,
  clickup_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  statement text not null,
  owner_id uuid not null references public.profiles (id), -- a commitment without an owner cannot be saved
  due_on date not null,
  status app.commitment_status not null default 'open',
  task_id uuid references public.tasks (id),
  created_at timestamptz not null default now()
);

-- ---------- Approvals (on a version, never on a record in general) ----------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  version int not null default 1,
  decision app.approval_decision not null,
  decided_by uuid not null references public.profiles (id),
  decided_at timestamptz not null default now(),
  note text
);

-- ---------- Agent ----------
create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  job_type text not null, -- health_review | flow_sync | flow_logic_doc | fact_extraction | brief_draft | meeting_preread
  schedule text, -- cron expression or null for on-demand
  enabled boolean not null default true,
  last_run_at timestamptz,
  unique (client_id, job_type)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.agent_jobs (id) on delete set null,
  client_id uuid not null references public.clients (id) on delete cascade,
  job_type text not null,
  idempotency_key text not null unique, -- job_type:client:period
  status app.run_status not null default 'queued',
  attempt int not null default 1,
  started_at timestamptz,
  finished_at timestamptz,
  inputs jsonb not null default '{}',
  outputs jsonb not null default '{}',
  records_touched jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  action text not null,
  payload jsonb not null default '{}',
  status app.request_status not null default 'pending',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index on public.facts (client_id, category, status);
create index on public.findings (client_id, status);
create index on public.flows (client_id);
create index on public.briefs (client_id, status);
create index on public.tasks (client_id, status);
create index on public.commitments (client_id, status);
create index on public.agent_runs (client_id, job_type, created_at desc);
create index on public.approval_requests (client_id, status);
