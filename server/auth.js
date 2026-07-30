// Auth: bcrypt password hashing + JWT access tokens. Replaces Supabase Auth.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { q } = require("./db");

const SECRET = process.env.JWT_SECRET;

const sign = (user) => jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: "30d" });
const hash = (pw) => bcrypt.hash(String(pw), 10);
const compare = (pw, h) => bcrypt.compare(String(pw), h);

async function profileFor(userId) {
  const r = await q("select id, full_name, email, role, agent_name from profiles where id=$1", [userId]);
  return r.rows[0] || null;
}

// Resolve the caller from the Bearer token; missing profile => pending (denied).
async function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const p = jwt.verify(token, SECRET);
    const prof = await profileFor(p.sub);
    req.user = prof || { id: p.sub, email: p.email, role: "pending", agent_name: null, full_name: "" };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

const need = (user, roles) => roles.includes(user && user.role);

module.exports = { sign, hash, compare, profileFor, authMiddleware, need };
