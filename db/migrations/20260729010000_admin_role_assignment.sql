-- Let Admins assign roles too (previously owner-only), with the Owner role
-- itself reserved to owners so an admin cannot promote themselves or lock the
-- owner out. Also adds contacts.birthday for contact birthday reminders.
--
-- Idempotent — safe to re-run.

alter table public.contacts add column if not exists birthday date;

-- Admins may read the team list (owner already can) so Team & Access loads.
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles
  for select using (public.app_role() in ('owner', 'admin') or id = auth.uid());

-- Role changes go through this function, which enforces the rules server-side.
-- Direct table updates by admins are intentionally NOT granted, so the checks
-- below cannot be bypassed by calling the REST API directly.
create or replace function public.set_member_role(
  p_id uuid,
  p_role text,
  p_agent_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role  text;
  v_target_role text;
  v_owner_count int;
begin
  select role into v_actor_role from public.profiles where id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to assign roles';
  end if;

  if p_role not in ('pending', 'agent', 'accounts', 'admin', 'owner') then
    raise exception 'Unknown role: %', p_role;
  end if;

  select role into v_target_role from public.profiles where id = p_id;
  if v_target_role is null then
    raise exception 'Account not found';
  end if;

  -- Only an owner may grant the owner role or modify an existing owner.
  if v_actor_role <> 'owner' and (p_role = 'owner' or v_target_role = 'owner') then
    raise exception 'Only an owner can assign or change the Owner role';
  end if;

  -- Agents must be linked to a commission ledger name.
  if p_role = 'agent' and coalesce(trim(p_agent_name), '') = '' then
    raise exception 'Select an agent ledger before assigning the Agent role';
  end if;

  -- Never leave the workspace without an owner.
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.profiles where role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'The last owner cannot be demoted';
    end if;
  end if;

  update public.profiles
     set role = p_role,
         agent_name = nullif(trim(p_agent_name), '')
   where id = p_id;
end;
$$;

grant execute on function public.set_member_role(uuid, text, text) to authenticated;
