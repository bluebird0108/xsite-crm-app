import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById("root");

const state = {
  profile: null,
  screen: "dashboard",
  authMode: "signin",
  agents: [], deals: [], commission: [], cash: [], team: [], docs: [],
  selectedAgent: null,
  txQuery: "", txType: "All", ledgerQuery: "",
  txMonth: null, ledgerMonth: null,
  invMonth: null, invType: "All", invQuery: "",
  cashDate: null,
  dealForm: null, pwForm: false, docForm: null, cashForm: null,
};

const MONTH_LABELS = { "01":"January","02":"February","03":"March","04":"April","05":"May","06":"June","07":"July","08":"August","09":"September","10":"October","11":"November","12":"December" };
function monthLabel(m) { if (!m) return "—"; const [y, mm] = m.split("-"); return `${MONTH_LABELS[mm] || mm} ${y}`; }
function availableMonths(rows, key) {
  const set = new Set(rows.map((r) => r[key]).filter(Boolean));
  return [...set].sort().reverse();
}

// ── helpers ──────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => n === null || n === undefined ? "—" : "AED " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const isoRe = /^\d{4}-\d{2}-\d{2}$/;
function showDate(iso, raw) {
  if (iso && isoRe.test(iso)) { const p = iso.split("-"); return `${p[2]}-${MONTHS[+p[1]-1]}-${p[0].slice(2)}`; }
  return raw || "—";
}
const roleIn = (...r) => r.includes(state.profile?.role);

// ── data ─────────────────────────────────────────────────
async function loadData() {
  if (roleIn("pending")) { state.agents = []; state.deals = []; state.commission = []; state.cash = []; state.team = []; return; }
  const [ag, dl, cm, ch, tm, md] = await Promise.all([
    supabase.from("agents").select("*").order("name"),
    supabase.from("deals").select("*").order("sno"),
    supabase.from("commission_entries").select("*").order("agent_name"),
    roleIn("owner", "accounts") ? supabase.from("cash_position").select("*").order("sort_order") : Promise.resolve({ data: [] }),
    roleIn("owner") ? supabase.from("profiles").select("*").order("created_at") : Promise.resolve({ data: [] }),
    roleIn("owner", "accounts", "admin") ? supabase.from("money_docs").select("*").order("doc_no") : Promise.resolve({ data: [] }),
  ]);
  state.agents = ag.data || [];
  state.deals = dl.data || [];
  state.commission = cm.data || [];
  state.cash = ch.data || [];
  state.team = tm.data || [];
  state.docs = md.data || [];
  const months = availableMonths(state.deals, "month");
  if (!state.txMonth || !months.includes(state.txMonth)) state.txMonth = months[0] || null;
  const lmonths = availableMonths(state.commission, "month");
  if (!state.ledgerMonth || !lmonths.includes(state.ledgerMonth)) state.ledgerMonth = lmonths[0] || null;
  const imonths = availableMonths(state.docs, "month");
  if (!state.invMonth || !imonths.includes(state.invMonth)) state.invMonth = imonths[0] || months[0] || null;
  const cdates = availableMonths(state.cash, "as_at");
  if (!state.cashDate || !cdates.includes(state.cashDate)) state.cashDate = cdates[0] || null;
}

async function reloadDeals() {
  const [dl, cm] = await Promise.all([
    supabase.from("deals").select("*").order("sno"),
    supabase.from("commission_entries").select("*").order("agent_name"),
  ]);
  state.deals = dl.data || [];
  state.commission = cm.data || [];
}

async function reloadDocs() {
  const { data } = await supabase.from("money_docs").select("*").order("doc_no");
  state.docs = data || [];
}

async function reloadCash() {
  const { data } = await supabase.from("cash_position").select("*").order("sort_order");
  state.cash = data || [];
  const cdates = availableMonths(state.cash, "as_at");
  state.cashDate = cdates[0] || null;
}

// ── auth ─────────────────────────────────────────────────
async function resolveProfile(session) {
  if (!session) { state.profile = null; return; }
  const { data } = await supabase.from("profiles").select("role, agent_name, full_name").eq("id", session.user.id).maybeSingle();
  state.profile = data ? { ...data, email: session.user.email } : { role: "pending", agent_name: null, full_name: "", email: session.user.email };
}

async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { await resolveProfile(session); await loadData(); }
  render();
  supabase.auth.onAuthStateChange(async (_e, s) => {
    if (s && !state.profile) { await resolveProfile(s); await loadData(); render(); }
    if (!s && state.profile) { state.profile = null; render(); }
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
  await resolveProfile(data.session); await loadData(); render();
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
  if (data.session) { await resolveProfile(data.session); await loadData(); render(); }
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
  const showTx = roleIn("owner", "accounts");
  const showLedger = roleIn("owner", "accounts", "admin") || p.role === "agent";
  const showTeam = roleIn("owner");
  const pendingTeam = state.team.filter((t) => t.role === "pending").length;
  const ledgerLabel = p.role === "agent" ? "My Ledger" : "Agent Ledgers";
  const nav = `
  <nav class="nav">
    <div class="nav-brand"><img src="./xsite-logo.png" alt="Xsite"></div>
    ${roleIn("pending") ? "" : navLink("dashboard", "Dashboard")}
    ${showTx ? navLink("transactions", "Transactions") : ""}
    ${roleIn("owner", "accounts", "admin") ? navLink("invoices", "Invoices & Receipts") : ""}
    ${showLedger ? navLink("ledgers", ledgerLabel) : ""}
    ${showTeam ? navLink("team", pendingTeam ? `Team (${pendingTeam})` : "Team") : ""}
    <div class="nav-right">
      <span class="tag tag-neutral">${esc(p.role)}</span>
      <span class="text-muted" style="font-size:13px">${esc(p.full_name || p.email)}</span>
      <a id="pwopen">Password</a>
      <a id="logout">Log out</a>
    </div>
  </nav>`;
  let body = "";
  if (roleIn("pending")) body = viewPending();
  else if (state.screen === "transactions" && showTx) body = viewTransactions();
  else if (state.screen === "invoices" && roleIn("owner", "accounts", "admin")) body = viewInvoices();
  else if (state.screen === "ledgers" && showLedger) body = viewLedgers();
  else if (state.screen === "team" && showTeam) body = viewTeam();
  else body = viewDashboard();
  root.innerHTML = nav + `<main>${body}</main>` + viewDealModal() + viewPwModal() + viewDocModal() + viewCashModal();
  root.querySelectorAll("[data-screen]").forEach((a) => a.onclick = () => { state.screen = a.dataset.screen; render(); });
  document.getElementById("logout").onclick = async () => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch {}
    state.profile = null; render();
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

// ── view: pending approval ───────────────────────────────
function viewPending() {
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">Account created</span><h1 style="margin-top:4px">Awaiting approval</h1>
      <p class="text-muted" style="margin:0">Your account is registered. The owner will approve your access and assign your role — check back soon.</p></div>
    </header>
    <div class="md-empty">Nothing to show yet. Once approved, your workspace appears here automatically.</div>
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
  const btn = tr.querySelector("[data-save]"); btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await supabase.from("profiles").update({ role, agent_name }).eq("id", uid);
  const msg = document.getElementById("teammsg");
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
  const deals = state.deals;
  const received = deals.reduce((s, d) => s + (+d.commission_received || 0), 0);
  const totc = deals.reduce((s, d) => s + (+d.total_commission || 0), 0);
  const tiers = expiryTiers();
  const expiringSoon = tiers.slice(1).reduce((s, t) => s + t.items.length, 0);
  const kicker = p.role === "owner" ? "Owner / Overview" : p.role === "accounts" ? "Accounts workspace" : "Admin workspace";
  const kpis = `
  <section class="md-kpi-grid">
    <div class="md-kpi is-accent"><span class="card-kicker">Deals this month</span><span class="md-kpi-value">${deals.length}</span><span class="md-kpi-detail">June 2026 register</span></div>
    <div class="md-kpi"><span class="card-kicker">Commission received</span><span class="md-kpi-value">${money(Math.round(received))}</span><span class="md-kpi-detail">Sum of received commission</span></div>
    <div class="md-kpi"><span class="card-kicker">Total commission</span><span class="md-kpi-value">${money(Math.round(totc))}</span><span class="md-kpi-detail">Incl. third-party share</span></div>
    <div class="md-kpi"><span class="card-kicker">Expiring ≤90 days</span><span class="md-kpi-value">${expiringSoon}</span><span class="md-kpi-detail">${tiers[0].items.length} already expired</span></div>
  </section>`;
  const cashDates = availableMonths(state.cash, "as_at");
  const cashRows = state.cash.filter((c) => c.as_at === state.cashDate);
  const isLatestCash = state.cashDate === cashDates[0];
  const cashDateOpts = cashDates.map((d) =>
    `<option value="${d}" ${d === state.cashDate ? "selected" : ""}>${showDate(d)}${d === cashDates[0] ? " (latest)" : ""}</option>`).join("");
  const cashCard = roleIn("owner", "accounts") ? `
    <section class="md-section">
      <div class="md-section-header"><h3>Cash position</h3>
        <span style="display:flex;gap:8px;align-items:center">
          ${cashDates.length > 1 ? `<select class="input" id="cashdate" style="padding:5px 8px;font-size:12px;width:auto">${cashDateOpts}</select>` : `<span class="text-muted" style="font-size:11px">As at ${showDate(state.cashDate)}</span>`}
          <button class="btn btn-secondary btn-mini" id="cashedit">Update cash</button>
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
      <div><span class="card-kicker">${esc(kicker)}</span><h1 style="margin-top:4px">June 2026 Overview</h1><p class="text-muted" style="margin:0">Live from the Xsite database.</p></div>
    </header>
    ${kpis}
    ${strip}
  </div>`;
}

function viewAgentDashboard() {
  const rows = state.commission;
  const received = rows.reduce((s, r) => s + (+r.received || 0), 0);
  const vat = rows.reduce((s, r) => s + (+r.vat || 0), 0);
  const share = rows.reduce((s, r) => s + (+r.agent_share || 0), 0);
  return `
  <div class="md-dashboard">
    <header class="md-dashboard-header">
      <div><span class="card-kicker">Private agent account</span><h1 style="margin-top:4px">${esc(state.profile.full_name || state.profile.agent_name || "My account")}</h1><p class="text-muted" style="margin:0">Your June 2026 commission summary.</p></div>
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
  const dealKeys = new Set(rows.map((d) => [d.unit, d.building, d.price, d.tc_start].join("|")));
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
    ${canEdit ? `<td><div class="row-actions"><button class="btn btn-secondary btn-mini" data-editdeal="${d.id}">Edit</button><button class="btn btn-secondary btn-mini" data-deletedeal="${d.id}">Delete</button></div></td>` : ""}</tr>`).join("");
  return `
  <div>
    <div style="margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="card-kicker">Accounts / Master Sheet</span><h1 style="margin-top:4px">Transactions Register</h1><p class="text-muted" style="margin:0">Every deal with tenancy, deposit, and payment details — ${monthLabel(state.txMonth)}.</p></div>
      ${canAdd ? `<button class="btn btn-primary" id="newdeal">+ New deal</button>` : ""}
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
  const today = new Date().toISOString().slice(0, 10);
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
  const totc = parseFloat(f.total_commission), recv = parseFloat(f.commission_received);
  const shared = !!f.agent2.trim();
  const r2 = (n) => Math.round(n * 100) / 100;
  if (Number.isFinite(totc)) f.vat = r2(totc / 21);
  if (Number.isFinite(recv) && Number.isFinite(parseFloat(f.vat))) f.commission_ex_vat = r2(recv - parseFloat(f.vat));
  const exv = parseFloat(f.commission_ex_vat);
  if (Number.isFinite(exv)) {
    f.agent_business = r2(shared ? exv / 2 : exv);
    f.company_share = r2(f.agent_business / 2);
    f.agent_share = r2(f.agent_business / 2);
  }
  ["vat","commission_ex_vat","agent_business","company_share","agent_share"].forEach((k) => {
    const el = document.getElementById("f_" + k); if (el) el.value = f[k];
  });
}
function dealAutoEnd() {
  collectDealForm();
  const f = state.dealForm;
  if (f.tc_start && Number.isFinite(parseInt(f.duration))) {
    const d = new Date(f.tc_start + "T00:00:00");
    d.setMonth(d.getMonth() + parseInt(f.duration));
    d.setDate(d.getDate() - 1);
    const pad = (n) => String(n).padStart(2, "0");
    f.tc_end = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  if (f.groupId) {
    const delD = await supabase.from("deals").delete().eq("group_id", groupId);
    const delC = await supabase.from("commission_entries").delete().eq("group_id", groupId);
    if (delD.error || delC.error) { msgEl.textContent = (delD.error || delC.error).message; btn.disabled = false; btn.textContent = "Save changes"; return; }
  }
  const insD = await supabase.from("deals").insert(dealRows);
  if (insD.error) { msgEl.textContent = insD.error.message; btn.disabled = false; btn.textContent = "Save deal"; return; }
  const insC = await supabase.from("commission_entries").insert(commissionRows);
  if (insC.error) { msgEl.textContent = "Deal saved but ledger entry failed: " + insC.error.message; }
  await reloadDeals();
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
  await supabase.from("commission_entries").delete().eq("group_id", d.group_id);
  const { error } = await supabase.from("deals").delete().eq("group_id", d.group_id);
  if (error) { window.alert("Could not delete: " + error.message); return; }
  await reloadDeals();
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
      <button class="btn btn-primary" id="newdoc">+ New receipt / invoice</button>
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
function nextDocNo(type) {
  const prefix = type === "invoice" ? "INV-" : "RCT-";
  const max = state.docs.filter((d) => d.doc_type === type)
    .reduce((m, d) => Math.max(m, parseInt(String(d.doc_no).replace(/\D/g, "")) || 0), 1000);
  return prefix + (max + 1);
}
function emptyDocForm() {
  return { id: null, doc_type: "receipt", dealLabel: "", client: "", description: "",
    amount: "", doc_date: new Date().toISOString().slice(0, 10), payment_method: "", msg: "" };
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
            <select class="input" id="d_type">
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
  if (f.id) ({ error } = await supabase.from("money_docs").update(rec).eq("id", f.id));
  else ({ error } = await supabase.from("money_docs").insert({ ...rec, doc_no: nextDocNo(type) }));
  if (error) { msgEl.textContent = error.message; btn.disabled = false; btn.textContent = "Save"; return; }
  await reloadDocs();
  state.invMonth = rec.month;
  state.docForm = null;
  render();
}
async function markPaid(id) {
  const { error } = await supabase.from("money_docs").update({ status: "paid" }).eq("id", id);
  if (error) { window.alert("Could not update: " + error.message); return; }
  await reloadDocs(); render();
}
async function deleteDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d || !window.confirm(`Delete ${d.doc_no} (${money(d.amount)})?`)) return;
  const { error } = await supabase.from("money_docs").delete().eq("id", id);
  if (error) { window.alert("Could not delete: " + error.message); return; }
  await reloadDocs(); render();
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
    as_at: new Date().toISOString().slice(0, 10),
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
  const existing = state.cash.filter((c) => c.as_at === f.as_at);
  if (existing.length) {
    const del = await supabase.from("cash_position").delete().eq("as_at", f.as_at);
    if (del.error) { msgEl.textContent = del.error.message; btn.disabled = false; btn.textContent = "Save snapshot"; return; }
  }
  const rows = lines.map((l, i) => ({ as_at: f.as_at, label: l.label.trim(), amount: l.amount, sort_order: i, month: f.as_at.slice(0, 7) }));
  const { error } = await supabase.from("cash_position").insert(rows);
  if (error) { msgEl.textContent = error.message; btn.disabled = false; btn.textContent = "Save snapshot"; return; }
  await reloadCash();
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
    <div style="margin-bottom:20px"><span class="card-kicker">Accounts / Commissions</span><h1 style="margin-top:4px">${state.profile.role === "agent" ? "My Commission Ledger" : "Agent Commission Ledgers"}</h1><p class="text-muted" style="margin:0">${monthLabel(state.ledgerMonth)} statements with VAT and 50/50 share.</p></div>\n    <div class="tabs" style="margin-bottom:16px">${lmonthTabs}</div>
    <div class="ledger-layout">
      <aside class="ledger-panel">
        ${state.profile.role !== "agent" ? `<input class="input" id="lq" type="search" placeholder="Search agents…" value="${esc(state.ledgerQuery)}" style="margin-bottom:12px">` : ""}
        ${list || `<div class="md-empty">No agents.</div>`}
      </aside>
      <div style="min-width:0">${sheet}</div>
    </div>
  </div>`;
}

// ── wiring ───────────────────────────────────────────────
function wireScreen() {
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
  root.querySelectorAll("[data-editdoc]").forEach((b) => b.onclick = () => {
    const d = state.docs.find((x) => x.id === b.dataset.editdoc);
    if (d) { state.docForm = docFormFromRow(d); render(); }
  });
  root.querySelectorAll("[data-deletedoc]").forEach((b) => b.onclick = () => deleteDoc(b.dataset.deletedoc));
  root.querySelectorAll("[data-markpaid]").forEach((b) => b.onclick = () => markPaid(b.dataset.markpaid));
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

function render() { state.profile ? renderApp() : renderLogin(); }

boot();
