# QUORUM — Handover Doc Patch: v26 → v27

Apply each CHANGE block in order. Where it says "Find / Replace", treat as exact string match in the named file.
Where it says "Append", add below the specified anchor line.

---

## CHANGE 1 — Document header

**File: top 2 lines of document**

Remove:
```
# QUORUM — Handover Document v25
### Date: May 2026 | Status: Sprint 26 complete (DeepSeek 503 retry · Persona header layer: Lens/Position/Real Cost · Pause TTS · Delete decision · Back to Council · Trade-off narrative in Synthesis)
```

Replace with:
```
# QUORUM — Handover Document v27
### Date: May 2026 | Status: Sprint 31 complete (Home flip-card · Onboarding panels · Chunks 1–5 · Pattern surfacing · Mirror paywall copy · IST timezone · localStorage auth fix · RecordReceipt · DM Sans · Mobile responsive passes)
```

---

## CHANGE 2 — Sprint table (SPRINT HISTORY section)

Append to the bottom of the sprint table:

```markdown
| **28** | Mirror UI revamp: confidence slider copy (Pre-session clarity / Foggy→Fully clear), mobile layout, "Activates when:" label, examiner quote + CoachingTip in Independence Score, section reorder (Bias Fingerprint first, Timeline last), rules card mobile, teaser polish — ✅ Deployed |
| **29** | Home page redesign: fixed navbar, persona pill strip, tips collapsible, history fade-in, .home-two-col responsive class. DM Sans variable font replaces Inter, optical sizing, .t-heading token — ✅ Deployed |
| **30** | Chunks 1–3: QUORUM flip-card home (inputRevealed crossfade, clamp mobile height, clamp gap), RecordReceipt post-synthesis, MemoryEngineStatus mirrorUnlocked + View Mirror links, Mirror paywall copy overhaul, lib/dates.ts IST timezone, localStorage auth key fix, Session type additions, sv-navbar bg-card fix, session/[id] totalSessionCount — ✅ Deployed |
| **31** | Chunks 4–5: Onboarding 3-panel card (Council/Mirror/Record, tap-to-advance, quorum_onboarded gate), PatternSurfaceCard (top pattern with narrative + decision links + actionable), RecurringConditionCard (top structural dimension observation), ContradictionBanner post-synthesis. VoiceInput manual end detection (enable_endpoint_detection: false). ExaminerPanel &apos; → Unicode fix. Background blue-tint gradient. Gold brightness pass. PatternSurfaceCard show-more + full decision text — ⚠️ Partially in codebase (see PENDING for outstanding items) |
```

---

## CHANGE 3 — CURRENT STATUS section (replace entirely)

Find:
```
## CURRENT STATUS
```
…through the next `---` divider. Replace the body with:

```markdown
## CURRENT STATUS

**Active Sprint:** Sprint 32 (not started as of this handover)
**Last completed:** Sprint 31 (partial — see PENDING)
**Stage gate:** First paying session + one returning user — not yet met

**What is live and confirmed in deployed code:**
- Home flip-card (QUORUM wordmark → decision form crossfade, clamp mobile height, clamp gap)
- Judgment Record strip (count, new-user tagline, isReturning condition)
- RecordReceipt post-synthesis (real DB count via totalSessionCount)
- MemoryEngineStatus: mirrorUnlocked prop, View Mirror → for both states
- Mirror paywall copy: no lock icons, "Activate Mirror" language, ₹9,999/year pricing
- Session page: totalSessionCount passed as server prop, duplicate notFound removed
- lib/dates.ts: all user-facing dates now IST (Asia/Kolkata)
- localStorage auth key fix: storeUserEmail() used consistently (was writing to wrong key 'user_email')
- sv-navbar: background changed from var(--bg-deep) to var(--bg-card) — now visible in dark mode
- Mirror nav back button: color var(--gold) on hover, was previously var(--text-3)
- DM Sans variable font, Sprint 28 Mirror UI revamp, Sprint 29 typography — all deployed

**Implemented in sessions but NOT YET in latest code zip:**
- Chunk 5 onboarding panels (isOnboarding, onboardPanel state, quorum_onboarded localStorage gate)
- Chunk 4a PatternSurfaceCard.tsx (new component)
- Chunk 4b ContradictionBanner.tsx (new component)
- Chunk 4c RecurringConditionCard.tsx (new component)
- ExaminerPanel.tsx: &apos; → \u2019 fix
- VoiceInput: manual end detection (enable_endpoint_detection: false in stream/route.ts)
- Background: dark mode blue tint/gradient (--bg-void still #010306)
- Gold brightness: dark mode --gold still #c9a84c (user requested brighter)
- PatternSurfaceCard improvements: show-more for decisions, full decision text (not UUID), actionable line
- RecurringConditionCard: user-friendly language, actionable line
- IST not yet applied to all date renders (only formatDate/formatDateTime helpers in lib/dates.ts — callers need to migrate)
```

---

## CHANGE 4 — Sprint log blocks (insert before ENVIRONMENT VARIABLES section)

Insert all six blocks below, in order, before `## ENVIRONMENT VARIABLES REQUIRED`.

---

### Sprint 28 block

```markdown
---

# Sprint 28 · Status: ✅ Complete
Mirror UI revamp (mobile + visual polish). Confidence slider copy redesign.

## Confidence Slider — Copy Redesign (app/page.tsx)
The slider captures epistemic clarity, not outcome prediction.

| Element | Before | After |
|---|---|---|
| Header label | HOW CONFIDENT ARE YOU IN YOUR CURRENT THINKING? | Pre-session clarity |
| Sub-text | This is your baseline… | How clearly do you understand this decision right now? The Council will test this and we track how your read compares to hindsight over time. |
| Left pole | Uncertain | Foggy |
| Right pole | Very confident | Fully clear |

## Mirror UI Revamp — 6 Items

**Item 1 — Mobile layout (app/mirror/page.tsx):** `mirror-content-pad`, `mirror-page-header`, `mirror-stats-grid` classNames; back button tap target raised to 44px; 8 new @media rules.

**Item 2 — "Activates when:" label (components/PatternTile.tsx):** `<span>` prepended inside activationSummary. 9.5px, all-caps, 60% opacity. Text byte-for-byte unchanged.

**Item 3a — Examiner quote in Independence Score (route.ts + component):** `session_id` added to select on `independence_score_log`; additional query fetches longest `examiner_responses.response_text`, caps at 180 chars, returns as `examinerQuote: string | null`. Graceful null for sessions without Examiner path.

**Item 3b — CoachingTip sub-component (components/IndependenceScore.tsx):** Band-aware, 3 actionable tips. Hidden at "Judgment compounding" (≥75). Signal names never exposed to user.

| Band | Score | Tip |
|---|---|---|
| Using Quorum as a report generator | <25 | Name one specific failure mode and one person who carries a consequence you haven't named yet |
| Frameworks starting to appear | 25–49 | Question the timeline — not whether it's real, but who set it and whether you agreed to it |
| Reasoning visibly shifting | 50–74 | Connect this decision to a past one with similar structural conditions. Name financial outcome and personal cost separately |
| Judgment compounding | ≥75 | No tip |

**Item 4 — Section reorder (app/mirror/page.tsx):** UnlockedView: Bias Fingerprint first, Decision Timeline last. TeaserView untouched (Timeline stays first as free-tier proof of value).

**Item 5 — Rules card mobile (components/DecisionRules.tsx):** `mirror-rules-card`, `mirror-rules-btn` classNames. Expand button tap target ~44px on mobile.

**Item 6 — Teaser polish (app/mirror/page.tsx):** `mirror-score-row`, `mirror-cta-card`, `mirror-cta-btn`; min-height 44px on CTA button mobile.

## Files modified in Sprint 28
`app/page.tsx` · `app/mirror/page.tsx` · `components/PatternTile.tsx` · `components/IndependenceScore.tsx` · `app/api/mirror/independence/route.ts` · `components/DecisionRules.tsx`
```

---

### Sprint 29 block

```markdown
---

# Sprint 29 · Status: ✅ Complete
Home page redesign (visual hierarchy, mobile, state-gated reveals). DM Sans typography upgrade.

## Home Page Redesign (app/page.tsx + app/globals.css)
Preserved 100%: all state logic, API calls, component imports/props, router navigation, VoiceInput, BehaviorAlerts, AuthPanel, MemoryEngineStatus, OutcomeTracker, delete flow, tab filter.

**Fixed navbar:** QUORUM wordmark + scale icon pinned `position: fixed` 52px top. "Judgment Operating System" tagline center — hidden mobile via `.nav-tagline`. ThemeToggle floats independently. Frosted glass on scroll (`.stuck` class — scrollY > 10). Frees ~100px above-fold space.

**State-gated register + slider:** Hidden (maxHeight: 0, opacity: 0) until `decision.length > 0`. Reveal: 400ms ease-out transition. Zero logic change.

**Persona grid → pill strip:** 3×2 grid → wrapping flex row of 6 pills (~44px total). `title` attribute carries hint text on hover.

**Tips → collapsible:** Toggle line in DM Mono 11px. State persisted in `localStorage` key `quorum_tips_open`. Open on first visit (no key), collapsed on return.

**History fade-in:** opacity 0 → 1 over 600ms when history loads.

**Mobile responsive:** `.home-two-col` CSS class: 2-column → 1-column below 600px. 44px min tap targets. 400px breakpoint for tighter adjustments.

## Typography Upgrade (app/layout.tsx + app/globals.css)
Inter → DM Sans variable font (wght 300–700, opsz 9..40). Same family as DM Mono — cohesive system. Optical sizing axis active. Warmer on dark backgrounds.

| Token | Before | After |
|---|---|---|
| --font-body | Inter | DM Sans |
| body line-height | 1.65 | 1.70 |
| body letter-spacing | (none) | -0.003em |
| .t-display letter-spacing | -0.01em | -0.025em |
| .t-label letter-spacing | 0.16em | 0.14em |
| .t-heading | (did not exist) | NEW — Cormorant Garamond 18–24px, weight 500 |
| .persona-response letter-spacing | 0.01em | 0.004em |

## Files modified in Sprint 29
`app/page.tsx` · `app/globals.css` · `app/layout.tsx`
```

---

### Sprint 30 block

```markdown
---

# Sprint 30 · Status: ✅ Complete
Chunks 1–3: Record frame, post-synthesis receipt, Mirror paywall copy. Bug fixes: localStorage auth key, IST timezone, sv-navbar visibility.

## Chunk 1 — Home Screen Record Frame

**QUORUM flip-card (app/page.tsx):**
- `inputRevealed` state (default: false)
- Back-face: QUORUM wordmark in Cormorant Garamond ~70px, gold rules above/below, "Add to your judgment record" CTA in gold mono — entire card is clickable
- Click → opacity+scale crossfade to front-face (decision form). CSS 3D flip avoided — unreliable across browsers with form elements; crossfade achieves identical theatre
- Card `minHeight: inputRevealed ? 0 : 'clamp(460px, 78svh, calc(100vh - 120px))'` — desktop: full viewport, mobile: 78svh (excludes browser chrome bar)
- `cardHovered` state: subtle scale(1.002) on back-face hover

**Judgment Record strip (app/page.tsx):**
- Always visible above the card (both user types)
- New user: `YOUR JUDGMENT RECORD · 0 decisions` + smaller line: "Every decision builds your private judgment OS"
- Returning user: count updates, second line absent (`!isReturning`)
- `isReturning = sessions.length > 0`
- History: capped to 5 (`HISTORY_PREVIEW = 5`), "Show N more decisions" button. Tabs: "Open" / "Logged"

**Gap between card and Memory Engine (app/page.tsx):**
- `marginTop: 'clamp(20px, 4vw, 28px)'` — 40px previously. 20px mobile, 28px desktop.

**Advisor caption (app/page.tsx):**
- "Six advisors · stress-test, surface gaps, and challenge assumptions across every decision" (above persona pills, after inputRevealed = true)

**mirrorUnlocked state (app/page.tsx):**
- `useState(false)` + fetch `/api/mirror/status` on auth — sets true if `gateState === 'unlocked'`
- Passed as `mirrorUnlocked={mirrorUnlocked}` prop to `<MemoryEngineStatus />`

## Chunk 2 — RecordReceipt (new component: components/RecordReceipt.tsx)

Renders below `<SynthesisCard />` once `synthesisDone = true` in SessionView.

Shows:
- "Decision record #N added" — N from `totalSessionCount` (real DB count from server)
- Decision type tag if `decision_type_primary` present
- Irreversibility dimension (derived from `stakes_reversibility`: high/moderate/reversible)
- No Mirror mention unless `mirrorActive = true` (always false for now — safe default)
- No charts, no bars — narrative confirmation only

**Wiring:**
- `components/SessionView.tsx`: new `totalSessionCount?: number` prop, `RecordReceipt` imported and rendered post-synthesis
- `app/session/[id]/page.tsx`: sequential query pattern — session first, then messages + `count: 'exact'` on sessions filtered by `user_id`, passes `totalSessionCount` as prop
- Duplicate `notFound()` call removed from session/[id]/page.tsx (was harmless but messy)

**lib/types.ts — Session interface additions:**
```ts
decision_type_primary?: string | null
stakes_reversibility?: string | null
```
(Fields exist in DB on `TimelineSession`, now declared on `Session` — no as-any casts needed)

## Chunk 3 — Mirror Paywall Copy (app/mirror/page.tsx)

Paywall state only. Unlocked Mirror view untouched (no changes to any module in UnlockedView).

| Before | After |
|---|---|
| Page sub-header: "Subscribe to unlock the full profile" | "building from every decision you bring" |
| Sub-label under heading | NEW: "A private operating system for your judgment" (DM Mono, 11px) |
| lockedBadge: lock icon + "Locked" | plain "building" in mono — no icon |
| TeaserTile header: lock icon present | lock icon removed |
| "Subscribe to read" | "Activate Mirror to read" |
| "Subscribe to see" | "Activate Mirror to see" |
| "Visible after subscribing" | "Visible after activating Mirror" |
| CTA header: "Subscribe to unlock" | "Activate Mirror — complete your Judgment OS" |
| Pricing | ₹9,999/year shown as leading number |
| Pre-threshold gate copy | "your Mirror preview activates" (was "unlock your Mirror preview") |

## MemoryEngineStatus — mirrorUnlocked (components/MemoryEngineStatus.tsx)

New `mirrorUnlocked?: boolean` prop (default: false).

| State | Status label |
|---|---|
| mirrorUnlocked = true | "Pattern Memory active · Mirror active" |
| mirrorReady (≥5 sessions, not unlocked) | "Pattern Memory active · Mirror ready to activate" |
| patternActive | "Pattern Memory active" |
| mirrorTeaserReady (≥3 sessions) | "Mirror preview activates" |

- "View Mirror →" link shown for both: `mirrorUnlocked` users (always) and `mirrorTeaserReady && !mirrorUnlocked` users
- "(mirrorTeaserReady && !mirrorUnlocked)" — teaser preview copy and link correctly suppressed when Mirror already active

## Bug Fixes in Sprint 30

**localStorage auth key fix (app/page.tsx):**
Root cause: `getSession()` effect wrote to `localStorage.setItem('user_email', ...)` (wrong key). App reads from `quorum_user_email` on init. Result: every new tab or "Open Quorum" from website showed unlinked state, required re-entering email. Fix: replaced with `storeUserEmail(authSession.user.email)`. Now persists to correct key on every session resolution.

**IST timezone (lib/dates.ts — new file):**
All user-facing dates must display in IST (Asia/Kolkata, UTC+5:30). Two helpers:
```ts
formatDate(iso)     → "28 May 2026"
formatDateTime(iso) → "28 May 2026, 11:14 AM"
```
Import from `@/lib/dates` instead of calling `toLocaleDateString()` directly. `app/page.tsx` already imports and uses `formatDate`. RecordExport.tsx and CalibrationSparkline.tsx already had `timeZone: 'Asia/Kolkata'` inline — migrate to helpers in future pass.

**sv-navbar background (components/SessionView.tsx):**
Changed from `var(--bg-deep)` (= #050810 in dark mode, identical to page bg) to `var(--bg-card)`. Nav strip now visually distinct in both themes.

**Mirror nav back button (app/mirror/page.tsx):**
Base color `var(--text-3)` was low-contrast in both themes. `onMouseEnter` already changes to `var(--gold)` — base now also uses gold at 0.85 opacity so the button is visible without hover.

## Files modified/created in Sprint 30
`app/page.tsx` · `components/RecordReceipt.tsx` (NEW) · `components/SessionView.tsx` · `components/MemoryEngineStatus.tsx` · `app/mirror/page.tsx` · `lib/types.ts` · `lib/dates.ts` (NEW) · `app/session/[id]/page.tsx`
```

---

### Sprint 31 block

```markdown
---

# Sprint 31 · Status: ⚠️ Partially complete (see PENDING for outstanding items)
Chunks 4–5. Onboarding panels. Pattern surfacing. Contradiction banner. Bug fixes: voice manual end, ExaminerPanel entity, background, gold brightness.

## Chunk 5 — Onboarding Panels (app/page.tsx)
**Status: ⚠️ Implemented in session, NOT yet in deployed code zip**

Three-panel sequence inside the QUORUM back-face card. Same card, same premium feel — the card has depth before the flip. New users only (`quorum_onboarded` localStorage gate).

**State:**
```ts
const [onboardPanel, setOnboardPanel] = useState(0)   // 0=Panel0, 1=Panel1, 2=QUORUM face
const isOnboarding = !localStorage.getItem('quorum_onboarded')
```
`isOnboarding` stays false for returning users (quorum_onboarded = 'true') → card renders Panel 2 (QUORUM face) directly, zero regression.

**Panel sequence:**
- Panel 0 (01 · THE COUNCIL): "Six advisors analyse every decision you bring. Each from a structurally distinct angle." Dot indicator bottom-left: filled/empty/empty. "TAP TO CONTINUE →" in gold mono.
- Panel 1 (02 · YOUR MIRROR): "Every decision is recorded. Over time, Mirror gets more accurate about you than you are about yourself." Dots: filled/filled/empty. "TAP TO CONTINUE →"
- Panel 2: QUORUM face (wordmark + gold rules + CTA) — tapping CTA triggers flip. quorum_onboarded set to 'true'.

**"Skip →" link:** top-right of card, small DM Mono. Clicking jumps directly to Panel 2 and sets quorum_onboarded = 'true'. Premium card moment is not lost on skip.

**Tap target:** entire back-face card is clickable (onClick advances panel). No separate "next" button needed.

## Chunk 4a — PatternSurfaceCard (components/PatternSurfaceCard.tsx)
**Status: ⚠️ Implemented in session, NOT yet in deployed code zip**

Reads `/api/mirror/patterns` (already built — returns `patterns[]` with rule firing frequency). Renders above Memory Engine on home page for Mirror-unlocked users with ≥5 sessions.

Renders **only** if `patterns[0]` exists and `patterns[0].rule_id` is in RULE_NARRATIVE map (R1–R10, R12). Otherwise renders nothing — no empty state card.

**Structure:**
- "PATTERN SURFACED" mono label top-left (9px, gold, wide tracking)
- Rule narrative in Cormorant Garamond ~16px: specific, structural, slightly uncomfortable (e.g. "In 4 of your 12 decisions, you brought high emotional intensity without genuine time pressure.")
- Actionable one-liner below in mono: specific behavioural prompt tied to the pattern
- Decision links: top 4 sessions that triggered the rule, showing first 60 chars of `decision_text` + date + link to `/session/[id]`
- "Show N more decisions" button when > 4 contributing sessions
- No avatar, no chart, no percentages — narrative only

**Current gap:** PatternSurfaceCard in session code shows UUID not decision text, and no actionable line — these improvements are in PENDING.

## Chunk 4c — RecurringConditionCard (components/RecurringConditionCard.tsx)
**Status: ⚠️ Implemented in session, NOT yet in deployed code zip**

Reads `top_dimensions[]` from same `/api/mirror/patterns` response (no extra fetch — 4a already triggered it). Surfaces the dimension with highest `high_count` if ≥3 decisions scored high.

Pure observation framing: "You have opened a question about [dimension label] across N decisions. It has not been resolved in any of them." No recommendation. No chart. One sentence.

**Current gap:** needs user-friendly language (not behavioral-tech terms like "emotional_intensity") and one actionable line — in PENDING.

## Chunk 4b — ContradictionBanner (components/ContradictionBanner.tsx)
**Status: ⚠️ Implemented in session, NOT yet in deployed code zip**

Renders post-synthesis in SessionView when `/api/mirror/contradictions` (GET, already built) returns a contradiction where `violationSessionId === session.id`.

Detection pipeline already runs server-side after Examiner completes — no change to existing pipeline.

**Structure:**
- Gold left border card, below RecordReceipt
- "This conflicts with a principle extracted from your record" header
- Stated principle (from previous session): italic quote
- Current action: what this session's decision implies
- Two buttons: "Flag as exception" / "Update my rule" — both call DELETE to dismiss; banner disappears
- Dismissal is session-scoped (won't refire for the same contradiction pair)

**Test note:** User confirmed contradictions exist in Mirror (3 identified: autonomy×, urgency×, process×). ContradictionBanner should fire on next synthesis session that is itself the violation session. If contradictions table has rows where `violation_session_id` matches a current or new session ID, it fires.

## Bug Fixes in Sprint 31

**ExaminerPanel &apos; fix (components/ExaminerPanel.tsx):**
**Status: ⚠️ NOT YET APPLIED in deployed code**

```
Find:
'Specific information would change this decision — the Council&apos;s read is provisional until you have it'

Replace with:
"Specific information would change this decision — the Council\u2019s read is provisional until you have it"
```
`&apos;` is not a valid HTML entity in all JSX contexts — renders as literal text in some browsers. `\u2019` is the Unicode right single quotation mark.

**Voice manual end detection (app/api/voice/stream/route.ts):**
**Status: ⚠️ NOT YET APPLIED in deployed code**

Current config: `enable_endpoint_detection: true, max_endpoint_delay_ms: 3000` — Soniox auto-stops after detecting end of speech. User requested manual-only: user explicitly taps Stop, no auto-detection.

```
File: app/api/voice/stream/route.ts

Find:
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 3000,

Replace with:
          enable_endpoint_detection: false,
```

User taps "Stop" in VoiceInput.tsx → `stop()` from useSoniox closes MediaRecorder → Soniox stream closes → `finished` event fires → transcript finalised. Manual control, no surprise auto-termination.

**Background too dark — blue tint (app/globals.css):**
**Status: ⚠️ NOT YET APPLIED in deployed code**

Current: `--bg-void: #010306` (near-pure black). User requested blue gradient or tint similar to Mirror page cards.

```
File: app/globals.css

Find (dark theme block):
  --bg-void:     #010306;

Replace with:
  --bg-void:     #030b18;
```
`#030b18` is a deep navy (near-black with visible blue undertone). Matches the existing `--bg-deep: #050810` family. Blue-tinted dark backgrounds reduce eye strain vs pure black and harmonise with the existing gold+navy palette.

**Gold brightness — dark mode (app/globals.css):**
**Status: ⚠️ NOT YET APPLIED in deployed code**

Current: `--gold: #c9a84c` (warm but reads as muted on near-black background). User requested brighter gold in dark mode.

```
File: app/globals.css

Find (dark theme block):
  --gold:        #c9a84c;
  --gold-bright: #eaca78;

Replace with:
  --gold:        #d4a832;
  --gold-bright: #f0c040;
```
`#d4a832` is ~15% brighter than `#c9a84c` while staying warm gold (not yellow). `#f0c040` for bright state (hover, active). Light theme gold values untouched.

## Files created/modified in Sprint 31
`app/page.tsx` (onboarding panels) · `components/PatternSurfaceCard.tsx` (NEW) · `components/RecurringConditionCard.tsx` (NEW) · `components/ContradictionBanner.tsx` (NEW) · `components/SessionView.tsx` (ContradictionBanner wire) · `components/ExaminerPanel.tsx` (entity fix) · `app/api/voice/stream/route.ts` (manual endpointing) · `app/globals.css` (background + gold)
```

---

### Website Strategy block

```markdown
---

## WEBSITE STRATEGY SESSION — Category Creation & Positioning
*Separate from product sprints. Full detail in QUORUM_MASTER_DOC.md.*

**Category decision (permanent — do not reopen):**
"Judgment Infrastructure" / "The Decision Operating System". Infrastructure is what operations run on — switching cost is loss of the entire accumulated judgment record.

Canonical hero eyebrow: "The judgment operating system"
Category statement: "Every business process has been systematized. Judgment is the last one."

**Website copy overhaul:** All live (quorumvault.org). Social proof section and full mobile overhaul (480px + 980px breakpoints) deployed.

**Tagline in product nav:** "Judgment Operating System" (was "Private Decision Intelligence").
```

---

## CHANGE 5 — CODEBASE MAP additions

In `app/` section, **add or update**:
```
  page.tsx             — Sprint 31 — flip-card (inputRevealed, onboardPanel, isOnboarding),
                         Judgment Record strip (count, isReturning, new-user tagline),
                         state-gated register+slider, persona pill strip, collapsible tips
                         (localStorage), history fade-in, mirrorUnlocked fetch, fixed navbar,
                         .home-two-col CSS, clamp heights, formatDate IST import
  layout.tsx           — Sprint 29 — DM Sans variable font replaces Inter
  globals.css          — Sprint 29 — DM Sans token, .home-two-col, type refinements; 
                         Sprint 31 PENDING — --bg-void blue tint, --gold brightness
  mirror/page.tsx      — Sprint 28 — Items 1+4+6 (mobile classNames, section reorder, teaser);
                         Sprint 30 — paywall copy overhaul
  session/[id]/page.tsx — Sprint 30 — sequential query (session first), totalSessionCount
                          COUNT query, duplicate notFound removed
```

In `components/` section, **add**:
```
  RecordReceipt.tsx    — Sprint 30 (NEW) — post-synthesis confirmation card; decision type,
                         irreversibility; uses totalSessionCount from server prop
  PatternSurfaceCard.tsx — Sprint 31 (NEW, ⚠️ pending deployment) — top pattern narrative,
                           decision text links, show-more, actionable line
  RecurringConditionCard.tsx — Sprint 31 (NEW, ⚠️ pending deployment) — top structural
                                dimension observation; user-friendly language, actionable
  ContradictionBanner.tsx — Sprint 31 (NEW, ⚠️ pending deployment) — post-synthesis; fires
                             when violation_session_id matches current session; dismiss via DELETE
  MemoryEngineStatus.tsx — Sprint 30 — mirrorUnlocked prop; View Mirror → for both states
  SessionView.tsx      — Sprint 30 — totalSessionCount prop, RecordReceipt render;
                         sv-navbar background: var(--bg-card);
                         Sprint 31 — ContradictionBanner wire (⚠️ pending)
  IndependenceScore.tsx — Sprint 28 — examinerQuote block, CoachingTip sub-component
  PatternTile.tsx      — Sprint 28 — "Activates when:" span prefix
  DecisionRules.tsx    — Sprint 28 — mirror-rules-card, mirror-rules-btn classNames
  ExaminerPanel.tsx    — Sprint 31 — &apos; → \u2019 (⚠️ pending)
```

In `lib/` section, **add**:
```
  dates.ts             — Sprint 30 (NEW) — formatDate() and formatDateTime() helpers,
                         all output in IST (Asia/Kolkata). Import from @/lib/dates
                         instead of inline toLocaleDateString()
  types.ts             — Sprint 30 — Session interface gains decision_type_primary and
                         stakes_reversibility (match TimelineSession fields, already in DB)
```

In `app/api/` section, **add**:
```
  voice/stream/route.ts  — Sprint 31 — enable_endpoint_detection: false (manual stop only,
                            ⚠️ pending)
  mirror/independence/route.ts — Sprint 28 — session_id in select, examinerQuote query
                                 (longest examiner_responses.response_text, cap 180 chars)
```

---

## CHANGE 6 — KEY DESIGN DECISIONS — add items 63–74

Append after the last existing item:

```markdown
63. **Confidence slider measures epistemic clarity, not outcome prediction (Sprint 28).** "Foggy → Fully clear" = how well the user understands the decision right now. Not "how sure am I this will work." The pre/post delta only calibrates if both measurements target the same construct. Do not revert to outcome-prediction language.

64. **Mirror section order: Bias Fingerprint first, Decision Timeline last (Sprint 28).** Timeline is archival record. Fingerprint is the densest analytical module — users should land on insights, not chronology. TeaserView exempt (Timeline first as free-tier proof).

65. **CoachingTip never exposes signal names (Sprint 28).** Signal names (response_depth, premortem_thinking, etc.) are internal scoring vocabulary. Tips abstract these into human behavioural language. Four bands, three tips — Judgment compounding gets none.

66. **examinerQuote selects longest response_text, not first (Sprint 28).** Multiple Examiner questions → multiple rows. Substantive answer is most likely the longest. 180-char cap. Graceful null for pre-Examiner sessions. Do not change to first-row selection.

67. **Persona pill strip not 3×2 grid (Sprint 29).** Grid was ~180px of marketing content returning users don't need. Pills are ~44px, hint on hover. Do not restore the grid — it competes with input for attention.

68. **State-gated register + slider: zero logic change (Sprint 29).** Controls reveal via CSS maxHeight/opacity when decision.length > 0. No conditional render, no state flag. Slider value always tracked; just hidden until typing.

69. **Tips section is localStorage-first, collapsed for returning users (Sprint 29).** Key: quorum_tips_open. Onboarding content should not persist at full height for experienced users.

70. **Quorum's category is "Judgment Infrastructure" / "Decision Operating System" (Website Strategy).** Do not revert to "decision intelligence", "decision support", or any framing implying episodic tool use.

71. **QUORUM flip-card uses opacity+scale crossfade, not CSS 3D backfaceVisibility (Sprint 30).** CSS 3D flips are unreliable across browsers when the card contains form elements. Opacity+scale crossfade achieves the same theatre feel with zero reliability issues. Do not replace with perspective/rotateY.

72. **totalSessionCount is server-fetched, not localStorage.length (Sprint 30).** localStorage stores only device-local session IDs (~21 vs actual 200+). RecordReceipt shows real count by passing totalSessionCount from session/[id]/page.tsx server prop. Always use DB count for user-visible session numbers.

73. **Onboarding panels live inside the QUORUM back-face card, not as a separate overlay (Sprint 31).** Modal overlay over the premium card would break the first impression. Panels are the card's depth — same gold, same typeface. Skip → jumps to QUORUM face (Panel 2) so the premium moment is not lost. quorum_onboarded gate: returning users see Panel 2 (QUORUM face) directly with zero regression.

74. **Voice end detection is manual-only (Sprint 31).** enable_endpoint_detection: false in Soniox stream config. User taps Stop explicitly — no auto-termination after detected silence. Rationale: long pauses during thinking should not cut off the recording unexpectedly at HNI decision quality stakes.
```

---

## CHANGE 7 — PENDING section (replace entirely)

```markdown
## PENDING

**Sprint 32 — priority order:**

1. **Deploy Sprint 31 pending items** (all built in sessions, not yet in code zip):
   - `app/page.tsx`: Chunk 5 onboarding panels (isOnboarding, onboardPanel, quorum_onboarded)
   - `components/PatternSurfaceCard.tsx`: new component
   - `components/RecurringConditionCard.tsx`: new component
   - `components/ContradictionBanner.tsx`: new component + SessionView wiring
   - `components/ExaminerPanel.tsx`: &apos; → \u2019
   - `app/api/voice/stream/route.ts`: enable_endpoint_detection: false
   - `app/globals.css`: --bg-void #030b18 (blue tint) + --gold #d4a832 (brighter dark mode)

2. **PatternSurfaceCard improvements** (from user QA session):
   - Show actual decision text (first 60 chars of decision_text) instead of UUID
   - "Show N more decisions" button when > 4 contributing sessions
   - Add one actionable line per pattern narrative
   - "Most frequent across your record" sub-label to signal freshness
   
3. **RecurringConditionCard improvements** (from user QA session):
   - Replace behavioral-tech dimension labels with user-friendly language
   - Add one actionable observation line

4. **IST migration** — `RecordExport.tsx` and `CalibrationSparkline.tsx` already have inline `timeZone: 'Asia/Kolkata'`. Migrate to `formatDate()` / `formatDateTime()` from `lib/dates.ts`. Audit all remaining `toLocaleDateString()` calls across codebase.

5. **Product Chunks 4–5 (full implementation) — correct build order:**
   - Chunk 5 onboarding first (lowest risk, purely frontend)
   - Chunk 4c RecurringConditionCard (observation, no new API)
   - Chunk 4a PatternSurfaceCard (core aha, reads /api/mirror/patterns — already built)
   - Chunk 4b ContradictionBanner (reads /api/mirror/contradictions — already built)
   - Chunk 1 Judgment Profile as primary object (home screen structural reframe — do not start before Chunks 4a/4b are stable)
   - Chunk 3 Mirror teaser reframe: profile-in-construction, "X of 5 decisions needed" progress
   - Chunk 2 Post-synthesis beat (RecordReceipt already live — extend with structural dimension summary)

**Parked items (do not build until stage gate met):**
- C0 context question in Examiner — spec debated, not built. Requires synthesis prompt update to treat C0 as USER_STATED_JOB framing block. Do not build without the synthesis change.
- R11 (Avoidance Detection) — requires cron + days_open tracking
- Razorpay webhook wiring — replace x-admin-key guard in create-subscription stub
- Contradiction log table (`contradiction_log` as first-class table) — after Contradiction Detector is at scale (~30–50 sessions)
- Institutional pricing (annual license per principal, PE/VC portfolio) — after individual product has Mirror calibration data

**Stage gate to Sprint 32 full build:** First paying session at any price point + one returning user who explicitly returns for a second real decision.
```

---

## CHANGE 8 — RESOLVED / CLOSED section additions

Append:

```markdown
- **Confidence slider ambiguity (users rated outcome confidence vs clarity)** → ✅ Sprint 28. "Pre-session clarity", Foggy/Fully clear, revised sub-text.
- **Mirror section order — Timeline first created wrong reading flow** → ✅ Sprint 28. Bias Fingerprint now first.
- **"Activates when:" missing from bias tiles** → ✅ Sprint 28.
- **Independence Score missing examiner context** → ✅ Sprint 28. Quote + CoachingTip.
- **Home page equal visual weight across all elements** → ✅ Sprint 29. State-gated reveals, fixed navbar, pill strip, collapsible tips.
- **Mobile unusable on home page** → ✅ Sprint 29 + 30. .home-two-col, 44px tap targets, clamp heights.
- **Inter body font clinical on dark backgrounds** → ✅ Sprint 29. DM Sans variable font.
- **localStorage auth key wrong ('user_email' instead of 'quorum_user_email')** → ✅ Sprint 30. "Open Quorum" from website now loads as linked on same device. Fix: storeUserEmail() used consistently in getSession() effect.
- **All dates in device/browser timezone** → ✅ Sprint 30. lib/dates.ts created, formatDate/formatDateTime helpers. app/page.tsx migrated. CalibrationSparkline + RecordExport already had inline IST (pending helpers migration).
- **RecordReceipt showing localStorage count (~21) instead of real DB count (200+)** → ✅ Sprint 30. totalSessionCount passed as server prop from session/[id]/page.tsx.
- **sv-navbar invisible in dark mode** → ✅ Sprint 30. background: var(--bg-card) replaces var(--bg-deep).
- **Mirror nav back button low contrast in both themes** → ✅ Sprint 30. onMouseEnter already gold; base color now gold at 0.85 opacity.
- **MemoryEngineStatus showing "Mirror ready to activate" for paid subscriber** → ✅ Sprint 30. mirrorUnlocked prop + /api/mirror/status fetch on home page.
- **Decision record count (RecordReceipt) showing localStorage count not DB count** → ✅ Sprint 30 (totalSessionCount fix).
```

---

## CHANGE 9 — Sprint 28–31 test logs (insert before ENVIRONMENT VARIABLES)

```markdown
---

## SPRINT 28 TEST LOG

| # | Test | Expected |
|---|---|---|
| SL1 | Confidence slider | "Pre-session clarity" label, "Foggy" / "Fully clear" poles |
| SL2 | Slider sub-text | "How clearly do you understand this decision right now?…" |
| M1 | Mirror on 375px | 16px side padding, 1-col teaser stats, back button 44px |
| A1 | Confirmed bias tile | "Activates when:" prefix before trigger text |
| Q1 | Independence Score — session with Examiner responses | Italic quote block between band pill and session count |
| Q2 | Old session (no Examiner) | No quote block — no regression |
| C1 | Band < 25 | Coaching tip appears |
| C2 | Band ≥ 75 | No coaching tip |
| R1 | Mirror UnlockedView | Bias Fingerprint is first module |
| R2 | Scroll to bottom | Decision Timeline is last |
| R3 | TeaserView | Decision Timeline still first |

## SPRINT 29 TEST LOG

| # | Test | Expected |
|---|---|---|
| N1 | Home page load | Fixed navbar at top, not centered wordmark |
| N2 | Scroll home | Navbar frosted glass effect |
| G1 | Empty textarea | Register mode + slider hidden |
| G2 | Type first character | Controls reveal smoothly |
| P1 | Persona section | 6 pills, ~44px total height |
| T1 | First visit | Tips expanded |
| T2 | Close, reload | Tips collapsed |
| H1 | History load | Fade-in |
| F1 | Body text | DM Sans — warmer/rounder vs Inter |

## SPRINT 30 TEST LOG

| # | Test | Expected |
|---|---|---|
| F1 | Land on home (new user) | QUORUM wordmark card, gold rules, "Add to your judgment record" CTA |
| F2 | Click card | Crossfade to decision form. Advisor line + personas fade in below |
| F3 | New user strip | "YOUR JUDGMENT RECORD · 0 decisions" + "Every decision builds…" second line |
| F4 | Returning user strip | Count correct, no second line |
| F5 | Mobile (375px) | Card height ~78% of viewport, not full-height |
| F6 | Gap card → MemoryEngine | Visibly tighter than before (clamp 20–28px) |
| R1 | RecordReceipt — after synthesis | Card appears below SynthesisCard, shows real DB count |
| R2 | RecordReceipt — before synthesis | Does not appear |
| R3 | RecordReceipt — decision type | Shows type tag if decision has tagger data |
| M1 | MemoryEngineStatus — Mirror unlocked user | "Pattern Memory active · Mirror active" + "View Mirror →" |
| M2 | MemoryEngineStatus — teaser ready, not unlocked | "Mirror preview activates" + "View Mirror →" |
| M3 | Mirror paywall state | No lock icons, "Activate Mirror" language, ₹9,999/year |
| M4 | Mirror unlocked state | Zero changes to any module in UnlockedView |
| A1 | "Open Quorum" from website (same device) | Loads as linked — no re-auth prompt |
| A2 | Date on any decision in history | IST time, not device timezone |
| N1 | Session page nav bar | Visually distinct from page background (bg-card, not invisible) |

## SPRINT 31 TEST LOG (apply once pending items deployed)

| # | Test | Expected |
|---|---|---|
| O1 | New user (clear localStorage) | Panel 0 shows inside card: "01 · THE COUNCIL" + dots + "TAP TO CONTINUE →" |
| O2 | Tap card | Panel 1 shows: "02 · YOUR MIRROR" |
| O3 | Tap card again | QUORUM face (Panel 2). Tap CTA → flip to form |
| O4 | Skip → | Jumps directly to QUORUM face |
| O5 | Returning user | Card shows QUORUM face directly (no panels) |
| P1 | Home page — Mirror user ≥5 sessions | PatternSurfaceCard appears above MemoryEngine |
| P2 | PatternSurfaceCard decision links | Shows actual decision text, not UUID |
| P3 | PatternSurfaceCard > 4 decisions | "Show N more" button appears |
| P4 | PatternSurfaceCard actionable | One actionable line present |
| P5 | RecurringConditionCard | Shows if top dimension has high_count ≥ 3. User-friendly language |
| C1 | ContradictionBanner — session that is violation | Banner fires below RecordReceipt |
| C2 | Dismiss "Flag as exception" | Banner disappears, does not refire |
| V1 | Voice recording | No auto-stop on silence — must tap Stop manually |
| E1 | ExaminerPanel R7 redirect text | "the Council's read" renders correctly (no &apos;) |
| B1 | Dark mode background | Deep navy tint (#030b18) — not pure black |
| G1 | Dark mode gold | Brighter (#d4a832) — clearly readable on dark background |
```

---

*End of patch. Apply CHANGES 1–9 to HANDOVER_DOC_v26.md to produce v27.*
