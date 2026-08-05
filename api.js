// Drop-in replacement for the Supabase JS client, backed by the self-hosted
// XSITE API (/api). Exposes just the surface app.js uses: .auth.*, .from(...)
// query builder, .rpc(), and .storage.from("documents"). Token is kept in
// localStorage; the query builder is thenable so `await sb.from(t).select()...`
// works exactly like supabase-js.
const API_BASE = "/api";
const TOKEN_KEY = "xsite_token";

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split(".")[1])); } catch { return null; }
}

export function createClient() {
  let token = localStorage.getItem(TOKEN_KEY) || null;
  const authHeaders = () => (token ? { authorization: `Bearer ${token}` } : {});

  async function http(method, path, body) {
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers: { "content-type": "application/json", ...authHeaders() },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) { return { data: null, error: { message: "Network error — is the server reachable?" } }; }
    let json = null; try { json = await res.json(); } catch { /* no body */ }
    if (!res.ok) return { data: null, error: { message: (json && json.error) || res.statusText, status: res.status } };
    return { data: json && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : json, error: null };
  }

  // ── query builder ──────────────────────────────────────────────────
  function from(table) {
    const st = { op: "select", select: "*", filters: {}, order: null, limit: null, offset: null, payload: null };
    async function exec() {
      if (st.op === "select") {
        const p = new URLSearchParams();
        if (st.select && st.select !== "*") p.set("select", String(st.select).replace(/\s+/g, ""));
        if (st.order) p.set("order", st.order);
        if (st.limit != null) p.set("limit", st.limit);
        if (st.offset != null) p.set("offset", st.offset);
        if (Object.keys(st.filters).length) p.set("where", JSON.stringify(st.filters));
        const r = await http("GET", `/db/${table}?${p.toString()}`);
        return finalize(r);
      }
      if (st.op === "insert") return finalize(await http("POST", `/db/${table}`, st.payload));
      if (st.op === "update") return finalize(await http("PATCH", `/db/${table}`, { values: st.payload, where: st.filters }));
      if (st.op === "delete") return finalize(await http("DELETE", `/db/${table}`, { where: st.filters }));
    }
    function finalize(r) {
      if (r.error) return r;
      let data = r.data;
      if (st.single) data = Array.isArray(data) ? (data[0] ?? null) : data;
      else if (st.maybe) data = Array.isArray(data) ? (data[0] ?? null) : data;
      return { data, error: null };
    }
    const chain = {
      select(cols) { if (st.op === "select") st.select = cols || "*"; return chain; },
      insert(rows) { st.op = "insert"; st.payload = rows; return chain; },
      update(vals) { st.op = "update"; st.payload = vals; return chain; },
      delete() { st.op = "delete"; return chain; },
      upsert(rows) { st.op = "insert"; st.payload = rows; return chain; },
      eq(col, val) { st.filters[col] = val; return chain; },
      order(col, opts) { st.order = `${col}.${opts && opts.ascending === false ? "desc" : "asc"}`; return chain; },
      range(a, b) { st.offset = a; st.limit = b - a + 1; return chain; },
      limit(n) { st.limit = n; return chain; },
      single() { st.single = true; return exec(); },
      maybeSingle() { st.maybe = true; return exec(); },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    return chain;
  }

  const rpc = async (name, payload) => http("POST", `/rpc/${name}`, payload || {});

  // ── auth ───────────────────────────────────────────────────────────
  const setToken = (t) => { token = t; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); };
  const sessionFromToken = () => {
    if (!token) return null;
    const p = decodeJwt(token);
    if (!p) return null;
    return { access_token: token, user: { id: p.sub, email: p.email } };
  };

  const auth = {
    async getSession() { return { data: { session: sessionFromToken() }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      const r = await http("POST", "/auth/login", { email, password });
      if (r.error) return { data: { session: null, user: null }, error: r.error };
      setToken(r.data.token);
      return { data: { session: sessionFromToken(), user: sessionFromToken().user }, error: null };
    },
    async signUp({ email, password, options }) {
      const full_name = options && options.data ? options.data.full_name : undefined;
      const r = await http("POST", "/auth/signup", { email, password, full_name });
      if (r.error) return { data: { session: null, user: null }, error: r.error };
      setToken(r.data.token);
      return { data: { session: sessionFromToken(), user: sessionFromToken().user }, error: null };
    },
    async signOut() { setToken(null); return { error: null }; },
    async updateUser({ password }) {
      const r = await http("POST", "/auth/change-password", { password });
      if (!r.error && r.data && r.data.token) setToken(r.data.token);
      return { data: r.data, error: r.error };
    },
    async resetPasswordForEmail() {
      return { data: null, error: { message: "Email reset isn't available. Ask an owner or admin to set your password." } };
    },
    async signInWithOtp() {
      return { data: null, error: { message: "Email sign-in links aren't available. Sign in with your password." } };
    },
  };

  // ── storage (bucket name ignored; single documents store) ──────────
  const storage = {
    from() {
      return {
        async upload(path, file) {
          const fd = new FormData();
          fd.append("path", path);
          fd.append("file", file);
          let res;
          try { res = await fetch(`${API_BASE}/files/upload`, { method: "POST", headers: { ...authHeaders() }, body: fd }); }
          catch { return { data: null, error: { message: "Upload failed — network error." } }; }
          const json = await res.json().catch(() => null);
          if (!res.ok) return { data: null, error: { message: (json && json.error) || "Upload failed" } };
          return { data: json.data, error: null };
        },
        async createSignedUrl(path) {
          const r = await http("POST", "/files/sign", { path });
          return { data: r.data, error: r.error };
        },
        async remove(paths) {
          const r = await http("POST", "/files/remove", { paths });
          return { data: r.data, error: r.error };
        },
      };
    },
  };

  return { auth, from, rpc, storage };
}
