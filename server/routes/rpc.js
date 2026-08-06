// /api/rpc/:name — the 18 server functions the client calls. Reconstructed
// from the client payloads + its fallback direct-writes + the old RLS/RPC role
// checks. Each returns { data, error } to match the client's expectations.
const router = require("express").Router();
const { q, tx, sqlInsert, sqlUpdate, pick, coerce } = require("../db");
const { need } = require("../auth");
const { validateMoneyDocument } = require("../money-doc-policy");

const MONEY = ["owner", "accounts"];
// "manager" mirrors "admin" for management actions (contracts, contacts, roles).
// Cash updates stay MONEY-only, so manager (like admin) cannot touch cash.
const MANAGE = ["owner", "admin", "manager"];
// Deleting an account and forcing a password reset touch the login itself, so
// they are owner+admin only — managers may reassign roles but not do these.
const OWNER_ADMIN = ["owner", "admin"];
const MONEY_REQUESTS = ["salary_advance", "commission_payout", "commission_query", "deal_correction"];
const ym = (d) => (d ? String(d).slice(0, 7) : null);

async function nextDocNo(client, docType) {
  const seq = docType === "receipt" ? "receipt_no_seq" : "invoice_no_seq";
  const prefix = docType === "receipt" ? "RCT-" : "INV-";
  const n = (await client.query(`select nextval('${seq}')::int n`)).rows[0].n;
  return prefix + String(n).padStart(4, "0");
}

// insert/update helper against a pg client
async function ins(client, table, obj, extra = {}) {
  const { text, values } = sqlInsert(table, obj, extra);
  return (await client.query(text, values)).rows[0];
}

const HANDLERS = {
  // ── deals ──────────────────────────────────────────────────────────
  async save_deal_group(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can record deals");
    const gid = p.p_group_id;
    return tx(async (c) => {
      await c.query("insert into deal_groups(id) values($1) on conflict (id) do nothing", [gid]);
      if (p.p_replace) {
        await c.query("delete from deals where group_id=$1", [gid]);
        await c.query("delete from commission_entries where group_id=$1", [gid]);
      }
      for (const d of p.p_deals || []) await ins(c, "deals", d, { group_id: gid, month: d.month || ym(d.deal_date) });
      for (const cm of p.p_commission || []) await ins(c, "commission_entries", cm, { group_id: gid, month: cm.month || ym(cm.entry_date) });
      return null;
    });
  },
  async delete_deal_group(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can delete deals");
    return tx(async (c) => {
      await c.query("delete from deals where group_id=$1", [p.p_group_id]);
      await c.query("delete from commission_entries where group_id=$1", [p.p_group_id]);
      await c.query("delete from deal_groups where id=$1", [p.p_group_id]);
      return null;
    });
  },

  // ── commission entries ─────────────────────────────────────────────
  async save_commission_entry(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can record commission entries");
    const row = {
      agent_name: p.p_agent_name, entry_date: p.p_entry_date, month: ym(p.p_entry_date),
      third_party: p.p_third_party, agent2: p.p_agent2, deal_type: p.p_deal_type,
      unit: p.p_unit, building: p.p_building, area: p.p_area, annual_value: p.p_annual_value,
      property_use: p.p_property_use || "Residential",
      total_commission: p.p_total_commission, received: p.p_received, vat: p.p_vat,
      commission_ex_vat: p.p_commission_ex_vat, agent_business: p.p_agent_business,
      xsite_share: p.p_xsite_share, agent_share: p.p_agent_share,
    };
    return tx(async (c) => {
      if (p.p_id) {
        const { text, values } = sqlUpdate("commission_entries", row, { id: p.p_id });
        await c.query(text, values);
      } else {
        const g = (await c.query("insert into deal_groups default values returning id")).rows[0].id;
        await ins(c, "commission_entries", row, { group_id: g });
      }
      return null;
    });
  },
  async delete_commission_entry(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can delete commission entries");
    await q("delete from commission_entries where id=$1", [p.p_id]);
    return null;
  },

  // ── contracts ──────────────────────────────────────────────────────
  async save_contract(u, p) {
    if (!need(u, MANAGE)) throw err("Only Owner or Admin can manage contracts");
    const base = {
      deal_group: p.p_deal_group || null, status: p.p_status,
      contract_date: p.p_contract_date, start_date: p.p_start_date, end_date: p.p_end_date,
      landlord_name: p.p_landlord_name, tenant_name: p.p_tenant_name,
      owner_phone: p.p_owner_phone, tenant_phone: p.p_tenant_phone,
      annual_rent: p.p_annual_rent, security_deposit: p.p_security_deposit,
      payment_mode: p.p_payment_mode, additional_terms: p.p_additional_terms,
      details: p.p_details, addendum: p.p_addendum,
    };
    return tx(async (c) => {
      let contract;
      const finalizing = p.p_status === "final";
      if (p.p_id) {
        const extra = { updated_at: new Date().toISOString() };
        if (finalizing) { extra.finalized_by = u.id; extra.finalized_at = new Date().toISOString(); }
        const { text, values } = sqlUpdate("contracts", { ...base, ...extra }, { id: p.p_id });
        contract = (await c.query(text, values)).rows[0];
      } else {
        const no = "CN-" + String((await c.query("select nextval('contract_no_seq')::int n")).rows[0].n).padStart(4, "0");
        const extra = { contract_no: no, created_by: u.id };
        if (finalizing) { extra.finalized_by = u.id; extra.finalized_at = new Date().toISOString(); }
        contract = await ins(c, "contracts", base, extra);
      }
      // On finalize, open an Accounts hand-off task if one isn't already open.
      if (finalizing && contract) {
        const open = await c.query("select 1 from account_tasks where contract_id=$1 and status='pending'", [contract.id]);
        if (!open.rowCount) await ins(c, "account_tasks", { contract_id: contract.id, task_type: "invoice_or_receipt", status: "pending" });
      }
      return contract;
    });
  },
  async set_contract_ejari(u, p) {
    if (!need(u, ["owner", "admin", "accounts"])) throw err("Not authorized");
    if (!["registered", "pending"].includes(p.p_status)) throw err("Invalid Ejari status");
    await q("update contracts set ejari_status=$1, updated_at=now() where id=$2", [p.p_status, p.p_id]);
    return null;
  },

  // ── money docs / account tasks ─────────────────────────────────────
  async fulfill_account_task(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can issue documents");
    return tx(async (c) => {
      const task = (await c.query("select * from account_tasks where id=$1 for update", [p.p_task_id])).rows[0];
      if (!task) throw err("Task not found");
      if (task.status !== "pending") throw err("This contract notification has already been handled");
      const contract = (await c.query("select * from contracts where id=$1", [task.contract_id])).rows[0];
      if (!contract) throw err("Contract not found");
      let checked;
      try {
        checked = validateMoneyDocument({ docType: p.p_doc_type, status: p.p_status || "draft", amount: p.p_amount,
          paymentMethod: p.p_payment_method, details: p.p_details });
      } catch (error) { throw err(error.message); }
      const doc_no = await nextDocNo(c, p.p_doc_type);
      const doc = await ins(c, "money_docs", {
        doc_type: p.p_doc_type, doc_no, deal_group: contract ? contract.deal_group : null,
        doc_date: p.p_doc_date, client: contract ? contract.tenant_name : null,
        description: contract ? `Contract ${contract.contract_no}` : null,
        amount: checked.amount, payment_method: checked.paymentMethod, details: {
          ...checked.details, contract_id: contract.id, contract_no: contract.contract_no,
        }, status: checked.status, month: ym(p.p_doc_date),
      });
      await c.query("update account_tasks set money_doc_id=$1, status='completed', completed_by=$2, completed_at=now() where id=$3",
        [doc.id, u.id, p.p_task_id]);
      return doc;
    });
  },
  async create_money_doc(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can post documents");
    return tx(async (c) => {
      let checked;
      try {
        checked = validateMoneyDocument({ docType: p.p_doc_type, status: p.p_status, amount: p.p_amount,
          paymentMethod: p.p_payment_method, details: p.p_details });
      } catch (error) { throw err(error.message); }
      const doc_no = await nextDocNo(c, p.p_doc_type);
      return ins(c, "money_docs", {
        doc_type: p.p_doc_type, doc_no, deal_group: p.p_deal_group || null, doc_date: p.p_doc_date,
        client: p.p_client, description: p.p_description, amount: checked.amount,
        payment_method: checked.paymentMethod, status: checked.status, month: ym(p.p_doc_date), details: checked.details,
      });
    });
  },
  async mark_invoice_paid(u, p) {
    if (!need(u, MONEY)) throw err("Not authorized");
    const updated = await q("update money_docs set status='paid' where id=$1 and doc_type='invoice' and status='pending' returning id", [p.p_doc_id]);
    if (!updated.rowCount) throw err("Only a pending invoice can be marked paid");
    return null;
  },
  async delete_money_doc(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can delete documents");
    return tx(async (c) => {
      await c.query("update account_tasks set money_doc_id=null, status='pending', completed_by=null, completed_at=null where money_doc_id=$1", [p.p_doc_id]);
      await c.query("delete from money_docs where id=$1", [p.p_doc_id]);
      return null;
    });
  },

  // ── cash ────────────────────────────────────────────────────────────
  async save_cash_snapshot(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can update cash position");
    return tx(async (c) => {
      await c.query("delete from cash_position where as_at=$1", [p.p_as_at]);
      const lines = p.p_lines || [];
      for (let i = 0; i < lines.length; i++) {
        await ins(c, "cash_position", { as_at: p.p_as_at, label: lines[i].label, amount: lines[i].amount, sort_order: i, month: ym(p.p_as_at) });
      }
      return null;
    });
  },
  async save_cash_movement(u, p) {
    if (!need(u, MONEY)) throw err("Only Owner or Accounts can record cash movements");
    const row = {
      movement_date: p.p_movement_date, direction: p.p_direction, channel: p.p_channel,
      bank_account: p.p_bank_account, agent_name: p.p_agent_name, client: p.p_client,
      property: p.p_property, amount: p.p_amount, reference: p.p_reference, month: ym(p.p_movement_date),
    };
    if (p.p_id) { const { text, values } = sqlUpdate("cash_movements", row, { id: p.p_id }); await q(text, values); }
    else await q(...toInsert("cash_movements", row, { created_by: u.id }));
    return null;
  },
  async delete_cash_movement(u, p) {
    if (!need(u, MONEY)) throw err("Not authorized");
    await q("delete from cash_movements where id=$1", [p.p_id]);
    return null;
  },

  // ── contacts ────────────────────────────────────────────────────────
  async save_contact(u, p) {
    if (!need(u, MANAGE)) throw err("Only Owner or Admin can manage contacts");
    const row = { name: p.p_name, contact_type: p.p_contact_type, phone: p.p_phone, email: p.p_email, notes: p.p_notes, last_contact: p.p_last_contact };
    if (p.p_id) { const { text, values } = sqlUpdate("contacts", { ...row, updated_at: new Date().toISOString() }, { id: p.p_id }); await q(text, values); return p.p_id; }
    const c = await insPool("contacts", row, { created_by: u.id });
    return c.id; // client uses the returned id to save birthday separately
  },
  async delete_contact(u, p) {
    if (!need(u, MANAGE)) throw err("Only Owner or Admin can delete contacts");
    await q("delete from contacts where id=$1", [p.p_id]);
    return null;
  },
  async upsert_contact_by_name(u, p) {
    if (!need(u, MANAGE)) throw err("Not authorized");
    const ex = await q("select id from contacts where lower(name)=lower($1) and contact_type=$2 limit 1", [p.p_name, p.p_contact_type]);
    if (ex.rowCount) { await q("update contacts set phone=coalesce(nullif($1,''),phone), updated_at=now() where id=$2", [p.p_phone || "", ex.rows[0].id]); return ex.rows[0].id; }
    const c = await insPool("contacts", { name: p.p_name, contact_type: p.p_contact_type, phone: p.p_phone }, { created_by: u.id });
    return c.id;
  },

  // ── requests / team ─────────────────────────────────────────────────
  async review_agent_request(u, p) {
    const reqRow = (await q("select * from agent_requests where id=$1", [p.p_id])).rows[0];
    if (!reqRow) throw err("Request not found");
    const money = MONEY_REQUESTS.includes(reqRow.request_type);
    const ok = u.role === "owner" || (u.role === "accounts" && money) || ((u.role === "admin" || u.role === "manager") && !money);
    if (!ok) throw err("Not authorized to review this request type");
    if (p.p_expected_updated_at) {
      const r = await q("update agent_requests set status=$1, response=$2, updated_at=now() where id=$3 and updated_at=$4 returning id",
        [p.p_status, p.p_response, p.p_id, p.p_expected_updated_at]);
      if (!r.rowCount) throw err("This request was updated by someone else — reload and try again.");
    } else {
      await q("update agent_requests set status=$1, response=$2, updated_at=now() where id=$3", [p.p_status, p.p_response, p.p_id]);
    }
    return null;
  },
  async set_member_role(u, p) {
    if (!need(u, MANAGE)) throw err("Only Owner or Admin can assign roles");
    const valid = ["owner", "accounts", "admin", "manager", "agent", "pending"];
    if (!valid.includes(p.p_role)) throw err("Invalid role");
    const target = (await q("select role from profiles where id=$1", [p.p_id])).rows[0];
    if (!target) throw err("Member not found");
    if (u.role !== "owner" && (p.p_role === "owner" || target.role === "owner"))
      throw err("Only the owner can grant or change the owner role");
    if (p.p_role === "agent" && !p.p_agent_name) throw err("An agent must have an agent name");
    if (target.role === "owner" && p.p_role !== "owner") {
      const owners = (await q("select count(*)::int n from profiles where role='owner'")).rows[0].n;
      if (owners <= 1) throw err("Cannot remove the last owner");
    }
    await q("update profiles set role=$1, agent_name=$2 where id=$3", [p.p_role, p.p_role === "agent" ? p.p_agent_name : null, p.p_id]);
    return null;
  },
  // Look up one agent's email by their ledger name so Accounts can email them a
  // statement. Scoped to owner/accounts and returns only the single address (the
  // generic profiles read is MANAGE-only, so this avoids exposing the whole table).
  async agent_email(u, p) {
    if (!need(u, MONEY)) throw err("Not authorized");
    const name = String(p.p_agent_name || "").trim();
    if (!name) return null;
    const r = await q(
      "select email from profiles where role='agent' and email is not null and email<>'' and lower(trim(agent_name))=lower($1) limit 1",
      [name]);
    return r.rows[0] ? r.rows[0].email : null;
  },
  // Permanently delete an account (distinct from "Remove access", which only
  // returns it to pending). Relies on the FK design: profiles cascades, audit
  // refs set-null, and deal/ledger history is keyed by name so it is untouched.
  async delete_member(u, p) {
    if (!need(u, OWNER_ADMIN)) throw err("Only Owner or Admin can delete accounts");
    if (!p.p_id) throw err("Member not found");
    if (p.p_id === u.id) throw err("You cannot delete your own account");
    const target = (await q("select role from profiles where id=$1", [p.p_id])).rows[0];
    if (!target) throw err("Member not found");
    if (u.role === "admin" && target.role === "owner") throw err("Only an owner can delete an owner account");
    if (target.role === "owner") {
      const owners = (await q("select count(*)::int n from profiles where role='owner'")).rows[0].n;
      if (owners <= 1) throw err("Cannot delete the last owner");
    }
    await q("delete from users where id=$1", [p.p_id]);
    return null;
  },
  // Force a member to set a new password at next login. Sets the flag AND bumps
  // token_version so their current session is revoked immediately; they log back
  // in with their CURRENT password and the client forces the reset screen.
  async flag_password_reset(u, p) {
    if (!need(u, OWNER_ADMIN)) throw err("Only Owner or Admin can reset passwords");
    if (!p.p_id) throw err("Member not found");
    if (p.p_id === u.id) throw err("Use the Password option in the top bar to change your own password");
    const target = (await q("select role from profiles where id=$1", [p.p_id])).rows[0];
    if (!target) throw err("Member not found");
    if (u.role === "admin" && target.role === "owner") throw err("Only an owner can reset an owner's password");
    await tx(async (c) => {
      await c.query("update profiles set must_reset_password=true where id=$1", [p.p_id]);
      await c.query("update users set token_version=token_version+1 where id=$1", [p.p_id]);
    });
    return null;
  },
};

// small pool-based insert helpers
async function insPool(table, obj, extra) { const { text, values } = sqlInsert(table, obj, extra); return (await q(text, values)).rows[0]; }
function toInsert(table, obj, extra) { const { text, values } = sqlInsert(table, obj, extra); return [text, values]; }
function err(msg) { const e = new Error(msg); e.rpc = true; return e; }

router.post("/:name", async (req, res) => {
  if (req.user.role === "pending") return res.status(403).json({ error: "Your account is awaiting approval." });
  const fn = HANDLERS[req.params.name];
  if (!fn) return res.status(404).json({ error: "Unknown function" });
  try {
    const data = await fn(req.user, req.body || {});
    res.json({ data: data === undefined ? null : data });
  } catch (e) {
    res.status(e.rpc ? 400 : 500).json({ error: e.message });
  }
});

module.exports = router;
