# QUORUM — Handover Document v22
### Date: May 2026 | Status: Sprint 19 complete (Mirror subscription gate · Teaser view · Pricing toggle · Race condition fix · Unlock route fix · Multi-token unlock)
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

## DATABASE SCHEMA (current as of Sprint 19)

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

### sessions, sessions_ontology, outcomes, structural_scores, messages, bias_library, contradictions, examiner_responses, user_preferences, session_requests, brief_access_tokens, structural_matches, sessions_pending_outcomes
All unchanged from Sprint 18b. See v21 for full schema.

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
  personas.ts, structural-retrieval.ts, ontology-tagger.ts, bias-scorer.ts,
  contradiction-detector.ts, independence-score.ts, mirror-fingerprint.ts,
  ai-client.ts, supabase.ts, storage.ts — unchanged

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
  payment/create-subscription/route.ts — ✅ Sprint 19 NEW — stub. Auth via x-admin-key.
  admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW — manual provisioning. Upsert with durationDays.
  persona/route.ts          — ✅ Sprint 19 hotfix — fetchCouncilContextWithRetry() for initial personas
                              (400ms poll, up to 3s) fixes race condition where ontology not yet written
                              when initial personas fire. Synthesis path uses plain fetchCouncilContext().
                              also Sprint 19a: buildCouncilContext() extended to all 6 initial personas
  ontology/route.ts, structural-match/route.ts, examiner/route.ts,
  bias-score/route.ts, independence-score/route.ts — unchanged from Sprint 18a/17

payment/create-subscription/route.ts — ✅ Sprint 19 NEW (stub)
admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW

components/
  MemoryEngineStatus.tsx   — ✅ Sprint 19 hotfix — MIRROR_TEASER_THRESHOLD=3 added.
                             mirrorTeaserReady flag (sessionCount ≥ 3). "View Mirror →" link
                             appears at ≥3 (gold) and ≥5 (green). "Mirror preview ready" rendered
                             on its own green line below the Pattern Memory countdown.
                             Status text at 3–4 sessions: "X more sessions for Pattern Memory"
                             + green "Mirror preview ready  View Mirror →" below.
  PatternStore.tsx         — ✅ Sprint 18b NEW
  SynthesisCard.tsx        — ✅ Sprint 19 — post-synthesis Mirror nudge: "This decision has been
                             added to your Mirror profile. View Mirror →". Shown when state=done,
                             separated from synthesis text by border-dim divider. Non-blocking.
                             also Sprint 16b: redirectQuestion prop + onOverrideRedirect
  SessionView.tsx, PersonaPanel.tsx, ExaminerPanel.tsx, AuthPanel.tsx,
  CalibrationSparkline.tsx — unchanged

app/
  mirror/page.tsx          — ✅ Sprint 19 — LockedView (<3 sessions, progress bar to 3),
                             TeaserView (≥3 sessions no sub — fetches /api/mirror/teaser,
                             blurred stats, locked module previews, "Subscribe to Mirror →" CTA),
                             UnlockedView (unchanged). fetchStatus fetches timeline for teaser+unlocked.
                             PRICING_URL: https://www.quorumvault.org/#pricing
                             also Sprint 18b: PatternStore imported + wired into UnlockedView
  page.tsx                 — unchanged

Static:
  index.html (quorumvault.org) — ✅ Sprint 19 — Monthly/Annual billing toggle pill (setBilling() JS).
                             Mirror card: ₹1,499/mo ↔ ₹9,999/yr. Badge: "Most used" ↔ "Best value".
                             Free tier: removed "Decision Timeline ≥5 sessions" + "Behavioral alerts".
                             Live advisory: "Mirror subscription included (12 months)".
                             Modal step 1 Mirror: ₹1,499/mo · or ₹9,999/yr.
                             Success message: subscription link flow (not token).
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

---

## CURRENT STATUS (as of Sprint 19)

### Mirror Gate States

| State | Condition | UI |
|---|---|---|
| `auth` | Not authenticated | AuthGate — sign in prompt |
| `locked` | Authenticated, < 3 sessions | LockedView — progress bar to 3, "what Mirror reveals" preview |
| `teaser` | ≥ 3 sessions, no valid subscription | TeaserView — timeline free, module previews blurred, subscribe CTA |
| `unlocked` | Valid subscription (not expired) | Full UnlockedView — all modules |

**Subscription types:** `monthly` (expires 30 days), `annual` (expires 365 days), `lifetime` (no expiry), `advisory` (no expiry — comp grant for live advisory clients).

**Unlock code flow:** Three Railway env vars control unlock access. User enters code in TeaserView → `/api/mirror/unlock` validates against all three tokens → upserts mirror_access with correct access_type and expires_at → immediate unlock.
- `MIRROR_TOKEN_MONTHLY` → `monthly`, expires 30 days
- `MIRROR_TOKEN_ANNUAL` → `annual`, expires 365 days
- `MIRROR_TOKEN_LIFETIME` → `lifetime`, no expiry
- `MIRROR_UNLOCK_TOKEN` → legacy fallback, treated as `lifetime`

Share the appropriate token privately (WhatsApp/email) after payment. Rotate any token in Railway at any time — existing mirror_access rows are unaffected.

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

---

## PENDING (next sprint — Sprint 20)

- **Payment gateway (Razorpay webhook):** Wire `/api/payment/create-subscription` stub to actual Razorpay webhook. Replace `x-admin-key` guard with webhook signature verification. Auto-provision monthly/annual access on payment success.
- **R11 (Avoidance Detection):** Parked. Requires cron + `days_open` tracking.
- **Railway cron for 30-day outcome nudges:** Parked. `sessions_pending_outcomes` view exists.

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

---

## KNOWN GAPS (logged, not prioritised)

- **Email auto-link on fresh magic-link login:** After Supabase magic link login, `loadHistory` in `page.tsx` reads `authToken` from the session but does not read `session.user.email` → `userEmail` stays null → `AuthPanel` shown again asking for email redundantly → `user_email` field null on first submitted session. Fix is 3 lines in `loadHistory`. Deprioritised — low user impact at current scale.

- Private benchmarking (aggregate anonymised dimension scores)
- Decision Graph (requires ~20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)

---

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
```

---

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.org / invigorating-manifestation-production-ecd2.up.railway.app
- Website: www.quorumvault.org
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
