// /api/files — local-disk replacement for Supabase Storage (bucket "documents").
// Bytes live under FILES_DIR keyed by the same paths the client already builds
// (<contractId>/<uuid>-<name>, submissions/<subId>/<uuid>-<name>). Metadata
// rows go through /api/db/contract_files. Downloads use a short-lived signed
// token (window.open can't send an auth header).
const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { authMiddleware, need } = require("../auth");

const FILES_DIR = process.env.FILES_DIR || "/var/www/crm-files";
const SECRET = process.env.JWT_SECRET;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Resolve a client-supplied storage key to a safe absolute path inside FILES_DIR.
function resolveSafe(key) {
  const clean = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(FILES_DIR, clean);
  if (!abs.startsWith(path.resolve(FILES_DIR) + path.sep)) return null;
  return abs;
}

// Upload: role owner/admin/accounts/agent (mirrors documents_insert policy).
router.post("/upload", authMiddleware, upload.single("file"), (req, res) => {
  if (!need(req.user, ["owner", "admin", "manager", "accounts", "agent"])) return res.status(403).json({ error: "Not authorized" });
  const key = req.body.path;
  if (!key || !req.file) return res.status(400).json({ error: "Missing path or file" });
  const abs = resolveSafe(key);
  if (!abs) return res.status(400).json({ error: "Invalid path" });
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    res.json({ data: { path: key } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sign: any authenticated non-pending user may request a link; row-level read
// rules are enforced when the metadata row is listed via /api/db/contract_files.
router.post("/sign", authMiddleware, (req, res) => {
  if (req.user.role === "pending") return res.status(403).json({ error: "Not authorized" });
  const key = req.body.path;
  if (!key || !resolveSafe(key)) return res.status(400).json({ error: "Invalid path" });
  const token = jwt.sign({ path: key }, SECRET, { expiresIn: 120 });
  res.json({ data: { signedUrl: `/api/files/raw/${token}` } });
});

// Raw download: token in the URL is the authorization.
router.get("/raw/:token", (req, res) => {
  try {
    const { path: key } = jwt.verify(req.params.token, SECRET);
    const abs = resolveSafe(key);
    if (!abs || !fs.existsSync(abs)) return res.status(404).send("Not found");
    res.sendFile(abs);
  } catch (e) { res.status(401).send("Link expired"); }
});

// Remove: owner/admin/manager (documents_delete policy).
router.post("/remove", authMiddleware, (req, res) => {
  if (!need(req.user, ["owner", "admin", "manager"])) return res.status(403).json({ error: "Not authorized" });
  for (const key of req.body.paths || []) {
    const abs = resolveSafe(key);
    if (abs && fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* ignore */ } }
  }
  res.json({ data: {} });
});

module.exports = router;
