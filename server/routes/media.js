// /api/media — PUBLIC listing image store. Unlike /api/files (token-signed,
// private documents), these images must be fetchable anonymously because the
// property portals (Property Finder / Bayut / Dubizzle) pull them by URL.
// Upload is owner/admin only; GET /raw/:file is intentionally unauthenticated.
const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { authMiddleware, need } = require("../auth");

const MEDIA_DIR = process.env.LISTING_MEDIA_DIR || "/var/www/crm-listing-media";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const NAME_RE = /^[a-f0-9-]+\.(jpg|png|webp|gif)$/i;

// Upload a listing image — owner/admin only. Returns a public raw URL.
router.post("/upload", authMiddleware, upload.single("file"), (req, res) => {
  if (!need(req.user, ["owner", "admin"])) return res.status(403).json({ error: "Not authorized" });
  if (!req.file) return res.status(400).json({ error: "Missing file" });
  const ext = EXT[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: "Only JPG, PNG, WebP or GIF images are allowed" });
  const name = `${crypto.randomUUID()}${ext}`;
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, name), req.file.buffer);
    res.json({ data: { file: name, url: `/api/media/raw/${name}` } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public serve — NO auth (portals fetch these by URL). Name is a UUID+ext, so
// there is no user-controlled path; still validate against traversal.
router.get("/raw/:file", (req, res) => {
  const file = req.params.file;
  if (!NAME_RE.test(file)) return res.status(400).send("Bad name");
  const abs = path.join(MEDIA_DIR, file);
  if (!abs.startsWith(path.resolve(MEDIA_DIR) + path.sep) || !fs.existsSync(abs)) return res.status(404).send("Not found");
  res.sendFile(abs);
});

// Remove — owner/admin.
router.post("/remove", authMiddleware, (req, res) => {
  if (!need(req.user, ["owner", "admin"])) return res.status(403).json({ error: "Not authorized" });
  for (const file of req.body.files || []) {
    if (NAME_RE.test(file)) {
      const abs = path.join(MEDIA_DIR, file);
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
    }
  }
  res.json({ data: {} });
});

module.exports = router;
