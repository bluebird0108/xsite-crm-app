-- Owner and Admin can add, edit, and remove staff from the app. Idempotent.
alter table public.staff enable row level security;

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff
  for select using (public.app_role() in ('owner','admin','accounts'));

drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff
  for all
  using (public.app_role() in ('owner','admin'))
  with check (public.app_role() in ('owner','admin'));
