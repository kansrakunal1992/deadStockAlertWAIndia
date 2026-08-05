# QUORUM — Living Handover Document
> **Last Updated:** May 2, 2026
> **Completed:** Sprint 7b — Mirror Bias Fingerprint
> **Active Next:** Sprint 7c — Decision Independence Score
> **Status:** Mirror page live, Bias Fingerprint generating, unlock code flow working

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 7b complete + bug fixes applied):**

Sprint 7b is fully deployed and validated. The Mirror page is live with:
- Bias Fingerprint narrative generating from real session data
- Pattern tiles (confirmed + forming) rendering correctly
- Activation summaries now in plain English ("Most active when you're considering a major life change and feel torn" not "transition decisions + ambivalence framing")
- Unlock code flow working — user enters code received via WhatsApp, page transitions in-place to unlocked view
- "Run a decision →" CTA added in all forming/empty states

**Files changed across Sprint 7b (all applied):**

| File | Change |
|---|---|
| `app/api/mirror/fingerprint/route.ts` | NEW — fingerprint API |
| `app/api/mirror/unlock/route.ts` | NEW — code-based unlock |
| `components/PatternTile.tsx` | NEW — activation summary moved to own block (fixes collision bug) |
| `components/BiasFingerprint.tsx` | NEW — narrative + tile grid + CTAs |
| `lib/mirror-fingerprint.ts` | NEW — data layer + AI call; sends all confirmed tiles (not just top 3); humanizeActivationSummary() replaces deriveActivationSummary() |
| `lib/personas.ts` | MODIFIED — MIRROR_FINGERPRINT_NARRATIVE prompt added; activation_summary instruction updated to plain English |
| `lib/types.ts` | MODIFIED — FingerprintTile, FingerprintData added |
| `app/mirror/page.tsx` | MODIFIED — UnlockCodeInput component; PaywallGate takes authToken + onUnlocked; UnlockedView renders BiasFingerprint |

**Bugs fixed post-7b deploy (all in above files):**
1. Activation summary collision in tile footer → moved to own block with tiered styling
2. Tiles 4+ missing AI interpretation → now sends all confirmed tiles (cap 6) not just top 3
3. Technical jargon in activation summaries → DECISION_TYPE_LABELS + EMOTION_LABELS maps + AI prompt instruction
4. No CTA back to home from forming/empty states → "Run a decision →" links added

**Sprint 7c starts fresh — share codebase zip + this doc to begin.**

---

## 🧠 WHAT IS QUORUM

**Quorum** is a private AI-powered decision intelligence platform. It presents 6 AI advisor personas analyzing a high-stakes decision in parallel, runs a diagnostic Examiner phase, then synthesises into a directional recommendation.

**Long-term vision: Judgment Compounding System.** The more a user engages, the more Quorum learns their decision patterns, biases, and reasoning style.

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. India + Middle East initially. High-stakes decisions where ₹25K for a Brief is obviously cheap relative to a bad call.

**Positioning:** Apple × McKinsey energy. Private thinking partner with boardroom-grade UX. Not a chatbot.

---

## ⚙️ CRITICAL IMPLEMENTATION / DO-NOT-REDEBATE DECISIONS

| Decision | Rationale |
|---|---|
| Bias scoring triggered server-side from `/api/examiner POST` | Client-side fails on stale connections / Railway cold starts |
| Bias/retrieval jobs read from DB, not client-passed state | DB is source of truth |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` (`createStream`, `createCompletion`) |
| Structural retrieval is rule-based, not embedding-based | Ontology already provides structured representation |
| Only mapped personas receive supplemental after Examiner | stakeholder/family → Stakeholder Mirror; financial/execution → Risk Architect; market/pattern → Pattern Analyst |
| Original persona analysis is immutable | Supplements and pushback append below; never overwrite |
| Pushback text stored in DB as first-class message event | High-value future Ledger data |
| Raw bias scores never user-facing pre-Mirror | Confidence must compound before surfacing |
| Mirror requires `user_id` (full auth), not just `user_email` | Mirror is the auth conversion hook |
| Mirror threshold = 5 sessions | Below 5 = meaningless signal |
| Decision Timeline is free (no mirror_access needed) | Creates pull toward paywall |
| Independence scoring fires from `/api/examiner POST` | Same trigger as bias scoring — no new trigger (Sprint 7c) |
| Fingerprint: one AI call for narrative + all tiles | Avoids N calls per tile; all confirmed tiles sent (cap 6) |
| `MIRROR_UNLOCK_TOKEN` shared secret pattern | Same as `BRIEF_ACCESS_TOKEN`; enables manual sales immediately |
| Activation summaries in plain English | Raw ontology values ("transition decisions + ambivalence framing") are jargon; mapped to conversational phrases |

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
  ├─ No user_id → 'auth'
  │     Sign-in prompt + magic link
  ├─ < 5 sessions → 'threshold'
  │     Progress bar; "N more decisions to unlock"
  ├─ ≥ 5 sessions, no mirror_access → 'paywall'
  │     FREE:  Decision Timeline
  │     FREE:  Forming tile labels (blurred content)
  │     FREE:  Unlock code input → /api/mirror/unlock
  └─ ≥ 5 sessions + mirror_access → 'unlocked'
        ✅ Decision Timeline
        ✅ Bias Fingerprint (narrative + pattern tiles)   ← Sprint 7b LIVE
        🔲 Decision Independence Score                    ← Sprint 7c
```

**Fingerprint confidence tiers:**
- `detection_count = 1` → forming tile (blurred, label only, lock icon)
- `detection_count ≥ 2` → confirmed tile (full interpretation, dim activation box)
- `detection_count ≥ 3` → confirmed tile (full interpretation, gold activation box)

**Fingerprint AI call:**
- All confirmed tiles sent (cap 6), not just top 3
- One call returns: narrative + interpretation + activation_summary per tile
- Activation summaries must be plain English ("Most active when…") — enforced in prompt
- Fallback if AI misses a tile: constructs sentence from humanizeActivationSummary()

---

## 🖥️ TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway |
| AI Provider | **Anthropic Claude** (`claude-sonnet-4-20250514`) |
| Auth | Supabase Magic Link (PKCE flow) |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

**Railway env vars (complete):**
```
AI_PROVIDER               = anthropic
ANTHROPIC_API_KEY         = ***
DEEPSEEK_API_KEY          = *** (kept, not used)
BRIEF_ACCESS_TOKEN        = ***
MIRROR_UNLOCK_TOKEN       = ***
NEXT_PUBLIC_SUPABASE_URL  = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY = ***
NEXT_PUBLIC_APP_URL       = https://invigorating-manifestation-production-ecd2.up.railway.app
```

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                          — Home: decision input, history, MemoryEngineStatus
  mirror/
    page.tsx                        — Full Mirror page, all gate states ✅
  api/
    examiner/route.ts               — GET questions; POST saves responses + triggers bias + structural scoring
    mirror/
      status/route.ts               — Gateway check ✅
      timeline/route.ts             — Session history ✅
      fingerprint/route.ts          — Bias Fingerprint (auth + access gated) ✅
      unlock/route.ts               — Code-based access grant ✅
      independence/route.ts         — Decision Independence Score 🔲 Sprint 7c
    bias-score/route.ts             — Background bias scoring (Sprint 4)
    structural-match/route.ts       — Structural retrieval (Sprint 5)

components/
  MirrorTimeline.tsx                — Decision history, pattern stripes ✅
  BiasFingerprint.tsx               — Narrative + tile grid + CTAs ✅
  PatternTile.tsx                   — Confirmed / forming tile states ✅
  IndependenceScore.tsx             — DI Score display 🔲 Sprint 7c
  BehaviorAlerts.tsx                — Active pattern alerts on home page 🔲 Sprint 7d
  DecisionRules.tsx                 — Extracted operating principles 🔲 Sprint 7d

lib/
  mirror-fingerprint.ts             — Data layer + AI call + humanizeActivationSummary() ✅
  independence-score.ts             — DI Score algorithm 🔲 Sprint 7c
  personas.ts                       — All prompts incl. MIRROR_FINGERPRINT_NARRATIVE ✅
  types.ts                          — FingerprintTile, FingerprintData added ✅
  ai-client.ts                      — Provider abstraction (Anthropic active)
  bias-scorer.ts                    — 15-bias adversarial scoring

supabase/
  sprint7a_mirror_schema.sql        — mirror_access + independence_score_log ✅
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status | Key deliverables |
|---|---|---|---|
| 1 | Ontology Tagger | ✅ | 9-dimension tagger |
| 2 | Register Mode | ✅ | Challenge vs Clarify |
| 3 | Examiner Phase 1 | ✅ | 3 diagnostic questions, synthesis gating |
| 4/4b | Bias Library | ✅ | 15-bias scoring, device_id, null-email fix |
| 5/5b | Structural Retrieval | ✅ | 100-point rubric |
| 6 | Auth | ✅ | Supabase PKCE magic link, 30-day sessions |
| 7a | Mirror Foundation | ✅ | Schema, gateway API, Mirror page, Timeline |
| 7b | Mirror: Bias Fingerprint | ✅ | Fingerprint API, tiles, unlock code, plain-English activation summaries |
| **7c** | **Mirror: Independence Score** | **🔲 Next** | **DI Score algorithm, storage, display** |
| 7d | Mirror: Alerts + Polish | 🔲 | Behavioral alerts, decision rules |
| 8 | Decision Brief PDF | 🔲 | `brief_access_tokens` table ready |
| 9 | Contradiction Detector | 🔲 Future | Needs 30–50 sessions |

---

## 🔢 SPRINT 7c — DECISION INDEPENDENCE SCORE: FULL SPEC

### What It Measures

*Is this user incorporating Quorum's reasoning frameworks in their own thinking — unprompted?*

This is the most honest metric Quorum can offer. It tracks whether the product is actually compounding judgment, not just generating reports. A user at 76+ is asking better questions before they even open Quorum. That's the stated goal, and the score makes it visible.

It is deliberately **not** gamified. No streaks, no badges. Just a number, a delta, and one sentence that tells them what it means.

---

### Scoring Algorithm: `lib/independence-score.ts`

**Input:** All `examiner_responses` rows for a given `user_id`, ordered by session date.

**Why examiner responses:** These are the highest-signal text in the product. The Examiner asks targeted questions about unknown-unknowns. How a user responds reveals their reasoning depth, framework adoption, and whether they're thinking more structurally over time — without self-report bias.

**Signals extracted per response (scoring rubric):**

| Signal | Points | Detection method |
|---|---|---|
| Names a specific worst-case scenario unprompted | 10 | Keywords: "worst case", "if this fails", "downside", "what goes wrong" |
| Surfaces a stakeholder not mentioned in decision text | 10 | Named person/role not in original session text ("my partner", "the board", "our team") |
| Questions the legitimacy of a deadline or constraint | 10 | "is the deadline real", "why [date]", "can we push", "who set this" |
| Separates financial outcome from identity/values | 8 | Phrases distinguishing "what I want" from "what makes sense financially" |
| Uses pre-mortem or scenario inversion unprompted | 8 | "if I look back in 2 years", "assuming this goes wrong", "what would have to be true" |
| Asks a counter-question (doesn't just answer) | 7 | Response ends with "?" or contains "what do you think", "does that change" |
| Response > 120 words (elaborated, not minimal) | 5 | Character/word count |
| Answered all 3 examiner questions (didn't skip) | 5 | `question_order` coverage across session |
| Response references a prior decision or outcome | 7 | "last time", "when I did X before", "similar to my [prior] decision" |

**Max per session: ~70 points**

**Cumulative score calculation:**
```
Per-session raw score: sum of signals (0–70)
Normalized to 0–100 per session
Rolling weighted average across all sessions:
  - More recent sessions weighted higher (decay factor 0.85 per session back)
  - First session always included at full weight (baseline anchor)
Final score: weighted average, rounded to integer, clamped 0–100
```

**Delta:** Current score minus score from 5 sessions ago (or first session if < 5). Shows trajectory, not just absolute level.

**Score bands:**

| Range | Label | Meaning |
|---|---|---|
| 0–24 | Using Quorum as a report generator | Answers are minimal, no framework absorption visible |
| 25–49 | Frameworks starting to appear | Some signals of structured thinking, inconsistent |
| 50–74 | Reasoning visibly shifting | Quorum's approach showing up in how questions are framed |
| 75–100 | Judgment compounding | Applying frameworks unprompted — Quorum becoming internalized |

The 75–100 band copy is deliberately the most interesting: *"You're internalizing the approach — Quorum is becoming less necessary."* This is honest and counterintuitive. It's the claim no advisory tool ever makes.

---

### Files: Sprint 7c

**New files:**
| File | Purpose |
|---|---|
| `lib/independence-score.ts` | Signal extraction + scoring algorithm |
| `app/api/mirror/independence/route.ts` | GET: return latest score for user; POST: calculate + store (called from examiner) |
| `components/IndependenceScore.tsx` | Score display: number + delta + band interpretation |

**Modified files:**
| File | Change |
|---|---|
| `app/api/examiner/route.ts` | Add `triggerIndependenceScoring(sessionId)` fire-and-forget alongside existing bias + structural triggers |
| `app/mirror/page.tsx` | Replace Decision Independence placeholder with `<IndependenceScore authToken={authToken} />` |
| `lib/types.ts` | `IndependenceScoreEntry` already exists — confirm fields match implementation |

**No new SQL migration needed.** `independence_score_log` table is already created in `sprint7a_mirror_schema.sql`.

---

### Component Design: `IndependenceScore.tsx`

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DECISION INDEPENDENCE

  ┌──────────────────────────────────────┐
  │                                      │
  │              67 / 100                │
  │                                      │
  │         ↑ +12 from baseline          │
  │                                      │
  │   "Quorum is visibly shaping         │
  │    your reasoning process."          │
  │                                      │
  │   Based on 8 sessions                │
  └──────────────────────────────────────┘

  What this measures:
  Whether you're asking better questions
  before you even open Quorum — not just
  using it to generate a report.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Design rules:**
- Number centered, large (48–56px), gold
- Delta in a smaller row below, green if positive, muted if flat/negative
- One-sentence band interpretation in italic below delta
- "Based on N sessions" in small muted text
- Below the card: 2-sentence plain-English explanation of what the score measures — first time a user sees this they won't know what "decision independence" means
- No progress bar. No gauge. Just the number and the meaning.
- Empty state (no examiner responses yet): "Complete the Examiner questions in your next session to start tracking this score." + "Run a decision →" CTA

---

### Trigger Architecture

```
User submits Examiner answers
           │
           ▼
POST /api/examiner
  ├── saves examiner_responses rows
  ├── triggerBiasScoring(sessionId)     ← existing
  ├── triggerStructuralMatch(sessionId) ← existing
  └── triggerIndependenceScoring(sessionId) ← NEW (Sprint 7c)
           │
           ▼
POST /api/mirror/independence
  ├── reads all examiner_responses for this user_id
  ├── runs signal extraction across all sessions
  ├── calculates rolling weighted score + delta
  └── upserts row into independence_score_log
```

**Why fire-and-forget (not awaited):** Same reasoning as bias scoring. Independence scoring reads from DB, not client state. Latency is acceptable since the user is still on the Examiner page when this fires — they won't navigate to Mirror for at least 60 seconds.

---

### API: `/api/mirror/independence`

**GET** — returns latest score for the authenticated user:
```typescript
// Response:
{
  score: number | null        // null if no sessions scored yet
  delta: number | null        // null if < 2 scored sessions
  band: string                // one of the 4 band labels
  interpretation: string      // one-sentence plain English
  sessionCount: number        // sessions included in calculation
  calculatedAt: string        // ISO timestamp of last calculation
}
```

**POST** — calculates and stores score (called from examiner trigger, not from client):
```typescript
// Body: { sessionId: string }
// Auth: internal only — no Bearer token check (called server-to-server)
// Response: { ok: true, score: number, delta: number | null }
```

---

### Sprint 7c Test Checklist

**Phase 1 — Score calculation:**
```
□ POST /api/mirror/independence fires after examiner POST (check Railway logs)
□ independence_score_log has new row after session completion
□ Score is between 0 and 100
□ Delta is null on first scored session
□ Delta is numeric on subsequent sessions
□ Score increases when response quality is clearly better (test with high-signal response)
□ Score does not increase when examiner is skipped (no responses = 0 signals)
```

**Phase 2 — GET route:**
```
□ GET /api/mirror/independence returns 401 without auth
□ Returns { score: null } if no sessions scored yet (not an error)
□ Returns correct score + delta + band + interpretation when data exists
□ Returns only data for authenticated user_id (no cross-user leak)
```

**Phase 3 — IndependenceScore component:**
```
□ Empty state renders with CTA when score is null
□ Score renders as large centered number
□ Delta shows with ↑ when positive, → when flat, ↓ when declining
□ Band interpretation matches score range
□ "Based on N sessions" footer matches sessionCount in response
□ Explanation copy renders below card on first view
□ Skeleton loader while fetch is in flight
□ Error state renders without breaking Timeline or Fingerprint above it
```

**Phase 4 — Mirror page integration:**
```
□ Decision Independence section shows score after examiner completion (may require page refresh)
□ Placeholder copy gone — replaced by IndependenceScore component
□ Score persists across sessions (not recalculated from scratch each time)
```

**Phase 5 — Regression:**
```
□ Examiner POST still saves responses correctly
□ Bias scoring still fires after examiner POST
□ Structural matching still fires after examiner POST
□ Mirror page Timeline + Fingerprint unaffected
□ Home page unaffected
```

---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule | Reasoning |
|---|---|---|
| All personas | Word limit at TOP of prompt | Models ignore end-of-prompt instructions |
| All personas | Target 200–280 words (instruct "250 max") | Models run 30–40% over stated limit |
| Synthesis | ≤200 words hard cap | Senior partner debrief, not meeting minutes |
| Mirror Fingerprint | JSON-only output, no markdown fences | Parsed directly |
| Mirror Fingerprint | "particularly when [condition]" required | Prevents generic personality-test copy |
| Mirror Fingerprint | Final sentence creates forward tension | Compliments don't drive return visits |
| Mirror Fingerprint | Forbidden words: "bias", "AI", "Quorum", "algorithm" | Breaks the tone |
| Mirror Fingerprint | All confirmed tiles sent (cap 6), not just top 3 | Tiles 4+ were hitting fallback |
| Mirror Activation | "Most active when…" sentence format | Replaces tag pairs ("X + Y framing") with readable prose |
| Mirror Activation | Plain English only, no ontology field names | "transition decisions" is a schema column, not a human phrase |

---

## 💰 BUSINESS MODEL

**Pricing ladder:**
- Free: Council + Synthesis + Decision Timeline
- ₹4,999: Mirror unlock (Fingerprint + Independence Score)
- ₹25K: Live 45-min session + Decision Brief PDF + Mirror unlock bundled

**Current unlock flow:** Share `MIRROR_UNLOCK_TOKEN` via WhatsApp → user enters in Mirror UI → instant access. No payment gateway.

**Stage gate before Sprint 8 (Brief PDF):**
- At least one paying user at any price point
- At least one returning user (second real decision)

---

## 🚀 PRODUCT NORTH STAR

**The three wow moments (designed):**
1. Reading the Fingerprint narrative and feeling *slightly uncomfortable* — specifically seen
2. Scrolling the Timeline and seeing three sessions connect through the same bias stripe
3. Independence Score delta going up — proof the product is changing how you think

**How Quorum dies:**
- Fingerprint reads like a generic personality test
- Mirror ships too slow
- No paying user before the product gets over-engineered

*End of Quorum Handover Document v5 — update after Sprint 7c*
