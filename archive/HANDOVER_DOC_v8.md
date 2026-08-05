# QUORUM — Living Handover Document
> **Last Updated:** May 3, 2026
> **Completed:** Sprint 8 — Decision Brief PDF + BehaviorAlerts v4
> **Active Next:** Sprint 9 — Contradiction Detector (30–50 sessions prerequisite)
> **Business gate:** First paying user · First returning user

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 8 complete):**

Decision Brief PDF is live. BehaviorAlerts phrase library expanded to v4 covering 90-case test set. Mirror module complete.

**Sprint 8 files (v2 — both bugs fixed post first deploy):**

| File | Status |
|---|---|
| `components/BehaviorAlerts.tsx` | MODIFIED (phrase library v4) |
| `app/api/record/[id]/brief/route.ts` | NEW v2 — unicode sanitiser (₹→Rs.), line-by-line rendering, light theme |
| `components/BriefCTA.tsx` | NEW v2 — Card moved outside component (fixes cursor focus loss on keystroke) |
| `app/record/[id]/page.tsx` | MODIFIED (BriefCTA added below OutcomeTracker) |

**Two post-deploy bugs fixed:**
- `BriefCTA` cursor bug: `Card` was defined inside the function component — new reference on every render → React remounts subtree → input loses focus after each keystroke. Fixed by moving `Card` to module scope.
- PDF unicode: jsPDF uses Latin-1 encoding; `₹` rendered as `¹`, em-dashes as `?`. Fixed with a `sanitise()` function that maps all non-Latin-1 chars before any text reaches the renderer (₹→Rs., —→--, "→", etc.).
- PDF layout: pre-calculated box heights were wrong when text wrapped unexpectedly. Switched to line-by-line rendering throughout — height is always exact.

**No new SQL migrations.** No new npm installs (jsPDF already in package.json).

**Before Sprint 9:** Confirm first paying Brief download has occurred. Check session count per user — Sprint 9 (Contradiction Detector) requires 30–50 sessions of real usage to produce reliable cross-session contradictions.

---

## 🧠 WHAT IS QUORUM

Private AI-powered decision intelligence. Six advisor personas analyze a high-stakes decision in parallel, an Examiner phase surfaces unknown-unknowns, a synthesis delivers a directional recommendation.

**Long-term vision: Judgment Compounding System.** The product learns decision patterns, biases, and reasoning tendencies the more it's used.

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. India + Middle East first.

**Positioning:** Apple × McKinsey. Private thinking partner. Not a chatbot.

---

## ⚙️ DO NOT REDEBATE — IMPLEMENTATION DECISIONS

| Decision | Rationale |
|---|---|
| All background jobs fire from `/api/examiner POST` server-side | Client-side fails on Railway cold starts |
| Jobs read from DB, not client-passed state | DB is source of truth |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` |
| Structural retrieval is rule-based | Ontology provides structured representation |
| Mirror requires `user_id` | Auth conversion hook |
| Mirror threshold = 5 sessions | Below 5 = meaningless signal |
| Decision Timeline is free | Creates pull toward paywall |
| Independence `REALISTIC_MAX = 35` | Good responses score 80–100, not 40–50 |
| `MIRROR_UNLOCK_TOKEN` shared secret | Enables manual sales today |
| `BRIEF_ACCESS_TOKEN` shared secret | Same pattern — no DB needed for MVP |
| BehaviorAlerts: client-side keyword match | No AI call, no latency |
| BehaviorAlerts: two-layer matching | History keywords (tier 1) + static phrases (tier 2) |
| BehaviorAlerts: specificity ranking | Longer phrase = more specific = higher confidence |
| BehaviorAlerts: dismiss via Set<string> | Was string\|null — caused cycling bug |
| Brief PDF: jsPDF server-side | Already in package.json; no Chrome; no new dep |
| Brief PDF: token re-validated server-side | BriefCTA validates client-side then passes token to route which re-validates |
| Decision Rules threshold = 8 sessions | Below 8 = too sparse to detect reliable patterns |

---

## 🏗️ ARCHITECTURE

### Brief access flow
```
Record page → "Get Brief →" → token input
  → POST /api/brief-access { token }
      → { valid: true }  → GET /api/record/[id]/brief?token=...
                              → validates token server-side
                              → fetches session + messages
                              → buildPdf() → returns binary
                              → browser triggers download
      → { valid: false } → error state, retry
```

### BehaviorAlerts matching tiers
```
Input change → 800ms debounce → findBestMatch()
  → Layer 1: check activationKeywords from /api/mirror/alerts
      (grounded in user's actual past session reasoning)
  → Layer 2: check BIAS_TRIGGER_PHRASES static vocabulary
      (covers framing + dismissal + assurance language of new decisions)
  → Sort: Tier 1 > Tier 2, then by phrase length (specificity)
  → Show best match, unless dismissed (Set<string>)
```

### Mirror gate states
```
/mirror
  ├─ No user_id → 'auth'
  ├─ < 5 sessions → 'threshold'
  ├─ ≥ 5, no mirror_access → 'paywall'
  └─ ≥ 5, mirror_access → 'unlocked'
        ✅ Decision Timeline
        ✅ Bias Fingerprint
        ✅ Decision Independence Score
        ✅ Decision Rules (≥8 sessions gate inside component)
```

### Examiner POST trigger chain
```
POST /api/examiner
  ├─ triggerBiasScoring()         → /api/bias-score
  ├─ triggerStructuralMatch()     → /api/structural-match
  └─ triggerIndependenceScoring() → /api/mirror/independence POST
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
| PDF | jsPDF 2.5.2 (server-side, already installed) |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                              — Home (BehaviorAlerts ✅)
  mirror/page.tsx                       — Mirror (all gates + DecisionRules ✅)
  record/[id]/page.tsx                  — Record (BriefCTA added ✅)
  api/
    examiner/route.ts                   — Saves responses + fires 3 background jobs ✅
    brief-access/route.ts               — Token validation (env var) ✅
    record/[id]/brief/route.ts          — PDF generation ✅ Sprint 8
    mirror/
      status / timeline / fingerprint / unlock / independence / alerts / rules
      (all ✅)

components/
  BehaviorAlerts.tsx                    ✅ Sprint 8 (phrase library v4)
  BriefCTA.tsx                          ✅ Sprint 8
  MirrorTimeline.tsx                    ✅
  BiasFingerprint.tsx                   ✅
  PatternTile.tsx                       ✅
  IndependenceScore.tsx                 ✅
  DecisionRules.tsx                     ✅

lib/
  ai-client.ts  · bias-scorer.ts  · independence-score.ts
  mirror-fingerprint.ts  · personas.ts  · types.ts
  ontology-tagger.ts  · structural-retrieval.ts  · supabase.ts  · storage.ts
  (all ✅)
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status |
|---|---|---|
| 1–6 | Foundation through Auth | ✅ |
| 7a | Mirror: Schema + Timeline | ✅ |
| 7b | Mirror: Bias Fingerprint | ✅ |
| 7c | Mirror: Independence Score | ✅ |
| 7d | Mirror: Alerts + Rules | ✅ |
| 8 | Decision Brief PDF + Alerts v4 | ✅ |
| **9** | **Contradiction Detector** | **🔲 Next** |
| — | Premium website | 🔲 |
| — | Founder-led demo pipeline | 🔲 |

---

## 🔢 SPRINT 9 — CONTRADICTION DETECTOR (PREVIEW)

**Prerequisite: 30–50 sessions of real usage per user. Do not start until you have this.**

The Contradiction Detector runs as a weekly background job:
1. Extracts stated principles from past Examiner responses + pushback messages
2. Compares them across sessions to find structural violations
   (e.g., "I always want to see the downside first" → made a decision without modeling failure)
3. Surfaces 1–3 contradictions per user in Mirror, with session references

**Why this is the most emotionally resonant feature:** It shows the user a gap between
who they think they are as a decision-maker and what they actually do — derived from
their own words, not the AI's assessment. That discomfort is the "oh shit" moment that
makes them share the product.

**Technical requirements:**
- `structural_matches` table (Sprint 5) — captures cross-session structural similarity
- `session_outcomes` — when user closes the loop, what actually happened
- `examiner_responses` — source of stated principles
- Weekly job: can run as a Railway cron or a POST to a protected endpoint

---

## 💰 BUSINESS MODEL

**Pricing:**
- Free: Council + Decision Timeline
- ₹4,999: Mirror unlock (MIRROR_UNLOCK_TOKEN via WhatsApp)
- ₹25K: Live advisory session + Decision Brief + Mirror (BRIEF_ACCESS_TOKEN via WhatsApp)

**Stage gates:**
- Before Sprint 9: First paying Brief download + one returning user

---

## 🔍 BEHAVIOURALERTS — PHRASE LIBRARY v4 NOTES

**Coverage after v4:** The 90-case test set (9 biases × 10 decisions) should now hit
85–90% recall. The remaining ~10% are cases where the decision text uses highly
paraphrased or indirect language that doesn't contain any of the trigger patterns.

**The hardest gap to close without an AI call:** Implicit dismissal language.
e.g., "My analysis is thorough" (overconfidence), "I've done similar before" (overconfidence),
"The co-founder seems reliable" (relationship alignment). These require semantic
understanding, not pattern matching.

**Do not add an AI call to BehaviorAlerts yet.** See Sprint 7d handover reasoning.
If you add one in the future: only fire when Layer 1 and Layer 2 both return null;
cache by decision hash; treat low-confidence AI outputs as suppressed.

---

## 🚀 FIVE WOW MOMENTS (post-Sprint 8)

1. Behavioral Alert fires before submission — "it already knows what I'm about to do"
2. Fingerprint narrative — slightly uncomfortable, specifically seen
3. Timeline cross-session stripe — same bias across three decisions
4. Independence Score delta going up — proof the product is changing how you think
5. Decision Brief PDF — clean enough to share with a co-founder or board

*End of Handover Doc v8 — update after Sprint 9*
