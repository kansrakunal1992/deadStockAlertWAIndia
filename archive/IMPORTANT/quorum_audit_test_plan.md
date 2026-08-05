# QUORUM — Audit Validation Test Plan
### v29_6 codebase · Generated June 2, 2026

---

## STATUS SNAPSHOT — What's In vs Out

| Audit Item | Status | Notes |
|---|---|---|
| R1 — Structural score tier + persona expansion | ✅ DONE | 3-tier (HIGH-CONFIDENCE/MODERATE/BORDERLINE) in `structural-retrieval.ts`. PERSONAS_WITH_STRUCTURAL_CONTEXT expanded 3→5 (+ contrarian, stakeholder_mirror) |
| R2 — Bias scores injected into synthesis | ✅ DONE | `fetchUserBiasContext()` in `bias-scorer.ts`; injected at synthesis path in `persona/route.ts` |
| R3 — Persona relevance weighting in synthesis | ✅ DONE | `computePersonaRelevance()` + `buildRelevanceBlock()` in `lib/persona-relevance.ts`; MANDATORY NON-NEGOTIABLE directive |
| R4 — Session Reliability Index | ✅ DONE | `lib/session-score.ts` + `api/mirror/session-score` + `SessionReliabilityIndex.tsx` |
| R5 — Structural output traceability | ✅ DONE | Conditional "Structurally, this decision..." sentence appended to structuralBlock |
| **R6 — Prompt overload** | **🚫 EXPLICITLY SKIPPED** | Low-priority by decision. No compression introduced. |
| R7 — Static rule system | ✅ PARTIAL | No automated feedback loop. Admin R11b dashboard surfaces avoidance stats for manual review. Accepted as design. |
| R8 — Heuristic thresholds | ✅ DONE | All 7 thresholds now Railway env-configurable. Admin dashboard shows effective vs default values. |
| R9 — Identity overfitting / provisional bias | ✅ DONE | Confirmed threshold raised to ≥3 in `mirror-fingerprint.ts` + `bias-scorer.ts`. Forming covers 1–2 detections. |
| **R10 — Style calibration bias** | **🚫 EXPLICITLY SKIPPED** | Verdict: LOW RISK, working as designed. Locked as KDD 110. |
| R11 — Heuristic thresholds (memory) | ✅ DONE | Same as R8 — all thresholds env-configurable; AVOIDANCE_DAYS_THRESHOLD and STRUCTURAL_ECHO_MIN_SCORE also configurable |
| Additional Risk A — recency_bias hardcoded neutral | ✅ DONE (pre-existing) | Returns 'distorting' when `ddInfo ≥ 4` in `classifyBiasSignal()` |
| Additional Risk B — C0 suppressed on complex decisions | ✅ DONE | `allRules.length < 3` condition removed; C0 always appended positionally last |
| Additional Risk C — Benchmark vs retrieval math inconsistency | ✅ DONE | `lib/similarity.ts` is single source for DIM_WEIGHTS; both routes import from it |
| Additional Risk D — R11 avoidance detection (website claim gap) | ✅ DONE | Full D1+D2+D3: `avoidance-detector.ts`, cron route, `AvoidanceAlertCard`, dismiss endpoint, resubmission context in synthesis |
| Additional Risk E — Longitudinal data not reaching synthesis | ✅ DONE | `fetchCalibrationContext()` + `fetchActiveContradictions()` in `bias-scorer.ts`; both appended to `synthesisBlock` |
| Additional Risk F — Synthesis blind to bias signals | ✅ DONE (pre-existing) | `fetchUserBiasContext()` already wiring bias → synthesis; confirmed no new code needed |
| PatternSurfaceCard / RecurringConditionCard / ContradictionBanner | ✅ DONE (Sprint 31) | Deployed |
| Admin R11b dashboard block | ✅ DONE | Threshold table + avoidance stats; deploy pending (June 1 implementation) |
| Fix 1 — Light mode button visibility | ✅ DONE | 8 semantic CSS tokens; 9 component files patched; deployed June 2 |
| Fix 2 — Magic Link via Resend | ✅ DONE | SMTP relay + branded HTML template; deployed June 2 |

**Deploy status note:** Fix 1 + Fix 2 are live. The June 1 batch (R9, R11, Admin R11b, Additional Risk D) is implemented but deploy pending — verify Railway deployment before running Group G tests below.

---

## SECTION 1 — TEST DECISIONS TO RUN

Two decisions cover the full audit surface between them. A third (manual DB setup) covers avoidance detection.

---

### Decision A — "The Strategic Investor Term Sheet"
**Purpose:** High-rule-count + high-stakes decision. Triggers R2/R4/R5/R8/R9, forces C0, exercises synthesis with full context injection.

**Text to submit:**
> "We have 45 days to decide whether to accept a term sheet from a strategic investor who is the dominant player in our sector. The valuation is below current market by 20%, but they want a board seat and information rights. Three co-founders are involved and we're not aligned — one wants to take it for the strategic value, one thinks the control terms are too restrictive, and I'm undecided. If we sign, we can't go back — they'll have material non-public information about our product roadmap and customer pipeline. There's a competing financial-only offer at a higher valuation but zero strategic value."

**Examiner context to add (if prompted):**
> "I've always prioritised independence over speed but this deal is time-sensitive and the lead partner is someone I deeply respect and trust."

**Rules expected to fire:** R2 (identity_alignment high + ambiguity ≥4), R4 (regret_asymmetry high), R5 (emotional_intensity high + time_pressure low/moderate), R6 (decision_unit ≥3 + emotional high), R8 (value_conflict high + identity high), R9 (reversibility high + time low)

**What this decision tests:** Items 1, 2, 3, 4, 5 in the grouped matrix below.

---

### Decision B — "Hire Externally or Promote Internally for Head of Sales"
**Purpose:** Upstream-blocked, information-deficient decision. Triggers R1 or R7. Tests C0 on a simpler rule-count decision (should still fire). Tests structural retrieval if a similar decision exists in corpus.

**Text to submit:**
> "I need to hire a Head of Sales within the next 60 days. My co-founder and I keep going back and forth — she wants to promote our senior SDR who knows the product inside out, I think we need external experience at the Series A stage. We've been talking about this for three months without moving. We're both dug in, there's no new information on the table, and every week we delay costs us pipeline."

**Rules expected to fire:** R1 (upstream_dependency high — co-founder alignment required), R7 potentially (DDI high + uncertainty high)

**What this decision tests:** Items 2, 3, 5 in the matrix (C0 presence on lower rule count, structural retrieval if match exists, persona relevance at a different structural profile).

---

### Decision C — Avoidance Alert Simulation (Manual DB Setup Required)
**Purpose:** Test the full D1→D2→D3 avoidance flow end-to-end.

**Setup steps (DB, before running):**
```sql
-- Step 1: Find an existing open session with upstream_dependency ≥ 4.
-- If none exists, use Decision B's session ID after it's created, then:

-- Step 2: Backdate created_at to simulate a stale session (>45 days)
UPDATE sessions
SET created_at = NOW() - INTERVAL '50 days',
    last_action_at = NULL
WHERE id = '<target_session_id>';

-- Step 3: Confirm no outcome row exists for this session (or delete it)
DELETE FROM outcomes WHERE session_id = '<target_session_id>';

-- Step 4: Trigger cron manually (see Group G test below)
```

---

## SECTION 2 — CLUBBED TEST GROUPS

Each group clubs multiple audit items into one verification pass. Run in order.

---

### GROUP A — Synthesis quality: bias + calibration + contradiction injection
**Audit items:** R2, Additional Risk E, Additional Risk F
**Decision to use:** Decision A (needs user with ≥2 prior sessions + at least 1 confirmed/forming bias)
**When to check:** After synthesis fires on Decision A

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| `synthesisBlock` was assembled | Railway logs | `[BiasContext]` log line with bias count; no error |
| Bias named in synthesis output | DB: messages table | Synthesis text contains plain-language bias description (NOT raw key like "fomo_urgency") |
| Calibration observation present | DB: messages table | Synthesis mentions confidence pattern in natural prose (NOT "LONGITUDINAL BIAS ASSESSMENT:" header) |
| Contradiction surfaced | DB: messages table | Synthesis mentions tension between past principle and current decision (if contradiction exists) |
| No section headers in output | DB: messages table | Text does NOT contain "LONGITUDINAL BIAS RECORD", "LONGITUDINAL BIAS ASSESSMENT:", any raw bias_key name |

**DB query:**
```sql
SELECT content
FROM messages
WHERE session_id = '<decision_a_session_id>'
  AND persona_key = 'synthesis'
ORDER BY created_at DESC
LIMIT 1;
```

**Railway check:** Look for `[BiasContext]` or `[Persona]` log lines at synthesis time. Absence of error = synthesisBlock reached the prompt.

---

### GROUP B — C0 always fires
**Audit items:** Additional Risk B (C0 fix)
**Decisions to use:** Decision A (many rules → old code would suppress C0) AND Decision B (fewer rules → C0 was already firing)
**When to check:** After examiner questions appear in the UI

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| C0 question present in Decision A's examiner | DB: examiner_responses | Row with `rule_id = 'C0'` for Decision A's session |
| C0 question present in Decision B's examiner | DB: examiner_responses | Row with `rule_id = 'C0'` for Decision B's session |
| C0 question is the LAST question positionally | DB: examiner_responses | `order` column value is highest among all questions for that session |

**DB query:**
```sql
SELECT rule_id, question_text, "order"
FROM examiner_responses
WHERE session_id IN ('<decision_a_id>', '<decision_b_id>')
ORDER BY session_id, "order";
```

**Railway check:** Not needed — DB is definitive here.

---

### GROUP C — Persona relevance weighting in synthesis (R3)
**Audit items:** R3
**Decision to use:** Decision A
**When to check:** After synthesis fires

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| MANDATORY COUNCIL WEIGHTING DIRECTIVE present in synthesis prompt | Railway logs | `[Persona] Synthesis call | relevanceBlock injected` or similar log; absence means the block was built but log may not exist — check synthesis quality instead |
| Synthesis explicitly addresses Risk Architect's failure cascade analysis | DB: messages | Synthesis names Risk Architect or risk-oriented perspective as primary signal (or structurally resolves its conflict with other advisors) |
| Synthesis doesn't treat all 6 personas equally | DB: messages | At minimum, synthesis identifies "where the Council most sharply diverges" with a structural reason, not just a narrative blend |

**Railway check:** The `buildRelevanceBlock()` call is in `persona/route.ts` at synthesis time. Any error there will log. Successful injection has no specific log line — absence of error + quality of synthesis output is the signal.

**DB query (synthesis output):** Same query as Group A.

---

### GROUP D — R1 structural score tier + 5-persona structural context
**Audit items:** R1 (score tier, persona expansion)
**Decision to use:** Decision A or B — whichever has a structural match in `structural_matches` (score ≥45)
**When to check:** After initial personas fire

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| Score tier label in structural block | DB: messages | Check contrarian or stakeholder_mirror persona output — should contain "HIGH-CONFIDENCE MATCH" / "MODERATE MATCH" / "BORDERLINE MATCH" if structural context was injected |
| Structural context reaches contrarian | DB: messages | Contrarian output contains reference to past structural decision or "Structurally, this decision..." traceability sentence |
| Structural context reaches stakeholder_mirror | DB: messages | stakeholder_mirror output references recurring relational pattern if structural match exists |
| Score tier label visible | DB: messages for pattern_analyst, risk_architect, elder | Same tier labels should appear |

**DB queries:**
```sql
-- Check which personas got structural context for a session
SELECT persona_key, LEFT(content, 500) AS content_start
FROM messages
WHERE session_id = '<session_id>'
  AND persona_key IN ('contrarian', 'stakeholder_mirror', 'pattern_analyst', 'risk_architect', 'elder')
  AND is_initial = true
ORDER BY persona_key;

-- Confirm structural match exists (and score) for this session
SELECT session_id, match_session_id, structural_score, matched_at
FROM structural_matches
WHERE session_id = '<session_id>'
ORDER BY structural_score DESC;
```

**Railway check:** Not required — DB is the source of truth for structural injection.

---

### GROUP E — R5 structural output traceability sentence
**Audit items:** R5
**Decision to use:** Decision with structural match score ≥45 in corpus (check structural_matches first)
**When to check:** After initial persona outputs load

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| Traceability sentence present on personas that received structural context | DB: messages | One of the 5 structural personas ends with "Structurally, this decision [...]" sentence |
| Traceability sentence absent on personas that did NOT receive structural context | DB: messages | competitor + synthesis do NOT contain forced traceability sentences |

**DB query:**
```sql
SELECT persona_key, 
       RIGHT(content, 300) AS content_tail
FROM messages
WHERE session_id = '<session_with_structural_match>'
  AND is_initial = true
  AND persona_key IN ('pattern_analyst', 'risk_architect', 'elder', 'contrarian', 'stakeholder_mirror', 'competitor')
ORDER BY persona_key;
```

---

### GROUP F — R9 provisional bias threshold (≥3 for confirmed)
**Audit items:** R9
**Decision to use:** Any session for a user with 1–2 total bias detections (new-ish user)
**When to check:** After examiner submit (bias score fires async)

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| User with 1 detection shows "FORMING" not "CONFIRMED" | DB: bias_library | `detection_count < 3` → status should be 'forming'; `detection_count ≥ 3` → 'confirmed' |
| activation_contexts JSONB has signal_type per session | DB: bias_library | JSONB key per session_id maps to signal_type value |
| BiasFingerprint UI shows "building confidence" for forming biases | UI | No "Confirmed" badge for 1–2 detection biases; "building confidence" label visible |
| recency_bias is NOT hardcoded neutral when ddInfo ≥ 4 | DB: bias_library | For sessions with high ambiguity (Decision A should have high DDI), recency_bias activation_contexts shows 'distorting' not always 'neutral' |

**DB queries:**
```sql
-- Check all bias entries for a user
SELECT bias_key, detection_count, is_confirmed, asymmetry_score_avg,
       jsonb_object_keys(activation_contexts) AS session_keys
FROM bias_library
WHERE user_id = '<user_id>'
ORDER BY detection_count DESC;

-- Check recency_bias signal specifically
SELECT bias_key, activation_contexts
FROM bias_library
WHERE user_id = '<user_id>'
  AND bias_key = 'recency_bias';
```

---

### GROUP G — R11 / Additional Risk D: Full avoidance detection flow
**Audit items:** Additional Risk D (D1+D2+D3), R11 (threshold configurability)
**Decision to use:** Decision C (manual DB setup required — see Section 1)
**Deploy gate:** Confirm June 1 batch is deployed on Railway before running this group.

**Sub-test G1: Cron detection fires**
```bash
# Trigger cron manually (replace URL + CRON_SECRET)
curl -s -X POST https://<your-app>.railway.app/api/cron/avoidance-detect \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId": "<target_user_id>"}'
# Expected: { ok: true, detected: 1, skipped: 0, errors: 0, elapsed_ms: ... }
```

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| avoidance_alerts row created | DB: avoidance_alerts | Row with correct session_id, days_open ≥ 45, upstream_dependency_score ≥ 4 |
| Structural echo populated if prior resolved session exists | DB: avoidance_alerts | `structural_echo` JSONB column non-null with matchScore, decisionSnippet |
| Mirror alerts route returns avoidanceAlerts | API: GET /api/mirror/alerts | Response includes `avoidanceAlerts: [{ id, sessionId, daysOpen, ... }]` |
| AvoidanceAlertCard renders in Mirror UI | UI | "Decisions Still Open" section visible above Bias Fingerprint for unlocked user |
| "Bring it back →" pre-fills textarea | UI | Click CTA → lands on home page with decision text pre-filled in textarea |
| resubmitAlertId flows to synthesis | DB: messages | Open the pre-filled session → complete to synthesis → check synthesis content for RESUBMISSION CONTEXT (days_open observation, framing shift question) |
| Dismiss (resolved externally) creates outcomes row | DB: outcomes | After clicking "Mark as resolved →", check outcomes table for `outcome_quality = 'resolved_externally'` for that session |
| Dismiss is idempotent | API | Second dismiss POST for same alert_id returns `{ ok: true }` without error |

**DB queries:**
```sql
-- Check avoidance_alerts table
SELECT id, session_id, days_open, upstream_dependency_score, 
       detected_at, dismissed_at, structural_echo
FROM avoidance_alerts
WHERE user_id = '<user_id>'
ORDER BY detected_at DESC;

-- Check minimal outcomes row created by dismiss (resolved_externally path)
SELECT session_id, outcome_quality, created_at
FROM outcomes
WHERE session_id = '<stale_session_id>';
```

**Railway check:** `[CronAvoidance]` + `[AvoidanceDetector]` log lines visible on cron trigger. Check for `detected: 1` in response JSON.

---

### GROUP H — Admin R11b dashboard
**Audit items:** R8, R11 (threshold table + avoidance stats)
**Deploy gate:** June 1 batch deployed.

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| R11 section visible in admin dashboard | UI: /admin | Threshold table rendered below existing R7/R8 sections |
| Default vs overridden thresholds correct | UI: /admin | Rows with amber highlight where Railway env var overrides default; badge shows "ENV OVERRIDE" |
| Avoidance alert stats present | UI: /admin | 4 stat cards: total alerts, open (undismissed), dismissed, avg days open |
| effectiveThresholds API returns correct values | API: GET /api/admin/dashboard (with ADMIN_CODE) | JSON includes `r11.effectiveThresholds` array and `r11.avoidanceStats` |

**Check env override behavior:**
```bash
# Set a non-default threshold in Railway vars (e.g. MATCH_THRESHOLD=50),
# then load admin dashboard — that row should show amber + "ENV OVERRIDE" badge
# and effective_value: "50" vs default_value: "45"
```

---

### GROUP I — PatternSurfaceCard, RecurringConditionCard, ContradictionBanner
**Audit items:** Sprint 31 components (not audit items per se, but part of the shipped work)
**Pre-condition:** User with ≥5 sessions + Mirror unlocked

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| PatternSurfaceCard renders on home page | UI | Top-firing rule pattern shown with fire_count, decision text snippets (real text, not placeholder) |
| Show-more expands correctly | UI | Clicking "Show more" reveals additional session snippets; click outside collapses |
| RecurringConditionCard shows recurring dimension | UI | Highest-recurring structural dimension shown with plain-language description |
| ContradictionBanner fires post-synthesis | UI | After synthesis on a session where a stored contradiction's violationSessionId matches: banner appears with principleText, violationText, two dismissal actions |
| ContradictionBanner dismiss works | DB: contradictions | After dismissing, row in contradictions table is updated (dismissed_at set or similar) |

**DB query for ContradictionBanner pre-condition:**
```sql
-- Find a contradiction whose violationSessionId can be used to trigger the banner
SELECT id, principle_text, violation_text, principle_session_id, 
       violation_session_id, severity, dismissed_at
FROM contradictions
WHERE user_id = '<user_id>'
  AND dismissed_at IS NULL
ORDER BY detected_at DESC
LIMIT 5;
-- Use the violation_session_id value — re-opening that session will show the banner post-synthesis
```

---

### GROUP J — Session Reliability Index (R4)
**Audit items:** R4
**Pre-condition:** Mirror-unlocked user + at least 3 sessions with outcomes filed

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| /api/mirror/session-score returns data | API | Array of SessionScoreData with composite score 0–100, 4 sub-scores, actionPlan |
| Composite formula correct | DB cross-check | Manually verify: structural × 0.25 + biasClarity × 0.30 + councilConfidence × 0.20 + calibration × 0.25 |
| Pending outcome scores 70 for calibration sub-score | DB | Session with no outcome row → calibration_score = 70 in returned data |
| SessionReliabilityIndex renders in Mirror | UI | "Session Reliability" section visible after Confidence Calibration |
| Sub-score hover tooltip shows exact score | UI | Hovering each dot shows precise sub-score |
| "Your next move" action targets weakest sub-score | UI | Action plan text matches the sub-score category with lowest average |

**DB cross-check query:**
```sql
-- Pull the raw inputs for one session to manually verify composite score
SELECT
  so.matches_json,
  bl.activation_contexts,
  so.rule_engine_result,
  o.calibration_delta
FROM sessions s
LEFT JOIN sessions_ontology so ON so.session_id = s.id
LEFT JOIN bias_library bl ON bl.user_id = s.user_id
LEFT JOIN outcomes o ON o.session_id = s.id
WHERE s.id = '<session_id>';
```

---

### GROUP K — Fix 1: Light mode button visibility
**Audit items:** Fix 1 (June 2)
**How to test:** Switch to light mode (via ThemeToggle). Navigate through the app.

**What to look for:**

| Component | Element | Signal in light mode |
|---|---|---|
| PersonaPanel | "Share this context with all advisors" button | Visible button with readable ink-blue text, not washed out |
| PersonaPanel | "Updating" badge | Visible ink-blue text on cream background |
| PersonaPanel | "Responded / ✓" badge | Visible forest-green text |
| PersonaPanel | Examiner update box | Readable blue-tinted box, not invisible |
| SynthesisCard | "This doesn't apply" override button | Ghost button visible on cream background |
| SynthesisCard | "✓ Complete" label | Forest-green text readable |
| OutcomeTracker | Quality option buttons | Visible on selection, dark text on colored fill |
| ExaminerPanel | CONTEXT badge | Readable forest-green on cream |
| IndependenceScore | Positive delta text | Readable green on light background |
| Mirror page | "● Active" badge | Readable green dot + text |

**Railway check:** Not applicable — visual verification only.

---

### GROUP L — Additional Risk C: Unified similarity math
**Audit items:** Additional Risk C
**Pre-condition:** User with Mirror unlocked + multiple sessions for benchmark comparison

**What to look for:**

| Check | Where | Signal |
|---|---|---|
| Benchmark results use DIM_WEIGHTS | Code | `app/api/mirror/benchmark/route.ts` imports from `lib/similarity.ts` — verify via file check or import trace |
| Structural retrieval uses same DIM_WEIGHTS | Code | `lib/structural-retrieval.ts` imports from `lib/similarity.ts` — no local DIM_WEIGHTS definition |
| Benchmark score and structural match score directionally consistent | DB | For same pair of sessions, benchmark similarity (cross-user, unweighted confidence) should not grossly diverge from structural_scores value (within-user, confidence-weighted) — large divergence would indicate math mismatch |

**DB query:**
```sql
-- Compare structural_score between two sessions you expect to be similar
SELECT ss.session_id, ss.match_session_id, ss.structural_score
FROM structural_scores ss
WHERE ss.session_id = '<session_a>'
   OR ss.session_id = '<session_b>'
ORDER BY structural_score DESC
LIMIT 10;
```

---

## SECTION 3 — RAILWAY vs DB QUICK REFERENCE

| Test | Best validated via Railway | Best validated via DB | UI verification needed |
|---|---|---|---|
| GROUP A — Synthesis bias injection | ✅ Log line for synthesisBlock | ✅ messages table (synthesis content) | ✅ Read synthesis output |
| GROUP B — C0 always fires | ❌ | ✅ examiner_responses (rule_id = 'C0') | ✅ Count questions in ExaminerPanel |
| GROUP C — R3 relevance weighting | ✅ Error absence at synthesis | ✅ messages table (synthesis content) | ✅ Synthesis quality |
| GROUP D — R1 score tier + persona expansion | ❌ | ✅ messages table (persona content) | ❌ |
| GROUP E — R5 traceability sentence | ❌ | ✅ messages table (persona content tail) | ❌ |
| GROUP F — R9 provisional threshold + recency_bias | ❌ | ✅ bias_library (detection_count, signal_type) | ✅ BiasFingerprint UI |
| GROUP G — R11 avoidance detection full flow | ✅ Cron log + response JSON | ✅ avoidance_alerts, outcomes tables | ✅ Mirror AvoidanceAlertCard |
| GROUP H — Admin R11b dashboard | ❌ | ✅ via dashboard API response | ✅ /admin page directly |
| GROUP I — Sprints 31 components | ❌ | ✅ contradictions table (for banner pre-condition) | ✅ Home page + post-synthesis |
| GROUP J — R4 Session Reliability Index | ❌ | ✅ session-score API + sub-score cross-check | ✅ Mirror SessionReliabilityIndex section |
| GROUP K — Fix 1 light mode | ❌ | ❌ | ✅ Full visual audit in light mode |
| GROUP L — Similarity math unified | ❌ | ✅ Import verification + structural_scores spot-check | ❌ |

---

## SECTION 4 — EXECUTION ORDER & DEPENDENCIES

```
1. Confirm June 1 deploy live on Railway (Groups G, H depend on it)
2. Run Decision A (complex term sheet)
   → Immediately validates: Groups A, B, C, D (if struct match), E (if struct match), F (post-async bias score)
3. Run Decision B (hire SDR vs external)
   → Validates: Group B (C0 on lower rule count), Group C (different relevance profile)
4. DB setup for Decision C (backdate session)
   → Run cron trigger
   → Validates Group G end-to-end
5. Load Mirror for test user
   → Validates: Groups I (PatternSurfaceCard, RecurringConditionCard), Group J (SessionReliabilityIndex)
6. Load /admin
   → Validates: Group H
7. Switch to light mode, navigate app
   → Validates: Group K
8. Code/import spot-check (no run needed)
   → Validates: Group L
```

---

## SECTION 5 — KNOWN GAPS (NOT TESTING, NOT BUGS)

| Item | Why not testing |
|---|---|
| R6 — Prompt overload compression | **Explicitly not done** by product decision. No compression introduced. |
| R10 — Style calibration ordering bias | **Explicitly not done** by product decision. LOW RISK, working as designed. KDD 110. |
| R7 — Automated outcomes→rules feedback loop | No automated job built — admin dashboard serves as manual equivalent. Accepted architecture. |
| Full `userJudgmentContext()` as described in audit Section 4 | Functionally implemented across `fetchUserBiasContext()` (bias + calibration + contradiction). Not a named single function, but the audit's capability description is met. |
| Threshold sensitivity dashboard (spreadsheet form) | Partially covered by R11 env vars + admin dashboard. Full sensitivity analysis tool not built. No test needed — it's a tooling gap, not a product bug. |

---

## SECTION 6 — QUICK SQL LIBRARY

For convenience — copy-paste queries for the most frequent checks.

```sql
-- 1. Examiner questions for a session (check C0 presence + order)
SELECT rule_id, LEFT(question_text, 100) AS q, "order"
FROM examiner_responses
WHERE session_id = '<id>'
ORDER BY "order";

-- 2. All messages for a session (check persona outputs)
SELECT persona_key, is_initial, LENGTH(content) AS len, LEFT(content, 200) AS preview
FROM messages
WHERE session_id = '<id>'
ORDER BY persona_key, created_at;

-- 3. Synthesis full content
SELECT content FROM messages
WHERE session_id = '<id>' AND persona_key = 'synthesis'
ORDER BY created_at DESC LIMIT 1;

-- 4. Bias library for a user
SELECT bias_key, detection_count, is_confirmed, asymmetry_score_avg,
       activation_contexts
FROM bias_library
WHERE user_id = '<uid>'
ORDER BY detection_count DESC;

-- 5. Structural matches for a session
SELECT match_session_id, structural_score, matched_at
FROM structural_matches
WHERE session_id = '<id>'
ORDER BY structural_score DESC;

-- 6. Avoidance alerts for a user
SELECT id, session_id, days_open, upstream_dependency_score,
       detected_at, dismissed_at, structural_echo
FROM avoidance_alerts
WHERE user_id = '<uid>'
ORDER BY detected_at DESC;

-- 7. Rule engine result for a session (check which rules fired)
SELECT rule_engine_result, tagger_version
FROM sessions_ontology
WHERE session_id = '<id>';

-- 8. Outcomes for a user (calibration data)
SELECT session_id, pre_decision_confidence, retrospective_confidence,
       calibration_delta, outcome_quality, council_helped
FROM outcomes
WHERE session_id IN (
  SELECT id FROM sessions WHERE user_id = '<uid>'
)
ORDER BY created_at DESC;

-- 9. Contradictions (for ContradictionBanner pre-condition)
SELECT id, principle_session_id, violation_session_id,
       severity, dismissed_at, LEFT(principle_text, 100) AS principle
FROM contradictions
WHERE user_id = '<uid>'
  AND dismissed_at IS NULL
ORDER BY detected_at DESC;

-- 10. Session score inputs (cross-check R4 composite manually)
SELECT
  s.id AS session_id,
  so.matches_json,
  so.rule_engine_result->>'mode' AS rule_mode,
  jsonb_array_length(so.rule_engine_result->'flag_rules') AS flag_count,
  o.calibration_delta
FROM sessions s
LEFT JOIN sessions_ontology so ON so.session_id = s.id
LEFT JOIN outcomes o ON o.session_id = s.id
WHERE s.user_id = '<uid>'
ORDER BY s.created_at DESC
LIMIT 20;
```

---

*Test plan generated from: HANDOVER_DOC_v29_6.md + quorum_audit.md + codebase inspection (quorum_Pre_Encryption_IMP.zip). R6 and R10 excluded by explicit product decision.*
