# QUORUM — Living Handover Document
> **Last Updated:** May 1, 2026  
> **Active Sprint:** Sprint 7a — Mirror Foundation (DEPLOYED)  
> **Next:** Run Sprint 7a test checklist → Sprint 7b (Bias Fingerprint)

---

## 📌 HOW TO USE THIS DOC
Update the **Current State**, **Active Bugs**, and **Latest Prompt** sections after every session. All other sections are reference — update only when architecture or vision changes.

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 7a complete):**
Mirror module foundation is deployed. Six files shipped in Sprint 7a:

**New files:**
- `supabase/sprint7a_mirror_schema.sql` — mirror_access + independence_score_log tables
- `app/api/mirror/status/route.ts` — gateway check (auth → threshold → paywall → unlocked)
- `app/api/mirror/timeline/route.ts` — session history with ontology join
- `app/mirror/page.tsx` — full Mirror page with all 4 gate states
- `components/MirrorTimeline.tsx` — free-tier session timeline with pattern stripes

**Modified files:**
- `components/MemoryEngineStatus.tsx` — fixed duplicate `</span>` bug; Mirror threshold set to 5; "View Mirror →" link shows when sessionCount ≥ 5
- `lib/types.ts` — already had Mirror types pre-added (MirrorStatus, TimelineSession, MirrorGateState, IndependenceScoreEntry)

**Deploy order for Sprint 7a:**
1. Run `supabase/sprint7a_mirror_schema.sql` in Supabase SQL Editor
2. Add `MIRROR_UNLOCK_TOKEN` env var to Railway (generate with `openssl rand -hex 32`)
3. Push all 7 files via GitHub → Railway auto-deploy
4. Run MIRROR_7A_TEST.md checklist

**Sprint 7b starts after test checklist passes.**
Sprint 7b adds the Bias Fingerprint: narrative profile, pattern tiles, confidence gating, and teaser/unlock states.

---

## 🧠 WHAT IS QUORUM

**Quorum** is a private AI-powered decision-making tool. It presents 6 AI "advisor" personas that analyse a user's high-stakes decision in parallel — each from a distinct psychological and strategic lens — then synthesises their views into a directional recommendation.

**Not an AI chatbot. Not a SaaS tool.**
It is a **Judgment Compounding System**: the quality of a user's decisions improves the more they use it, because the tool learns their decision patterns, biases, and mental models over time.

---

## 🔭 PRODUCT VISION

**5-module long-term arc:**
- **Council** → immediate multi-perspective decision analysis ✅
- **Ledger** → structured decision memory, ontology, retrieval, and bias signal collection ✅
- **Mirror** → surfaced personal insight, fingerprinting, contradiction, and decision independence 🔄 (Sprint 7)
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
| Structural retrieval is rule-based, not embedding-based | Ontology already provides structured representation |
| Only mapped personas receive supplemental after Examiner | stakeholder/family → Stakeholder Mirror; financial/execution → Risk Architect; market/pattern → Pattern Analyst |
| Original persona analysis is immutable | Supplements and pushback append below; never overwrite |
| Pushback text stored in DB as first-class message event | High-value future Ledger data |
| Raw bias scores never user-facing pre-Mirror | Confidence must compound before surfacing |
| Mirror requires user_id (full auth), not just user_email | Mirror is the auth conversion hook; email-only is pre-auth tier |
| Mirror threshold = 5 sessions | Same as Pattern Memory threshold; below 5 = meaningless data |
| Decision Timeline is free (no mirror_access needed) | Creates pull for paywall; seeing your history + locked tiles is the conversion mechanic |
| Independence scoring fires from `/api/examiner POST` | Same trigger as bias scoring — no new trigger needed |

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
- Bias fingerprint shown only in Mirror — never from a single session
- Contradictions require 30–50 sessions to be reliable — deferred to Sprint 9

**Mirror gate state machine:**
```
/mirror
  │
  ├─ No user_id → gateState: 'auth'      (sign-in prompt)
  ├─ < 5 sessions → gateState: 'threshold' (progress gate)
  ├─ ≥ 5 sessions, no mirror_access → gateState: 'paywall'
  │     Free: Decision Timeline visible
  │     Paid: Bias tiles locked (labels shown, content blurred)
  └─ ≥ 5 sessions + mirror_access → gateState: 'unlocked'
        Sprint 7b: Bias Fingerprint (live)
        Sprint 7c: Independence Score (live)
```

**Mirror pricing:**
- ₹4,999 standalone Mirror unlock
- Bundled into ₹25K live advisory session + Brief (no separate charge)
- Payment flow: manual (contact-to-unlock) → Sprint 7c adds `/api/mirror/unlock` route with `MIRROR_UNLOCK_TOKEN` verification

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
MIRROR_UNLOCK_TOKEN = ***        ← NEW: add in Sprint 7a deploy
NEXT_PUBLIC_SUPABASE_URL = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY = ***
NEXT_PUBLIC_APP_URL = https://invigorating-manifestation-production-ecd2.up.railway.app
```

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                          — Home: decision input, history, MemoryEngineStatus
  layout.tsx                        — Root layout
  globals.css                       — Design tokens (CSS vars)
  mirror/
    page.tsx                        — Mirror module main page (Sprint 7a) ✅
  session/[id]/page.tsx             — Live session view
  record/[id]/page.tsx              — Read-only session record
  auth/callback/page.tsx            — PKCE magic link handler
  api/
    session/route.ts                — Create session
    persona/route.ts                — Stream persona response
    examiner/route.ts               — Examiner questions + triggers bias scoring
    synthesis/route.ts (implicit)   — Synthesis streaming
    record/route.ts                 — Fetch complete session record
    history/route.ts                — Fetch past sessions for home page
    bias-score/route.ts             — Background bias scoring (Sprint 4/4b)
    structural-match/route.ts       — Structural retrieval (Sprint 5)
    outcome/route.ts                — Log decision outcome
    auth/route.ts                   — Send magic link
    auth/link-sessions/route.ts     — Link pre-auth sessions to user_id
    mirror/
      status/route.ts               — Mirror gateway check (Sprint 7a) ✅
      timeline/route.ts             — Session history with ontology (Sprint 7a) ✅
      fingerprint/route.ts          — Bias Fingerprint (Sprint 7b) 🔲
      independence/route.ts         — Independence Score (Sprint 7c) 🔲
      unlock/route.ts               — Mirror access grant (Sprint 7c) 🔲

components/
  SessionView.tsx                   — Orchestrates Council + Examiner + Synthesis
  PersonaPanel.tsx                  — Individual advisor card + streaming
  ExaminerPanel.tsx                 — 3 diagnostic questions; gates synthesis
  SynthesisCard.tsx                 — Council synthesis + pushback
  MemoryEngineStatus.tsx            — Home page progress bar (Sprint 7a: bug fixed) ✅
  AuthPanel.tsx                     — Home page magic link input
  OutcomeTracker.tsx                — Log decision outcome
  RecordExport.tsx                  — Session export
  MirrorTimeline.tsx                — Decision history with pattern stripes (Sprint 7a) ✅
  BiasFingerprint.tsx               — Narrative + pattern tiles (Sprint 7b) 🔲
  PatternTile.tsx                   — Individual bias tile (Sprint 7b) 🔲
  IndependenceScore.tsx             — DI Score display (Sprint 7c) 🔲
  MirrorPaywall.tsx                 — Paywall component (Sprint 7c) 🔲
  BehaviorAlerts.tsx                — Active pattern alerts (Sprint 7d) 🔲
  DecisionRules.tsx                 — Extracted operating principles (Sprint 7d) 🔲

lib/
  ai-client.ts                      — Provider abstraction (createStream, createCompletion)
  personas.ts                       — All 6 advisor prompts + Synthesis + Brief prompts
  ontology-tagger.ts                — 9-dimension decision tagger
  bias-scorer.ts                    — 15-bias adversarial scoring (Sprint 4)
  structural-retrieval.ts           — 100-point rule-based structural matching (Sprint 5)
  storage.ts                        — localStorage helpers (session IDs, email, device_id)
  supabase.ts                       — createClient() / createServiceClient()
  types.ts                          — All TypeScript interfaces (Mirror types added) ✅
  mirror-fingerprint.ts             — Fingerprint data + narrative gen (Sprint 7b) 🔲
  independence-score.ts             — DI Score algorithm (Sprint 7c) 🔲

supabase/
  schema.sql                        — Base schema (sessions, messages)
  sprint1_add_ledger_tables.sql     — Ontology, examiner_responses, bias_library, contradiction_log
  sprint2_add_register_to_sessions.sql
  sprint3_examiner_phase1.sql       — (deployed, not in repo zip)
  sprint4_bias_score.sql            — (deployed, not in repo zip)
  sprint4b_device_id.sql            — (deployed, not in repo zip)
  sprint5_structural.sql            — (deployed, not in repo zip)
  sprint5b_structural_scores_fix.sql — Bug A fix (deployed)
  sprint6_auth.sql                  — (deployed, not in repo zip)
  sprint7a_mirror_schema.sql        — mirror_access + independence_score_log (Sprint 7a) ✅
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status | Notes |
|---|---|---|---|
| 1 | Ontology Tagger | ✅ Done | 9-dimension tagger, sessions_ontology table |
| 2 | Register Mode | ✅ Done | Challenge vs Clarify mode |
| 3 | Examiner Phase 1 | ✅ Done | 3 diagnostic questions, synthesis gating |
| 4/4b | Bias Library | ✅ Done | 15-bias adversarial scoring, device_id accumulation |
| 5/5b | Structural Retrieval | ✅ Done | 100-point rubric, structural_scores fix deployed |
| 6 | Auth | ✅ Done | Supabase magic link PKCE, 30-day sessions |
| **7a** | **Mirror Foundation** | **✅ Done** | **Schema, API, page, timeline** |
| 7b | Mirror: Bias Fingerprint | 🔲 Next | Narrative, pattern tiles, teaser state |
| 7c | Mirror: Independence + Payment | 🔲 Queued | DI score, unlock route |
| 7d | Mirror: Alerts + Polish | 🔲 Queued | Behavioral alerts, decision rules |
| 8 | Decision Brief PDF | 🔲 Queued | brief_access_tokens table ready |
| 9 | Contradiction Detector | 🔲 Future | Requires 30–50 sessions |

---

## 🧪 TESTING REFERENCE

### Sprint 7a Test (MIRROR_7A_TEST.md)

**Phase 1 — Gate states:**
- Anonymous → auth gate (sign-in prompt)
- Authenticated, < 5 sessions → threshold gate (progress bar)
- Authenticated, ≥ 5 sessions, no mirror_access → paywall (timeline + locked tiles)
- Authenticated, mirror_access row present → unlocked view (timeline + placeholders)

**Phase 2 — Timeline:**
- Rows in reverse chronological order
- Decision type chips, reversibility dots, outcome indicators render
- Pattern stripe (colored left border) appears for recurring decision types
- Click → navigates to `/record/[id]`

**Phase 3 — API routes:**
- `/api/mirror/status`: returns correct gateState for each scenario
- `/api/mirror/timeline`: 401 without auth; returns only user's sessions with auth

**Phase 4 — MemoryEngineStatus:**
- "View Mirror →" link shows at 5+ sessions
- No duplicate `</span>` error
- Anonymous users see email CTA, not progress bar

---

### Sprint 7b Test (upcoming)
- Fingerprint narrative: 120–150 words, second person, no jargon
- Pattern tiles: confidence dots match detection_count
- Teaser tiles: label visible, content blurred, lock icon present
- Paid tiles (unlocked users): full content, conditional pattern shown at 3+ detections
- No tile surfaces for detection_count = 0

---

## 📐 ARCHITECTURE DECISIONS (Do Not Re-debate)

| Decision | Rationale |
|---|---|
| Mirror requires user_id, not just user_email | Mirror is the auth conversion hook; email-only cannot guarantee data persistence |
| Timeline free, Fingerprint paid | Seeing your history creates pull; seeing locked bias labels is the conversion mechanic |
| Teaser tiles show bias label but blur content | Personalization in locked state is more powerful than hiding everything |
| MIRROR_UNLOCK_TOKEN pattern (not Razorpay yet) | Same pattern as BRIEF_ACCESS_TOKEN; enables manual sales flow immediately |
| Independence scoring from examiner responses | Examiner answers reveal reasoning quality over time; low-cost signal, no extra API call |
| Contradictions deferred to Sprint 9 | Require 30–50 sessions for reliable signal; do not surface early |

---

## 📝 PROMPT IMPROVEMENTS LOG

| Area | Change | Reasoning |
|---|---|---|
| All 6 personas | Word limit instruction at TOP | Models ignore end-of-prompt instructions |
| All 6 personas | Target 200–280 words (instruct "250 max") | Models run 30–40% over stated limit |
| SYNTHESIS | ≤200 words hard cap | Senior partner debrief, not meeting minutes |
| Risk Architect | Personal finance delegation calibration | Quantify transition tax first; fee creep second |
| Stakeholder Mirror | Partner/spouse elevated as primary unstated stakeholder | Best insight of test session |
| Mirror Fingerprint | Conditional framing required: "particularly when [X]" | Prevents generic personality copy (Sprint 7b) |

---

## 💰 BUSINESS MODEL & GTM

**Pricing ladder:**
- Free: Full Council + Synthesis + Decision Timeline (Mirror free tier)
- ₹4,999: Mirror unlock (Bias Fingerprint + Independence Score) — new tier ✅
- ₹25K: Live 45-min founder-run session + Decision Brief PDF + Mirror unlock bundled

**Mirror unlock mechanics:**
- Payment flow: manual (user contacts Quorum team → payment → MIRROR_UNLOCK_TOKEN used to grant access via `/api/mirror/unlock`)
- Conversion hook: teaser tiles show actual bias names detected from user's decisions
- Upsell: Mirror unlock page suggests live session as next step

**Stage gate before Ledger depth:**
- First paying engagement at any real price point
- At least one user who returns for a second real decision
- Evidence of engagement as a thinking partner, not a one-time report

---

## 🚀 PRODUCT AMBITION

**How Quorum dies:**
- No "holy-shit" breakthrough moment
- Perceived as another AI chatbot
- Mirror ships too slow

**How it reaches scale:**
- Mirror is the "holy shit" unlock — reading your own bias fingerprint for the first time
- Architecture is deeply differentiated: ontology + examiner + structural retrieval + bias accumulation
- Every session compounds the moat — Mirror gets sharper the more you use Council

**One-liner:** "Bring one real decision — get six expert perspectives and a crisp synthesis in minutes."

*End of Quorum Handover Document — update after each session*
