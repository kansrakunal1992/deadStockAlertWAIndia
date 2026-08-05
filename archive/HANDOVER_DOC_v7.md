# QUORUM — Living Handover Document
> **Last Updated:** May 2, 2026
> **Completed:** Sprint 7d — Behavioral Alerts + Decision Rules + Polish
> **Active Next:** Sprint 8 — Decision Brief PDF (paywall)
> **Mirror Module Status:** Timeline ✅ · Bias Fingerprint ✅ · Independence Score ✅ · Decision Rules ✅ · Behavioral Alerts ✅

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 7d complete — Mirror module fully shipped):**

Mirror module is complete. All four unlocked sections live. Behavioral Alerts running on home page.

**Sprint 7d files:**

| File | Status |
|---|---|
| `app/api/mirror/alerts/route.ts` | NEW (GET — returns confirmed biases + keywords for client matching) |
| `app/api/mirror/rules/route.ts` | NEW (GET — AI extracts operating principles from examiner + pushback) |
| `components/BehaviorAlerts.tsx` | NEW (debounced alert, 800ms, dismissible, client-side match) |
| `components/DecisionRules.tsx` | NEW (threshold gate, skeleton, rules display with left accent bars) |
| `app/page.tsx` | MODIFIED (BehaviorAlerts added below context section; authToken state resolved on history load) |
| `app/mirror/page.tsx` | MODIFIED (DecisionRules added in UnlockedView; divider + section header + intro copy) |

**No new SQL migrations required for Sprint 7d.** All features read from existing tables.

**Sprint 8 starts after 7d test checklist passes.**
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
| Behavioral Alerts: client-side keyword match | No AI call, no latency, no blocking submission flow |
| Behavioral Alerts: require `detection_count >= 2` | Forming tiles (count=1) not reliable enough for pre-submission warning |
| Behavioral Alerts: show max 1 alert at a time | Multiple simultaneous alerts would feel overwhelming |
| Decision Rules: one AI call for all principles | Cap at 7 rules; corpus capped at 20 sessions for token budget |
| Decision Rules: threshold = 8 sessions | Below 8 = too sparse to detect reliable behavioral patterns |
| Decision Rules: requires mirror_access | Rules are a paid feature; threshold gate shown inline |

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
        ✅ Decision Rules (≥8 sessions gate inside component)
```

### Examiner POST trigger chain
```
POST /api/examiner
  ├─ saves examiner_responses rows
  ├─ triggerBiasScoring()         → /api/bias-score
  ├─ triggerStructuralMatch()     → /api/structural-match
  └─ triggerIndependenceScoring() → /api/mirror/independence POST
```

### Behavioral Alerts flow
```
Home page mount:
  ├─ GET /api/mirror/alerts (with Bearer token)
  │     └─ returns: [{ biasKey, biasLabel, detectionCount, activationKeywords[] }]
  └─ held in component state

On decision textarea change:
  ├─ 800ms debounce
  ├─ client-side keyword match (expandKeywords covers semantic variants)
  └─ shows 1 alert card (highest detection_count first) · dismissible per session
```

### Decision Rules flow
```
GET /api/mirror/rules
  ├─ Auth gate (Bearer token → user_id)
  ├─ Mirror access gate (mirror_access row)
  ├─ Session count gate (>= 8)
  ├─ Fetches examiner_responses (all sessions, non-null, ≤50 sessions)
  ├─ Fetches messages where role='user' (pushback messages, ≤50 sessions)
  ├─ Builds corpus text (≤20 sessions to stay in token budget)
  └─ One AI call → JSON array of 3–7 first-person rule strings
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

### Score bands (Independence)
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
  page.tsx                              — Home page (BehaviorAlerts added ✅)
  mirror/page.tsx                       — Mirror page, all gate states (DecisionRules added ✅)
  api/
    examiner/route.ts                   — Saves responses + fires all 3 background jobs ✅
    mirror/
      status/route.ts                   ✅
      timeline/route.ts                 ✅
      fingerprint/route.ts              ✅
      unlock/route.ts                   ✅
      independence/route.ts             ✅
      alerts/route.ts                   ✅ Sprint 7d
      rules/route.ts                    ✅ Sprint 7d

components/
  MirrorTimeline.tsx                    ✅
  BiasFingerprint.tsx                   ✅
  PatternTile.tsx                       ✅
  IndependenceScore.tsx                 ✅
  BehaviorAlerts.tsx                    ✅ Sprint 7d
  DecisionRules.tsx                     ✅ Sprint 7d

lib/
  mirror-fingerprint.ts                 ✅
  independence-score.ts                 ✅ (v2)
  personas.ts                           ✅ (MIRROR_FINGERPRINT_NARRATIVE)
  types.ts                              ✅
  ai-client.ts                          ✅ (Anthropic active)
  bias-scorer.ts                        ✅
  structural-retrieval.ts               ✅

supabase/
  schema.sql                            ✅
  sprint1_ontology.sql                  ✅
  sprint2_add_register.sql              ✅
  sprint3_examiner_phase1.sql           ✅
  sprint4_bias_score.sql                ✅
  sprint4b_device_id.sql                ✅
  sprint5_structural.sql                ✅
  sprint6_auth.sql                      ✅
  sprint7a_mirror_schema.sql            ✅
  sprint7c_independence_constraint.sql  ✅
  (no new SQL for Sprint 7d)
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status |
|---|---|---|
| 1–6 | Foundation through Auth | ✅ All complete |
| 7a | Mirror Foundation | ✅ Schema, gateway, page, Timeline |
| 7b | Mirror: Bias Fingerprint | ✅ Fingerprint, tiles, unlock code, plain-English activation |
| 7c | Mirror: Independence Score | ✅ v2 algorithm, API, component, constraint fix, live validated |
| 7d | Mirror: Alerts + Rules + Polish | ✅ BehaviorAlerts, DecisionRules, polish pass |
| **8** | **Decision Brief PDF** | **🔲 Next** |
| 9 | Contradiction Detector | 🔲 Future (30–50 sessions needed) |

---

## 🔢 SPRINT 8 — DECISION BRIEF PDF (FULL SCOPE)

### Overview

A formatted PDF export of the full session — all persona analyses, Examiner responses, synthesis, and any pushback — delivered as a downloadable artifact after payment or unlock.

**`brief_access_tokens` table already in Supabase.** The Brief flow mirrors the Mirror unlock pattern.

### Gate logic
```
/session/[id]  →  "Get your Decision Brief" CTA
  ├─ User clicks → one-time payment flow (₹4,999 standalone or included in ₹25K session)
  ├─ On success → POST /api/brief-access { sessionId }
  │     └─ creates brief_access_tokens row for this session
  └─ GET /api/record/[id]/brief → validates token → generates PDF → returns download
```

### Components to build
- `app/api/record/[id]/brief/route.ts` — generates PDF (using existing `lib/personas.ts` DECISION_BRIEF prompt)
- `components/BriefCTA.tsx` — "Get Decision Brief" card in session/record view  
- `app/api/brief-access/route.ts` — already exists (check + extend if needed)
- PDF generation: use `pdfmake` or `@react-pdf/renderer` — read SKILL.md first

### Env vars needed
- `BRIEF_ACCESS_TOKEN` — already set (shared secret for manual unlock, same as Mirror pattern)

### Design
- Brief is formatted: Quorum wordmark header, decision text, date, each persona as a named section, Synthesis as a final section
- Locked state in record view shows blurred/greyed content with CTA overlay
- PDF should be clean enough to share with a board or co-founder

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
| Decision Rules | JSON array only; forbidden: "Quorum", "AI", "bias"; max 20 words per rule |
| Decision Rules | First-person imperative framing ("Never…", "Get…", "Separate…") |
| Decision Rules | Skip patterns appearing only once — reliability over coverage |

---

## 💰 BUSINESS MODEL

**Pricing:** Free (Council + Timeline) · ₹4,999 (Mirror unlock) · ₹25K (live session + Brief + Mirror)

**Unlock flow:** `MIRROR_UNLOCK_TOKEN` via WhatsApp → user enters in Mirror UI → instant in-place unlock.

**Stage gate before Sprint 8:** First paying user + one returning user.

---

## 🚀 FOUR WOW MOMENTS (Mirror complete)

1. Fingerprint narrative — slightly uncomfortable, specifically seen
2. Timeline cross-session stripe — same bias across three decisions
3. Independence Score delta going up — proof the product is changing how you think
4. Behavioral Alert fires before submission — "it already knows what I'm about to do"

*End of Handover Doc v7 — update after Sprint 8*
