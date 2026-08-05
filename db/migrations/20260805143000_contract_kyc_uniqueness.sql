-- Prevent duplicate workflow rows while retaining completed task history.
-- The cleanup clauses make this safe on an installation that already has
-- duplicates: keep the newest KYC row and one pending task per contract.

with ranked as (
  select id,
         row_number() over (
           partition by contact_id
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as rn
    from kyc_forms
   where contact_id is not null
)
delete from kyc_forms
 where id in (select id from ranked where rn > 1);

create unique index if not exists kyc_contact_unique
  on kyc_forms(contact_id) where contact_id is not null;

with ranked as (
  select id,
         row_number() over (
           partition by contract_id
           order by created_at desc nulls last, id desc
         ) as rn
    from account_tasks
   where status = 'pending'
)
delete from account_tasks
 where id in (select id from ranked where rn > 1);

create unique index if not exists account_tasks_one_pending_per_contract
  on account_tasks(contract_id) where status = 'pending';
