// /api/db/:table — generic, authorization-enforced table access.
// Mirrors the Supabase/PostgREST surface the client already uses, but every
// rule from the old RLS policies is re-checked here server-side. Agents are
// scoped to their own rows; pending is denied everything.
const router = require("express").Router();
const { q, COLS, buildWhere, sqlInsert, sqlUpdate } = require("../db");
const { sanitizeWrite, hasKnownFilter } = require("../write-policy");

// "manager" mirrors "admin" everywhere EXCEPT cash (see CASH below).
const BACK = ["owner", "accounts", "admin", "manager"];
const MANAGE = ["owner", "admin", "manager"];
const MONEY = ["owner", "accounts"];
const AUTHED = ["owner", "accounts", "admin", "agent", "manager"];
// Cash position + movements: owner/accounts only. Admin and manager are excluded.
const CASH = ["owner", "accounts"];
// Property listings (portal syndication) — admin + owner only.
const LISTINGS = ["owner", "admin"];

// Money columns withheld from the ADMIN role on read. Owner/accounts/manager see
// amounts, and agents see their own (row-scoped) amounts — only admin is masked.
// Admin still gets the rows (counts, dates, agent names, unit/building intact) but
// every amount is stripped at the source, not just hidden in the UI.
const MONEY_MASKED = ["admin"];
const MONEY_COLS = {
  deals: ["price", "total_commission", "commission_received", "vat", "commission_ex_vat",
          "agent_business", "company_share", "agent_share", "security_deposit"],
  commission_entries: ["annual_value", "total_commission", "received", "vat", "commission_ex_vat",
          "agent_business", "xsite_share", "agent_share"],
  money_docs: ["amount"],
};

// Per-table policy. `scope` narrows reads (and agent writes) to own rows.
// scope: { col, by } — by "agent" uses user.agent_name, "id" uses user.id,
// or `sql` for a custom predicate using :A (agent_name).
const POLICY = {
  agents:             { read: AUTHED, insert: [], update: [], delete: [] },
  deals:              { read: AUTHED, insert: MONEY, update: MONEY, delete: MONEY, agentSql: "(agent = :A or agent2 = :A)" },
  commission_entries: { read: AUTHED, insert: MONEY, update: MONEY, delete: MONEY, scope: { col: "agent_name", by: "agent" } },
  deal_groups:        { read: AUTHED, insert: ["owner", "accounts", "admin", "manager"], update: [], delete: MONEY },
  cash_position:      { read: CASH, insert: MONEY, update: MONEY, delete: MONEY },
  cash_movements:     { read: CASH, insert: MONEY, update: MONEY, delete: MONEY },
  money_docs:         { read: BACK, insert: MONEY, update: MONEY, delete: MONEY },
  // Role changes must go through set_member_role, which enforces owner rules.
  profiles:           { read: MANAGE, insert: [], update: [], delete: [], selfRead: true },
  staff:              { read: BACK, insert: MANAGE, update: MANAGE, delete: MANAGE },
  agent_requests:     { read: AUTHED, insert: AUTHED, update: BACK, delete: MANAGE, scope: { col: "created_by", by: "id" } },
  contracts:          { read: AUTHED, insert: [], update: [], delete: MANAGE,
                        agentSql: "(status='final' and deal_group in (select group_id from deals where agent = :A or agent2 = :A))" },
  account_tasks:      { read: BACK, insert: [], update: MONEY, delete: [] },
  contacts:           { read: BACK, insert: MANAGE, update: MANAGE, delete: MANAGE },
  kyc_forms:          { read: BACK, insert: BACK, update: BACK, delete: MANAGE },
  listings:           { read: LISTINGS, insert: LISTINGS, update: LISTINGS, delete: LISTINGS },
  contract_files:     { read: AUTHED, insert: AUTHED, update: MANAGE, delete: MANAGE, scope: { col: "uploaded_by", by: "id" } },
  deal_submissions:   { read: AUTHED, insert: AUTHED, update: ["owner", "admin", "manager", "self"], delete: MANAGE, scope: { col: "submitted_by", by: "id" } },
};

const has = (u, roles) => roles.includes(u.role);

// Extra WHERE fragment restricting agents to their own rows for a table.
function agentScope(table, user, startIdx) {
  const p = POLICY[table];
  if (!p || user.role !== "agent") return { sql: "", params: [] };
  if (p.agentSql) {
    // inline agent_name safely as a parameter
    const val = user.agent_name || "\0";
    return { sql: p.agentSql.replace(/:A/g, `$${startIdx + 1}`), params: [val] };
  }
  if (p.scope) {
    const val = p.scope.by === "id" ? user.id : (user.agent_name || "\0");
    return { sql: `"${p.scope.col}" = $${startIdx + 1}`, params: [val] };
  }
  // agent with no scope on a readable table: allow (e.g. agents reference table)
  return { sql: "", params: [] };
}

router.use("/:table", (req, res, next) => {
  const table = req.params.table;
  if (!POLICY[table] || !COLS[table]) return res.status(404).json({ error: "Unknown table" });
  // Pending members still need to read their own profile so the client can
  // render the awaiting-approval workspace. Every other table and every write
  // remains blocked until an owner/admin assigns a role.
  const pendingSelfProfileRead = req.user.role === "pending" && req.method === "GET" && table === "profiles";
  if (req.user.role === "pending" && !pendingSelfProfileRead)
    return res.status(403).json({ error: "Your account is awaiting approval." });
  next();
});

// GET list
router.get("/:table", async (req, res) => {
  const table = req.params.table;
  const p = POLICY[table];
  const u = req.user;
  const canRead = has(u, p.read) || p.selfRead;
  const scoped = u.role === "agent" && (p.scope || p.agentSql);
  if (!canRead && !scoped) return res.status(403).json({ error: "Not authorized" });

  const set = COLS[table];
  let select = (req.query.select ? String(req.query.select).split(",") : ["*"])
    .map((c) => c.trim()).filter((c) => c === "*" || set.has(c));
  // Withhold money columns from the admin role (see MONEY_COLS / MONEY_MASKED). Once
  // masking applies we never fall back to "*", or the amounts would leak straight back in.
  if (MONEY_COLS[table] && has(u, MONEY_MASKED)) {
    const hidden = new Set(MONEY_COLS[table]);
    const allowed = [...set].filter((c) => !hidden.has(c));
    if (select.includes("*")) select = allowed;
    else { select = select.filter((c) => !hidden.has(c)); if (!select.length) select = allowed; }
  }
  const cols = select.length ? select.map((c) => (c === "*" ? "*" : `"${c}"`)).join(",") : "*";

  const where = req.query.where ? safeJson(req.query.where) : {};
  const { clause, params } = buildWhere(table, where, 0);
  let sql = `select ${cols} from ${table} ${clause}`;
  let allParams = params;

  // profiles: non-manage roles may only read their own row
  if (table === "profiles" && !has(u, MANAGE)) {
    sql += (clause ? " and" : " where") + ` id = $${allParams.length + 1}`;
    allParams = [...allParams, u.id];
  } else {
    const sc = agentScope(table, u, allParams.length);
    if (sc.sql) { sql += (clause ? " and " : " where ") + sc.sql; allParams = [...allParams, ...sc.params]; }
  }

  if (req.query.order) {
    const [col, dir] = String(req.query.order).split(".");
    if (set.has(col)) sql += ` order by "${col}" ${dir === "desc" ? "desc" : "asc"}`;
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
  const offset = parseInt(req.query.offset, 10) || 0;
  sql += ` limit ${limit} offset ${offset}`;

  try {
    const r = await q(sql, allParams);
    res.json({ data: r.rows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST insert (single object or array)
router.post("/:table", async (req, res) => {
  const table = req.params.table, p = POLICY[table], u = req.user;
  if (!has(u, p.insert)) return res.status(403).json({ error: "Not authorized" });
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const out = [];
    for (const row of rows) {
      const extra = {};
      if (table === "deal_submissions") {
        extra.submitted_by = u.id;
        extra.submitted_by_name = u.full_name || u.email;
        extra.agent_name = u.agent_name || null;
      }
      if (table === "contract_files") {
        extra.uploaded_by = u.id;
        extra.uploaded_by_name = u.full_name || u.email;
      }
      if (table === "agent_requests") {
        extra.created_by = u.id;
        extra.submitter_name = u.full_name || u.email;
      }
      const clean = sanitizeWrite(table, "insert", u.role, row);
      const { text, values } = sqlInsert(table, clean, extra);
      const r = await q(text, values);
      out.push(r.rows[0]);
    }
    res.json({ data: out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH update  body: { values:{}, where:{} }
router.patch("/:table", async (req, res) => {
  const table = req.params.table, p = POLICY[table], u = req.user;
  const { values, where } = req.body || {};
  const allowed = has(u, p.update) ||
    (p.update.includes("self") && u.role === "agent");
  if (!allowed) return res.status(403).json({ error: "Not authorized" });
  try {
    if (!hasKnownFilter(where, COLS[table])) return res.status(400).json({ error: "Refusing unfiltered update" });
    const clean = sanitizeWrite(table, "update", u.role, values);
    // agents may only touch their own rows (and submissions only while 'submitted')
    let w = { ...where };
    if (u.role === "agent" && p.scope) w[p.scope.col] = p.scope.by === "id" ? u.id : u.agent_name;
    if (table === "deal_submissions" && u.role === "agent") w.status = "submitted";
    const { text, values: vv } = sqlUpdate(table, clean, w);
    const r = await q(text, vv);
    res.json({ data: r.rows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE  body/query: { where:{} }
router.delete("/:table", async (req, res) => {
  const table = req.params.table, p = POLICY[table], u = req.user;
  if (!has(u, p.delete)) return res.status(403).json({ error: "Not authorized" });
  const where = (req.body && req.body.where) || (req.query.where ? safeJson(req.query.where) : {});
  const { clause, params } = buildWhere(table, where, 0);
  if (!clause) return res.status(400).json({ error: "Refusing unfiltered delete" });
  try {
    const r = await q(`delete from ${table} ${clause} returning *`, params);
    res.json({ data: r.rows });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

module.exports = router;
