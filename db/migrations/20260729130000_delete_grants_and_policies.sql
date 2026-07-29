-- Delete for contracts and submissions (drafts / agent intake), plus the
-- table-level GRANTs the RLS delete policies need to actually apply.
-- RLS still restricts who can delete; the GRANT just lets the policy run.
grant delete on public.contracts to authenticated;
grant delete on public.deal_submissions to authenticated;
grant delete on public.staff to authenticated;

drop policy if exists contracts_delete on public.contracts;
create policy contracts_delete on public.contracts
  for delete using (public.app_role() in ('owner','admin'));

drop policy if exists ds_delete on public.deal_submissions;
create policy ds_delete on public.deal_submissions
  for delete using (public.app_role() in ('owner','admin'));
