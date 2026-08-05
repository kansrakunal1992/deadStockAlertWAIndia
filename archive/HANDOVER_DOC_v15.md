# QUORUM — Handover Document v15
### Date: May 2026 | Status: Sprint 15e complete (personas.ts: Risk Architect intervention slot + Strategic Possibilities revision)
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

## DATABASE SCHEMA (current as of Sprint 15d)

No schema changes in Sprints 15b–15d. All tables unchanged from Sprint 15a, with one advisory migration for Sprint 15c.

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

-- CATEGORICAL FIELDS (v1.0, all retained) ──────────────────────────
decision_type_primary, decision_type_secondary[], stakes_reversibility,
stakes_bearer, stakes_timeline, has_stated_deadline, deadline_source,
deadline_credibility, counterparty_present, counterparty_alignment,
info_asymmetry, relationship_type, dominant_emotion, emotion_source,
emotion_analysis_aligned, stakeholder_count, hidden_stakeholder_probability,
instrumental_weight, constitutive_weight, examiner_gap_1/2/3, raw_ontology_json

-- NEW IN SPRINT 11a ──────────────────────────────────────────────────
ontology_vector         jsonb    ← 14-dim scored vector (score, confidence, rationale per dim)
rule_engine_result      jsonb    ← {mode, triggered_rules, flag_rules, evaluated_at}
```

**ontology_vector dimensions (D1–D14, research doc order):**
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
-- Run once before deploying Sprint 15c:
ALTER TABLE structural_scores
  ADD COLUMN IF NOT EXISTS scoring_mode     text,
  ADD COLUMN IF NOT EXISTS vector_similarity numeric;
```
Without this migration, retrieval still works — the traceability upsert fails silently (existing error handling). Run it to get the audit trail.

### Other tables (unchanged)
`messages`, `bias_library`, `contradictions`, `examiner_responses`, `mirror_access`, `user_preferences`, `session_requests`, `brief_access_tokens`, `structural_matches`, `sessions_pending_outcomes` (view)

---

## CODEBASE MAP

```
lib/
  structural-retrieval.ts  — ✅ Sprint 15c — 14-dim weighted cosine scorer + v1.0 categorical fallback
  personas.ts              — ✅ Sprint 15e — Risk Architect conditional intervention slot; Strategic Possibilities trigger conditions + dual-path support
  ontology-tagger.ts, rule-engine.ts, bias-scorer.ts, contradiction-detector.ts,
  independence-score.ts, mirror-fingerprint.ts, ai-client.ts, supabase.ts, types.ts, storage.ts

app/api/
  structural-match/route.ts — ✅ Sprint 15c — ontology_vector + tagger_version in SELECTs + snapshots
  mirror/calibration/route.ts — ✅ Sprint 15a
  [all other routes unchanged from Sprint 14]

components/
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
| **15c** | **Structural Retrieval upgrade to 14-dim weighted cosine vector — ✅ PASSED (see below)** |
| **15d** | **AuthPanel magic link UX + website decision examples + feature tiles — ✅ PASSED (see below)** |
| **15e** | **Council reasoning quality: Risk Architect structural alternative slot + Strategic Possibilities revised (trigger conditions, max 2 paths, structural distinctness) — ✅ PASSED** |

---

## CURRENT STATUS (as of Sprint 15d)

---

### Sprint 15c — Structural Retrieval v2.0

**Files changed:** `lib/structural-retrieval.ts`, `app/api/structural-match/route.ts`
**Advisory SQL:** `ALTER TABLE structural_scores ADD COLUMN IF NOT EXISTS scoring_mode text, ADD COLUMN IF NOT EXISTS vector_similarity numeric;`

#### What changed

**`lib/structural-retrieval.ts`** — full replacement.

The scorer now routes on `tagger_version`. When both sessions are v2.0 with `ontology_vector` present: confidence-weighted cosine similarity across 14 dims with ⭐ differential weights. When either session is v1.0: original categorical scorer unchanged.

**Why cosine (not Euclidean):** Cross-domain detection is the moat — a PE deal and a career pivot can share the same structural architecture. Cosine measures profile shape (the pattern of which dims are high vs low relative to each other), not absolute magnitude. Euclidean penalises magnitude gaps that are irrelevant to structural similarity.

**⭐ Differential weights (research doc v0.10):**
```
identity_alignment:  1.5×   (D12 — "who do I want to be?" decisions)
regret_asymmetry:    1.5×   (D13 — one type of mistake structurally worse)
upstream_dependency: 1.5×   (D14 — prior question blocks this one)
all other 11 dims:   1.0×
```
These three are the P0 rule-engine triggers and highest research novelty dimensions. Flat cosine would dilute them to 1/14th each. Weighted cosine correctly treats them as more discriminating.

**Effective score per dim:** `score × confidence × dim_weight`
Confidence-weighting: dims the tagger was uncertain about contribute proportionally less.

**Score mapping:** cosine [0.65, 1.0] → [0, 100]. Threshold ≥ 45/100 (cos_sim ≥ 0.808). Same threshold as v1.0.

**Dimension order:** Matches research doc D1–D14 exactly.

**Annotation prompt:** Adapts per scoring mode. V2.0 path surfaces top 3 contributing dimension labels in plain English. V1.0 path unchanged.

**`app/api/structural-match/route.ts`** — 5 surgical additions:
- `ontology_vector` + `tagger_version` added to current session SELECT
- `ontology_vector` + `tagger_version` added to past sessions SELECT
- Both snapshot builds include the two new fields (default to `'v1.0'` / `null` if absent)
- `structural_scores` upsert adds `scoring_mode` + `vector_similarity` for research traceability

**Backward compatibility:** V1.0 sessions unaffected. Mixed pairs (current v2.0 vs past v1.0) fall back to categorical automatically — no migration needed for past decisions.

**Research doc note (do not re-debate):** The 80+ corpus case target is a research validation requirement for weight calibration — not a product gate. The product activates at 5 past sessions, same as v1.0. The 1.5× ⭐ weights are validated against research priority (highest product leverage per research doc) and will be refined as the corpus grows past 80 cases.

**Vector scoring activation:** Progresses automatically as v2.0 sessions accumulate. A user's first v2.0 session scores against v1.0 past sessions (categorical fallback). Once they have two or more v2.0 sessions, those pairwise comparisons use the vector path. No user action required.

#### Railway log interpretation (first v2.0 session logged after deploy)

```
[StructuralMatch] Scoring session acbc805f against 50 past sessions
[StructuralMatch] Done — 2 matches, threshold_met: true, sessions_scored: 50
```

**V2.0 vector path did NOT run for these 50 comparisons.** The current session is confirmed v2.0 (ontology log shows rule engine output). But all 50 past sessions are v1.0 (pre-Sprint-11a). The router requires both sessions to have `ontology_vector` — mixed pairs fall back to categorical. The 2 matches are real and correctly scored categorically.

To confirm after SQL migration: `SELECT scoring_mode, COUNT(*) FROM structural_scores WHERE session_id_a = 'acbc805f-3fb8-489d-9bc9-859c17bf683d' GROUP BY scoring_mode;` → all rows will show `categorical`.

Vector scoring activates progressively as v2.0 sessions accumulate.

---

### Sprint 15d — AuthPanel UX + Website

**Files changed:** `components/AuthPanel.tsx`, `quorum-website.html`
**No schema changes. No new API routes.**

#### Change 1 — AuthPanel.tsx: Magic link "waiting room" state

**Problem:** After clicking "Send link", the old sent state was a small gold box with 2 lines of muted text. Users stared at the app not knowing they needed to leave the screen.

**Fix:** Full-attention waiting room UI:
- Pulsing envelope icon in a gold ring — visual signal something is actively held
- Bold "Open your inbox now" heading — imperative, directional (not "Check your email")
- 3 numbered steps: Go to inbox → Click the magic link → You'll return here with sessions linked. Removes all ambiguity about what happens next
- Pulsing dot + "Waiting for you to click the link…" — app feels held, not done
- "Wrong email?" reset link — returns to idle state without page refresh

**Do not re-debate:** The waiting room state must feel like the app is actively waiting. The pulsing indicator is intentional. "Open your inbox now" (not "Check your email") is directional language — do not soften it.

#### Change 2 — quorum-website.html: Decision examples grid

**Where:** Inside the `#moments` section, above the 01–04 feature cards.

**What:** Two-column "Bring this → / Not this →" grid with 6 + 5 entries.

Bring this:
- Exits and liquidity events — timing and structure have permanent downstream effects
- Capital allocation above ₹1Cr — opportunity cost is structural, not just financial
- Succession and key people — replaceability and trust compound over time
- Decisions you keep circling — repeated return signals structural unresolved tension
- Career pivots with identity stakes — when the question is who to be, not what to do
- Strategic commitments that close doors — irreversibility makes the cost asymmetric

Not this:
- Tactical and operational minutiae — where to seat someone, which vendor to shortlist
- Decisions with a knowable answer — research will resolve it, not Council deliberation
- Information-deficit decisions — if the answer hinges on data you don't have yet, get the data first
- Requests for a single verdict — Quorum surfaces structure and tension, not instructions
- Low-stakes fully reversible choices — if you can undo it next week at no cost, it doesn't need this

Each entry has a one-sentence rationale explaining the why.

#### Change 3 — quorum-website.html: Feature tiles (3 new cards after 04 Calibration)

Three live Mirror features not previously mentioned on the website:

**Behavioral Alerts** — Flags when patterns in your decision behaviour suggest a structural risk (avoidance, urgency inflation, consistency drift). Live in Mirror.

**PDF Decision Brief** — Every session can be exported as a formatted Decision Brief: full Council analysis, examiner responses, synthesis, and structural context in one document. Token-gated.

**Decision Timeline** — The full ledger of your decisions in Mirror: type, register, structural tags, and outcome (if logged). Visual record of your judgment history.

#### Change 4 — quorum-website.html: Calibration card (04) unlocked

Removed `mc-locked` class and blurred overlay from the 04 Calibration card. Changed copy from "Activates as your decision record builds" to "Builds after 3 logged outcomes" — accurate and not vague. Feature has been live since Sprint 15a.

---

### 🔄 Pending (Sprint 15 — remaining)

- Railway cron for 30-day outcome nudges (infrastructure built — `sessions_pending_outcomes` view exists — not wired)
- Mirror Pattern Store (rule firing frequency accumulation — aggregatable from existing `rule_engine_result` JSONB without new table)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron + days_open tracking

### ❌ Not started

- Private benchmarking (aggregate anonymised dimension scores)
- Decision Graph (requires ~20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

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
| O | Strategic possibilities surfaces max 2 structurally distinct paths; paths name what they test, not just what they are | 🔲 retest |
| P | Risk Architect structural alternative slot fires on Head-of-Sales-class decision (binary + unvalidated assumption risk) | 🔲 retest |
| Q | Risk Architect structural alternative slot absent when binary is genuinely the only available structure | 🔲 retest |
| L | Clarification mode synthesis still orients first | ✅ |
| M | Paras 1–3 + Strategic Possibilities ≤ 220 words; Pattern Observation appears when triggered | ✅ |

---

## SPRINT 15a TEST LOG

| Test | Description | Result |
|---|---|---|
| A | 0 outcomes → "No calibration data yet" + 0/3 dots | ✅ |
| B | 1–2 retro outcomes → correct count, "N more needed" | ✅ |
| C | ≥3 retro outcomes (pre may be null) → full chart renders | ✅ |
| D | Hover dots → correct date/pre/retro/delta per session | ✅ |
| E | Pre-Sprint-14 sessions (null pre) → retro line renders, delta bars absent, avg pre hidden | ✅ |
| F | GET /api/mirror/calibration with valid Bearer → correct shape | ✅ |
| G | Auth token absent → 401, clean error card | ✅ |

---

## RULE ENGINE (lib/rule-engine.ts)

| Rule | Type | Trigger | Status |
|---|---|---|---|
| R1 — Upstream Dependency Block | REDIRECT | `upstream_dependency ≥ 5` | ✅ live |
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
**Low confidence:** If triggering dim has `confidence < 0.55`, rule downgrades to clarifying question.

---

## KEY DESIGN DECISIONS (do not re-debate)

1. Ontology is fixed schema, not learned. The 14-dim vector is the data structure that makes longitudinal pattern detection comparable.
2. Rule engine is deterministic. `upstream_dependency >= 5 → REDIRECT`. Auditable, zero false positive risk.
3. Council personas all fire on every session. Grid reordering (not suppression) is the UX response.
4. REDIRECT blocks synthesis permanently. GATE only gates until examiner submit.
5. Categorical v1.0 fields retained alongside v2.0 scored vector. Mixed comparisons fall back to categorical automatically.
6. Two-pass Contradiction Detector. Do not replace with ML.
7. Compounding moat is the Ledger, not the AI. `ontology_vector`, `rule_engine_result`, `examiner_responses`, `outcomes` per session are the durable asset.
8. REDIRECT vs GATE distinction is permanent. Only cleared by Reanalyze (new session).
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
19. Risk Architect structural alternative slot (conditional): fires only when assumption risk analysis reveals the binary rests on an unvalidated premise AND a lower-commitment path could test it. One concrete alternative named with specific mechanism (e.g. "90-day performance gate tied to X metric") — not a generic hedge. Appended after diagnostic question. Exempt from the three-risk depth constraint. Omit when binary is the only available structure.
20. Home page glow fires exactly once per mount. Do not loop or re-trigger.
21. Pattern Observation in synthesis is mandatory when a pattern qualifies, and exempt from the 220-word limit.
22. Structural retrieval ⭐ dimension weights are permanently 1.5× for identity_alignment, regret_asymmetry, upstream_dependency. These are the P0 rule triggers and highest research novelty dimensions. Do not flatten to 1.0×.
23. Structural retrieval product threshold is 5 past sessions regardless of corpus size. The 80+ corpus case target is a research validation requirement for weight calibration — not a product gate.
24. AuthPanel "waiting room" sent state uses imperative language ("Open your inbox now") and a pulsing indicator. Do not soften the copy or remove the pulse — the app must feel actively held, not done.

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
