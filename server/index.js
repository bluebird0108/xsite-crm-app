// XSITE CRM API — self-hosted replacement for the Supabase backend.
require("dotenv").config();
const express = require("express");
const { loadMeta, q } = require("./db");
const { authMiddleware } = require("./auth");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "2mb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.get("/api/health", async (_req, res) => {
  try { await q("select 1"); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Public auth (signup/login); session & change-password self-guard inside.
app.use("/api/auth", require("./routes/auth"));

// Files: per-route auth (raw download is token-authorized).
app.use("/api/files", require("./routes/files"));

// Listing media: per-route auth. Upload is owner/admin; raw serve is PUBLIC so
// the property portals can fetch listing images by URL.
app.use("/api/media", require("./routes/media"));

// Listing feeds: PUBLIC XML the portals pull (guarded by ?key=FEED_KEY).
app.use("/api/feed", require("./routes/feed"));

// Everything else requires a valid session.
app.use("/api/db", authMiddleware, require("./routes/db"));
app.use("/api/rpc", authMiddleware, require("./routes/rpc"));

const PORT = process.env.PORT || 8787;
loadMeta()
  .then(() => app.listen(PORT, "127.0.0.1", () => console.log(`xsite-crm-api on 127.0.0.1:${PORT}`)))
  .catch((e) => { console.error("Failed to load schema metadata:", e.message); process.exit(1); });
