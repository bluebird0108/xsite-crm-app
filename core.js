const MONTH_LABELS = {
  "01": "January",
  "02": "February",
  "03": "March",
  "04": "April",
  "05": "May",
  "06": "June",
  "07": "July",
  "08": "August",
  "09": "September",
  "10": "October",
  "11": "November",
  "12": "December",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const roundMoney = (value) => Math.round(value * 100) / 100;
const localTodayIso = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
};

export function monthLabel(month) {
  if (!month) return "—";
  const [year, monthNumber] = month.split("-");
  return `${MONTH_LABELS[monthNumber] || monthNumber} ${year}`;
}

export function availableMonths(rows, key = "month") {
  return [...new Set(rows.map((row) => String(row[key] || "").slice(0, 7)).filter(Boolean))].sort().reverse();
}

export function availableDates(rows, key) {
  return [...new Set(rows.map((row) => String(row[key] || "")).filter(Boolean))].sort().reverse();
}

export function calculateDealCommission(totalCommission, commissionReceived, shared = false) {
  const total = Number(totalCommission);
  const received = Number(commissionReceived);
  if (!Number.isFinite(total) || !Number.isFinite(received)) return null;

  const vat = roundMoney(total / 21);
  const commissionExVat = roundMoney(received - vat);
  const agentBusiness = roundMoney(shared ? commissionExVat / 2 : commissionExVat);
  const companyShare = roundMoney(agentBusiness / 2);
  const agentShare = roundMoney(agentBusiness / 2);
  return { vat, commissionExVat, agentBusiness, companyShare, agentShare };
}

// Commission derived from the property price and a rate: 5% residential,
// 10% commercial. price × rate IS the total commission, VAT-inclusive — VAT is
// extracted out of it (total / 21 = the 5% VAT component), NOT added on top.
// Shares are computed from the ex-VAT base, halved again for a shared deal.
export function calculateDealCommissionFromRate(price, ratePercent, shared = false) {
  const p = Number(price);
  const rate = Number(ratePercent);
  if (!Number.isFinite(p) || !Number.isFinite(rate) || p <= 0 || rate <= 0) return null;

  const totalCommission = roundMoney((p * rate) / 100);
  const vat = roundMoney(totalCommission / 21);
  const commissionExVat = roundMoney(totalCommission - vat);
  const agentBusiness = roundMoney(shared ? commissionExVat / 2 : commissionExVat);
  const companyShare = roundMoney(agentBusiness / 2);
  const agentShare = roundMoney(agentBusiness / 2);
  return { totalCommission, vat, commissionExVat, agentBusiness, companyShare, agentShare };
}

export function calculateContractEnd(startIso, durationMonths) {
  if (!ISO_DATE.test(startIso || "")) return "";
  const months = Number.parseInt(durationMonths, 10);
  if (!Number.isFinite(months) || months <= 0) return "";

  const [year, month, day] = startIso.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const endExclusive = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)));
  endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
  return endExclusive.toISOString().slice(0, 10);
}

export function getStaffPermitStatus(expiryIso, todayIso = localTodayIso()) {
  if (!ISO_DATE.test(expiryIso || "") || !ISO_DATE.test(todayIso || "")) {
    return { status: "missing", days: null };
  }
  const expiry = Date.parse(`${expiryIso}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const days = Math.round((expiry - today) / 86_400_000);
  if (days < 0) return { status: "expired", days };
  if (days <= 60) return { status: "expiring", days };
  return { status: "valid", days };
}

export function renewalStatus(endIso, todayIso = localTodayIso()) {
  if (!ISO_DATE.test(endIso || "") || !ISO_DATE.test(todayIso || "")) {
    return { status: "missing", days: null };
  }
  const end = Date.parse(`${endIso}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const days = Math.round((end - today) / 86_400_000);
  if (days < 0) return { status: "expired", days };
  if (days <= 90) return { status: "due", days };
  return { status: "upcoming", days };
}

function safeCsvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(rows, columns) {
  const header = columns.map(([label]) => safeCsvCell(label)).join(",");
  const body = rows.map((row) => columns.map(([, key]) => safeCsvCell(row[key])).join(","));
  return [header, ...body].join("\r\n");
}
