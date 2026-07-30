// /api/auth — signup (first user becomes owner, rest pending), login, session,
// change-password. No email flows (owner/admin approve & set roles in-app).
const router = require("express").Router();
const { q, tx } = require("../db");
const { sign, hash, compare, profileFor, authMiddleware } = require("../auth");

router.post("/signup", async (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const em = String(email).trim().toLowerCase();
  try {
    if ((await q("select 1 from users where email=$1", [em])).rowCount)
      return res.status(409).json({ error: "An account with this email already exists." });
    const out = await tx(async (c) => {
      const isFirst = (await c.query("select count(*)::int n from users")).rows[0].n === 0;
      const role = isFirst ? "owner" : "pending";
      const ph = await hash(password);
      const u = (await c.query("insert into users(email,password_hash) values($1,$2) returning id,email", [em, ph])).rows[0];
      await c.query("insert into profiles(id,full_name,email,role) values($1,$2,$3,$4)", [u.id, full_name || "", em, role]);
      return u;
    });
    return res.json({ token: sign(out), profile: await profileFor(out.id) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/login", async (req, res) => {
  const em = String((req.body || {}).email || "").trim().toLowerCase();
  const r = await q("select id,email,password_hash from users where email=$1", [em]);
  if (!r.rowCount) return res.status(401).json({ error: "Invalid email or password." });
  if (!(await compare((req.body || {}).password || "", r.rows[0].password_hash)))
    return res.status(401).json({ error: "Invalid email or password." });
  return res.json({ token: sign(r.rows[0]), profile: await profileFor(r.rows[0].id) });
});

router.get("/session", authMiddleware, (req, res) => res.json({ profile: req.user }));

router.post("/change-password", authMiddleware, async (req, res) => {
  const pw = (req.body || {}).password;
  if (!pw || String(pw).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  await q("update users set password_hash=$1 where id=$2", [await hash(pw), req.user.id]);
  return res.json({ ok: true });
});

module.exports = router;
