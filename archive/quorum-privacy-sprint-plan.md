# Quorum — Enterprise Privacy & Security: Sprint Plan

**6 sprints · User-facing first (S1–S3) · Backend hardening after (S4–S6)**
**Based on codebase review: June 2026**

---

## SPRINT 1 — Website Trust Layer
**~18h · 1 file changed (index.html) + 1 new API route**
*The public website collects name, email, WhatsApp & sensitive decision text with zero legal cover. Fix the visible surface first — this is what prospects and enterprise buyers see before the app.*

### S1-01 · CRITICAL — Cookie/localStorage consent banner
- Show on first visit before any localStorage writes
- Three buttons: Accept All · Reject Non-Essential · Manage Preferences
- Gate `getOrCreateDeviceId()` behind consent
- Store choice in `quorum_cookie_consent` localStorage key
- **Files:** `index.html` — inject banner + consent JS before any storage calls

### S1-02 · CRITICAL — Privacy notice + consent on request form
- Add below Step 3 submit button: "By submitting you agree that Quorum may store your name, email, and decision summary to process your request."
- Add required checkbox — disable Submit until checked
- Link to Privacy Policy (stub URL acceptable in S1)
- **Files:** `index.html` · step3 modal — add checkbox + validation in `checkStep3()`

### S1-03 · CRITICAL — Remove hardcoded Supabase credentials
- Lines 2821–2822: live project URL and full anon JWT in public source
- Replace `insertSessionRequest()` with a call to a thin proxy endpoint on the Next.js app (`/api/waitlist`) that holds the key server-side
- **Files:** `index.html` lines 2821–2830 → new `app/api/waitlist/route.ts`

### S1-04 · HIGH — Footer legal links
- Replace "Private · © 2026" with: Privacy Policy · Cookie Policy · Terms · Security & Trust · hello@quorum.so · © 2026
- Pages can be stubs initially — the links must exist before enterprise review
- **Files:** `index.html` lines 2682–2685

### S1-05 · HIGH — Cookie preferences centre
- Triggered from "Manage Preferences" banner button and footer link
- Toggles: Strictly Necessary (always on) · Functional (device ID, session history) · Analytics
- Save to `quorum_cookie_consent`
- **Files:** `index.html` — new modal + JS preference store

---

## SPRINT 2 — In-App Trust Experience
**~20h · 5–6 files changed + 2 new components**
*Users storing board-level decisions have no idea what happens to their data, who processes it, or how it's protected. Every enterprise security review will look for this.*

### S2-01 · CRITICAL — App consent banner (gate device ID)
- Add `CookieConsent` client component to `layout.tsx`
- `getOrCreateDeviceId()` in `storage.ts` fires on first visit with no consent — must be gated
- Check `quorum_cookie_consent` before writing any non-essential localStorage key
- **Files:** `app/layout.tsx` · `lib/storage.ts` · new `components/CookieConsent.tsx`

### S2-02 · CRITICAL — AI processing disclosure
- When Council analysis starts, show inline notice: "Your decision is being analysed by Anthropic Claude. Quorum does not share decisions with third parties beyond the AI processing required to run this analysis."
- Required under GDPR Art 13 and DPDP
- Suppress or qualify if DeepSeek is active provider — cannot make Anthropic's data claim for DeepSeek
- **Files:** `components/PersonaPanel.tsx` or new `components/AiDisclosure.tsx`

### S2-03 · HIGH — Decision page trust badge strip
- Small contextual strip on session + record pages
- Only show claims that are true: 🔒 Encrypted at rest (AES-256-GCM) · 👤 Visible only to you · 🤖 Analysed by Anthropic — not used for model training
- If `DB_ENCRYPTION_KEY` unset: omit encryption claim. If DeepSeek active: adjust AI claim
- **Files:** new `components/TrustBadgeStrip.tsx` · `app/session/[id]/page.tsx` · `app/record/[id]/page.tsx`

### S2-04 · HIGH — App-wide footer with legal links
- Add persistent footer to `layout.tsx`: Privacy Policy · Cookie Policy · Terms · Security & Trust · © 2026 Quorum
- Style to match existing dark/light theme tokens from `globals.css`
- **Files:** `app/layout.tsx` · new `components/AppFooter.tsx`

### S2-05 · HIGH — Auth screen terms acknowledgement
- Add below the magic link send button: "By continuing you agree to our Terms of Service and Privacy Policy."
- Establishes contract as legal basis for GDPR processing at moment of account creation
- **Files:** `components/AuthPanel.tsx` — add legal footnote below send button

---

## SPRINT 3 — Legal Documents + Privacy & Security Settings
**~28h · 6 new pages in app/ · Legal drafting required in parallel**
*Zero legal pages exist anywhere. No settings for privacy, consent, data export, or account deletion. Any enterprise procurement review or legal due diligence halts here.*

### S3-01 · CRITICAL — Privacy Policy page `/privacy`
Must cover accurately (no aspirational claims):
- Data collected: email, device ID, decision text (encrypted), AI analysis, bias scores, behavioral profiles
- Legal basis: contract (authenticated users), legitimate interests (anon sessions), consent (analytics)
- AI processing by Anthropic (link their policy) — and DeepSeek if active
- Third-party processors: Supabase (US), Railway (US), Anthropic (US), Google Fonts (US)
- Retention periods · GDPR + DPDP rights · Contact email
- **Files:** `app/privacy/page.tsx` — new static page

### S3-02 · CRITICAL — Terms of Service `/terms`
Must include:
- Service description · User responsibilities · Data ownership (user owns their decisions)
- AI content disclaimer: analysis is informational only — not legal, financial, or investment advice
- Limitation of liability · Subscription & payment · Termination · Governing law
- **Files:** `app/terms/page.tsx` — new static page

### S3-03 · HIGH — Cookie Policy `/cookies`
List every localStorage key by name, purpose, category, duration:
- `quorum_theme` (strictly necessary) · `quorum_device_id` (functional, consent required)
- `quorum_session_ids` (functional, consent required) · `quorum_user_email` (authentication)
- `quorum_cookie_consent` (strictly necessary) · Supabase auth tokens (strictly necessary)
- **Files:** `app/cookies/page.tsx` — new static page

### S3-04 · HIGH — Security & Trust page `/security`
Only include technically provable facts:
- ✅ AES-256-GCM field encryption · Magic link auth · TLS in transit · Railway/Supabase US hosting · RLS on all tables
- ❌ Do NOT include: SOC 2, pen test results, MFA, key rotation (none of these are implemented yet)
- **Files:** `app/security/page.tsx` — new static page

### S3-05 · MEDIUM — Settings → Privacy Center
New settings tab or page at `/settings/privacy`:
- Consent preferences (toggle functional/analytics on/off — updates `quorum_cookie_consent`)
- Export my data (triggers JSON download — stub: email request until S6-02 builds the endpoint)
- Delete my account (confirmation modal → email team with 30-day SLA until S6-03 is built)
- Link to Privacy Policy
- **Files:** new `app/settings/privacy/page.tsx`

### S3-06 · MEDIUM — Settings → Security Center
New settings tab:
- Current session info (email, last sign-in)
- Sign out all devices (calls `supabase.auth.signOut({ scope: 'global' })`)
- Re-send magic link / change email
- Full login history deferred to S6 when audit_log is built
- **Files:** new `app/settings/security/page.tsx`

---

## SPRINT 4 — Critical Backend: Fix the Actual Vulnerabilities
**~16h · 4 files changed + 1 new SQL migration**
*Four working exploits exist today. A security researcher, hostile competitor, or enterprise pen-tester will find them. Must be closed before any funded or institutional user is onboarded.*

### S4-01 · CRITICAL — Fix RLS: replace `using(true)` on all 4 sensitive tables
Current state: `sessions_ontology`, `examiner_responses`, `bias_library`, `contradiction_log` all use `using (true)` — any anon-key caller can read ANY user's data via Supabase REST.

Fix: Replace with user-scoped joins:
- `sessions_ontology` / `examiner_responses` → via `session_id → sessions.user_id = auth.uid()`
- `bias_library` / `contradiction_log` → add `user_id uuid FK → auth.users` column + `using (auth.uid() = user_id)`

Service role API calls continue to work (bypass RLS). Add new migration file.
- **Files:** `supabase/sprint4_security_rls_fix.sql` — new migration

### S4-02 · CRITICAL — Stop accepting client-supplied `user_id` in session creation
Current: `POST /api/session` accepts `user_id` from request body and writes it directly to DB. Attacker submits any UUID → attaches sessions to victim's account, poisons their bias library.

Fix: Extract user identity exclusively from the Supabase Bearer token server-side using `supabase.auth.getUser(token)`. Never trust client-supplied identity.
- **Files:** `app/api/session/route.ts` — remove `user_id` from destructured body, add server-side token resolution

### S4-03 · CRITICAL — Fix payment route: stop using service role key as HTTP auth
Current: `if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY)` — the DB master key is compared to an HTTP header, meaning it's transmitted and logged by Railway/proxies.

Fix: Add a separate `PAYMENT_WEBHOOK_SECRET` env var for this route only.
- **Files:** `app/api/payment/create-subscription/route.ts` · `.env.example`

### S4-04 · HIGH — Add all missing secrets to `.env.example`
Five security-critical vars are absent — any new deployment ships broken by default:
- `ADMIN_CODE` · `CRON_SECRET` · `DB_ENCRYPTION_KEY` · `PAYMENT_WEBHOOK_SECRET` · `INTERNAL_API_SECRET`
- Add with generation commands and "REQUIRED in production" markers
- **Files:** `.env.example`

### S4-05 · HIGH — HTTP security headers in `next.config.ts`
`next.config.ts` has no `headers()` config — zero defensive HTTP headers today.

Add: Content-Security-Policy (allow Supabase, fonts.googleapis.com, api.anthropic.com) · Strict-Transport-Security · X-Frame-Options: DENY · X-Content-Type-Options: nosniff · Referrer-Policy: strict-origin-when-cross-origin · Permissions-Policy
- **Files:** `next.config.ts` — add `headers()` export

---

## SPRINT 5 — Backend Hardening: Rate Limiting, Encryption & API Auth
**~20h · 8–10 files + 1 new SQL migration**
*No rate limits on any endpoint means one bad actor can exhaust AI credits and crash the service in minutes. Encryption silently fails open. Internal API routes have no auth.*

### S5-01 · HIGH — Rate limiting on all public API routes
Zero rate limits exist. Recommended: Upstash Redis + `@upstash/ratelimit` (available on Railway).

Limits:
- `/api/auth` → 5 req/15min/IP (prevent email spam/enumeration)
- `/api/session` → 10/hour/IP (prevent AI cost explosion)
- `/api/persona` → 20/hour/user
- Admin endpoints → 20/hour/IP with 5-attempt lockout

Add `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` to `.env.example`
- **Files:** new `lib/ratelimit.ts` · `app/api/auth/route.ts` · `app/api/session/route.ts` · `app/api/persona/route.ts` · `app/api/admin/*/route.ts`

### S5-02 · HIGH — Fix encryption fail-open: loud production warning
Currently: if `DB_ENCRYPTION_KEY` is unset, `encrypt()` silently returns plaintext. New deploys ship unencrypted by default with no indication.

Fix: Add a startup check in a Next.js instrumentation hook — if `NODE_ENV=production` and key is missing, log a loud `console.error` with clear instructions. Don't crash (backward compat) but make failure impossible to miss.
- **Files:** `lib/encryption.ts` · new `instrumentation.ts` (Next.js startup hook)

### S5-03 · HIGH — Authenticate internal server-to-server routes
Routes `/api/ontology`, `/api/bias-score`, `/api/structural-match` are called fire-and-forget with no auth — any caller who guesses a session UUID can trigger AI inference.

Add `INTERNAL_API_SECRET` env var. Server-to-server calls include `Authorization: Bearer <secret>`. Routes reject without it.
- **Files:** new `lib/internal-auth.ts` · `app/api/ontology/route.ts` · `app/api/bias-score/route.ts` · `app/api/structural-match/route.ts`

### S5-04 · MEDIUM — Encrypt `bias_library.user_email` + add `user_id` FK
After S4-01's RLS fix, encrypt the plaintext email column using existing `encrypt()`. Add `user_id uuid FK` to `bias_library` so user-scoped RLS works without email as key. Migration + backfill script.
- **Files:** `supabase/sprint5_bias_library_hardening.sql` · `scripts/encrypt-bias-emails.ts`

### S5-05 · MEDIUM — Switch default AI provider to Anthropic
One-line fix, significant implication: `.env.example` sets `AI_PROVIDER=deepseek` as default — user decision text goes to Chinese infrastructure in all new deployments.

Change default to `anthropic`. Add comment: DeepSeek requires explicit opt-in and GDPR cross-border transfer disclosure.
- **Files:** `.env.example` — change `AI_PROVIDER` default + add warning comment

---

## SPRINT 6 — Audit Log, Data Rights & SOC 2 Foundation
**~24h · 5 new routes + 1 SQL migration + 1 lib helper**
*Builds the infrastructure that makes compliance claims credible — structured audit trails, actual data deletion, full data export, and admin hardening. Required for SOC 2 gap analysis and enterprise DPA execution.*

### S6-01 · HIGH — Structured `audit_log` table + logging helper
New table schema:
```sql
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  timestamptz DEFAULT now() NOT NULL,
  actor_id    uuid,
  actor_email text,
  action      text NOT NULL, -- 'session.create', 'session.delete', 'admin.access', 'account.delete', 'auth.magic_link_sent'
  resource_id uuid,
  ip_address  text,
  user_agent  text,
  metadata    jsonb
);
-- RLS: no user can read audit_log (admin-only via service role)
```
Add `writeAuditLog()` helper. Wire into: all admin routes, session DELETE, account deletion, auth sends.
- **Files:** `supabase/sprint6_audit_log.sql` · new `lib/audit.ts` · `app/api/admin/*/route.ts` · `app/api/session/route.ts`

### S6-02 · HIGH — Data export endpoint (GDPR Art. 20 portability)
New authenticated endpoint `GET /api/account/export`.

Collects and decrypts: all sessions, all messages, all examiner responses, all outcomes, bias_library rows, sessions_ontology rows. Returns as `quorum-data-export-{date}.json`. Rate limit: 1 export per 24 hours. Logs to `audit_log`. Wire into Privacy Center from S3-05.
- **Files:** new `app/api/account/export/route.ts`

### S6-03 · HIGH — Account deletion endpoint (GDPR Art. 17 erasure)
New authenticated endpoint `DELETE /api/account`.

Deletes cascade: sessions → messages, examiner_responses, outcomes, ontology, structural data; bias_library rows; contradiction_log; mirror_access; avoidance_alerts; auth.users entry via `admin.deleteUser()`. Send confirmation email. Log to `audit_log`. Consider 30-day soft-delete before hard wipe.
- **Files:** new `app/api/account/route.ts` · wire into Privacy Center from S3-05

### S6-04 · MEDIUM — Admin auth hardening: lockout + structured logging
Add: (1) Failed attempt counter in Upstash Redis → lock IP for 15 min after 5 failures; (2) All admin access events written to `audit_log` with IP + user-agent; (3) Railway IP allowlist documentation in runbook.
- **Files:** `app/api/admin/dashboard/route.ts` · `lib/audit.ts`

### S6-05 · MEDIUM — Admin audit log viewer
Extend admin dashboard: new tab showing last 100 `audit_log` entries. Columns: timestamp · actor email · action · resource ID · IP. Filterable by action type and date. Read-only. Minimum evidence required for SOC 2 CC7 and enterprise security reviews.
- **Files:** `app/admin/page.tsx` · new `app/api/admin/audit-log/route.ts`

---

## Summary

| Sprint | Focus | Effort | Blocks |
|---|---|---|---|
| S1 · Website | Cookie consent, form privacy, credentials, footer | ~18h | Enterprise outreach |
| S2 · App Trust | Consent banner, AI disclosure, trust badges, footer, auth notice | ~20h | Any paying users |
| S3 · Legal & Settings | 4 legal pages, Privacy Center, Security Center | ~28h | Procurement reviews, GDPR |
| S4 · Critical Backend | Fix 4 exploits, security headers, .env.example | ~16h | Institutional users |
| S5 · Hardening | Rate limits, encryption warnings, internal API auth, AI provider default | ~20h | Scale, abuse |
| S6 · Audit & Compliance | Audit log, data export, deletion, SOC 2 foundation | ~24h | Enterprise DPAs, SOC 2 |

**Total: ~126h engineering + ~20h legal drafting**

---

## What Quorum can claim after all 6 sprints

- "All user data encrypted at rest (AES-256-GCM)"
- "Cookie consent management — accept, reject, or customise"
- "GDPR-ready: data export, account deletion, privacy controls in-app"
- "Privacy Policy, Terms of Service, Cookie Policy, and Security & Trust page published"
- "Rate limiting on all public endpoints"
- "HTTP security headers (CSP, HSTS, X-Frame-Options)"
- "Structured audit log for all admin and sensitive operations"
- "AI processing disclosed to users at point of analysis"
- "RLS enforced across all database tables"
- "No advertising, no data selling"
