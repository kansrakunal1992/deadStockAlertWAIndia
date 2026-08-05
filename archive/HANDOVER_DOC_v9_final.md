# QUORUM — Living Handover Document
> **Last Updated:** May 4, 2026
> **Completed:** Sprint 9 — Contradiction Detector (live validated)
> **Active Next:** Sprint 10 — Prompt Tightening + Premium Website + GTM
> **Mirror Module:** Timeline ✅ · Fingerprint ✅ · Independence ✅ · Rules ✅ · Contradictions ✅

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 9 live, validated May 4):**

All Mirror sections are live and generating real data. Contradiction Detector surfaced 3 contradictions on first run (2 genuine, 1 false positive — see analysis below). Pass-2 prompt needs tightening before wider user rollout.

**Sprint 9 files (all deployed):**

| File | Status |
|---|---|
| `supabase/sprint9_contradictions.sql` | ✅ Run in Supabase |
| `lib/contradiction-detector.ts` | ✅ Two-pass AI pipeline |
| `app/api/mirror/contradictions/route.ts` | ✅ GET / POST / DELETE |
| `components/ContradictionDetector.tsx` | ✅ 40-session gate + progressive teaser + Run a decision CTA |
| `app/api/examiner/route.ts` | ✅ `triggerContradictionDetection()` added |
| `app/mirror/page.tsx` | ✅ ContradictionDetector wired in UnlockedView |

**Critical deployment note:** Folder must be named `contradictions` (plural).
Was accidentally deployed as `contradiction` (singular) → 404. Renamed and fixed.
Force-trigger via POST `{ userId, force: true }` to backfill historical sessions.

---

## 🔐 FEATURE GATES

| Feature | Gate |
|---|---|
| Council + Examiner + Synthesis | Free · no auth |
| Behavioral Alerts (home page) | Free · auth required |
| Decision Timeline | Free · auth + ≥5 sessions |
| Bias Fingerprint | Paid · `MIRROR_UNLOCK_TOKEN` |
| Decision Independence Score | Paid · `MIRROR_UNLOCK_TOKEN` |
| Decision Rules | Paid · `MIRROR_UNLOCK_TOKEN` · ≥8 sessions gate inside component |
| Contradiction Detector | Paid · `MIRROR_UNLOCK_TOKEN` · teaser 10–39 sessions · full unlock ≥40 |
| Decision Brief PDF | Paid · `BRIEF_ACCESS_TOKEN` |

---

## 🧠 WHAT IS QUORUM

Private AI-powered decision intelligence. Six advisor personas analyse a high-stakes decision in parallel. Examiner phase surfaces unknown-unknowns. Synthesis delivers a directional recommendation.

**Long-term vision: Judgment Compounding System** — the product learns decision patterns, biases, and reasoning tendencies the more it's used.

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. India + Middle East first. Decisions where ₹25K is cheap relative to a bad call.

**Positioning:** Apple × McKinsey. Private thinking partner. Not a chatbot.

---

## ⚙️ DO NOT REDEBATE — IMPLEMENTATION DECISIONS

| Decision | Rationale |
|---|---|
| All background jobs fire from `/api/examiner POST` | Client-side fails on Railway cold starts |
| Jobs read from DB, not client state | DB is source of truth |
| Never instantiate model SDKs directly | Always use `lib/ai-client.ts` |
| Contradiction: two-pass AI (extract → compare) | Single call hallucinates cross-references |
| Contradiction gate: 40 sessions | Below that, principle extraction produces noise |
| Contradiction teaser: 4 milestones at 10/20/30/40 | Progressive reveal; blurred tiles are placeholders only — no fabricated data |
| Contradiction rerun throttle: 7 days | Prevents redundant AI calls; `force: true` bypasses |
| Contradiction cap: 3 surfaced max | Quality over quantity |
| Pass-2 severity "notable" too permissive | Catches non-contradictions — tighten in Sprint 10 |
| BriefCTA Card at module scope | Prevents input focus loss (component-in-render remount) |
| PDF: `new Uint8Array(buffer)` | `Buffer` not assignable to `BodyInit` in Next.js 15 |
| PDF: style calls inside render loops | jsPDF resets state on `addPage()` |
| PDF: `sanitise()` before all text | ₹ → Rs., jsPDF Latin-1 encoding |
| BehaviorAlerts: two-layer matching | History keywords (tier 1) + static phrases (tier 2) |
| BehaviorAlerts: dismiss via `Set<string>` | `string|null` caused cycling bug |

---

## 🏗️ ARCHITECTURE

### Contradiction detection pipeline
```
POST /api/examiner (session complete)
  └─ triggerContradictionDetection(sessionId) — fire-and-forget
       └─ POST /api/mirror/contradictions { sessionId }
            ├─ Resolve user_id from session row
            ├─ Check contradiction_runs — skip if ran < 7 days (unless force=true)
            ├─ Fetch sessions + examiner_responses + pushback messages
            ├─ Build SessionEvidence[] (sessions with actual content only)
            ├─ < 5 sessions with evidence → record run, return early
            ├─ Pass 1: createCompletion → extract principles per session (max 3/session)
            └─ Pass 2: createCompletion → find contradictions across all principles
                 └─ Upsert into contradictions table (UNIQUE on user+session pair)
```

### Mirror unlocked section order
```
Decision Timeline        free · ≥5 sessions
Bias Fingerprint         paid
Decision Independence    paid
Decision Rules           paid · ≥8 sessions gate inside component
Contradiction Detector   paid · teaser 10–39 · unlock ≥40
```

### Examiner POST trigger chain (complete)
```
POST /api/examiner
  ├─ triggerBiasScoring()
  ├─ triggerStructuralMatch()
  ├─ triggerIndependenceScoring()
  └─ triggerContradictionDetection()
```

### ContradictionDetector milestone states
```
0–9   → "Detection initialising"  · 0 blurred tiles · Run a decision CTA
10–19 → "First patterns detected" · 1 blurred tile   · excerpt + CTA
20–29 → "Signal strengthening"    · 2 blurred tiles  · excerpt + CTA
30–39 → "Contradiction forming"   · 3 blurred tiles  · excerpt + CTA
≥40   → Live contradiction cards (or empty/error states)
```

---

## 🔬 CONTRADICTION DETECTOR — LIVE VALIDATION (May 4, 2026)

**First run: 3 contradictions surfaced. Assessment: 2 genuine, 1 false positive.**

### Emerging · Autonomy ✅ (genuine, weak)
- Said: "I don't let co-founder deadlines drive my decision unless backed by external pressure"
- Did: "I consider locking up capital for 5+ years acceptable if I can afford it without liquidity"
- Assessment: Both involve commitment under external pressure — the AI read the structural connection correctly. "Forming" severity is right. Borderline but defensible.

### Tension · Urgency ✅ (genuine, strong — this is the wow moment)
- Said: "I prioritize my child being cared for by a parent over career considerations"
- Did: "I want to retire at 45 with FULL FIRE — it's an urgency"
- Assessment: Real structural conflict. The FIRE urgency competes directly with the stated family-first principle. This is exactly the feature working as intended. The "what you said / what you did" framing makes it land.

### Tension · Process ❌ (false positive)
- Said: "I require a startup concept validated by pilot before committing full-time"
- Did: "I require knowing personal obligations before leaving stable job for pre-revenue venture"
- Assessment: Two different process requirements for two different decision types — not a contradiction. The pass-2 prompt's "meaningful tension" threshold is too permissive. These are both cautious-process principles that happen to come from different sessions.

**Fix needed (Sprint 10):** Tighten pass-2 prompt. Replace "meaningful tension" with stricter language — a contradiction must show the person explicitly doing something they said they wouldn't do, or not doing something they said they always do. Process variants aren't contradictions.

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                              ✅ Home (BehaviorAlerts)
  mirror/page.tsx                       ✅ Mirror (all 5 sections)
  record/[id]/page.tsx                  ✅ Record (BriefCTA)
  api/
    examiner/route.ts                   ✅ 4 background triggers
    brief-access/route.ts               ✅
    record/[id]/brief/route.ts          ✅ PDF generation
    mirror/
      status · timeline · fingerprint · unlock · independence · alerts · rules
      contradictions/route.ts           ✅ Sprint 9

components/
  BehaviorAlerts.tsx                    ✅ phrase library v4
  BriefCTA.tsx                          ✅
  MirrorTimeline · BiasFingerprint · PatternTile
  IndependenceScore · DecisionRules
  ContradictionDetector.tsx             ✅ Sprint 9

lib/
  ai-client · bias-scorer · independence-score
  mirror-fingerprint · personas · types
  ontology-tagger · structural-retrieval
  contradiction-detector.ts             ✅ Sprint 9

supabase/
  schema → sprint1–6 → sprint7a → sprint7c_independence_constraint
  → sprint9_contradictions.sql          ✅
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status |
|---|---|---|
| 1–6 | Foundation through Auth | ✅ |
| 7a–7d | Mirror: Timeline → Rules | ✅ |
| 8 | Decision Brief PDF | ✅ |
| 9 | Contradiction Detector | ✅ live validated |
| **10** | **Prompt tightening + Website + GTM** | **🔲 Next** |

---

## 🔢 SPRINT 10 — SCOPE

### 10a · Contradiction pass-2 prompt tightening (1 file, 30 min)
The false positive rate on first run was 1/3. Acceptable for MVP but needs fixing before showing to users who haven't built the product with you.

**File:** `lib/contradiction-detector.ts`
**Change:** Replace the PASS2_PROMPT definition. The key addition:

```
A contradiction requires ONE of:
  (a) The person explicitly did X after stating they never do X
  (b) The person skipped Y after stating they always require Y before deciding
  (c) The person stated principle A, then in a later decision stated principle B
      where A and B are logically incompatible (not just different contexts)

"Tension" (notable severity) must meet the same bar — different phrasing of
the same cautious instinct is NOT a tension. Different decision types applying
different frameworks is NOT a tension.
```

### 10b · Premium website (new repo or `/marketing` subfolder)
- Dark, minimal, typographic — Apple × McKinsey
- Homepage: one value prop, 3 wow moments (Fingerprint narrative, Contradiction card, Independence delta), single CTA
- No product screenshots — typographic decision prompt teaser, illustrated timeline visual
- /session: Calendly embed or form for ₹25K live advisory booking
- Custom domain (quorum.so or similar)

### 10c · GTM pipeline
- LinkedIn outreach: 15 warm leads from PE/founder network
  - Message 1: observation on a public decision they've made
  - Message 2: "built a private advisory layer for decisions like this"
  - Message 3: offer one session, no pitch
- XLRI WhatsApp: "3 decisions to stress-test, on me" — gets real data, warm referrals
- Stage gate: 1 paying live session + 1 returning user before Sprint 11

### 10d · Session outcome loop (small, high-value)
Currently decisions go in but outcomes never come back. A lightweight "what happened?" prompt 30 days after each decision — one tap: Got better / Got worse / Still deciding — populates `session_outcomes` and unlocks the Contradiction Detector's causal layer (did the contradiction actually cost them?).

---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule |
|---|---|
| All personas | Word limit at TOP |
| Synthesis | ≤200 words hard cap |
| Mirror Fingerprint | JSON only · forbidden: "bias", "AI", "Quorum" |
| Decision Rules | First-person imperative · max 20 words per rule |
| Contradiction Pass 1 | Max 3 principles/session · skip thin sessions (<30 words) |
| Contradiction Pass 2 | Max 3 contradictions · severity classified by AI · **needs tightening Sprint 10a** |

---

## 💰 BUSINESS MODEL

- Free: Council + Decision Timeline
- ₹4,999: Mirror unlock (`MIRROR_UNLOCK_TOKEN` via WhatsApp)
- ₹25K: Live advisory session + Brief + Mirror

**Stage gate before Sprint 11:** 1 paying live session + 1 returning user.

---

## 🚀 SIX WOW MOMENTS

1. Behavioral Alert fires before submission — "it already knows"
2. Fingerprint narrative — slightly uncomfortable, specifically seen
3. Timeline cross-session stripe — same bias, three decisions
4. Independence Score delta going up — proof the product is working
5. Decision Brief PDF — clean enough to share with a board
6. **Contradiction card** — "You said you'd never do X. Then you did."

*End of Handover Doc v9 — update after Sprint 10*
