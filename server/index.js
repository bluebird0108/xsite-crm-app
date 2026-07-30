// XSITE CRM API — self-hosted replacement for the Supabase backend.
require("dotenv").config();
const express = require("express");
const { loadMeta, q } = require("./db");
const { authMiddleware } = require("./auth");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  try { await q("select 1"); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Public auth (signup/login); session & change-password self-guard inside.
app.use("/api/auth", require("./routes/auth"));

// Files: per-route auth (raw download is token-authorized).
app.use("/api/files", require("./routes/files"));

// Everything else requires a valid session.
app.use("/api/db", authMiddleware, require("./routes/db"));
app.use("/api/rpc", authMiddleware, require("./routes/rpc"));

const PORT = process.env.PORT || 8787;
loadMeta()
  .then(() => app.listen(PORT, "127.0.0.1", () => console.log(`xsite-crm-api on 127.0.0.1:${PORT}`)))
  .catch((e) => { console.error("Failed to load schema metadata:", e.message); process.exit(1); });
