-- Contract document storage: signed contracts/Ejari, cheque copies, and
-- owner/tenant identity documents. Private bucket + index table.
-- Applied to the live project; kept here as the record. Idempotent.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

create table if not exists public.contract_files (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  doc_type text not null default 'other',
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists contract_files_contract_idx on public.contract_files (contract_id);
alter table public.contract_files enable row level security;

drop policy if exists contract_files_read on public.contract_files;
create policy contract_files_read on public.contract_files
  for select using (public.app_role() in ('owner','admin','accounts'));
drop policy if exists contract_files_write on public.contract_files;
create policy contract_files_write on public.contract_files
  for insert with check (public.app_role() in ('owner','admin','accounts'));
drop policy if exists contract_files_delete on public.contract_files;
create policy contract_files_delete on public.contract_files
  for delete using (public.app_role() in ('owner','admin'));

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects
  for select using (bucket_id = 'documents' and public.app_role() in ('owner','admin','accounts'));
drop policy if exists documents_insert on storage.objects;
create policy documents_insert on storage.objects
  for insert with check (bucket_id = 'documents' and public.app_role() in ('owner','admin','accounts'));
drop policy if exists documents_delete on storage.objects;
create policy documents_delete on storage.objects
  for delete using (bucket_id = 'documents' and public.app_role() in ('owner','admin'));
