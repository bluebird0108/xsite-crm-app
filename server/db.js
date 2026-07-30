// Postgres pool + query helpers. We store date-like fields as TEXT (so the
// client's string date handling works unchanged); numeric is coerced to JS
// number to mirror what PostgREST returned. Column/jsonb metadata is loaded
// from information_schema so writes are whitelisted against the real schema.
const { Pool, types } = require("pg");
require("dotenv").config();

types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric -> number
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // bigint -> number

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

const COLS = {};   // table -> Set(columns)
const JSONB = {};  // table -> Set(jsonb columns)

async function loadMeta() {
  const r = await pool.query(
    "select table_name, column_name, data_type from information_schema.columns where table_schema='public'"
  );
  for (const k of Object.keys(COLS)) delete COLS[k];
  for (const k of Object.keys(JSONB)) delete JSONB[k];
  for (const row of r.rows) {
    (COLS[row.table_name] ||= new Set()).add(row.column_name);
    if (row.data_type === "jsonb") (JSONB[row.table_name] ||= new Set()).add(row.column_name);
  }
}

// Coerce a value for storage: "" -> null; objects/arrays for jsonb -> JSON string.
function coerce(table, col, val) {
  if (val === "" || val === undefined) return null;
  if (val !== null && typeof val === "object" && JSONB[table] && JSONB[table].has(col)) {
    return JSON.stringify(val);
  }
  return val;
}

// Keep only real columns for the table.
function pick(table, obj) {
  const set = COLS[table];
  const out = {};
  if (!set || !obj) return out;
  for (const k of Object.keys(obj)) if (set.has(k)) out[k] = obj[k];
  return out;
}

// Build an INSERT ... RETURNING * for a single row object.
function sqlInsert(table, obj, extra = {}) {
  const merged = { ...pick(table, obj), ...pick(table, extra) };
  const keys = Object.keys(merged);
  const vals = keys.map((k) => coerce(table, k, merged[k]));
  const ph = keys.map((_, i) => `$${i + 1}`);
  const text = `insert into ${table} (${keys.map((k) => `"${k}"`).join(",")}) values (${ph.join(",")}) returning *`;
  return { text, values: vals };
}

// Build an UPDATE ... WHERE ... RETURNING * from a values object + where object.
function sqlUpdate(table, values, where) {
  const v = pick(table, values);
  const keys = Object.keys(v);
  const params = keys.map((k) => coerce(table, k, v[k]));
  const sets = keys.map((k, i) => `"${k}"=$${i + 1}`);
  const { clause, params: wp } = buildWhere(table, where, keys.length);
  const text = `update ${table} set ${sets.join(",")} ${clause} returning *`;
  return { text, values: [...params, ...wp] };
}

// Build a WHERE clause from a plain {col: val} object (validated columns only).
function buildWhere(table, where, startIdx = 0) {
  const set = COLS[table] || new Set();
  const parts = [];
  const params = [];
  let i = startIdx;
  for (const k of Object.keys(where || {})) {
    if (!set.has(k)) continue;
    if (where[k] === null) { parts.push(`"${k}" is null`); continue; }
    params.push(where[k]);
    parts.push(`"${k}"=$${++i}`);
  }
  return { clause: parts.length ? `where ${parts.join(" and ")}` : "", params };
}

module.exports = { pool, q, tx, loadMeta, COLS, JSONB, coerce, pick, sqlInsert, sqlUpdate, buildWhere };
