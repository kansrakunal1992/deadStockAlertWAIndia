# QUORUM — Handover Document v13
### Date: May 2026 | Status: Sprint 13 complete (with patches)
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
GET /api/examiner         → reads rule_engine_result (v2.0) or gaps (v1.0)
                            → personalises each rule question to decision_text (Sprint 12)
                            → returns questions  rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses (with rule_id) → fires /api/bias-score (non-blocking)
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → synthesis with buildCouncilContext injected into system prompt (Sprint 12)
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
pre_decision_confidence integer CHECK (1–10)   ← column exists, UI pending Sprint 13
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
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')  ← column exists, UI pending Sprint 13
retrospective_confidence integer CHECK (1–10)  ← column exists, UI pending Sprint 13
calibration_delta       numeric                ← column exists, compute on submit (pending Sprint 13)
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
User-level bias accumulation. **One row per (user × bias_parameter) — not per session.**
Key columns: `user_email`, `user_id`, `device_id`, `session_ids uuid[]`, `bias_parameter`, `detection_count`, `confidence_weight`, `asymmetry_score_avg`, `activation_contexts jsonb`, `outcome_confirmed_count`, `outcome_disconfirmed_count`.
Unique constraint: `(user_email, bias_parameter)`.
Identity resolution order: `user_id` → `user_email` → `device_id` → anonymous (INSERT only, no accumulation).
**Only `/api/bias-score` writes to this table. No other route should insert here.**

### contradictions
User-level contradiction log. `principle_text`, `violation_text`, `principle_session_id`, `violation_session_id`, `severity`, `category`, `dismissed_at`.

### structural_matches / structural_scores
Cross-session structural similarity. Computed from categorical ontology fields (v1.0). Upgrade to 14-dim vector scoring pending Sprint 13.

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
    ontology/route.ts         — ★ REPLACED Sprint 11a — v2.0 tagger  rule engine
    examiner/route.ts         — ★ Sprint 12 — GET: personalises rule questions to decision_text
                                              POST: saves examiner_responses, fires /api/bias-score
    persona/route.ts          — ★ Sprint 12 — synthesis/decision_brief: injects buildCouncilContext
                                  all other persona calls unchanged
    bias-score/route.ts       — bias scorer, identity resolution, bias_library upsert
                                SOLE WRITER to bias_library
    structural-match/route.ts — cross-session structural similarity
    outcome/route.ts          — saves outcomes (calibration fields in DB, UI pending Sprint 13)
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
      status/route.ts         — ⚠ KNOWN BUG: queries bias_library by .eq('user_id', userId)
                                  should be .eq('user_email', userEmail) — fix Sprint 13 Item 1
      unlock/route.ts         — token validation for mirror access
    auth/route.ts             — Supabase auth
    auth/link-sessions/route.ts — links anonymous sessions to user on login
    brief-access/route.ts     — validates brief access tokens

lib/
  ontology-tagger.ts  — 14-dim scored vector, tagger_version v2.0
  rule-engine.ts      — R1–R5 live; R6–R12 fully spec'd as stubs (Sprint 13 Item 2)
                        buildCouncilContext() — structured decision block injected into synthesis
  personas.ts         — 6 persona system prompts  PERSONAS_WITH_STRUCTURAL_CONTEXT
  structural-retrieval.ts — OntologySnapshot, scoring, PERSONAS_WITH_STRUCTURAL_CONTEXT
  bias-scorer.ts      — bias detection AI call  structured output (called only from /api/bias-score)
  contradiction-detector.ts — two-pass contradiction pipeline
  independence-score.ts — independence scoring
  mirror-fingerprint.ts — fingerprint computation
  ai-client.ts        — provider abstraction (Anthropic / DeepSeek), createStream / createCompletion
  supabase.ts         — createServiceClient, createBrowserClient
  types.ts            — shared TypeScript types (PersonaKey, PersonaMeta, Message)
  storage.ts          — localStorage helpers

components/
  SessionView.tsx     ✅ Sprint 11b COMPLETE — ruleMode  redirectBlocked state, handleExaminerComplete(responses, mode), dim persona grid
  SynthesisCard.tsx   ✅ Sprint 11b COMPLETE — redirectBlocked prop, gates synthesis useEffect, upstream block card early return
  ExaminerPanel.tsx   ✅ Sprint 11b COMPLETE — onComplete(responses, ruleMode), REDIRECT banner, Acknowledge button
  PersonaPanel.tsx    — auto-fires on mount, handles pushback exchanges
  OutcomeTracker.tsx  — outcome_quality  retrospective_confidence fields pending Sprint 13
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

**R6–R12 — Fully spec'd in stubs, implementation Sprint 13 Item 2:**

| Rule | Type | Trigger |
|---|---|---|
| R6 — Multi-Party Alignment | FLAG | `decision_unit >= 3 AND emotional_intensity >= 4` |
| R7 — Information-First | REDIRECT | `decision_discriminating_info >= 4 AND outcome_uncertainty >= 3 AND identity_alignment <= 3` |
| R8 — Irreconcilable Values | FLAG | `value_conflict >= 5 AND identity_alignment >= 4` |
| R9 — Irreversibility Warning | FLAG | `reversibility >= 4 AND time_pressure <= 2 AND emotional_intensity >= 4` |
| R10 — Complexity Overload | GATE | `task_complexity >= 5 AND ambiguity >= 4` |
| R11 — Avoidance Detection | BACKGROUND | Requires cron — defer post-Sprint 13 |
| R12 — Couple Misalignment | FLAG | `decision_unit == 2 AND value_conflict >= 4` |

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

**Reset:** User clicks Reanalyze → `handleReanalyze()` → new session → `setRuleMode(null)`  `setRedirectBlocked(false)`

**DB record:** `rule_engine_result.mode = 'REDIRECT'` stored in `sessions_ontology`. No synthesis row in `messages` table for REDIRECT sessions (synthesis never fires).

## SPRINT HISTORY

| Sprint | What shipped |
|---|---|
| 1 | Basic session submission  6 persona streaming |
| 2 | Supabase persistence, session record |
| 3 | Examiner phase 1 gate (synthesis gated on examiner) |
| 4 | Mirror access gate, bias scorer |
| 5 | Structural retrieval  structural context injection |
| 6 | Contradiction Detector two-pass pipeline |
| 7 | Mirror launch: Timeline, Fingerprint, Independence, Rules, Contradictions |
| 8 | PDF brief, brief access tokens, clarification register mode |
| 9 | Outcome tracker, ReanalyzeDrawer, record export |
| 10 | Examiner tightening, PASS2_PROMPT refinement, codebase audit |
| **11a** | **14-dim ontology tagger (v2.0), rule-engine.ts (R1–R5), SQL migration — ✅ ALL TESTS PASSED** |
| **11b** | **REDIRECT synthesis block, ExaminerPanel rule_mode pass-through, dim persona grid — ✅ ALL TESTS PASSED** |
| **11c** | **Rule calibration: R1 threshold back to 5, R4 suppressed when R2 fires, upstream_dependency prompt tightened, REDIRECT banner shows specific rationale, dim fires immediately on REDIRECT detection (not on dismiss), SynthesisCard light-mode fix, typography system (Cormorant  DM Mono  Inter)** |
| **12** | **Contextual rule questions (personalised to decision_text), Council context enrichment
           (buildCouncilContext → synthesis system prompt), POST handler reconstruction,
           bias trigger fix — ✅ ALL TESTS PASSED** |
| **13** | **Mirror status fix (bias_library user_email query), R6–R12 rule implementations,
           post-test patches: R2 threshold → 5, R12 range widened 2–3, SSL bias trigger fix
           — ✅ ALL TESTS PASSED** |

---

## CURRENT STATUS (as of Sprint 13)

### ✅ Live and working

Everything from Sprint 11a / 11b / 11c, plus:

**Sprint 12 — Contextual Rule Questions** (`app/api/examiner/route.ts` GET)
- `personaliseRuleQuestion()`: parallel AI call per rule (80 tokens, `createCompletion`), rewrites template question using decision-specific language. Falls back to template on any failure.
- `decision_text` fetched from `sessions` in parallel with ontology query — no serial cost.
- v1.0 sessions unaffected (gap-based path unchanged).

**Sprint 12 — Council Context Enrichment** (`app/api/persona/route.ts`)
- For `synthesis` and `decision_brief` calls: fetches `sessions_ontology`, calls `buildCouncilContext(ontology_vector, rule_engine_result)`, prepends structured decision-structure block to system prompt.
- Runs in parallel with message construction — no added latency. Only fires for v2.0 sessions — no-op otherwise. No client-side changes.

**Sprint 12 — POST handler reconstruction** (`app/api/examiner/route.ts` POST)
- Was absent from Sprint 11a paste (which replaced the entire file with only a GET handler).
- Saves `examiner_responses` with `rule_id`, updates `examiner_status = 'submitted'`.
- Fires `/api/bias-score` as background non-blocking call. Also fires on skip path.

**Sprint 12 patch — Bias trigger corrected**
- Original POST had inline `triggerBiasScoring()` calling `scoreBiasesForSession` directly and inserting into `bias_library` with nonexistent columns (`bias_key`, `prosecutor_score` etc.).
- Fixed: replaced with `fireBiasScore()` — background `fetch` to `/api/bias-score`. Base URL from `new URL(req.url).origin`. `/api/bias-score` owns all accumulation logic.

**Sprint 13 — Mirror Status Fix** (`app/api/mirror/status/route.ts`)
- Teaser biases query fixed: resolves `userEmail` via
  `supabase.auth.admin.getUserById(userId)` then queries
  `bias_library` with `.eq('user_email', userEmail)`.
- Failure path: try/catch returns `teaserBiases: []` — generic placeholder,
  no 500.
- Paywall conversion hook now surfaces real named biases in blurred tiles.

**Sprint 13 — R6–R12 Rule Engine** (`lib/rule-engine.ts`)
- R6 (Multi-Party Alignment), R7 (Information-First Redirect), R8
  (Irreconcilable Values), R9 (Irreversibility Warning), R10 (Complexity
  Overload), R12 (Couple Misalignment) — all implemented.
- R11 (Avoidance Detection) deferred — requires cron  `days_open` tracking.
- Suppression pairs: R9 suppressed when R4 fires; R12 suppressed when R8 fires.
- `buildCouncilContext()` enrichment block wired into synthesis system prompt.
- R7 is a REDIRECT — evaluation order: R1 → R7 → GATE rules → FLAG rules.

**Sprint 13 patches (applied post live-session testing)**
- R2 threshold raised: `identity_alignment >= 4` → `>= 5`. Conservative
  threshold preserves discriminant validity — permissive threshold fired on
  majority of real sessions.
- R12 guard widened: `unit.score !== 2` → `unit.score >= 2 && <= 3`.
  Tagger correctly scores implied-stakeholder dyads (couple with children,
  two founders with downstream team) as 3 — strict equality caused silent
  misses on all such sessions.
- SSL bias trigger fix: `fireBiasScore()` was deriving base URL from
  `req.url` (public HTTPS). Railway containers calling their own public
  endpoint hit SSL termination — `ERR_SSL_PACKET_LENGTH_TOO_LONG`. Fixed:
  `http://localhost:${process.env.PORT ?? '8080'}`. Bias accumulation was
  silently skipping every session; Ledger data was not being written.

(no known active bugs as of Sprint 13)

### 🔄 Pending (Sprint 13)

### 🔄 Pending (Sprint 14)

- `pre_decision_confidence` UI (column in DB, no form element)
- `outcome_quality`  `retrospective_confidence` in OutcomeTracker (columns in DB, no UI)
- `calibration_delta` computed on outcome submit
- Structural retrieval upgrade from categorical to 14-dim vector scoring
- Railway cron for 30-day outcome nudges (infrastructure built, not wired)
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron  days_open tracking

### ❌ Not started (Sprint 14)

- Calibration sparklines in Mirror
- Private benchmarking (aggregate anonymized dimension scores)
- Decision Graph (requires 20 sessions per user)
- Hybrid semantic  ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

---

## SPRINT 12 TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Contextual questions personalised to decision text (v2.0 session) | ✅ |
| B | Fallback to template question on forced AI error | ✅ |
| C | v1.0 session — gap-based path unchanged | ✅ |
| D | Council context injected in synthesis output (Railway log confirmed) | ✅ |
| E | v1.0 session — synthesis no-op (no council context injected) | ✅ |
| F | decision_brief — council context injected | ✅ |
| G | Examiner submit saves examiner_responses with rule_id | ✅ |
| H | examiner_status = 'submitted' after submit | ✅ |
| I | bias_library rows written after examiner submit | ✅ (after patch) |

**Correct query to verify bias_library rows for a session:**
```sql
SELECT bias_parameter, detection_count, asymmetry_score_avg, updated_at
FROM bias_library
WHERE session_ids @> ARRAY['<session_id>']::uuid[];
```
(`session_ids` is `uuid[]` — use array containment `@>`, not scalar equality)

---

## SPRINT 13 TEST LOG

| Test | Description | Result |
|---|---|---|
| A | Paywall user sees named biases in blurred tiles (not generic placeholder) | ✅ |
| B | Unlocked user Mirror loads normally — no regression | ✅ |
| C | Email resolution failure → teaserBiases: [], no 500 | ✅ |
| D | R7 fires → REDIRECT, synthesis blocked | ✅ |
| E | R6 fires → FLAG in Council context | ✅ |
| F | R8 fires → FLAG; R12 suppressed when R8 active | ✅ |
| G | R9 fires → FLAG; R9 suppressed when R4 active | ✅ (expected miss on ancestral
|   |                                                 | property — tagger scored reversibility
|   |                                                 | low; R5 fired instead) |
| H | R10 fires → GATE, Examiner shown, synthesis after submit | ✅ |
| I | R12 fires → FLAG (after widening guard to 2–3) | ✅ |
| J | R2 does NOT fire at identity_alignment = 4 | ✅ |
| K | R2 fires at identity_alignment = 5 | ✅ |
| L | R1 unaffected by R2 patch — REDIRECT still fires correctly | ✅ |

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

5. **Categorical v1.0 fields retained alongside v2.0 scored vector.** Structural retrieval uses categorical fields until Sprint 13 upgrade. Both formats coexist in `sessions_ontology`.

6. **Two-pass Contradiction Detector.** Pass 1: extract principles. Pass 2: find violations. Simultaneous-truth test as disqualifier. Do not replace with ML.

7. **Compounding moat is the Ledger, not the AI.** Every AI model in this system is swappable. The `ontology_vector`, `rule_engine_result`, `examiner_responses`, and `outcomes` per session are the durable asset.

8. **REDIRECT vs GATE distinction is permanent.** REDIRECT (`upstream_dependency ≥ 5`) blocks synthesis permanently — `redirectBlocked` is only cleared by Reanalyze (new session). GATE merely delays synthesis until examiner submit. This is intentional: REDIRECT signals the decision is structurally premature, not just incomplete. Do not merge these two modes or make REDIRECT dismissible without a new session.

9. **Persona grid dims but does not suppress on REDIRECT.** All 6 personas stream regardless of rule mode. The dim (55% opacity, pointer-events: none) on REDIRECT is a visual signal that their analysis is provisional, not a feature gate. Full suppression (personas not firing at all) is deferred — requires early tagger polling before allPersonasDone.

10. **R1 threshold is permanently 5, not 4.** REDIRECT is the highest-severity action in the product — it blocks synthesis and dims the Council. It must only fire when upstream_dependency is unambiguously maximum (5/5). Score 4 produces too many false positives (the "fire head of sales" decision scored upstream=4 on emotional context alone). If R1 is not firing enough, the fix is to tighten the ontology prompt (exclude non-external dependencies), not to lower the threshold.

11. **`/api/bias-score` is the sole writer to `bias_library`.** No other route should call `scoreBiasesForSession` directly or insert into `bias_library`. The endpoint owns identity resolution (user_id → user_email → device_id → anonymous) and schema-correct accumulation logic.

12. **R2 threshold is permanently 5, not 4.** Same rationale as R1 (point 10
    above). `identity_alignment >= 4` fires on a majority of real sessions.
    R2 must identify *genuinely* identity-anchored decisions — not merely ones
    with emotional significance. Do not lower this threshold.

13. **R12 fires on decision_unit 2–3, not strictly 2.** The ontology tagger
    correctly scores implied-stakeholder dyads (couple with children, two
    founders with downstream team) as 3. Strict equality (`== 2`) silently
    missed all such sessions. R6 (>= 3) and R12 (<= 3) intentionally
    overlap at score 3 — they address different diagnostic angles (alignment
    check vs intimate value conflict).

14. **Bias trigger uses localhost, not req.url origin.** `fireBiasScore()`
    must derive its base URL from `http://localhost:${PORT}` (or
    `INTERNAL_API_URL`), never from the public HTTPS origin in `req.url`.
    Railway containers calling their own public HTTPS endpoint hit SSL
    termination. The `PORT` env var is set automatically by Railway.
    Using `req.url` origin silently skips all bias accumulation — the Ledger
    starves without any error surfacing to the user.
---

## WEBSITE (quorum-website.html)

Separate static HTML file in repo root. Not part of Next.js routing. Served separately.

**Reviewed Sprint 11c:** Three changes identified — see Website_Review_Sprint11b.md. Contradiction Detector session threshold needs verification against live code. Examiner step description updated to mention structured intervention. Bias stat should be updated from live DB query. Optional hero addition: "Some decisions aren't ready to be decided. Quorum tells you when."
 REDIRECT/GATE language is product-accurate but may need user-facing rewrite. Pricing and feature list accurate as of Sprint 11b.

---

## RESEARCH ARCHITECTURE

Reference: `Quorum_Research_Architecture_v07.md`
Human IRR established for all 14 dimensions. No publication required to use in product.
R6–R12 implemented Sprint 13. All validated on live sessions. R11 deferred (cron).

---

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.xyz
- Railway: deployment from GitHub main branch
- Vercel: (check if used alongside Railway for any routes)
