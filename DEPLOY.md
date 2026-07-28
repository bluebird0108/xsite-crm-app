# Deploying the Xsite CRM (private repo → free static host)

The repo is private, so GitHub Pages won't serve it on the free plan. Host the
static site on **Netlify** (or Vercel / Cloudflare Pages) — all serve private
GitHub repos free. It's a plain static app (no build step); `netlify.toml`
already points Netlify at the repo root.

## Netlify (recommended — 2 minutes)

1. Go to https://app.netlify.com → **Add new site → Import an existing project**.
2. Choose **GitHub**, authorize Netlify, and pick **bluebird0108/xsite-crm-app**
   (grant access to this private repo when prompted).
3. Settings are auto-detected from `netlify.toml`:
   - **Build command:** *(empty)*
   - **Publish directory:** `.`
4. **Deploy site.** You'll get a URL like `https://<name>.netlify.app`.
   Every push to `main` redeploys automatically.

### Vercel alternative
https://vercel.com/new → import the repo → **Framework Preset: Other**,
**Build Command:** empty, **Output Directory:** `.` → Deploy.

### Cloudflare Pages alternative
Pages → Create → Connect the repo → **Framework preset: None**,
**Build command:** empty, **Build output directory:** `/` → Save & Deploy.

## ⚠️ One required Supabase setting after deploy

Auth redirect URLs are origin-specific. Once you have the new domain
(`https://<name>.netlify.app`), add it in Supabase:

**Supabase dashboard → Authentication → URL Configuration**
- **Site URL:** `https://<name>.netlify.app`
- **Redirect URLs:** add `https://<name>.netlify.app` (and `/**` if you want
  to allow any path)

Without this, **magic-link / email-confirmation** sign-ins will fail on the new
domain. Plain **email + password** sign-in works regardless.

(A custom domain later? Point it at Netlify and add that URL to the same
Supabase list.)
