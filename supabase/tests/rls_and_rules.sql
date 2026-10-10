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
insert into public.snapshots (id, client_id, source_system, kind, payload) values ('70000000-0000-4000-8000-000000000001', :'atrakt', 'klaviyo', 'flow_report_30d', '{"rows":1}');
select pg_temp.check('agent finding without a snapshot rejected',
  pg_temp.fails(format('insert into public.findings (client_id, area, title, severity) values (%L, ''flows'', ''no snapshot'', 2)', :'atrakt')));
insert into public.findings (client_id, area, title, severity, status, snapshot_id) values (:'atrakt', 'flows', 'agent finding', 2, 'promoted', '70000000-0000-4000-8000-000000000001');
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

-- 10. evidence model (0006)
select pg_temp.as_user(:'drew');
select pg_temp.check('snapshots are immutable', pg_temp.fails('update public.snapshots set payload = ''{}'' where id = ''70000000-0000-4000-8000-000000000001'''));
insert into public.facts (id, client_id, category, statement, evidence_class) values ('80000000-0000-4000-8000-000000000001', :'atrakt', 'business_objective', 'Q3 gross store revenue was $2,547,302', 'observed');
select pg_temp.check('observed fact without basis cannot be verified',
  pg_temp.fails('update public.facts set status = ''verified'' where id = ''80000000-0000-4000-8000-000000000001'''));
update public.facts set metric_basis = '{"metric_key":"store_revenue_gross","window_start":"2026-07-01","window_end":"2026-09-30","time_basis":"order_date","value":2547302}' where id = '80000000-0000-4000-8000-000000000001';
update public.facts set status = 'verified' where id = '80000000-0000-4000-8000-000000000001';
select pg_temp.check('observed fact with basis verified', (select status = 'verified' from public.facts where id = '80000000-0000-4000-8000-000000000001'));
insert into public.facts (id, client_id, category, statement, evidence_class, metric_basis) values ('80000000-0000-4000-8000-000000000002', :'atrakt', 'business_objective', 'Q3 gross store revenue was $2,540,000 (corrected)', 'observed', '{"metric_key":"store_revenue_gross"}');
select pg_temp.check('superseding without a note rejected',
  pg_temp.fails('update public.facts set superseded_by = ''80000000-0000-4000-8000-000000000002'' where id = ''80000000-0000-4000-8000-000000000001'''));
update public.facts set superseded_by = '80000000-0000-4000-8000-000000000002', correction_note = 'UTC boundary shortfall corrected' where id = '80000000-0000-4000-8000-000000000001';
select pg_temp.check('superseded fact becomes stale', (select status = 'stale' from public.facts where id = '80000000-0000-4000-8000-000000000001'));
select pg_temp.check('promoting a finding needs a readout',
  pg_temp.fails('update public.findings set status = ''promoted'' where title = ''agent finding'' and next_readout is null'));
update public.findings set status = 'promoted', next_readout = 'Zero sends resolved in next nightly review' where title = 'agent finding';
select pg_temp.check('finding promoted with readout', (select status = 'promoted' from public.findings where title = 'agent finding'));

-- 11. decision register
select pg_temp.as_agent();
insert into public.decisions (id, client_id, statement, owner_side, owner_role, status) values ('90000000-0000-4000-8000-000000000001', :'atrakt', 'Approve one welcome entitlement', 'client', 'client commercial owner', 'decided');
select pg_temp.check('agent-opened decision lands open', (select status = 'open' from public.decisions where id = '90000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(:'drew');
select pg_temp.check('deciding without outcome rejected',
  pg_temp.fails('update public.decisions set status = ''decided'' where id = ''90000000-0000-4000-8000-000000000001'''));
update public.decisions set status = 'decided', outcome = '10% off first order', decided_by = 'Artemi (client)' where id = '90000000-0000-4000-8000-000000000001';
select pg_temp.check('decision decided with outcome and date', (select status = 'decided' and decided_on = current_date from public.decisions where id = '90000000-0000-4000-8000-000000000001'));
insert into public.decision_links (client_id, decision_id, record_type, record_id) values (:'atrakt', '90000000-0000-4000-8000-000000000001', 'finding', (select id from public.findings where title = 'agent finding'));
select pg_temp.check('decision linked to a finding', (select count(*) = 1 from public.decision_links where decision_id = '90000000-0000-4000-8000-000000000001'));

-- 12. journeys and steps
insert into public.journeys (id, client_id, stage, name) values ('a0000000-0000-4000-8000-000000000001', :'atrakt', 'welcome', 'Welcome & first purchase');
select pg_temp.check('drew cannot approve a journey', pg_temp.fails('update public.journeys set status = ''approved'' where id = ''a0000000-0000-4000-8000-000000000001'''));
insert into public.journey_steps (id, client_id, journey_id, position, name, bindings) values ('a0000000-0000-4000-8000-000000000011', :'atrakt', 'a0000000-0000-4000-8000-000000000001', 1, 'Deliver the welcome',
  jsonb_build_array(jsonb_build_object('token','ACCEPTED_BENEFIT','fact_id',(select id from public.facts where statement like 'Sleep gummy%')::text)));
select pg_temp.check('step with unapproved binding cannot be approved',
  pg_temp.fails('update public.journey_steps set status = ''approved'' where id = ''a0000000-0000-4000-8000-000000000011'''));
update public.journey_steps set bindings = jsonb_build_array(jsonb_build_object('token','ACCEPTED_BENEFIT','fact_id',(select id from public.facts where statement like 'Client preference%')::text)) where id = 'a0000000-0000-4000-8000-000000000011';
update public.journey_steps set status = 'approved' where id = 'a0000000-0000-4000-8000-000000000011';
select pg_temp.check('step approved once bindings resolve to approved facts', (select status = 'approved' and approved_by = :'drew'::uuid from public.journey_steps where id = 'a0000000-0000-4000-8000-000000000011'));
select pg_temp.check('step live needs publish permission', pg_temp.fails('update public.journey_steps set status = ''live'' where id = ''a0000000-0000-4000-8000-000000000011'''));
select pg_temp.as_user(:'sako');
update public.journeys set status = 'approved' where id = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.check('sako approved the journey', (select status = 'approved' from public.journeys where id = 'a0000000-0000-4000-8000-000000000001'));

-- 13. experiments
select pg_temp.as_user(:'drew');
insert into public.experiments (id, client_id, name, hypothesis) values ('b0000000-0000-4000-8000-000000000001', :'atrakt', 'Day-35 refill touch', 'A day-35 usage email lifts second purchase');
select pg_temp.check('experiment cannot run without control and readout',
  pg_temp.fails('update public.experiments set status = ''running'' where id = ''b0000000-0000-4000-8000-000000000001'''));
update public.experiments set control = 'Holdout 20% no day-35 send', primary_metric = 'repeat_rate_60d', readout_on = '2026-12-15' where id = 'b0000000-0000-4000-8000-000000000001';
select pg_temp.check('experiment cannot run unapproved', pg_temp.fails('update public.experiments set status = ''running'' where id = ''b0000000-0000-4000-8000-000000000001'''));
update public.experiments set status = 'approved' where id = 'b0000000-0000-4000-8000-000000000001';
update public.experiments set status = 'running' where id = 'b0000000-0000-4000-8000-000000000001';
select pg_temp.check('experiment running is predeclared', (select status = 'running' and predeclared_at is not null from public.experiments where id = 'b0000000-0000-4000-8000-000000000001'));
select pg_temp.check('predeclared design is frozen', pg_temp.fails('update public.experiments set control = ''changed'' where id = ''b0000000-0000-4000-8000-000000000001'''));
select pg_temp.check('concluding needs a conclusion', pg_temp.fails('update public.experiments set status = ''concluded'' where id = ''b0000000-0000-4000-8000-000000000001'''));

-- 14. targets
insert into public.targets (id, client_id, period, metric_key, floor_value, record_value, stretch_value) values ('c0000000-0000-4000-8000-000000000001', :'atrakt', '2026-Q4', 'attributed_revenue', 120000, 250000, 400000);
select pg_temp.check('drew cannot approve a target', pg_temp.fails('update public.targets set status = ''approved'' where id = ''c0000000-0000-4000-8000-000000000001'''));
select pg_temp.check('target is modeled evidence', (select evidence_class = 'modeled' from public.targets where id = 'c0000000-0000-4000-8000-000000000001'));

-- 15. design handoff gate
select pg_temp.check('handoff cannot release without ready check',
  pg_temp.fails('update public.briefs set handoff_released_at = now(), handoff = ''{"context":"x","design":"y","ready_check":[]}'' where id = ''50000000-0000-4000-8000-000000000001'''));
select pg_temp.check('handoff cannot release with a failed item',
  pg_temp.fails('update public.briefs set handoff_released_at = now(), handoff = ''{"context":"x","design":"y","ready_check":[{"item":"assets vetted","passed":false}]}'' where id = ''50000000-0000-4000-8000-000000000001'''));
update public.briefs set handoff_released_at = now(), handoff = '{"context":"x","design":"y","ready_check":[{"item":"assets vetted","passed":true}]}' where id = '50000000-0000-4000-8000-000000000001';
select pg_temp.check('handoff released when complete', (select handoff_released_by = :'drew'::uuid from public.briefs where id = '50000000-0000-4000-8000-000000000001'));

-- 16. contact policy at cycle approval
select pg_temp.as_user(:'sako');
insert into public.cycles (id, client_id, starts_on, ends_on) values ('d0000000-0000-4000-8000-000000000001', :'atrakt', '2026-11-02', '2026-11-15');
insert into public.calendar_slots (client_id, cycle_id, send_on, channel, purpose, title)
  select :'atrakt', 'd0000000-0000-4000-8000-000000000001', ('2026-11-02'::date + i), 'email', 'education', 'send ' || i from generate_series(0, 4) i;
select pg_temp.check('cycle over the weekly email cap cannot be approved',
  pg_temp.fails('update public.cycles set status = ''approved'' where id = ''d0000000-0000-4000-8000-000000000001'''));
delete from public.calendar_slots where cycle_id = 'd0000000-0000-4000-8000-000000000001' and title in ('send 3','send 4');
update public.calendar_slots set purpose = 'promotion' where cycle_id = 'd0000000-0000-4000-8000-000000000001' and title in ('send 0','send 1');
select pg_temp.check('two promotions in a row cannot be approved',
  pg_temp.fails('update public.cycles set status = ''approved'' where id = ''d0000000-0000-4000-8000-000000000001'''));
update public.calendar_slots set purpose = 'education' where cycle_id = 'd0000000-0000-4000-8000-000000000001' and title = 'send 1';
update public.cycles set status = 'approved' where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.check('cycle within contact policy approved', (select status = 'approved' from public.cycles where id = 'd0000000-0000-4000-8000-000000000001'));

-- 17. metric dictionary is agency-level
select pg_temp.as_user(:'outsider');
select pg_temp.check('outsider reads the metric dictionary', (select count(*) >= 12 from public.metric_definitions));
update public.metric_definitions set caveat = 'x' where key = 'attributed_revenue';
select pg_temp.check('outsider cannot edit the metric dictionary', (select caveat <> 'x' from public.metric_definitions where key = 'attributed_revenue'));

-- 18. onboarding questionnaire: private client link, team review
select pg_temp.as_user(:'andre');
select pg_temp.check('contributor cannot create an onboarding link',
  pg_temp.fails(format('insert into public.onboarding_forms (client_id) values (%L)', :'atrakt')));
select pg_temp.as_user(:'drew'); select pg_temp.as_agent();
select pg_temp.check('agent cannot create an onboarding link',
  pg_temp.fails(format('insert into public.onboarding_forms (client_id) values (%L)', :'atrakt')));
select pg_temp.as_user(:'drew');
insert into public.onboarding_forms (id, client_id, respondent_name, status) values ('f1000000-0000-4000-8000-000000000001', :'atrakt', 'Client Contact', 'reviewed');
select pg_temp.check('lead creates a link; it starts as sent with a long token',
  (select status = 'sent' and created_by = :'drew'::uuid and length(token) = 48 from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(:'outsider');
select pg_temp.check('outsider sees no onboarding links', (select count(*) from public.onboarding_forms) = 0);
select pg_temp.as_user(:'drew');
select pg_temp.check('team cannot write answers directly',
  pg_temp.fails(format('insert into public.onboarding_answers (form_id, client_id, section_key, question_key, value) values (''f1000000-0000-4000-8000-000000000001'', %L, ''business'', ''brand_summary'', ''"x"'')', :'atrakt')));
select set_config('app.actor', 'client', false);
select pg_temp.check('client actor cannot write outside the onboarding functions',
  pg_temp.fails(format('insert into public.onboarding_answers (form_id, client_id, section_key, question_key, value) values (''f1000000-0000-4000-8000-000000000001'', %L, ''business'', ''brand_summary'', ''"x"'')', :'atrakt')));
select pg_temp.as_user(:'drew');
select pg_temp.check('a wrong token is rejected', pg_temp.fails('select app.onboarding_save(repeat(''0'', 48), ''business'', ''brand_summary'', ''"x"'')'));
select app.onboarding_open((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'));
select app.onboarding_save((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), 'business', 'brand_summary', '"Gut health gummies for busy men"');
select app.onboarding_save((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), 'offers', 'programs', '["loyalty","subscription"]');
select app.onboarding_save((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), 'offers', 'welcome_offer', '"10% off"');
select app.onboarding_save((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), 'offers', 'welcome_offer', '""');
select pg_temp.check('client saves answers through the link; blank answers are removed; form is in progress',
  (select count(*) = 2 from public.onboarding_answers where form_id = 'f1000000-0000-4000-8000-000000000001')
  and (select status = 'in_progress' and first_opened_at is not null from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'));
select pg_temp.check('submit needs a name',
  pg_temp.fails('select app.onboarding_submit((select token from public.onboarding_forms where id = ''f1000000-0000-4000-8000-000000000001''), '' '')'));
select app.onboarding_submit((select token from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), 'Jamie (Atrakt)');
select pg_temp.check('submitting creates a questionnaire source',
  (select f.status = 'submitted' and s.kind = 'questionnaire' from public.onboarding_forms f join public.sources s on s.id = f.source_id where f.id = 'f1000000-0000-4000-8000-000000000001'));
select pg_temp.check('a submitted questionnaire cannot be changed by the link',
  pg_temp.fails('select app.onboarding_save((select token from public.onboarding_forms where id = ''f1000000-0000-4000-8000-000000000001''), ''business'', ''brand_summary'', ''"changed"'')'));
select pg_temp.check('team cannot change what the client answered',
  pg_temp.fails('update public.onboarding_answers set value = ''"edited"'' where question_key = ''brand_summary'''));
select pg_temp.check('cannot mark reviewed while answers are pending',
  pg_temp.fails('update public.onboarding_forms set status = ''reviewed'' where id = ''f1000000-0000-4000-8000-000000000001'''));
select pg_temp.check('promoting needs the fact it created',
  pg_temp.fails('update public.onboarding_answers set review_status = ''promoted'' where question_key = ''brand_summary'''));
select pg_temp.as_user(:'andre');
select pg_temp.check('contributor cannot review answers',
  pg_temp.fails('update public.onboarding_answers set review_status = ''skipped'' where question_key = ''programs'''));
select pg_temp.as_user(:'drew');
insert into public.facts (id, client_id, category, statement, source_id, proposed_by)
  values ('f2000000-0000-4000-8000-000000000001', :'atrakt', 'business_objective', 'Client-stated brand summary: Gut health gummies for busy men',
          (select source_id from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'), :'drew');
update public.onboarding_answers set review_status = 'promoted', fact_id = 'f2000000-0000-4000-8000-000000000001' where question_key = 'brand_summary';
update public.onboarding_answers set review_status = 'skipped' where question_key = 'programs';
update public.onboarding_forms set status = 'reviewed' where id = 'f1000000-0000-4000-8000-000000000001';
select pg_temp.check('promoted answer becomes a proposed fact and the form is marked reviewed',
  (select status = 'proposed' from public.facts where id = 'f2000000-0000-4000-8000-000000000001')
  and (select status = 'reviewed' and reviewed_by = :'drew'::uuid from public.onboarding_forms where id = 'f1000000-0000-4000-8000-000000000001'));
insert into public.onboarding_forms (id, client_id, expires_at) values ('f1000000-0000-4000-8000-000000000002', :'atrakt', now() - interval '1 day');
select pg_temp.check('an expired link cannot save',
  pg_temp.fails('select app.onboarding_save((select token from public.onboarding_forms where id = ''f1000000-0000-4000-8000-000000000002''), ''business'', ''brand_summary'', ''"x"'')'));
update public.onboarding_forms set status = 'revoked' where id = 'f1000000-0000-4000-8000-000000000002';
select pg_temp.check('a revoked link cannot even open',
  pg_temp.fails('select app.onboarding_open((select token from public.onboarding_forms where id = ''f1000000-0000-4000-8000-000000000002''))'));

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
do $$ declare n int; begin
  select count(*) into n from results where not ok;
  if n > 0 then raise exception '% check(s) failed', n; end if;
end $$;
