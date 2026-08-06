// /api/auth — signup (first user becomes owner, rest pending), login, session,
// change-password. No email flows (owner/admin approve & set roles in-app).
const router = require("express").Router();
const { q, tx } = require("../db");
const { sign, hash, compare, profileFor, authMiddleware } = require("../auth");
const { rateLimit } = require("../rate-limit");

const signupLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `signup:${req.ip}` });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, key: (req) => `login:${req.ip}` });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

router.post("/signup", signupLimit, async (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const em = String(email).trim().toLowerCase();
  if (em.length > 320 || !EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!validPassword(password)) return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  if (String(full_name || "").length > 200) return res.status(400).json({ error: "Full name is too long." });
  try {
    if ((await q("select 1 from users where email=$1", [em])).rowCount)
      return res.status(409).json({ error: "An account with this email already exists." });
    const out = await tx(async (c) => {
      const isFirst = (await c.query("select count(*)::int n from users")).rows[0].n === 0;
      const role = isFirst ? "owner" : "pending";
      const ph = await hash(password);
      const u = (await c.query("insert into users(email,password_hash) values($1,$2) returning id,email,token_version", [em, ph])).rows[0];
      await c.query("insert into profiles(id,full_name,email,role) values($1,$2,$3,$4)", [u.id, full_name || "", em, role]);
      return u;
    });
    return res.json({ token: sign(out), profile: await profileFor(out.id) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/login", loginLimit, async (req, res) => {
  const em = String((req.body || {}).email || "").trim().toLowerCase();
  const password = (req.body || {}).password;
  if (em.length > 320 || typeof password !== "string" || password.length > 128)
    return res.status(401).json({ error: "Invalid email or password." });
  try {
    const r = await q("select id,email,password_hash,token_version from users where email=$1", [em]);
    if (!r.rowCount || !(await compare(password || "", r.rows[0].password_hash)))
      return res.status(401).json({ error: "Invalid email or password." });
    return res.json({ token: sign(r.rows[0]), profile: await profileFor(r.rows[0].id) });
  } catch (e) {
    console.error("Login failed:", e.message);
    return res.status(500).json({ error: "Login is temporarily unavailable." });
  }
});

router.get("/session", authMiddleware, (req, res) => res.json({ profile: req.user }));

router.post("/change-password", authMiddleware, async (req, res) => {
  const pw = (req.body || {}).password;
  if (!validPassword(pw)) return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  const r = await q("update users set password_hash=$1, token_version=token_version+1 where id=$2 returning id,email,token_version", [await hash(pw), req.user.id]);
  // Clear any owner/admin-set forced-reset flag now that they've chosen a new password.
  await q("update profiles set must_reset_password=false where id=$1", [req.user.id]);
  return res.json({ ok: true, token: sign(r.rows[0]) });
});

module.exports = router;
