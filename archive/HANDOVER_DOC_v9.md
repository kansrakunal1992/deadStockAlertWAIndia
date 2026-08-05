# QUORUM — Living Handover Document
> **Last Updated:** May 2026
> **Completed:** Sprint 9 — Contradiction Detector
> **Active Next:** Sprint 10 — Premium Website + GTM Pipeline
> **Mirror Module Status:** Timeline ✅ · Fingerprint ✅ · Independence ✅ · Rules ✅ · Contradictions ✅

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 9 complete):**

Contradiction Detector is live. All five Mirror sections are now shipped. Mirror module is complete.

**Sprint 9 files:**

| File | Status |
|---|---|
| `supabase/sprint9_contradictions.sql` | NEW — run in Supabase SQL editor |
| `lib/contradiction-detector.ts` | NEW — two-pass AI pipeline (principle extraction → contradiction detection) |
| `app/api/mirror/contradictions/route.ts` | NEW — GET (list), POST (trigger), DELETE (dismiss) |
| `components/ContradictionDetector.tsx` | NEW — 40-session gate, 4-milestone progressive teaser, live cards |
| `app/api/examiner/route.ts` | MODIFIED — `triggerContradictionDetection()` added (fire-and-forget) |
| `app/mirror/page.tsx` | MODIFIED — ContradictionDetector added after Decision Rules in UnlockedView |

**No new npm installs. Run `sprint9_contradictions.sql` before deploying.**

---

## 🔐 FEATURE GATES (current state)

| Feature | Who can access | Gate |
|---|---|---|
| Council (6 personas + Examiner + Synthesis) | Everyone | Free · no auth required |
| Behavioral Alerts (home page) | Authenticated users only | Free · auth required |
| Decision Timeline in Mirror | Authenticated · ≥5 sessions | Free · auth + sessions |
| Bias Fingerprint | Authenticated · ≥5 sessions · paid | `MIRROR_UNLOCK_TOKEN` |
| Decision Independence Score | Authenticated · ≥5 sessions · paid | `MIRROR_UNLOCK_TOKEN` |
| Decision Rules | Authenticated · ≥8 sessions · paid | `MIRROR_UNLOCK_TOKEN` |
| Contradiction Detector | Authenticated · paid · ≥40 sessions to fully unlock | `MIRROR_UNLOCK_TOKEN` · progressive teaser from session 10 |
| Decision Brief PDF | Any session · paid | `BRIEF_ACCESS_TOKEN` |

---

## 🧠 WHAT IS QUORUM

Private AI-powered decision intelligence. Six advisor personas analyse a high-stakes decision in parallel. An Examiner phase surfaces unknown-unknowns. Synthesis delivers a directional recommendation.

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
| Contradiction detection: two-pass AI (extract then compare) | One giant call produces hallucinated cross-references |
| Contradiction gate: 40 sessions | Below that, principle extraction produces noise not signal |
| Contradiction teaser: 4 milestones at 10/20/30/40 | Progressive reveal builds anticipation; blurred tiles are placeholders only — no fabricated data |
| Contradiction rerun throttle: 7 days | Prevents redundant AI calls; `force: true` bypasses for testing |
| Contradiction cap: 3 surfaced maximum | Quality over quantity — one sharp contradiction is worth more than five tenuous ones |
| `MIRROR_UNLOCK_TOKEN` shared secret | Enables manual sales today without Stripe integration |
| `BRIEF_ACCESS_TOKEN` shared secret | Same pattern — no DB needed for MVP |
| BriefCTA `Card` at module scope | Prevents input focus loss bug (component-in-render remount) |
| PDF: `new Uint8Array(buffer)` in Response | `Buffer` not assignable to `BodyInit` in Next.js 15 strict mode |
| PDF: style calls inside render loops | jsPDF resets graphics state on `addPage()` — style must be re-applied after every `ensure()` |
| PDF: `sanitise()` before all text | jsPDF uses Latin-1 — ₹ renders as ¹ without sanitisation |
| BehaviorAlerts: two-layer matching | History keywords (tier 1, grounded) + static phrases (tier 2, vocabulary) |
| BehaviorAlerts: dismiss via `Set<string>` | `string | null` caused cycling bug after second dismiss |

---

## 🏗️ ARCHITECTURE

### Contradiction detection pipeline
```
POST /api/examiner (after session completes)
  └─ triggerContradictionDetection(sessionId)  ← fire-and-forget
       └─ POST /api/mirror/contradictions { sessionId }
            ├─ Resolve user_id from session row
            ├─ Check contradiction_runs — skip if ran < 7 days ago
            ├─ Fetch all sessions + examiner_responses + pushback messages
            ├─ Build SessionEvidence[] (only sessions with actual content)
            ├─ If < 5 sessions with evidence → record run, return early
            ├─ Pass 1: createCompletion → extract principles per session
            └─ Pass 2: createCompletion → find contradictions across principles
                 └─ Upsert into contradictions table (UNIQUE on user+session pair)
```

### ContradictionDetector teaser milestones
```
sessionCount 0–9   → "Detection initialising"  · 0 blurred tiles
sessionCount 10–19 → "First patterns detected" · 1 blurred tile + excerpt
sessionCount 20–29 → "Signal strengthening"    · 2 blurred tiles + excerpt
sessionCount 30–39 → "Contradiction forming"   · 3 blurred tiles + excerpt
sessionCount ≥ 40  → Live: fetch + render contradiction cards
```

### Mirror unlocked view — section order
```
Decision Timeline       (free, ≥5 sessions)
Bias Fingerprint        (paid)
Decision Independence   (paid)
Decision Rules          (paid, ≥8 sessions gate inside component)
Contradiction Detector  (paid, teaser from session 10, fully unlocked at 40)
```

### Examiner POST trigger chain (full)
```
POST /api/examiner
  ├─ triggerBiasScoring()              → /api/bias-score
  ├─ triggerStructuralMatch()          → /api/structural-match
  ├─ triggerIndependenceScoring()      → /api/mirror/independence POST
  └─ triggerContradictionDetection()   → /api/mirror/contradictions POST
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
| PDF | jsPDF 2.5.2 (server-side, dynamic import) |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                              — Home (BehaviorAlerts ✅)
  mirror/page.tsx                       — Mirror (all 5 sections ✅)
  record/[id]/page.tsx                  — Record (BriefCTA ✅)
  api/
    examiner/route.ts                   — 4 background triggers ✅
    brief-access/route.ts               — Token validation ✅
    record/[id]/brief/route.ts          — PDF generation ✅
    mirror/
      status/route.ts                   ✅
      timeline/route.ts                 ✅
      fingerprint/route.ts              ✅
      unlock/route.ts                   ✅
      independence/route.ts             ✅
      alerts/route.ts                   ✅
      rules/route.ts                    ✅
      contradictions/route.ts           ✅ Sprint 9

components/
  BehaviorAlerts.tsx                    ✅ (phrase library v4)
  BriefCTA.tsx                          ✅
  MirrorTimeline.tsx                    ✅
  BiasFingerprint.tsx                   ✅
  PatternTile.tsx                       ✅
  IndependenceScore.tsx                 ✅
  DecisionRules.tsx                     ✅
  ContradictionDetector.tsx             ✅ Sprint 9

lib/
  ai-client.ts  · bias-scorer.ts  · independence-score.ts
  mirror-fingerprint.ts  · personas.ts  · types.ts
  ontology-tagger.ts  · structural-retrieval.ts
  contradiction-detector.ts             ✅ Sprint 9

supabase/
  schema.sql → sprint1 → sprint2 → sprint3 → sprint4 → sprint4b
  → sprint5 → sprint6 → sprint7a → sprint7c_independence_constraint
  → sprint9_contradictions.sql          ✅ Sprint 9
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
| 8 | Decision Brief PDF | ✅ |
| 9 | Contradiction Detector | ✅ |
| **10** | **Premium website + GTM pipeline** | **🔲 Next** |

---

## 🔢 SPRINT 10 — PREMIUM WEBSITE + GTM PIPELINE

**Goal:** Convert warm leads who've heard about Quorum but haven't tried it. The current Railway URL is functional, not credible at ₹25K. The website needs to do two jobs: (1) make the product feel inevitable, (2) give a clear path to a live session.

### Website
- Apple × McKinsey positioning — dark, minimal, typographic
- Homepage: one-sentence value prop, 3 wow moments (Fingerprint, Contradiction, Independence Score), CTA to request a session
- No product screenshots — instead: decision prompt input teaser, timeline visual, fingerprint tile preview (designed, not live)
- /about: Kunal's positioning — founder-run advisory, not SaaS
- /session: booking form (Calendly or custom) for ₹25K live advisory

### GTM
- LinkedIn outreach sequence: 15 warm leads from PE post engagements
  - Message 1: observation about a decision they've made publicly (hiring, fundraise, expansion)
  - Message 2: Quorum framing — "I've been building a private advisory layer for decisions like this"
  - Message 3: offer 1 session, see what surfaces, no pitch
- WhatsApp broadcast to XLRI group: "built a thing, want 3 decisions to stress-test before I charge properly"

### Stage gate before Sprint 10 ends
- 1 paying live session completed (₹25K received, Brief delivered)
- 1 returning user (came back for second real decision unprompted)
- Website live on custom domain

---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule |
|---|---|
| All personas | Word limit at TOP |
| Synthesis | ≤200 words hard cap |
| Mirror Fingerprint | JSON only · no "bias", "AI", "Quorum" |
| Mirror Fingerprint | "particularly when [condition]" required |
| Decision Rules | JSON array · first-person imperative · max 20 words per rule |
| Contradiction Pass 1 | Max 3 principles per session · skip thin sessions |
| Contradiction Pass 2 | Max 3 contradictions · severity must be classified |

---

## 💰 BUSINESS MODEL

- Free: Council + Decision Timeline
- ₹4,999: Mirror unlock (MIRROR_UNLOCK_TOKEN via WhatsApp)
- ₹25K: Live advisory session + Decision Brief + Mirror

**Stage gate before Sprint 10:** First paying Brief download + one returning user. Both need to happen before website build begins — don't build marketing for a product that hasn't proved commercial pull.

---

## 🚀 SIX WOW MOMENTS (Mirror complete + Sprint 9)

1. Behavioral Alert fires before submission — "it already knows what I'm about to do"
2. Fingerprint narrative — slightly uncomfortable, specifically seen
3. Timeline cross-session stripe — same bias across three decisions
4. Independence Score delta going up — proof the product is changing how you think
5. Decision Brief PDF — clean enough to share with a co-founder or board
6. **Contradiction card** — "You said you never commit without stress-testing. Then you did exactly that."

*End of Handover Doc v9 — update after Sprint 10*
