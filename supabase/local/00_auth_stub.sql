-- Local-only stand-in for Supabase's auth schema so migrations and RLS tests run on plain Postgres.
-- Never apply this to a Supabase project; Supabase provides auth.users and auth.uid() itself.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- an "authenticated" role like Supabase's, used by the RLS test harness
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public, app, auth to authenticated, service_role;
