-- Role/publish changes: admins only when a user is acting; system context (no auth.uid(), e.g. migrations,
-- the deploy script, or the service role) is allowed, the agent never is.
create or replace function app.guard_profile_role() returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.can_publish is distinct from old.can_publish) then
    if app.is_agent() then raise exception 'agent cannot change roles or publish permission'; end if;
    if auth.uid() is not null and not app.is_admin() then
      raise exception 'only an admin can change roles or publish permission';
    end if;
  end if;
  return new;
end $$;
