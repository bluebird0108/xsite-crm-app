-- Deleting an invoice/receipt that was created from a contract task failed:
-- account_tasks.money_doc_id references the row (FK), so Postgres refuses.
-- This function detaches the task, reopens it so Accounts can re-issue, and
-- then deletes the document — atomically, with the role check server-side.
create or replace function public.delete_money_doc(p_doc_id uuid)
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
    raise exception 'Only Owner or Accounts can delete invoices and receipts';
  end if;

  update public.account_tasks
     set money_doc_id = null,
         status = 'pending',
         completed_by = null,
         completed_at = null
   where money_doc_id = p_doc_id;

  delete from public.money_docs where id = p_doc_id;
end;
$$;

grant execute on function public.delete_money_doc(uuid) to authenticated;
