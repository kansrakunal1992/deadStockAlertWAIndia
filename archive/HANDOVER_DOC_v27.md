# QUORUM — Handover Document v27
### Date: May 2026 | Status: Sprint 31 complete (Home flip-card · Onboarding panels · Chunks 1–5 · Pattern surfacing · Mirror paywall copy · IST timezone · localStorage auth fix · RecordReceipt · DM Sans · Mobile responsive passes)
### Stack: Next.js 15 · Supabase (PostgreSQL) · Railway · Anthropic / DeepSeek

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
        ↓ (Mirror, separate routes)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts|calibration|patterns}
                            ↳ Sprint 19: all routes use getMirrorAccessState() helper
                              (replaces binary mirror_access row-exists check)
                              teaser route: /api/mirror/teaser (new Sprint 19)
                            ↳ Sprint 20 NEW: /api/mirror/benchmark — cross-user cosine similarity
                              cluster aggregation, insufficient guard (min 5 sessions)
                            ↳ Sprint 20 NEW: /api/mirror/sessions-lookup — session preview
                              fetcher for source-decision drawer. Ownership-gated.
                            ↳ Sprint 21 NEW: /api/mirror/preferences — GET/POST style_cue.
                              Auth + mirror-access gated. Returns { style_cue: string|null }.
```

**Sprint 19 additions:**

**Database migration (`migration_sprint19.sql` — run once in Supabase before deploy):**
- Drops old CHECK constraint (`'paid','granted','trial'`)
- Adds 3 new columns: `started_at timestamptz`, `payment_id text`, `subscription_id text`
- Backfills: `paid`→`monthly`, `granted`→`lifetime`, `trial`→`monthly`
- Adds new CHECK constraint: `access_type IN ('annual','monthly','lifetime','advisory')`
- Updates column default to `'monthly'`

**New files:**
- `lib/mirror-access.ts` — `getMirrorAccessState(userId, supabase)` helper. Returns `'unlocked'|'teaser'|'locked'`. Logic: lifetime/advisory → always unlocked; annual/monthly → check expires_at > now(); no valid row → session count ≥ TEASER_THRESHOLD (3) → teaser; else locked. Single source of truth replacing all inline binary checks.
- `app/api/mirror/teaser/route.ts` — serves safe preview data for teaser state: session count, pattern count (distinct fired rules), blurred independence score, contradiction count, calibration dates, top 3 bias labels.
- `app/api/payment/create-subscription/route.ts` — stub for payment webhook (Sprint 20). Accepts `{userId, plan, paymentId}`, upserts mirror_access with correct expires_at. Auth via `x-admin-key` header until Razorpay webhook wired.
- `app/api/admin/grant-mirror-access/route.ts` — manual provisioning for advisory clients/beta. Accepts `{userId, accessType, durationDays}`. Always upserts (ON CONFLICT user_id).

**Modified — lib:**
- `lib/types.ts` — `MirrorGateState`: `'auth'|'threshold'|'paywall'|'unlocked'` → `'auth'|'locked'|'teaser'|'unlocked'`. `MirrorStatus`: removed `threshold`/`meetsThreshold` fields. Added `MirrorAccessState = 'unlocked'|'teaser'|'locked'` and `SubscriptionPlan = 'monthly'|'annual'|'lifetime'|'advisory'` types.

**Modified — Mirror API routes (all 10):**
All routes replace inline binary `mirror_access` row-exists check with `getMirrorAccessState()`. Routes return 403 for both `teaser` and `locked` states (full content only for `unlocked`). Exception: `timeline` returns empty array for `locked` but serves data for `teaser` (timeline visible in teaser state). `outcomes` gates on userId path only (pre-auth email/deviceId path unaffected).

**Modified — UI:**
- `app/mirror/page.tsx` — three gate states: `LockedView` (<3 sessions, progress bar to 3), `TeaserView` (≥3 sessions no sub — fetches /api/mirror/teaser, shows blurred stats, locked module previews with "Subscribe to Mirror →" CTA), `UnlockedView` (unchanged). `fetchStatus` updated to fetch timeline for `teaser` and `unlocked`. PRICING_URL: `https://www.quorumvault.org/#pricing`.
- `components/SynthesisCard.tsx` — post-synthesis Mirror nudge: "This decision has been added to your Mirror profile." + "View Mirror →" link. Appears after synthesis completes (state=done), separated by a border-dim divider. Non-blocking.
- `index.html` (website, `quorumvault.org`) — Monthly/Annual billing toggle pill above pricing grid. Mirror card: ₹1,499/mo or ₹9,999/yr (toggle-driven). Badge switches "Most used" ↔ "Best value". Free tier copy updated (removed "Decision Timeline ≥5 sessions" and "Behavioral alerts" — now Mirror-only). Live advisory: "Mirror subscription included (12 months)". Modal step 1 Mirror option: ₹1,499/mo · or ₹9,999/yr. Success message updated to subscription flow.

**Hotfixes applied in Sprint 19 (post-deploy):**
- `app/api/mirror/unlock/route.ts` — `access_type: 'paid'` → `'lifetime'` (was invalid under new CHECK constraint); `insert` → `upsert ON CONFLICT user_id` (handles expired rows); `const supabase = createServiceClient()` restored (was accidentally removed when collapsing early-return). Subsequently updated to support three separate Railway env tokens: `MIRROR_TOKEN_MONTHLY` (30 days), `MIRROR_TOKEN_ANNUAL` (365 days), `MIRROR_TOKEN_LIFETIME` (no expiry). `MIRROR_UNLOCK_TOKEN` retained as legacy lifetime fallback. Each token independently resolves `access_type` and `expires_at`.
- `components/MemoryEngineStatus.tsx` — Split `MIRROR_THRESHOLD=5` into `MIRROR_TEASER_THRESHOLD=3` + `MIRROR_THRESHOLD=5`. "View Mirror →" link now appears at ≥3 sessions (gold → green at ≥5). "Mirror preview ready" rendered on its own green line below the Pattern Memory countdown, not inline.
- `app/api/persona/route.ts` — Race condition fix: initial personas fire simultaneously with ontology tagger, so `sessions_ontology` is often not yet written when `fetchCouncilContext` runs, causing silent null return. Fix: `fetchCouncilContextWithRetry()` polls every 400ms up to 3s for initial personas only. Synthesis path unchanged (ontology always written by then). Railway logs will now show `(initial)` for all 6 personas once ontology writes.

**Sprint 19a additions (carried from v21):**
- `lib/rule-engine.ts` — R2 ambiguity threshold corrected: `ambiguity.score < 3` → `ambiguity.score < 4`.
- `app/api/persona/route.ts` — `buildCouncilContext()` extended to all 6 initial Council personas.

---

**Sprint 20 additions:**

**No DB migration required.**
`signal_type` is stored per-session inside the existing `activation_contexts` JSONB column in `bias_library` — no new column. All other Sprint 20 features read from existing tables.

**New files:**
- `app/api/mirror/benchmark/route.ts` — cross-user peer benchmark. Fetches current user's most recent v2.0 ontology_vector, computes cosine similarity against all other users' vectors in `sessions_ontology` (corpus scan, limit 300). Cluster gate: returns `insufficient: true` when fewer than 5 structurally similar sessions found. Returns aggregate dimension averages + top 3 bias keys from cluster. Zero PII — no decision text, no user identity in response.
- `app/api/mirror/sessions-lookup/route.ts` — session preview endpoint for source-decision drawers in `PatternTile` and `PatternStore`. Auth + mirror_access gated. Ownership-gated: `.eq('user_id', userId)` ensures users can only fetch their own sessions. Returns full `decision_text` (no truncation), cap 30 sessions.

**Modified — lib:**
- `lib/types.ts` — added `BiasSignalType` (`'distorting'|'neutral'|'adaptive'`), `signalType: BiasSignalType | null` and `sessionIds: string[]` to `FingerprintTile`; `session_ids: string[]` to `RulePattern`; `BenchmarkData` and `SessionPreview` interfaces added.
- `lib/bias-scorer.ts` — added `classifyBiasSignal(biasKey, score, ontologyVector)`: crosses detected bias against decision's ontology_vector to classify signal as distorting/neutral/adaptive. Added `getPredominantSignal(activationContexts)`: returns most common signal_type across all sessions for a bias. Added `OntologyScoreMap` type.
- `lib/mirror-fingerprint.ts` — `buildFingerprint()` now calls `getPredominantSignal()` on each tile's `activation_contexts` to populate `signalType`. Passes `session_ids` from `bias_library` through to `FingerprintTile` as `sessionIds`.
- `lib/personas.ts` — `DECISION_BRIEF` prompt updated: closing "DECISION-MAKER OBSERVATION" instruction added. One sentence, second person, about how the person makes decisions (not about the decision). Max 20 words. Fires in the Decision Brief only — not in SYNTHESIS (which already has PATTERN OBSERVATION block).

**Modified — API routes:**
- `app/api/bias-score/route.ts` — now fetches `ontology_vector` from `sessions_ontology` alongside existing ontology fields. Calls `classifyBiasSignal()` for each detected bias. Stores `signal_type` inside `newActivationContext` JSONB per session. No schema change.
- `app/api/mirror/patterns/route.ts` — aggregation loop now tracks `ruleSessionIds: Record<string, string[]>` alongside `ruleCounts`. Each `RulePattern` in response includes `session_ids: string[]`.

**Modified — components:**
- `components/PatternTile.tsx` — fully rewritten. `ConfirmedTile` now accepts optional `authToken` prop (passed from `BiasFingerprint`). Adds `SignalPill` (red/green — neutral renders no pill). Adds `SourceDrawer`: lazy-fetches `/api/mirror/sessions-lookup` on first open, caches in state, closes on outside click. Full decision text, cap 30, scrollable (`maxHeight: 320, overflowY: auto`).
- `components/BiasFingerprint.tsx` — passes `authToken` down to each `PatternTile`. No other changes.
- `components/PatternStore.tsx` — `RuleRow` gains `authToken?: string` prop and `drawerOpen` state. Fire count badge (`3×`) is now a clickable dotted-underline button. `RuleSourceDrawer` component added (same pattern as `SourceDrawer` in `PatternTile`). Full text, cap 30, scrollable.

**Modified — UI:**
- `app/mirror/page.tsx` — module header renames in `UnlockedView`: "Decision Independence" → "Decision Independence Score"; "Decision Rules" → "Your Implicit Rules"; "Decision Patterns" → "What Keeps Coming Up"; "Calibration Trend" → "Confidence Calibration". Sub-descriptions added under "Bias Fingerprint" and "Decision Independence Score". `BenchmarkModule` component added (renders after Confidence Calibration, silently hidden when `insufficient: true`). `BenchmarkData` imported from types.
- `index.html` (quorumvault.org) — Council section: PRISME grid removed, replaced with 6 actual persona cards (Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor) with correct descriptions. Showcase headings: "01 — Contradiction" → "01 — Contradiction Detector"; "03 — Independence Score" → "03 — Decision Independence Score". Pricing feature list: "Decision Rules library" → "Your Implicit Rules"; "Decision Patterns" → "What Keeps Coming Up"; Decision Patterns feature added. Step 4 Mirror description updated. Council step copy: "Pattern. Risk. Investor. Strategist. Mirror. Elder." → correct persona names. Mirror subscription blurb: lowercase names → proper names.



---

**Sprint 21 additions:**

**DB migration (`migration_sprint21.sql` — run once in Supabase before deploy):**
- `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS style_cue TEXT CHECK (style_cue IN ('direct','challenge','pattern','risk','stakeholder','long'))`
- No backfill needed — NULL = calibration not yet completed (safe default).

**New files:**
- `app/api/mirror/preferences/route.ts` — GET returns `{ style_cue }` for authenticated, unlocked user. POST validates and upserts `style_cue` to `user_preferences`. Enum constraint enforced at both DB and API layer. Uses same Bearer token + `getMirrorAccessState()` guard pattern as all other Mirror routes.
- `components/StyleCalibration.tsx` — 3-question inline calibration flow. One question at a time, 2 answer buttons each, progress bar advances per step. Style cue derived by majority vote across 3 answers (Q1 tie-breaks). On final answer: writes `localStorage` key `quorum_style_calibration_dismissed` immediately (guard against POST failure), then POSTs to `/api/mirror/preferences`. On dismiss (X): writes same localStorage key — banner never reappears in that browser. Dismissable mid-flow at any step.

**Modified — lib:**
- `lib/types.ts` — added `StyleCue = 'direct'|'challenge'|'pattern'|'risk'|'stakeholder'|'long'` type.
- `lib/personas.ts` — added `USER_STYLE_BOOSTS` constant (maps each `StyleCue` to +1 persona boost). `computePersonaOrder()` gains optional third param `userStyle?: string | null`. Style boosts applied *before* rule/dim boosts — a rule signal (+3 max) always dominates a style nudge (+1). No persona ever suppressed — order only.

**Modified — components:**
- `components/SessionView.tsx` — added `styleCueRef` (useRef, not state — no extra renders). New `useEffect` on mount: gets client-side Supabase auth token, fetches `/api/mirror/preferences`, stores result in `styleCueRef`. Passed as third arg to `computePersonaOrder()` when ontology resolves. Silent on failure — degrades to rule/dim ordering only.

**Modified — UI:**
- `app/mirror/page.tsx` — added `initialStyleCue` state (`StyleCue | null`). `fetchStatus()` fetches `/api/mirror/preferences` alongside timeline when `gateState === 'unlocked'`. Passed as prop to `UnlockedView`. `UnlockedView` gains `initialStyleCue` prop + `showCalibration` state. Calibration shows when `sessionCount >= 5 && !initialStyleCue && localStorage key not set`. `StyleCalibration` rendered above Decision Timeline in `UnlockedView`.

**Hotfix applied in Sprint 21 (post-deploy):**
- `components/StyleCalibration.tsx` — localStorage guard added to both complete and dismiss paths. Previously, completing or dismissing the calibration did not persist across page reloads (banner reappeared). Fix: both paths write `quorum_style_calibration_dismissed = 'true'` to localStorage. `UnlockedView` reads this key in the `useState` initialiser — evaluates once on mount, not on every render.


---

## DATABASE SCHEMA (current as of Sprint 20)

### mirror_access ← updated Sprint 19 migration
```
id               uuid PK
user_id          uuid UNIQUE FK → auth.users (unique index — one row per user, always upsert)
access_type      text CHECK ('annual','monthly','lifetime','advisory') DEFAULT 'monthly'
granted_at       timestamptz NOT NULL DEFAULT now()
started_at       timestamptz   ← NEW Sprint 19
expires_at       timestamptz   ← null = never expires (lifetime/advisory)
payment_ref      text          ← partial code ref for audit (unlock route)
payment_id       text          ← NEW Sprint 19 (payment gateway ref)
subscription_id  text          ← NEW Sprint 19 (recurring subscription ref)
```

**Access logic (getMirrorAccessState):**
- `lifetime` / `advisory` → always `unlocked`
- `annual` / `monthly` → `unlocked` if `expires_at > now()` or `expires_at IS NULL`; else fall through
- No valid row or expired → session count ≥ 3 → `teaser`; else `locked`

### sessions, sessions_ontology, outcomes, structural_scores, messages, contradictions, examiner_responses, session_requests, brief_access_tokens, structural_matches, sessions_pending_outcomes
All unchanged from Sprint 18b. See v21 for full schema.

### user_preferences ← Sprint 21 update
`style_cue TEXT CHECK ('direct','challenge','pattern','risk','stakeholder','long')` column added. NULL = calibration not completed. All other columns unchanged.

### bias_library ← Sprint 20 update
`activation_contexts` JSONB column now stores `signal_type: 'distorting'|'neutral'|'adaptive'` per session key, written by `bias-score/route.ts`. Pre-Sprint-20 rows have no `signal_type` key — `getPredominantSignal()` returns `null` → no pill rendered (safe degradation). No migration needed.

---

## CODEBASE MAP

```
lib/
  mirror-access.ts         — ✅ Sprint 19 NEW — getMirrorAccessState() helper.
                             TEASER_THRESHOLD = 3. Single source of truth for all Mirror routes.
  rule-engine.ts           — ✅ Sprint 19a — R2 ambiguity threshold corrected to ≥ 4 (was ≥ 3)
  types.ts                 — ✅ Sprint 19 — MirrorGateState updated (locked/teaser/unlocked);
                             MirrorStatus cleaned (threshold/meetsThreshold removed);
                             MirrorAccessState + SubscriptionPlan types added;
                             also Sprint 18b: RuleType, RulePattern, DimPattern, PatternStoreData
  personas.ts              — ✅ Sprint 21 — USER_STYLE_BOOSTS constant added. computePersonaOrder()
                             gains optional userStyle param (+1 baseline before rule boosts).
                             Also Sprint 20: DECISION_BRIEF DECISION-MAKER OBSERVATION block.
  bias-scorer.ts           — ✅ Sprint 20 — classifyBiasSignal(), getPredominantSignal(),
                             OntologyScoreMap type, BiasSignalType type added.
  mirror-fingerprint.ts    — ✅ Sprint 20 — signalType + sessionIds populated on every tile.
  types.ts                 — ✅ Sprint 21 — StyleCue union type added.
                             Also Sprint 19/20: MirrorAccessState, SubscriptionPlan, BiasSignalType etc.
  structural-retrieval.ts, ontology-tagger.ts, contradiction-detector.ts,
  independence-score.ts, ai-client.ts, supabase.ts, storage.ts — unchanged
  ai-client.ts             — ✅ Sprint 26 — withRetry() wrapper for DeepSeek 503.
                             MAX_503_RETRIES=2, RETRY_WAIT_MS=5000. Both streamDeepSeek
                             and createCompletion wrapped. Anthropic paths unchanged.
  personas.ts              — ✅ Sprint 25/26 — WORD_LIMIT_PREFIX: constraint 0 (header block:
                             <lens><position><realcost> tags, plain-English instructions with
                             counter-examples). All 6 persona RESPONSE STRUCTURE sections:
                             header reminder added. SYNTHESIS: TRADE-OFF SUMMARY block added
                             (always-last, 60-word cap, narrative prose). Also Sprint 21/20 above.
  storage.ts               — ✅ Sprint 24a — removeSessionId(id) export added.
 dates.ts             — Sprint 30 (NEW) — formatDate() and formatDateTime() helpers,
                         all output in IST (Asia/Kolkata). Import from @/lib/dates
                         instead of inline toLocaleDateString()
  types.ts             — Sprint 30 — Session interface gains decision_type_primary and
                         stakes_reversibility (match TimelineSession fields, already in DB)

app/api/
  mirror/status/route.ts    — ✅ Sprint 19 — fully rewritten. 3-state gate via getMirrorAccessState().
                              Returns auth/locked/teaser/unlocked. Fetches teaserBiases for teaser state.
  mirror/teaser/route.ts    — ✅ Sprint 19 NEW — teaser data for ≥3-session non-subscribers.
                              Returns: sessionCount, patternCount, independenceScore (blurred),
                              contradictionCount, calibrationDates, teaserBiases.
  mirror/fingerprint/route.ts  — ✅ Sprint 19 — getMirrorAccessState() replacing binary check
  mirror/contradictions/route.ts — ✅ Sprint 19 — getMirrorAccessState()
  mirror/independence/route.ts   — ✅ Sprint 19 — getMirrorAccessState()
  mirror/patterns/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
  mirror/rules/route.ts          — ✅ Sprint 19 — getMirrorAccessState()
  mirror/calibration/route.ts    — ✅ Sprint 19 — getMirrorAccessState() added (was unguarded)
  mirror/alerts/route.ts         — ✅ Sprint 19 — getMirrorAccessState() added (was unguarded); returns [] for non-unlocked
  mirror/timeline/route.ts       — ✅ Sprint 19 — getMirrorAccessState() added; serves data for teaser + unlocked, empty for locked
  mirror/outcomes/route.ts       — ✅ Sprint 19 — getMirrorAccessState() added for userId path
  mirror/unlock/route.ts         — ✅ Sprint 19 hotfix — access_type 'paid'→'lifetime'; insert→upsert
                                   ON CONFLICT user_id; supabase client init restored.
                                   Updated: three-token support — MIRROR_TOKEN_MONTHLY (30d),
                                   MIRROR_TOKEN_ANNUAL (365d), MIRROR_TOKEN_LIFETIME (no expiry).
                                   MIRROR_UNLOCK_TOKEN retained as legacy lifetime fallback.
  mirror/benchmark/route.ts      — ✅ Sprint 20 NEW — cross-user cosine similarity peer cluster.
                                   Insufficient guard (cluster < 5 → returns insufficient: true).
                                   Reads sessions_ontology + bias_library aggregate. Zero PII.
  mirror/sessions-lookup/route.ts — ✅ Sprint 20 NEW
  mirror/preferences/route.ts     — ✅ Sprint 21 NEW — GET/POST style_cue. Auth + mirror-access
                                     gated. Enum validated at API layer. — session preview for source drawers.
                                   Auth + mirror_access + ownership gated. Full text, cap 30.
  mirror/patterns/route.ts       — ✅ Sprint 20 — session_ids tracked per rule in aggregation loop.
                                   Each RulePattern now includes session_ids: string[].
  payment/create-subscription/route.ts — ✅ Sprint 19 NEW — stub. Auth via x-admin-key.
  admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW — manual provisioning. Upsert with durationDays.
  persona/route.ts          — ✅ Sprint 19 hotfix — fetchCouncilContextWithRetry() for initial personas
                              (400ms poll, up to 3s) fixes race condition where ontology not yet written
                              when initial personas fire. Synthesis path uses plain fetchCouncilContext().
                              also Sprint 19a: buildCouncilContext() extended to all 6 initial personas
  bias-score/route.ts       — ✅ Sprint 20 — fetches ontology_vector from sessions_ontology.
                              Calls classifyBiasSignal() per detected bias. Writes signal_type
                              into activation_contexts JSONB. No schema change.
  ontology/route.ts, structural-match/route.ts, examiner/route.ts,
  independence-score/route.ts — unchanged from Sprint 18a/17
  record/route.ts          — ✅ Sprint 24a — DELETE handler added. Ownership check
                             (user_id match or device-only). Cascade delete via FK.
  session/[id]/page.tsx    — ✅ Sprint 24b — fetches existing messages in parallel with
                             session fetch. Builds initialMessages Record<personaKey, content>.
                             Passed as prop to SessionView.
  voice/stream/route.ts  — Sprint 31 — enable_endpoint_detection: false (manual stop only,
                            ⚠️ pending)
  mirror/independence/route.ts — Sprint 28 — session_id in select, examinerQuote query
                                 (longest examiner_responses.response_text, cap 180 chars)

payment/create-subscription/route.ts — ✅ Sprint 19 NEW (stub)
admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW

components/
  MemoryEngineStatus.tsx   — ✅ Sprint 19 hotfix — MIRROR_TEASER_THRESHOLD=3 added.
                             mirrorTeaserReady flag (sessionCount ≥ 3). "View Mirror →" link
                             appears at ≥3 (gold) and ≥5 (green). "Mirror preview ready" rendered
                             on its own green line below the Pattern Memory countdown.
                             Status text at 3–4 sessions: "X more sessions for Pattern Memory"
                             + green "Mirror preview ready  View Mirror →" below.
  PatternStore.tsx         — ✅ Sprint 20 — RuleSourceDrawer added. Fire count badge (3×) is
                             now a clickable dotted-underline button opening inline drawer.
                             Fetches /api/mirror/sessions-lookup lazily. Full text, cap 30, scrollable.
                             authToken?: string prop added to RuleRow.
                             also Sprint 18b: original PatternStore component.
  PatternTile.tsx          — ✅ Sprint 20 — SignalPill (distorting=red, adaptive=green, neutral=no pill).
                             SourceDrawer: lazy-fetch, outside-click close, full text, cap 30,
                             maxHeight 320 scrollable. authToken prop added.
  BiasFingerprint.tsx      — ✅ Sprint 20 — passes authToken to PatternTile. No other changes.
  SynthesisCard.tsx        — ✅ Sprint 19 — post-synthesis Mirror nudge. also Sprint 16b.
  SessionView.tsx          — ✅ Sprint 21 — styleCueRef (useRef) + mount useEffect to fetch
                             style_cue. computePersonaOrder() call passes styleCueRef.current.
  StyleCalibration.tsx     — ✅ Sprint 21 NEW — 3-question inline calibration. localStorage
                             persistence on complete + dismiss. Progress bar, dismissable.
  PersonaPanel.tsx, ExaminerPanel.tsx, AuthPanel.tsx,
  CalibrationSparkline.tsx, IndependenceScore.tsx, ContradictionDetector.tsx — unchanged
  BackButton.tsx           — ✅ Sprint 24a NEW — 'use client'. router.back() on click.
                             Used on record/[id]/page to return to Council without remount.
  PersonaPanel.tsx         — ✅ Sprint 25/24b — extractHeaderTags(): strips <lens><position>
                             <realcost> from stream, sets state, returns clean prose.
                             Body-top render: labeled italic lines + divider.
                             initialContent prop: skips API call, seeds responseRef.
                             Pause/Resume/Stop TTS buttons in strip.
                             Also Sprint 24b: initialContent hydration.
  SynthesisCard.tsx        — ✅ Sprint 25 — Pause/Resume/Stop TTS. Same three-state
                             pattern as PersonaPanel. Also Sprint 19/22 above.
  SessionView.tsx          — ✅ Sprint 24b — initialMessages prop. completedResponses
                             seeded from it. initialContent passed to each PersonaPanel.
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

app/
  mirror/page.tsx          — ✅ Sprint 20 — UnlockedView header renames (5 modules).
                             Sub-descriptions under Bias Fingerprint + Decision Independence Score.
                             BenchmarkModule component added (silently hidden when insufficient).
                             BenchmarkData imported. LockedView/TeaserView unchanged.
                             also Sprint 19: LockedView, TeaserView, gate states.
                             also Sprint 18b: PatternStore wired into UnlockedView.
  page.tsx                 — Sprint 31 — flip-card (inputRevealed, onboardPanel, isOnboarding),
                         Judgment Record strip (count, isReturning, new-user tagline),
                         state-gated register+slider, persona pill strip, collapsible tips
                         (localStorage), history fade-in, mirrorUnlocked fetch, fixed navbar,
                         .home-two-col CSS, clamp heights, formatDate IST import
  record/[id]/page.tsx     — ✅ Sprint 24a — BackButton replaces Link on header + bottom nav.
                             Bottom nav: ← Back to Council | Reanalyze | New decision.
  page.tsx                 — ✅ Sprint 24a — handleDeleteSession + IconTrash on session cards.
                             Sub-text formatting (italic, demoted, smaller).
                             removeSessionId imported from storage.
layout.tsx           — Sprint 29 — DM Sans variable font replaces Inter
  globals.css          — Sprint 29 — DM Sans token, .home-two-col, type refinements; 
                         Sprint 31 PENDING — --bg-void blue tint, --gold brightness
  mirror/page.tsx      — Sprint 28 — Items 1+4+6 (mobile classNames, section reorder, teaser);
                         Sprint 30 — paywall copy overhaul
  session/[id]/page.tsx — Sprint 30 — sequential query (session first), totalSessionCount
                          COUNT query, duplicate notFound removed

Static:
  index.html (quorumvault.org) — ✅ Sprint 20 — Council section: PRISME grid replaced with 6
                             actual persona cards (Contrarian, Risk Architect, Pattern Analyst,
                             Stakeholder Mirror, Elder, Competitor). Showcase: "01 — Contradiction"
                             → "01 — Contradiction Detector"; "03 — Independence Score" →
                             "03 — Decision Independence Score". Pricing: "Decision Rules library"
                             → "Your Implicit Rules"; "Decision Patterns" → "What Keeps Coming Up";
                             Decision Patterns feature added. Step 4 copy updated. Council step
                             persona names corrected. Mirror subscription blurb proper names.
                             also Sprint 19: billing toggle, Mirror pricing, subscription flow.

app/globals.css          — ✅ Sprint 24b — height:100% removed from .persona-card.
                             Fixes TTS strip floating mid-card on equal-height grid rows.
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
| **20** | **Bias signal classification (distorting/neutral/adaptive per decision context). DECISION_BRIEF mirror closing line. Peer benchmark module (Others in Similar Decisions). Source-decision drawer on Bias Fingerprint + What Keeps Coming Up. Website + Mirror copy fully synced — council names, module names, showcase headings all corrected. — ✅ Deployed** |
| 23b | TTS Read Aloud — Synthesis card. REST not WebSocket. Chunked playback. Countdown timer. Pace control. — ✅ Deployed |
| 23c | TTS Read Aloud — all 6 persona cards. Reuses 23b infrastructure. Bottom strip (accentColor). Singleton TTSProvider. — ✅ Deployed |
| 24a | Dora session fixes: Delete decision (API + UI + localStorage). Sub-text formatting (italic, demoted). Back to Council (router.back() + BackButton component). — ✅ Deployed |
| 24b | Back to Council no re-run: session/[id]/page.tsx fetches existing messages server-side; initialMessages prop threads to PersonaPanel; initialContent skips API call. TTS strip alignment: removed height:100% from .persona-card CSS. — ✅ Deployed |
| 25 | Pause/Resume TTS (useSonioxTTS + PersonaPanel + SynthesisCard). Persona header layer: <lens><position><realcost> tags in all 6 persona prompts; extractHeaderTags parser; body-top labeled display. Synthesis trade-off narrative block. — ✅ Deployed |
| 26 | DeepSeek 503 retry: withRetry() wrapper in ai-client.ts, 2 retries, 5s wait. Persona RESPONSE STRUCTURE reminder: all 6 personas reminded to output header tags before structure. — ✅ Deployed |
| **28** | Mirror UI revamp: confidence slider copy (Pre-session clarity / Foggy→Fully clear), mobile layout, "Activates when:" label, examiner quote + CoachingTip in Independence Score, section reorder (Bias Fingerprint first, Timeline last), rules card mobile, teaser polish — ✅ Deployed |
| **29** | Home page redesign: fixed navbar, persona pill strip, tips collapsible, history fade-in, .home-two-col responsive class. DM Sans variable font replaces Inter, optical sizing, .t-heading token — ✅ Deployed |
| **30** | Chunks 1–3: QUORUM flip-card home (inputRevealed crossfade, clamp mobile height, clamp gap), RecordReceipt post-synthesis, MemoryEngineStatus mirrorUnlocked + View Mirror links, Mirror paywall copy overhaul, lib/dates.ts IST timezone, localStorage auth key fix, Session type additions, sv-navbar bg-card fix, session/[id] totalSessionCount — ✅ Deployed |
| **31** | Chunks 4–5: Onboarding 3-panel card (Council/Mirror/Record, tap-to-advance, quorum_onboarded gate), PatternSurfaceCard (top pattern with narrative + decision links + actionable), RecurringConditionCard (top structural dimension observation), ContradictionBanner post-synthesis. VoiceInput manual end detection (enable_endpoint_detection: false). ExaminerPanel &apos; → Unicode fix. Background blue-tint gradient. Gold brightness pass. PatternSurfaceCard show-more + full decision text — ⚠️ Partially in codebase (see PENDING for outstanding items) |
---

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

### Website (quorumvault.org)

Billing toggle: `setBilling('monthly')` / `setBilling('annual')`. Toggles Mirror card price between ₹1,499/mo and ₹9,999/yr. Badge toggles "Most used" / "Best value".

---

## RULE ENGINE (lib/rule-engine.ts)

| Rule | Type | Trigger | Status |
|---|---|---|---|
| R1 — Upstream Dependency Block | REDIRECT | `upstream_dependency ≥ 5` AND `confidence ≥ 0.55` | ✅ live |
| R2 — Identity-First Gate | GATE | `identity_alignment ≥ 5 AND ambiguity ≥ 4` | ✅ live (threshold corrected Sprint 19a) |
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

---

## KEY DESIGN DECISIONS (do not re-debate)

1–42: All carried from v21 unchanged.

43. **Mirror TEASER_THRESHOLD = 3 (Sprint 19): permanently 3 sessions. Teaser shows the Mirror is accumulating before the subscription ask. Increasing it delays the conversion hook with no analytical benefit. Do not raise.**
44. **getMirrorAccessState() is the sole arbiter of Mirror access (Sprint 19). No route should query mirror_access directly for access decisions — always call the helper. This ensures expiry logic, access_type handling, and session count fallback stay consistent across all 10 routes.**
45. **mirror_access writes are always upsert ON CONFLICT (user_id) (Sprint 19). The unique index on user_id means insert will fail if a row exists (e.g. expired subscription). All three write paths (unlock route, create-subscription, grant-mirror-access) use upsert.**
46. **Unlock tokens map to plan type (Sprint 19 update). `MIRROR_TOKEN_MONTHLY` → monthly (30d), `MIRROR_TOKEN_ANNUAL` → annual (365d), `MIRROR_TOKEN_LIFETIME` → lifetime. `MIRROR_UNLOCK_TOKEN` legacy token → lifetime. Share the right token for the right plan. Each token is a shared secret — anyone with it can redeem. For per-user control use the admin grant route instead.**
47. **fetchCouncilContextWithRetry() for initial personas only (Sprint 19). Synthesis path uses plain fetchCouncilContext() — ontology is always written by synthesis time. The retry adds ≤400ms latency before streaming starts, imperceptible given 5–15s persona response time. Do not add retry to synthesis path.**
48. **TeaserView PRICING_URL points to https://www.quorumvault.org/#pricing (Sprint 19). Website is hosted at .org not .xyz. Do not revert to .xyz.**
49. **signal_type is stored in activation_contexts JSONB, not a new column (Sprint 20). This means signal type is per-session (each session's context determines whether fomo_urgency is distorting or adaptive in that decision). getPredominantSignal() aggregates across sessions for the Mirror tile. Pre-Sprint-20 sessions return null → no pill. Do not add a standalone signal_type column.**
50. **DECISION_BRIEF mirror line goes in DECISION_BRIEF only — not SYNTHESIS (Sprint 20). SYNTHESIS already has a PATTERN OBSERVATION closing block. Adding another closing to SYNTHESIS creates collision. The mirror line fires when the user unlocks the Decision Brief — it is not part of the main council output.**
51. **BenchmarkModule silently renders nothing when cluster < 5 (Sprint 20). Do not show an empty state for this module — thin data is more harmful than no data. The module will naturally appear as the corpus grows. Do not lower the MIN_CLUSTER_SIZE threshold.**
52. **Canonical module names (Sprint 20). These are the permanent names across both app and website — do not diverge again: Bias Fingerprint, Decision Independence Score, Your Implicit Rules, What Keeps Coming Up, Contradiction Detector, Confidence Calibration. The Council has 6 personas: Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor.**

53. **USER_STYLE_BOOSTS is +1, rule boosts are up to +3 (Sprint 21). Style nudge never overrides a fired rule. This is intentional — structural decision signals take precedence over self-reported preference. If style cue and a rule both boost the same persona, they stack (max effective boost = +4). Do not raise style boost above +1.**

54. **StyleCalibration persistence is localStorage-first, DB-second (Sprint 21). localStorage is written before the POST fires — so a failed network call never causes the banner to reappear. The DB write is for cross-device consistency only. Do not reverse this order. The localStorage key is `quorum_style_calibration_dismissed`.**

55. router.back() not Link href for Back to Council (Sprint 24a). A forward navigation remounts the page and replays all useEffect hooks, re-running 6 AI calls. router.back() triggers bfcache and restores full React state. BackButton must be a 'use client' component — record/[id]/page.tsx is a server component.

56. initialMessages seeds PersonaPanel from DB, not from re-running AI (Sprint 24b). session/[id]/page.tsx fetches existing messages at server render time. Empty object for new sessions → normal flow. Non-empty → all panels hydrate from DB, skip API call. This is the correct approach for Back to Council — not bfcache alone, because bfcache is not guaranteed across all browsers/deployments.

57. height:100% removed from .persona-card (Sprint 24b). Cards in a CSS grid row were stretching to equal height. Body maxHeight:380 cap then created dead space between body and TTS strip. Natural height cards fix alignment without removing the scroll window. maxHeight:380 is preserved.

58. Persona header tags are output before RESPONSE STRUCTURE (Sprint 25). Tags are in the prompt's HARD CONSTRAINTS (numbered 0, above all persona-specific instructions). Each persona's RESPONSE STRUCTURE block has an explicit reminder. The Contrarian's "Opening line" instruction was overriding the tags — fixed with the reminder. All 6 personas have it.

59. <realcost> not <tradeoff> (Sprint 25). The label "The real cost:" is more human and immediately tells the user what the line is for. "Trade-off flagged" felt passive and technical. Lens/Position/The real cost are three nouns in parallel, colon, sentence — consistent structure.

60. Header layer is in the card body, not a sub-header band (Sprint 25). The header's job is identity (persona name + tagline + buttons). The three analytical lines are content — they belong in the reading flow. A coloured sub-header band mixed chrome with content. Body-top placement with divider is cleaner.

61. withRetry wraps DeepSeek call creation only, not stream consumption (Sprint 26). The 503 fires at the API call stage before streaming begins. Once a stream is open, 503s don't apply. Wrapping createCompletion covers the background jobs (ontology, bias scorer). 2 retries × 5s = 10s max added latency — acceptable given DeepSeek 503s typically resolve within seconds.

62. Ontology tagger failure marks session as tagger_status=failed permanently without retry (pre-Sprint 26). The withRetry fix in ai-client.ts means the tagger now retries before failing. Sessions where the tagger failed before Sprint 26 will permanently lack structural context — this is acceptable (small number, old sessions).

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
---

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

## RESOLVED / CLOSED

- **Single shared unlock token (MIRROR_UNLOCK_TOKEN) granting only lifetime** → replaced by three plan-specific tokens (MIRROR_TOKEN_MONTHLY/ANNUAL/LIFETIME) in Sprint 19 update. Legacy token retained as fallback.
- **Mirror paywall (one-time ₹4,999)** → replaced by subscription model (₹1,499/mo · ₹9,999/yr) in Sprint 19.
- **Binary mirror_access row-exists check** → replaced by getMirrorAccessState() in Sprint 19.
- **access_type 'paid' in unlock route** → fixed to 'lifetime' in Sprint 19 hotfix.
- **Council context race condition for initial personas** → fixed by fetchCouncilContextWithRetry() in Sprint 19 hotfix.
- **MemoryEngineStatus Mirror link at 5 sessions** → moved to 3 sessions (teaser threshold) in Sprint 19 hotfix.
- **R2 threshold fix** → ✅ done Sprint 19a.
- **Initial 6 Council personas — buildCouncilContext()** → ✅ done Sprint 19a.
- **FLIP animation, Share context Tier 2** → ✅ closed (see v21).
- **PRISME acronym on website not matching actual personas** → ✅ fixed Sprint 20. Council section rebuilt with real names.
- **Module name inconsistencies (app vs website)** → ✅ fixed Sprint 20. All 6 module names now canonical and consistent.
- **All bias tiles treated as errors regardless of context** → ✅ fixed Sprint 20. Signal classification (distorting/neutral/adaptive) now applied per decision context.
- **Private benchmarking (aggregate anonymised dimension scores)** → ✅ Phase 1 done Sprint 20 (dimension + bias aggregate, no outcomes). Phase 2 (outcome data, N≥50) remains in Known Gaps.
- **Style calibration (3-question onboarding)** → ✅ done Sprint 21. `StyleCalibration` component, `/api/mirror/preferences` route, `user_preferences.style_cue` column, localStorage persistence.
- **Persona reorder by user style** → ✅ done Sprint 21. `USER_STYLE_BOOSTS` in `personas.ts`, `computePersonaOrder()` third param, `styleCueRef` in `SessionView`.
- **Style calibration reappearing on reload** → ✅ fixed Sprint 21 hotfix. localStorage key `quorum_style_calibration_dismissed` written on both complete and dismiss paths.
Back to Council re-running personas → ✅ fixed Sprint 24b. initialMessages fetched server-side, passed to PersonaPanel as initialContent, API call skipped when content present.
TTS strip floating mid-card on equal-height grid → ✅ fixed Sprint 24b. height:100% removed from .persona-card.
Delete decision — no way to remove Reanalyze duplicates → ✅ fixed Sprint 24a. DELETE handler + trash icon on home page session cards.
"Six private advisors" sub-text reading as instruction → ✅ fixed Sprint 24a. Italic, smaller, muted.
No back button after Save Record → ✅ fixed Sprint 24a. BackButton (router.back()) on record page header and bottom nav.
Pause/Resume missing from TTS → ✅ fixed Sprint 25. Three-state button on both PersonaPanel and SynthesisCard.
Persona cards giving no orientation before prose → ✅ fixed Sprint 25. Lens/Position/The real cost labeled lines at top of body.
The Contrarian skipping header tags → ✅ fixed Sprint 26. RESPONSE STRUCTURE reminder added to all 6 personas.
DeepSeek 503 causing permanent ontology failure and persona errors → ✅ mitigated Sprint 26. withRetry wrapper in ai-client.ts.
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

---

## KNOWN GAPS (logged, not prioritised)

- **Email auto-link on fresh magic-link login:** After Supabase magic link login, `loadHistory` in `page.tsx` reads `authToken` from the session but does not read `session.user.email` → `userEmail` stays null → `AuthPanel` shown again asking for email redundantly → `user_email` field null on first submitted session. Fix is 3 lines in `loadHistory`. Deprioritised — low user impact at current scale.

- Private benchmarking (aggregate anonymised dimension scores)
- Decision Graph (requires ~20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)
- **TTS pace gap at 1.5×/2×:** At elevated playback speeds, chunk N finishes before Soniox generates chunk N+1 → brief silence between chunks. Fix: derive pre-fetch lead time from `rate × (chunkWords / 150) × 60` and fetch earlier at higher speeds. Currently mitigated by PREFETCH=1 + retry; not user-reported as blocking.

---

## SPRINT 21 TEST LOG

| # | Test | Expected |
|---|---|---|
| P1 | GET `/api/mirror/preferences` (valid Bearer, unlocked user, no style_cue set) | `{ style_cue: null }` |
| P2 | POST `/api/mirror/preferences` `{ style_cue: "risk" }` | `{ ok: true, style_cue: "risk" }` + DB row updated |
| P3 | GET `/api/mirror/preferences` after P2 | `{ style_cue: "risk" }` |
| P4 | POST `/api/mirror/preferences` `{ style_cue: "foo" }` | `400` with enum error |
| P5 | GET `/api/mirror/preferences` — no auth header | `401` |
| P6 | GET `/api/mirror/preferences` — valid token, teaser/locked user | `403` |
| C1 | Unlocked user, `sessionCount >= 5`, `style_cue` null, no localStorage key → Mirror | Calibration banner visible above Decision Timeline |
| C2 | Answer all 3 questions | Banner disappears; `user_preferences.style_cue` set in DB; localStorage `quorum_style_calibration_dismissed = 'true'` |
| C3 | Reload Mirror after C2 | Banner does not reappear |
| C4 | Click X (dismiss) mid-flow | Banner disappears; `style_cue` stays null in DB; localStorage key set |
| C5 | Reload Mirror after C4 | Banner does not reappear |
| C6 | `sessionCount < 5`, `style_cue` null | Banner never shown |
| R1 | Set `style_cue = 'risk'` in DB; run decision: *"I've been offered a seat on a startup advisory board — 0.5% equity, 3hrs/month. Not sure if the space is right for me."* | `risk_architect` leads council grid (+1 style, no rule fires) |
| R2 | Same `style_cue = 'risk'`; run decision: *"My co-founder wants to shift my role from technical founder to commercial lead. It would fundamentally change how I operate and see myself in this company."* | `elder` leads council grid (R2 fires: identity_alignment ≥ 5 + ambiguity ≥ 4 → elder +3 overrides risk +1) |
| R3 | Set `style_cue = null` in DB | Persona order matches pre-Sprint-21 baseline (rule/dim signals only) |

# Sprint 22 · Status: ✅ Complete
Adds a thin status strip on the Council screen that narrates back-end activity in plain language — making Quorum's structural processing visible to the user without exposing internals.
New file: components/CouncilStatusBar.tsx
Modified: components/SessionView.tsx, components/SynthesisCard.tsx

Phase state machine
PhaseTriggerMessage shownsilent0–700ms after mountNothingmapping700ms elapsed"Reading the structural shape of your decision"historyontology_ready resolves"Checking if you've faced a structurally similar decision before"council1+ persona complete"N of 6 advisors have reviewed the brief" (counts up)examinerAll 6 done, examiner active"The Council has reviewed the brief — the Examiner is now surfacing what they may have missed"synthesisExaminer submitted"Synthesising across six analytical frames"doneSynthesis completeFades out, unmounts
MIN_DISPLAY_MS = 2500 — each message stays visible for at least 2.5s even if the back-end event resolves instantly. Front-end debounce only; no back-end changes.

components/SynthesisCard.tsx
diff// Props interface — after onOverrideRedirect
+  /** Council status bar: fires when synthesis stream begins */
+  onSynthesisStart?: () => void
+  /** Council status bar: fires when synthesis stream completes */
+  onSynthesisComplete?: () => void

// Destructure
   onOverrideRedirect, // Sprint 16b Fix 1
+  onSynthesisStart,   // Council status bar
+  onSynthesisComplete,// Council status bar

// Inside synthesis useEffect — after setState('streaming')
+    onSynthesisStart?.()

// Inside synthesis useEffect — after setState('done')
+        onSynthesisComplete?.()

components/SessionView.tsx
diff// Imports
+import CouncilStatusBar from './CouncilStatusBar'

// State declarations — after structuralContext
+  // Council status bar state
+  const [ontologyReady,      setOntologyReady]      = useState(false)
+  const [synthesisStreaming,  setSynthesisStreaming]  = useState(false)
+  const [synthesisDone,       setSynthesisDone]       = useState(false)

// Inside fetchStructuralContext — when data.ontology_ready resolves
   if (data.ontology_ready && !pendingOrderRef.current) {
+    setOntologyReady(true)
     const ordered = computePersonaOrder(

// Inside handleReanalyze — after existing resets
+      // Reset council status bar
+      setOntologyReady(false)
+      setSynthesisStreaming(false)
+      setSynthesisDone(false)

// JSX — above <SynthesisCard>, inside max-w-7xl div
+        {/* ── Council Status Bar ── */}
+        <CouncilStatusBar
+          key={`statusbar-${sessionKey}`}
+          personasComplete={Object.keys(completedResponses).length}
+          totalPersonas={PERSONA_ORDER.length}
+          ontologyReady={ontologyReady}
+          examinerActive={allPersonasDone && !examinerReady}
+          examinerDone={examinerReady}
+          synthesisStreaming={synthesisStreaming}
+          synthesisDone={synthesisDone}
+        />

// <SynthesisCard> — two new props added
+          onSynthesisStart={() => setSynthesisStreaming(true)}
+          onSynthesisComplete={() => { setSynthesisStreaming(false); setSynthesisDone(true) }}

components/CouncilStatusBar.tsx (new file)
Full file — ~150 lines. Key design decisions:

phaseRef mirrors phase state — prevents stale closures inside transitionTo / applyPhase called from setTimeout
initialised ref gates the progression effect until after the 700ms silent window; avoids the race where ontology resolves before the first message appears
desiredPhase() pure function centralises priority logic — highest-priority state wins, evaluated fresh on every prop change
applyPhase guards against same-phase re-entry (if next === phaseRef.current return) — prevents flicker if a prop change fires while already in the target phase
No new API calls, no new DB reads — purely observes props already computed in SessionView
---

# Sprint 23a · Status: ✅ Complete
Voice I/O — real-time speech-to-text on home page decision input.

## What was built
- Real-time voice transcription via Soniox WebSocket (`stt-rt-v4` model)
- Server-side SSE proxy (`/api/voice/stream`) — Soniox WS never exposed to client
- Binary audio chunk forwarding (`/api/voice/chunk`) — 250ms MediaRecorder slices
- AI cleanup call (`/api/voice/cleanup`) — grammar/structure/translation fix, no new assumptions
- Particle sphere canvas animation (amplitude-driven, gold palette, dark + light mode)
- Full error handling: permission denied, quota exceeded, provider down, empty transcript — all graceful, no raw error codes shown

## Files added
- `lib/voice-sessions.ts` — module-level session Map (Railway persistent process)
- `app/api/voice/stream/route.ts` — SSE + Soniox WS bridge
- `app/api/voice/chunk/route.ts` — binary audio forwarder
- `app/api/voice/cleanup/route.ts` — AI grammar/translate cleanup
- `hooks/useSoniox.ts` — state machine: idle → requesting → ready → recording → finalizing → done | error
- `components/VoiceInput.tsx` — full UI widget, light + dark mode via CSS variables

## Files modified
- `app/page.tsx` — mounts VoiceInput, wires onTranscript to setDecision
- `app/globals.css` — adds @keyframes spin, @keyframes pulseGold
- `next.config.ts` — adds `serverExternalPackages: ['ws']` (prevents ws bundling crash)
- `package.json` — adds `ws` + `@types/ws`

## Architecture note
Uses module-level Map in `lib/voice-sessions.ts` to share Soniox WS between SSE and chunk routes. **This requires Railway's persistent Node process — will not work on serverless (Vercel etc.).** Sessions have 10-min TTL sweep as a guard.

## Key decisions locked
- `language_hints: ['en', 'hi']` — prevents Indian accent mis-detected as Hindi
- Batch SSE events (not per-token) — required by Soniox docs: non-final tokens reset per response, not accumulate
- Auto-finish on `hasEndpoint: true` — avoids `request_timeout` error from keeping WS idle after endpoint detection
- Cleanup prompt: translate to English + fix grammar only, no new assumptions — inviolable

## Sprint 23a test log
| # | Test | Expected |
|---|---|---|
| V1 | Click Voice input → Chrome permission | Permission prompt fires |
| V2 | Speak for 10s | Partial text appears grey below sphere, updating live |
| V3 | Stop | Finalising… → done state → ✓ Transcribed |
| V4 | Textarea | Contains final transcript, updated incrementally during speech |
| V5 | Click Clean up | Cleaned text replaces raw, grammar fixed, no new info added |
| V6 | Speak in Hindi | Transcribed and translated to English via cleanup |
| V7 | Deny mic permission | "Mic access denied · check browser settings" — no crash |
| V8 | Soniox quota exceeded (simulated) | "Voice unavailable right now · try again later" + Try again |
| V9 | Network tab | SONIOX_API_KEY not visible in any client request |
| V10 | Light mode | All voice widget states render correctly (no hardcoded dark colors) |

## Also fixed in this sprint
- **Auth Bug (link-sessions):** Route was rejecting empty `sessionIds` with 400, causing `user_preferences` to never be created for users who clicked magic link from a different window than where sessions were created (private mode → regular window). Fixed: `sessionIds` no longer required; only `userId` is mandatory.
- **Auth Bug (loadHistory):** `loadHistory` in `page.tsx` was getting `authSession` but not setting `userEmail` from it, causing AuthPanel to re-appear even on successful auth. Fixed: `setUserEmail` + `storeUserEmail` called from `authSession.user.email` if present.

## SPRINT 19 TEST LOG

| # | Test | Expected |
|---|---|---|
| 1 | Run `migration_sprint19.sql` → `SELECT access_type, count(*) FROM mirror_access GROUP BY access_type` | No paid/granted/trial rows remain |
| 2 | New user, 0–2 sessions → `/mirror` | LockedView, progress bar, "3 decisions to unlock preview" |
| 3 | 3rd session complete → `/mirror` | TeaserView — timeline visible, modules blurred, subscribe CTA |
| 4 | Teaser state → network tab | `/api/mirror/teaser` returns patternCount, contradictionCount, blurred independenceScore |
| 5 | Teaser state → `GET /api/mirror/fingerprint` with Bearer | 403 |
| 6 | Teaser state → `GET /api/mirror/timeline` | Sessions returned (not blocked) |
| 7 | `POST /api/admin/grant-mirror-access` userId + monthly + x-admin-key → `/mirror` | Full UnlockedView |
| 8 | Grant lifetime → check expires_at in DB | NULL (never expires) |
| 9 | Set expires_at to past for user with 3+ sessions → `/mirror` | TeaserView (not locked) |
| 10 | `/api/mirror/status` for no-auth / <3 / 3+ / subscribed | auth / locked / teaser / unlocked |
| 11 | Complete session through synthesis | Mirror nudge appears below synthesis text |
| 12 | Website pricing → click "Annual · 2 months free" | ₹9,999/yr, badge "Best value" |
| 13 | Enter unlock code (MIRROR_UNLOCK_TOKEN value) in TeaserView | Immediate unlock, gateState → unlocked |
| 14 | Enter unlock code when expired subscription exists | Upserts successfully (no conflict error) |
| 15 | MemoryEngineStatus at 3 sessions | "Mirror preview ready" green line + "View Mirror →" appears |
| 16 | MemoryEngineStatus at 4 sessions | "1 more session for Pattern Memory" (gold) + green Mirror line |
| 17 | MemoryEngineStatus at 5 sessions | Both Pattern Memory and Mirror lines green |
| 18 | Railway logs after new session (v2.0) | `[Persona] Council context injected for <key> (initial)` × 6 |
| 19 | Railway logs — pushback call | No `(initial)` log (pushback excluded) |
| 20 | Decision with `identity_alignment=5, ambiguity=3` | R2 does NOT fire |

---

## SPRINT 20 TEST LOG

| # | Test | Expected |
|---|---|---|
| W1 | Website council section | 6 cards: Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor. No PRISME acronym. |
| W2 | Website showcase headings | "01 — Contradiction Detector", "03 — Decision Independence Score" |
| W3 | Website pricing feature list | "Your Implicit Rules", "What Keeps Coming Up", "Decision Patterns" feature present |
| W4 | Website Council step copy | "Contrarian. Risk Architect. Pattern Analyst. Stakeholder Mirror. Elder. Competitor." |
| M1 | Mirror UnlockedView headers | Bias Fingerprint, Decision Independence Score, Your Implicit Rules, What Keeps Coming Up, Contradiction Detector, Confidence Calibration |
| M2 | Bias Fingerprint module | Sub-description present: "The conditions that trigger your patterns…" |
| M3 | Decision Independence Score module | Sub-description present: "How much this decision came from you…" |
| S1 | Signal pill — run decision: "A founder I respect says his SPV closes in 4 days and this is my last chance to invest ₹25L. I've only had one call with the company." | fomo_urgency tile shows red pill "Working against you here" (low real time pressure = distorting) |
| S2 | Signal pill — run decision: "I want to promote my head of product to CPO. 14 months strong performance. Haven't spoken to skip-level reports or benchmarked externally. I feel certain." | overconfidence tile shows red pill (high ddInfo available = distorting) |
| S3 | Pre-Sprint-20 existing sessions in Mirror | No signal pills on any tile — null signalType renders nothing. No regression. |
| D1 | Click "N of your sessions ↓" on confirmed bias tile | Drawer opens inline, shows full decision text (no truncation), scrollable if > 5 sessions |
| D2 | Click outside drawer | Drawer closes |
| D3 | Click fire count (3×) on a rule in What Keeps Coming Up | Same drawer behaviour as D1 |
| D4 | sessions-lookup called for session_ids belonging to another user | Returns empty (ownership gate — .eq user_id filter) |
| B1 | GET /api/mirror/benchmark with valid token, thin corpus | `{ insufficient: true, cluster_size: <N> }` |
| B2 | Benchmark module in Mirror UnlockedView with insufficient cluster | Module not rendered — no empty state shown |
| B3 | Decision Brief after synthesis (subscribed user) | Closing sentence present: second person, about decision-maker, ≤20 words, no softening opener |


---

## SPRINT 19a TEST LOG

| Test | What to check | Expected |
|---|---|---|
| R2a | Decision with `identity_alignment = 5, ambiguity = 3` → R2 does NOT fire | 🔲 |
| R2b | Decision with `identity_alignment = 5, ambiguity = 4` → R2 fires, GATE mode | 🔲 |
| R2c | Decision with `identity_alignment = 4, ambiguity = 4` → R2 does NOT fire | 🔲 |
| CC1 | New session (v2.0) → Railway log shows `Council context injected for risk_architect (initial)` × 6 | 🔲 |
| CC2 | v1.0 session → no council context log, personas run normally | 🔲 |
| CC3 | Pushback exchange → no council context injected | 🔲 |
| CC4 | Synthesis still receives council context — no regression | 🔲 |

---

## SPRINT 18b TEST LOG

(Carried from v21 — see previous doc for PS1–PS11)

---

Sprint 23b — Council Synthesis TTS (Read Aloud)
Sprint 23c — Persona Cards TTS (Read Aloud)
Paste both entries directly after the Sprint 23a block in the handover doc,
before the ENVIRONMENT VARIABLES REQUIRED section.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Sprint 23b · Status: ✅ Complete
TTS — Read Aloud on Council Synthesis card.
Established all TTS infrastructure (API route, hook, context) reused by Sprint 23c without modification.

## Architecture — REST not WebSocket
Confirmed from Soniox docs. Endpoint: `POST https://tts-rt.soniox.com/tts`
Model: `tts-rt-v1` · Voice: `Adrian` · Format: `mp3` · Auth: `Authorization: Bearer SONIOX_API_KEY`

## Files created
- `app/api/voice/tts/route.ts` — server-side proxy. Strips markdown (regex, no library), validates text, calls Soniox REST, pipes `audio/mpeg` body back to client. Error codes: `TTS_NOT_CONFIGURED / TTS_QUOTA_EXCEEDED / TTS_PROVIDER_DOWN / TTS_FAILED / INPUT_TOO_LONG`.
- `hooks/useSonioxTTS.ts` — client TTS hook (see interface below).
- `context/TTSContext.tsx` — singleton wrapper. `TTSProvider` mounted inside `components/SessionView.tsx` wrapping the council content block. `useTTSContext()` consumed by all cards. Do NOT mount at app layout level.

## useSonioxTTS interface (as built)
```
speak(text, speakerId): void
stop(): void
isSpeaking: boolean
isLoading: boolean
activeSpeakerId: string | null
rate: number                    — playback speed (1 | 1.5 | 2), default 1
setRate(r: number): void        — updates rateRef + live audio.playbackRate if playing
countdown: number | null        — estimated seconds until first audio; null when playing
```

## Chunking architecture (added during implementation)
Sending full synthesis text as one request = ~1m50s wait (Soniox generates audio at ~1× real time). Fix: split text into chunks before sending.

`chunkText(text)` — splits on sentence boundaries. `MAX_WORDS = 40` per chunk (≈16s audio, ≈12-15s first-chunk start at 1×).

Pre-fetch queue (`PREFETCH = 1`): seeds 2 concurrent fetches (within Soniox 3-concurrent limit). Chunk N+1 fetch starts when chunk N blob arrives → seamless joins at 1× speed.

`fetchChunkWithRetry` — 1 retry with 1.5s delay on non-abort errors. Handles Railway cold starts and transient Soniox errors. `setIsLoading(false)` moved to after the loop (always fires on break or normal exit — previously left state dirty on error).

## Countdown timer
On `speak()`: estimates `Math.round((firstChunkWords / 150) * 60)` seconds, starts 1s interval. Button shows `~Ns → Starting…` while fetching. Cleared when chunk 0 blob arrives.

## Pace button
Cycles 1× → 1.5× → 2× → 1×. `rateRef` keeps rate accessible inside async callbacks. `setRate()` updates both `rateRef.current` and `audioRef.current.playbackRate` live. Applied to every new Audio element at start — rate carries across all chunks.

## SynthesisCard button placement
**Header right group** (near "Council Synthesis" title), only when `state === 'done' && synthesis`. Two buttons: Read aloud/Stop (with countdown) + Pace cycle. Gold accent on active.

## Bugs fixed post-deploy
1. **First click flicker** — Railway cold start → chunk 0 fails → `break` exits loop → `setIsLoading(false)` never called → `activeSpeakerId` reset to null → button snaps to Read aloud. Fixed: `fetchChunkWithRetry` (route warm on retry) + `setIsLoading(false)` after loop.
2. **Stopping mid-read** — PREFETCH=2 fired 3 simultaneous requests, hitting Soniox 3-concurrent limit → transient failure → `break` → silent stop. Fixed: PREFETCH=1 + retry.

## Tech debt
**Pace gap at 1.5×/2×:** At elevated speeds, chunk N finishes before chunk N+1 blob arrives → brief silence. Fix: start pre-fetch earlier based on `rate × chunkDuration`. Logged in Known Gaps.

## Environment
No new vars. `SONIOX_API_KEY` (Sprint 23a) covers TTS.

## Sprint 23b test checklist
| # | Test | Expected |
|---|---|---|
| B1 | Click Read aloud on synthesis | Countdown (~Ns) → audio begins within ~15s |
| B2 | Click Stop mid-audio | Audio stops immediately |
| B3 | Click Read aloud again after stop | New fetch, plays from beginning |
| B4 | Navigate away while playing | Unmount cleanup stops audio, revokes URL |
| B5 | Network tab | SONIOX_API_KEY not in any client request |
| B6 | Synthesis contains bold markers | Stripped — not read aloud as "asterisk asterisk" |
| B7 | Soniox TTS 429 | Button returns to idle silently |
| B8 | Light mode | Button renders correctly (CSS vars only) |
| B9 | Set pace to 1.5× before clicking Read aloud | Audio plays at 1.5× from first chunk |
| B10 | Change pace mid-playback | Rate applies to current chunk immediately; next chunks inherit |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Sprint 23c · Status: ✅ Complete
TTS — Read Aloud on all 6 persona cards. Reuses Sprint 23b infrastructure entirely (route, hook, context unchanged).

## Files modified
- `components/PersonaPanel.tsx` — only file changed.

## Button placement — bottom strip (not header)
Header is too tight (icon + title + tagline + pushback + status badge). A **thin bottom strip** is added as the last child of each persona card, using `accentColor` background to match the card header — reads as a cohesive footer.

Strip layout: `[▶ Read aloud / ■ Stop + countdown]` left — `[1× / 1.5× / 2×]` right.

Visibility: only when `panelState === 'done' && !showPushback`. Disappears when pushback input is open.

## Implementation
```typescript
import { useTTSContext } from '@/context/TTSContext'

const { speak, stop, isSpeaking, isLoading, activeSpeakerId, rate, setRate, countdown } = useTTSContext()
const isThisSpeaking = activeSpeakerId === persona.key

// Text spoken: `response` state variable (primary persona text)
// On click: isThisSpeaking ? stop() : speak(response, persona.key)
```

## Pace button
Same global `rate`/`setRate` from TTSContext. Changing it on any card applies to all subsequent chunks for any speaker. Gold accent when rate !== 1.

## Singleton enforcement
```
TTSProvider (SessionView)
  └── useSonioxTTS (one instance, one Audio element)
        ├── SynthesisCard → speak('synthesis')
        ├── PersonaPanel[contrarian] → speak('contrarian')
        ├── PersonaPanel[risk_architect] → speak('risk_architect')
        └── ... (all 6 personas)
```
Clicking Persona B while Persona A plays: `speak()` calls `stopInternal()` first. No per-card coordination needed.

## Sprint 23c test checklist
| # | Test | Expected |
|---|---|---|
| C1 | Click Read aloud on Persona 1 | Countdown → audio begins |
| C2 | Click Read aloud on Persona 2 while P1 playing | P1 stops; P2 countdown starts; P1 strip returns to idle |
| C3 | Click Stop on active persona | Audio stops immediately |
| C4 | Click synthesis Read aloud while persona playing | Persona stops; synthesis begins |
| C5 | All 6 personas loaded → click each | Each plays correctly, no overlap |
| C6 | Persona still streaming (panelState !== done) | TTS strip not rendered |
| C7 | Pushback input open | TTS strip hidden |
| C8 | Light mode | Strip renders correctly (accentColor unchanged in light mode) |
| C9 | Set pace to 2× on Persona 1, play Persona 2 | Persona 2 also plays at 2× |

## Sprint 24a · Status: ✅ Complete
Three UX fixes from Dora Suri session (May 23).
Files modified

lib/storage.ts — added removeSessionId(id) export. Symmetric with pushSessionId.
app/api/record/route.ts — new DELETE handler. Accepts { sessionId }, resolves caller from Bearer token, ownership check (user_id match or device-only), hard-deletes session row. messages/outcomes/examiner_responses cascade automatically via FK constraints.
app/page.tsx — three changes: (1) handleDeleteSession function — optimistic UI removal + removeSessionId + DELETE /api/record; (2) <IconTrash /> button on each session card (transparent → red on hover, stopPropagation); (3) "Six private advisors…" sub-text demoted to fontSize:12, fontStyle:italic, color:var(--text-4).
components/BackButton.tsx — NEW. 'use client' component. router.back() on click. Used on record page to return to Council without re-navigation.
app/record/[id]/page.tsx — header breadcrumb and bottom nav both use <BackButton label="← Back to Council" /> instead of Link. Bottom nav: Back to Council | Reanalyze | New decision.

Key decision
router.back() not Link href="/session/${id}" — back() triggers browser bfcache, restoring Council page with full React state. A forward Link href would remount and replay all useEffect hooks, re-running all 6 personas.

# Sprint 24b · Status: ✅ Complete
Back to Council was still re-running personas. TTS strip misaligned on equal-height grid rows.
Back to Council no re-run

app/session/[id]/page.tsx — fetches existing messages rows in parallel with session fetch. Builds Record<personaKey, content> map. Passes as initialMessages prop to SessionView.
components/SessionView.tsx — initialMessages prop added. completedResponses state seeded from it (status bar + synthesis gate count correctly). Passes initialContent={initialMessages[key]} to each PersonaPanel.
components/PersonaPanel.tsx — initialContent prop added. response state and responseRef seeded from it. panelState initialised as 'done' when content present. Mount effect returns early — no API call fires. New decisions have empty initialMessages → all 6 personas fire fresh as normal.

TTS strip alignment

app/globals.css — removed height: 100% from .persona-card. Cards were stretching to equal row height; body hit maxHeight: 380 cap; dead space opened between body and TTS strip. Natural card height removes the gap. maxHeight: 380 and scroll window preserved.


# Sprint 25 · Status: ✅ Complete
Pause/Resume TTS. Persona header layer (Lens/Position/Real Cost). Synthesis trade-off narrative.
Pause/Resume TTS

hooks/useSonioxTTS.ts — isPaused state, pause() (audioRef.current.pause()), resume() (audioRef.current.play()), stopInternal() resets isPaused. All exposed in hook interface.
components/PersonaPanel.tsx — TTS strip button becomes three-state: Read aloud → Pause (while playing) → Resume (while paused). Separate Stop button appears alongside while active.
components/SynthesisCard.tsx — same Pause/Resume/Stop pattern applied to synthesis Read aloud button.

Persona header layer
Three XML tags added to every persona prompt (via WORD_LIMIT_PREFIX constraint 0):

<lens> — the specific angle this advisor is looking through. Plain English, max 8 words.
<position> — advisor's verdict on this specific decision. Direct, no hedging.
<realcost> — concrete real-world consequence the decision-maker will feel. Full sentence, personal to this decision. Not a category label.

extractHeaderTags() in PersonaPanel strips tags from streamed output, sets state, returns clean prose. Tags render at top of card body as labeled lines (Lens: / Position: / The real cost:), bold label + normal-weight value, consistent 12px, thin divider before prose. Sub-header band removed entirely.
Each persona's RESPONSE STRUCTURE block updated with: "Before this structure begins: output the mandatory <lens>, <position>, and <realcost> header tags as required by constraint 0 above."
initialContent hydration also routes through extractHeaderTags so Back to Council renders header correctly.
Synthesis trade-off narrative
SYNTHESIS prompt gains TRADE-OFF SUMMARY block — always-present, always last, 60-word cap. Narrative prose covering 2–3 dimensions: what following the council's lean costs, what rejecting it preserves. Not a list, not category labels.
Files modified

lib/personas.ts — WORD_LIMIT_PREFIX constraint 0 (header block). All 6 persona RESPONSE STRUCTURE sections (header reminder). SYNTHESIS TRADE-OFF SUMMARY block.
components/PersonaPanel.tsx — extractHeaderTags, lensText/positionText/realCostText state, body-top render, pause/resume TTS.
hooks/useSonioxTTS.ts — isPaused, pause(), resume().
components/SynthesisCard.tsx — pause/resume/stop TTS.


# Sprint 26 · Status: ✅ Complete
DeepSeek 503 resilience. Persona RESPONSE STRUCTURE tag compliance fix.
DeepSeek 503 retry

lib/ai-client.ts — withRetry<T>(fn, label) wrapper. Detects 503 via status === 503 || code === 'service_unavailable_error'. Retries up to MAX_503_RETRIES = 2 times with RETRY_WAIT_MS = 5000ms wait. Both DeepSeek call sites wrapped: streamDeepSeek and createCompletion. Anthropic paths untouched. Logs warn on each retry attempt.

Root cause diagnosed: DeepSeek API returns 503 during peak hours (standard tier capacity). Previously caused permanent tagger_status = failed on ontology (no retry), all 6 personas to surface errors to user, structural context never loading for that session.
Persona tag compliance fix
The Contrarian was skipping <lens><position><realcost> output because its RESPONSE STRUCTURE section says "Never deviate from it / Opening line: A single direct statement" — model treated this as line 1 and skipped tags. All 6 personas now have an explicit reminder inside RESPONSE STRUCTURE: output tags before the structure begins. Fixed in lib/personas.ts (6 targeted inserts, no other changes). 

# SPRINT 24a/24b/25/26 TEST CHECKLIST
Sprint 24a
#TestExpectedD1Click trash icon on session cardConfirmation prompt → session removed from list immediatelyD2Check Supabase after D1Session row deleted, messages/outcomes cascade deletedD3Trash icon while logged in as different user403 ForbiddenD4"Six private advisors…" text on homeItalic, smaller, muted — reads as context not instructionD5Click "Save to Record" on Council pageLands on record/[id] pageD6Click "← Back to Council" (header)Returns to Council page with full state — no re-runD7Click "← Back to Council" (bottom nav)Same
Sprint 24b
#TestExpectedB1Navigate to existing session directly via URLAll 6 persona cards show content, no API calls fireB2TTS strip on persona cardsSits flush at card bottom — no gap between body and stripB3New decisionAll 6 personas stream fresh content
Sprint 25
#TestExpectedP1Run new decisionEach persona card shows Lens/Position/The real cost at top of bodyP2Lens/Position/Real cost textPlain English, full sentences, no jargonP3The Contrarian specificallyLens/Position/The real cost present (was missing pre-Sprint 26)P4Click Read aloud on personaButton changes to Pause + Stop appearsP5Click PauseAudio pauses; button shows ResumeP6Click ResumeAudio continues from paused positionP7Click StopAudio stops; buttons reset to Read aloudP8Click Read aloud on SynthesisSame Pause/Resume/Stop behaviourP9Synthesis outputTRADE-OFF SUMMARY paragraph present at end — prose, 2-3 dimensions
Sprint 26
#TestExpectedR1Railway logs during DeepSeek 503[AIClient] 503 on streamDeepSeek — retrying in 5000msR2After 2 retries failError surfaces normally — no silent hangR3All 6 personas output header tagsLens/Position/Real cost visible on all cards including Contrarian

# Sprint 27 · Status: ✅ Complete
Header layer redesign. Examiner R1/R7 REDIRECT distinction. Rule engine false positive fixes. Record page bugs.

Persona header layer — execution redesign
Sprint 25 introduced three labeled lines (Lens: / Position: / The real cost:) at the top of each card body. Sprint 27 removes the labeled-line queue and redistributes the three elements to their structurally correct positions.
Lens → card header caption
lensText || persona.tagline now renders as the sub-line in the card header (accent background). When the model hasn't streamed yet, the static tagline shows. Once lensText arrives it swaps in. Zero body lines consumed.
Position → unlabeled opening statement
No "Position:" label prefix. Renders at 13px, fontWeight 500, var(--text-1) — full contrast, reads as the advisor's opening declaration. Single thin divider below it, then prose.
Real cost → closing beat
Rendered below the prose at card bottom. 12px italic var(--text-4). Gated on panelState === 'done' && exchanges.length === 0 — does not render while streaming, disappears when a pushback exchange opens.
extractHeaderTags() unchanged — still strips all three tags from prose. Only rendering changed.
Files modified

components/PersonaPanel.tsx — header sub-line (lensText || persona.tagline), body position block (unlabeled, 13px/500), closing real cost block


Examiner — R1 vs R7 REDIRECT distinction
Root cause: upstreamRationale was read from ontology_vector.upstream_dependency.rationale for ALL REDIRECTs. R7 (information-first) also fires as REDIRECT — unrelated to upstream dependency. The tagger's own rationale for the upstream_dependency dimension ("no external blocking element exists…") was being surfaced inside the R7 blocking banner, producing directly contradictory copy.
Three fixes:
app/api/examiner/route.ts

Derives redirectRule from triggered_rules array (first rule with mode === 'REDIRECT'): 'R1' | 'R7' | null
upstreamRationale only populated when redirectRule === 'R1'
Returns redirect_rule in response JSON alongside upstream_rationale

components/ExaminerPanel.tsx

redirectRule state added (string | null)
Reads data.redirect_rule from API response on fetch
Header tagline: R7 → 'Synthesis held — specific information needed first'; R1 → unchanged
Banner title: R7 → 'Specific information would change this decision — the Council's read is provisional until you have it'; R1 → 'This decision has an unresolved upstream dependency'
upstreamRationale only rendered when redirectRule === 'R1'
Footer copy: R7 → instructs to gather info and Reanalyze; R1 → existing upstream copy unchanged
Build fix: unescaped apostrophe in JSX string (Council's → Council&apos;s)


Rule engine — R7 false positive fixes
lib/rule-engine.ts — two changes
R7 question template (line 120):

Before: '…What would it take to gather it in the next week?'
After: '…What is that information — and what would it take to get it?'
Rationale: old template assumed the user knew what the information was; invented a timeline not present in the decision text.

R7 identity gate (line 111):

Before: if (info.score < 4 || uncert.score < 3 || identity.score > 3) return null
After: if (info.score < 4 || uncert.score < 3 || identity.score > 2) return null
Rationale: gap between R7's old gate (>3) and R2's trigger (>=5) swallowed career/life-direction decisions where identity_alignment scores 3 (moderate, pragmatic framing). R7 was firing on decisions that are fundamentally values-driven, not information-gap decisions.

lib/ontology-tagger.ts — rubric NOTE added to decision_discriminating_info
Added NOTE (mirrors structure of upstream_dependency NOTE):

Score 4–5 ONLY when the missing information is (a) external and concretely obtainable — e.g. a salary figure, a market rate, a medical result, counterparty terms, a regulatory ruling — AND (b) would change the structural framing of the decision, not just its parameters. Do NOT score 4–5 when: the decision-maker has full situational awareness but faces inherent outcome uncertainty; the decision is primarily values-driven or identity-driven; the person is choosing between known paths with unknown futures. Career decisions where the person understands their situation score 1–2 even when future outcomes are uncertain. Inherent uncertainty ≠ missing information.


Record page — three fixes
app/record/[id]/page.tsx
QUORUM → home link
<span>Quorum</span> wrapped in <Link href="/">. + New Decision button added to header right (outer div already has justify-between).
XML tag stripping
stripHeaderTags(raw: string) function added (strips <lens>, <position>, <realcost> blocks). Applied to all assistant message renders. Tags are stored raw in DB since Sprint 25 — record page never stripped them.
Duplicate content deduplication
byPersona grouping replaced with two-pass logic:

Pass 1: collect all messages per persona key (unchanged)
Pass 2: for each persona, split at first user message. Of the initial assistant block, keep only the last message. Append pushback exchanges (user + following assistant) in full.
Prevents duplicate advisor content when a session was re-run (pre-Sprint 24b or via any path that inserted multiple initial assistant rows per persona key).


# Sprint 27 test checklist
#TestExpectedS1Run new decisionCard header sub-line shows lens text once loaded (not static tagline)S2Card body topUnlabeled position statement — no "Position:" prefixS3Card body bottomItalic muted closing line after prose loads; absent during streamingS4R7 decision (financials withheld, no identity stakes)Examiner shows "Synthesis held — specific information needed first"; question ends with "…what would it take to get it?"S5R7 bannerNo "no external blocking element" copy anywhereS6R1 decision (named prior unresolved external decision)Examiner shows "upstream decision unresolved" copy unchangedS7Career/values decision (Air India HRBP decision)R7 does NOT fire; no REDIRECTS8Record page — advisor cardsNo raw XML tags (<lens>, <position>, <realcost>) visibleS9Record page — re-run sessionEach advisor appears once, not duplicatedS10Record page — QUORUM headingClick navigates to home pageS11Record page — header right+ New Decision button visible, links to home

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

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_PROVIDER              (anthropic | deepseek)
AI_MODEL                 (claude-sonnet-4-20250514 | deepseek-chat)
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
MIRROR_TOKEN_MONTHLY     ← shared code for monthly access (30 days)
MIRROR_TOKEN_ANNUAL      ← shared code for annual access (365 days)
MIRROR_TOKEN_LIFETIME    ← shared code for lifetime access (no expiry)
MIRROR_UNLOCK_TOKEN      ← legacy fallback, treated as lifetime — keep until all old codes retired
SONIOX_API_KEY           ← Soniox STT + TTS shared key (added Sprint 23a — covers voice/stream, voice/chunk, voice/cleanup, voice/tts)
```

---

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.org / invigorating-manifestation-production-ecd2.up.railway.app
- Website: www.quorumvault.org
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
