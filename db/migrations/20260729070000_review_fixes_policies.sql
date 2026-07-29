-- Fixes from the full app review. Idempotent.

-- 1) Agents could not edit their own submissions: ds_update allowed only
--    owner/admin, so an agent's "Save changes" silently updated 0 rows.
--    Let the submitter edit their own submission while it is still new.
drop policy if exists ds_update on public.deal_submissions;
create policy ds_update on public.deal_submissions
  for update using (
    public.app_role() in ('owner','admin')
    or (submitted_by = auth.uid() and status = 'submitted')
  );

-- 2) Converting a submission re-points its files at the new contract, but
--    contract_files had no UPDATE policy, so that update affected 0 rows.
drop policy if exists contract_files_update on public.contract_files;
create policy contract_files_update on public.contract_files
  for update using (public.app_role() in ('owner','admin'));
