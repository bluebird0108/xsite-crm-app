// Explicit write allowlists for the generic /api/db surface. Server-owned
// identity, role, ownership, numbering, and audit fields never pass through.
const INSERT_COLUMNS = {
  deals: ["group_id", "sno", "deal_date", "deal_date_raw", "agent", "agent2", "third_party", "deal_type", "unit", "building", "area", "price", "total_commission", "commission_received", "vat", "commission_ex_vat", "agent_business", "company_share", "agent_share", "payment_method", "tc_start", "tc_start_raw", "contract_duration", "tc_end", "tc_end_raw", "security_deposit", "cheque_count", "cheque_details", "property_use", "landlord", "tenant", "bank", "month"],
  commission_entries: ["group_id", "agent_name", "entry_date", "entry_date_raw", "third_party", "agent2", "deal_type", "unit", "building", "area", "annual_value", "property_use", "total_commission", "received", "vat", "commission_ex_vat", "agent_business", "xsite_share", "agent_share", "month"],
  deal_groups: ["id"],
  cash_position: ["as_at", "label", "amount", "sort_order", "month"],
  cash_movements: ["movement_date", "direction", "channel", "bank_account", "agent_name", "client", "property", "amount", "reference", "month"],
  money_docs: ["doc_type", "deal_group", "doc_date", "client", "description", "amount", "payment_method", "status", "month", "details"],
  staff: ["name", "job", "nationality", "branch", "card_number", "card_expiry", "birthday", "team"],
  agent_requests: ["submitter_name", "request_type", "subject", "deal_group", "details"],
  contacts: ["name", "contact_type", "phone", "email", "notes", "last_contact", "birthday"],
  kyc_forms: ["contact_id", "branch_ref", "status", "data"],
  listings: ["ref_no", "status", "offering_type", "property_type", "title", "description", "price", "rent_period", "bedrooms", "bathrooms", "size_sqft", "city", "community", "sub_community", "tower", "furnishing", "amenities", "photos", "permit_number", "permit_qr_url", "dtcm_permit", "agent_name", "publish_pf", "publish_bayut", "publish_dubizzle", "published_at"],
  contract_files: ["contract_id", "submission_id", "doc_type", "file_name", "storage_path", "size_bytes", "uploaded_by_name"],
  deal_submissions: ["submitted_by_name", "agent_name", "owner_name", "owner_phone", "owner_email", "owner_emirates_id", "tenant_name", "tenant_phone", "tenant_email", "tenant_emirates_id", "building", "unit", "area", "moving_date", "cheque_count", "price", "dewa_number", "notes"],
};

const UPDATE_COLUMNS = {
  deals: INSERT_COLUMNS.deals,
  commission_entries: INSERT_COLUMNS.commission_entries,
  cash_position: INSERT_COLUMNS.cash_position,
  cash_movements: INSERT_COLUMNS.cash_movements,
  money_docs: ["deal_group", "doc_date", "client", "description", "amount", "payment_method", "status", "month", "details"],
  staff: INSERT_COLUMNS.staff,
  agent_requests: ["status", "response", "updated_at"],
  account_tasks: ["status", "money_doc_id", "completed_by", "completed_at"],
  contacts: [...INSERT_COLUMNS.contacts, "updated_at"],
  kyc_forms: [...INSERT_COLUMNS.kyc_forms, "updated_at"],
  listings: [...INSERT_COLUMNS.listings, "updated_at"],
  contract_files: ["contract_id", "submission_id", "doc_type"],
  deal_submissions: [...INSERT_COLUMNS.deal_submissions, "status", "contract_id", "reviewed_by_name", "reviewed_at", "updated_at"],
};

const AGENT_SUBMISSION_UPDATE_COLUMNS = new Set([
  "owner_name", "owner_phone", "owner_email", "owner_emirates_id",
  "tenant_name", "tenant_phone", "tenant_email", "tenant_emirates_id",
  "building", "unit", "area", "moving_date", "cheque_count", "price",
  "dewa_number", "notes", "updated_at",
]);

function sanitizeWrite(table, operation, role, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Write values must be an object");
  }
  let allowed = operation === "insert" ? INSERT_COLUMNS[table] : UPDATE_COLUMNS[table];
  if (operation === "update" && table === "deal_submissions" && role === "agent") {
    allowed = AGENT_SUBMISSION_UPDATE_COLUMNS;
  }
  const set = allowed instanceof Set ? allowed : new Set(allowed || []);
  const keys = Object.keys(input);
  const forbidden = keys.filter((key) => !set.has(key));
  if (forbidden.length) throw new Error(`Columns cannot be ${operation === "insert" ? "inserted" : "updated"}: ${forbidden.join(", ")}`);
  if (!keys.length) throw new Error("No writable values supplied");
  return Object.fromEntries(keys.map((key) => [key, input[key]]));
}

function hasKnownFilter(where, columns) {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  return Object.keys(where).some((key) => columns.has(key));
}

module.exports = { sanitizeWrite, hasKnownFilter };
