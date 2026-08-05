-- Draft/issued money-document workflow with agent ownership and structured
-- cheque details. Existing rows are retained and marked for manual agent review
-- only when they predate the agent field.

alter table money_docs alter column details set default '{}'::jsonb;
update money_docs set details = '{}'::jsonb where details is null;
update money_docs
   set details = details || jsonb_build_object('agent', 'UNASSIGNED - REVIEW')
 where btrim(coalesce(details->>'agent', '')) = '';
alter table money_docs alter column details set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'money_docs_type_status_check') then
    alter table money_docs add constraint money_docs_type_status_check check (
      (doc_type = 'invoice' and status in ('draft','pending','paid')) or
      (doc_type = 'receipt' and status in ('draft','received'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'money_docs_agent_required') then
    alter table money_docs add constraint money_docs_agent_required
      check (btrim(coalesce(details->>'agent','')) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'money_docs_cheque_required') then
    alter table money_docs add constraint money_docs_cheque_required check (
      doc_type <> 'receipt' or status = 'draft' or payment_method <> 'Cheque' or
      (btrim(coalesce(details->>'cheque_number','')) <> '' and
       btrim(coalesce(details->>'cheque_bank','')) <> '' and
       btrim(coalesce(details->>'cheque_date','')) <> '')
    );
  end if;
end $$;
