// Auth: bcrypt password hashing + JWT access tokens. Replaces Supabase Auth.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { q } = require("./db");

const SECRET = process.env.JWT_SECRET;

const sign = (user) => jwt.sign({ sub: user.id, email: user.email, ver: Number(user.token_version || 0) }, SECRET, { expiresIn: "7d" });
const hash = (pw) => bcrypt.hash(String(pw), 10);
const compare = (pw, h) => bcrypt.compare(String(pw), h);

async function profileFor(userId) {
  const r = await q("select id, full_name, email, role, agent_name from profiles where id=$1", [userId]);
  return r.rows[0] || null;
}

async function authStateFor(userId) {
  const r = await q(
    `select u.id, u.email, u.token_version, p.full_name, p.role, p.agent_name
       from users u left join profiles p on p.id=u.id where u.id=$1`,
    [userId]
  );
  return r.rows[0] || null;
}

// Resolve the caller from the Bearer token; missing profile => pending (denied).
async function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const p = jwt.verify(token, SECRET);
    const state = await authStateFor(p.sub);
    if (!state || Number(p.ver || 0) !== Number(state.token_version || 0)) throw new Error("Session revoked");
    req.user = {
      id: state.id, email: state.email, role: state.role || "pending",
      agent_name: state.agent_name || null, full_name: state.full_name || "",
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

const need = (user, roles) => roles.includes(user && user.role);

module.exports = { sign, hash, compare, profileFor, authMiddleware, need };
