-- Agent → Admin deal intake: agents submit owner/tenant details, terms, and
-- documents; admins turn a submission into a contract. Applied live; kept as
-- the record. Idempotent.

create table if not exists public.deal_submissions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'submitted',
  submitted_by uuid references auth.users(id) default auth.uid(),
  submitted_by_name text, agent_name text,
  owner_name text, owner_phone text, owner_email text, owner_emirates_id text,
  tenant_name text, tenant_phone text, tenant_email text, tenant_emirates_id text,
  building text, unit text, area text,
  moving_date date, cheque_count text, price numeric, dewa_number text, notes text,
  contract_id uuid references public.contracts(id) on delete set null,
  reviewed_by_name text, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deal_submissions_status_idx on public.deal_submissions (status);
alter table public.deal_submissions enable row level security;

drop policy if exists ds_read on public.deal_submissions;
create policy ds_read on public.deal_submissions
  for select using (public.app_role() in ('owner','admin','accounts') or submitted_by = auth.uid());
drop policy if exists ds_insert on public.deal_submissions;
create policy ds_insert on public.deal_submissions
  for insert with check (public.app_role() in ('owner','admin','accounts','agent'));
drop policy if exists ds_update on public.deal_submissions;
create policy ds_update on public.deal_submissions
  for update using (public.app_role() in ('owner','admin'));

alter table public.contract_files add column if not exists submission_id uuid references public.deal_submissions(id) on delete cascade;
create index if not exists contract_files_submission_idx on public.contract_files (submission_id);

drop policy if exists contract_files_read on public.contract_files;
create policy contract_files_read on public.contract_files
  for select using (public.app_role() in ('owner','admin','accounts') or uploaded_by = auth.uid());
drop policy if exists contract_files_write on public.contract_files;
create policy contract_files_write on public.contract_files
  for insert with check (public.app_role() in ('owner','admin','accounts','agent'));

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects
  for select using (bucket_id = 'documents' and (public.app_role() in ('owner','admin','accounts') or owner = auth.uid()));
drop policy if exists documents_insert on storage.objects;
create policy documents_insert on storage.objects
  for insert with check (bucket_id = 'documents' and public.app_role() in ('owner','admin','accounts','agent'));
