-- Local-only: auth users with fixed ids so seed data can reference them.
-- On Supabase, create these users through the dashboard or scripts/create-users.ts and let
-- the handle_new_user trigger (0003_auth_hooks.sql) create profiles; the seed resolves ids by email.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'sako@wavystudios.com'),
  ('00000000-0000-4000-8000-000000000002', 'drew@wavystudios.com'),
  ('00000000-0000-4000-8000-000000000003', 'andre@wavystudios.com'),
  ('00000000-0000-4000-8000-000000000004', 'jeanclaude@wavystudios.com'),
  ('00000000-0000-4000-8000-000000000009', 'outsider@example.com')
on conflict do nothing;
