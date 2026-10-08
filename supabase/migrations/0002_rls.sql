-- LCOS RLS and integrity rules.
-- Principle: a user sees a client only through an assignment; admins see all; the agent (service role,
-- app.actor = 'agent') can create drafts and move records INTO review but never past it.

-- ---------- helpers ----------
create or replace function app.current_user_role() returns app.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function app.has_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.client_assignments a where a.client_id = cid and a.user_id = auth.uid())
$$;

create or replace function app.client_role(cid uuid) returns app.user_role
language sql stable security definer set search_path = public as $$
  select case when app.is_admin() then 'admin'::app.user_role
         else (select role_on_client from public.client_assignments where client_id = cid and user_id = auth.uid()) end
$$;

create or replace function app.is_agent() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.actor', true), '') = 'agent'
$$;

create or replace function app.can_publish() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_publish from public.profiles where id = auth.uid()), false)
$$;

-- ---------- enable RLS everywhere ----------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security; -- no policies: service role only
alter table public.sources enable row level security;
alter table public.facts enable row level security;
alter table public.fact_versions enable row level security;
alter table public.sops enable row level security;
alter table public.client_sop_exceptions enable row level security;
alter table public.audit_templates enable row level security;
alter table public.audits enable row level security;
alter table public.findings enable row level security;
alter table public.flows enable row level security;
alter table public.proposed_changes enable row level security;
alter table public.cycles enable row level security;
alter table public.calendar_slots enable row level security;
alter table public.briefs enable row level security;
alter table public.copy_versions enable row level security;
alter table public.meetings enable row level security;
alter table public.decisions enable row level security;
alter table public.tasks enable row level security;
alter table public.commitments enable row level security;
alter table public.approvals enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.approval_requests enable row level security;

-- ---------- profiles / clients / assignments ----------
create policy profiles_select on public.profiles for select using (true);
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid() or app.is_admin()) with check (id = auth.uid() or app.is_admin());

create policy clients_select on public.clients for select using (app.has_client(id));
create policy clients_admin_write on public.clients for all using (app.is_admin()) with check (app.is_admin());

create policy assignments_select on public.client_assignments for select using (app.has_client(client_id));
create policy assignments_admin_write on public.client_assignments for all using (app.is_admin()) with check (app.is_admin());

-- agency-level playbook: everyone reads, admins write
create policy sops_select on public.sops for select using (true);
create policy sops_admin_write on public.sops for all using (app.is_admin()) with check (app.is_admin());
create policy audit_templates_select on public.audit_templates for select using (true);
create policy audit_templates_admin_write on public.audit_templates for all using (app.is_admin()) with check (app.is_admin());

-- ---------- generic client-scoped policies ----------
-- select: anyone assigned; write: account_lead or admin (contributors are limited by triggers below)
do $$
declare t text;
begin
  foreach t in array array[
    'integrations','sources','facts','client_sop_exceptions','audits','findings','flows','proposed_changes',
    'cycles','calendar_slots','briefs','copy_versions','meetings','decisions','tasks','commitments',
    'approvals','agent_jobs','agent_runs','approval_requests']
  loop
    execute format('create policy %I_select on public.%I for select using (app.has_client(client_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (app.has_client(client_id)) with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (app.client_role(client_id) in (''admin'',''account_lead''))', t, t);
  end loop;
end $$;

-- fact_versions has no client_id: scope through the fact
create policy fact_versions_select on public.fact_versions for select
  using (exists (select 1 from public.facts f where f.id = fact_id and app.has_client(f.client_id)));
create policy fact_versions_insert on public.fact_versions for insert
  with check (exists (select 1 from public.facts f where f.id = fact_id and app.has_client(f.client_id)));
create policy fact_versions_update on public.fact_versions for update
  using (exists (select 1 from public.facts f where f.id = fact_id and app.has_client(f.client_id)));

-- ---------- integrity triggers ----------

-- Only admins change roles or the publish permission.
create or replace function app.guard_profile_role() returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.can_publish is distinct from old.can_publish) and not app.is_admin() then
    raise exception 'only an admin can change roles or publish permission';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function app.guard_profile_role();

-- Facts: versioning, approval rules, agent limits, sensitive categories need an admin.
create or replace function app.fact_sensitive(c app.fact_category) returns boolean language sql immutable as $$
  select c in ('offers_discounts','brand_voice','pricing_economics','constraints_rules','claims_compliance')
$$;

create or replace function app.facts_before_insert() returns trigger language plpgsql as $$
begin
  if app.is_agent() then
    new.status := 'proposed'; new.proposed_by_kind := 'agent';
  end if;
  if new.status in ('verified','approved') and app.is_agent() then
    raise exception 'agent cannot create verified or approved facts';
  end if;
  return new;
end $$;
create trigger facts_bi before insert on public.facts for each row execute function app.facts_before_insert();

create or replace function app.facts_after_insert() returns trigger language plpgsql as $$
begin
  insert into public.fact_versions (fact_id, version, statement, status, changed_by, change_note)
  values (new.id, 1, new.statement, new.status, auth.uid(), 'created');
  return new;
end $$;
create trigger facts_ai after insert on public.facts for each row execute function app.facts_after_insert();

create or replace function app.facts_before_update() returns trigger language plpgsql as $$
declare r app.user_role := app.client_role(new.client_id);
begin
  if app.is_agent() and (new.status is distinct from old.status) then
    raise exception 'agent cannot change fact status';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if app.fact_sensitive(new.category) and not app.is_admin() then
      raise exception 'approving % facts requires an admin', new.category;
    end if;
    if r not in ('admin','account_lead') then
      raise exception 'only an account lead or admin can approve facts';
    end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    if r not in ('admin','account_lead') then
      raise exception 'only an account lead or admin can verify facts';
    end if;
    new.verified_by := auth.uid(); new.verified_at := now();
  end if;
  if new.statement is distinct from old.statement then
    new.version := old.version + 1;
    -- an edit to an approved fact reopens it
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'proposed'; new.approved_by := null; new.approved_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger facts_bu before update on public.facts for each row execute function app.facts_before_update();

create or replace function app.facts_after_update() returns trigger language plpgsql as $$
begin
  if new.version <> old.version or new.status is distinct from old.status then
    insert into public.fact_versions (fact_id, version, statement, status, changed_by, change_note)
    values (new.id, new.version, new.statement, new.status, auth.uid(),
            case when new.version <> old.version then 'statement changed' else 'status: ' || new.status::text end);
  end if;
  return new;
end $$;
create trigger facts_au after update on public.facts for each row execute function app.facts_after_update();

-- Copy versions are immutable.
create or replace function app.block_change() returns trigger language plpgsql as $$
begin raise exception 'copy versions are immutable; create a new version'; end $$;
create trigger copy_versions_immutable before update or delete on public.copy_versions
  for each row execute function app.block_change();

create or replace function app.copy_versions_before_insert() returns trigger language plpgsql as $$
declare b public.briefs;
begin
  select * into b from public.briefs where id = new.brief_id;
  new.client_id := b.client_id;
  new.version := b.current_copy_version + 1;
  if app.is_agent() then new.created_by_kind := 'agent'; end if;
  -- the agent may only cite approved facts
  if new.created_by_kind = 'agent' and exists (
      select 1 from unnest(new.fact_ids) fid join public.facts f on f.id = fid where f.status <> 'approved') then
    raise exception 'agent copy may cite only approved facts';
  end if;
  update public.briefs set current_copy_version = new.version,
    status = case when status in ('internal_approved','client_approved') then 'draft'::app.brief_status else status end,
    internal_approved_version = case when status in ('internal_approved','client_approved') then null else internal_approved_version end,
    updated_at = now()
    where id = new.brief_id;
  return new;
end $$;
create trigger copy_versions_bi before insert on public.copy_versions
  for each row execute function app.copy_versions_before_insert();

-- Briefs: approval on a version; edits after approval reset; contributors limited to design fields; agent stops at review.
create or replace function app.briefs_before_update() returns trigger language plpgsql as $$
declare r app.user_role := app.client_role(new.client_id); content_changed boolean;
begin
  content_changed := (new.goal, new.segment, new.offer_fact_id, new.key_message, new.proof, new.cta, new.title)
                     is distinct from (old.goal, old.segment, old.offer_fact_id, old.key_message, old.proof, old.cta, old.title);
  if r = 'contributor' and (content_changed or new.status is distinct from old.status or new.qa_checklist is distinct from old.qa_checklist) then
    raise exception 'contributors may change only design fields on a brief';
  end if;
  if app.is_agent() and new.status not in ('draft','copy_review') then
    raise exception 'agent cannot move a brief past review';
  end if;
  if new.status = 'internal_approved' and old.status is distinct from 'internal_approved' then
    if not app.is_admin() then raise exception 'internal approval requires an admin'; end if;
    if new.current_copy_version = 0 then raise exception 'nothing to approve: no copy version'; end if;
    if exists (select 1 from jsonb_array_elements(new.qa_checklist) i where coalesce((i->>'passed')::boolean, false) = false) then
      raise exception 'QA checklist has failed or unchecked items';
    end if;
    new.internal_approved_version := new.current_copy_version;
    new.internal_approved_by := auth.uid(); new.internal_approved_at := now();
  end if;
  if new.status = 'client_approved' and old.status is distinct from 'client_approved' then
    if old.status <> 'internal_approved' then raise exception 'client approval requires internal approval first'; end if;
    if new.client_approval_evidence_url is null then raise exception 'client approval needs evidence (Figma or Slack link)'; end if;
    new.client_approved_at := now();
  end if;
  if content_changed and old.status in ('internal_approved','client_approved') then
    new.status := 'draft'; new.internal_approved_version := null; new.internal_approved_by := null;
    new.internal_approved_at := null; new.client_approved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger briefs_bu before update on public.briefs for each row execute function app.briefs_before_update();

-- Flows: contributors may only attach designs; agent may only write documented_logic draft and sync fields.
create or replace function app.flows_before_update() returns trigger language plpgsql as $$
declare r app.user_role := app.client_role(new.client_id);
begin
  if r = 'contributor' and (new.rebuild_status is distinct from old.rebuild_status or new.documented_logic is distinct from old.documented_logic) then
    raise exception 'contributors may only attach designs to a flow';
  end if;
  if app.is_agent() and new.rebuild_status is distinct from old.rebuild_status then
    raise exception 'agent cannot change rebuild status';
  end if;
  if new.rebuild_status = 'live' and old.rebuild_status is distinct from 'live' and not app.is_admin() then
    raise exception 'marking a flow live requires an admin';
  end if;
  return new;
end $$;
create trigger flows_bu before update on public.flows for each row execute function app.flows_before_update();

-- Proposed changes: approve = admin; apply = publisher permission.
create or replace function app.changes_before_update() returns trigger language plpgsql as $$
begin
  if app.is_agent() and new.status is distinct from old.status then raise exception 'agent cannot change a proposal status'; end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if not app.is_admin() then raise exception 'approving a flow change requires an admin'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  if new.status = 'applied' and old.status is distinct from 'applied' then
    if old.status <> 'approved' then raise exception 'a change must be approved before it is applied'; end if;
    if not app.can_publish() then raise exception 'applying a live change requires publish permission'; end if;
    new.applied_by := auth.uid(); new.applied_at := now();
  end if;
  return new;
end $$;
create trigger changes_bu before update on public.proposed_changes for each row execute function app.changes_before_update();

-- Cycles: plan approval = admin.
create or replace function app.cycles_before_update() returns trigger language plpgsql as $$
begin
  if app.is_agent() and new.status not in ('draft','internal_review') then raise exception 'agent cannot approve a plan'; end if;
  if new.status in ('approved','active') and old.status not in ('approved','active') then
    if not app.is_admin() then raise exception 'approving a cycle plan requires an admin'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger cycles_bu before update on public.cycles for each row execute function app.cycles_before_update();

-- Findings: agent creates 'new' only; promotion/dismissal is human; dismissal needs a reason.
create or replace function app.findings_guard() returns trigger language plpgsql as $$
begin
  if app.is_agent() then
    if tg_op = 'INSERT' then new.status := 'new'; new.created_by_kind := 'agent';
    elsif new.status is distinct from old.status then raise exception 'agent cannot change finding status'; end if;
  end if;
  if new.status = 'dismissed' and coalesce(new.dismiss_reason, '') = '' then
    raise exception 'dismissing a finding requires a reason';
  end if;
  return new;
end $$;
create trigger findings_bi before insert on public.findings for each row execute function app.findings_guard();
create trigger findings_bu before update on public.findings for each row execute function app.findings_guard();

-- Audits: agent may prefill only; publishing an onboarding/quarterly audit requires an admin.
create or replace function app.audits_before_update() returns trigger language plpgsql as $$
begin
  if app.is_agent() and new.status not in ('scheduled','prefilled') then raise exception 'agent cannot review or publish an audit'; end if;
  if new.status = 'published' and old.status is distinct from 'published' and new.kind <> 'health_review' and not app.is_admin() then
    raise exception 'publishing an audit requires an admin';
  end if;
  if new.status = 'reviewed' and old.status is distinct from 'reviewed' then new.reviewed_by := auth.uid(); end if;
  return new;
end $$;
create trigger audits_bu before update on public.audits for each row execute function app.audits_before_update();

-- Approvals: the decider is the current user and must hold the right role.
create or replace function app.approvals_before_insert() returns trigger language plpgsql as $$
begin
  if app.is_agent() then raise exception 'agent cannot record approvals'; end if;
  new.decided_by := auth.uid();
  if app.client_role(new.client_id) not in ('admin','account_lead') then
    raise exception 'only an account lead or admin can approve';
  end if;
  return new;
end $$;
create trigger approvals_bi before insert on public.approvals for each row execute function app.approvals_before_insert();

-- Approval requests: decided by admins only.
create or replace function app.requests_before_update() returns trigger language plpgsql as $$
begin
  if new.status in ('approved','rejected') and old.status = 'pending' then
    if not app.is_admin() then raise exception 'only an admin can decide an agent request'; end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  if new.status = 'executed' and old.status <> 'approved' then raise exception 'cannot execute an unapproved request'; end if;
  return new;
end $$;
create trigger requests_bu before update on public.approval_requests for each row execute function app.requests_before_update();

-- Tasks: contributors may update only their own tasks.
create or replace function app.tasks_guard() returns trigger language plpgsql as $$
begin
  if app.client_role(new.client_id) = 'contributor' and old.owner_id is distinct from auth.uid() then
    raise exception 'contributors may update only tasks they own';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tasks_bu before update on public.tasks for each row execute function app.tasks_guard();

-- Commitments: owner is required by schema; closing is by the owner, lead, or admin.
create or replace function app.commitments_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.owner_id <> auth.uid() and app.client_role(new.client_id) not in ('admin','account_lead') then
    raise exception 'only the owner, an account lead, or an admin can close a commitment';
  end if;
  return new;
end $$;
create trigger commitments_bu before update on public.commitments for each row execute function app.commitments_guard();
