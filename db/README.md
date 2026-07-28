# Database migrations

> Kept under `db/`, **not** `supabase/`, on purpose. The database already has
> its full migration history applied directly in the project; putting a
> partial `supabase/migrations/` folder in the repo makes the Supabase↔GitHub
> integration try to reconcile it against that history and fail its Preview
> check. This folder is documentation/record only.

## `20260728200403_feature_merge_contacts_ejari_cashbank.sql`

Adds the backend objects for the features merged in from the standalone
"Accounts Ledger" build (`bluebird0108/xsite-crm`):

| Object | Purpose |
|---|---|
| `contacts` table + `save_contact` / `upsert_contact_by_name` / `delete_contact` | Contacts directory (Buyers / Sellers / Tenants / Landlords); auto-synced from contract parties |
| `contracts.ejari_status` + `set_contract_ejari` | Ejari registration state (registered / pending) toggled from the Contracts view |
| `staff.birthday` | Powers the dashboard birthday alerts |
| `cash_movements` table + `save_cash_movement` / `delete_cash_movement` | Cash-in-hand / bank-transfer register behind the Cash & Bank view |
| `app_role()` | Helper returning the caller's role (used by the new RLS policies) |

All statements are idempotent (safe to re-run). RLS + `SECURITY DEFINER` role
checks follow the existing convention: `owner` / `accounts` / `admin` are
back-office; `agent` is self-service; `pending` has no access.

### How to apply

The client code degrades gracefully until this runs (the Contacts and
Cash & Bank sections stay empty, Ejari/birthday fields are hidden), so the
app never breaks if the migration lags the deploy. To enable the features,
apply the migration one of these ways:

- **Supabase SQL editor** — paste the file contents and run.
- **Supabase MCP** — `apply_migration` with this file (needs the approval
  that was unavailable in the session that authored it).
- **Supabase CLI** — copy this file into a `supabase/migrations/` folder and run `supabase db push`.

Project ref: `eesbkovplyyxxdzkhvko`.
