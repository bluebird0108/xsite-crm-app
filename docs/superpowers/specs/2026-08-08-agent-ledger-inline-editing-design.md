# Design: inline commission-entry editing in the Agent Ledger

Date: 2026-08-08
Status: approved, pending implementation
Repo: `bluebird0108/xsite-crm-app`

## Problem

Accounts staff reviewing an agent's ledger cannot act on what they see. Spotting a wrong
figure or a missing deal means leaving the screen, opening **Accounts → Commission Entry**,
switching to the right month, and searching for the row.

The capability itself is not missing. `accounts` can already create, edit and delete
commission entries:

| Layer | State |
|---|---|
| `rpc.js` `save_commission_entry` / `delete_commission_entry` | exist, gated on `MONEY = ["owner","accounts"]` |
| `app.js` `viewCommissionEntry()` (line 3779) | `canEdit = roleIn("owner","accounts")`, per-row Edit/Delete, `+ New commission entry` |
| `app.js` `viewAgentLedgers()` (line 2348) | **no role check, no edit affordance** — `Export CSV`, `Print statement`, search only |

So this is a wiring problem, not a permissions problem. No role changes are required.

Two latent defects in the existing save path must be fixed as part of it, because inline
editing would multiply both.

### Defect 1 — `month` is derived from the entry date

```js
month: ym(p.p_entry_date)             // rpc.js
month: args.p_entry_date.slice(0, 7)  // app.js fallback
```

The ledger convention is that `month` is the **commission sheet's reporting period**, not
the deal date. A deal closed 23 June that settles on the July sheet reports under
`2026-07`. On 2026-08-08, 49 rows were re-filed to restore this after an import wrongly
used `deal_date[:7]`; every month now equals its source sheet's row count exactly.

An entry added from the Nov ledger but dated 5 Dec would today be filed under `2025-12` —
recreating a phantom month that no uploaded sheet produced.

### Defect 2 — creating an entry produces no `deals` row

```js
const g = (await c.query("insert into deal_groups default values returning id")).rows[0].id;
await ins(c, "commission_entries", row, { group_id: g });   // deals untouched
```

`deals`, `commission_entries` and `deal_groups` are currently 819/819/819, 1:1:1 by
`group_id`. An entry created this way makes it 819/820/820, and the commission never
appears on the **Master Sheet** tab, which reads `deals`.

`delete_commission_entry` has the mirror problem — it removes only the entry row, which
will strand a `deals` row once we start creating them.

## Decisions

1. **Inline Edit / Delete / Add in the ledger**, reusing the existing modal. Rejected:
   a link through to the Accounts screen (still two screens); edit-only without add/delete
   (accounts would still leave the screen for half the work).
2. **`month` = the ledger month being worked in**, not the entry date.
3. **Create a matching `deals` row**, keeping the three tables 1:1:1.
4. **Fix the shared RPC rather than adding a new one.** Rejected: routing through
   `save_deal_group` (array/replace semantics, heavier than one row, modal would need
   rewiring); a new `save_ledger_entry` (duplicates logic that would then drift).

## Changes

### `server/routes/rpc.js`

Permission checks are unchanged — `MONEY` already contains `accounts`.

**`save_commission_entry`**
- Accept `p_month`. Use it for the `month` column; fall back to `ym(p_entry_date)` only
  when absent, so the existing Commission Entry screen keeps working unchanged.
- **Insert:** write `deal_groups`, `commission_entries` **and `deals`** under one
  `group_id`, inside the existing `tx()`.
- **Update:** update the `deals` row carrying the same `group_id` alongside
  `commission_entries`.

Field mapping, `commission_entries` → `deals`:

| commission_entries | deals |
|---|---|
| `agent_name` | `agent` |
| `entry_date` | `deal_date` |
| `annual_value` | `price` |
| `received` | `commission_received` |
| `xsite_share` | `company_share` |
| all others | identical names |

Columns only `deals` has are left NULL, because the ledger form does not collect them.
This matches existing agent-workbook rows for the tenancy-contract fields — verified
across the 244 Oct/Nov 2025 rows, where `tc_start`, `landlord` and `payment_method` are
NULL on all 244.

One exception worth noting: `sno` **is** populated on imported rows (237 of those 244,
from the workbook's `S.NO` column) but will be NULL on ledger-created entries. `sno` is a
per-sheet line number with no meaning for an entry typed directly into the ledger, so NULL
is correct — but any report that assumes `sno` is always present would need to tolerate
it. No current view does.

**`delete_commission_entry`**
- Delete the `deals` row and the `deal_groups` parent for that `group_id`, not just the
  entry — matching `delete_deal_group`.

### `app.js` — `viewAgentLedgers()` (~line 2348)

- Add `const canEdit = roleIn("owner", "accounts")` — the same gate used by
  `viewCommissionEntry()`, the money-docs view and the deals view.
- Per row when `canEdit`: **Edit** and **Delete**, reusing `ceFormFromRow(r)` and
  `deleteCommissionEntry(id)`.
- Header when `canEdit`: **+ Add entry**, via `emptyCeForm()` pre-filled with the selected
  agent and `state.ledgerMonth`.
- Pass `p_month: state.ledgerMonth` in the `save_commission_entry` args.

The modal is unchanged and opens over the ledger. Agents viewing "My Ledger" see no edit
controls, exactly as now.

### `app.js` — remove the legacy fallback

`saveCommissionEntry()` falls back to direct table writes when the RPC is missing — a
leftover from the Supabase era. It sets `month` from the date and never writes `deals`,
i.e. it reproduces both defects above. The self-hosted API always provides the RPC, so
this path is dead code that can only produce inconsistent rows. Delete it, and the
matching fallback in `deleteCommissionEntry()`.

## Error handling

- Existing validation is retained: agent name required, entry date required, save button
  disabled while in flight, server error surfaced in `#cemsg`.
- All writes stay inside the existing `tx()`, so a failure part-way cannot leave `deals`
  and `commission_entries` disagreeing.
- Authorisation is enforced server-side in the RPC. Hiding the buttons is presentation
  only; a forged call from an `agent` session is still rejected.

## Testing

1. As `accounts`, add an entry from the **Nov 2025** ledger dated **5 Dec 2025** —
   `deals`, `commission_entries`, `deal_groups` each **+1**; `month = 2025-11`; no
   `2025-12` month appears.
2. Edit an entry from the ledger — both tables change; `deals.agent` still equals
   `commission_entries.agent_name`; row counts unchanged.
3. Delete an entry — all three rows removed; counts stay equal.
4. As an `agent`, open "My Ledger" — no Edit/Delete/Add rendered; a direct
   `save_commission_entry` call is rejected with "Only Owner or Accounts can record
   commission entries".
5. Add an entry via the existing **Accounts → Commission Entry** screen — still works, and
   now also produces a `deals` row.
6. Run `/root/xsite-import-tools/audit_calcs.sql` — 0 divergent pairs, VAT and split rules
   unchanged.

Rollback: revert the commit; no schema migration is involved.

## Known side effect

Fixing the shared RPC also changes the existing **Accounts → Commission Entry** screen:
entries created there will now produce `deals` rows and appear on the Master Sheet. This
is a correction — that screen currently creates commission rows invisible to the Master
Sheet — but it is a behaviour change to a screen outside the original request, and is
called out here deliberately rather than left to be discovered.

## Out of scope

- No changes to roles, `MONEY`, or any other permission group.
- No audit-trail / change-history table. Worth considering separately if accounts editing
  becomes routine, since commission figures are financial records and edits are currently
  unlogged.
- No bulk edit or CSV re-import from the ledger.
