-- The deals register was cleared, so requiring every contract and money doc to
-- link to a register deal blocked the whole submission → contract → receipt
-- chain. Make the link optional at the database level.
alter table public.contracts alter column deal_group drop not null;
alter table public.money_docs alter column deal_group drop not null;

-- If save_contract / create_money_doc raise their own "deal required" errors
-- on null, run this to inspect them, then send the output to be patched:
--   select pg_get_functiondef(p.oid) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.proname in ('save_contract','create_money_doc');
