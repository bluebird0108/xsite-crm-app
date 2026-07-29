-- Accounts can post commission straight to an agent ledger (corrections,
-- referrals, payouts that arrive outside a register deal). Idempotent.
create or replace function public.save_commission_entry(
  p_id uuid, p_agent_name text, p_entry_date date, p_third_party text, p_agent2 text,
  p_deal_type text, p_unit text, p_building text, p_area text, p_annual_value numeric,
  p_total_commission numeric, p_received numeric, p_vat numeric, p_commission_ex_vat numeric,
  p_agent_business numeric, p_xsite_share numeric, p_agent_share numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid; v_month text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner','accounts') then
    raise exception 'Only Owner or Accounts can record commission entries';
  end if;
  if coalesce(trim(p_agent_name),'') = '' then raise exception 'Agent is required'; end if;
  if p_entry_date is null then raise exception 'Date is required'; end if;
  v_month := to_char(p_entry_date, 'YYYY-MM');
  if p_id is null then
    -- commission_entries.group_id references deal_groups: mint the parent row.
    declare v_group uuid := gen_random_uuid();
    begin
      insert into public.deal_groups (id) values (v_group);
      insert into public.commission_entries
        (group_id, agent_name, entry_date, third_party, agent2, deal_type, unit, building, area,
         annual_value, total_commission, received, vat, commission_ex_vat, agent_business,
         xsite_share, agent_share, month)
      values
        (v_group, upper(trim(p_agent_name)), p_entry_date,
       coalesce(nullif(trim(p_third_party),''),'N/A'), coalesce(nullif(trim(p_agent2),''),'N/A'),
       p_deal_type, nullif(trim(p_unit),''), nullif(trim(p_building),''), nullif(trim(p_area),''),
         p_annual_value, p_total_commission, p_received, p_vat, p_commission_ex_vat,
         p_agent_business, p_xsite_share, p_agent_share, v_month)
      returning id into v_id;
    end;
  else
    update public.commission_entries set
      agent_name = upper(trim(p_agent_name)), entry_date = p_entry_date,
      third_party = coalesce(nullif(trim(p_third_party),''),'N/A'),
      agent2 = coalesce(nullif(trim(p_agent2),''),'N/A'), deal_type = p_deal_type,
      unit = nullif(trim(p_unit),''), building = nullif(trim(p_building),''), area = nullif(trim(p_area),''),
      annual_value = p_annual_value, total_commission = p_total_commission, received = p_received,
      vat = p_vat, commission_ex_vat = p_commission_ex_vat, agent_business = p_agent_business,
      xsite_share = p_xsite_share, agent_share = p_agent_share, month = v_month
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Commission entry not found'; end if;
  end if;
  return v_id;
end; $$;
grant execute on function public.save_commission_entry(uuid,text,date,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.delete_commission_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner','accounts') then
    raise exception 'Only Owner or Accounts can delete commission entries';
  end if;
  delete from public.commission_entries where id = p_id;
end; $$;
grant execute on function public.delete_commission_entry(uuid) to authenticated;

-- The client-side fallback (used until this file is applied) needs to mint the
-- parent row directly, so allow owner/accounts to insert into deal_groups.
alter table public.deal_groups enable row level security;
drop policy if exists deal_groups_insert on public.deal_groups;
create policy deal_groups_insert on public.deal_groups
  for insert with check (public.app_role() in ('owner','accounts','admin'));
drop policy if exists deal_groups_read on public.deal_groups;
create policy deal_groups_read on public.deal_groups
  for select using (public.app_role() in ('owner','accounts','admin','agent'));
