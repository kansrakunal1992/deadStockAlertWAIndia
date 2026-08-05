# QUORUM — Research Working Document
## Decision Intelligence Ontology — Living Research State

**Version 0.10** | Updated from v0.9 | Internal only
**Parallel tracks:** Research (this doc) | Product (separate session) | GTM (separate session)

---

## ⚡ ONE THING TO PICK NEXT

**DDI scoring — 30 un-annotated corpus cases.**

The Corporate Western batch (20 cases) and Personal HNI global batch (10 cases) are both on prior annotation definitions with D7 (Decision-discriminating info) not yet scored. Stage 4 rule testing — R7 in particular — needs DDI for all 60 cases. Zero dependencies. Can be done now using the AI-relay method (Copilot + ChatGPT blind double-annotation, researcher adjudication). Expected: 2–3 days.

Brief submission prep is done. R2 is resolved. This is the highest-value zero-dependency research task remaining before IRR packets return.

---

## RESEARCH STATE AT A GLANCE

| Stage | Status | Blocker / Next action |
|---|---|---|
| **Stage 1** — Corpus expansion + dimension rewrites + analog ratings | ✅ **COMPLETE** | — |
| **Stage 2** — Human-rater IRR validation | 🔄 **IN PROGRESS** | Rater packets distributed. ~1 week to return. IRR computation + Stage 2 brief on arrival. |
| **Stage 3** — Ontology scorer accuracy testing | ✅ **BRIEF PREP DONE** | 25 first-person vignettes ready. Ground truth table (all 25 cases) compiled. Scorer validation starts the day product scorer goes live — zero lag. |
| **Stage 4** — Examiner rule refinement on expanded corpus | ⏳ Pending Stage 2 | DDI scoring for 30 un-annotated cases: do now to avoid lag. |
| **Stage 5** — Retrieval weight tuning + analog corpus curation | ⏳ Pending Stage 3 | 14 analog ratings received. Need 6 more for regression. |
| **Stage 6** — Academic validation + working paper preparation | ⏳ Pending Stage 2 + real outcome data | Cannot draft until human IRR complete + outcome data exists. |

---

## WHAT CHANGED IN v0.10

### Completed this session

- ✅ **R2 threshold resolved** — `identity_alignment ≥ 5 AND ambiguity ≥ 4` confirmed as correct definition. Conservative threshold retained to preserve discriminant validity; a permissive gate would fire on a majority of real sessions and undermine R2's ability to identify genuinely identity-anchored decisions. Code update from product track required (current code uses ≥ 4/≥ 3).

- ✅ **Brief submission prep complete** — All 25 vignettes stripped to first-person, 20–80 words, no outcome. File: `Brief_Submission_25_Cases_v1.md`. Stage 3 scorer validation can begin with zero lag the day the product scorer goes live.

- ✅ **Ground truth annotation table compiled (C-06 to C-25)** — Blind double-annotation (Copilot + ChatGPT independent runs), adjudicated by researcher. 15 ±2 divergences resolved with documented rationale. Full 25-case table (including C-01–C-05 from Annotation_Self.xlsx) in `Quorum_Ground_Truth_All25_v1.md`. One pending item: D7 inferred scores for C-01–C-05 require founder confirmation (D7 was not in original spreadsheet).

- ✅ **D14 calibration finding documented** — Copilot systematically inflated D14 scores (4–5 on almost all cases), treating identity questions and alignment tensions as upstream dependencies. ChatGPT applied the strict v0.8 definition (1–2). Copilot's interpretation accepted only for cases with a genuinely separate prior question (C-16, C-18, C-19, C-23). Finding logged in Ground Truth adjudication log — relevant for future AI-relay annotation sessions.

- ✅ **`buildCouncilContext()` status corrected** — v0.9 stated this was "not wired." Code audit shows it IS wired in the persona route for `synthesis` and `decision_brief` personas (Sprint 12). The remaining gap is narrower: the initial 6 Council personas do not receive rule engine signals. Persona route correctly imports and calls `buildCouncilContext()` for synthesis stage only.

---

## PARALLEL TASKS WHILE IRR IS IN FLIGHT

Ordered by priority. IRR expected back in ~1 week.

### ✅ Resolved this session

**R2 threshold** — confirmed ≥ 5/≥ 4. Code update delegated to product track.
**Brief submission prep** — complete. 25 cases ready.
**Ground truth annotations (C-06–C-25)** — complete and adjudicated.

### 🔴 Pending — decision / coordination

**Schema lock with product team** *(1 meeting)*
Share v0.8 dimension definitions and anchor examples before scorer prompts are finalised. R2 code update also needs to happen here.

**Recruit Rater 3** *(a few outreach messages)*
Rater 3 is TBD. Send outreach now — calendar alignment takes time. Packet goes out once Raters 1 & 2 return theirs.

**Confirm D7 scores for C-01–C-05** *(15 min)*
Five inferred scores in ground truth table need founder confirmation before Stage 3 begins. See Ground Truth v1.0 — D7 Inferred Scores section.

### 🟡 This week — research track

**DDI scoring — 30 un-annotated corpus cases** *(2–3 days)*
Corporate Western (20) and Personal HNI global (10) both missing D7. Use blind double-annotation method — same workflow as C-11 to C-25 this session.

**Low-IA cases — Gap #4, 5 cases** *(2–3 days)*
Add 5 cases with identity_alignment = 1–2. Domains: financial arbitrage, vendor selection, logistics optimisation. Needed for scorer calibration at the low end.

**6 more analog ratings → run Stage 5 regression** *(2–3 days)*
Currently 14/20+ ratings. Priority domains: wealth distribution / HNI philanthropy, partnership dissolution, late-career pivot (50+).

### 🟢 Code track (product session)

**Update R2 threshold in code** — change `≥ 4/≥ 3` to `≥ 5/≥ 4`.
**Wire initial 6 Council personas to receive `buildCouncilContext()` signals** — synthesis stage already wired; initial persona stage is the gap.
**Implement R6–R12** — start with R7 (Information-First Redirect) and R9 (Irreversibility Warning).

---

## SCIENTIFIC DEFENSIBILITY CHECKLIST

| Condition | Status |
|---|---|
| Human-rater IRR on 25+ cases (3 independent raters) | 🔄 In progress |
| Pre-registered annotation protocol on OSF | ✅ **DONE** — filed under 4-year embargo |
| Ground truth annotation table — 25 cases, all 14 dims | ✅ **DONE** — v1.0 compiled this session |
| Brief submission prep — 25 first-person vignettes | ✅ **DONE** — Stage 3 ready |
| Ontology scorer accuracy tested on 20+ real user sessions | ⏳ Pending product scorer going live |
| Examiner rule retroactive validation via 30-day outcome question | ⏳ Pending real sessions |
| External domain expert review of three novel dimensions | ❌ Not yet started |

**Current defensible claim:** *"Built on a 14-dimensional decision ontology validated through a staged AI-relay research protocol with 60 annotated cases, independent human-rater IRR in progress, a pre-registered analysis plan on OSF, and a 25-case ground truth annotation table ready for scorer validation."*

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
| Mirror suite | Fingerprint, independence score, contradiction detector. All complete. |
| `buildCouncilContext()` — synthesis stage | Wired in persona route for `synthesis` and `decision_brief` personas (Sprint 12). |
| DB schema | sessions, sessions_ontology, examiner_responses, bias_library, contradiction_log, register_mode. |

### Partial or wired incorrectly ⚠️

| Gap | Detail |
|---|---|
| R2 threshold — code vs doc mismatch | Code uses `≥ 4/≥ 3`; correct definition confirmed as `≥ 5/≥ 4`. **Update in product track.** |
| `buildCouncilContext()` — initial Council personas | Synthesis/decision_brief personas receive context (Sprint 12). Initial 6 Council personas do not. Gap is narrower than previously stated. |
| R6–R12 | Stubs only. Evaluator calls R1–R5 only. |
| `rule_id` not saved | TODO in examiner route. Writes nothing to examiner_responses. |
| Structural retrieval ignores `ontology_vector` | Uses legacy 9-category scoring. Stage 5 dimension weights cannot be tested until retrieval uses the scored vector. |

---

## CORPUS STATE (v0.10)

| Batch | Cases | Status | Notes |
|---|---|---|---|
| Corporate Western (Copilot) | 20 | Prior annotation (v0.6 defs) | D7 not yet scored — do next |
| Personal HNI global (Copilot) | 10 | Prior annotation | D7 not yet scored — do next |
| Founder's own decisions | 5 | ✅ Fully annotated (all 14 dims) | Ground truth cases |
| Western personal (self-annotated) | 5 | ✅ Fully annotated | C-01 to C-05. D7 inferred — confirm |
| Additional cases C-06–C-10 | 5 | ✅ Fully annotated | Founder-scored this session |
| Stage 1 gap cases C-11–C-25 | 15 | ✅ Fully annotated | Blind AI double-annotation, adjudicated |
| **Total** | **60** | 25 on v0.8 defs; 35 on prior defs | Target: 80+ before live retrieval |

**Immediate gap:** 5 low-IA cases (identity_alignment = 1–2). Needed for scorer calibration and to prevent R2 over-firing.

---

## 12 EXAMINER RULES — CURRENT RULE SET (v0.8)

### Mode Summary

| Mode | Rules | Council behaviour | Code status |
|---|---|---|---|
| REDIRECT (hard stop) | R1, R7 | Council BLOCKED entirely | R1 ✅ live · R7 ⏳ stub |
| GATE (conditional) | R2, R3, R8, R10 | Council held behind values sequence | R2 ✅ live (**threshold now confirmed ≥ 5/≥ 4 — code update needed**) · R3 ✅ live · R8, R10 ⏳ stubs |
| FLAG (concurrent) | R4, R5, R6, R9, R11, R12 | Council proceeds + flag appended | R4 ✅ live · R5 ✅ live · R6, R9, R11, R12 ⏳ stubs |

### Rules

**R1 — Upstream Dependency Block [REDIRECT, P0]** ✅ live
Trigger: `upstream_dependency ≥ 5`
"Before we work on this decision, there is a prior question that must be resolved first."

**R2 — Identity-First Gate [GATE, P0]** ✅ live · ⚠️ code update needed
Trigger (confirmed): `identity_alignment ≥ 5 AND ambiguity ≥ 4`
Rationale: Conservative threshold retained to preserve discriminant validity; a permissive gate would fire on a majority of real sessions and undermine R2's ability to identify genuinely identity-anchored decisions.
Current code (incorrect): `identity_alignment ≥ 4 AND ambiguity ≥ 3` — update in product track.

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

## THREE PUBLISHABLE CLAIMS — WHAT EACH NEEDS

**Claim 1 — Identity alignment predicts decision difficulty and post-decision satisfaction variance**
Needs: human IRR ≥ 80% on IA + 20 corpus cases IA ≥ 4 with outcomes + real user outcome data

**Claim 2 — Regret asymmetry as a pre-decision structural feature (not post-hoc)**
Needs: human IRR ≥ 75% on RA + double-bind validation (IBM/Gerstner pattern in ≥ 3 cases) + India batch sub-finding

**Claim 3 — Upstream dependency and False Clarity (attempting some decisions now produces wrong answers)**
Needs: human IRR ≥ 72% on UD + 3 corpus cases with documented False Clarity outcome + product R1 redirect data

---

## RESEARCH METHOD REFERENCE

### The Zero-Budget AI-Relay Model

| Rater | Role |
|---|---|
| Claude (Anthropic) | Lead researcher — ontology design, annotation, critique, synthesis, rule derivation, adjudication |
| Copilot / ChatGPT | Research volume — case harvesting, literature sourcing, blind annotation |
| Founder | Human rater — real HNI context, quality judgment, ground truth, analog ratings |

**Calibration finding (this session):** Copilot shows D14 inflation tendency — treats unresolved identity questions as upstream dependencies rather than applying the strict "prior decision that blocks this one" test. When using AI-relay annotation, always run D14 as a blind double and adjudicate ±2 divergences manually.

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

## FINAL MOAT STATEMENT (unchanged)

Quorum is the only system that stores your full decision history as structured, comparable data — ontology vectors, rule firings, confidence scores, and outcomes — and uses that accumulated private data to detect your specific judgment patterns, calibration gaps, and recurring blind spots in a way that becomes more accurate with every decision you bring.

The moat is not the AI. The moat is the data structure. And the data structure compounds.

---

*Quorum Research Working Document v0.10*
*Updated from v0.9 | R2 threshold confirmed | Brief prep complete | Ground truth 25-case table compiled*
*Next update: after IRR packets return + DDI scoring complete*
*Paste this document at the start of any new research session to resume from current state*
