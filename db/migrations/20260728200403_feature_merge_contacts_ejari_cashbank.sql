-- ─────────────────────────────────────────────────────────────────────────
-- Feature-merge migration: bring the monolith "Accounts Ledger" edition's
-- unique features into the Supabase-backed CRM.
--
-- Adds:
--   1. contacts               — CRM contacts directory (+ RPCs + RLS)
--   2. contracts.ejari_status — Ejari registration state (+ toggle RPC)
--   3. staff.birthday         — for birthday alerts on the dashboard
--   4. cash_movements         — cash-in-hand / bank commission movements
--                               (+ RPCs + RLS) powering the Cash & Bank view
--
-- Every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / drop-
-- then-create policies) so the file is safe to re-run. Role checks inside the
-- SECURITY DEFINER RPCs mirror the existing app conventions:
--   owner / accounts / admin  = back-office; agent = self-service; pending = none.
-- ─────────────────────────────────────────────────────────────────────────

-- Caller's application role, read past RLS. SECURITY DEFINER runs as the
-- function owner so the profiles lookup is not blocked by profiles' own RLS.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

grant execute on function public.app_role() to authenticated;


-- ── 1. Contacts ───────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_type  text not null default 'Tenant',
  phone         text,
  email         text,
  notes         text,
  last_contact  date,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contacts_name_idx on public.contacts (lower(name));

alter table public.contacts enable row level security;

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select using (public.app_role() in ('owner', 'accounts', 'admin'));

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all
  using (public.app_role() in ('owner', 'admin'))
  with check (public.app_role() in ('owner', 'admin'));

-- Insert / update a contact. p_id null = insert.
create or replace function public.save_contact(
  p_id           uuid,
  p_name         text,
  p_contact_type text,
  p_phone        text,
  p_email        text,
  p_notes        text,
  p_last_contact date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id   uuid;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Not authorized to manage contacts';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Contact name is required';
  end if;

  if p_id is null then
    insert into public.contacts (name, contact_type, phone, email, notes, last_contact)
    values (trim(p_name),
            coalesce(nullif(trim(p_contact_type), ''), 'Tenant'),
            nullif(trim(p_phone), ''),
            nullif(trim(p_email), ''),
            nullif(trim(p_notes), ''),
            p_last_contact)
    returning id into v_id;
  else
    update public.contacts
       set name         = trim(p_name),
           contact_type = coalesce(nullif(trim(p_contact_type), ''), 'Tenant'),
           phone        = nullif(trim(p_phone), ''),
           email        = nullif(trim(p_email), ''),
           notes        = nullif(trim(p_notes), ''),
           last_contact = p_last_contact,
           updated_at   = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Contact not found';
    end if;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_contact(uuid, text, text, text, text, text, date) to authenticated;

-- Insert a contact only if one with the same name does not already exist
-- (used to auto-sync contract parties without creating duplicates).
create or replace function public.upsert_contact_by_name(
  p_name         text,
  p_contact_type text,
  p_phone        text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id   uuid;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Not authorized to manage contacts';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    return null;
  end if;

  select id into v_id from public.contacts
   where lower(name) = lower(trim(p_name))
   limit 1;

  if v_id is null then
    insert into public.contacts (name, contact_type, phone)
    values (trim(p_name),
            coalesce(nullif(trim(p_contact_type), ''), 'Tenant'),
            nullif(trim(p_phone), ''))
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_contact_by_name(text, text, text) to authenticated;

create or replace function public.delete_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Not authorized to manage contacts';
  end if;
  delete from public.contacts where id = p_id;
end;
$$;

grant execute on function public.delete_contact(uuid) to authenticated;


-- ── 2. Ejari registration status on contracts ─────────────────────────────
alter table public.contracts
  add column if not exists ejari_status text not null default 'pending';

create or replace function public.set_contract_ejari(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Not authorized to update Ejari status';
  end if;
  if p_status not in ('registered', 'pending') then
    raise exception 'Ejari status must be registered or pending';
  end if;
  update public.contracts set ejari_status = p_status, updated_at = now() where id = p_id;
end;
$$;

grant execute on function public.set_contract_ejari(uuid, text) to authenticated;


-- ── 3. Staff birthdays ────────────────────────────────────────────────────
alter table public.staff
  add column if not exists birthday date;


-- ── 4. Cash & Bank movements ──────────────────────────────────────────────
-- Standalone cash-in-hand / bank-transfer commission ledger. Kept separate
-- from money_docs and cash_position so the existing accounting flow is
-- untouched; the Cash & Bank view aggregates these rows live.
create table if not exists public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  movement_date date not null,
  direction     text not null check (direction in ('in', 'out')),
  channel       text not null check (channel in ('cash', 'bank')),
  bank_account  text,
  agent_name    text,
  client        text,
  property      text,
  amount        numeric not null check (amount >= 0),
  reference     text,
  month         text,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists cash_movements_month_idx on public.cash_movements (month);

alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements
  for select using (public.app_role() in ('owner', 'accounts', 'admin'));

drop policy if exists cash_movements_write on public.cash_movements;
create policy cash_movements_write on public.cash_movements
  for all
  using (public.app_role() in ('owner', 'accounts'))
  with check (public.app_role() in ('owner', 'accounts'));

create or replace function public.save_cash_movement(
  p_id           uuid,
  p_movement_date date,
  p_direction    text,
  p_channel      text,
  p_bank_account text,
  p_agent_name   text,
  p_client       text,
  p_property     text,
  p_amount       numeric,
  p_reference    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id   uuid;
  v_month text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'accounts') then
    raise exception 'Not authorized to record cash or bank movements';
  end if;
  if p_movement_date is null then raise exception 'Date is required'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Direction must be in or out'; end if;
  if p_channel not in ('cash', 'bank') then raise exception 'Channel must be cash or bank'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Amount must be zero or greater'; end if;

  v_month := to_char(p_movement_date, 'YYYY-MM');

  if p_id is null then
    insert into public.cash_movements
      (movement_date, direction, channel, bank_account, agent_name, client, property, amount, reference, month)
    values
      (p_movement_date, p_direction, p_channel,
       case when p_channel = 'bank' then nullif(trim(p_bank_account), '') else null end,
       nullif(trim(p_agent_name), ''), nullif(trim(p_client), ''), nullif(trim(p_property), ''),
       p_amount, nullif(trim(p_reference), ''), v_month)
    returning id into v_id;
  else
    update public.cash_movements
       set movement_date = p_movement_date,
           direction     = p_direction,
           channel       = p_channel,
           bank_account  = case when p_channel = 'bank' then nullif(trim(p_bank_account), '') else null end,
           agent_name    = nullif(trim(p_agent_name), ''),
           client        = nullif(trim(p_client), ''),
           property      = nullif(trim(p_property), ''),
           amount        = p_amount,
           reference     = nullif(trim(p_reference), ''),
           month         = v_month
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Cash movement not found'; end if;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_cash_movement(uuid, date, text, text, text, text, text, text, numeric, text) to authenticated;

create or replace function public.delete_cash_movement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'accounts') then
    raise exception 'Not authorized to delete cash or bank movements';
  end if;
  delete from public.cash_movements where id = p_id;
end;
$$;

grant execute on function public.delete_cash_movement(uuid) to authenticated;
