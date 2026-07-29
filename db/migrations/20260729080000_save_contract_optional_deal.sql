-- Contracts (and money docs) can now be created without a register deal, but
-- the original save_contract/create_money_doc functions still raise
-- 'Related deal does not exist' when p_deal_group is null. Rather than
-- rewriting functions whose full source lives only in the database, patch them
-- in place: fetch each definition and make the deal-existence error fire only
-- when a deal group was actually supplied. Idempotent — re-running finds the
-- guard already present and changes nothing.
do $$
declare
  fn  text;
  src text;
  patched text;
begin
  foreach fn in array array['save_contract', 'create_money_doc'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
     limit 1;
    if src is null then
      raise notice '%: not found, skipped', fn;
      continue;
    end if;

    patched := replace(src,
      $q$raise exception 'Related deal does not exist'$q$,
      $q$if p_deal_group is not null then raise exception 'Related deal does not exist'; end if$q$);

    if patched = src then
      raise notice '%: no deal-existence check to patch (already ok)', fn;
    elsif position('if p_deal_group is not null then raise exception' in src) > 0 then
      raise notice '%: already patched', fn;
    else
      execute patched;
      raise notice '%: patched — deal link is now optional', fn;
    end if;
  end loop;
end $$;
