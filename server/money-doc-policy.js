const VALID_STATUS = {
  invoice: new Set(["draft", "pending", "paid"]),
  receipt: new Set(["draft", "received"]),
};

function validateMoneyDocument(input) {
  const docType = String(input.docType || "");
  const status = String(input.status || "");
  const amount = Number(input.amount);
  const paymentMethod = String(input.paymentMethod || "").trim();
  const details = input.details && typeof input.details === "object" && !Array.isArray(input.details)
    ? input.details : {};

  if (!VALID_STATUS[docType]) throw new Error("Document type must be invoice or receipt");
  if (!VALID_STATUS[docType].has(status)) throw new Error(`Invalid ${docType} status`);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Document amount must be greater than zero");
  if (!String(details.agent || "").trim()) throw new Error("Agent name is required");
  if (docType === "receipt" && status !== "draft" && paymentMethod === "Cheque") {
    if (![details.cheque_number, details.cheque_bank, details.cheque_date].every((value) => String(value || "").trim())) {
      throw new Error("Cheque number, bank, and cheque date are required for a cheque receipt");
    }
  }
  return { docType, status, amount, paymentMethod, details };
}

module.exports = { validateMoneyDocument };
