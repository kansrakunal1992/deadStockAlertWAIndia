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
   - 2.7 Decision Continuity
   - 2.8 Persona Relevance
   - 2.9 Outcome Recording
   - 2.10 Decision Brief PDF
   - 2.11 Session History & Labels
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
4. [Decision Graph Engine](#4-decision-graph-engine)
   - 4.1 Edge Types & Canonicalization
   - 4.2 Live Structural Edges
   - 4.3 Backfill Engine
   - 4.4 Graph Synthesis Context
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
`sessions`, `messages`, `examiner_responses`, `sessions_ontology`, `bias_library`, `structural_matches`, `structural_scores`, `outcomes`, `contradictions`, `contradiction_runs`, `contradiction_log`, `avoidance_alerts`, `mirror_access`, `user_preferences`, `independence_score_log`, `push_subscriptions`, `notification_log`, `audit_log`, `graph_edges`, `user_profiles`

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
  "device_id": "string (optional, from localStorage)"
}
```

**Backend logic:**
1. Validates `decision` field is non-empty.
2. Encrypts `decision_text` and `context_text` using `encrypt()` before DB write.
3. Inserts row into `sessions` with `status = 'active'`, `validation_state = 'pending'`.
4. Sets `user_id`, `user_email`, `device_id` from request body — all optional at creation; anonymous sessions are fully supported.
5. Writes an audit log entry: `session.create`.
6. Returns `{ session_id, status }`.

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
From `lib/structural-retrieval.ts`: top-N structurally similar past decisions with cosine similarity scores, injected as `PRIOR DECISION CONTEXT:` block.

**Layer 5 — Bias History Context**  
From `fetchUserBiasContext()` in `lib/bias-scorer.ts`: the user's running bias profile. Only synthesis-eligible triggers (dimension + category types) are injected. Flag triggers are excluded due to ordering risk (see §3.3).

**Layer 6 — Decision Continuity Context**  
From `lib/decision-continuity.ts`: if this session has prior messages (user has pushed back), the full conversation thread is injected to maintain coherent multi-turn dialogue.

**Layer 7 — Graph Synthesis Context** (Sprint G4)  
From `lib/graph-engine.ts fetchGraphSynthesisContext()`: up to 6 connected past decisions with edge type labels (`structural_similarity`, `contradiction`, `shared_bias_trigger`). Includes a directive if ≥ 2 connections found: "Pattern Analyst's cross-history signal carries elevated weight."

**Layer 8 — Persona Relevance Score** (for dynamic ordering)  
`lib/persona-relevance.ts` computes a relevance weight for each persona given the current ontology vector. High-relevance personas are surfaced first in the UI.

#### 2.4.3 Persona Relevance Scoring

`computePersonaRelevanceScores()` maps ontology dimensions to persona weights:

| Persona | Primarily driven by |
|---|---|
| Contrarian | `outcome_uncertainty`, `ambiguity` |
| Risk Architect | `reversibility`, `stakes_magnitude`, `regret_asymmetry` |
| Pattern Analyst | Prior session count, `task_complexity` |
| Stakeholder Mirror | `decision_unit`, `value_conflict` |
| Elder | `time_horizon`, `identity_alignment` |
| Competitor | `time_pressure`, `emotional_intensity`, `stakes_magnitude` |

Raw scores are normalised 0–1 and returned as `{ persona_key: relevance_score }`.

#### 2.4.4 Examiner Injection Timing

The Examiner's questions are run **after** the first round of persona responses. Each persona call includes an optional `examiner_context` block if the user has already answered Examiner questions — this prevents personas from re-asking questions the Examiner already covered.

#### 2.4.5 Streaming

All persona calls stream via the Anthropic streaming API. The route sets `Transfer-Encoding: chunked` and sends SSE-style deltas. Streaming is per-call; the client fires 6 parallel persona calls and renders each independently as chunks arrive.

---

### 2.5 Examiner System

**Route:** `GET /api/examiner` (fetch next question), `POST /api/examiner` (submit answer)  
**Library:** inline in route, `lib/bias-scorer.ts` (bias firing)  
**Rate limit:** 40 per 10 minutes per IP

The Examiner is Quorum's cross-cutting interrogator. It surfaces clarifying questions drawn from structural gaps in the user's reasoning, and fires bias scoring as a side-effect.

#### 2.5.1 Question Generation (POST)

**Input:** `session_id`, `user_message` (pushback or initial trigger)

The route assembles a `MAX_QUESTIONS = 3` cap per session. Logic:
1. Counts existing `examiner_responses` rows for this session — if already at cap, returns `{ done: true }`.
2. Fetches all prior persona messages + prior examiner Q&As.
3. Sends to Examiner AI (hard-pinned to Anthropic):

**Examiner System Prompt** includes:
- Role: `You are The Examiner — the interrogator who finds what's missing from the council's analysis`
- Instruction to generate ONE specific question targeting the weakest reasoning gap
- Must NOT repeat any question already in the session
- Must NOT ask about things already in decision_text or context_text
- Question must be answerable by the decision-maker (not hypothetical)
- Returns raw question string (no JSON, no formatting)

4. Saves the question to `examiner_responses` with `question_order`.
5. **Fire-and-forget:** calls `fireBiasScore()` from `lib/bias-scorer.ts` in the background — this is intentionally not awaited so it doesn't block question delivery.

#### 2.5.2 `fireBiasScore()` — Bias Scoring Side-Effect

Called for every examiner interaction. Sends the full decision context (decision text, context, prior persona outputs, examiner Q&A) to the bias scorer AI with a structured system prompt listing all 18 bias parameters. Returns a list of fired biases with `confidence_weight` (0–1) and `activation_context` (JSON with `urgency_present`, `counterparty_present`, free-text fields).

Updates `bias_library` rows using a **running exponential average** formula:
```
new_confidence_weight = (old_confidence_weight × (n - 1) + new_confidence_weight) / n
```
Where `n = detection_count` after increment.

#### 2.5.3 Question Selection (GET)

**Input:** `session_id`

Returns the **oldest unanswered** examiner question (ordered by `question_order ASC`, filtered to rows where `response_text IS NULL`). The client polls this to know whether the Examiner has a pending question.

#### 2.5.4 Answer Submission (POST with `response_text`)

1. Validates session ownership.
2. Saves `response_text` (encrypted) to `examiner_responses`.
3. Triggers contradiction detection pipeline as fire-and-forget: calls `POST /api/mirror/contradictions` with `sessionId` (see §3.6).
4. Returns `{ saved: true }`.

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

#### 2.6.4 Context Block Construction

The retrieved matches are assembled into a `PRIOR DECISION CONTEXT:` text block injected into persona prompts. Each match entry shows:
- Truncated decision text (80 chars)
- Score
- Top matching dimensions (human-readable)

---

### 2.7 Decision Continuity

**Library:** `lib/decision-continuity.ts`

Handles multi-turn dialogue within a session — when the user pushes back on a persona's response.

**How it works:**
- The `messages` table stores all persona outputs (`role = 'assistant'`) and user pushbacks (`role = 'user'`), keyed by `session_id` and `persona`.
- When a user sends a pushback message to a specific persona, the full prior thread for that persona (all assistant + user messages in chronological order) is injected into the next persona call as the conversation history.
- The pushback message is prefixed before being saved: `[User pushback to ${persona.label}]: ${pushback_text}` — this prefix is stripped before rendering in UI but is visible to the AI, giving it context about who the user was challenging.
- `buildDecisionContinuityContext()` returns an array of `{ role, content }` messages formatted for the AI API.

**Pushback flow:**
1. User types a pushback in the UI.
2. Client calls `POST /api/record` with `{ session_id, persona, content }`.
3. Message saved encrypted to DB.
4. Client re-calls `POST /api/persona` for that specific persona.
5. The persona route fetches the full thread and includes it in the API call as `messages` array (multi-turn mode).

---

### 2.8 Persona Relevance Scoring

**Library:** `lib/persona-relevance.ts`

Computes a 0–1 relevance weight for each of the 6 personas, given the current session's ontology vector. Used by the UI to rank which advisors to surface prominently.

**Formula per persona (weighted dimension lookup):**
```
relevance_score = Σ (dim_score × persona_weight[dim]) / Σ persona_weight[dim]
```

Scores are normalised so the sum across all personas = 1. The highest-relevance persona is suggested as "start here."

Also returns a `session_label` — a short descriptive phrase for the type of decision (e.g. "High-stakes irreversible commitment under time pressure") assembled from the top-scoring dimensions.

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

**Route:** `GET /api/history`  
**Library:** `lib/session-labels.ts`, `lib/dates.ts`

Returns all sessions for the current user (or by `sessionIds[]` from localStorage for anonymous users), with:
- Decrypted `decision_text` (truncated to 120 chars for list view)
- `session_label` — a generated 4–6 word title derived from the decision text using `buildSessionLabel()` (AI-free: takes the first meaningful noun phrase)
- `validation_state`, `status`, `created_at`
- Outcome quality if an outcome row exists

**Date formatting:** `lib/dates.ts` provides locale-aware relative date formatting (`3 days ago`, `last Tuesday`, etc.) with IST timezone as default.

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

Per-session quality metric — how reliable was the reasoning process in a given session, regardless of outcome?

**Reliability dimensions per session:**

| Dimension | Formula |
|---|---|
| `examiner_engagement` | Was the Examiner used? Were answers substantive (≥ 50 chars avg)? |
| `persona_diversity` | Number of distinct personas engaged ÷ 6 |
| `pushback_depth` | Did the user push back? Mean pushback length |
| `context_completeness` | Was `context_text` provided? Length normalised 0–1 |
| `time_on_decision` | Time between session creation and last message (in minutes, capped at 60) |

**Sub-scores each 0–1, then combined:**
```
session_reliability = (examiner_engagement × 0.3) +
                      (persona_diversity × 0.25) +
                      (pushback_depth × 0.2) +
                      (context_completeness × 0.15) +
                      (time_on_decision × 0.1)
```

`computeUserSessionScores()` returns an array across all user sessions, most recent first. Mirror Summary uses `scores[0].actionPlan` for the `nextAction` field.

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

### 3.13 Benchmark Module

**Route:** `GET /api/mirror/benchmark`  
**Access:** Advisory tier only

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
**Schedule:** `0 2 * * *` (02:00 UTC — runs BEFORE daily-nudge)

Targets users with sessions in `validation_state = 'pending'` for more than N days. Uses `validation_pending` theme variants from the nudge copy bank.

**Targeting:**
- Sessions created > 3 days ago with `validation_state = 'pending'` AND no outcome row
- User must not have `validation_nudge_opted_out = true`
- `canSendNudge()` gate must be clear

**Sends email + push combo, claims shared notification slot (`recordNudge(userId, 'validation_nudge')`).**

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

*End of Quorum Technical Specification*  
*Document generated June 2026 from codebase analysis.*
