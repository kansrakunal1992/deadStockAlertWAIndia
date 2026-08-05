# QUORUM — Handover Document v11
### Date: May 2026 | Status: Sprint 11a complete, 11b in progress
### Stack: Next.js 14 · Supabase (PostgreSQL) · Railway · Vercel · Anthropic / DeepSeek

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
GET /api/examiner         → reads rule_engine_result (v2.0) or gaps (v1.0) → returns questions + rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses → triggers contradiction run (if ≥5 sessions)
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → Decision Brief synthesis
        ↓ (Mirror, separate route)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts}
```

---

## DATABASE SCHEMA (all tables, current as of Sprint 11a)

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
pre_decision_confidence integer CHECK (1–10)   ← NEW Sprint 11a
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
rule_id            text    ← NEW Sprint 11a (R1–R12, null for v1.0 sessions)
created_at         timestamptz
```

### outcomes
```
id                      uuid PK
session_id              uuid UNIQUE FK → sessions
what_decided            text NOT NULL
council_helped          text CHECK ('yes','partially','no')
notes                   text
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')  ← NEW
retrospective_confidence integer CHECK (1–10)  ← NEW
calibration_delta       numeric                ← NEW (pre_decision_confidence - retrospective_confidence)
created_at              timestamptz
updated_at              timestamptz
```

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
User-level bias accumulation. `bias_parameter`, `detection_count`, `confidence_weight`, `asymmetry_score_avg`, `activation_contexts`, `outcome_confirmed_count`, `outcome_disconfirmed_count`.

### contradictions
User-level contradiction log. `principle_text`, `violation_text`, `principle_session_id`, `violation_session_id`, `severity`, `category`, `dismissed_at`.

### structural_matches / structural_scores
Cross-session structural similarity. Computed from categorical ontology fields (v1.0). Will upgrade to 14-dim vector scoring in Sprint 12.

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
    ontology/route.ts         — ★ REPLACED Sprint 11a — v2.0 tagger + rule engine
    examiner/route.ts         — GET: reads rule_engine_result (v2.0) or gaps (v1.0)
                                POST: saves examiner_responses, triggers contradiction run
    persona/route.ts          — streams persona responses (6 personas + synthesis)
    bias-score/route.ts       — bias scorer, updates bias_library
    structural-match/route.ts — cross-session structural similarity
    outcome/route.ts          — saves outcomes (calibration fields pending Sprint 12)
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
      status/route.ts         — mirror access check
      unlock/route.ts         — token validation for mirror access
    auth/route.ts             — Supabase auth
    auth/link-sessions/route.ts — links anonymous sessions to user on login
    brief-access/route.ts     — validates brief access tokens

lib/
  ontology-tagger.ts  ★ REPLACED Sprint 11a — 14-dim scored vector, tagger_version v2.0
  rule-engine.ts      ★ NEW Sprint 11a — R1–R5 deterministic rule evaluator
  personas.ts         — 6 persona system prompts + PERSONAS_WITH_STRUCTURAL_CONTEXT
  structural-retrieval.ts — OntologySnapshot, scoring, PERSONAS_WITH_STRUCTURAL_CONTEXT
  bias-scorer.ts      — bias detection AI call + structured output
  contradiction-detector.ts — two-pass contradiction pipeline
  independence-score.ts — independence scoring
  mirror-fingerprint.ts — fingerprint computation
  ai-client.ts        — provider abstraction (Anthropic / DeepSeek), createStream / createCompletion
  supabase.ts         — createServiceClient, createBrowserClient
  types.ts            — shared TypeScript types (PersonaKey, PersonaMeta, Message)
  storage.ts          — localStorage helpers

components/
  SessionView.tsx     ✅ Sprint 11b COMPLETE — ruleMode + redirectBlocked state, handleExaminerComplete(responses, mode), dim persona grid
  SynthesisCard.tsx   ✅ Sprint 11b COMPLETE — redirectBlocked prop, gates synthesis useEffect, upstream block card early return
  ExaminerPanel.tsx   ✅ Sprint 11b COMPLETE — onComplete(responses, ruleMode), REDIRECT banner, Acknowledge button
  PersonaPanel.tsx    — auto-fires on mount, handles pushback exchanges
  OutcomeTracker.tsx  — Sprint 12: add outcome_quality + retrospective_confidence fields
  MirrorTimeline.tsx, BiasFingerprint.tsx, DecisionRules.tsx, ContradictionDetector.tsx,
  IndependenceScore.tsx, BehaviorAlerts.tsx, OutcomeTracker.tsx, MemoryEngineStatus.tsx
  PatternTile.tsx, BriefCTA.tsx, RecordExport.tsx, ReanalyzeDrawer.tsx, SynthesisCard.tsx,
  AuthPanel.tsx, ThemeToggle.tsx

app/
  page.tsx            — landing / decision submission form
  session/[id]/page.tsx — session view
  mirror/page.tsx     — Mirror dashboard
  record/[id]/page.tsx — decision record (read-only, shareable)
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

**R6–R12:** Designed in research architecture v0.7. Implemented Sprint 12.

**Low confidence rule:** If triggering dimension has `confidence < 0.55`, rule downgrades from hard action to clarifying question. Prevents false positives on vague decision text.

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

**DB record:** `rule_engine_result.mode = 'REDIRECT'` stored in `sessions_ontology`. No synthesis row in `messages` table for REDIRECT sessions (synthesis never fires).

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
| **11a** | **14-dim ontology tagger (v2.0), rule-engine.ts (R1–R5), SQL migration — ✅ ALL TESTS PASSED** |
| **11b** | **REDIRECT synthesis block, ExaminerPanel rule_mode pass-through, dim persona grid — ✅ ALL TESTS PASSED** |
| **11c** | **Rule calibration: R1 threshold back to 5, R4 suppressed when R2 fires, upstream_dependency prompt tightened, REDIRECT banner shows specific rationale, dim fires immediately on REDIRECT detection (not on dismiss), SynthesisCard light-mode fix, typography system (Cormorant + DM Mono + Inter)** |
| 12 | Council context enrichment (buildCouncilContext), pre_decision_confidence UI, outcome_quality UI, R6–R12 rule engine, structural retrieval upgrade to 14-dim vector |

---

## CURRENT STATUS (as of Sprint 11b)

### ✅ Live and working (Sprint 11a + 11b + 11c)
- 14-dim ontology tagger (v2.0) — produces scored vector + rule engine result per session
- Rule Engine R1–R5 — deterministic, fires on every new session (async, post-tagger)
- Examiner GET — returns `rule_mode` + rule-derived questions for v2.0 sessions; v1.0 gap fallback intact
- Backward compat — all v1.0 sessions fully functional across all routes and Mirror modules
- ExaminerPanel — `rule_mode` captured from GET response, passed to `onComplete(responses, ruleMode)`
- SessionView — `ruleMode` + `redirectBlocked` state; `handleExaminerComplete` handles REDIRECT branch
- SynthesisCard — `redirectBlocked` prop gates synthesis useEffect; renders upstream block card on REDIRECT
- Persona grid — dims to 55% opacity + `pointer-events: none` on REDIRECT (personas still stream, marked provisional)
- Reanalyze — resets `ruleMode` and `redirectBlocked` state correctly on new session
- Rule Engine calibration: R1 threshold = 5 (REDIRECT is harshest action — requires max signal); R4 suppressed when R2 fires (same axis, removes repetitive 75yr framing); upstream_dependency prompt tightened (emotional charge explicitly excluded from scoring 4–5)
- REDIRECT banner: shows `upstream_dependency.rationale` from ontology_vector as specific context (not just generic question)
- ExaminerPanel: `onComplete([], 'REDIRECT')` fires immediately on REDIRECT detection — personas dim before user clicks dismiss; "Understood — dismiss" collapses panel locally only
- SynthesisCard: all hardcoded dark-hex and rgba(255,255,255,...) replaced with CSS vars — correct in light and dark mode
- Typography system: Cormorant Garamond (display), DM Mono (labels/mono), Inter (body); utility classes .t-display .t-label .t-mono; persona-card hairline gradient; font-size scale normalised to 11/13/15/17/22px

### 🔄 In progress / Sprint 12
- **Contextual rule questions** — small AI call takes rule_id + decision_text and generates a tailored version of the hardcoded question. Eliminates generic feel on repeat use. Highest-priority Sprint 12 item (direct UX impact).
- `rule_id` written to `examiner_responses` (column exists, not populated)
- `pre_decision_confidence` UI (column in DB, no form element yet)
- `outcome_quality` + `retrospective_confidence` in OutcomeTracker (columns in DB)
- `calibration_delta` computed on outcome submit
- Council persona context enrichment (buildCouncilContext wired to persona route)
- Railway cron for 30-day outcome nudges (infrastructure built, not wired)
- R6–R12 rule implementations
- Structural retrieval upgrade from 9-dim categorical to 14-dim scored vector
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals

### ❌ Not started (Sprint 13+)
- Calibration sparklines in Mirror
- Private benchmarking (aggregate anonymized dimension scores)
- Decision Graph (requires 20+ sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

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

1. **Ontology is fixed schema, not learned.** The 14-dim vector is the data structure that makes longitudinal pattern detection comparable. ML cannot replace it at current data volumes (< 500 sessions). See Research Architecture v0.7.

2. **Rule engine is deterministic.** No ML, no probabilistic routing. `upstream_dependency >= 5 → REDIRECT`. Auditable, explainable, zero false positive risk from model variance.

3. **Council personas all fire on every session.** No suppression by ontology profile. Grid reordering (not suppression) is the UX response to ontology signals. REDIRECT is the one exception — personas dim but still stream.

4. **REDIRECT blocks synthesis permanently.** GATE only gates until examiner submit. This is intentional — REDIRECT means the decision is genuinely premature, not just incomplete.

5. **Categorical v1.0 fields retained alongside v2.0 scored vector.** Structural retrieval uses categorical fields until Sprint 12 upgrade. Both formats coexist in `sessions_ontology`.

6. **Two-pass Contradiction Detector.** Pass 1: extract principles. Pass 2: find violations. Simultaneous-truth test as disqualifier. Do not replace with ML.

7. **Compounding moat is the Ledger, not the AI.** Every AI model in this system is swappable. The `ontology_vector`, `rule_engine_result`, `examiner_responses`, and `outcomes` per session are the durable asset.

8. **REDIRECT vs GATE distinction is permanent.** REDIRECT (`upstream_dependency ≥ 5`) blocks synthesis permanently — `redirectBlocked` is only cleared by Reanalyze (new session). GATE merely delays synthesis until examiner submit. This is intentional: REDIRECT signals the decision is structurally premature, not just incomplete. Do not merge these two modes or make REDIRECT dismissible without a new session.

9. **Persona grid dims but does not suppress on REDIRECT.** All 6 personas stream regardless of rule mode. The dim (55% opacity, pointer-events: none) on REDIRECT is a visual signal that their analysis is provisional, not a feature gate. Full suppression (personas not firing at all) is deferred to Sprint 12 and requires early tagger polling before allPersonasDone.

10. **R1 threshold is permanently 5, not 4.** REDIRECT is the highest-severity action in the product — it blocks synthesis and dims the Council. It must only fire when upstream_dependency is unambiguously maximum (5/5). Score 4 produces too many false positives (the "fire head of sales" decision scored upstream=4 on emotional context alone). If R1 is not firing enough, the fix is to tighten the ontology prompt (exclude non-external dependencies), not to lower the threshold.

---

## WEBSITE (quorum-website.html)

Separate static HTML file in repo root. Not part of Next.js routing. Served separately.

**Reviewed Sprint 11c:** Three changes identified — see Website_Review_Sprint11b.md. Contradiction Detector session threshold needs verification against live code. Examiner step description updated to mention structured intervention. Bias stat should be updated from live DB query. Optional hero addition: "Some decisions aren't ready to be decided. Quorum tells you when."
 REDIRECT/GATE language is product-accurate but may need user-facing rewrite. Pricing and feature list accurate as of Sprint 11b.

---

## RESEARCH ARCHITECTURE

Reference: `Quorum_Research_Architecture_v07.md`
Human IRR established for all 14 dimensions. No publication required to use in product.
R6–R12 rule logic defined in research doc — implement in Sprint 12 after R1–R5 validated on live sessions.

---

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.xyz
- Railway: deployment from GitHub main branch
- Vercel: (check if used alongside Railway for any routes)
