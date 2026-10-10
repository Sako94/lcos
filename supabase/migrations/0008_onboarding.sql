-- Client onboarding questionnaire.
-- A client fills the form through a private link (no login). Their answers are evidence, not truth:
-- each answer is reviewed by an account lead or admin, who promotes it into a Proposed fact (source = the
-- submitted questionnaire) or skips it. From there the normal Source of Truth flow applies
-- (Proposed → Verified → Approved).
--
-- Who can do what:
--   client (private link)  → only through app.onboarding_* functions below; save answers while the form is
--                            open, submit once. Cannot see or touch review fields.
--   account lead / admin   → create, extend, revoke, reopen links; review answers; mark the form reviewed.
--   contributor            → read only.
--   agent                  → read only (it cannot send links to clients or decide reviews).

create type app.onboarding_status as enum ('sent', 'in_progress', 'submitted', 'reviewed', 'revoked');
create type app.answer_review as enum ('pending', 'promoted', 'skipped');

create table public.onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  questionnaire_version int not null default 1,
  status app.onboarding_status not null default 'sent',
  respondent_name text,
  respondent_email text,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  first_opened_at timestamptz,
  last_saved_at timestamptz,
  submitted_at timestamptz,
  submitted_by_name text,
  source_id uuid references public.sources (id),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz
);
create index on public.onboarding_forms (client_id, created_at desc);

create table public.onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.onboarding_forms (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  section_key text not null,
  question_key text not null,
  value jsonb not null, -- string, or array of strings for multi-select
  updated_at timestamptz not null default now(),
  review_status app.answer_review not null default 'pending',
  fact_id uuid references public.facts (id) on delete set null,
  review_note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  unique (form_id, question_key)
);
create index on public.onboarding_answers (form_id);

alter table public.onboarding_forms enable row level security;
alter table public.onboarding_answers enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onboarding_forms', 'onboarding_answers'] loop
    execute format('create policy %I_select on public.%I for select using (app.has_client(client_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (app.has_client(client_id)) with check (app.has_client(client_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (app.client_role(client_id) in (''admin'',''account_lead''))', t, t);
  end loop;
end $$;

create or replace function app.is_client_link() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.actor', true), '') = 'client'
$$;

-- ---------- team-side guards ----------

create or replace function app.onboarding_forms_guard() returns trigger language plpgsql as $$
declare r app.user_role;
begin
  if app.is_client_link() then
    -- the client path only runs inside app.onboarding_* functions, which set this flag
    if coalesce(current_setting('app.onboarding_fn', true), '') <> 'on' then
      raise exception 'client link changes go through the onboarding functions';
    end if;
    return new;
  end if;
  if app.is_agent() then raise exception 'agent cannot create or change onboarding links'; end if;
  r := app.client_role(new.client_id);
  if tg_op = 'INSERT' then
    if r is null or r not in ('admin', 'account_lead') then
      raise exception 'only an account lead or admin can create an onboarding link';
    end if;
    new.created_by := auth.uid();
    new.status := 'sent';
    return new;
  end if;
  if r is null or r not in ('admin', 'account_lead') then
    raise exception 'only an account lead or admin can change an onboarding link';
  end if;
  if new.token is distinct from old.token or new.client_id is distinct from old.client_id
     or new.submitted_at is distinct from old.submitted_at or new.submitted_by_name is distinct from old.submitted_by_name
     or new.source_id is distinct from old.source_id then
    raise exception 'link token, client and submission details cannot be changed';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'reviewed' then
      if old.status <> 'submitted' then raise exception 'only a submitted questionnaire can be marked reviewed'; end if;
      if exists (select 1 from public.onboarding_answers a where a.form_id = new.id and a.review_status = 'pending') then
        raise exception 'every answer must be promoted or skipped before the questionnaire is marked reviewed';
      end if;
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    elsif new.status = 'in_progress' then
      -- reopen a submitted form so the client can make changes
      if old.status not in ('submitted', 'revoked') then raise exception 'only a submitted or revoked questionnaire can be reopened'; end if;
      if new.expires_at <= now() then new.expires_at := now() + interval '14 days'; end if;
    elsif new.status = 'revoked' then
      if old.status = 'reviewed' then raise exception 'a reviewed questionnaire cannot be revoked'; end if;
    else
      raise exception 'status % cannot be set by the team', new.status;
    end if;
  end if;
  return new;
end $$;
create trigger onboarding_forms_guard before insert or update on public.onboarding_forms
  for each row execute function app.onboarding_forms_guard();

create or replace function app.onboarding_answers_guard() returns trigger language plpgsql as $$
declare r app.user_role;
begin
  if app.is_client_link() then
    if coalesce(current_setting('app.onboarding_fn', true), '') <> 'on' then
      raise exception 'client answers go through the onboarding functions';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then raise exception 'answers are written by the client through their link'; end if;
  if app.is_agent() then raise exception 'agent cannot review onboarding answers'; end if;
  r := app.client_role(new.client_id);
  if r is null or r not in ('admin', 'account_lead') then
    raise exception 'only an account lead or admin can review onboarding answers';
  end if;
  if new.value is distinct from old.value or new.question_key is distinct from old.question_key
     or new.form_id is distinct from old.form_id or new.client_id is distinct from old.client_id then
    raise exception 'client answers are kept as given; edit the fact you promote instead';
  end if;
  if new.review_status = 'promoted' and new.fact_id is null then
    raise exception 'a promoted answer must point to the fact it created';
  end if;
  if new.review_status is distinct from old.review_status then
    if (select status from public.onboarding_forms where id = new.form_id) <> 'submitted' then
      raise exception 'answers are reviewed after the client submits, and before the questionnaire is marked reviewed';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger onboarding_answers_guard before insert or update on public.onboarding_answers
  for each row execute function app.onboarding_answers_guard();

-- ---------- client-side functions (the only way a private link writes) ----------

-- Resolve a token to an open form, or raise. Used by every client function.
create or replace function app.onboarding_form_for_token(p_token text, p_for_write boolean)
returns public.onboarding_forms
language plpgsql security definer set search_path = public as $$
declare f public.onboarding_forms;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'onboarding link not found'; end if;
  select * into f from public.onboarding_forms where token = p_token;
  if not found then raise exception 'onboarding link not found'; end if;
  if f.status = 'revoked' then raise exception 'this onboarding link is no longer active'; end if;
  if p_for_write then
    if f.status not in ('sent', 'in_progress') then raise exception 'this questionnaire has already been submitted'; end if;
    if f.expires_at <= now() then raise exception 'this onboarding link has expired'; end if;
  end if;
  return f;
end $$;

create or replace function app.onboarding_open(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.onboarding_forms := app.onboarding_form_for_token(p_token, false);
begin
  perform set_config('app.actor', 'client', true);
  perform set_config('app.onboarding_fn', 'on', true);
  if f.first_opened_at is null then
    update public.onboarding_forms set first_opened_at = now() where id = f.id;
  end if;
  perform set_config('app.onboarding_fn', '', true);
end $$;

create or replace function app.onboarding_save(p_token text, p_section text, p_question text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare f public.onboarding_forms := app.onboarding_form_for_token(p_token, true);
begin
  if p_question !~ '^[a-z0-9_]{1,64}$' or p_section !~ '^[a-z0-9_]{1,64}$' then raise exception 'unknown question'; end if;
  if jsonb_typeof(p_value) not in ('string', 'array') then raise exception 'answers must be text or a list'; end if;
  if length(p_value::text) > 20000 then raise exception 'answer is too long'; end if;
  perform set_config('app.actor', 'client', true);
  perform set_config('app.onboarding_fn', 'on', true);
  if (jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '') or p_value = '[]'::jsonb then
    delete from public.onboarding_answers where form_id = f.id and question_key = p_question;
  else
    insert into public.onboarding_answers (form_id, client_id, section_key, question_key, value)
    values (f.id, f.client_id, p_section, p_question, p_value)
    on conflict (form_id, question_key) do update set value = excluded.value, section_key = excluded.section_key, updated_at = now(),
      -- a changed answer on a reopened form goes back to the review queue
      review_status = case when onboarding_answers.value is distinct from excluded.value then 'pending'::app.answer_review
                           else onboarding_answers.review_status end;
  end if;
  update public.onboarding_forms
    set last_saved_at = now(), status = case when status = 'sent' then 'in_progress'::app.onboarding_status else status end
    where id = f.id;
  perform set_config('app.onboarding_fn', '', true);
end $$;

create or replace function app.onboarding_submit(p_token text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.onboarding_forms := app.onboarding_form_for_token(p_token, true); sid uuid; c public.clients;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'please add your name before submitting'; end if;
  if not exists (select 1 from public.onboarding_answers where form_id = f.id) then raise exception 'the questionnaire is empty'; end if;
  perform set_config('app.actor', 'client', true);
  perform set_config('app.onboarding_fn', 'on', true);
  select * into c from public.clients where id = f.client_id;
  -- a reopened form keeps its original source record
  sid := f.source_id;
  if sid is null then
    insert into public.sources (client_id, kind, title, url, captured_at)
    values (f.client_id, 'questionnaire', 'Onboarding questionnaire — ' || btrim(p_name),
            '/clients/' || c.slug || '/onboarding/' || f.id, current_date)
    returning id into sid;
  end if;
  update public.onboarding_forms
    set status = 'submitted', submitted_at = now(), submitted_by_name = btrim(p_name), source_id = sid, last_saved_at = now()
    where id = f.id;
  perform set_config('app.onboarding_fn', '', true);
end $$;
