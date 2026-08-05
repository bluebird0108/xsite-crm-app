const DOCUMENT_CATEGORIES = new Set([
  "contracts",
  "invoices-receipts",
  "kyc-and-ids",
  "commission-statements",
  "utilities",
  "legal",
  "other",
]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DOCUMENT_KEY_RE = new RegExp(
  `^(?:${[...DOCUMENT_CATEGORIES].join("|")})\\/(?:${UUID}|submissions\\/${UUID})\\/${UUID}-[^/]{1,120}$`,
  "i"
);

function isAllowedDocumentKey(key) {
  return typeof key === "string" && DOCUMENT_KEY_RE.test(key);
}

module.exports = { DOCUMENT_CATEGORIES, isAllowedDocumentKey };
