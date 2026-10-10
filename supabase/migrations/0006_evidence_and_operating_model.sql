-- 0006: evidence model, snapshots, message-level findings, decision register, target journeys,
-- experiments, metric dictionary, contact policy, design handoff, quarterly targets.
-- Adopted from the Atrakt hub audit (Oct 2026). Every new record keeps the LCOS operating rules:
-- the agent proposes, named people approve, nothing goes live without publish permission.

-- ---------- enums ----------
create type app.evidence_class as enum ('stated', 'observed', 'inferred', 'modeled', 'proposed');
create type app.decision_status as enum ('open', 'decided', 'superseded');
create type app.party as enum ('client', 'agency');
create type app.journey_stage as enum (
  'capture', 'welcome', 'recover_intent', 'deliver_routine', 'second_purchase', 'retain_reconnect', 'advocacy');
create type app.journey_status as enum ('proposed', 'approved', 'building', 'live', 'retired');
create type app.step_status as enum ('proposed', 'approved', 'built', 'live', 'retired');
create type app.experiment_status as enum ('proposed', 'approved', 'running', 'readout', 'concluded', 'abandoned');
create type app.target_status as enum ('proposed', 'approved', 'retired');

-- ---------- metric dictionary (agency level) ----------
-- One definition per number the app shows. Every fact or finding that carries a figure names its metric_key.
create table public.metric_definitions (
  key text primary key,
  name text not null,
  definition text not null,
  time_basis text not null,      -- event_time | send_date | order_date | snapshot
  source text not null,          -- where the number comes from
  caveat text,                   -- stated once here, not on every number
  unit text not null default 'usd',
  updated_at timestamptz not null default now()
);

-- ---------- snapshots: every agent read is a dated, immutable record ----------
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  source_system text not null,   -- klaviyo | shopify | onetext | hub | upload
  kind text not null,            -- flow_report_30d | campaign_report_30d | flow_inventory | flow_message_html | orders_export ...
  captured_at timestamptz not null default now(),
  window_start date,
  window_end date,
  row_count int,
  content_hash text,
  payload jsonb not null default '{}',
  agent_run_id uuid,
  created_by uuid references public.profiles (id)
);
create index on public.snapshots (client_id, kind, captured_at desc);

-- ---------- evidence fields on facts and findings ----------
alter table public.facts
  add column evidence_class app.evidence_class not null default 'stated',
  add column metric_basis jsonb,          -- {metric_key, window_start, window_end, time_basis, population, value, unit}
  add column snapshot_id uuid references public.snapshots (id) on delete set null,
  add column superseded_by uuid references public.facts (id) on delete set null,
  add column correction_note text;
create index on public.facts (superseded_by) where superseded_by is not null;

alter table public.findings
  add column evidence_class app.evidence_class not null default 'observed',
  add column metric_basis jsonb,
  add column snapshot_id uuid references public.snapshots (id) on delete set null,
  add column flow_message_id uuid,        -- fk added after flow_messages exists
  add column readiness text,              -- what must be resolved before this can be acted on
  add column next_readout text,           -- how and when we will know it worked
  add column estimate_hours_min int check (estimate_hours_min >= 0),
  add column estimate_hours_max int check (estimate_hours_max >= estimate_hours_min);

-- ---------- client-level rules used by checks and planning ----------
alter table public.clients
  add column approved_domains text[] not null default '{}',
  add column old_brand_terms text[] not null default '{}',
  add column contact_policy jsonb not null default '{
    "email_max_per_week": 4, "sms_max_per_week": 2, "promo_streak_max": 1,
    "quiet_hours": {"start": "21:00", "end": "08:00", "tz": "America/Los_Angeles"},
    "collision_rule": "A conditional send replaces its base message in the same slot; campaigns never carry an offer that conflicts with a live flow offer."
  }'::jsonb;

-- ---------- flow messages: the unit findings point at ----------
create table public.flow_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  flow_id uuid not null references public.flows (id) on delete cascade,
  external_id text not null,     -- Klaviyo flow message id (e.g. VnVQ2d)
  action_id text,
  channel app.channel not null default 'email',
  name text not null,
  subject text,
  preview_text text,
  from_label text,
  from_email text,
  external_status text,
  links jsonb not null default '[]',    -- [{href, text}]
  checks jsonb not null default '{}',   -- {old_domain:[href], old_brand:[term], sender_old_brand:bool, checked_at}
  html_snapshot_id uuid references public.snapshots (id) on delete set null,
  last_synced_at timestamptz,
  unique (client_id, external_id)
);
alter table public.findings add constraint findings_flow_message_fk
  foreign key (flow_message_id) references public.flow_messages (id) on delete set null;

-- ---------- decision register ----------
alter table public.decisions
  add column status app.decision_status not null default 'decided',  -- existing rows were recorded outcomes
  add column owner_side app.party,
  add column owner_role text,            -- "client commercial owner", "Wavy measurement lead"
  add column owner_name text,
  add column options jsonb not null default '[]',
  add column unlocks text,
  add column due_on date,
  add column decided_on date,
  add column outcome text;

create table public.decision_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  decision_id uuid not null references public.decisions (id) on delete cascade,
  record_type text not null,     -- finding | brief | proposed_change | calendar_slot | journey | experiment | target
  record_id uuid not null,
  unique (decision_id, record_type, record_id)
);
create index on public.decision_links (record_type, record_id);

-- ---------- target journeys (what the program should be) next to flows (what Klaviyo has) ----------
create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  stage app.journey_stage not null,
  name text not null,
  purpose text,
  entry_condition text,
  exit_condition text,
  sort_order int not null default 0,
  status app.journey_status not null default 'proposed',
  proposed_by_kind app.actor_kind not null default 'user',
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.journey_steps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  journey_id uuid not null references public.journeys (id) on delete cascade,
  position int not null,
  channel app.channel not null default 'email',
  name text not null,
  anchor text not null default 'entry',         -- entry | previous_step | event:<name>
  delay_hours int not null default 0,
  subject text,
  draft_body text,
  do_not_send jsonb not null default '[]',      -- ["Opt-out or suppression", "Open service case", ...]
  bindings jsonb not null default '[]',         -- [{token:"ACCEPTED_BENEFIT", fact_id:"..."}]
  current_flow_id uuid references public.flows (id) on delete set null,
  current_message_id uuid references public.flow_messages (id) on delete set null,
  status app.step_status not null default 'proposed',
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  unique (journey_id, position)
);

-- ---------- experiments: predeclared tests with a control and a readout ----------
create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  hypothesis text not null,
  treatment text,
  control text,
  primary_metric text references public.metric_definitions (key),
  min_sample int,
  stop_rule text,
  starts_on date,
  readout_on date,
  status app.experiment_status not null default 'proposed',
  predeclared_at timestamptz,
  result jsonb,
  conclusion text,
  finding_id uuid references public.findings (id) on delete set null,
  brief_id uuid references public.briefs (id) on delete set null,
  journey_step_id uuid references public.journey_steps (id) on delete set null,
  owner_id uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_by_kind app.actor_kind not null default 'user',
  created_at timestamptz not null default now()
);

-- ---------- quarterly targets with gates ----------
create table public.targets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  period text not null,                          -- 2026-Q4
  metric_key text not null references public.metric_definitions (key),
  floor_value numeric(14,2),
  record_value numeric(14,2),
  stretch_value numeric(14,2),
  basis text,                                    -- how the numbers were built
  levers jsonb not null default '[]',            -- [{name, amount, gate, gate_status}]
  evidence_class app.evidence_class not null default 'modeled',
  status app.target_status not null default 'proposed',
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (client_id, period, metric_key)
);

-- ---------- calendar: contact plan fields ----------
alter table public.calendar_slots
  add column priority int not null default 3 check (priority between 1 and 5),
  add column replaces_slot_id uuid references public.calendar_slots (id) on delete set null,
  add column audience_rule text,
  add column exclusions text;

-- ---------- briefs: design handoff ----------
alter table public.briefs
  add column handoff jsonb not null default '{}',   -- {context, copy_notes, design, delivery, ready_check:[{item, passed}]}
  add column handoff_released_at timestamptz,
  add column handoff_released_by uuid references public.profiles (id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.metric_definitions enable row level security;
create policy metric_definitions_select on public.metric_definitions for select using (true);
create policy metric_definitions_admin_write on public.metric_definitions for all using (app.is_admin()) with check (app.is_admin());

do $$
declare t text;
begin
  foreach t in array array['snapshots','flow_messages','decision_links','journeys','journey_steps','experiments','targets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select using (app.has_client(client_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (app.has_client(client_id)) with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (app.client_role(client_id) in (''admin'',''account_lead''))', t, t);
  end loop;
end $$;
grant all on all tables in schema public to authenticated, service_role;

-- ============================================================
-- Rules
-- ============================================================

-- Snapshots are immutable evidence.
create or replace function app.snapshots_immutable() returns trigger language plpgsql as $$
begin raise exception 'snapshots are immutable evidence; capture a new one instead'; end $$;
create trigger snapshots_immutable before update or delete on public.snapshots for each row execute function app.snapshots_immutable();

-- Facts: a number needs its basis before it is Verified; superseding marks the old fact Stale.
create or replace function app.facts_evidence_guard() returns trigger language plpgsql as $$
begin
  if new.evidence_class in ('observed','inferred','modeled')
     and new.status in ('verified','approved')
     and (new.metric_basis is null or new.metric_basis = '{}'::jsonb) and new.snapshot_id is null then
    raise exception 'an % fact cannot be verified without a metric basis or a snapshot', new.evidence_class;
  end if;
  if new.superseded_by is not null then
    if new.superseded_by = new.id then raise exception 'a fact cannot supersede itself'; end if;
    if coalesce(new.correction_note, '') = '' then raise exception 'superseding a fact requires a correction note'; end if;
    new.status := 'stale';
  end if;
  return new;
end $$;
create trigger facts_evidence_bi before insert on public.facts for each row execute function app.facts_evidence_guard();
-- runs after the existing facts_bu so the version/approval logic has already applied
create trigger facts_evidence_bu before update on public.facts for each row execute function app.facts_evidence_guard();

-- Findings: agent findings must cite a snapshot; a promoted finding needs a next readout.
create or replace function app.findings_evidence_guard() returns trigger language plpgsql as $$
begin
  if app.is_agent() and tg_op = 'INSERT' and new.snapshot_id is null then
    raise exception 'agent findings must cite a snapshot';
  end if;
  if new.status = 'promoted' and coalesce(new.next_readout, '') = '' then
    raise exception 'promoting a finding requires a next readout (how we will know it worked)';
  end if;
  return new;
end $$;
create trigger findings_evidence_bi before insert on public.findings for each row execute function app.findings_evidence_guard();
create trigger findings_evidence_bu before update on public.findings for each row execute function app.findings_evidence_guard();

-- Decisions: deciding needs an outcome and who decided; the agent only opens decisions.
create or replace function app.decisions_guard() returns trigger language plpgsql as $$
begin
  if app.is_agent() then
    if tg_op = 'INSERT' then new.status := 'open';
    elsif new.status is distinct from old.status then raise exception 'agent cannot decide or close a decision'; end if;
  end if;
  if new.status = 'decided' and (coalesce(new.outcome, '') = '' or coalesce(new.decided_by, '') = '') then
    raise exception 'a decided decision needs an outcome and who decided it';
  end if;
  if new.status = 'decided' and new.decided_on is null then new.decided_on := current_date; end if;
  return new;
end $$;
create trigger decisions_bi before insert on public.decisions for each row execute function app.decisions_guard();
create trigger decisions_bu before update on public.decisions for each row execute function app.decisions_guard();

-- Generic: agent inserts land as proposed; agent never changes status; approval needs an admin or lead.
create or replace function app.proposed_record_guard() returns trigger language plpgsql as $$
declare approver_needed text := tg_argv[0]; -- 'admin' or 'lead'
begin
  if app.is_agent() then
    if tg_op = 'INSERT' then new.status := 'proposed';
    elsif new.status is distinct from old.status then raise exception '% status is set by a person, not the agent', tg_table_name; end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    if approver_needed = 'admin' and not app.is_admin() then
      raise exception 'approving a % requires an admin', tg_table_name;
    elsif approver_needed = 'lead' and app.client_role(new.client_id) not in ('admin','account_lead') then
      raise exception 'approving a % requires an account lead or admin', tg_table_name;
    end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger journeys_guard_bi before insert on public.journeys for each row execute function app.proposed_record_guard('admin');
create trigger journeys_guard_bu before update on public.journeys for each row execute function app.proposed_record_guard('admin');
create trigger targets_guard_bi before insert on public.targets for each row execute function app.proposed_record_guard('admin');
create trigger targets_guard_bu before update on public.targets for each row execute function app.proposed_record_guard('admin');
create trigger experiments_guard_bi before insert on public.experiments for each row execute function app.proposed_record_guard('lead');
create trigger experiments_guard_bu before update on public.experiments for each row execute function app.proposed_record_guard('lead');

-- Journey steps: bindings resolve to Approved facts before a step is approved; going live needs publish permission.
create or replace function app.journey_steps_guard() returns trigger language plpgsql as $$
declare b jsonb; fid uuid; missing int := 0;
begin
  if app.is_agent() then
    if tg_op = 'INSERT' then new.status := 'proposed';
    elsif new.status is distinct from old.status then raise exception 'journey step status is set by a person, not the agent'; end if;
  end if;
  if new.status in ('approved','built','live') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    for b in select * from jsonb_array_elements(new.bindings) loop
      fid := nullif(b->>'fact_id', '')::uuid;
      if fid is null or not exists (select 1 from public.facts f where f.id = fid and f.status = 'approved') then missing := missing + 1; end if;
    end loop;
    if missing > 0 then raise exception '% binding(s) do not resolve to an Approved fact', missing; end if;
    if new.status = 'approved' and app.client_role(new.client_id) not in ('admin','account_lead') then
      raise exception 'approving a journey step requires an account lead or admin';
    end if;
    if new.status = 'live' and not app.can_publish() then raise exception 'setting a step live requires publish permission'; end if;
    if new.status = 'approved' then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger journey_steps_bi before insert on public.journey_steps for each row execute function app.journey_steps_guard();
create trigger journey_steps_bu before update on public.journey_steps for each row execute function app.journey_steps_guard();

-- Experiments: running requires a predeclared design; concluding requires a conclusion.
create or replace function app.experiments_rules() returns trigger language plpgsql as $$
begin
  if new.status in ('running','readout','concluded') then
    if coalesce(new.control, '') = '' or new.primary_metric is null or new.readout_on is null then
      raise exception 'an experiment needs a control, a primary metric, and a readout date before it runs';
    end if;
    if new.approved_at is null then raise exception 'an experiment must be approved before it runs'; end if;
    if new.predeclared_at is null then new.predeclared_at := now(); end if;
  end if;
  if new.status = 'concluded' and coalesce(new.conclusion, '') = '' then raise exception 'concluding an experiment requires a conclusion'; end if;
  if tg_op = 'UPDATE' and old.predeclared_at is not null and
     (new.hypothesis is distinct from old.hypothesis or new.control is distinct from old.control or new.primary_metric is distinct from old.primary_metric or new.min_sample is distinct from old.min_sample or new.stop_rule is distinct from old.stop_rule) then
    raise exception 'a predeclared experiment design cannot be changed; abandon it and propose a new one';
  end if;
  return new;
end $$;
create trigger experiments_rules_bu before update on public.experiments for each row execute function app.experiments_rules();

-- Briefs: the design handoff is released only when context, copy and every ready-check item are complete.
create or replace function app.briefs_handoff_guard() returns trigger language plpgsql as $$
declare item jsonb;
begin
  if new.handoff_released_at is not null and (old.handoff_released_at is null) then
    if app.is_agent() then raise exception 'agent cannot release a design handoff'; end if;
    if new.current_copy_version = 0 then raise exception 'handoff needs a saved copy version'; end if;
    if coalesce(new.handoff->>'context', '') = '' or coalesce(new.handoff->>'design', '') = '' then
      raise exception 'handoff needs context and design direction';
    end if;
    if jsonb_array_length(coalesce(new.handoff->'ready_check', '[]'::jsonb)) = 0 then raise exception 'handoff needs a ready check'; end if;
    for item in select * from jsonb_array_elements(new.handoff->'ready_check') loop
      if coalesce((item->>'passed')::boolean, false) = false then raise exception 'ready check item "%" has not passed', item->>'item'; end if;
    end loop;
    new.handoff_released_by := auth.uid();
  end if;
  return new;
end $$;
create trigger briefs_handoff_bu before update on public.briefs for each row execute function app.briefs_handoff_guard();

-- Cycles: contact policy is enforced at approval (weekly cap per channel, no two promotions in a row).
create or replace function app.cycle_contact_check(cid uuid) returns void language plpgsql as $$
declare pol jsonb; cap_email int; cap_sms int; streak int; r record; last_purpose text := null; last_channel text := null;
begin
  select c.contact_policy into pol from public.cycles cy join public.clients c on c.id = cy.client_id where cy.id = cid;
  cap_email := coalesce((pol->>'email_max_per_week')::int, 4);
  cap_sms := coalesce((pol->>'sms_max_per_week')::int, 2);
  streak := coalesce((pol->>'promo_streak_max')::int, 1);
  for r in
    select channel::text as channel, date_trunc('week', send_on)::date as wk, count(*) as n
    from public.calendar_slots where cycle_id = cid and replaces_slot_id is null
    group by 1, 2
  loop
    if r.channel = 'email' and r.n > cap_email then raise exception 'week of % has % email sends; contact policy allows %', r.wk, r.n, cap_email; end if;
    if r.channel = 'sms' and r.n > cap_sms then raise exception 'week of % has % SMS sends; contact policy allows %', r.wk, r.n, cap_sms; end if;
  end loop;
  if streak <= 1 then
    for r in select channel::text as channel, purpose::text as purpose from public.calendar_slots where cycle_id = cid and replaces_slot_id is null order by channel, send_on loop
      if r.channel = last_channel and r.purpose = 'promotion' and last_purpose = 'promotion' then
        raise exception 'two promotion sends in a row on % violate the contact policy', r.channel;
      end if;
      last_channel := r.channel; last_purpose := r.purpose;
    end loop;
  end if;
end $$;

create or replace function app.cycles_before_update() returns trigger language plpgsql as $$
begin
  if app.is_agent() and new.status not in ('draft','internal_review') then raise exception 'agent cannot approve a plan'; end if;
  if new.status in ('approved','active') and old.status not in ('approved','active') then
    if not app.is_admin() then raise exception 'approving a cycle plan requires an admin'; end if;
    perform app.cycle_contact_check(new.id);
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;

-- ---------- metric dictionary seed (agency level) ----------
insert into public.metric_definitions (key, name, definition, time_basis, source, caveat, unit) values
 ('store_revenue_gross', 'Gross store revenue', 'Sum of Placed Order values synced from the store, before refunds, discounts after the fact, taxes and shipping reconciliation.', 'order_date', 'Shopify orders (export or API)', 'Not net sales and not profit. Never add attributed revenue to this number.', 'usd'),
 ('attributed_revenue', 'Klaviyo-attributed revenue', 'Placed Order value Klaviyo credits to an email or SMS within its attribution window.', 'event_time', 'Klaviyo flow and campaign values reports', 'Platform attribution, not incremental revenue. Overlaps with store revenue; never summed with it.', 'usd'),
 ('flow_share_of_attribution', 'Flow share of attribution', 'Flow-attributed revenue divided by total attributed revenue over the same window.', 'event_time', 'Klaviyo flow and campaign values reports', 'A share of attribution, not of store revenue.', 'pct'),
 ('placed_order_rate', 'Placed-order rate', 'Conversions divided by recipients for a flow, message or campaign.', 'send_date', 'Klaviyo values reports', 'Counts message exposures, not unique people, when a person receives several messages.', 'pct'),
 ('spam_complaint_rate', 'Spam complaint rate', 'Spam complaints divided by delivered, volume-weighted across sends in the window.', 'send_date', 'Klaviyo values reports', 'Provider-reported; Gmail does not report complaints at the message level.', 'pct'),
 ('unsubscribe_rate', 'Unsubscribe rate', 'Unsubscribes divided by delivered, volume-weighted across sends in the window.', 'send_date', 'Klaviyo values reports', null, 'pct'),
 ('bounce_rate', 'Bounce rate', 'Bounced divided by attempted, volume-weighted across sends in the window.', 'send_date', 'Klaviyo values reports', 'Concentrated bounces in one message point at intake, not the whole list.', 'pct'),
 ('campaign_count', 'Campaigns sent', 'Distinct campaigns with at least one recipient in the window.', 'send_date', 'Klaviyo campaign values report', 'A cancelled campaign that partially delivered still counts.', 'count'),
 ('repeat_rate_60d', 'Mature 60-day repeat rate', 'Share of first-time buyers with a second paid order within 60 days, among buyers whose 60 days have fully elapsed.', 'order_date', 'Shopify orders', 'Only mature cohorts; immature months are excluded, not estimated.', 'pct'),
 ('value_per_customer_180d', '180-day value per customer', 'Observed order value per eligible customer in the first 180 days after the first order, by first-order month.', 'order_date', 'Shopify orders', 'Descriptive; does not control for season, product or promotion mix.', 'usd'),
 ('sms_subscribe_events', 'SMS subscribe events', 'Count of subscribe events in the window.', 'event_time', 'OneText custom events in Klaviyo', 'Events, not unique marketable people; OneText is the consent source of truth.', 'count'),
 ('list_growth_net', 'Net list growth', 'New subscribed, eligible email profiles minus unsubscribes and suppressions in the window.', 'event_time', 'Klaviyo profiles and lists', 'Form submits are not unique subscribers.', 'count')
on conflict (key) do update set name = excluded.name, definition = excluded.definition, time_basis = excluded.time_basis, source = excluded.source, caveat = excluded.caveat, unit = excluded.unit, updated_at = now();
