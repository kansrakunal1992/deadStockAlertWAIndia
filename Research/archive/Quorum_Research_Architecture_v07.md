# QUORUM — Research Architecture & Product Defensibility Review
### Version 0.7 | Built from Research Working Doc v0.6 + Handover Doc v10
### Status: Internal only | Brutally honest | Zero flattery

---

> **The single hardest truth before any question:** Quorum currently has no ontology scorer in production. The 14-dimensional research is real, but the codebase runs `ontology-tagger` and `structural-retrieval` as proxies, not the full vector. Every claim about "decision intelligence" is aspirationally correct, technically incomplete. The next 14 days must fix this — or the research is decorative.

---

## 1. What Parts of Quorum Are Still Generic and Copyable?

**Council personas.** Six parallel AI advisors is an obvious architecture. Deciso does it. Pi.ai does it with one persistent persona. The Council is differentiable only if it is *informed by structured pre-decision data* — which it currently is not. Right now, Council personas receive raw decision text. Without the ontology vector as input context, any LLM can replicate this in an afternoon.

**The Examiner.** Asking hard questions before advice is good product design. But "asking hard questions" is not a moat. Every serious decision tool (Rubicon Probity, Wizer, even well-prompted GPT-4) can surface uncomfortable questions. The Examiner is defensible only if questions are mechanically derived from a scored vector that no competitor computes — which is the 12-rule engine from Section 6 of the research doc. That engine does not currently run in production.

**Synthesis.** A directional recommendation paragraph is the least defensible output in the product. Any LLM produces synthesis. The only way synthesis becomes defensible is if it names *which examiner rules fired* and *how they changed the recommendation* — i.e., synthesis as a traceable reasoning chain, not a summary paragraph.

**Behavioral Alerts on the home page.** These are keyword-matching rules (two-layer: history keywords + static phrases). As implemented, they are impressive UX but thin intelligence. A sufficiently creative prompt engineer can reproduce them. They become defensible when they are longitudinally triggered by cross-session pattern accumulation, not single-session phrases.

**The 30-day outcome loop.** Capturing outcomes is table-stakes for any decision journal. What is not table-stakes is using outcomes to retroactively score Examiner calibration — i.e., "the Examiner flagged regret asymmetry at decision time; the outcome confirmed it." That causal layer does not exist yet. The `causalReady` flag is the hook. It has not been used.

**The Decision Brief PDF.** A clean PDF with an appendix is impressive UI polish. It is the least defensible feature in the product. Anyone with jsPDF and an afternoon can produce this. Build it for ₹25K session credibility, not as a moat.

**What is genuinely hard to copy today:** The 45-case annotated corpus. The 14-dimensional ontology with IRR validation. The Contradiction Detector's two-pass pipeline with simultaneous-truth test. The longitudinal Mirror accumulation architecture. These are defensible — but only if they are wired together correctly, which they are not yet.

---

## 2. What Should We Beg/Borrow/Steal?

### From Deciso / DecisionOS
- **Borrow:** Temporal consequence mapping — the explicit discipline of asking "what does this look like in 6 months / 2 years / 10 years?" across different options. This is structurally missing from Quorum's Council phase.
- **Borrow:** Scenario comparison matrix — a structured side-by-side across options before synthesis. Quorum goes straight to synthesis; a structured pre-synthesis comparison step would improve output quality.
- **Do not copy:** The "AI boardroom" visual metaphor. Generic. The multi-persona structure without ontology grounding is the weakness of Deciso, not a feature.

### From Decision Journal / Decira-type products
- **Borrow:** The explicit pre-decision confidence score — "on a 1–10 scale, how confident are you in this decision right now?" captured at submission time, before Council responds. This is the numerator for the calibration score.
- **Borrow:** The discipline of separating decision quality from outcome quality. A decision can be good even if the outcome is bad (bad luck) and vice versa. This framing must be built into the outcome capture UI explicitly, not just philosophically.
- **Do not copy:** Passive journaling. Quorum must actively interrogate, not merely record.

### From Hindsight
- **Borrow:** The "decision arc" — the idea that decisions have a lifecycle (before, during, after) and that the record stays alive across all three phases. The outcome loop already starts this. What is missing is the arc visualization — making users feel their decision is a *living record*, not a filed document.
- **Borrow:** Scheduled reviews as a product-triggered event, not a user-initiated one. Hindsight sends review prompts. Quorum should trigger 30/90/180-day outcome requests via Railway cron on `sessions_pending_outcomes`.
- **Do not copy:** Searchable history without structural intelligence. Text search across past decisions is a feature, not a product.

### From Rubicon Probity
- **Borrow:** The audit trail concept — every intervention (rule fired, examiner question asked, user response given) is logged with a timestamp. This creates an accountability record that HNI/CXO users value for self-review.
- **Borrow:** The three-state verdict system (CLEAR / CAUTION / STOP). Not the enterprise language, but the structure: every decision gets a pre-Council verdict state based on the rule engine output, and that state is visible to the user before they read any Council advice.
- **Borrow:** The outcome feedback loop — outcome data retroactively informs which intervention types were predictive. Rubicon tracks this. Quorum's `causalReady` flag is the intended hook; it must be used.
- **Do not copy:** 150+ visible bias labels. Cognitive overload. Naming biases does not improve decisions. Detecting recurring structural patterns across decisions does.

### From Wizer
- **Borrow:** "Decision DNA" framing — the idea that a person has a characteristic decision *profile* that is discoverable and improvable over time. This is exactly what the Bias Fingerprint and Independence Score are approaching. The framing is right; the implementation must catch up.
- **Borrow:** "Who is missing from the room?" — a structural question about missing perspectives. This maps directly onto R6 (Multi-Party Alignment Check) and R12 (Couple Misalignment Check). The question should be surfaced more prominently, not buried in the Examiner rule engine.
- **Borrow:** Blind-spot detection framing — the idea that you consistently miss a *type* of consideration. This is what the Mirror Pattern Store should surface after 3+ rule firings of the same type. The concept is right but not yet built.
- **Do not copy:** Team-first rooms, personality test labels, HR positioning. Quorum is private. The individual judgment profile is the product.

---

## 3. How Quorum Should Transform Each Borrowed Idea Into Something Defensible

**Temporal consequence mapping (from Deciso) → Ontology-gated timeline projection.** Deciso asks all decisions "what does this look like in 10 years?" Quorum should only surface temporal framing *when time_horizon >= 4*. For short-horizon decisions (time_horizon = 1–2), temporal projection is noise. The ontology gate makes this a precision intervention, not a generic template.

**Pre-decision confidence score (from Decira) → Calibration numerator stored with ontology vector.** The confidence score is only useful if stored alongside: the session ID, the full ontology vector, and the eventual outcome score. Then it becomes a calibration data point. "You rated confidence 8/10. Regret asymmetry was 5. Outcome: partially as expected. Your high-confidence / high-regret-asymmetry decisions are systematically overconfident." No decision journal does this because none of them have a structured ontology vector to compare against.

**Decision arc (from Hindsight) → Living decision record with examiner rule state.** Hindsight keeps a living record. Quorum should keep a living record *with examiner rule state* — i.e., the record shows which rules fired at decision time, what the user's response was, and whether the outcome retroactively validated the flag. This makes the record an accountability instrument, not just a memory.

**Audit trail (from Rubicon) → Examiner intervention log.** Every rule fired, every question asked, every user response (engaged / dismissed), logged with timestamp. This creates a verifiable chain: "we flagged upstream dependency on Day 1. The user dismissed it. The decision stalled for 90 days." That chain is valuable to the user and publishable as outcome data.

**Three-state verdict (from Rubicon) → PRE/GATE/OPEN verdict derived from rule engine.** Quorum's vocabulary: PRE-CONDITION (a prior decision must be resolved first — R1 fires), GATED (values clarification required before advice — R2, R3, R10 fire), OPEN (Council can proceed — no hard stops). This is mechanically derivable from the rule engine output. It is not a manual assessment. It is a computed state.

**Decision DNA (from Wizer) → Judgment Compounding Profile.** Wizer's "decision DNA" is a self-reported personality test. Quorum's equivalent should be *derived from actual decision behavior* — which dimensions score consistently high, which Examiner rules consistently fire, what the calibration score trend looks like. Earned profile, not self-reported profile. No one else has this because no one else has the longitudinal data architecture.

**Blind-spot detection (from Wizer) → Structural pattern triggers.** Wizer labels blind spots from a questionnaire. Quorum should surface blind spots from *empirically observed rule firing patterns* — "In 4 of your 6 decisions, R5 (False Urgency) fired. You may chronically confuse internal anxiety with external deadlines." That is a more credible blind-spot detection than any questionnaire.

---

## 4. Core Product Thesis in One Sentence

**Quorum is the only system that learns how you specifically make high-stakes decisions — detecting your recurring judgment patterns, hidden contradictions, and confidence gaps — so that each decision you bring makes the system more accurate about the next one.**

The critical word is "specifically." Not "people like you." Not "HNI decisions in general." *You.* Longitudinal, private, compounding. That is the thesis.

---

## 5. How the 14-Dimensional Ontology Should Sit in the Architecture

The ontology is not a feature. It is the operating system. Everything else is an application running on top of it.

**Tier 0 — Ontology Scorer (must exist before anything else).**
Takes decision text → returns a 14-dimensional score vector (1–5 per dimension) + confidence per dimension + 2–3 sentence rationale per dimension. Runs before Council. Runs before Examiner. Runs before anything.

**Tier 1 — Rule Engine.**
Takes the score vector → evaluates 12 rules → returns: mode (REDIRECT / GATE / OPEN), list of triggered rules, question templates per triggered rule. This is the input to the Examiner Sequencer.

**Tier 2 — Examiner Sequencer.**
Presents questions derived from triggered rules. Collects user responses. Enriches the decision record with: rule responses, user's stated values/fears/stakeholders, upstream decision links (if R1 fires). Passes the enriched record to Council.

**Tier 3 — Council (currently exists, but receives wrong input).**
Must receive: decision text + ontology vector + triggered rules + Examiner question answers. Not just decision text. The vector changes how each persona should respond — the Elder responds differently to identity_alignment=5 than to identity_alignment=2. The Risk Architect responds differently to regret_asymmetry=5. This persona customization does not currently exist.

**Tier 4 — Synthesis.**
Must name which rules fired and how they shaped the recommendation. "The Examiner flagged upstream dependency (R1) — this decision cannot be fully resolved until [upstream decision] is addressed. With that caveat, the Council's directional view is..." Synthesis becomes a traceable reasoning chain.

**Tier 5 — Ledger (persistent storage).**
Every session stores: decision text, ontology vector, confidence per dimension, rules fired, Examiner Q&A, Council responses, pre-decision confidence score, outcome (when captured), calibration delta. This is first-class infrastructure. The Ledger is the moat.

**Tier 6 — Mirror (reads from Ledger).**
Reads accumulated rule firings, ontology vectors, calibration scores, contradiction data. Surfaces patterns. Not a display layer — a pattern detection engine reading from structured longitudinal data.

---

## 6. What Exactly Should Happen Before Council Personas Generate Any Response?

In sequential order, with no exceptions:

**Step 1: Ontology Scorer runs.** Decision text in → 14-dimension vector out. Confidence below 0.6 on any dimension triggers a clarifying question to the user before proceeding. The clarifying question is dimension-specific ("You mentioned wanting to leave your job — how reversible is this? Could you return in 12 months if needed?").

**Step 2: Rule Engine evaluates all 12 rules.** Returns mode (REDIRECT / GATE / OPEN) + triggered rules + questions.

**Step 3: If REDIRECT (R1 or R7) — full stop.** Council is not invoked. The Examiner surfaces the redirect question. The session is logged as "redirected" with the upstream decision ID (if R1) or the information gap (if R7). No Council response is generated until the user returns after resolving the prior condition.

**Step 4: If GATE (R2, R3, R8, R10) — Council is gated.** Examiner presents the values/reframe sequence. User answers are logged. Council is then invoked with: decision text + ontology vector + examiner answers + triggered rules. Council personas must reference the examiner answer in their response ("Based on what you said about [value], the question becomes...").

**Step 5: If OPEN — Council proceeds with enriched context.** Even with no rules firing in REDIRECT or GATE mode, the ontology vector and any FLAG-mode rules (R4, R5, R6, R9, R11, R12) are appended to Council's system prompt. FLAG rules do not block Council but do add specific interrogation instructions per persona.

**Step 6: Pre-decision confidence score is captured.** Before the user sees any Council response, the UI asks: "Before we show you the Council's analysis — how confident are you in this decision right now? (1–10)." This is stored in the Ledger with the timestamp. Non-negotiable. This is the numerator for calibration.

---

## 7. What Structured Data Should Be Stored for Every Decision?

```
session: {
  id: uuid
  created_at: timestamp
  decision_text: string
  decision_context: string (optional, from 3-step modal or in-app)

  ontology: {
    reversibility: { score: 1-5, confidence: 0-1, rationale: string }
    time_horizon: { score: 1-5, confidence: 0-1, rationale: string }
    stakes_magnitude: { score: 1-5, confidence: 0-1, rationale: string }
    outcome_uncertainty: { score: 1-5, confidence: 0-1, rationale: string }
    ambiguity: { score: 1-5, confidence: 0-1, rationale: string }
    task_complexity: { score: 1-5, confidence: 0-1, rationale: string }
    decision_discriminating_info: { score: 1-5, confidence: 0-1, rationale: string }
    time_pressure: { score: 1-5, confidence: 0-1, rationale: string }
    decision_unit: { score: 1-5, confidence: 0-1, rationale: string }
    value_conflict: { score: 1-5, confidence: 0-1, rationale: string }
    emotional_intensity: { score: 1-5, confidence: 0-1, rationale: string }
    identity_alignment: { score: 1-5, confidence: 0-1, rationale: string }
    regret_asymmetry: { score: 1-5, confidence: 0-1, rationale: string }
    upstream_dependency: { score: 1-5, confidence: 0-1, rationale: string }
    vector_version: "v1.0"  // for future schema migration
  }

  examiner: {
    verdict: "REDIRECT" | "GATE" | "OPEN"
    rules_triggered: [{ rule_id: "R1", mode: "REDIRECT", question_shown: string, user_response: string, response_timestamp: timestamp }]
    upstream_links: [{ session_id: uuid, dependency_direction: "upstream" | "downstream" }]
  }

  pre_decision: {
    confidence_score: 1-10
    confidence_captured_at: timestamp
  }

  council: {
    response_generated_at: timestamp
    personas_included: string[]
  }

  outcome: {
    recorded_at: timestamp  // 30-day, 90-day, or 180-day
    what_decided: string
    outcome_quality: "better_than_expected" | "as_expected" | "worse_than_expected" | "too_early"
    council_helped: "yes" | "partially" | "no"
    retrospective_confidence: 1-10  // "knowing what you know now, how confident were you?"
    notes: string
    calibration_delta: number  // pre_confidence - retrospective_confidence (computed)
  }

  analogs: {
    retrieved_at: timestamp
    top_3: [{ case_id: string, structural_match_score: number, user_rating: 1-5 }]
  }
}
```

The key innovation in this schema is `calibration_delta` — the computed difference between pre-decision confidence and retrospective confidence. This is a data point no competitor collects because no competitor has the ontology vector to compare it against across dimensions.

---

## 8. Minimum Viable Ontology Vector Schema

For the first production implementation, scope to the 8 dimensions with highest IRR and highest product leverage. Add the remaining 6 in v1.1 after the scorer is validated on real sessions.

**Phase 1 (build now):**
```typescript
type OntologyVector = {
  reversibility: Score        // IRR 85% (post-rewrite 95%+)
  time_horizon: Score         // IRR 100%
  stakes_magnitude: Score     // IRR 90%
  outcome_uncertainty: Score  // IRR 95%
  value_conflict: Score       // IRR 96%
  identity_alignment: Score   // IRR 91% — Novel, highest leverage
  regret_asymmetry: Score     // IRR 85% — Novel, highest leverage
  upstream_dependency: Score  // IRR 65% (post-rewrite 88%+) — Novel, highest leverage
}

type Score = {
  value: 1 | 2 | 3 | 4 | 5
  confidence: number  // 0.0–1.0
  rationale: string   // 1–2 sentences from the scorer
}
```

**Phase 2 (add after 20 real sessions):**
```typescript
  ambiguity: Score            // IRR 88%
  task_complexity: Score      // IRR 92%
  decision_discriminating_info: Score  // IRR 75% (post-rewrite 90%+)
  time_pressure: Score        // IRR 94%
  decision_unit: Score        // IRR 80% (post-rewrite 92%+)
  emotional_intensity: Score  // IRR 93%
```

**Why phase it this way:** The three novel dimensions (identity_alignment, regret_asymmetry, upstream_dependency) are the highest product leverage and the highest research novelty. They must be in Phase 1. The six established dimensions with post-rewrite expected IRR issues (reversibility, info, decision_unit) should not delay Phase 1 — add them as they stabilize.

---

## 9. Hard-Coded Examiner Intervention Rules From the Ontology

These are the 12 rules from Section 6 of the research document, stated here as implementation specifications:

**R1 — Upstream Dependency Block [REDIRECT, P0]**
Trigger: `upstream_dependency.value >= 5`
Action: Block Council entirely. Surface: "Before we work on this decision, there is a prior question that must be resolved first." Log: upstream decision as a dependency link.
Hard gate: No Council invocation until user either (a) returns to address the upstream decision or (b) explicitly marks it as "acknowledged, proceeding anyway" (which is also logged).

**R2 — Identity-First Gate [GATE, P0]**
Trigger: `identity_alignment.value >= 5 AND ambiguity.value >= 4`
Action: Gate Council. Ask: "If you imagine yourself at 75 looking back, what would make you feel you made the right call — not financially, but as a person?" Store answer. Pass to Council as `identity_anchor`.

**R3 — No-Information Mode [GATE, P0]**
Trigger: `decision_discriminating_info.value <= 1 AND outcome_uncertainty.value >= 4`
Action: Gate Council. Block data-driven recommendations. Ask: "What do you believe is permanently true about [core subject] — regardless of what the world looks like in [time_horizon] years?" Store answer as `values_anchor`.

**R4 — Regret Asymmetry Alert [FLAG, P1]**
Trigger: `regret_asymmetry.value >= 5`
Action: Flag. Ask: "At 75, looking back — which mistake would be harder to live with: having done this, or not having done it?" Special case: if both errors catastrophic (IBM/Gerstner pattern), surface as DOUBLE-BIND, not asymmetry.

**R5 — False Urgency Detector [FLAG, P1]**
Trigger: `emotional_intensity.value >= 4 AND time_pressure.value <= 2`
Action: Flag. Say: "There is no real external deadline here. What is creating the internal sense of urgency?" Log: whether user acknowledges the gap or dismisses the flag.

**R6 — Multi-Party Alignment Check [FLAG, P1]**
Trigger: `decision_unit.value >= 3 AND emotional_intensity.value >= 4`
Action: Ask: "Have you had a real conversation with [stakeholder] about what they actually want — not what you assume they want?"

**R7 — Information-First Redirect [REDIRECT, P1]**
Trigger: `decision_discriminating_info.value >= 4 AND outcome_uncertainty.value >= 3 AND identity_alignment.value <= 3`
Action: Redirect. Say: "There is specific information that would change this decision, and you do not have it yet. What would it take to gather it in the next week?" Block Council until user confirms information gathering plan.

**R8 — Irreconcilable Values Alert [FLAG, P1]**
Trigger: `value_conflict.value >= 5 AND identity_alignment.value >= 4`
Action: Flag. Name both values explicitly. Ask: "Which value are you not willing to betray, even if it costs you the other?"

**R9 — Irreversibility Warning [FLAG, P1]**
Trigger: `reversibility.value >= 4 AND time_pressure.value <= 2 AND emotional_intensity.value >= 4`
Action: Flag. Say: "This decision is essentially irreversible — and there is no real deadline. What would you need to know or feel before you would be ready?" Slow the decision down.

**R10 — Complexity Overload Alert [GATE, P2]**
Trigger: `task_complexity.value >= 5 AND ambiguity.value >= 4`
Action: Gate. Ask: "If you could resolve only one question that would most change your thinking, what would it be?" Decompose before Council proceeds.

**R11 — Avoidance Detection [BACKGROUND JOB, P2]**
Trigger: `upstream_dependency.value >= 4 AND days_open >= 45 AND no_new_action`
Action: Background job (Railway cron). Surface in Mirror. Say: "This decision has been open [N] days. The upstream question has not moved. What would take this forward in the next two weeks?"

**R12 — Couple Misalignment Check [FLAG, P2]**
Trigger: `decision_unit.value == 2 AND value_conflict.value >= 4`
Action: Ask: "What has [partner] actually said they want — in their own words, not what you think they would say?"

**Implementation priority:** R1, R2, R3 must ship in the first version of the Rule Engine. These are hard stops and gates. R4–R9 can ship in the second version. R10–R12 can ship in the third. Do not ship R11 without the Railway cron.

---

## 10. CLEAR / CAUTION / STOP Without Copying Rubicon's Enterprise Language

Rubicon uses CLEAR / CAUTION / STOP because it targets enterprise governance and compliance teams. That language is correct for that market. It is wrong for a private HNI/founder product.

Quorum's equivalent:

**PROCEED** (maps to CLEAR)
Displayed when: no REDIRECT or GATE rules fire. Council can give full advice.
Visual: no prominent state indicator — PROCEED is the default, unmarked state. The absence of a gate *is* the signal.

**BEFORE WE GO FURTHER** (maps to CAUTION)  
Displayed when: one or more GATE rules fire. Council is held.
Visual: a single warm-toned card above the Council loading state. "The Council has reviewed your decision. Before we share their analysis, there is a question we need to work through first." Then the Examiner question. No alarm. No flag emoji. A private conversation, not a warning system.

**THIS DECISION ISN'T READY** (maps to STOP)
Displayed when: R1 or R7 fires (REDIRECT mode).
Visual: the Council loading state never starts. A single card explains: "Working on this decision now would produce an answer that won't hold — because [upstream reason / information gap]. Here is what needs to happen first." Gives the user a specific next action, not a dead end.

The tone difference from Rubicon: Rubicon sounds like a compliance officer. Quorum sounds like a trusted advisor who has seen your file and is telling you something important before the meeting starts. Same structure, completely different register.

---

## 11. How Mirror Should Evolve from Display Module to Longitudinal Judgment-Pattern Engine

**Current state:** Mirror displays Timeline, Fingerprint, Independence Score, Rules, Contradictions. These are read-only visualizations of existing data. They do not detect patterns across sessions. They do not generate insights that could not be computed from a single session.

**What Mirror must become:**

Phase 1 — Pattern accumulation (requires 5+ sessions). Mirror reads all fired Examiner rules across sessions and counts frequencies. "R5 (False Urgency) has fired in 3 of your 5 decisions." This is the Pattern Store referenced in the research doc but not yet built.

Phase 2 — Pattern trigger surface (requires 8+ sessions). When the same rule fires 3+ times, Mirror surfaces a Pattern Trigger: not just "R5 fired again" but a characterization: "You consistently bring decisions with a sense of urgency. In [X of Y] cases, no real external deadline existed. This may be your default framing style, not the decision's structure." The framing must be observational, not clinical.

Phase 3 — Calibration engine (requires 5+ outcomes). Mirror computes calibration scores: average pre-decision confidence vs. average retrospective confidence, segmented by ontology dimension. "Your high-stakes decisions (stakes >= 4) show consistent overconfidence — average delta of -2.1. Your low-stakes decisions are well-calibrated." This is the "compare confidence vs. reality" component of the core thesis.

Phase 4 — Contradiction causal layer (requires 5+ outcomes + Contradiction Detector unlock). Mirror connects: contradiction fired at session X + outcome captured at session X + 30/90 days = "The contradiction between your stated value of long-term thinking and your choice in [session] was associated with [outcome]. This pattern has appeared in [N] decisions." This is the `causalReady` flag that exists in the code but is not yet wired to any output.

**The key architectural shift:** Mirror must read from the Ledger's structured fields (ontology vectors, rule firings, calibration deltas), not from AI-generated text. Pattern detection that runs on structured data is reproducible, auditable, and improvable. Pattern detection that runs on AI-summarized text is opaque and non-compounding.

---

## 12. How Quorum Should Detect "How This User Is Repeatedly Wrong" Without Shallow Bias Labels

Do not label biases. Do not say "you show signs of overconfidence bias" or "this looks like loss aversion." These labels are borrowed from academic psychology, understood differently by different people, and produce defensiveness rather than insight.

Instead, detect structural recurrence:

**Recurrence type 1 — Rule pattern.** The same Examiner rule fires repeatedly for the same user. "In 4 of 6 decisions, the Examiner found no real external deadline (R5). The urgency was internally generated." This is an empirical observation, not a bias label.

**Recurrence type 2 — Ontology pattern.** Certain dimensions consistently score at extremes for this user. "Every decision you bring has identity_alignment >= 4. You may be using Quorum primarily for decisions where your sense of self is at stake — and possibly avoiding decisions where the right answer is analytically clear." This is an insight about usage pattern, not a personality label.

**Recurrence type 3 — Calibration pattern.** The user consistently rates pre-decision confidence higher than retrospective confidence for decisions with specific ontology profiles. "When value_conflict is high (4–5), your pre-decision confidence is on average 2.3 points higher than your retrospective assessment. You may systematically underestimate how much value conflict affects decision quality."

**Recurrence type 4 — Outcome pattern (requires 5+ outcomes).** The user's decisions with certain ontology profiles show systematically worse outcomes. "Decisions where upstream_dependency >= 4 have produced 'worse than expected' outcomes in [N] of [M] cases." This is an empirical finding, not a theoretical claim about how the user thinks.

The rule: detect patterns across structured data. Name what happened. Do not name what the user *is*. The difference is: "In 4 decisions, X happened" vs. "You are the kind of person who does X." The first is observable. The second is a psychological label that will be resisted.

---

## 13. How Emotional State Should Be Captured Without Making the Product Feel Like Therapy

**The problem with direct emotional capture:** If Quorum asks "How are you feeling about this decision?" it becomes a therapy app. HNI/CXO users will not use a therapy app for a ₹25K decision. They will use a sharp advisory system.

**The solution: emotional state as a structural inference, not a self-report.**

`emotional_intensity` is already scored by the Ontology Scorer from the decision text. The user never answers "how emotional are you?" The system infers it from: word choice, stakes framing, time pressure framing, and whether the user describes the decision in terms of consequences vs. feelings.

The only explicit emotional data collected from the user:
- The pre-decision confidence score (1–10) — this is implicitly emotional but framed as cognitive.
- The Examiner's identity/values questions (R2, R3, R8) — these surface emotional stakes through strategic questions, not direct emotional inquiry.
- The outcome retrospective note — free text, where emotional state emerges naturally.

**What to never do:** Ask "how are you feeling about this?" Ask "what emotions are coming up for you?" Use the word "anxiety," "fear," or "grief" in the product UI. These are therapy words.

**What to always do:** Ask "what would make this feel right?" Ask "at 75, looking back..." Ask "which error would be harder to live with?" These surface emotional reality through forward-projection and consequence framing. The emotional content emerges; the product does not extract it directly.

---

## 14. How Confidence-Before and Outcome-After Should Create Calibration Scores

**The calibration score formula:**

```
decision_calibration_delta = pre_decision_confidence - retrospective_confidence

user_calibration_score = mean(decision_calibration_delta) across N decisions with outcomes

dimension_calibration = mean(delta) segmented by ontology dimension value
```

**What this produces:**

A user_calibration_score of +2.1 means the user is systematically overconfident by 2.1 points on average. A score of -0.5 means they are slightly underconfident. A score near 0 means they are well-calibrated.

The dimension_calibration is the more powerful insight. "When identity_alignment = 5, your average delta is +3.2 (severely overconfident). When identity_alignment = 1, your average delta is +0.3 (well-calibrated). Your confidence is unreliable specifically when identity is at stake." This is a finding that no personality questionnaire can generate.

**Minimum threshold:** Calibration scores should not be surfaced until the user has at least 5 decisions with outcome data. Before that threshold, the score is shown as "building" with the milestone counter.

**UI presentation:** Do not show the raw delta number. Show it as: "Your decisions are [well-calibrated / showing a confidence gap / showing excess caution]" + a sparkline of deltas over time. The number is the engine; the interpretation is the product.

---

## 15. How Outcome Review Should Work at 30/90/180 Days

**30-day review (primary):**
Trigger: Railway cron queries `sessions_pending_outcomes` view. Sends a single-action prompt via WhatsApp or email: "How did [decision summary] play out? [Better than expected / As expected / Worse than expected / Too early to say]" + a free-text field for notes. Single tap. No login required for the initial capture. Outcome stored immediately.

After capture: "How helpful was the Council's analysis in retrospect? [Yes / Partially / No]" One more tap.

After that: "Knowing what you know now, how confident were you going in? (1–10)" This is the retrospective_confidence score. The delta is computed automatically.

**90-day review:**
Only triggered if: the 30-day response was "Too early to say" OR the decision had `reversibility >= 4` (irreversible decisions deserve longer tracking). Same format as 30-day, plus: "Has anything changed in how you think about this decision?" Free text.

**180-day review:**
Only triggered for: decisions with `time_horizon >= 4` OR decisions where the 90-day response was still "Too early to say." At this point, Quorum surfaces the Examiner flags from the original session: "When you submitted this decision, the Examiner flagged [rule]. Looking back — was that flag right?" Yes / No / Partially. This is a validation data point for the rule engine.

**What 180-day data enables:** Retrospective rule validation. "R4 (Regret Asymmetry Alert) fired in [N] decisions. In [X%] of those decisions, the outcome confirmed that not acting was the worse error." This is publishable as product outcome data.

---

## 16. How Structural Analog Retrieval Should Work

**The current state:** `structural-retrieval` exists in the codebase but uses a smaller proxy ontology, not the 14-dimensional vector.

**Target architecture:**

**Step 1 — Ontology vector similarity.** For each decision, compute Euclidean distance between the decision's ontology vector and every case in the corpus. Weight the three novel dimensions higher: identity_alignment × 2.0, regret_asymmetry × 1.8, upstream_dependency × 1.8. Downweight dimensions that do not discriminate: emotional_intensity × 0.7 (high in almost all HNI cases), task_complexity × 0.8 (high in almost all complex decisions).

**Step 2 — Semantic similarity.** Run embedding similarity between decision text and case summary text. This catches surface-level domain matches (tech founder → tech founder cases) that ontology similarity misses.

**Step 3 — Hybrid scoring.** Final score = 0.6 × ontology_similarity + 0.4 × semantic_similarity. These weights are the starting point. After 50+ analog ratings, run regression to find the weights that best predict user rating. Update the weights. This is a learning retrieval system.

**Step 4 — User rating feedback loop.** After Council responds, show the top analog with a 1–5 rating prompt: "How useful was the [Case] comparison?" Store rating with session_id + analog_id + ontology_vector. After 20+ ratings per dimension profile, the system can learn which analogs are useful for which ontology patterns.

**Why the v0.6 finding matters for implementation:** Buffett/Apple scored structurally high for Coast FIRE but was rated lower than Patagonia/Chouinard. This means structural match alone does not predict user utility. The retrieval must also weight *narrative resonance* — does this case feel like something the user's peer group would know and respect? India-context cases should be weighted up for Indian users. Founder cases should be weighted up for founder users. This is a personalization layer on top of ontology similarity.

---

## 17. How Quorum Should Build Private Benchmarking Without Exposing Private User Decisions

**The fundamental constraint:** User decisions are private. No user data can be used to benchmark against other users in an identifiable way.

**The solution: dimension-level aggregate benchmarking, never decision-level.**

Quorum can compute, across all sessions in the database: average ontology vector per decision type (career, financial, family, health). Average calibration delta per dimension. Average rule-firing rate. These are aggregate statistics with no decision content attached.

Then: "Your pre-decision confidence in high-stakes financial decisions (stakes >= 4) is 7.2 on average. Across all Quorum users, the average is 6.4. You tend toward overconfidence relative to this benchmark." The user sees their number vs. an aggregate. No individual user's decision is exposed.

**The private benchmark corpus:** The 45-case annotated corpus in the research doc is the initial benchmark. As real sessions accumulate (with user consent to aggregate anonymized dimension scores), the benchmark becomes empirically derived. "People who bring career-identity decisions (identity_alignment >= 4, decision_unit <= 2) to Quorum show an average pre-decision confidence of 6.8." This is a peer group comparison without exposing any peer's decision.

**What this enables:** A "How do you compare?" section in Mirror (gated behind paid tier, requires 5+ sessions). Not a leaderboard. A calibration context. "Your false urgency rate (R5 firings as % of decisions) is 67%. Across similar users, the average is 28%. This is worth understanding."

---

## 18. How the Decision Graph Should Work So It Is Not Decorative

**Current status:** Do not build. The handover doc is correct. Graph needs 50 sessions per user to find meaningful cross-decision links. No active user has 50 sessions. Building the visualization before the data exists is expensive UI that shows empty nodes.

**What to build in preparation (low cost, high future leverage):**

Store upstream links now. Every time R1 fires and the user identifies an upstream decision, create a `decision_dependency` row: `{ from_session_id, to_session_id, dependency_type: "upstream" | "downstream" | "enables" | "conflicts_with" }`. This is the graph data layer. Build it now, visualize it when there is data.

**When the graph should be built (future, not now):**
The graph is defensible only if it surfaces non-obvious links — "This decision about your career connects to a financial decision you made 8 months ago, which in turn constrains your parenting decision." That requires: 20+ decisions per user, ontology vector similarity to detect non-explicit links, and a graph traversal algorithm that finds structural (not just user-stated) dependencies.

The visualization should show: decision nodes (colored by verdict state), dependency edges (from user-stated upstream links), structural similarity edges (auto-detected from ontology vectors), outcome edges (green = good outcome, red = worse than expected). Each edge tells a story. An empty graph tells nothing.

**Hard rule:** Do not build the graph until you have one user with 20+ decisions and can test whether the graph is telling that user something they did not know. If the graph does not generate at least one genuine insight for that user, it is decorative. Abort.

---

## 19. Features That No Global Product Seems to Have Fully Solved

**1. Pre-decision structural classification + post-outcome validation loop.**
No product combines: (a) structured ontology scoring at decision time, (b) examiner interventions derived from the score, and (c) retroactive validation of those interventions against outcomes. Rubicon Probity approaches this but has not published outcome data. This is Quorum's most publishable claim if it collects enough data.

**2. Upstream dependency detection as a product feature.**
No product explicitly detects "this decision cannot be resolved yet because a prior decision is unresolved." Decision Journal captures what you decided. Hindsight tracks outcomes. No one surfaces false clarity — the state where a user *thinks* they are deciding but is actually responding to a mis-specified question. This is the most novel product behavior Quorum can offer and the hardest for any competitor to copy without the ontology infrastructure.

**3. Identity alignment as a diagnostic dimension.**
No product asks: "Is this a decision about what to do, or a decision about who you want to be?" The distinction changes the entire advisory logic — values-first vs. analysis-first. Wizer gestures toward this with "decision DNA" but operationalizes it as a personality questionnaire, not a structural feature of individual decisions. Quorum's identity_alignment dimension is a per-decision score, not a user-level trait.

**4. Calibration scoring across ontology dimension profiles.**
"Your confidence is unreliable specifically when identity_alignment is high" is a finding that no product currently produces. This requires the intersection of: pre-decision confidence capture, 14-dimensional ontology scoring, and post-outcome retrospective confidence. Three data points that no existing product collects together.

**5. Examiner rule retroactive validation.**
At 180 days, asking "the Examiner flagged regret asymmetry — was it right?" creates a feedback loop that improves the rule engine over time. This is a self-improving advisory system. No competitor does this because no competitor has the rule engine infrastructure to validate.

---

## 20. Features That Should Not Be Built Yet

**The Decision Graph.** Answered above. Needs 50 sessions/user minimum. Currently decorative.

**The Legacy module.** The handover doc is correct — 18–24 months away. No use case is clear enough to build.

**Analog retrieval in the product UI.** The research shows retrieval quality is strong (avg 4.2/5 rating). But retrieval requires: ontology scorer running in production, corpus scaled to 100+ cases, and hybrid similarity algorithm with user-rating feedback loop. Build the scorer first. Retrieval is Phase 2.

**Benchmarking against other users.** Not until there are 50+ users with 5+ sessions each. Before that, the benchmark is not statistically meaningful.

**Any new Council persona.** The instruction to not add generic personas stands. If identity_alignment >= 5 cases consistently show a gap (no persona addresses the identity question directly), consider an Identity Auditor persona — but only after seeing this gap in real session data.

**Mobile app.** Premature. The session flow requires deliberate engagement. Mobile context is wrong for high-stakes decisions. The website + WhatsApp prompt for outcome capture is the right interface for now.

**Public case library.** The research corpus is a research asset. Publishing it without academic validation would invite legitimate criticism. Hold until there is IRR documentation, methodological statement, and at least one external reviewer.

---

## 21. Minimum Defensible System in 14 Days

**Day 1–3: Ontology Scorer (P0)**
Build a single API route (`/api/ontology/score`) that takes decision text and returns the Phase 1 ontology vector (8 dimensions: reversibility, time_horizon, stakes_magnitude, outcome_uncertainty, value_conflict, identity_alignment, regret_asymmetry, upstream_dependency). Use a structured output prompt with JSON-only response. Validate output against schema. Store result in a new `ontology_scores` table (session_id + 8 dimension scores + confidence values + rationale strings).

Cost: one AI call per session. Acceptable.

**Day 3–5: Rule Engine (P1)**
Build a deterministic rule evaluator that takes an ontology vector and returns: verdict (REDIRECT / GATE / OPEN), triggered rules array, question text per triggered rule. No AI calls — pure logic. Start with R1, R2, R3, R4, R5. These cover the most critical interventions.

**Day 5–7: Wire Examiner Sequencer to Rule Engine**
Currently, the Examiner invokes Council immediately. Insert the Rule Engine output between submission and Council invocation. If verdict = REDIRECT, block Council entirely and show the redirect question. If verdict = GATE, show the values question and pass the answer to Council. If verdict = OPEN, proceed as today but append ontology vector to Council system prompt.

**Day 7–9: Pre-Decision Confidence Capture**
Before displaying any Council response, add a single UX step: "Before we show you the Council's analysis — how confident are you in this decision right now? (1–10)." Store in `sessions` table. This is 3 hours of UI work.

**Day 9–11: Council Context Enrichment**
Modify `lib/personas.ts` to receive ontology vector + triggered rules as system prompt context. At minimum: if identity_alignment >= 4, instruct every persona to reference the identity question. If regret_asymmetry >= 5, instruct the Risk Architect to name which error is recoverable. If upstream_dependency >= 4, instruct the Elder to name the prior decision. This is prompt engineering, not new infrastructure.

**Day 11–12: Calibration Delta Computation**
Add `calibration_delta` column to `outcomes` table. On outcome record: compute delta = pre_decision_confidence - retrospective_confidence. Store. Surface in Mirror as: "Your calibration trend" with a sparkline of deltas (requires 3+ outcomes).

**Day 12–14: Analog retrieval v0.1**
Hardcode the top 3 analogs for the 10 most common ontology patterns (from the 45-case corpus). Do not build a live retrieval algorithm yet. When the ontology vector matches a known pattern, surface the pre-computed analog. This is a static lookup table, not an algorithm. It gets analog retrieval into the product at zero complexity cost. Build the real retrieval algorithm in Sprint 12.

**What this 14-day build gives you:** An actual decision intelligence product, not a decision advice product. The ontology scorer, rule engine, and pre-decision confidence capture are the infrastructure that makes every other claim true.

---

## 22. 30-Day Build Roadmap Ranked by Moat Impact

**Week 1: Ontology Scorer + Rule Engine (moat impact: 10/10)**
This is the foundational infrastructure. Everything else depends on it. Nothing else should be built until this exists.

**Week 2: Examiner → Council → Ledger pipeline (moat impact: 9/10)**
Wire the full flow: Ontology Scorer → Rule Engine → Examiner Sequencer → enriched Council context → Ledger storage. This is the first time Quorum functions as described in the product thesis, not just in the research document.

**Week 3: Pre-decision confidence + calibration delta (moat impact: 8/10)**
Add the confidence capture before Council display. Wire calibration delta computation. Surface in Mirror when 3+ outcomes exist. This is the numerator for the most defensible claim Quorum can make: "we track whether your confidence is calibrated to reality."

**Week 4: Mirror Pattern Store (moat impact: 7/10)**
Build the pattern accumulation layer: count rule firings per user, surface Pattern Trigger when same rule fires 3+ times. This is the beginning of longitudinal judgment profiling — the feature that turns Quorum from a decision tool into a decision intelligence system.

**What to deprioritize in this 30-day window:** Analog retrieval algorithm (hardcoded lookup is sufficient), Decision Graph (not ready), GTM (hold at 10c until Stage Gate is met), any new UI polish that is not connected to moat-building infrastructure.

---

## 23. Research Validation Needed for Scientific Defensibility

**The current honest state:** The 14-dimensional ontology has strong IRR in internal testing (85–98% within-1 across three rater batches), but the rater pool is: one AI (Claude), one AI (Copilot/ChatGPT), and one human (the founder). This is not a scientifically defensible IRR claim. It is a rigorous internal validation. The distinction matters if Quorum intends to make publishable claims.

**What is needed for scientific credibility:**

1. **At least 3 human raters with no stake in the product.** They should receive: the ontology definitions, 30–40 cases (blinded — no case names, no outcomes), and rating instructions. IRR computed between human raters only. AI raters can be checked against human raters as a validation step, but AI-only IRR is not publishable.

2. **Pre-registered annotation protocol.** The annotation instructions, dimension definitions, and scoring rubrics should be published (even as a working paper on SSRN or arXiv) before the validation run, so that the IRR result cannot be post-hoc tuned.

3. **Outcome validation for Examiner rules.** The rules are derived from 45 cases and structured reasoning. They have not been tested against outcome data. The 180-day retrospective question ("was the Examiner flag right?") is the validation mechanism. This requires real sessions with outcome follow-through. Target: 50 sessions with 6-month outcomes before claiming predictive validity.

4. **External domain expert review.** For the three novel dimensions (identity alignment, regret asymmetry, upstream dependency), at least one researcher in judgment/decision-making, behavioral economics, or related field should review the construct definitions and scoring rubrics. A letter of review from one domain expert is the minimum credibility signal for investor-facing or academic claims.

---

## 24. Publishable Claims From Real User Data

**Claim 1 (requires 100 sessions, 30+ outcomes):**
"Upstream dependency detection as an intervention — users who were redirected via R1 show [X% lower / higher] decision revision rates than users who proceeded without redirection." This validates the False Clarity concept empirically.

**Claim 2 (requires 200 sessions, 5 outcomes per user, 20+ users):**
"Calibration score trajectories over repeated Quorum use — users show measurable improvement in confidence calibration after N decisions, suggesting the system functions as a judgment compounding instrument." This is the longitudinal learning claim.

**Claim 3 (requires 50 sessions, 30+ outcomes):**
"Identity alignment as a predictor of decision difficulty and post-decision satisfaction — decisions with identity_alignment >= 4 show systematically lower pre-decision confidence and higher retrospective satisfaction variance than decisions with identity_alignment <= 2." This is the novel dimension validation.

**Claim 4 (requires 200+ analog ratings):**
"Structural ontology similarity vs. user-perceived analog utility — a regression model shows that identity alignment and regret asymmetry weights are the strongest predictors of analog utility, outperforming conventional dimensions (task complexity, emotional intensity)." This validates the retrieval weight tuning from Section 5 of the research doc.

**Claim 5 (requires 100+ contradiction detections, 50+ outcomes):**
"Contradiction detection as a decision quality signal — users whose contradictions were surfaced before outcome showed lower 'worse than expected' outcome rates than users whose contradictions were detected post-outcome." This is the Contradiction Detector causal validation.

None of these are publishable today. All of them are achievable within 12–18 months if the data infrastructure is built correctly now.

---

## 25. Top 5 Failure Risks

**Risk 1: The ontology scorer is not accurate enough on real sessions.**
The 14-dimensional ontology was designed on 45 curated cases. Real user decisions will be messier, more ambiguous, more briefly described. If the scorer consistently misclassifies dimensions (e.g., scores upstream_dependency low when it is actually high), the Rule Engine fires the wrong rules, and the product actively gives bad advice. Mitigation: add a user-visible confidence threshold — if any dimension confidence < 0.5, surface a clarifying question before running the Rule Engine. Never run rules on low-confidence scores.

**Risk 2: The Stage Gate is not passed, and the product is built for zero users.**
The current stage gate is correct: 1 paying live session + 1 returning user. If GTM (Sprint 10c) does not produce these within 30 days, the product is building increasingly sophisticated infrastructure for a user base that does not exist. The research architecture is meaningless without real user data. Mitigation: all build work in the next 30 days must be evaluated against this criterion — does this help convert or retain real users, or is it purely infrastructure?

**Risk 3: The outcome loop fails because users do not complete 30-day reviews.**
The causal layer, calibration scores, and longitudinal pattern detection all require outcome data. If users submit one decision and never return for the outcome prompt, the entire longitudinal value proposition collapses. Mitigation: the 30-day prompt should be a single-action WhatsApp message, not an email requiring login. Friction kills outcome capture. The `sessions_pending_outcomes` view is built — wire it to Railway cron immediately.

**Risk 4: The Contradiction Detector produces false positives on real users and creates distrust.**
The PASS2_PROMPT was tightened in Sprint 10a, and the simultaneous-truth test significantly reduces false positives. But a false contradiction surfaced to a real paying user ("you said you value long-term thinking, but then...") will be felt as an accusation, not an insight. One bad experience can kill the product for that user. Mitigation: surface contradictions as questions, not statements. "In two decisions, you seemed to prioritize different things — is that a contradiction, or is there a principle we're missing?" Let the user validate before Quorum asserts.

**Risk 5: The positioning fails and Quorum becomes a premium AI chatbot in the market's mind.**
The Apple × McKinsey positioning is correct as a target. But the actual user experience is: submit decision text → get 6 AI paragraphs + synthesis. Without the Examiner gates, pre-decision confidence capture, and longitudinal Mirror, this *is* a premium AI chatbot. The Stage Gate must also be a product gate: do not run live sessions until the Ontology Scorer and Rule Engine are wired in. Otherwise, the live sessions become testimonials for a product that does not yet exist.

---

## 26. Quorum's Final Moat Statement Against All Competitors

**Against OpenAI / generic AI:**
OpenAI can generate Council-quality analysis for any decision. It cannot learn *your* decision patterns across 20 decisions, detect *your* calibration gaps, or flag *your* recurring judgment failures — because it has no longitudinal memory, no structural ontology, and no outcome loop. Quorum's moat is not intelligence. It is accumulated private judgment data that gets more accurate about you specifically over time. OpenAI has no incentive to build this for individual users. It is a platform, not a personal system.

**Against Notion / second-brain tools:**
Notion captures your thinking. It does not challenge it, score it, detect contradictions in it, or tell you that you have been wrong in the same way four times. A second brain is a filing cabinet. Quorum is a thinking partner that has read all your previous files and has something specific to say about how you think.

**Against generic AI coaches:**
Generic AI coaching products (Pi.ai, etc.) build a relationship and offer general wisdom. They do not have a 14-dimensional decision ontology, do not score your decisions structurally, and do not tell you that your pre-decision confidence in high-identity-alignment decisions is calibrated 2.3 points higher than reality. They are emotionally intelligent. Quorum is structurally rigorous.

**Against decision journals (Decira, etc.):**
Decision journals capture pre-decision reasoning and post-decision outcomes. They do not challenge the framing of the decision before it is made. They do not detect when a decision cannot be resolved because a prior decision is unresolved. They do not surface the structural analog that is most similar to this decision in the space of all historical decisions. They are memory. Quorum is intelligence applied to memory.

**Against Rubicon Probity:**
Rubicon is built for enterprise governance — audit trails, compliance language, 150+ bias labels. Its target user is a risk committee, not a founder. Its positioning is accountability, not insight. Quorum's target user does not want to be audited. They want a private thinking partner that makes their judgment better, not a compliance system that documents their decisions for review boards.

**Against Deciso:**
Deciso offers a multi-persona advisory council and temporal consequence mapping. It does not have a structural decision ontology. It does not detect upstream dependency. It does not accumulate longitudinal judgment profiles. It does not calibrate confidence against outcomes. It is stateless advice from AI personas. Quorum is a compounding private intelligence system.

**Against Hindsight:**
Hindsight is an excellent decision record system with scheduled reviews. It does not have an advisory intelligence layer. It does not challenge decisions before they are made. It does not detect structural decision patterns or calibrate confidence. It is a living archive. Quorum is an active advisory system with a living archive as its foundation.

**Against Wizer:**
Wizer detects decision blind spots from a questionnaire and applies them to team decisions. It is self-reported profile, not empirically derived judgment profile. It is team-first, not private. Its blind-spot detection cannot distinguish between "I have a personality trait" and "in 4 of 6 decisions, this specific structural pattern produced this specific rule firing." Quorum derives your judgment profile from actual decision behavior, not self-report.

**The single moat sentence:**
Quorum is the only system that stores your full decision history as structured, comparable data — ontology vectors, rule firings, confidence scores, and outcomes — and uses that accumulated private data to detect your specific judgment patterns, calibration gaps, and recurring blind spots in a way that becomes more accurate with every decision you bring.

The moat is not the AI. The moat is the data structure. And the data structure compounds.

---

# Research Plan Changes Required Now

## What Changes from Research Working Doc v0.6

**Change 1: Ontology scorer must move from research output to production code immediately.**
v0.6 treats the 14-dimensional ontology as a research validation exercise. Given Handover v10, the scorer must become production infrastructure in the next 14 days. The research task (annotating 60+ cases, improving IRR) and the build task (ontology scorer API route) are now parallel workstreams, not sequential.

**Change 2: The three novel dimensions are Phase 1, not Phase 2.**
In v0.6, the novel dimensions (identity_alignment, regret_asymmetry, upstream_dependency) are flagged as research contributions. In the build architecture, they are Phase 1 implementation priorities — the highest product leverage dimensions in the vector.

**Change 3: Analog retrieval is Phase 2, not Phase 1.**
v0.6 treats retrieval as an immediate product output. Given that the ontology scorer does not yet exist in production and the corpus is 45 cases (below the ~100 needed for retrieval to be useful), analog retrieval should be implemented as a hardcoded lookup table in the next 14 days and replaced with a live retrieval algorithm in Sprint 12+.

**Change 4: IRR validation methodology must be upgraded.**
v0.6 reports IRR from AI raters. For scientific defensibility, at least 3 human raters must annotate 30–40 cases with no stake in the product. This is a 4–6 week task that should be scoped as a separate workstream, not delayed indefinitely.

## What Stays Unchanged

The 14-dimensional ontology structure. All 14 dimensions have survived empirical stress-testing and are stable. Do not add or remove dimensions without full re-validation.

The 12 Examiner rules. The rule logic is sound. The only change is implementation priority (R1–R5 in Phase 1, R6–R10 in Phase 2, R10–R12 in Phase 3).

The three-rater relay method. AI-relay is the right zero-cost research method for corpus expansion. Continue using it for corpus gap filling (Section 8 corpus gap prompts are still valid).

The three novel publishable angles. Identity alignment, regret asymmetry, upstream dependency are genuinely novel. Hold them for academic submission — but do not make public claims without the human-rater validation.

The handover doc's stage gate. 1 paying live session + 1 returning user before Sprint 11. This is correct and should not be moved.

## What Must Be Deprioritized

Expanding the corpus beyond 60 cases right now. The corpus is sufficient to test the ontology scorer. Expanding to 100+ cases is a Phase 2 task after the scorer is validated on real sessions.

Any new UI polish that is not connected to ontology-vector-driven features. The website is shipped. The PDF is shipped. Mirror has 5 sections. Stop building display layers.

Academic paper drafting. Do not draft the working papers until human-rater IRR validation is complete and real user outcome data exists. Premature publication invites legitimate criticism of the AI-only rater pool.

Decision Graph. Repeated here for emphasis. Do not scope.

## What Must Be Implemented in the Next 14 Days

1. Ontology Scorer API route — Phase 1 (8 dimensions). Takes decision text, returns scored vector + confidence + rationale. Stores in `ontology_scores` table.
2. Rule Engine — deterministic logic evaluator. Takes vector, returns verdict + triggered rules + questions. R1–R5 minimum.
3. Examiner gate — wired between submission and Council invocation. REDIRECT blocks Council. GATE holds Council, asks values question, passes answer to Council context.
4. Pre-decision confidence capture — single UX step before Council display. Stored in sessions table.
5. Council context enrichment — ontology vector + triggered rules appended to persona system prompts. Minimum: identity_alignment and regret_asymmetry signals to Elder and Risk Architect.
6. Railway cron for outcome nudges — 30-day prompt via `sessions_pending_outcomes`. Single-action WhatsApp preferred.

## What Must Be Validated Before Claiming Scientific Defensibility

1. Human-rater IRR on 30+ cases (3 independent raters, no product stake).
2. Pre-registered annotation protocol published (working paper or SSRN).
3. Ontology scorer accuracy tested on 20+ real user sessions (scorer vs. human annotation).
4. Examiner rule retroactive validation via 180-day outcome question (target: 50 sessions).
5. External domain expert review of the three novel dimensions.

Until these five conditions are met, Quorum can accurately say: "built on a 14-dimensional decision ontology validated through an internal AI-relay research protocol with 45 annotated cases." It cannot accurately say: "scientifically validated decision intelligence." The distinction matters for investor credibility and academic defensibility.

## How Handover v10 Changes the Research Roadmap

**The Contradiction Detector is further ahead than the Ontology Scorer.** The two-pass pipeline is live, validated, and tightened. But its causal layer (does the contradiction predict worse outcomes?) cannot be activated until the outcome loop produces data. The research roadmap must now treat causal validation of the Contradiction Detector as a near-term research task, not a future one — because the infrastructure is ready, only the data is missing.

**The outcome loop is live but not wired to research.** `sessions_pending_outcomes` view exists. `causalReady` flag exists. Calibration delta computation does not exist. The research task of designing the calibration score formula (Section 14 of this document) must translate immediately into schema additions (`calibration_delta` column) and Mirror UI changes (calibration sparkline). This is a 2-day build, not a research exercise.

**The website and session form are live, which means real user data is now possible.** The GTM sprint (10c) means real HNI/founder decisions will enter the system soon. The research roadmap must prioritize: getting the Ontology Scorer into production before the first batch of real sessions arrives. If real sessions arrive before the scorer is wired, those sessions become wasted data — Council responses were generated without ontology context, and the Ledger data for those sessions cannot be used for calibration or pattern detection.

**The stage gate (1 paying session + 1 returning user) is now the research trigger.** Once the stage gate is passed, research validation moves from hypothesis to empirical. The moment real users complete 3+ decisions and 1+ outcome, the calibration loop can be tested for the first time. That moment is the most important research milestone in Quorum's history. The research plan must be ready for it.

---

*Quorum Research Architecture v0.7 | Built against Research Working Doc v0.6 + Handover Doc v10 | Internal only*
*Next update: after Stage Gate is passed (1 paying session + 1 returning user)*
