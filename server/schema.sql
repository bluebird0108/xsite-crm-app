-- XSITE CRM — self-hosted schema (rebuilt from the app's COLUMNS contract).
-- Date-like fields are stored as TEXT to faithfully mirror how the client
-- reads them (it does string ops like date.slice(0,7) and never date math
-- server-side). Money is numeric; details/addendum are jsonb. Idempotent.

create extension if not exists pgcrypto;

-- ── auth ────────────────────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists profiles (
  id         uuid primary key references users(id) on delete cascade,
  full_name  text default '',
  email      text,
  role       text not null default 'pending',
  agent_name text,
  created_at timestamptz not null default now()
);

-- ── reference / imported ────────────────────────────────────────────────
create table if not exists agents (
  id                            uuid primary key default gen_random_uuid(),
  name                          text,
  role                          text,
  month                         text,
  agent_business_including_vat  numeric
);

-- FK parent for deals + commission_entries
create table if not exists deal_groups (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists deals (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid references deal_groups(id) on delete cascade,
  sno                integer,
  deal_date          text,
  deal_date_raw      text,
  agent              text,
  agent2             text,
  third_party        text,
  deal_type          text,
  unit               text,
  building           text,
  area               text,
  price              numeric,
  total_commission   numeric,
  commission_received numeric,
  vat                numeric,
  commission_ex_vat  numeric,
  agent_business     numeric,
  company_share      numeric,
  agent_share        numeric,
  payment_method     text,
  tc_start           text,
  tc_start_raw       text,
  contract_duration  text,
  tc_end             text,
  tc_end_raw         text,
  security_deposit   numeric,
  cheque_count       text,
  landlord           text,
  tenant             text,
  bank               text,
  month              text
);
create index if not exists deals_group_idx on deals(group_id);
create index if not exists deals_month_idx on deals(month);

create table if not exists commission_entries (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid references deal_groups(id) on delete cascade,
  agent_name        text,
  entry_date        text,
  entry_date_raw    text,
  third_party       text,
  agent2            text,
  deal_type         text,
  unit              text,
  building          text,
  area              text,
  annual_value      numeric,
  total_commission  numeric,
  received          numeric,
  vat               numeric,
  commission_ex_vat numeric,
  agent_business    numeric,
  xsite_share       numeric,
  agent_share       numeric,
  month             text
);
create index if not exists commission_group_idx on commission_entries(group_id);

create table if not exists cash_position (
  id         uuid primary key default gen_random_uuid(),
  as_at      text,
  label      text,
  amount     numeric,
  sort_order integer,
  month      text
);

create table if not exists money_docs (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text,
  doc_no         text,
  deal_group     uuid references deal_groups(id) on delete set null,
  doc_date       text,
  client         text,
  description    text,
  amount         numeric,
  payment_method text,
  status         text,
  month          text,
  details        jsonb
);

create table if not exists cash_movements (
  id            uuid primary key default gen_random_uuid(),
  movement_date text,
  direction     text,
  channel       text,
  bank_account  text,
  agent_name    text,
  client        text,
  property      text,
  amount        numeric,
  reference     text,
  month         text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists cashmv_month_idx on cash_movements(month);

create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  job         text,
  nationality text,
  branch      text,
  card_number text,
  card_expiry text,
  birthday    text,
  team        text
);

create table if not exists agent_requests (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references users(id) on delete set null,
  submitter_name text,
  request_type  text,
  subject       text,
  deal_group    uuid references deal_groups(id) on delete set null,
  details       jsonb,
  status        text default 'pending',
  response      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists contracts (
  id              uuid primary key default gen_random_uuid(),
  contract_no     text,
  deal_group      uuid references deal_groups(id) on delete set null,
  status          text default 'draft',
  contract_date   text,
  start_date      text,
  end_date        text,
  landlord_name   text,
  tenant_name     text,
  owner_phone     text,
  tenant_phone    text,
  annual_rent     numeric,
  security_deposit numeric,
  payment_mode    text,
  additional_terms text,
  details         jsonb,
  addendum        jsonb,
  ejari_status    text default 'pending',
  created_by      uuid references users(id) on delete set null,
  finalized_by    uuid references users(id) on delete set null,
  finalized_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists deal_submissions (
  id                 uuid primary key default gen_random_uuid(),
  status             text default 'submitted',
  submitted_by       uuid references users(id) on delete set null,
  submitted_by_name  text,
  agent_name         text,
  owner_name         text,
  owner_phone        text,
  owner_email        text,
  owner_emirates_id  text,
  tenant_name        text,
  tenant_phone       text,
  tenant_email       text,
  tenant_emirates_id text,
  building           text,
  unit               text,
  area               text,
  moving_date        text,
  cheque_count       text,
  price              numeric,
  dewa_number        text,
  notes              text,
  contract_id        uuid references contracts(id) on delete set null,
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists account_tasks (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid references contracts(id) on delete cascade,
  task_type    text,
  status       text default 'pending',
  money_doc_id uuid references money_docs(id) on delete set null,
  completed_by uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text,
  contact_type text,
  phone        text,
  email        text,
  notes        text,
  last_contact text,
  birthday     text,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists contract_files (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid references contracts(id) on delete cascade,
  submission_id    uuid references deal_submissions(id) on delete cascade,
  doc_type         text,
  file_name        text,
  storage_path     text,
  size_bytes       bigint,
  uploaded_by      uuid references users(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists cfiles_contract_idx on contract_files(contract_id);
create index if not exists cfiles_submission_idx on contract_files(submission_id);

-- ── document number sequences (server-assigned) ─────────────────────────
create sequence if not exists contract_no_seq;
create sequence if not exists invoice_no_seq;
create sequence if not exists receipt_no_seq;
