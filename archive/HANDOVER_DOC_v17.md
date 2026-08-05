# QUORUM — Handover Document v17
### Date: May 2026 | Status: Sprint 16c complete (context show more · anti-template-repetition prompt · examiner question subtext · Fix 2 progressive disclosure reverted)
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

**Sprint 16c additions:** No new routes or schema changes.

---

## DATABASE SCHEMA (current as of Sprint 16c)

No schema changes in Sprint 16b or 16c. All tables unchanged from Sprint 15a.

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
  personas.ts              — ✅ Sprint 16c — anti-template-repetition instruction added to FORMAT block (item 3 in WORD_LIMIT_PREFIX); also Sprint 16b: PUSHBACK_DETECTION_PREFIX, LANGUAGE REGISTER (item 4), DECISION TYPE CALIBRATION renumbered to 5
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
  SessionView.tsx          — ✅ Sprint 16c — contextExpanded state + "↓ See more / ↑ See less" toggle on Context section (threshold: 120 chars); also Sprint 16b: redirectQuestion state, handleOverrideRedirect, handleShareContext fan-out
  PersonaPanel.tsx         — ✅ Sprint 16b — onShareContext, contextShared, StatusBadge pushback states ("Reading your challenge…" / "Responded"). Fix 2 progressive disclosure was implemented then reverted (Sprint 16c) — full response renders always; natural scroll is the right UX at 140–170 word constraint.
  ExaminerPanel.tsx        — ✅ Sprint 16c — RULE_HINTS map (R1–R12); italic subtext under each question label explaining why it matters; gap-derived subtext for non-rule questions; also Sprint 16b: redirectQuestion passed up on REDIRECT
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
| **16b** | **Fix 1: R1 confidence guard + override button + REDIRECT question display. Fix 3: pushback detection prefix + PersonaPanel status labels. Fix 4: Share context fan-out (one-shot post-pushback). Fix 5: Language register in WORD_LIMIT_PREFIX. — ✅ Deployed** |
| **16c** | **Context show more toggle. Anti-template-repetition instruction in personas. Examiner question subtext with RULE_HINTS map. Fix 2 progressive disclosure implemented and reverted — full text always shown. — ✅ Deployed** |

---

## CURRENT STATUS (as of Sprint 16c)

### Sprint 16c — Four changes

**Files changed:** `lib/personas.ts`, `components/SessionView.tsx`, `components/PersonaPanel.tsx`, `components/ExaminerPanel.tsx`
**No schema changes. No new routes. No new tables.**

---

#### Context section — "show more" toggle (SessionView.tsx)

**Problem:** The Context field was permanently clamped to a single line (`WebkitLineClamp: 1`). Users who added detailed context had no way to re-read it without re-opening the session.

**What changed:** New `contextExpanded` boolean state alongside the existing `decisionExpanded`. The Context block now applies `WebkitLineClamp: 1` only when collapsed. A "↓ See more / ↑ See less" toggle button appears when `context_text.length > 120` (threshold is lower than Decision's 220 because the context container is smaller-fonted and single-line by default). Behaviour is identical to the Decision expand pattern.

---

#### Anti-template-repetition — persona prompt (personas.ts)

**Problem:** Persona outputs exhibited detectable cadence sameness across all six advisors — constructions like "The real question is…", "The core tension is…", "The discriminating condition is…" appeared repeatedly, reducing perceived originality and persona distinctiveness even after language register was cleaned up in 16b.

**What changed:** A two-sentence instruction added immediately after the FORMAT rule in `WORD_LIMIT_PREFIX` (item 3), before LANGUAGE REGISTER (item 4): *"Do not announce your insight before delivering it. Never open a sentence with meta-framing constructions like 'The real question is…', 'The core tension is…', 'The discriminating condition is…', 'The specific reversal scenario…', or 'The point of irreversibility is…'. State the observation directly. The label is not the insight — the observation is."* Named constructions listed explicitly — vague instructions to "be direct" do not suppress this pattern. Applies to all six personas. Synthesis prompt unchanged.

---

#### Fix 2 — Persona card progressive disclosure (reverted)

Implemented (200-char preview + "Read full analysis →" expand) and reverted in the same sprint. Decision: the 140–170 word prompt constraint already caps card height to ~8–10 lines — not a wall. Truncation introduced a mandatory click at the highest-value moment (reading a new insight) on every card, every session. The right long-term solution to perceived grid density is ontology-driven card reordering (backlog), not content hiding. Full response renders always; natural page scroll handles the grid.

---

#### Fix 6 — Examiner question subtext / RULE_HINTS (ExaminerPanel.tsx)

**Problem:** Examiner questions surfaced by the rule engine felt generic and hard-coded to users who encountered them across multiple sessions, reducing engagement and answer quality.

**What changed:** New `RULE_HINTS` constant (Record<string, string>) defined at module level, mapping R1–R12 (excluding R11 which is not live) to one-sentence user-facing explanations of why each question matters. Example: `R7: 'Specific information exists that would change the right answer — your response helps identify what to gather first.'`

Each question label now has an italic 11px subtext rendered between the label and the textarea:
- **Rule questions** (`q.rule_id !== null`): shows `RULE_HINTS[q.rule_id]` — specific to what that rule is detecting
- **Gap questions** (`q.rule_id === null`): shows `Helps surface: {q.gap}` using the already-descriptive gap text (e.g. *"Helps surface: product strategy alignment not resolved"*)
- **Fallback** (unknown rule_id): `'Your answer helps the Council refine its assessment.'`

Styled at `var(--text-4)`, italic, `font-size: 11`, `line-height: 1.5`, margin `0 0 8px` — visible but clearly secondary to the question text.

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
28. **Share context fan-out (Sprint 16b Tier 1): one-shot button per pushback exchange. Passes pushback text to all other personas via the existing examinerContext mechanism. After all 5 update streams complete, synthesis re-runs automatically (synthesisVersion increments). No new routes. Tier 2 (standalone "Add context for all" field) is next sprint.**
29. **Language register (Sprint 16b): applies to all six persona prompts via WORD_LIMIT_PREFIX item 4. Does not apply to Synthesis. Does not change tone targets — Contrarian stays sharp, Elder stays measured. Only the vocabulary layer changes.**
30. **Anti-template-repetition (Sprint 16c): instruction lives inside FORMAT (item 3 of WORD_LIMIT_PREFIX), naming specific forbidden constructions explicitly. Vague "be direct" instructions do not suppress this pattern — named examples are required. Do not remove the named list.**
31. **Examiner RULE_HINTS (Sprint 16c): defined at module level in ExaminerPanel.tsx. Gap questions use `q.gap` text directly (already descriptive from the tagger). Rule questions use the RULE_HINTS map. R11 is intentionally absent (not live). Fallback string is "Your answer helps the Council refine its assessment." — do not remove the fallback.**
32. **Context "show more" threshold (Sprint 16c): 120 chars, lower than Decision's 220, because context is rendered at font-size 12 in a single-line container. Do not align both thresholds — they serve different container sizes.**
33. **R7 fires correctly on information-driven decisions with DDI ≥ 4 and outcome_uncertainty ≥ 4 even when upstream dependency is ambiguous. This is by design — if specific missing information would change the decision, synthesis before gathering it is misleading. Do not lower the R7 DDI threshold.**

---

## PENDING (next sprint — Sprint 17)

NOTE on Fix 6: confidence slider already has sufficient context copy on the home page ("This is your baseline. After the decision plays out, we'll measure how your confidence shifted — and what that pattern reveals about your judgment over time."). No further work needed. Closing permanently.

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

## SPRINT 16c TEST LOG

| Test | What to check | Expected |
|---|---|---|
| C1 | Context field > 120 chars → "↓ See more" button appears | 🔲 |
| C2 | Click "↓ See more" → full context visible, button reads "↑ See less" | 🔲 |
| C3 | Context field ≤ 120 chars → no toggle button shown | 🔲 |
| C4 | Context expand state resets on Reanalyze | 🔲 |
| T1 | Persona output does not open with "The real question is…" construction | 🔲 |
| T2 | Persona output does not open with "The core tension is…" construction | 🔲 |
| T3 | Hard-hitting point still lands — no analytical depth lost | 🔲 |
| T4 | Contrarian and Elder tones unchanged — only opening construction affected | 🔲 |
| E1 | Rule question (e.g. R7) → italic subtext appears below question label | 🔲 |
| E2 | R7 subtext reads "Specific information exists that would change the right answer…" | 🔲 |
| E3 | Gap question (rule_id null) → subtext reads "Helps surface: {gap text}" | 🔲 |
| E4 | Unknown rule_id → fallback subtext "Your answer helps the Council refine its assessment." | 🔲 |
| E5 | Subtext does not appear between question and textarea — confirm margin/spacing correct | 🔲 |

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
