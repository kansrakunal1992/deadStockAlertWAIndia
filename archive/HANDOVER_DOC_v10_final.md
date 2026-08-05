# QUORUM — Living Handover Document
> **Last Updated:** May 7, 2026
> **Completed:** Sprint 10a–10d · UI theme system (dark/light toggle, contrast uplift)
> **Active Next:** Sprint 10c (GTM outreach)
> **Mirror Module:** Timeline ✅ · Fingerprint ✅ · Independence ✅ · Rules ✅ · Contradictions ✅
> **Mirror Module:** Timeline ✅ · Fingerprint ✅ · Independence ✅ · Rules ✅ · Contradictions ✅

---

## 🔄 LATEST PROMPT (Start Here in Next Session)

**Context (Sprint 10a–10d complete + UI theme system, May 7):**

PASS2_PROMPT false positive rate fixed. Website rebuilt. Outcome loop shipped. UI theme system added — dark mode contrast uplift + full light mode ("Private Bank Stationery") with fixed toggle on every page. Website URL now `https://app.quorumvault.xyz`. Next: GTM outreach (10c).

**Sprint 10 files (all complete):**

| File | Status |
|---|---|
| `lib/contradiction-detector.ts` | ✅ PASS2_PROMPT tightened (Sprint 10a) |
| `quorum-website.html` | ✅ Full marketing site with dark/light toggle, PRISME order, session modal |
| `app/globals.css` | ✅ Dark mode contrast uplift + `[data-theme="light"]` tokens added |
| `components/ThemeToggle.tsx` | ✅ NEW — fixed top-right pill, sun/moon icon, persists to localStorage |
| `app/layout.tsx` | ✅ Anti-flash theme script in `<head>` + global `<ThemeToggle />` render |
| `supabase/sprint10b_session_requests.sql` | ✅ Ready to run — session_requests table  RLS |
| `supabase/sprint10d_outcomes.sql` | ✅ outcomes table  RLS (join-through-sessions)  pending view |
| `app/api/mirror/outcomes/route.ts` | ✅ GET — distribution, pending count, causalReady flag |
| `components/OutcomeTracker.tsx` | ✅ localSaved bug fix — fresh saves no longer silently disappear |

**Critical deployment note (website):**
Replace `YOUR_PROJECT_ID` and `YOUR_SUPABASE_ANON_KEY` in the HTML with your actual Supabase values (Project Settings → API). RLS is already configured — anon key can INSERT only, no browser reads.

---

## 🔐 FEATURE GATES

| Feature | Gate |
|---|---|
| Council  Examiner  Synthesis | Free · no auth |
| Behavioral Alerts (home page) | Free · auth required |
| Decision Timeline | Free · auth  ≥5 sessions |
| Bias Fingerprint | Paid · `MIRROR_UNLOCK_TOKEN` |
| Decision Independence Score | Paid · `MIRROR_UNLOCK_TOKEN` |
| Decision Rules | Paid · `MIRROR_UNLOCK_TOKEN` · ≥8 sessions gate inside component |
| Contradiction Detector | Paid · `MIRROR_UNLOCK_TOKEN` · teaser 10–39 sessions · full unlock ≥40 |
| Decision Brief PDF | Paid · `BRIEF_ACCESS_TOKEN` |

---

## 🧠 WHAT IS QUORUM

Private AI-powered decision intelligence. Six advisor personas analyse a high-stakes decision in parallel. Examiner phase surfaces unknown-unknowns. Synthesis delivers a directional recommendation.

**Long-term vision: Judgment Compounding System** — the product learns decision patterns, biases, and reasoning tendencies the more it's used.

**Target user:** HNIs, CXOs, family office MDs, second-generation business owners. Decisions where ₹25K is cheap relative to a bad call.

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
| PASS2_PROMPT — simultaneous-truth test added | Fixed false positive: "could both be true at once? if yes, not a contradiction" |
| PASS2_PROMPT — explicit disqualifiers enumerated | Process variants, context shifts, different decision types are NOT contradictions |
| BriefCTA Card at module scope | Prevents input focus loss (component-in-render remount) |
| outcomes.user_id — REMOVED | Column caused ERROR 42703 on migration; ownership is already implicit via session_id → sessions.user_id. Existing api/outcome/route.ts never wrote user_id. RLS policy joins through sessions instead. |
| sessions_pending_outcomes view | No user_id column selected — join through sessions only. Safe across all deployment variants. |
| Mirror outcomes route — identity resolution | Resolves session IDs first via user_id/user_email/device_id, then queries outcomes.in(session_ids). No outcomes.user_id dependency. |
| OutcomeTracker localSaved state | existingOutcome is a server prop (never updates client-side). After a fresh save, localSaved captures the submitted data so the saved card renders immediately. displayOutcome = existingOutcome ?? localSaved. |
| PDF: `new Uint8Array(buffer)` | `Buffer` not assignable to `BodyInit` in Next.js 15 |
| PDF: style calls inside render loops | jsPDF resets state on `addPage()` |
| PDF: `sanitise()` before all text | ₹ → Rs., jsPDF Latin-1 encoding |
| BehaviorAlerts: two-layer matching | History keywords (tier 1)  static phrases (tier 2) |
| BehaviorAlerts: dismiss via `Set<string>` | `string|null` caused cycling bug |
| Website light mode: cream bg  navy ink  steel borders | Cream retained; cool ink/borders distinguish from Claude's warm-all-over look |
| App dark mode: text-1 `#f5f7fb`, text-2 `#c8d6f0`, text-3 `#8fa0c4` | Prior values (#edf0f7, #b0bcd4, #6a7a9a) were insufficiently legible. These new values are the source of truth. |
| ThemeToggle in `layout.tsx`, not per-page | Single render point; `position: fixed` makes it visible on all pages without per-page boilerplate. |
| Anti-flash script in `<head>` before React | `localStorage` read must be synchronous pre-paint. Script sets `data-theme` on `<html>` — `suppressHydrationWarning` on html tag required. |
| Session form: 3-step modal, no page redirect | Interest → decision → contact. Better conversion than separate page |
| Session form: decision input as qualifier | 80-char minimum  pattern matching surfaces a relevant signal card. Scarcity: "4 sessions/week" |
| Supabase: anon key INSERT-only, no SELECT for browser | RLS enforces write-only from front-end; reads via dashboard or service role |

---

## 🏗️ ARCHITECTURE

### Contradiction detection pipeline
```
POST /api/examiner (session complete)
  └─ triggerContradictionDetection(sessionId) — fire-and-forget
       └─ POST /api/mirror/contradictions { sessionId }
            ├─ Resolve user_id from session row
            ├─ Check contradiction_runs — skip if ran < 7 days (unless force=true)
            ├─ Fetch sessions  examiner_responses  pushback messages
            ├─ Build SessionEvidence[] (sessions with actual content only)
            ├─ < 5 sessions with evidence → record run, return early
            ├─ Pass 1: createCompletion → extract principles per session (max 3/session)
            └─ Pass 2: createCompletion → find contradictions across all principles
                 └─ Upsert into contradictions table (UNIQUE on usersession pair)
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
10–19 → "First patterns detected" · 1 blurred tile   · excerpt  CTA
20–29 → "Signal strengthening"    · 2 blurred tiles  · excerpt  CTA
30–39 → "Contradiction forming"   · 3 blurred tiles  · excerpt  CTA
≥40   → Live contradiction cards (or empty/error states)
```

### Website session request flow
```
Button click (nav / hero / pricing)
  └─ Modal opens, step pre-selected if from pricing card
       ├─ Step 1: Interest type (mirror | live | explore | other)
       ├─ Step 2: Decision input (80-char min)
       │    └─ Regex pattern match → signal card shown (5 patterns  default)
       │    └─ Scarcity note: "4 live sessions/week"
       ├─ Step 3: Name  email (required) · WhatsApp  context (optional)
       └─ Submit → POST /rest/v1/session_requests (Supabase anon key)
            ├─ Success → step switches to confirmation with context-aware message
            └─ Error → inline error, retry available
```

### session_requests table schema
```sql
id                 uuid        PK
created_at         timestamptz DEFAULT now()
interest_type      text        NOT NULL  -- 'mirror' | 'live' | 'explore' | 'other'
decision_summary   text
name               text        NOT NULL
email              text        NOT NULL
whatsapp           text
additional_context text
status             text        DEFAULT 'pending'
                               -- 'pending' | 'reviewed' | 'accepted' | 'declined' | 'waitlisted'
responded_at       timestamptz
notes              text        -- internal ops only
```

---

## 🔬 CONTRADICTION DETECTOR — PASS2_PROMPT FIX (Sprint 10a)

**Problem:** False positive rate was 1/3 on first live run. "Tension · Process" case — two cautious-process principles from different decision types — was being labelled a contradiction because "meaningful tension" was too permissive.

**Fix (three mechanisms added to PASS2_PROMPT):**

1. **Strict definition** — reframed from "tension" to "violation of own principle." Forces the model to find the same person contradicting themselves, not two different instincts.

2. **Automatic disqualifiers** — explicit enumeration of false-positive patterns:
   - Two process requirements that could both be true simultaneously → NOT a contradiction
   - Two principles from different decision types → NOT a contradiction
   - Same caution expressed in different words → NOT a contradiction

3. **Simultaneous-truth test** — "Before flagging: could both principles be true at the same time? If yes — not a contradiction." Pilot validation  know-your-obligations obviously passes (both can be true). FIRE urgency  family-first obviously fails (they genuinely compete).

**Validated:** The two genuine contradictions from Sprint 9 (Autonomy/forming, Urgency/tension) would still pass under the new prompt. The false positive would not.

---

## 🌐 WEBSITE — SPRINT 10b

**File:** `quorum-website.html` (standalone, no framework)

**Design decisions locked:**

| Decision | Detail |
|---|---|
| Fonts | Cormorant Garamond (display/serif)  DM Sans (body)  DM Mono (mono/eyebrow) |
| Dark mode bg | `#010204` — near-black, blue-tinted |
| Light mode bg | `#f4f1eb` — cream, retained from v8 |
| Light mode ink | `#060d1c` — cold navy, NOT warm charcoal. Differentiates from Claude |
| Light mode borders | `#c8cdd8` — cool steel-blue, NOT warm beige. Key differentiator |
| Gold (dark) | `#c9a84c` — brand-matched to app |
| Gold (light) | `#9a7020` — deeper for contrast on cream |
| Council order | PRISME — Pattern · Risk · Investor · Strategist · Mirror · Elder |
| Theme toggle | Pill switch in nav, persists via `localStorage` |
| App URL | `https://app.quorumvault.xyz` — all three CTA buttons updated from Railway subdomain |
| "SCROLL" hint | Removed |
| Location references | Removed ("India & Middle East" gone everywhere) |

**Sections (in order):**
1. Hero — "Your decisions compound. Most people never find out how."
2. The Problem — two-col with stats counter
3. The Council — PRISME grid, 6 advisor cards
4. What it surfaces — 3 wow-moment cards (Contradiction demo, Fingerprint, Independence Score)
5. How it works — 4-step grid (Council → Examiner → Synthesis → Mirror)
6. Access / Pricing — 3 tiers, pricing card buttons pre-select modal interest
7. CTA — "Start with one decision"
8. Footer

**Session request modal — 3 steps  success:**

Step 1: Interest selection (4 options, pre-selectable from pricing cards)
Step 2: Decision input — 80-char threshold, 5 regex patterns surface relevant signal card, default fallback, scarcity note
Step 3: Name  email (required)  WhatsApp  context (optional)
Success: Context-aware confirmation message per interest type

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
  ThemeToggle.tsx                       ✅ NEW — fixed pill, sun/moon, localStorage persist
  MirrorTimeline · BiasFingerprint · PatternTile
  IndependenceScore · DecisionRules
  ContradictionDetector.tsx             ✅ Sprint 9

lib/
  ai-client · bias-scorer · independence-score
  mirror-fingerprint · personas · types
  ontology-tagger · structural-retrieval
  contradiction-detector.ts             ✅ PASS2_PROMPT tightened Sprint 10a

app/globals.css                         ✅ dark/light CSS tokens, .theme-toggle class
app/layout.tsx                          ✅ anti-flash script, ThemeToggle render

supabase/
  schema → sprint1–6 → sprint7a → sprint7c_independence_constraint
  → sprint9_contradictions.sql          ✅
  → sprint10d_outcomes.sql              ✅ outcomes table (no user_id) + pending view
  → sprint10b_session_requests.sql      ✅ Ready to run

marketing/
  quorum-website.html                   ✅ Sprint 10b — full site with modal
```

---

## 📋 SPRINT STATUS

| Sprint | Name | Status |
|---|---|---|
| 1–6 | Foundation through Auth | ✅ |
| 7a–7d | Mirror: Timeline → Rules | ✅ |
| 8 | Decision Brief PDF | ✅ |
| 9 | Contradiction Detector | ✅ live validated |
| 10a | Contradiction pass-2 prompt tightening | ✅ |
| 10b | Premium website  session form  Supabase | ✅ |
| **10c** | **GTM pipeline** | **🔲 Next** |
| 10d | Session outcome loop | ✅ |
| 10e | UI theme system — dark contrast uplift + light mode + toggle | ✅ |

---

## 🔢 SPRINT 10 — REMAINING SCOPE

### 10c · GTM pipeline
Stage gate before Sprint 11: 1 paying live session  1 returning user.

**LinkedIn outreach (15 warm leads from PE/founder network):**
- Message 1: observation on a public decision they've made
- Message 2: "built a private advisory layer for decisions like this"
- Message 3: offer one session, no pitch

**XLRI WhatsApp:** "3 decisions to stress-test, on me" — gets real data, warm referrals

### 10d · Session outcome loop (small, high-value)
**Shipped.** Three files:

**Implementation:**
- New table: `session_outcomes` (`session_id`, `outcome`, `notes`, `recorded_at`)
- Scheduled job (or cron on Railway): flag sessions where `created_at` < 30 days ago and no outcome recorded
- Single-tap UI on the record page or email link
- Unlocks Contradiction Detector's causal layer (did the contradiction actually cost them?)
- `supabase/sprint10d_outcomes.sql` — `outcomes` table (session_id, what_decided, council_helped, notes). **No user_id column** — ownership through sessions. RLS joins via sessions. `sessions_pending_outcomes` view for future reminder cron.
- `app/api/mirror/outcomes/route.ts` — GET returns total, pending, distribution (yes/partially/no), 5 recent, causalReady (≥5).
- `components/OutcomeTracker.tsx` — fixed silent-disappear bug on fresh save (localSaved state).

**Migration note:** Run `sprint10d_outcomes.sql`. The `sessions` table already has an `outcomes` route reading from it — no other file changes needed.

**Next on outcomes:** Railway cron querying `sessions_pending_outcomes` view (service role) → 30-day nudge email. The `causalReady` flag on the Mirror route is the hook for Contradiction Detector's causal layer (Sprint 11+).


---

## 💡 PROMPT ENGINEERING LOG

| Area | Rule |
|---|---|
| All personas | Word limit at TOP |
| Synthesis | ≤200 words hard cap |
| Mirror Fingerprint | JSON only · forbidden: "bias", "AI", "Quorum" |
| Decision Rules | First-person imperative · max 20 words per rule |
| Contradiction Pass 1 | Max 3 principles/session · skip thin sessions (<30 words) |
| Contradiction Pass 2 | Max 3 contradictions · severity classified by AI · simultaneous-truth test added · explicit disqualifiers enumerated ✅ |

---

## 💰 BUSINESS MODEL

- Free: Council  Decision Timeline
- ₹4,999: Mirror unlock (`MIRROR_UNLOCK_TOKEN` via WhatsApp or email after session_request accepted)
- ₹25K: Live advisory session  Brief  Mirror

**Stage gate before Sprint 11:** 1 paying live session  1 returning user.

---

## 🚀 SIX WOW MOMENTS

1. Behavioral Alert fires before submission — "it already knows"
2. Fingerprint narrative — slightly uncomfortable, specifically seen
3. Timeline cross-session stripe — same bias, three decisions
4. Independence Score delta going up — proof the product is working
5. Decision Brief PDF — clean enough to share with a board
6. **Contradiction card** — "You said you'd never do X. Then you did."

---

## 🗓️ GRAPH & LEGACY — TIMELINE NOTE

Neither is imminent. Both need longitudinal scale that doesn't exist yet.

**Graph** (connected decision network) needs 50 sessions per user to find meaningful cross-decision links. Mostly backend graph traversal  a visualization layer. No point scoping until Mirror has proven itself at 20 sessions per active user.

**Legacy** (generational transfer) is a product design problem more than a technical one. Needs a clear use case before any code. Earliest realistic exploration: 18–24 months after Mirror is stable.

Neither is backend-only — both will have UI — but building either now would be premature.

Enhancements: 
Applied: May 6, 2026
Affects: lib/personas.ts · components/PersonaPanel.tsx · components/RecordExport.tsx


Change 1 · Persona Word Limit — 220–280 → ~200 words
File: lib/personas.ts

 2. LENGTH: Your response must be 140–170 words. Count before submitting.
    If you exceed 170 words, cut the weakest paragraph entirely. No exceptions.
    Every sentence must earn its place.
Rationale: Models run 30–40% over stated limits. Instructing 140–170 yields ~195–200 in practice — the target. HNI/Founder reading context: these users are consuming 6 personas in one sitting. At 280 words per card that's 1,680+ words of analysis before synthesis. At 200 words it's under 1,200 — digestible in a single focused read. The literary register of the personas (especially Elder, Contrarian) is deliberately elevated; density matters more than volume.
Note: Synthesis hard cap remains 180 words (unchanged — it was already set correctly).

Change 2 · Challenge Button — Footer → Header
File: components/PersonaPanel.tsx
What changed: The "Challenge this · add context" button moved from the card footer (full-width, bottom) to the card header (compact, top-right), appearing only when panelState === 'done'. The textarea/send flow still appears at the bottom when triggered.
Before: Full-width gold button at footer → required scrolling past the response to find it.
After: Compact pill button in the header row, right of the status badge (✓) → visible immediately when analysis completes, no scroll required. Button auto-hides once showPushback is true (textarea replaces it at bottom).
Usability logic: Users read top-to-bottom. The natural reaction to "I disagree with this" happens as they're reading, not after they've scrolled past everything. Header placement matches the cognitive moment of friction — the button is available the instant the analysis finishes.
Label shortened: "Challenge this · add context" → "Challenge · add context" (11px compact pill fits the header row cleanly).

Change 3 · Decision Brief PDF Structure — Flat List → Brief + Appendix
File: components/RecordExport.tsx
Before: PDF exported all personas in a flat ordered sequence:
Cover → Decision Brief → Synthesis → Contrarian → Risk Architect → Pattern Analyst → Stakeholder Mirror → Elder → Competitor
After: PDF is structured as a proper deliverable:
Cover page
  └─ THE DECISION (text + context)
Section 1: DECISION BRIEF  (main document body)
  └─ decision_brief persona output — full premium header treatment
Section 2: APPENDIX divider page
  └─ "Full Council Analysis · Council Synthesis · Advisor Responses"
     ├─ Council Synthesis
     ├─ The Contrarian
     ├─ The Risk Architect
     ├─ The Pattern Analyst
     ├─ The Stakeholder Mirror
     ├─ The Elder
     └─ The Competitor
Rationale: "Generate Decision Brief" on the session page and the PDF "Decision Brief" button were producing different experiences — one was a focused structured output, the other was a full data dump with the brief buried at the front. The PDF should read like a McKinsey one-pager that happens to have full workings attached. The Brief IS the document. The council analysis is the supporting evidence. Now structurally aligned.
Appendix divider page: A centred "APPENDIX" label on a blank dark page with a subtitle line — signals the transition from deliverable to working documents. Visually clean, easy to print just page 1–N (brief only) or the full document.
Appendix only rendered if content exists: hasAppendix guard ensures the divider page doesn't appear for sessions where only the brief was generated (no persona messages in DB).

Prompt Engineering Log — Update
Add to lib/personas.ts section of handover doc:
AreaRuleAll personasWord limit instruction: 140–170 (yields ~200 output). Previous: 220–280 (yielded ~280–300).

DO NOT REDEBATE additions
DecisionRationaleChallenge button in header, not footerCognitive friction moment happens during reading, not after scrolling. Header placement = zero scroll to access.PDF: Brief as main body, council as AppendixThe Brief IS the deliverable. Council analysis = supporting evidence. Structurally correct for a ₹25K product artifact.Word limits: instruct 140–170 to get ~200Models overshoot by 30–40%. 140–170 instruction → ~195–200 output. Tested pattern from prior persona calibration.

# HANDOVER DOC — Patch v10c (Session 2)
> Applied: May 7, 2026
> Covers all changes made post HANDOVER_DOC_v10_final.md

---

## FILES CHANGED — QUICK REFERENCE

| File | Change |
|---|---|
| `lib/personas.ts` | Word limit 220–280 → 140–170 |
| `components/PersonaPanel.tsx` | Challenge button moved to header |
| `components/RecordExport.tsx` | Brief = main body, council = Appendix (client-side PDF) |
| `components/SessionView.tsx` | "Save Record → PDF" renamed "Save to Record" (both instances) |
| `components/ReanalyzeDrawer.tsx` | **NEW** — client component with full drawer for record page |
| `app/record/[id]/page.tsx` | RecordExport removed; ReanalyzeDrawer added (2 placements); Reanalyze near OutcomeTracker |
| `app/api/record/[id]/brief/route.ts` | Full rewrite — dark theme, markdown renderer, forced page break, ALL CAPS headers, duplicate heading strip, auto-generate brief if missing |

---

## CHANGE 1 · Persona Word Limit

**File:** `lib/personas.ts` · `WORD_LIMIT_PREFIX` constraint #2

```
140–170 words (was 220–280)
+ "Every sentence must earn its place."
```

Models overshoot by 30–40%. 140–170 instruction → ~195–200 output.
Synthesis hard cap 180 words — unchanged.

---

## CHANGE 2 · Challenge Button → Header

**File:** `components/PersonaPanel.tsx`

- Moved from full-width footer button → compact gold pill in header row (top-right, beside ✓ badge)
- Only visible when `panelState === 'done'`
- Textarea/send still appears at card bottom when triggered
- Button auto-hides once `showPushback = true`
- Label: "Challenge · add context" (shortened to fit pill)

**DO NOT revert:** Cognitive friction moment happens during reading, not after scrolling.

---

## CHANGE 3 · PDF Structure (client-side RecordExport)

**File:** `components/RecordExport.tsx`

New order:
```
Cover
Section 1: DECISION BRIEF (main body)
Appendix divider page
  └─ Synthesis
  └─ 6 advisor personas
```

`hasAppendix` guard prevents dangling divider if no persona messages exist.

**The client-side RecordExport button is removed from the record page.**
Only `BriefCTA` ("Get Brief") is the export path now.

---

## CHANGE 4 · "Save to Record" Rename

**File:** `components/SessionView.tsx`

Both instances renamed:
- Top header: `"Save Record → PDF"` → `"Save to Record"`
- Bottom bar: `"Save Decision Record → Export PDF"` → `"Save to Record"`

Rationale: button saves session to DB + navigates to `/record/[id]`. Never generated a PDF — old label was wrong. Brief PDF is exclusively via "Get Brief" (paid).

---

## CHANGE 5 · ReanalyzeDrawer (NEW COMPONENT)

**File:** `components/ReanalyzeDrawer.tsx` ← NEW FILE

Client component (`'use client'`). Props: `sessionId`, `decisionText`, `contextText`.

Exact extraction of the drawer pattern from `SessionView.tsx`:
- Same bottom-slide drawer with editable decision textarea
- Same optional context textarea
- Same Challenge / Understand toggle
- On submit: `POST /api/session` → creates new session → `router.push('/session/[newId]')`

Used in record page at two placements:
1. Below `OutcomeTracker` (flush-right, small ghost button)
2. Bottom bar (alongside "New decision")

**DO NOT use `<Link href="/session/[id]">` for Reanalyze anywhere.** That re-opens the old session, not a new one. ReanalyzeDrawer always creates a new session with pre-filled text.

---

## CHANGE 6 · Record Page Cleanup

**File:** `app/record/[id]/page.tsx`

- Removed: `import RecordExport` + both `<RecordExport>` renders
- Added: `import ReanalyzeDrawer`
- Added: `<ReanalyzeDrawer>` near OutcomeTracker + bottom bar
- Existing: `<BriefCTA>` retained as the only PDF export
- `Link` import retained (used for "New decision" → `/`)

---

## CHANGE 7 · Brief Route — Full Rewrite (v3)

**File:** `app/api/record/[id]/brief/route.ts`

### 7a — Dark premium theme (replaces light theme)

```
pageBg:     [4, 6, 15]      — deep navy
briefBg:    [8, 18, 8]      — dark green for brief header band
synthBg:    [15, 22, 15]
gold:       [201, 168, 76]
bodyText:   [188, 200, 220]
mutedText:  [74, 85, 104]
```

Per-persona accent colours (match UI dark theme):
```
contrarian:         [60, 18, 18]
risk_architect:     [11, 22, 56]
pattern_analyst:    [11, 32, 22]
stakeholder_mirror: [28, 12, 46]
elder:              [38, 24, 8]
competitor:         [22, 16, 6]
```

### 7b — Critical bug fix: font before splitTextToSize

Every `splitTextToSize` call now has `setFont()` + `setFontSize()` immediately before it.

**Root cause of text clipping:** jsPDF uses the currently active font's metrics for wrapping. If a bold header was drawn immediately before, `splitTextToSize` calculated line breaks using bold metrics but text rendered in normal (narrower) — causing 3–4 chars to be silently cut per line.

### 7c — Markdown renderer (`renderMarkdown`)

For `decision_brief` messages only. Handles:

| Pattern | Rendering |
|---|---|
| `**bold**` inline | Helvetica Bold segment, inline x-tracking |
| `*italic*` inline | Helvetica Italic segment |
| `---` | Thin gold horizontal rule |
| `- item` / `• item` | Gold bullet dot + indented text |
| `1. item` | Gold numbered label + indented text |
| `**Heading**` (full line) | Larger bold, body colour |
| ALL CAPS line | Gold bold + short underline rule (e.g. KEY INSIGHTS, RISKS) |

Prose persona messages still use `bodyBlock` (no markdown).

### 7d — Forced page break for Decision Brief

```typescript
// Before (broken):
ensure(52)  // only breaks if <52pt remain — doesn't break on short decisions

// After (fixed):
doc.addPage()
fillPageDark()
page++
Y = ML
drawFooter()
```

Decision Brief always starts on its own page. Cover page = wordmark + decision only.

### 7e — Duplicate heading strip

AI `DECISION_BRIEF` prompt makes the model echo `DECISION BRIEF` / `THE DECISION BRIEF` as its first line. Since the header band already renders this, the echo was doubling up. Regex strips it:

```typescript
const cleaned = msg.content
  .replace(/^\s*\*{0,2}(THE\s+)?DECISION BRIEF\*{0,2}\s*\n?/i, '')
  .replace(/^\s*#{1,3}\s*(THE\s+)?DECISION BRIEF\s*\n?/i, '')
  .trimStart()
```

### 7f — Decision block: line-by-line (no pre-calc box)

Old: pre-calculated `decBoxH = lines.length * lineHeight + 22`, drew rect first, then text. If decision was long, box overflowed page.

New: renders line-by-line with per-line background rect + gold left accent bar drawn after all lines are placed.

### 7g — Auto-generate decision_brief if missing

In the GET handler, before `buildPdf`:

1. Check if any `decision_brief` assistant messages exist in DB
2. If not → collect all persona messages → call `createCompletion(DECISION_BRIEF prompt + council content)`
3. Save result to `messages` table → appears on record page too
4. If generation fails → PDF renders without brief section (graceful fallback)

### 7h — PDF structure

```
Page 1:  Cover (QUORUM wordmark + date + session + THE DECISION)
Page 2+: DECISION BRIEF (always new page, dark green header band)
Page N:  APPENDIX divider (centred, blank dark page)
Page N+: Council Synthesis
Pages:   6 advisor personas (one per page)
Final:   Closing disclaimer line
```

---

## PERSONA HEADER FIX

Persona header now guarded:
```typescript
if (Y + 120 > PH - BOTTOM_MARGIN) {
  doc.addPage(); fillPageDark(); page++; Y = ML; drawFooter()
}
```

Gold rule drawn **after** `Y += hH + 6` — never overlaps header band.

---

## DO NOT REDEBATE

| Decision | Reason |
|---|---|
| Challenge button in header | Cognitive moment is during reading, not after scrolling |
| Brief always on its own page | Visual weight of a premium artifact; matches target design |
| Dark theme for PDF | Matches UI; client explicitly confirmed this is the target |
| `ensure()` → `addPage()` for brief | `ensure(52)` was always wrong for a section that must be its own page |
| `splitTextToSize` after `setFont` | jsPDF uses active font metrics — this is load-bearing, don't remove |
| Reanalyze = new session always | `/session/[id]` re-opens OLD session; ReanalyzeDrawer creates NEW |
| RecordExport removed from record page | One export path only: "Get Brief" (paid) |

---

## SPRINT STATUS UPDATE

| Sprint | Status |
|---|---|
| Sprint 1–6 | ✅ Complete |
| Sprint 7 (Mirror) | ✅ Complete |
| Sprint 8 (Decision Brief PDF) | ✅ Complete — v3 (dark theme, markdown, forced page) |
| Sprint 9 (Contradiction Detector) | ✅ Complete |
| Sprint 10a (Website) | ✅ Complete |
| Sprint 10b (Session Requests) | ✅ Complete |
| Sprint 10c (GTM) | 🔄 In progress — playbook built, outreach starting |
| Sprint 11 (Outcome Nudge Cron) | ⏳ Pending stage gate: 1 paid session + 1 returning user |

---

## STAGE GATE (before Sprint 11)

- [ ] ≥1 live session at ₹25K completed and paid
- [ ] ≥1 user who has run ≥2 sessions

Both required before Sprint 11 begins.

---

## KEY OPERATIONAL REMINDERS

- `AI_PROVIDER` env var = single switch for DeepSeek ↔ Claude. Never branch in code.
- All model calls via `lib/ai-client.ts` — never instantiate SDKs directly
- Migration order: schema → sprint1 → sprint2 → sprint3 → sprint4 → sprint4b → sprint5 → sprint6 → sprint10b
- Supabase: Refresh Token Rotation ON, JWT 30 days, Site URL = Railway production URL
- `sprint10b_session_requests.sql` must be run before website session modal works
- `BRIEF_ACCESS_TOKEN` env var gates "Get Brief" on the record page
- App URL: `https://app.quorumvault.xyz` — update `NEXT_PUBLIC_APP_URL` on Railway if domain changes
- Raw bias scores never user-facing pre-Mirror
- Pushback text persisted to DB as first-class message event


*End of Handover Doc v10 — update after Sprint 10c*

