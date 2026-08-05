# QUORUM — Research Working Document
## Decision Intelligence Ontology — Living Research State

**Version 0.8** | Updated from v0.7 | Internal only
**Parallel tracks:** Research (this doc) | Product (separate session — 14-dim implementation underway)

---

## RESEARCH STATE AT A GLANCE

| Stage | Status | Blocker / Next action |
|---|---|---|
| **Stage 1** — Corpus expansion + dimension rewrites + analog ratings | ✅ **COMPLETE** | — |
| **Stage 2** — Human-rater IRR validation | 🔄 **IN PROGRESS** | 3 raters working in parallel. PhD professor (brother-in-law) + ex-BCG CXO (friend) + 1 TBD. Rater packet (v2) distributed. |
| **Stage 3** — Ontology scorer prompt design + accuracy testing | ⚡ **RUNNING IN PRODUCT** | 14-dim implementation happening in parallel product session. Research task shifts to: validate scorer accuracy against corpus ground truth once product scorer is live. |
| **Stage 4** — Examiner rule refinement on expanded corpus | ⏳ Pending Stage 2 | Run all 12 rules against 60-case corpus. Measure false positive / negative rates. |
| **Stage 5** — Retrieval weight tuning + analog corpus curation | ⏳ Pending Stage 3 | 14 analog ratings received. Regression pending (needs 20+ ratings for meaningful weights). |
| **Stage 6** — Academic validation + working paper preparation | ⏳ Pending Stage 2 + real outcome data | Cannot draft papers until human IRR complete + outcome data exists. |

---

## YOUR NEXT TASKS IN THIS SESSION

Pick up from Stage 2 outputs when the raters return their completed packets.

**When rater packets arrive (immediate):**
1. Compute pairwise IRR for all 14 dimensions across all 3 raters
2. Flag any dimension below target thresholds (see Stage 2 table below)
3. For dimensions below target: rewrite definition, add anchor example, flag for second round
4. Compare AI-relay IRR vs. human-rater IRR — document convergence/divergence
5. Produce Stage 2 completion brief (4-page, suitable for external advisors)

**Running in parallel now (do not wait for IRR):**
- Validate ontology scorer accuracy once product team shares scorer output — compare against corpus ground truth annotations
- Add 5 low-identity-alignment cases to corpus (see Corpus Gap #4 below — new gap identified in Stage 1)

**Key context for new session:**
- Corpus is at 60 cases (25 fully annotated with all 14 dims in Annotation_Self_v3.xlsx, 35 from prior AI-relay batches)
- Analog ratings are complete (14/15 — health decision had only 2 analogs)
- DDI (Decision-discriminating information) column was missing from the annotation sheet in v0.7 — now added and scored for all 25 cases
- Engelhorn upstream dependency corrected from 4 → 2 (directional definition fix applied)
- Product is implementing all 14 dimensions in a parallel session — research does not need to wait for this

---

## COMPLETED FINDINGS FROM STAGE 1

### Analog Rating Results (all 14/15 received)

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

**Key finding — Buffett/Apple anomaly confirmed:** Highest structural score in the Coast FIRE set (22/28) but lowest user rating (3). Chouinard and Murthy, both lower structural scores, rated 5. This is now empirical data confirming that structural match ≠ user utility. Narrative resonance, cultural proximity, and domain familiarity must be weighted in retrieval alongside structural similarity.

**Domain findings:** Health analogs strongest (avg 5/5). Parenting weakest (avg 3.3/5) — confirms corpus gap. Air India analogs strong (avg 4.3/5). Coast FIRE mixed due to Buffett/Apple anomaly.

### Annotation Sheet Updates (Annotation_Self_v3.xlsx)

- **DDI column added:** Decision-discriminating information was entirely missing from the annotation sheet in v0.7. Scored for all 25 cases.
- **Engelhorn upstream dependency corrected:** 4 → 2. Under the directional definition (score the current decision's dependency on a *prior upstream unresolved decision*), her moral framework was fully formed before the redistribution decision. Score of 4 was measuring "decision feels weighty" — the error the definition rewrite was designed to catch.
- **Cases 6–10 newly annotated:** Abigail Disney, Liesel Pritzker Simmons, Taylor Adams, John Tu, Ryan Caldbeck — all 14 dimensions.
- **15 new gap cases added (corpus now 60):**
  - Gap 1 (urgent/real deadlines): Musk/SpaceX 4th launch, Schultz buying Starbucks, Sharma/Paytm demonetisation, Mazumdar-Shaw/Biocon, Sam Walton post-franchise
  - Gap 2 (couple disagreement documented): Bezos/Amazon, Phil+Penny Knight/Nike IPO, Chouinard/Patagonia transfer, Nilekani philanthropy, Branson/Virgin Atlantic
  - Gap 3 (hard decision, good outcome, process documented): Grove/Intel exit from memory, Iger/Pixar acquisition, Nadella/Microsoft CEO, Schultz retraining, Ratan Tata/JLR

### New Corpus Finding — Identity Alignment Dominance

**Identity_alignment = 5 in 9 of 10 originally annotated HNI cases.** Across all 25 self-annotated cases, identity_alignment ≥ 4 in the vast majority. This is a corpus selection effect — HNI/founder decisions brought to Quorum are disproportionately identity-laden. It has two implications:

1. **For the product:** The retrieval system needs low-IA cases (identity_alignment 1–2) to calibrate the dimension properly. Without them, the scorer cannot distinguish high-IA from medium-IA cases accurately.
2. **For the research:** The India batch finding (IA = 5 in all 10 cases) may partially reflect corpus construction rather than a genuine cultural distinction. Still worth documenting as a sub-finding, but caveat it.

**New corpus gap #4 (identified in Stage 1):** Add 5 cases where identity_alignment = 1–2. Pure analytical decisions where identity is genuinely not at stake. Examples: a financial arbitrage decision, a vendor selection, a logistics optimisation. These are needed to give the scorer a low-IA anchor.

---

## STAGE 2 — Human-Rater IRR Validation
**Status: IN PROGRESS**

### Rater Panel

| Rater | Profile | Status |
|---|---|---|
| Rater 1 | PhD professor (academic anchor — brother-in-law) | Packet distributed |
| Rater 2 | Ex-BCG → CXO (practitioner anchor) | Packet distributed |
| Rater 3 | TBD — founder / senior operator from network | Not yet recruited |

Rater 3 is not blocking. Two-rater IRR is sufficient to identify weak dimensions and begin Stage 3 work in parallel.

### Rater Packet

File: `Rater_Packet_v2.docx`
- 25 blinded case vignettes (names, outcomes, all identifying details removed)
- 14 dimensions with "Ask yourself…" plain-English prompts
- Compact rating table per case (score + rationale)
- Rationale required only for scores ≠ 3 (reduces burden for practitioner rater)
- Estimated completion: 2–3 hours
- Calibration example included (worked example, do not rate)

### IRR Target Thresholds (human raters)

| Dimension | AI-relay IRR | Human target | Risk |
|---|---|---|---|
| Time horizon | 100% | ≥ 90% | Low |
| Value conflict | 96% | ≥ 88% | Low |
| Emotional intensity | 93% | ≥ 83% | Low |
| Time pressure | 94% | ≥ 85% | Low — felt vs. real distinction must hold |
| Outcome uncertainty | 95% | ≥ 85% | Low |
| Task complexity | 92% | ≥ 82% | Low |
| Identity alignment | 91% | ≥ 82% | Medium — novel, definition must hold with non-AI raters |
| Stakes magnitude | 90% | ≥ 82% | Low |
| Ambiguity | 88% | ≥ 78% | Acceptable |
| Regret asymmetry | 85% | ≥ 75% | Medium — double-bind sub-distinction is the risk |
| Reversibility | 95% (post-rewrite) | ≥ 82% | Low |
| Decision unit | 92% (post-rewrite) | ≥ 80% | Low |
| Decision-discrim. info | 90% (post-rewrite) | ≥ 78% | Medium — new column, first human test |
| Upstream dependency | 88% (post-rewrite) | ≥ 72% | High — most novel, most likely to diverge |

Any dimension below target → definition rewrite + 1 additional calibration round before Stage 3.

### When Packets Return — Computation Steps

1. For each case × dimension pair, record all 3 rater scores
2. Compute pairwise IRR (within-1): % of pairs where scores differ by ≤ 1
3. 3 raters = 3 pairwise comparisons per dimension per case
4. Report: mean pairwise IRR per dimension across all 25 cases
5. Flag dimensions below target
6. Compare to AI-relay IRR — document where humans diverge from AI consensus
7. Produce Stage 2 brief

---

## STAGE 3 — Ontology Scorer Accuracy Testing
**Status: Running in product (parallel session)**

The product team is implementing the 14-dimensional scorer. Research task shifts from *designing* the scorer to *validating* its accuracy against corpus ground truth.

### When Product Scorer Is Live — Validation Protocol

1. Take each of the 25 annotated cases
2. Strip to "brief submission" format (20–80 words, first person, no outcome — simulating a real user)
3. Run through the product scorer
4. Compare output against corpus ground truth annotation
5. Record per-dimension accuracy (within-1 of ground truth)
6. Record confidence calibration: does low confidence from scorer predict actual mismatches?
7. Record R1 and R7 false positive rates (REDIRECT rules — must be < 10%)

**Target:** ≥ 85% within-1 accuracy on Phase 1 dimensions. ≥ 75% on all 14.

### Dimensions to Watch Closely in Scorer Testing

- **Upstream dependency:** Most likely to under-score on brief decision text. Users often don't name the prior unresolved question explicitly.
- **Regret asymmetry:** Requires inferring asymmetry from framing — easy to miss in sparse text.
- **DDI (Decision-discriminating info):** Scorer must distinguish "data doesn't exist" (score 1) from "data exists but user hasn't gotten it" (score 5). This distinction is hard from brief text.
- **Identity alignment:** Likely to score 4–5 on almost everything in the HNI/founder domain — needs calibration on the low end.

---

## STAGE 4 — Examiner Rule Refinement
**Status: Pending Stage 2 completion**

Run all 12 rules against the 60-case corpus once Stage 2 IRR confirms dimension scores are reliable. Measure false positive and false negative rates per rule.

**Critical thresholds:**
- R1, R7 (REDIRECT): false positive < 10%
- R4, R5 (FLAG): false positive < 25%

---

## STAGE 5 — Retrieval Weight Tuning
**Status: Partially unblocked — 14 analog ratings received**

### Current Retrieval Weight Hypothesis (from analog ratings)

Buffett/Apple anomaly confirms: upweight identity_alignment, regret_asymmetry, value_conflict, narrative/cultural proximity. Downweight generic task_complexity, emotional_intensity.

**Proposed starting weights for hybrid retrieval:**
- identity_alignment: × 2.0
- regret_asymmetry: × 1.8
- upstream_dependency: × 1.8
- value_conflict: × 1.5
- cultural_proximity (India/West, founder/HNI/family): × 1.4
- task_complexity: × 0.8
- emotional_intensity: × 0.7

These are hypotheses. Full regression requires 20+ analog ratings. Current 14 ratings give directional signal only.

**Corpus still needs (for retrieval coverage):**
- Low-identity-alignment cases (Gap #4 — see above)
- Wealth distribution decisions (HNI philanthropy, inheritance)
- Partnership dissolution (co-founder split, business divorce)
- NRI return / geographic relocation decisions
- Late-career pivot (50+, second act)
- Corpus target: 80+ cases before live retrieval is deployed

---

## STAGE 6 — Academic Validation + Working Paper Preparation
**Status: Not yet started. Cannot start until Stage 2 complete.**

### Three Working Papers — Status

**Paper 1 — Identity alignment as a structural decision dimension**
*Working title: "Identity alignment as a predictor of decision difficulty and post-decision regret in high-stakes personal decisions"*
Status: Hypothesis formed. Evidence needed: human-rater IRR ≥ 80% on IA dimension + 20 corpus cases with IA ≥ 4 + outcome data.

**Paper 2 — Regret asymmetry as a pre-decision structural feature**
*Working title: "Minimax regret theory applied to personal life-architecture decisions: a structural operationalization"*
Status: Hypothesis formed. Evidence needed: human-rater IRR ≥ 75% on RA dimension + double-bind validation + India batch documented as sub-finding.

**Paper 3 — Upstream dependency and the False Clarity problem**
*Working title: "False clarity in high-stakes personal decisions: when attempting to decide produces wrong answers"*
Status: Hypothesis formed. Evidence needed: human-rater IRR ≥ 72% on UD dimension + 3 corpus cases documenting False Clarity outcome + product outcome data from R1 redirects.

**Pre-registration:** File on OSF before collecting outcome data. One afternoon task. Do not skip — it's what separates "we found what we predicted" from "we found what we were looking for."

**External reviewer:** One domain expert in judgment/decision-making or behavioral economics needed. Letter confirming the three novel dimensions are distinct from existing literature. This is the minimum for investor-facing academic credibility.

---

## RESEARCH METHOD REFERENCE

### The Zero-Budget AI-Relay Model

| Rater | Role |
|---|---|
| Claude (Anthropic) | Lead researcher — ontology design, annotation, critique, synthesis, rule derivation |
| Copilot / ChatGPT | Research volume — case harvesting, literature sourcing, blind annotation |
| Founder | Human rater — real HNI context, quality judgment, ground truth, analog ratings |

**The relay protocol:** Copilot gathers → founder briefs Claude → Claude annotates → founder validates → Claude synthesises.

---

## 14 DIMENSIONS — CURRENT DEFINITIONS (v0.8, stable)

All 14 dimensions have survived empirical stress-testing. Do not add or remove without full re-validation.

| # | Dimension | Ask yourself | Score 1 | Score 5 |
|---|---|---|---|---|
| D1 | **Reversibility** | If wrong — how easily undone? | Completely reversible at low cost | Structurally permanent |
| D2 | **Time horizon** | How far do consequences ripple? | Days to weeks | Lifetime / generational |
| D3 | **Stakes magnitude** | How much does this matter to THIS person? | Barely matters | Shapes entire life trajectory |
| D4 | **Outcome uncertainty** | Even with perfect info — how predictable? | Highly predictable | Fundamentally unknowable |
| D5 | **Ambiguity** | Do they know what decision they're actually making? | Problem completely clear | Question itself is mis-specified |
| D6 | **Task complexity** | How many moving parts to manage at once? | Simple, 1–2 variables | Many interacting variables, expert input needed |
| D7 | **Decision-discriminating info** | Does specific, get-able info exist that they haven't gotten — that would change the answer? | No — values-anchored or unknowable | Yes — specific accessible info exists, not yet gathered |
| D8 | **Time pressure** | Is there a REAL external deadline — not just felt urgency? | No deadline at all | Imminent real deadline, hours/days |
| D9 | **Decision unit** | How many people must actively agree for this to work? | Solo decision | Large group / institutional alignment |
| D10 | **Value conflict** | Are the person's own core values fighting each other? | No conflict | Irreconcilable — any option betrays something |
| D11 | **Emotional intensity** | How emotionally charged is this for them? | Low, largely detached | Core sense of self activated |
| D12 | **Identity alignment** ⭐ | Is this about what to DO or who to BE? | Purely about what to do | Cannot resolve without answering "who do I want to be?" |
| D13 | **Regret asymmetry** ⭐ | Is one type of mistake structurally much worse than the other? | Both errors roughly equal | One error substantially worse, potentially unrecoverable |
| D14 | **Upstream dependency** ⭐ | Does a prior unresolved decision need to happen first? | Self-contained, ready now | Prior question must resolve first — attempting this now produces false clarity |

⭐ = three novel dimensions, highest research novelty, highest product leverage

### Dimensions Negated — Not Part of the Ontology

Explainability requirement, trust/reliance calibration, user AI familiarity, planning/search depth, information quality framing, decision dependency direction (merged into upstream dependency), stakeholder breadth + social complexity (merged into decision unit).

---

## 12 EXAMINER RULES — CURRENT RULE SET (v0.8)

### Mode Summary

| Mode | Rules | Council behaviour |
|---|---|---|
| REDIRECT (hard stop) | R1, R7 | Council BLOCKED entirely |
| GATE (conditional) | R2, R3, R8, R10 | Council held behind values sequence |
| FLAG (concurrent) | R4, R5, R6, R9, R11, R12 | Council proceeds + flag appended |

### Rules

**R1 — Upstream Dependency Block [REDIRECT, P0]**
Trigger: `upstream_dependency ≥ 5`
"Before we work on this decision, there is a prior question that must be resolved first."
False positive target: < 10%

**R2 — Identity-First Gate [GATE, P0]**
Trigger: `identity_alignment ≥ 5 AND ambiguity ≥ 4`
"If you imagine yourself at 75 looking back, what would make you feel you made the right call — not financially, but as a person?"

**R3 — No-Information Mode [GATE, P0]**
Trigger: `decision_discriminating_info ≤ 1 AND outcome_uncertainty ≥ 4`
"What do you believe is permanently true about [core subject] — regardless of what the world looks like in [time_horizon] years?"

**R4 — Regret Asymmetry Alert [FLAG, P1]**
Trigger: `regret_asymmetry ≥ 5`
"At 75, looking back — which mistake would be harder to live with: having done this, or not having done it?"
Special case: if both errors catastrophic → surface as DOUBLE-BIND.

**R5 — False Urgency Detector [FLAG, P1]**
Trigger: `emotional_intensity ≥ 4 AND time_pressure ≤ 2`
"There is no real external deadline here. What is creating the internal sense of urgency?"

**R6 — Multi-Party Alignment Check [FLAG, P1]**
Trigger: `decision_unit ≥ 3 AND emotional_intensity ≥ 4`
"Have you had a real conversation with [stakeholder] about what they actually want — not what you assume they want?"

**R7 — Information-First Redirect [REDIRECT, P1]**
Trigger: `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 3`
"There is specific information that would change this decision, and you do not have it yet."
False positive target: < 10%

**R8 — Irreconcilable Values Alert [FLAG, P1]**
Trigger: `value_conflict ≥ 5 AND identity_alignment ≥ 4`
"Which value are you not willing to betray, even if it costs you the other?"

**R9 — Irreversibility Warning [FLAG, P1]**
Trigger: `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4`
"This decision is essentially irreversible — and there is no real deadline."

**R10 — Complexity Overload Alert [GATE, P2]**
Trigger: `task_complexity ≥ 5 AND ambiguity ≥ 4`
"If you could resolve only one question that would most change your thinking, what would it be?"

**R11 — Avoidance Detection [BACKGROUND JOB, P2]**
Trigger: `upstream_dependency ≥ 4 AND days_open ≥ 45 AND no_new_action`
Railway cron job. Surfaces in Mirror.

**R12 — Couple Misalignment Check [FLAG, P2]**
Trigger: `decision_unit == 2 AND value_conflict ≥ 4`
"What has [partner] actually said they want — in their own words?"

---

## CORPUS STATE (v0.8)

| Batch | Cases | Status | Notes |
|---|---|---|---|
| Corporate Western (Copilot) | 20 | Prior annotation (v0.6 definitions) | DDI not yet scored. Flag for update in Stage 4. |
| Personal HNI global (Copilot) | 10 | Prior annotation | DDI not yet scored |
| Founder's own decisions | 5 | ✅ Fully annotated (all 14 dims) | Ground truth cases |
| Western personal (self-annotated) | 5 | ✅ Fully annotated | Brooks, Brinker, Kernick, Anon founder, Engelhorn |
| Additional cases 6–10 | 5 | ✅ Fully annotated | Disney, Pritzker Simmons, T. Adams, J. Tu, Caldbeck |
| Stage 1 gap cases | 15 | ✅ Fully annotated | 5 urgent + 5 couple + 5 good outcome/process |
| **Total** | **60** | 25 fully on v0.8 defs; 35 on prior defs | |

**Immediate gap to fill:** 5 low-identity-alignment cases (IA = 1–2). Currently almost no corpus coverage of decisions where identity is genuinely not at stake. Without these the scorer cannot calibrate the low end of the IA dimension.

---

## ANALOG RETRIEVAL CORPUS — FOUNDER DECISIONS

### D1 — Coast FIRE at 40 (Stay Comfortably Funded vs. Aim Higher)

| Rank | Analog | Score | Rating | Why useful/not |
|---|---|---|---|---|
| 1 | Patagonia / Yvon Chouinard | 20/28 | **5** | Identity + values clarity narrative resonates |
| 2 | Narayana Murthy / Infosys | 18/28 | **5** | Indian founder context + enough vs. ambition framing |
| 3 | Warren Buffett / Apple | 22/28 | **3** | Structurally high but narrative doesn't land — Buffett is not "coasting" |

Examiner: R2 (identity gate), R5 (false urgency), R10 (complexity overload — 12 variables), R9 (irreversibility of not compounding).

### D2 — Air India Transformation Opportunity

| Rank | Analog | Score | Rating | Why useful/not |
|---|---|---|---|---|
| 1 | IAS officer (public to private) | 22/28 | **5** | Indian context, identity transition, institutional loyalty |
| 2 | Kayla Kernick / Spring Creek | 24/28 | **4** | Highest structural match in entire corpus |
| 3 | Sundar Pichai / Google CEO | 19/28 | **4** | Public-facing leadership transition, stakeholder complexity |

Examiner: R2 (identity gate), R6 (multi-party alignment), R8 (values conflict — mission vs. prestige).

### D3 — Startup at 45 (Safe Career vs. Founding Again)

| Rank | Analog | Score | Rating | Why useful/not |
|---|---|---|---|---|
| 1 | Falguni Nayar / Nykaa | 23/28 | **5** | Indian founder, 50+ leap, consumer brand — closest structural match |
| 2 | Michael Dell | 21/28 | **4** | Returning founder narrative |
| 3 | Anonymous founder (succession conflict) | 19/28 | **4** | Warning case — useful as counterpoint |

Examiner: R1 (upstream dependency — FIRE floor not defined), R4 (regret asymmetry — not acting is worse), R2 (identity gate).

### D4 — Parenting for AI-First World

| Rank | Analog | Score | Rating | Why useful/not |
|---|---|---|---|---|
| 1 | Marlene Engelhorn | 18/28 | **4** | Values-anchoring in unknowable future — structural resonance |
| 2 | Kiran Mazumdar-Shaw | 20/28 | **3** | Structural match but domain distance too large |
| 3 | Narayana Murthy | 17/28 | **3** | Indian parenting framing, but not the same stakes dimension |

**Corpus gap confirmed.** Parenting domain is consistently weakest. R3 fires correctly (no information mode — 2040 AI economy is genuinely unknowable).

### D5 — Health / Diet Trade-Off

| Rank | Analog | Score | Rating | Why useful/not |
|---|---|---|---|---|
| 1 | Ryan Caldbeck (burnout → step down) | 21/28 | **5** | Health stakes, identity cost, values conflict — strong match |
| 2 | Taylor Adams (sobriety + purpose) | 19/28 | **5** | Health as identity decision — excellent structural match |

Only 2 analogs in corpus for this domain. R7 fires correctly (information-first redirect — one blood panel changes everything).

---

## WHAT MUST BE VALIDATED BEFORE CLAIMING SCIENTIFIC DEFENSIBILITY

1. Human-rater IRR on 25+ cases (3 independent raters, no product stake) — **IN PROGRESS**
2. Pre-registered annotation protocol on OSF — **NOT DONE**
3. Ontology scorer accuracy tested on 20+ real user sessions — **PENDING PRODUCT SCORER**
4. Examiner rule retroactive validation via 180-day outcome question — **PENDING REAL SESSIONS**
5. External domain expert review of three novel dimensions — **NOT DONE**

Until these five conditions are met, Quorum can accurately claim: *"built on a 14-dimensional decision ontology validated through a staged AI-relay research protocol with 60 annotated cases and independent human-rater IRR in progress."*

It cannot yet claim: *"scientifically validated decision intelligence."*

---

## THREE PUBLISHABLE CLAIMS — WHAT EACH NEEDS

**Claim 1 — Identity alignment predicts decision difficulty and post-decision satisfaction variance**
Needs: human IRR ≥ 80% on IA + 20 corpus cases IA ≥ 4 with documented outcomes + real user outcome data

**Claim 2 — Regret asymmetry as a pre-decision structural feature (not post-hoc)**
Needs: human IRR ≥ 75% on RA + double-bind validation (IBM/Gerstner pattern in ≥ 3 cases) + India batch as sub-finding

**Claim 3 — Upstream dependency and False Clarity (attempting some decisions now produces wrong answers)**
Needs: human IRR ≥ 72% on UD + 3 corpus cases with documented False Clarity outcome + product R1 redirect data

**Fastest path to publication:** HBR practitioner article. Does not require outcome data or peer review. Requires: compelling framework, 3 novel dimensions well-argued, case evidence. Achievable after Stage 2 completes. 3–4 months from now.

**Academic publication path:** SSRN pre-print → Judgment and Decision Making journal. Requires outcome data. 18–24 months.

---

## PARALLEL TRACK — PRODUCT (separate session)

The product team is implementing the 14-dimensional ontology scorer and all 12 Examiner rules in a parallel session. This does not block the research track. The research track's job is:

1. Provide corpus ground truth for scorer accuracy testing (done — 25 fully annotated cases)
2. Complete human-rater IRR so dimension definitions are locked before product stores vectors long-term
3. Validate scorer output against corpus annotations once the product scorer is live
4. Provide retrieval weights for the analog retrieval system (pending Stage 5 regression)

**One important handoff:** When the product scorer is live, share 10 "brief submission" versions of corpus cases with the product team and ask them to return the scorer output. Compare against ground truth. This is Stage 3 validation and it is the research track's most important near-term output.

---

## FIVE TOP FAILURE RISKS (unchanged from v0.7)

1. **Ontology scorer not accurate enough on real sessions** — real user text is messier than corpus cases. Mitigate: confidence threshold < 0.5 triggers clarifying question before Rule Engine fires.
2. **Outcome loop fails because users don't complete 30-day reviews** — friction kills calibration data. Mitigate: single-action WhatsApp, no login required for initial capture.
3. **Contradiction Detector produces false positives on real users** — feels like accusation, not insight. Mitigate: surface as question, not statement. Let user validate.
4. **Corpus selection effect produces biased Examiner rules** — if all 60 cases have IA ≥ 4, R2 fires on everything. Mitigate: add low-IA cases (Gap #4) before Stage 4 rule testing.
5. **Research and product tracks diverge** — product implements a different 14-dim schema than the research corpus. Mitigate: share dimension definitions and anchor examples with product team before they finalise scorer prompts. Lock the schema together.

---

## FINAL MOAT STATEMENT (unchanged)

Quorum is the only system that stores your full decision history as structured, comparable data — ontology vectors, rule firings, confidence scores, and outcomes — and uses that accumulated private data to detect your specific judgment patterns, calibration gaps, and recurring blind spots in a way that becomes more accurate with every decision you bring.

The moat is not the AI. The moat is the data structure. And the data structure compounds.

---

*Quorum Research Working Document v0.8*
*Updated from v0.7 | Reflects Stage 1 completion + Stage 2 in progress + product parallel track*
*Next update: after Stage 2 rater packets returned and IRR computed*
*Paste this document at the start of any new research session to resume from current state*
