# QUORUM — Handover Document v16
### Date: May 2026 | Status: Sprint 16b complete (R1 confidence guard + override · REDIRECT question display · pushback detection prefix · language register · share context fan-out)
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

**Sprint 16b additions:**
- `PATCH /api/ontology` — logs `user_overrode_redirect: true` into `raw_ontology_json` when user overrides an R1 REDIRECT. No schema change required.

---

## DATABASE SCHEMA (current as of Sprint 16b)

No schema changes in Sprint 16b. All tables unchanged from Sprint 15a.

The R1 override flag is written into the existing `raw_ontology_json` JSONB column:
```json
{ "user_overrode_redirect": true, "user_overrode_redirect_at": "<ISO timestamp>" }
```
To query mis-fire frequency: `SELECT COUNT(*) FROM sessions_ontology WHERE raw_ontology_json->>'user_overrode_redirect' = 'true';`

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
pre_decision_confidence integer CHECK (1–10)   ← ✅ Sprint 14
created_at              timestamptz
```

### sessions_ontology
```
id                      uuid PK
session_id              uuid UNIQUE FK → sessions
tagger_version          text DEFAULT 'v1.0'    ← 'v2.0' for post-Sprint-11a sessions
tagger_status           text CHECK ('pending','complete','failed')
examiner_status         text CHECK ('pending','submitted','skipped')

-- CATEGORICAL FIELDS (v1.0, all retained) ──────────────────────────────────
decision_type_primary, decision_type_secondary[], stakes_reversibility,
stakes_bearer, stakes_timeline, has_stated_deadline, deadline_source,
deadline_credibility, counterparty_present, counterparty_alignment,
info_asymmetry, relationship_type, dominant_emotion, emotion_source,
emotion_analysis_aligned, stakeholder_count, hidden_stakeholder_probability,
instrumental_weight, constitutive_weight, examiner_gap_1/2/3, raw_ontology_json

-- NEW IN SPRINT 11a ──────────────────────────────────────────────────────────
ontology_vector         jsonb    ← 14-dim scored vector (score, confidence, rationale per dim)
rule_engine_result      jsonb    ← {mode, triggered_rules, flag_rules, evaluated_at}
```

**raw_ontology_json fields written by Sprint 16b:**
- `user_overrode_redirect` (boolean) — true when user clicked "This doesn't apply — continue to Council"
- `user_overrode_redirect_at` (ISO string) — timestamp of override

**ontology_vector dimensions (D1–D14):**
`reversibility`, `time_horizon`, `stakes_magnitude`, `outcome_uncertainty`, `ambiguity`, `task_complexity`, `decision_discriminating_info`, `time_pressure`, `decision_unit`, `value_conflict`, `emotional_intensity`, `identity_alignment` ⭐, `regret_asymmetry` ⭐, `upstream_dependency` ⭐
Each: `{ score: 1-5, confidence: 0-1, rationale: string }`, plus `vector_version: "v2.0"`

### outcomes
```
id                      uuid PK
session_id              uuid UNIQUE FK → sessions
what_decided            text NOT NULL
council_helped          text CHECK ('yes','partially','no')
notes                   text
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')
retrospective_confidence integer CHECK (1–10)  ← ✅ Sprint 14
calibration_delta       numeric                ← ✅ auto-computed (Sprint 14)
created_at, updated_at  timestamptz
```

### structural_scores ← Sprint 15c migration
```sql
-- Run once before deploying Sprint 15c (if not already done):
ALTER TABLE structural_scores
  ADD COLUMN IF NOT EXISTS scoring_mode     text,
  ADD COLUMN IF NOT EXISTS vector_similarity numeric;
```

### Other tables (unchanged)
`messages`, `bias_library`, `contradictions`, `examiner_responses`, `mirror_access`, `user_preferences`, `session_requests`, `brief_access_tokens`, `structural_matches`, `sessions_pending_outcomes` (view)

---

## CODEBASE MAP

```
lib/
  rule-engine.ts           — ✅ Sprint 16b — evaluateR1() confidence guard (< 0.55 → null, no REDIRECT)
  personas.ts              — ✅ Sprint 16b — PUSHBACK_DETECTION_PREFIX prepended; LANGUAGE REGISTER block (item 4 in WORD_LIMIT_PREFIX); DECISION TYPE CALIBRATION renumbered to 5
  structural-retrieval.ts  — ✅ Sprint 15c — 14-dim weighted cosine scorer + v1.0 categorical fallback
  ontology-tagger.ts, bias-scorer.ts, contradiction-detector.ts,
  independence-score.ts, mirror-fingerprint.ts, ai-client.ts, supabase.ts, types.ts, storage.ts

app/api/
  ontology/route.ts        — ✅ Sprint 16b — PATCH handler added: logs user_overrode_redirect into raw_ontology_json
  structural-match/route.ts — ✅ Sprint 15c — ontology_vector + tagger_version in SELECTs + snapshots
  mirror/calibration/route.ts — ✅ Sprint 15a
  [all other routes unchanged from Sprint 14]

components/
  SynthesisCard.tsx        — ✅ Sprint 16b — redirectQuestion prop: shows R1 question in REDIRECT banner; onOverrideRedirect prop + button ("This doesn't apply — continue to Council")
  SessionView.tsx          — ✅ Sprint 16b — redirectQuestion state; handleOverrideRedirect (PATCH + unblock); handleShareContext (fan-out); onShareContext wired to PersonaPanel grid
  PersonaPanel.tsx         — ✅ Sprint 16b — onShareContext prop; contextShared state; "Share this context with all advisors" button (post-pushback, one-shot); StatusBadge: "Reading your challenge…" + "Responded" states
  ExaminerPanel.tsx        — ✅ Sprint 16b — onComplete third arg: redirectQuestion? string passed up when mode=REDIRECT
  AuthPanel.tsx            — ✅ Sprint 15d — magic link "waiting room" sent state
  CalibrationSparkline.tsx — ✅ Sprint 15a
  [all other components unchanged]

app/
  page.tsx                 — ✅ Sprint 15b — one-time input glow on mount
  mirror/page.tsx          — ✅ Sprint 15a — CalibrationSparkline wired into UnlockedView

Static:
  quorum-website.html      — ✅ Sprint 15d — decision examples grid + feature tiles + calibration card unlocked
```

---

## SPRINT HISTORY

| Sprint | What shipped |
|---|---|
| 1–10 | Core session flow, personas, examiner, Mirror, PDF, outcome tracker, bias scorer |
| 11a | 14-dim ontology tagger (v2.0), rule engine R1–R5, SQL migration |
| 11b | REDIRECT synthesis block, ExaminerPanel rule_mode pass-through, dim persona grid |
| 11c | Rule calibration: R1 threshold → 5, R4 suppresses R2, REDIRECT banner rationale |
| 12 | Contextual rule questions, Council context enrichment (buildCouncilContext), bias trigger fix |
| 13 | Mirror status fix, R6–R12 implementations, R2 threshold → 5, R12 range fix, SSL bias fix |
| 14 | Calibration loop: pre_decision_confidence slider, outcome_quality, retrospective_confidence, calibration_delta |
| **15a** | **Calibration Sparklines in Mirror — ✅ PASSED** |
| **15b** | **UX + Reasoning Quality: prompt architecture (decision type calibration, pushback protocol, synthesis recommendation-first, strategic possibilities, pattern observation) + home glow — ✅ PASSED** |
| **15c** | **Structural Retrieval upgrade to 14-dim weighted cosine vector — ✅ PASSED** |
| **15d** | **AuthPanel magic link UX + website decision examples + feature tiles — ✅ PASSED** |
| **15e** | **Council reasoning quality: Risk Architect structural alternative slot + Strategic Possibilities revised — ✅ PASSED** |
| **16b** | **Fix 1: R1 confidence guard (< 0.55 → no fire) + override button + REDIRECT question display. Fix 3: pushback detection prefix at top of prompt + PersonaPanel status labels. Fix 4: Share context fan-out to all advisors (one-shot button post-pushback). Fix 5: Language register block in WORD_LIMIT_PREFIX. — Testing in progress** |

---

## CURRENT STATUS (as of Sprint 16b)

### Sprint 16b — Four fixes

**Files changed:** `lib/rule-engine.ts`, `lib/personas.ts`, `components/PersonaPanel.tsx`, `components/SessionView.tsx`, `components/SynthesisCard.tsx`, `app/api/ontology/route.ts`
**No schema changes. No new tables.**

---

#### Fix 1 — Rule Engine: R1 confidence guard + user override + question display

**Problem:** R1 (Upstream Dependency Block) fired REDIRECT on `upstream_dependency.score >= 5` regardless of tagger confidence. Low-confidence score 5 (e.g. 0.40–0.54) created false positive blocks on normal decisions. The REDIRECT banner showed only generic copy — no specific question to resolve. The only dismissal action was "Understood — dismiss" with no escape hatch.

**What changed:**

**`lib/rule-engine.ts`** — `evaluateR1()` now returns `null` when `dim.confidence < LOW_CONFIDENCE_THRESHOLD` (0.55). The score threshold stays at 5 permanently (design decision #10). Low-confidence tagger results now produce no R1 effect at all — neither REDIRECT nor clarifying question.

**`app/api/ontology/route.ts`** — New `PATCH` handler. Called when user clicks "This doesn't apply". Writes `{ user_overrode_redirect: true, user_overrode_redirect_at: <ISO> }` into the session's `raw_ontology_json` JSONB column. Non-blocking — UI override completes even if write fails.

**`components/ExaminerPanel.tsx`** — `onComplete` gains an optional third argument `redirectQuestion?: string`. When mode is REDIRECT, `data.questions[0]?.text` is passed up in the closure (before `setQuestions` state settles).

**`components/SessionView.tsx`** — New `redirectQuestion` state captures the R1 question text from `handleExaminerComplete`. Forwarded to SynthesisCard. New `handleOverrideRedirect` callback: fires PATCH to log override, then sets `redirectBlocked = false`, `ruleMode = null`, `examinerReady = true` — synthesis fires immediately (personas are already done).

**`components/SynthesisCard.tsx`** — Two new props: `redirectQuestion?: string` and `onOverrideRedirect?: () => void`. REDIRECT body now branches: when `redirectQuestion` is present, shows a labelled callout box with the specific question text at 14.5px/500 weight in a gold-bordered panel under "Resolve this before returning". Override button "This doesn't apply — continue to Council" sits below the Reanalyze instruction, styled as a secondary ghost action.

---

#### Fix 3 — Pushback protocol: detection at top of prompt

**Problem:** The pushback classification protocol sat at the bottom of `WORD_LIMIT_SUFFIX`, after 2000+ words of persona identity prompts. Models deprioritised late instructions. Personas opened pushback responses with their own analytical position rather than acknowledging what the user introduced — users felt unheard.

**What changed:**

**`lib/personas.ts`** — New `PUSHBACK_DETECTION_PREFIX` constant prepended before `WORD_LIMIT_PREFIX` in all six persona prompts. Content: instructs model to scan conversation history first, detect pushback mode if a user message follows an assistant response, and make the first sentence name exactly what the user introduced. Includes explicit warning: "Failure to open with acknowledgment of the specific input is the most common error in pushback mode. Do not make it." The full classification protocol (WEAK / PARTIALLY VALID / MATERIALLY VALID / RECOMMENDATION-CHANGING) in `WORD_LIMIT_SUFFIX` is unchanged.

**`components/PersonaPanel.tsx`** — `StatusBadge` gains two new states: (1) `isPushingBack === true` → pulsing gold "Reading your challenge…" label, shown as soon as pushback is submitted; (2) `panelState === 'done' && exchanges.length > 0` → green "Responded" label with reply-arrow icon, shown once the exchange completes.

---

#### Fix 4 — Share context with all advisors (Tier 1)

**Problem:** Pushback submitted to one persona with new information (e.g. "there's already a signed term sheet") reached only that card. Users had to repeat themselves five more times. Most didn't — collapsing six-advisor value to one.

**What changed:**

**`components/PersonaPanel.tsx`** — New `onShareContext?: (text: string) => void` prop. New `contextShared` boolean state. After a pushback exchange completes (`isPushingBack === false`, `panelState === 'done'`, `exchanges.length > 0`, `!contextShared`), a one-shot blue "Share this context with all advisors" button appears below the reply block. On click: calls `onShareContext(lastExchange.user)`, sets `contextShared = true` (button disappears permanently). Button uses the share-icon SVG at blue-400 palette, matching the examiner update colour family.

**`components/SessionView.tsx`** — New `handleShareContext(originPersonaKey, text)` callback. Builds an examinerContext message prefixed with "The user submitted the following new information while challenging another advisor…" and fans it out to all `PERSONA_ORDER` entries except `originPersonaKey` via `setExaminerContextByPersona`. Reuses the existing examiner update stream mechanism — no new API routes, no synthesis re-run, original analyses preserved.

**Tier 2 (next sprint):** Standalone "Add context for all advisors" input field not yet implemented.

---

#### Fix 5 — Language register

**Problem:** Persona outputs used technical vocabulary and formal register that users described as "flowery" or "jargonish". Analytical depth was correct; surface language created friction.

**What changed:**

**`lib/personas.ts`** — New `LANGUAGE REGISTER` block added as item 4 in `WORD_LIMIT_PREFIX`, between FORMAT (item 3) and DECISION TYPE CALIBRATION (renumbered to item 5). Instructions: write as a highly intelligent person speaking directly, not as a report; avoid nominalisations and Latinate abstractions; use technical terms only when load-bearing and never as decoration; prefer short SVO sentences for hardest-hitting points. Applies to all six personas. Does not apply to Synthesis (which has its own prompt).

---

## RULE ENGINE (lib/rule-engine.ts)

| Rule | Type | Trigger | Status |
|---|---|---|---|
| R1 — Upstream Dependency Block | REDIRECT | `upstream_dependency ≥ 5` AND `confidence ≥ 0.55` | ✅ live (confidence guard added Sprint 16b) |
| R2 — Identity-First Gate | GATE | `identity_alignment ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R3 — No-Information Mode | GATE | `decision_discriminating_info ≤ 1 AND outcome_uncertainty ≥ 4` | ✅ live |
| R4 — Regret Asymmetry Alert | FLAG | `regret_asymmetry ≥ 5` | ✅ live |
| R5 — False Urgency Detector | FLAG | `emotional_intensity ≥ 4 AND time_pressure ≤ 2` | ✅ live |
| R6 — Multi-Party Alignment | FLAG | `decision_unit ≥ 3 AND emotional_intensity ≥ 4` | ✅ live |
| R7 — Information-First | REDIRECT | `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 3` | ✅ live |
| R8 — Irreconcilable Values | FLAG | `value_conflict ≥ 5 AND identity_alignment ≥ 4` | ✅ live |
| R9 — Irreversibility Warning | FLAG | `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4` | ✅ live |
| R10 — Complexity Overload | GATE | `task_complexity ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R11 — Avoidance Detection | BACKGROUND | `upstream_dependency ≥ 4 AND days_open ≥ 45` | 🔲 deferred (needs cron) |
| R12 — Couple Misalignment | FLAG | `decision_unit 2–3 AND value_conflict ≥ 4` | ✅ live |

**Suppression:** R9 suppressed when R4 fires. R12 suppressed when R8 fires.
**Evaluation order:** R1 → R7 (REDIRECTs) → GATE rules → FLAG rules.
**Low confidence:** If triggering dim has `confidence < 0.55`, rule downgrades to clarifying question (R2–R12) or does not fire at all (R1 — Sprint 16b).

---

## KEY DESIGN DECISIONS (do not re-debate)

1. Ontology is fixed schema, not learned. The 14-dim vector is the data structure that makes longitudinal pattern detection comparable.
2. Rule engine is deterministic. `upstream_dependency >= 5 → REDIRECT`. Auditable, zero false positive risk.
3. Council personas all fire on every session. Grid reordering (not suppression) is the UX response.
4. REDIRECT blocks synthesis permanently. GATE only gates until examiner submit.
5. Categorical v1.0 fields retained alongside v2.0 scored vector. Mixed comparisons fall back to categorical automatically.
6. Two-pass Contradiction Detector. Do not replace with ML.
7. Compounding moat is the Ledger, not the AI. `ontology_vector`, `rule_engine_result`, `examiner_responses`, `outcomes` per session are the durable asset.
8. REDIRECT vs GATE distinction is permanent. Only cleared by Reanalyze (new session) — or user override (Sprint 16b).
9. Persona grid dims but does not suppress on REDIRECT. Dim (55% opacity, pointer-events: none) is a visual signal, not a feature gate.
10. R1 threshold is permanently 5. Do not lower.
11. `/api/bias-score` is the sole writer to `bias_library`.
12. R2 threshold is permanently 5. `identity_alignment >= 4` fires on a majority of real sessions.
13. R12 fires on decision_unit 2–3, not strictly 2.
14. Bias trigger uses localhost, not req.url origin. Railway containers calling their own public HTTPS endpoint hit SSL termination and silently skip all bias accumulation.
15. Calibration dataReady threshold uses retro-only count, not paired count. Pre-Sprint-14 sessions have `pre_decision_confidence = NULL`.
16. Decision type calibration threshold is permanently 90% confidence (WORD_LIMIT_PREFIX). Do not lower.
17. Synthesis opening lean is mandatory and must appear first. Do not revert to old structure.
18. Strategic Possibilities in synthesis fires on three explicit trigger conditions: (a) binary with unvalidated premise, (b) complicating factors the binary ignores, (c) convergence dependent on a testable premise. Max 2 structurally distinct paths. Each path names what it would test or resolve. Still optional — omit when no genuine alternative exists. 220-word cap covers P1–P3 + Strategic Possibilities combined.
19. Risk Architect structural alternative slot (conditional): fires only when assumption risk analysis reveals the binary rests on an unvalidated premise AND a lower-commitment path could test it. One concrete alternative named with specific mechanism. Appended after diagnostic question. Exempt from the three-risk depth constraint. Omit when binary is the only available structure.
20. Home page glow fires exactly once per mount. Do not loop or re-trigger.
21. Pattern Observation in synthesis is mandatory when a pattern qualifies, and exempt from the 220-word limit.
22. Structural retrieval ⭐ dimension weights are permanently 1.5× for identity_alignment, regret_asymmetry, upstream_dependency. Do not flatten to 1.0×.
23. Structural retrieval product threshold is 5 past sessions regardless of corpus size.
24. AuthPanel "waiting room" sent state uses imperative language ("Open your inbox now") and a pulsing indicator. Do not soften the copy or remove the pulse.
25. **R1 confidence guard (Sprint 16b): `upstream_dependency.score >= 5` with `confidence < 0.55` does not fire R1 at all — returns null. The score threshold stays at 5. Only the confidence gate is new.**
26. **R1 user override (Sprint 16b): "This doesn't apply — continue to Council" in SynthesisCard unblocks synthesis by setting redirectBlocked=false and examinerReady=true. Override is logged non-blocking to raw_ontology_json. This is not Reanalyze — it is an in-session escape hatch for mis-fires only.**
27. **PUSHBACK_DETECTION_PREFIX (Sprint 16b): Appears before all other instructions in every persona system prompt. Instructs the model to detect pushback mode and open with acknowledgment of what the user introduced. The classification protocol in WORD_LIMIT_SUFFIX is unchanged — only the detection trigger and opening instruction moved to the top.**
28. **Share context fan-out (Sprint 16b Tier 1): one-shot button per pushback exchange. Passes pushback text to all other personas via the existing examinerContext mechanism. No synthesis re-run. No new routes. Tier 2 (standalone "Add context for all" field) is next sprint.**
29. **Language register (Sprint 16b): applies to all six persona prompts via WORD_LIMIT_PREFIX item 4. Does not apply to Synthesis. Does not change tone targets — Contrarian stays sharp, Elder stays measured. Only the vocabulary layer changes.**

---

## PENDING (next sprint — Sprint 16c)

- **Fix 2:** Persona card progressive disclosure — show first ~200 chars, "Read full analysis →" expand on done state
- **Fix 6:** Confidence slider copy — one line of context below slider; outcome nudge in Memory Engine section after 3+ sessions with no logged outcomes
- **Share context Tier 2:** Standalone "Add context for all advisors" input field (not tied to a pushback exchange)
- Railway cron for 30-day outcome nudges (infrastructure built — `sessions_pending_outcomes` view exists — not wired)
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron + days_open tracking

---

## NOT STARTED

- Private benchmarking (aggregate anonymised dimension scores)
- Decision Graph (requires ~20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

---

## SPRINT 16b TEST LOG

| Test | Description | Expected |
|---|---|---|
| 1A | Low-confidence score-5 session → no REDIRECT fires | 🔲 |
| 1B | Low-confidence score-5 → SynthesisCard shows normal synthesis, no blocked banner | 🔲 |
| 1F | Genuine R1 REDIRECT → SynthesisCard body shows specific R1 question in callout box | 🔲 |
| 1J | Override button present in REDIRECT banner | 🔲 |
| 1K | Click override → SynthesisCard unblocks, synthesis streams | 🔲 |
| 1N | Override → raw_ontology_json contains user_overrode_redirect: true | 🔲 |
| 3A | Pushback response opens with acknowledgment of what user introduced | 🔲 |
| 3G | StatusBadge shows "Reading your challenge…" while isPushingBack | 🔲 |
| 3H | StatusBadge shows "Responded" after pushback completes | 🔲 |
| 4A | Post-pushback "Share this context with all advisors" button appears | 🔲 |
| 4D | Share button disappears after click, does not reappear | 🔲 |
| 4F | Other 5 personas show blue update block with shared context | 🔲 |
| 4G | Originating persona does not receive context again | 🔲 |
| 5A | No nominalisations in persona outputs | 🔲 |
| 5E | Contrarian tone still sharp after language register change | 🔲 |

---

## SPRINT 15c TEST LOG

| Test | What to check | Result |
|---|---|---|
| A | New v2.0 session scored against 50 v1.0 past sessions → Railway log: 2 matches, threshold_met: true | ✅ |
| B | `structural_scores` rows after SQL migration: all 50 show `scoring_mode = 'categorical'` (mixed pairs) | Expected ✅ |
| C | Two v2.0 sessions scored against each other → `scoring_mode = 'vector'`, `vector_similarity` ~0.80–1.0 | Pending (need ≥2 v2.0 sessions) |
| D | Annotation for v2.0 match → mentions specific dim labels, not old 5-category breakdown | Pending |
| E | V1.0 session scored → categorical path, scores unchanged from pre-Sprint-15c | ✅ |
| F | `structural_scores` upsert: 50 rows written in 3 batches (20+20+10) | ✅ |

---

## SPRINT 15b TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Home page loads → textarea glows once ~600ms after mount, fades by ~2400ms | ✅ |
| B | Glow does not repeat | ✅ |
| C | Straightforward query → concise response, no philosophical framing | ✅ |
| D | Complex query → full depth, calibration does not compress | ✅ |
| E | Weak pushback → persona holds, explains specific logical gap | ✅ |
| F | Materially valid pushback → persona updates explicitly | ✅ |
| G | Strong user point → acknowledged directly, what still stands surfaced | ✅ |
| H | Synthesis opens with directional lean in first sentence | ✅ |
| I | Synthesis lean is concrete, not hedged | ✅ |
| J | Strategic possibilities fires on binary decision with unvalidated premise (trigger a) | 🔲 retest |
| K | Strategic possibilities fires when complicating factors ignored by binary (trigger b) | 🔲 retest |
| N | Strategic possibilities fires when convergence rests on testable premise (trigger c) | 🔲 retest |
| O | Strategic possibilities surfaces max 2 structurally distinct paths | 🔲 retest |
| P | Risk Architect structural alternative slot fires on Head-of-Sales-class decision | 🔲 retest |
| Q | Risk Architect structural alternative slot absent when binary is only available structure | 🔲 retest |
| L | Clarification mode synthesis still orients first | ✅ |
| M | Paras 1–3 + Strategic Possibilities ≤ 220 words | ✅ |

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

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.xyz / invigorating-manifestation-production-ecd2.up.railway.app
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
