-- RLS and integrity tests. Run against a freshly seeded local DB:
--   su postgres -c "psql -v ON_ERROR_STOP=1 -d lcos_dev -f supabase/tests/rls_and_rules.sql"
-- Every check prints PASS/FAIL; the script ends with an error if any check failed.

create temp table results (name text, ok boolean);
grant all on results to authenticated;

create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false), set_config('app.actor', 'user', false)
$$;
create or replace function pg_temp.as_agent() returns void language sql as $$
  select set_config('app.actor', 'agent', false)
$$;
create or replace function pg_temp.fails(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt; return false;
exception when others then return true;
end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language sql as $$
  insert into results values (name, ok)
$$;

\set sako '00000000-0000-4000-8000-000000000001'
\set drew '00000000-0000-4000-8000-000000000002'
\set andre '00000000-0000-4000-8000-000000000003'
\set outsider '00000000-0000-4000-8000-000000000009'
\set atrakt '10000000-0000-4000-8000-000000000001'

set role authenticated;

-- 1. isolation: outsider sees nothing
select pg_temp.as_user(:'outsider');
select pg_temp.check('outsider sees no clients', (select count(*) from public.clients) = 0);
select pg_temp.check('outsider sees no facts', (select count(*) from public.facts) = 0);
select pg_temp.check('outsider sees no flows', (select count(*) from public.flows) = 0);
select pg_temp.check('outsider cannot insert a fact',
  pg_temp.fails(format('insert into public.facts (client_id, category, statement) values (%L, ''business_objective'', ''x'')', :'atrakt')));
select pg_temp.check('outsider still reads the agency playbook', (select count(*) from public.sops) = 22);

-- 2. assigned lead sees the client
select pg_temp.as_user(:'drew');
select pg_temp.check('drew sees atrakt', (select count(*) from public.clients) = 1);
select pg_temp.check('drew sees 64 facts', (select count(*) from public.facts) = 64);

-- 3. role rules on facts
select pg_temp.check('drew cannot approve an offers fact',
  pg_temp.fails('update public.facts set status = ''approved'' where category = ''offers_discounts'' and statement like ''Client preference%'''));
update public.facts set status = 'approved' where category = 'products_launches' and statement like 'Debo (debloat%';
select pg_temp.check('drew approved a product fact', (select status = 'approved' and approved_by = :'drew'::uuid from public.facts where statement like 'Debo (debloat%'));
update public.facts set statement = statement || ' (edited)' where statement like 'Debo (debloat%';
select pg_temp.check('editing an approved fact reopens it as proposed, version 2',
  (select status = 'proposed' and version = 2 from public.facts where statement like 'Debo (debloat%'));
select pg_temp.check('fact history recorded', (select count(*) from public.fact_versions v join public.facts f on f.id = v.fact_id where f.statement like 'Debo (debloat%') >= 3);

select pg_temp.as_user(:'sako');
update public.facts set status = 'approved' where category = 'offers_discounts' and statement like 'Client preference%';
select pg_temp.check('sako approved the offers fact', (select status = 'approved' from public.facts where statement like 'Client preference%'));

-- 4. contributor limits
select pg_temp.as_user(:'andre');
select pg_temp.check('andre sees atrakt facts (assigned)', (select count(*) from public.facts) = 64);
select pg_temp.check('andre cannot verify a fact',
  pg_temp.fails('update public.facts set status = ''verified'' where status = ''proposed'' and category = ''customer_audience'''));
select pg_temp.check('andre cannot change rebuild status',
  pg_temp.fails('update public.flows set rebuild_status = ''documented'' where external_id = ''VjzG3F'''));
update public.flows set design_url = 'https://figma.com/file/x' where external_id = 'VjzG3F';
select pg_temp.check('andre can attach a design to a flow', (select design_url is not null from public.flows where external_id = 'VjzG3F'));
select pg_temp.check('andre cannot record an approval',
  pg_temp.fails(format('insert into public.approvals (client_id, record_type, record_id, decision) values (%L, ''brief'', gen_random_uuid(), ''approved'')', :'atrakt')));

-- 5. agent limits (service role in production; simulated here with app.actor = agent as drew's session)
select pg_temp.as_user(:'drew'); select pg_temp.as_agent();
insert into public.facts (client_id, category, statement, status) values (:'atrakt', 'customer_audience', 'agent proposed fact', 'approved');
select pg_temp.check('agent inserts land as proposed even if it asks for approved',
  (select status = 'proposed' and proposed_by_kind = 'agent' from public.facts where statement = 'agent proposed fact'));
select pg_temp.check('agent cannot change fact status',
  pg_temp.fails('update public.facts set status = ''verified'' where statement = ''agent proposed fact'''));
insert into public.findings (client_id, area, title, severity, status) values (:'atrakt', 'flows', 'agent finding', 2, 'promoted');
select pg_temp.check('agent findings land as new', (select status = 'new' and created_by_kind = 'agent' from public.findings where title = 'agent finding'));
select pg_temp.check('agent cannot approve a cycle',
  pg_temp.fails('update public.cycles set status = ''approved'''));

-- 6. briefs, copy versions, approvals on a version
select pg_temp.as_user(:'drew');
insert into public.briefs (id, client_id, title, goal, owner_id) values ('50000000-0000-4000-8000-000000000001', :'atrakt', 'Sleep gummy launch email', 'Announce launch', :'drew');
select pg_temp.as_agent();
select pg_temp.check('agent copy cannot cite a proposed fact',
  pg_temp.fails(format('insert into public.copy_versions (brief_id, body, fact_ids) values (''50000000-0000-4000-8000-000000000001'', ''x'', array[(select id from public.facts where statement like ''Sleep gummy%%'')]::uuid[])')));
insert into public.copy_versions (brief_id, body, fact_ids) values ('50000000-0000-4000-8000-000000000001', 'v1 body', array[(select id from public.facts where statement like 'Client preference%')]::uuid[]);
select pg_temp.check('agent copy citing an approved fact is accepted as v1', (select current_copy_version = 1 from public.briefs where id = '50000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(:'drew');
select pg_temp.check('copy versions are immutable', pg_temp.fails('update public.copy_versions set body = ''hacked'''));
select pg_temp.check('drew cannot internally approve a brief',
  pg_temp.fails('update public.briefs set status = ''internal_approved'' where id = ''50000000-0000-4000-8000-000000000001'''));
select pg_temp.as_user(:'sako');
select pg_temp.check('approval blocked while QA has unchecked items',
  pg_temp.fails('update public.briefs set status = ''internal_approved'', qa_checklist = ''[{"item":"links","passed":false}]'' where id = ''50000000-0000-4000-8000-000000000001'''));
update public.briefs set status = 'internal_approved', qa_checklist = '[{"item":"links","passed":true}]' where id = '50000000-0000-4000-8000-000000000001';
select pg_temp.check('sako approved brief v1', (select internal_approved_version = 1 from public.briefs where id = '50000000-0000-4000-8000-000000000001'));
select pg_temp.check('client approval needs evidence',
  pg_temp.fails('update public.briefs set status = ''client_approved'' where id = ''50000000-0000-4000-8000-000000000001'''));
update public.briefs set key_message = 'changed after approval' where id = '50000000-0000-4000-8000-000000000001';
select pg_temp.check('content edit after approval resets to draft',
  (select status = 'draft' and internal_approved_version is null from public.briefs where id = '50000000-0000-4000-8000-000000000001'));

-- 7. cycle and flow change approvals
select pg_temp.as_user(:'drew');
select pg_temp.check('drew cannot approve the cycle plan', pg_temp.fails('update public.cycles set status = ''approved'''));
select pg_temp.as_user(:'sako');
update public.cycles set status = 'approved';
select pg_temp.check('sako approved the cycle', (select bool_and(status = 'approved') from public.cycles));
insert into public.proposed_changes (id, client_id, flow_id, title, after_logic) values ('60000000-0000-4000-8000-000000000001', :'atrakt', (select id from public.flows where external_id = 'VjzG3F'), 'Fix old-domain links', 'All links to atrakt.com');
update public.proposed_changes set status = 'approved' where id = '60000000-0000-4000-8000-000000000001';
select pg_temp.check('admin without publish permission cannot apply a live change',
  pg_temp.fails('update public.proposed_changes set status = ''applied'' where id = ''60000000-0000-4000-8000-000000000001'''));

-- 8. agent run idempotency
insert into public.agent_runs (client_id, job_type, idempotency_key) values (:'atrakt', 'health_review', 'health_review:atrakt:2026-10-07');
select pg_temp.check('duplicate run blocked by idempotency key',
  pg_temp.fails(format('insert into public.agent_runs (client_id, job_type, idempotency_key) values (%L, ''health_review'', ''health_review:atrakt:2026-10-07'')', :'atrakt')));

-- 9. commitments need an owner; dismissals need a reason
select pg_temp.check('commitment without owner rejected',
  pg_temp.fails(format('insert into public.commitments (client_id, statement, due_on) values (%L, ''x'', ''2026-10-20'')', :'atrakt')));
select pg_temp.check('dismiss without reason rejected',
  pg_temp.fails('update public.findings set status = ''dismissed'' where title = ''agent finding'''));

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
do $$ declare n int; begin
  select count(*) into n from results where not ok;
  if n > 0 then raise exception '% check(s) failed', n; end if;
end $$;
