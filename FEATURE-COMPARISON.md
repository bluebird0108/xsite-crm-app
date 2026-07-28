# Xsite CRM — feature comparison & consolidation

Two implementations of the Xsite CRM existed:

- **`bluebird0108/xsite-crm-app`** (this repo) — modular vanilla-JS SPA backed
  by **Supabase** (real Postgres, Auth, row-level security, RPCs). Multi-user,
  persistent, CSV export, Ejari/DLD image-overlay contract printing.
- **`bluebird0108/xsite-crm`** — a single self-contained bundle ("Accounts
  Ledger" edition) using a custom template engine. **In-memory only** (no
  persistence, cosmetic login), but with a few sections this app lacked.

**Decision:** consolidate into this repo (the stronger, persistent base) and
port over the features that were unique to the standalone build.

## What each already had

| Capability | xsite-crm-app | xsite-crm (monolith) |
|---|---|---|
| Persistence / Auth | ✅ Supabase + real auth | ❌ in-memory, cosmetic login |
| Transactions register | ✅ | ✅ |
| Agent commission ledgers | ✅ | ✅ |
| Invoices & receipts | ✅ | ✅ |
| Cash position snapshots | ✅ | ✅ |
| Contract expiry / renewal alerts | ✅ | ✅ |
| Staff directory + work-permit alerts | ✅ | ✅ (+ add/delete) |
| Requests workflow | ✅ | ✅ |
| Team & access management | ✅ | ❌ |
| CSV export | ✅ | ❌ |
| Ejari/DLD overlay printing | ✅ | ✅ (text only) |
| **Contacts directory** | ❌ | ✅ |
| **Ejari registration status** | ❌ | ✅ |
| **Cash-in-hand / bank movements** | ❌ | ✅ |
| **Staff birthdays** | ❌ | ✅ |
| **Daily-control dashboard + activity feed** | ❌ | ✅ |
| **Global dashboard search** | ❌ | ✅ |

## Features ported into this app

1. **Contacts** — new nav section (owner/admin): Buyer/Seller/Tenant/Landlord
   directory with add/edit/delete, type filter, and search. Contract parties
   (landlord + tenant) are auto-added as contacts when a contract is saved.
2. **Ejari registration status** — a Registered ⇄ Pending toggle on finalized
   contracts (owner/admin/accounts), plus an "Ejari pending" dashboard alert.
3. **Cash & Bank** — new nav section (owner/accounts): cash-in-hand and
   bank-transfer movements (Mashreq / Emirates NBD Islamic / Other), with live
   cash-in-hand and per-bank totals.
4. **Staff birthdays** — `staff.birthday` field, surfaced as a dashboard
   "Staff birthdays" (next 30 days) alert and a Staff-directory column.
5. **Daily-control dashboard** — today's contracts/receipts/invoices/new-contacts
   KPIs, Sales/Accounts/CRM progress bars, and a live activity feed.
6. **Global dashboard search** — search across contacts, contracts, and deals
   with click-through deep links.

The backend objects these need are in
`supabase/migrations/20260728200403_feature_merge_contacts_ejari_cashbank.sql`
(see `supabase/README.md`). Until it is applied, the new sections simply stay
empty — the rest of the app is unaffected.
