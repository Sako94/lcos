-- Weighted audit score on a 100-point scale over the areas that have a score.
create or replace function app.audit_overall(scores jsonb, template_version int) returns numeric
language sql stable as $$
  with a as (
    select (area->>'key') as key, (area->>'weight')::numeric as weight
    from public.audit_templates t, jsonb_array_elements(t.areas) area
    where t.version = template_version
  ), s as (
    select a.weight, (scores->a.key->>'score')::numeric as score
    from a where scores ? a.key and (scores->a.key->>'score') is not null
  )
  select case when sum(weight) = 0 or sum(weight) is null then null
              else round(sum(score * weight) / sum(weight) * 20, 1) end
  from s
$$;

-- Keep overall in sync whenever scores change.
create or replace function app.audits_overall_sync() returns trigger language plpgsql as $$
begin
  new.overall := app.audit_overall(new.scores, new.template_version);
  return new;
end $$;
create trigger audits_overall before insert or update of scores on public.audits
  for each row execute function app.audits_overall_sync();
