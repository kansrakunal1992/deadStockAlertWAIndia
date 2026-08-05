# QUORUM — Research Working Document
## Decision Intelligence Ontology — Living Research State

**Version 0.9** | Updated from v0.8 | Internal only
**Parallel tracks:** Research (this doc) | Product (separate session — 14-dim implementation underway)

---

## ⚡ ONE THING TO PICK NEXT

**Resolve the R2 threshold mismatch.**

The research doc says R2 fires at `identity_alignment ≥ 5 AND ambiguity ≥ 4`.
The live code fires at `identity_alignment ≥ 4 AND ambiguity ≥ 3`.

The code is meaningfully more permissive — R2 will fire on a much larger share of sessions and hold the Council behind a values gate it may not need. The IRR raters are annotating against the doc definition (≥ 5). If the code stays at ≥ 4, the live product and the validated research instrument are misaligned from day one.

**Decision needed: pick one definition, update the other. 15 minutes. Do it before rater packets return.**

After that: wire `buildCouncilContext()` into the examiner POST handler (Sprint 11b) — the rule engine signals are fully computed and currently thrown away on every session.

---

## RESEARCH STATE AT A GLANCE

| Stage | Status | Blocker / Next action |
|---|---|---|
| **Stage 1** — Corpus expansion + dimension rewrites + analog ratings | ✅ **COMPLETE** | — |
| **Stage 2** — Human-rater IRR validation | 🔄 **IN PROGRESS** | Rater packets distributed. ~1 week to return. IRR computation + Stage 2 brief on arrival. |
| **Stage 3** — Ontology scorer accuracy testing | ⚡ **RUNNING IN PRODUCT** | Brief submission prep (25 cases) ready to do now — needed the day scorer goes live. |
| **Stage 4** — Examiner rule refinement on expanded corpus | ⏳ Pending Stage 2 | DDI scoring for 30 un-annotated cases can be done now to avoid lag. |
| **Stage 5** — Retrieval weight tuning + analog corpus curation | ⏳ Pending Stage 3 | 14 analog ratings received. Need 6 more for regression. Retrieval system does not yet use ontology_vector (code gap — see below). |
| **Stage 6** — Academic validation + working paper preparation | ⏳ Pending Stage 2 + real outcome data | Cannot draft papers until human IRR complete + outcome data exists. |

---

## WHAT CHANGED IN v0.9

### Completed since v0.8

- ✅ **OSF pre-registration filed** — timestamped, under 4-year embargo. All three hypotheses, per-dimension IRR targets, analysis plan, and stopping rules are now locked. URL/DOI to be added here once confirmed from OSF dashboard.
- ✅ **Code audit complete** — full read of `rule-engine.ts`, `ontology-tagger.ts`, `structural-retrieval.ts`, `bias-scorer.ts`, `mirror-fingerprint.ts`, `contradiction-detector.ts`, `independence-score.ts`, all API routes, and Supabase schema. State documented below.

### Newly identified — must resolve

- 🔴 **R2 threshold mismatch** — doc says `identity_alignment ≥ 5 AND ambiguity ≥ 4`; code uses `≥ 4 AND ≥ 3`. Needs explicit decision before IRR packets return.
- 🔴 **`buildCouncilContext()` not wired** — function exists in rule-engine.ts, produces correct structural signal block, but is commented out in examiner POST handler ("Sprint 11b — scope separately"). Council personas are not receiving rule engine signals.
- 🟡 **R6–R12 are stubs** — only R1–R5 are evaluated. Six rules are code comments only.
- 🟡 **Structural retrieval ignores `ontology_vector`** — uses legacy 9-category scoring (decision type, register, stakes, counterparty, time pressure). The Stage 5 dimension weights (identity_alignment ×2.0 etc.) cannot be tested until retrieval actually uses the scored vector.
- 🟡 **`rule_id` not saved to `examiner_responses`** — noted as TODO in examiner route. DB column presumably exists but nothing writes to it.

---

## PARALLEL TASKS WHILE IRR IS IN FLIGHT

Ordered by priority. IRR expected back in ~1 week.

### 🔴 This week — decision needed

**1. Resolve R2 threshold** *(15 min)*
Pick `≥ 5 / ≥ 4` (doc) or `≥ 4 / ≥ 3` (code). Update the other. Document the decision here. Do not let IRR packets return with the mismatch unresolved.

**2. Schema lock with product team** *(1 meeting)*
Share v0.8 dimension definitions and anchor examples before scorer prompts are finalised. The R2 mismatch above is exactly the drift this prevents. Risk #5 is still open.

**3. Recruit Rater 3** *(a few outreach messages)*
Rater 3 is TBD. Send outreach now — calendar alignment takes time. Packet goes out once Raters 1 & 2 return theirs.

### 🟡 This week — research track

**4. Brief submission prep — 25 annotated cases** *(1–2 days)*
Strip each case to 20–80 words, first person, no outcome. Required for Stage 3 scorer validation. Zero dependencies. Stage 3 starts the day the product scorer is live — have this ready so there is no lag.

**5. DDI scoring — 30 un-annotated corpus cases** *(2–3 days)*
Corporate Western batch (20 cases) and Personal HNI global batch (10 cases) are both flagged "DDI not yet scored." Stage 4 rule testing (R7 in particular) needs DDI for all 60 cases. Score using v0.8 definition.

**6. Low-IA cases — Gap #4, 5 cases** *(2–3 days)*
Add 5 cases with identity_alignment = 1–2. Domains: financial arbitrage, vendor selection, logistics optimisation. Needed for scorer calibration at the low end and to prevent R2 from over-firing on all real sessions.

### 🟢 This week — code track

**7. Wire `buildCouncilContext()` into examiner POST handler** *(Sprint 11b)*
The rule engine structural signals (triggered rule, dimension rationale, confidence) exist and are thrown away on every session. This is the highest-leverage code change available — users start receiving structurally-informed Council responses immediately on merge.

**8. Implement R6–R12** *(Sprint 12)*
Start with R7 (Information-First Redirect) and R9 (Irreversibility Warning) — highest product leverage and logic fully specified in code comments. R6, R8, R10, R11, R12 to follow.

### 🔵 Ongoing — corpus

**9. Add 6 more analog ratings → run Stage 5 regression** *(2–3 days)*
Currently 14/20+ ratings. Six more unlocks the regression and produces empirical retrieval weights rather than directional guesses. Priority domains: wealth distribution / HNI philanthropy, partnership dissolution / co-founder split, late-career pivot (50+).

**10. Expand corpus toward 80+ cases** *(~1 week)*
Still needed for retrieval coverage: wealth distribution decisions, partnership dissolution, NRI return / geographic relocation, late-career pivot (50+). Currently at 60; target 80+ before live retrieval deploys.

---

## SCIENTIFIC DEFENSIBILITY CHECKLIST

| Condition | Status |
|---|---|
| Human-rater IRR on 25+ cases (3 independent raters) | 🔄 In progress |
| Pre-registered annotation protocol on OSF | ✅ **DONE** — filed under 4-year embargo |
| Ontology scorer accuracy tested on 20+ real user sessions | ⏳ Pending product scorer going live |
| Examiner rule retroactive validation via 30-day outcome question | ⏳ Pending real sessions |
| External domain expert review of three novel dimensions | ❌ Not yet started |

**Current defensible claim:** *"Built on a 14-dimensional decision ontology validated through a staged AI-relay research protocol with 60 annotated cases, independent human-rater IRR in progress, and a pre-registered analysis plan on OSF."*

**Not yet claimable:** *"Scientifically validated decision intelligence."*

---

## CODE STATE — WHAT IS AND IS NOT BUILT

### Fully implemented ✅

| Component | Detail |
|---|---|
| 14-dim ontology tagger (v2.0) | All 14 dimensions, score + confidence + rationale. Anthropic or DeepSeek provider. Stored as `ontology_vector` JSONB. |
| Rule Engine R1–R5 | Deterministic, live. REDIRECT / GATE / FLAG modes correct. R4 suppressed when R2 fires. Confidence downgrade on low-confidence dims. |
| Examiner routing | v2.0 sessions use rule engine; v1.0 fallback to gap-based. Same response shape. |
| Bias scorer | 15 parameters, adversarial prosecutor + defence pass. Stored in `bias_library`. |
| Mirror suite | Fingerprint (confidence tiers + AI narrative), independence score (9-signal heuristic), contradiction detector (2-pass pipeline). All complete. |
| DB schema | sessions, sessions_ontology (v2.0 fields), examiner_responses, bias_library, contradiction_log, register_mode. |

### Partial or wired incorrectly ⚠️

| Gap | Detail |
|---|---|
| R6–R12 | Stubs only (Sprint 12 comments). Evaluator function only calls R1–R5. |
| `buildCouncilContext()` not wired | Produces correct structural block, commented out in examiner POST ("Sprint 11b"). Personas not receiving rule signals. |
| `rule_id` not saved | TODO comment in examiner route. Writes nothing to examiner_responses. |
| Structural retrieval | Uses old 9-category scoring. `ontology_vector` stored but ignored by retrieval. Stage 5 regression weights cannot be tested until this is fixed. |

### R2 threshold — needs resolution 🔴

| | identity_alignment | ambiguity |
|---|---|---|
| Research doc | ≥ 5 | ≥ 4 |
| Live code | ≥ 4 | ≥ 3 |

Code is more permissive. R2 is a GATE (holds the Council). Wrong threshold = Council blocked too often or not enough. Must be resolved before IRR packets return.

---

## STAGE 2 — Human-Rater IRR Validation
**Status: IN PROGRESS**

### Rater Panel

| Rater | Profile | Status |
|---|---|---|
| Rater 1 | PhD professor (academic anchor — brother-in-law) | Packet distributed |
| Rater 2 | Ex-BCG → CXO (practitioner anchor) | Packet distributed |
| Rater 3 | TBD — founder / senior operator from network | Not yet recruited — outreach needed this week |

Two-rater IRR sufficient to identify weak dimensions and begin Stage 3. Three raters required for Stage 2 completion brief and external reporting.

### IRR Target Thresholds (human raters)

| Dimension | AI-relay IRR | Human target | Risk |
|---|---|---|---|
| Time horizon | 100% | ≥ 90% | Low |
| Value conflict | 96% | ≥ 88% | Low |
| Emotional intensity | 93% | ≥ 83% | Low |
| Time pressure | 94% | ≥ 85% | Low |
| Outcome uncertainty | 95% | ≥ 85% | Low |
| Task complexity | 92% | ≥ 82% | Low |
| Identity alignment ⭐ | 91% | ≥ 82% | Medium |
| Stakes magnitude | 90% | ≥ 82% | Low |
| Ambiguity | 88% | ≥ 78% | Acceptable |
| Regret asymmetry ⭐ | 85% | ≥ 75% | Medium |
| Reversibility | 95% (post-rewrite) | ≥ 82% | Low |
| Decision unit | 92% (post-rewrite) | ≥ 80% | Low |
| Decision-discrim. info | 90% (post-rewrite) | ≥ 78% | Medium |
| Upstream dependency ⭐ | 88% (post-rewrite) | ≥ 72% | High |

Any dimension below target → definition rewrite + 1 additional calibration round before Stage 3.

### When Packets Return — Computation Steps

1. For each case × dimension pair, record all 3 rater scores
2. Compute pairwise IRR (within-1): % of pairs where scores differ by ≤ 1
3. 3 raters = 3 pairwise comparisons per dimension per case
4. Report: mean pairwise IRR per dimension across all 25 cases
5. Flag dimensions below target
6. Compare to AI-relay IRR — document where humans diverge from AI consensus
7. Produce Stage 2 completion brief (4-page, suitable for external advisors)

---

## STAGE 3 — Ontology Scorer Accuracy Testing
**Status: Running in product (parallel session)**

### Preparation Task (do now, before scorer is live)

For each of the 25 annotated cases:
- Strip to "brief submission" format (20–80 words, first person, no outcome)
- Simulates a real user submission
- Have all 25 ready before scorer goes live — zero lag on Stage 3 start

### When Product Scorer Is Live — Validation Protocol

1. Run all 25 brief submissions through product scorer
2. Compare output against corpus ground truth annotation (within-1 per dimension)
3. Record confidence calibration: does low confidence predict actual mismatches?
4. Record R1 and R7 false positive rates (< 10% target)

**Target:** ≥ 85% within-1 accuracy on Phase 1 dimensions. ≥ 75% on all 14.

### Dimensions to Watch

- **Upstream dependency:** Most likely to under-score. Users often don't name the prior question explicitly.
- **Regret asymmetry:** Requires inferring asymmetry from framing — easy to miss in sparse text.
- **DDI:** Scorer must distinguish "data doesn't exist" (score 1) from "data exists, not yet gathered" (score 5).
- **Identity alignment:** Likely to score 4–5 on almost everything in HNI domain — needs low-end calibration.

---

## STAGE 4 — Examiner Rule Refinement
**Status: Pending Stage 2 completion**

Run all 12 rules against 60-case corpus once Stage 2 IRR confirms dimension scores are reliable.

**Pre-work available now:** Score DDI for the 30 un-annotated cases (Corporate Western + Personal HNI global batches). R7 depends on DDI. Don't let this create lag when Stage 4 unlocks.

**Critical thresholds:**
- R1, R7 (REDIRECT): false positive < 10%
- R4, R5 (FLAG): false positive < 25%

---

## STAGE 5 — Retrieval Weight Tuning
**Status: Partially unblocked — 14 analog ratings received**

### Code gap to fix before Stage 5 can be validated

The structural retrieval system currently uses the old 9-category scoring (decision type, register, stakes, counterparty, time pressure). `ontology_vector` is stored in the DB but not used in retrieval. The Stage 5 dimension weights below are hypotheses — they cannot be empirically validated until retrieval actually uses the scored vector.

### Current Retrieval Weight Hypothesis

| Dimension | Weight |
|---|---|
| identity_alignment | × 2.0 |
| regret_asymmetry | × 1.8 |
| upstream_dependency | × 1.8 |
| value_conflict | × 1.5 |
| cultural_proximity | × 1.4 |
| task_complexity | × 0.8 |
| emotional_intensity | × 0.7 |

These are directional hypotheses. Full regression requires 20+ analog ratings. Current 14 ratings give signal only.

**6 more analog ratings needed for regression unlock.** Priority domains: wealth distribution / HNI philanthropy, partnership dissolution, late-career pivot (50+).

**Corpus still needs (retrieval coverage):**
- Wealth distribution decisions (HNI philanthropy, inheritance)
- Partnership dissolution (co-founder split, business divorce)
- NRI return / geographic relocation decisions
- Late-career pivot (50+, second act)
- Target: 80+ cases before live retrieval deploys

---

## STAGE 6 — Academic Validation + Working Paper Preparation
**Status: Not yet started. Cannot start until Stage 2 complete.**

### Three Working Papers — Status

**Paper 1 — Identity alignment as a structural decision dimension**
*"Identity alignment as a predictor of decision difficulty and post-decision regret in high-stakes personal decisions"*
Evidence needed: human IRR ≥ 80% on IA + 20 corpus cases IA ≥ 4 + outcome data.

**Paper 2 — Regret asymmetry as a pre-decision structural feature**
*"Minimax regret theory applied to personal life-architecture decisions: a structural operationalization"*
Evidence needed: human IRR ≥ 75% on RA + double-bind validation + India batch sub-finding.

**Paper 3 — Upstream dependency and the False Clarity problem**
*"False clarity in high-stakes personal decisions: when attempting to decide produces wrong answers"*
Evidence needed: human IRR ≥ 72% on UD + 3 corpus cases with documented False Clarity outcome + R1 redirect data.

### Publication Timeline

| Output | Target | Requires |
|---|---|---|
| HBR practitioner article | 3–4 months post Stage 2 | Stage 2 complete. No outcome data needed. |
| SSRN pre-print | 18–24 months | IRR + outcome data + external expert review |
| Journal submission (JDM / JDBM) | 24–36 months | SSRN response, peer review cycle |

**Pre-registration:** ✅ Filed on OSF. 4-year embargo. Locked before outcome data collection.

**External reviewer:** One domain expert in judgment / decision-making needed. Not yet started. Required before SSRN submission.

---

## COMPLETED FINDINGS FROM STAGE 1

### Analog Rating Results (14/15 received)

| Decision | Analog | Structural score | User rating |
|---|---|---|---|
| Coast FIRE | Buffett/Apple | 22/28 | **3** |
| Coast FIRE | Patagonia/Chouinard | 20/28 | **5** |
| Coast FIRE | Narayana Murthy/Infosys | 18/28 | **5** |
| Air India | Kayla Kernick | 24/28 | **4** |
| Air India | IAS officer | 22/28 | **5** |
| Air India | Sundar Pichai | 19/28 | **4** |
| Startup at 45 | Falguni Nayar | 23/28 | **5** |
| Startup at 45 | Michael Dell | 21/28 | **4** |
| Startup at 45 | Anonymous founder | 19/28 | **4** |
| Parenting / AI world | Kiran Mazumdar-Shaw | 20/28 | **3** |
| Parenting / AI world | Marlene Engelhorn | 18/28 | **4** |
| Parenting / AI world | Narayana Murthy | 17/28 | **3** |
| Health / diet | Ryan Caldbeck | 21/28 | **5** |
| Health / diet | Taylor Adams | 19/28 | **5** |

**Key finding — Buffett/Apple anomaly:** Highest structural score (22/28) but lowest user rating (3). Narrative resonance, cultural proximity, and domain familiarity must be weighted in retrieval alongside structural similarity.

---

## FIVE TOP FAILURE RISKS

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Ontology scorer not accurate enough on real sessions | Confidence < 0.5 triggers clarifying question before Rule Engine fires | Open |
| 2 | Outcome loop fails — users don't complete 30-day reviews | Single-action email (no login), WhatsApp channel under consideration | Open |
| 3 | Contradiction Detector produces false positives | Surface as question, not statement. Let user validate. | Open |
| 4 | Corpus selection effect → R2 fires on everything | Add 5 low-IA cases (Gap #4) before Stage 4. In queue. | Open |
| 5 | Research and product tracks diverge on schema | Share dimension definitions + anchor examples before scorer prompts finalised. R2 mismatch is live evidence this risk is active. | 🔴 Active |

---

## RESEARCH METHOD REFERENCE

### The Zero-Budget AI-Relay Model

| Rater | Role |
|---|---|
| Claude (Anthropic) | Lead researcher — ontology design, annotation, critique, synthesis, rule derivation |
| Copilot / ChatGPT | Research volume — case harvesting, literature sourcing, blind annotation |
| Founder | Human rater — real HNI context, quality judgment, ground truth, analog ratings |

---

## 14 DIMENSIONS — CURRENT DEFINITIONS (v0.8, stable)

| # | Dimension | Ask yourself | Score 1 | Score 5 |
|---|---|---|---|---|
| D1 | **Reversibility** | If wrong — how easily undone? | Completely reversible at low cost | Structurally permanent |
| D2 | **Time horizon** | How far do consequences ripple? | Days to weeks | Lifetime / generational |
| D3 | **Stakes magnitude** | How much does this matter to THIS person? | Barely matters | Shapes entire life trajectory |
| D4 | **Outcome uncertainty** | Even with perfect info — how predictable? | Highly predictable | Fundamentally unknowable |
| D5 | **Ambiguity** | Do they know what decision they're actually making? | Problem completely clear | Question itself is mis-specified |
| D6 | **Task complexity** | How many moving parts to manage at once? | Simple, 1–2 variables | Many interacting variables, expert input needed |
| D7 | **Decision-discriminating info** | Does specific, get-able info exist that would change the answer? | No — values-anchored or unknowable | Yes — specific accessible info exists, not yet gathered |
| D8 | **Time pressure** | Is there a REAL external deadline — not just felt urgency? | No deadline at all | Imminent real deadline, hours/days |
| D9 | **Decision unit** | How many people must actively agree for this to work? | Solo decision | Large group / institutional alignment |
| D10 | **Value conflict** | Are the person's own core values fighting each other? | No conflict | Irreconcilable — any option betrays something |
| D11 | **Emotional intensity** | How emotionally charged is this for them? | Low, largely detached | Core sense of self activated |
| D12 | **Identity alignment** ⭐ | Is this about what to DO or who to BE? | Purely about what to do | Cannot resolve without answering "who do I want to be?" |
| D13 | **Regret asymmetry** ⭐ | Is one type of mistake structurally much worse than the other? | Both errors roughly equal | One error substantially worse, potentially unrecoverable |
| D14 | **Upstream dependency** ⭐ | Does a prior unresolved decision need to happen first? | Self-contained, ready now | Prior question must resolve first — attempting this now produces false clarity |

⭐ = three novel dimensions, highest research novelty, highest product leverage

---

## 12 EXAMINER RULES — CURRENT RULE SET (v0.8)

### Mode Summary

| Mode | Rules | Council behaviour | Code status |
|---|---|---|---|
| REDIRECT (hard stop) | R1, R7 | Council BLOCKED entirely | R1 ✅ live · R7 ⏳ stub |
| GATE (conditional) | R2, R3, R8, R10 | Council held behind values sequence | R2 ✅ live (⚠️ threshold mismatch) · R3 ✅ live · R8, R10 ⏳ stubs |
| FLAG (concurrent) | R4, R5, R6, R9, R11, R12 | Council proceeds + flag appended | R4 ✅ live · R5 ✅ live · R6, R9, R11, R12 ⏳ stubs |

### Rules

**R1 — Upstream Dependency Block [REDIRECT, P0]** ✅ live
Trigger: `upstream_dependency ≥ 5`
"Before we work on this decision, there is a prior question that must be resolved first."

**R2 — Identity-First Gate [GATE, P0]** ✅ live ⚠️ threshold mismatch
Trigger (doc): `identity_alignment ≥ 5 AND ambiguity ≥ 4`
Trigger (code): `identity_alignment ≥ 4 AND ambiguity ≥ 3` ← resolve this week
"If you imagine yourself at 75 looking back, what would make you feel you made the right call — not financially, but as a person?"

**R3 — No-Information Mode [GATE, P0]** ✅ live
Trigger: `decision_discriminating_info ≤ 1 AND outcome_uncertainty ≥ 4`

**R4 — Regret Asymmetry Alert [FLAG, P1]** ✅ live
Trigger: `regret_asymmetry ≥ 5`

**R5 — False Urgency Detector [FLAG, P1]** ✅ live
Trigger: `emotional_intensity ≥ 4 AND time_pressure ≤ 2`

**R6 — Multi-Party Alignment Check [FLAG, P1]** ⏳ stub
Trigger: `decision_unit ≥ 3 AND emotional_intensity ≥ 4`

**R7 — Information-First Redirect [REDIRECT, P1]** ⏳ stub
Trigger: `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 3`
False positive target: < 10%

**R8 — Irreconcilable Values Alert [FLAG, P1]** ⏳ stub
Trigger: `value_conflict ≥ 5 AND identity_alignment ≥ 4`

**R9 — Irreversibility Warning [FLAG, P1]** ⏳ stub
Trigger: `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4`

**R10 — Complexity Overload Alert [GATE, P2]** ⏳ stub
Trigger: `task_complexity ≥ 5 AND ambiguity ≥ 4`

**R11 — Avoidance Detection [BACKGROUND JOB, P2]** ⏳ stub
Trigger: `upstream_dependency ≥ 4 AND days_open ≥ 45 AND no_new_action`

**R12 — Couple Misalignment Check [FLAG, P2]** ⏳ stub
Trigger: `decision_unit == 2 AND value_conflict ≥ 4`

---

## CORPUS STATE (v0.9)

| Batch | Cases | Status | Notes |
|---|---|---|---|
| Corporate Western (Copilot) | 20 | Prior annotation (v0.6 definitions) | DDI not yet scored — do this week |
| Personal HNI global (Copilot) | 10 | Prior annotation | DDI not yet scored — do this week |
| Founder's own decisions | 5 | ✅ Fully annotated (all 14 dims) | Ground truth cases |
| Western personal (self-annotated) | 5 | ✅ Fully annotated | Brooks, Brinker, Kernick, Anon founder, Engelhorn |
| Additional cases 6–10 | 5 | ✅ Fully annotated | Disney, Pritzker Simmons, T. Adams, J. Tu, Caldbeck |
| Stage 1 gap cases | 15 | ✅ Fully annotated | 5 urgent + 5 couple + 5 good outcome/process |
| **Total** | **60** | 25 on v0.8 defs; 35 on prior defs | Target: 80+ before live retrieval |

**Immediate gap:** 5 low-identity-alignment cases (IA = 1–2). Without them, scorer cannot calibrate the low end and R2 risks over-firing.

---

## THREE PUBLISHABLE CLAIMS — WHAT EACH NEEDS

**Claim 1 — Identity alignment predicts decision difficulty and post-decision satisfaction variance**
Needs: human IRR ≥ 80% on IA + 20 corpus cases IA ≥ 4 with outcomes + real user outcome data

**Claim 2 — Regret asymmetry as a pre-decision structural feature (not post-hoc)**
Needs: human IRR ≥ 75% on RA + double-bind validation (IBM/Gerstner pattern in ≥ 3 cases) + India batch sub-finding

**Claim 3 — Upstream dependency and False Clarity (attempting some decisions now produces wrong answers)**
Needs: human IRR ≥ 72% on UD + 3 corpus cases with documented False Clarity outcome + product R1 redirect data

---

## FINAL MOAT STATEMENT (unchanged)

Quorum is the only system that stores your full decision history as structured, comparable data — ontology vectors, rule firings, confidence scores, and outcomes — and uses that accumulated private data to detect your specific judgment patterns, calibration gaps, and recurring blind spots in a way that becomes more accurate with every decision you bring.

The moat is not the AI. The moat is the data structure. And the data structure compounds.

---

*Quorum Research Working Document v0.9*
*Updated from v0.8 | OSF pre-registration filed | Code audit complete | R2 threshold mismatch identified*
*Next update: after R2 threshold resolved + rater packets returned*
*Paste this document at the start of any new research session to resume from current state*
