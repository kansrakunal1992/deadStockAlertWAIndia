# QUORUM — Living Handover Document
> **Last Updated:** May 2, 2026
> **Completed:** Sprint 7c — Decision Independence Score (v2 algorithm, validated)
> **Active Next:** Sprint 7d — Behavioral Alerts + Decision Rules + Polish
> **Mirror Module Status:** Timeline ✅ · Bias Fingerprint ✅ · Independence Score ✅

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 7c complete + live validated):**

Mirror module is fully live. All three sections generating real data.

**Sprint 7c files (all deployed):**

| File | Status |
|---|---|
| `lib/independence-score.ts` | NEW (v2 — realistic ceiling, empty-session exclusion, logging) |
| `app/api/mirror/independence/route.ts` | NEW (GET + POST, stores scoredCount) |
| `components/IndependenceScore.tsx` | NEW (score, delta, band pill, interpretation) |
| `app/api/examiner/route.ts` | MODIFIED (triggerIndependenceScoring added) |
| `app/mirror/page.tsx` | MODIFIED (IndependenceScore replaces placeholder) |
| `supabase/sprint7c_independence_constraint.sql` | NEW (UNIQUE constraint on session_id — required) |

**Live score observed (May 2, 2026):**
Score=25, delta=+6, band="Frameworks starting to appear" for user with 11 sessions (3 pre-Sprint-3 excluded, 8 scored with short responses). Algorithm confirmed correct — score is an honest reflection of minimal examiner engagement, not a bug.

**Sprint 7d starts after 7c test checklist passes.**
Share fresh codebase zip + this doc to begin.

---

## 🧠 WHAT IS QUORUM

Private AI-powered decision intelligence. Six advisor personas analyze a high-stakes decision in parallel, an Examiner phase surfaces unknown-unknowns, a synthesis delivers a directional recommendation.

**Long-term vision: Judgment Compounding System.** The product learns decision patterns, biases, and reasoning tendencies the more it's used.

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. India + Middle East first. Decisions where ₹25K is cheap relative to a bad call.

**Positioning:** Apple × McKinsey. Private thinking partner. Not a chatbot.

---

## ⚙️ DO NOT REDEBATE — IMPLEMENTATION DECISIONS

| Decision | Rationale |
|---|---|
| All background jobs (bias, structural, independence) fire from `/api/examiner POST` server-side | Client-side fails on stale connections / Railway cold starts |
| Jobs read from DB, not client-passed state | DB is source of truth |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` |
| Structural retrieval is rule-based | Ontology provides structured representation |
| Only mapped personas receive Examiner supplemental | stakeholder/family → Stakeholder Mirror; financial → Risk Architect; market → Pattern Analyst |
| Original persona analysis is immutable | Supplements append below; never overwrite |
| Mirror requires `user_id` | Auth conversion hook; email-only can't guarantee persistence |
| Mirror threshold = 5 sessions | Below 5 = meaningless signal |
| Decision Timeline is free | Creates pull toward paywall |
| Fingerprint: one AI call for all tiles (cap 6) | Avoids N calls per tile |
| Activation summaries in plain English | Raw ontology values are jargon |
| Independence: exclude sessions with no responses | Pre-Sprint-3 sessions must not suppress score permanently |
| Independence `REALISTIC_MAX = 35` | Good responses score 80–100, not 40–50 |
| Independence: keyword-based signal detection | Acceptable MVP trade-off; refine with usage data |
| `MIRROR_UNLOCK_TOKEN` shared secret pattern | Same as `BRIEF_ACCESS_TOKEN`; enables manual sales today |

**Identity/accumulation priority:**
1. `user_id` — cross-device, permanent
2. `user_email` — cross-device, pre-auth
3. `device_id` — device-local, ephemeral
4. Anonymous — INSERT only

---

## 🏗️ ARCHITECTURE

### Mirror gate states
```
/mirror
  ├─ No user_id → 'auth'
  ├─ < 5 sessions → 'threshold'
  ├─ ≥ 5, no mirror_access → 'paywall'
  │     FREE: Timeline · teaser tiles · unlock code input
  └─ ≥ 5, mirror_access → 'unlocked'
        ✅ Decision Timeline
        ✅ Bias Fingerprint (narrative + pattern tiles)
        ✅ Decision Independence Score
        🔲 Decision Rules (Sprint 7d, ≥8 sessions)
```

### Examiner POST trigger chain
```
POST /api/examiner
  ├─ saves examiner_responses rows
  ├─ triggerBiasScoring()         → /api/bias-score
  ├─ triggerStructuralMatch()     → /api/structural-match
  └─ triggerIndependenceScoring() → /api/mirror/independence POST
```

### Independence score algorithm (v2)
```
Input: all examiner_responses for user_id, oldest → newest

9 signals per response (keyword regex):
  worst_case_framing        10pts
  stakeholder_surfacing     10pts
  deadline_questioning      10pts
  values_outcome_separation  8pts
  premortem_thinking         8pts
  counter_questioning        7pts
  cross_session_reference    7pts
  response_depth             5pts  (≥60 words)
  answered_not_skipped       5pts  (>15 chars)

Normalization: min(100, rawScore / 35 × 100)
Completion bonus: +10 flat if all 3 questions answered

Per session: avg(response scores) + completion bonus
  → null if no responses at all (excluded from weighted average)

Weighted average: decay 0.85 per session back
Delta: current score vs weighted average of sessions [0 .. N-lookback]
  where lookback = min(5, N-1)
```

### Score bands
```
75–100  Judgment compounding — "You're applying structured thinking before opening Quorum."
50–74   Reasoning visibly shifting — "Quorum's approach is starting to show up in how you frame questions."
25–49   Frameworks starting to appear — "Some signals emerging, not yet consistent."
0–24    Using Quorum as a report generator — "Reasoning in Examiner is minimal."
```

### Fingerprint confidence tiers
```
detection_count = 1  → forming tile (blurred, label visible, lock icon)
detection_count ≥ 2  → confirmed tile (interpretation + dim activation box)
detection_count ≥ 3  → confirmed tile (interpretation + gold activation box)
```

---

## 🖥️ TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway |
| AI Provider | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Auth | Supabase Magic Link (PKCE flow) |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

**Railway env vars:**
```
AI_PROVIDER                   = anthropic
ANTHROPIC_API_KEY             = ***
BRIEF_ACCESS_TOKEN            = ***
MIRROR_UNLOCK_TOKEN           = ***
NEXT_PUBLIC_SUPABASE_URL      = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY     = ***
NEXT_PUBLIC_APP_URL           = https://...railway.app
```

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                              — Home page (Sprint 7d: BehaviorAlerts added here)
  mirror/page.tsx                       — Mirror page, all gate states ✅
  api/
    examiner/route.ts                   — Saves responses + fires all 3 background jobs ✅
    mirror/
      status/route.ts                   ✅
      timeline/route.ts                 ✅
      fingerprint/route.ts              ✅
      unlock/route.ts                   ✅
      independence/route.ts             ✅
      alerts/route.ts                   🔲 Sprint 7d
      rules/route.ts                    🔲 Sprint 7d

components/
  MirrorTimeline.tsx                    ✅
  BiasFingerprint.tsx                   ✅
  PatternTile.tsx                       ✅
  IndependenceScore.tsx                 ✅
  BehaviorAlerts.tsx                    🔲 Sprint 7d
  DecisionRules.tsx                     🔲 Sprint 7d

lib/
  mirror-fingerprint.ts                 ✅
  independence-score.ts                 ✅ (v2)
  personas.ts                           ✅ (MIRROR_FINGERPRINT_NARRATIVE)
  types.ts                              ✅
  ai-client.ts                          ✅ (Anthropic active)
  bias-scorer.ts                        ✅
  structural-retrieval.ts               ✅

supabase/
  sprint7a_mirror_schema.sql            ✅
  sprint7c_independence_constraint.sql  ✅ (UNIQUE on session_id)
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status |
|---|---|---|
| 1–6 | Foundation through Auth | ✅ All complete |
| 7a | Mirror Foundation | ✅ Schema, gateway, page, Timeline |
| 7b | Mirror: Bias Fingerprint | ✅ Fingerprint, tiles, unlock code, plain-English activation |
| 7c | Mirror: Independence Score | ✅ v2 algorithm, API, component, constraint fix, live validated |
| **7d** | **Mirror: Alerts + Polish** | **🔲 Next** |
| 8 | Decision Brief PDF | 🔲 `brief_access_tokens` table ready |
| 9 | Contradiction Detector | 🔲 Future (30–50 sessions needed) |

---

## 🔢 SPRINT 7d — FULL SCOPE

### 1. Behavioral Alerts (home page)

Pre-submission pattern warning. After user types a decision, a lightweight check fires against their confirmed biases from `bias_library`. If activation conditions match, a dismissible alert surfaces below the input — before they submit.

```
⚠ Pattern detected
Exit Optionality Mispricing has been active in 4 of your past decisions
when considering high-commitment transitions.

Consider: Have you mapped what reversing this would actually require?

[ Dismiss ]
```

- Client-side keyword check against `activation_contexts` from a preloaded bias fetch — no AI call, no added latency
- Only fires for authenticated users with ≥1 confirmed bias (`detection_count ≥ 2`)
- 800ms debounce on input change
- Files: `components/BehaviorAlerts.tsx`, `app/api/mirror/alerts/route.ts`, `app/page.tsx` (MODIFIED)

### 2. Decision Rules (Mirror page)

Unlocked view, ≥8 sessions. One AI call extracts implicit operating principles from the user's Examiner answers + pushback messages. Surfaced as first-person rules.

```
Your operating principles (from 12 decisions):

• Never accept the first deadline without checking if it's real
• Separate what makes financial sense from what you actually want
• Get one disconfirming view before any irreversible commitment
```

- Files: `components/DecisionRules.tsx`, `app/api/mirror/rules/route.ts`, `app/mirror/page.tsx` (MODIFIED)
- Session threshold: 8 sessions with mirror_access

### 3. Polish pass
- Skeleton loaders verified on all async Mirror sections
- Error boundaries confirmed (fingerprint failure must not break Timeline)
- Mobile layout check at 390px
- Empty/locked state copy reviewed for tone throughout

---

## 🔍 INDEPENDENCE SCORE — OBSERVED BEHAVIOURS & LIMITATIONS

**Score of 25 is correct.** The user's examiner responses were genuinely short (7–27 words visible). The algorithm is accurately measuring minimal engagement.

**How scores increase:** Users need to write responses ≥60 words that contain structured reasoning signals. The score explanation in the component and the "Run a decision →" CTA both guide toward this.

**Log interleaving is expected.** BiasScore, StructuralMatch, and IndependenceScore all fire concurrently from the Examiner POST. Q-level log lines may appear out of order between other service logs. Math always resolves correctly regardless of log display order.

**Signal detection is keyword-based, not semantic.** Some genuine reasoning in unusual phrasing won't be detected. Some surface-level trigger words will score higher than warranted. Acceptable MVP trade-off.

**Scale limit:** Recalculates from all sessions per trigger. Fine up to ~50 sessions/user. At that scale, move to incremental calculation (cache prior weighted average, score only new session delta).

---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule |
|---|---|
| All personas | Word limit at TOP (models ignore end-of-prompt instructions) |
| All personas | Instruct "250 max" for 200–280 output |
| Synthesis | ≤200 words hard cap |
| Mirror Fingerprint | JSON-only output; forbidden: "bias", "AI", "Quorum", "algorithm" |
| Mirror Fingerprint | Must include "particularly when [condition]" |
| Mirror Fingerprint | Final sentence creates forward tension, not a compliment |
| Mirror Fingerprint | All confirmed tiles sent (cap 6) — not just top 3 |
| Mirror Activation | "Most active when…" sentence; plain English only |

---

## 💰 BUSINESS MODEL

**Pricing:** Free (Council + Timeline) · ₹4,999 (Mirror unlock) · ₹25K (live session + Brief + Mirror)

**Unlock flow:** `MIRROR_UNLOCK_TOKEN` via WhatsApp → user enters in Mirror UI → instant in-place unlock.

**Stage gate before Sprint 8:** First paying user + one returning user.

---

## 🚀 THREE WOW MOMENTS

1. Fingerprint narrative — slightly uncomfortable, specifically seen
2. Timeline cross-session stripe — same bias across three decisions
3. Independence Score delta going up — proof the product is changing how you think

*End of Handover Doc v6 — update after Sprint 7d*
