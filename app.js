import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import {
  availableDates,
  availableMonths,
  calculateContractEnd,
  calculateDealCommission,
  getStaffPermitStatus,
  monthLabel,
  renewalStatus,
  toCsv,
} from "./core.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById("root");

const state = {
  profile: null,
  fatalError: null,
  screen: "dashboard",
  authMode: "signin",
  agents: [], deals: [], commission: [], cash: [], team: [], docs: [], staff: [], requests: [], contracts: [], accountTasks: [],
  contacts: [], cashMovements: [],
  selectedAgent: null,
  txQuery: "", txType: "All", ledgerQuery: "",
  txMonth: null, ledgerMonth: null,
  invMonth: null, invType: "All", invQuery: "",
  cashDate: null,
  staffQuery: "", staffBranch: "All", requestStatus: "All",
  contactQuery: "", contactType: "All",
  cbMonth: null, cbChannel: "All", cbQuery: "",
  dashQuery: "", activityDay: null,
  dealForm: null, pwForm: false, docForm: null, cashForm: null, requestForm: null,
  contractForm: null, printContract: null, printInvoice: null,
  contactForm: null, cashMoveForm: null,
};

// ── helpers ──────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => n === null || n === undefined ? "—" : "AED " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const isoRe = /^\d{4}-\d{2}-\d{2}$/;
function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}
function showDate(iso, raw) {
  if (iso && isoRe.test(iso)) { const p = iso.split("-"); return `${p[2]}-${MONTHS[+p[1]-1]}-${p[0].slice(2)}`; }
  return raw || "—";
}
const roleIn = (...r) => r.includes(state.profile?.role);

// Xsite company + bank constants for tax invoices (from the official invoice format)
const XSITE_CO = {
  name: "XSITE REAL ESTATE BROKERS L.L.C",
  addressLines: ["Address : Prime Business Center B", "Office No.B1304, Al Barsha South Fourth,", "Dubai, United Arab Emirates"],
  trn: "TRN No:105165988400003",
  email: "Email : accounts@xsite.ae",
  bank: [
    ["Account Name", "XSITE REAL ESTATE BROKERS L.L.C"],
    ["Account Number", "019101014764"],
    ["IBAN Number", "AE680330000019101014764"],
    ["SWIFT Code", "BOMLAEAD"],
    ["Bank Name", "Mashreq Bank"],
    ["Branch Name", "NIOBIZ"],
  ],
  registered: "Registered Office: Xsite Real Estate Brokers, Prime Business Center B, Office No.B1304, Al Barsha South Fourth, Dubai, United Arab Emirates.",
};
const num2 = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}
function clearSensitiveState() {
  state.profile = null;
  state.agents = []; state.deals = []; state.commission = []; state.cash = [];
  state.team = []; state.docs = []; state.staff = []; state.requests = [];
  state.contracts = []; state.accountTasks = [];
  state.contacts = []; state.cashMovements = [];
  state.dealForm = null; state.pwForm = false; state.docForm = null;
  state.cashForm = null; state.requestForm = null; state.contractForm = null; state.printContract = null;
  state.contactForm = null; state.cashMoveForm = null;
}
const COLUMNS = {
  agents: "id,name,role,month,agent_business_including_vat",
  deals: "id,group_id,sno,deal_date,deal_date_raw,agent,agent2,third_party,deal_type,unit,building,area,price,total_commission,commission_received,vat,commission_ex_vat,agent_business,company_share,agent_share,payment_method,tc_start,tc_start_raw,contract_duration,tc_end,tc_end_raw,security_deposit,cheque_count,landlord,tenant,bank,month",
  commission_entries: "id,group_id,agent_name,entry_date,entry_date_raw,third_party,agent2,deal_type,unit,building,area,annual_value,total_commission,received,vat,commission_ex_vat,agent_business,xsite_share,agent_share,month",
  cash_position: "id,as_at,label,amount,sort_order,month",
  profiles: "id,full_name,email,role,agent_name,created_at",
  money_docs: "id,doc_type,doc_no,deal_group,doc_date,client,description,amount,payment_method,status,month,details",
  staff: "id,name,job,nationality,branch,card_number,card_expiry,birthday",
  agent_requests: "id,created_by,submitter_name,request_type,subject,deal_group,details,status,response,created_at,updated_at",
  contracts: "id,contract_no,deal_group,status,contract_date,start_date,end_date,landlord_name,tenant_name,owner_phone,tenant_phone,annual_rent,security_deposit,payment_mode,additional_terms,details,addendum,ejari_status,created_by,finalized_by,finalized_at,created_at,updated_at",
  account_tasks: "id,contract_id,task_type,status,money_doc_id,completed_by,completed_at,created_at",
  contacts: "id,name,contact_type,phone,email,notes,last_contact,birthday,created_by,created_at,updated_at",
  cash_movements: "id,movement_date,direction,channel,bank_account,agent_name,client,property,amount,reference,month,created_by,created_at",
};
async function fetchAll(table, orderColumn, ascending = true, columns = COLUMNS[table]) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await supabase.from(table).select(columns).order(orderColumn, { ascending }).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) break;
  }
  return { data: rows, error: null };
}
// Some columns (ejari_status, staff.birthday) are added by the feature-merge
// migration. Load with them, but fall back to the base column set if the
// migration has not been applied yet, so contracts/staff still load.
const OPTIONAL_COLUMNS = { contracts: ["ejari_status"], staff: ["birthday"], contacts: ["birthday"] };
async function fetchAllOptional(table, orderColumn, ascending = true) {
  try { return await fetchAll(table, orderColumn, ascending); }
  catch (error) {
    const optional = OPTIONAL_COLUMNS[table] || [];
    if (!/column .* does not exist/i.test(error.message) && !optional.some((c) => error.message.includes(c))) throw error;
    const base = COLUMNS[table].split(",").filter((c) => !optional.includes(c)).join(",");
    console.warn(`[xsite] ${table}: migration columns not applied yet — loading base fields.`);
    return await fetchAll(table, orderColumn, ascending, base);
  }
}
// Non-fatal fetch for features whose backend migration may not be applied yet
// (contacts, cash_movements). A missing table/column degrades the feature to
// empty instead of breaking the whole workspace load.
async function fetchAllSafe(table, orderColumn, ascending = true, optionalColumns = false) {
  try { return optionalColumns ? await fetchAllOptional(table, orderColumn, ascending) : await fetchAll(table, orderColumn, ascending); }
  catch (error) { console.warn(`[xsite] ${table} unavailable — feature disabled until migration is applied:`, error.message); return { data: [] }; }
}
function downloadCsv(filename, rows, columns) {
  const blob = new Blob(["\uFEFF", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

// ── data ─────────────────────────────────────────────────
async function loadData() {
  state.fatalError = null;
  if (roleIn("pending")) {
    state.agents = []; state.deals = []; state.commission = []; state.cash = [];
    state.team = []; state.docs = []; state.staff = []; state.requests = [];
    state.contracts = []; state.accountTasks = [];
    state.contacts = []; state.cashMovements = [];
    return;
  }
  const [ag, dl, cm, ch, tm, md, sf, rq, ct, at, co, mv] = await Promise.all([
    fetchAll("agents", "name"),
    fetchAll("deals", "sno"),
    fetchAll("commission_entries", "agent_name"),
    roleIn("owner", "accounts", "admin") ? fetchAll("cash_position", "sort_order") : Promise.resolve({ data: [] }),
    roleIn("owner", "admin") ? fetchAll("profiles", "created_at") : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? fetchAll("money_docs", "doc_no") : Promise.resolve({ data: [] }),
    roleIn("owner", "admin") ? fetchAllOptional("staff", "name") : Promise.resolve({ data: [] }),
    fetchAll("agent_requests", "created_at", false),
    fetchAllOptional("contracts", "created_at", false),
    roleIn("owner", "accounts", "admin") ? fetchAll("account_tasks", "created_at", false) : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? fetchAllSafe("contacts", "name", true, true) : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? fetchAllSafe("cash_movements", "movement_date", false) : Promise.resolve({ data: [] }),
  ]);
  state.agents = requireData(ag, "Could not load agents");
  state.deals = requireData(dl, "Could not load deals");
  state.commission = requireData(cm, "Could not load commission entries");
  state.cash = requireData(ch, "Could not load cash position");
  state.team = requireData(tm, "Could not load team profiles");
  state.docs = requireData(md, "Could not load invoices and receipts");
  state.staff = requireData(sf, "Could not load staff directory");
  state.requests = requireData(rq, "Could not load agent requests");
  state.contracts = requireData(ct, "Could not load contracts");
  state.accountTasks = requireData(at, "Could not load Accounts tasks");
  state.contacts = requireData(co, "Could not load contacts");
  state.cashMovements = requireData(mv, "Could not load cash and bank movements");
  const cbmonths = availableMonths(state.cashMovements, "month");
  if (!state.cbMonth || !cbmonths.includes(state.cbMonth)) state.cbMonth = cbmonths[0] || null;
  const months = availableMonths(state.deals, "month");
  if (!state.txMonth || !months.includes(state.txMonth)) state.txMonth = months[0] || null;
  const lmonths = availableMonths(state.commission, "month");
  if (!state.ledgerMonth || !lmonths.includes(state.ledgerMonth)) state.ledgerMonth = lmonths[0] || null;
  const imonths = availableMonths(state.docs, "month");
  if (!state.invMonth || !imonths.includes(state.invMonth)) state.invMonth = imonths[0] || months[0] || null;
  const cdates = availableDates(state.cash, "as_at");
  if (!state.cashDate || !cdates.includes(state.cashDate)) state.cashDate = cdates[0] || null;
}

async function reloadDeals() {
  const [dl, cm] = await Promise.all([
    fetchAll("deals", "sno"),
    fetchAll("commission_entries", "agent_name"),
  ]);
  state.deals = requireData(dl, "Could not reload deals");
  state.commission = requireData(cm, "Could not reload commission entries");
}

async function reloadDocs() {
  const result = await fetchAll("money_docs", "doc_no");
  state.docs = requireData(result, "Could not reload invoices and receipts");
}

async function reloadCash() {
  const result = await fetchAll("cash_position", "sort_order");
  state.cash = requireData(result, "Could not reload cash position");
  const cdates = availableDates(state.cash, "as_at");
  state.cashDate = cdates[0] || null;
}

async function reloadRequests() {
  const result = await fetchAll("agent_requests", "created_at", false);
  state.requests = requireData(result, "Could not reload agent requests");
}

async function reloadContacts() {
  const result = await fetchAll("contacts", "name");
  state.contacts = requireData(result, "Could not reload contacts");
}

async function reloadCashMovements() {
  const result = await fetchAll("cash_movements", "movement_date", false);
  state.cashMovements = requireData(result, "Could not reload cash and bank movements");
  const cbmonths = availableMonths(state.cashMovements, "month");
  if (!state.cbMonth || !cbmonths.includes(state.cbMonth)) state.cbMonth = cbmonths[0] || null;
}

async function reloadContracts() {
  const [contracts, tasks, docs] = await Promise.all([
    fetchAllOptional("contracts", "created_at", false),
    roleIn("owner", "accounts", "admin") ? fetchAll("account_tasks", "created_at", false) : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? fetchAll("money_docs", "doc_no") : Promise.resolve({ data: [] }),
  ]);
  state.contracts = requireData(contracts, "Could not reload contracts");
  state.accountTasks = requireData(tasks, "Could not reload Accounts tasks");
  state.docs = requireData(docs, "Could not reload invoices and receipts");
}

async function reloadAfterWrite(reload, label) {
  try { await reload(); return true; }
  catch (error) {
    state.fatalError = `${label} was saved, but the refreshed data could not be loaded: ${error.message}`;
    render();
    return false;
  }
}

// ── auth ─────────────────────────────────────────────────
async function resolveProfile(session) {
  if (!session) { state.profile = null; return; }
  const result = await supabase.from("profiles").select("role, agent_name, full_name").eq("id", session.user.id).maybeSingle();
  if (result.error) throw new Error(`Could not load your profile: ${result.error.message}`);
  const data = result.data;
  state.profile = data ? { ...data, id: session.user.id, email: session.user.email }
    : { id: session.user.id, role: "pending", agent_name: null, full_name: "", email: session.user.email };
}

async function boot() {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) state.fatalError = `Could not restore your session: ${sessionResult.error.message}`;
  const session = sessionResult.data?.session;
  if (session) {
    try { await resolveProfile(session); await loadData(); }
    catch (error) { state.fatalError = error.message; }
  }
  render();
  supabase.auth.onAuthStateChange(async (_e, s) => {
    if (s && !state.profile) {
      try { await resolveProfile(s); await loadData(); }
      catch (error) { state.fatalError = error.message; }
      render();
    }
    if (!s && state.profile) { clearSensitiveState(); render(); }
  });
}

// ── render: login ────────────────────────────────────────
function renderLogin(msg) {
  root.innerHTML = `
  <div class="login-shell">
    <div class="login-panel">
      <div class="login-brand">
        <img class="login-logo" src="./xsite-logo.png" alt="Xsite Real Estate Brokers">
        <p class="login-brand-note">Real Estate Operations</p>
      </div>
      <div class="login-access">
        <span class="login-kicker">Private business system</span>
        <h1 class="login-title">${state.authMode === "signup" ? "Create account" : "Sign in"}</h1>
        <p class="login-intro">${state.authMode === "signup"
          ? "Register with your work email. The owner approves your access and assigns your role."
          : "Sign in with your work email and password."}</p>
        ${state.authMode === "signup" ? `
        <div class="login-field" style="margin-bottom:14px">
          <label for="fullname">Full name</label>
          <input class="input" id="fullname" type="text" autocomplete="name" placeholder="Your full name">
        </div>` : ""}
        <div class="login-field">
          <label for="email">Work email</label>
          <input class="input" id="email" type="email" autocomplete="email" placeholder="you@xsite.example">
        </div>
        <div class="login-field" style="margin-top:14px">
          <label for="password">Password</label>
          <input class="input" id="password" type="password" autocomplete="${state.authMode === "signup" ? "new-password" : "current-password"}" placeholder="${state.authMode === "signup" ? "Choose a password (min 8 characters)" : "Your password"}">
        </div>
        <div class="login-actions">
          <button class="btn btn-primary" id="authgo" style="width:100%">${state.authMode === "signup" ? "Create account" : "Sign in"}</button>
        </div>
        <p class="login-msg" style="margin-top:14px">
          ${state.authMode === "signup"
            ? `Already registered? <a id="switchmode" style="cursor:pointer">Sign in</a>`
            : `New team member? <a id="switchmode" style="cursor:pointer">Create your account</a> · <a id="send" style="cursor:pointer">Email me a sign-in link</a>`}
        </p>
        <p class="login-msg ${msg ? msg.kind : ""}" id="msg">${msg ? esc(msg.text) : ""}</p>
        <p class="login-security-note">Authorized Xsite personnel only · Dubai, UAE</p>
      </div>
    </div>
  </div>`;
  document.getElementById("authgo").onclick = state.authMode === "signup" ? signUp : signInPassword;
  document.getElementById("switchmode").onclick = () => { state.authMode = state.authMode === "signup" ? "signin" : "signup"; renderLogin(); };
  const send = document.getElementById("send");
  if (send) send.onclick = sendLink;
  document.getElementById("password").addEventListener("keydown", (e) => { if (e.key === "Enter") (state.authMode === "signup" ? signUp : signInPassword)(); });
  if (msg && msg.email) document.getElementById("email").value = msg.email;
}

async function signInPassword() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) { renderLogin({ kind: "is-error", text: "Enter your email and password.", email }); return; }
  const btn = document.getElementById("authgo"); btn.disabled = true; btn.textContent = "Signing in…";
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { renderLogin({ kind: "is-error", text: error.message, email }); return; }
  try { await resolveProfile(data.session); await loadData(); }
  catch (loadError) { state.fatalError = loadError.message; }
  render();
}

async function signUp() {
  const fullName = document.getElementById("fullname").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!fullName || !email || !password) { renderLogin({ kind: "is-error", text: "Enter your name, email, and a password.", email }); return; }
  if (password.length < 8) { renderLogin({ kind: "is-error", text: "Password must be at least 8 characters.", email }); return; }
  const btn = document.getElementById("authgo"); btn.disabled = true; btn.textContent = "Creating account…";
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) { renderLogin({ kind: "is-error", text: error.message, email }); return; }
  if (data.session) {
    try { await resolveProfile(data.session); await loadData(); }
    catch (loadError) { state.fatalError = loadError.message; }
    render();
  }
  else {
    state.authMode = "signin";
    renderLogin({ kind: "is-ok", text: "Account created. Confirm via the email we sent, then sign in.", email });
  }
}

async function sendLink() {
  const email = document.getElementById("email").value.trim();
  if (!email) { renderLogin({ kind: "is-error", text: "Enter your work email first." }); return; }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) { renderLogin({ kind: "is-error", text: error.message, email }); }
  else { renderLogin({ kind: "is-ok", text: "Check your email for the sign-in link.", email }); }
}

// ── render: app shell ────────────────────────────────────
function navLink(screen, label) {
  return `<a data-screen="${screen}" class="${state.screen === screen ? "is-active" : ""}">${label}</a>`;
}
function renderApp() {
  const p = state.profile;
  const showTeam = roleIn("owner", "admin");
  const pendingTeam = state.team.filter((t) => t.role === "pending").length;
  const pendingRequests = state.requests.filter((request) => request.status === "pending").length;
  const pendingAccountTasks = state.accountTasks.filter((task) => task.status === "pending").length;
  const renewalAlerts = state.contracts.filter((contract) => contract.status === "final" && ["due", "expired"].includes(renewalStatus(contract.end_date).status)).length;
  const contractAlerts = pendingAccountTasks + renewalAlerts;
  const nav = `
  <nav class="nav">
    <div class="nav-brand"><img src="./xsite-logo.png" alt="Xsite"></div>
    ${roleIn("owner", "accounts", "admin") ? navLink("dashboard", "Dashboard") : ""}
    ${roleIn("owner") ? navLink("activity", "Team Activity") : ""}
    ${roleIn("owner", "admin") ? navLink("contracts", contractAlerts ? `Contracts (${contractAlerts})` : "Contracts") : ""}
    ${roleIn("owner", "admin") ? navLink("contacts", "Contacts") : ""}
    ${roleIn("owner", "accounts") ? navLink("transactions", "Transactions") : ""}
    ${roleIn("owner", "accounts") ? navLink("invoices", "Invoices & Receipts") : ""}
    ${roleIn("owner", "accounts") ? navLink("cashbank", "Cash & Bank") : ""}
    ${roleIn("owner", "accounts", "agent") ? navLink("ledgers", roleIn("agent") ? "My Ledger" : "Agent Ledgers") : ""}
    ${roleIn("pending") ? "" : navLink("requests", pendingRequests ? `Requests (${pendingRequests})` : "Requests")}
    ${roleIn("owner", "admin") ? navLink("staff", "Staff") : ""}
    ${showTeam ? navLink("team", pendingTeam ? `Team (${pendingTeam})` : "Team") : ""}
    <div class="nav-right">
      <span class="tag tag-neutral">${esc(p.role)}</span>
      <span class="text-muted" style="font-size:13px">${esc(p.full_name || p.email)}</span>
      <a id="pwopen">Password</a>
      <a id="logout">Log out</a>
    </div>
  </nav>`;
  let body = "";
  if (state.fatalError) body = viewFatalError();
  else if (roleIn("pending")) body = viewPending();
  else if (state.screen === "activity" && roleIn("owner")) body = viewTeamActivity();
  else if (state.screen === "contacts" && roleIn("owner", "admin")) body = viewContacts();
  else if (state.screen === "transactions" && roleIn("owner", "accounts")) body = viewTransactions();
  else if (state.screen === "contracts" && roleIn("owner", "admin")) body = viewContracts();
  else if (state.screen === "invoices" && roleIn("owner", "accounts")) body = viewInvoices();
  else if (state.screen === "cashbank" && roleIn("owner", "accounts")) body = viewCashBank();
  else if (state.screen === "ledgers" && roleIn("owner", "accounts", "agent")) body = viewLedgers();
  else if (state.screen === "requests") body = viewRequests();
  else if (state.screen === "staff" && roleIn("owner", "admin")) body = viewStaff();
  else if (state.screen === "team" && showTeam) body = viewTeam();
  else if (roleIn("agent")) body = viewLedgers();
  else body = viewDashboard();
  root.innerHTML = nav + `<main>${body}</main>` + viewDealModal() + viewPwModal() + viewDocModal() + viewCashModal() + viewRequestModal() + viewContractModal() + viewContractPrint() + viewInvoicePrint() + viewContactModal() + viewCashMoveModal();
  root.querySelectorAll("[data-screen]").forEach((a) => a.onclick = () => { state.screen = a.dataset.screen; render(); });
  document.getElementById("logout").onclick = async () => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch {}
    clearSensitiveState(); render();
  };
  const refreshAccess = document.getElementById("refreshaccess");
  if (refreshAccess) refreshAccess.onclick = async () => {
    refreshAccess.disabled = true; refreshAccess.textContent = "Checking…";
    const sessionResult = await supabase.auth.getSession();
    try {
      if (sessionResult.error || !sessionResult.data?.session) throw new Error(sessionResult.error?.message || "Session expired");
      await resolveProfile(sessionResult.data.session); await loadData(); render();
    } catch (error) { state.fatalError = error.message; render(); }
  };
  wireScreen();
}

// ── expiry tiers (client-side, live vs today) ────────────
function expiryTiers() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const seen = new Set(); const all = [];
  for (const d of state.deals) {
    if (!d.tc_end || !isoRe.test(d.tc_end)) continue;
    const key = [d.unit, d.building, d.tc_end, d.tenant].join("|");
    if (seen.has(key)) continue; seen.add(key);
    const days = Math.round((new Date(d.tc_end + "T00:00:00") - today) / 86400000);
    if (days > 90) continue;
    all.push({ unit: d.unit, building: d.building, tenant: d.tenant || "—", landlord: d.landlord || "—",
      agent: d.agent, endLabel: showDate(d.tc_end), days,
      daysLabel: days < 0 ? Math.abs(days) + " days overdue" : (days === 0 ? "today" : "in " + days + " days"),
      daysClass: days < 0 ? "expiry-days is-overdue" : "expiry-days" });
  }
  all.sort((a, b) => a.days - b.days);
  return [
    { title: "Expired", hint: "End date already passed", items: all.filter((x) => x.days < 0) },
    { title: "Within 30 days", hint: "Renewal action needed now", items: all.filter((x) => x.days >= 0 && x.days <= 30) },
    { title: "31–60 days", hint: "Prepare renewal offers", items: all.filter((x) => x.days > 30 && x.days <= 60) },
    { title: "61–90 days", hint: "Upcoming renewal pipeline", items: all.filter((x) => x.days > 60 && x.days <= 90) },
  ];
}

// ── view: fatal data error ────────────────────────────────
function viewFatalError() {
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">Connection problem</span><h1 style="margin-top:4px">The CRM data could not be loaded</h1>
      <p class="text-muted" style="margin:0">${esc(state.fatalError)}</p></div>
    </header>
    <div class="md-empty"><button class="btn btn-primary" id="retryload">Try again</button></div>
  </div>`;
}

// ── view: pending approval ────────────────────────────────
function viewPending() {
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">Account created</span><h1 style="margin-top:4px">Awaiting approval</h1>
      <p class="text-muted" style="margin:0">Your account is registered. The owner will approve your access and assign your role — check back soon.</p></div>
    </header>
    <div class="md-empty">Nothing to show yet. Once approved, check your access to load the workspace.<br><br>
      <button class="btn btn-primary" id="refreshaccess">Check access</button>
    </div>
  </div>`;
}

// ── view: staff directory (owner + admin) ────────────────
function viewStaff() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const permitStatus = (staff) => getStaffPermitStatus(staff.card_expiry, todayIso);
  const q = state.staffQuery.trim().toLowerCase();
  const branches = ["All", ...[...new Set(state.staff.map((s) => s.branch).filter(Boolean))].sort()];
  const branchTabs = branches.map((b) =>
    `<button class="tab ${state.staffBranch === b ? "is-active" : ""}" data-staffbranch="${esc(b)}">${esc(b)}${b === "All" ? ` (${state.staff.length})` : ""}</button>`).join("");
  const rows = state.staff.filter((s) =>
    (state.staffBranch === "All" || s.branch === state.staffBranch) &&
    (!q || [s.name, s.job, s.nationality, s.card_number].join(" ").toLowerCase().includes(q)));
  const expired = state.staff.filter((s) => permitStatus(s).status === "expired");
  const expiringSoon = state.staff.filter((s) => permitStatus(s).status === "expiring");
  const attention = [...expired, ...expiringSoon].sort((a, b) => a.card_expiry.localeCompare(b.card_expiry));
  const body = rows.map((s) => {
    const permit = permitStatus(s);
    const expClass = permit.status === "expired" ? "expiry-days is-overdue" : permit.status === "expiring" ? "expiry-days" : "";
    const expLabel = permit.status === "missing" ? "—" : permit.status === "expired"
      ? `${showDate(s.card_expiry)} · ${Math.abs(permit.days)}d overdue`
      : permit.status === "expiring" ? `${showDate(s.card_expiry)} · ${permit.days}d` : showDate(s.card_expiry);
    return `<tr>
      <td>${esc(s.name)}</td><td>${esc(s.job || "—")}</td><td>${esc(s.nationality || "—")}</td>
      <td>${esc(s.branch || "—")}</td><td>${esc(s.card_number || "—")}</td>
      <td><span class="${expClass}">${esc(expLabel)}</span></td>
      <td>${s.birthday && isoRe.test(s.birthday) ? esc(showDate(s.birthday)) : "—"}</td></tr>`;
  }).join("");
  return `
  <div>
    <div style="margin-bottom:20px"><span class="card-kicker">Owner / HR</span><h1 style="margin-top:4px">Staff Directory</h1><p class="text-muted" style="margin:0">${state.staff.length} employees across Main and Branch offices.</p></div>
    ${attention.length ? `
    <section class="md-section" style="margin-bottom:20px">
      <div class="md-section-header"><h3>Work permits requiring attention</h3><span class="tag tag-accent">${expired.length} expired · ${expiringSoon.length} within 60 days</span></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Job</th><th>Branch</th><th>Card no</th><th>Expiry</th></tr></thead><tbody>
        ${attention.map((s)=>{const permit=permitStatus(s);return `<tr><td>${esc(s.name)}</td><td>${esc(s.job||"—")}</td><td>${esc(s.branch)}</td><td>${esc(s.card_number)}</td><td><span class="${permit.status === "expired" ? "expiry-days is-overdue" : "expiry-days"}">${showDate(s.card_expiry)} · ${permit.status === "expired" ? Math.abs(permit.days)+"d overdue" : permit.days+"d"}</span></td></tr>`;}).join("")}
      </tbody></table></div>
    </section>` : ""}
    <div class="tx-toolbar">
      <div class="tabs">${branchTabs}</div>
      <input class="input" id="staffq" type="search" placeholder="Search name, job, nationality, card no…" value="${esc(state.staffQuery)}">
      <span class="text-muted" style="font-size:12px">${rows.length} shown</span>
    </div>
    <div class="sheet">
      <div class="sheet-hint">Full roster — from official labour work-permit lists</div>
      <div class="table-wrap"><table class="grid" style="min-width:900px">
        <thead><tr><th>Name</th><th>Job</th><th>Nationality</th><th>Branch</th><th>Work-permit card</th><th>Card expiry</th><th>Birthday</th></tr></thead>
        <tbody>${body || `<tr><td colspan="7"><div class="md-empty" style="border:0">No employees match.</div></td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
}

// ── view: agent requests (Stage 4) ───────────────────────
function requestTypeLabel(type) {
  return ({ deal_correction: "Deal correction", commission_query: "Commission query", document_request: "Document request",
    salary_advance: "Salary / cash advance", leave_request: "Leave request", commission_payout: "Commission payout", other: "Other" })[type] || type;
}

function requestStatusLabel(status) {
  return status === "in_review" ? "In review" : status.charAt(0).toUpperCase() + status.slice(1);
}

// Money requests (salary, advance, payout, commission queries) are reviewed by
// Accounts; leave and document requests by Admin. Owner can action anything.
const MONEY_REQUESTS = ["salary_advance", "commission_payout", "commission_query", "deal_correction"];
function canReviewRequest(request) {
  if (roleIn("owner")) return true;
  if (roleIn("accounts")) return MONEY_REQUESTS.includes(request.request_type);
  if (roleIn("admin")) return !MONEY_REQUESTS.includes(request.request_type);
  return false;
}
function viewRequests() {
  const canSubmit = roleIn("agent");
  const canReview = roleIn("owner", "accounts", "admin");
  const statuses = ["All", "pending", "in_review", "resolved", "rejected"];
  const tabs = statuses.map((status) => `<button class="tab ${state.requestStatus === status ? "is-active" : ""}" data-requeststatus="${status}">${status === "All" ? "All" : requestStatusLabel(status)}</button>`).join("");
  const rows = state.requests.filter((request) => state.requestStatus === "All" || request.status === state.requestStatus);
  const body = rows.map((request) => {
    const date = new Date(request.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const deal = request.deal_group ? dealLabelFor(request.deal_group) : "—";
    const action = canReviewRequest(request) ? `<div data-requestrow="${request.id}" style="display:grid;gap:6px;min-width:220px">
      <select class="input" data-request-state style="padding:6px 8px">
        ${["pending","in_review","resolved","rejected"].map((status) => `<option value="${status}" ${status === request.status ? "selected" : ""}>${requestStatusLabel(status)}</option>`).join("")}
      </select>
      <textarea class="input" data-request-response rows="2" maxlength="4000" placeholder="Response to agent">${esc(request.response || "")}</textarea>
      <button class="btn btn-primary btn-mini" data-saverequest>Save update</button>
    </div>` : esc(request.response || "—");
    return `<tr>
      <td>${esc(date)}</td><td>${esc(request.submitter_name)}</td><td>${esc(requestTypeLabel(request.request_type))}</td>
      <td><strong>${esc(request.subject)}</strong><br><span class="text-muted" style="white-space:pre-wrap">${esc(request.details)}</span></td>
      <td>${esc(deal)}</td><td><span class="tag ${request.status === "pending" ? "tag-accent" : "tag-neutral"}">${esc(requestStatusLabel(request.status))}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Operations / Requests</span><h1 style="margin-top:4px">${canSubmit ? "My Requests" : "Agent Requests"}</h1><p class="text-muted" style="margin:0">Deal corrections, salary advances, leave, commission payouts, and document requests.</p></div>
      ${canSubmit ? `<button class="btn btn-primary" id="newrequest">+ New request</button>` : ""}
    </div>
    <div class="tx-toolbar"><div class="tabs">${tabs}</div><span class="text-muted" style="font-size:12px">${rows.length} requests</span></div>
    <div class="sheet"><div class="sheet-hint">Requests are private to the submitting agent and the operations team</div>
      <div class="table-wrap"><table class="grid" style="min-width:1050px">
        <thead><tr><th>Date</th><th>Submitted by</th><th>Type</th><th>Request</th><th>Related deal</th><th>Status</th><th>${canReview ? "Workflow / response" : "Response"}</th></tr></thead>
        <tbody>${body || `<tr><td colspan="7"><div class="md-empty" style="border:0">No requests match this status.</div></td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
}

function viewRequestModal() {
  const f = state.requestForm;
  if (!f) return "";
  const opts = dealGroupOptions();
  const dealList = `<datalist id="requestdeals">${opts.map((option) => `<option value="${esc(option.label)}">`).join("")}</datalist>`;
  return `<div class="modal-backdrop">
    <div class="modal" style="width:min(640px,100%)" role="dialog" aria-labelledby="requesttitle">
      <div class="modal-head"><h3 id="requesttitle">New request</h3><button class="modal-close" id="requestclose" aria-label="Close">×</button></div>
      <div class="modal-body">${dealList}
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="r_type">Type</label><select class="input" id="r_type">
            <option value="deal_correction">Deal correction</option><option value="commission_query">Commission query</option>
            <option value="document_request">Document request</option><option value="salary_advance">Salary / cash advance</option>
            <option value="leave_request">Leave request</option><option value="commission_payout">Commission payout</option><option value="other">Other</option>
          </select></div>
          <div class="field"><label for="r_deal">Related deal (optional)</label><input class="input" id="r_deal" list="requestdeals" placeholder="Type to search your deals"></div>
          <div class="field" style="grid-column:1/-1"><label for="r_subject">Subject</label><input class="input" id="r_subject" maxlength="160" placeholder="Short summary"></div>
          <div class="field" style="grid-column:1/-1"><label for="r_details">Details</label><textarea class="input" id="r_details" rows="6" maxlength="4000" placeholder="Explain exactly what needs attention"></textarea></div>
        </div>
        <div class="modal-actions"><span class="form-msg" id="requestmsg">${esc(f.msg || "")}</span><button class="btn btn-secondary" id="requestcancel">Cancel</button><button class="btn btn-primary" id="requestsave">Submit request</button></div>
      </div>
    </div>
  </div>`;
}

async function saveRequest() {
  const requestType = document.getElementById("r_type").value;
  const dealLabel = document.getElementById("r_deal").value.trim();
  const subject = document.getElementById("r_subject").value.trim();
  const details = document.getElementById("r_details").value.trim();
  const msg = document.getElementById("requestmsg");
  const deal = dealLabel ? dealGroupOptions().find((option) => option.label === dealLabel) : null;
  if (dealLabel && !deal) { msg.textContent = "Choose a related deal from the list, or leave it blank."; return; }
  if (subject.length < 3 || details.length < 3) { msg.textContent = "Subject and details must each be at least 3 characters."; return; }
  const button = document.getElementById("requestsave"); button.disabled = true; button.textContent = "Submitting…";
  const result = await supabase.from("agent_requests").insert({
    request_type: requestType, subject, details, deal_group: deal?.group || null,
  });
  if (result.error) { msg.textContent = result.error.message; button.disabled = false; button.textContent = "Submit request"; return; }
  if (!await reloadAfterWrite(reloadRequests, "Request")) return;
  state.requestForm = null; state.requestStatus = "All"; render();
}

async function saveRequestReview(container) {
  const id = container.dataset.requestrow;
  const status = container.querySelector("[data-request-state]").value;
  const response = container.querySelector("[data-request-response]").value.trim() || null;
  const button = container.querySelector("[data-saverequest]"); button.disabled = true; button.textContent = "Saving…";
  const current = state.requests.find((request) => request.id === id);
  const result = await supabase.rpc("review_agent_request", {
    p_id: id,
    p_status: status,
    p_response: response,
    p_expected_updated_at: current?.updated_at,
  });
  if (result.error) { window.alert("Could not update request: " + result.error.message); button.disabled = false; button.textContent = "Save update"; return; }
  if (!await reloadAfterWrite(reloadRequests, "Request update")) return;
  render();
}

// ── view: tenancy contracts, addenda, renewals, Accounts tasks ──
function contractDraftFromDeal(deal) {
  return {
    id: null, deal_group: deal?.group_id || "", status: "draft",
    contract_date: todayIso(), start_date: deal?.tc_start || "", end_date: deal?.tc_end || "",
    landlord_name: deal?.landlord || "", tenant_name: deal?.tenant || "", owner_phone: "", tenant_phone: "",
    annual_rent: deal?.price || "", security_deposit: deal?.security_deposit || 0,
    payment_mode: deal?.cheque_count ? `${deal.cheque_count} cheque(s)` : (deal?.payment_method || ""), additional_terms: "",
    details: { lessorName: deal?.landlord || "", lessorEmiratesId: "", lessorEmail: "", lessorLicenseNo: "", lessorLicensingAuthority: "",
      tenantEmiratesId: "", tenantEmail: "", tenantLicenseNo: "", tenantLicensingAuthority: "", plotNo: "", makaniNo: "",
      buildingName: deal?.building || "", propertyNo: deal?.unit || "", propertyType: "Residential", contractValue: deal?.price || "", unitType: "", propertyArea: "", location: deal?.area || "", premisesNo: "" },
    addendum: { furnishing: "UNFURNISHED", premises: "", unitNo: deal?.unit || "", building: deal?.building || "", area: deal?.area || "", city: "DUBAI", customTerms: "" },
    msg: "",
  };
}

function openContractForm(contract = null) {
  if (contract) state.contractForm = { ...contract, details: { ...(contract.details || {}) }, addendum: { ...(contract.addendum || {}) }, msg: "" };
  else state.contractForm = contractDraftFromDeal(dealGroupOptions()[0]?.deal);
  render();
}

// Contract → Accounts hand-off. Admin finalizes a contract; Accounts sees the
// full details here (tenant, landlord, rent, deposit, payment mode) and raises
// the matching invoice or receipt without re-keying anything. Rendered on both
// the Contracts screen (owner/admin oversight) and Invoices (accounts action).
function contractHandoffSection() {
  if (!roleIn("owner", "accounts", "admin") || !state.accountTasks.length) return "";
  const canFulfill = roleIn("owner", "accounts");
  const pending = state.accountTasks.filter((t) => t.status === "pending").length;
  const taskRows = state.accountTasks.map((task) => {
    const contract = state.contracts.find((c) => c.id === task.contract_id);
    if (!contract) return "";
    const doc = state.docs.find((d) => d.id === task.money_doc_id);
    const action = task.status === "pending" && canFulfill ? `<div data-accounttask="${task.id}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:end">
      <label class="field compact-field">Type<select class="input" data-tasktype><option value="invoice">Invoice</option><option value="receipt">Receipt</option></select></label>
      <label class="field compact-field">Date<input class="input" type="date" data-taskdate value="${todayIso()}"></label>
      <label class="field compact-field">Amount<input class="input" type="number" min="0.01" step="0.01" data-taskamount value="${esc(contract.details?.contractValue || contract.annual_rent)}"></label>
      <label class="field compact-field">Payment<input class="input" data-taskpayment value="${esc(contract.payment_mode || "")}" placeholder="Cheque / transfer"></label>
      <button class="btn btn-primary btn-mini" data-fulfilltask>Create</button></div>` : `<span class="tag tag-neutral">${doc ? esc(doc.doc_no) : "Completed"}</span>`;
    return `<tr><td><strong>${esc(contract.contract_no)}</strong><div class="text-muted" style="font-size:11px">${showDate(contract.start_date)} – ${showDate(contract.end_date)}</div></td>
      <td>${esc(contract.tenant_name)}<div class="text-muted" style="font-size:11px">${esc(contract.tenant_phone || "")}</div></td>
      <td>${esc(contract.landlord_name || "—")}<div class="text-muted" style="font-size:11px">${esc(contract.owner_phone || "")}</div></td>
      <td class="numeric">${money(contract.annual_rent)}</td>
      <td class="numeric">${money(contract.security_deposit)}</td>
      <td>${esc(contract.payment_mode || "—")}</td>
      <td><span class="tag ${task.status === "pending" ? "tag-accent" : "tag-neutral"}">${esc(task.status)}</span></td><td>${action}</td></tr>`;
  }).join("");
  return `<section class="md-section" style="margin-bottom:20px"><div class="md-section-header"><h3>Contracts awaiting Accounts</h3><span class="tag ${pending ? "tag-accent" : "tag-neutral"}">${pending} pending</span></div>
    <div class="table-wrap"><table class="grid" style="min-width:1100px"><thead><tr><th>Contract</th><th>Tenant</th><th>Landlord / owner</th><th>Annual rent</th><th>Deposit</th><th>Payment mode</th><th>Status</th><th>Create invoice or receipt</th></tr></thead><tbody>${taskRows}</tbody></table></div></section>`;
}

function viewContracts() {
  const canManage = roleIn("owner", "admin");
  const canFulfill = roleIn("owner", "accounts");
  const canEjari = roleIn("owner", "admin", "accounts");
  const reminders = state.contracts.filter((c) => c.status === "final")
    .map((contract) => ({ contract, renewal: renewalStatus(contract.end_date) }))
    .filter((item) => ["due", "expired"].includes(item.renewal.status))
    .sort((a, b) => a.renewal.days - b.renewal.days);
  const contractRows = state.contracts.map((contract) => {
    const renewal = contract.status === "final" ? renewalStatus(contract.end_date) : { status: "draft", days: null };
    const renewalText = renewal.status === "expired" ? `${Math.abs(renewal.days)} days overdue` : renewal.status === "due" ? `${renewal.days} days remaining` : "Not due";
    const ejariRegistered = contract.ejari_status === "registered";
    const ejariCell = contract.status !== "final"
      ? `<span class="text-muted">—</span>`
      : canEjari
        ? `<button class="btn btn-mini ${ejariRegistered ? "btn-secondary" : "btn-primary"}" data-toggleejari="${contract.id}">${ejariRegistered ? "Registered" : "Register Ejari"}</button>`
        : `<span class="tag ${ejariRegistered ? "tag-neutral" : "tag-accent"}">${ejariRegistered ? "Registered" : "Pending"}</span>`;
    return `<tr><td><strong>${esc(contract.contract_no)}</strong></td><td>${esc(dealLabelFor(contract.deal_group))}</td>
      <td>${esc(contract.landlord_name)} → ${esc(contract.tenant_name)}</td><td>${showDate(contract.start_date)} – ${showDate(contract.end_date)}</td>
      <td><span class="tag ${contract.status === "draft" ? "tag-accent" : "tag-neutral"}">${esc(contract.status)}</span></td>
      <td>${ejariCell}</td>
      <td><span class="${renewal.status === "expired" ? "expiry-days is-overdue" : renewal.status === "due" ? "expiry-days" : "text-muted"}">${esc(renewalText)}</span></td>
      <td style="white-space:nowrap">${canManage && contract.status === "draft" ? `<button class="btn btn-secondary btn-mini" data-editcontract="${contract.id}">Edit</button> ` : ""}<button class="btn btn-primary btn-mini" data-printcontract="${contract.id}">View / print</button></td></tr>`;
  }).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap">
      <div><span class="card-kicker">Tenancy operations</span><h1 style="margin-top:4px">${roleIn("agent") ? "My Tenancy Contracts" : "Contracts & Addenda"}</h1><p class="text-muted" style="margin:0">DLD contract drafts, Xsite addenda, 90-day renewals, and Accounts hand-off.</p></div>
      ${canManage ? `<button class="btn btn-primary" id="newcontract">+ New contract draft</button>` : ""}
    </div>
    ${reminders.length ? `<section class="md-section" style="margin-bottom:20px"><div class="md-section-header"><h3>Renewal reminders</h3><span class="tag tag-accent">${reminders.filter(({renewal})=>renewal.status==="due").length} due · ${reminders.filter(({renewal})=>renewal.status==="expired").length} expired</span></div>
      <div class="expiry-list">${reminders.map(({contract,renewal}) => `<div class="expiry-row"><div><strong>${esc(contract.contract_no)} · ${esc(contract.tenant_name)}</strong><div class="text-muted">${esc(dealLabelFor(contract.deal_group))} · ends ${showDate(contract.end_date)}</div></div><span class="${renewal.status === "expired" ? "expiry-days is-overdue" : "expiry-days"}">${renewal.status === "expired" ? `${Math.abs(renewal.days)}d overdue` : `${renewal.days}d left`}</span></div>`).join("")}</div></section>` : ""}
    ${contractHandoffSection()}
    <div class="sheet"><div class="sheet-hint">${roleIn("agent") ? "Only finalized contracts linked to your deals are visible" : `${state.contracts.length} saved contract records`}</div>
      <div class="table-wrap"><table class="grid" style="min-width:1080px"><thead><tr><th>Contract</th><th>Deal</th><th>Parties</th><th>Term</th><th>Status</th><th>Ejari</th><th>Renewal</th><th></th></tr></thead><tbody>${contractRows || `<tr><td colspan="8"><div class="md-empty" style="border:0">No contracts yet.</div></td></tr>`}</tbody></table></div></div>
  </div>`;
}

function contractInput(id, label, value, type = "text", extra = "") {
  const lengthLimit = ["text", "email", "tel"].includes(type) && !extra.includes("maxlength") ? 'maxlength="300"' : "";
  return `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" type="${type}" value="${esc(value ?? "")}" ${lengthLimit} ${extra}></div>`;
}

function viewContractModal() {
  const f = state.contractForm;
  if (!f) return "";
  const options = dealGroupOptions().map((o) => `<option value="${o.group}" ${o.group === f.deal_group ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  const d = f.details || {}, a = f.addendum || {};
  return `<div class="modal-backdrop"><div class="modal contract-modal" role="dialog" aria-modal="true" aria-labelledby="contracttitle">
    <div class="modal-head"><h3 id="contracttitle">${f.id ? `Edit ${esc(f.contract_no)}` : "New tenancy contract draft"}</h3><button class="modal-close" id="contractclose" aria-label="Close">×</button></div>
    <div class="modal-body"><div class="contract-form-section"><h4>Deal and contract</h4><div class="form-grid">
      <div class="field"><label for="ct_deal">Related deal</label><select class="input" id="ct_deal">${options}</select></div>
      ${contractInput("ct_contract_date","Contract date",f.contract_date,"date")}${contractInput("ct_start","Start date",f.start_date,"date")}${contractInput("ct_end","End date",f.end_date,"date")}
      ${contractInput("ct_landlord","Landlord / owner",f.landlord_name)}${contractInput("ct_tenant","Tenant",f.tenant_name)}${contractInput("ct_owner_phone","Owner phone",f.owner_phone,"tel")}${contractInput("ct_tenant_phone","Tenant phone",f.tenant_phone,"tel")}
      ${contractInput("ct_rent","Annual rent (AED)",f.annual_rent,"number",'min="0" step="0.01"')}${contractInput("ct_contract_value","Total contract value (AED)",d.contractValue ?? f.annual_rent,"number",'min="0" step="0.01"')}${contractInput("ct_deposit","Security deposit (AED)",f.security_deposit,"number",'min="0" step="0.01"')}${contractInput("ct_payment","Payment mode",f.payment_mode)}
    </div></div>
    <div class="contract-form-section"><h4>Official Ejari / DLD details</h4><div class="form-grid">
      ${contractInput("ct_lessor","Lessor name",d.lessorName)}${contractInput("ct_lessor_id","Lessor Emirates ID",d.lessorEmiratesId)}${contractInput("ct_lessor_email","Lessor email",d.lessorEmail,"email")}${contractInput("ct_lessor_license","Lessor company license",d.lessorLicenseNo)}${contractInput("ct_lessor_authority","Lessor licensing authority",d.lessorLicensingAuthority)}
      ${contractInput("ct_tenant_id","Tenant Emirates ID",d.tenantEmiratesId)}${contractInput("ct_tenant_email","Tenant email",d.tenantEmail,"email")}${contractInput("ct_tenant_license","Tenant company license",d.tenantLicenseNo)}${contractInput("ct_tenant_authority","Tenant licensing authority",d.tenantLicensingAuthority)}
      ${contractInput("ct_plot","Plot no.",d.plotNo)}${contractInput("ct_makani","Makani no.",d.makaniNo)}${contractInput("ct_building","Building",d.buildingName)}${contractInput("ct_unit","Property / unit no.",d.propertyNo)}
      <div class="field"><label for="ct_property_type">Property use</label><input class="input" id="ct_property_type" value="Residential" readonly><span class="text-muted" style="font-size:11px">The supplied Xsite addendum is residential-only.</span></div>
      ${contractInput("ct_unit_type","Unit type",d.unitType)}${contractInput("ct_area_sqm","Area (sq.m)",d.propertyArea,"number",'min="0" step="0.01"')}${contractInput("ct_location","Location",d.location)}${contractInput("ct_premises_no","Premises no. (DEWA)",d.premisesNo)}
      <div class="field" style="grid-column:1/-1"><label for="ct_terms">Additional terms</label><textarea class="input" id="ct_terms" rows="4" maxlength="1500">${esc(f.additional_terms || "")}</textarea><span class="text-muted" style="font-size:11px">Maximum 1,500 characters to fit the DLD terms area.</span></div>
    </div></div>
    <div class="contract-form-section"><h4>Xsite addendum</h4><div class="form-grid">
      ${contractInput("ct_furnishing","Furnishing",a.furnishing)}${contractInput("ct_add_premises","Premises description",a.premises)}${contractInput("ct_add_unit","Unit number",a.unitNo)}${contractInput("ct_add_building","Building",a.building)}${contractInput("ct_add_area","Area / community",a.area)}${contractInput("ct_add_city","City / emirate",a.city)}
      <div class="field" style="grid-column:1/-1"><label for="ct_add_terms">Custom addendum conditions</label><textarea class="input" id="ct_add_terms" rows="5" maxlength="1000">${esc(a.customTerms || "")}</textarea><span class="text-muted" style="font-size:11px">Maximum 1,000 characters to keep signatures and footer visible.</span></div>
    </div></div>
    <div class="modal-actions"><span class="form-msg" id="contractmsg" aria-live="polite">${esc(f.msg || "")}</span><button class="btn btn-secondary" id="contractcancel">Cancel</button><button class="btn btn-secondary" id="contractdraft">Save draft</button><button class="btn btn-primary" id="contractfinal">Finalize & notify Accounts</button></div>
    </div></div></div>`;
}

async function saveContract(status) {
  const value = (id) => document.getElementById(id)?.value?.trim() || "";
  const msg = document.getElementById("contractmsg");
  const payload = {
    p_id: state.contractForm.id || null, p_deal_group: value("ct_deal"), p_status: status,
    p_contract_date: value("ct_contract_date"), p_start_date: value("ct_start"), p_end_date: value("ct_end"),
    p_landlord_name: value("ct_landlord"), p_tenant_name: value("ct_tenant"), p_owner_phone: value("ct_owner_phone"), p_tenant_phone: value("ct_tenant_phone"),
    p_annual_rent: Number(value("ct_rent")), p_security_deposit: Number(value("ct_deposit")), p_payment_mode: value("ct_payment"), p_additional_terms: value("ct_terms"),
    p_details: { lessorName:value("ct_lessor"), lessorEmiratesId:value("ct_lessor_id"), lessorEmail:value("ct_lessor_email"), lessorLicenseNo:value("ct_lessor_license"), lessorLicensingAuthority:value("ct_lessor_authority"), tenantEmiratesId:value("ct_tenant_id"), tenantEmail:value("ct_tenant_email"), tenantLicenseNo:value("ct_tenant_license"), tenantLicensingAuthority:value("ct_tenant_authority"), plotNo:value("ct_plot"), makaniNo:value("ct_makani"), buildingName:value("ct_building"), propertyNo:value("ct_unit"), propertyType:value("ct_property_type"), contractValue:value("ct_contract_value"), unitType:value("ct_unit_type"), propertyArea:value("ct_area_sqm"), location:value("ct_location"), premisesNo:value("ct_premises_no") },
    p_addendum: { furnishing:value("ct_furnishing"), premises:value("ct_add_premises"), unitNo:value("ct_add_unit"), building:value("ct_add_building"), area:value("ct_add_area"), city:value("ct_add_city"), customTerms:value("ct_add_terms") },
  };
  if (!payload.p_deal_group || !payload.p_contract_date || !payload.p_start_date || !payload.p_end_date || !payload.p_landlord_name || !payload.p_tenant_name || !Number.isFinite(payload.p_annual_rent) || payload.p_annual_rent < 0 || !Number.isFinite(payload.p_security_deposit) || payload.p_security_deposit < 0) { msg.textContent = "Deal, valid dates, parties, and non-negative amounts are required."; return; }
  if (status === "final") {
    const required = [[payload.p_owner_phone,"Owner phone"],[payload.p_tenant_phone,"Tenant phone"],[payload.p_payment_mode,"Payment mode"],[payload.p_details.lessorEmail,"Lessor email"],[payload.p_details.tenantEmail,"Tenant email"],[payload.p_details.buildingName,"Building"],[payload.p_details.propertyNo,"Property / unit no."],[payload.p_details.unitType,"Unit type"],[payload.p_details.location,"Location"],[payload.p_details.premisesNo,"Premises no."],[payload.p_addendum.furnishing,"Furnishing"],[payload.p_addendum.premises,"Addendum premises"],[payload.p_addendum.unitNo,"Addendum unit"],[payload.p_addendum.building,"Addendum building"],[payload.p_addendum.area,"Addendum area"],[payload.p_addendum.city,"Addendum city"]];
    const missing = required.filter(([entry])=>!entry).map(([,label])=>label);
    if (missing.length) { msg.textContent = `Complete before finalizing: ${missing.join(", ")}.`; return; }
    if (!payload.p_details.lessorEmiratesId && !payload.p_details.lessorLicenseNo) { msg.textContent = "Lessor Emirates ID or company licence is required."; return; }
    if (!payload.p_details.tenantEmiratesId && !payload.p_details.tenantLicenseNo) { msg.textContent = "Tenant Emirates ID or company licence is required."; return; }
    if (payload.p_annual_rent <= 0 || Number(payload.p_details.contractValue) <= 0) { msg.textContent = "Annual rent and total contract value must be greater than zero."; return; }
    if (!["ct_lessor_email","ct_tenant_email"].every((id)=>document.getElementById(id).checkValidity())) { msg.textContent = "Enter valid lessor and tenant email addresses."; return; }
    if (!window.confirm("Finalize this complete contract? Final contracts cannot be edited and Accounts will be notified.")) return;
  }
  const buttons = document.querySelectorAll("#contractdraft,#contractfinal"); buttons.forEach((button)=>button.disabled=true);
  const result = await supabase.rpc("save_contract", payload);
  if (result.error) { msg.textContent = result.error.message; buttons.forEach((button)=>button.disabled=false); return; }
  state.contractForm = null; await reloadAfterWrite(reloadContracts, status === "final" ? "Final contract" : "Contract draft");
  await syncContractContacts(payload);
  render();
}

async function fulfillAccountTask(container) {
  const button = container.querySelector("[data-fulfilltask]");
  const amount = Number(container.querySelector("[data-taskamount]").value);
  const docDate = container.querySelector("[data-taskdate]").value;
  const paymentMethod = container.querySelector("[data-taskpayment]").value.trim();
  if (!docDate || !Number.isFinite(amount) || amount <= 0 || !paymentMethod) { window.alert("Date, a positive amount, and payment method are required."); return; }
  button.disabled = true; button.textContent = "Creating…";
  const result = await supabase.rpc("fulfill_account_task", { p_task_id: container.dataset.accounttask, p_doc_type: container.querySelector("[data-tasktype]").value,
    p_doc_date: docDate, p_amount: amount, p_payment_method: paymentMethod });
  if (result.error) { window.alert("Could not create document: " + result.error.message); button.disabled=false; button.textContent="Create"; return; }
  await reloadAfterWrite(reloadContracts, "Invoice or receipt"); render();
}

function fill(value, style, cls = "dld-fill") { return `<span class="${cls}" style="${style}">${esc(value || "")}</span>`; }
function viewContractPrint() {
  const c = state.printContract;
  if (!c) return "";
  const d = c.details || {}, a = c.addendum || {};
  const usageMarkStyle = d.propertyType === "Industrial" ? "left:25.2%;top:58.1%;" : d.propertyType === "Commercial" ? "left:43%;top:58.1%;" : "left:62.8%;top:58.1%;";
  const addendumDescription = `${a.furnishing || ""} ${a.premises || "PREMISES"}, UNIT ${a.unitNo || d.propertyNo || ""}, ${a.building || d.buildingName || ""}, ${a.area || d.location || ""}, ${a.city || "DUBAI"}`.replace(/\s+/g," ").trim();
  return `<div class="contract-print-shell" role="dialog" aria-modal="true" aria-label="Contract print preview" tabindex="-1"><div class="contract-print-toolbar"><div><strong>DLD Contract + Xsite Addendum</strong><div>${esc(c.contract_no)} · ${esc(c.tenant_name)} · ${esc(c.status.toUpperCase())}</div></div><div><button class="btn btn-secondary" id="printclose">Back</button> <button class="btn btn-primary" id="printnow">Print / Save PDF</button></div></div>
    ${c.status === "draft" ? `<div class="contract-draft-watermark">DRAFT</div>` : ""}
    <div class="dld-print-page"><img src="./contract-assets/ejari-page-1.png" alt="DLD tenancy contract page 1">
      ${fill(showDate(c.contract_date),"left:8%;top:13.3%;width:18%")}${fill(c.landlord_name,"left:15.5%;top:20.5%;width:73%")}${fill(d.lessorName,"left:15.5%;top:23.2%;width:73%")}${fill(d.lessorEmiratesId,"left:22%;top:26%;width:62%")}${fill(d.lessorLicenseNo,"left:14%;top:28.6%;width:29%")}${fill(d.lessorLicensingAuthority,"left:63%;top:28.6%;width:25%")}${fill(d.lessorEmail,"left:15%;top:31.6%;width:69%")}${fill(c.owner_phone,"left:15%;top:34.2%;width:69%")}
      ${fill(c.tenant_name,"left:15.5%;top:40.7%;width:70%")}${fill(d.tenantEmiratesId,"left:22%;top:43.5%;width:62%")}${fill(d.tenantLicenseNo,"left:14%;top:46.2%;width:29%")}${fill(d.tenantLicensingAuthority,"left:63%;top:46.2%;width:25%")}${fill(d.tenantEmail,"left:15%;top:49.2%;width:69%")}${fill(c.tenant_phone,"left:15%;top:51.9%;width:69%")}
      ${fill("X",usageMarkStyle)}${fill(d.plotNo,"left:12%;top:61.1%;width:31%")}${fill(d.makaniNo,"left:61%;top:61.1%;width:28%")}${fill(d.buildingName,"left:15%;top:64%;width:28%")}${fill(d.propertyNo,"left:61%;top:64%;width:28%")}${fill(d.unitType,"left:15%;top:66.8%;width:28%")}${fill(d.propertyArea,"left:65%;top:66.8%;width:24%")}${fill(d.location,"left:12%;top:69.6%;width:31%")}${fill(d.premisesNo,"left:64%;top:69.6%;width:25%")}
      ${fill(showDate(c.start_date),"left:21%;top:76.2%;width:14%")}${fill(showDate(c.end_date),"left:36%;top:76.2%;width:14%")}${fill(money(d.contractValue || c.annual_rent),"left:63%;top:76.2%;width:25%")}${fill(money(c.annual_rent),"left:15%;top:79.2%;width:27%")}${fill(money(c.security_deposit),"left:65%;top:79.2%;width:23%")}${fill(c.payment_mode,"left:15%;top:81.9%;width:71%")}${fill(showDate(c.contract_date),"left:34%;top:94.7%;width:12%")}${fill(showDate(c.contract_date),"left:82%;top:94.7%;width:12%")}
    </div>
    <div class="dld-print-page"><img src="./contract-assets/ejari-page-2.png" alt="DLD tenancy contract page 2">${fill(showDate(c.contract_date),"left:34%;top:94.7%;width:12%")}${fill(showDate(c.contract_date),"left:82%;top:94.7%;width:12%")}</div>
    <div class="dld-print-page"><img src="./contract-assets/ejari-page-3.png" alt="DLD tenancy contract page 3">${fill(c.additional_terms,"left:9.5%;top:36.7%;width:81%;height:16%;white-space:pre-line","dld-fill dld-terms-fill")}${fill(showDate(c.contract_date),"left:34%;top:91.6%;width:12%")}${fill(showDate(c.contract_date),"left:82%;top:91.6%;width:12%")}</div>
    <div class="dld-print-page"><img src="./contract-assets/xsite-addendum-page-1.png" alt="Xsite addendum page 1">${fill(addendumDescription,"left:2.4%;top:14.6%;width:95%;background:white;padding:1px 4px","addendum-fill")}${fill(c.tenant_name,"left:9.5%;top:74.3%;width:35%;text-align:center","addendum-fill")}${fill(c.landlord_name,"left:52.5%;top:74.3%;width:35%;text-align:center","addendum-fill")}${fill(showDate(c.contract_date),"left:9.5%;top:79.4%;width:35%;text-align:center","addendum-fill")}${fill(showDate(c.contract_date),"left:52.5%;top:79.4%;width:35%;text-align:center","addendum-fill")}</div>
    <div class="dld-print-page"><img src="./contract-assets/xsite-addendum-page-2.png" alt="Xsite addendum page 2">${a.customTerms ? fill(`ADDITIONAL MUTUALLY AGREED CONDITIONS\n${a.customTerms}`,"left:7%;top:64%;width:86%;min-height:12%;padding:6px","addendum-fill addendum-custom") : ""}${fill(c.tenant_name,"left:8%;top:52.8%;width:35%;text-align:center","addendum-fill")}${fill(c.landlord_name,"left:53%;top:52.8%;width:35%;text-align:center","addendum-fill")}${fill(showDate(c.contract_date),"left:8%;top:57.9%;width:35%;text-align:center","addendum-fill")}${fill(showDate(c.contract_date),"left:53%;top:57.9%;width:35%;text-align:center","addendum-fill")}</div>
  </div>`;
}

// ── view: team management (owner + admin) ────────────────
// Owner and Admin can both assign roles. Only an Owner may grant or remove the
// Owner role, so an admin cannot promote themselves or lock the owner out.
function viewTeam() {
  const isOwner = roleIn("owner");
  const agentNames = [...new Set(state.commission.map((r) => r.agent_name))].sort();
  const assignable = isOwner ? ["pending", "agent", "accounts", "admin", "owner"] : ["pending", "agent", "accounts", "admin"];
  const roleOpts = (cur) => (assignable.includes(cur) ? assignable : [...assignable, cur])
    .map((r) => `<option value="${r}" ${r === cur ? "selected" : ""}>${r}</option>`).join("");
  const agentOpts = (cur) => `<option value="">— none —</option>` + agentNames
    .map((n) => `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
  const rows = state.team.map((t) => {
    // Admins may view owner accounts but not modify them.
    const locked = !isOwner && t.role === "owner";
    return `
    <tr data-uid="${t.id}">
      <td>${esc(t.full_name || "—")}</td>
      <td>${esc(t.email || "—")}</td>
      <td>${t.role === "pending" ? `<span class="tag tag-accent">pending</span>` : `<span class="tag tag-neutral">${esc(t.role)}</span>`}</td>
      <td>${locked ? `<span class="text-muted" style="font-size:12px">Owner — only an owner can change this</span>`
        : `<select class="input" data-role style="padding:7px 10px">${roleOpts(t.role)}</select>`}</td>
      <td>${locked ? "—" : `<select class="input" data-agentname style="padding:7px 10px">${agentOpts(t.agent_name)}</select>`}</td>
      <td>${locked ? "" : `<button class="btn btn-primary" data-save>Save</button>`}</td>
    </tr>`;
  }).join("");
  return `
  <div>
    <div style="margin-bottom:20px"><span class="card-kicker">${isOwner ? "Owner" : "Admin"} / Team</span><h1 style="margin-top:4px">Team &amp; Access</h1>
    <p class="text-muted" style="margin:0">New signups appear here as <strong>pending</strong>. Assign a role to grant access; link agents to their ledger name.${isOwner ? "" : " Owner accounts can only be changed by an owner."}</p></div>
    <div class="sheet"><div class="sheet-hint">Everyone with an account · role changes apply immediately</div>
    <div class="table-wrap"><table class="grid">
      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Assign role</th><th>Agent ledger link</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">No accounts yet.</td></tr>`}</tbody>
    </table></div></div>
    <p class="text-muted" style="font-size:12px;margin-top:10px" id="teammsg"></p>
  </div>`;
}

async function saveTeamRow(tr) {
  const uid = tr.dataset.uid;
  const role = tr.querySelector("[data-role]").value;
  const agent_name = tr.querySelector("[data-agentname]").value || null;
  const msg = document.getElementById("teammsg");
  if (role === "agent" && !agent_name) { msg.textContent = "Select an agent ledger before assigning the Agent role."; return; }
  const ownerCount = state.team.filter((member) => member.role === "owner").length;
  const target = state.team.find((member) => member.id === uid);
  if (target?.role === "owner" && role !== "owner" && ownerCount <= 1) { msg.textContent = "The last owner cannot be demoted."; return; }
  // Only an owner may grant or remove the owner role.
  if (!roleIn("owner") && (role === "owner" || target?.role === "owner")) {
    msg.textContent = "Only an owner can assign or change the Owner role.";
    return;
  }
  const btn = tr.querySelector("[data-save]"); btn.disabled = true; btn.textContent = "Saving…";
  // Prefer the RPC, which re-checks the owner-role rule server-side. Falls back
  // to a direct update where that function has not been created yet.
  let error = null;
  const rpcResult = await supabase.rpc("set_member_role", { p_id: uid, p_role: role, p_agent_name: agent_name });
  if (rpcResult.error && /function|does not exist|schema cache/i.test(rpcResult.error.message)) {
    ({ error } = await supabase.from("profiles").update({ role, agent_name }).eq("id", uid));
  } else {
    error = rpcResult.error;
  }
  if (error) { msg.textContent = "Could not save: " + error.message; btn.disabled = false; btn.textContent = "Save"; return; }
  const t = state.team.find((x) => x.id === uid);
  if (t) { t.role = role; t.agent_name = agent_name; }
  msg.textContent = "Saved.";
  const main = root.querySelector("main"); main.innerHTML = viewTeam(); wireScreen();
}

// ── view: dashboard ──────────────────────────────────────
function viewDashboard() {
  const p = state.profile;
  if (p.role === "agent") return viewAgentDashboard();
  const deals = state.deals.filter((deal) => !state.txMonth || deal.month === state.txMonth);
  const received = deals.reduce((s, d) => s + (+d.commission_received || 0), 0);
  const totc = deals.reduce((s, d) => s + (+d.total_commission || 0), 0);
  const tiers = expiryTiers();
  const expiringSoon = tiers.slice(1).reduce((s, t) => s + t.items.length, 0);
  const kicker = p.role === "owner" ? "Owner / Overview" : p.role === "accounts" ? "Accounts workspace" : "Admin workspace";
  const kpis = `
  <section class="md-kpi-grid">
    <div class="md-kpi is-accent"><span class="card-kicker">Deals this month</span><span class="md-kpi-value">${deals.length}</span><span class="md-kpi-detail">${monthLabel(state.txMonth)} register</span></div>
    <div class="md-kpi"><span class="card-kicker">Commission received</span><span class="md-kpi-value">${money(Math.round(received))}</span><span class="md-kpi-detail">Sum of received commission</span></div>
    <div class="md-kpi"><span class="card-kicker">Total commission</span><span class="md-kpi-value">${money(Math.round(totc))}</span><span class="md-kpi-detail">Incl. third-party share</span></div>
    <div class="md-kpi"><span class="card-kicker">Expiring ≤90 days</span><span class="md-kpi-value">${expiringSoon}</span><span class="md-kpi-detail">${tiers[0].items.length} already expired</span></div>
  </section>`;
  const cashDates = availableMonths(state.cash, "as_at");
  const cashRows = state.cash.filter((c) => c.as_at === state.cashDate);
  const isLatestCash = state.cashDate === cashDates[0];
  const cashDateOpts = cashDates.map((d) =>
    `<option value="${d}" ${d === state.cashDate ? "selected" : ""}>${showDate(d)}${d === cashDates[0] ? " (latest)" : ""}</option>`).join("");
  const cashCard = roleIn("owner", "accounts", "admin") ? `
    <section class="md-section">
      <div class="md-section-header"><h3>Cash position</h3>
        <span style="display:flex;gap:8px;align-items:center">
          ${cashDates.length > 1 ? `<select class="input" id="cashdate" style="padding:5px 8px;font-size:12px;width:auto">${cashDateOpts}</select>` : `<span class="text-muted" style="font-size:11px">As at ${showDate(state.cashDate)}</span>`}
          ${roleIn("owner", "accounts") ? `<button class="btn btn-secondary btn-mini" id="cashedit">Update cash</button>` : ""}
        </span>
      </div>
      ${!isLatestCash ? `<p class="text-muted" style="font-size:11px;margin:0 0 8px">Historical snapshot — latest is ${showDate(cashDates[0])}.</p>` : ""}
      ${cashRows.map((c) => `<div class="cash-row ${/remaining/i.test(c.label) ? "is-remaining" : /total/i.test(c.label) ? "is-total" : ""}"><span>${esc(c.label)}</span><strong>${money(c.amount)}</strong></div>`).join("")}
    </section>` : "";
  const expiryCard = `
    <section class="md-section">
      <div class="md-section-header"><h3>Contract expiries</h3>${roleIn("owner","accounts") ? `<button class="btn btn-secondary" data-screen="transactions">Open register</button>` : ""}</div>
      <div class="md-attention-list">
        ${tiers.map((t) => `<div class="md-attention-item"><span><strong>${t.title}</strong><br><span class="text-muted" style="font-size:11px">${t.hint}</span></span><span class="md-attention-count">${t.items.length}</span></div>`).join("")}
      </div>
    </section>`;
  const strip = cashCard ? `<div class="fin-strip">${cashCard}${expiryCard}</div>` : expiryCard;

  // Daily control — today's business progress + activity feed.
  const daily = dailyControl();
  const deptBar = (dept) => {
    const count = daily.deptCounts[dept] || 0;
    const pct = Math.round((count / daily.maxDept) * 100);
    return `<div class="dept-progress"><div class="dept-progress-head"><span>${dept}</span><strong>${count}</strong></div><div class="dept-progress-track"><div class="dept-progress-fill" style="width:${pct}%"></div></div></div>`;
  };
  const dailySection = `
    <section class="md-section" style="margin-bottom:20px">
      <div class="md-section-header"><h3>Today's business progress</h3><span class="text-muted" style="font-size:11px">${showDate(todayIso())}</span></div>
      <div class="md-kpi-grid" style="margin-bottom:16px">
        <div class="md-kpi"><span class="card-kicker">Contracts today</span><span class="md-kpi-value">${daily.contractsToday.length}</span></div>
        <div class="md-kpi"><span class="card-kicker">Receipts today</span><span class="md-kpi-value">${daily.receiptsToday.length}</span><span class="md-kpi-detail">${money(Math.round(daily.receiptCash))} received</span></div>
        <div class="md-kpi"><span class="card-kicker">Invoices today</span><span class="md-kpi-value">${daily.invoicesToday.length}</span></div>
        <div class="md-kpi"><span class="card-kicker">New contacts today</span><span class="md-kpi-value">${daily.contactsToday.length}</span><span class="md-kpi-detail">${state.contacts.length} total</span></div>
      </div>
      <div class="fin-strip">
        <div><h4 style="margin:0 0 10px;font-size:13px">Department progress</h4>${["Sales","Accounts","CRM"].map(deptBar).join("")}</div>
        <div><h4 style="margin:0 0 10px;font-size:13px">Today's activity</h4>${daily.activity.length
          ? `<div class="activity-feed">${daily.activity.map((a) => `<div class="activity-item"><span class="tag tag-neutral">${a.dept}</span><span>${esc(a.text)}</span></div>`).join("")}</div>`
          : `<p class="text-muted" style="font-size:12px;margin:0">No activity recorded yet today.</p>`}</div>
      </div>
    </section>`;

  // Extra alert cards: Ejari pending + upcoming staff birthdays.
  const ejari = ejariPending();
  const birthdays = birthdayAlerts();
  const ejariCard = `
    <section class="md-section">
      <div class="md-section-header"><h3>Ejari pending</h3><span class="tag ${ejari.length ? "tag-accent" : "tag-neutral"}">${ejari.length}</span></div>
      ${ejari.length ? `<div class="expiry-list">${ejari.slice(0, 6).map((c) => `<div class="expiry-row"><div><strong>${esc(c.contract_no || "—")} · ${esc(c.tenant_name || "")}</strong><div class="text-muted">ends ${showDate(c.end_date)}</div></div><span class="expiry-days">Not registered</span></div>`).join("")}</div>` : `<p class="text-muted" style="font-size:12px;margin:0">All finalized contracts are Ejari-registered.</p>`}
    </section>`;
  const birthdayCard = `
    <section class="md-section">
      <div class="md-section-header"><h3>Staff birthdays</h3><span class="tag ${birthdays.length ? "tag-accent" : "tag-neutral"}">${birthdays.length}</span></div>
      ${birthdays.length ? `<div class="expiry-list">${birthdays.slice(0, 6).map((b) => `<div class="expiry-row"><div><strong>${esc(b.name)}</strong><div class="text-muted">${esc(b.job || "")}</div></div><span class="expiry-days">${b.dateLabel} · ${b.days === 0 ? "today" : `${b.days}d`}</span></div>`).join("")}</div>` : `<p class="text-muted" style="font-size:12px;margin:0">No birthdays in the next 30 days.</p>`}
    </section>`;
  const alertStrip = `<div class="fin-strip" style="margin-top:20px">${ejariCard}${birthdayCard}</div>`;

  // Global search across contacts, contracts, and deals.
  const searchResults = dashboardSearch(state.dashQuery);
  const searchBox = `
    <div class="dash-search">
      <input class="input" id="dashsearch" type="search" placeholder="Search contacts, contracts, and deals…" value="${esc(state.dashQuery)}">
      ${state.dashQuery.trim() ? `<div class="dash-search-results">${searchResults.length
        ? searchResults.map((r) => `<button class="dash-search-item" data-gotoscreen="${r.screen}"><strong>${esc(r.label)}</strong><span class="text-muted">${esc(r.detail)}</span></button>`).join("")
        : `<div class="md-empty" style="border:0">No matches.</div>`}</div>` : ""}
    </div>`;

  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">${esc(kicker)}</span><h1 style="margin-top:4px">${monthLabel(state.txMonth)} Overview</h1><p class="text-muted" style="margin:0">Live from the Xsite database.</p></div>
    </header>
    ${searchBox}
    ${dailySection}
    ${kpis}
    ${strip}
    ${alertStrip}
  </div>`;
}

function viewAgentDashboard() {
  const rows = state.commission.filter((row) => !state.ledgerMonth || row.month === state.ledgerMonth);
  const received = rows.reduce((s, r) => s + (+r.received || 0), 0);
  const vat = rows.reduce((s, r) => s + (+r.vat || 0), 0);
  const share = rows.reduce((s, r) => s + (+r.agent_share || 0), 0);
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">Private agent account</span><h1 style="margin-top:4px">${esc(state.profile.full_name || state.profile.agent_name || "My account")}</h1><p class="text-muted" style="margin:0">Your ${monthLabel(state.ledgerMonth)} commission summary.</p></div>
    </header>
    <section class="md-kpi-grid">
      <div class="md-kpi is-accent"><span class="card-kicker">My deals</span><span class="md-kpi-value">${rows.length}</span><span class="md-kpi-detail">Commission entries</span></div>
      <div class="md-kpi"><span class="card-kicker">Commission received</span><span class="md-kpi-value">${money(Math.round(received))}</span></div>
      <div class="md-kpi"><span class="card-kicker">VAT @ 5%</span><span class="md-kpi-value">${money(Math.round(vat))}</span></div>
      <div class="md-kpi"><span class="card-kicker">My share</span><span class="md-kpi-value">${money(Math.round(share))}</span></div>
    </section>
  </div>`;
}

// ── view: transactions register ──────────────────────────
function viewTransactions() {
  const tiers = expiryTiers();
  const hasExp = tiers.some((t) => t.items.length);
  const q = state.txQuery.trim().toLowerCase();
  const canAdd = roleIn("owner", "accounts", "admin");
  const canEdit = roleIn("owner", "accounts");
  const months = availableMonths(state.deals, "month");
  const monthTabs = months.map((m) =>
    `<button class="tab ${state.txMonth === m ? "is-active" : ""}" data-txmonth="${m}">${monthLabel(m)}</button>`).join("");
  const rows = state.deals.filter((d) =>
    (!state.txMonth || d.month === state.txMonth) &&
    (state.txType === "All" || (d.deal_type || "").replace("Off plan", "Off Plan") === state.txType) &&
    (!q || [d.agent, d.agent2, d.third_party, d.building, d.unit, d.area, d.landlord, d.tenant, d.payment_method].join(" ").toLowerCase().includes(q)));
  const dealKeys = new Set(rows.map((d) => d.group_id || d.id));
  const editableGroups = new Set(state.commission.map((entry) => entry.group_id).filter(Boolean));
  const recv = rows.reduce((s, d) => s + (+d.commission_received || 0), 0);
  const totc = rows.reduce((s, d) => s + (+d.total_commission || 0), 0);
  const tabs = ["All", "Rent", "Renewal", "Off Plan", "Secondary Sale"].map((t) =>
    `<button class="tab ${state.txType === t ? "is-active" : ""}" data-txtype="${t}">${t}</button>`).join("");
  const expBlock = `
    <section class="md-section" style="margin-bottom:20px">
      <div class="md-section-header"><h3>Contract expiries</h3><span class="tag tag-accent">${tiers.slice(1).reduce((s,t)=>s+t.items.length,0)} due within 90 days · ${tiers[0].items.length} expired</span></div>
      ${hasExp ? tiers.filter((t) => t.items.length).map((t) => `
        <div class="expiry-tier"><h4>${t.title} <span class="text-muted" style="font-size:11px;font-weight:400">${t.hint}</span></h4>
        <div class="table-wrap"><table class="grid"><thead><tr><th>Unit</th><th>Building</th><th>Tenant</th><th>Landlord</th><th>Agent</th><th>TC end</th><th>Due</th></tr></thead><tbody>
        ${t.items.map((x) => `<tr><td>${esc(x.unit)}</td><td>${esc(x.building)}</td><td>${esc(x.tenant)}</td><td>${esc(x.landlord)}</td><td>${esc(x.agent)}</td><td>${esc(x.endLabel)}</td><td><span class="${x.daysClass}">${esc(x.daysLabel)}</span></td></tr>`).join("")}
        </tbody></table></div></div>`).join("") : `<div class="md-empty">No tenancy contracts fall due within the next 90 days.</div>`}
    </section>`;
  const body = rows.map((d) => `<tr>
    <td>${d.sno ?? ""}</td><td>${esc(showDate(d.deal_date, d.deal_date_raw))}</td>
    <td>${esc(d.agent + (d.agent2 && d.agent2 !== "N/A" ? " + " + d.agent2 : ""))}</td>
    <td class="tp-cell">${esc(d.third_party || "—")}</td><td>${esc(d.deal_type)}</td>
    <td class="unit-cell">${esc(d.unit)}</td><td>${esc(d.building)}</td><td>${esc(d.area)}</td>
    <td class="numeric">${money(d.price)}</td><td class="numeric">${money(d.total_commission)}</td><td class="numeric">${money(d.commission_received)}</td>
    <td>${esc(d.landlord || "—")}</td><td>${esc(d.tenant || "—")}</td>
    <td>${esc(showDate(d.tc_start, d.tc_start_raw))}</td><td>${esc(showDate(d.tc_end, d.tc_end_raw))}</td>
    <td class="numeric">${money(d.security_deposit)}</td><td>${esc(d.cheque_count || "—")}</td><td>${esc(d.payment_method || "—")}</td>
    ${canEdit ? (editableGroups.has(d.group_id)
      ? `<td><div class="row-actions"><button class="btn btn-secondary btn-mini" data-editdeal="${d.id}">Edit</button><button class="btn btn-secondary btn-mini" data-deletedeal="${d.id}">Delete</button></div></td>`
      : `<td><span class="text-muted" style="font-size:11px">Imported · read-only</span></td>`) : ""}</tr>`).join("");
  return `
  <div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Accounts / Master Sheet</span><h1 style="margin-top:4px">Transactions Register</h1><p class="text-muted" style="margin:0">Every deal with tenancy, deposit, and payment details — ${monthLabel(state.txMonth)}.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" id="exporttx">Export CSV</button>
        ${canAdd ? `<button class="btn btn-primary" id="newdeal">+ New deal</button>` : ""}
      </div>
    </div>
    ${expBlock}
    <div class="tx-toolbar">
      <div class="tabs">${monthTabs}</div>
      <input class="input" id="txq" type="search" placeholder="Search agent, building, unit, landlord, tenant…" value="${esc(state.txQuery)}">
      <div class="tabs">${tabs}</div>
      <span class="text-muted" style="font-size:12px">${rows.length} rows · ${dealKeys.size} unique deals</span>
    </div>
    <div class="sheet">
      <div class="sheet-hint">Full register — scroll horizontally for tenancy and payment columns</div>
      <div class="table-wrap"><table class="grid wide">
        <thead><tr><th>S.No</th><th>Date</th><th>Agent(s)</th><th>Third party</th><th>Type</th><th>Unit</th><th>Building</th><th>Area</th><th>Rent / Sale price</th><th>Total commission</th><th>Commission received</th><th>Landlord</th><th>Tenant</th><th>TC start</th><th>TC end</th><th>Deposit</th><th>Cheques</th><th>Payment</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>${body}
          <tr class="total-row"><td></td><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="numeric">${money(Math.round(totc*100)/100)}</td><td class="numeric">${money(Math.round(recv*100)/100)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>${canEdit ? "<td></td>" : ""}</tr>
        </tbody></table></div>
    </div>
    ${rows.length === 0 ? `<div class="md-empty" style="margin-top:12px">No transactions in ${monthLabel(state.txMonth)} match the current search or filter.</div>` : ""}
  </div>`;
}

// ── deal form (add / edit) ───────────────────────────────
function emptyDealForm() {
  const today = todayIso();
  return { groupId: null, editIds: [], deal_date: today, agent: "", agent2: "", third_party: "",
    deal_type: "Rent", unit: "", building: "", area: "", price: "", total_commission: "",
    commission_received: "", vat: "", commission_ex_vat: "", agent_business: "",
    company_share: "", agent_share: "", payment_method: "", tc_start: "", duration: "12",
    tc_end: "", security_deposit: "", cheque_count: "", landlord: "", tenant: "", bank: "", msg: "" };
}
function dealFormFromRow(d) {
  const group = state.deals.filter((x) => x.group_id === d.group_id);
  return { groupId: d.group_id, editIds: group.map((x) => x.id),
    deal_date: d.deal_date || "", agent: d.agent || "", agent2: d.agent2 === "N/A" ? "" : (d.agent2 || ""),
    third_party: d.third_party === "N/A" ? "" : (d.third_party || ""),
    deal_type: (d.deal_type || "Rent").replace("Off plan", "Off Plan"), unit: d.unit || "",
    building: d.building || "", area: d.area || "", price: d.price ?? "",
    total_commission: d.total_commission ?? "", commission_received: d.commission_received ?? "",
    vat: d.vat ?? "", commission_ex_vat: d.commission_ex_vat ?? "", agent_business: d.agent_business ?? "",
    company_share: d.company_share ?? "", agent_share: d.agent_share ?? "",
    payment_method: d.payment_method || "", tc_start: d.tc_start || "",
    duration: d.contract_duration || "12", tc_end: d.tc_end || "",
    security_deposit: d.security_deposit ?? "", cheque_count: d.cheque_count || "",
    landlord: d.landlord || "", tenant: d.tenant || "", bank: d.bank || "", msg: "" };
}
function viewDealModal() {
  const f = state.dealForm;
  if (!f) return "";
  const agentNames = state.agents.map((a) => a.name);
  const dl = `<datalist id="agentlist">${agentNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
  const typeOpts = ["Rent", "Renewal", "Off Plan", "Secondary Sale"]
    .map((t) => `<option ${f.deal_type === t ? "selected" : ""}>${t}</option>`).join("");
  const field = (id, label, type = "text", extra = "") =>
    `<div class="field"><label for="f_${id}">${label}</label><input class="input" id="f_${id}" type="${type}" value="${esc(f[id])}" ${extra}></div>`;
  return `
  <div class="modal-backdrop" id="dealbackdrop">
    <div class="modal" role="dialog" aria-labelledby="dealtitle">
      <div class="modal-head"><h3 id="dealtitle">${f.groupId ? "Edit deal" : "New deal"}</h3><button class="modal-close" id="dealclose" aria-label="Close">×</button></div>
      <div class="modal-body">${dl}
        <div class="form-grid">
          ${field("deal_date", "Deal date", "date")}
          <div class="field"><label for="f_deal_type">Type</label><select class="input" id="f_deal_type">${typeOpts}</select></div>
          ${field("unit", "Unit")}
          ${field("agent", "Agent", "text", 'list="agentlist"')}
          ${field("agent2", "Agent 2 (shared deal)", "text", 'list="agentlist" placeholder="Leave empty if solo"')}
          ${field("third_party", "Third party", "text", 'placeholder="e.g. KDK Real Estate (AED 6,035.5)"')}
          ${field("building", "Building")}
          ${field("area", "Area")}
          ${field("price", "Annual rent / sale price", "number")}
          <div class="form-section">Commission — auto-calculated, editable</div>
          ${field("total_commission", "Total commission", "number")}
          ${field("commission_received", "Commission received", "number")}
          ${field("vat", "VAT @ 5%", "number")}
          ${field("commission_ex_vat", "Commission ex-VAT", "number")}
          ${field("agent_business", "Agent business", "number")}
          <div class="field"></div>
          ${field("company_share", "Company 50%", "number")}
          ${field("agent_share", "Agent 50%", "number")}
          ${field("payment_method", "Payment / remarks")}
          <div class="form-section">Tenancy contract</div>
          ${field("tc_start", "TC start", "date")}
          ${field("duration", "Duration (months)", "number")}
          ${field("tc_end", "TC end (auto)", "date")}
          ${field("security_deposit", "Security deposit", "number")}
          ${field("cheque_count", "No. of cheques")}
          ${field("bank", "Bank")}
          ${field("landlord", "Landlord (L.L name)")}
          ${field("tenant", "Tenant")}
          <div class="form-note">Shared deals: filling Agent 2 saves two mirrored register rows and both agents' ledger entries, linked together.</div>
        </div>
        <div class="modal-actions">
          <span class="form-msg" id="dealmsg">${esc(f.msg)}</span>
          <button class="btn btn-secondary" id="dealcancel">Cancel</button>
          <button class="btn btn-primary" id="dealsave">${f.groupId ? "Save changes" : "Save deal"}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function collectDealForm() {
  const f = state.dealForm;
  ["deal_date","deal_type","unit","agent","agent2","third_party","building","area","price",
   "total_commission","commission_received","vat","commission_ex_vat","agent_business",
   "company_share","agent_share","payment_method","tc_start","duration","tc_end",
   "security_deposit","cheque_count","bank","landlord","tenant"].forEach((k) => {
    const el = document.getElementById("f_" + k); if (el) f[k] = el.value;
  });
}
function dealAutoMath() {
  collectDealForm();
  const f = state.dealForm;
  const calculated = calculateDealCommission(f.total_commission, f.commission_received, !!f.agent2.trim());
  if (calculated) {
    f.vat = calculated.vat;
    f.commission_ex_vat = calculated.commissionExVat;
    f.agent_business = calculated.agentBusiness;
    f.company_share = calculated.companyShare;
    f.agent_share = calculated.agentShare;
  }
  ["vat","commission_ex_vat","agent_business","company_share","agent_share"].forEach((k) => {
    const el = document.getElementById("f_" + k); if (el) el.value = f[k];
  });
}
function dealAutoEnd() {
  collectDealForm();
  const f = state.dealForm;
  const calculatedEnd = calculateContractEnd(f.tc_start, f.duration);
  if (calculatedEnd) {
    f.tc_end = calculatedEnd;
    const el = document.getElementById("f_tc_end"); if (el) el.value = f.tc_end;
  }
}
async function saveDeal() {
  collectDealForm();
  const f = state.dealForm;
  const msgEl = document.getElementById("dealmsg");
  if (!f.deal_date || !f.agent.trim() || !f.building.trim()) { msgEl.textContent = "Date, agent, and building are required."; return; }
  const btn = document.getElementById("dealsave"); btn.disabled = true; btn.textContent = "Saving…";
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const txt = (v, fb = null) => v && String(v).trim() ? String(v).trim() : fb;
  const groupId = f.groupId || crypto.randomUUID();
  const month = f.deal_date.slice(0, 7);
  const agent1 = f.agent.trim(), agent2 = f.agent2.trim();
  const base = {
    group_id: groupId, deal_date: f.deal_date, month,
    third_party: txt(f.third_party, "N/A"),
    deal_type: f.deal_type, unit: txt(f.unit), building: txt(f.building), area: txt(f.area),
    price: num(f.price), total_commission: num(f.total_commission),
    commission_received: num(f.commission_received), vat: num(f.vat),
    commission_ex_vat: num(f.commission_ex_vat), agent_business: num(f.agent_business),
    company_share: num(f.company_share), agent_share: num(f.agent_share),
    payment_method: txt(f.payment_method),
    tc_start: f.tc_start || null, contract_duration: txt(f.duration),
    tc_end: f.tc_end || null,
    security_deposit: num(f.security_deposit), cheque_count: txt(f.cheque_count),
    landlord: txt(f.landlord), tenant: txt(f.tenant), bank: txt(f.bank),
  };
  const maxSno = state.deals.reduce((m, d) => Math.max(m, d.sno || 0), 0);
  const dealRows = [{ ...base, sno: maxSno + 1, agent: agent1, agent2: agent2 || "N/A" }];
  if (agent2) dealRows.push({ ...base, sno: maxSno + 2, agent: agent2, agent2: agent1 });
  const commissionRows = [agent1, agent2].filter(Boolean).map((name, i, arr) => ({
    group_id: groupId, agent_name: name.toUpperCase(), entry_date: f.deal_date,
    third_party: base.third_party, agent2: arr.length === 2 ? arr[1 - i] : "N/A",
    deal_type: f.deal_type, unit: base.unit, building: base.building, area: base.area,
    annual_value: base.price, total_commission: base.total_commission,
    received: base.commission_received, vat: base.vat, commission_ex_vat: base.commission_ex_vat,
    agent_business: base.agent_business, xsite_share: base.company_share,
    agent_share: base.agent_share, month,
  }));
  const { error } = await supabase.rpc("save_deal_group", {
    p_group_id: groupId,
    p_deals: dealRows,
    p_commission: commissionRows,
    p_replace: !!f.groupId,
  });
  if (error) {
    msgEl.textContent = error.message;
    btn.disabled = false;
    btn.textContent = f.groupId ? "Save changes" : "Save deal";
    return;
  }
  if (!await reloadAfterWrite(reloadDeals, "Deal")) return;
  state.txMonth = month;
  state.dealForm = null;
  render();
}
async function deleteDeal(id) {
  const d = state.deals.find((x) => x.id === id);
  if (!d) return;
  const group = state.deals.filter((x) => x.group_id === d.group_id);
  const label = `${d.unit || ""} ${d.building || ""} (${d.agent}${group.length > 1 ? " + mirror row" : ""})`;
  if (!window.confirm(`Delete this deal and its linked entries?\n${label}`)) return;
  const { error } = await supabase.rpc("delete_deal_group", { p_group_id: d.group_id });
  if (error) { window.alert("Could not delete: " + error.message); return; }
  if (!await reloadAfterWrite(reloadDeals, "Deal deletion")) return;
  render();
}

// ── view: invoices & receipts ────────────────────────────
function dealGroupOptions() {
  const seen = new Set();
  return state.deals.filter((d) => !seen.has(d.group_id) && seen.add(d.group_id))
    .map((d) => ({ group: d.group_id, label: `${d.sno ?? "—"} · ${d.unit || ""} ${d.building || ""} — ${d.agent}`.trim(), deal: d }));
}
function dealLabelFor(group) {
  const opt = dealGroupOptions().find((o) => o.group === group);
  return opt ? opt.label : "(deal removed)";
}
function viewInvoices() {
  const canEdit = roleIn("owner", "accounts");
  const months = [...new Set([...availableMonths(state.docs, "month"), ...availableMonths(state.deals, "month")])].sort().reverse();
  const monthTabs = months.map((m) =>
    `<button class="tab ${state.invMonth === m ? "is-active" : ""}" data-invmonth="${m}">${monthLabel(m)}</button>`).join("");
  const typeTabs = ["All", "Invoices", "Receipts"].map((t) =>
    `<button class="tab ${state.invType === t ? "is-active" : ""}" data-invtype="${t}">${t}</button>`).join("");
  const q = state.invQuery.trim().toLowerCase();
  const rows = state.docs.filter((d) =>
    (!state.invMonth || d.month === state.invMonth) &&
    (state.invType === "All" || (state.invType === "Invoices" ? d.doc_type === "invoice" : d.doc_type === "receipt")) &&
    (!q || [d.doc_no, d.client, d.description, d.payment_method, dealLabelFor(d.deal_group)].join(" ").toLowerCase().includes(q)));
  const monthDocs = state.docs.filter((d) => d.month === state.invMonth);
  const sumWhere = (fn) => monthDocs.filter(fn).reduce((s, d) => s + (+d.amount || 0), 0);
  const received = sumWhere((d) => d.doc_type === "receipt");
  const invoiced = sumWhere((d) => d.doc_type === "invoice");
  const pending = sumWhere((d) => d.doc_type === "invoice" && d.status === "pending");
  const statusTag = (d) => d.status === "pending" ? `<span class="tag tag-accent">pending</span>`
    : `<span class="tag tag-neutral">${esc(d.status)}</span>`;
  const body = rows.map((d) => `<tr>
    <td>${esc(d.doc_no)}</td><td>${esc(showDate(d.doc_date))}</td>
    <td>${d.doc_type === "invoice" ? "Invoice" : "Receipt"}</td>
    <td>${esc(dealLabelFor(d.deal_group))}</td>
    <td>${esc(d.client || "—")}</td><td>${esc(d.description || "—")}</td>
    <td class="numeric">${money(d.amount)}</td>
    <td>${statusTag(d)}</td><td>${esc(d.payment_method || "—")}</td>
    ${canEdit ? `<td><div class="row-actions">
      ${d.doc_type === "invoice" ? `<button class="btn btn-secondary btn-mini" data-invpdf="${d.id}">Invoice PDF</button>` : ""}
      ${d.doc_type === "invoice" && d.status === "pending" ? `<button class="btn btn-primary btn-mini" data-markpaid="${d.id}">Mark paid</button>` : ""}
      <button class="btn btn-secondary btn-mini" data-editdoc="${d.id}">Edit</button>
      <button class="btn btn-secondary btn-mini" data-deletedoc="${d.id}">Delete</button>
    </div></td>` : ""}</tr>`).join("");
  return `
  <div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Accounts / Money</span><h1 style="margin-top:4px">Invoices &amp; Receipts</h1><p class="text-muted" style="margin:0">Every document links to a register deal — ${monthLabel(state.invMonth)}.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" id="exportdocs">Export CSV</button>
        <button class="btn btn-primary" id="newdoc">+ New receipt / invoice</button>
      </div>
    </div>
    ${contractHandoffSection()}
    <section class="md-kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:20px">
      <div class="md-kpi is-accent"><span class="card-kicker">Receipts — ${monthLabel(state.invMonth)}</span><span class="md-kpi-value">${money(Math.round(received))}</span><span class="md-kpi-detail">${monthDocs.filter((d)=>d.doc_type==="receipt").length} receipts recorded</span></div>
      <div class="md-kpi"><span class="card-kicker">Invoiced</span><span class="md-kpi-value">${money(Math.round(invoiced))}</span><span class="md-kpi-detail">${monthDocs.filter((d)=>d.doc_type==="invoice").length} invoices raised</span></div>
      <div class="md-kpi"><span class="card-kicker">Pending invoices</span><span class="md-kpi-value">${money(Math.round(pending))}</span><span class="md-kpi-detail">${monthDocs.filter((d)=>d.doc_type==="invoice"&&d.status==="pending").length} awaiting payment</span></div>
    </section>
    <div class="tx-toolbar">
      ${months.length ? `<div class="tabs">${monthTabs}</div>` : ""}
      <input class="input" id="invq" type="search" placeholder="Search doc no, client, deal…" value="${esc(state.invQuery)}">
      <div class="tabs">${typeTabs}</div>
      <span class="text-muted" style="font-size:12px">${rows.length} documents</span>
    </div>
    <div class="sheet">
      <div class="sheet-hint">Documents — newest number first</div>
      <div class="table-wrap"><table class="grid" style="min-width:1100px">
        <thead><tr><th>Doc no</th><th>Date</th><th>Type</th><th>Deal</th><th>Client</th><th>Description</th><th>Amount</th><th>Status</th><th>Payment</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>${body || `<tr><td colspan="10"><div class="md-empty" style="border:0">No documents in ${monthLabel(state.invMonth)} yet.</div></td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
}

// ── doc modal ────────────────────────────────────────────
function emptyDocForm() {
  return { id: null, doc_type: "receipt", dealLabel: "", client: "", description: "",
    amount: "", doc_date: todayIso(), payment_method: "", msg: "" };
}
function docFormFromRow(d) {
  return { id: d.id, doc_type: d.doc_type, dealLabel: dealLabelFor(d.deal_group),
    client: d.client || "", description: d.description || "", amount: d.amount ?? "",
    doc_date: d.doc_date || "", payment_method: d.payment_method || "", msg: "", status: d.status };
}
function viewDocModal() {
  const f = state.docForm;
  if (!f) return "";
  const opts = dealGroupOptions();
  const dl = `<datalist id="deallist">${opts.map((o) => `<option value="${esc(o.label)}">`).join("")}</datalist>`;
  return `
  <div class="modal-backdrop">
    <div class="modal" style="width:min(640px,100%)" role="dialog" aria-labelledby="doctitle">
      <div class="modal-head"><h3 id="doctitle">${f.id ? "Edit document" : "New receipt / invoice"}</h3><button class="modal-close" id="docclose" aria-label="Close">×</button></div>
      <div class="modal-body">${dl}
        <div class="form-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="field"><label for="d_type">Type</label>
            <select class="input" id="d_type" ${f.id ? "disabled" : ""}>
              <option value="receipt" ${f.doc_type === "receipt" ? "selected" : ""}>Receipt — money received</option>
              <option value="invoice" ${f.doc_type === "invoice" ? "selected" : ""}>Invoice — payment requested</option>
            </select></div>
          <div class="field"><label for="d_date">Date</label><input class="input" id="d_date" type="date" value="${esc(f.doc_date)}"></div>
          <div class="field" style="grid-column:1/-1"><label for="d_deal">Deal (required — type to search the register)</label>
            <input class="input" id="d_deal" list="deallist" value="${esc(f.dealLabel)}" placeholder="e.g. 47 · 208 Herad Tower — Saheer Salim"></div>
          <div class="field"><label for="d_client">Client</label><input class="input" id="d_client" value="${esc(f.client)}"></div>
          <div class="field"><label for="d_amount">Amount (AED)</label><input class="input" id="d_amount" type="number" value="${esc(f.amount)}"></div>
          <div class="field" style="grid-column:1/-1"><label for="d_desc">Description</label><input class="input" id="d_desc" value="${esc(f.description)}"></div>
          <div class="field" style="grid-column:1/-1"><label for="d_pay">Payment method / reference</label><input class="input" id="d_pay" value="${esc(f.payment_method)}"></div>
          <div class="form-note">Picking a deal pre-fills client, description, and amount — edit freely. Receipts save as received; invoices start pending.</div>
        </div>
        <div class="modal-actions">
          <span class="form-msg" id="docmsg">${esc(f.msg)}</span>
          <button class="btn btn-secondary" id="doccancel">Cancel</button>
          <button class="btn btn-primary" id="docsave">${f.id ? "Save changes" : "Save"}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function docPrefill() {
  const label = document.getElementById("d_deal").value;
  const opt = dealGroupOptions().find((o) => o.label === label);
  if (!opt) return;
  const d = opt.deal;
  const setIfEmpty = (id, v) => { const el = document.getElementById(id); if (el && !el.value) el.value = v ?? ""; };
  setIfEmpty("d_client", d.tenant || d.landlord || "");
  setIfEmpty("d_desc", `Commission — ${d.unit || ""} ${d.building || ""}`.trim());
  setIfEmpty("d_amount", d.commission_received ?? "");
}
async function saveDoc() {
  const f = state.docForm;
  const g = (id) => document.getElementById(id).value;
  const label = g("d_deal");
  const opt = dealGroupOptions().find((o) => o.label === label);
  const msgEl = document.getElementById("docmsg");
  if (!opt) { msgEl.textContent = "Pick a deal from the register list."; return; }
  if (!g("d_amount") || !g("d_date")) { msgEl.textContent = "Date and amount are required."; return; }
  const type = g("d_type");
  const btn = document.getElementById("docsave"); btn.disabled = true; btn.textContent = "Saving…";
  const rec = {
    doc_type: type, deal_group: opt.group, client: g("d_client") || null,
    description: g("d_desc") || null, amount: parseFloat(g("d_amount")),
    doc_date: g("d_date"), month: g("d_date").slice(0, 7),
    payment_method: g("d_pay") || null,
    status: type === "receipt" ? "received" : (f.status === "paid" ? "paid" : "pending"),
  };
  let error;
  if (f.id) {
    ({ error } = await supabase.from("money_docs").update(rec).eq("id", f.id));
  } else {
    ({ error } = await supabase.rpc("create_money_doc", {
      p_doc_type: rec.doc_type,
      p_deal_group: rec.deal_group,
      p_doc_date: rec.doc_date,
      p_client: rec.client,
      p_description: rec.description,
      p_amount: rec.amount,
      p_payment_method: rec.payment_method,
      p_status: rec.status,
    }));
  }
  if (error) { msgEl.textContent = error.message; btn.disabled = false; btn.textContent = "Save"; return; }
  if (!await reloadAfterWrite(reloadDocs, "Document")) return;
  state.invMonth = rec.month;
  state.docForm = null;
  render();
}
async function markPaid(id) {
  const { error } = await supabase.rpc("mark_invoice_paid", {
    p_doc_id: id,
    p_paid_date: todayIso(),
  });
  if (error) { window.alert("Could not update: " + error.message); return; }
  if (!await reloadAfterWrite(reloadDocs, "Invoice payment")) return;
  render();
}
async function deleteDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d || !window.confirm(`Delete ${d.doc_no} (${money(d.amount)})?`)) return;
  const { error } = await supabase.from("money_docs").delete().eq("id", id);
  if (error) { window.alert("Could not delete: " + error.message); return; }
  if (!await reloadAfterWrite(reloadDocs, "Document deletion")) return;
  render();
}

// ── cash snapshot modal ──────────────────────────────────
function viewCashModal() {
  const f = state.cashForm;
  if (!f) return "";
  const rows = f.lines.map((l, i) => `
    <tr>
      <td><input class="input" data-cl-label="${i}" value="${esc(l.label)}" style="min-width:260px"></td>
      <td><input class="input" data-cl-amount="${i}" type="number" value="${esc(l.amount ?? "")}" placeholder="—"></td>
      <td><button class="btn btn-secondary btn-mini" data-cl-remove="${i}">Remove</button></td>
    </tr>`).join("");
  return `
  <div class="modal-backdrop">
    <div class="modal" style="width:min(680px,100%)" role="dialog" aria-labelledby="cashtitle">
      <div class="modal-head"><h3 id="cashtitle">Update cash position</h3><button class="modal-close" id="cashclose" aria-label="Close">×</button></div>
      <div class="modal-body">
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="c_asat">As at date</label><input class="input" id="c_asat" type="date" value="${esc(f.as_at)}"></div>
          <div class="form-note" style="align-self:end">Saving records a new snapshot for this date. Earlier snapshots stay in history.</div>
        </div>
        <table class="grid" style="margin-top:12px;width:100%">
          <thead><tr><th>Line</th><th>Amount (AED)</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="btn btn-secondary btn-mini" id="cashaddline" style="margin-top:10px">+ Add line</button>
        <div class="modal-actions">
          <span class="form-msg" id="cashmsg">${esc(f.msg || "")}</span>
          <button class="btn btn-secondary" id="cashcancel">Cancel</button>
          <button class="btn btn-primary" id="cashsave">Save snapshot</button>
        </div>
      </div>
    </div>
  </div>`;
}
function collectCashForm() {
  const f = state.cashForm;
  if (!f) return;
  f.as_at = document.getElementById("c_asat").value;
  f.lines.forEach((l, i) => {
    l.label = document.querySelector(`[data-cl-label="${i}"]`)?.value ?? l.label;
    const amt = document.querySelector(`[data-cl-amount="${i}"]`)?.value;
    l.amount = amt === "" || amt === undefined ? null : parseFloat(amt);
  });
}
function openCashForm() {
  const dates = availableMonths(state.cash, "as_at");
  const latest = state.cash.filter((c) => c.as_at === dates[0]);
  state.cashForm = {
    as_at: todayIso(),
    lines: latest.map((c) => ({ label: c.label, amount: c.amount === null ? null : +c.amount })),
    msg: "",
  };
  render();
}
async function saveCashSnapshot() {
  collectCashForm();
  const f = state.cashForm;
  const msgEl = document.getElementById("cashmsg");
  const lines = f.lines.filter((l) => l.label.trim());
  if (!f.as_at || !lines.length) { msgEl.textContent = "Date and at least one line are required."; return; }
  const btn = document.getElementById("cashsave"); btn.disabled = true; btn.textContent = "Saving…";
  const rows = lines.map((l, i) => ({ label: l.label.trim(), amount: l.amount, sort_order: i }));
  const { error } = await supabase.rpc("save_cash_snapshot", { p_as_at: f.as_at, p_lines: rows });
  if (error) { msgEl.textContent = error.message; btn.disabled = false; btn.textContent = "Save snapshot"; return; }
  if (!await reloadAfterWrite(reloadCash, "Cash snapshot")) return;
  state.cashForm = null;
  render();
}

// ── password modal ───────────────────────────────────────
function viewPwModal() {
  if (!state.pwForm) return "";
  return `
  <div class="modal-backdrop" id="pwbackdrop">
    <div class="modal" style="width:min(420px,100%)" role="dialog" aria-labelledby="pwtitle">
      <div class="modal-head"><h3 id="pwtitle">Change password</h3><button class="modal-close" id="pwclose" aria-label="Close">×</button></div>
      <div class="modal-body">
        <div class="field"><label for="pw1" style="display:block;margin-bottom:5px;font-size:12px;font-weight:700">New password (min 8 characters)</label>
        <input class="input" id="pw1" type="password" autocomplete="new-password"></div>
        <div class="modal-actions">
          <span class="form-msg" id="pwmsg"></span>
          <button class="btn btn-secondary" id="pwcancel">Cancel</button>
          <button class="btn btn-primary" id="pwsave">Update password</button>
        </div>
      </div>
    </div>
  </div>`;
}
async function savePassword() {
  const pw = document.getElementById("pw1").value;
  const msgEl = document.getElementById("pwmsg");
  if (pw.length < 8) { msgEl.textContent = "Minimum 8 characters."; return; }
  const btn = document.getElementById("pwsave"); btn.disabled = true; btn.textContent = "Updating…";
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) { msgEl.textContent = error.message; btn.disabled = false; btn.textContent = "Update password"; return; }
  state.pwForm = false; render();
}

// ── tax invoice draft + print ────────────────────────────
function invoiceDraftFor(doc) {
  const deal = (state.deals.find((d) => d.group_id === doc.deal_group) || {});
  const d = doc.details || {};
  const unit = deal.unit ? `Unit No ${deal.unit}` : "";
  const refBuilding = [unit, deal.building, deal.area].filter(Boolean).join(", ");
  return {
    id: doc.id,
    status: doc.status,
    invoice_number: d.invoice_number || doc.doc_no || "",
    invoice_date: d.invoice_date || doc.doc_date || todayIso(),
    due_date: d.due_date || doc.doc_date || todayIso(),
    client_name: d.client_name || doc.client || "",
    client_address: d.client_address || "",
    client_trn: d.client_trn || "",
    reference: d.reference || refBuilding,
    agent: d.agent || deal.agent || "",
    buyer_name: d.buyer_name || deal.tenant || deal.landlord || "",
    description: d.description || doc.description ||
      (refBuilding ? `Agency fee against ${refBuilding}.` : "Agency fee"),
    quantity: d.quantity != null ? d.quantity : 1,
    unit_price: d.unit_price != null ? d.unit_price : (doc.amount ?? 0),
    vat_rate: d.vat_rate != null ? d.vat_rate : 5,
    signed: d.signed != null ? d.signed : true,
  };
}
function openInvoicePrint(id) {
  const doc = state.docs.find((x) => x.id === id);
  if (!doc) return;
  state.printInvoice = invoiceDraftFor(doc);
  render();
}
function viewInvoicePrint() {
  const f = state.printInvoice;
  if (!f) return "";
  const canEdit = roleIn("owner", "accounts");
  const subtotal = (Number(f.quantity) || 0) * (Number(f.unit_price) || 0);
  const vat = subtotal * (Number(f.vat_rate) || 0) / 100;
  const total = subtotal + vat;
  const inp = (id, val, extra = "") => `<input class="inv-in" id="iv_${id}" value="${esc(val)}" ${extra} ${canEdit ? "" : "readonly"}>`;
  const ta = (id, val) => `<textarea class="inv-in inv-ta" id="iv_${id}" rows="3" ${canEdit ? "" : "readonly"}>${esc(val)}</textarea>`;
  return `<div class="inv-print-shell" role="dialog" aria-modal="true" aria-label="Invoice preview" tabindex="-1">
    <div class="contract-print-toolbar inv-toolbar">
      <div><strong>Tax Invoice</strong><div>${esc(f.invoice_number)}${f.status !== "paid" ? " · DRAFT" : ""}</div></div>
      <div style="display:flex;align-items:center;gap:12px">
        ${canEdit ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap"><input type="checkbox" id="invsigned" ${f.signed ? "checked" : ""}>Signature &amp; stamp</label>` : ""}
        <button class="btn btn-secondary" id="invclose">Back</button>
        ${canEdit ? `<button class="btn btn-secondary" id="invsave">Save draft</button>` : ""}
        <button class="btn btn-primary" id="invprint">Print / Save PDF</button>
      </div>
    </div>
    <div class="inv-sheet">
      ${f.status !== "paid" ? `<div class="inv-watermark">DRAFT</div>` : ""}
      <div class="inv-head">
        <h1 class="inv-title">TAX INVOICE</h1>
        <img class="inv-logo" src="./xsite-logo.png" alt="Xsite">
      </div>
      <div class="inv-meta">
        <div class="inv-billto">
          ${inp("client_name", f.client_name, 'placeholder="Client / company name" style="font-weight:700"')}
          ${ta("client_address", f.client_address)}
          <label class="inv-lbl">TRN</label>${inp("client_trn", f.client_trn)}
        </div>
        <div class="inv-fields">
          <label class="inv-lbl">Invoice Date</label>${inp("invoice_date", f.invoice_date, 'type="date"')}
          <label class="inv-lbl">Invoice Number</label>${inp("invoice_number", f.invoice_number)}
          <label class="inv-lbl">Reference</label>${ta("reference", f.reference)}
          <label class="inv-lbl">Agent</label>${inp("agent", f.agent)}
        </div>
        <div class="inv-company">
          <strong>${esc(XSITE_CO.name)}</strong>
          ${XSITE_CO.addressLines.map((l) => `<div>${esc(l)}</div>`).join("")}
          <div>${esc(XSITE_CO.trn)}</div>
          <div>${esc(XSITE_CO.email)}</div>
        </div>
      </div>
      <table class="inv-items">
        <thead><tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit Price</th><th class="num">Amount AED</th></tr></thead>
        <tbody>
          <tr>
            <td>${ta("description", f.description)}<div class="inv-buyer">(Buyer Name: ${inp("buyer_name", f.buyer_name, 'style="width:auto;display:inline-block;min-width:220px"')})</div></td>
            <td class="num">${inp("quantity", f.quantity, 'type="number" step="0.01" style="width:70px;text-align:right"')}</td>
            <td class="num">${inp("unit_price", f.unit_price, 'type="number" step="0.01" style="width:120px;text-align:right"')}</td>
            <td class="num" id="iv_amount">${num2(subtotal)}</td>
          </tr>
        </tbody>
      </table>
      <div class="inv-totals">
        <div class="inv-total-row"><span>Subtotal</span><strong id="iv_subtotal">${num2(subtotal)}</strong></div>
        <div class="inv-total-row"><span>TOTAL VAT ON SALES ${inp("vat_rate", f.vat_rate, 'type="number" step="0.01" style="width:56px;text-align:right;display:inline-block"')}%</span><strong id="iv_vat">${num2(vat)}</strong></div>
        <div class="inv-total-row is-grand"><span>TOTAL AED</span><strong id="iv_total">${num2(total)}</strong></div>
      </div>
      <div class="inv-foot">
        <div class="inv-due"><strong>Due Date:</strong> ${inp("due_date", f.due_date, 'type="date" style="width:auto;display:inline-block"')}</div>
        <div class="inv-bank">${XSITE_CO.bank.map(([k, v]) => `<div>${esc(k)} - ${esc(v)}</div>`).join("")}</div>
        <div class="inv-sign">
          ${f.signed ? `<img class="inv-sign-img" src="./contract-assets/invoice-signature.png" alt="Authorised signature">
          <img class="inv-stamp-img" src="./contract-assets/invoice-stamp.png" alt="Company stamp">` : ""}
          <div class="inv-sign-label">Authorised signatory · Xsite Real Estate Brokers L.L.C</div>
        </div>
      </div>
      <div class="inv-registered">${esc(XSITE_CO.registered)}</div>
    </div>
  </div>`;
}
function invoiceRecalc() {
  const f = state.printInvoice; if (!f) return;
  const g = (id) => document.getElementById("iv_" + id);
  const qty = Number(g("quantity")?.value) || 0;
  const price = Number(g("unit_price")?.value) || 0;
  const rate = Number(g("vat_rate")?.value) || 0;
  const subtotal = qty * price, vat = subtotal * rate / 100, total = subtotal + vat;
  if (g("amount")) g("amount").textContent = num2(subtotal);
  if (g("subtotal")) g("subtotal").textContent = num2(subtotal);
  if (g("vat")) g("vat").textContent = num2(vat);
  if (g("total")) g("total").textContent = num2(total);
}
function readInvoiceForm() {
  const f = state.printInvoice;
  const g = (id) => document.getElementById("iv_" + id);
  ["invoice_number", "invoice_date", "due_date", "client_name", "client_address", "client_trn",
   "reference", "agent", "buyer_name", "description", "quantity", "unit_price", "vat_rate"].forEach((k) => {
    if (g(k)) f[k] = g(k).value;
  });
  const cb = document.getElementById("invsigned"); if (cb) f.signed = cb.checked;
}
async function saveInvoiceDraft() {
  readInvoiceForm();
  const f = state.printInvoice;
  const btn = document.getElementById("invsave"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const details = {
    invoice_number: f.invoice_number, invoice_date: f.invoice_date, due_date: f.due_date,
    client_name: f.client_name, client_address: f.client_address, client_trn: f.client_trn,
    reference: f.reference, agent: f.agent, buyer_name: f.buyer_name, description: f.description,
    quantity: Number(f.quantity) || 0, unit_price: Number(f.unit_price) || 0, vat_rate: Number(f.vat_rate) || 0,
    signed: !!f.signed,
  };
  const amount = details.quantity * details.unit_price;
  const { error } = await supabase.from("money_docs").update({ details, amount, client: f.client_name, doc_date: f.invoice_date }).eq("id", f.id);
  if (error) { if (btn) { btn.disabled = false; btn.textContent = "Save draft"; } window.alert("Could not save: " + error.message); return; }
  await reloadDocs();
  if (btn) { btn.disabled = false; btn.textContent = "Saved ✓"; }
}

// ── view: agent ledgers ──────────────────────────────────
function ledgerAgentNames() {
  if (state.profile.role === "agent") return state.profile.agent_name ? [state.profile.agent_name] : [];
  return [...new Set(state.commission.map((r) => r.agent_name))].sort();
}
function viewLedgers() {
  const names = ledgerAgentNames();
  const q = state.ledgerQuery.trim().toLowerCase();
  const filtered = names.filter((n) => !q || n.toLowerCase().includes(q));
  if (!state.selectedAgent || !names.includes(state.selectedAgent)) state.selectedAgent = names[0] || null;
  const lmonths = availableMonths(state.commission, "month");
  const lmonthTabs = lmonths.map((m) =>
    `<button class="tab ${state.ledgerMonth === m ? "is-active" : ""}" data-ledgermonth="${m}">${monthLabel(m)}</button>`).join("");
  const rows = state.commission.filter((r) => r.agent_name === state.selectedAgent && (!state.ledgerMonth || r.month === state.ledgerMonth));
  const sum = (k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  const list = filtered.map((n) => `
    <button class="ledger-agent ${n === state.selectedAgent ? "is-active" : ""}" data-agent="${esc(n)}">
      <span class="ledger-avatar">${esc(n.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>
      <span style="min-width:0"><span style="display:block;font-weight:700;font-size:13px">${esc(n)}</span></span>
    </button>`).join("");
  const sheet = state.selectedAgent ? `
    <div class="ledger-metrics">
      <div class="ledger-metric"><span class="ledger-metric-label">Commission received</span><span class="ledger-metric-value">${money(Math.round(sum("received")))}</span></div>
      <div class="ledger-metric"><span class="ledger-metric-label">VAT @ 5%</span><span class="ledger-metric-value">${money(Math.round(sum("vat")))}</span></div>
      <div class="ledger-metric is-accent"><span class="ledger-metric-label">Agent share</span><span class="ledger-metric-value">${money(Math.round(sum("agent_share")))}</span></div>
      <div class="ledger-metric"><span class="ledger-metric-label">Deals</span><span class="ledger-metric-value">${rows.length}</span></div>
    </div>
    <div class="sheet"><div class="sheet-hint">${esc(state.selectedAgent)} — ${monthLabel(state.ledgerMonth)} commission statement</div>
    <div class="table-wrap"><table class="grid wide">
      <thead><tr><th>Date</th><th>Third party</th><th>Agent 2</th><th>Type</th><th>Unit</th><th>Building</th><th>Area</th><th>Annual value</th><th>Total commission</th><th>Received</th><th>VAT</th><th>Ex-VAT</th><th>Agent business</th><th>Xsite share</th><th>Agent share</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(showDate(r.entry_date, r.entry_date_raw))}</td><td class="tp-cell">${esc(r.third_party || "—")}</td><td>${esc(r.agent2 || "—")}</td><td>${esc(r.deal_type)}</td><td class="unit-cell">${esc(r.unit)}</td><td>${esc(r.building)}</td><td>${esc(r.area)}</td><td class="numeric">${money(r.annual_value)}</td><td class="numeric">${money(r.total_commission)}</td><td class="numeric">${money(r.received)}</td><td class="numeric">${money(r.vat)}</td><td class="numeric">${money(r.commission_ex_vat)}</td><td class="numeric">${money(r.agent_business)}</td><td class="numeric">${money(r.xsite_share)}</td><td class="numeric">${money(r.agent_share)}</td></tr>`).join("")}</tbody>
    </table></div></div>` : `<div class="md-empty">No commission records to show.</div>`;
  return `
  <div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Accounts / Commissions</span><h1 style="margin-top:4px">${state.profile.role === "agent" ? "My Commission Ledger" : "Agent Commission Ledgers"}</h1><p class="text-muted" style="margin:0">${monthLabel(state.ledgerMonth)} statements with VAT and 50/50 share.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" id="exportledger">Export CSV</button><button class="btn btn-secondary" id="printledger">Print statement</button></div>
    </div>\n    <div class="tabs" style="margin-bottom:16px">${lmonthTabs}</div>
    <div class="ledger-layout">
      <aside class="ledger-panel">
        ${state.profile.role !== "agent" ? `<input class="input" id="lq" type="search" placeholder="Search agents…" value="${esc(state.ledgerQuery)}" style="margin-bottom:12px">` : ""}
        ${list || `<div class="md-empty">No agents.</div>`}
      </aside>
      <div style="min-width:0">${sheet}</div>
    </div>
  </div>`;
}

function exportTransactions() {
  const q = state.txQuery.trim().toLowerCase();
  const rows = state.deals.filter((d) =>
    (!state.txMonth || d.month === state.txMonth) &&
    (state.txType === "All" || (d.deal_type || "").replace("Off plan", "Off Plan") === state.txType) &&
    (!q || [d.agent, d.agent2, d.third_party, d.building, d.unit, d.area, d.landlord, d.tenant, d.payment_method].join(" ").toLowerCase().includes(q)));
  downloadCsv(`xsite-transactions-${state.txMonth || "all"}.csv`, rows, [
    ["S.No", "sno"], ["Date", "deal_date"], ["Agent", "agent"], ["Agent 2", "agent2"],
    ["Third party", "third_party"], ["Type", "deal_type"], ["Unit", "unit"], ["Building", "building"],
    ["Area", "area"], ["Rent / Sale price", "price"], ["Total commission", "total_commission"],
    ["Commission received", "commission_received"], ["Landlord", "landlord"], ["Tenant", "tenant"],
    ["TC start", "tc_start"], ["TC end", "tc_end"], ["Security deposit", "security_deposit"],
    ["Cheques", "cheque_count"], ["Payment", "payment_method"],
  ]);
}

function exportDocuments() {
  const q = state.invQuery.trim().toLowerCase();
  const rows = state.docs.filter((d) =>
    (!state.invMonth || d.month === state.invMonth) &&
    (state.invType === "All" || (state.invType === "Invoices" ? d.doc_type === "invoice" : d.doc_type === "receipt")) &&
    (!q || [d.doc_no, d.client, d.description, d.payment_method, dealLabelFor(d.deal_group)].join(" ").toLowerCase().includes(q)))
    .map((d) => ({ ...d, deal: dealLabelFor(d.deal_group) }));
  downloadCsv(`xsite-documents-${state.invMonth || "all"}.csv`, rows, [
    ["Document no", "doc_no"], ["Date", "doc_date"], ["Type", "doc_type"], ["Deal", "deal"],
    ["Client", "client"], ["Description", "description"], ["Amount", "amount"], ["Status", "status"],
    ["Payment", "payment_method"],
  ]);
}

function exportLedger() {
  const rows = state.commission.filter((r) => r.agent_name === state.selectedAgent && (!state.ledgerMonth || r.month === state.ledgerMonth));
  const safeAgent = (state.selectedAgent || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadCsv(`xsite-ledger-${safeAgent}-${state.ledgerMonth || "all"}.csv`, rows, [
    ["Date", "entry_date"], ["Agent", "agent_name"], ["Third party", "third_party"], ["Agent 2", "agent2"],
    ["Type", "deal_type"], ["Unit", "unit"], ["Building", "building"], ["Area", "area"],
    ["Annual value", "annual_value"], ["Total commission", "total_commission"], ["Received", "received"],
    ["VAT", "vat"], ["Commission ex-VAT", "commission_ex_vat"], ["Agent business", "agent_business"],
    ["Xsite share", "xsite_share"], ["Agent share", "agent_share"],
  ]);
}

// ── view: contacts (owner + admin) ───────────────────────
const CONTACT_TYPES = ["Buyer", "Seller", "Tenant", "Landlord"];
function emptyContactForm() {
  return { id: null, name: "", contact_type: "Tenant", phone: "", email: "", last_contact: "", birthday: "", notes: "", msg: "" };
}
function contactFormFromRow(c) {
  return { id: c.id, name: c.name || "", contact_type: c.contact_type || "Tenant", phone: c.phone || "",
    email: c.email || "", last_contact: c.last_contact || "", birthday: c.birthday || "", notes: c.notes || "", msg: "" };
}
function viewContacts() {
  const canManage = roleIn("owner", "admin");
  const q = state.contactQuery.trim().toLowerCase();
  const typeTabs = ["All", ...CONTACT_TYPES].map((t) =>
    `<button class="tab ${state.contactType === t ? "is-active" : ""}" data-contacttype="${esc(t)}">${esc(t)}${t === "All" ? ` (${state.contacts.length})` : ""}</button>`).join("");
  const rows = state.contacts.filter((c) =>
    (state.contactType === "All" || c.contact_type === state.contactType) &&
    (!q || [c.name, c.contact_type, c.phone, c.email, c.notes].join(" ").toLowerCase().includes(q)));
  const body = rows.map((c) => `<tr>
    <td><strong>${esc(c.name)}</strong></td>
    <td><span class="tag tag-neutral">${esc(c.contact_type)}</span></td>
    <td>${esc(c.phone || "—")}</td><td>${esc(c.email || "—")}</td>
    <td>${c.last_contact ? esc(showDate(c.last_contact)) : "—"}</td>
    <td class="tp-cell">${esc(c.notes || "—")}</td>
    ${canManage ? `<td><div class="row-actions"><button class="btn btn-secondary btn-mini" data-editcontact="${c.id}">Edit</button><button class="btn btn-secondary btn-mini" data-deletecontact="${c.id}">Delete</button></div></td>` : ""}</tr>`).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">CRM / Contacts</span><h1 style="margin-top:4px">Contacts</h1><p class="text-muted" style="margin:0">Buyers, sellers, tenants, and landlords — auto-synced from contracts.</p></div>
      ${canManage ? `<button class="btn btn-primary" id="newcontact">+ New contact</button>` : ""}
    </div>
    <div class="tx-toolbar">
      <div class="tabs">${typeTabs}</div>
      <input class="input" id="contactq" type="search" placeholder="Search name, phone, email, notes…" value="${esc(state.contactQuery)}">
      <span class="text-muted" style="font-size:12px">${rows.length} shown</span>
    </div>
    <div class="sheet"><div class="sheet-hint">${state.contacts.length} contact records</div>
      <div class="table-wrap"><table class="grid" style="min-width:900px">
        <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Email</th><th>Last contact</th><th>Notes</th>${canManage ? "<th></th>" : ""}</tr></thead>
        <tbody>${body || `<tr><td colspan="${canManage ? 7 : 6}"><div class="md-empty" style="border:0">No contacts match.</div></td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
}
function viewContactModal() {
  const f = state.contactForm;
  if (!f) return "";
  const typeOpts = CONTACT_TYPES.map((t) => `<option value="${t}" ${f.contact_type === t ? "selected" : ""}>${t}</option>`).join("");
  return `<div class="modal-backdrop">
    <div class="modal" style="width:min(560px,100%)" role="dialog" aria-labelledby="contacttitle">
      <div class="modal-head"><h3 id="contacttitle">${f.id ? "Edit contact" : "New contact"}</h3><button class="modal-close" id="contactclose2" aria-label="Close">×</button></div>
      <div class="modal-body">
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="co_name">Name</label><input class="input" id="co_name" maxlength="200" value="${esc(f.name)}"></div>
          <div class="field"><label for="co_type">Type</label><select class="input" id="co_type">${typeOpts}</select></div>
          <div class="field"><label for="co_phone">Phone</label><input class="input" id="co_phone" type="tel" maxlength="60" value="${esc(f.phone)}"></div>
          <div class="field"><label for="co_email">Email</label><input class="input" id="co_email" type="email" maxlength="200" value="${esc(f.email)}"></div>
          <div class="field"><label for="co_last">Last contact</label><input class="input" id="co_last" type="date" value="${esc(f.last_contact)}"></div>
          <div class="field"><label for="co_birthday">Birthday</label><input class="input" id="co_birthday" type="date" value="${esc(f.birthday)}"></div>
          <div class="field" style="grid-column:1/-1"><label for="co_notes">Notes</label><textarea class="input" id="co_notes" rows="4" maxlength="2000">${esc(f.notes)}</textarea></div>
        </div>
        <div class="modal-actions"><span class="form-msg" id="contactmsg2">${esc(f.msg || "")}</span><button class="btn btn-secondary" id="contactcancel2">Cancel</button><button class="btn btn-primary" id="contactsave2">${f.id ? "Save changes" : "Save contact"}</button></div>
      </div>
    </div>
  </div>`;
}
async function saveContactForm() {
  const f = state.contactForm;
  const g = (id) => document.getElementById(id).value;
  const msg = document.getElementById("contactmsg2");
  const name = g("co_name").trim();
  const email = g("co_email").trim();
  if (name.length < 2) { msg.textContent = "Enter a contact name."; return; }
  if (email && !document.getElementById("co_email").checkValidity()) { msg.textContent = "Enter a valid email address."; return; }
  const btn = document.getElementById("contactsave2"); btn.disabled = true; btn.textContent = "Saving…";
  const { data: savedId, error } = await supabase.rpc("save_contact", {
    p_id: f.id, p_name: name, p_contact_type: g("co_type"),
    p_phone: g("co_phone").trim() || null, p_email: email || null,
    p_notes: g("co_notes").trim() || null, p_last_contact: g("co_last") || null,
  });
  if (error) { msg.textContent = error.message; btn.disabled = false; btn.textContent = f.id ? "Save changes" : "Save contact"; return; }
  // Birthday is stored separately so the existing save_contact RPC signature
  // stays unchanged; ignored if the column has not been added yet.
  const contactId = f.id || savedId;
  if (contactId) {
    const birthdayResult = await supabase.from("contacts").update({ birthday: g("co_birthday") || null }).eq("id", contactId);
    if (birthdayResult.error) console.warn("[xsite] birthday not saved:", birthdayResult.error.message);
  }
  if (!await reloadAfterWrite(reloadContacts, "Contact")) return;
  state.contactForm = null; render();
}
async function deleteContact(id) {
  const c = state.contacts.find((x) => x.id === id);
  if (!c || !window.confirm(`Delete contact ${c.name}?`)) return;
  const { error } = await supabase.rpc("delete_contact", { p_id: id });
  if (error) { window.alert("Could not delete: " + error.message); return; }
  if (!await reloadAfterWrite(reloadContacts, "Contact deletion")) return;
  render();
}
// After a contract is saved, keep landlord + tenant in the contacts directory
// (best-effort; ignores duplicates and permission failures silently).
async function syncContractContacts(contract) {
  if (!roleIn("owner", "admin") || !contract) return;
  const parties = [
    { name: contract.p_landlord_name, type: "Landlord", phone: contract.p_owner_phone },
    { name: contract.p_tenant_name, type: "Tenant", phone: contract.p_tenant_phone },
  ];
  for (const party of parties) {
    if (!party.name || !party.name.trim()) continue;
    try { await supabase.rpc("upsert_contact_by_name", { p_name: party.name.trim(), p_contact_type: party.type, p_phone: party.phone || null }); }
    catch { /* non-fatal */ }
  }
  try { await reloadContacts(); } catch { /* non-fatal */ }
}

// ── view: cash & bank movements (owner + accounts) ───────
const CB_BANKS = ["Mashreq", "Emirates NBD Islamic", "Other bank"];
function cashBankSummary(rows) {
  const sum = (fn) => rows.filter(fn).reduce((s, r) => s + (+r.amount || 0), 0);
  const cashInHand = sum((r) => r.channel === "cash" && r.direction === "in") - sum((r) => r.channel === "cash" && r.direction === "out");
  const bankRows = rows.filter((r) => r.channel === "bank");
  const banks = [...new Set(bankRows.map((r) => r.bank_account || "Other bank"))].sort();
  const perBank = banks.map((b) => ({
    bank: b,
    net: sum((r) => r.channel === "bank" && (r.bank_account || "Other bank") === b && r.direction === "in") - sum((r) => r.channel === "bank" && (r.bank_account || "Other bank") === b && r.direction === "out"),
    count: bankRows.filter((r) => (r.bank_account || "Other bank") === b).length,
  }));
  const bankTotal = perBank.reduce((s, x) => s + x.net, 0);
  return { cashInHand, bankTotal, perBank };
}
function emptyCashMoveForm() {
  return { id: null, movement_date: todayIso(), direction: "in", channel: "cash", bank_account: "Mashreq",
    agent_name: "", client: "", property: "", amount: "", reference: "", msg: "" };
}
function cashMoveFormFromRow(r) {
  return { id: r.id, movement_date: r.movement_date || todayIso(), direction: r.direction || "in", channel: r.channel || "cash",
    bank_account: r.bank_account || "Mashreq", agent_name: r.agent_name || "", client: r.client || "",
    property: r.property || "", amount: r.amount ?? "", reference: r.reference || "", msg: "" };
}
function viewCashBank() {
  const canEdit = roleIn("owner", "accounts");
  const months = availableMonths(state.cashMovements, "month");
  const monthTabs = months.map((m) => `<button class="tab ${state.cbMonth === m ? "is-active" : ""}" data-cbmonth="${m}">${monthLabel(m)}</button>`).join("");
  const channelTabs = ["All", "Cash", "Bank"].map((t) => `<button class="tab ${state.cbChannel === t ? "is-active" : ""}" data-cbchannel="${t}">${t}</button>`).join("");
  const q = state.cbQuery.trim().toLowerCase();
  const monthRows = state.cashMovements.filter((r) => !state.cbMonth || r.month === state.cbMonth);
  const summary = cashBankSummary(monthRows);
  const rows = monthRows.filter((r) =>
    (state.cbChannel === "All" || (state.cbChannel === "Cash" ? r.channel === "cash" : r.channel === "bank")) &&
    (!q || [r.agent_name, r.client, r.property, r.bank_account, r.reference].join(" ").toLowerCase().includes(q)));
  const bankCards = summary.perBank.map((b) => `<div class="md-kpi"><span class="card-kicker">${esc(b.bank)}</span><span class="md-kpi-value">${money(Math.round(b.net))}</span><span class="md-kpi-detail">${b.count} movement${b.count === 1 ? "" : "s"}</span></div>`).join("");
  const body = rows.map((r) => `<tr>
    <td>${esc(showDate(r.movement_date))}</td>
    <td><span class="tag ${r.direction === "in" ? "tag-neutral" : "tag-accent"}">${r.direction === "in" ? "In" : "Out"}</span></td>
    <td>${r.channel === "cash" ? "Cash in hand" : "Bank transfer"}</td>
    <td>${esc(r.channel === "bank" ? (r.bank_account || "—") : "—")}</td>
    <td>${esc(r.agent_name || "—")}</td><td>${esc(r.client || "—")}</td><td>${esc(r.property || "—")}</td>
    <td class="numeric">${money(r.amount)}</td><td>${esc(r.reference || "—")}</td>
    ${canEdit ? `<td><div class="row-actions"><button class="btn btn-secondary btn-mini" data-editcm="${r.id}">Edit</button><button class="btn btn-secondary btn-mini" data-deletecm="${r.id}">Delete</button></div></td>` : ""}</tr>`).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Accounts / Cash & Bank</span><h1 style="margin-top:4px">Cash & Bank</h1><p class="text-muted" style="margin:0">Cash-in-hand and bank movements — ${monthLabel(state.cbMonth)}.</p></div>
      ${canEdit ? `<button class="btn btn-primary" id="newcm">+ New movement</button>` : ""}
    </div>
    <section class="md-kpi-grid" style="margin-bottom:20px">
      <div class="md-kpi is-accent"><span class="card-kicker">Cash in hand</span><span class="md-kpi-value">${money(Math.round(summary.cashInHand))}</span><span class="md-kpi-detail">Net cash movements</span></div>
      <div class="md-kpi"><span class="card-kicker">Bank total</span><span class="md-kpi-value">${money(Math.round(summary.bankTotal))}</span><span class="md-kpi-detail">Across all accounts</span></div>
      ${bankCards}
    </section>
    <div class="tx-toolbar">
      ${months.length ? `<div class="tabs">${monthTabs}</div>` : ""}
      <input class="input" id="cbq" type="search" placeholder="Search agent, client, property, bank, reference…" value="${esc(state.cbQuery)}">
      <div class="tabs">${channelTabs}</div>
      <span class="text-muted" style="font-size:12px">${rows.length} movements</span>
    </div>
    <div class="sheet"><div class="sheet-hint">Cash and bank register — newest first</div>
      <div class="table-wrap"><table class="grid" style="min-width:1050px">
        <thead><tr><th>Date</th><th>Direction</th><th>Channel</th><th>Bank</th><th>Agent</th><th>Client</th><th>Property</th><th>Amount</th><th>Reference</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>${body || `<tr><td colspan="${canEdit ? 10 : 9}"><div class="md-empty" style="border:0">No movements in ${monthLabel(state.cbMonth)} yet.</div></td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
}
function viewCashMoveModal() {
  const f = state.cashMoveForm;
  if (!f) return "";
  const agentNames = state.agents.map((a) => a.name);
  const dl = `<datalist id="cmagents">${agentNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
  const bankOpts = CB_BANKS.map((b) => `<option value="${esc(b)}" ${f.bank_account === b ? "selected" : ""}>${esc(b)}</option>`).join("");
  return `<div class="modal-backdrop">
    <div class="modal" style="width:min(680px,100%)" role="dialog" aria-labelledby="cmtitle">
      <div class="modal-head"><h3 id="cmtitle">${f.id ? "Edit movement" : "New cash / bank movement"}</h3><button class="modal-close" id="cmclose" aria-label="Close">×</button></div>
      <div class="modal-body">${dl}
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="cm_date">Date</label><input class="input" id="cm_date" type="date" value="${esc(f.movement_date)}"></div>
          <div class="field"><label for="cm_dir">Direction</label><select class="input" id="cm_dir"><option value="in" ${f.direction === "in" ? "selected" : ""}>In — received</option><option value="out" ${f.direction === "out" ? "selected" : ""}>Out — paid</option></select></div>
          <div class="field"><label for="cm_channel">Channel</label><select class="input" id="cm_channel"><option value="cash" ${f.channel === "cash" ? "selected" : ""}>Cash in hand</option><option value="bank" ${f.channel === "bank" ? "selected" : ""}>Bank transfer</option></select></div>
          <div class="field" id="cm_bankwrap" style="${f.channel === "bank" ? "" : "display:none"}"><label for="cm_bank">Bank account</label><select class="input" id="cm_bank">${bankOpts}</select></div>
          <div class="field"><label for="cm_agent">Agent</label><input class="input" id="cm_agent" list="cmagents" value="${esc(f.agent_name)}"></div>
          <div class="field"><label for="cm_amount">Amount (AED)</label><input class="input" id="cm_amount" type="number" min="0" step="0.01" value="${esc(f.amount)}"></div>
          <div class="field"><label for="cm_client">Client</label><input class="input" id="cm_client" maxlength="200" value="${esc(f.client)}"></div>
          <div class="field"><label for="cm_property">Property</label><input class="input" id="cm_property" maxlength="200" value="${esc(f.property)}"></div>
          <div class="field" style="grid-column:1/-1"><label for="cm_ref">Reference</label><input class="input" id="cm_ref" maxlength="200" value="${esc(f.reference)}" placeholder="Cheque no, transfer ref, remarks"></div>
        </div>
        <div class="modal-actions"><span class="form-msg" id="cmmsg">${esc(f.msg || "")}</span><button class="btn btn-secondary" id="cmcancel">Cancel</button><button class="btn btn-primary" id="cmsave">${f.id ? "Save changes" : "Save movement"}</button></div>
      </div>
    </div>
  </div>`;
}
async function saveCashMovement() {
  const f = state.cashMoveForm;
  const g = (id) => document.getElementById(id).value;
  const msg = document.getElementById("cmmsg");
  const amount = parseFloat(g("cm_amount"));
  if (!g("cm_date")) { msg.textContent = "Date is required."; return; }
  if (!Number.isFinite(amount) || amount < 0) { msg.textContent = "Enter a valid amount."; return; }
  const channel = g("cm_channel");
  const btn = document.getElementById("cmsave"); btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await supabase.rpc("save_cash_movement", {
    p_id: f.id, p_movement_date: g("cm_date"), p_direction: g("cm_dir"), p_channel: channel,
    p_bank_account: channel === "bank" ? g("cm_bank") : null,
    p_agent_name: g("cm_agent").trim() || null, p_client: g("cm_client").trim() || null,
    p_property: g("cm_property").trim() || null, p_amount: amount, p_reference: g("cm_ref").trim() || null,
  });
  if (error) { msg.textContent = error.message; btn.disabled = false; btn.textContent = f.id ? "Save changes" : "Save movement"; return; }
  if (!await reloadAfterWrite(reloadCashMovements, "Cash movement")) return;
  state.cbMonth = g("cm_date").slice(0, 7); state.cashMoveForm = null; render();
}
async function deleteCashMovement(id) {
  const r = state.cashMovements.find((x) => x.id === id);
  if (!r || !window.confirm(`Delete this ${money(r.amount)} movement?`)) return;
  const { error } = await supabase.rpc("delete_cash_movement", { p_id: id });
  if (error) { window.alert("Could not delete: " + error.message); return; }
  if (!await reloadAfterWrite(reloadCashMovements, "Cash movement deletion")) return;
  render();
}

// ── ejari status toggle (owner/admin/accounts) ───────────
async function toggleEjari(id) {
  const c = state.contracts.find((x) => x.id === id);
  if (!c) return;
  const next = c.ejari_status === "registered" ? "pending" : "registered";
  const { error } = await supabase.rpc("set_contract_ejari", { p_id: id, p_status: next });
  if (error) { window.alert("Could not update Ejari status: " + error.message); return; }
  if (!await reloadAfterWrite(reloadContracts, "Ejari status")) return;
  render();
}

// ── dashboard helpers (birthdays, Ejari pending, daily) ──
// Upcoming birthdays within 30 days — staff roster and saved contacts alike.
function birthdayAlerts() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  const add = (name, subtitle, birthday) => {
    if (!name || !birthday || !isoRe.test(birthday)) return;
    const [, mm, dd] = birthday.split("-").map(Number);
    let next = new Date(today.getFullYear(), mm - 1, dd);
    if (next < today) next = new Date(today.getFullYear() + 1, mm - 1, dd);
    const days = Math.round((next - today) / 86400000);
    if (days <= 30) out.push({ name, job: subtitle, days, dateLabel: `${String(dd).padStart(2, "0")}-${MONTHS[mm - 1]}` });
  };
  state.staff.forEach((s) => add(s.name, s.job, s.birthday));
  state.contacts.forEach((c) => add(c.name, `Contact · ${c.contact_type || ""}`.trim(), c.birthday));
  return out.sort((a, b) => a.days - b.days);
}
function ejariPending() {
  return state.contracts.filter((c) => c.status === "final" && c.ejari_status !== "registered");
}
function dailyControl() {
  const today = todayIso();
  const contractsToday = state.contracts.filter((c) => (c.created_at || "").slice(0, 10) === today || c.contract_date === today);
  const receiptsToday = state.docs.filter((d) => d.doc_type === "receipt" && d.doc_date === today);
  const invoicesToday = state.docs.filter((d) => d.doc_type === "invoice" && d.doc_date === today);
  const contactsToday = state.contacts.filter((c) => (c.created_at || "").slice(0, 10) === today);
  const cashToday = state.cashMovements.filter((m) => m.movement_date === today);
  const receiptCash = receiptsToday.reduce((s, d) => s + (+d.amount || 0), 0)
    + cashToday.filter((m) => m.direction === "in").reduce((s, m) => s + (+m.amount || 0), 0);
  const activity = [];
  contractsToday.forEach((c) => activity.push({ dept: "Sales", text: `Contract ${c.contract_no || "draft"} · ${c.tenant_name || ""}`.trim() }));
  receiptsToday.forEach((d) => activity.push({ dept: "Accounts", text: `Receipt ${d.doc_no} · ${money(d.amount)}` }));
  invoicesToday.forEach((d) => activity.push({ dept: "Accounts", text: `Invoice ${d.doc_no} · ${money(d.amount)}` }));
  contactsToday.forEach((c) => activity.push({ dept: "CRM", text: `New contact · ${c.name}` }));
  cashToday.forEach((m) => activity.push({ dept: "Accounts", text: `${m.direction === "in" ? "Cash in" : "Cash out"} · ${money(m.amount)}` }));
  const deptCounts = {
    Sales: contractsToday.length,
    Accounts: receiptsToday.length + invoicesToday.length + cashToday.length,
    CRM: contactsToday.length,
  };
  const maxDept = Math.max(1, ...Object.values(deptCounts));
  return { contractsToday, receiptsToday, invoicesToday, contactsToday, receiptCash, activity: activity.slice(0, 10), deptCounts, maxDept };
}
function dashboardSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const c of state.contacts) {
    if ([c.name, c.phone, c.email, c.contact_type].join(" ").toLowerCase().includes(q))
      out.push({ screen: "contacts", label: `Contact · ${c.name}`, detail: `${c.contact_type} · ${c.phone || c.email || ""}`.trim() });
  }
  for (const c of state.contracts) {
    if ([c.contract_no, c.tenant_name, c.landlord_name].join(" ").toLowerCase().includes(q))
      out.push({ screen: "contracts", label: `Contract · ${c.contract_no || "draft"}`, detail: `${c.landlord_name || ""} → ${c.tenant_name || ""}` });
  }
  const seenDeal = new Set();
  for (const d of state.deals) {
    if (seenDeal.has(d.group_id)) continue;
    if ([d.agent, d.building, d.unit, d.tenant, d.landlord].join(" ").toLowerCase().includes(q)) {
      seenDeal.add(d.group_id);
      out.push({ screen: "transactions", label: `Deal · ${d.unit || ""} ${d.building || ""}`.trim(), detail: `${d.agent} · ${d.tenant || d.landlord || ""}` });
    }
  }
  return out.slice(0, 12);
}

// ── view: team activity (owner) — who did what, per person ──
// Attribution comes from the created_by / finalized_by / completed_by columns
// already stored on each record, so every action is traced to a real account.
function personName(userId) {
  if (!userId) return null;
  const member = state.team.find((t) => t.id === userId);
  return member ? (member.full_name || member.email || "Unknown") : null;
}
// Builds one activity record per action taken across the workspace.
function activityEntries() {
  const out = [];
  const push = (userId, when, dept, text, amount) => {
    if (!userId) return;
    out.push({ userId, day: String(when || "").slice(0, 10), dept, text, amount: amount ?? null });
  };
  for (const c of state.contracts) {
    push(c.created_by, c.created_at, "Contracts", `Drafted contract ${c.contract_no || "—"} · ${c.tenant_name || ""}`.trim(), c.annual_rent);
    if (c.status === "final" && c.finalized_by) {
      push(c.finalized_by, c.finalized_at || c.updated_at, "Contracts", `Finalized ${c.contract_no || "—"} · ${c.tenant_name || ""}`.trim(), c.annual_rent);
    }
  }
  for (const task of state.accountTasks) {
    if (task.status !== "pending" && task.completed_by) {
      const doc = state.docs.find((d) => d.id === task.money_doc_id);
      push(task.completed_by, task.completed_at, "Accounts", `Issued ${doc ? doc.doc_no : "document"} for a contract`, doc?.amount);
    }
  }
  for (const m of state.cashMovements) {
    push(m.created_by, m.movement_date || m.created_at, "Accounts",
      `${m.direction === "in" ? "Recorded cash in" : "Recorded cash out"} · ${m.channel === "bank" ? (m.bank_account || "bank") : "cash in hand"}`, m.amount);
  }
  for (const c of state.contacts) {
    push(c.created_by, c.created_at, "Contacts", `Added contact · ${c.name}`, null);
  }
  for (const r of state.requests) {
    if (r.status !== "pending") {
      // Reviews are recorded on the request itself; attribute to the submitter's
      // reviewer only when we can identify them from the team list.
      push(r.created_by, r.created_at, "Requests", `Request ${requestTypeLabel(r.request_type)} · ${r.status}`, null);
    }
  }
  return out;
}
function viewTeamActivity() {
  const entries = activityEntries();
  const days = [...new Set(entries.map((e) => e.day).filter(Boolean))].sort().reverse();
  const day = state.activityDay && days.includes(state.activityDay) ? state.activityDay : (days[0] || todayIso());
  const dayEntries = entries.filter((e) => e.day === day);
  // Everyone who can do work in the system, so idle staff still appear.
  const workers = state.team.filter((t) => ["admin", "accounts", "owner"].includes(t.role));
  const cards = workers.map((w) => {
    const mine = dayEntries.filter((e) => e.userId === w.id);
    const byDept = {};
    mine.forEach((e) => { (byDept[e.dept] = byDept[e.dept] || []).push(e); });
    const chips = Object.entries(byDept).map(([dept, list]) => `<span class="tag tag-neutral">${esc(dept)} · ${list.length}</span>`).join(" ");
    const rows = mine.slice(0, 12).map((e) => `<div class="activity-item"><span class="tag tag-neutral">${esc(e.dept)}</span><span>${esc(e.text)}${e.amount ? ` — ${money(e.amount)}` : ""}</span></div>`).join("");
    return `<section class="md-section">
      <div class="md-section-header">
        <h3 style="font-size:18px">${esc(w.full_name || w.email || "Unknown")}</h3>
        <span class="tag ${mine.length ? "tag-accent" : "tag-neutral"}">${esc(w.role)} · ${mine.length} action${mine.length === 1 ? "" : "s"}</span>
      </div>
      ${chips ? `<div style="margin-bottom:10px">${chips}</div>` : ""}
      ${rows ? `<div class="activity-feed">${rows}</div>` : `<p class="text-muted" style="font-size:12px;margin:0">No recorded work on this day.</p>`}
    </section>`;
  }).join("");
  const dayOpts = (days.length ? days : [day]).map((d) => `<option value="${d}" ${d === day ? "selected" : ""}>${showDate(d)}${d === days[0] ? " (latest)" : ""}</option>`).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Owner / Oversight</span><h1 style="margin-top:4px">Team Activity</h1><p class="text-muted" style="margin:0">What each team member did — ${showDate(day)}.</p></div>
      <select class="input" id="activityday" style="width:auto">${dayOpts}</select>
    </div>
    <section class="md-kpi-grid" style="margin-bottom:20px">
      <div class="md-kpi is-accent"><span class="card-kicker">Actions today</span><span class="md-kpi-value">${dayEntries.length}</span></div>
      <div class="md-kpi"><span class="card-kicker">People active</span><span class="md-kpi-value">${new Set(dayEntries.map((e) => e.userId)).size}</span><span class="md-kpi-detail">of ${workers.length} team members</span></div>
      <div class="md-kpi"><span class="card-kicker">Contracts work</span><span class="md-kpi-value">${dayEntries.filter((e) => e.dept === "Contracts").length}</span></div>
      <div class="md-kpi"><span class="card-kicker">Accounts work</span><span class="md-kpi-value">${dayEntries.filter((e) => e.dept === "Accounts").length}</span></div>
    </section>
    ${workers.length ? `<div class="activity-grid">${cards}</div>` : `<div class="md-empty">No admin or accounts team members yet — assign roles in Team &amp; Access.</div>`}
  </div>`;
}

// ── wiring ───────────────────────────────────────────────
function wireScreen() {
  const retry = document.getElementById("retryload");
  if (retry) retry.onclick = async () => {
    retry.disabled = true; retry.textContent = "Loading…";
    try { await loadData(); }
    catch (error) { state.fatalError = error.message; }
    render();
  };
  const txq = document.getElementById("txq");
  if (txq) txq.oninput = () => { state.txQuery = txq.value; rerenderTx(); };
  root.querySelectorAll("[data-txtype]").forEach((b) => b.onclick = () => { state.txType = b.dataset.txtype; rerenderTx(); });
  root.querySelectorAll("[data-txmonth]").forEach((b) => b.onclick = () => { state.txMonth = b.dataset.txmonth; rerenderTx(); });
  root.querySelectorAll("[data-ledgermonth]").forEach((b) => b.onclick = () => { state.ledgerMonth = b.dataset.ledgermonth; rerenderLedgers(); });
  const lq = document.getElementById("lq");
  if (lq) lq.oninput = () => { state.ledgerQuery = lq.value; rerenderLedgers(); };
  root.querySelectorAll("[data-agent]").forEach((b) => b.onclick = () => { state.selectedAgent = b.dataset.agent; rerenderLedgers(); });
  root.querySelectorAll("[data-save]").forEach((b) => b.onclick = () => saveTeamRow(b.closest("tr")));
  const nd = document.getElementById("newdeal");
  if (nd) nd.onclick = () => { state.dealForm = emptyDealForm(); render(); };
  const exportTx = document.getElementById("exporttx"); if (exportTx) exportTx.onclick = exportTransactions;
  root.querySelectorAll("[data-editdeal]").forEach((b) => b.onclick = () => {
    const d = state.deals.find((x) => x.id === b.dataset.editdeal);
    if (d) { state.dealForm = dealFormFromRow(d); render(); }
  });
  root.querySelectorAll("[data-deletedeal]").forEach((b) => b.onclick = () => deleteDeal(b.dataset.deletedeal));
  const pwo = document.getElementById("pwopen");
  if (pwo) pwo.onclick = () => { state.pwForm = true; render(); };
  // invoices & receipts
  root.querySelectorAll("[data-invmonth]").forEach((b) => b.onclick = () => { state.invMonth = b.dataset.invmonth; render(); });
  root.querySelectorAll("[data-invtype]").forEach((b) => b.onclick = () => { state.invType = b.dataset.invtype; render(); });
  const invq = document.getElementById("invq");
  if (invq) invq.oninput = () => {
    state.invQuery = invq.value;
    const main = root.querySelector("main"); main.innerHTML = viewInvoices(); wireScreen();
    const el = document.getElementById("invq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  };
  const ndoc = document.getElementById("newdoc");
  if (ndoc) ndoc.onclick = () => { state.docForm = emptyDocForm(); render(); };
  const exportDocs = document.getElementById("exportdocs"); if (exportDocs) exportDocs.onclick = exportDocuments;
  root.querySelectorAll("[data-editdoc]").forEach((b) => b.onclick = () => {
    const d = state.docs.find((x) => x.id === b.dataset.editdoc);
    if (d) { state.docForm = docFormFromRow(d); render(); }
  });
  root.querySelectorAll("[data-deletedoc]").forEach((b) => b.onclick = () => deleteDoc(b.dataset.deletedoc));
  root.querySelectorAll("[data-markpaid]").forEach((b) => b.onclick = () => markPaid(b.dataset.markpaid));
  root.querySelectorAll("[data-invpdf]").forEach((b) => b.onclick = () => openInvoicePrint(b.dataset.invpdf));
  if (state.printInvoice) {
    document.getElementById("invclose").onclick = () => { state.printInvoice = null; render(); };
    const invSave = document.getElementById("invsave"); if (invSave) invSave.onclick = saveInvoiceDraft;
    document.getElementById("invprint").onclick = () => window.print();
    const invSigned = document.getElementById("invsigned");
    if (invSigned) invSigned.onchange = () => { readInvoiceForm(); state.printInvoice.signed = invSigned.checked; render(); };
    ["quantity", "unit_price", "vat_rate"].forEach((id) => {
      const el = document.getElementById("iv_" + id); if (el) el.oninput = invoiceRecalc;
    });
    document.querySelectorAll(".inv-in").forEach((el) => { if (el.oninput === null || !el.oninput) el.addEventListener("input", () => { const s = document.getElementById("invsave"); if (s) s.textContent = "Save draft"; }); });
  }
  const exportLedgerButton = document.getElementById("exportledger"); if (exportLedgerButton) exportLedgerButton.onclick = exportLedger;
  const printLedger = document.getElementById("printledger"); if (printLedger) printLedger.onclick = () => window.print();
  // agent requests
  root.querySelectorAll("[data-requeststatus]").forEach((button) => button.onclick = () => { state.requestStatus = button.dataset.requeststatus; render(); });
  const newRequest = document.getElementById("newrequest"); if (newRequest) newRequest.onclick = () => { state.requestForm = { msg: "" }; render(); };
  root.querySelectorAll("[data-saverequest]").forEach((button) => button.onclick = () => saveRequestReview(button.closest("[data-requestrow]")));
  // contracts, addenda, renewal reminders, and Accounts notifications
  const newContract = document.getElementById("newcontract"); if (newContract) newContract.onclick = () => openContractForm();
  root.querySelectorAll("[data-editcontract]").forEach((button) => button.onclick = () => openContractForm(state.contracts.find((c) => c.id === button.dataset.editcontract)));
  root.querySelectorAll("[data-printcontract]").forEach((button) => button.onclick = () => { state.printContract = state.contracts.find((c) => c.id === button.dataset.printcontract) || null; render(); });
  root.querySelectorAll("[data-fulfilltask]").forEach((button) => button.onclick = () => fulfillAccountTask(button.closest("[data-accounttask]")));
  // staff
  root.querySelectorAll("[data-staffbranch]").forEach((b) => b.onclick = () => { state.staffBranch = b.dataset.staffbranch; render(); });
  const sq = document.getElementById("staffq");
  if (sq) sq.oninput = () => {
    state.staffQuery = sq.value;
    const main = root.querySelector("main"); main.innerHTML = viewStaff(); wireScreen();
    const el = document.getElementById("staffq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  };
  // cash
  const ce = document.getElementById("cashedit");
  if (ce) ce.onclick = openCashForm;
  const cd = document.getElementById("cashdate");
  if (cd) cd.onchange = () => { state.cashDate = cd.value; render(); };
  // contacts
  const newContact = document.getElementById("newcontact"); if (newContact) newContact.onclick = () => { state.contactForm = emptyContactForm(); render(); };
  root.querySelectorAll("[data-contacttype]").forEach((b) => b.onclick = () => { state.contactType = b.dataset.contacttype; render(); });
  root.querySelectorAll("[data-editcontact]").forEach((b) => b.onclick = () => {
    const c = state.contacts.find((x) => x.id === b.dataset.editcontact);
    if (c) { state.contactForm = contactFormFromRow(c); render(); }
  });
  root.querySelectorAll("[data-deletecontact]").forEach((b) => b.onclick = () => deleteContact(b.dataset.deletecontact));
  const contactq = document.getElementById("contactq");
  if (contactq) contactq.oninput = () => {
    state.contactQuery = contactq.value;
    const main = root.querySelector("main"); main.innerHTML = viewContacts(); wireScreen();
    const el = document.getElementById("contactq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  };
  // cash & bank
  const newCm = document.getElementById("newcm"); if (newCm) newCm.onclick = () => { state.cashMoveForm = emptyCashMoveForm(); render(); };
  root.querySelectorAll("[data-cbmonth]").forEach((b) => b.onclick = () => { state.cbMonth = b.dataset.cbmonth; render(); });
  root.querySelectorAll("[data-cbchannel]").forEach((b) => b.onclick = () => { state.cbChannel = b.dataset.cbchannel; render(); });
  root.querySelectorAll("[data-editcm]").forEach((b) => b.onclick = () => {
    const r = state.cashMovements.find((x) => x.id === b.dataset.editcm);
    if (r) { state.cashMoveForm = cashMoveFormFromRow(r); render(); }
  });
  root.querySelectorAll("[data-deletecm]").forEach((b) => b.onclick = () => deleteCashMovement(b.dataset.deletecm));
  const cbq = document.getElementById("cbq");
  if (cbq) cbq.oninput = () => {
    state.cbQuery = cbq.value;
    const main = root.querySelector("main"); main.innerHTML = viewCashBank(); wireScreen();
    const el = document.getElementById("cbq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  };
  // contracts — Ejari toggle
  root.querySelectorAll("[data-toggleejari]").forEach((b) => b.onclick = () => toggleEjari(b.dataset.toggleejari));
  // team activity — day selector
  const activityDay = document.getElementById("activityday");
  if (activityDay) activityDay.onchange = () => { state.activityDay = activityDay.value; render(); };
  // dashboard — global search + deep links
  const dashSearch = document.getElementById("dashsearch");
  if (dashSearch) dashSearch.oninput = () => {
    state.dashQuery = dashSearch.value;
    const main = root.querySelector("main"); main.innerHTML = viewDashboard(); wireScreen();
    const el = document.getElementById("dashsearch"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };
  root.querySelectorAll("[data-gotoscreen]").forEach((b) => b.onclick = () => { state.dashQuery = ""; state.screen = b.dataset.gotoscreen; render(); });
  wireModals();
}

function wireModals() {
  const closeDeal = () => { collectDealForm(); state.dealForm = null; render(); };
  const dc = document.getElementById("dealclose"); if (dc) dc.onclick = () => { state.dealForm = null; render(); };
  const dca = document.getElementById("dealcancel"); if (dca) dca.onclick = () => { state.dealForm = null; render(); };
  const ds = document.getElementById("dealsave"); if (ds) ds.onclick = saveDeal;
  ["f_total_commission", "f_commission_received", "f_agent2"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.oninput = dealAutoMath;
  });
  ["f_tc_start", "f_duration"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.oninput = dealAutoEnd;
  });
  const pc = document.getElementById("pwclose"); if (pc) pc.onclick = () => { state.pwForm = false; render(); };
  const pca = document.getElementById("pwcancel"); if (pca) pca.onclick = () => { state.pwForm = false; render(); };
  const ps = document.getElementById("pwsave"); if (ps) ps.onclick = savePassword;
  // doc modal
  const dxc = document.getElementById("docclose"); if (dxc) dxc.onclick = () => { state.docForm = null; render(); };
  const dxa = document.getElementById("doccancel"); if (dxa) dxa.onclick = () => { state.docForm = null; render(); };
  const dxs = document.getElementById("docsave"); if (dxs) dxs.onclick = saveDoc;
  const ddeal = document.getElementById("d_deal"); if (ddeal) ddeal.onchange = docPrefill;
  // cash modal
  const cxc = document.getElementById("cashclose"); if (cxc) cxc.onclick = () => { state.cashForm = null; render(); };
  const cxa = document.getElementById("cashcancel"); if (cxa) cxa.onclick = () => { state.cashForm = null; render(); };
  const cxs = document.getElementById("cashsave"); if (cxs) cxs.onclick = saveCashSnapshot;
  const cal = document.getElementById("cashaddline");
  if (cal) cal.onclick = () => { collectCashForm(); state.cashForm.lines.push({ label: "", amount: null }); render(); };
  document.querySelectorAll("[data-cl-remove]").forEach((b) => b.onclick = () => {
    collectCashForm(); state.cashForm.lines.splice(+b.dataset.clRemove, 1); render();
  });
  // request modal
  const requestClose = document.getElementById("requestclose"); if (requestClose) requestClose.onclick = () => { state.requestForm = null; render(); };
  const requestCancel = document.getElementById("requestcancel"); if (requestCancel) requestCancel.onclick = () => { state.requestForm = null; render(); };
  const requestSave = document.getElementById("requestsave"); if (requestSave) requestSave.onclick = saveRequest;
  // contract modal and print/PDF view
  const contractClose = document.getElementById("contractclose"); if (contractClose) contractClose.onclick = () => { state.contractForm = null; render(); };
  const contractCancel = document.getElementById("contractcancel"); if (contractCancel) contractCancel.onclick = () => { state.contractForm = null; render(); };
  const contractDraft = document.getElementById("contractdraft"); if (contractDraft) contractDraft.onclick = () => saveContract("draft");
  const contractFinal = document.getElementById("contractfinal"); if (contractFinal) contractFinal.onclick = () => saveContract("final");
  const contractDeal = document.getElementById("ct_deal"); if (contractDeal && !state.contractForm?.id) contractDeal.onchange = () => {
    if (!window.confirm("Change the related deal? Any unsaved contract entries will be replaced.")) { contractDeal.value = state.contractForm.deal_group; return; }
    const deal = dealGroupOptions().find((option) => option.group === contractDeal.value)?.deal;
    state.contractForm = contractDraftFromDeal(deal); render();
  };
  // contact modal
  const contactClose2 = document.getElementById("contactclose2"); if (contactClose2) contactClose2.onclick = () => { state.contactForm = null; render(); };
  const contactCancel2 = document.getElementById("contactcancel2"); if (contactCancel2) contactCancel2.onclick = () => { state.contactForm = null; render(); };
  const contactSave2 = document.getElementById("contactsave2"); if (contactSave2) contactSave2.onclick = saveContactForm;
  // cash movement modal
  const cmClose = document.getElementById("cmclose"); if (cmClose) cmClose.onclick = () => { state.cashMoveForm = null; render(); };
  const cmCancel = document.getElementById("cmcancel"); if (cmCancel) cmCancel.onclick = () => { state.cashMoveForm = null; render(); };
  const cmSave = document.getElementById("cmsave"); if (cmSave) cmSave.onclick = saveCashMovement;
  const cmChannel = document.getElementById("cm_channel");
  if (cmChannel) cmChannel.onchange = () => {
    if (state.cashMoveForm) state.cashMoveForm.channel = cmChannel.value;
    const wrap = document.getElementById("cm_bankwrap"); if (wrap) wrap.style.display = cmChannel.value === "bank" ? "" : "none";
  };
  const printClose = document.getElementById("printclose"); if (printClose) printClose.onclick = () => { state.printContract = null; render(); };
  const printNow = document.getElementById("printnow"); if (printNow) printNow.onclick = async () => {
    printNow.disabled = true; printNow.textContent = "Preparing pages…";
    const images = [...document.querySelectorAll(".dld-print-page img")];
    try {
      await Promise.all(images.map((image) => image.decode ? image.decode() : new Promise((resolve, reject) => {
        if (image.complete && image.naturalWidth) resolve();
        else { image.onload = resolve; image.onerror = reject; }
      })));
      window.print();
    } catch { window.alert("The contract template images did not finish loading. Please try again."); }
    finally { printNow.disabled = false; printNow.textContent = "Print / Save PDF"; }
  };
  document.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    if (state.printInvoice) { state.printInvoice = null; render(); }
    else if (state.printContract) { state.printContract = null; render(); }
    else if (state.contractForm) { state.contractForm = null; render(); }
    else if (state.contactForm) { state.contactForm = null; render(); }
    else if (state.cashMoveForm) { state.cashMoveForm = null; render(); }
  };
  if (state.contractForm) document.getElementById("ct_deal")?.focus();
  else if (state.printContract) document.getElementById("printclose")?.focus();
}
function rerenderTx() {
  const main = root.querySelector("main"); const focus = document.activeElement === document.getElementById("txq");
  main.innerHTML = viewTransactions(); wireScreen();
  if (focus) { const el = document.getElementById("txq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function rerenderLedgers() {
  const main = root.querySelector("main"); const focus = document.activeElement === document.getElementById("lq");
  main.innerHTML = viewLedgers(); wireScreen();
  if (focus) { const el = document.getElementById("lq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function render() {
  state.profile ? renderApp() : renderLogin(state.fatalError ? { kind: "is-error", text: state.fatalError } : undefined);
}

boot();
