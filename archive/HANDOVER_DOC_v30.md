# QUORUM — Handover Document v30
### Date: June 2, 2026 | Status: Security Sprint — Application-level AES-256-GCM field encryption. All raw user input encrypted at rest in Supabase. 21 files patched + lib/encryption.ts created + migration endpoint + test script. Backfill complete, verified via SQL audit.
### Date: June 2, 2026 | Status: Fix 1 (light mode button visibility) — 8 semantic CSS tokens, 9 component files patched. Fix 2 (Supabase Magic Link via Resend) — SMTP relay configured, branded HTML template live.
### Date: June 1, 2026 | Status: Additional Risk D fully implemented (D1 + D2 + D3) — avoidance detection, Mirror surface, dismiss endpoint, synthesis resubmission context all complete
### Date: June 1, 2026 | Status: Audit R9 (provisional bias threshold ≥3), R10 locked as permanent skip, R11 (env-configurable thresholds + admin dashboard R11 section) — implemented; deploy pending
### Date: May 31, 2026 | Status: Sprints 32–34 deployed + C0 fix + R3 + R4 + R5 + Additional Risk C + Additional Risk E implemented; Additional Risk A confirmed pre-existing fix; Risk F confirmed pre-existing fix
### Date: May 30, 2026 | Status: Sprints 32–34 deployed + Website competitive leakage audit completed
### Stack: Next.js 15 · Supabase (PostgreSQL) · Railway · Anthropic / DeepSeek

---

## PRODUCT SUMMARY

Quorum is a private decision intelligence system for high-stakes decisions. A user describes a decision; six AI advisors (the Council) analyse it in parallel from distinct cognitive frames. Before synthesis fires, the Examiner surfaces unknown unknowns — and from Sprint 11a, runs a deterministic rule engine that can block or gate the Council based on the decision's structural profile. Over time, the Mirror layer accumulates patterns, calibration data, and contradiction signals across all of a user's decisions.

**Positioning:** Not a chatbot. Not a framework. A private judgment system that compounds with every session.
**Copy discipline (established May 2026):** Public-facing copy distinguishes three buckets — (1) what Quorum does [always publish], (2) what the system produces [abstract before publishing], (3) how Quorum does it [default remove]. Architecture, dimension counts, rule counts, operating mode names, and pipeline sequence are never published. See KDDs 88–96.

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
                            ↳ Sprint 17: also returns rule_engine_result + ontology_vector
                              for grid reorder signal — no new route, piggybacked on existing poll
POST /api/independence-score → independence scorer → independence_score_log upsert
        ↓ (UI, parallel)
6 × POST /api/persona     → streams persona responses → messages insert
                            ↳ Sprint 19a: buildCouncilContext() injected for all 6 initial personas
                              via fetchCouncilContextWithRetry() (race condition fix — Sprint 19)
        ↓ (after all 6 done — Sprint 17 addition)
Grid reorder animation    → fade out (350ms) → cards reorder to ontology-ranked positions
                            → fade in → "Ranked by relevance to your decision" label appears
        ↓ (also after all 6 done)
GET /api/examiner         → reads rule_engine_result (v2.0) or gaps (v1.0)
                            → personalises each rule question to decision_text (Sprint 12)
                            → returns questions + rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses (with rule_id) → fires /api/bias-score (non-blocking)
                            → fires /api/mirror/independence (non-blocking) ← ✅ Sprint 18a restored
                            → fires /api/mirror/contradictions (non-blocking) ← ✅ Sprint 18a restored
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → synthesis with buildCouncilContext injected into system prompt (Sprint 12)
                            ↳ Sprint R3: computePersonaRelevance() + buildRelevanceBlock() injected
                              as MANDATORY NON-NEGOTIABLE final layer — weights 6 advisors by rule
                              signals + ontology dims + structural match quality
        ↓ (post-synthesis — Sprint 31)
ContradictionBanner       → GET /api/mirror/contradictions — fires if violationSessionId === session.id
RecordReceipt             → shows real DB session count (totalSessionCount from server prop)
        ↓ (Mirror, separate routes)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts|calibration|patterns}
                            ↳ Sprint 19: all routes use getMirrorAccessState() helper
                            ↳ Sprint 20 NEW: /api/mirror/benchmark
                            ↳ Sprint 20 NEW: /api/mirror/sessions-lookup
                            ↳ Sprint 21 NEW: /api/mirror/preferences
```

---

## DATABASE SCHEMA (current as of Sprint 20)

### Encrypted columns (Security Sprint — June 2, 2026)
All raw user input is encrypted at rest using AES-256-GCM (application-layer). Anyone with direct Supabase access sees only `enc:<iv>:<authTag>:<ciphertext>` strings. Derived tables (numeric scores, enums, AI summaries) are intentionally left plaintext.

| Table | Encrypted columns |
|---|---|
| `sessions` | `decision_text`, `context_text` |
| `messages` | `content` (all roles) |
| `examiner_responses` | `question_text`, `response_text` |
| `outcomes` | `what_decided`, `notes` |
| `structural_matches` | `context_block` (text), `matches_json` (JSONB — stored as `{ _enc: "enc:..." }`) |

**Left plaintext (derived tables — no raw user text):** `sessions_ontology`, `bias_library`, `structural_scores`, `independence_score_log`, `contradiction_runs`, `avoidance_alerts`, `mirror_access`, `user_preferences`, `contradictions.principle_text/violation_text` (AI-derived summaries, not verbatim user input).

**Key:** `DB_ENCRYPTION_KEY` Railway env var (64 hex chars / 32 bytes). See lib/encryption.ts.
**Backward compat:** `decrypt()` passes through any value not starting with `enc:` — old plaintext rows remain readable. Backfill migration run and verified June 2, 2026.

### mirror_access ← updated Sprint 19 migration
```
id               uuid PK
user_id          uuid UNIQUE FK → auth.users
access_type      text CHECK ('annual','monthly','lifetime','advisory') DEFAULT 'monthly'
granted_at       timestamptz NOT NULL DEFAULT now()
started_at       timestamptz
expires_at       timestamptz   ← null = never expires (lifetime/advisory)
payment_ref      text
payment_id       text
subscription_id  text
```

**Access logic (getMirrorAccessState):**
- `lifetime` / `advisory` → always `unlocked`
- `annual` / `monthly` → `unlocked` if `expires_at > now()` or `expires_at IS NULL`; else fall through
- No valid row or expired → session count ≥ 3 → `teaser`; else `locked`

### sessions, sessions_ontology, outcomes, structural_scores, messages, contradictions, examiner_responses, session_requests, brief_access_tokens, structural_matches, sessions_pending_outcomes
All unchanged from Sprint 18b.

### user_preferences ← Sprint 21 update
`style_cue TEXT CHECK ('direct','challenge','pattern','risk','stakeholder','long')` column added.

### bias_library ← Sprint 20 update
`activation_contexts` JSONB column now stores `signal_type: 'distorting'|'neutral'|'adaptive'` per session key.

---

## CODEBASE MAP

```
lib/
  encryption.ts            — ✅ Security Sprint NEW — AES-256-GCM field encryption module.
                             encrypt(value): wraps plaintext in enc:<iv>:<authTag>:<ciphertext>.
                             decrypt(value): passes through non-enc: values (backward compat).
                             encryptJson(data): wraps JSON as { _enc: "enc:..." } for JSONB columns.
                             decryptJson<T>(value): handles both old array and new { _enc } format.
                             No-op when DB_ENCRYPTION_KEY unset (safe for dev without key).
                             All other files import exclusively from here — never instantiate crypto directly.
  mirror-access.ts         — ✅ Sprint 19 NEW — getMirrorAccessState() helper.
  rule-engine.ts           — ✅ Sprint 27 — R7 identity gate tightened (>3→>2); question template fix.
                             also Sprint 19a: R2 ambiguity threshold corrected to ≥ 4
  types.ts                 — ✅ Sprint 30 — Session interface gains decision_type_primary +
                             stakes_reversibility. also Sprint 19/20/21: MirrorGateState, MirrorAccessState,
                             SubscriptionPlan, BiasSignalType, StyleCue, BenchmarkData, SessionPreview, RulePattern
                             R4 — SessionScoreData interface appended (composite score + 4 sub-scores +
                             calibrationPending + distortingBiasLabels + actionPlan).
  personas.ts              — ✅ Sprint 34 — SYNTHESIS prompt: PATTERN OBSERVATION section now
                             includes explicit "CRITICAL: Do NOT write 'PATTERN OBSERVATION:' as a
                             label or header — begin directly with the natural-language opener."
                             Prevents the AI from copying the internal section name into output.
                             Sprint 26 — RESPONSE STRUCTURE header tag reminder all 6 personas.
                             Sprint 25 — WORD_LIMIT_PREFIX constraint 0 (header tags). SYNTHESIS TRADE-OFF block.
                             Sprint 21 — USER_STYLE_BOOSTS constant. computePersonaOrder() userStyle param.
                             Sprint 20 — DECISION_BRIEF DECISION-MAKER OBSERVATION block.
  bias-scorer.ts           — ✅ Sprint RE — fetchCalibrationContext() (private): queries sessions
                             joined with outcomes for calibration_delta; gates on ≥3 paired points
                             AND |avgDelta| ≥ 0.3; returns plain-English synthesis-ready description
                             of confidence calibration pattern, or ''. fetchActiveContradictions()
                             (private): queries contradictions table for active (non-dismissed)
                             tensions, limit 2 by recency; returns synthesis-ready block or ''.\n                             fetchUserBiasContext() extended: all 3 DB queries now run in parallel
                             via Promise.all. calibrationLine + contradictionBlock appended to
                             synthesisBlock before MANDATORY directive. Directive extended with
                             calibrationDirective + contradictionDirective addenda — each supplies
                             concrete example phrasings so synthesis surfaces findings as natural
                             prose observations, never as labelled data points or section headers.
                             Return shape and call signature unchanged. One file changed.
                             Sprint 34 — directiveBody (synthesisBlock) updated:
                             (a) explicitly bans raw bias_key output (e.g. "loss_aversion_reversal")
                             — instructs plain-language translation instead;
                             (b) explicitly forbids "LONGITUDINAL BIAS ASSESSMENT:" or any section
                             header — weave into existing prose;
                             (c) all three tiers (distorting/forming/neutral) updated consistently.
                             Sprint 20 — classifyBiasSignal(), getPredominantSignal()
                             R9 fix (June 1, 2026) — isConfirmed threshold raised from ≥2 to ≥3.
                             statusLabel correctly pluralises for 2-detection forming entries.
                             Columns description in synthesis prompt updated: "CONFIRMED = 3+ detections,
                             FORMING = 1–2 detections". Aligns with mirror-fingerprint.ts.
  mirror-fingerprint.ts    — ✅ Sprint 20 — signalType + sessionIds per tile
                             R9 fix (June 1, 2026) — confirmed threshold raised from ≥2 to ≥3.
                             formingRows now captures detection_count 1 OR 2 (was strictly === 1).
                             Forming tile builder: detectionCount, confidenceWeight, confidenceDots
                             now dynamic from DB row (were hardcoded 1 / 0.30 / 1).
                             humanizeActivationSummary null guard updated to < 3 (was < 2) — 2-detection
                             forming tiles get fallback activation summary; 1-detection tiles still return null.
                             Static interpretation fallback branches: 2-detection → "1 more session to confirm";
                             1-detection → "one more session to confirm".
  ai-client.ts             — ✅ Sprint 26 — withRetry() wrapper for DeepSeek 503
  storage.ts               — ✅ Sprint 24a — removeSessionId(id) export added
  dates.ts                 — ✅ Sprint 30 NEW — formatDate() / formatDateTime() helpers, all IST (Asia/Kolkata)
  ontology-tagger.ts       — ✅ Sprint 27 — decision_discriminating_info rubric NOTE added
  structural-retrieval.ts  — ✅ Additional Risk C — DIM_WEIGHTS local definition removed.
                             Now imports DIM_WEIGHTS from lib/similarity.ts (single source of truth).
                             scoreVectorSimilarity() logic unchanged: still applies score × confidence
                             × dim_weight for within-user comparison. VECTOR_DIMS stays in this file.
                             R11 (June 1, 2026) — MATCH_THRESHOLD and MIN_SESSIONS now read from
                             process.env (Railway env vars). Defaults: 45 and 5 respectively.
                             No behaviour change unless Railway vars are set to override.
  voice-sessions.ts        — ✅ Sprint 23a NEW — module-level session Map (Railway persistent process)
  avoidance-detector.ts    — ✅ Sprint D2 (previously implemented) — full avoidance detection engine.
                             Security Sprint: decrypt() applied to decision_text and what_decided reads.
  independence-score.ts    — ✅ Sprint 18a — calculateIndependenceScore() + getScoreBand().
                             Security Sprint: decrypt() applied to response_text in bySession map and decision_text before scoreSession call.
                             Queries sessions where days_open ≥ AVOIDANCE_DAYS_THRESHOLD and
                             upstream_dependency ≥ 4. Writes to avoidance_alerts table.
                             Called by cron route (app/api/cron/avoidance-detect/route.ts).
                             R11 (June 1, 2026) — AVOIDANCE_DAYS_THRESHOLD and STRUCTURAL_ECHO_MIN_SCORE
                             now read from process.env. Defaults: 45 and 60 respectively.
  persona-relevance.ts     — ✅ Sprint R3 NEW — computePersonaRelevance() + buildRelevanceBlock().
                             RULE_PERSONA_BOOSTS config (keyed by RuleId type-anchored to rule-engine.ts).
                             DIM_PERSONA_BOOSTS config (1–5 scale, 9 dimension entries).
                             Structural match tiered boost (≥80 → +0.30, ≥60 → +0.15, ≥45 → +0.05).
                             To retune: edit boost values in RULE_PERSONA_BOOSTS or DIM_PERSONA_BOOSTS only.
  similarity.ts            — ✅ Additional Risk C NEW — single source of truth for DIM_WEIGHTS.
                             Exports DIM_WEIGHTS: Record<string, number> — 14 dims, 1.5× for ⭐ starred
                             (identity_alignment, regret_asymmetry, upstream_dependency).
                             Both lib/structural-retrieval.ts and app/api/mirror/benchmark/route.ts
                             import from here. Eliminates math inconsistency between the two routes.
                             Do not define DIM_WEIGHTS anywhere else — always import from this file.
  session-score.ts         — ✅ R4 NEW — computeUserSessionScores(userId, supabase): Promise<SessionScoreData[]>.
                             Security Sprint: decrypt() applied to decision_text before decisionPreview slice.
                             Unifies 4 data streams into per-session reliability score (0–100).
                             Sub-scores: structural (sessions_ontology.matches_json → maxStructuralScore),
                             biasClarity (bias_library.activation_contexts — distorting count × asymmetry),
                             councilConfidence (rule_engine_result mode + flag_rules.length — deterministic,
                             no LLM), calibration (outcomes.calibration_delta — 70 if outcome pending).
                             deriveActionPlan() targets user's weakest avg sub-score across all sessions.
                             TypeScript: intermediate array typed as Omit<SessionScoreData, 'actionPlan'> —
                             actionPlan attached in final .map() call (deploy fix for TS build error).
                             No LLM calls. No schema changes.

app/api/
  mirror/status/route.ts    — ✅ Sprint 19 — 3-state gate via getMirrorAccessState()
  mirror/teaser/route.ts    — ✅ Sprint 19 NEW
  mirror/fingerprint/route.ts — ✅ Sprint 19 — getMirrorAccessState()
  mirror/contradictions/route.ts — ✅ Sprint 19 — getMirrorAccessState(); Sprint 18a: POST pipeline
                                   R11 (June 1, 2026) — MIN_SESSIONS + RERUN_DAYS_THRESHOLD now read from process.env. Defaults: 5 and 7.
                                   Security Sprint: GET — decrypt() on decision_text in decisionMap. POST — decrypt() on decision_text, question_text, response_text, messages content before building AI evidence.
  mirror/independence/route.ts   — ✅ Sprint 28 — examinerQuote query added
                                   Security Sprint: decrypt() on response_text before building examiner quote.
  mirror/patterns/route.ts       — ✅ Sprint 20 — session_ids tracked per rule
                                   R11 (June 1, 2026) — PATTERNS_SESSION_THRESHOLD now reads from process.env. Default: 3.
  mirror/rules/route.ts          — ✅ Sprint 19 — getMirrorAccessState()
                                   R11 (June 1, 2026) — RULES_SESSION_THRESHOLD now reads from process.env. Default: 8.
                                   Security Sprint: decrypt() on decision_text (decisionMap), question_text, response_text, messages content.
  mirror/calibration/route.ts    — ✅ Sprint 19 — getMirrorAccessState()
                                   Security Sprint: decrypt() on decision_text before slicing for tooltip label.
  mirror/alerts/route.ts         — ✅ Sprint D3 — GET now returns avoidanceAlerts[] alongside
                                    existing alerts[]. Both queries run in parallel via Promise.all.
                                    avoidanceAlerts: undismissed avoidance_alerts rows (limit 3,
                                    days_open DESC) joined with decision_text from sessions.
                                    All early-return paths updated to return { alerts: [], avoidanceAlerts: [] }.
                                    Sprint 19 — getMirrorAccessState()
                                    Security Sprint: decrypt() on decision_text in sessionMap.
  mirror/timeline/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
                                   Security Sprint: decrypt() on decision_text in result map.
  mirror/outcomes/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
  mirror/unlock/route.ts         — ✅ Sprint 19 hotfix — three-token support (MONTHLY/ANNUAL/LIFETIME)
  mirror/benchmark/route.ts      — ✅ Additional Risk C — extractVector() now applies DIM_WEIGHTS
                                    (imported from lib/similarity.ts). Starred dims carry 1.5× in
                                    cross-user peer similarity, matching structural-retrieval.ts.
                                    Confidence intentionally NOT applied cross-user. Sprint 20 NEW.
  mirror/avoidance/dismiss/route.ts — ✅ Sprint D3 NEW — POST /api/mirror/avoidance/dismiss.
                                    Bearer auth + ownership check (confirms alert.user_id === userId).
                                    Sets dismissed_at + action_taken ('new_session' | 'resolved_externally').
                                    'resolved_externally' path: upserts minimal outcomes row
                                    (outcome_quality='resolved_externally') so D2 cron does not
                                    re-flag the session on the next daily pass. Idempotent — already-
                                    dismissed alerts return { ok: true } silently.
  mirror/sessions-lookup/route.ts — ✅ Sprint 20 NEW — session preview for source drawers
                                   Security Sprint: decrypt() on decision_text before trim for decision_preview.
  mirror/preferences/route.ts    — ✅ Sprint 21 NEW — GET/POST style_cue
  mirror/session-score/route.ts  — ✅ R4 NEW — GET /api/mirror/session-score.
                                    Auth (Bearer token → resolveUserId) + Mirror unlocked gate
                                    (getMirrorAccessState). Returns SessionScoreData[] for last 20
                                    sessions. Parallel reads from sessions, sessions_ontology,
                                    bias_library, outcomes. No LLM. No schema change.
  payment/create-subscription/route.ts — ✅ Sprint 19 NEW (stub)
  admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW
  admin/dashboard/route.ts             — ✅ Deployed and working June 1, 2026.
                                         Bug fix (June 1): data-fetching logic extracted into
                                         handleDashboard() with top-level try/catch in GET().
                                         Runtime errors now return JSON 500 not HTML — page can
                                         parse the response and show "Server error 500" instead
                                         of silently catching as "Network error".
                                         R11b (June 1): r11 block added — effectiveThresholds reads
                                         all 7 env vars vs defaults, returns { name, default_value,
                                         effective_value, is_overridden, env_raw } per threshold.
                                         Avoidance stats block queries avoidance_alerts (non-fatal
                                         catch if table absent). r11 returned alongside r7/r8/meta.
  persona/route.ts          — ✅ Sprint D3 — resubmitAlertId optional body param added.
                              When present (user came via "Bring it back →" in Mirror):
                              fetches avoidance_alerts row, confirms user_id ownership, injects
                              RESUBMISSION CONTEXT block into synthesis system prompt — states
                              days open as information not accusation, asks whether framing has
                              shifted, surfaces structural echo if present. Non-fatal: synthesis
                              proceeds without context if fetch fails. Ownership check ensures
                              alertId from a different user cannot inject false context.
                              Sprint R5 — conditional OUTPUT TRACEABILITY requirement appended
                              to structuralBlock after the persona-specific structural mandate.
                              Design: conditional ("if you engaged with it, close with one sentence
                              beginning 'Structurally, this decision...'"). Omit entirely if structural
                              memory did not apply. No fabrication. Only fires when structuralBlock is
                              assembled (structural context present + persona in
                              PERSONAS_WITH_STRUCTURAL_CONTEXT + initial call). No system prompt change.
                              Tech debt: conditional creates audit gap (omit vs ignore indistinguishable)
                              — full traceability deferred. See KDD 102.
                              Sprint R3 — fetchCouncilContext() extended: matches_json added to
                              select; ruleEngineResult + maxStructuralScore now returned. At synthesis,
                              computePersonaRelevance() + buildRelevanceBlock() called; relevanceBlock
                              appended as final layer in synthesis system prompt (after synthesisBlock).
                              fetchCouncilContextWithRetry() return type updated to match.
                              Sprint 19a — buildCouncilContext() to all 6 initial personas
                              Sprint 19 hotfix — fetchCouncilContextWithRetry() for initial personas
                              Security Sprint: encrypt() on messages.content before both user pushback insert and assistant response insert.
  examiner/route.ts         — ✅ Sprint C0 — C0 (JTBD anchor question) now fires on every decision
                              regardless of rule count. Condition `allRules.length < 3` removed from
                              shouldAddC0 guard. REDIRECT suppression retained. C0 still appended
                              positionally last, still personalised via personaliseRuleQuestion().\
                              Sprint 27 — redirectRule derived + returned; upstreamRationale R1-only
                              Security Sprint: GET — decrypt() on decision_text before AI personalisation. POST — encrypt() on question_text and response_text in rows before insert.
  bias-score/route.ts       — ✅ Sprint 20 — classifyBiasSignal() per bias; signal_type in JSONB
                              Security Sprint: decrypt() on decision_text, context_text, messages content, question_text, response_text before passing to scorer.
  record/route.ts           — ✅ Sprint 24a — DELETE handler + ownership check
                              Security Sprint: decrypt() on session decision_text, context_text and messages content before returning to client.
  structural-match/route.ts — ✅ Sprint 17 — returns rule_engine_result + ontology_vector for grid reorder
                              Security Sprint: cache-hit path decrypts context_block and decryptJson(matches_json). Data path decrypts current session decision_text, past snapshots decision_text, outcomes what_decided. Cache-write path encrypts context_block and encryptJson(matches array).
  admin/encrypt-migrate/route.ts — ✅ Security Sprint NEW — POST /api/admin/encrypt-migrate.
                              One-shot backfill endpoint. Bearer ADMIN_CODE auth. Encrypts all existing plaintext rows across 5 tables + structural_matches.matches_json JSONB. Returns JSON progress report with per-table updated/skipped/errors counts. DELETE THIS FILE after migration is confirmed complete.
  session/route.ts          — ✅ Security Sprint CHANGED — POST: encrypt() on decision_text and context_text before insert. GET: decrypt() on decision_text and context_text before returning to client.
  outcome/route.ts          — ✅ Security Sprint CHANGED — encrypt() on what_decided and notes before upsert.
  history/route.ts          — ✅ Security Sprint CHANGED — decrypt() on decision_text and outcomes.what_decided before returning sessions array.
  record/[id]/brief/route.ts — ✅ Security Sprint CHANGED — decrypt() on session decision_text, context_text, messages content, examiner question_text/response_text after DB fetch. encrypt() on messages.content (decision_brief) before DB insert.
  voice/stream/route.ts     — ✅ Sprint 31 — enable_endpoint_detection: false (manual stop only)
  voice/chunk/route.ts      — ✅ Sprint 23a NEW
  voice/cleanup/route.ts    — ✅ Sprint 23a NEW
  voice/tts/route.ts        — ✅ Sprint 23b NEW — Soniox TTS proxy, markdown strip, chunked audio

components/
  SessionView.tsx          — ✅ Sprint 31 — ContradictionBanner wire (post-synthesis fetch +
                             render gated on synthesisDone); sv-navbar background: var(--bg-card)
                             Sprint 30 — totalSessionCount prop, RecordReceipt render
                             Sprint 27 — R7/R1 redirectRule pass-through handling
                             Sprint 25/24b — initialMessages, extractHeaderTags, style cue
                             Sprint 22 — CouncilStatusBar wiring
  RecordReceipt.tsx        — ✅ Sprint 30 NEW — post-synthesis confirmation card
  PatternSurfaceCard.tsx   — ✅ Sprint 31 NEW — top pattern narrative, actual decision text,
                             show-more button, actionable line, click-outside collapse,
                             fire_count cap on fetched session IDs
  RecurringConditionCard.tsx — ✅ Sprint 31 NEW — top structural dimension observation,
                               plain-language descriptions, actionable line per dimension
  ContradictionBanner.tsx  — ✅ Sprint 31 NEW — post-synthesis; correct API field names
                             (principleText/violationText/principleDecision/violationDecision/
                             principleSessionId/violationSessionId/severity/category);
                             fires when violationSessionId === session.id; dismiss via DELETE
  MemoryEngineStatus.tsx   — ✅ Sprint 31 — mirrorUnlocked prop; "Mirror active" status label;
                             "View Mirror →" shown for both mirrorUnlocked AND mirrorTeaserReady states
                             Sprint 19 hotfix — TEASER_THRESHOLD=3, preview link at ≥3
  ExaminerPanel.tsx        — ✅ Sprint 31 — Council&apos;s → Council\u2019s (apostrophe render fix)
                             Sprint 27 — redirectRule state, R7 vs R1 copy distinction
  PersonaPanel.tsx         — ✅ Fix 1 (June 2, 2026) — "Share this context with all advisors" button, examiner update box, "Updating" badge, "Responded"/"✓" badge — all hardcoded blue/green values replaced with --info-* and --success-* tokens.
                             Sprint 34 — Examiner update (Share to All Advisors) now calls
                             stripHeaderTags(acc) before setExaminerUpdate() and in fullContent
                             save. stripHeaderTags added to examiner useEffect dep array.
                             This was the only code path not stripping <lens>/<position>/<realcost>
                             tags — initial response and pushback replies were already clean.
                             Sprint 32 — ACCENT_COLORS values updated (more muted, readable as
                             left-rail accents). Header redesigned: full-color block → dark neutral
                             var(--bg-card-alt) + borderLeft: 3px solid accentColor on outer card.
                             Icon container uses accentColor at 13%/33% opacity (not white overlay).
                             TTS strip footer: full-color → var(--bg-card-alt). Button colors use
                             --tts-btn-color/border/bg/stop-color tokens (theme-aware).
                             Sprint 27 — lens→header sub-line; position→unlabeled body-top;
                             realcost→italic closing. Sprint 25/24b/23c as noted.
  AvoidanceAlertCard.tsx   — ✅ Sprint D3 NEW — renders up to 3 undismissed avoidance alerts
                             from Mirror alerts route (avoidanceAlerts[] field). Each card shows:
                             decision text snippet, days-open as plain observation ("You first
                             brought this N days ago. It hasn't moved."), structural echo block
                             when present (prior resolved session ≥60/100 match), two CTAs:
                             "Bring it back →" (localStorage quorum_resubmit_alert + ?decision=
                             pre-fill navigation) and "Mark as resolved →" (calls dismiss endpoint).
                             Copy language: recognition not accusation — "avoidance" never appears.
                             Dismiss removes card from view optimistically. Exported types:
                             AvoidanceAlertData, StructuralEcho (imported by mirror/page.tsx).
  SynthesisCard.tsx        — ✅ Fix 1 (June 2, 2026) — override button ghost bg → --overlay-bg/hover; clarification badge → --success-*; ✓ Complete → --success-text.
                             Sprint D3 — synthesis POST body now includes resubmitAlertId.
                             Read from localStorage key 'quorum_resubmit_alert' at synthesis call
                             time; cleared immediately after read (fires only once per resubmission).
                             Sprint 25 — Pause/Resume/Stop TTS. Sprint 22 — status bar callbacks
  PatternStore.tsx         — ✅ Sprint 20 — RuleSourceDrawer, fire count clickable
  PatternTile.tsx          — ✅ Sprint 28 — "Activates when:" label. Sprint 20 — SignalPill, SourceDrawer
  BiasFingerprint.tsx      — ✅ Sprint 20 — authToken passed to PatternTile
                             R9 fix (June 1, 2026) — forming section strip copy updated from "one more
                             session to confirm" to "building confidence" (accurate for 1 or 2 detections).
                             Narrative block copy updated: "three or more patterns" (was "two or more").
  IndependenceScore.tsx    — ✅ Fix 1 (June 2, 2026) — positive delta text #4ade80 → var(--success-text).
                             Sprint 28 — examinerQuote block, CoachingTip sub-component
  DecisionRules.tsx        — ✅ Sprint 28 — mobile classNames
  SessionReliabilityIndex.tsx — ✅ R4 NEW — Mirror module in UnlockedView (after Confidence
                                 Calibration, before Decision Timeline). Fetches from
                                 /api/mirror/session-score. Renders: average composite score + trend
                                 delta (recent 5 vs prior 5 sessions), per-session list (last 10)
                                 with score bar + 4 sub-score dots (structural/bias/council/
                                 calibration). Hover tooltip per dot shows exact score. Always-visible
                                 "Your next move" action plan callout (gold left-border card) targeting
                                 user's weakest avg sub-score with a specific, non-generic action.
  StyleCalibration.tsx     — ✅ Sprint 21 NEW — 3-question inline calibration, localStorage persistence
  CouncilStatusBar.tsx     — ✅ Sprint 22 NEW — phase state machine narrating back-end activity
  BackButton.tsx           — ✅ Sprint 24a NEW — router.back() client component
  VoiceInput.tsx           — ✅ Sprint 23a NEW — full voice widget, SSR disabled (dynamic import)

app/
  page.tsx                 — ✅ Sprint D3 — reads ?decision= URL param on mount alongside
                             existing ?em= param handler. If present, calls setDecision()
                             with decoded value (pre-fills submission textarea). URL cleaned
                             via history.replaceState after reading. This is the landing target
                             for AvoidanceAlertCard "Bring it back →" deep-link.
                             Sprint 34 — Hero card border: 2px solid var(--gold-dim).
                             Sprint 33 — overflowX: 'clip' removed from flip-card wrapper (was
                             clipping card box-shadow on left/right edges on mobile).
                             Sprint 32 — Hero card: dark glass treatment (linear-gradient rgba +
                             backdropFilter blur(20px)), className="card-back-inner hero-card".
                             Radial bloom div (className="card-bloom") behind card; bloom suppressed
                             in light mode via CSS. Bloom uses top/left/right/bottom (no negative
                             horizontal inset — avoids mobile centering shift).
                             Sprint 31 — onboarding 3-panel card; PatternSurfaceCard +
                             RecurringConditionCard wired; mirrorUnlocked; pattern dimensions.
                             Sprint 30 — QUORUM flip-card, Judgment Record strip, clamp heights.
                             Sprint 29 — fixed navbar, persona pill strip, tips collapsible.
  mirror/page.tsx          — ✅ Sprint D3 — AvoidanceAlertCard import + AvoidanceAlertData type
                             import. avoidanceAlerts state added. fetchStatus() extended: when
                             gateState = 'unlocked', fetches /api/mirror/alerts and sets
                             avoidanceAlerts from response.avoidanceAlerts. UnlockedView prop
                             signature extended with avoidanceAlerts: AvoidanceAlertData[].
                             "Decisions Still Open" section inserted above Bias Fingerprint —
                             renders only when avoidanceAlerts.length > 0.
                             R4 — SessionReliabilityIndex import added.
                             Sprint 31 — sub-label "A private operating system for your judgment";
                             no lock icons on teaser tiles; "Activate Mirror" language throughout;
                             ₹9,999/year leading price; "building" lockedBadge; gold back button
                             Sprint 28 — mobile layout, section reorder (Fingerprint first), teaser polish
                             Sprint 20 — UnlockedView header renames, BenchmarkModule
                             Sprint 19 — LockedView, TeaserView, gate states
  session/[id]/page.tsx    — ✅ Sprint 30 — sequential query (session first), totalSessionCount
                             COUNT query, duplicate notFound removed
                             Sprint 24b — initialMessages server-side fetch
  record/[id]/page.tsx     — ✅ Sprint 27 — XML tag stripping, deduplication, QUORUM home link,
                             +New Decision button
                             Sprint 24a — BackButton, bottom nav
  admin/page.tsx           — ✅ R7/R8 Admin Dashboard — deployed and working June 1, 2026.
                             Bug fix (June 1): fetchDashboard() was declared after the useEffect
                             that calls it, causing a TDZ reference error in React strict-mode's
                             synchronous effect replay — manifest as "Network error" catch.
                             Fix: fetchDashboard() moved above useEffect; dependency array changed
                             from [] to [fetchDashboard] (correct stale-closure handling).
                             res.json() now wrapped in its own try/catch — if server returns HTML
                             instead of JSON (Railway error page), shows specific message rather
                             than generic "Network error". typeof window guard added to useEffect.
                             ADMIN_CODE constraint: must be ASCII-only (ISO-8859-1 safe). See KDD 106.
                             R11b (June 1, 2026) — R11 section added: threshold table (amber highlight
                             for env-overridden values, default/override badge per row) + avoidance alert
                             stat cards (total, open, dismissed, avg days open). R11ThresholdRow + R11Data
                             interfaces added to DashboardData type. Review cadence footer updated.
                             Sprint 19 — admin grant access UI (pre-existing).
  globals.css              — ✅ Sprint 32 — Dark token refine: --bg-void #080f1c, --bg-card #101827,
                             --bg-card-alt #151e2f, --bg-deep #0b1220, --border-dim #202b40,
                             --border-mid #2b3a55, --text-3 #8d9aaf, --text-4 #66738a.
                             Dark mode body radial gradient (fixed selector: html[data-theme="dark"]).
                             .hero-card class (dark: glass gradient; light: var(--bg-card)).
                             .card-bloom class (hidden in light via [data-theme="light"] .card-bloom).
                             Light mode warm vignette gradient on html[data-theme="light"] body.
                             --accent-contrarian/risk/pattern/stakeholder/elder/competitor added.
                             --tts-btn-color/border/bg, --tts-stop-color tokens (dark + light values).
                             btn-primary: gradient + dark text (#101318) + box-shadow.
                             Input focus ring: rgba(122,162,216,0.14) (was greenish rgba(52,77,128,0.22)).
                             Sprint 31 — --bg-void: #060c1a, --gold: #d4a843; @keyframes spin + pulseGold
                             Sprint 29 — DM Sans token, .home-two-col, type refinements
  layout.tsx               — ✅ Sprint 29 — DM Sans variable font replaces Inter

hooks/
  useSoniox.ts             — ✅ Sprint 31 — manual end detection (enable_endpoint_detection: false);
                             300ms finalize delay; 8s timeout guard for stuck finalizing state
                             Sprint 23a NEW — state machine idle→recording→finalizing→done|error
  useSonioxTTS.ts          — ✅ Sprint 25 — isPaused, pause(), resume()
                             Sprint 23b NEW — speak(), stop(), chunked playback, countdown, pace

context/
  TTSContext.tsx           — ✅ Sprint 23b NEW — singleton TTSProvider, useTTSContext()

scripts/
  encrypt-existing.ts      — ✅ Security Sprint NEW — CLI alternative for backfill migration.
                             Run via: npx tsx scripts/encrypt-existing.ts
                             Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_ENCRYPTION_KEY.
                             Batches 200 rows at a time. Idempotent — skips enc: prefixed rows.
                             Prefer the API endpoint (admin/encrypt-migrate) for Railway deployments.
  test-encryption.ts       — ✅ Security Sprint NEW — Integration test script.
                             Tests: encryption primitives (no DB), write→DB encrypted, read→API decrypted,
                             examiner Q&A round-trip, outcome round-trip, backward compat (legacy plaintext row),
                             history route. Cleans up all test data. Run before and after deploy.
                             Usage: npx tsx scripts/test-encryption.ts

Static:
  index.html (quorumvault.org) — ✅ Sprint 20 — 6 persona cards, correct module names
                                 Sprint 19 — billing toggle, Mirror pricing, subscription flow
                                 Sprint 31 — social proof section + full mobile overhaul deployed
                                 May 30, 2026 — competitive leakage audit (3 passes, 31 issues).
                                   Output: index_final.html (clean) + index_final.patch (2 LOW items).
                                   Audit doc: quorum_leakage_analysis.html.
                                   All HIGH/MEDIUM resolved. Two LOW residuals patched (see KDD 88–96).
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
| **15b** | **UX + Reasoning Quality: prompt architecture + home glow — ✅ PASSED** |
| **15c** | **Structural Retrieval upgrade to 14-dim weighted cosine vector — ✅ PASSED** |
| **15d** | **AuthPanel magic link UX + website decision examples + feature tiles — ✅ PASSED** |
| **15e** | **Council reasoning quality: Risk Architect structural alternative slot — ✅ PASSED** |
| **16b** | **R1 confidence guard + override button + pushback detection + share context fan-out + language register — ✅ Deployed** |
| **16c** | **Context show more toggle + anti-template-repetition + Examiner RULE_HINTS — ✅ Deployed** |
| **17** | **Dynamic persona grid reorder + Mirror Pattern Store route — ✅ Deployed** |
| **18a** | **Independence Score + Contradiction Detector triggers restored in examiner route — ✅ Deployed** |
| **18b** | **Mirror Pattern Store UI (PatternStore.tsx) — ✅ Deployed** |
| **19a** | **R2 ambiguity threshold fix (≥3→≥4) + buildCouncilContext() to all 6 initial personas — ✅ Deployed** |
| **19** | **Mirror subscription gate (locked/teaser/unlocked). getMirrorAccessState() helper. Teaser view. mirror_access schema migration. Pricing toggle on website. SynthesisCard Mirror nudge. Race condition fix (fetchCouncilContextWithRetry). Unlock route fix (lifetime + upsert). MemoryEngineStatus teaser threshold (3). — ✅ Deployed** |
| **20** | **Bias signal classification (distorting/neutral/adaptive). DECISION_BRIEF mirror closing line. Peer benchmark module. Source-decision drawer on Bias Fingerprint + What Keeps Coming Up. Website + Mirror copy synced. — ✅ Deployed** |
| **21** | **Style calibration (3-question flow). /api/mirror/preferences route. user_preferences.style_cue column. computePersonaOrder() style param. localStorage persistence. — ✅ Deployed** |
| **22** | **CouncilStatusBar — phase state machine narrating back-end activity in plain language. — ✅ Deployed** |
| **23a** | **Voice I/O — Soniox STT, SSE proxy, binary chunk forwarding, AI cleanup, particle animation. — ✅ Deployed** |
| **23b** | **TTS Read Aloud — Synthesis card. REST not WebSocket. Chunked playback. Countdown timer. Pace control. — ✅ Deployed** |
| **23c** | **TTS Read Aloud — all 6 persona cards. Singleton TTSProvider. Bottom strip layout. — ✅ Deployed** |
| **24a** | **Delete decision. Back to Council (router.back). Sub-text formatting. — ✅ Deployed** |
| **24b** | **Back to Council no re-run (initialMessages server-side). TTS strip alignment fix. — ✅ Deployed** |
| **25** | **Pause/Resume TTS. Persona header layer (Lens/Position/Real Cost). Synthesis trade-off narrative. — ✅ Deployed** |
| **26** | **DeepSeek 503 retry (withRetry). Persona RESPONSE STRUCTURE tag compliance fix (all 6). — ✅ Deployed** |
| **27** | **Persona header redistribution (lens→header sub-line, position→body-top, realcost→closing). R7 vs R1 REDIRECT distinction. R7 false positive fixes. Record page (XML strip, dedup, home link, +New Decision). — ✅ Deployed** |
| **28** | **Mirror UI revamp: confidence slider copy, mobile layout, "Activates when:", examiner quote + CoachingTip in Independence Score, section reorder (Fingerprint first, Timeline last), rules card mobile, teaser polish. — ✅ Deployed** |
| **29** | **Home page redesign: fixed navbar, persona pill strip, tips collapsible, history fade-in, .home-two-col. DM Sans variable font. — ✅ Deployed** |
| **30** | **Chunks 1–3: QUORUM flip-card, RecordReceipt, Mirror paywall copy. Bug fixes: localStorage auth key, IST timezone, sv-navbar bg-card, Mirror nav button. lib/types.ts Session additions. session/[id] totalSessionCount. — ✅ Deployed** |
| **31** | **Chunks 4–5: Onboarding 3-panel card, PatternSurfaceCard (decision text + show-more + actionable + click-outside), RecurringConditionCard (plain language + actionable), ContradictionBanner (correct field names, post-synthesis). VoiceInput manual end detection + timeout guard. ExaminerPanel \u2019 fix. Background #060c1a blue tint. Gold brightness #d4a843. Website social proof + mobile overhaul deployed. — ✅ Deployed** |
| **32** | **UI Polish: dark token refine (--bg-void #080f1c, --bg-card #101827, border/text nudges). Body radial gradient (fixed html[data-theme="dark"] selector — was broken). Hero card glass treatment + radial bloom. PersonaPanel header redesign (left rail, neutral bg). btn-primary gradient. Input focus ring. TTS strip theme-aware token system. Light mode warm vignette. — ✅ Deployed** |
| **33** | **Bug fixes: overflowX clip removed (card edge cut on mobile). Light mode bloom hidden. Card border 1.5px. TTS strip button colors readable in light mode via --tts-btn-* tokens. — ✅ Deployed** |
| **34** | **Bug fixes: card border → 2px. Examiner update (Share to All Advisors) strips lens/position/realcost tags (stripHeaderTags was missing from that code path). Synthesis output: PATTERN OBSERVATION no longer appears as a header label. LONGITUDINAL BIAS ASSESSMENT header and raw bias_key names (e.g. loss_aversion_reversal) eliminated from synthesis output. — ✅ Deployed** |
| **Fix 1 (June 2, 2026)** | **Light mode button visibility — end-to-end audit + token system. Root cause: 3 classes of hardcoded dark-mode-only values: (A) ghost-white backgrounds rgba(255,255,255,0.04/0.08) invisible on light cream; (B) pastel accent text (#93c5fd, #60a5fa, rgba(74,222,128,0.9), #4ade80) unreadable on #f4f1eb; (C) low-alpha blue containers rgba(96,165,250,0.07) with no visible border on light bg. Fix: 8 new semantic CSS tokens added to both :root (dark) and [data-theme="light"] blocks in globals.css — --info-text, --info-bg, --info-border, --success-text, --success-bg, --success-border, --overlay-bg, --overlay-bg-hover. Dark values = exact prior hardcodes (zero dark-mode regression). Light values = ink blue (#1a52a8), forest green (#1a7a3a), dark-tinted overlays (rgba(0,0,0,0.04)). 9 component files updated: PersonaPanel.tsx ("Share this context with all advisors" button bg/border/text, examiner update box, "Updating" badge, "Responded"/"✓" badge), SynthesisCard.tsx ("This doesn't apply — continue to Council" ghost button + hover, clarification mode badge, "✓ Complete"), CouncilStatusBar.tsx (phase badge non-synthesis bg), OutcomeTracker.tsx (quality-option ghost bg, helpedOptions bg now --outcome-* CSS vars, text #fff → var(--text-1) in both form and saved-state), ReanalyzeDrawer.tsx (clarification mode selected border/bg/text), ExaminerPanel.tsx (CONTEXT badge color/border/bg), AuthPanel.tsx (linked-sessions success box bg/border/dot), IndependenceScore.tsx (positive delta text), app/mirror/page.tsx (● Active badge). Two intentional non-fixes: CalibrationSparkline.tsx (SVG fill= attrs — CSS vars unsupported in SVG presentation attributes), SessionView.tsx (already had [data-theme="light"] override in same file for this path). — ✅ Implemented June 2, 2026** |
| **Fix 2 (June 2, 2026)** | **Supabase Magic Link email via Resend — SMTP relay + branded template. Resend domain quorumvault.org verified (SPF/DKIM/DMARC). Supabase Auth SMTP configured (smtp.resend.com:465, username: resend, password: Resend API key). Branded HTML Magic Link template live in Supabase Auth → Email Templates. Template variable: {{ .ConfirmationURL }}. — ✅ Implemented June 2, 2026** |
| **Security Sprint (June 2, 2026)** | **Application-level AES-256-GCM field encryption. lib/encryption.ts (NEW) — encrypt(), decrypt(), encryptJson(), decryptJson(). All raw user input encrypted at rest: sessions.decision_text/context_text, messages.content, examiner_responses.question_text/response_text, outcomes.what_decided/notes, structural_matches.context_block + matches_json (JSONB as {_enc}). Derived tables (ontology scores, bias scores, enums) unchanged and visible. 21 files patched: 5 write paths encrypt before DB insert; 16 read paths decrypt after DB fetch. app/api/admin/encrypt-migrate/route.ts (NEW) — one-shot backfill endpoint called once, then deleted. scripts/test-encryption.ts (NEW) — integration test covering write→encrypted, read→decrypted, backward compat. Backfill run June 2, 2026. SQL audit confirmed: 0 plaintext rows across all 5 tables. DB_ENCRYPTION_KEY added to Railway env vars. — ✅ Deployed June 2, 2026** | — SMTP relay + branded template. Problem: Supabase default SMTP sends unbranded plain emails, high spam rate, no template control. Fix: (1) Resend account created, domain quorumvault.org verified (3 DNS records — SPF, DKIM, DMARC). (2) Supabase Project Settings → Authentication → SMTP → Enable Custom SMTP: host smtp.resend.com, port 465, username resend, password = Resend API key (re_xxxx), sender name "Quorum", sender email auth@quorumvault.org. (3) Supabase Auth → Email Templates → Magic Link: replaced default template with branded HTML. Template anatomy: dark navy header (#08111f) + 3px gold bottom border + Quorum wordmark (img hosted on Railway); overline "Secure sign-in" in gold (#9c7628); serif h1 "Sign in to Quorum"; body copy — "Your private decision workspace is ready" + continuity value prop (cross-device, connect prior sessions, judgment record, pattern history, memory layer); CTA "Open Quorum" — dark navy #0b1f3a button; gold-accent callout card (4px left border, #faf3e5 bg, #ead8b8 border) — "Private judgment infrastructure" one-liner and Quorum value prop paragraph; plain-text fallback URL block; cream footer (#f3ead8) with "Quorum" label + tagline. Template variable: {{ .ConfirmationURL }} used in button href and fallback link. — ✅ Implemented June 2, 2026** |
| **C0 fix** | **Examiner route: C0 (JTBD anchor — "what would this decision have to deliver for you to feel it was genuinely the right call?") now fires on every decision regardless of rule count. Single condition removed from shouldAddC0 guard. REDIRECT suppression retained. Max question count on complex decisions: 3 rules → 4 questions. — ✅ Implemented May 31, 2026** |
| **R3** | **Council Weighting Directive: lib/persona-relevance.ts (NEW) — computePersonaRelevance() + buildRelevanceBlock(). Scores all 6 advisors via RULE_PERSONA_BOOSTS (11 rules) + DIM_PERSONA_BOOSTS (9 dimensions) + structural match boost. persona/route.ts updated: fetchCouncilContext() now returns ruleEngineResult + maxStructuralScore (matches_json added to DB select). Synthesis path: relevanceBlock injected as MANDATORY NON-NEGOTIABLE final system prompt layer. — ✅ Implemented May 31, 2026** |
| **R5** | **Structural output traceability: conditional OUTPUT TRACEABILITY requirement appended to structuralBlock in persona/route.ts. Fires only when structural context is present + persona is in PERSONAS_WITH_STRUCTURAL_CONTEXT + initial call. If structural memory genuinely shaped the persona's angle, final sentence must begin "Structurally, this decision [observation]." If not applicable, sentence is omitted — no fabrication. No system prompt change. No personas.ts change. Tech debt: audit gap (omit vs ignore indistinguishable) — deferred to corpus scale. See KDD 102. — ✅ Implemented May 31, 2026** |
| **Additional Risk A** | **recency_bias hardcoded to 'neutral' — confirmed already fixed in Sprint R2 (bias-scorer.ts classifyBiasSignal()). Now correctly returns 'distorting' when ddInfo ≥ 4. No new files needed. — ✅ Pre-existing fix confirmed May 31, 2026** |
| **Additional Risk C** | **Benchmark vs structural retrieval math inconsistency: lib/similarity.ts (NEW) — single source of truth for DIM_WEIGHTS (14 dims, 1.5× for ⭐ starred). lib/structural-retrieval.ts updated: imports DIM_WEIGHTS from similarity.ts, local definition removed. app/api/mirror/benchmark/route.ts updated: extractVector() now applies DIM_WEIGHTS (score × dim_weight). Intentionally NOT confidence-weighted cross-user (see KDD 101). — ✅ Implemented May 31, 2026** |
| **Additional Risk E** | **Longitudinal reasoning gap — calibration delta and contradiction data not reaching synthesis: lib/bias-scorer.ts extended (one file). fetchCalibrationContext() (private) — queries sessions+outcomes for calibration_delta, gates on ≥3 paired points and \|avgDelta\| ≥ 0.3, returns plain-English synthesis-ready description of confidence pattern. fetchActiveContradictions() (private) — queries contradictions for undismissed tensions (limit 2), returns synthesis-ready block. fetchUserBiasContext() updated: all 3 DB queries run in parallel via Promise.all; calibrationLine + contradictionBlock appended to synthesisBlock; MANDATORY directive extended with calibrationDirective + contradictionDirective — each gives synthesis concrete example phrasings to ensure findings surface as natural prose, never as section headers or labelled data points. Return shape and call signature unchanged. — ✅ Implemented May 31, 2026** |
| **R4** | **Session Reliability Index: lib/session-score.ts (NEW) — computeUserSessionScores() unifies structural match quality (sessions_ontology.matches_json), bias clarity (bias_library.activation_contexts — distorting signal count × asymmetry_score_avg), council confidence (rule_engine_result mode + flag_rules.length, deterministic), calibration (outcomes.calibration_delta, 70 if pending) into SessionScoreData[]. Formula: structural × 0.25 + biasClarity × 0.30 + councilConfidence × 0.20 + calibration × 0.25. deriveActionPlan() always returns specific improvement action targeting weakest avg sub-score across all sessions. app/api/mirror/session-score/route.ts (NEW) — GET handler, auth + unlocked gate. components/SessionReliabilityIndex.tsx (NEW) — Mirror module: per-session score list (last 10), 4 sub-score hover dots, average + trend delta, always-visible "Your next move" callout. lib/types.ts: SessionScoreData appended. app/mirror/page.tsx: import + section block added after Confidence Calibration. TypeScript fix: Omit<SessionScoreData, 'actionPlan'> intermediate type resolves build error. No LLM. No schema change. — ✅ Implemented May 31, 2026** |
| **Additional Risk F** | **Synthesis has no access to bias signals — confirmed already fully implemented in Sprint R2 (fetchUserBiasContext() in lib/bias-scorer.ts). synthesisBlock + personaAlert both firing. No new files needed. — ✅ Pre-existing fix confirmed May 31, 2026** |
| **Audit R9 / R11** | **Audit R9 (Identity Overfitting): confirmed threshold raised from ≥2 to ≥3 in mirror-fingerprint.ts and bias-scorer.ts. Forming now covers detection_count 1 and 2. Forming tile builder fully dynamic (detectionCount / confidenceWeight / confidenceDots from DB row). BiasFingerprint.tsx copy updated — "building confidence" replaces "one more session to confirm" (accurate for both 1 and 2 detections). Narrative block: "three or more patterns" (was two). Audit R10 (Style calibration bias): permanently skipped — audit verdict was LOW RISK, working as designed. Locked as KDD 110. Audit R11 (Heuristic thresholds): all 7 threshold constants now configurable via Railway env vars — MATCH_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD, AVOIDANCE_DAYS_THRESHOLD, STRUCTURAL_ECHO_MIN_SCORE. No deploy needed to tune. .env.example updated with all 7 vars and recalibration milestone note. Admin dashboard: r11 block added (effectiveThresholds table + avoidance alert stats). app/admin/page.tsx: R11 section added — threshold table with amber override highlighting + 4-stat avoidance card grid. — ✅ Implemented June 1, 2026 (deploy pending)** |
| **Additional Risk D — D3** | **Mirror surface + dismiss + synthesis resubmission context: components/AvoidanceAlertCard.tsx (NEW) — renders up to 3 undismissed alerts, "Bring it back →" + "Mark as resolved →" CTAs. app/api/mirror/avoidance/dismiss/route.ts (NEW) — POST dismiss endpoint, ownership check, minimal outcomes upsert on resolve. app/api/mirror/alerts/route.ts — parallel avoidance query, response gains avoidanceAlerts[]. app/api/persona/route.ts — resubmitAlertId param, RESUBMISSION CONTEXT injected at synthesis. app/mirror/page.tsx — AvoidanceAlertCard wired into UnlockedView above Bias Fingerprint. app/page.tsx — ?decision= URL param pre-fills textarea. components/SynthesisCard.tsx — resubmitAlertId passed from localStorage. Additional Risk D now fully complete (D1 + D2 + D3). — ✅ Implemented June 1, 2026** | (3 passes). HIGH: dimension count (14), rule count (12), full pipeline sequence, Mirror module mechanism descriptions. MEDIUM: bias trigger format, Decision Independence Score mechanism, internal state labels (provisional/blocked/held), social proof FOMO metric, not-a-chatbot strip architecture, Mirror timeline internal labels. LOW: "12 months" advisory, teaser unlock threshold (3), "in parallel" Council execution, "Traces which structural factors". All resolved. Output: index_final.html + index_final.patch. — ✅ May 30, 2026** |

---

## CURRENT STATUS

**Active Sprint:** Sprint 35 (not started)
**Last completed:** Security Sprint (AES-256-GCM field encryption, backfill, SQL verification) — June 2, 2026
**Prior completed:** Fix 1 (light mode visibility) + Fix 2 (Resend Magic Link email) — June 2, 2026
**Stage gate:** First paying session + one returning user — not yet met

**Admin dashboard bug fix (June 1, 2026 — deployed):**

| File | Change | Why |
|---|---|---|
| `app/admin/page.tsx` | `fetchDashboard()` moved above `useEffect`; dep array `[]` → `[fetchDashboard]`; `res.json()` wrapped in its own try/catch; `typeof window` guard in `useEffect` | TDZ ordering error in React strict-mode caused "Network error" on every load — closure captured uninitialized binding |
| `app/api/admin/dashboard/route.ts` | Data-fetch logic extracted to `handleDashboard()`; top-level try/catch in `GET()` returns JSON 500 | Unhandled runtime errors returned HTML, causing `res.json()` to throw → same "Network error" symptom |

**What is implemented this session — Security Sprint (June 2, 2026):**

| File | Status | Key change |
|---|---|---|
| `lib/encryption.ts` | ✅ NEW | AES-256-GCM encrypt/decrypt/encryptJson/decryptJson. DB_ENCRYPTION_KEY from Railway env. No-op when key unset (safe dev default). enc: prefix for backward compat. JSONB stored as { _enc: "enc:..." }. |
| `app/api/session/route.ts` | ✅ CHANGED | POST: encrypt decision_text, context_text. GET: decrypt both before return. |
| `app/api/outcome/route.ts` | ✅ CHANGED | encrypt what_decided and notes before upsert. |
| `app/api/examiner/route.ts` | ✅ CHANGED | GET: decrypt decision_text before AI personalisation. POST: encrypt question_text, response_text in rows before insert. |
| `app/api/persona/route.ts` | ✅ CHANGED | encrypt messages.content (both user pushback and assistant) before insert. |
| `app/api/history/route.ts` | ✅ CHANGED | decrypt decision_text and outcomes.what_decided before returning sessions array. |
| `app/api/bias-score/route.ts` | ✅ CHANGED | decrypt decision_text, context_text, messages content, examiner question_text/response_text before passing to scorer. |
| `app/api/record/route.ts` | ✅ CHANGED | decrypt session decision_text, context_text and messages content before return. |
| `app/api/record/[id]/brief/route.ts` | ✅ CHANGED | decrypt session + messages + examiner after fetch; encrypt decision_brief content before insert. |
| `app/api/structural-match/route.ts` | ✅ CHANGED | Cache hit: decrypt context_block and decryptJson(matches_json). Data path: decrypt current + past session decision_text, outcomes what_decided. Cache write: encrypt context_block and encryptJson(matches). |
| `app/api/mirror/timeline/route.ts` | ✅ CHANGED | decrypt decision_text in result map. |
| `app/api/mirror/sessions-lookup/route.ts` | ✅ CHANGED | decrypt decision_text before decision_preview trim. |
| `app/api/mirror/calibration/route.ts` | ✅ CHANGED | decrypt decision_text before 80-char tooltip slice. |
| `app/api/mirror/independence/route.ts` | ✅ CHANGED | decrypt response_text before examiner quote build. |
| `app/api/mirror/alerts/route.ts` | ✅ CHANGED | decrypt decision_text in sessionMap. |
| `app/api/mirror/rules/route.ts` | ✅ CHANGED | decrypt decision_text, question_text, response_text, messages content. |
| `app/api/mirror/contradictions/route.ts` | ✅ CHANGED | GET: decrypt decision_text in decisionMap. POST: decrypt all fields before building AI evidence. |
| `lib/avoidance-detector.ts` | ✅ CHANGED | decrypt decision_text in toOntologySnapshot; decrypt what_decided in resolvedMap. |
| `lib/independence-score.ts` | ✅ CHANGED | decrypt response_text in bySession map; decrypt decision_text before scoreSession call. |
| `lib/session-score.ts` | ✅ CHANGED | decrypt decision_text before decisionPreview slice. |
| `app/api/admin/encrypt-migrate/route.ts` | ✅ NEW (temporary) | One-shot backfill endpoint. POST with Bearer ADMIN_CODE. Run once → confirm ok:true → delete file + redeploy. Already run June 2, 2026. |
| `scripts/encrypt-existing.ts` | ✅ NEW | CLI alternative to the migrate endpoint. |
| `scripts/test-encryption.ts` | ✅ NEW | Integration test: 8 test cases covering full write→encrypted→read→decrypted cycle + backward compat. |

**What is implemented this session (June 2, 2026):**

| File | Status | Key change |
|---|---|---|
| `app/globals.css` | ✅ CHANGED | Fix 1: 8 new semantic tokens added to both dark (:root) and light ([data-theme="light"]) blocks: --info-text, --info-bg, --info-border, --success-text, --success-bg, --success-border, --overlay-bg, --overlay-bg-hover. Dark values = exact prior hardcodes. |
| `components/PersonaPanel.tsx` | ✅ CHANGED | Fix 1: "Share this context" button (rgba(96,165,250,*) → --info-*). Examiner update box (rgba(96,165,250,*) → --info-*). "Updating" badge (#60a5fa → --info-text). "Responded"/"✓" badge (rgba(74,222,128,0.9) → --success-text). |
| `components/SynthesisCard.tsx` | ✅ CHANGED | Fix 1: "This doesn't apply" override button (rgba(255,255,255,0.04/0.08) → --overlay-bg/--overlay-bg-hover). Clarification badge (rgba(74,222,128,*) → --success-*). "✓ Complete" label (rgba(74,222,128,0.9) → --success-text). |
| `components/CouncilStatusBar.tsx` | ✅ CHANGED | Fix 1: Phase badge non-synthesis background (rgba(255,255,255,0.04) → --overlay-bg). |
| `components/OutcomeTracker.tsx` | ✅ CHANGED | Fix 1: Quality-option selected bg (rgba(255,255,255,0.04) → --overlay-bg). helpedOptions bg now use --outcome-yes/partial/no CSS vars (were hardcoded dark fills #1a4a2e/#3a3a10/#4a1a1a). Button text #fff → var(--text-1) in both selection form and saved-state badge. |
| `components/ReanalyzeDrawer.tsx` | ✅ CHANGED | Fix 1: Clarification mode selected border (#4ade80 → --success-border), bg (rgba(74,222,128,0.08) → --success-bg), text (#4ade80 → --success-text). |
| `components/ExaminerPanel.tsx` | ✅ CHANGED | Fix 1: CONTEXT badge color (#4ade80 → --success-text), border (rgba(74,222,128,0.3) → --success-border), bg (rgba(74,222,128,0.07) → --success-bg). |
| `components/AuthPanel.tsx` | ✅ CHANGED | Fix 1: Linked-sessions success box bg (rgba(74,222,128,0.06) → --success-bg), border (rgba(74,222,128,0.2) → --success-border), green dot (#4ade80 → --success-text). |
| `components/IndependenceScore.tsx` | ✅ CHANGED | Fix 1: Positive delta text (#4ade80 → --success-text). |
| `app/mirror/page.tsx` | ✅ CHANGED | Fix 1: "● Active" badge color (#4ade80 → --success-text). |
| Resend + Supabase config | ✅ LIVE | Fix 2: Domain verified on Resend. Custom SMTP wired in Supabase Auth settings. Branded Magic Link HTML template live in Supabase Email Templates. |

**What is implemented this session (June 1, 2026 — deploy pending):**

| File | Status | Key change |
|---|---|---|
| `lib/mirror-fingerprint.ts` | ✅ CHANGED | R9: confirmed threshold ≥3 (was ≥2). formingRows = detection_count < 3. Forming tile builder dynamic. humanizeActivationSummary guard < 3. |
| `lib/bias-scorer.ts` | ✅ CHANGED | R9: isConfirmed ≥3. statusLabel pluralised for 2-detection forming. Synthesis columns description updated. |
| `components/BiasFingerprint.tsx` | ✅ CHANGED | R9: forming strip copy "building confidence". Narrative block "three or more patterns". |
| `lib/structural-retrieval.ts` | ✅ CHANGED | R11: MATCH_THRESHOLD + MIN_SESSIONS read from process.env. |
| `app/api/mirror/contradictions/route.ts` | ✅ CHANGED | R11: MIN_SESSIONS + RERUN_DAYS_THRESHOLD read from process.env. |
| `app/api/mirror/patterns/route.ts` | ✅ CHANGED | R11: PATTERNS_SESSION_THRESHOLD reads from process.env. |
| `app/api/mirror/rules/route.ts` | ✅ CHANGED | R11: RULES_SESSION_THRESHOLD reads from process.env. |
| `lib/avoidance-detector.ts` | ✅ CHANGED | R11: AVOIDANCE_DAYS_THRESHOLD + STRUCTURAL_ECHO_MIN_SCORE read from process.env. |
| `app/api/admin/dashboard/route.ts` | ✅ CHANGED | R11b: r11 block — effectiveThresholds (7 vars, is_overridden flag) + avoidance stats. |
| `app/admin/page.tsx` | ✅ CHANGED | R11b: R11 section — threshold table (amber overrides) + avoidance alert stat cards. R11ThresholdRow + R11Data interfaces added. |
| `.env.example` | ✅ CHANGED | All 7 threshold vars added with defaults and recalibration milestone note. |

| File | Status | Key change |
|---|---|---|
| `lib/persona-relevance.ts` | ✅ NEW | `computePersonaRelevance()` + `buildRelevanceBlock()`. RULE_PERSONA_BOOSTS config (11 rules), DIM_PERSONA_BOOSTS config (9 dimensions), structural match boost (tiered). MANDATORY NON-NEGOTIABLE directive string builder. |
| `lib/similarity.ts` | ✅ NEW | Single source of truth for `DIM_WEIGHTS`. Exports 14-dim weight map with 1.5× for ⭐ starred dims. Both structural-retrieval.ts and benchmark/route.ts import from here. |
| `app/api/persona/route.ts` | ✅ CHANGED | R5: conditional OUTPUT TRACEABILITY sentence appended to structuralBlock template. R3: `fetchCouncilContext()` extended; synthesis path wired to `computePersonaRelevance()` + `buildRelevanceBlock()`. |
| `app/api/examiner/route.ts` | ✅ CHANGED | C0 always fires. Removed `&& allRules.length < 3` from `shouldAddC0` condition. One functional line changed. |
| `lib/structural-retrieval.ts` | ✅ CHANGED | `DIM_WEIGHTS` local definition removed. Imports from `lib/similarity.ts`. `scoreVectorSimilarity()` logic unchanged. |
| `app/api/mirror/benchmark/route.ts` | ✅ CHANGED | `extractVector()` now applies `DIM_WEIGHTS` (dim-weighted raw scores). Confidence intentionally not applied cross-user. |
| `lib/bias-scorer.ts` | ✅ CHANGED | Sprint RE: `fetchCalibrationContext()` + `fetchActiveContradictions()` (both private). `fetchUserBiasContext()` extended — parallel queries, calibration + contradiction appended to synthesisBlock, directive extended with plain-language example phrasings for both. One file changed. |
| `lib/session-score.ts` | ✅ NEW | R4: `computeUserSessionScores()` + `deriveActionPlan()`. Parallel queries from sessions_ontology, bias_library, outcomes. Returns `SessionScoreData[]` with composite score + 4 sub-scores + action plan. `Omit<SessionScoreData, 'actionPlan'>` intermediate type prevents TS build error. |
| `app/api/mirror/session-score/route.ts` | ✅ NEW | R4: GET handler, auth + Mirror unlocked gate. Returns scored array (last 20 sessions). No LLM, no schema change. |
| `components/SessionReliabilityIndex.tsx` | ✅ NEW | R4: Mirror module. Per-session score list (last 10), 4 sub-score hover dots, average  trend delta (recent 5 vs prior 5), always-visible "Your next move" action plan targeting weakest avg sub-score. |
| `lib/types.ts` | ✅ CHANGED | R4: `SessionScoreData` interface appended. |
| `app/mirror/page.tsx` | ✅ CHANGED | R4: `SessionReliabilityIndex` import added. Section block inserted in UnlockedView after `CalibrationSparkline`, before Decision Timeline. |

**What is confirmed deployed (v29 — Sprints 32–34):**

| File | Status | Key change |
|---|---|---|
| `app/globals.css` | ✅ | Dark token refine; body radial gradient (fixed selector); .hero-card + .card-bloom classes; --tts-btn-* tokens; btn-primary gradient. Fix 1 (June 2, 2026): 8 new semantic tokens for light-mode-safe accent/overlay colours (--info-*, --success-*, --overlay-bg/hover) — see KDD 116. |
| `app/page.tsx` | ✅ | Hero card glass + bloom; 2px gold border; overflowX clip removed |
| `components/PersonaPanel.tsx` | ✅ | Header left-rail redesign; examiner update tag stripping fixed |
| `lib/personas.ts` | ✅ | PATTERN OBSERVATION label suppressed from synthesis output |
| `lib/bias-scorer.ts` | ✅ | Plain-language bias output; LONGITUDINAL BIAS ASSESSMENT header + raw bias_key names eliminated |

**Sprint 31 confirmed deployed (v28 QA — carried forward):**
| `app/page.tsx` | ✅ | Onboarding panels; PatternSurfaceCard + RecurringConditionCard; mirrorUnlocked; panel text sizes |
| `app/api/voice/stream/route.ts` | ✅ | `enable_endpoint_detection: false` |
| `components/MemoryEngineStatus.tsx` | ✅ | mirrorUnlocked prop; "Mirror active"; View Mirror → |
| `components/PatternSurfaceCard.tsx` | ✅ | Real decision text; show-more; actionable; click-outside |
| `components/RecurringConditionCard.tsx` | ✅ | Plain language; actionable per dimension |
| `components/ContradictionBanner.tsx` | ✅ | Correct API field names |
| `components/SessionView.tsx` | ✅ | ContradictionBanner wired; totalSessionCount; sv-navbar var(--bg-card) |
| `components/ExaminerPanel.tsx` | ✅ | \u2019 apostrophe fix |
| `app/mirror/page.tsx` | ✅ | Sub-label; no lock icons; "Activate Mirror"; gold back button |
| `app/session/[id]/page.tsx` | ✅ | totalSessionCount; no duplicate notFound |
| `lib/types.ts` | ✅ | decision_type_primary, stakes_reversibility on Session |

### Website (quorumvault.org)
Social proof section and full mobile overhaul (480px + 980px breakpoints) deployed. Billing toggle: monthly ₹1,499 / annual ₹9,999. All module names canonical and consistent with app.
**Competitive leakage audit — ✅ complete (May 30, 2026).** 3-pass review of all public copy. 31 issues resolved across HIGH/MEDIUM/LOW severity. Clean file: `index_final.html`. Third-pass residual patch: `index_final.patch`. Governing principles logged as KDDs 88–96.

---

## RULE ENGINE (lib/rule-engine.ts)

| Rule | Type | Trigger | Status |
|---|---|---|---|
| R1 — Upstream Dependency Block | REDIRECT | `upstream_dependency ≥ 5` AND `confidence ≥ 0.55` | ✅ live |
| R2 — Identity-First Gate | GATE | `identity_alignment ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R3 — No-Information Mode | GATE | `decision_discriminating_info ≤ 1 AND outcome_uncertainty ≥ 4` | ✅ live |
| R4 — Regret Asymmetry Alert | FLAG | `regret_asymmetry ≥ 5` | ✅ live |
| R5 — False Urgency Detector | FLAG | `emotional_intensity ≥ 4 AND time_pressure ≤ 2` | ✅ live |
| R6 — Multi-Party Alignment | FLAG | `decision_unit ≥ 3 AND emotional_intensity ≥ 4` | ✅ live |
| R7 — Information-First | REDIRECT | `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 2` | ✅ live (gate tightened Sprint 27) |
| R8 — Irreconcilable Values | FLAG | `value_conflict ≥ 5 AND identity_alignment ≥ 4` | ✅ live |
| R9 — Irreversibility Warning | FLAG | `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4` | ✅ live |
| R10 — Complexity Overload | GATE | `task_complexity ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R11 — Avoidance Detection | BACKGROUND | `upstream_dependency ≥ 4 AND days_open ≥ 45` | ✅ Fully live. D1: schema (sessions.last_action_at + avoidance_alerts table). D2: detection engine (avoidance-detector.ts) + cron (cron-job.org, daily 02:00 UTC). D3: Mirror surface (AvoidanceAlertCard), dismiss endpoint, synthesis resubmission context. |
| R12 — Couple Misalignment | FLAG | `decision_unit 2–3 AND value_conflict ≥ 4` | ✅ live |

---

## KEY DESIGN DECISIONS (do not re-debate)

1–42: All carried from v21 unchanged.

43. **Mirror TEASER_THRESHOLD = 3.** Permanently 3 sessions. Do not raise.
44. **getMirrorAccessState() is the sole arbiter of Mirror access.** No route queries mirror_access directly.
45. **mirror_access writes are always upsert ON CONFLICT (user_id).**
46. **Unlock tokens map to plan type.** MIRROR_TOKEN_MONTHLY → 30d, MIRROR_TOKEN_ANNUAL → 365d, MIRROR_TOKEN_LIFETIME → no expiry.
47. **fetchCouncilContextWithRetry() for initial personas only.** Synthesis uses plain fetchCouncilContext().
48. **TeaserView PRICING_URL points to https://www.quorumvault.org/#pricing.** Not .xyz.
49. **signal_type is stored in activation_contexts JSONB, not a new column.**
50. **DECISION_BRIEF mirror line goes in DECISION_BRIEF only — not SYNTHESIS.**
51. **BenchmarkModule silently renders nothing when cluster < 5.** Do not lower MIN_CLUSTER_SIZE.
52. **Canonical module names:** Bias Fingerprint, Decision Independence Score, Your Implicit Rules, What Keeps Coming Up, Contradiction Detector, Confidence Calibration. Council personas: Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor.
53. **USER_STYLE_BOOSTS is +1, rule boosts are up to +3.** Style nudge never overrides a fired rule.
54. **StyleCalibration persistence is localStorage-first, DB-second.** Key: `quorum_style_calibration_dismissed`.
55. **router.back() not Link href for Back to Council.** back() triggers bfcache, preserving full React state.
56. **initialMessages seeds PersonaPanel from DB, not from re-running AI.**
57. **height:100% removed from .persona-card.** Cards stretch to equal grid row height with dead space; natural height fixes alignment.
58. **Persona header tags output before RESPONSE STRUCTURE.**
59. **`<realcost>` not `<tradeoff>`** — "The real cost:" is more human.
60. **Header layer is in card body, not sub-header band.**
61. **withRetry wraps DeepSeek call creation only, not stream consumption.**
62. **Ontology tagger failure marks session tagger_status=failed permanently (pre-Sprint 26).** withRetry now prevents this.
63. **Confidence slider measures epistemic clarity, not outcome prediction.** "Foggy → Fully clear." Do not revert.
64. **Mirror section order: Bias Fingerprint first, Decision Timeline last.** TeaserView exempt.
65. **CoachingTip never exposes signal names.**
66. **examinerQuote selects longest response_text, not first.**
67. **Persona pill strip not 3×2 grid.**
68. **State-gated register + slider: zero logic change.** Controls reveal via CSS only.
69. **Tips section is localStorage-first, collapsed for returning users.** Key: `quorum_tips_open`.
70. **Quorum's category is "Judgment Infrastructure" / "Decision Operating System".**
71. **QUORUM flip-card uses opacity+scale crossfade, not CSS 3D backfaceVisibility.** CSS 3D unreliable with form elements inside.
72. **totalSessionCount is server-fetched, not localStorage.length.** localStorage is device-local. Always use DB count for user-visible numbers.
73. **Onboarding panels live inside the QUORUM back-face card, not as a separate overlay.** quorum_onboarded gate ensures returning users see QUORUM face directly (Panel 2) with zero regression.
74. **Voice end detection is manual-only.** `enable_endpoint_detection: false`. User taps Stop explicitly — HNI-grade thinking pauses must not trigger auto-cutoff.
75. **PatternSurfaceCard shows actual decision text (not UUID), caps fetched IDs to fire_count, shows first 2 decisions with "Show N more" expand.** Actionable line is always present per pattern narrative.
76. **ContradictionBanner fires only when violationSessionId === session.id — no fallback to most-recent contradiction.** Showing a contradiction where both sides are from past sessions reads as false context for the current decision.
77. **Flag as exception vs Update my rule are currently semantic only** — both call DELETE /api/mirror/contradictions. Distinction is a scaffold for future principle-rewrite flow. Do not wire to different backend logic until principle management is built.
78. **sv-navbar background is var(--bg-card), not var(--bg-deep).** bg-deep is identical to bg-void in dark mode — makes the nav strip invisible. bg-card is the elevated surface color, always visually distinct.
79. **Hero card background is theme-aware via CSS class, not inline style.** [data-theme="dark"] .hero-card = glass gradient; [data-theme="light"] .hero-card = var(--bg-card). Inline style must not set background — CSS class wins cleanly.
80. **Card bloom (.card-bloom) is hidden in light mode via CSS.** Warm cream bg needs no extra depth layer. Dark-only: radial-gradient(ellipse at 50% 48%, rgba(22,42,88,0.72)...).
81. **Bloom div uses top/left/right/bottom=0 (no negative horizontal inset).** inset: '-80px -100px' caused mobile centering shift by extending scrollable area. Kept vertical overflow only.
82. **overflowX: clip on flip-card wrapper was removed.** It clipped box-shadow at card edges. Centering issue was the bloom's negative inset — fixed at source, not with clip.
83. **PersonaPanel ACCENT_COLORS are now rail accent values, not background fill values.** Left-border 3px rails at partial saturation look premium; full-header blocks read as gaming dashboard. Do not revert to header blocks.
84. **TTS strip button colors use --tts-btn-color/border/bg/stop-color CSS tokens, not hardcoded rgba(255,255,255,*).** White hardcodes were invisible on light mode cream background. Token values: dark → white-ish rgba; light → var(--text-2)/var(--border-mid).
85. **Examiner update (Share to All Advisors) must call stripHeaderTags() before setExaminerUpdate() and before saving fullContent.** Initial response and pushback both stripped correctly; examiner update was the sole missing path. All three code paths now strip.
86. **Synthesis must never output "PATTERN OBSERVATION:" or "LONGITUDINAL BIAS ASSESSMENT:" as section headers.** Both are internal prompt section names, not output labels. PATTERN OBSERVATION instruction now includes explicit CRITICAL note. directiveBody in bias-scorer.ts now forbids both the header and raw bias_key names.
87. **Raw bias_key names (e.g. loss_aversion_reversal) must never appear in synthesis output.** directiveBody now instructs plain-language translation. Example canonical translation: "a tendency to weigh the regret of missing out more heavily than the risk of a concrete loss."
88. **Website copy — three-bucket rule.** Every sentence of public copy falls into one of three buckets: (1) "What Quorum does" — category claims, transformation narrative, product capabilities described at the outcome level → always publish; (2) "What the system produces" — outputs, findings, surfaced patterns → publish abstracted, no mechanism attached; (3) "How Quorum does it" — pipeline sequence, dimension counts, rule counts, mode names, scoring logic, trigger conditions, integration architecture → default remove. When in doubt, ask whether the sentence would help a competitor build. If yes, rewrite to outcome language or remove.
89. **Dimension count (14) and rule count (12) are never published.** They reveal ontology cardinality and rule engine size respectively. Replace with concept language: "structural dimensions," "structural read," "intervention logic." The concept stays public; the count does not. This applies to stats sections, step descriptions, pricing lists, and all other copy surfaces.
90. **Rule engine operating mode names never appear in public copy.** REDIRECT, GATE, FLAG are internal. "Synthesis is held / blocked / marked provisional" and "The Council's analysis is marked provisional" are internal state labels — banned from website, mocks, and social proof. Acceptable user-experience replacements: "The decision was held," "the analysis is held," "The analysis holds until then." The mode tag on the Examiner output card reads "Decision held," not "Synthesis held."
91. **Named ontology dimensions banned from pipeline descriptions.** "Reversibility. Identity stakes. Real vs. felt urgency. Prior unresolved dependencies." must not appear in a numbered process walkthrough — they read as a spec sheet. They may appear as experiential questions ("Is it reversible?") in standalone positioning copy where they describe the user's experience, not the system's taxonomy.
92. **Integration architecture is never confirmed in public copy.** The following phrases all confirm that the examiner or personas consume the ontology tagger's output and are banned: "Derived from the structural analysis," "reads the structural profile," "Each receives the structural profile of your decision," "Before synthesis fires, it reads," "Traces which structural factors shaped it," "Analysis shaped by what the decision structurally is." Replace with outcome language: "reads what the decision actually is," "every advisor already understands what they're dealing with," "you can see exactly what shaped it."
93. **Bias trigger format banned from public copy.** "X activates when [condition]" reveals conditional detection architecture (the system detects the trigger, not just the bias category). Replace with observation of when it occurred: "In the sessions where it appeared, [context]." The finding stays specific; the detection logic does not.
94. **"In parallel" for Council execution removed from public copy.** Reveals parallel execution architecture. Replace with non-architectural language: "Six advisors, each from a distinct cognitive frame, review the decision." In dec-examples copy, "run in parallel" → "each bring a distinct read."
95. **Canonical safe-to-publish copy (confirmed May 2026 audit).** These phrases are confirmed category-creation assets — philosophical positioning that cannot be reverse-engineered. Publish prominently and do not dilute: "AI has made analysis abundant and coherence scarce. Quorum is not another source of perspective — it is the system that integrates them." / "The first session is analysis. The tenth is a mirror. The fiftieth is infrastructure." / "The only system that will tell you a decision isn't ready." / "Every business process has been systematized. Judgment is the last one." / "Judgment Infrastructure" as category name. / "At the level where the cost of being wrong is measured in crores, the absence of a genuine feedback loop is its own risk factor."
96. **Website audit output files (May 30, 2026).** `quorum_leakage_analysis.html` — full audit document (31 issues, severity ratings, rewrites, safe/dangerous matrix, comparable company framing reference). `index_final.html` — production-ready revised website copy with all HIGH and MEDIUM issues resolved. `index_final.patch` — unified diff for two residual LOW items ("Builds after 3 logged outcomes" → "Builds as your decision record grows"; "in parallel" removed from three locations). Apply with: `patch index_final.html index_final.patch`.

97. **C0 fires on every decision, including complex ones (3+ rules).** The previous suppression (`allRules.length < 3`) was a false economy — C0 is the JTBD anchor and is *most* valuable precisely when the decision is complex. REDIRECT suppression is retained (C0 cannot fire if the Council is blocked). Max question count on a 3-rule decision is now 4. UX cost is one extra question; synthesis quality gain is permanent (user's success definition always recorded).

98. **Council Weighting Directive is MANDATORY NON-NEGOTIABLE, positioned last in synthesis system prompt.** Flat aggregation of 6 advisor outputs is the failure mode. The directive must be terminal in the system prompt — LLM adherence is highest for the final instruction. Positioning it earlier (between councilContext and biasBlock) risks de-prioritisation. Do not move it.

99. **RULE_PERSONA_BOOSTS in lib/persona-relevance.ts is explicit config, keyed by RuleId.** Rule IDs are typed against the union type `RuleId` which mirrors rule-engine.ts exactly. If a rule is added/renamed in rule-engine.ts, the union type in persona-relevance.ts must be updated — TypeScript will error at the Record definition if they drift. To retune weights: edit boost values in RULE_PERSONA_BOOSTS or DIM_PERSONA_BOOSTS only. No logic changes required for retuning.

100. **computePersonaRelevance() fires for synthesis even when councilContext is null.** If ontology is missing (v1.0 session or race condition at synthesis time), the function returns a flat 0.50 baseline map. buildRelevanceBlock() still serialises this as the directive — all advisors at BASELINE. The directive is valid and non-misleading. Do not gate the call on councilContext presence.

101. **DIM_WEIGHTS lives in lib/similarity.ts — the single source of truth. Never define it elsewhere.** structural-retrieval.ts (within-user comparison) and benchmark/route.ts (cross-user comparison) both import from there. The two formulas are intentionally different: structural-retrieval.ts applies score × confidence × dim_weight (confidence is valid within a user's own history); benchmark/route.ts applies score × dim_weight only (confidence is a per-session personal signal and is not portable between users — applying someone else's confidence weight to your score introduces noise, not signal). What is now consistent: the 1.5× multipliers for the three ⭐ starred dimensions (identity_alignment, regret_asymmetry, upstream_dependency) apply in both contexts. Full formula unification would require a cross-user confidence normalisation strategy — deferred, not worth the complexity at current corpus size.

102. **R5 structural output traceability is conditional, not mandatory.** The OUTPUT TRACEABILITY block in structuralBlock tells each of the 5 structural-context personas: if the structural record genuinely shaped your angle, close with one sentence beginning "Structurally, this decision [observation]." If it did not, omit entirely — do not fabricate. Rationale: weak or borderline structural matches (45–59/100) may not apply to every persona's specific analytical lens. A forced closing sentence on a non-applicable match degrades output quality more than the traceability is worth. Tech debt: the conditional creates an audit gap — a persona that omitted the sentence cannot be distinguished from one that ignored the mandate. Full traceability (requiring either a closing citation or an explicit non-applicability statement) is deferred until corpus scale makes the distinction analytically meaningful and operationally worth the prompt cost.

103. **Calibration and contradiction data in synthesisBlock must reach the user as natural prose, never as labelled data.** The calibration and contradiction directive addenda in `fetchUserBiasContext()` each supply concrete example phrasings to synthesis — e.g. "your track record suggests you tend to be more certain at the moment of deciding than your retrospective view has supported" (calibration) and "this sits in some tension with something you've articulated before" (contradiction). Synthesis is explicitly prohibited from: using the label "calibration data", creating a section header for either data type, reproducing field values verbatim as a list, surfacing contradiction tensions that are not genuinely applicable to the current decision, or quoting numbers without human meaning. This is the same plain-language contract that governs bias key translation (KDD 87) — extended consistently to all three longitudinal data types now in synthesisBlock.

104. **fetchCalibrationContext() gates on both count and magnitude.** Minimum 3 paired sessions (pre + retro both present) AND |avgDelta| ≥ 0.3. The magnitude gate ensures well-calibrated users — whose delta is noise-level — produce no injection. No point surfacing a calibration observation when the user is already accurate. The count gate prevents a single retrospective outlier from driving synthesis narrative. Both gates must be satisfied; neither alone is sufficient.

105. **Session Reliability Index formula weights: structural × 0.25, biasClarity × 0.30, councilConfidence × 0.20, calibration × 0.25.** Bias clarity weighted highest (0.30) — active distorting signals are the most actionable and most frequently occurring drag on analysis quality. Structural and calibration equal (0.25 each) — both measure contextual richness but across different axes (historical comparison vs. personal accuracy track record). Council confidence lowest (0.20) — it reflects decision framing clarity, which is least controllable within a single session. Do not rebalance without a calibration corpus of ≥ 50 sessions.

106. **Session Reliability Index action plan is global (one per user from weakest average sub-score across all sessions) — not per-session.** Per-session actions would produce contradictory advice if adjacent sessions have different weak spots. A single global action based on the user's pattern gives one clear lever. The same actionPlan string is attached to every row in SessionScoreData[] — UI reads from [0]. The action is always present even when all sub-scores are strong — maintenance actions surface in that case (e.g. "log outcomes consistently").

107. **council_confidence_score is computed deterministically from rule_engine_result.mode and flag_rules.length — no LLM call.** An LLM-based divergence score (per original audit proposal) would require a per-session inference pass adding latency and cost. The rule engine result is a structurally valid proxy: REDIRECT = decision was structurally blocked (35); GATE = structural ambiguity fired (50); flag count ≥ 3 = high complexity (60); 1–2 flags = manageable (75); 0 flags OPEN = clean conditions (90). Deterministic, auditable, and zero inference cost. If true LLM variance scoring is needed in future, it must run async post-session — not on the API request path.

108. **Audit R9 fix: confirmed bias threshold is ≥3 detections, not ≥2.** Two detections of a bias pattern is insufficient to call it confirmed — one unusual decision can produce two correlated signals in the same session cycle. Three detections across distinct sessions is the minimum for a stable fingerprint entry. The forming tier now covers detection_count 1 and 2, with appropriate hedging. Synthesis prompt updated to reflect "CONFIRMED = 3+ / FORMING = 1–2". Do not lower this back to ≥2 without a calibration corpus showing stable precision at that threshold.

109. **Audit R11: all 7 heuristic threshold constants are now configurable via Railway env vars — MATCH_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD, AVOIDANCE_DAYS_THRESHOLD, STRUCTURAL_ECHO_MIN_SCORE.** Defaults are the original heuristic values (unchanged behaviour when vars are unset). Override in the Railway Variables panel — takes effect immediately on next request, no deploy needed. Formal recalibration is mandated at 100-session and 250-session corpus milestones (see TECH DEBT section). Do not tune thresholds before 100 sessions — current heuristics will outperform empirical fits on small-n data. The admin dashboard R11 section shows which thresholds are currently overridden (amber highlight) vs at default.

110. **Audit R10 (style calibration bias in persona ordering) is permanently skipped — locked KDD.** The audit verdict was: TRUE (LOW RISK), working as designed, effect is bounded. The +1 USER_STYLE_BOOST is a tiebreaker that cannot override a fired rule signal (which carries up to +3). All 6 advisors still generate full output regardless of ordering position. First-position read bias is a UX micro-effect, not a reasoning quality gap. Monitoring for reduced diversity with strong style preferences is an informal observational check via the admin dashboard — no code needed. Do not reopen R10 as a build item.

111. **ADMIN_CODE Railway env var must be ASCII-only (ISO-8859-1 safe).** HTTP headers — including the Authorization header used to pass the admin code from the browser to the API route — only allow ISO-8859-1 characters. Setting ADMIN_CODE to a value that contains emoji, Devanagari, Arabic, or any other non-Latin character causes `fetch()` to throw `TypeError: Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point` before the request is sent. The browser's catch block then fires, producing a misleading "Network error" message. Fix: use any printable ASCII string (A–Z, a–z, 0–9, hyphens, underscores, punctuation all safe). Non-ASCII characters in the ADMIN_CODE are not sanitised in code — the constraint is on the env var value itself.

112. **Admin page hook ordering: `fetchDashboard` must be declared before the `useEffect` that calls it.** In React strict-mode (Next.js default), effects are run synchronously on mount, then cleaned up and re-run. A `const fetchDashboard = useCallback(...)` declared AFTER `useEffect(() => { ... fetchDashboard(stored) ... }, [])` means the `useEffect` closure captures `fetchDashboard` while it is in the Temporal Dead Zone. The closure call throws a ReferenceError, caught by the `catch` block as "Network error". Fix: always declare `fetchDashboard` (or any async function called inside `useEffect`) before the `useEffect` hook. The dependency array should include `fetchDashboard` (not `[]` with an eslint suppress comment), which is correct because `useCallback` with a stable dependency re-creates the function only when the dependency changes — not on every render.

113. **AvoidanceAlertCard copy contract: "avoidance" never appears in user-facing text.** The word frames the user as having failed to act, which is both inaccurate (conditions may genuinely not have been right) and counterproductive (shame is not a decision-quality lever). The card observes that time has passed — neutrally. "You first brought this N days ago. It hasn't moved." is a factual observation, not an accusation. "Hasn't moved" is the closest acceptable framing — it describes the decision's state, not the user's behaviour. Do not reintroduce "avoidance", "avoided", "stalling", or "procrastinating" in any revision of this card's copy.

114. **The resubmission context in persona/route.ts is injected at synthesis time, not at session creation.** The `resubmitAlertId` param arrives in the synthesis POST body (via SynthesisCard.tsx reading localStorage). It is looked up fresh at synthesis call time — this means: (1) ownership is confirmed again at synthesis time (not just when the user clicked "Bring it back →"), preventing a malicious alertId injection via URL manipulation; (2) the `days_open` value is the snapshot from when D2 detected it, not recalculated — intentional, since "45 days ago" is more human than "actually now 47 days"; (3) if the alert row has been deleted between click and synthesis, the injection silently skips (non-fatal). localStorage key `quorum_resubmit_alert` is cleared immediately after reading — it fires exactly once per navigation, even if synthesis is re-run in the same session.

115. **The dismiss endpoint writes a minimal outcomes row to close the D2 cron gate.** The `resolved_externally` outcome quality value signals resolution without requiring the user to complete the full Outcome Tracker flow. This is intentional — demanding full outcome data before a decision can be dismissed from the avoidance alert would create friction that discourages dismissal. The minimal row (`outcome_quality: 'resolved_externally'`, `what_decided: 'Resolved externally — marked via Mirror.'`) satisfies the D2 detection gate (session has an outcome row → not flagged). If the user later wants to file a proper retrospective, the upsert uses `ignoreDuplicates: true` on `session_id` conflict — a real outcome filing via the Outcome Tracker will overwrite this placeholder.

116. **Light mode accent colors use semantic CSS tokens, never hardcoded rgba values.** Dark-mode-only hardcodes (e.g. #93c5fd, rgba(74,222,128,0.9), rgba(255,255,255,0.04)) are invisible or illegible on the light cream background (#f4f1eb). The correct pattern is: add the value to both `:root` (dark) and `[data-theme="light"]` (light) blocks in globals.css as a named semantic token, then reference via `var(--token-name)` in all components. Eight tokens established in Fix 1 (June 2, 2026): `--info-text`, `--info-bg`, `--info-border` (blue accent family), `--success-text`, `--success-bg`, `--success-border` (green accent family), `--overlay-bg`, `--overlay-bg-hover` (glass button family). Do not introduce new hardcoded rgba values for interactive or accent elements — every new color must be tokenised at the point of creation. Exception: SVG presentation attributes (fill=, stroke=) cannot accept CSS custom properties — hardcodes are required there and are acceptable.

117. **Supabase Magic Link email is routed via Resend SMTP relay — do not revert to Supabase default SMTP.** Supabase's built-in email has no domain authentication (poor deliverability), no custom sender name, and no template control beyond basic variable substitution. Resend provides: proper SPF/DKIM/DMARC on quorumvault.org, reliable inbox placement, and full HTML template support. Config lives in Supabase Project Settings → Authentication → SMTP (host: smtp.resend.com, port 465, username: resend, password: Resend API key). The Resend API key is a Railway/Supabase secret — never commit to source. The Magic Link template uses `{{ .ConfirmationURL }}` as the only Supabase-injected variable. If the Resend API key is rotated, update the Supabase SMTP password field immediately — Magic Link emails will fail silently if the key is invalid. Template HTML is stored externally (not in codebase) — keep a copy in `/mnt/user-data/outputs/` or a design asset store as the source of truth.

118. **All raw user input is encrypted at rest using application-layer AES-256-GCM. The encryption key (DB_ENCRYPTION_KEY) is stored only in Railway env vars — never in the codebase or Supabase.** Anyone with direct Supabase dashboard access, DB credentials, or backup access sees only `enc:<iv>:<authTag>:<ciphertext>` strings. Decryption happens exclusively server-side (Railway process). The key is a 32-byte / 64 hex-char random value. Encrypted columns: sessions (decision_text, context_text), messages (content — all roles), examiner_responses (question_text, response_text), outcomes (what_decided, notes), structural_matches (context_block as enc: string; matches_json as JSONB `{_enc: "enc:..."}` wrapper). Derived tables (sessions_ontology, bias_library, structural_scores, contradiction tables, avoidance_alerts) are intentionally plaintext — they contain numeric scores, enums, and AI-derived summaries, not verbatim user input. Anthropic's API still receives plaintext for AI processing — this is inherent to the product and unavoidable; encryption protects against DB-level exposure only.

119. **Backward compatibility: decrypt() passes through any value that does not start with 'enc:' — no migration is required before deploying.** Old plaintext rows remain readable immediately after the code deploy. Backfill encryption of existing rows is a separate one-time operation (run the migrate endpoint or script). This means there is a safe window between code deploy and backfill where the DB is mixed: new rows encrypted, old rows plaintext — both read correctly. The `enc:` prefix is the sole discriminator. If DB_ENCRYPTION_KEY is not set, encrypt() is a no-op and returns the original value — the app works in plaintext mode (local dev without key configured). Never set DB_ENCRYPTION_KEY to an empty string — that is different from unset and will cause key-length validation errors. For JSONB columns (matches_json), the discriminator is the presence of a `_enc` key in the JSON object vs an array — old rows are arrays, new rows are `{_enc: "enc:..."}` objects. decryptJson() handles both cases.

120. **If DB_ENCRYPTION_KEY is ever rotated, all existing encrypted rows must be re-encrypted in the same deploy window.** The rotation process: (1) add the new key as DB_ENCRYPTION_KEY_NEW in Railway; (2) run a migration script that reads each encrypted value with the old key and re-encrypts with the new key; (3) swap DB_ENCRYPTION_KEY to the new value; (4) redeploy. Partial rotation (some rows on old key, some on new) will cause decrypt failures for old-key rows. The current codebase does not have a rotation utility — build one before rotating. At current scale (single founding user stage), rotation is low urgency. Trigger rotation if: the key is accidentally exposed, a Railway staff member with env var access leaves, or the system moves to HNI-grade private infra.

118. **All raw user input is encrypted at rest using application-level AES-256-GCM. Supabase and anyone with direct DB access sees only opaque enc: strings.** The encryption key (DB_ENCRYPTION_KEY) lives exclusively in Railway environment variables — never in the codebase, never in Supabase, never in logs. Encrypted columns: sessions.decision_text/context_text, messages.content, examiner_responses.question_text/response_text, outcomes.what_decided/notes, structural_matches.context_block/matches_json. Derived tables (numeric scores, enums, AI summaries) are intentionally left plaintext — they contain no raw user text and the decrypt overhead is not justified. All encryption/decryption happens in Railway server memory. The Anthropic API still receives plaintext for AI calls — this is inherent and unavoidable given the product's function. Railway logs must not contain decision_text in error messages — do not add debug logs that print raw field values.

119. **decrypt() is a transparent passthrough for values not starting with 'enc:' — this is the backward compat contract and must not be changed.** Old plaintext rows inserted before the Security Sprint remain readable without any migration. The backfill (encrypt-migrate endpoint) was run June 2, 2026 — SQL audit confirmed 0 plaintext rows remaining. However, the passthrough must be preserved permanently: any future row inserted without encryption (e.g. during a dev session with DB_ENCRYPTION_KEY unset) will still be readable. If DB_ENCRYPTION_KEY is not set, encrypt() is a no-op — the system writes plaintext and reads it back cleanly. Setting the key later will transparently handle the mixed state.

120. **structural_matches.matches_json is a JSONB column — encrypted values are stored as { "_enc": "enc:..." } to remain valid JSON.** Old rows contain the plaintext array directly (Array.isArray check in decryptJson handles backward compat). New rows contain the wrapped object. encryptJson() and decryptJson() in lib/encryption.ts are the only functions that should touch this pattern. Do not attempt to partially encrypt fields within the JSONB — the entire array is encrypted as a single string. The column type remains JSONB (no schema change). Supabase's JSONB operators (e.g. the ? operator for key existence) are used in the SQL audit queries to detect encrypted vs plaintext rows: `matches_json ? '_enc'` returns true for encrypted rows. Supabase's built-in email has no domain authentication (poor deliverability), no custom sender name, and no template control beyond basic variable substitution. Resend provides: proper SPF/DKIM/DMARC on quorumvault.org, reliable inbox placement, and full HTML template support. Config lives in Supabase Project Settings → Authentication → SMTP (host: smtp.resend.com, port 465, username: resend, password: Resend API key). The Resend API key is a Railway/Supabase secret — never commit to source. The Magic Link template uses `{{ .ConfirmationURL }}` as the only Supabase-injected variable. If the Resend API key is rotated, update the Supabase SMTP password field immediately — Magic Link emails will fail silently if the key is invalid. Template HTML is stored externally (not in codebase) — keep a copy in `/mnt/user-data/outputs/` or a design asset store as the source of truth.

---

## R4 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R4-1 | Mirror unlocked user — open Mirror, scroll to Session Reliability Index | Module renders below Confidence Calibration. Average score (large number) + trend delta visible. Per-session list shows last ≤10 decisions. |
| R4-2 | Hover any sub-score dot on a session row | Tooltip appears: label + exact score (e.g. "Structural: 78/100"). Disappears on mouse-out. |
| R4-3 | User with ≥5 sessions — mix of sessions with outcomes logged and sessions without | Sessions missing outcomes show yellow calibration dot (score=70). Sessions with calibration_delta ≥ 0 show teal dot (score=85). Sessions with delta < −0.3 show red/yellow dot. |
| R4-4 | User with a recurring distorting bias across ≥2 sessions | "Your next move" callout names the specific bias label (not generic copy). Gold left-border card always visible — never absent. |
| R4-5 | User whose sessions contain a REDIRECT rule result | Council confidence dot red (score=35) for that session. If >40% of sessions are REDIRECTs, action plan references the redirect pattern specifically. |
| R4-6 | User with ≥10 sessions | Trend delta line appears: "↑ N pts over last 5 sessions" or "↓" or "→ stable". Only appears when prior 5 sessions exist (≥6 sessions total). |
| R4-7 | User with only 1–2 sessions (no structural history yet) | Structural sub-score dots neutral (score=50 = yellow). Action plan reads: "Structural matching activates once Quorum has prior sessions…" Module renders without error. |
| R4-8 | Mirror locked or teaser user | GET /api/mirror/session-score returns 403. Component returns null — no empty state rendered, no error shown. |
| R4-9 | Check Railway logs during module load | No errors from computeUserSessionScores(). Three parallel DB queries complete in single round-trip. No "actionPlan is missing" TypeScript errors at runtime. |

---

## PENDING

**Sprint 32 — priority order:**

1. **IST migration** — `RecordExport.tsx` and `CalibrationSparkline.tsx` already have inline `timeZone: 'Asia/Kolkata'`. Migrate to `formatDate()` / `formatDateTime()` from `lib/dates.ts`. Audit all remaining `toLocaleDateString()` calls across codebase.

2. **ContradictionBanner — improve fire rate:** Current logic requires `violationSessionId === session.id`. The three known contradictions in the user's Mirror (autonomy×, urgency×, process×) may not map to recent session IDs. Consider: after synthesis, if no exact match exists, offer a "View your tensions →" micro-link to the Mirror Contradiction Detector section instead of showing nothing. Keep the banner itself strict (exact match only).

3. **Background visual identity** — ✅ RESOLVED Sprint 32. Implemented: navy radial gradient on body (dark mode), warm cream vignette (light mode), glass card treatment on hero card, dedicated .card-bloom radial behind card.

4. **Chunk 4b test coverage** — Run these decisions to generate new contradiction-eligible sessions:
   - "I want to move fast on this acquisition even though I haven't done proper due diligence — the opportunity feels too good to miss" (triggers autonomy tension)
   - Then POST /api/mirror/contradictions with `force: true` if banner still doesn't fire

5. **Product Chunks (deferred until stage gate):**
   - Chunk 1 Judgment Profile as primary object (home screen structural reframe beyond current strip)
   - Chunk 3 Mirror teaser reframe: profile-in-construction with "X of 5 decisions needed" progress
   - Chunk 2 RecordReceipt extension: structural dimension summary below count

**Parked items (do not build until stage gate met):**
- Razorpay webhook wiring
- Contradiction log table (`contradiction_log` as first-class table) — after ~30–50 sessions
- Institutional pricing (annual license per principal)

**Stage gate to Sprint 32 full build:** First paying session at any price point + one returning user who explicitly returns for a second real decision.

---

## RESOLVED / CLOSED

*(All items from v27 carried forward unchanged)*

- **Audit R9 (Identity overfitting — confirmed threshold too low)** → ✅ Fixed June 1, 2026. Confirmed threshold raised from ≥2 to ≥3 in mirror-fingerprint.ts and bias-scorer.ts. Forming tile builder made dynamic for detection_count 1–2. BiasFingerprint.tsx copy updated. Deploy pending.
- **Audit R10 (Style calibration bias in persona ordering)** → ✅ Permanently skipped. Audit verdict: LOW RISK, working as designed. Locked as KDD 110. No code required.
- **Admin dashboard "Network error" bug (June 1, 2026)** → ✅ Fixed. Two causes: (1) `fetchDashboard` declared after `useEffect` — TDZ reference in React strict-mode; fixed by moving `fetchDashboard` above `useEffect` and correcting dep array to `[fetchDashboard]`. (2) Unhandled route errors returned HTML not JSON — `res.json()` threw, caught as "Network error"; fixed by wrapping route in top-level try/catch returning JSON 500. Root trigger in production: ADMIN_CODE contained non-ASCII character (emoji/special symbol) — `fetch()` threw before even sending the request. Fixed by user removing non-ASCII characters from ADMIN_CODE. See KDDs 111 and 112.
- **Additional Risk D — D3 (Mirror surface, dismiss, synthesis resubmission)** → ✅ Implemented June 1, 2026. components/AvoidanceAlertCard.tsx (NEW). app/api/mirror/avoidance/dismiss/route.ts (NEW). app/api/mirror/alerts/route.ts updated. app/api/persona/route.ts updated. app/mirror/page.tsx updated. app/page.tsx updated. components/SynthesisCard.tsx updated. Full R11 loop complete: D1 schema → D2 detection → D3 surface → dismiss → synthesis context. Deploy pending.

- **Audit R11 (Heuristic thresholds not configurable)** → ✅ Fixed June 1, 2026. All 7 threshold constants now env-configurable via Railway. Admin dashboard R11 section added (effectiveThresholds + avoidance stats). .env.example updated. Deploy pending. D3 (AvoidanceAlertCard) remains parked. C0 now always fires regardless of rule count. One condition removed from examiner/route.ts.
- **R4 (No unified decision scoring layer)** → ✅ Implemented May 31, 2026. lib/session-score.ts (NEW) — computeUserSessionScores() + deriveActionPlan(). app/api/mirror/session-score/route.ts (NEW). components/SessionReliabilityIndex.tsx (NEW). lib/types.ts + app/mirror/page.tsx updated. TypeScript fix: Omit<SessionScoreData, 'actionPlan'> intermediate array. No schema change, no LLM. Deploy pending.
- **R3 (Council Weighting Directive — flat synthesis aggregation)** → ✅ Implemented May 31, 2026. lib/persona-relevance.ts created. persona/route.ts updated. Deploy pending.
- **R5 (Structural context injected as text only, no output traceability)** → ✅ Implemented May 31, 2026. Conditional OUTPUT TRACEABILITY requirement appended to structuralBlock in persona/route.ts. One functional change (~4 lines). Deploy pending.
- **Additional Risk A (recency_bias hardcoded to 'neutral')** → ✅ Confirmed pre-existing fix (Sprint R2). classifyBiasSignal() in bias-scorer.ts already returns 'distorting' when ddInfo ≥ 4. No new files needed.
- **Additional Risk B (C0 suppression on complex decisions)** → ✅ Same as C0 fix above. Resolved May 31, 2026.
- **Additional Risk C (benchmark vs structural retrieval math inconsistency)** → ✅ Fixed May 31, 2026. lib/similarity.ts (NEW). structural-retrieval.ts imports DIM_WEIGHTS from it. benchmark/route.ts extractVector() now applies dim weights. Deploy pending.
- **Additional Risk E (calibration delta and contradiction data not reaching synthesis)** → ✅ Fixed May 31, 2026. lib/bias-scorer.ts only. fetchCalibrationContext() + fetchActiveContradictions() added (private). fetchUserBiasContext() extended with parallel queries and synthesisBlock addenda. Directive extended with example phrasings enforcing plain-language, prose-woven output. One file changed. Deploy pending.
- **Additional Risk F (synthesis has no access to bias signals)** → ✅ Confirmed pre-existing fix (Sprint R2). fetchUserBiasContext() in lib/bias-scorer.ts already returns synthesisBlock + personaAlert. Both firing correctly. No new files needed.

- **Fix 1 (Light mode button visibility — June 2, 2026)** → ✅ Implemented. 8 semantic CSS tokens added to globals.css (--info-text/bg/border, --success-text/bg/border, --overlay-bg/hover) with correct dark + light values. 9 component files updated: PersonaPanel.tsx, SynthesisCard.tsx, CouncilStatusBar.tsx, OutcomeTracker.tsx, ReanalyzeDrawer.tsx, ExaminerPanel.tsx, AuthPanel.tsx, IndependenceScore.tsx, app/mirror/page.tsx. Root cause: three classes of hardcoded dark-only values invisible/illegible in light mode. See KDD 116.
- **Security Sprint (Field encryption — June 2, 2026)** → ✅ Complete. lib/encryption.ts (AES-256-GCM, enc: prefix, JSONB {_enc} wrapper). 21 files patched across 5 write paths and 16 read paths. app/api/admin/encrypt-migrate/route.ts (NEW, temporary — delete after use). scripts/test-encryption.ts (NEW). Backfill endpoint called June 2, 2026. SQL audit verified 0 plaintext rows in all 5 encrypted tables. DB_ENCRYPTION_KEY set in Railway. KDDs 118–120 logged.

- **Security Sprint (Application-level AES-256-GCM field encryption — June 2, 2026)** → ✅ Deployed + backfill complete. lib/encryption.ts (NEW). 21 files patched across all write and read paths. app/api/admin/encrypt-migrate/route.ts (NEW, temporary — delete after use). scripts/encrypt-existing.ts (NEW). scripts/test-encryption.ts (NEW). Backfill migration run June 2, 2026. SQL audit confirmed 0 plaintext rows across all 5 encrypted tables. DB_ENCRYPTION_KEY added to Railway env vars. See KDDs 118–120.

- **Fix 2 (Supabase Magic Link via Resend — June 2, 2026)** → ✅ Live. Resend domain verified. Supabase SMTP configured (smtp.resend.com:465). Branded HTML Magic Link template active in Supabase Auth → Email Templates. See KDD 117.
- **Sprint 31 items marked "pending" in v27** → ✅ All confirmed deployed in v28 QA pass (May 30, 2026):
  - Onboarding panels (isOnboarding, onboardPanel, quorum_onboarded)
  - PatternSurfaceCard.tsx — decision text, show-more, actionable, click-outside
  - RecurringConditionCard.tsx — plain language, actionable
  - ContradictionBanner.tsx + SessionView wiring — correct field names
  - ExaminerPanel.tsx — &apos; → \u2019
  - voice/stream/route.ts — enable_endpoint_detection: false
  - globals.css — --bg-void #060c1a, --gold #d4a843
  - useSoniox.ts — 300ms finalize delay, 8s timeout guard (from session fixes, now in codebase)
- **sv-navbar background still var(--bg-deep) in v27 zip** → ✅ Fixed in v28. Correct value var(--bg-card) confirmed.
- **RecordReceipt showing localStorage count (~21) instead of DB count** → ✅ Sprint 30.
- **Mirror MemoryEngineStatus showing "Mirror ready to activate" for paid subscriber** → ✅ Sprint 30 + 31. mirrorUnlocked prop + correct status label.
- **ExaminerPanel &apos; rendering as literal text** → ✅ Sprint 31. \u2019 Unicode right single quote.
- **Voice auto-terminating on silence** → ✅ Sprint 31. enable_endpoint_detection: false.

- **Sprint 32–34 items** → ✅ All deployed May 30, 2026:
  - Dark token values nudged (--bg-void #080f1c, surfaces #101827/#151e2f, borders #202b40/#2b3a55)
  - Body radial gradient — selector was broken ([data-theme="dark"] html never matched; fixed to html[data-theme="dark"])
  - Hero card glass treatment + .hero-card CSS class
  - .card-bloom radial div (dark only)
  - PersonaPanel header: full-color block → left rail + dark neutral bg
  - TTS strip: theme-aware button color tokens
  - btn-primary: warm gold gradient, dark text
  - Input focus ring: calibrated navy-blue
  - overflowX: clip removed from card wrapper (was cutting shadows on mobile)
  - Light mode: bloom hidden, warm cream vignette added
  - Card border: 2px solid var(--gold-dim)
  - Examiner update tag stripping: stripHeaderTags() added to examiner useEffect code path
  - Synthesis PATTERN OBSERVATION: no longer appears as a header label in output
  - Synthesis bias section: no LONGITUDINAL BIAS ASSESSMENT header; no raw bias_key names
---

## KNOWN GAPS (logged, not prioritised)

- **Email auto-link on fresh magic-link login:** After Supabase magic link login, `loadHistory` reads authToken but does not read `session.user.email` → userEmail stays null → AuthPanel re-appears. Fix is 3 lines in loadHistory. Low impact at current scale.
- **Private benchmarking Phase 2** (outcome data, N≥50) — after corpus grows
- **Decision Graph** — requires ~20 sessions per user
- **Hybrid semantic + ontology structural retrieval**
- **TTS pace gap at 1.5×/2×:** Brief silence between chunks at elevated speeds. Fix: derive pre-fetch lead time from rate × chunkDuration. Currently mitigated by PREFETCH=1 + retry.

---

## TECH DEBT

### TD-1 — Threshold Recalibration at Higher Decision Count
**Added:** June 1, 2026 (R11 sprint)
**Priority:** Mandatory at corpus milestones — do not forget

All 7 heuristic threshold constants (MATCH_THRESHOLD=45, MIN_SESSIONS=5, PATTERNS_SESSION_THRESHOLD=3, RULES_SESSION_THRESHOLD=8, RERUN_DAYS_THRESHOLD=7, AVOIDANCE_DAYS_THRESHOLD=45, STRUCTURAL_ECHO_MIN_SCORE=60) were set with a ~60-session corpus. They are reasonable bootstrap values but have not been empirically validated. As of R11, all are configurable via Railway env vars without a deploy.

**Mandatory recalibration schedule:**
- **100-session milestone:** Open admin dashboard → R8 Threshold Sensitivity section. Check corpus counts at current vs ±10% variants for each threshold. Where the ±10% count differs significantly from current (cliff-edge sensitivity), reconsider the value. Also check R7 (Rule Calibration) for any rules with negative council_helped delta — these may need threshold adjustment in rule-engine.ts.
- **250-session milestone:** Full empirical recalibration. Use actual outcome data (from /api/mirror/outcomes) to validate whether each threshold is producing signal or noise. Check the admin dashboard R8 section for each constant. Adjust via Railway env vars first; if a threshold change is confirmed stable at 250 sessions, move it to the code default.

**Why not recalibrate before 100 sessions:** Fitting thresholds to sub-100 data produces overfit heuristics — the sample is too small to distinguish signal from session-composition variance. The current heuristics are more generalisable at this corpus size than any empirically derived values would be.

**Tooling:** Admin dashboard R8 section provides sensitivity analysis for all constants. Admin dashboard R11 section shows which values are currently overridden vs at default. Both sections are already built.

---

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_PROVIDER              (anthropic | deepseek)
AI_MODEL                 (claude-sonnet-4-20250514 | deepseek-chat)
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
DB_ENCRYPTION_KEY        ← AES-256-GCM key for field encryption. 64 hex chars (32 bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))". Set in Railway only — never commit. See KDDs 118–120.
MIRROR_TOKEN_MONTHLY     ← shared code for monthly access (30 days)
MIRROR_TOKEN_ANNUAL      ← shared code for annual access (365 days)
MIRROR_TOKEN_LIFETIME    ← shared code for lifetime access (no expiry)
MIRROR_UNLOCK_TOKEN      ← legacy fallback, treated as lifetime — keep until all old codes retired
SONIOX_API_KEY           ← Soniox STT + TTS shared key
DB_ENCRYPTION_KEY        ← AES-256-GCM key for field encryption (64 hex chars / 32 bytes).
                           Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
                           Never commit to source. If unset, encryption is silently skipped (dev-safe).
                           Rotating this key requires re-running the backfill migration to re-encrypt all rows.
```

### Calibration Threshold Variables (R11 — June 1, 2026)

All 7 are optional. When unset, the system uses the heuristic default shown below — no behaviour change. Set in Railway Variables panel; takes effect on next request (no deploy). **Do not tune before 100-session corpus milestone.** See TECH DEBT section for recalibration schedule. All current values visible in the admin dashboard R11 section, with amber highlight if any override is active.

| Variable | Default | Plain-English Meaning |
|---|---|---|
| `MATCH_THRESHOLD` | `45` | **How similar does a past decision need to be before it counts as relevant context for your advisors?** Score is 0–100. At 45, a moderately similar past decision is surfaced. Lower = more past decisions shown (broader context, some loosely related). Higher = only the closest structural matches used. *Example: set to 55 if advisors are receiving too many weakly-related past decisions as context; set to 35 if the feature feels absent for users with few sessions.* |
| `MIN_SESSIONS` | `5` | **How many decisions must a user have logged before structural matching and contradiction detection switch on?** Below this count, those features don't fire — not enough history to compare against. Lower = features activate earlier per user. Higher = longer wait for richer context. *Example: set to 3 to give access after 3 decisions instead of 5; useful if early users feel features are missing.* |
| `PATTERNS_SESSION_THRESHOLD` | `3` | **How many decisions must a user have before the "What Keeps Coming Up" Mirror section generates?** Pattern detection needs enough history to find recurring signals. Lower = section appears sooner with less validated patterns. Higher = section withheld until more history exists. *Example: set to 2 if early Mirror subscribers complain this section is always empty.* |
| `RULES_SESSION_THRESHOLD` | `8` | **How many decisions must a user have before their implicit decision rules are extracted for the Mirror?** Rule extraction needs sufficient history to spot consistent themes. Lower = rules extracted from less data (potentially less reliable). Higher = longer wait before user sees this Mirror feature. *Example: set to 6 to give early Mirror subscribers access two sessions sooner.* |
| `RERUN_DAYS_THRESHOLD` | `7` | **How many days must pass before the contradiction detector re-checks a user's decision record for new tensions?** This prevents it from rerunning on every session. Lower = more frequent checks (marginally fresher contradictions, slightly more compute). Higher = less frequent. *Example: set to 14 as user count grows to halve background compute; set to 3 to make contradiction detection near-real-time.* |
| `AVOIDANCE_DAYS_THRESHOLD` | `45` | **How many days must a decision sit open (no outcome filed) before R11 flags it as a potential avoidance pattern?** A decision still open after 45 days with high upstream dependency scores gets an alert. Lower = alerts fire sooner on less-stale decisions. Higher = only genuinely stuck decisions get flagged. *Example: set to 30 for a more proactive avoidance signal; set to 60 if 45-day alerts are producing too many false positives.* |
| `STRUCTURAL_ECHO_MIN_SCORE` | `60` | **When an avoidance alert fires, how similar must a resolved past decision be to qualify as a "structural echo" — a precedent Quorum shows the user?** Score is 0–100. At 60, a reasonably similar past decision is surfaced as a reference point. Lower = more past decisions shown as echoes (some may feel loosely related). Higher = only near-identical past decisions surface. *Example: set to 70 if the echoes being surfaced feel like loose structural matches; set to 50 if no echoes are being found at all.* |

---

## R3 + C0 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| C0-1 | Submit a decision that triggers 3 rules (e.g. high-stakes, irreversible, self-imposed urgency). Check examiner questions. | 4 questions appear: 3 rule questions + C0 (JTBD anchor) last. Server log shows `rules: R2,R9,R5,C0`. |
| C0-2 | Submit a simple decision (0 rules fire). Check examiner questions. | C0 still appears as the only or final question. Was suppressed before this fix. |
| C0-3 | Submit a REDIRECT decision (R1 or R7 fires with full confidence). | C0 does NOT appear — REDIRECT suppression is retained. |
| R3-1 | Run any synthesis. Check server log. | `[Persona] Council weighting directive injected for synthesis` log line present. |
| R3-2 | Run synthesis on a decision where R9 fired (irreversible + self-pressure). | Risk Architect and Contrarian should have highest weights in directive. If synthesis output resolves divergence in favour of a BASELINE advisor over a DOMINANT one without non-structural justification, the directive is not being followed — flag for prompt review. |
| R3-3 | Run synthesis on a session with a HIGH-CONFIDENCE structural match (≥80/100). | Pattern Analyst weight elevated (+0.30). Server log confirms `maxStructuralScore` was non-null. |
| R3-4 | Run synthesis on a v1.0 session (no ontology vector). | Directive still appears with flat 0.50 BASELINE for all advisors. No crash. |

---

## R5 + ADDITIONAL RISK C TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R5-1 | Run a session where you have ≥5 past sessions and current decision scores ≥80 structural match. Review Pattern Analyst and Risk Architect outputs. | At least one persona ends with a sentence beginning "Structurally, this decision..." — confirms traceability sentence is firing on strong matches. |
| R5-2 | Run the same session — review Competitor output. | No traceability sentence. Competitor is not in PERSONAS_WITH_STRUCTURAL_CONTEXT — confirms the block is gated correctly. |
| R5-3 | Run a session where structural match is borderline (45–59/100). Review all 5 structural-context persona outputs. | Some or all may omit the traceability sentence — this is correct (conditional design). Fabricated citations are the failure mode, not omissions. |
| RC-1 | Open the Mirror benchmark panel (≥5 past sessions, cluster ≥5). Check that the cluster composition is plausible. | Decisions with high identity_alignment, regret_asymmetry, or upstream_dependency scores should be more likely to cluster — confirming dim weights are now applied in cross-user similarity. |
| RC-2 | Verify no crash in structural-retrieval.ts after DIM_WEIGHTS import change. | Run any new session end-to-end. Check Railway logs — no "DIM_WEIGHTS is not defined" or import errors. |

---

## SPRINT 31 TEST LOG (use to validate current deployment)

| # | Test | Expected |
|---|---|---|
| O1 | New user (clear localStorage) | Panel 0 inside card: "01 · THE COUNCIL" + dots + "TAP TO CONTINUE →" |
| O2 | Tap card | Panel 1: "02 · YOUR MIRROR" |
| O3 | Tap card again | QUORUM face (Panel 2). Tap CTA → flip to form |
| O4 | Skip → | Jumps to QUORUM face directly |
| O5 | Returning user | Card shows QUORUM face directly (no panels) |
| P1 | Home page — Mirror user ≥5 sessions | PatternSurfaceCard appears above MemoryEngine |
| P2 | PatternSurfaceCard decision links | Shows actual decision text (not UUID) |
| P3 | PatternSurfaceCard > 2 decisions | "Show N more" button appears |
| P4 | PatternSurfaceCard | One actionable line ("What to do next time") present |
| P5 | Click outside PatternSurfaceCard | Expanded decisions list collapses |
| P6 | RecurringConditionCard | Appears if top dimension has high_count ≥ 3; plain-language description; actionable line |
| C1 | ContradictionBanner — session that is violation | Banner fires below RecordReceipt post-synthesis |
| C2 | "Flag as exception" | Banner disappears, does not refire |
| C3 | "Update my rule" | Same dismissal behaviour |
| V1 | Voice recording — pause 3+ seconds | Does NOT auto-stop |
| V2 | Voice — tap Stop | Finalising… → done, transcript populated |
| E1 | ExaminerPanel R7 redirect text | "the Council's read" renders with correct apostrophe, not &apos; |
| B1 | Dark mode background | Deep navy tint visible (#080f1c) — not pure black; radial gradient at top visible |
| G1 | Dark mode gold | Brighter (#d4a843) — clearly readable on dark background |
| M1 | MemoryEngineStatus — Mirror unlocked user | "Pattern Memory active · Mirror active" + "View Mirror →" |
| M2 | MemoryEngineStatus — teaser ready, not unlocked | "Mirror preview activates" + "View Mirror →" |
| N1 | Session page nav bar | Visually distinct from page background (bg-card) |

---

## SPRINT 30 TEST LOG

| # | Test | Expected |
|---|---|---|
| F1 | Land on home (new user) | QUORUM wordmark card, gold rules, "Add to your judgment record" CTA |
| F2 | Click card | Crossfade to decision form. Advisor line + personas fade in below |
| F3 | New user strip | "YOUR JUDGMENT RECORD · 0 decisions" + "Every decision builds…" second line |
| F4 | Returning user strip | Count correct, no second line |
| F5 | Mobile (375px) | Card height ~78% of viewport, not full-height |
| F6 | Gap card → MemoryEngine | Tighter (clamp 20–28px) |
| R1 | RecordReceipt — after synthesis | Card appears below SynthesisCard, shows real DB count |
| R2 | RecordReceipt — before synthesis | Does not appear |
| M1 | MemoryEngineStatus — Mirror unlocked | "Pattern Memory active · Mirror active" + "View Mirror →" |
| M3 | Mirror paywall state | No lock icons, "Activate Mirror" language, ₹9,999/year |
| M4 | Mirror unlocked state | Zero changes to any module in UnlockedView |
| A2 | Date on any decision in history | IST time, not device timezone |

---

## SPRINT 32–34 TEST LOG

| # | Test | Expected |
|---|---|---|
| UI1 | Dark mode — hero card | Glass effect: translucent dark gradient, gold border 2px, soft top-edge highlight |
| UI2 | Dark mode — page background | Subtle radial navy bloom at top; not flat black |
| UI3 | Dark mode — persona cards | Dark neutral header (not saturated red/blue/green); 3px coloured left rail; muted icon |
| UI4 | Dark mode — CTA button | Warm gold gradient (#D2B66B → #B89445), dark text (#101318), visible box-shadow |
| UI5 | Light mode — hero card | Clean white card (var(--bg-card)), not dark glass |
| UI6 | Light mode — page background | Warm cream vignette; no dark blue bloom |
| UI7 | Light mode — TTS strip | "Read aloud", "Stop", "1.5×" text legible (dark text on cream bg) |
| UI8 | Mobile — hero card | Card centered correctly; no edge clipping; bloom present in dark, absent in light |
| FX1 | Share to All Advisors → Risk Architect | Response shows no raw <lens>, <position>, <realcost> tags |
| FX2 | Share to All Advisors → Elder | Same — no raw XML tags |
| FX3 | Share to All Advisors → Competitor | Same — no raw XML tags |
| FX4 | Council Synthesis | No "PATTERN OBSERVATION:" header label visible in output |
| FX5 | Council Synthesis (user with confirmed bias) | No "LONGITUDINAL BIAS ASSESSMENT:" header; no raw bias key like "loss_aversion_reversal" in text |
| FX4 | Council Synthesis | No "PATTERN OBSERVATION:" header label visible in output |
| FX5 | Council Synthesis (user with confirmed bias) | No "LONGITUDINAL BIAS ASSESSMENT:" header; no raw bias key like "loss_aversion_reversal" in text |
| FX6 | Council Synthesis (user with confirmed bias) | Bias observation is woven into prose in plain language |

---

## SPRINT RE TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| RE-1 | Run synthesis for a user with ≥3 sessions where both pre_decision_confidence and retrospective_confidence are filled, and \|avgDelta\| ≥ 0.3. | Synthesis output contains a natural-language observation about confidence pattern — e.g. "your track record suggests you tend to enter decisions with more certainty than your retrospective view later supports." No label like "Calibration pattern:" or "calibration data" visible. No number quoted unless it adds human meaning. |
| RE-2 | Run synthesis for a user with < 3 paired calibration points (or \|avgDelta\| < 0.3). | No calibration observation in synthesis output. Gate is working. |
| RE-3 | Run synthesis for a user with ≥1 active (non-dismissed) contradiction in the contradictions table, where the tension is relevant to the current decision's domain. | Synthesis references the tension as a natural observation — e.g. "this sits in some tension with something you've articulated before." The word "contradiction" does not appear. No structured list of principle_text / violation_text fields. |
| RE-4 | Run synthesis for a user with active contradictions, but where none are relevant to the current decision domain. | No contradiction reference in synthesis output. Directive correctly gates on relevance ("only if directly applicable"). |
| RE-5 | Run synthesis for a user with zero active contradictions (all dismissed or none generated yet). | No contradiction reference. No crash. |
| RE-6 | Check Railway logs for any session with a user who has calibration data. | Log shows no `[BiasContext]` error. fetchCalibrationContext and fetchActiveContradictions complete within the same latency envelope as the existing bias_library query (all three run in parallel). |
| RE-7 | Confirm return shape of fetchUserBiasContext() is unchanged. | synthesisBlock, personaAlert, hasAnyBiases — all three fields present. personaAlert still only fires for confirmed DISTORTING bias (no change). No new fields in return object. |

---

## ADMIN DASHBOARD GUIDE

**Access:** `/admin` (requires admin auth). Route: `app/api/admin/dashboard/route.ts`. Data refreshes on each page load — no caching.

The dashboard has three sections: **R7 (Rule Calibration)**, **R8 (Threshold Sensitivity)**, and **R11 (Active Thresholds + Avoidance Stats)**. Each has a different review cadence and action pattern.

---

### R7 — Rule Calibration

**What it shows:** For each of the 12 rules (R1–R12), the dashboard shows: how many times it fired in the last 90 days, how many of those sessions have an outcome logged, the average `council_helped` score when the rule fired, the global average `council_helped` across all sessions, and the delta between the two.

**What to look for:**
- **Red-flagged delta (negative):** The rule is firing on sessions where the Council was *less* helpful than average. This means the rule may be triggering too broadly — catching decisions where it isn't actually needed, which degrades session quality without structural justification.
- **Positive delta:** The rule is adding value — sessions where it fires are producing better Council output than average. This is the expected pattern for a well-calibrated rule.
- **Low outcome count:** The rule fires frequently but few sessions have outcomes logged. Cannot assess quality. Prompt users to complete the Outcome Tracker after decisions resolve.
- **Zero fires in 90 days:** The rule may be too conservative (threshold too high) or genuinely rare. Check whether the trigger condition has ever been met — if the rule is correct, leave it; if it seems like it should be firing more, review the threshold.

**What actions to take:**
- 🔴 Flagged rule → Investigate 3–5 sessions where that rule fired and `council_helped` was 'no' or 'partially'. Is the rule firing on decisions that don't genuinely need it? If yes, raise the trigger threshold for that rule in `lib/rule-engine.ts`. Log the change as a KDD with the corpus count at which the adjustment was made.
- ✅ All rules positive or neutral → No action needed. Review monthly.
- No outcome data at all → Block time for users to complete outcome tracking before the next R7 review.

**Review cadence:** Monthly. Do not adjust rule thresholds based on fewer than 5 outcome-linked fires per rule.

---

### R8 — Threshold Sensitivity

**What it shows:** For each calibration threshold constant, the dashboard shows: the current value, the corpus count at the current value, the corpus count at current value −10%, and the corpus count at current value +10%. A milestone badge indicates corpus maturity: ⚪ = under 100 sessions (do not touch), 🟡 = 100+ sessions (review), 🟢 = 250+ sessions (recalibrate).

**What to look for:**
- **⚪ badge on all rows:** Corpus is still under 100 sessions. The current heuristic defaults are more generalisable than any empirically fitted values would be at this size. Do nothing.
- **🟡 badge on any row:** The threshold is now reviewable. Check whether the current count differs significantly from the ±10% variants:
  - *Cliff-edge sensitivity* (large count change at ±10%): The threshold is sitting at a sensitive point — small changes produce large effects. Worth scrutiny before 250 sessions.
  - *Flat zone* (±10% barely changes the count): The threshold is robust to small perturbations. Lower urgency — leave for 250-session review.
- **🟢 badge on any row:** Formal recalibration time. Use outcome data to assess whether the threshold is producing signal or noise. The corpus is large enough to justify an empirical adjustment. Change via Railway env var first; if stable after 4–6 weeks, move to code default and log as KDD.
- **Note for MIN_SESSIONS:** This threshold controls feature activation per user, not corpus count. The "corpus count" at current value shows how many users have reached that session count. If only a handful of users have crossed the threshold, recalibration isn't meaningful yet.

**What actions to take:**
- ⚪ across all rows → nothing. Next review at 100-session milestone.
- 🟡 on a cliff-edge row → note the sensitivity. Flag for review at 250 sessions. No change yet.
- 🟢 on any row → run the full recalibration per TD-1 (TECH DEBT section). Use Railway env var to test the new value for 4–6 weeks before committing to code.
- Any row where current count = 0 → the threshold is too high and the feature is never firing. Investigate immediately — this is a functional gap, not a calibration question.

**Review cadence:** At 100-session and 250-session milestones. Not monthly — the corpus moves slowly and sensitivity analysis is only meaningful when the corpus has grown materially since the last review.

---

### R11 — Active Thresholds + Avoidance Stats

This section has two parts: the **threshold table** (which shows the live effective value of each env-configurable constant) and the **avoidance alert stats** (which show R11 detection activity).

#### Threshold Table

**What it shows:** For each of the 7 configurable threshold constants, the table shows the hardcoded default value, the currently active effective value, and whether the value is being overridden by a Railway env var (amber badge) or sitting at the code default (grey badge).

**What to look for:**
- **All rows grey (default):** No overrides active. The system is running on heuristic defaults. Expected state before 100-session milestone.
- **Any amber row:** A threshold has been overridden via Railway env var. This is intentional if an override was set deliberately. If unexpected, investigate — a stale env var from a past test may still be active.
- **Effective value ≠ default but no amber badge:** This should not be possible (the badge derives from the same comparison). If seen, it is a display bug — check the `is_overridden` logic in `dashboard/route.ts`.

**What actions to take:**
- Confirm each amber-flagged override is intentional. If a test override was applied and the test is done, remove the env var from Railway to restore the default.
- If an override has been stable and validated for ≥6 weeks at the 250-session milestone, consider moving it to the code default and logging it as a KDD.

#### Avoidance Alert Stats

**What it shows:** Four numbers — total alerts generated by R11, currently open alerts (no outcome filed), dismissed alerts, and average days open across all alerts. Below the cards: the currently active detection threshold (days open ≥ N) and echo minimum score.

**What to look for:**
- **Open alerts > 0:** Users have decisions that have been sitting unresolved past the threshold. This is actionable — the Mirror's avoidance section (D3, when built) should surface these. Until D3 is built, these can be reviewed manually in the `avoidance_alerts` table.
- **Total = 0 despite many sessions:** R11 is either not firing (no sessions have been open long enough) or the `avoidance_alerts` table migration has not been applied. Check Supabase for the table's existence first.
- **Dismissed > Open:** Users are engaging with and resolving avoidance alerts. Healthy signal.
- **Avg days open > 2× the threshold:** Alerts are piling up undismissed. Either the threshold is too low (firing too aggressively) or users aren't seeing the alerts (D3 not built yet — expected until that sprint ships).

**What actions to take:**
- Total = 0 and sessions exist → check `avoidance_alerts` table in Supabase. If absent, apply the D1 migration.
- Open count high + D3 not built → note for next sprint prioritisation. These are real avoidance signals sitting undelivered to users.
- `AVOIDANCE_DAYS_THRESHOLD` feels too aggressive (false positives) → raise it via Railway env var. Monitor open count over 2 weeks.

**Review cadence:** Monthly once R11 cron is generating alerts. Weekly during the first month after D3 ships (to calibrate threshold against real user feedback).

---

## R9 / R11 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R9-1 | User with exactly 2 detections of any bias — open Mirror → Bias Fingerprint | Tile appears in **forming** section (not confirmed). Confidence dots = 2. Interpretation reads "1 more session to confirm." No full activation summary (may have partial if AI call ran for that entry). |
| R9-2 | User with exactly 3 detections of a bias — open Mirror → Bias Fingerprint | Tile appears in **confirmed** section. Full activation summary and interpretation rendered. |
| R9-3 | User with 1 detection — open Mirror → Bias Fingerprint | Tile in forming section. Confidence dots = 1. Static fallback: "Pattern forming — one more session to confirm." Activation summary null (correct — insufficient data). |
| R9-4 | Forming section header text | Reads "N patterns forming — building confidence" — NOT "one more session to confirm". |
| R9-5 | Mirror narrative block (no confirmed patterns yet) | Text reads "three or more patterns are confirmed" — not "two or more". |
| R9-6 | Run any synthesis for user with 2-detection bias | Synthesis columns description reads "FORMING = 1–2 detections". statusLabel for that bias reads "FORMING (2 detections)" — plural correct. |
| R11a-1 | All threshold env vars unset in Railway | All features behave identically to pre-sprint. No regressions. Structural matching still fires at 45, patterns at 3 sessions, etc. |
| R11a-2 | Set `PATTERNS_SESSION_THRESHOLD=2` in Railway, open Mirror for a user with exactly 2 sessions | "What Keeps Coming Up" section now generates (previously required 3). Remove var after test. |
| R11a-3 | Set `MATCH_THRESHOLD=70` in Railway, run a session | Structural context only surfaces past decisions scoring 70+/100. Lower-scoring matches excluded. Remove after test. |
| R11a-4 | Set `RERUN_DAYS_THRESHOLD=1` in Railway, submit two decisions in 24 hours | Contradiction detector re-runs on the second decision. Remove after test. |
| R11b-1 | Open `/admin`, scroll to R11 — Active Thresholds | Table shows 7 rows. All show grey "default" badge. Effective value = default value for each row. |
| R11b-2 | Set `RULES_SESSION_THRESHOLD=10` in Railway, reload admin | That row shows amber "env override" badge. Effective = 10, Default = 8. All other rows unchanged. |
| R11b-3 | Admin page with avoidance_alerts data in DB | Stat cards show correct total, open, dismissed counts and avg days open. Threshold values in footer match Railway env (or defaults). |
| R11b-4 | Admin page before avoidance_alerts table exists | All stat cards show 0. No crash, no error UI. (Non-fatal catch in route.) |

---

## R7 + R8 ADMIN DASHBOARD TEST LOG

| # | Test | Expected |
|---|---|---|
| AD-1 | Navigate to `/admin` — fresh browser (no sessionStorage) | Password gate renders: single input with "Admin code" placeholder, "Enter" button. No dashboard visible. |
| AD-2 | Enter wrong ADMIN_CODE | Silent redirect to `/` — no error message, no confirmation the route exists. sessionStorage entry cleared. |
| AD-3 | Enter correct ADMIN_CODE (ASCII-only) | Dashboard loads. Two sections visible: R7 Rule Calibration table and R8 Threshold Sensitivity table. Header shows session count, sessions-with-outcomes count, global avg helpfulness, and generated timestamp. |
| AD-4 | Enter correct ADMIN_CODE containing non-ASCII characters | Fails with "Network error: TypeError: Failed to execute 'fetch'... String contains non ISO-8859-1 code point." Fix: update ADMIN_CODE in Railway to ASCII-only string. See KDD 111. |
| AD-5 | Reload page after successful login | Password gate is skipped — code read from sessionStorage. Dashboard loads immediately. |
| AD-6 | Click Refresh button | Data refetches with same stored code. Generated timestamp updates. No re-authentication required. |
| R7-1 | R7 table — all rules present | 11 rows: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R12. Each shows rule ID, label, fires count, outcome count, avg when fired, avg when not fired, delta, flag column. |
| R7-2 | R7 table — zero data state (no outcomes logged) | All `avg_fired`, `avg_not_fired`, `delta` columns show "—". No crash. Informational note appears below table: "No outcome data yet for this window — ask users to complete the Outcome Tracker after decisions resolve." |
| R7-3 | R7 table — rule with 🔴 flag | Delta column reads a negative percentage (red, bold). Flag column shows 🔴. This means that rule is firing on sessions where council was less helpful than baseline by >10pp. |
| R7-4 | R7 table — rule with zero fires in 90 days | Fires column = 0. Avg columns show "—". No crash. This is expected for rare rules — not a bug. |
| R8-1 | R8 table — all threshold rows present | 7 rows: MATCH_THRESHOLD, SIMILARITY_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD. |
| R8-2 | R8 table — queryable thresholds (MATCH_THRESHOLD, SIMILARITY_THRESHOLD, PATTERNS_SESSION_THRESHOLD) | Current count, −10% variant count, +10% variant count all populated with integers. Corpus total present. Milestone badge: ⚪ if <100 sessions, 🟡 if 100+, 🟢 if 250+. |
| R8-3 | R8 table — non-queryable thresholds (LOW_CONFIDENCE, RULES_SESSION, RERUN_DAYS) | Count columns show "—". Amber italic note appears explaining why and pointing to correct lookup. No crash. |
| R8-4 | R8 table — MIN_SESSIONS row | Current count shows total completed sessions_ontology rows. −10% and +10% show "—" (per-user threshold, not corpus aggregate). Note explains this. |
| R8-5 | Corpus at 0 sessions | All counts are 0 or "—". No crash. Milestone badges all ⚪. Table renders correctly. |

## ADDITIONAL RISK D — FULL TEST PLAN (D1 + D2 + D3)

### D1 — Schema + Activity Tracking

| # | Test | Expected |
|---|---|---|
| D1-1 | Check Supabase — `sessions` table schema | `last_action_at timestamptz` column exists. All pre-migration rows have `last_action_at = created_at` (backfill). New sessions have `last_action_at = NULL` until first examiner submit. |
| D1-2 | Check Supabase — `avoidance_alerts` table | Table exists with: id, user_id, session_id, days_open (int), upstream_dependency_score (numeric), structural_echo (jsonb), detected_at, dismissed_at (null), action_taken. RLS enabled. |
| D1-3 | Submit a session and complete the examiner | Railway logs show no `last_action_at stamp failed` error. Check Supabase: `sessions.last_action_at` updated to now() for that session. |
| D1-4 | Skip the examiner (skip path) | Same as D1-3 — `last_action_at` stamped on skip path too. |
| D1-5 | File an outcome via Outcome Tracker | `sessions.last_action_at` updated to now() for that session. Confirms resolution signal is working — D2 cron will not flag this session. |
| D1-6 | Check index on sessions | `idx_sessions_last_action_at` exists as a partial index on `(user_id, last_action_at) WHERE status = 'completed'`. |

### D2 — Detection Engine + Cron

| # | Test | Expected |
|---|---|---|
| D2-1 | Deploy D2. Check Railway build logs | No import errors from `lib/avoidance-detector.ts` or cron route. Build passes cleanly. |
| D2-2 | Trigger cron manually from cron-job.org (Force Execute) | Railway logs show `[AvoidanceDetector] Pass starting — N user(s)` and `Pass complete — detected: X, skipped: Y, errors: 0`. cron-job.org shows HTTP 200 response `{ ok: true, detected, skipped, errors, elapsed_ms }`. |
| D2-3 | Call cron endpoint without Authorization header | Returns 401. No detection runs. |
| D2-4 | Call cron endpoint with wrong CRON_SECRET | Returns 401. |
| D2-5 | User has completed session with `upstream_dependency ≥ 4`, `last_action_at` ≥ 45 days ago, no outcomes row. Run cron. | Row appears in `avoidance_alerts`. `days_open ≥ 45`. `upstream_dependency_score ≥ 4`. `dismissed_at` is null. |
| D2-6 | Run cron again immediately after D2-5 | No duplicate alert written. Existing undismissed alert causes skip. `skipped` count increments. |
| D2-7 | Session with `upstream_dependency = 3` (below threshold). Run cron. | No alert for that session. |
| D2-8 | Session 50 days old but outcome filed. Run cron. | No alert — outcome = resolved. |
| D2-9 | Session qualifies AND user has a prior resolved session scoring ≥ 60/100 structural similarity (v2.0). Run cron. | Alert row has `structural_echo` JSONB: `{ sessionId, matchScore, decisionSnippet, outcomeSummary }`. Other qualifying sessions with no close match have `structural_echo: null`. |
| D2-10 | cron-job.org execution history after 02:00 UTC | Status: success. Response body `ok: true`. Notification email fires if it fails. |

### D3 — Mirror Surface + Dismiss + Synthesis Resubmission

| # | Test | Expected |
|---|---|---|
| D3-1 | Mirror unlocked user with ≥1 undismissed avoidance alert — open Mirror | "Decisions Still Open" section renders above Bias Fingerprint. One card per alert (max 3). Section absent if no alerts. |
| D3-2 | Card content — alert with no structural echo | Shows decision snippet, days-open observation ("You first brought this N days ago. It hasn't moved."). No echo section. Two CTAs visible: "Bring it back →" and "Mark as resolved →". |
| D3-3 | Card content — alert with structural_echo present | Echo block appears: "A prior decision was structurally close to this one (N/100 match). [decisionSnippet]..." — including outcomeSummary if present. |
| D3-4 | Check copy — "avoidance" word scan | The word "avoidance", "avoided", "stalling" does not appear anywhere in the rendered card. |
| D3-5 | Click "Mark as resolved →" | Card disappears optimistically. POST /api/mirror/avoidance/dismiss called. Supabase: alert row has `dismissed_at` set and `action_taken = 'resolved_externally'`. Outcomes table: row inserted with `outcome_quality = 'resolved_externally'`. |
| D3-6 | Reload Mirror after dismiss | Dismissed card does not reappear (dismissed_at is set — query filters it). |
| D3-7 | Run D2 cron after D3-5 (session now has outcome row) | Dismissed session is NOT re-flagged. Outcome row closes the D2 cron gate. |
| D3-8 | Click "Bring it back →" | Navigates to `/?decision=<encoded decision text>`. Decision textarea is pre-filled with the decision snippet. localStorage key `quorum_resubmit_alert` is set to the alert ID. |
| D3-9 | From pre-filled form (D3-8) — submit decision and run through to synthesis | Synthesis fires. Railway logs show `[Persona] Resubmission context injected for synthesis | alert <id> | Nd open`. Synthesis output acknowledges elapsed time as neutral observation — e.g. "The fact that this has been open for N days is itself worth reading…" No "avoidance" language. |
| D3-10 | Synthesis after resubmission — check localStorage | `quorum_resubmit_alert` key is cleared after synthesis call. If synthesis is re-run in same session, resubmission context does NOT fire a second time. |
| D3-11 | Resubmission synthesis — alert has structural echo | Synthesis references the prior resolved session — e.g. "A prior decision was structurally similar to this one…" |
| D3-12 | Dismiss endpoint — wrong alertId (another user's alert) | Returns 403 Forbidden. Alert not modified. |
| D3-13 | Mirror locked or teaser user | "Decisions Still Open" section absent. Alerts route returns `avoidanceAlerts: []` for non-unlocked users. |
| D3-14 | User with 0 avoidance alerts | "Decisions Still Open" section not rendered. No empty state shown. |

---

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.org / invigorating-manifestation-production-ecd2.up.railway.app
- Website: www.quorumvault.org
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
