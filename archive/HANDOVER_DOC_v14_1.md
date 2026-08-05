# QUORUM — Handover Document v14.1
### Date: May 2026 | Status: Sprint 15b complete (UX + Reasoning Quality)
### Stack: Next.js 14 · Supabase (PostgreSQL) · Railway · Anthropic / DeepSeek

---

## PRODUCT SUMMARY

Quorum is a private decision intelligence system for high-stakes decisions. A user describes a decision; six AI advisors (the Council) analyse it in parallel from distinct cognitive frames. Before synthesis fires, the Examiner surfaces unknown unknowns — and from Sprint 11a, runs a deterministic rule engine that can block or gate the Council based on the decision's structural profile. Over time, the Mirror layer accumulates patterns, calibration data, and contradiction signals across all of a user's decisions.

**Positioning:** Not a chatbot. Not a framework. A private judgment system that compounds with every session.

**Target user:** Founders, CXOs, Family Office MDs. Decisions where ₹25K is cheap relative to a bad call.

---

## SYSTEM ARCHITECTURE

```
User submits decision
        ↓
POST /api/session         → creates session row (sessions table)
        ↓ (async, background)
POST /api/ontology        → tagDecision (14-dim v2.0) → evaluateRules → DB upsert
POST /api/bias-score      → bias scorer → bias_library upsert
POST /api/structural-match → structural retrieval → structural_matches upsert
POST /api/independence-score → independence scorer → independence_score_log upsert
        ↓ (UI, parallel)
6 × POST /api/persona     → streams persona responses → messages insert
        ↓ (after all 6 done)
GET /api/examiner         → reads rule_engine_result (v2.0) or gaps (v1.0)
                            → personalises each rule question to decision_text (Sprint 12)
                            → returns questions + rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses (with rule_id) → fires /api/bias-score (non-blocking)
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → synthesis with buildCouncilContext injected into system prompt (Sprint 12)
        ↓ (Mirror, separate route)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts|calibration}
```

---

## DATABASE SCHEMA (all tables, current as of Sprint 15b)

No schema changes in Sprint 15b. All tables unchanged from Sprint 15a.

### sessions
```
id                      uuid PK
user_id                 uuid FK → auth.users
user_email              text
device_id               text
decision_text           text NOT NULL
context_text            text
status                  text CHECK ('active','completed')
register_mode           text CHECK ('analytical','clarification')
pre_decision_confidence integer CHECK (1–10)   ← ✅ column + UI live (Sprint 14)
created_at              timestamptz
```

### sessions_ontology
```
id                      uuid PK
session_id              uuid UNIQUE FK → sessions
tagger_version          text DEFAULT 'v1.0'    ← 'v2.0' for new sessions
tagger_status           text CHECK ('pending','complete','failed')
examiner_status         text CHECK ('pending','submitted','skipped')

-- CATEGORICAL FIELDS (v1.0, all retained) ──────────────────────────
decision_type_primary   text
decision_type_secondary text[]
stakes_reversibility    text
stakes_bearer           text
stakes_timeline         text
has_stated_deadline     boolean
deadline_source         text
deadline_credibility    text
known_unknowns_surfaced boolean
unknown_unknown_categories text[]
counterparty_present    boolean
counterparty_alignment  text
info_asymmetry          text
relationship_type       text
dominant_emotion        text
emotion_source          text
emotion_analysis_aligned boolean
stakeholder_count       text
hidden_stakeholder_probability text
instrumental_weight     numeric(3,2)
constitutive_weight     numeric(3,2)
examiner_gap_1          text
examiner_gap_2          text
examiner_gap_3          text
raw_ontology_json       jsonb

-- NEW IN SPRINT 11a ──────────────────────────────────────────────────
ontology_vector         jsonb    ← 14-dim scored vector (score, confidence, rationale per dim)
rule_engine_result      jsonb    ← {mode, triggered_rules, flag_rules, evaluated_at}
```

**ontology_vector dimensions (14):**
`reversibility`, `time_horizon`, `stakes_magnitude`, `outcome_uncertainty`, `value_conflict`, `identity_alignment`, `regret_asymmetry`, `upstream_dependency`, `ambiguity`, `task_complexity`, `decision_discriminating_info`, `time_pressure`, `decision_unit`, `emotional_intensity`
Each: `{ score: 1-5, confidence: 0-1, rationale: string }`, plus `vector_version: "v2.0"`

**rule_engine_result modes:** `REDIRECT` (synthesis blocked) · `GATE` (examiner first) · `OPEN` (Council runs freely)

### sessions_pending_outcomes *(view)*
Sessions with no outcome row older than 30 days. Used by cron (not yet wired).

### examiner_responses
```
id                 uuid PK
session_id         uuid FK → sessions
question_text      text
response_text      text
bias_parameter_probed text
unknown_unknown_gap   text
question_order     integer
rule_id            text    ← Sprint 11a (R1–R12, null for v1.0 sessions)
created_at         timestamptz
```

### outcomes
```
id                      uuid PK
session_id              uuid UNIQUE FK → sessions
what_decided            text NOT NULL
council_helped          text CHECK ('yes','partially','no')
notes                   text
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')
retrospective_confidence integer CHECK (1–10)  ← ✅ Sprint 14
calibration_delta       numeric                ← ✅ auto-computed on outcome submit (Sprint 14)
created_at              timestamptz
updated_at              timestamptz
```

**calibration_delta** = `retrospective_confidence − pre_decision_confidence`. Null when `pre_decision_confidence` was not recorded (pre-Sprint 14 sessions). Written by `/api/outcome` POST only.

### messages
```
id          uuid PK
session_id  uuid FK → sessions
persona     text (contrarian|risk_architect|pattern_analyst|stakeholder_mirror|elder|competitor)
role        text CHECK ('assistant','user')
content     text
created_at  timestamptz
```

### bias_library
User-level bias accumulation. **One row per (user × bias_parameter) — not per session.**
Key columns: `user_email`, `user_id`, `device_id`, `session_ids uuid[]`, `bias_parameter`, `detection_count`, `confidence_weight`, `asymmetry_score_avg`, `activation_contexts jsonb`, `outcome_confirmed_count`, `outcome_disconfirmed_count`.
Unique constraint: `(user_email, bias_parameter)`.
Identity resolution order: `user_id` → `user_email` → `device_id` → anonymous (INSERT only, no accumulation).
**Only `/api/bias-score` writes to this table. No other route should insert here.**

### contradictions
User-level contradiction log. `principle_text`, `violation_text`, `principle_session_id`, `violation_session_id`, `severity`, `category`, `dismissed_at`.

### structural_matches / structural_scores
Cross-session structural similarity. Computed from categorical ontology fields (v1.0). Upgrade to 14-dim vector scoring pending Sprint 15.

### mirror_access
Controls Mirror feature gate. `access_type`: `'paid' | 'granted' | 'trial'`. `expires_at` nullable.

### user_preferences
`email_weekly_summary`, `email_contradiction`, `default_register_mode`, `has_completed_onboarding`, `first_session_at`.

### session_requests
Inbound leads from website modal. `interest_type`, `decision_summary`, `name`, `email`, `whatsapp`, `status`.

### brief_access_tokens
Token-gated access to PDF brief download. `token`, `used_count`, `expires_at`, `is_active`.

---

## CODEBASE MAP

```
app/
  api/
    session/route.ts          — creates session, fires 4 async background jobs
    ontology/route.ts         — ★ Sprint 11a — v2.0 tagger + rule engine
    examiner/route.ts         — ★ Sprint 12 — GET: personalises rule questions to decision_text
                                              POST: saves examiner_responses, fires /api/bias-score
    persona/route.ts          — ★ Sprint 12 — synthesis/decision_brief: injects buildCouncilContext
                                  all other persona calls unchanged
    bias-score/route.ts       — bias scorer, identity resolution, bias_library upsert
                                SOLE WRITER to bias_library
    structural-match/route.ts — cross-session structural similarity
    outcome/route.ts          — ✅ saves all calibration fields, computes calibration_delta (Sprint 14)
    record/[id]/route.ts      — fetches full session record for /record/[id]
    record/[id]/brief/route.ts — PDF brief generation
    mirror/
      timeline/route.ts       — decision history for Mirror Timeline
      fingerprint/route.ts    — bias fingerprint from bias_library
      independence/route.ts   — independence score trend
      rules/route.ts          — extracts implicit decision rules from examiner corpus
      contradictions/route.ts — active contradictions for display
      outcomes/route.ts       — outcome loop status, causalReady flag
      alerts/route.ts         — behavioral alerts
      status/route.ts         — Mirror access gate + teaser biases (Sprint 13 fix live)
      unlock/route.ts         — token validation for mirror access
      calibration/route.ts    — ✅ NEW Sprint 15a — calibration sparkline data
    auth/route.ts             — Supabase auth
    auth/link-sessions/route.ts — links anonymous sessions to user on login
    brief-access/route.ts     — validates brief access tokens

lib/
  ontology-tagger.ts  — 14-dim scored vector, tagger_version v2.0
  rule-engine.ts      — R1–R5 live; R6–R12 fully implemented (Sprint 13)
                        buildCouncilContext() — structured decision block injected into synthesis
  personas.ts         — ★ Sprint 15b — 6 persona prompts + SYNTHESIS + WORD_LIMIT_PREFIX/SUFFIX
                        All prompt logic lives here. See Sprint 15b section for full change detail.
  structural-retrieval.ts — OntologySnapshot, scoring, PERSONAS_WITH_STRUCTURAL_CONTEXT
  bias-scorer.ts      — bias detection AI call + structured output (called only from /api/bias-score)
  contradiction-detector.ts — two-pass contradiction pipeline
  independence-score.ts — independence scoring
  mirror-fingerprint.ts — fingerprint computation
  ai-client.ts        — provider abstraction (Anthropic / DeepSeek), createStream / createCompletion
  supabase.ts         — createServiceClient, createBrowserClient
  types.ts            — shared TypeScript types (PersonaKey, PersonaMeta, Message)
  storage.ts          — localStorage helpers

components/
  SessionView.tsx     ✅ Sprint 11b — ruleMode + redirectBlocked state, handleExaminerComplete(responses, mode)
  SynthesisCard.tsx   ✅ Sprint 11b — redirectBlocked prop, upstream block card early return
  ExaminerPanel.tsx   ✅ Sprint 11b — onComplete(responses, ruleMode), REDIRECT banner
  PersonaPanel.tsx    — auto-fires on mount, handles pushback exchanges
  OutcomeTracker.tsx  — ✅ outcome_quality, retrospective_confidence, calibration display (Sprint 14)
  CalibrationSparkline.tsx  — ✅ NEW Sprint 15a — dual-line SVG sparkline, delta bars, summary card
  MirrorTimeline.tsx, BiasFingerprint.tsx, DecisionRules.tsx, ContradictionDetector.tsx,
  IndependenceScore.tsx, BehaviorAlerts.tsx, MemoryEngineStatus.tsx,
  PatternTile.tsx, BriefCTA.tsx, RecordExport.tsx, ReanalyzeDrawer.tsx,
  AuthPanel.tsx, ThemeToggle.tsx

app/
  page.tsx               — ★ Sprint 15b — one-time input glow on mount; pre_decision_confidence slider live
  session/[id]/page.tsx  — session view
  mirror/page.tsx        — ✅ Sprint 15a patch — CalibrationSparkline section wired into UnlockedView
  record/[id]/page.tsx   — decision record (read-only, shareable)
  auth/callback/page.tsx — Supabase OAuth callback

Static:
  quorum-website.html — marketing site (separate from Next.js app)
```

---

## RULE ENGINE (lib/rule-engine.ts)

**R1 — Upstream Dependency Block** `[REDIRECT]`
Fires when: `upstream_dependency.score >= 5` (and confidence ≥ 0.55)
Effect: Synthesis blocked. ExaminerPanel shows redirect question. Persona grid dims.

**R2 — Identity-First Gate** `[GATE]`
Fires when: `identity_alignment.score >= 5 AND ambiguity.score >= 4`
Effect: Examiner asks values question before synthesis. Synthesis fires after examiner submit.

**R3 — No-Information Mode** `[GATE]`
Fires when: `decision_discriminating_info.score <= 1 AND outcome_uncertainty.score >= 4`
Effect: Examiner asks what is permanently true. Synthesis after examiner.

**R4 — Regret Asymmetry Alert** `[FLAG]`
Fires when: `regret_asymmetry.score >= 5`
Effect: Enriches Council context. Does not block.

**R5 — False Urgency Detector** `[FLAG]`
Fires when: `emotional_intensity.score >= 4 AND time_pressure.score <= 2`
Effect: Enriches Council context. Does not block.

**R6–R12 — All implemented Sprint 13:**

| Rule | Type | Trigger |
|---|---|---|
| R6 — Multi-Party Alignment | FLAG | `decision_unit >= 3 AND emotional_intensity >= 4` |
| R7 — Information-First | REDIRECT | `decision_discriminating_info >= 4 AND outcome_uncertainty >= 3 AND identity_alignment <= 3` |
| R8 — Irreconcilable Values | FLAG | `value_conflict >= 5 AND identity_alignment >= 4` |
| R9 — Irreversibility Warning | FLAG | `reversibility >= 4 AND time_pressure <= 2 AND emotional_intensity >= 4` |
| R10 — Complexity Overload | GATE | `task_complexity >= 5 AND ambiguity >= 4` |
| R11 — Avoidance Detection | BACKGROUND | Requires cron — deferred |
| R12 — Couple Misalignment | FLAG | `decision_unit == 2–3 AND value_conflict >= 4` |

**Suppression pairs:** R9 suppressed when R4 fires. R12 suppressed when R8 fires.
**Evaluation order:** R1 → R7 (REDIRECTs first) → GATE rules → FLAG rules.
**Low confidence rule:** If triggering dimension has `confidence < 0.55`, rule downgrades to clarifying question.

---

## REDIRECT FLOW (Sprint 11b — live)

**Trigger:** `upstream_dependency.score >= 5` AND `confidence >= 0.55` → R1 fires → `rule_engine_result.mode = 'REDIRECT'`

**UI flow:**
1. All 6 personas auto-fire and stream normally (grid dims to 55% opacity after ExaminerPanel fires)
2. `allPersonasDone` → ExaminerPanel becomes `visible`
3. ExaminerPanel GET: `rule_mode = 'REDIRECT'` from `rule_engine_result`
4. ExaminerPanel renders REDIRECT banner (gold-bordered, R1 question text, "Understood — dismiss" button)
5. User clicks "Understood — dismiss" → `handleSkip()` → `onComplete([], 'REDIRECT')`
6. SessionView `handleExaminerComplete([], 'REDIRECT')`:
   - `setRuleMode('REDIRECT')`
   - `setRedirectBlocked(true)`
   - `setExaminerReady(false)` — synthesis gate stays closed
   - Returns early (no persona context mapping)
7. SynthesisCard receives `redirectBlocked=true` → renders upstream block card (not synthesis)
8. Persona grid: `opacity: 0.55`, `pointer-events: none`

**Reset:** User clicks Reanalyze → `handleReanalyze()` → new session → `setRuleMode(null)` + `setRedirectBlocked(false)`

**DB record:** `rule_engine_result.mode = 'REDIRECT'` stored in `sessions_ontology`. No synthesis row in `messages` table for REDIRECT sessions.

---

## SPRINT HISTORY

| Sprint | What shipped |
|---|---|
| 1 | Basic session submission + 6 persona streaming |
| 2 | Supabase persistence, session record |
| 3 | Examiner phase 1 gate (synthesis gated on examiner) |
| 4 | Mirror access gate, bias scorer |
| 5 | Structural retrieval + structural context injection |
| 6 | Contradiction Detector two-pass pipeline |
| 7 | Mirror launch: Timeline, Fingerprint, Independence, Rules, Contradictions |
| 8 | PDF brief, brief access tokens, clarification register mode |
| 9 | Outcome tracker, ReanalyzeDrawer, record export |
| 10 | Examiner tightening, PASS2_PROMPT refinement, codebase audit |
| **11a** | **14-dim ontology tagger (v2.0), rule-engine.ts (R1–R5), SQL migration — ✅ PASSED** |
| **11b** | **REDIRECT synthesis block, ExaminerPanel rule_mode pass-through, dim persona grid — ✅ PASSED** |
| **11c** | **Rule calibration: R1 threshold → 5, R4 suppresses R2, REDIRECT banner shows rationale, dim fires on detection not dismiss, SynthesisCard light-mode fix, typography system** |
| **12** | **Contextual rule questions (personalised to decision_text), Council context enrichment (buildCouncilContext → synthesis), POST handler reconstruction, bias trigger fix — ✅ PASSED** |
| **13** | **Mirror status fix (bias_library user_email query), R6–R12 implementations, post-test patches: R2 threshold → 5, R12 range widened 2–3, SSL bias trigger fix — ✅ PASSED** |
| **14** | **Calibration loop: pre_decision_confidence slider (home page), outcome_quality + retrospective_confidence in OutcomeTracker, calibration_delta auto-computed. UI patches: helped-badge white text, hindsight confidence colour-coded — ✅ PASSED** |
| **15a** | **Calibration Sparklines in Mirror — ✅ PASSED** |
| **15b** | **UX + Reasoning Quality (prompt architecture + home glow) — ✅ PASSED (see below)** |

---

## CURRENT STATUS (as of Sprint 15b)

### ✅ Live and working

Everything from Sprints 11a–15a, plus:

---

### Sprint 15b — UX + Reasoning Quality

**Files changed:** `lib/personas.ts`, `app/page.tsx`
**No schema changes. No new API routes. No new components.**

---

#### Change 1 — Home Page Input Discovery Glow (`app/page.tsx`)

**What changed:** Decision textarea fires a one-time subtle gold glow on page load.

**Implementation:**
- Added `inputGlowing` boolean state.
- Two `setTimeout` calls inside the existing mount `useEffect`: glow starts at 600ms, clears at 2400ms.
- Glow applied via inline style spread on the textarea: `box-shadow: 0 0 0 2px rgba(201,168,76,0.18), 0 0 18px 4px rgba(201,168,76,0.13)` + softened `borderColor`.
- CSS `transition: box-shadow 0.5s ease, border-color 0.5s ease` ensures smooth fade in/out.
- Fires exactly once per page load. No repeat, no loop, no animation library.

**Purpose:** First-action clarity for new users. Guides attention to the primary input without onboarding friction.

**Do not re-debate:** The glow is intentionally subtle and brief (1.8s visible window). It must not loop or repeat. Do not convert to a CSS `@keyframes` animation — the current approach is correct because it fires once and clears state cleanly.

---

#### Change 2 — Decision Type Calibration (`lib/personas.ts` → `WORD_LIMIT_PREFIX`)

**What changed:** Added item 4 to `WORD_LIMIT_PREFIX`, which is prepended to every persona's system prompt.

**Behaviour:** Before generating a response, each persona self-assesses whether the query is:
- **Straightforward / operational** (90%+ confidence): primarily quantitative, cost-benefit solvable, no deep value/identity/irreversibility dimension. E.g. "Should I buy a 1L washing machine or continue domestic help?"
- **Genuinely complex**: involves value conflicts, identity alignment, irreversible structural choices, or outcome uncertainty that information alone cannot resolve.

**If operational:** persona compresses analysis — skips philosophical exploration, avoids invented psychological depth, leads with direct tradeoff logic. Stays in lane but shorter.

**If complex:** full depth as normal. The calibration block does not activate.

**Threshold is 90% confidence** to avoid false compression on genuinely ambiguous queries that happen to look operational on the surface.

**Do not re-debate:** This calibration only changes *how* a persona responds, not its role. The Contrarian still challenges an operational decision — just more efficiently. Do not lower the confidence threshold below 90%.

---

#### Change 3 — Pushback Classification Protocol (`lib/personas.ts` → `WORD_LIMIT_SUFFIX`)

**What changed:** Added `PUSHBACK PROTOCOL` block to `WORD_LIMIT_SUFFIX`, which is appended to every persona's system prompt.

**Behaviour when pushback/challenge text is present in conversation:**

1. **Classify** the challenge as one of:
   - `WEAK` — repeats original position, no new information, assertion-only
   - `PARTIALLY VALID` — adds nuance but doesn't change core recommendation
   - `MATERIALLY VALID` — new information or overlooked dimension requiring analysis update
   - `RECOMMENDATION-CHANGING` — would reverse or substantially alter the direction of advice

2. **Open** by naming what new information or argument the user introduced (one sentence).

3. **Respond in proportion to classification:**
   - WEAK: hold position, explain the specific logical gap in the pushback — do not simply reassert
   - PARTIALLY VALID: acknowledge what is right, name the limit of that point, sharpen original position
   - MATERIALLY VALID: update explicitly — name what changed and by how much
   - RECOMMENDATION-CHANGING: reverse or substantially revise, state new position clearly

**Purpose:** Eliminate procedural-feeling acknowledgment. Make disagreement feel intellectually honest and genuinely responsive.

**Do not re-debate:** Personas must not simply restate their prior conclusion when holding position. The classification step is mandatory even if internal only. Surface omission of the protocol is a prompt failure.

---

#### Change 4 — Reward Good User Thinking (`lib/personas.ts` → `WORD_LIMIT_SUFFIX`)

**What changed:** Added `STEP 4 — REWARD STRONG REASONING` inside the Pushback Protocol block.

**Behaviour:** When a user makes a genuinely good point, identifies a real tradeoff, or introduces analytically sharp reasoning, personas must acknowledge it directly. The structure (adapted into prose, not used as literal headers):
- "What your reasoning gets right: [specific acknowledgment]"
- "What may still be missing: [genuine gap, if one exists]"
- "What risk may still be underestimated: [the thing that survives even good pushback]"

**Purpose:** Reflexive adversarialism when the user is right destroys trust faster than agreement. Quorum should feel fair, not like a system that punishes logic regardless of quality.

**Do not re-debate:** This does not make personas soft or agreeable. The acknowledgment must be earned — the structure only activates when the reasoning is genuinely strong. The "what risk may still be underestimated" component preserves intellectual sharpness.

---

#### Change 5 — Council Synthesis: Recommendation-First Structure (`lib/personas.ts` → `SYNTHESIS`)

**What changed:** Restructured the `SYNTHESIS` prompt to mandate recommendation-first output.

**New structure:**
1. **Opening sentence (mandatory):** Directional lean stated immediately. Where the council lands. Not hedged, not exploratory. Form: "The council leans toward X, contingent on Y." or "The weight here is against X, primarily because [one-clause reason]." This sentence must appear first.
2. **Paragraph 1 (2-3 sentences including opening):** What the council collectively agrees on — the "here is why" that follows the lean.
3. **Paragraph 2 (2 sentences):** Where the council most sharply diverges — the genuine tension the decision-maker must resolve themselves.
4. **Paragraph 3 (1-2 sentences):** The single most important thing to examine before deciding. Specific, not generic.
5. **Strategic Possibilities** (optional — see Change 6).
6. **Pattern Observation** — surfaces when a pattern is present (mandatory when triggered, exempt from word limit — see note below).

**Purpose:** High-agency users (founders, operators, HNI) need fast orientation before depth. A buried conclusion reduces trust even when underlying reasoning is strong.

**Word limit:** 180 → 220 words for Paragraphs 1–3 and Strategic Possibilities combined. Pattern Observation is **exempt from this count** — if a pattern clearly qualifies, it must appear regardless of proximity to the word limit. It is not optional when a pattern is present; it is only omitted when no pattern qualifies.

**Do not re-debate:** The opening lean is mandatory. It must not be moved to the end, softened into a question, or replaced with a summary of tensions. The old structure (consensus → tension → most important thing → lean) was the problem this change fixes. If clarification mode is active, the opening still orients — "The council reads this as a question about X more than Y" — before exploring tensions. Pattern Observation must not be dropped to stay under 220 words — it is exempt from the word limit when a pattern qualifies.

---

#### Change 6 — Council Synthesis: Strategic Possibilities (`lib/personas.ts` → `SYNTHESIS`)

**What changed:** Added an optional `STRATEGIC POSSIBILITIES` paragraph to the synthesis structure, between Paragraph 3 and Pattern Observation.

**Behaviour:** After the core analysis, synthesis scans whether the council's reasoning surfaces a genuine constraint with unexplored alternatives — an untested assumption about available options, an alternative path that resolves the core tension, or a leverage point that reframes the binary. If yes: 1-2 sentences expanding the decision space.

**Example trigger condition:** Council identifies "hiring talent is the bottleneck" → synthesis might surface apprenticeship pipelines, adjacent talent pools, capability-building models as possibilities the user hasn't named.

**Hard guardrails:**
- Do NOT force this. If no genuine alternative exists, omit entirely.
- Do NOT produce a list of recommendations.
- Do NOT turn synthesis into a consulting engine or solution generator.
- Frame as expansion of possibility space, not a solution. Example language: "One path that may not be visible yet:" / "Worth testing before committing:" / "The leverage point the council didn't name explicitly:"

**Purpose:** Users should leave feeling strategically expanded, not merely that the system discussed their problem intelligently.

**Do not re-debate:** The strategic possibilities layer is additive and optional. It does not replace or dilute the core decision analysis. If a future sprint attempts to make it mandatory or list-based, revert to the current implementation.

---

## SPRINT 15b TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Home page loads → textarea glows once ~600ms after mount, fades by ~2400ms | ✅ |
| B | Glow does not repeat on subsequent renders or state changes | ✅ |
| C | Straightforward query (washing machine / domestic help type) → persona response is concise, direct, no philosophical framing | ✅ |
| D | Complex query (PE stake sale, family business) → persona response is full depth, calibration does not compress | ✅ |
| E | User pushback with weak argument → persona holds position, explains specific logical gap (does not just restate) | ✅ |
| F | User pushback with materially valid argument → persona updates explicitly, names what changed | ✅ |
| G | User makes strong point → persona acknowledges it directly, surfaces what still stands | ✅ |
| H | Council synthesis opens with directional lean in first sentence | ✅ |
| I | Synthesis lean is concrete (not "it depends" or "the council is divided") | ✅ |
| J | Strategic possibilities paragraph appears when council surfaces a genuine constraint with alternatives | ✅ |
| K | Strategic possibilities absent when no genuine alternative exists (not forced) | ✅ |
| L | Clarification mode synthesis still orients first ("The council reads this as a question about X more than Y") | ✅ |
| M | Paragraphs 1–3 + Strategic Possibilities stay ≤ 220 words; Pattern Observation appears when triggered regardless of count | ✅ |

---

## SPRINT 15a — Calibration Sparklines (previous sprint, still live)

`app/api/mirror/calibration/route.ts`, `components/CalibrationSparkline.tsx`

New API route `/api/mirror/calibration`:
- Joins `sessions.pre_decision_confidence` with `outcomes` (retrospective_confidence, calibration_delta, outcome_quality).
- `dataReady` threshold: **≥ 3 outcomes with `retrospective_confidence` filled** — retro-only sessions count. Pre-Sprint-14 sessions with `pre_decision_confidence = NULL` are included in the chart (retro line only); they don't count as "paired" for delta stats but do activate the chart.
- Computes: `avg_retro` (all retro points), `avg_delta` / `avg_pre` / trend / pattern (paired points only — where both pre and retro are non-null).
- Trend: OLS slope over `calibration_delta` values ordered by date. `slope > +0.3` → improving, `< -0.3` → declining, else stable.
- Pattern: plain-language label derived from avg_delta magnitude + trend direction.

`CalibrationSparkline.tsx` — three visual layers:
1. **Summary card** — avg Δ (green/red/gold-coded), avg pre (hidden when null), avg retro, trend label, pattern text.
2. **Dual-line SVG sparkline** — pre confidence (muted) vs retro confidence (gold). Pre line only drawn where `pre_decision_confidence` is non-null. Shaded area between lines. Hover tooltip per point: date, pre, retro, delta.
3. **Delta bar row** — per-session signed bars (height ∝ `|calibration_delta|`, green/red coded). Only rendered where delta is non-null.

`app/mirror/page.tsx` — `CalibrationSparkline` added as final section in `UnlockedView`, after Contradiction Detector, with divider and description copy.

**Key design note (do not re-debate):** `dataReady` uses retro-only count, not paired count. This was corrected during Sprint 15a after discovering all pre-Sprint-14 sessions have `pre_decision_confidence = NULL` — requiring paired count would have left existing users at 0/3 indefinitely despite having logged outcomes. Delta stats are suppressed cleanly when pre data is absent; they accumulate going forward as new sessions include the slider.

**Supabase join note:** The calibration route uses `.select('... outcomes ( retrospective_confidence, calibration_delta, outcome_quality )')` as a nested join. Requires FK `outcomes.session_id → sessions.id` to be correctly declared for PostgREST to resolve. If the join returns empty, swap to an explicit two-query pattern: fetch session IDs first, then query outcomes with `.in('session_id', sessionIds)`.

---

### 🔄 Pending (Sprint 15 — remaining)

- Structural retrieval upgrade from categorical to 14-dim vector scoring
- Railway cron for 30-day outcome nudges (infrastructure built, not wired)
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron + days_open tracking

### ❌ Not started

- Private benchmarking (aggregate anonymised dimension scores)
- Decision Graph (requires 20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

---

## SPRINT 15a TEST LOG

| Test | Description | Result |
|---|---|---|
| A | User with 0 outcomes → "No calibration data yet" + 0/3 dots | ✅ |
| B | User with 1–2 retro outcomes → correct count, "N more needed" copy | ✅ |
| C | User with ≥3 retro outcomes (pre may be null) → full chart renders | ✅ |
| D | Hover dots → tooltip shows correct date, pre/retro/delta per session | ✅ |
| E | Pre-Sprint-14 sessions (null pre_decision_confidence) → retro line renders, delta bars absent, avg pre hidden | ✅ |
| F | GET /api/mirror/calibration with valid Bearer → correct points + summary shape | ✅ |
| G | Auth token absent → 401, clean error card in UI | ✅ |

---

## SPRINT 14 TEST LOG

| Test | Description | Result |
|---|---|---|
| A | pre_decision_confidence slider visible on home page | ✅ |
| B | Slider value saved to sessions.pre_decision_confidence | ✅ |
| C | outcome_quality selector renders in OutcomeTracker | ✅ |
| D | retrospective_confidence slider renders | ✅ |
| E | calibration_delta computed and stored on submit | ✅ |
| F | Saved outcome state shows calibration_delta and colour-coded retro confidence | ✅ |
| G | Pre-Sprint-14 session (no pre_decision_confidence) → calibration_delta null, no error | ✅ |
| H | Light-mode: helped-badge text is white | ✅ |

---

## SPRINT 13 TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Paywall user sees named biases in blurred tiles | ✅ |
| B | Unlocked Mirror loads normally | ✅ |
| C | Email resolution failure → teaserBiases: [], no 500 | ✅ |
| D | R7 fires → REDIRECT, synthesis blocked | ✅ |
| E | R6 fires → FLAG in Council context | ✅ |
| F | R8 fires → FLAG; R12 suppressed | ✅ |
| G | R9 fires → FLAG; R9 suppressed when R4 active | ✅ |
| H | R10 fires → GATE, synthesis after examiner | ✅ |
| I | R12 fires (after widening guard to 2–3) | ✅ |
| J | R2 does NOT fire at identity_alignment = 4 | ✅ |
| K | R2 fires at identity_alignment = 5 | ✅ |
| L | R1 unaffected by R2 patch | ✅ |

---

## SPRINT 12 TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Contextual questions personalised to decision text (v2.0) | ✅ |
| B | Fallback to template question on forced AI error | ✅ |
| C | v1.0 session — gap-based path unchanged | ✅ |
| D | Council context injected in synthesis (Railway log) | ✅ |
| E | v1.0 session — synthesis no-op | ✅ |
| F | decision_brief — council context injected | ✅ |
| G | Examiner submit saves examiner_responses with rule_id | ✅ |
| H | examiner_status = 'submitted' after submit | ✅ |
| I | bias_library rows written after examiner submit | ✅ (after patch) |

**Verify bias_library rows for a session:**
```sql
SELECT bias_parameter, detection_count, asymmetry_score_avg, updated_at
FROM bias_library
WHERE session_ids @> ARRAY['<session_id>']::uuid[];
```
(`session_ids` is `uuid[]` — use array containment `@>`, not scalar equality)

---

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_PROVIDER          (anthropic | deepseek)
AI_MODEL             (claude-sonnet-4-20250514 | deepseek-chat)
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
```

---

## KEY DESIGN DECISIONS (do not re-debate)

1. **Ontology is fixed schema, not learned.** The 14-dim vector is the data structure that makes longitudinal pattern detection comparable. ML cannot replace it at current data volumes.

2. **Rule engine is deterministic.** No ML, no probabilistic routing. `upstream_dependency >= 5 → REDIRECT`. Auditable, explainable, zero false positive risk.

3. **Council personas all fire on every session.** No suppression by ontology profile. Grid reordering (not suppression) is the UX response. REDIRECT is the one exception — personas dim but still stream.

4. **REDIRECT blocks synthesis permanently.** GATE only gates until examiner submit. REDIRECT means the decision is genuinely premature.

5. **Categorical v1.0 fields retained alongside v2.0 scored vector.** Structural retrieval uses categorical fields until Sprint 15 upgrade.

6. **Two-pass Contradiction Detector.** Pass 1: extract principles. Pass 2: find violations. Do not replace with ML.

7. **Compounding moat is the Ledger, not the AI.** Every AI model is swappable. The `ontology_vector`, `rule_engine_result`, `examiner_responses`, and `outcomes` per session are the durable asset.

8. **REDIRECT vs GATE distinction is permanent.** Only cleared by Reanalyze (new session). Do not merge or make REDIRECT dismissible without a new session.

9. **Persona grid dims but does not suppress on REDIRECT.** Dim (55% opacity, pointer-events: none) is a visual signal, not a feature gate.

10. **R1 threshold is permanently 5.** REDIRECT is the highest-severity action. Score 4 produces false positives. Do not lower.

11. **`/api/bias-score` is the sole writer to `bias_library`.** No other route should call `scoreBiasesForSession` directly.

12. **R2 threshold is permanently 5.** `identity_alignment >= 4` fires on a majority of real sessions. Do not lower.

13. **R12 fires on decision_unit 2–3, not strictly 2.** Tagger correctly scores implied-stakeholder dyads as 3. Strict equality silently misses them.

14. **Bias trigger uses localhost, not req.url origin.** `fireBiasScore()` must use `http://localhost:${PORT}`. Railway containers calling their own public HTTPS endpoint hit SSL termination and silently skip all bias accumulation.

15. **Calibration dataReady threshold uses retro-only count, not paired count.** Pre-Sprint-14 sessions have `pre_decision_confidence = NULL`. Requiring both sides would permanently block existing users from seeing their calibration chart. Delta stats are conditionally hidden when pre data is absent; they populate naturally going forward.

16. **Decision type calibration threshold is permanently 90% confidence.** The straightforward/operational compression behaviour in `WORD_LIMIT_PREFIX` only activates at 90%+ confidence. Do not lower. False compression on ambiguous queries that look operational on the surface is worse than unnecessary depth.

17. **Synthesis opening lean is mandatory and must appear first.** The `SYNTHESIS` prompt requires the directional lean as the opening sentence. Do not revert to the old structure (consensus → tension → lean). The recommendation-first structure was implemented after user testing showed buried conclusions reduce trust even when reasoning quality is high.

18. **Strategic Possibilities in synthesis is optional and must not be forced.** The paragraph only appears when the council's analysis genuinely surfaces an unexplored alternative. It must never be a list of recommendations. If it becomes formulaic or appears in every synthesis, remove it.

20. **Pattern Observation in synthesis is mandatory when a pattern qualifies, and exempt from the 220-word limit.** The "optional" label was removed from the prompt header in Sprint 15b patch. Root cause: budget compression from the new mandatory opening lean + Strategic Possibilities was silently crowding out Pattern Observation as the last item. Fix: Pattern Observation is now counted separately. Do not reintroduce a shared word limit that forces the model to drop it. Do not add "optional" back to the header.

19. **Home page glow fires exactly once per mount.** The `inputGlowing` state is set by `setTimeout` inside the mount `useEffect` and is never re-triggered. Do not convert to a CSS animation loop. Do not add any mechanism that re-fires it on re-render.

---

## WEBSITE (quorum-website.html)

Separate static HTML file in repo root. Not part of Next.js routing.
Contradiction Detector session threshold needs verification against live code. Examiner step description updated to mention structured intervention. REDIRECT/GATE language is product-accurate but may need user-facing rewrite.

---

## RESEARCH ARCHITECTURE

Reference: `Quorum_Research_Architecture_v07.md`
Human IRR established for all 14 dimensions. R6–R12 implemented Sprint 13. R11 deferred (cron dependency).

---

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.xyz / invigorating-manifestation-production-ecd2.up.railway.app
- Railway: deployment from GitHub main branch
