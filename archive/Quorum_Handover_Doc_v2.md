# QUORUM — Living Handover Document
> **Last Updated:** April 30, 2026  
> **Active Sprint:** Sprint 5/6 bug fix (structural_scores + identity continuity)  
> **Next:** Validate fixes with clean test run → Sprint 7 Mirror Module

---

## 📌 HOW TO USE THIS DOC
Update the **Current State**, **Active Bugs**, and **Latest Prompt** sections after every session. All other sections are reference — update only when architecture or vision changes.

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (April 30, end of day):**
Three bugs remain from Sprint 5/6 integration testing. All three are diagnosed and patched. Patches are NOT yet deployed. The next session's first job is to apply the patches from `/DIAGNOSIS_AND_PATCHES.md` and the five patched source files, run the SQL migration, clear prototype data, and re-run the end-to-end test checklist.

**Three bugs and their fixes:**

**Bug A — structural_scores always empty (Fix A1 + A2)**
- Root cause: `structural_scores` table missing its unique constraint `(session_id_a, session_id_b)`, or table doesn't exist yet. The upsert in `structural-match/route.ts` silently swallowed the error with no logging.
- Fix A1: Run `supabase/sprint5b_structural_scores_fix.sql` in Supabase SQL Editor.
- Fix A2: Patched `app/api/structural-match/route.ts` — structural_scores upsert now has error logging. If it still fails after migration, Railway logs will show `[StructuralMatch] structural_scores upsert FAILED: ...` with the exact Postgres error code.

**Bug B — new post-auth sessions not stamping user_id (Fix B1 + B2)**
- Root cause: `page.tsx` handleSubmit sends `user_email` and `device_id` to `/api/session` but never `user_id`. Session route doesn't accept it.
- Fix B1: Patched `app/page.tsx` — handleSubmit now reads `supabase.auth.getSession()` before submission and includes `user_id` in the session creation payload.
- Fix B2: Patched `app/api/session/route.ts` — accepts and stores `user_id` from request body.

**Bug C — pre-auth device_id bias rows not retro-linked after auth (Fix C1 + C2)**
- Root cause: Auth callback doesn't pass `device_id` to link-sessions API. Link-sessions route only upgrades rows where `user_email` matches — never touches device_id-only rows.
- Fix C1: Patched `app/auth/callback/page.tsx` — reads `getStoredDeviceId()` and passes it to link-sessions. Removed `if (storedIds.length > 0)` guard so link-sessions always fires post-auth.
- Fix C2: Patched `app/api/auth/link-sessions/route.ts` — added block to update `bias_library` where `device_id = deviceId AND user_email IS NULL AND user_id IS NULL`, promoting them to the authenticated user_id lane.

**Deploy order:**
1. Run `supabase/sprint5b_structural_scores_fix.sql` in Supabase SQL Editor.
2. Deploy the five patched files via GitHub → Railway.
3. Truncate prototype test data (SQL in DIAGNOSIS_AND_PATCHES.md Section 3).
4. Run the Phase 1–6 test checklist in DIAGNOSIS_AND_PATCHES.md Section 5.
5. After full pass: begin Sprint 7.

**Only start Sprint 7 (Mirror) after all three bugs are confirmed fixed via the test checklist.**

---

## 🧠 WHAT IS QUORUM

**Quorum** is a private AI-powered decision-making tool. It presents 6 AI "advisor" personas that analyse a user's high-stakes decision in parallel — each from a distinct psychological and strategic lens — then synthesises their views into a directional recommendation.

**Not an AI chatbot. Not a SaaS tool.**
It is a **Judgment Compounding System**: the quality of a user's decisions improves the more they use it, because the tool learns their decision patterns, biases, and mental models over time.

---

## 🔭 PRODUCT VISION

**5-module long-term arc:**
- **Council** → immediate multi-perspective decision analysis
- **Ledger** → structured decision memory, ontology, retrieval, and bias signal collection
- **Mirror** → surfaced personal insight, fingerprinting, contradiction, and decision independence
- **Graph** → connected network of decisions, stakeholders, influences, and outcomes
- **Legacy** → generational transfer / decision-philosophy continuity

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. Initially India and Middle East. High-stakes decisions where ₹25K for a Brief is obviously cheap relative to a bad call.

**Positioning:** Apple × McKinsey energy. Private thinking partner with boardroom-grade UX. Not a chatbot.

---

## ⚙️ CRITICAL IMPLEMENTATION / DO-NOT-REDEBATE DECISIONS

| Decision | Rationale |
|---|---|
| Bias scoring triggered server-side from `/api/examiner POST` | Client-side fails on stale connections / Railway cold starts |
| Bias / retrieval jobs read from DB, not client-passed state | DB is source of truth; client state is stale at trigger time |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` (`createStream`, `createCompletion`) |
| Structural retrieval is rule-based, not embedding-based | Ontology is already structured; rule-based is more interpretable and catches cross-domain analogues that embeddings blur |
| Only mapped personas receive supplemental after Examiner | stakeholder/family gaps → Stakeholder Mirror; financial/execution → Risk Architect; market/pattern → Pattern Analyst |
| Original persona analysis is immutable | Supplements and pushback append below; never overwrite |
| Council Synthesis may recalibrate; original persona text must not | Record integrity |
| Synthesis needs AbortController-style cancellation | Prevents race conditions and stale-closure re-triggers |
| Pushback text stored in DB as first-class message event | High-value future Ledger data |
| Raw bias scores never user-facing pre-Mirror | Confidence must compound before surfacing |

**Identity / accumulation priority (do not reorder):**
1. `user_id` (post magic-link auth) — cross-device, permanent, highest trust
2. `user_email` (entered on home page) — cross-device, pre-auth
3. `device_id` (generated on first visit) — device-local, ephemeral
4. Anonymous — INSERT only, no accumulation

---

## 🏗️ ARCHITECTURE

**Session lifecycle:** one decision submission = one session. New session created only on new decision. Bias accumulation is cross-session, longitudinal.

**Key architectural principles:**
- Bias confidence starts at 0.30 per detection, compounds +0.30 per subsequent session, capped at 1.0
- Structural retrieval activates only after ≥5 ontology-complete sessions for same user
- Threshold for structural match: ≥45 / 100 points on the rubric
- Bias fingerprint shown only in Mirror (Sprint 7) — never from a single session
- Contradictions require 30–50 sessions to be reliable — deferred to Sprint 9

**100-point structural scoring rubric:**
- Decision type match: 30 pts
- Register proximity (instrumental/constitutive weight): 25 pts
- Stakes architecture (reversibility + bearer + timeline): 20 pts
- Counterparty structure: 15 pts
- Time pressure pattern: 10 pts

**Personas receiving structural context:** Pattern Analyst, Risk Architect, Elder (others receive none — forcing context onto Contrarian / Stakeholder Mirror dilutes their angles)

---

## 🖥️ TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway |
| AI Provider | DeepSeek (current); Anthropic Claude (planned switch) |
| Auth | Supabase Magic Link (PKCE flow) |
| Repo | GitHub → deployed via Railway |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

**Railway env vars:**
```
AI_PROVIDER = deepseek (or anthropic)
ANTHROPIC_API_KEY = ***
DEEPSEEK_API_KEY = ***
BRIEF_ACCESS_TOKEN = ***
NEXT_PUBLIC_SUPABASE_URL = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY = ***
NEXT_PUBLIC_APP_URL = https://invigorating-manifestation-production-ecd2.up.railway.app
```

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                    — Home page; handleSubmit now reads user_id from auth session
  api/
    session/route.ts          — Creates session; now accepts + stores user_id from body
    persona/route.ts          — Streams persona responses; injects register_mode + structural context
    examiner/route.ts         — GET: questions from ontology gaps | POST: saves answers, fires bias + structural
    bias-score/route.ts       — Adversarial scoring; upserts bias_library with full identity chain
    ontology/route.ts         — Returns full ontology tag for a session
    structural-match/route.ts — Scores past sessions; writes structural_matches + structural_scores (now with error logging)
    auth/route.ts             — Sends magic link via signInWithOtp
    auth/link-sessions/route.ts — Links session IDs to user_id; retro-links device_id + email bias rows
    history/route.ts          — Dual query: localStorage IDs + user_id
  auth/callback/page.tsx      — PKCE exchange; now passes device_id to link-sessions; always fires link-sessions

components/
  PersonaPanel.tsx            — Streams single persona; handles pushback; supplemental on examiner context
  SessionView.tsx             — Orchestrates all panels; register mode; examiner gating; structural context
                                ↳ decisionExpanded state: "See More/Less" for long decisions
                                ↳ Privacy notice: conditional on session.user_id (honest for both auth + anon)
  SynthesisCard.tsx           — Fires after allDone + examinerReady; recalibrates on pushback
  ExaminerPanel.tsx           — 3 diagnostic questions; gates synthesis
  RecordExport.tsx            — PDF export; Decision Brief first; Synthesis second; 6 personas
  MemoryEngineStatus.tsx      — Home page counter: sessions toward 5-threshold / 10-threshold
  AuthPanel.tsx               — Email input for magic link; identity pill when authenticated

lib/
  personas.ts                 — All 6 prompts + SYNTHESIS + DECISION_BRIEF
  types.ts                    — PersonaKey union
  ontology-tagger.ts          — Prompt-driven 9-dimension tagger
  bias-scorer.ts              — 15-bias adversarial scoring; createCompletion
  structural-retrieval.ts     — 100-point rubric; Haiku annotation; createCompletion
  ai-client.ts                — Provider abstraction (createStream, createCompletion, getProviderInfo)
  storage.ts                  — localStorage: session IDs, user email, device_id; getStoredDeviceId exported
  supabase.ts                 — createClient() (browser) + createServiceClient() (server, bypasses RLS)

supabase/
  schema.sql                  — Base schema (sessions, messages)
  sprint1_add_ledger_tables.sql   — sessions_ontology, examiner_responses, bias_library, contradiction_log
  sprint2_add_register_to_sessions.sql — register_mode column
  sprint3_examiner_phase1.sql     — examiner_status on sessions_ontology
  sprint4_bias_score.sql          — user_email + device_id on sessions; user_id + device_id on bias_library
  sprint5_structural.sql          — structural_matches + structural_scores tables (base)
  sprint5b_structural_scores_fix.sql ← NEW: adds unique constraint to structural_scores; safe to re-run
  sprint6_auth.sql                — user_preferences, brief_access_tokens, link_sessions_to_user RPC
```

**Migration run order (cumulative — run each once in sequence):**
`schema.sql` → `sprint1_add_ledger_tables.sql` → `sprint2_add_register_to_sessions.sql` → `sprint3_examiner_phase1.sql` → `sprint4_bias_score.sql` → `sprint5_structural.sql` → **`sprint5b_structural_scores_fix.sql`** → `sprint6_auth.sql`

---

## ✅ SPRINTS COMPLETED

### Sprint 1 — Ontology Tagger ✅
Async background job. 9-dimension structural tagging. Stored in `sessions_ontology`. Powers Examiner questions, Structural Retrieval, and Bias weighting.

### Sprint 2 — Register Mode ✅
User picks Challenge vs Clarification before submitting. Flows into all 6 persona prompts.

### Sprint 3 — Examiner Phase 1 ✅
After all 6 personas: 3 diagnostic questions from ontology gaps. Synthesis gated until answered or skipped. Supplemental re-runs fire for mapped personas only.

### Sprint 4 / 4b — Bias Library + Anonymous Identity ✅ (Fixed April 29)
15-bias adversarial scoring. Accumulation fixed (null-email global match bug). device_id third-tier identity added. MemoryEngineStatus shows email CTA for anonymous users.

### Sprint 5 — Structural Retrieval ✅ core / 🔧 structural_scores
Structural matching works. structural_matches written correctly. structural_scores still empty — table missing unique constraint. **Fix A1+A2 pending deploy.**

### Sprint 6 — Auth ✅ core / 🔧 identity continuity
Magic link PKCE flow fixed. Session linking works at sessions table level. user_id not stamping on new sessions. device_id bias rows not retro-linked. **Fix B+C pending deploy.**

---

## 🚨 OPEN BUGS (as of April 30 — patches written, not yet deployed)

### Bug A — structural_scores upsert failing ✅ CONFIRMED FIXED
**Status:** `structural-match/route.ts` already has the correct patch deployed (confirmed April 30 via file review). No further edits needed.  
**Root cause (confirmed):** The previous route inserted `threshold_met` into `structural_scores` but that column doesn't exist in the live Supabase schema. Error was PGRST204. The deployed file already removes `threshold_met` from scoreRows and adds `user_email` to match actual schema.  
**Actual table schema confirmed:** `session_id_a`, `session_id_b`, `user_email`, `total_score`, `decision_type_score`, `register_score`, `stakes_score`, `counterparty_score`, `time_pressure_score`, `annotation`, `computed_at`. Unique constraint: `(session_id_a, session_id_b)` ✅  
**No SQL migration needed.** `sprint5b_structural_scores_fix.sql` is obsolete — do not run it.

### Bug B — new post-auth sessions not stamping user_id
**Status:** Patch written (B1: page.tsx, B2: session/route.ts)  
**Root cause:** handleSubmit never reads auth session; session route never accepted user_id  
**Files:** `app/page.tsx`, `app/api/session/route.ts`

### Bug D — Decision text truncated with no expand (UI) ✅ FIXED
**Status:** Patched in `components/SessionView.tsx`  
**Fix:** Added `decisionExpanded` state. Decision text conditionally removes webkit line-clamp when expanded. "↓ See more / ↑ See less" button renders only when `decision_text.length > 220` (safe threshold to avoid showing button for short decisions).

### Bug E — Privacy notice factually incorrect for authenticated sessions (UI)
**Status:** Patched in `components/SessionView.tsx`  
**Root cause:** "No account or identity is linked to this decision" was hardcoded but is false when `session.user_id` is set (i.e. after auth).  
**Fix:** Now conditional — authenticated sessions show "This session is linked to your account and included in your decision memory." Anonymous sessions show the original URL-privacy notice. Uses `session.user_id` field which already exists on the `Session` type.
**Status:** Patch written (C1: callback, C2: link-sessions route)  
**Root cause:** Callback didn't pass device_id; link-sessions only upgraded email-keyed rows  
**Files:** `app/auth/callback/page.tsx`, `app/api/auth/link-sessions/route.ts`

---

## 📋 SPRINTS REMAINING

| Sprint | Name | Status | Prerequisite |
|---|---|---|---|
| 5b | Structural scores traceability | 🔧 Fix ready | Deploy A1 + A2 |
| 6b | Identity continuity hardening | 🔧 Fix ready | Deploy B + C |
| 7 | Mirror Module | 🔲 Not started | Auth ✅ + 10 sessions + bias accumulating cleanly |
| 8 | Decision Brief PDF (paywall) | 🔲 Not started | Auth ✅ (brief_access_tokens table ready) |
| 9 | Contradiction Detector | 🔲 Not started | Mirror + structural_matches at scale |

### Sprint 7 — Mirror Module (next after fixes validated)
Three views:
1. **Bias Fingerprint** — conditional patterns (e.g. "FOMO activates when a trusted contact endorses a deal"), not scalar scores. Show only after confidence compounds (≥2–3 detections).
2. **Decision Timeline** — visual structural connections across sessions.
3. **Decision Independence Score** — tracks whether user incorporates Quorum's frameworks unprompted.

Prerequisites: Auth working ✅, ≥10 sessions per user, bias_library accumulating correctly with user_id stamped.

### Sprint 8 — Decision Brief PDF (Paywall)
`brief_access_tokens` table already in Supabase. One-time purchase or session-based gate. Target: ₹25K for live session + formatted PDF artifact.

### Sprint 9 — Contradiction Detector
Weekly background job. Extracts stated principles from past decisions. Flags structural violations. "Before you begin — something worth knowing." Requires 30–50 sessions for reliable signal. Do not surface early.

---

## 📐 ARCHITECTURE DECISIONS (Do Not Re-debate)

| Decision | Rationale |
|---|---|
| Bias scoring triggered server-side from `/api/examiner` POST | Stale connections / Railway cold starts kill client-side triggers |
| No embeddings for structural retrieval | Ontology already provides structured representation; rule-based is more interpretable and catches cross-domain patterns |
| Haiku for annotation, not full model | Annotation is language generation only; scoring is deterministic |
| Bias diagnosis shown only at Mirror | Never from single session — confidence must compound |
| Examiner questions from ontology gaps, not generic | Generic questions get ignored; ontology-derived questions target specific unknown-unknowns |

---

## 🧪 TESTING REFERENCE

### Post-fix Test Checklist (run after deploying Bug A+B+C fixes)
Full checklist in `DIAGNOSIS_AND_PATCHES.md` Section 5. Summary:

**Phase 1** — Anonymous session: verify ontology, bias scoring by device_id  
**Phase 2** — Auth: verify session linked, bias rows retro-linked (including device_id rows)  
**Phase 3** — Sessions 2–4 authenticated: verify user_id stamped, bias accumulating  
**Phase 4** — Session 6+ structural retrieval: verify structural_scores has 5 rows  
**Phase 5** — Cross-device: verify email history loads from new browser  
**Phase 6** — Final SQL verification query (see DIAGNOSIS_AND_PATCHES.md)

### Sprint 4 Tests (Bias Library — historical)
- Submit decision → check Railway `[BiasScore] Scoring session...` within 30s of Examiner
- Check `bias_library` for rows with matching session_id and correct bias_key
- 2 sessions same user → same bias shows detection_count=2, confidence_weight=0.6

### Sprint 5 Tests (Structural Retrieval)
- Requires ≥5 sessions with same identity, tagger_status='complete'
- Railway logs: `[StructuralMatch] Scoring session ... against 5 past sessions`
- `structural_matches` has row; `structural_scores` has 5 rows (post-fix)
- Session 6+: Pattern Analyst / Risk Architect / Elder responses reference "you faced this structure before"

### Sprint 6 Tests (Auth)
- Enter email → receive magic link (subject: "Sign in to Quorum")
- Click → redirected to Railway `/auth/callback` (not localhost)
- After redirect: sessions table has user_id populated
- New sessions after auth: user_id populated immediately (post-Fix B)
- New device: enter email → click link → full history loads

---

## 📝 PROMPT IMPROVEMENTS LOG

| Area | Change | Reasoning |
|---|---|---|
| All 6 personas | Word limit instruction at TOP | Models ignore end-of-prompt instructions |
| All 6 personas | Target 200–280 words (instruct "250 max") | Models run 30–40% over stated limit |
| All 6 personas | Explicit NOT instructions per persona | Prevents Risk Architect ↔ Pattern Analyst lane overlap |
| SYNTHESIS | ≤200 words hard cap | Senior partner debrief, not meeting minutes |
| SYNTHESIS | Optional 1-2 sentence pattern observation at close | Seeds Mirror without spoiling it; only fires when pattern is earned |
| Risk Architect | Personal finance delegation calibration | Quantify transition tax first; fee creep second; lock-in third |
| Stakeholder Mirror | Partner/spouse elevated as primary unstated stakeholder | Best insight of test session — buried without this instruction |

---

## 💰 BUSINESS MODEL & GTM

**Pricing:**
- Free: Full Council + Synthesis
- Paid: ₹25K for live 45-min founder-run session + formatted Decision Brief PDF
- Eventually: ₹1L–₹10L/year per HNI user; ₹25L for family office setups

**Stage gate before Ledger depth:**
- First paying engagement at any real price point
- At least one user who returns for a second real decision
- Evidence of engagement as a thinking partner, not a one-time report

**Target paying user profile:** Decision involves ₹1 Cr capital or ₹1 Cr annual role. At that scale, ₹25K = 0.025% of capital at stake.

**LinkedIn GTM sequence:**
1. Mine PE deal post engagements for warm leads
2. Comment on posts by family business operators, founders in fundraising, CXOs in transitions
3. DM 15 people whose recent activity signals a live high-stakes decision
4. Pitch: "I run a 45-min private advisory session. You get a formatted Brief. Tell me what you're wrestling with."
5. Price after interest: "₹25K for the Brief — live run + formatted output."

**Validation audience ≠ paying audience.** WhatsApp/XLRI group improves prompts but doesn't prove ₹25K willingness to pay. Commercial proof requires users whose stakes are high enough that the price is obviously cheap.

---

## 🔬 RESEARCH FOUNDATION (moat claims)

**Decision Ontology:** 8-dimensional structural tagging. Ontology retrieval is more accurate than vector similarity for cross-domain pattern detection (PE deal and career pivot share identical bias structure — embeddings blur this, rule-based rubric catches it).

**Bias Library:** Adversarial prosecutor/defense scoring. High asymmetry = strong signal. Confidence compounds over sessions. Never show bias diagnosis from a single session.

**The Examiner:** Motivated interviewing applied to AI advisory. Questions from ontology's unknown-unknowns, not generic. Answers stored tagged to bias parameters.

**Contradiction Detector (Sprint 9):** Most emotionally resonant feature. "The moment you said X but did Y." Requires 30–50 sessions to be reliable. Do not surface early.

---

## 🚀 PRODUCT AMBITION

**How Quorum dies:**
- No "holy-shit" breakthrough moment
- Perceived as another AI chatbot
- Over-focus on infra at cost of value delivery
- Not using the product personally and publicly

**How it reaches Ambani-level:**
- Mirror module is the "holy shit" unlock — ship ASAP after fixes
- Architecture is deeply differentiated: ontology + examiner + structural retrieval + bias accumulation + contradiction detection
- Privacy-first, structured, advisor-like design appeals to CXOs and family businesses
- Every new session compounds the moat

**One-liner:** "Bring one real decision — get six expert perspectives and a crisp synthesis in minutes."

*End of Quorum Handover Document — update after each session*
