# Quorum — Full Technical Specification

**Scope:** Complete backend logic, formulas, AI orchestration, data flows, and invisible-to-UI mechanics across the entire codebase.  
**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (PostgreSQL + Auth) · Railway hosting · Anthropic Claude / DeepSeek AI · Soniox STT/TTS · Razorpay payments · Web Push

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Core Decision Flow (Council)](#2-core-decision-flow-council)
   - 2.1 Session Creation
   - 2.2 Ontology Tagger
   - 2.3 Rule Engine (12 Rules)
   - 2.4 Persona Orchestration
   - 2.5 Examiner System
   - 2.6 Structural Retrieval & Matching
   - 2.7 Decision Continuity — RET-5 Revisit & the Decision Arc
   - 2.8 Persona Relevance Scoring (full algorithm)
   - 2.9 Outcome Recording
   - 2.10 Decision Brief PDF
   - 2.11 Session History & Labels
   - 2.12 User Profile, Framing Intent & Correction Carry-Forward (SB-1 / SB-3 / S2-05)
   - 2.13 Post-Decision Confidence Capture (S2-01)
   - 2.14 Council Verdict & Tension Highlight (S1-03 / S3-01)
   - 2.15 Session-End Enrichment Surfaces (Bias Note, Decision-Maker Observation, Synthesis Summary)
   - 2.16 Onboarding & Guided Tours (TOUR-1)
   - 2.17 Worth Confirming (Sprint 1 follow-on)
   - 2.18 Synthesis Versioning & the "What Changed" View (P1)
3. [Mirror Layer](#3-mirror-layer)
   - 3.1 Mirror Access Gating
   - 3.2 Bias Scoring System
   - 3.3 Bias Trigger Engine
   - 3.4 Mirror Fingerprint
   - 3.5 Calibration Engine
   - 3.6 Contradiction Detector
   - 3.7 Avoidance Detector
   - 3.8 Independence Score
   - 3.9 Session Reliability Score
   - 3.10 Decision Rules
   - 3.11 Pattern Store
   - 3.12 Monthly Review
   - 3.13 Benchmark Module
   - 3.14 Mirror Summary
   - 3.15 ValidationCard Signal
   - 3.16 Council Weighting Strip (S2-02)
   - 3.17 Watchlist (Sprint W1)
   - 3.18 Mirror Advisory Request Flow (Sprint M7)
4. [Decision Graph Engine](#4-decision-graph-engine)
   - 4.1 Edge Types & Canonicalization
   - 4.2 Live Structural Edges
   - 4.3 Backfill Engine
   - 4.4 Graph Synthesis Context
   - 4.5 Tiered Graph Access — locked / preview / full (Sprint QW-2)
   - 4.6 Post-Session Graph Nudge (Sprint QW-3)
5. [Infrastructure & Security](#5-infrastructure--security)
   - 5.1 Encryption
   - 5.2 Rate Limiting
   - 5.3 Audit Log
   - 5.4 Supabase Client Tiers
   - 5.5 Client-Side Storage & Cookie Consent
6. [Authentication](#6-authentication)
   - 6.1 Magic Link Flow
   - 6.2 Session Linking (Anonymous → Authenticated)
7. [Voice System](#7-voice-system)
   - 7.1 Speech-to-Text (Soniox WebSocket)
   - 7.2 Text-to-Speech (Soniox HTTP)
8. [Notification & Nudge System](#8-notification--nudge-system)
   - 8.1 Web Push Infrastructure
   - 8.2 Notification Throttle Gate
   - 8.3 Nudge Copy Engine
   - 8.4 Nudge Unsubscribe Tokens
   - 8.5 Lapse Nudge Cron (daily-nudge)
   - 8.6 Validation Nudge Cron
   - 8.7 Reanalyze Email Cron
   - 8.8 Mirror Insight Email Cron
   - 8.9 Avoidance Detection Cron
9. [Payments — Razorpay](#9-payments--razorpay)
10. [Admin Routes](#10-admin-routes)
11. [Account Management](#11-account-management)
12. [Institutional Mode](#12-institutional-mode)
    - 12.1 Overview & Feature Flag
    - 12.2 Schema
    - 12.3 Redemption, Onboarding & Sub-Institutions
    - 12.4 RBAC
    - 12.5 Consent Model
    - 12.6 The K-Floor Privacy Mechanism
    - 12.7 Aggregate Benchmark (Institution-Level)
    - 12.8 Cross-Institution Rollup (Conglomerate Tier)
    - 12.9 Bias Parameter Benchmark ("Sprint 6" per SQL filename — not Kunal's planned hardening Sprint 6)
    - 12.10 Cohorts
    - 12.11 Admin Console
    - 12.12 Synthesis-Time Injection
    - 12.13 Unlock Notices & Progress-Toward-Floor
    - 12.14 Restricted DB Role — Defined, Not Wired
    - 12.15 Tier 3 — Deactivation
    - 12.16 Institution Creation (Platform-Admin-Only)
    - 12.17 Billing Model & Known Gaps

---

## 1. System Architecture Overview

Quorum is a **personal judgment infrastructure** product. Each user takes a structured decision through a multi-stage pipeline:

```
[Decision Input]
      │
      ▼
[Session Creation] ── [Ontology Tagger v2.0] ── [Rule Engine (12 rules)]
      │
      ▼
[Persona Orchestration] ── 6 AI Advisors + The Examiner + Decision Brief
      │
      ▼
[Bias Scoring] ── [Structural Matching] ── [Contradiction Detection]
      │
      ▼
[Outcome Recording] ── [Mirror Layer: Fingerprint / Calibration / Independence]
      │
      ▼
[Decision Graph] ── [Nudge System] ── [Payments / Access Gating]
```

**Database tables (Supabase):**  
`sessions`, `messages`, `examiner_responses`, `sessions_ontology`, `bias_library`, `structural_matches`, `structural_scores`, `outcomes`, `contradictions`, `contradiction_runs`, `contradiction_log`, `avoidance_alerts`, `mirror_access`, `user_preferences`, `independence_score_log`, `push_subscriptions`, `notification_log`, `audit_log`, `graph_edges`, `user_profiles`, `watchlist_items`, `synthesis_versions` (P1 — What Changed, §2.18)

**Institutional Mode tables** (§12) — separate migration lineage, `supabase/institutional_sprint1-6_*.sql` + `institutional_tier3_deactivation.sql`, all gated behind `isInstitutionalModeEnabled()`: `institutions`, `institution_memberships`, `unlock_code_redemptions`, `consent_audit_log`, `cohorts`, `cohort_memberships`. Plus three materialised views computed over existing session data rather than new base tables: `institutional_benchmark_segments`, `institutional_rollup_benchmark_segments`, `institutional_bias_parameter_segments`.

> **Schema tracking note (added this pass):** `supabase/schema.sql` and the numbered `supabase/sprintN_*.sql` files in the repo predate most of the tables/columns referenced above and below — they were not kept current as sprints shipped (migrations are typically run ad hoc in the Supabase SQL editor per the deployment notes in the handover doc, and the `.sql` file isn't always committed afterward). `watchlist_items` (Sprint W1) is the newest non-institutional table with no migration file in the repo at all. The institutional migrations (`institutional_sprint1_schema.sql` through `institutional_sprint6_bias_parameter_view.sql`, plus `institutional_tier3_deactivation.sql`) are, by contrast, present, numbered, and appear to have actually been run in order — treat those as reliable. For everything else, treat this spec, not `supabase/schema.sql`, as the source of truth for current columns, and consider exporting the live Supabase schema periodically to reconcile.
>
> **Account deletion gap (flagged, not fixed):** `DELETE /api/account` (§11) does not delete `institution_memberships` or `cohort_memberships` rows for the deleted user. A deleted account can leave an orphaned membership row behind — harmless for aggregate views (they're count/average-based and a phantom member just slightly skews a denominator), but worth a cleanup pass before institutional rollout scales past a handful of pilot accounts.

**AI providers:**
- **Anthropic Claude** — persona primary (Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor), examiner, synthesis, bias scoring, contradiction detection, calibration, rules extraction
- **DeepSeek** — Decision Brief auto-generation (cost-optimised fallback)
- **Routing:** `ROUTING_MODE` env var controls provider per call (`anthropic_only`, `deepseek_only`, `mixed`). Some calls are hard-pinned to Anthropic regardless of mode (e.g. Examiner, Bias Scorer).

**Encryption:** AES-256-GCM field-level encryption on all raw user input columns. Server-only; encrypted at write, decrypted at read. Key: `DB_ENCRYPTION_KEY` (64-char hex / 32 bytes).

---

## 2. Core Decision Flow (Council)

### 2.1 Session Creation

**Route:** `POST /api/session`  
**Rate limit:** 20 requests per 15 minutes per IP

**Request body:**
```json
{
  "decision": "string (the decision question)",
  "context": "string (optional background)",
  "user_email": "string (optional, pre-auth)",
  "user_id": "string (optional, post-auth)",
  "device_id": "string (optional, from localStorage)",
  "parent_session_id": "string (optional, uuid — RET-5 Sprint 1, see §2.7)"
}
```

**Backend logic:**
1. Validates `decision` field is non-empty.
2. Encrypts `decision_text` and `context_text` using `encrypt()` before DB write.
3. Inserts row into `sessions` with `status = 'active'`, `validation_state = 'pending'`.
4. Sets `user_id`, `user_email`, `device_id` from request body — all optional at creation; anonymous sessions are fully supported.
5. **If `parent_session_id` is present (RET-5 revisit/"Reanalyze"):** validates the parent session belongs to the *same* caller (by `user_id`, falling back to `device_id` for anonymous sessions) before accepting it — a user cannot graft a new session onto someone else's decision by guessing a UUID. Rejects with `400` if the parent doesn't resolve to the caller. On success, stores `parent_session_id` on the new row; this is the sole link the rest of RET-5 (§2.7) walks to assemble continuity context and the Decision Arc timeline.
6. Writes an audit log entry: `session.create`.
7. Returns `{ session_id, status }`.

**Identity tiers (how sessions accumulate toward bias/mirror):**
- `user_id` (post-auth) → primary accumulation key
- `user_email` (pre-auth, typed by user) → secondary
- `device_id` (anonymous, localStorage-generated) → tertiary

---

### 2.2 Ontology Tagger

**Route:** `POST /api/ontology`  
**Library:** `lib/ontology-tagger.ts`

The tagger converts a raw decision text + optional context into a structured vector and metadata row in `sessions_ontology`. It runs as a fire-and-forget call immediately after session creation.

**Tagger version:** `v2.0` (gated on `TAGGER_VERSION` env var, default `v2.0`)

#### 2.2.1 Ontology Vector — 14 Dimensions

Each dimension is scored 1–5 (integer) with a `confidence` 0–1 float:

| Dimension Key | What it measures |
|---|---|
| `reversibility` | How hard is it to undo this decision? |
| `time_horizon` | Short-term vs long-term effect scope |
| `stakes_magnitude` | Scale of consequences |
| `outcome_uncertainty` | Predictability of outcome |
| `ambiguity` | Clarity of the situation itself |
| `task_complexity` | Number of interdependent moving parts |
| `decision_discriminating_info` | Would one key fact change the answer? |
| `time_pressure` | Genuine vs manufactured deadline |
| `decision_unit` | Solo vs multi-party alignment needed |
| `value_conflict` | Internal priority conflict |
| `emotional_intensity` | Emotional charge on the decision |
| `identity_alignment` | Connection to self-concept |
| `regret_asymmetry` | Asymmetry in potential regret directions |
| `upstream_dependency` | Dependence on prior unsettled decisions |

**Starred dimensions** (carry 1.5× weight in structural similarity scoring):  
`identity_alignment`, `regret_asymmetry`, `upstream_dependency`

#### 2.2.2 Categorical Fields

- `decision_type_primary` — one of: `commitment | allocation | transition | acquisition | renunciation | governance | delegation`
- `dominant_emotion` — one of: `anxiety | excitement | obligation | ambivalence | urgency | resignation`
- `stakes_reversibility` — compound field combining stakes/reversibility signals for the ValidationCard

#### 2.2.3 Rule Engine Result

The tagger also invokes the Rule Engine (see §2.3) and stores the result in `sessions_ontology.rule_engine_result` as JSONB:
```json
{
  "mode": "REDIRECT | GATE | FLAG | OPEN",
  "triggered_rules": [{ "rule_id": "R1", "label": "...", "reason": "..." }],
  "flag_rules": [{ "rule_id": "R4", "label": "...", "reason": "..." }]
}
```

#### 2.2.4 AI Prompt Structure

The tagger sends a structured system prompt asking Claude to return **only JSON** (no preamble, no markdown). The prompt includes:
- All 14 dimension definitions with anchors for 1, 3, 5
- The categorical taxonomy
- Instruction: `If unsure, score 3 (midpoint). Never leave a field null.`
- Response parsing strips ` ```json ` fences and re-attempts `JSON.parse` on a bracket-slice fallback if initial parse fails.

#### 2.2.5 DB Write

Upserts into `sessions_ontology` with `tagger_version`, `tagger_status = 'complete'`, all vector scores, and `rule_engine_result`.

---

### 2.3 Rule Engine (12 Rules)

**Library:** `lib/rule-engine.ts`  
**Called by:** ontology tagger, persona route (synthesis directive)

Deterministic rule evaluation over the 14-dimension ontology vector. Rules are checked on every session and drive synthesis framing, UI flags, and the Pattern Store.

#### Rule Definitions

| Rule ID | Label | Trigger Condition | Type |
|---|---|---|---|
| **R1** | Upstream Dependency | `upstream_dependency ≥ 4` | REDIRECT |
| **R2** | Identity-First Gate | `identity_alignment ≥ 4` AND `ambiguity ≥ 4` | GATE |
| **R3** | No-Information Mode | `decision_discriminating_info ≤ 2` AND `outcome_uncertainty ≥ 4` | GATE |
| **R4** | Regret Asymmetry | `regret_asymmetry ≥ 4` AND `reversibility ≥ 4` | FLAG |
| **R5** | False Urgency | `emotional_intensity ≥ 4` AND `time_pressure ≤ 2` | FLAG |
| **R6** | Multi-Party Alignment | `decision_unit ≥ 4` AND `emotional_intensity ≥ 4` | FLAG |
| **R7** | Information-First | `decision_discriminating_info ≥ 4` AND `outcome_uncertainty ≥ 4` | REDIRECT |
| **R8** | Irreconcilable Values | `value_conflict ≥ 4` AND `identity_alignment ≥ 4` | FLAG |
| **R9** | Irreversibility Warning | `reversibility ≥ 4` AND `emotional_intensity ≥ 4` AND `time_pressure ≤ 2` | FLAG |
| **R10** | Complexity Overload | `task_complexity ≥ 4` AND `ambiguity ≥ 4` | GATE |
| **R12** | Couple Misalignment | `decision_unit ≥ 4` AND `value_conflict ≥ 4` | FLAG |

> Note: R11 is reserved (configurable threshold env-var sentinel, not a decision rule).

#### Rule Precedence & Mode

The engine evaluates all rules simultaneously and assigns a composite **mode**:
- `REDIRECT` — if any REDIRECT rule fires (R1, R7): implies a prerequisite action must happen first
- `GATE` — if any GATE rule fires and no REDIRECT (R2, R3, R10): implies analysis needs reframing
- `FLAG` — if only FLAG rules fire (R4, R5, R6, R8, R9, R12): advisory warnings alongside normal flow
- `OPEN` — no rules fire: standard flow

All triggered rules are enumerated in the result regardless of mode (a session can be REDIRECT + carry multiple FLAG rules simultaneously).

---

### 2.4 Persona Orchestration

**Route:** `POST /api/persona`  
**Library:** `lib/personas.ts`, `lib/council-context.ts`, `lib/bias-scorer.ts`, `lib/graph-engine.ts`  
**Rate limit:** 60 per 10 minutes per IP

This is the most complex orchestration in the product. Each call generates a single persona's streaming response, but the server-side prompt construction is deeply personalised.

#### 2.4.1 The Six Core Personas

| Key | Label | Archetype |
|---|---|---|
| `contrarian` | The Contrarian | Steelman every counter-position; what would have to be true for the opposite choice to be correct? |
| `risk_architect` | Risk Architect | Probability-weighted downside mapping; tail-risk exposure; asymmetric outcome analysis |
| `pattern_analyst` | Pattern Analyst | Historical analogy retrieval; base-rate reasoning; prior decision patterns |
| `stakeholder_mirror` | Stakeholder Mirror | Whose interests are in play? Who benefits from your urgency? |
| `elder` | The Elder | Long-game thinking; what will this look like in 10 years? |
| `competitor` | The Competitor | If an adversary wanted you to make the wrong call, what would they want you to do? |

Plus two special outputs:
- `examiner` — The Examiner (handled by separate route, §2.5)
- `decision_brief` — Synthesis / Decision Brief (auto-generated at PDF time, §2.10)

#### 2.4.2 Persona Prompt Construction

The full prompt for each persona call is assembled from these layers:

**Layer 1 — Persona System Prompt**  
Hard-coded per persona in `lib/personas.ts`. Each prompt specifies:
- Role identity and voice
- What to look for in this specific decision
- What NOT to do (no generic wisdom, no obvious statements)
- Format constraints (section headers, bullet style, length target)

**Layer 2 — Decision Context Block**  
Assembled by `buildCouncilContext()` in `lib/council-context.ts`:
```
DECISION: <decrypted decision_text>
CONTEXT: <decrypted context_text, if any>
```

**Layer 3 — Ontology Synthesis Directive**  
Generated by `buildSynthesisDirective()` in `lib/bias-scorer.ts`. Based on the session's `ontology_vector` and `rule_engine_result`:
- If rule mode is REDIRECT/GATE: mandatory framing instruction injected
- If specific rules fire (e.g. R5 False Urgency): persona-specific behavioural instruction
- If personal bias triggers exist for this user: `MANDATORY: [bias name] has historically cost you in [condition]. Watch for it here.`

**Layer 4 — Structural Match Context** (if prior sessions exist)  
From `lib/structural-retrieval.ts`: top-N structurally similar past decisions with cosine similarity scores, injected as `PRIOR DECISION CONTEXT:` block. A conditional structural-citation sentence ("Structurally, this decision...") is appended after each eligible persona's mandate — but only for the 5 personas in `PERSONAS_WITH_STRUCTURAL_CONTEXT`, and only on first-round calls (`messages.length === 0`, i.e. not on pushback/continuity turns). **Sprint R6:** this closing sentence is now wrapped in `<structural>...</structural>` — matching the `<lens>`/`<position>`/`<realcost>`/`<lean>` header-tag convention (see the tag-stripping note in §2.14). Before R6 it streamed in as unparsed prose, and the *only* visible signal that structural retrieval had fired at all was one hardcoded banner permanently pinned to the Pattern Analyst card — disconnected from whether Pattern Analyst, or any of the other 4 eligible personas, had actually produced a citation that session. `PersonaPanel.tsx` now extracts and strips the tag per-persona and renders a citation badge only on cards whose own output actually contains one.

**Layer 5 — Bias History Context**  
From `fetchUserBiasContext()` in `lib/bias-scorer.ts`: the user's running bias profile. Only synthesis-eligible triggers (dimension + category types) are injected. Flag triggers are excluded due to ordering risk (see §3.3).

**Layer 6 — Council Weighting Directive** (`relevanceBlock`, synthesis calls only)  
Built from `computePersonaRelevance()` (full algorithm in §2.8) and injected as a `— MANDATORY — NON-NEGOTIABLE — COUNCIL WEIGHTING DIRECTIVE —` block, listing each persona's numeric weight and telling the synthesis model explicitly to lean on the higher-weighted advisors. This is also where the P1 deliberation-shift boost applies — if `leanShifts` (personas whose position moved since the previous synthesis version, §2.18) is non-empty, those personas get an additional `DELIBERATION_SHIFT_BOOST` before this block is built.

**Layer 6.5 — Institutional Benchmark Context** (Sprint 5 task 6, synthesis calls only — see §12.12)  
Additive, non-mandatory context appended after the weighting directive when the caller is an institution member, `isInstitutionalModeEnabled()` is on, and at least one dimension of the current decision has cleared that institution's K-floor (§12.6). Presented to the model as supplementary framing ("members facing similar decisions at your organisation tend to score X on dimension Y") — explicitly not phrased as a directive, and the MANDATORY weighting block above is unaffected either way. Silently omitted for non-institutional users or when no dimension has cleared the floor.

**Layer 7 — RET-5 Continuity Directive** (terminal layer — see §2.7 for full mechanics)  
If this session has a `parent_session_id` (the user chose "Reanalyze" on a prior decision), `lib/decision-continuity.ts` assembles what the Council concluded last time, what the user's own answers/pushback established, and the prior outcome if logged — then injects a `NON-NEGOTIABLE` continuation directive instructing the model to explicitly say whether any of that changes now. This is deliberately the **last** layer appended to the synthesis prompt, after Layer 6.5, so nothing downstream can dilute it.

**Layer 8 — Pushback Protocol** (`pushbackProtocol`, non-synthesis/multi-turn calls only — see §2.4.6)  
Appended instead of Layers 6–7 when the call is a pushback response (`messages.length > 0`) rather than an initial or synthesis call: a strict, format-constrained directive capping the response at ~150 words and forbidding the model from restating its earlier analysis.

**Layer 9 — Persona Alert Block** (initial persona calls only)  
Carries forward any rule-engine FLAG-mode alert text so every advisor sees it, not just the one that would otherwise reference it.

**Layer 10 — Graph Synthesis Context** (Sprint G4)  
From `lib/graph-engine.ts fetchGraphSynthesisContext()`: up to 6 connected past decisions with edge type labels (`structural_similarity`, `contradiction`, `shared_bias_trigger`). Includes a directive if ≥ 2 connections found: "Pattern Analyst's cross-history signal carries elevated weight."

**Layer 11 — User Profile, Framing Intent & Correction Carry-Forward** (Sprint SB-3 — see §2.12 for full detail)  
`buildCouncilContext()` optionally accepts `profile`, `framingIntent`, and `validationCorrection` and injects a `WHO IS BRINGING THIS DECISION` block, a framing-intent directive, and/or a `PRIOR SESSION CORRECTION` block. All three are additive and backward-compatible — omitted entirely if the user never provided a profile/framing intent or has no carried-forward correction.

> **Numbering note:** layers are listed here in construction order as they appear in `app/api/persona/route.ts`, not in a fixed historical numbering — several (6.5, 7, 8, 9) were added or repurposed after the original Layer 1–9 list was written and don't map 1:1 onto old layer numbers from earlier passes of this document. Treat "Layer N" as positional-in-this-list, not as a stable ID referenced elsewhere.

#### 2.4.3 Persona Relevance Scoring

Moved to §2.8, which now contains the full, current algorithm — the version previously here (a normalised weighted-dimension-lookup formula summing to 1 across personas) does not match the current implementation and was removed to avoid two conflicting descriptions in the same document.

#### 2.4.4 Examiner Injection Timing

The Examiner's questions are run **after** the first round of persona responses. Each persona call includes an optional `examiner_context` block if the user has already answered Examiner questions — this prevents personas from re-asking questions the Examiner already covered.

#### 2.4.5 Streaming

All persona calls stream via the Anthropic streaming API. The route sets `Transfer-Encoding: chunked` and sends SSE-style deltas. Streaming is per-call; the client fires 6 parallel persona calls and renders each independently as chunks arrive.

#### 2.4.6 Pushback Protocol (Multi-Turn)

> **Correction (this pass):** the old §2.7 described pushback as routed through a `buildDecisionContinuityContext()` function in `lib/decision-continuity.ts`. That function no longer exists anywhere in the codebase — `lib/decision-continuity.ts` was fully repurposed for RET-5 revisit continuity (§2.7). Pushback/multi-turn handling now lives entirely inline in `app/api/persona/route.ts`. Documenting the actual current mechanism below.

**How it works:**
1. The client maintains the full message thread for a given persona card locally and sends it as a `messages` array (`{ role: 'user' | 'assistant', content }[]`) on the request body when the user pushes back — this is standard Anthropic multi-turn `messages` API usage, not a custom thread-reconstruction step server-side.
2. The server detects a pushback call by `messages.length > 0` (an initial call has an empty array).
3. On a pushback call, the server appends a `pushbackProtocol` directive to the system prompt instead of the synthesis/continuity layers (Layers 6–7 in §2.4.2 are skipped entirely for pushback calls):
   - Hard caps the response at roughly 150 words.
   - Explicitly forbids restating the persona's original analysis.
   - Mandates a fixed three-part structure: acknowledge the specific challenge, hold or revise the position with one new piece of reasoning, state plainly whether the position changed.
4. The user's pushback message is saved to `messages` with `role = 'user'`, and the persona's reply with `role = 'assistant'` — both encrypted at rest, both keyed by `session_id` + `persona`.
5. `leanShifts` (§2.4.2 Layer 6, §2.8) is derived by diffing the persona's stated lean before and after a pushback exchange — this is what feeds the `DELIBERATION_SHIFT_BOOST` and the What Changed view (§2.18).

**Why this replaced the old thread-injection model:** the previous design re-sent the entire prior thread as plain injected text on every call and relied on a stripped `[User pushback to X]:` prefix for the model to infer context. The current design uses the Anthropic API's native multi-turn `messages` format directly (cleaner, no manual thread reconstruction) and adds an explicit protocol constraining *how* a persona is allowed to respond under challenge — previously a persona could ramble at full length or silently re-derive its original position; now it must commit to holding or revising within a fixed structure.

---

### 2.5 Examiner System

**Route:** `GET /api/examiner` (generate this session's question batch), `POST /api/examiner` (submit answers or skip)  
**Library:** inline in route (`lib/rule-engine.ts` for mode/gap detection)  
**Rate limit:** 40 per 10 minutes per IP

> **Correction (this pass):** the previous version of this section described a one-question-at-a-time polling loop (`GET` returns the single oldest unanswered question; repeat until `MAX_QUESTIONS = 3` is hit). That is not how the route works today — describing current behaviour below. The rewrite (internally versioned "SB-2 v2.0" in route logs) shipped **Sprint SB-2, June 26, 2026** — the same day as the ValidationCard/framing-intent work in §2.12 (Sprint SB-1).

#### 2.5.1 Question Generation (GET) — three fixed slots, generated together

Rather than one question fetched at a time, a single `GET` call generates up to 3 questions in one batch, assembled from three purpose-built slots:

| Slot | Name | Fires when | Register |
|---|---|---|---|
| 1 | **E0 — Emotional** | Always (non-REDIRECT) | Inward: surfaces the fear/identity dimension present but unsaid. Full AI generation (Anthropic), informed by self-identified `primary_fears` (§2.12 profile) and `dominant_emotion` when available. |
| 2 | **S0 (orientation) or a rule question** — mutually exclusive | S0 if `decisionWordCount < 25` (thin brief needs domain grounding first); otherwise the top-priority triggered/flagged rule from the Rule Engine (§2.3), template + AI-personalised to the decision text | S0: domain-context gathering. Rule: structural diagnostic. |
| 3 | **C0 — Context/close** | Always (non-REDIRECT) | Reflective close — "what does success look like here?" Template + AI-personalised, sharpened against confirmed longitudinal bias patterns (`biasHint`) and, since SB-2, the user's self-identified profile (`profileCtx`). |

**REDIRECT mode override:** if the Rule Engine's mode is `REDIRECT` (R1 or R7), all three slots are skipped — a single exact resolution question is generated instead and returned as the sole item, with `rule_mode: 'REDIRECT'` and the triggering `redirect_rule` in the response. The client renders this as the call-to-action inside the REDIRECT banner rather than as a normal question flow.

**R7 Resolvability Check (audit fix #3, `lib/examiner-resolvability-check.ts`):** before committing to a REDIRECT for rule **R7 specifically** ("decision needs information you don't have yet"), the route calls `checkR7Resolvable(decisionText, infoRationale)` — a single cheap AI check asking whether a genuinely useful, honest, *provisional* answer is possible today even with the information gap named openly. If `resolvable: true`, the mode is **downgraded from REDIRECT to GATE** in-place before the response is built — R7 then follows the same clarifying-question path as any other gated rule instead of fully blocking the session, with `rationale` logged (`console.log`) for traceability. This check is scoped to R7 only — R1 (the other REDIRECT-eligible rule) is unaffected and still redirects unconditionally. Net effect: most information-gap decisions now get a sharper clarifying question instead of a hard stop; only genuinely hinge-dependent cases still redirect.

**v1.0 fallback:** if the session has no ontology tagging yet (pre-dating the E0/S0/C0 system, or the tagger hasn't completed), the route falls back to gap-based generation from `examiner_gap_1/2/3` — unchanged legacy path, `rule_mode: null`.

Personalisation prompts pull in, where available: `fearProfile` (E0 only), `dominantEmotion` (E0 only), `biasHint` — confirmed longitudinal distorting patterns from `bias_library`, sharpens rule/C0 questions specifically (S0 deliberately excluded — domain-context gathering shouldn't be bias-sharpened) — and `profileCtx` (SB-2 addition, S0 + C0 only).

#### 2.5.2 Answer Submission (POST) — batch, or skip

`POST` accepts either `{ sessionId, responses: [...] }` (one row per answered question, `question_text`+`response_text` encrypted at rest) or `{ sessionId, skipped: true }`. Either path:
1. Updates `sessions_ontology.examiner_status = 'submitted'`.
2. Stamps `last_action_at` on the session — the primary activity signal the avoidance-detection cron (§8.9) relies on, deliberately distinct from `created_at` (a session submitted 60 days ago but engaged with 3 days ago is not avoidance).
3. Fires three background triggers, all non-blocking (`.catch()`-only, never awaited): `fireBiasScore()` (§2.5.3, unchanged running-average logic), `fireIndependenceScore()`, and `fireContradictions()` (calls `POST /api/mirror/contradictions`, §3.6). Skipping still fires all three — persona output + ontology tagging alone are enough signal even with no Examiner answers.

#### 2.5.3 `fireBiasScore()` — Bias Scoring Side-Effect

Sends the full decision context (decision text, context, prior persona outputs, examiner Q&A) to the bias scorer AI with a structured system prompt listing all 18 bias parameters. Returns a list of fired biases with `confidence_weight` (0–1) and `activation_context` (JSON with `urgency_present`, `counterparty_present`, free-text fields).

Updates `bias_library` rows using a **running exponential average** formula:
```
new_confidence_weight = (old_confidence_weight × (n - 1) + new_confidence_weight) / n
```
Where `n = detection_count` after increment.

---

### 2.6 Structural Retrieval & Matching

**Route:** `POST /api/structural-match`  
**Library:** `lib/structural-retrieval.ts`, `lib/similarity.ts`, `lib/graph-engine.ts`  
**Rate limit:** 30 per 10 minutes per IP

Finds structurally similar past decisions from the user's own history. Used to inject prior-decision context into persona prompts and to materialise graph edges.

#### 2.6.1 Similarity Scoring Formula

**Step 1 — Weighted cosine similarity** (`scoreVectorSimilarity()` in `lib/similarity.ts`):

```
weighted_score[dim] = score[dim] × DIM_WEIGHTS[dim]
```

`DIM_WEIGHTS` applied to the three ⭐ starred dimensions:
```
identity_alignment:   1.5
regret_asymmetry:     1.5
upstream_dependency:  1.5
all others:           1.0
```

After weighting, standard cosine similarity:
```
cosine = Σ(a[i] × b[i]) / (√Σa[i]² × √Σb[i]²)
```

**Step 2 — Confidence scaling** (personal, not cross-user):
```
confidence_adjusted = cosine × avg(confidence[dim] for all dims present)
```
Confidence is per-session (tagger's certainty signal) and is NOT applied in cross-user benchmark comparisons — only in personal structural retrieval.

**Step 3 — Total score (0–100)**:
```
total_score = confidence_adjusted × 100
```

**Threshold:** `MATCH_THRESHOLD` env var, default `45`. Sessions below this are not returned or stored as graph edges.

#### 2.6.2 Scoring Logic

`scoreStructuralSimilarity()` returns a `ScoreBreakdown`:
```typescript
{
  total: number,           // 0–100
  vector_similarity: number, // raw cosine 0–1
  top_matching_dims: string[], // top 3 dimension names by contribution
  scoring_mode: 'vector' | 'categorical'
}
```

**Categorical fallback:** if the current session has no v2.0 ontology vector (e.g. tagger hasn't run yet), the engine falls back to matching on `decision_type_primary` — a simple string equality check returning a fixed score.

#### 2.6.3 Route Flow

1. Fetches all of the user's prior sessions with v2.0 ontology vectors.
2. Scores each against the current session's vector using `scoreStructuralSimilarity()`.
3. Filters to `total ≥ MATCH_THRESHOLD`.
4. Sorts descending, returns top-N.
5. **Side-effect:** For each qualifying pair, calls `upsertStructuralEdge()` in `lib/graph-engine.ts` to materialise a graph edge. This write is fire-and-forget — never delays the scoring response.
6. Stores full matches in `structural_matches` and scores in `structural_scores` tables.

> **BUGFIX (root-caused via Sprint S2-02 diagnostic, fixed July 2026 — Sprint R3/BUGFIX in `app/api/persona/route.ts`):** `fetchCouncilContext()`'s Council-context query selected `matches_json` from `sessions_ontology` — but `matches_json` has never lived on that table; it's written here, to `structural_matches`, by this route's step 6. Including a non-existent column in the select caused the **entire** Supabase query to fail (Postgres error 42703, undefined column), so `data` came back `null` on every single call — silently, no thrown exception the route's existing error handling would catch. The practical effect: `maxStructuralScore` was always `null`, and downstream, `computePersonaRelevance()` (§2.8) always fell back to its flat 0.50 baseline for every persona, on every session, since this code shipped — the Council Weighting Strip (§3.16) that made the relevance values visible for the first time is what surfaced it. Fix: `matches_json` is now fetched via its own separate query against `structural_matches`, decrypted, and joined in-memory with the `sessions_ontology` row. The old query's error is now logged (`console.warn`) rather than silently swallowed, specifically so a future schema drift like this one surfaces immediately instead of silently degrading a scoring signal for weeks.

#### 2.6.4 Context Block Construction

The retrieved matches are assembled into a `PRIOR DECISION CONTEXT:` text block injected into persona prompts. Each match entry shows:
- Truncated decision text (80 chars)
- Score
- Top matching dimensions (human-readable)

---

### 2.7 Decision Continuity — RET-5 Revisit & the Decision Arc

**Library:** `lib/decision-continuity.ts` (fully repurposed — see correction note below)  
**Routes touching this:** `POST /api/session` (§2.1), `POST /api/persona` (§2.4.2 Layer 7), `app/record/[id]/page.tsx`, `components/ReanalyzeDrawer.tsx`, `components/SessionView.tsx`, `components/DecisionTimeline.tsx`

> **Correction (this pass):** `lib/decision-continuity.ts` previously handled pushback thread-injection (now documented in its actual current form at §2.4.6). At some point since, the file was **completely repurposed** — it has no code path left resembling the old behavior. Its current job is RET-5: letting a user reopen the *same* decision as a linked, continuous revisit rather than starting a fresh session, spanning three sprints.

#### 2.7.1 RET-5 Sprint 1 — Linked Revisit (the `parent_session_id` chain)

A session can optionally carry a `parent_session_id` pointing at the session it revisits (§2.1 validates ownership at creation). This is a **flat, single-hop link to the immediately preceding session** — not a pointer to the original root. Chains longer than two sessions (reanalyze → reanalyze again) are therefore possible and each link is correct locally (A←B, B←C), but see §2.7.3 for a real limitation this creates in how the chain renders.

**Entry point (`ReanalyzeDrawer.tsx`):** a drawer reachable from any completed session's record page, letting the user re-enter/edit the decision text, context, register mode, and pre-decision confidence, then submit. On submit, `POST /api/session` is called with `parent_session_id: session.id` (the session currently being viewed — fixed as a memoization-closure bug during this sprint; see the QC-fix comment in `SessionView.tsx` for why the dependency array mattered: without `session.id` and the framing-intent value in the callback's deps, a second reanalyze with identical field values would silently reuse a stale closure and re-link to the *original* session instead of the one actually being revisited).

**Evidence assembly (`lib/decision-continuity.ts`, current form):** given a `parent_session_id`, fetches and decrypts:
- The parent's own decision/context text.
- The parent's synthesis message (`messages` where `persona = 'synthesis'`).
- The parent's Examiner Q&A.
- Any pushback exchanges on the parent (formatted as `Pushback to ${personaLabel}: "..."` evidence lines — reusing the old prefix convention, but now purely as an internal evidence-formatting label, not a live AI-facing context-injection mechanism).
- The parent's logged outcome, if one exists (`outcomes` row).

This assembled evidence becomes the **NON-NEGOTIABLE continuation directive** injected as the terminal layer of the synthesis prompt (§2.4.2 Layer 7) — instructing the model to state explicitly whether anything changes given what's new, rather than silently re-deriving a fresh verdict as if this were the first time the decision had been brought.

#### 2.7.2 RET-5 Sprint 2 — Council Continuity in the Synthesis Prompt

Covered above — this is the Layer 7 injection itself. Worth noting explicitly: this is the **only** layer in the entire persona-prompt stack marked non-negotiable *and* positioned last, meaning nothing else in the prompt (institutional context, graph context, profile context) can dilute or override it once it's present.

#### 2.7.3 RET-5 Sprint 3 — Decision Arc Timeline

**Component:** `components/DecisionTimeline.tsx`, rendered on `app/record/[id]/page.tsx`.

A session is treated as a **chain root** iff `!session.parent_session_id && childSessions.length > 0` (i.e., it has no parent itself, and at least one session points back at it). Only chain roots render the timeline. The root's page fetches its direct children (`sessions` where `parent_session_id = root.id`) plus all outcomes across `[root, ...children]`, and builds a chronological arc: each entry shows a decision-text preview, timestamp, and outcome (if logged). Mirror-access users additionally see `avgCalibrationDelta` across the arc — how their calibration shifted from version to version. Free and ungated — the timeline itself costs nothing, unlike most Mirror-tier longitudinal features.

**Known limitation (flagged, not fixed):** the root's child query is **one level deep only** (`.eq('parent_session_id', id)`), while the underlying link (§2.7.1) allows arbitrarily long chains (A ← B ← C ← ...). For a 2-hop revisit (reanalyzed once), this is correct — the root has exactly the one child. For a 3+ hop chain (reanalyzed twice or more), the root's timeline will show only the first revisit and silently omit the second and any subsequent ones, because grandchildren never satisfy `parent_session_id = root.id`. Each individual page's parent/child *breadcrumb* links (§2.1, single-hop lookups) remain correct at every depth — it's specifically the root-anchored timeline aggregation that's shallow. Worth a recursive-CTE or `WITH RECURSIVE` fetch (or simply walking the chain in application code) before this is relied on for a genuinely multi-revisit decision.

---

### 2.8 Persona Relevance Scoring

**Library:** `lib/persona-relevance.ts`  
**Consumers:** §2.4.2 Layer 6 (synthesis directive), Council Weighting Strip (§3.16), What Changed view input (§2.18)

Computes a 0–1 relevance weight for each of the 6 personas given the current session. This is the **authoritative, current** description — earlier passes of this document (and the old §2.4.3) described a normalised weighted-dimension-lookup formula (`Σ(dim_score × weight) / Σweight`, scores summing to 1 across personas) that does not match the implementation and has been removed to avoid duplication.

**Actual model — additive boosts on a common base, independently clamped, NOT normalised to sum to 1:**

```
score[persona] = clamp(
  0.50                                          // PERSONA_BASE_SCORE, same starting point for all 6
  + Σ RULE_PERSONA_BOOSTS[rule][persona]         // for every triggered_rule / flag_rule that has a boost table entry for this persona
  + Σ DIM_PERSONA_BOOSTS[dim][persona]           // for every ontology dimension whose score clears that entry's threshold (direction: 'above' or 'below')
  + (0.10 × count of confirmed personal calibration zones     // Sprint CAL — see 2.8.1
       active for this decision AND mapped to this persona)
  + (0.15 if this persona's lean shifted since the previous   // P1 Gap #2 — see 2.8.2
       synthesis version, i.e. persona ∈ leanShifts)
  , 0.0, 1.0)
```

Each persona starts at the same `0.50` baseline; boosts are purely additive; the five inputs (rule engine result, ontology vector, structural match score, calibration zones, lean shifts) are each optional and independently omittable — a session with no structural match history and no calibration data yet still produces valid, if flatter, scores. There is no cross-persona normalisation step — it is entirely possible (and common) for the sum across all six personas to be well above or below 1.0.

**2.8.1 — Personal Calibration Zone Boost (Sprint CAL).** When the *current* decision is elevated on a dimension where *this specific user* has a confirmed personal calibration pattern (from `lib/calibration-engine.ts`), every persona already mapped to that dimension in `DIM_PERSONA_BOOSTS` gets an additional flat `CALIBRATION_ZONE_BOOST = 0.10`. Deliberately smaller than a primary rule/dimension boost (those range roughly 0.10–0.30) — this *refines* an existing signal rather than introducing a new one. Explicit KDD in the source: rule-engine thresholds themselves (`lib/rule-engine.ts`) are never personalised by this — personalisation stays confined to relevance weighting and the synthesis context block, not to whether a rule fires at all.

**2.8.2 — Deliberation-Shift Boost (P1 Gap #2 fix).** A persona whose stated lean genuinely changed between the previous synthesis version and this one (`leanShifts`, diffed by `lib/synthesis-diff.ts`, §2.18) gets a flat `DELIBERATION_SHIFT_BOOST = 0.15` — deliberately not scaled by "how far" the lean moved, since proceed/wait/mixed isn't an ordinal scale with a principled distance metric. Rationale: a persona that visibly changed its mind under challenge has just demonstrated its position isn't fixed, which is itself evidence worth weighing more heavily. This is also the fix for a real bug: before `leanShifts` existed as an input, every other input to this function was fixed at session-creation time, meaning re-running relevance scoring on every re-synthesis during a session always returned identical numbers — nothing ever moved, regardless of how the deliberation actually evolved.

**Output shape:** `PersonaRelevanceMap` (`{ [personaKey]: number 0–1 }`), plus `explainPersonaWeights()` which produces a parallel `{ [personaKey]: string[] }` of short human-readable reasons (e.g. "high stakes + irreversible", "your confirmed overconfidence zone") — this reasons map is what powers the "why" tooltips on the Council Weighting Strip, exposed via a separate response header (below).

**Response headers (`app/api/persona/route.ts`, synthesis call only):**
- `X-Persona-Relevance` — JSON-stringified `PersonaRelevanceMap`.
- `X-Persona-Relevance-Reasons` — `encodeURIComponent(JSON.stringify(...))` of the reasons map (Sprint 1 follow-on to the header above; same delivery pattern, added later).
- `X-Worth-Confirming` — see §2.17; delivered via the identical safety/encoding pattern as the reasons header, unrelated data, same mechanism reused.

> **Bug history (kept for context):** this scoring was silently broken — flat `0.50` for every persona, on every session, effectively disabling every boost above — from initial ship until Sprint R3/BUGFIX, July 2026 (root cause: `matches_json` selected from the wrong table in `fetchCouncilContext()`; full account in §2.6.3). The Council Weighting Strip (§3.16), which was the first surface to expose these numbers visibly, is what made the flat baseline noticeable enough to investigate. Confirmed working as of this pass, and now considerably more sophisticated than what it was originally shipped as — Sprint CAL and the P1 lean-shift boost were both built on top of the fixed version.

---

### 2.9 Outcome Recording

**Route:** `POST /api/outcome`, `GET /api/outcome`

When the user eventually records what happened, the outcome is stored and used to close the decision loop.

**Outcome fields:**
- `outcome_quality` — one of: `better_than_expected | as_expected | worse_than_expected | too_early`
- `what_decided` — encrypted free text: what the user actually chose
- `notes` — encrypted free text: reflections
- `commitment_review_date` — date the user committed to reviewing (drives Monthly Review open loops)
- `rule_recall_choice` — `applied | ignored | not_relevant`: did the user apply the rule engine's advice?

**Outcome's role in the Mirror:**
- `worse_than_expected` outcomes are what the Bias Trigger Engine (§3.3) uses to identify when a bias is genuinely costly (not just present)
- `loops_closed` in Monthly Review counts sessions with any outcome row (any quality except `too_early`)
- `confirmation_patterns` (bias_library `detection_count ≥ 3`) + `worse_than_expected` outcomes drive the Mirror Fingerprint tier upgrades

---

### 2.10 Decision Brief PDF

**Route:** `GET /api/record/[id]/brief?theme=dark|light`  
**Library:** jsPDF (dynamic import), `lib/ai-client.ts`

Generates a premium PDF of the full decision council session. Available free to all users.

#### 2.10.1 Auto-Generation Logic

If a `decision_brief` message does not yet exist in `messages` for this session:
1. Gathers all persona `assistant` messages in canonical APPENDIX_ORDER.
2. Assembles a `COUNCIL ANALYSIS:` block.
3. Sends to DeepSeek (cost-optimised) with the `DECISION_BRIEF` system prompt requesting a structured executive synthesis.
4. Saves the generated brief as an encrypted message (`persona = 'decision_brief'`, `role = 'assistant'`).
5. Uses the in-memory plaintext for this PDF render (no second DB round-trip).

#### 2.10.2 PDF Structure

Dark (default) and Light themes, both rendered with jsPDF:

- **Cover page:** Session ID (partial), creation date, decision text excerpt
- **Section per persona:** Per-persona colour accent band, persona label, full response text with markdown rendering (bold, italic, bullets, numbered lists, headings, horizontal rules all parsed)
- **Examiner Section:** Q&A pairs in chronological order
- **Decision Brief:** Executive synthesis (auto-generated if absent)
- **Typography:** Helvetica; markdown → jsPDF instructions via custom renderer

**Unicode sanitiser:** All text is passed through `sanitise()` before rendering — converts `₹` → `Rs.`, smart quotes → ASCII quotes, em-dashes → hyphens, etc. jsPDF uses Latin-1 encoding; anything outside it renders as garbage.

---

### 2.11 Session History & Labels

**Route:** `POST /api/history`

> **Correction (this pass):** the previous version of this section described a `GET` route returning a generated `session_label` via a `buildSessionLabel()` helper. That function does not exist anywhere in the codebase, and the route is `POST`, not `GET`. This was a spec/implementation mismatch that predates the sprints covered in this update — corrected here for accuracy, not attributed to any recent sprint.

Two query paths, merged and deduplicated: (1) by `ids[]` from the request body — session IDs stored in the caller's `localStorage`, works pre-auth; (2) by `user_id` resolved from the Bearer token, capped at 500 sessions (raised from 100 in Sprint 21 — the route was diverging from the Mirror's own count). This means a first-time visitor sees only their device's sessions, a logged-in user on the same device sees device + cross-device sessions, and a logged-in user on a new device sees their full history even with empty `localStorage`.

**Returns:** `{ sessions: [...] }` — each row is `{ id, decision_text (decrypted, full length, no truncation), created_at, outcome: { what_decided (decrypted), council_helped } | null }`. No `session_label`, no `validation_state`, no `status` field is returned by this route today — list-view titling is done client-side from the raw `decision_text`.

`lib/session-labels.ts` exists but is unrelated to history-list titling — see §2.16 below; it's a shared plain-English label map (ontology dimensions, decision types, reversibility, framing intent) used by `OntologyRevealCard`, `SessionCompleteBadge`, and the Decision Profile Strip.

---

### 2.12 User Profile, Framing Intent & Correction Carry-Forward (SB-1 / SB-3 / S2-05)

Three related additions that all feed the same destination: richer, more personal context injected into every persona's system prompt via `buildCouncilContext()` in `lib/rule-engine.ts`.

**(1) Framing intent (Sprint SB-1).** Captured at session creation (`POST /api/session`) as one of `'challenge' | 'clarify' | 'right'`, stored on `sessions.framing_intent` (null if not provided or not one of the three values). Signals what the user explicitly wants from the Council:
- `'right'` — the user wants to know what is objectively right, not what they want to hear. Directive: name any divergence between the better option and what the user appears to want, directly — don't soften it into "considerations to weigh."
- `'clarify'` — the user wants help understanding what they want, not just what's analytically correct. Directive: weight values/identity/relational dimensions heavily; Elder and Stakeholder Mirror become primary.
- `'challenge'` — the user wants structural challenge. Directive: prioritise stress-testing over validation.

**(2) User profile (Sprint SB-1 capture / SB-3 injection).** `components/ProfileCaptureOverlay.tsx` — an optional, dismissible overlay on the home page and Mirror page — lets a user self-identify: `archetype`, `primary_fears[]`, `mbti_type` (validated against the 16 real MBTI codes client-side), `life_stage`, `risk_stance`. Saved via `POST /api/profile` to `user_profiles`. All fields optional and independently settable; the overlay only shows if at least one is still unset. At persona-call time, `fetchCouncilContext()` in `app/api/persona/route.ts` reads this row (when `userId` is resolvable) and passes it into `buildCouncilContext()`, which injects a `WHO IS BRINGING THIS DECISION` block instructing personas to calibrate angle/emphasis/register from it — explicitly told not to repeat the labels verbatim in their response. Used most directly by Elder (life stage), Risk Architect (fears), Contrarian (MBTI), Pattern Analyst (fears).

**(3) Correction carry-forward (Sprint S2-05).** When a user corrects Quorum's emotional/archetype read via the ValidationCard (see §3.15), the correction text is stored on the session as `validation_correction`. If that session is later revisited (linked via `parent_session_id`), `POST /api/session` copies it forward onto the new session's `validation_correction_carry` column (the current session's own `validation_correction` doesn't exist yet at persona-call time — it's only set after synthesis + validation of *this* session). `fetchCouncilContext()` reads `validation_correction_carry` and injects a `PRIOR SESSION CORRECTION` block asking personas to check whether the same dynamic is present in this decision, and to name it explicitly rather than leaving it as a structural inference. This is the closed learning loop: a disagreement in session N shapes session N+1's Council context.

All three blocks are optional/additive — `buildCouncilContext()`'s new parameters (`profile`, `framingIntent`, `validationCorrection`) are backward compatible; omitting them produces the original output.

---

### 2.13 Post-Decision Confidence Capture (S2-01)

**Route:** `PATCH /api/session/[id]/confidence`  
**Body:** `{ post_decision_confidence: number (1–10), user_email?, device_id? }`

Captures a post-synthesis confidence re-rate via a lightweight widget shown after the Council responds — the counterpart to `pre_decision_confidence` (captured at session start, see §2.1), enabling before/after confidence-delta analysis per session. Ownership resolved via Bearer token first, then falls back to `user_email`/`device_id` matching against the session row (same three-tier identity precedence used throughout: `user_id` > `user_email` > `device_id`). **Idempotent by design, not just convention:** if `post_decision_confidence` is already set on the row, the route returns `{ ok: true, skipped: true }` without overwriting — a rating, once given, is not editable via this endpoint.

---

### 2.14 Council Verdict & Tension Highlight (S1-03)

A structured extraction layer on top of the synthesis stream, parsed live in `components/SynthesisCard.tsx` as tokens arrive.

**`<verdict>...</verdict>`** — the synthesis model's headline recommendation, written as a single sentence (client truncates to the first complete sentence as a defensive guard against the model writing more than one). Extracted out of the prose entirely and rendered in its own gold-accented box above the synthesis body, both on the live session view and in the Decision Brief PDF (`app/api/record/[id]/brief/route.ts` — theme-aware palette: `verdictBg`/`verdictAccent` per light/dark theme).

**`<tension>...</tension>`** — a single sentence naming the central tension the synthesis is resolving. Unlike `<verdict>`, the tagged content **stays inline** in the prose — only the tags themselves are stripped — and is rendered with a highlighted background (`--tension-highlight-bg` / `--tension-highlight-border` theme variables) rather than being pulled into a separate box. Same treatment in the PDF export (`tensionHighlightBg` palette entry).

**Streaming parser (`SynthesisCard.tsx`):** a small state machine (`parseModeRef`: `'prose' | 'verdict' | 'tension'`) scans the accumulating raw stream for `<verdict>`/`<tension>` open tags, buffers into `verdictAccRef`/`tensionAccRef` until the matching close tag, and updates `verdictText`/`tensionText` state as they complete — so the verdict box and tension highlight both populate progressively during streaming, not just after the stream ends.

**Downstream tag-stripping:** every surface that displays synthesis text elsewhere (Decision-Maker Observation generation in §2.15, Reanalyze drawer's synthesis-summary in §2.15, the Decision Brief PDF) strips `<verdict>`/`<tension>` (and the older `<lens>`/`<position>`/`<realcost>`/`<lean>` header-tag family) before use — this machine-readable-tag family has been a recurring source of leakage/malformed-output bugs each time a new tag is introduced (`<lean>`/`<wait>` leaking into persona card text was one prior incident), and each new consuming surface needs its own strip pass; there is no single shared sanitiser function today.

**Related: pre-synthesis tension interstitial.** `components/TensionInterstitial.tsx` (rendered while synthesis is in flight, gating its start until the interstitial's own timed progress bar completes) reads the `<lean>` values already captured per-persona (`'proceed' | 'wait'`) and shows a short headline — "N leans toward proceeding, M toward waiting" if there's a genuine split, "The Council largely agrees" otherwise, or a neutral "The Council has finished" if too few personas produced a valid lean to say anything specific. This is a distinct mechanism from the verdict/tension tags above: the interstitial summarises *pre*-synthesis lean signal; `<verdict>`/`<tension>` are pulled from the synthesis output itself.

---

### 2.15 Session-End Enrichment Surfaces

Three read-only, best-effort routes that surface data the Council/Examiner/bias scorer already computed for this exact session — none of them run a new AI detection pass purely to populate a UI element:

- **`GET /api/session/[id]/bias-note`** — the single strongest *distorting* bias detected for this session specifically (not a cross-session pattern), read from `bias_library.activation_contexts[sessionId]`, filtered to `signal_type === 'distorting'` and ranked by `prosecutor_score`. Handles both identified sessions (`user_id`/`user_email`/`device_id` precedence) and anonymous sessions (via the synthetic `anon:<sessionId>` device key written by the bias-score route). Returns `{ biasNote: { label, reasoning } | null }`, reasoning truncated to 220 chars on a word boundary. Powers `components/BiasNoteCard.tsx`.

- **`POST /api/session/[id]/observation` (Sprint O3)** — auto-surfaces the Decision Brief's "Decision-Maker Observation" line (the closing, second-person, "how you make decisions" sentence — see `DECISION_BRIEF` prompt in §2.10) directly below the synthesis card for Mirror subscribers, without requiring them to click "Generate Decision Brief" first. Gated on `getMirrorAccessState() === 'unlocked'` — locked/teaser users get `{ observation: null }` and the client renders nothing (SynthesisCard already carries the Mirror upsell elsewhere). On first call: reads the earliest assistant message per persona plus the synthesis message, strips header/synthesis tags, and sends it to a dedicated lightweight prompt (`DECISION_OBSERVATION_PROMPT` in `lib/personas.ts` — the same register/constraints as the Decision Brief's observation section, extracted as its own standalone call so it can fire automatically). Result is cached on `sessions.decision_observation`; subsequent calls (repeat page loads) return the cached value with no re-generation and no re-billing.

- **`GET /api/session/[id]/synthesis-summary` (Sprint S2-08)** — returns this session's tag-stripped synthesis text in full, for the Reanalyze drawer (`components/ReanalyzeDrawer.tsx`), so a user reanalyzing a past decision can recall what the Council originally concluded before deciding what to change. Returns the complete cleaned text; the client renders a short preview with a "Show more" toggle rather than truncating server-side with no way back.

---

### 2.16 Onboarding & Guided Tours (Sprint TOUR-1)

`components/OnboardingTour.tsx` (home page) and `components/RecordTour.tsx` (record page) — lightweight, dismissible, step-based walkthrough overlays; a third tour ("council tour") is defined inline in `components/SessionView.tsx`.

- **Home tour:** fires once after the input form is revealed; auto-advances from the QUORUM intro panel into the input-field reveal after a fixed 1800ms delay rather than waiting for a click, then proceeds step-by-step from there.
- **Council tour:** fires once, after synthesis completes on a user's first session.
- **Record tour:** wraps the record page as a client component (`RecordTour.tsx`), consistent with the Server Component constraint noted elsewhere in this spec (page-level data fetching stays server-side; the tour overlay itself is client-only).
- Each tour has its own dismissal/seen-state flag so a user who dismisses the home tour still sees the record and council tours on their respective first visits, and vice versa.

---

### 2.17 Worth Confirming (Sprint 1 follow-on — merged Features #1 + #6)

**Library:** `lib/worth-confirming.ts` (92 lines)  
**Consumer:** `components/SynthesisCard.tsx`, via `X-Worth-Confirming` response header (§2.8)  
**Called from:** `app/api/persona/route.ts`, synthesis call only, via `getWorthConfirmingText()`

Produces a single sentence naming the highest-value unknown or the input the synthesis verdict is most sensitive to — surfaced as one quiet closing line on the synthesis card, distinct from the verdict and the named tension (§2.14).

**Selection logic (candidates evaluated in priority order, first match wins):**
1. **Unresolved Examiner gap** — if any of `examiner_gap_1/2/3` was never answered (skipped or session ended before reaching it), and that gap's text is substantive (not a boilerplate placeholder), it becomes the candidate: "You haven't confirmed [gap text] — the verdict above assumes an answer here."
2. **Low-confidence ontology dimension driving the verdict** — if a dimension with `confidence < threshold` (tagger's own uncertainty signal, §2.2) is also one of the top-weighted dimensions feeding the winning persona's relevance score (§2.8), it becomes the candidate: naming that specific dimension as the shakiest input to an otherwise confident-sounding verdict.
3. **No candidate found** — returns `null`/empty; the header is simply omitted and `SynthesisCard.tsx` renders nothing for this slot. Deliberately no manufactured caveat — a clean, well-evidenced session shows no "worth confirming" line at all rather than a forced hedge.

**Delivery mechanism:** identical `encodeURIComponent(...)` header pattern as `X-Persona-Relevance-Reasons` (§2.8), added to the response only when a candidate exists (`worthConfirmingForHeader` is conditionally spread into the headers object, not sent as an empty string).

---

### 2.18 Synthesis Versioning & the "What Changed" View (P1)

**Library:** `lib/synthesis-diff.ts` (174 lines)  
**Table:** `synthesis_versions`  
**Route:** `app/api/session/[id]/synthesis-version/route.ts`  
**Component:** `components/WhatChangedDrawer.tsx`

Every time a session's synthesis is (re-)generated — including the very first time — a snapshot is written to `synthesis_versions`: `{ session_id, version_number, verdict, tension, persona_leans: { [personaKey]: 'proceed' | 'wait' | 'mixed' }, persona_relevance: PersonaRelevanceMap, created_at }`. `version_number` auto-increments per `session_id`.

**`diffSynthesisVersions(previous, current)`** (the actual comparison, run client-triggered when the drawer is opened, not on every synthesis):
- **`verdictShift`** — `'held' | 'flipped' | 'mixed'`, comparing the top-line verdict direction between the two versions.
- **`leanShifts`** — `{ [personaKey]: { from, to } }` for every persona whose `persona_leans` entry differs between versions. This is the exact object threaded back into `computePersonaRelevance()` as the `leanShifts` argument (§2.8.2) and into the Layer 6 weighting directive (§2.4.2) — the diffing logic and the relevance-boost consumer share one canonical shape, computed once.
- **`relevanceDeltas`** — per-persona numeric delta in relevance weight between versions, signed, for the "gained/lost weight" bars in the drawer.

**Gating:** `WhatChangedDrawer.tsx` only renders when `synthesis_versions` has ≥ 2 rows for the session — a first-pass, never-reanalyzed decision shows no trace of this feature at all. This is distinct from, but commonly co-occurs with, an RET-5 revisit (§2.7): a pushback-triggered re-synthesis *within* the same session also writes a new `synthesis_versions` row, so "What Changed" can legitimately fire even without a full session-level reanalyze, as long as the synthesis itself was regenerated more than once.

---

## 3. Mirror Layer

The Mirror is the longitudinal intelligence layer — it compiles a user's judgment history into a personalised profile of patterns, biases, calibration accuracy, and decision consistency.

### 3.1 Mirror Access Gating

**Library:** `lib/mirror-access.ts`, `lib/mirror-tier-config.ts`

Single source of truth: `getMirrorAccessState(userId, supabase)` returns one of:
- `'unlocked'` — full Mirror access
- `'teaser'` — limited preview (user has ≥ 3 sessions but no active subscription)
- `'locked'` — fewer than 3 sessions (no preview)

**Access resolution waterfall:**
1. Check `mirror_access` table for a row matching `user_id`
2. If `access_type = 'advisory'` → `unlocked` (never expires)
3. If `access_type = 'lifetime'` → `unlocked` (legacy, retired but honoured)
4. If `access_type = 'annual'` or `'monthly'` → `unlocked` only if `expires_at > NOW()`; else fall through
5. No valid row → count user sessions: `≥ TEASER_THRESHOLD (3)` → `teaser`; else → `locked`

**Tier distinction (`getMirrorTier()`):**
- `'advisory'` — access_type === 'advisory'; gets Benchmark, full Contradiction detail, SRI prescriptive next-move, bypassed session-count thresholds
- `'mirror'` — all other subscriptions

**Session-count thresholds** (bypassed for advisory tier):
- Decision Rules: `RULES_SESSION_THRESHOLD` env var, default `8`
- Pattern Store: `PATTERNS_SESSION_THRESHOLD` env var, default `3`
- Contradiction Detector: `MIN_SESSIONS` env var, default `5`

---

### 3.2 Bias Scoring System

**Library:** `lib/bias-scorer.ts`  
**Route:** `POST /api/bias-score`

#### 3.2.1 The 18 Bias Parameters

| Key | Label |
|---|---|
| `fomo_urgency` | FOMO / False Urgency |
| `overconfidence` | Overconfidence Bias |
| `speed_bias` | Speed Bias |
| `loss_aversion_reversal` | Loss Aversion Reversal |
| `exit_optionality_mispricing` | Exit Optionality Mispricing |
| `recency_bias` | Recency Bias |
| `social_proof` | Social Proof Reliance |
| `uniqueness_fallacy` | Uniqueness Fallacy |
| `narrative_capture` | Narrative Capture |
| `authority_deference` | Authority Deference |
| `present_bias` | Present Bias |
| `false_consensus` | False Consensus |
| `sunk_cost` | Sunk Cost Fallacy |
| `planning_fallacy` | Planning Fallacy |
| `availability_heuristic` | Availability Heuristic |
| `anchoring` | Anchoring Bias |
| `confirmation_bias` | Confirmation Bias |
| `status_quo_bias` | Status Quo Bias |

#### 3.2.2 `classifyBiasSignal()` — Structural Bias Detection

Called synchronously in persona synthesis. For each of the 18 biases, applies a deterministic rule against the ontology vector (not an AI call). Returns a `BiasSignal` with:
- `detected: boolean`
- `confidence_weight: 0–1` (rule-based, not learned)
- `reason: string`

These structural classifications are **universal** (same rules for everyone) and separate from the personal, outcome-derived triggers computed by the Bias Trigger Engine.

#### 3.2.3 `fireBiasScore()` — AI Bias Detection

AI call (Anthropic, hard-pinned). Sends decision context + all 18 bias definitions + persona outputs to Claude. Returns an array of fired biases, each with:
- `bias_parameter` key
- `confidence_weight` (0–1)
- `activation_context` — `{ urgency_present: boolean, counterparty_present: boolean, decision_type: string, emotional_signature: string }`

**`bias_library` update (running average formula):**

For each fired bias, upserts into `bias_library` (keyed by `user_id | user_email | device_id`):

```
detection_count += 1
new_confidence_weight = (old_confidence_weight × (n-1) + new_weight) / n
```

Where `n` = `detection_count` after increment. This gives equal weight to all observations (simple running average), not an exponential decay.

Also: appends the current `session_id` to `session_ids[]` array and merges `activation_context` into the `activation_contexts` JSON map keyed by session_id.

#### 3.2.4 Synthesis Directive Injection

`buildSynthesisDirective()` is called by the persona route before building each persona's prompt. It:
1. Fetches the user's `bias_library` rows from DB
2. Calls `computePersonalBiasTriggers()` (see §3.3) to get synthesis-eligible triggers
3. For each trigger where the current session's context matches the trigger condition, prepends a `MANDATORY:` directive to the persona system prompt
4. The directive specifies the bias name, the trigger condition, and the instruction to surface it

---

### 3.3 Bias Trigger Engine

**Library:** `lib/bias-trigger-engine.ts`

Moves beyond "this bias fires frequently" to "this bias costs this specific user under this specific condition." Computed from the user's own outcome history.

**Constants:**
```
HIGH_THRESHOLD = 4    (dim score ≥ 4 = "high")
LOW_THRESHOLD  = 2    (dim score ≤ 2 = "low")
MIN_BUCKET_SIZE = 3   (each bucket needs ≥ 3 outcome-logged firings)
MIN_GAP = 0.4         (bad-outcome rate difference ≥ 0.40 to count as signal)
MAX_EVIDENCE_PER_TRIGGER = 2
MAX_TRIGGERS_RETURNED = 4  (global cap across ALL biases and trigger types)
```

#### 3.3.1 Four Trigger Types

**Type 1 — DIMENSION triggers** (Phase 1)

For each bias, for each of the 14 ontology dimensions:
1. Split firing sessions (where this bias was detected + outcome logged) into:
   - `HIGH` bucket: `dim.score ≥ 4`
   - `LOW` bucket: `dim.score ≤ 2`
2. Compute `bad_rate = count(worse_than_expected) / bucket_size` for each
3. `gap = bad_rate_high - bad_rate_low`
4. If `gap ≥ MIN_GAP` and both buckets have `≥ MIN_BUCKET_SIZE` firing sessions → trigger found
5. Keep the single best-gap dimension per bias

**Type 2 — FLAG triggers** (Phase 2a)

Same mechanism but binary split on `activation_context` boolean fields:
- `urgency_present`: true (HIGH) vs false (LOW)
- `counterparty_present`: true (HIGH) vs false (LOW)

⚠️ **FLAG triggers are NOT synthesis-eligible.** They are mirror-UI-only. Reason: `activation_context` is written by `fireBiasScore()` as a fire-and-forget background call — there is no guaranteed ordering between it completing and synthesis running for the same session. Gating a MANDATORY synthesis directive on a value that may not exist yet would cause silent intermittent misses.

**Type 3 — CATEGORY triggers** (Phase 2b)

Buckets against canonical categorical fields from `sessions_ontology` (NOT bias-score's free-text activation_context — those are LLM-generated strings with no fixed taxonomy):
- `decision_type_primary` (7 values)
- `dominant_emotion` (6 values)

One-vs-rest bucketing: for each candidate value, HIGH = firing sessions where field equals that value; LOW = all other firing sessions pooled.

CATEGORY triggers **are synthesis-eligible** (fields exist on `sessions_ontology`, written by the tagger before synthesis runs — no ordering risk).

**Type 4 — Per-bias independence**: best-of-each, not best-of-all. A bias can have up to 4 triggers simultaneously (one per type). Global `MAX_TRIGGERS_RETURNED = 4` caps the final list sorted by gap descending.

#### 3.3.2 Synthesis Eligibility

`isSynthesisEligibleTrigger(t)` returns `true` for DIMENSION and CATEGORY triggers only. Used by `fetchUserBiasContext()` to filter what gets injected into synthesis prompts.

---

### 3.4 Mirror Fingerprint

**Library:** `lib/mirror-fingerprint.ts`  
**Route:** `GET /api/mirror/fingerprint`

Assembles the full Mirror Fingerprint — the primary visualisation in the Mirror UI showing a user's confirmed bias patterns, their trigger conditions, and calibration zones.

**`buildFingerprint()` logic:**
1. Fetches all `bias_library` rows for the user
2. For each bias with `detection_count ≥ 1`, builds a `FingerprintBias` entry
3. Calls `computePersonalBiasTriggers()` to get ALL trigger types (including FLAG triggers, unlike synthesis path)
4. Merges triggers onto their parent bias entries
5. Calls calibration engine (§3.5) for calibration zones per dimension
6. Returns structured `BiasFingerprint` object

**Fingerprint structure:**
```typescript
{
  biases: FingerprintBias[],    // confirmed + forming patterns
  calibrationZones: Zone[],     // per-dimension over/under-confidence
  summary: string,              // AI-generated summary paragraph
  sessionCount: number,
  gateState: 'unlocked' | 'teaser' | 'locked'
}
```

**Confirmed vs forming patterns:**
- `detection_count ≥ 3` → "confirmed pattern"
- `detection_count 1–2` → "forming pattern"

---

### 3.5 Calibration Engine

**Library:** `lib/calibration-engine.ts`  
**Route:** `GET /api/mirror/calibration`

Compares decision-time confidence scores (from the ontology tagger) against eventual outcomes, per ontology dimension, to detect systematic over- or under-confidence.

**Calibration Zone formula per dimension:**

For each completed session with an outcome (`not too_early`):
1. Take the dimension `score` (1–5) from `ontology_vector` as the confidence proxy
2. Encode outcome: `better_than_expected = +1`, `as_expected = 0`, `worse_than_expected = -1`
3. Compute `calibration_error = score_normalised - outcome_valence`
   - Score normalised to 0–1: `(score - 1) / 4`
   - Outcome valence is binary: `positive = 1`, `negative = 0`

**Zone classification:**
```
mean_calibration_error > +0.2  → 'overconfident' (rated too highly, outcome worse)
mean_calibration_error < -0.2  → 'underconfident' (rated too cautiously, outcome better)
else                           → 'calibrated'
```

**Minimum sessions:** 3 sessions with outcomes required per dimension before a zone is reported. Below threshold: dimension shows `'insufficient_data'`.

**`calibration_direction`** (used by ValidationCard §3.15):
- Aggregate across all dimensions: if majority show `overconfident` → `'over'`; if majority `underconfident` → `'under'`; else `null`

---

### 3.6 Contradiction Detector

**Library:** `lib/contradiction-detector.ts`  
**Route:** `GET/POST/DELETE /api/mirror/contradictions`

Detects when a user's stated reasoning in one decision contradicts their stated reasoning in another.

#### 3.6.1 Detection Pipeline (POST)

**Trigger:** Called from `/api/examiner` after each answer submission (fire-and-forget background call via `POST /api/mirror/contradictions` with `sessionId`).

**Gate conditions (all must pass):**
1. `user_id` resolvable from session
2. `≥ MIN_SESSIONS (5)` sessions with examiner evidence
3. Last run was `> RERUN_DAYS_THRESHOLD (7)` days ago, or `force = true`

**Evidence assembly:**
- Fetches last 30 sessions (chronological order) for the user
- Per session: collects `examiner_responses` (Q+A pairs, decrypted) and `messages` where `role = 'user'` (pushback messages, decrypted)
- Filters out sessions with no evidence (< 15 chars in any answer)
- Builds `SessionEvidence[]`: `{ sessionId, decisionText, createdAt, responses[] }`

**AI call** (`detectContradictions()` in `lib/contradiction-detector.ts`):
- Sends full evidence corpus to Claude
- System prompt asks: "Find cases where the user stated a principle in one decision and then appears to violate that principle in another"
- Returns `ContradictionResult[]`: `{ principleText, principleSessionId, violationText, violationSessionId, severity: 'low|medium|high', category: 'process|values|risk|timing' }`

**DB upsert:**
- Upserts into `contradictions` table with `onConflict: 'user_id,principle_session_id,violation_session_id'`
- Soft-dismissal via `dismissed_at` (DELETE route sets this)
- Records run in `contradiction_runs` table (one row per user, upserted)

#### 3.6.2 GET — Return Active Contradictions

Returns non-dismissed contradictions + decision text snippets (decrypted, 80 chars) for each referenced session. Also returns `{ sessionCount, meetsThreshold, lastRanAt, dismissedCount }`.

#### 3.6.3 Advisory Tier

Advisory tier users see "full detail" — the exact principle and violation text. Standard subscribers see only the categorical summary.

---

### 3.7 Avoidance Detector

**Library:** `lib/avoidance-detector.ts`  
**Route:** `GET /api/cron/avoidance-detect` (cron), `GET /api/mirror/avoidance/dismiss` (dismiss)

Detects when a user repeatedly brings the same type of decision to Quorum but never records an outcome — a signal of decision avoidance.

**Detection logic:**
1. Groups user sessions by `decision_type_primary`
2. For each type with `≥ 3` sessions and `0` outcomes: flags as avoidance pattern
3. Also checks temporal clustering: `≥ 3` sessions on the same general topic within 14 days with no outcome = time-pressure avoidance
4. Writes alerts to `avoidance_alerts` table

**Avoidance types detected:**
- `category_loop` — same decision_type_primary, no resolution
- `time_cluster` — rapid repeated similar decisions without closure
- `outcome_gap` — sessions ≥ 30 days old with no outcome filed

---

### 3.8 Independence Score

**Library:** `lib/independence-score.ts`  
**Route:** `GET /api/mirror/independence`

Measures how independently the user reasons — do they capitulate to AI advisor pressure or maintain their own analysis?

**Score components (0–100 total, weighted sum):**

| Sub-score | Weight | What it measures |
|---|---|---|
| `pushback_rate` | 25% | % of sessions where user submitted ≥1 pushback message |
| `examiner_depth` | 25% | Average length/substance of examiner responses |
| `outcome_closure` | 20% | % of decisions eventually given an outcome |
| `multi_session_diversity` | 15% | Decision type diversity across sessions |
| `revision_rate` | 15% | % of sessions where user changed stated position after pushback |

**Formula:**
```
independence_score = Σ(sub_score[i] × weight[i])
```

Each sub-score is normalised 0–100 before weighting.

**Delta calculation:**
```
score_delta = current_score - previous_score
```
Stored in `independence_score_log` (one row per computation, timestamped). The latest two rows provide the delta for the "since last visit" line in Mirror Summary.

**`actionPlan` string:** The sub-score with the lowest value has an associated prescriptive suggestion string (e.g. "Record outcomes for 2 more past decisions to improve your Loop Closure score"). This is the `nextAction` field in Mirror Summary.

---

### 3.9 Session Reliability Score (SRI)

**Library:** `lib/session-score.ts`  
**Route:** `GET /api/mirror/session-score`

> **Correction (this pass):** the previous version of this section described a single weighted formula (`examiner_engagement × 0.3 + persona_diversity × 0.25 + ...`). That formula does not appear anywhere in the current file. Describing the actual current model below — four independent sub-scores feeding a targeted action-plan generator, not one composite reliability number.

**Four sub-scores, computed per session, each 0–100:**

| Sub-score | Source | Logic |
|---|---|---|
| `structural` | `structural_matches.matches_json` for this session | Max `structural_score` achieved across this session's matches. `50` + `hasData: false` if no matches exist yet (explicit flag — see BUGFIX below for why this can't be inferred from the score alone). |
| `biasClarity` | `bias_library.activation_contexts[sessionId]` | `80` (neutral-good) if no bias fired for this session, or fired but not `signal_type === 'distorting'`. Otherwise penalised: `100 − (distortingCount × maxAsymmetryScore × 12)`, floored at 0. |
| `councilConfidence` | `sessions_ontology.rule_engine_result` (deterministic, no AI call) | `OPEN`/0 flags → 90 · `OPEN`/1–2 flags → 75 · `OPEN`/3+ flags → 60 · `GATE` → 50 · `REDIRECT` → 35 |
| `calibration` | `outcomes.calibration_delta` (`retrospective_confidence − pre_decision_confidence`) | `70` if no outcome logged yet (pending, not penalised) · `≥0` → 85 (well-calibrated/under-confident) · `≥ -0.3` → 70 · `≥ -1` → 50 · else → 30 (significant overconfidence) |

**`deriveActionPlan()`** ranks a user's *average* sub-scores across all sessions, finds the single weakest one, and returns one concrete, non-generic copy string targeted at that specific weakness (e.g. weakest = `structural` + fewer than 3 sessions with usable comparison data → "Bring 3 or more decisions to Quorum..."; weakest = `biasClarity` with a known top distorting bias → names that exact bias). This is what Mirror Summary's `nextAction` field surfaces.

> **BUGFIX (audit pass, July 2026):** two separate silent failures, found and fixed together:
> 1. **Same root cause as §2.6's `matches_json` bug** — `scoreStructural()`'s source query also selected `matches_json` from `sessions_ontology` instead of `structural_matches`. Same failure mode: the entire query rejected (nonexistent column), so structural scoring silently fell back to its neutral default for every session, for every user.
> 2. **A second, unrelated column-name bug in the same audit:** the `bias_library` query used `bias_label` — the real column is `bias_parameter` (confirmed against every other call site, e.g. `app/api/bias-score/route.ts`). Same failure mode — bias-clarity scoring was also always silently falling back to its neutral default (80).
>
> **Separately, a genuine logic bug (tracked as MIRROR-1):** `scoreStructural()` previously returned a bare number, using `50` to mean both "no comparison data available for this session" *and* a legitimately reachable real score. `deriveActionPlan()` relied on `structural === 50` as a proxy for "user doesn't have enough decisions yet" — but a rounded average across up to 20 sessions can land on exactly 50 by pure arithmetic coincidence even for a veteran user with plenty of real data. That coincidence is what was producing "Bring 3 or more decisions" messaging for users who already had far more than 3. Fixed by returning an explicit `hasData`/`structuralDataCount` flag instead of overloading the score value, and checking that directly.

---

### 3.10 Decision Rules

**Route:** `GET /api/mirror/rules`  
**Session threshold:** 8 (env: `RULES_SESSION_THRESHOLD`); bypassed for advisory tier

Extracts 3–7 implicit operating principles from the user's examiner responses and pushback messages across all their sessions — behavioral rules they follow without having stated them explicitly.

**AI prompt system:** "These are NOT personality traits. These are behavioral rules the person is implicitly following, revealed through their reasoning patterns and what they push back on." Returns a JSON array of first-person strings (max 20 words each, max 7 rules).

**Evidence corpus:** Last 20 sessions with examiner data; groups Q+A pairs + pushback messages per session; sends as structured text block.

**Parse resilience:** Strips ` ```json ``` ` fences and bare `json` labels; if initial `JSON.parse` fails, attempts bracket-slice extraction `cleaned.slice(firstBracket, lastBracket+1)`. Degrades gracefully (returns `rules: null` with reason) rather than 500.

---

### 3.11 Pattern Store

**Route:** `GET /api/mirror/patterns`  
**Session threshold:** 3 (env: `PATTERNS_SESSION_THRESHOLD`)

Aggregates rule-engine firing frequencies across all user sessions.

**Logic:**
1. Fetches all user session IDs (up to 100)
2. Fetches `sessions_ontology` rows with `tagger_status = 'complete'`
3. For each row, reads `rule_engine_result.triggered_rules` and `rule_engine_result.flag_rules`
4. Counts fire frequency per rule across all sessions
5. Tracks `session_ids[]` per rule (Sprint 20 addition — enables source-session drawer)
6. Tracks `recent_fire_count`: count of fires in the last 10 sessions (Sprint M4)

**Per-rule response:**
```json
{
  "rule_id": "R5",
  "label": "False Urgency",
  "description": "...",
  "type": "FLAG",
  "fire_count": 7,
  "pct": 0.58,
  "session_ids": ["uuid1", ...],
  "recent_fire_count": 3
}
```

**Also returns:** Top 5 dimensions by average score across all v2.0 sessions, with `high_count` (sessions where that dimension scored ≥ 4).

---

### 3.12 Monthly Review

**Route:** `GET /api/mirror/monthly-review`

Rolling 30-day decision closure summary. Falls back to all-time window if user has fewer than 10 total sessions.

**Metrics returned:**
- `decisions_total` — sessions in window
- `loops_closed` — sessions in window that have an `outcomes` row
- `loops_closed_pct` — `round(loops_closed / decisions_total × 100)`
- `rule_recall_applied` — sessions where `rule_recall_choice = 'applied'`
- `confirmed_patterns` — `bias_library` rows where `detection_count ≥ 3`
- `open_loops` — sessions meeting either open-loop condition:

**Open loop definition (either condition):**

**Condition A (past review date):**  
`commitment_review_date IS NOT NULL` AND `commitment_review_date < TODAY`  
→ `days_overdue = days since review_date`

**Condition B (catch-all — no review date, aged > 14 days):**  
`commitment_review_date IS NULL` AND `created_at < (NOW - 14 days)`  
→ `days_overdue = null`

**Sort order:** Past-due loops first (by `days_overdue DESC`), then by `days_open DESC`.

Each open loop returns `{ session_id, decision_text (80 chars truncated), created_at, review_date, days_overdue, days_open }`.

---

### 3.13 Benchmark Module ("Peer Benchmark")

**Route:** `GET /api/mirror/benchmark` (Sprint 20 — "Others in Similar Decisions")  
**Access:** any user with `mirror_access` in `'unlocked'` state (via `getMirrorAccessState()`, §3.1)

> **Correction (this pass):** previously documented as "Advisory tier only." The route's actual gate is `accessState !== 'unlocked'` → `403` — that's the same check used for every standard Mirror-tier feature, not an Advisory-specific one. Every paying Mirror subscriber (monthly, annual, or Advisory) sees this, not just Advisory. Do not confuse this with the separate, genuinely institution-scoped benchmark machinery in §12.7 — same underlying idea (cosine similarity across ontology vectors, cluster-floor gating before returning anything), completely different code path, dataset, and privacy floor (`MIN_CLUSTER_SIZE = 5` here vs. `K_FLOOR` in §12.6, which defaults to 20).

Cross-user structural peer comparison — finds sessions from OTHER users that are structurally similar to the current user's most recent session, then aggregates patterns without exposing any PII.

**Privacy guarantees:**
- Reads only `sessions_ontology` (no `decision_text`, no user identity)
- Reads only aggregate `bias_library` counts (no per-user bias data)
- Minimum cluster size of 5 before any data is returned (`MIN_CLUSTER_SIZE = 5`)
- Current user's own sessions excluded by both `session_id` and `user_id` checks
- Response contains zero PII, zero session IDs

**Algorithm:**
1. Get current user's most recent v2.0 ontology vector
2. Extract weighted vector (applying `DIM_WEIGHTS` — same 1.5× starred dimension weights as personal retrieval)
3. Fetch up to 300 other-user session vectors from `sessions_ontology`
4. Compute cosine similarity for each (`SIMILARITY_THRESHOLD = 0.808`)
5. If cluster size `< 5` → return `{ insufficient: true }`
6. Aggregate dimension averages across cluster → top 3 by `avg_score`
7. Count bias frequency across cluster (via `bias_library.session_ids[]` overlap) → top 3 biases

**Note on confidence:** Confidence is NOT applied in cross-user comparisons. It is a per-session tagger signal, not portable between users.

---

### 3.14 Mirror Summary

**Route:** `GET /api/mirror/summary`

Single aggregated payload for the Mirror above-fold snapshot card.

**Returns:**
- `independenceScore` — latest score from `independence_score_log`
- `scoreDelta` — delta from previous calculation
- `examinerQuote` — longest Examiner response from most recent session (decrypted)
- `confirmedPatternCount` — `bias_library` rows with `detection_count ≥ 2`
- `formingPatternCount` — `bias_library` rows with `detection_count = 1`
- `openLoopCount` — sessions > 30 days old with no outcome row
- `nextAction` — `actionPlan` string from lowest SRI sub-score
- `sessionCount` — total sessions
- `sinceLastVisit` — human-readable delta: e.g. `"Since 3 days ago: Independence +4 pts · 2 new contradictions"` (null on first visit)
- `newContradictions` — count of undismissed contradictions created since `last_mirror_viewed_at`
- `latestSessionMode` — `REDIRECT | GATE | FLAG | OPEN | null` (drives module prominence in UI: REDIRECT → highlight Independence Score; GATE → highlight Contradiction Detector)

**Side-effect:** Upserts `user_preferences.last_mirror_viewed_at = NOW()` on every GET call (best-effort, non-blocking).

---

### 3.15 ValidationCard Signal

**Route:** `GET /api/session/[id]/validation-signal`  
**Sprint lineage:** SB-1 (original tiered signal + framing_intent capture) → "Enrichment Sprint" (current version, unchanged tier matrix/signal logic from SB-1 — see §2.12 for framing_intent and §3.16/§2.12 for what else SB-1/SB-3 fed).

Tiered contextual signal shown on the ValidationCard — a personalised prompt shown immediately after a session ends, asking the user to log what they decided.

**Tier matrix (driven by `sessionCount`):**

| Tier | Sessions | Features unlocked |
|---|---|---|
| 0 | 1–2 | Single-session ontology read only (archetype + emotion + decision type) |
| 1 | 3–9 | + Top bias pattern from `bias_library` |
| 2 | 10–24 | + Calibration direction + decision-type frequency |
| 3 | 25+ | Confirmed patterns, precise counts, full fingerprint language |

**Signal line construction** (`buildValidationLine()`):
- Uses `dominant_emotion` + `archetype` + `decision_type_primary` + `stakes_reversibility`
- Returns a short present-tense narrative: e.g. "You're making an allocation call under a strong sense of urgency — and your track record on these tends to be better than you expect in the moment"
- Returns `null` if ontology not yet tagged (prevents empty card)

**Context lines** (`buildContextLines()` at tier 1–3):
- Bias line: "Your most documented blind spot: [bias label] — confirmed across N sessions"
- Calibration line: "Your tracked decisions show you tend to rate your confidence higher at decision-time than in hindsight"
- Decision-type frequency: "N of your M prior decisions were [type] calls — this is a familiar move for you"

**Returns `already_validated: true`** if `validation_state ≠ 'pending'` (idempotent — safe to call multiple times).

**Confirm/correct actions** go to `PATCH /api/session/validate`: `{ session_id, validation_state: 'confirmed' | 'corrected', validation_emotion_confirmed, validation_correction?, device_id, user_email? }`. A `'corrected'` submission stores the correction text on `sessions.validation_correction` — which is what §2.12's carry-forward loop (Sprint S2-05) reads on the *next* linked session. The client-side accumulation copy (`getAccumulationMessage()`/`getIdleTeaserLine()` in `ValidationCard.tsx`) scales with the same tier matrix, distinct from the server-computed signal/context lines.

---

### 3.16 Council Weighting Strip (Sprint S2-02)

**Component:** `components/CouncilWeightingStrip.tsx`  
**Data source:** `X-Persona-Relevance` response header on the synthesis-call persona stream — the exact `relevanceMap` used to build the synthesis directive (`computePersonaRelevance()`, see §2.8), exposed as a JSON header rather than recomputed client-side.

Shown immediately after synthesis completes, for every tier (no gating — it's explaining the synthesis the user already received for free; gating it would be punitive). Displays the top 3 advisors by weight as a horizontal bar chart with a coloured dot per persona, only rendering at all if at least one advisor scored above the 0.52 baseline (`hasElevated` check — a flat, undifferentiated Council doesn't get a strip).

**This sprint's diagnostic work is also what surfaced the critical persona-relevance bug** described in §2.8 and §2.6 — exposing the exact weighting values via this header made it visible that `computePersonaRelevance()` was silently returning a flat 0.50 baseline for every session, which led to the `matches_json`/wrong-table root cause being found and fixed (Sprint R3/BUGFIX, July 2026).

**Since fixed:** the strip now reflects every boost layered onto the base algorithm after the bugfix — rule/dimension boosts, the Sprint CAL calibration-zone boost, and the P1 deliberation-shift boost (§2.8.1–2.8.2) all flow through the same `X-Persona-Relevance` header this component reads, with no separate wiring needed on this end. The `X-Persona-Relevance-Reasons` header (§2.8) additionally powers a "why" affordance (short human-readable reasons per persona) not present when this section was first written.

---

### 3.17 Watchlist (Sprint W1)

**Routes:** `GET/POST /api/watchlist`, `PATCH/DELETE /api/watchlist/[id]`, `POST /api/watchlist/[id]/graduate`  
**Component:** `components/WatchlistSection.tsx` (home page)  
**Feature flag:** `lib/feature-flags.ts` — `isWatchlistEnabled()`, gated on `NEXT_PUBLIC_WATCHLIST_ENABLED === 'true'`. **Off by default.** All four routes return `404` (not an empty result) when the flag is off, so a disabled feature looks absent rather than broken. `NEXT_PUBLIC_`-prefixed so the same variable works identically from server routes (`process.env`) and client components (inlined into the bundle at build time — a plain Railway restart will **not** pick up a change to this var; it requires a rebuild).

A deliberately low-friction, lightweight capture surface distinct from a full Council session: one text box, an optional tag (`business | wealth | career | family | relationship | other`), a list of open items each with **Archive** and **Convene the Council** actions. No register-mode choice, no setup step — capture is meant to take under 10 seconds. This is explicitly *not* meant to become a second, lighter decision ritual alongside the main Council flow.

- **`POST /api/watchlist`** — `{ text (≤500 chars), tag? }`, encrypted at rest (`text_encrypted`), always Bearer-authenticated (no anonymous path — same posture as the graph-nudge route below, since this route writes state).
- **`GET /api/watchlist`** — returns the caller's `status = 'open'` items, decrypted, plus a `count` so the client can render its own soft-cap nudge copy; the route itself never blocks creation on count.
- **`PATCH /api/watchlist/[id]`** — `{ status: 'archived' }` only (soft dismiss, row kept). **`DELETE`** — hard delete. Both scoped to the caller's own `user_id`.
- **`POST /api/watchlist/[id]/graduate`** — marks an item graduated (presumably into a full session — see "Convene the Council" action in the UI).

**Cross-feature integration:** when a session's post-session graph-nudge slot (§4.6) has nothing else to show, and the flag is on, it falls back to offering to add the session's own first non-empty `examiner_gap_1/2/3` phrase to the Watchlist — sourced from data the Examiner already computed for that exact session, never a new detection pass run to manufacture a prompt.

---

### 3.18 Mirror Advisory Request Flow (Sprint M7)

**Route:** `POST /api/mirror/advisory-request`  
**Component:** `components/AdvisoryUpsellCard.tsx` (request CTA added this sprint; upsell card itself is Phase 4/5)

Lets a user request Advisory-tier access (as opposed to self-serve Mirror ₹3,999/mo checkout) — presumably logging a request record for manual follow-up/sales-assist rather than an automated grant. See §3.1 for the Advisory tier's role in Mirror access gating and the `ADVISORY_BYPASSES_THRESHOLDS` flag referenced throughout this spec.

---

## 4. Decision Graph Engine

**Library:** `lib/graph-engine.ts`  
**Routes:** `POST /api/graph/backfill`, `GET /api/mirror/graph`, `GET /api/mirror/graph/edges`, `DELETE /api/mirror/graph/edges/[id]/dismiss`

Materialises a personal decision graph from structured data already computed by other engines. Sprint G1 (June 2026) — data layer only; G2 adds query API, G3 adds Sprint UI, G4 adds synthesis injection.

### 4.1 Edge Types & Canonicalization

**Five edge types:**

| Type | Source | Strength | Description |
|---|---|---|---|
| `structural_similarity` | `scoreStructuralSimilarity()` | `vector_similarity` (0–1) | Two decisions are ontologically similar |
| `contradiction` | `contradiction_log` table | `1.0` (fixed) | A principle from one session is violated in another |
| `shared_bias_trigger` | `bias_library.session_ids[]` | `max(confidence_weight)` across biases | Same bias fired in both sessions |
| `shared_decision_type` | `sessions_ontology.decision_type_primary` | `1.0` (fixed) | Both sessions are the same primary decision type |
| `user_asserted` | Sprint G2 (not yet implemented) | User-defined | User manually links two decisions |

**Pair canonicalization:** All edges are undirected. UUID lexicographic ordering: `session_id_a < session_id_b` always. Must be called (`canonicalize()`) before every upsert to prevent duplicate rows violating the unique constraint `(session_id_a, session_id_b, edge_type)`.

### 4.2 Live Structural Edges

`upsertStructuralEdge()` is called from the `structural-match` route for every pair that clears `MATCH_THRESHOLD`. It is:
- **Additive** to the structural-match flow — never synthesis-blocking
- **Error-caught** — failures are logged but never thrown to the route's caller
- **Non-blocking** — the structural-match response is never delayed waiting for a graph write

Stores `DimensionBreakdown` in `dimension_breakdown` JSONB:
```json
{
  "vector_similarity": 0.847,
  "total": 62,
  "top_matching_dims": ["identity_alignment", "regret_asymmetry", "time_horizon"],
  "scoring_mode": "vector"
}
```

### 4.3 Backfill Engine

`runFullBackfill(userId, supabase)` — orchestrates all 4 computed edge-type backfills in parallel. Called from `/api/graph/backfill` (admin-gated via `INTERNAL_API_SECRET`).

**Structural backfill:** Re-scores all pairs of the user's sessions with v2.0 ontology vectors; upserts edges for pairs above threshold.

**Contradiction backfill:** Reads all `contradiction_log` rows involving user's session IDs; creates edges for each pair.

**Shared bias backfill:** For each `bias_library` row, iterates all `(i,j)` pairs in `session_ids[]`. Pre-aggregates multiple biases into a single canonical pair entry (max strength = `max(confidence_weight)` across contributing biases; all bias keys listed in `metadata.bias_parameters[]`). Batches upserts in groups of 50.

**Shared decision type backfill:** Groups user's `sessions_ontology` rows by `decision_type_primary`; creates edges between every pair within each group. Batches in groups of 50.

### 4.4 Graph Synthesis Context

`fetchGraphSynthesisContext(userId, sessionId, decisionTypePrimary)` — called by the persona route (Sprint G4) to inject graph context into synthesis prompts.

**Logic:**
1. Queries `graph_edges` for edges involving the current session (types: `structural_similarity`, `contradiction`, `shared_bias_trigger`)
2. Up to 2 retry attempts with 800ms wait between — accounts for the fact that `structural-match` is fire-and-forget from the client and may not have completed yet
3. Queries count of `shared_decision_type` edges (global, not current-session-specific)
4. Builds a structured text block with:
   - Per-edge descriptions with type-appropriate framing
   - If ≥ 2 structural connections: "Pattern Analyst's cross-history signal carries elevated weight" synthesis directive
   - Historical context line for same-decision-type count

Returns `EMPTY_GRAPH_SYNTHESIS_CONTEXT` (no-op) if user has no edges or is not authenticated.

---

### 4.5 Tiered Graph Access — locked / preview / full (Sprint QW-2)

**Route:** `GET /api/mirror/graph`

Prior to this sprint, the graph was all-or-nothing: `getMirrorAccessState() === 'unlocked'` AND a 20-session/3-edge corpus, or nothing. Two real problems fell out of that: free users never saw the product's most differentiated asset before paying, and paying subscribers under the 20-session corpus saw an *empty* graph too — a retention bug, not a deliberate paywall. Fixed by splitting into three tiers, gated primarily on whether edges exist and whether the user has paid, not on an arbitrary large corpus:

| Tier | Condition | What's returned |
|---|---|---|
| `locked` | `sessionCount < MIN_PREVIEW_SESSIONS` (default 2) | At most a single self-node — a "your first decision is mapped" ghost state. No edges are possible yet. |
| `preview` | `sessionCount ≥ MIN_PREVIEW_SESSIONS` AND not (paid + full corpus met) | Real edges are returned — the fact that a connection exists is the hook — but `dimension_breakdown`, `explanation_text`, and `metadata` are stripped server-side (never trust client-side hiding for this: the interpretive "why" is the paid layer, same principle as `ADVISORY_BYPASSES_THRESHOLDS`'s contradiction-detail gating). Capped to `PREVIEW_MAX_EDGES` (default 2), strongest first; the remainder is surfaced only as a count (`corpus.locked_edge_count`). |
| `full` | `accessState === 'unlocked'` AND (Advisory bypass OR corpus met) | Unchanged from original behaviour — full detail, uncapped. |

`MIN_GRAPH_SESSIONS`/`MIN_GRAPH_EDGES` now gate only the preview→full transition, and only for paying users — defaults lowered from 20/3 to **2/1**. A paying subscriber should not have to reach 20 sessions to see their own graph in full. (Railway env vars already set to the old 20/3 defaults from before this sprint continue to apply until changed.)

Response shape: `{ nodes, edges: ResponseEdge[], tier, corpus }`. Each `ResponseEdge` carries an explicit `redacted: boolean` flag so the client can distinguish "computed and genuinely empty" from "stripped because you're on the preview tier" without guessing from nulls. `corpus` is tier-aware — `min_sessions`/`min_edges` describe what's needed for the *next* tier up, not a single fixed threshold.

---

### 4.6 Post-Session Graph Nudge (Sprint QW-3)

**Route:** `GET /api/session/[id]/graph-nudge`  
**Component:** `components/GraphNudgeLine.tsx`

Powers a single shared end-of-flow prompt slot in `SessionView.tsx` — deliberately not a reuse of the full `DecisionGraph` d3 component; by session 6+ the graph already has a home (Mirror) and this slot only needs to say "something changed there," not show it again. Gated to `sessionCount ≥ MIN_SESSION_COUNT_FOR_NUDGE` (6) — mirrors (and re-enforces server-side) the client's own gate that reserves the pictorial 1–5 session graph teaser for newer users.

**Three variants, mutually exclusive per call, tried in this order, sharing ONE 72-hour cooldown** (`user_preferences.last_graph_nudge_shown_at` — whichever variant fires updates the same timestamp, so a user never sees more than one prompt from this slot per cooldown window regardless of which variant it was):

1. **`milestone`** — veteran users only (`sessionCount ≥ 20`). Fires when total non-dismissed edge count crosses a new rung in `[10, 25, 50, 100, 250, 500, 1000]`.
2. **`new-connection`** — non-veteran users. Fires when a `graph_edges` row involving *this* session exists that's newer than the last time this slot was shown (or any edge, if never shown before) — scoped specifically to edges touching the session just finished, not an unrelated fresh edge elsewhere in the user's graph.
3. **`watchlist-suggestion`** (Sprint W1 fallback, either cohort) — if neither graph variant fired and `NEXT_PUBLIC_WATCHLIST_ENABLED` is on, offers to add this session's first non-empty `examiner_gap_1/2/3` phrase to the Watchlist (§3.17). Sourced from a field the Examiner already computed for this exact session — never a new detection pass. Graph variants always win when both are eligible; a real new connection or milestone is treated as the more "earned" moment, with the Watchlist suggestion as the lower-stakes fallback rather than a competing headline.

Auth: session UUID + a resolved `user_id` are both required (no anonymous-session fallback) — unlike read-only routes such as bias-note (§2.15), this route *writes* nudge-shown state.

---

## 5. Infrastructure & Security

### 5.1 Encryption

**Library:** `lib/encryption.ts`  
**Algorithm:** AES-256-GCM  
**Key:** `DB_ENCRYPTION_KEY` env var (64 hex chars / 32 bytes)  
**Guard:** `import 'server-only'` — build-time error if imported client-side

**Encrypted columns:**

| Table | Columns |
|---|---|
| `sessions` | `decision_text`, `context_text` |
| `messages` | `content` (all roles) |
| `examiner_responses` | `question_text`, `response_text` |
| `outcomes` | `what_decided`, `notes` |
| `structural_matches` | `context_block`, `matches_json` (JSONB via `_enc` wrapper) |
| `graph_edges` | `explanation_text` (user_asserted edges only) |

**Excluded (derived/computed data — not raw user input):**  
`sessions_ontology`, `bias_library`, `structural_scores`, `independence_score_log`, `contradiction_runs`, `avoidance_alerts`, `mirror_access`, `user_preferences`, `contradictions.principle_text` / `violation_text` (AI-derived)

**Encrypted value format:**
```
enc:<iv_hex(32 chars)>:<authTag_hex(32 chars)>:<ciphertext_base64>
```

**Behaviour matrix:**

| Scenario | `encrypt()` | `decrypt()` |
|---|---|---|
| Key set, production | AES-256-GCM encrypt | Decrypt normally |
| Key not set, development | Return plaintext (backward compat) | Return plaintext as-is |
| Key not set, production | Throw (fail-closed, surfaces 500) | Log error, return ciphertext |
| Old plaintext row (no `enc:` prefix) | — | Return as-is (backward compat) |

**JSONB encryption** (`encryptJson()` / `decryptJson()`):  
Wraps serialised JSON in `{ "_enc": "enc:..." }` for JSONB columns. Old plaintext arrays are returned as-is for backward compatibility.

**Startup warning:** If `NODE_ENV === 'production'` and `DB_ENCRYPTION_KEY` is unset, a `CRITICAL` error is logged at module load time — surfaces immediately in Railway logs.

---

### 5.2 Rate Limiting

**Library:** `lib/rate-limit.ts`  
**Mechanism:** In-memory sliding-window (single-instance Railway deployment; no Redis required)

**Configured limits:**

| Route | Identifier | Limit | Window |
|---|---|---|---|
| `POST /api/session` | `session` | 20 | 15 min |
| `POST /api/persona` | `persona` | 60 | 10 min |
| `GET/POST /api/examiner` | `examiner` | 40 | 10 min |
| `POST /api/auth` | `auth` | 5 | 15 min |
| `POST /api/voice/tts` | `voice-tts` | 80 | 10 min |
| `POST /api/structural-match` | `structural-match` | 30 | 10 min |
| `POST /api/outcome` | `outcome` | 30 | 10 min |

**Window mechanics:**  
Key = `${identifier}:${client_ip}`. Entry stores `{ count, resetAt }`. On expiry: new entry with count=1. On hit: count++. On exceeded: 429 response with `Retry-After` header and human-readable message.

**Memory cleanup:** `setInterval` every 15 minutes clears expired entries. `.unref()` prevents the interval from blocking process exit.

**IP extraction:** `x-forwarded-for` header (leftmost IP for Railway), fallback `x-real-ip`, fallback `'unknown'`.

**429 response shape:**
```json
{
  "error": "Too many requests",
  "message": "You've sent too many persona requests. Please wait 4 minutes — you can try again at 3:45 PM.",
  "resetAt": 1719825900000,
  "retryAfterSecs": 240
}
```

---

### 5.3 Audit Log

**Library:** `lib/audit.ts`  
**Table:** `audit_log` (no SELECT policy — users cannot read their own trail)

**Audited actions:**
- `session.create`
- `auth.magic_link_sent`
- `account.export`
- `account.delete`
- `admin.access`
- `admin.auth_failed`
- `admin.locked_out`

**Write behaviour:** Always resolves `void` — errors are caught and logged to stderr, never thrown. Audit failures never break the primary operation.

**Fields per event:** `actor_id` (user UUID), `actor_email`, `action`, `resource_id`, `ip_address`, `user_agent`, `metadata` (JSON).

---

### 5.4 Supabase Client Tiers

**Library:** `lib/supabase.ts`

Two clients:

| Client | Key Used | RLS | Use Case |
|---|---|---|---|
| `createClient()` | Anon key | Enforced | Browser-safe operations (auth token validation) |
| `createServiceClient()` | Service role key | Bypassed | All server-side routes; full DB access |

All API routes use `createServiceClient()` for DB operations, but use `createClient()` (anon key) specifically for `auth.getUser(token)` — this is required so Supabase validates the bearer token correctly (service key would bypass auth validation).

---

### 5.5 Client-Side Storage & Cookie Consent

**Library:** `lib/storage.ts`

**localStorage keys:**
- `quorum_session_ids` — up to 100 recent session UUIDs (functional consent required to write)
- `quorum_user_email` — post-auth email (strictly necessary, no consent gate)
- `quorum_device_id` — anonymous device identity, `dev_${crypto.randomUUID()}` (functional consent required to write)
- `quorum_cookie_consent` — `{ functional: boolean }` consent record

**Consent gate (`hasFunctionalConsent()`):**  
All `pushSessionId()` and `getOrCreateDeviceId()` writes are gated. Reads are always permitted. `quorum_user_email` is treated as strictly necessary — no consent gate.

**Device ID generation:** `'dev_' + crypto.randomUUID()` (or `Math.random().toString(36)` fallback for older environments). Written to `sessions.device_id` at session creation time, enabling anonymous bias accumulation before auth.

---

## 6. Authentication

### 6.1 Magic Link Flow

**Route:** `POST /api/auth`  
**Rate limit:** 5 per 15 minutes per IP (strictest limit in the system)

**Flow:**
1. Validates email format
2. Uses Supabase anon client `signInWithOtp()` (NOT `admin.generateLink()` — the latter returns the URL without sending email)
3. Callback URL is always built from `NEXT_PUBLIC_APP_URL` env var — not from request `Origin` header (which would be `app.quorumvault.org`, not in Supabase's redirect allowlist, causing silent fallback that drops all query params)

**Cross-browser recovery payload** (Sprint 6b):

The `emailRedirectTo` URL carries the originating browser's session history as query params:
```
/auth/callback?xd=dev_abc123&xs=uuid1,uuid2,...,uuid40
```
- `xd` = device_id
- `xs` = up to 40 session IDs from localStorage

When the link is clicked in a different browser (email client, mobile WebView), localStorage is empty — these params are read from the URL and passed to `link-sessions` to recover the full session history.

**Audit log:** `auth.magic_link_sent` written non-blocking after OTP send.

---

### 6.2 Session Linking (Anonymous → Authenticated)

**Route:** `POST /api/auth/link-sessions`

After magic link callback, runs all linking operations in parallel:

**1. RPC `link_sessions_to_user`**  
Links up to 40 explicit session IDs (from localStorage or URL param `xs`) to the new `user_id`. Uses a Supabase RPC function that atomically updates all matching rows.

**2. Device-ID session sweep**  
`UPDATE sessions SET user_id = ?, user_email = ? WHERE device_id IN (?) AND user_id IS NULL`  
Catches sessions created before the magic link was sent AND sessions created after (e.g. by reanalyze cron) that wouldn't be in the `?xs=` params.

**3. Email session sweep**  
`UPDATE sessions SET user_id = ? WHERE user_email = ? AND user_id IS NULL`  
Catches sessions where the user entered their email before authenticating.

**4. Bias library retro-link**  
Upgrades anonymous bias rows to `user_id` lane:  
`UPDATE bias_library SET user_id = ?, user_email = ? WHERE user_email = ? AND user_id IS NULL`  
And similarly for device_id. Ensures bias accumulation continues longitudinally after auth.

**5. `user_preferences` upsert**  
Ensures Mirror can access the user's preferences immediately after auth.

**Response:**
```json
{
  "linked_sessions": 7,
  "linked_by_ids": 3,
  "linked_by_device": 4,
  "linked_by_email": 0
}
```

---

## 7. Voice System

### 7.1 Speech-to-Text (Soniox WebSocket)

**Routes:** `GET /api/voice/stream`, `POST /api/voice/chunk`  
**Library:** `lib/voice-sessions.ts`, `ws` npm package  
**Runtime:** `nodejs` (not Edge — WebSocket requires Node.js runtime)

**Architecture:** Browser → `/api/voice/stream` (SSE) ↔ Soniox WebSocket

**Session lifecycle:**
1. Browser GETs `/api/voice/stream?sessionId=xxx` → opens SSE connection
2. Route opens a Soniox WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`) and sends config on open:
   ```json
   { "api_key": "...", "model": "stt-rt-v4", "audio_format": "auto", "language_hints": ["en"] }
   ```
3. Route stores session in shared `voiceSessions` Map (keyed by `sessionId`)
4. Browser POSTs audio chunks to `/api/voice/chunk?sessionId=xxx` → route looks up WS from Map and forwards raw audio bytes
5. Soniox sends token batches → route forwards as SSE events to browser
6. On browser disconnect (SSE cancel): Soniox WS is closed, session removed from Map

**SSE event types:**
```json
{ "type": "ready" }
{ "type": "batch", "finalText": "...", "partialText": "...", "hasEndpoint": false }
{ "type": "finished" }
{ "type": "error", "errorType": "ws_error", "msg": "..." }
```

**Token handling:** Soniox's `is_final` flag distinguishes finalized vs in-progress tokens. Special tokens `<end>` and `<fin>` are filtered from display text. Non-final tokens reset on every response (replace, not append). The `batch` event type sends the whole message so the client correctly replaces partial text on each update.

**TTL sweep:** `sweepStaleSessions()` removes sessions older than 10 minutes — called on each new connection. Prevents Map growth from leaked sessions.

**Shared Map:** `voiceSessions` is a module-level `Map` — valid because Railway runs Next.js as a persistent Node.js process, not serverless. Both `/api/voice/stream` and `/api/voice/chunk` share this Map.

---

### 7.2 Text-to-Speech (Soniox HTTP)

**Route:** `POST /api/voice/tts`  
**Rate limit:** 80 per 10 minutes per IP  
**Runtime:** `nodejs`

**Request:** `{ text: string }` (max 8000 chars)

**Pre-processing:** `stripMarkdown(text)` removes `**bold**`, `*italic*`, `##` headers, `- bullet` prefixes before sending to TTS — markdown symbols are spoken literally otherwise.

**Soniox API call:**
```json
{
  "model": "tts-rt-v1",
  "language": "en",
  "voice": "Adrian",
  "audio_format": "mp3",
  "text": "<stripped text>"
}
```

**Response:** Proxied audio stream with `Content-Type: audio/mpeg`, `Cache-Control: no-store`.

**Error handling:**
- Soniox 429 → `{ error: 'TTS_QUOTA_EXCEEDED' }` 429
- Soniox 5xx → `{ error: 'TTS_PROVIDER_DOWN' }` 502
- Network error → 502
- Text too long → 400

---

## 8. Notification & Nudge System

### 8.1 Web Push Infrastructure

**Library:** `lib/push.ts`  
**Route:** `POST /api/push/subscribe`  
**NPM:** `web-push` package  
**Keys:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (Railway env vars)

**Subscribe route:** Accepts a Web Push subscription object (`endpoint`, `p256dh`, `auth_key`) and upserts it into `push_subscriptions` table keyed by `user_id`.

**`sendPushToUser(userId, payload)`:**
1. Fetches all `push_subscriptions` rows for user
2. For each: calls `webpush.sendNotification()` with `TTL: 86400` (24-hour retry window)
3. On success: stamps `last_used_at`
4. On 410/404 status: prunes the expired subscription from DB
5. Returns `{ sent: number, failed: number }`

**Payload shape:** `{ title: string, body: string, url?: string }`

---

### 8.2 Notification Throttle Gate

**Library:** `lib/notification-throttle.ts`  
**Constants:** `SHARED_NUDGE_GATE_DAYS = 3`

Cross-cron shared gate preventing back-to-back nudges. Both `daily-nudge` and `validation-nudge` are gated here. `reanalyze-email` and `mirror-insight-email` are intentionally excluded.

**`canSendNudge(userId, withinDays = 3)`:**  
Checks `notification_log` for any entry in the past 3 days. Returns `false` if found (fail-closed if DB error). Returns `true` only if no recent entry exists.

**`recordNudge(userId, source)`:**  
Inserts into `notification_log` with `source: 'daily_nudge' | 'validation_nudge'` and `sent_at = NOW()`. Claims the shared slot.

**Priority enforcement:** Via cron schedule order — `validation-nudge` runs at 02:00 UTC, `daily-nudge` at 04:00 UTC. Whichever runs first claims the shared slot; the other correctly defers.

---

### 8.3 Nudge Copy Engine

**Library:** `lib/nudge-copy.ts`

**30 copy variants** across 7 themes:
- `daily_decision` — reinforce logging habit
- `judgment_record` — frame decisions as a longitudinal record
- `blind_spots` — bias awareness
- `confidence` — calibration angle
- `contradictions` — consistency theme
- `long_term` — elder-voice framing
- `exec_lens` — professional decision-quality framing
- `validation_pending` — re-engagement when session has no outcome (Sprint SB-1)

Each variant has `push.title` (≤55 chars), `push.body` (≤90 chars), `email.subject` (≤60 chars), `email.body` (≤120 words).

**Personalisation tokens:**  
`{{session_count}}` — always available; `{{bias_label}}` — only when `bias_library ≥ 1 row`.

Variants requiring `{{bias_label}}` are excluded from the eligible pool when the user has no bias data.

**Deterministic selection (`selectNudgeVariant()`):**
```
eligible_pool = variants filtered by token availability
index = (dayOfYear(now) + abs(hash(userId))) % eligible_pool.length
```
Different users get different variants on the same day; same user cycles through all 30 before repeating.

**`userIdHash()`:** `Σ (31 × h + charCodeAt(i)) | 0` — stable numeric hash of UUID string.

**`resolveVariantTokens()`:** String replacement of `{{session_count}}` and `{{bias_label}}` placeholders. `toInlineBiasLabel()` converts label `"FOMO / False Urgency"` → `"false urgency"` (takes second segment if slash-separated, lowercases).

---

### 8.4 Nudge Unsubscribe Tokens

**Library:** `lib/nudge-token.ts`

HMAC-SHA256 signed tokens using `CRON_SECRET` as the signing key.

**Two formats:**

| Format | Token | Signing input | Backwards compat |
|---|---|---|---|
| Legacy `daily` | `{userId}.{hmac}` | `hmac(userId)` | Yes — pre-existing links still work |
| Typed (any) | `{userId}.{type}.{hmac}` | `hmac(userId.type)` | No — new format only |

The type is bound into the signature for typed tokens — a leaked link cannot be replayed against a different preference column.

**`verifyUnsubToken()`:** Timing-safe comparison via `crypto.timingSafeEqual()`. Returns `{ userId, type }` or `null`. 2-segment tokens are always treated as `'daily'` type.

---

### 8.5 Lapse Nudge Cron (daily-nudge)

**Route:** `POST /api/cron/daily-nudge`  
**Schedule:** `0 4 * * *` (04:00 UTC = 9:30 AM IST)  
**Auth:** `Authorization: Bearer <CRON_SECRET>`

**Not a daily message — a decaying 4-step lapse sequence:**

```
LAPSE_SEQUENCE_DAYS = [2, 5, 10, 18]
```
Four contact attempts per lapse period: at days 2, 5, 10, 18 of inactivity. No contact after day 18 until the user logs a new session (which resets the clock).

**Sequence state** stored in `user_preferences`:
- `lapse_anchor_session_at` — the most-recent session date this sequence counts from
- `lapse_sequence_step` — how many sequence attempts have been sent for this lapse

**Fresh lapse detection:** If `last_session_date > lapse_anchor_session_at` → user came back → reset to step 0 automatically (no separate webhook needed).

**Per-user flow:**
1. Check opt-out: `daily_nudge_opted_out = true` → skip
2. Compute `days_since_last_session`
3. Determine `current_step` (0 if fresh lapse)
4. Check `days_since_last_session ≥ LAPSE_SEQUENCE_DAYS[current_step]` → if not due, skip
5. Check `canSendNudge(userId)` → if gate taken by validation-nudge, defer (do NOT consume step)
6. Resolve email + session count (parallel)
7. Resolve top bias key from `bias_library`
8. Select variant deterministically, resolve tokens
9. Send email + push combo
10. `recordNudge()` + advance `lapse_sequence_step += 1` + update `lapse_anchor_session_at`

**Active window:** Only users with a session within the past 180 days are considered.

---

### 8.6 Validation Nudge Cron

**Route:** `POST /api/cron/validation-nudge`  
**Schedule:** `0 2 * * *` (02:00 UTC — 07:30 IST — deliberately scheduled BEFORE daily-nudge's 04:00 UTC run, so this source claims the shared notification slot first whenever both crons want the same user in the same window)

> **Correction (this pass):** the previous version of this section said sessions qualify at "> 3 days ago" with no upper bound and no synthesis-completion check. Neither is accurate — see the real targeting conditions below.

**Targeting (all conditions must pass):**
- `session.user_id IS NOT NULL` (authenticated — an email/push subscription must exist to notify)
- `validation_state = 'pending'`
- `validation_nudge_sent_at IS NULL` — this exact session has never been nudged before (per-session stamp, not a per-user cooldown)
- Session is **7 to 60 days old** — `MIN_AGE_DAYS = 7` is a minimum spacing floor; `MAX_AGE_DAYS = 60` is an outer bound so the cron doesn't keep reaching back into ancient pending sessions indefinitely
- Session **actually completed synthesis** — verified via a `messages` row with `persona = 'synthesis', role = 'assistant'` for that session. Without this check, REDIRECT-blocked sessions (which never run the Council and default to `validation_state = 'pending'` at creation, with nothing to ever move them out of it) would get nudged to validate an inference that was never made — a real trust problem the check exists specifically to prevent.
- `validation_nudge_opted_out IS NOT TRUE` in `user_preferences`
- `canSendNudge(userId)` — shared cross-cron gate (§8.2) clear

**One nudge per user per run**, even with multiple qualifying pending sessions — targets only their single most recent one.

**Copy:** reuses the 3 existing `validation_pending` theme variants from the nudge copy bank (added alongside SB-1, §2.12) — no new copy needed for this cron. Variant selection is **deterministic per session ID**, not per calendar day as daily-nudge's rotation is — this cron fires once per qualifying session rather than on a recurring daily cadence, so the rotation axis is the session, not the date.

**On send:** stamps `sessions.validation_nudge_sent_at` (this exact session is never re-targeted again) and calls `recordNudge(userId, 'validation_nudge')` to claim the shared cross-cron slot (§8.2), so daily-nudge's later run defers if it was also due for this user this window.

---

### 8.7 Reanalyze Email Cron

**Route:** `POST /api/cron/reanalyze-email`

Milestone-based outcome check-in emails. Fires at most 3 times per session, at days 7, 14, and 30 after session creation.

**NOT gated by `notification-throttle`** — milestone emails fire at a specific meaningful moment; a missed milestone has no retry at "day 14.5." Dropping them for a nudge collision would be a real product loss.

**Milestone tracking:** Stored in sessions table (`reanalyze_7d_sent`, `reanalyze_14d_sent`, `reanalyze_30d_sent` boolean flags). Prevents re-send.

**Also fires:** `sendPushToUser()` alongside the email (combo pattern, not separately gated).

---

### 8.8 Mirror Insight Email Cron

**Route:** `POST /api/cron/mirror-insight-email`

Sends a personalised Mirror insight email when a user's bias fingerprint reaches a new milestone (e.g. first confirmed pattern, 5th session). Email-only (no push). Has its own 7-day per-user cooldown, independent of the shared nudge gate.

---

### 8.9 Avoidance Detection Cron

**Route:** `GET /api/cron/avoidance-detect`

Runs the avoidance detector (see §3.7) across all active users. Writes alerts to `avoidance_alerts`. Alerts are surfaced in the Mirror UI under the Avoidance module.

---

## 9. Payments — Razorpay

**Route:** `POST /api/payment/webhook`  
**Verification:** HMAC-SHA256 (`x-razorpay-signature` header, `RAZORPAY_WEBHOOK_SECRET` env var)

**Subscription tiers:**
- `monthly` — ₹3,999/month
- `annual` — ₹39,999/year

**`expires_at` buffer:** +3 days over plan period to absorb late webhook delivery:
```
monthly → NOW + 33 days
annual  → NOW + 368 days
```

**Handled events:**

| Event | Action |
|---|---|
| `subscription.activated` | Upsert `mirror_access` row with `access_type = plan`, `expires_at` calculated |
| `payment.captured` | Extend `expires_at` on renewal — tries `notes.user_id + notes.plan` first; falls back to DB lookup by `payment_id` (subscription_id) |
| `subscription.cancelled` | No-op — row stays, `expires_at` gates naturally; user retains Mirror until period ends |
| `subscription.expired` | No-op — same reason |
| All others | 200 OK + `ignored: eventName` — prevents Razorpay retry storms |

**HMAC verification (timing-safe):**
```
expected = HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, rawBody)
crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
```
Raw body is read before any JSON parsing (required for HMAC — `req.text()` not `req.json()`).

**`notes` contract** (set at subscription creation time in `POST /api/payment/create-subscription`):
```json
{ "user_id": "<supabase auth UUID>", "plan": "monthly | annual" }
```

**Cancellation route:** `POST /api/payment/cancel-subscription` — calls Razorpay API to cancel the subscription; does NOT delete the `mirror_access` row (natural expiry gate handles access).

---

## 10. Admin Routes

All admin routes are gated by `INTERNAL_API_SECRET` Bearer token (not the same as `CRON_SECRET`).

### `GET /api/admin/dashboard`

Returns aggregate metrics:
- Total users, sessions, outcomes, bias patterns
- Session count distribution
- Recent activity (last 7 days)
- Mirror access breakdown (monthly/annual/advisory/lifetime counts)

### `POST /api/admin/grant-mirror-access`

Manually grants `mirror_access` to a user. Used for:
- Advisory cohort onboarding (`access_type = 'advisory'`, no expiry)
- Gifted subscriptions
- Support cases

**Request:** `{ user_id, access_type: 'advisory' | 'monthly' | 'annual', expires_at?: ISO date }`  
**Action:** Upserts into `mirror_access` with `onConflict: 'user_id'`.

### `GET /api/admin/audit-log`

Returns paginated audit log entries. Supports filtering by `action` and `actor_id`.

---

## 11. Account Management

### `GET/DELETE /api/account`

**GET:** Returns `{ email, session_count, has_mirror_access, created_at }`.

**DELETE — account deletion:**
1. Writes audit log: `account.delete`
2. Deletes all user data in order: `messages`, `examiner_responses`, `sessions`, `outcomes`, `bias_library`, `mirror_access`, `user_preferences`, `push_subscriptions`, `independence_score_log`, `graph_edges`
3. Deletes Supabase Auth user: `auth.admin.deleteUser(userId)`
4. Returns `{ deleted: true }`

### `GET /api/account/export`

**GDPR data export.** Returns a JSON file containing all user data:
- All sessions (decrypted `decision_text` + `context_text`)
- All messages per session (decrypted `content`)
- All examiner Q&As (decrypted)
- All outcomes (decrypted)
- Bias library (all parameters + detection counts)
- Mirror access record
- User preferences

Writes audit log: `account.export`.  
Response: `Content-Disposition: attachment; filename="quorum-export-<partial-uuid>.json"`, `Cache-Control: no-store`.

---

## 12. Institutional Mode

**Not previously documented in this spec.** This is a complete, separately-built B2B layer sitting alongside the individual product — six migrations (`institutional_sprint1_schema.sql` through `institutional_sprint6_bias_parameter_view.sql`) plus `institutional_tier3_deactivation.sql`, all additive and all gated behind one master flag. It touches nothing on `sessions`, `messages`, `sessions_ontology`, `examiner_responses`, `bias_library`, or `contradiction_log` directly — it reads from them (for aggregation) but the individual product's schema is otherwise untouched, and the whole layer is inert with the flag off.

### 12.1 Overview & Feature Flag

**Flag:** `isInstitutionalModeEnabled()` in `lib/feature-flags.ts` → `process.env.NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED === 'true'`. Default off. `NEXT_PUBLIC_`-prefixed (same pattern as the Watchlist flag, §3.17) — read identically client- and server-side, baked into the client bundle at build time, so a Railway *restart* alone will not pick up a change; a rebuild is required.

**Difference from Watchlist's flag:** this one gates real permission logic (membership rows, code redemption, admin RBAC), not just a UI surface — so **every** institutional API route checks it server-side and returns a bare `404` when off, not just a `200` with empty data. A disabled institutional layer is indistinguishable from a build that never had the feature, from the outside.

**What it's for:** a B2B / family-office / firm-level tier sitting on top of the individual product — an organization (a fund, a firm, a family office) can have its own private space where members opt into anonymized, K-floor-gated aggregate comparisons against their colleagues, without the product ever showing anyone else's individual decisions, session content, or bias data.

### 12.2 Schema

**`institutions`** — one row per organization. `id`, `name`, `parent_institution_id` (self-referencing FK — enables the conglomerate/rollup hierarchy, §12.8), `unlock_code_hash` (SHA-256, the raw code is never stored and never retrievable after creation — only shown once at creation/rotation time), `admin_seat_claimed` (boolean, flips atomically on first redemption so two simultaneous first-redemptions can't both win the admin seat), `k_floor_override` (nullable int — `null` uses the global default, §12.6), `allowed_email_domains` (nullable `text[]` — optional redemption allowlist), `deactivated_at` (nullable timestamptz, §12.15).

**`institution_memberships`** — one row per `(user_id, institution_id)` pair, unique constraint on that pair (a user can belong to several institutions, one row each). `role` (`'admin' | 'member'`, default `member`), three separate consent booleans (§12.5): `consent_aggregate`, `consent_aggregate_backfill`, `consent_shared_cohort`. `joined_at`.

**`consent_audit_log`** — append-only, one row per consent-toggle write: `user_id`, `institution_id`, `field_changed` (one of the three consent field names), `old_value`, `new_value`, `changed_at`. No update or delete path exists anywhere in the codebase for this table.

**`cohorts`** / **`cohort_memberships`** — a named sub-group within one institution (e.g. "Leadership", "Product"), many-to-many with members (a user can be in more than one cohort). Note: Sprint 1 originally added a single `cohort_id` column directly on `institution_memberships`, anticipating one-cohort-per-membership; Sprint 3 dropped that column in favor of this proper many-to-many join table once the plan called for users belonging to multiple cohorts.

**`user_institution_preference`** (Sprint 5) — one row per user, `active_institution_id` (nullable FK). Backs "which institution's context am I currently viewing" for a user in more than one institution — a small dedicated table rather than `localStorage` or `auth.users` metadata, specifically so the choice carries across devices like any other account setting.

**`seen_unlock_notices`** (Sprint 5) — one row per `(user_id, dim, scope_type)` the first time a given benchmark panel became visible to that user, where `scope_type ∈ {'institution', 'platform', 'rollup'}`. Powers a one-time "this just unlocked" toast (§12.13) that never re-fires, even across devices.

**Row Level Security:** `institutions` and `institution_memberships` are both RLS-enabled with SELECT-only policies for the `authenticated` role (a user can see institutions/rows they belong to). There is deliberately **no INSERT policy for the authenticated role on either table** — membership rows and institution rows are created exclusively by service-role routes (`/api/institutions/redeem`, `/api/admin/create-institution`), never directly by the client. Same posture on `cohorts`/`cohort_memberships` (service-role-only writes) and `consent_audit_log` (service-role-only writes, and no admin-facing SELECT policy at all — see §12.5 for why). `user_institution_preference` and `seen_unlock_notices` are the two exceptions: plain account-level user data with no privacy-sensitive consent semantics, so they allow direct client INSERT/UPDATE under RLS rather than routing through a service-role endpoint.

### 12.3 Redemption, Onboarding & Sub-Institutions

**`POST /api/institutions/redeem`** — `{ code: string }`. Hashes the submitted code and looks it up against `unlock_code_hash`. Rejects if the institution is deactivated (`deactivated_at` set), if `allowed_email_domains` is set and the caller's email doesn't match, or if the code doesn't resolve at all — all as a generic "Invalid unlock code" to avoid leaking which failure mode occurred. On success: inserts an `institution_memberships` row, and if this is the institution's first-ever redemption, atomically flips `admin_seat_claimed` and sets `role = 'admin'` for this user (a conditional `UPDATE ... WHERE admin_seat_claimed = false` pattern, closing the race between two simultaneous first-time redeemers).

**`app/institution/join/page.tsx`** — a standalone, linkable "enter your unlock code" page, added specifically because before this page existed, the redeem endpoint had existed since Sprint 1 with **zero UI path to reach it**. Deliberately a full page rather than a modal — an admin distributing a code to their org needs a shareable link ("go to quorum.app/institution/join and enter this"), not an instruction to find a buried settings toggle.

**Sub-institutions (conglomerate hierarchy):** `POST /api/institutions/[institutionId]/admin/codes` with `{ action: 'create_child', name, allowedEmailDomains? }` — only callable by an admin of the **parent**, mints a new `institutions` row with `parent_institution_id` set and its own fresh unlock code. This is what populates the rollup tier (§12.8).

**Code rotation:** same route, `{ action: 'rotate' }` — invalidates the old code, generates and returns a new one (shown once). Does **not** reset `admin_seat_claimed` — that flag is specifically about who won the admin seat on the *original* first-ever redemption, unrelated to later rotations.

### 12.4 RBAC

**`lib/institution-auth.ts` → `requireInstitutionRole(req, institutionId, allowedRoles[])`** — the single shared guard every admin route calls first. Resolves the Bearer token to a user via the anon Supabase client, looks up that user's `institution_memberships` row for the given institution, and checks `role` against the allowed-roles list. Returns `{ ok: true, auth: { userId, role } }` or `{ ok: false, error, status }` (`401` unauthenticated, `403` wrong role, `404` not a member at all). This is the **first real caller** of this pattern — every admin-portal route (roster, codes, cohorts, role assignment, dashboards) reuses it rather than reimplementing its own check.

**`POST /api/institutions/[institutionId]/admin/role`** — `{ userId, role: 'admin' | 'member' }`. One safety rule not in the original plan doc, added as a direct consequence of the RBAC model rather than an explicit spec item: **refuses to demote an institution's last remaining admin** (`409` if the target is the sole admin) — with zero admins, no one could ever promote anyone back, permanently locking the institution out of its own admin routes.

### 12.5 Consent Model

Three independent boolean flags per membership, not one:
- **`consent_aggregate`** — included in this institution's forward-looking aggregate benchmark views (§12.7) going forward from when consent is granted.
- **`consent_aggregate_backfill`** — separately, whether *past* sessions (predating consent) are retroactively included. Defined and stored but — worth flagging — **not read by any of the Sprint 4/6 aggregate views**, which all filter purely on `consent_aggregate = true` with no backfill-specific branch. As written, granting `consent_aggregate` includes all of a user's qualifying sessions (past and future) in the aggregate the moment consent is granted; the backfill flag exists in schema and in the consent API but has no distinct effect yet. Worth a decision (implement the distinction, or drop the column) before this is surfaced to real users as if it does something.
- **`consent_shared_cohort`** — separately gates inclusion in cohort-level peer insights (§12.10), independent of the aggregate flags.

**`POST /api/institutions/consent`** — toggles one or more of the three fields on the caller's own membership row and writes a matching `consent_audit_log` row. **Correction (this pass, per Kunal's own tracked tech debt): these are two separate Supabase calls (`.update()` then `.insert()`), not one DB transaction** — the route's own in-code comment already flags this and sketches the fix (a `supabase.rpc('toggle_consent', {...})` wrapping both writes in a single Postgres function). If the audit insert fails immediately after the membership update succeeds, the consent change still takes effect (correct user-facing behavior) but the audit trail silently gets a gap — `console.error` fires server-side either way, so this fails loud in logs, not silently in the data. Logged as **Tech Debt #1** in Kunal's tracker, explicitly scoped for the Hardening/Edge-Cases sprint (see §12.9's naming note on why "which sprint" is worth being careful about) rather than fixed ad hoc. **`GET /api/institutions/consent/history`** — the caller's own audit trail.

**Admin visibility is deliberately asymmetric — counts, never identities:**
- **`GET /api/institutions/[institutionId]/consent-changes`** — admin-only, returns counts of consent-field changes per field over the last 7 days ("3 members changed `consent_aggregate` this week"). The underlying query only ever selects `field_changed` and `changed_at`, never `user_id` — enforced by the query shape itself, not just response formatting, and there is no RLS SELECT policy granting an admin row-level access to `consent_audit_log` at all, by design.
- **`GET /api/institutions/[institutionId]/admin/consent-rate`** — admin-only, returns an opt-in *rate*, but only once **total membership** (not the consenting count) clears that institution's K-floor: `{ belowFloor: true, memberCount }` otherwise. Deliberately gated on total membership rather than on the consenting count, because gating on the consenting count would leak almost the same information the gate exists to hide — a rate that only appears once enough people *consented* already tells you consent is high, even with no number attached.

### 12.6 The K-Floor Privacy Mechanism

**`lib/k-floor.ts`** — `DEFAULT_K_FLOOR = 20` (mirrored independently in SQL as `k_floor_default()`, currently also `20` — **if one changes, the other must change in the same commit**, there is no single source of truth enforced across the boundary). `effectiveKFloor(override)` returns the institution's own `k_floor_override` if set, else the default.

**"Absence is the mechanism," not a suggestion:** every aggregate view (§12.7, §12.9) enforces the floor via SQL `HAVING count(distinct user_id) >= k_floor` at the view level — a segment below the floor doesn't exist as a row in the view at all. There is no "locked" placeholder row with a count attached anywhere in the standard member-facing surfaces; a dimension that hasn't cleared the floor is simply absent from the response, matching the same privacy posture used for the personal cross-user Peer Benchmark (§3.13, `MIN_CLUSTER_SIZE = 5` there — a different, looser floor for a different, non-institutional feature). One explicit exception, flagged in its own route's comments as a deliberate, scoped call rather than a precedent: the admin aggregate/rollup dashboards (§12.11) also key purely off "did this clear the floor," with no separate "locked dimensions with their current count" view built for admins either — that would need its own authorized-exception decision, not assumed by default.

### 12.7 Aggregate Benchmark (Institution-Level)

**Views:** `institutional_platform_benchmark_segments` (across every consenting user, all institutions combined) and `institutional_benchmark_segments` (scoped to one institution, using its own `k_floor_override`).

**What's actually being measured — this is a population-level version of the personal Calibration Engine (§3.5), not a structural-similarity comparison:** for each of the 14 ontology dimensions, sessions are bucketed `HIGH` (dimension score ≥ 4) or `LOW` (≤ 2) — same threshold convention as the personal calibration engine — and average `outcomes.calibration_delta` is computed within each bucket. `gap = high_avg_delta − low_avg_delta`; `is_signal = |gap| ≥ 0.4` — same `MIN_GAP` constant as the personal version. In plain terms: "at this organization, people who rate a decision as highly [dimension] tend to be meaningfully more/less well-calibrated about it than people who rate it low on that same dimension" — an org-level pattern, not "here's what your peers decided."

**Eligibility:** a session only contributes if its owning user has `consent_aggregate = true` on their institution membership, the session has a logged outcome with a non-null `calibration_delta`, and has a completed ontology vector. The platform-wide view additionally deduplicates by `user_id` *before* joining to session data — a user in more than one institution's consenting membership would otherwise have their sessions double- (or triple-) counted, inflating both `n` and the average.

**`getBenchmarkForDimension(dim, institutionId)`** (`lib/aggregate-benchmark.ts`) — the actual tiering/fallback logic: query the institution-scoped view first (if `institutionId` is non-null); if that returns nothing (below floor, or no `institutionId` at all — e.g. a user with no active institution), fall back to the platform-wide view; if that also returns nothing, return `{ scope: { type: 'insufficient' } }`. Every benchmark number returned to the UI carries this `scope` tag inline (`institution` / `platform` / `insufficient`), so the UI can label which population a given number came from rather than presenting it as unscoped truth.

**`GET /api/institutions/benchmark`** — the member-facing route wrapping this. Notably reachable by **any authenticated user, institution member or not** — a non-member simply always gets routed to the platform-wide tier (or `insufficient`). When insufficient, the response additionally attaches **progress-toward-floor** counts (§12.13) rather than a bare "no data."

### 12.8 Cross-Institution Rollup (Conglomerate Tier)

**View:** `institutional_rollup_benchmark_segments` — built **exclusively** from child institutions' own already-floor-cleared rows in `institutional_benchmark_segments`, never from raw session/outcome data directly (verifiable by construction: the view's only `FROM`/`JOIN` targets are `institutional_benchmark_segments` and `institutions`). Aggregation is an **n-weighted average across children**, not a flat average-of-averages — a child institution with 80 consenting members doesn't count equally with one that has 21.

**Requires ≥ 2 contributing children**, not 1 — a rollup built from exactly one child's numbers would just be that child's already-floor-cleared number relabeled as the parent's, which both defeats the purpose of rolling up and edges toward isolating a single population as a de facto identifiable segment (the exact thing K-floor gating exists to prevent), even though that one child's number had already independently cleared its own floor.

**`getRollupBenchmarkForDimension()`** — a deliberately **separate entry point**, not a third rung appended to `getBenchmarkForDimension()`'s fallback chain, because it answers a different question ("what does this whole conglomerate look like") rather than serving as a fallback for an individual member's own institution-then-platform lookup.

**`GET /api/institutions/[institutionId]/admin/rollup-dashboard`** — admin-of-the-parent-only, returns every dimension that's cleared the rollup floor for that parent, in one query. This route (plus the equivalent aggregate-dashboard route, §12.11) is the first thing in the codebase that actually *reads* this view or `getRollupBenchmarkForDimension()` — both existed at the schema/library level since earlier sprints with no route or UI surface reaching them until Sprint 5.

### 12.9 Bias Parameter Benchmark ("Sprint 6" per SQL filename — see naming caveat below)

> **Naming caveat (this pass):** this document (and the corresponding handover-doc entries) labeled this work "Institutional Sprint 6" purely because the migration file is named `institutional_sprint6_bias_parameter_view.sql`. Kunal's own tech debt tracker refers to a **different, not-yet-built "Sprint 6 (Hardening, Edge Cases, Rollout)"** as the sprint where currently-open institutional tech debt (§12.17) gets swept. These are not the same sprint — the SQL filename numbering is informal/build-order, not the authoritative sprint plan. Do not read "Sprint 6" anywhere in this document as "the hardening sprint has already happened" — it hasn't. Where this document says "Sprint 6" elsewhere, it means the bias-parameter-view work specifically, never the hardening sprint.

A second, separate aggregate-view type — deferred out of Sprint 5 by explicit decision because it needed a different join path: the Sprint 4 views key on the 14-dimension ontology vocabulary, but `bias_library` (and the client's `PatternTile` component that displays it) is keyed by `bias_parameter`, a different vocabulary entirely.

**Views:** `institutional_platform_bias_parameter_segments`, `institutional_bias_parameter_segments` — per `bias_parameter`, `member_count` and `avg_confidence_weight`, same `k_floor` gating as §12.7.

**A genuine cross-cutting data-modeling gap, surfaced by this join:** `bias_library` is keyed by `user_email` (text), not `user_id` — a pre-institutional design choice from before auth existed, per that table's own original migration comment ("identifier until auth is added"). This view bridges the two by joining through `auth.users.email`. Consequence: if a user's `bias_library` rows were written under an email that no longer matches their *current* `auth.users.email` (e.g. they changed their login email since), those rows silently fall out of this join. This isn't a new gap introduced by the institutional layer — it's the same identity-continuity gap that exists anywhere else in the app reading `bias_library` by current session identity — but the institutional views are where it was actually documented.

**Deliberately excluded fields:** `activation_contexts` and `detection_count`/`asymmetry_score_avg` are never selected into these views — `activation_contexts` in particular can carry decision-specific free text (per its own column comment), which is exactly the kind of thing an aggregate, anonymized view should never expose even in summary form.

### 12.10 Cohorts

**`lib/cohort-insights.ts`** — computes peer insights for a member's own cohort(s): for each cohort the caller belongs to, every **other** member who has both (a) a `cohort_memberships` row in that same cohort and (b) `consent_shared_cohort = true` — **mutual** consent is required; a member consenting alone sees no peers, and their own data isn't shown to others who haven't also consented. Returned per peer: `sessionScore` (latest Session Reliability Index, §3.9), `sessionScoreDelta`, `calibrationDeltaAvg`, and `biasParameters` (their confirmed bias labels) — never raw decisions, never session content, from either side.

**`components/CohortInsightsCard.tsx`** — renders on a member's own Mirror page, `id="msec-cohort"`, titled "Your Cohort." Renders `null` entirely (no UI element implying a cohort exists at all) if the member isn't in any cohort with at least one other mutually-consenting peer — matching the "absence, not an empty state" pattern used throughout this layer. **Notably not gated on `mirror_access`/paid tier** — reachable by any authenticated institution member regardless of whether they personally hold a paid Mirror subscription (see §12.17 for the billing implications of this).

**Admin cohort management** — `GET/POST /api/institutions/[institutionId]/admin/cohorts` (list all cohorts with resolved member emails; create an empty cohort — creation and population are kept as separate actions/routes deliberately, since they have different failure modes worth keeping distinct) and `POST/DELETE /api/institutions/[institutionId]/admin/cohorts/[cohortId]` (add/remove a member — verifies the target is already an institution member before allowing cohort addition; delete cascades to `cohort_memberships` via `ON DELETE CASCADE` but never touches `institution_memberships` — removing a cohort never removes anyone from the institution itself).

### 12.11 Admin Console

**`app/institution/admin/page.tsx`** — a single-page dashboard (no tab routing), loading all of the following on mount for whichever institution(s) the caller administers: roster, code status, consent-change counts, consent rate, aggregate benchmark dashboard, cohort list, rollup dashboard.

- **Roster** (`GET .../admin/roster`) — `{ userId, email, role, joinedAt }[]`, membership metadata only, no consent flags and no session/bias data. **Flagged cost note in the route's own comments, not fixed:** there is no bulk "get users by ID" in `supabase-js`, so email resolution is one `auth.admin.getUserById()` call per member — an N+1 pattern, fine at pilot scale, worth replacing with a single Postgres join before a large institution tier. The same N+1 pattern is reused for the cohort roster.
- **RBAC assignment** — §12.4.
- **Code management** — rotation and child-institution creation, §12.3.
- **Consent activity & rate** — §12.5.
- **Aggregate dashboard** (`GET .../admin/aggregate-dashboard`) — every dimension that's cleared this institution's floor, queried directly against `institutional_benchmark_segments` for `institution_id = X` in one call, rather than calling `getBenchmarkForDimension()` 14 times — a deliberate choice, since that function is built for "check one dimension the UI is currently showing," a different shape of question than "give me everything this institution has."
- **Rollup dashboard** — §12.8, same "one call for everything" reasoning, admin-of-the-parent only.

### 12.12 Synthesis-Time Injection

Covered in full at §2.4.2 Layer 6.5 — when a decision belongs to an institution member and at least one dimension of that decision has cleared the institution's floor, the relevant aggregate benchmark context is appended to the synthesis prompt as **additive, non-mandatory** framing ("members facing similar decisions at your organization tend to score X on dimension Y"), positioned after the MANDATORY Council Weighting directive and before the equally-non-negotiable RET-5 continuity directive (§2.7). This is the only point in the entire product where institutional aggregate data reaches the language model directly, rather than only ever being rendered client-side in a dashboard.

### 12.13 Unlock Notices & Progress-Toward-Floor

**`lib/unlock-notices.ts`** + `seen_unlock_notices` table (§12.2) — the one-time "this benchmark just became available" toast, keyed per `(user, dim, scope_type)` so institution-level and platform-level unlocks for the same dimension are tracked as genuinely separate events (an institution's own population clearing its floor for the first time is a more notable moment than the platform fallback, which is close to always available).

**`lib/unlock-progress.ts`** — when a dimension is `insufficient` (§12.7), computes how far the relevant population is from clearing the floor and returns a progress figure (e.g. "your institution needs N more consenting members before this unlocks") rather than a bare "not enough data" — this is what `GET /api/institutions/benchmark` attaches to an `insufficient` response.

### 12.14 Restricted DB Role — Defined, Not Wired

`institutional_sprint4_restricted_role.sql` defines a narrower Postgres role (`aggregate_reader`, name approximate — see the migration file for the exact grant statements) intended to read the aggregate views specifically, without the blanket table access `service_role` has. **As of this pass, every institutional route (`lib/aggregate-benchmark.ts`, `lib/bias-parameter-benchmark.ts`, `lib/cohort-insights.ts`, and every admin route) still calls `createServiceClient()`** — the same full-access service-role client used everywhere else in the app. The restricted role exists in the database but nothing in the application code has been switched to use it. This is explicitly flagged in the migration's own comments as a follow-up, not silently forgotten — but it means the current blast radius of any bug or injection in the aggregate-serving code path is "full service-role access to every table," not the narrower surface the restricted role was built to provide. Worth prioritizing before institutional data volume or the number of pilot orgs grows.

### 12.15 Tier 3 — Deactivation

A single nullable column, `institutions.deactivated_at` (not an `is_active` boolean, and not a hard delete). Setting it: blocks all *new* redemptions against that institution's code (`redeem` checks it and rejects with the same generic error as an invalid code) and hides the institution from the platform-admin's active-institutions view. It does **not** retroactively change any existing member's consent settings, delete any data, or remove any membership row — existing members keep functioning exactly as before. Deliberately scoped to soft deactivation only: the migration's own comments note that a genuine hard-delete (cascading through memberships, cohorts, consent history, seen-notices, and the active-institution preference table) is a materially more hazardous operation than this migration was willing to bundle in "while already touching this file," and would need its own explicit decision plus almost certainly its own confirmation UI.

Toggled via `PATCH`-style body on `POST /api/admin/create-institution` (`{ deactivate: true | false }`, platform-admin-only, §12.16) — there is no institution-admin-facing self-deactivation path; only the platform operator can deactivate an institution.

### 12.16 Institution Creation (Platform-Admin-Only)

**`POST /api/admin/create-institution`** — gated by the `ADMIN_CODE` env var (same secret used elsewhere for platform-admin actions), **not** self-serve and **not** reachable by an institution's own admin. Creates the `institutions` row, generates and hashes the initial unlock code, returns the raw code once (never retrievable again — only rotatable via §12.3). Also supports listing/updating existing institutions (name, `k_floor_override`, `allowed_email_domains`, and the `deactivated_at` toggle above) behind the same `ADMIN_CODE` gate.

### 12.17 Billing Model & Known Gaps

**No in-product billing exists for Institutional Mode.** Unlike the individual Mirror subscription (§9, fully self-serve via Razorpay), there is no institutional equivalent anywhere in the codebase — no institutional Razorpay plan, no seat-based billing, no invoicing hooks. Provisioning is entirely manual and out-of-band: a platform admin creates the institution via `ADMIN_CODE` (§12.16) and distributes the unlock code directly (consistent with the existing Advisory-tier posture of "pricing emerges from direct outreach, not a checkout page," per the product's GTM approach). This is presumably intentional at pilot stage, but worth naming explicitly since it means institutional revenue currently has zero technical connection to the product's payment system — it's tracked, if at all, entirely outside the codebase.

**A related, non-obvious product point worth surfacing:** an institution member gets access to Cohort Insights (§12.10) and, if their own institution has cleared K-floor, sees themselves contributing to the institutional aggregate benchmark — **regardless of whether they personally hold a paid Mirror subscription**. `mirror_access` (§3.1) and institutional membership are two entirely independent gates; nothing in `lib/mirror-access.ts` has any awareness of institutions at all. In effect, institutional membership currently opens a parallel, Mirror-subscription-independent path to a meaningful slice of Mirror-adjacent functionality. That's presumably the intended commercial shape (the institution's arrangement is what's being paid for, not each member's individual subscription) — but it's worth confirming that's the deliberate model rather than an oversight, since it means an institutional deal currently has no natural mechanism to also convert members into individual paying subscribers.

**Other flagged, not-yet-fixed items — as of this pass, cross-checked against Kunal's own tracked tech debt list (`TECH_DEBT.md`), which is now the authoritative source for the two items marked below rather than this document's own code-reading:**
- **[Tech Debt #1, tracked]** `POST /api/institutions/consent` writes the membership update and the audit-log insert as two separate calls, not one transaction — see §12.5 for the failure mode. Scoped by the tracker for the (not-yet-built) hardening sprint.
- **[Tech Debt #2, tracked]** Roster and cohort-insights email resolution is N+1 (`auth.admin.getUserById()` per member/peer, confirmed present in both `.../admin/roster/route.ts` and `lib/cohort-insights.ts`) — the tracker's own proposed fix is a Postgres function joining `institution_memberships`/cohort peers to `auth.users` directly, called once via `supabase.rpc(...)` instead of N calls, with both call sites moved to it together. The tracker flags this as urgent specifically **before onboarding any institution near the top of the size tiers described in Kunal's institutional plan document, Section 1.1** — a plan this document doesn't have visibility into; worth attaching or summarizing here if it continues to inform gap-prioritization in future passes.
- `consent_aggregate_backfill` is stored and settable but has no distinct effect on any current aggregate view (§12.5).
- The restricted `aggregate_reader` DB role is defined but not wired into any application code (§12.14).
- Account deletion doesn't clean up `institution_memberships` or `cohort_memberships` (§1, noted at the top of this document).
- `k_floor_default()` (SQL) and `DEFAULT_K_FLOOR` (`lib/k-floor.ts`) are two independently-maintained copies of the same constant (`20`), with no shared source of truth — a future change to one without the other would silently desync the privacy floor between the application layer and the views themselves (§12.6).

**On the tracker itself:** `TECH_DEBT.md` is structured as an Open/Resolved log tied to specific sprints, with each item's origin sprint and intended close point recorded — a tighter, more disciplined format than this section's flat list. Worth considering whether the other items above (all found by reading code/migrations rather than tracked deliberately at build time) belong folded into that file going forward rather than living here — this document is better suited to explaining *what a thing is*, the tracker to *what's owed on it and when it's due*.

---

*End of Quorum Technical Specification*  
*Document generated June 2026 from codebase analysis; substantially revised July 2026 to correct drift from external code changes and add full Institutional Mode coverage (§12).*
