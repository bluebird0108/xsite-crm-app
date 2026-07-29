-- create_money_doc still refuses a blank deal group ("A valid deal group is
-- required"), blocking standalone invoices/receipts. Patch it in place the
-- same way save_contract was patched: the requirement now applies only when a
-- deal group was actually supplied. Idempotent.
do $$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_money_doc' limit 1;
  if src is null then raise notice 'create_money_doc: not found'; return; end if;

  patched := src;
  patched := replace(patched,
    $q$raise exception 'A valid deal group is required'$q$,
    $q$if p_deal_group is not null then raise exception 'A valid deal group is required'; end if$q$);
  patched := replace(patched,
    $q$raise exception 'Related deal does not exist'$q$,
    $q$if p_deal_group is not null then raise exception 'Related deal does not exist'; end if$q$);

  if patched = src then
    raise notice 'create_money_doc: nothing to patch (already ok)';
  else
    execute patched;
    raise notice 'create_money_doc: patched — deal link now optional';
  end if;
end $$;
