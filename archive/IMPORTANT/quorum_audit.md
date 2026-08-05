# QUORUM — ARCHITECTURE AUDIT REPORT
### Sprint 20 Codebase · Full Risk Verification + Hidden Risk Discovery + Website Claims Audit + Naomi Competitive Lens

---

## SECTION 0 — AUDIT METHODOLOGY

This audit reads directly from source: `rule-engine.ts`, `structural-retrieval.ts`, `bias-scorer.ts`, `personas.ts` (1099 lines), `app/api/persona/route.ts`, `app/api/examiner/route.ts`, `app/api/mirror/*` routes, `lib/mirror-fingerprint.ts`, `lib/independence-score.ts`, `lib/contradiction-detector.ts`, and the full website `index.html`. Every verdict below is traceable to a specific code location. Naomi product analysis comes from `naomihq.com` and the comparative document provided.

---

## SECTION 1 — PROMPTED RISKS: FULL VERDICTS (R1–R11)

---

### R1 — Structural similarity scores computed but NOT used quantitatively in reasoning

**VERDICT: PARTIALLY TRUE — overstated as written, but a real problem**

**Evidence:**

The score IS used as a binary gate. `MATCH_THRESHOLD = 45` in `structural-retrieval.ts` determines whether any structural context appears at all — so the number does influence the system. The comment explicitly acknowledges this is conservative: *"corpus at ~60 decisions; threshold set conservatively (≥45/100)."*

The real problem is what happens AFTER the gate. A match scoring 47/100 and one scoring 95/100 produce **identical context text injections**. The annotation engine converts both into prose with the same framing authority. There is no score tier (LOW / MED / HIGH) that changes how the receiving persona weights the historical pattern. A near-identical past decision (95/100) is treated identically to a borderline match (47/100) in every downstream step.

Further: structural context only reaches 3 of 6 personas (`PERSONAS_WITH_STRUCTURAL_CONTEXT = new Set(['pattern_analyst', 'risk_architect', 'elder']`). Contrarian, Stakeholder Mirror, and Competitor run structurally blind to past decision memory — despite being the three personas most likely to benefit from knowing what failed before.

**Concrete fix:**

Add a score tier to the structural context block itself:

```typescript
const tier = matchScore >= 80 ? 'HIGH-CONFIDENCE MATCH'
           : matchScore >= 60 ? 'MODERATE MATCH'
           : 'BORDERLINE MATCH'
```

Prepend this to the structural block injected into the 3 receiving personas, and include a directive: `"This is a [tier] structural match ([score]/100). Calibrate the weight you assign to the historical pattern accordingly — a HIGH-CONFIDENCE MATCH warrants near-direct comparison; a BORDERLINE MATCH warrants cautious reference only."`

Additionally: expand `PERSONAS_WITH_STRUCTURAL_CONTEXT` to include Contrarian (for failure case resonance) and Stakeholder Mirror (for relationship pattern recurrence). Competitor arguably doesn't need it.

---

### R2 — Bias scores stored but NOT injected into persona or synthesis reasoning

**VERDICT: TRUE — this is the most consequential confirmed gap in the system**

**Evidence:**

`fireBiasScore()` is called from `examiner/route.ts` at lines 248 and 289 — both triggered by examiner submit/skip events, which fire **after** initial personas have already generated their outputs in most session flows. This is by design: bias scoring reads persona responses as input to compute bias signals. But the consequence is that bias scores are always post-hoc relative to the session that generated them.

More critically: even accumulated longitudinal bias data (stored in `bias_library` across many sessions, with `detection_count`, `asymmetry_score_avg`, `activation_summary`) is **never queried** in `app/api/persona/route.ts`. The synthesis call path (`isSynthesisCall = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')`) fetches `councilContext` (ontology + rules) but makes zero reference to `bias_library`.

The persona prompts themselves (e.g., CONTRARIAN) contain hardcoded HNI-calibrated descriptions of bias patterns — e.g., references to FOMO, social proof, attribution asymmetry. These are universal descriptions, not injections of the user's specific accumulated profile. A founder with 7 documented `fomo_urgency` detections across 15 sessions receives the exact same Contrarian analysis as a first-time user.

The Mirror page displays `bias_library` data beautifully. But the reasoning engine has never read a single row from it.

**Concrete fix (two-phase):**

**Phase 1 — Synthesis injection (2–3 days dev):**
In `persona/route.ts`, before the synthesis call, add a `fetchUserBiasContext(userId)` function that queries `bias_library` for confirmed biases (`detection_count >= 2`), ordered by `asymmetry_score_avg` DESC, limited to top 3. Construct a compressed block:

```
LONGITUDINAL BIAS RECORD (confirmed patterns across prior sessions):
— fomo_urgency [3 detections | avg asymmetry: 3.8 | signal: DISTORTING when time_pressure ≤ 2]
  Activation pattern: "Activates when a trusted contact endorses before independent view forms."
— speed_bias [2 detections | avg asymmetry: 2.9 | signal: DISTORTING when urgency self-imposed]
Your synthesis MUST explicitly assess whether either pattern appears active in this decision based on the structural profile and Council outputs. Name it directly if detected.
```

Append this to the synthesis system prompt alongside `councilContext`.

**Phase 2 — Persona injection (1 sprint):**
On initial persona calls, inject a one-line bias alert for the single highest-confidence bias if `detection_count >= 3` and `classifyBiasSignal()` returns `'distorting'` for the current session's ontology. Keep it terse — one sentence — to avoid prompt overload.

---

### R3 — Synthesis is purely prompt-based aggregation without weighting, scoring, or conflict reconciliation

**VERDICT: TRUE — with an important nuance**

**Evidence:**

The `SYNTHESIS` prompt in `personas.ts` is entirely LLM-driven. It does receive `councilContext` (ontology + rule engine output) via `basePrompt = councilContext ? \`${persona.prompt}\n\n${councilContext}\`` — so the synthesis is not completely context-free. Rule signals and ontology dimensions ARE present.

But: all 6 persona outputs arrive as raw `rawMessages` with equal implicit weight. The synthesis prompt instructs the LLM to "identify where the Council most sharply diverges" — which is a soft directive for conflict acknowledgment, not enforced reconciliation logic. The LLM can mention divergence or ignore it with no structural consequence.

There is no mechanism to reflect that on a high-irreversibility decision with R2 + R9 firing, the Risk Architect's analysis should carry more synthesis weight than the Competitor's. There is no `personaRelevanceScore` feeding into the synthesis call. Persona outputs are presented flat.

This is not catastrophic — the SYNTHESIS prompt is well-crafted and the LLM does sensible work. But synthesis quality is entirely dependent on LLM discretion rather than structural steering.

**Concrete fix:**

Before the synthesis API call, compute a `personaRelevanceMap` using already-available data:

```typescript
const relevanceMap = computePersonaRelevance(ruleEngineResult, ontologyVector)
// Returns: { contrarian: 0.82, risk_architect: 0.94, pattern_analyst: 0.79, ... }
```

Where `computePersonaRelevance` assigns scores based on which rules fired (e.g., R2 = irreversibility rule → +0.3 to risk_architect weight), which ontology dims are high (high `identity_stakes` → +0.2 to elder weight), and whether a structural match exists (→ +0.25 to pattern_analyst weight).

Inject into synthesis system prompt:

```
COUNCIL RELEVANCE PROFILE for this decision's structural type:
Primary signal: Risk Architect (0.94), Pattern Analyst (0.79)
Secondary signal: Contrarian (0.82), Elder (0.71)
Weight their outputs accordingly. Where Risk Architect and Pattern Analyst diverge from others, the divergence is structurally significant — name it and resolve it explicitly.
```

This is implementable in `persona/route.ts` before the synthesis call with no schema changes.

---

### R4 — No unified "decision scoring layer" combining structural similarity + bias signals + persona outputs + confidence

**VERDICT: TRUE — confirmed, no such layer exists anywhere in the codebase**

**Evidence:**

Four independent data streams exist with no convergence point:
- `structural_scores` table: pairwise cosine similarity (stored, retrieved for 3 personas)
- `bias_library` table: per-bias accumulation across sessions (stored, displayed in Mirror)
- `messages` table: persona outputs (stored, used in synthesis + Mirror)
- `outcomes` table: `pre_decision_confidence`, `council_helped`, `what_decided` (stored, displayed in Mirror)

No query anywhere joins these. No `session_quality_score` field exists. No endpoint produces a unified session-level signal.

This means: a session where structural similarity is 89/100, three biases are active and distorting, the Council is highly divergent, and confidence is historically uncalibrated produces no different aggregate signal than a clean, well-structured session. The system generates no summary verdict about the quality or reliability of any given analysis.

**Concrete fix:**

Add a `session_intelligence_score` computed field (or separate table) after synthesis completes:

```
session_intelligence_score = (
  structural_match_score × 0.25       // 0 if no match, scaled 0–100
  + bias_clarity_score × 0.30         // inverse of active distorting biases × asymmetry
  + council_divergence_score × 0.20   // computed from variance in persona outputs (LLM-detected)
  + confidence_calibration_delta × 0.25  // from outcomes table, historical reliability
) / 100
```

Expose this in the Mirror as "Session Reliability Index" — a single number per session that represents how structurally sound the analysis was. Over time, this metric itself becomes a calibration signal: sessions with low reliability scores that preceded bad outcomes confirm the model; sessions with high scores preceding good outcomes validate it.

This is the seed of a genuine decision quality measurement system.

---

### R5 — Structural context injected as text only (soft), not enforced as constraints

**VERDICT: TRUE — but this is partially acceptable architecture, not a pure defect**

**Evidence:**

The end of `buildCouncilContext()` appends: *"Your response must engage with the structural signals above. Do not restate them. Let them shape the depth and angle of your analysis."* This is a directive, not a constraint. An LLM can receive this instruction and produce output that superficially engages with structural signals while ignoring their specific implications.

There is no enforcement mechanism — no scoring of whether a persona actually engaged with the structural signals, no retry logic if structural relevance is low, no structured output requirement that would force explicit citation of which structural factor shaped which paragraph.

**Why this is partially acceptable:** Fully constraining LLM reasoning via hard rules defeats the purpose of multi-perspective analysis. Some softness is the right design choice. The problem is that "soft" currently means "entirely dependent on LLM compliance."

**Concrete fix (targeted, not overengineering):**

For the 3 personas that receive structural context, add a one-sentence structured output requirement at the end of their persona prompt: *"Your final sentence must explicitly reference the single most relevant structural signal from the profile above, using the format: 'Structurally, this decision [observation about the most relevant dimension or historical match].'"*

This is lightweight enforcement that doesn't constrain the reasoning — it only requires traceability at the output level. It also makes structural factor citations visible in the UI and in synthesis.

---

### R6 — Prompt overload: multiple context layers may dilute signal

**VERDICT: LIKELY — real risk, but severity depends on decision type**

**Evidence:**

An initial persona call on a heavily flagged decision receives:
1. `registerBlock` — analytical mode framing (~100 tokens)
2. `structuralBlock` — past decision matches with annotations (~300–400 tokens, 3 personas only)
3. `DECISION: [text]` — variable
4. `contextBlock` — user context (~200–500 tokens)
5. `examinerBlock` — up to 4 personalized Q&As (~400–600 tokens)
6. `councilContext` — 14-dim ontology + triggered rules + flagged rules (~600–800 tokens)
7. `persona.prompt` — the core persona instruction (~1500–2500 tokens for long personas like CONTRARIAN)

Total injection for heavily flagged decisions: ~3500–5000 tokens before the persona even begins reasoning. For synthesis: add 6 × 300–500 word persona outputs = potentially 8000+ tokens.

All of this is within Claude Sonnet's context limits. The technical risk is not overflow — it's **signal prioritization failure**: the LLM must weight 7 distinct instruction layers simultaneously, and when they contain competing directives, recency and proximity effects may degrade the council context signals that appear earlier in the prompt.

**What would confirm it:** Compare synthesis outputs for identical decisions where (a) all context layers are present vs (b) only persona prompt + examiner block. If output quality is comparable, prompt overload is not a real issue. If (b) produces more focused outputs, context layering is causing dilution.

**Concrete fix:**

Introduce context compression for `examinerBlock` and `councilContext` when combined token count exceeds a threshold (~2000 tokens). The examiner Q&As can be compressed to key answers only (dropping the personalized question text). The council context can be truncated to top 3 dimensions + fired rules only. This preserves signal density without reducing instruction surface.

---

### R7 — Static rule system: R1–R12 fixed, not learning dynamically

**VERDICT: TRUE — by design, but the outcomes→rules feedback loop is a real missed opportunity**

**Evidence:**

Rules R1–R12 are hardcoded constants. The `outcomes` table captures `council_helped`, `what_decided`, `pre_decision_confidence`, `post_decision_confidence` — but no code in `rule-engine.ts` or anywhere else reads from `outcomes`. Rule thresholds don't adapt. Pattern detection doesn't evolve. R11 is explicitly deferred with no implementation.

`LOW_CONFIDENCE_THRESHOLD = 0.55` has no empirical basis visible in code. The comment corpus acknowledges the system is operating on a ~60-session corpus — far below the volume needed for threshold calibration.

This is partially a deliberate design: deterministic rules are a feature (reliability, debuggability). But the total absence of any outcome-informed rule adjustment means the system will never self-correct even with 500 sessions of outcome data.

**Concrete fix (conservative, not a full ML pipeline):**

Add a quarterly `rule_calibration_report` computed job:
- For each rule that fired in the past quarter, compute: avg `council_helped` when rule fired vs when it didn't
- If a rule's `council_helped` correlation is negative (rule fires → user says Council was less helpful), flag for manual review
- Output: a simple calibration dashboard for you (the founder) to review and manually adjust thresholds

This is not automated learning — it's outcome-informed manual calibration. Sustainable, auditable, and actionable without building an ML system.

---

### R8 — Thresholds are heuristic, not empirically calibrated

**VERDICT: TRUE — explicitly self-acknowledged in the codebase**

**Evidence:**

- `MATCH_THRESHOLD = 45` — comment: *"corpus at ~60 decisions; threshold to be validated as corpus grows"*
- `SIMILARITY_THRESHOLD = 0.808` in benchmark route — stated equivalence note but no validation data
- `LOW_CONFIDENCE_THRESHOLD = 0.55` — no empirical basis cited
- `MIN_SESSIONS = 5` — heuristic
- `RERUN_DAYS_THRESHOLD = 7` — heuristic

This is not a defect — it's expected at this corpus size. The risk is treating these numbers as validated when they're not. The `MATCH_THRESHOLD = 45` is particularly critical: too low means low-quality matches inject misleading historical context; too high means useful matches are excluded.

**Concrete fix:**

Build a simple threshold sensitivity dashboard (even a manual spreadsheet would work) that, for each threshold:
- Shows how many sessions it includes/excludes at current value
- Shows what changes at ±10% variation
- Flags sessions where the threshold decision (include/exclude) seems wrong on manual inspection

Set a formal review trigger: re-evaluate all thresholds at corpus = 100 sessions, again at 250.

---

### R9 — Identity overfitting: fingerprint forms from limited initial sessions

**VERDICT: TRUE — partially mitigated but not eliminated**

**Evidence:**

Bias detection can fire from a single session if `asymmetry_score >= 2.5`. The `confidence_weight` system starts at 0.30 per detection and caps at 1.0 — this is a meaningful mitigation. However, `detected = true` is set after a single asymmetry event. The `activation_summary` (which appears in the UI as "FOMO activates when...") is generated from a single detection's ontology context. A user who happens to bring a time-pressured decision first could receive an inaccurate FOMO fingerprint that then shapes all subsequent Mirror displays.

The contradiction detector requires `MIN_SESSIONS = 5` and a 7-day throttle — this is well-designed. The fingerprint narrative requires `confirmed_biases >= 2` (detection >= 2 sessions) — also reasonable. But the gap is in `activation_summary`: it's too confident too early.

**Concrete fix:**

Add a `provisional` flag to `bias_library` entries with `detection_count < 3`. Display provisional detections differently in the Mirror UI (e.g., "Emerging pattern — 1 signal detected, building confidence"). The `activation_summary` for provisional entries should read: "Potential pattern — [condition] — confirmed after more data" rather than the high-confidence framing. Only promote to full fingerprint at `detection_count >= 3`.

---

### R10 — Style calibration introduces subtle bias in advisor ordering

**VERDICT: TRUE (LOW RISK) — working as designed, effect is bounded**

**Evidence:**

`USER_STYLE_BOOSTS` applies a +1 boost to specific personas based on user style preference, and this is computed BEFORE rule/dim boosts in `computePersonaOrder()`. Since rule boosts can be +1, +2, or +3, a +1 style boost will never override a strong rule signal. The effect is limited to tie-breaking when rule signals are absent or equal.

The first-position effect is real but small: users who read advisors in order may over-weight the first advisor they encounter. However, this is a conscious UX design decision, and the effect on reasoning quality (not just experience) is minimal since all 6 advisor outputs are still generated.

**No fix required** — this is acceptable design. Monitor for a pattern where users who have a strong style preference show less diversity in which advisor outputs they engage with in subsequent sessions. If detected, randomize position slightly within the style-boosted tier.

---

### R11 — Memory thresholds are heuristic, not data-driven

**VERDICT: TRUE — acknowledged and acceptable given corpus stage**

**Evidence:**
- `PATTERNS_SESSION_THRESHOLD = 3`
- `MIN_SESSIONS = 5` for structural retrieval
- `RULES_SESSION_THRESHOLD = 8` for implicit rules extraction
- `RERUN_DAYS_THRESHOLD = 7` for contradiction re-runs

All heuristic. Given the ~60-session corpus, empirical calibration isn't yet possible. This becomes a risk at scale: a threshold of 5 that should be 12 could produce premature pattern activations for heavy users and never-activate for moderate users.

**Concrete fix:** Same as R8 — build a threshold review cadence. Additionally, make these constants configurable via environment variables rather than hardcoded, so they can be tuned without deploys.

---

## SECTION 2 — ADDITIONAL RISKS DISCOVERED IN CODEBASE

These were not in the original prompt. Ranked by severity.

---

### ADDITIONAL RISK A — `recency_bias` classification is permanently hardcoded to `'neutral'`

**SEVERITY: MEDIUM**

**Location:** `lib/bias-scorer.ts`, `classifyBiasSignal()`, line ~291

**Evidence:**

```typescript
case 'recency_bias':
  return 'neutral'   // ambiguity not in top-3 dims; default neutral for this bias
```

The comment reveals the intent: the ontology's top-3 dimensions (`decision_discriminating_info`, `time_pressure`, `reversibility`) don't provide a reliable proxy for whether recency is distorting. The solution was to default to neutral. The problem: `recency_bias` will now **always** appear as neutral in the Mirror's bias signal classification regardless of asymmetry score, regardless of how many times it's detected, regardless of how distorted the decision appears to be.

A founder who systematically misjudges new opportunities because their last deal went badly (classic recency bias) will have this documented as 'neutral' in their fingerprint — weakening the signal precisely when it matters.

**Concrete fix:**

Use `decision_discriminating_info` (decision ambiguity proxy) as the recency signal dimension. Add it to `classifyBiasSignal()`:

```typescript
case 'recency_bias':
  // Distorting when high ambiguity exists (DDI >= 4) AND the decision type
  // matches the most recent prior session's type (structural recurrence)
  if (ddInfo >= 4) return 'distorting'
  if (ddInfo <= 2) return 'neutral'
  return 'neutral'
```

This is imperfect but better than a permanent neutral. It at least catches the case where the user is making ambiguous decisions (where recency is most dangerous) and flags them.

---

### ADDITIONAL RISK B — C0 (JTBD question) is suppressed precisely on the most complex decisions

**SEVERITY: HIGH**

**Location:** `app/api/examiner/route.ts`, line 150

**Evidence:**

```typescript
const [shouldAddC0, c0Text] = ruleResult.mode !== 'REDIRECT' && allRules.length < 3
  ? [true, await personaliseRuleQuestion('C0', C0_TEMPLATE, decisionText)]
  : [false, C0_TEMPLATE]
```

C0 is the JTBD question: *"What would this decision have to deliver for you to feel it was genuinely the right call — not just in outcome, but in how it unfolded?"* This is arguably the most important framing question in the entire system — it surfaces what the user actually needs from this decision versus what they asked.

It is **suppressed whenever 3 or more rules fire**. But 3 rules firing indicates a high-complexity, high-stakes decision — exactly the case where surfacing the user's success definition matters most. A succession decision or an exit that triggers R2 + R9 + R10 loses the one question that would anchor the Council's analysis to what actually matters to the user.

**Concrete fix:**

Remove the `allRules.length < 3` condition. Always append C0 as the **final** question (after all rule questions), making it positional rather than conditional:

```typescript
const shouldAddC0 = ruleResult.mode !== 'REDIRECT'
// C0 always appended last — it anchors the JTBD regardless of rule complexity
if (shouldAddC0) {
  questions.push({
    order: questions.length + 1,
    text: c0Text,
    gap: 'C0 — CONTEXT',
    rule_id: 'C0'
  })
}
```

Maximum question count goes from 3 to 4 on complex decisions. This is a small UX cost for a significant synthesis quality gain — synthesis now always has the user's success definition to anchor against.

---

### ADDITIONAL RISK C — Benchmark (peer comparison) and structural retrieval use mathematically inconsistent similarity calculations

**SEVERITY: MEDIUM**

**Location:** `app/api/mirror/benchmark/route.ts` line 73 vs `lib/structural-retrieval.ts`

**Evidence:**

`benchmark/route.ts` `extractVector()` reads only `.score` from ontology dimensions (raw values, no weighting). `structural-retrieval.ts` `scoreVectorSimilarity()` uses `score * confidence * dim_weight` with 1.5× multiplier for starred dimensions (reversibility, identity_stakes, time_pressure, stakes_level).

These are two different similarity computations. A decision could show HIGH similarity to a peer benchmark (raw score comparison) and MODERATE structural match in personal retrieval (confidence-weighted), or vice versa. These signals would appear in different parts of the Mirror UI with no explanation of why they differ.

**Concrete fix:**

Extract the similarity computation into a shared `lib/similarity.ts` function that both `benchmark/route.ts` and `structural-retrieval.ts` call. Decide on one canonical formula: use the confidence-weighted version (from structural-retrieval) as it's more sophisticated. Update benchmark to use the same math.

---

### ADDITIONAL RISK D — R11 (Avoidance Detection) is deferred but the website makes a live claim for it

**SEVERITY: HIGH (website-product gap)**

**Location:** `lib/rule-engine.ts` lines 323–325; website copy

**Evidence:**

Rule-engine.ts comment: *"R11 — Avoidance Detection [BACKGROUND] — Deferred: requires cron job + days_open tracking. Trigger: upstream_dependency >= 4 AND days_open >= 45 AND no_new_action."*

Website copy: *"decisions you keep opening but never resolve... Surfaced without you having to ask. Not a report — an alert."* (Under Mirror · Behavioral Alerts section)

Also: *"Decisions you keep circling but not resolving — If you've been sitting with the same question for weeks, Quorum will surface why."* (Under "Bring this →" section)

These are active, present-tense product claims. R11 is fully deferred. No cron exists. No `days_open` tracking exists in the sessions table. A user who loops on a major decision for 8 weeks will receive no alert.

**Concrete fix (this is a 1–2 day build, not a sprint):**

Add `first_opened_at` timestamp to sessions table (or use existing `created_at`). Add a `status` update timestamp. Build a simple server-side check (can run on Mirror page load rather than cron for MVP):

```typescript
// In mirror/alerts route:
const openLong = await supabase
  .from('sessions')
  .select('id, decision_text, created_at')
  .eq('user_id', userId)
  .eq('status', 'open')
  .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: true })
  .limit(3)
// Surface these as alerts in the Mirror without requiring R11 to formally fire
```

This is not the full R11 (which requires structural pattern matching), but it delivers on the website's promise immediately.

---

### ADDITIONAL RISK E — The longitudinal data feedback loop does not exist at the reasoning layer

**SEVERITY: CRITICAL — this is the single most important architectural observation**

**UPDATE — Partial closure shipped (Chunk 4a/4b/4c):**

Three components now surface longitudinal memory to the user:
- `PatternSurfaceCard` — proactively shows the top-firing rule pattern (R1–R12, fire_count/total with plain-language narrative) on the home page for Mirror-unlocked users with ≥5 sessions
- `RecurringConditionCard` — surfaces the highest-recurring structural dimension (high_count ≥ 3) as a pure observation on the home page
- `ContradictionBanner` — fires post-synthesis in SessionView when a stored contradiction exists where `violationSessionId` matches the current session; includes principle source and two dismissal actions

**This closes the feedback loop at the user awareness layer.** The user now sees their patterns before and after sessions. This is meaningful: a founder who sees "In 8 of your 22 decisions, urgency was self-created" before opening the textarea brings that awareness into the session.

**The reasoning layer remains fully open.** None of these three components inject longitudinal data into Council prompts or synthesis. The synthesis still runs with zero knowledge of the user's pattern history or bias profile. The `userJudgmentContext()` function described in Section 4 is still the gap that, if closed, would make the system genuinely self-improving at the output layer.

*(Full discussion in Section 4)*

---

### ADDITIONAL RISK F — Synthesis has no access to current-session OR historical bias signals

**SEVERITY: HIGH** *(This is the synthesis-specific manifestation of R2, but distinct enough to name)*

Bias scoring fires asynchronously **after** examiner submit (examiner/route.ts lines 248, 289). Synthesis fires synchronously as part of the session. The pipeline sequence is:

```
Ontology → Examiner → Council (6 personas) → Synthesis → [async] Bias Score
```

This means synthesis runs with:
- ✅ Ontology vector (14 dims)
- ✅ Rule engine output (R1–R12 flags)
- ✅ Examiner Q&A
- ❌ Current-session bias signals (haven't been computed yet)
- ❌ Historical bias profile (never queried from bias_library)

Synthesis is the product's primary output. It produces "a call" with "traces which structural factors shaped it." But it cannot account for the user's most consequential cognitive pattern — their documented bias history — because that data is never available at synthesis time.

Fix is described under R2 (fetch from bias_library, inject confirmed biases into synthesis system prompt). No pipeline reordering required.

---

## SECTION 3 — WEBSITE CLAIMS vs IMPLEMENTATION AUDIT

| Claim | Status | Evidence | Severity |
|---|---|---|---|
| "Each advisor receives the structural profile of your decision" | **OVERSTATED** | All 6 get council context (ontology + rules) ✅, but only 3/6 get structural MEMORY (past matches). Contrarian, Stakeholder Mirror, Competitor are structurally blind to decision history. | Medium |
| "Decisions you keep opening but never resolve — Surfaced without you having to ask" | **STILL NOT IMPLEMENTED** | R11 (avoidance detection) remains deferred — no cron, no `days_open` field. PatternSurfaceCard and ContradictionBanner do NOT cover this specific claim — they surface rule patterns and principle violations, not open-loop avoidance. | High |
| "Patterns flagged before you notice them... automatically" | **PARTIALLY ADDRESSED** | PatternSurfaceCard (4a) now proactively surfaces the top rule-firing pattern on the home page for Mirror-unlocked users ≥5 sessions. RecurringConditionCard (4c) surfaces recurring structural dimensions. Contradiction detection had 7-day throttle and batch compute — ContradictionBanner (4b) now surfaces stored contradictions post-synthesis. Core claim is now substantially met for pattern + contradiction; avoidance detection (R11) remains open. | Low–Medium |
| "Synthesis... traces which structural factors shaped it" | **PARTIALLY TRUE** | Council context injected → LLM may reference ontology dims. But there's no enforced tracing, no structural citation requirement. The LLM can produce synthesis with zero explicit structural reference and nothing catches it. | Medium |
| "FOMO activates when a trusted contact endorses a deal under time pressure" — conditional bias fingerprinting | **TRUE** | `activation_summary` in bias-scorer.ts is generated from the specific ontology context of each detection. This is genuinely implemented. | — |
| "After each decision record closes, Quorum generates a structured PDF brief" | **TRUE** | `app/api/record/[id]/brief/route.ts` is implemented. | — |
| "A rising score means your judgment is compounding" (Independence Score) | **PARTIALLY TRUE** | Independence score exists and is computed per session. But the trend line (Session 1: 42 → Session 12: 89) shown on the website implies a stored time-series. Unclear if per-session scores are persisted and retrieved as a curve — verify independence_score backend has trend storage. | Low–Medium |
| "Before any advisor runs, the decision is classified across 14 structural dimensions" | **SEQUENCE INACCURACY** | The website presents Structural Analysis as Step 0. In the actual API flow: Examiner fires first (uses ontology), then personas (also use ontology). The 14-dim classification does happen before synthesis, but not strictly before all advisors. Minor but technically inaccurate. | Low |
| "Structural matching to prior capital decisions in your record is often where the real insight sits" | **UNDERSTATED** | Structural matching only reaches 3/6 personas, and only at the first message in a session. Capital decisions may get pattern_analyst and risk_architect context, but not contrarian or stakeholder mirror. The claim implies fuller integration than exists. | Low |

---

## SECTION 4 — THE SINGLE MOST CRITICAL ARCHITECTURAL GAP

**The system has no feedback loop from longitudinal memory into active session reasoning.**

**Partial closure shipped (Chunk 4a/4b/4c):** `PatternSurfaceCard`, `RecurringConditionCard`, and `ContradictionBanner` now surface longitudinal intelligence to the user at the home page (before a session) and post-synthesis (after synthesis). This is a meaningful step — users can bring pattern awareness into sessions themselves. The user-awareness layer of the feedback loop now exists.

**The reasoning layer gap remains.** The Council and synthesis still have no access to this data. A session where the user has 8 documented R5 firings (self-created urgency) still produces a synthesis with zero reference to that pattern unless the user happens to mention it in their decision text. The architecture still needs `userJudgmentContext()` to close this.

This is the root cause connecting R1, R2, R3, R4, and Additional Risk E. Name it clearly:

**The Mirror layer and the Council layer are architecturally one-way.** Data flows from sessions into the Mirror (observation, display, pattern detection). No data ever flows from the Mirror back into session reasoning. The consequence:

- Session 1 and Session 50 receive identical reasoning quality from the same user
- A founder with 8 documented sessions, a confirmed FOMO fingerprint, 3 structural matches, and a calibration showing 4-point overconfidence on identity-heavy decisions receives exactly the same synthesis quality as a first-time anonymous user
- The "compounding judgment" narrative on the website is aspirationally correct but literally false at the reasoning layer

**What Naomi gets right (and Quorum doesn't yet):** Naomi's core architectural choice is that longitudinal memory directly informs each new session's response quality. It's the entire point of the product. In Quorum, the longitudinal layer is a reporting dashboard. It is not a reasoning input.

**The fix is a `userJudgmentContext()` function:**

```typescript
async function userJudgmentContext(userId: string, sessionOntology: OntologyVector): Promise<string | null> {
  // 1. Fetch top 3 confirmed biases from bias_library (detection_count >= 2)
  // 2. Fetch calibration delta for matching decision type (from outcomes + confidence)
  // 3. Check if structural match exists (score >= 60) for this session
  // 4. Pull latest contradiction (if any, from last run)
  // 5. Compress into a ~200-token block

  return `
JUDGMENT PROFILE (${sessionCount} sessions):
Confirmed biases: [fomo_urgency | 4x | distorting under low time_pressure]
Calibration pattern: Overconfident on identity-heavy decisions by avg 3.2 points
Structural match: HIGH (87/100) — prior capital allocation, Q2 2024
Active contradiction: "Prioritise stability" vs 3 high-risk moves in 6 months
`
}
```

This block gets injected into the synthesis call (and optionally into the 3 most relevant initial personas). It is the architectural step that turns Quorum from an analysis tool into a calibration system. It is what makes "a rising score means your judgment is compounding" literally true — because the system's outputs would actually improve as history accumulates.

---

## SECTION 5 — TOP 3 RISKS BY IMPACT IF FIXED

---

### #1 — HIGHEST IMPACT: Bias scores not injected into synthesis (R2 + Additional F)

**Why it's #1:**

Synthesis is the product's primary output — the thing users read, share, act on, and evaluate the product by. Every session produces a synthesis that is equally uninformed regardless of whether it's the user's first session or fiftieth. The `bias_library` contains the most valuable personalization data in the entire system (conditional fingerprints, asymmetry scores, activation patterns) — and it has never influenced a single synthesis output.

Fixing this is the single change that would most immediately improve the quality of what the product actually produces for paying users.

**Expected improvement:**

Synthesis outputs for users with established bias profiles would explicitly name whether a detected pattern is active. Instead of: *"The Council notes a time pressure element to this decision"* — synthesis would say: *"Your documented pattern: fomo_urgency activates under exactly these conditions (trusted contact endorsement + sub-30-day timeline). This is the third time this structural configuration has appeared. The Council's analysis should be read with that context."* This is the difference between analysis and calibration.

**Implementation:**

In `app/api/persona/route.ts`, add before synthesis call:

```typescript
if (isSynthesisCall && userId) {
  const biasContext = await buildUserBiasContext(userId, currentOntologyVector)
  if (biasContext) {
    basePrompt = `${basePrompt}\n\n${biasContext}`
  }
}
```

`buildUserBiasContext()` queries `bias_library` for confirmed patterns, formats them into a ~150-token block, and includes a synthesis directive to explicitly assess active patterns. Zero schema changes. ~1 day dev work.

---

### #2 — HIGH IMPACT: No structural weighting in synthesis aggregation (R3)

**Why it's #2:**

The synthesis is the convergence point of the entire pipeline. Currently, six persona outputs arrive with equal implicit weight. The rule engine has already computed which structural dimensions are dominant, which rules fired, and which advisors are most aligned with the structural profile — but none of this information reaches the synthesis call in a form that can steer weighting.

Fixing this ensures synthesis quality is structurally calibrated: on a high-irreversibility decision with R2 firing, the Risk Architect's failure cascade analysis carries more weight than the Competitor's adversarial scan. Conflicts between structurally relevant and less-relevant advisors get explicitly resolved rather than averaged.

**Expected improvement:**

Synthesis outputs would show more precision in which perspectives they converge on. The synthesis "call" would be traceable to specific structural factors rather than being an LLM blend. Users would be able to read synthesis and understand why certain advisors' views dominated — which is what "traces which structural factors shaped it" actually requires.

**Implementation:**

Add `computePersonaRelevance(ruleEngineResult, ontologyVector)` function in `lib/personas.ts`. Returns a `personaRelevanceMap` object. Inject into synthesis system prompt as a compact directive (3–4 lines). No schema changes. ~1.5 days dev work.

---

### #3 — HIGH IMPACT: C0 suppressed on complex decisions (Additional Risk B)

**Why it's #3:**

C0 asks what success actually means to the user. Without it, synthesis produces a directional recommendation without knowing what the user would consider a win. This is particularly damaging on the most complex decisions — the ones where C0 is currently suppressed. A succession decision that triggers 3 rule flags may produce a Council analysis that's structurally rigorous but misaligned with what the founder actually needs from it.

This is also the easiest fix in the list. One line of code change. Zero schema changes. The cost is one additional examiner question on complex decisions — a small UX cost for a significant synthesis quality gain.

**Expected improvement:**

Synthesis outputs would consistently close with an assessment of whether the directional recommendation actually satisfies the user's stated success definition. Mismatches between structural recommendation and user intent would surface at the synthesis layer rather than being discovered post-decision. The C0 answer also feeds the Mirror over time — a longitudinal record of what users need from their decisions, not just what they brought.

**Implementation:**

Remove `allRules.length < 3` condition from line 150 of `examiner/route.ts`. Always append C0 as the final question. One line change. 30 minutes dev work.

---

## SECTION 6 — SYSTEM STATUS VERDICT

**Current status: (b) Partially integrated — more precisely: "Structurally integrated, longitudinally surfacing (user layer), observational (reasoning layer)."**

The system is NOT merely observational (a):
- Rule engine actively gates, redirects, and frames Council output
- Ontology classification shapes which advisors fire and with what boosts
- Examiner questions are structurally derived, not generic
- Structural context reaches 3/6 personas and synthesis
- **PatternSurfaceCard, RecurringConditionCard, ContradictionBanner now surface longitudinal patterns proactively to the user (home page + post-synthesis)**

The system is NOT fully decision-intelligent (c):
- Longitudinal data (bias, calibration, contradiction) never informs Council or synthesis reasoning
- Synthesis is unweighted and unscored
- No unified session quality signal
- C0 suppressed on complex decisions
- Session N reasons identically to Session 1 for any given user (at the reasoning layer)

**What "fully decision-intelligent" would look like:**
- `userJudgmentContext()` injected into synthesis for all sessions after threshold
- `personaRelevanceMap` steering synthesis weighting
- `session_intelligence_score` computed per session
- C0 always present
- Bias classification extended to recency_bias
- R11 live for avoidance detection

Achieving (c) is approximately one focused sprint of work. The architecture is entirely capable of it — the data exists, the pipeline exists, the injection points are clear. The gap is 4–5 targeted additions, not a redesign.

---

## SECTION 7 — NAOMI COMPETITIVE LENS: ARCHITECTURE IMPLICATIONS

The Naomi comparison surfaces something more important than a narrative observation: **it reveals a structural equivalence between Naomi's product thesis and Quorum's current architectural gap.**

Naomi's entire product value proposition is: longitudinal memory directly improves the quality of current responses. That is the one thing it does. Quorum has built a dramatically more sophisticated reasoning infrastructure — but has not yet built the feature that Naomi's entire product IS.

**Key implications by category:**

---

**On the "Mirror is the moat" thesis:**

The Naomi document is correct that the Council (6 personas) is Quorum's most replicable layer. Sophisticated multi-persona LLM prompting can be cloned. The bias_library accumulation, structural_scores corpus, calibration_delta, contradiction detector — these are uniquely personal data that compounds over time and cannot be replicated without the user's history. The Mirror IS the moat.

But there is a critical distinction to add: **the Mirror was a passive moat** — it locked users in through accumulated data but didn't actively improve their experience because data never fed back into reasoning. The shipped PatternSurfaceCard, RecurringConditionCard, and ContradictionBanner have upgraded this: longitudinal data now feeds back to the USER, which is genuinely valuable. The moat is now semi-active. The remaining step — feeding longitudinal data into synthesis quality — would make it fully active and structurally insurmountable.

---

**On website narrative vs product reality:**

The Naomi document correctly identifies that Quorum explains architecture before emotion. But there's a deeper issue: the website claims "compounding judgment" as the core value proposition — and this claim is not yet literally true at the reasoning layer. The compounding is real in the Mirror (more data = richer patterns). It is not yet real in the Council (reasoning quality doesn't compound with sessions).

The website is selling the fully-integrated version of the product. The current product delivers ~70% of that. The 30% gap is specifically the feedback loop described in Section 4. Closing that gap makes the website's claims accurate rather than aspirational — which is far more valuable than rewriting the website copy.

---

**On "one foundational human truth":**

The Naomi document recommends narrowing to one primitive. The code reveals what Quorum's actual foundational truth should be — not "AI has made analysis abundant and coherence scarce" (which is a market observation) but something closer to:

**"Your judgment record is the most valuable thing you'll never be shown — until now."**

Everything in the system supports this: bias_library accumulates what you do under pressure; calibration tracks when your confidence is reliable; contradiction detector shows the gap between who you think you are and how you actually decide; structural memory matches today's decision against your own history. The product's deepest claim is not about analysis quality — it's about self-knowledge as competitive advantage.

---

**On pre-decision alerts (the single highest-leverage Naomi-inspired feature):**

The Naomi document's most architecturally actionable insight is: *"Before the Council even runs: 'This resembles three previous decisions where urgency exceeded actual time constraints.'"*

This is R11 territory. R11 is deferred. But the data required exists: `sessions` has `created_at` and structural type; `structural_scores` has similarity values; the rule engine has computed urgency metrics. A pre-Council alert that fires when a new session's structural profile matches a prior session that the user rated poorly or resolved badly is implementable now. It would be the single most experientially differentiating feature in the product — and it would make the "patterns flagged before you notice them" website claim literally true.

This should be the priority feature in Sprint 22 or 23.

---

**On Naomi's emotional framing superiority:**

The document is correct that Naomi grounds abstraction in concrete human moments (difficult email, sister, Sunday nights). Quorum currently grounds abstraction in institutional language (exit decisions, capital allocation, succession). There is a version of this critique that applies to the PRODUCT UX, not just the website: the Mirror UI surfaces numbers and classifications without enough interpretive narrative.

The Mirror shows: "fomo_urgency — 3 detections — asymmetry: 3.8 — distorting." A more emotionally legible Mirror would say: "Three times in the past year, you moved faster than the situation required. Each time, the window you felt closing was larger than it was." This doesn't require architectural changes — it's a copy and framing change to the Mirror UI that the existing data fully supports.

---

## SECTION 8 — PRIORITIZED ACTION PLAN

Ranked by impact-to-effort ratio:

| Priority | Change | Type | Est. Effort | Impact | Status |
|---|---|---|---|---|---|
| — | PatternSurfaceCard (4a) — proactive rule pattern on home page | Component | — | High | ✅ SHIPPED |
| — | RecurringConditionCard (4c) — recurring dimension observation | Component | — | Medium | ✅ SHIPPED |
| — | ContradictionBanner (4b) — post-synthesis contradiction alert | Component | — | High | ✅ SHIPPED |
| 1 | Inject confirmed bias profile into synthesis | Code (route.ts) | 1 day | Critical | 🔴 OPEN |
| 2 | Always include C0 regardless of rule count | Code (1 line) | 30 min | High | 🔴 OPEN |
| 3 | Implement basic R11 via Mirror page load (not cron) | Code (1–2 days) | 2 days | High (fixes claim) | 🔴 OPEN |
| 4 | Add persona relevance map to synthesis directive | Code (lib + route) | 1.5 days | High | 🔴 OPEN |
| 5 | Fix recency_bias classification (remove neutral hardcode) | Code (bias-scorer.ts) | 1 hour | Medium | 🔴 OPEN |
| 6 | Add score tier to structural context block | Code (structural-retrieval.ts) | 2 hours | Medium | 🔴 OPEN |
| 7 | Unify benchmark + retrieval similarity math | Code (new lib/similarity.ts) | 3 hours | Medium | 🔴 OPEN |
| 8 | Add provisional flag to early bias detections | Code + UI | 1 day | Medium | 🔴 OPEN |
| 9 | Expand structural context to Contrarian persona | Code (Set update) | 1 hour | Medium | 🔴 OPEN |
| 10 | Build `userJudgmentContext()` full function | Code (new lib) | 3 days | Critical (long-term) | 🔴 OPEN |
| 11 | Add `session_intelligence_score` computation | Code + schema | 2 days | High (long-term) | 🔴 OPEN |
| 12 | Threshold calibration dashboard | Product tooling | 1 day | Medium | 🔴 OPEN |

Items 1–4 remain the highest priority. Items 1 and 2 require no schema changes. The shipped Chunk 4 components (PatternSurfaceCard etc.) address user-layer surfacing but do not substitute for items 1–4, which operate at the reasoning layer.

---

*Audit complete. Codebase: Sprint 20 + Chunk 4 components (PatternSurfaceCard, RecurringConditionCard, ContradictionBanner). Website: index.html (attached). Competitor: naomihq.com. Verdict: Architecture is sound, moat trajectory is correct, user-layer feedback loop now closed. Reasoning-layer feedback loop remains the single highest-leverage open item.*
