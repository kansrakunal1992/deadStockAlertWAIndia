# QUORUM — Living Handover Document
> **Last Updated:** May 2, 2026
> **Active Sprint:** Sprint 7b — Mirror Bias Fingerprint (DEPLOYED)
> **Next:** Run Sprint 7b test checklist → Sprint 7c (Independence Score + Payment Polish)

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 7b complete):**

Eight files shipped in Sprint 7b. Summary of what changed:

**New files:**
- `app/api/mirror/fingerprint/route.ts` — auth + access gated; calls `buildFingerprint()`, returns `FingerprintData`
- `app/api/mirror/unlock/route.ts` — validates `MIRROR_UNLOCK_TOKEN`, inserts `mirror_access` row; idempotent
- `components/PatternTile.tsx` — two visual states: ConfirmedTile (detection ≥ 2) and FormingTile (detection = 1, blurred)
- `components/BiasFingerprint.tsx` — fetches `/api/mirror/fingerprint`, renders narrative + confirmed + forming tile grids; skeleton loader; error boundary
- `lib/mirror-fingerprint.ts` — pulls from `bias_library`, derives activation summaries from `activation_contexts` JSONB, calls AI for narrative + tile interpretations in one call, returns `FingerprintData`

**Modified files:**
- `lib/personas.ts` — `MIRROR_FINGERPRINT_NARRATIVE` prompt added at bottom (JSON-output prompt, injects 4 template vars at call time)
- `lib/types.ts` — `FingerprintTile` and `FingerprintData` interfaces added
- `app/mirror/page.tsx` — `UnlockCodeInput` component added; `PaywallGate` now takes `authToken` + `onUnlocked` props; `UnlockedView` now takes `authToken` and renders `<BiasFingerprint authToken={authToken} />`; `handleUnlocked` re-fetches status in-place (paywall → unlocked transition without hard refresh)

**AI provider:** Switched to Anthropic/Claude (`AI_PROVIDER=anthropic`). No code changes were required — `lib/ai-client.ts` abstraction handled it.

**Required env var (must be set in Railway before deploying):**
```
MIRROR_UNLOCK_TOKEN = [openssl rand -hex 32]
```

**Sprint 7c starts after test checklist passes.**
Sprint 7c adds: Decision Independence Score calculation + storage, score display component, and payment flow polish (Razorpay hook stub).

---

## 🧠 WHAT IS QUORUM

**Quorum** is a private AI-powered decision intelligence platform. It presents 6 AI advisor personas analyzing a high-stakes decision in parallel, runs a diagnostic Examiner phase, then synthesises into a directional recommendation.

**Long-term vision: Judgment Compounding System.** The more a user engages, the more Quorum learns their decision patterns, biases, and reasoning style.

**Not a chatbot. Not a SaaS tool.** Positioned as a private thinking partner with boardroom-grade UX — Apple × McKinsey energy.

---

## ⚙️ CRITICAL IMPLEMENTATION / DO-NOT-REDEBATE DECISIONS

| Decision | Rationale |
|---|---|
| Bias scoring triggered server-side from `/api/examiner POST` | Client-side fails on stale connections / Railway cold starts |
| Bias/retrieval jobs read from DB, not client-passed state | DB is source of truth |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` (`createStream`, `createCompletion`) |
| Structural retrieval is rule-based, not embedding-based | Ontology provides structured representation |
| Only mapped personas receive supplemental after Examiner | stakeholder/family → Stakeholder Mirror; financial/execution → Risk Architect; market/pattern → Pattern Analyst |
| Original persona analysis is immutable | Supplements and pushback append below; never overwrite |
| Pushback text stored in DB as first-class message event | High-value future Ledger data |
| Raw bias scores never user-facing pre-Mirror | Confidence must compound before surfacing |
| Mirror requires `user_id` (full auth), not just `user_email` | Mirror is the auth conversion hook; email-only cannot guarantee persistence |
| Mirror threshold = 5 sessions | Below 5 = meaningless data; same threshold as Pattern Memory |
| Decision Timeline is free (no mirror_access needed) | Creates pull; seeing history + locked tiles is the conversion mechanic |
| Independence scoring fires from `/api/examiner POST` | Same trigger as bias scoring — no new trigger needed (Sprint 7c) |
| Fingerprint generation: one AI call for narrative + all tiles | Avoids N calls per tile; ~4–6s acceptable on Mirror page load |
| `MIRROR_UNLOCK_TOKEN` shared secret pattern | Same as `BRIEF_ACCESS_TOKEN`; enables manual sales immediately; Razorpay replaces this in future |
| Unlock is idempotent | Re-entering correct code on already-unlocked account returns success, not error |

**Identity/accumulation priority (do not reorder):**
1. `user_id` — cross-device, permanent, highest trust
2. `user_email` — cross-device, pre-auth
3. `device_id` — device-local, ephemeral
4. Anonymous — INSERT only, no accumulation

---

## 🏗️ ARCHITECTURE

**Mirror gate state machine:**
```
/mirror
  ├─ No user_id → 'auth'        Sign-in prompt + magic link
  ├─ < 5 sessions → 'threshold' Progress bar, preview of what Mirror reveals
  ├─ ≥ 5 sessions, no mirror_access → 'paywall'
  │     FREE: Decision Timeline
  │     FREE: Teaser tiles (real bias labels, content blurred)
  │     FREE: Unlock code input (→ /api/mirror/unlock)
  └─ ≥ 5 sessions + mirror_access → 'unlocked'
        ✅ Decision Timeline
        ✅ Bias Fingerprint (narrative + pattern tiles)  ← Sprint 7b LIVE
        🔲 Decision Independence Score                   ← Sprint 7c
```

**Fingerprint confidence tiers:**
- `detection_count = 1` → forming tile (blurred, label only, "Pattern forming")
- `detection_count ≥ 2` → confirmed tile (full interpretation, activation summary if available)
- `detection_count ≥ 3` → conditional pattern shown ("Activates when: X + Y")

**Narrative generation rules (enforced in prompt):**
- Second person only ("You…")
- 110–140 words
- No words: "bias", "cognitive bias", "AI", "Quorum", "algorithm"
- Must include one conditional: "particularly when…"
- Final sentence creates forward tension, not a compliment
- Returns `null` if fewer than 2 confirmed patterns → placeholder copy shown

---

## 🖥️ TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway |
| AI Provider | **Anthropic Claude** (`claude-sonnet-4-20250514`) ← switched Sprint 7b |
| Auth | Supabase Magic Link (PKCE flow) |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

**Railway env vars (complete list):**
```
AI_PROVIDER               = anthropic
ANTHROPIC_API_KEY         = ***
DEEPSEEK_API_KEY          = *** (kept as fallback)
BRIEF_ACCESS_TOKEN        = ***
MIRROR_UNLOCK_TOKEN       = *** ← NEW: required since Sprint 7b
NEXT_PUBLIC_SUPABASE_URL  = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY = ***
NEXT_PUBLIC_APP_URL       = https://invigorating-manifestation-production-ecd2.up.railway.app
```

---

## 📁 KEY FILE MAP

```
app/
  mirror/
    page.tsx                        — Full Mirror page, all gate states (Sprint 7a/7b) ✅
  api/
    mirror/
      status/route.ts               — Gateway check (Sprint 7a) ✅
      timeline/route.ts             — Session history (Sprint 7a) ✅
      fingerprint/route.ts          — Bias Fingerprint (Sprint 7b) ✅
      unlock/route.ts               — Code-based access grant (Sprint 7b) ✅
      independence/route.ts         — DI Score (Sprint 7c) 🔲
    examiner/route.ts               — Fires bias scoring + (Sprint 7c) independence scoring

components/
  MirrorTimeline.tsx                — Decision history, pattern stripes (Sprint 7a) ✅
  BiasFingerprint.tsx               — Narrative + tile grid, skeleton, error boundary (Sprint 7b) ✅
  PatternTile.tsx                   — Confirmed / forming tile states (Sprint 7b) ✅
  IndependenceScore.tsx             — DI Score display (Sprint 7c) 🔲
  MirrorPaywall.tsx                 — Standalone paywall component (Sprint 7c, if needed) 🔲
  BehaviorAlerts.tsx                — Active pattern alerts on home page (Sprint 7d) 🔲
  DecisionRules.tsx                 — Extracted operating principles (Sprint 7d) 🔲

lib/
  mirror-fingerprint.ts             — Data layer + AI call for Fingerprint (Sprint 7b) ✅
  independence-score.ts             — DI Score algorithm (Sprint 7c) 🔲
  personas.ts                       — All prompts incl. MIRROR_FINGERPRINT_NARRATIVE ✅
  types.ts                          — FingerprintTile, FingerprintData added (Sprint 7b) ✅
  ai-client.ts                      — Provider abstraction (Anthropic now active)
  bias-scorer.ts                    — 15-bias adversarial scoring
  structural-retrieval.ts           — 100-point rule-based rubric

supabase/
  sprint7a_mirror_schema.sql        — mirror_access + independence_score_log ✅
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status | Key deliverables |
|---|---|---|---|
| 1 | Ontology Tagger | ✅ | 9-dimension tagger, sessions_ontology |
| 2 | Register Mode | ✅ | Challenge vs Clarify |
| 3 | Examiner Phase 1 | ✅ | 3 diagnostic questions, synthesis gating |
| 4/4b | Bias Library | ✅ | 15-bias scoring, device_id accumulation, null-email bug fixed |
| 5/5b | Structural Retrieval | ✅ | 100-point rubric, structural_scores fix |
| 6 | Auth | ✅ | Supabase PKCE magic link, 30-day sessions |
| 7a | Mirror Foundation | ✅ | Schema, status/timeline APIs, Mirror page, free Timeline |
| **7b** | **Mirror: Bias Fingerprint** | **✅** | **Fingerprint API, unlock code UI, PatternTile, BiasFingerprint, Claude API switch** |
| 7c | Mirror: Independence Score | 🔲 Next | DI Score algorithm, storage, display component |
| 7d | Mirror: Alerts + Polish | 🔲 | Behavioral alerts (home page), decision rules, drift view |
| 8 | Decision Brief PDF | 🔲 | `brief_access_tokens` table already exists |
| 9 | Contradiction Detector | 🔲 Future | Requires 30–50 sessions to be reliable |

---

## 🧪 SPRINT 7b — TEST SUMMARY

**Phase 1 — Unlock code UI:**
- "Have an unlock code?" button expands inline (no page reload)
- Wrong code → specific error message, stays on paywall
- Correct code → in-place transition to unlocked (no hard refresh)
- Idempotent — second unlock attempt on already-unlocked account returns success

**Phase 2 — `/api/mirror/unlock`:**
- 401 without auth; 403 wrong code; 200 + DB row on correct code
- `payment_ref` stores partial code for audit trail

**Phase 3 — Bias Fingerprint:**
- Skeleton loader while fetch in flight
- Narrative: second person, 110–140 words, no jargon, conditional present, forward tension in final sentence
- Confirmed tiles: full interpretation, activation summary at 3+ detections
- Forming tiles: blurred bars, lock icon, "Pattern forming"
- Error boundary: fingerprint failure does not break Timeline

**Phase 6 — Paywall teasers:**
- Real detected bias labels shown even before payment
- Content blurred, lock icon visible

---

## 📐 SPRINT 7c SCOPE (Next)

**Decision Independence Score:**
- Algorithm: signal extraction from `examiner_responses` text (keyword + structural markers)
- Signals: risk framing, hidden stakeholder surfacing, deadline questioning, constitutive framing, pre-mortem language, response depth, counter-questioning
- Storage: `independence_score_log` table (schema already in `sprint7a_mirror_schema.sql`)
- Trigger: fires from `/api/examiner POST` alongside bias scoring
- Display: `IndependenceScore.tsx` — number (0–100), delta vs first 5 sessions, one-sentence band interpretation

**Score bands:**
- 0–25: "Using Quorum as a report generator"
- 26–50: "Frameworks starting to show in your thinking"
- 51–75: "Quorum is visibly shaping your reasoning process"
- 76–100: "You're internalising the approach — Quorum is becoming redundant (in the best way)"

**Payment polish:**
- Razorpay stub in the unlock flow (order creation → webhook → `/api/mirror/unlock` internal call)
- Or: keep manual unlock code flow and add Razorpay in Sprint 8

---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule | Reasoning |
|---|---|---|
| All personas | Word limit instruction at TOP | Models ignore end-of-prompt instructions |
| All personas | Target 200–280 words (instruct "250 max") | Models run 30–40% over stated limit |
| Synthesis | ≤200 words hard cap | Senior partner debrief, not meeting minutes |
| Mirror Fingerprint | JSON-only output, no markdown fences | Parsed directly; prose contamination breaks JSON.parse |
| Mirror Fingerprint | "particularly when [condition]" required | Prevents generic personality-test copy |
| Mirror Fingerprint | Final sentence must create forward tension | Compliments don't drive return visits |
| Mirror Fingerprint | Forbidden words list | "bias", "AI", "Quorum", "algorithm" break the tone |

---

## 💰 BUSINESS MODEL

**Pricing ladder:**
- Free: Council + Synthesis + Decision Timeline (Mirror threshold view)
- ₹4,999: Mirror unlock (Fingerprint + Independence Score)
- ₹25K: Live 45-min session + Decision Brief PDF + Mirror unlock bundled

**Current unlock mechanism:** `MIRROR_UNLOCK_TOKEN` shared privately (WhatsApp/DM) → user enters in Mirror UI → instant access. No payment gateway required for first sales.

**Conversion mechanics built:**
1. Paywall teaser shows real detected bias labels (personalised, not generic)
2. Unlock code UI is low-friction (no redirect, no new tab, in-place transition)
3. Decision Timeline visible free → user sees own history → wants to understand patterns → pays

---

## 🚀 PRODUCT PRINCIPLES

**How Quorum dies:**
- Mirror ships too slow — the "holy shit" moment delayed indefinitely
- Fingerprint narrative reads like a generic personality test
- Being perceived as another AI chatbot

**How it wins:**
- Mirror narrative is specific enough to be slightly uncomfortable
- Every session compounds the moat — Mirror gets sharper the more Council is used
- Independence Score creates the clearest ROI story: "Is this actually changing how I think?"

*End of Quorum Handover Document v4 — update after each session*
