-- Create a profile row when an auth user is created (Supabase pattern).
-- New users default to 'contributor' with no client assignments: they see nothing until an admin assigns them.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 'contributor')
  on conflict (id) do nothing;
  return new;
end $$;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='raw_user_meta_data') then
    execute 'create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user()';
  end if;
end $$;
