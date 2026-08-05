# QUORUM — Pass 4: Friction Audit + Sprint Plan  
## Revised: June 2026 · Incorporates theme, language & Mirror audit

---

## PASS 4: Friction & Cognitive Load

### The Input Budget Reality Check

A fully engaged Council session currently asks for these discrete user actions:

| Stage | Action | Type | Skippable? |
|-------|---------|------|------------|
| Home | Write decision | Text (required) | No |
| Home | Register mode | 1 button | No (defaults to Challenge) |
| Home | Confidence slider | 1 drag | No (defaults to 5) |
| Home | Add context | Text (optional) | Yes |
| Examiner | E0 emotional question | Textarea | Yes (blank = skip) |
| Examiner | S0 or rule question | Textarea | Yes |
| Examiner | C0 intent question | Textarea | Yes |
| Examiner | Submit | Button | No |
| Personas | Challenge one advisor | Textarea + button | Yes |
| Post-synthesis | ValidationCard confirm/correct | 1–2 taps + optional text | Yes |
| Post-synthesis | DecisionStateCard leaning | Textarea | Yes |
| Post-synthesis | DecisionStateCard switch_condition | Textarea | Yes |
| Post-synthesis | DecisionStateCard review_date | Date picker | Yes |

**13 distinct input moments.** The Examiner is already capped at 3 questions (E0 + S0-or-rule + C0). The issue is how the *post-synthesis* inputs feel — they appear in rapid sequence as forms-after-analysis rather than natural extensions of the conversation. The ratio should feel like: Quorum speaks for 10 minutes, you respond for 30 seconds.

---

### What Gets CUT from the Audit

**Item 17 (Pre-Council lean capture)** — REMOVED.  
The confidence slider on the home page already records pre-state. A second lean capture between Examiner submit and persona streaming is friction at the worst moment. The delta is already covered by: confidence slider (pre-session) + post-synthesis 3-tap read (Sprint 2) + eventual outcome logging.

---

### What Gets SIMPLIFIED

**Post-synthesis re-rate (Item 19) — 3 taps, not a slider.**  
A re-rate slider with labels repeats the home page slider UX and feels like form completion. Replace with 3 muted buttons embedded in the synthesis footer **alongside** (not replacing) the existing Mirror nudge — placed *above* the Mirror line:  
`After reading the Council: [ Clearer ] [ No change ] [ More conflicted ]`  
One tap. Zero friction. Mirror link and "This decision has been added to your Mirror profile." copy stay exactly as-is below.

**DecisionStateCard — one required field, two optional collapsed.**  
Currently 3 fields presented equally (leaning, switch_condition, review_date). Review date is the only one that drives the retention mechanic. Simplify: primary is the date picker with prompt copy *"When do you want to revisit this?"*. Secondary is one combined optional field: *"Where are you leaning right now, and what would change your mind?"* — clubs leaning + switch_condition. Remove the intermediate 'prompt' state and go directly to the compact form.

**Examiner UX — stepper, not form.**  
Already capped at 3 questions. The issue is presentation: 3 textareas at once feels like a survey. A conversational stepper (one question at a time, fading in after the previous is answered or skipped) makes 3 questions feel like a 90-second check-in. Same backend, same submit logic, only the render layer changes.

---

### Revised Input Budget (Post All 3 Sprints)

| Stage | Action | Change |
|-------|---------|--------|
| Home | Decision + register mode + slider | Unchanged |
| Examiner | 3 questions (stepper) | Form → conversational dialogue |
| Synthesis footer | 3-tap post-synthesis read | NEW (above existing Mirror link) |
| ValidationCard | 1–2 taps | Unchanged |
| DecisionStateCard | 1-click date + optional combined lean | SIMPLIFIED (3 fields → 1 required) |

**Target: 9 discrete actions, 3 of which require meaningful input. Product speaks 95% of the time.**

---

## PRE-SPRINT: Existing Bugs to Fix First

These are not sprint items — they are bugs present in the current build that will affect new components if not fixed.

**Bug 1 — `border-subtle` missing from globals.css**  
`BiasNoteCard` uses `var(--border-subtle)` but this variable does not exist in either theme block. It falls through to `undefined` and renders as no border. Add to both theme blocks:  
- Dark: `--border-subtle: rgba(255,255,255,0.06)`  
- Light: `--border-subtle: rgba(0,0,0,0.07)`

**Bug 2 — `PersonaPanel` ACCENT_COLORS duplicates CSS vars without tracking them**  
The JS object `ACCENT_COLORS` in PersonaPanel hardcodes the same hex values as the CSS vars `--accent-contrarian`, `--accent-risk`, etc. in globals.css. If the CSS vars are ever updated for light-mode or rebranding, PersonaPanel won't track. Low visual priority now (colors work in both themes at current values) but a maintenance risk. Flag for future refactor: PersonaPanel should read from CSS vars via `getComputedStyle` or a shared constants file.

**Bug 3 — `rgba(201,168,76,...)` hardcoded throughout SynthesisCard and PersonaPanel**  
These use the dark-mode gold value (`201,168,76`). In light mode, `--gold` is `#c08c18` (RGB: `192,140,24`). The rgba values don't automatically switch. Visual impact is minor (gold tint is still gold-ish) but purists will notice the inconsistency. Deferred to post-Sprint 3 cleanup: replace all `rgba(201,168,76,...)` with compound expressions using `var(--gold-glow)` (already defined correctly for both themes).

---

## SPRINT 1: "Council Presence"
**Theme:** Make the Council feel like a room, not a loading screen.  
**Inputs added:** 0 new. No schema changes.  
**Duration estimate:** 1 week  

---

### S1-01 — OntologyRevealCard (Decision X-Ray)

**What the user sees:**  
After their submission is processed and before any advisor begins speaking, a card appears for ~5 seconds:

> *"The Council is reading this as:*  
> **High stakes · Difficult to reverse · Self-created urgency**"

Then it collapses and the first advisor begins.

**Why it matters:** First thing that proves Quorum isn't ChatGPT. It read the *structure* of the decision, not just the text. No other AI product does this on session 1.

**Implementation:**  
`ontologyReady` fires when the structural match response returns. Parse the top 3 dimension names from `data.ontology_vector` (fields with highest scores > 0.6). Map to plain-English labels (see Language Notes below). Render as a new `OntologyRevealCard` component. Auto-dismiss via a 5-second timer — the dismiss IS the `canShowCeremony` flag flip for S2-07. Add a timeout fallback: if `ontologyReady` hasn't fired within 8 seconds of examiner submit, skip the card and proceed.

**Language note for dimension labels:**  
Ontology dimension keys must be translated to plain English for display. Add a `DIMENSION_LABELS` map:

| Dimension key | User-facing label |
|--------------|------------------|
| `reversibility` | Difficult to reverse |
| `emotional_intensity` | Emotionally charged |
| `identity_alignment` | About who you are |
| `time_pressure` | Time-sensitive |
| `information_completeness` | Missing key information |
| `stakeholder_complexity` | Many people involved |
| `financial_stakes` | High financial stakes |
| `regret_asymmetry` | Asymmetric regret risk |
| `uncertainty_level` | High uncertainty |
| `authority_scope` | High authority required |

**Theme rules:**  
- `background: var(--bg-card)`, `border: 1px solid var(--border-mid)`  
- Dimension labels: `color: var(--gold)`, `font-weight: 600`  
- Label chips: `background: var(--gold-glow)`, `border: 1px solid var(--gold-dim)` — `--gold-dim` IS theme-aware  
- Card fades out with `opacity: 0, transform: translateY(-8px)` over 300ms

**Files:** `components/OntologyRevealCard.tsx` (new, ~55 lines), `SessionView.tsx` (render after `ontologyReady`, before first persona canStream)

---

### S1-02 — Sequential Persona Streaming

**What the user sees:**  
The top-ranked advisor (by relevance) begins reading first. When it completes, the next begins. Users follow the council as a sequence of voices, not a simultaneous loading race.

**Implementation detail — completion-based, not time-based:**  
Do NOT use fixed delays (`setTimeout` at 3-second intervals). This breaks down when personas are fast (cold cache) or slow (Railway cold start). Instead: when persona at index N transitions to `panelState === 'done'`, fire `canStream` for index N+1. This ensures each voice is heard before the next begins.

Pass `canStream` as a derived prop: `canStream={examinerSubmitted && streamUnlockedUpTo >= personaIndex}`. `streamUnlockedUpTo` starts at 0, increments when each persona's `onComplete` callback fires.

**TTS interaction:** If the user starts TTS on a persona card while the next card begins streaming, there's visual noise. The existing `speakingPersonaId` in `SonioxTTSContext` handles mutual exclusion for playback, but the streaming text appearing may distract. No code change needed — the staggered start naturally reduces simultaneous visual activity.

**Files:** `SessionView.tsx` (~30 lines: add `streamUnlockedUpTo` state, pass `onComplete` callback to each PersonaPanel, increment on persona done)

---

### S1-03 — Synthesis `<verdict>` + `<tension>` Tags

**What the user sees:**  
The synthesis body now has visible hierarchy:

- A **verdict block** at the top (display font, slightly larger, gold left-border): the synthesis's 1–2 sentence conclusion before its reasoning
- A **tension callout** somewhere in the body (gold-bordered inline box): the sharpest disagreement between advisors that synthesis is resolving
- Everything else streams as prose below

**Implementation:**  
In the synthesis system prompt (in `lib/personas.ts`), add to the output instructions:

> *Wrap your opening 1–2 sentence verdict in `<verdict>` tags. Wrap the single sharpest tension you are resolving in `<tension>` tags. Both must appear exactly once. Everything else is prose.*

In `SynthesisCard`, as text streams in, use a simple regex to extract and remove these tags from the displayed body, rendering them into dedicated styled slots above the prose.

**Language note:** The synthesis prompt should instruct: write the verdict as a single clear sentence that a founder could read in 5 seconds and know where the council landed — not an academic summary.

**Theme rules:**  
- Verdict block: `border-left: 3px solid var(--gold)`, `padding: 10px 14px`, `background: var(--gold-glow)`, `color: var(--text-1)`  
- Tension callout: `border: 1px solid var(--gold)`, `border-radius: 8px`, `padding: 10px 14px`, `background: var(--bg-inset)`, `color: var(--text-2)`  
- Both survive light and dark — `--gold-glow` and `--bg-inset` are theme-aware

**Files:** `lib/personas.ts` (synthesis prompt section, +8 lines), `SynthesisCard.tsx` (~40 lines: extractor function + 2 render blocks)

---

### S1-04 — 'right' Mode in Reanalyze Drawer

**What the user sees:**  
The Reanalyze drawer gains a third mode button: "Tell me what's actually right here" — matching the home page exactly (purple border, ⚖ icon, same copy).

**Implementation:** Add the third `sv-mode-btn` to the Reanalyze drawer section in `SessionView.tsx`. In `handleReanalyze`, when `reanalMode === 'right'`, pass `framing_intent: 'right'` alongside `register_mode: 'analytical'` in the request body.

**Files:** `SessionView.tsx` (Reanalyze drawer, ~18 lines)

---

### S1-05 — Decision Profile Strip

**What the user sees:**  
Below the decision text in the hero card, a compact one-line metadata row:

> *Commitment decision · Irreversible · Challenging my thinking*

Available from session props — no API call.

**Language note:** Use human-readable labels, not internal enum values:
- `decision_type_primary`: map through a `DECISION_TYPE_LABELS` shared constant  
- `stakes_reversibility`: "Reversible" / "Difficult to reverse" / "Irreversible"  
- `framing_intent`: "Challenging my thinking" / "Getting clarity" / "Finding the right answer"

Render only when at least 2 of these 3 are non-null. Don't show a partial strip with one item — looks unfinished.

**Theme rules:** `color: var(--text-4)`, `font-size: 11px`, separator dots `·` in `var(--text-4)`. Invisible in light mode if `--text-4` is too dim on cream — check: `--text-4: #5e789e` on `#ffffff` is contrast ratio ~4.2:1. Acceptable.

**Files:** `lib/session-labels.ts` (new shared label maps, ~30 lines), `SessionView.tsx` (sv-hero section, ~20 lines)

---

### S1-06 — Council Complete Timestamp Footer

**What the user sees:**  
When synthesis completes, a single muted line appears and stays above the synthesis card:

> *Council complete · Commitment decision · 6 advisors · 11:47 PM*

The CouncilStatusBar still unmounts as before. This is a permanent session timestamp — it doesn't disappear.

**Language:** Time in IST (already the system default). Decision type from `decision_type_primary` via `DECISION_TYPE_LABELS` (from S1-05 shared file).

**Theme rules:** `color: var(--text-4)`, `font-size: 11px`, `letter-spacing: 0.04em`. No background, no border — just a muted line. Works identically in light and dark.

**Files:** `components/SessionCompleteBadge.tsx` (new, ~25 lines), `SessionView.tsx` (render when `synthesisDone`, ~5 lines)

---

### S1-07 — Structural Echo Banner on Pattern Analyst

**What the user sees:**  
When structural retrieval fires (`threshold_met === true`), a passive one-line banner appears above the Pattern Analyst card only:

> *"Pattern Analyst is drawing on a structurally similar decision you brought in March 2025."*

No button. No CTA. Proof the memory is working without exposing any prior decision text.

**Language:** Keep it factual and specific. Use relative month/year (already available in structural match response if `best_match_date` is returned — add to response if not).

**Theme rules:** `background: rgba(46,138,88,0.08)` → switch to `var(--success-bg)` (theme-aware, already defined for both themes). `border: 1px solid var(--success-border)`. `color: var(--success-text)`. These three vars are already correctly defined in both theme blocks.

**Files:** `SessionView.tsx` (pass `structuralContextActive` bool + `matchDate` string to PersonaPanel for pattern_analyst), `PersonaPanel.tsx` (~15 lines: render banner in card header when prop is set)

---

### S1-08 — StyleCueRef Race Condition Fix

**What:** Convert `styleCue` from a ref to a useState. Add `styleCueReady` boolean state. Gate `computePersonaOrder` on both `ontologyReady && styleCueReady`. Add a 2-second timeout: if `styleCueReady` hasn't fired by then, compute order without style cue (acceptable fallback — style cue is a minor weighting factor).

**Files:** `SessionView.tsx` (~20 lines refactor of the fetchStyleCue and structural match effects)

---

## SPRINT 2: "Memory Surfaced"
**Theme:** Make the system's longitudinal intelligence visible. One new micro-input that surfaces alongside the existing Mirror upsell.  
**Inputs added:** 1 tap (post-synthesis read, above Mirror link)  
**Duration estimate:** 1 week  

---

### S2-01 — Post-Synthesis 3-Tap Read

**What the user sees:**  
The synthesis footer (after `state === 'done'`) gains a new row above the existing Mirror line:

```
After reading the Council:  [ Clearer ]  [ No change ]  [ More conflicted ]
— — — — — — — — — — — — — — — — — — — — — — — — — — — —
This decision has been added to your Mirror profile.     View Mirror →
```

On tap: buttons are replaced by *"Noted."* in `var(--text-4)`. The Mirror line below is untouched.

**What's stored:** `post_council_read` enum (`clearer | unchanged | conflicted`) on the sessions table. Used by Mirror for calibration delta. The gap between pre-session confidence score and post-synthesis read is the first honest signal of Council impact.

**Language:** "After reading the Council:" is plain and direct. Button labels are one word each. No explanation needed.

**Theme rules:**  
- Buttons: `border: 1px solid var(--border-mid)`, `background: var(--bg-inset)`, `color: var(--text-3)`, `border-radius: 6px`  
- On hover: `border-color: var(--gold)`, `color: var(--gold)` — works in both themes  
- Separator line: `border-top: 1px solid var(--border-dim)` between the 3-tap row and the Mirror line  

**Mirror preservation:** The Mirror nudge copy and link below are unchanged.

**Files:** `SynthesisCard.tsx` (add row above Mirror footer, ~25 lines), `app/api/session/[id]/post-council-read/route.ts` (new, ~30 lines), schema: `post_council_read` column on sessions

---

### S2-02 — Council Weighting Strip

**What the user sees:**  
After synthesis completes, a compact `CouncilWeightingStrip` component renders below the SynthesisCard. Shows all 6 advisors with subtle bar indicators — no numbers, just relative weight bars. Muted label: *"How the Council weighted this decision"*

On hover per advisor: a tooltip — *"Risk Architect: elevated — irreversibility and time pressure were dominant."* Plain English, no rule IDs surfaced.

**Language:** Tooltip copy should say what the *user's decision characteristics* triggered, not internal rule codes. "Irreversibility and time pressure were dominant" not "R4 + R5 fired."

**Data source:** Add `relevance_map` (serialised from `buildRelevanceBlock`) to the `/api/structural-match` response. It's already computed — just needs to be returned alongside `ontology_ready` and `threshold_met`.

**Theme rules:**  
- Strip background: `var(--bg-card)`, `border: 1px solid var(--border-dim)`  
- Bars: filled = `var(--gold)`, unfilled = `var(--border-mid)`. Both are theme-aware.  
- Advisor labels: `var(--text-3)`, `font-size: 11px`

**Files:** `components/CouncilWeightingStrip.tsx` (new, ~65 lines), `app/api/structural-match/route.ts` (add `relevance_map` to response), `SessionView.tsx` (render after `synthesisDone`, pass `relevance_map`)

---

### S2-03 — Examiner Stepper UX

**What the user sees:**  
The Examiner panel shows one question at a time. The first question (E0) appears alone, with a distinct visual register:

**Step 0 (intro, auto-advances after 1s):**  
> *"Before the Council convenes — three quick questions. Your answers shape how the advisors approach your decision."*

**Step 1 (E0 — Reflection):**  
Distinct card-within-card treatment. Gold top border. Label: *REFLECTION* (already exists). Placeholder specific to emotional register.

**Step 2 (S0 or rule question):**  
Standard treatment. Placeholder specific to the question type.

**Step 3 (C0 — Intent):**  
Standard treatment. Placeholder: *e.g. "I want to understand whether the upside is real, not just get permission to proceed."*

**Final screen:**  
`[Submit to the Council →]` button. Below it in `var(--text-4)`: *"X of 3 answered · Y skipped — skipped answers are fine."*

The questions array, submit logic, and all backend logic are unchanged. Only the render layer changes.

**Language note for Step 0:** "Three quick questions" is better than "The Examiner has questions for you." It sets expectation and implies brevity. Do not use the word "Examiner" in the intro — it sounds clinical. Save that label for the card header.

**Theme rules:**  
- Step cards: `background: var(--bg-card)`, `border: 1px solid var(--border-dim)`  
- E0 step: `border-top: 2px solid var(--gold)`, `background: var(--bg-card-alt)`  
- Both are theme-aware. `var(--bg-card-alt)` in light is `#f8f6f1` — subtle warmth on cream, correct.  
- Progress dots: filled = `var(--gold)`, unfilled = `var(--border-mid)`

**Files:** `ExaminerPanel.tsx` (~85 lines refactor of the body render section only)

---

### S2-04 — E0 Visual Isolation (within Stepper)

Covered inside S2-03. E0's step has:
- `border-top: 2px solid var(--gold)` top accent
- Small label above textarea: *"This isn't about the decision. It's about what you haven't said yet."* — in `var(--text-4)`, `font-size: 11px`, `font-style: italic`
- No structural difference — purely CSS + copy within the stepper step

---

### S2-05 — Validation Correction "Applied" Signal

**What the user sees:**  
If the prior session had a `validation_correction` (user corrected Quorum's archetype/emotion read), a single passive line appears at the top of the SynthesisCard header, before the streaming begins:

> *"Quorum adjusted this session's read based on your correction from last time."*

No button, no modal, no detail. Proof that corrections compound.

**When:** Only if `validation_correction` is non-null on the session record. Fetch `validation_correction` from the session data in the server component (add to select) and pass as a prop to `SessionView` → `SynthesisCard`.

**Language:** "adjusted this session's read" not "recalibrated its validation logic" — plain and specific.

**Theme rules:** `color: var(--success-text)`, `font-size: 11px`. `var(--success-text)` is defined as `#4ade80` (dark) and `#1a7a3a` (light). Both readable.

**Files:** `app/session/[id]/page.tsx` (+1 field in select), `SessionView.tsx` (pass prop), `SynthesisCard.tsx` (~8 lines in header)

---

### S2-06 — EarlyEchoCard in SessionView

Import and render `EarlyEchoCard` in `SessionView` after `synthesisDone && sessionCount >= 2 && sessionCount <= 5`. The component handles its own data fetch and display conditions. One import, one JSX line with the session ID prop.

**Files:** `SessionView.tsx` (~5 lines)

---

### S2-07 — First-Session Opening Ceremony

**What the user sees:**  
Session 1 only. After the Examiner is submitted and the OntologyRevealCard (S1-01) collapses, an `OpeningCeremonyCard` appears for exactly 3 seconds:

> *"Six advisors are reading your decision.*  
> *They don't know what each other is saying."*

Then it fades out. The first advisor begins streaming as the card disappears. No button. No close. No interaction required.

**Language:** Two short sentences. The second line is the differentiating idea — the advisors are genuinely independent. Don't add more context. Don't name the advisors here. That comes when the cards appear.

**Theme rules:**  
- `background: var(--bg-card)`, `border: 1px solid var(--border-mid)`, `text-align: center`  
- Six dots (decorative): `background: var(--gold)`, `border-radius: 50%`, 8px diameter, spaced with `gap: 8px`  
- Title: `color: var(--text-1)`, `font-family: var(--font-display)`, `font-size: 20px`  
- Subtitle: `color: var(--text-3)`, `font-size: 13px`

**Files:** `components/OpeningCeremonyCard.tsx` (new, ~40 lines), `SessionView.tsx` (~8 lines, gate on `totalSessionCount === 1`)

---

### S2-08 — Reanalyze Drawer: Prior Council Summary

**What the user sees:**  
When the Reanalyze drawer opens for a session with a `parent_session_id`, a collapsible section at the top:

*▸ What the last Council found* (collapsed by default)  

On expand: the parent synthesis excerpt (first ~200 chars, already in continuity context). Plain prose, no formatting inside the collapsible.

**Language:** Label is "What the last Council found" — not "Prior session synthesis" or "Continuity context." Human, not technical.

**Files:** `app/session/[id]/page.tsx` (pass parent synthesis excerpt), `SessionView.tsx` (drawer, ~25 lines collapsible section)

---

## SPRINT 3: "Calibration Close"
**Theme:** Rationalize existing inputs (net reduction), close the two open loops. The product's session end feels deliberate, not like a trailing form.  
**Inputs changed:** Net –2 required fields. Sequential streaming completes.  
**Duration estimate:** 1 week  

---

### S3-01 — Tension Interstitial

**What the user sees:**  
After all 6 personas complete (`allPersonasDone`) and before synthesis begins (currently instant), a 4-second card appears:

> *"The Council is divided.*  
> *Four advisors lean toward waiting. Two toward moving forward.*  
> *The synthesis is weighing the tension."*

Then the card fades and synthesis header appears, beginning to stream.

**Implementation:**  
A new endpoint `/api/session/[id]/council-lean` receives the 6 `positionText` values (short, extracted strings) and returns a tally in one batch LLM call: each position classified as `PROCEED | CAUTION | RECONSIDER`. This call fires when the 6th persona completes (same trigger as synthesis). Synthesis is delayed by the max of: (a) 4 seconds flat, or (b) the time for this endpoint to return. If endpoint doesn't return in 3 seconds, show interstitial with "The Council is weighing six perspectives" (no split shown) and proceed.

**Language:** "Four advisors lean toward waiting" not "4/6 classified CAUTION." Plain English tallies only. Avoid fractions or percentages.

**Theme rules:**  
- `background: var(--bg-card)`, `border: 1px solid var(--border-mid)`, `text-align: center`  
- Split numbers: `color: var(--gold)`, `font-weight: 700`, `font-size: 28px`  
- Supporting text: `color: var(--text-3)`, `font-size: 13px`  
- Both survive light and dark — all CSS var based.

**Files:** `app/api/session/[id]/council-lean/route.ts` (new, ~40 lines), `components/TensionInterstitial.tsx` (new, ~40 lines), `SessionView.tsx` (~15 lines render logic)

---

### S3-02 — DecisionStateCard Rationalization

**What the user sees:**

**Before:** Prompt card → 3-field form (leaning / switch_condition / review_date)  
**After:** Direct compact card with:
- Primary: *"When do you want to revisit this?"* + 4 date quick-picks: `+1 week · +2 weeks · +1 month · +3 months`  
- Optional secondary (collapsed, revealed by *"Add where you're leaning →"* link): one combined textarea — *"Where are you leaning, and what would change your mind?"*

The prompt stage ('prompt' → 'form' state machine step) is removed. The card opens directly to the date picker + optional lean field. Save requires only review_date (or leans if no date — same as current minimum constraint: at least one).

**Language:** Primary label: *"When do you want to revisit this?"* — positions it as the user's action (setting a reminder), not Quorum's data collection. Optional field: *"Where are you leaning, and what would change your mind?"* — combines the two previous fields into one natural question. Placeholder: *e.g. "Leaning toward waiting — I'd move forward if the audit comes back clean."*

**Theme rules:**  
- Quick-pick date buttons: `border: 1px solid var(--border-mid)`, `background: var(--bg-inset)`, `color: var(--text-2)`. On selected: `border-color: var(--gold)`, `background: var(--gold-glow)`, `color: var(--gold)` — all theme-aware.  
- "Add where you're leaning →" link: `color: var(--text-4)`, `font-size: 12px` — muted, not a CTA  
- Textarea: `background: var(--bg-inset)`, `border: 1px solid var(--border-dim)` — same as Examiner fields

**Files:** `DecisionStateCard.tsx` (~65 lines refactor), `app/api/session/commitment/route.ts` (minor: accept `combined_lean` field or split into existing fields server-side)

---

### S3-03 — Persona Pull-Quote Previews

**What the user sees:**  
When each persona card transitions to `done`, a one-sentence pull-quote appears in the card header below the lens caption:

> *"The real cost isn't the investment — it's the 18 months of focus you can't get back."*

Users can scan 6 complete cards in 20 seconds and prioritize which to read first.

**Implementation:** After `positionText` is set in PersonaPanel state (already happens on card completion), extract the first sentence: `positionText.split(/[.!?]/)[0].trim()` + punctuation. If result is > 100 chars, truncate to 85 chars + ellipsis. No AI call.

**Language:** This is extracted directly from the AI output — no additional language work needed. The key is the font treatment: it should feel like a quote, not a label.

**Theme rules:**  
- `font-size: 12px`, `font-style: italic`, `color: var(--text-3)`, `line-height: 1.45`  
- In light mode `var(--text-3)` is `#364e70` on `#ffffff` — contrast ~6.5:1. Fine.

**Files:** `PersonaPanel.tsx` (~20 lines: extract sentence from positionText, render in header)

---

### S3-04 — Structural Memory Badge on All 5 Eligible Personas

**What the user sees:**  
S1-07 added a prominent banner to Pattern Analyst. This extends a quieter version to the other 4 personas with structural context (Contrarian, Risk Architect, Stakeholder Mirror, Elder):

A small `●` dot in `var(--success-text)` next to each persona's lens caption with `title="Drawing on pattern memory"` tooltip. One dot, no text, no banner. Quiet proof that the memory is working across the full council.

**Files:** `PersonaPanel.tsx` (dot indicator when `structuralContextActive && persona.key !== 'pattern_analyst'`, ~10 lines), `SessionView.tsx` (pass `structuralContextActive` to all 5 personas, not just pattern_analyst)

---

## Mirror References: Preservation Map

All of the following must remain exactly as-is. They are upsell hooks and must not be removed, rewritten, or repositioned without explicit decision:

| Location | Copy | Notes |
|----------|------|-------|
| `SynthesisCard` footer | *"This decision has been added to your Mirror profile. View Mirror →"* | S2-01 adds a row above this, not a replacement |
| `BiasNoteCard` comment | *"longitudinal 'confirmed pattern' claim (that's Mirror's job)"* | Code comment only, not user-facing |
| `EarlyEchoCard` comment | *"Mirror unlock"* in copy logic | Code comment, not user-facing |
| `MemoryEngineStatus` | Session count bars toward Mirror unlock | Home page, not Council — unchanged |
| `SessionView` | `mirrorActive={false}` prop to PersonaPanel | Correct gating — Mirror reanalysis blocked for free tier |

The only Mirror reference being changed: "View Mirror →" is not removed — the 3-tap read is placed above it as a new row.

---

## Language Audit: Flags & Rewrites

These are existing strings that need rewriting to meet plain-language standard:

| Location | Current | Proposed |
|----------|---------|---------|
| `CouncilStatusBar` | *"Synthesising across six analytical frames"* | *"Writing the Council's conclusion"* |
| `CouncilStatusBar` | *"Reading the structural shape of your decision"* | *"Understanding your decision's structure"* |
| `ExaminerPanel` RULE_HINT R3 | *"Without key information, analysis would be speculative. Your answer focuses the Council on what actually needs resolving."* | *"The Council needs more context before it can give you a useful answer."* |
| `ExaminerPanel` RULE_HINT R10 | *"The decision involves enough moving parts that clarity on structure helps before analysis begins."* | *"There are several moving parts here — your answer helps the Council focus."* |
| `ExaminerPanel` placeholder | *"Your answer (or leave blank to skip this question)…"* | Replaced per-question in S2-03 stepper. E0: *"Take a moment — there's no wrong answer."* C0: *"What are you actually hoping to walk away knowing?"* |
| `AttentionZone` | *"POTENTIAL ATTENTION RISK"* (all caps label) | *"Something to be aware of"* |

Leave unchanged (already plain English, correct register):
- All EarlyEchoCard copy
- RULE_HINTS R1, R2, R4, R5, R6, R7, R8, R9, R12
- E0 RULE_HINT
- C0 RULE_HINT (internal — only shown as a label, not to user)
- ValidationCard copy
- DecisionStateCard placeholder examples

---

## Theme Compliance: New Components Checklist

All new components in this sprint plan must:
- Use only CSS variables — no hardcoded hex or rgba() values
- Be tested in both `data-theme="dark"` and `data-theme="light"` before merge
- Use the following variable pairs for interactive elements:

| State | Background | Border | Text |
|-------|-----------|--------|------|
| Default | `var(--bg-inset)` | `var(--border-dim)` | `var(--text-2)` |
| Hover | `var(--bg-card-alt)` | `var(--border-mid)` | `var(--text-1)` |
| Active/selected | `var(--gold-glow)` | `var(--gold)` | `var(--gold)` |
| Muted/dim | `var(--bg-card)` | `var(--border-dim)` | `var(--text-4)` |
| Success signal | `var(--success-bg)` | `var(--success-border)` | `var(--success-text)` |

One exception: `var(--gold-dim)` behaves differently in light mode (`#c8a030` on `#ffffff` is bright gold, not dim). Prefer `var(--border-dim)` for muted gold borders in new components.

---

## Additional Observations (No Sprint Assigned Yet)

**O1 — CouncilStatusBar "Examiner" phase copy is the longest sentence on screen**  
*"The Examiner has questions for you — the Council will convene once you've answered"* is 14 words. It's the most text the status bar shows. In the new stepper UX (S2-03), this message becomes less necessary because the examiner card is self-explanatory. Consider shortening to: *"Answer a few questions, then the Council convenes"* — same information, half the words.

**O2 — Post-synthesis: BiasNoteCard and ValidationCard appear in rapid sequence**  
Both fire after `synthesisDone`. Both are passive/confirmatory interactions. A user who reads synthesis, then immediately sees a bias flag, then immediately sees an archetype confirmation, then 6 persona cards, then DecisionStateCard — experiences 5 distinct "things" arriving in sequence. Post-Sprint 3, the sequence is: Synthesis → RecordReceipt → ContradictionBanner → BiasNoteCard → ValidationCard → personas → DecisionStateCard. No change recommended yet — but the timing should be staggered (300ms between each) so they don't all appear simultaneously on scroll-load.

**O3 — The Decision Brief is the most underexposed high-value output**  
The Decision Brief generates the OBSERVATION line — a 20-word inference about *how* the person decides, not what they decided. This is Quorum's sharpest longitudinal claim. It lives at the end of the brief, behind a click, after synthesis. For Mirror-subscribed users, consider surfacing the OBSERVATION line alone (not the full brief) in the BiasNoteCard or directly below the synthesis card. This makes Mirror feel earned without requiring the user to go to `/record/[id]`.

**O4 — `mirrorActive={false}` is hardcoded in SessionView**  
The `mirrorActive` prop on PersonaPanel is always `false` — Mirror reanalysis is never shown even for paying Mirror users on the Council page. If Mirror subscribers push back on a persona, they should see the Mirror-tier reanalysis (persona-level calibration) not the free-tier pushback. This needs a gating check: fetch Mirror subscription status and pass `mirrorActive={true}` for paying users. Current state means paying Mirror users get the free experience on the Council page.

**O5 — The `sv-fade sv-fade-2` animation classes on BiasNoteCard**  
Check that these CSS animations are defined in globals.css and work in both themes (they're opacity-only, so they should). Confirm `border-subtle` is fixed (Pre-Sprint bug) before this component renders in light mode.

**O6 — `RuleRecallBanner` timing vs Examiner submit**  
The RuleRecallBanner shows a past rule match before the user submits the Examiner. If the user ignores the banner and submits without clicking "Apply rule," the rule IS still injected via `appliedRule` state — but only if they explicitly clicked Apply. The banner appearing and then silently disappearing on submit is confusing. Suggestion: when Examiner submit fires, if `appliedRule` is null but a rule banner was shown, auto-apply the rule (the user saw it — their decision not to click is a valid signal, but the rule content is still useful context). OR: after submit, dismiss the banner with an explicit animation confirming it was considered regardless.

---

## The Test (Post All 3 Sprints)

A first-time Council session should feel like this:

1. Submit decision → confidence slider → register mode (user-initiated, natural)
2. Status: *"Understanding your decision's structure"* → X-Ray card appears: 3 dimension labels, 5 seconds (no action)
3. Opening ceremony: *"Six advisors are reading your decision. They don't know what each other is saying."* (3 seconds, no action)
4. Examiner opens: intro step, then E0 (reflection), then 1 structural question, then C0 intent (90 seconds, conversational)
5. Top-ranked advisor begins speaking. Completes. Next begins. Council speaks sequentially.
6. All 6 complete. Tension interstitial: *"The Council is divided. 4 lean toward caution. 2 toward moving forward."* (4 seconds, no action)
7. Synthesis streams — verdict pull-quote first, tension callout embedded, prose below
8. Synthesis footer: *"After reading the Council: [ Clearer ] [ No change ] [ More conflicted ]"* → 1 tap. Mirror nudge below unchanged.
9. ValidationCard: *"Quorum read you as X. Does that track?"* → 1 tap
10. DecisionStateCard: *"When do you want to revisit this?"* → 1 date click. Optional: combined lean field.

**10 moments. 3 require meaningful input. The product speaks for 95% of the session.**

