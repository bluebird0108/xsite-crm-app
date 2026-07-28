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
  selectedAgent: null,
  txQuery: "", txType: "All", ledgerQuery: "",
  txMonth: null, ledgerMonth: null,
  invMonth: null, invType: "All", invQuery: "",
  cashDate: null,
  staffQuery: "", staffBranch: "All", requestStatus: "All",
  dealForm: null, pwForm: false, docForm: null, cashForm: null, requestForm: null,
  contractForm: null, printContract: null,
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
function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}
function clearSensitiveState() {
  state.profile = null;
  state.agents = []; state.deals = []; state.commission = []; state.cash = [];
  state.team = []; state.docs = []; state.staff = []; state.requests = [];
  state.contracts = []; state.accountTasks = [];
  state.dealForm = null; state.pwForm = false; state.docForm = null;
  state.cashForm = null; state.requestForm = null; state.contractForm = null; state.printContract = null;
}
const COLUMNS = {
  agents: "id,name,role,month,agent_business_including_vat",
  deals: "id,group_id,sno,deal_date,deal_date_raw,agent,agent2,third_party,deal_type,unit,building,area,price,total_commission,commission_received,vat,commission_ex_vat,agent_business,company_share,agent_share,payment_method,tc_start,tc_start_raw,contract_duration,tc_end,tc_end_raw,security_deposit,cheque_count,landlord,tenant,bank,month",
  commission_entries: "id,group_id,agent_name,entry_date,entry_date_raw,third_party,agent2,deal_type,unit,building,area,annual_value,total_commission,received,vat,commission_ex_vat,agent_business,xsite_share,agent_share,month",
  cash_position: "id,as_at,label,amount,sort_order,month",
  profiles: "id,full_name,email,role,agent_name,created_at",
  money_docs: "id,doc_type,doc_no,deal_group,doc_date,client,description,amount,payment_method,status,month",
  staff: "id,name,job,nationality,branch,card_number,card_expiry",
  agent_requests: "id,created_by,submitter_name,request_type,subject,deal_group,details,status,response,created_at,updated_at",
  contracts: "id,contract_no,deal_group,status,contract_date,start_date,end_date,landlord_name,tenant_name,owner_phone,tenant_phone,annual_rent,security_deposit,payment_mode,additional_terms,details,addendum,created_by,finalized_by,finalized_at,created_at,updated_at",
  account_tasks: "id,contract_id,task_type,status,money_doc_id,completed_by,completed_at,created_at",
};
async function fetchAll(table, orderColumn, ascending = true) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await supabase.from(table).select(COLUMNS[table]).order(orderColumn, { ascending }).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) break;
  }
  return { data: rows, error: null };
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
    return;
  }
  const [ag, dl, cm, ch, tm, md, sf, rq, ct, at] = await Promise.all([
    fetchAll("agents", "name"),
    fetchAll("deals", "sno"),
    fetchAll("commission_entries", "agent_name"),
    roleIn("owner", "accounts", "admin") ? fetchAll("cash_position", "sort_order") : Promise.resolve({ data: [] }),
    roleIn("owner") ? fetchAll("profiles", "created_at") : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? fetchAll("money_docs", "doc_no") : Promise.resolve({ data: [] }),
    roleIn("owner", "admin", "accounts") ? fetchAll("staff", "name") : Promise.resolve({ data: [] }),
    fetchAll("agent_requests", "created_at", false),
    fetchAll("contracts", "created_at", false),
    roleIn("owner", "accounts", "admin") ? fetchAll("account_tasks", "created_at", false) : Promise.resolve({ data: [] }),
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

async function reloadContracts() {
  const [contracts, tasks, docs] = await Promise.all([
    fetchAll("contracts", "created_at", false),
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
  const showTx = roleIn("owner", "accounts", "admin");
  const showLedger = roleIn("owner", "accounts", "admin") || p.role === "agent";
  const showTeam = roleIn("owner");
  const pendingTeam = state.team.filter((t) => t.role === "pending").length;
  const pendingRequests = state.requests.filter((request) => request.status === "pending").length;
  const pendingAccountTasks = state.accountTasks.filter((task) => task.status === "pending").length;
  const renewalAlerts = state.contracts.filter((contract) => contract.status === "final" && ["due", "expired"].includes(renewalStatus(contract.end_date).status)).length;
  const contractAlerts = pendingAccountTasks + renewalAlerts;
  const ledgerLabel = p.role === "agent" ? "My Ledger" : "Agent Ledgers";
  const nav = `
  <nav class="nav">
    <div class="nav-brand"><img src="./xsite-logo.png" alt="Xsite"></div>
    ${roleIn("owner", "accounts", "admin") ? navLink("dashboard", "Dashboard") : ""}
    ${showTx ? navLink("transactions", "Transactions") : ""}
    ${roleIn("owner", "accounts", "admin") ? navLink("contracts", contractAlerts ? `Contracts (${contractAlerts})` : "Contracts") : ""}
    ${roleIn("owner", "accounts", "admin") ? navLink("invoices", "Invoices & Receipts") : ""}
    ${showLedger ? navLink("ledgers", ledgerLabel) : ""}
    ${roleIn("pending") ? "" : navLink("requests", pendingRequests ? `Requests (${pendingRequests})` : "Requests")}
    ${roleIn("owner", "admin", "accounts") ? navLink("staff", "Staff") : ""}
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
  else if (state.screen === "transactions" && showTx) body = viewTransactions();
  else if (state.screen === "contracts" && roleIn("owner", "accounts", "admin")) body = viewContracts();
  else if (state.screen === "invoices" && roleIn("owner", "accounts", "admin")) body = viewInvoices();
  else if (state.screen === "ledgers" && showLedger) body = viewLedgers();
  else if (state.screen === "requests") body = viewRequests();
  else if (state.screen === "staff" && roleIn("owner", "admin", "accounts")) body = viewStaff();
  else if (state.screen === "team" && showTeam) body = viewTeam();
  else if (roleIn("agent")) body = viewLedgers();
  else body = viewDashboard();
  root.innerHTML = nav + `<main>${body}</main>` + viewDealModal() + viewPwModal() + viewDocModal() + viewCashModal() + viewRequestModal() + viewContractModal() + viewContractPrint();
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
      <td><span class="${expClass}">${esc(expLabel)}</span></td></tr>`;
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
        <thead><tr><th>Name</th><th>Job</th><th>Nationality</th><th>Branch</th><th>Work-permit card</th><th>Card expiry</th></tr></thead>
        <tbody>${body || `<tr><td colspan="6"><div class="md-empty" style="border:0">No employees match.</div></td></tr>`}</tbody>
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

function viewRequests() {
  const canSubmit = roleIn("agent");
  const canReview = roleIn("owner", "accounts");
  const statuses = ["All", "pending", "in_review", "resolved", "rejected"];
  const tabs = statuses.map((status) => `<button class="tab ${state.requestStatus === status ? "is-active" : ""}" data-requeststatus="${status}">${status === "All" ? "All" : requestStatusLabel(status)}</button>`).join("");
  const rows = state.requests.filter((request) => state.requestStatus === "All" || request.status === state.requestStatus);
  const body = rows.map((request) => {
    const date = new Date(request.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const deal = request.deal_group ? dealLabelFor(request.deal_group) : "—";
    const action = canReview ? `<div data-requestrow="${request.id}" style="display:grid;gap:6px;min-width:220px">
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

function viewContracts() {
  const canManage = roleIn("owner", "admin");
  const canFulfill = roleIn("owner", "accounts");
  const reminders = state.contracts.filter((c) => c.status === "final")
    .map((contract) => ({ contract, renewal: renewalStatus(contract.end_date) }))
    .filter((item) => ["due", "expired"].includes(item.renewal.status))
    .sort((a, b) => a.renewal.days - b.renewal.days);
  const contractRows = state.contracts.map((contract) => {
    const renewal = contract.status === "final" ? renewalStatus(contract.end_date) : { status: "draft", days: null };
    const renewalText = renewal.status === "expired" ? `${Math.abs(renewal.days)} days overdue` : renewal.status === "due" ? `${renewal.days} days remaining` : "Not due";
    return `<tr><td><strong>${esc(contract.contract_no)}</strong></td><td>${esc(dealLabelFor(contract.deal_group))}</td>
      <td>${esc(contract.landlord_name)} → ${esc(contract.tenant_name)}</td><td>${showDate(contract.start_date)} – ${showDate(contract.end_date)}</td>
      <td><span class="tag ${contract.status === "draft" ? "tag-accent" : "tag-neutral"}">${esc(contract.status)}</span></td>
      <td><span class="${renewal.status === "expired" ? "expiry-days is-overdue" : renewal.status === "due" ? "expiry-days" : "text-muted"}">${esc(renewalText)}</span></td>
      <td style="white-space:nowrap">${canManage && contract.status === "draft" ? `<button class="btn btn-secondary btn-mini" data-editcontract="${contract.id}">Edit</button> ` : ""}<button class="btn btn-primary btn-mini" data-printcontract="${contract.id}">View / print</button></td></tr>`;
  }).join("");
  const taskRows = state.accountTasks.map((task) => {
    const contract = state.contracts.find((c) => c.id === task.contract_id);
    if (!contract) return "";
    const doc = state.docs.find((d) => d.id === task.money_doc_id);
    const action = task.status === "pending" && canFulfill ? `<div data-accounttask="${task.id}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:end">
      <label class="field compact-field">Type<select class="input" data-tasktype><option value="invoice">Invoice</option><option value="receipt">Receipt</option></select></label>
      <label class="field compact-field">Date<input class="input" type="date" data-taskdate value="${todayIso()}"></label>
      <label class="field compact-field">Amount<input class="input" type="number" min="0.01" step="0.01" data-taskamount value="${esc(contract.details?.contractValue || contract.annual_rent)}"></label>
      <label class="field compact-field">Payment<input class="input" data-taskpayment placeholder="Cheque / transfer"></label>
      <button class="btn btn-primary btn-mini" data-fulfilltask>Create</button></div>` : `<span class="tag tag-neutral">${doc ? esc(doc.doc_no) : "Completed"}</span>`;
    return `<tr><td>${esc(contract.contract_no)}</td><td>${esc(contract.tenant_name)}</td><td>${money(contract.annual_rent)}</td><td><span class="tag ${task.status === "pending" ? "tag-accent" : "tag-neutral"}">${esc(task.status)}</span></td><td>${action}</td></tr>`;
  }).join("");
  return `<div>
    <div style="margin-bottom:20px;display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap">
      <div><span class="card-kicker">Tenancy operations</span><h1 style="margin-top:4px">${roleIn("agent") ? "My Tenancy Contracts" : "Contracts & Addenda"}</h1><p class="text-muted" style="margin:0">DLD contract drafts, Xsite addenda, 90-day renewals, and Accounts hand-off.</p></div>
      ${canManage ? `<button class="btn btn-primary" id="newcontract">+ New contract draft</button>` : ""}
    </div>
    ${reminders.length ? `<section class="md-section" style="margin-bottom:20px"><div class="md-section-header"><h3>Renewal reminders</h3><span class="tag tag-accent">${reminders.filter(({renewal})=>renewal.status==="due").length} due · ${reminders.filter(({renewal})=>renewal.status==="expired").length} expired</span></div>
      <div class="expiry-list">${reminders.map(({contract,renewal}) => `<div class="expiry-row"><div><strong>${esc(contract.contract_no)} · ${esc(contract.tenant_name)}</strong><div class="text-muted">${esc(dealLabelFor(contract.deal_group))} · ends ${showDate(contract.end_date)}</div></div><span class="${renewal.status === "expired" ? "expiry-days is-overdue" : "expiry-days"}">${renewal.status === "expired" ? `${Math.abs(renewal.days)}d overdue` : `${renewal.days}d left`}</span></div>`).join("")}</div></section>` : ""}
    ${roleIn("owner", "accounts", "admin") && state.accountTasks.length ? `<section class="md-section" style="margin-bottom:20px"><div class="md-section-header"><h3>Accounts notifications</h3><span class="tag tag-accent">${state.accountTasks.filter((t)=>t.status==="pending").length} pending</span></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Contract</th><th>Tenant</th><th>Contract value</th><th>Status</th><th>Create invoice or receipt</th></tr></thead><tbody>${taskRows}</tbody></table></div></section>` : ""}
    <div class="sheet"><div class="sheet-hint">${roleIn("agent") ? "Only finalized contracts linked to your deals are visible" : `${state.contracts.length} saved contract records`}</div>
      <div class="table-wrap"><table class="grid" style="min-width:1000px"><thead><tr><th>Contract</th><th>Deal</th><th>Parties</th><th>Term</th><th>Status</th><th>Renewal</th><th></th></tr></thead><tbody>${contractRows || `<tr><td colspan="7"><div class="md-empty" style="border:0">No contracts yet.</div></td></tr>`}</tbody></table></div></div>
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
  state.contractForm = null; await reloadAfterWrite(reloadContracts, status === "final" ? "Final contract" : "Contract draft"); render();
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

// ── view: team management (owner) ────────────────────────
function viewTeam() {
  const agentNames = [...new Set(state.commission.map((r) => r.agent_name))].sort();
  const roleOpts = (cur) => ["pending", "agent", "accounts", "admin", "owner"]
    .map((r) => `<option value="${r}" ${r === cur ? "selected" : ""}>${r}</option>`).join("");
  const agentOpts = (cur) => `<option value="">— none —</option>` + agentNames
    .map((n) => `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
  const rows = state.team.map((t) => `
    <tr data-uid="${t.id}">
      <td>${esc(t.full_name || "—")}</td>
      <td>${esc(t.email || "—")}</td>
      <td>${t.role === "pending" ? `<span class="tag tag-accent">pending</span>` : `<span class="tag tag-neutral">${esc(t.role)}</span>`}</td>
      <td><select class="input" data-role style="padding:7px 10px">${roleOpts(t.role)}</select></td>
      <td><select class="input" data-agentname style="padding:7px 10px">${agentOpts(t.agent_name)}</select></td>
      <td><button class="btn btn-primary" data-save>Save</button></td>
    </tr>`).join("");
  return `
  <div>
    <div style="margin-bottom:20px"><span class="card-kicker">Owner / Team</span><h1 style="margin-top:4px">Team &amp; Access</h1>
    <p class="text-muted" style="margin:0">New signups appear here as <strong>pending</strong>. Assign a role to grant access; link agents to their ledger name.</p></div>
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
  const btn = tr.querySelector("[data-save]"); btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await supabase.from("profiles").update({ role, agent_name }).eq("id", uid);
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
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">${esc(kicker)}</span><h1 style="margin-top:4px">${monthLabel(state.txMonth)} Overview</h1><p class="text-muted" style="margin:0">Live from the Xsite database.</p></div>
    </header>
    ${kpis}
    ${strip}
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
    if (state.printContract) { state.printContract = null; render(); }
    else if (state.contractForm) { state.contractForm = null; render(); }
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
