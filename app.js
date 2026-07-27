import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById("root");

const state = {
  profile: null,
  screen: "dashboard",
  agents: [], deals: [], commission: [], cash: [],
  selectedAgent: null,
  txQuery: "", txType: "All", ledgerQuery: "",
};

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
  const [ag, dl, cm, ch] = await Promise.all([
    supabase.from("agents").select("*").order("name"),
    supabase.from("deals").select("*").order("sno"),
    supabase.from("commission_entries").select("*").order("agent_name"),
    roleIn("owner", "accounts") ? supabase.from("cash_position").select("*").order("sort_order") : Promise.resolve({ data: [] }),
  ]);
  state.agents = ag.data || [];
  state.deals = dl.data || [];
  state.commission = cm.data || [];
  state.cash = ch.data || [];
}

// ── auth ─────────────────────────────────────────────────
async function resolveProfile(session) {
  if (!session) { state.profile = null; return; }
  const { data } = await supabase.from("profiles").select("role, agent_name, full_name").eq("id", session.user.id).maybeSingle();
  state.profile = data ? { ...data, email: session.user.email } : { role: "agent", agent_name: null, full_name: "", email: session.user.email };
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
        <h1 class="login-title">Sign in</h1>
        <p class="login-intro">Enter your work email. We'll send a one-tap sign-in link — no password to remember.</p>
        <div class="login-field">
          <label for="email">Work email</label>
          <input class="input" id="email" type="email" autocomplete="email" placeholder="you@xsite.example">
        </div>
        <div class="login-actions">
          <button class="btn btn-primary" id="send" style="width:100%">Send sign-in link</button>
        </div>
        <p class="login-msg ${msg ? msg.kind : ""}" id="msg">${msg ? esc(msg.text) : ""}</p>
        <p class="login-security-note">Authorized Xsite personnel only · Dubai, UAE</p>
      </div>
    </div>
  </div>`;
  document.getElementById("send").onclick = sendLink;
  document.getElementById("email").addEventListener("keydown", (e) => { if (e.key === "Enter") sendLink(); });
}

async function sendLink() {
  const email = document.getElementById("email").value.trim();
  if (!email) { renderLogin({ kind: "is-error", text: "Enter your work email." }); return; }
  const btn = document.getElementById("send"); btn.disabled = true; btn.textContent = "Sending…";
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) { renderLogin({ kind: "is-error", text: error.message }); }
  else { renderLogin({ kind: "is-ok", text: "Check your email for the sign-in link." }); }
}

// ── render: app shell ────────────────────────────────────
function navLink(screen, label) {
  return `<a data-screen="${screen}" class="${state.screen === screen ? "is-active" : ""}">${label}</a>`;
}
function renderApp() {
  const p = state.profile;
  const showTx = roleIn("owner", "accounts");
  const showLedger = roleIn("owner", "accounts", "admin") || p.role === "agent";
  const ledgerLabel = p.role === "agent" ? "My Ledger" : "Agent Ledgers";
  const nav = `
  <nav class="nav">
    <div class="nav-brand"><img src="./xsite-logo.png" alt="Xsite"></div>
    ${navLink("dashboard", "Dashboard")}
    ${showTx ? navLink("transactions", "Transactions") : ""}
    ${showLedger ? navLink("ledgers", ledgerLabel) : ""}
    <div class="nav-right">
      <span class="tag tag-neutral">${esc(p.role)}</span>
      <span class="text-muted" style="font-size:13px">${esc(p.full_name || p.email)}</span>
      <a id="logout">Log out</a>
    </div>
  </nav>`;
  let body = "";
  if (state.screen === "transactions" && showTx) body = viewTransactions();
  else if (state.screen === "ledgers" && showLedger) body = viewLedgers();
  else body = viewDashboard();
  root.innerHTML = nav + `<main>${body}</main>`;
  root.querySelectorAll("[data-screen]").forEach((a) => a.onclick = () => { state.screen = a.dataset.screen; render(); });
  document.getElementById("logout").onclick = async () => { await supabase.auth.signOut(); };
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
  const cashCard = roleIn("owner", "accounts") ? `
    <section class="md-section">
      <div class="md-section-header"><h3>Cash position</h3><span class="text-muted" style="font-size:11px">As at ${state.cash[0] ? showDate(state.cash[0].as_at) : ""}</span></div>
      ${state.cash.map((c) => `<div class="cash-row ${/remaining/i.test(c.label) ? "is-remaining" : /total/i.test(c.label) ? "is-total" : ""}"><span>${esc(c.label)}</span><strong>${money(c.amount)}</strong></div>`).join("")}
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
  const rows = state.deals.filter((d) =>
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
    <td class="numeric">${money(d.security_deposit)}</td><td>${esc(d.cheque_count || "—")}</td><td>${esc(d.payment_method || "—")}</td></tr>`).join("");
  return `
  <div>
    <div style="margin-bottom:20px"><span class="card-kicker">Accounts / Master Sheet</span><h1 style="margin-top:4px">Transactions Register</h1><p class="text-muted" style="margin:0">Every June 2026 deal with tenancy, deposit, and payment details.</p></div>
    ${expBlock}
    <div class="tx-toolbar">
      <input class="input" id="txq" type="search" placeholder="Search agent, building, unit, landlord, tenant…" value="${esc(state.txQuery)}">
      <div class="tabs">${tabs}</div>
      <span class="text-muted" style="font-size:12px">${rows.length} rows · ${dealKeys.size} unique deals</span>
    </div>
    <div class="sheet">
      <div class="sheet-hint">Full register — scroll horizontally for tenancy and payment columns</div>
      <div class="table-wrap"><table class="grid wide">
        <thead><tr><th>S.No</th><th>Date</th><th>Agent(s)</th><th>Third party</th><th>Type</th><th>Unit</th><th>Building</th><th>Area</th><th>Rent / Sale price</th><th>Total commission</th><th>Commission received</th><th>Landlord</th><th>Tenant</th><th>TC start</th><th>TC end</th><th>Deposit</th><th>Cheques</th><th>Payment</th></tr></thead>
        <tbody>${body}
          <tr class="total-row"><td></td><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="numeric">${money(Math.round(totc*100)/100)}</td><td class="numeric">${money(Math.round(recv*100)/100)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        </tbody></table></div>
    </div>
    ${rows.length === 0 ? `<div class="md-empty" style="margin-top:12px">No transactions match the current search or filter.</div>` : ""}
  </div>`;
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
  const rows = state.commission.filter((r) => r.agent_name === state.selectedAgent);
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
    <div class="sheet"><div class="sheet-hint">${esc(state.selectedAgent)} — June 2026 commission statement</div>
    <div class="table-wrap"><table class="grid wide">
      <thead><tr><th>Date</th><th>Third party</th><th>Agent 2</th><th>Type</th><th>Unit</th><th>Building</th><th>Area</th><th>Annual value</th><th>Total commission</th><th>Received</th><th>VAT</th><th>Ex-VAT</th><th>Agent business</th><th>Xsite share</th><th>Agent share</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(showDate(r.entry_date, r.entry_date_raw))}</td><td class="tp-cell">${esc(r.third_party || "—")}</td><td>${esc(r.agent2 || "—")}</td><td>${esc(r.deal_type)}</td><td class="unit-cell">${esc(r.unit)}</td><td>${esc(r.building)}</td><td>${esc(r.area)}</td><td class="numeric">${money(r.annual_value)}</td><td class="numeric">${money(r.total_commission)}</td><td class="numeric">${money(r.received)}</td><td class="numeric">${money(r.vat)}</td><td class="numeric">${money(r.commission_ex_vat)}</td><td class="numeric">${money(r.agent_business)}</td><td class="numeric">${money(r.xsite_share)}</td><td class="numeric">${money(r.agent_share)}</td></tr>`).join("")}</tbody>
    </table></div></div>` : `<div class="md-empty">No commission records to show.</div>`;
  return `
  <div>
    <div style="margin-bottom:20px"><span class="card-kicker">Accounts / Commissions</span><h1 style="margin-top:4px">${state.profile.role === "agent" ? "My Commission Ledger" : "Agent Commission Ledgers"}</h1><p class="text-muted" style="margin:0">June 2026 statements with VAT and 50/50 share.</p></div>
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
  if (txq) txq.oninput = () => { state.txQuery = txq.value; const s = root.querySelector(".sheet"); rerenderTx(); };
  root.querySelectorAll("[data-txtype]").forEach((b) => b.onclick = () => { state.txType = b.dataset.txtype; rerenderTx(); });
  const lq = document.getElementById("lq");
  if (lq) lq.oninput = () => { state.ledgerQuery = lq.value; rerenderLedgers(); };
  root.querySelectorAll("[data-agent]").forEach((b) => b.onclick = () => { state.selectedAgent = b.dataset.agent; rerenderLedgers(); });
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
