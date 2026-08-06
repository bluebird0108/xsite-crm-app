# Team — Delete account + real password-reset flow

**Date:** 2026-08-06
**App:** XSITE CRM (`/var/www/crm`, self-hosted Node + Postgres, `xsite-api` systemd unit)
**Screen:** Team & Access (`viewTeam` in `app.js`)

## Problem

Two gaps on the Team screen:

1. There is no way to **permanently delete** an account. "Remove access" only
   returns a user to `pending`; the login persists.
2. The **Reset password** button is dead. The self-hosted `api.js` shim's
   `resetPasswordForEmail()` returns *"Email reset isn't available…"*, and the
   UI copy still falsely claims it "emails a secure link." There is no email/SMTP
   on this app, so a link-based reset is impossible.

## Context (current auth model)

- `users` table: `id`, `email`, `password_hash`, `token_version`, `created_at`.
  Bumping `token_version` revokes all of that user's existing sessions.
- `profiles.id → users.id ON DELETE CASCADE`.
- All audit references (`created_by`, `completed_by`, `finalized_by`,
  `submitted_by`, `uploaded_by`) are `ON DELETE SET NULL`.
- `deals.agent` and `commission_entries.agent_name` are **name strings, not FKs** —
  an agent's deal/ledger history is independent of their login account.
- `/auth/change-password` (authed) changes the caller's **own** password and bumps
  `token_version`. There is no mechanism to set another user's password (no
  service-role key in the browser, by design).
- Team screen is visible to owner/admin/manager (`showTeam`). Role changes go
  through the `set_member_role` RPC.

## Decisions (agreed)

- **Reset mechanism:** flag + forced reset on next login (no temp password, no
  email, owner/admin-initiated only).
- **Delete access:** owner + admin (managers may reassign roles but not delete
  accounts).

## Feature A — Delete team member (permanent)

Distinct from "Remove access" (→ `pending`). Delete removes the login entirely.
Because of the FK design, a delete is just `delete from users where id=$1`:
the profile cascades, audit refs null out, and deal/ledger history (keyed by
name) is untouched.

### Server — new RPC `delete_member(p_id)` in `server/routes/rpc.js`
- Gate: **owner + admin only** (403 otherwise).
- Guards, server-enforced:
  - Cannot delete yourself (`p_id === req.user.id` → error).
  - Cannot delete the last owner (count owners; if target is owner and count ≤ 1 → error).
  - Admin cannot delete an owner (if caller is admin and target role is owner → error).
- Action: `delete from users where id = p_id` (profile cascades via FK).

### Frontend — `app.js`
- New red **Delete** button next to *Remove access* in each team row. Hidden on
  the caller's own row, and (for admins) on owner rows.
- New `deleteMember(uid)`:
  - Confirm: *"Permanently delete X's account? This removes their login completely.
    Their deal and ledger history stays (it's linked by name, not by login)."*
  - Calls the `delete_member` RPC; on success removes the row and re-renders.
- Wire the button in `wireScreen()` alongside the existing `data-removemember` handler.

## Feature B — Reset password → forced reset on next login

Replaces the dead `resetPasswordForEmail` path.

### Schema
```sql
alter table users add column if not exists must_reset_password boolean not null default false;
```
(Applied via `psql` on the live DB **and** added to `server/schema.sql`.)

### Server
- **New RPC `flag_password_reset(p_id)`** (owner + admin): sets
  `must_reset_password = true` **and** bumps `token_version` for the target. The
  `token_version` bump revokes the agent's current session so the flag takes
  effect immediately; the agent logs back in with their **current** password
  (they are not locked out).
- **`/auth/login` and `/auth/session`**: include `must_reset_password` in the
  returned profile (add the column to the `authMiddleware` / login user selects).
- **`/auth/change-password`**: on success, clear the flag
  (`set must_reset_password = false`) alongside the existing `token_version` bump.

### Frontend — forced reset screen
- In `renderApp`, if `state.profile.must_reset_password` is true, short-circuit
  **before any role routing** to a new `viewForcePasswordReset()` — a minimal
  "Set a new password" screen (new + confirm password fields) that cannot be
  dismissed or navigated away from.
- It calls `change-password`; on success the flag clears (server + local state)
  and the app reloads into the user's normal role.
- **This forced screen is the "notification to reset."**
- **Session continuity (verified):** `/auth/change-password` bumps
  `token_version` (invalidating the current token) but re-issues a fresh token in
  its response (`sign(...)`), and the `api.js` shim's `updateUser` already stores
  it via `setToken`. So the agent stays authenticated through the reset with no
  extra re-login step — no change needed to that path.

### Frontend — Team screen
- `sendPasswordReset(email)` → `flagPasswordReset(uid)` calling the new RPC.
- Confirm: *"Require X to set a new password? They'll be signed out and prompted
  to choose a new one the next time they log in."*
- Fix the misleading screen copy (remove "emails a secure link"; describe the
  forced-reset-on-next-login behavior).

## Deploy & verify

- Apply the `ALTER` via `psql` on the live DB (+ update `schema.sql`). **Do not**
  run `update-crm.sh` with uncommitted edits (it does `git pull --ff-only`).
- Add the two RPCs + auth changes + frontend, then `systemctl restart xsite-api`
  (COLS reloads from `information_schema` on boot).
- Verify with disposable accounts (owner + admin + agent JWTs; a disposable
  profile needs a `users` row first — FK `profiles.id → users.id`):
  - **Delete:** disposable agent → Delete → gone from Team, login now fails;
    last-owner guard and admin-can't-delete-owner guard both return errors.
  - **Reset:** flag a disposable agent → their session is revoked → they re-login
    with their current password → forced reset screen appears → set a new
    password → flag clears, normal access restored; the new password works and
    the old one is rejected.

## Scope guard (YAGNI)

- No temp-password entry, no email, no self-service "forgot password"
  (owner/admin-initiated only).
- Delete is a hard delete relying on the existing cascade / set-null FKs — no
  soft-delete or archive table.
