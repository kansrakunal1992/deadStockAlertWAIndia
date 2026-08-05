# Quorum — Judgment Operating System Diligence Report v2

**Scope of review:** `quorum_clean.zip` (Next.js app, 151 TS/TSX files, ~500 commits, first commit 2026-04-15), `HANDOVER_DOC_v49.md` (2,400 lines). Source code reviewed directly; where handover doc and code disagree, code wins. This report supersedes the original report (reviewed against v43) and the targeted update (reviewed against the Bias Trigger Engine and Calibration Engine builds). All 11 parts have been re-examined against the current codebase — this is not a delta document.

**Headline finding:** The product reviewed here is materially different from the one reviewed in the original report, in one way that matters architecturally and several ways that matter operationally. The architectural change: a persisted Decision Graph (Sprints G1–G4) now exists — edges computed from structural similarity, contradictions, shared bias triggers, and shared decision type, feeding back into synthesis and visible to the user in Mirror. This is not a UI feature; it is the first mechanism in Quorum that makes past decisions genuinely retrievable as a *graph* rather than a flat list, and it is the one piece of new infrastructure since the original review that meaningfully advances the moat thesis. The operational changes: codebase resilience has improved substantially (server-only guards, named type aliases, vitest scaffold, a hard-learned `next build` gate replacing `tsc --noEmit` as the real build check); the retention architecture is real and wired (five RET sprints, Council continuity on revisits, outcome-nudge cadence, monthly journal); and payments are live-mode ready, pending KYC clearance.

What has not changed: the corpus volume problem is still the dominant constraint. The moat this product is designed to build — a compounding, longitudinal, outcome-verified decision record per real ICP user — does not yet exist at any meaningful scale for any user. The first real-money transaction has not yet been observed. The institutional-tier vision (PE firms, family-office multi-principal) has zero corresponding code. The "compounding proprietary judgment record" remains a correctly designed intention, not a fact about the world. All of this was true in the original report and remains true now.

---

## PART 1 — Capability Inventory

**Mechanisms note (unchanged from original report):** No model training or fine-tuning happens anywhere in this codebase. Every "learning" effect is one of: (a) a single LLM call per event, fresh each time against frontier APIs (Claude + DeepSeek), no weight updates; (b) a deterministic counter accumulating in Postgres (`detection_count++`, `confidence_weight += 0.30`); (c) hardcoded regex/heuristic. The system feels like it learns about a user; the mechanism is "structured data accumulates, then gets re-injected into a stock LLM's context window." That is the correct design at this stage. It also means every "judgment" claim in the product is rate-limited by how much structured data has actually accumulated — a constraint the original report named as the dominant one, and which this review finds unchanged in kind, though the architecture to exploit data when it exists is materially more complete.

| Capability | Status vs. Original Report | Mechanism | Key files |
|---|---|---|---|
| Decision Ontology Tagger v2.0 | **Unchanged** — 14 dims, hardcoded Claude, strict JSON validation | Single Claude call, temp 0.1 | `lib/ontology-tagger.ts` |
| Deterministic Rule Engine (R1–R12) | **Unchanged** — REDIRECT / GATE / FLAG, suppression logic, confidence gates | Pure TS, zero LLM calls | `lib/rule-engine.ts` |
| Structural Retrieval Engine | **Unchanged** — cosine over 14-dim scored vector, 250-session 5-tier mode unreachable | No embeddings; 5-tier mode requires corpus this product still doesn't have | `lib/structural-retrieval.ts` |
| Examiner / Diagnostic Layer | **Unchanged** — rule-driven question selection + LLM personalisation | Rule + Claude | `app/api/examiner/route.ts` |
| Adversarial Bias Library | **Unchanged** — prosecutor/defense pass, 15 biases, asymmetry ≥ 2.5 threshold | Single Claude call | `lib/bias-scorer.ts` |
| Bias Signal Classification | **Strengthened** — original report: "trigger logic is hardcoded once, not discovered per-user." Now: per-user trigger discovery (Bias Trigger Engine Phases 1, 2a, 2b) built and awaiting outcome data. | Deterministic bucket-and-compare on user's own outcomes | `lib/bias-trigger-engine.ts` |
| Dimensional Calibration Engine | **New since original report** — calibration is no longer a single global average; resolved per 14 ontology dimensions per user (e.g. "this user over-weights confidence specifically when stakes_magnitude is high") | Deterministic bucket-and-compare, zero LLM | `lib/calibration-engine.ts` |
| Contradiction Detector | **Unchanged** — two-pass pipeline, ≥3 sessions gate, capped at 30 sessions in / 3 out | Two Claude calls | `lib/contradiction-detector.ts` |
| Confidence Calibration | **Unchanged core** — delta tracking, gated on ≥3 paired points | Pure arithmetic | `lib/bias-scorer.ts` |
| Decision Independence Score | **Unchanged** — 9-signal regex matcher on examiner answers, 0–100; noted as gameable | Pure regex | `lib/independence-score.ts` |
| Session Reliability Index | **Unchanged** — 4 sub-score composite, hand-weighted, "do not rebalance before 50 sessions" | Weighted sum | `lib/session-score.ts` |
| Avoidance Detector (R11) | **Unchanged** — 45-day open flag + structural echo on resolved prior session | Cron + structural-similarity scorer | `lib/avoidance-detector.ts` |
| Council (6 advisor personas) | **Unchanged in architecture** — Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor. DeepSeek for 5/6 generative calls | Per-persona system prompts, Council Weighting Directive | `lib/personas.ts`, `lib/persona-relevance.ts` |
| Council Weighting Directive | **Unchanged** — deterministic relevance map (0–1 per persona) injected as "MANDATORY NON-NEGOTIABLE" final system-prompt layer | `RULE_PERSONA_BOOSTS`, `DIM_PERSONA_BOOSTS` | `lib/persona-relevance.ts` |
| Council Continuity (Revisits) | **New since original report** — when a user revisits a prior decision, the original Council conclusions, examiner evidence, and any logged outcome are retrieved and injected into the new Council (personaBlock for initial personas, synthesisDirective as Layer 5 for synthesis). Parent session ownership validated server-side before honouring `parent_session_id`. | Two-artifact injection pattern (KDD 198) | `lib/decision-continuity.ts`, `app/api/persona/route.ts` |
| Synthesis Layer | **Strengthened** — now has 5 context layers: (1) Council context, (2) structural/rule-engine signal, (3) bias block, (3.5) Decision Graph context (Sprint G4, new), (4) Council Weighting Directive, (5) Continuity directive for revisits. | Hardcoded to Claude; Layer 3.5 is the new graph synthesis block | `app/api/persona/route.ts` |
| Decision Graph | **NEW — fully built, previously "Missing (self-acknowledged)"** — 5 edge types persisted in `graph_edges`: structural_similarity (live from scoring loop), contradiction, shared_bias_trigger, shared_decision_type (backfill), user_asserted (user-authored). G1: schema + materialization engine. G2: query API + corpus gate + user_asserted and dismiss endpoints. G3: d3-force Mirror UI (interactive force-directed graph, node click → record, edge click → dimension tooltip). G4: graph context fed back into synthesis as Layer 3.5 with Pattern Analyst boost directive when connectedCount ≥ 2. | G1–G4 complete | `lib/graph-engine.ts`, `app/api/mirror/graph/`, `app/api/graph/backfill/`, `components/DecisionGraph.tsx` |
| Decision Brief PDF | **Strengthened** — free for all tiers (token gate removed), dark/light theme toggle, `BRIEF_ACCESS_TOKEN` gate retired | jsPDF, server-side | `app/api/record/[id]/brief/route.ts` |
| Outcome Tracking | **Strengthened** — 7/14/30-day automated nudges + 45-day avoidance flag + Monthly Judgment Review + per-decision "log outcome" CTA surfaced in Calibration and Bias Fingerprint modules when data is sparse | Self-report + cron nudges | `app/api/cron/reanalyze-email/route.ts` |
| Decision Timeline | **New since original report** — chain-root record pages show full sitting arc with outcomes and Mirror Calibration Arc tile | Server component | `components/DecisionTimeline.tsx`, `app/record/[id]/page.tsx` |
| Graph Breadcrumb (Record Page) | **New** — "Connected to N decisions in your graph →" badge on individual record pages for Mirror users; links to Mirror Graph section | One Supabase count query at page load | `app/record/[id]/page.tsx` |
| Organizational / multi-user modeling | **Still missing entirely** — zero code, zero schema | — | — |
| Hybrid AI Routing | **Unchanged** — per-call provider pinning, `ROUTING_MODE`, `DEEPSEEK_MODEL=deepseek-v4-pro` | `lib/ai-client.ts` | Mature infrastructure |
| Security / Encryption | **Strengthened** — AES-256-GCM on all raw user input across five tables (sessions, messages, examiner_responses, outcomes, structural_matches, graph_edges.explanation_text added in G1); `server-only` guards on `lib/ai-client.ts` and `lib/encryption.ts` (TB1), RLS hardening, rate limiting, GDPR export/delete, audit log | `lib/encryption.ts` | Production-grade for stage |
| Codebase Resilience | **Materially improved — new since original report** — `server-only` npm guard on two critical lib files preventing client-bundle leakage (incident that motivated it: blank Mirror page in production from a transitive import chain); named `CouncilContext`/`EMPTY_COUNCIL_CONTEXT` and `UserBiasContext`/`EMPTY_USER_BIAS_CONTEXT` constants replacing 7 hand-typed duplicate fallback literals (a class of bug that had already produced one production failure); `lib/council-context.ts` separating the shape from the route file after a real `next build` failure caused by an unexpected Next.js constraint (`tsc --noEmit` does not catch route-file export violations; only `next build` does — now hardcoded as the mandatory build-verification gate); 15-test vitest scaffold covering shape contracts and deterministic rule-engine/persona-relevance logic | `lib/council-context.ts`, `vitest.config.ts`, `tests/` | Not a product capability, but relevant to iteration velocity and failure surface |
| Payments (Razorpay) | **Unchanged in code; advancing operationally** — HMAC-verified webhook, cancel-at-cycle-end, all properly built. KYC "Under Review" as of last handover entry, live-mode keys not yet active, first real-money transaction not yet observed | `app/api/payment/*` | Code complete; commercially unproven |

---

## PART 2 — Memory vs. Judgment Audit

The original report's A–D categorization holds. What has changed is how far each category has advanced.

**Category A (Commodity AI capability — unchanged):** Council personas, synthesis, voice I/O, hybrid routing, PWA/push mechanics, the chat-adjacent session UI. All replicable by any team with API access in days. No change.

**Category B (Memory capability — unchanged in kind, improved in surface area):** Longitudinal context blocks assembled for synthesis, Decision Timeline, Pattern Store, Monthly Judgment Review. Mechanism is still "look up rows for this user_id and inject into a prompt." The Decision Graph (G1–G4) sits at the B/C boundary — it adds *graph traversal* on top of memory retrieval, meaning it can now surface multi-hop connections (decision A → resembles B → contradicts C) that flat-list memory retrieval cannot produce. That is a genuine architectural improvement over Category B, though the data behind it for any given user remains thin.

**Category C (Judgment capability — strengthened):** The original report's list stands: ontology tagger, rule engine, bias signal classification, contradiction detector, calibration-delta tracking, council weighting directive. Two additions since the original: (1) Dimensional Calibration Engine — calibration is now per-ontology-dimension, not just a global aggregate; this means the system can now make the claim "you are specifically over-confident when stakes_magnitude is high and reversibility is low," not just "you tend to be over-confident." (2) Per-user Bias Trigger Discovery — the original report named "trigger logic is hardcoded once by the developer" as the key gap in Category C. That gap has been closed architecturally: `lib/bias-trigger-engine.ts` now discovers which ontology dimensions, boolean flags, and categorical fields correlate with worse-than-expected outcomes *specifically for a given bias, for a given user*. The gap between "closed architecturally" and "producing real signal" is still corpus volume — every one of these mechanisms requires multiple outcome-logged sessions per bias per trigger type to fire. That caveat has not changed.

**Category D (Genuine moat — status: architecture closed, data still the constraint):** The original report said Category D was "a correctly designed intention, not yet a fact about the world." The Decision Graph's G4 synthesis integration advances the architecture further toward D — the system can now tell you, mid-synthesis, that "this decision has structural matches to 4 past decisions on identity_alignment + regret_asymmetry, and you have historically been over-confident in this cluster." That sentence requires *this person's own graph* to produce — it cannot be manufactured on day one by a competitor. But it requires a graph with edges, which requires sessions, which requires outcomes, which requires the same corpus volume problem that has been the dominant constraint since the original report. The moat is now better designed than it was; it is not yet deeper in terms of actual data.

---

## PART 3 — Website Claims Audit

**Note on pricing drift:** the website still references stale pricing (₹9,999/yr · ₹1,499/mo) while the live product runs ₹3,999/mo self-serve Mirror and an unpublished ~₹75,000/quarter Advisory tier. This is a known, self-acknowledged operational lag.

| Claim | Status | Change since original report |
|---|---|---|
| Structural Read | **Fully implemented** | Unchanged |
| Examiner | **Fully implemented** | Unchanged |
| Decision Hold (REDIRECT) | **Fully implemented** | Unchanged |
| Dependency Detection | **Partially implemented** | Unchanged — R1 detects upstream dependency as a dimension; no persisted graph link to a specific other session. Decision Graph now provides cross-session structural links generally, but they are not the typed "this depends on that" model the marketing implies. |
| Mirror (all sub-modules) | **Fully implemented** | Substantially expanded — Dimensional Calibration, Bias Trigger Discovery, Decision Timeline, Decision Graph, Monthly Review, Benchmark, Independence Score all added since original. Mirror is now the most complete part of the product. |
| Contradiction Detector | **Fully implemented** | Unchanged |
| Bias Fingerprint | **Strengthened** — now includes per-user trigger discovery and dimensional calibration zones in addition to activation-context specificity | Now earns "exact moments and conditions" claim more completely |
| Decision Independence Score | **Partially implemented relative to marketing** | Unchanged — still a regex pattern matcher; "proof the product is working" is a stronger claim than a keyword score supports |
| Confidence Calibration | **Strengthened** — now per-dimension, not just global aggregate | Dimensional calibration closes part of the original gap |
| Decision Graph | **Now fully implemented** — was "Missing (self-acknowledged)" in original report | Major change. 5 edge types, live materialization, Mirror UI, synthesis integration, record-page breadcrumb. |
| Decision Timeline | **Newly implemented** — sitting arc with outcomes | New since original report |
| Outcome Tracking | **Partial → Improved** — cadence and CTA infrastructure now complete; no AI-generated "lessons learned" or automatic outcome assessment | 7/14/30-day nudges + Monthly Review + decision-level CTAs added |
| Judgment OS | **Still partially implemented** — individual-tier features substantially present; institutional tier (org layer, multi-principal, external API surface) still zero code | No change in the gap that matters most for this claim |

---

## PART 4 — Frontier AI Competition Audit

The original report's one-paragraph finding stands: yes, every lab, within weeks not years, for all commodity capabilities. This section has one genuine update.

**What has changed:** The Decision Graph's materialization engine makes the structural-retrieval comparison to frontier labs slightly more complex than the original report allowed. The original correctly noted that structural retrieval over a scored 14-dimension vector (not embeddings of raw text) is "a design choice, not a data asset, until corpus scale is reached." The G4 synthesis integration adds one more layer: the graph traversal can now surface multi-hop patterns that even a well-designed embedding-based system cannot replicate without Quorum's specific ontology. "You have made 4 decisions in the last 18 months that all share high identity_alignment + high regret_asymmetry, and in 3 of the 4 the outcome was lower-quality-than-expected" is a claim that requires Quorum's 14-dimension schema — not because the schema is proprietary, but because a competitor would need to have applied the same schema to the same decisions to produce the same claim. That is a mild strengthening of the "architecture requires investment to replicate" argument. It does not change "a competent team, weeks not years" — it just means the weeks include re-tagging the user's decision history with an equivalent ontology.

**What has not changed:** the platform dependency risk. The whole judgment layer still sits on two third-party model APIs with zero proprietary weights. DeepSeek deprecation already forced one emergency model swap; the structural exposure is permanent.

---

## PART 5 — Blue Ocean Analysis

Updates to the original scorecard reflecting what has changed. Unchanged rows noted briefly.

| Capability | Strategic value | Defensibility | Moat | Change note |
|---|---|---|---|---|
| 14-dim ontology tagger | 8 | 3 | 2 | Unchanged |
| Deterministic rule engine | 9 | 5 | 3 | Unchanged |
| Bias library + signal classification | 7 | 4 | 5 | +1 moat: per-user trigger discovery now built, awaiting data |
| Dimensional calibration engine | 8 | 4 | 7 | **New** — more defensible than global calibration because the dimensional signature is person-specific |
| Contradiction detector | 7 | 4 | 6 | Unchanged |
| Calibration delta history | 8 | 3 | 8 | Unchanged — still the highest-moat mechanism, still data-constrained |
| Decision Graph (G1–G4) | 9 | 6 | 6 | **New** — the graph itself is architecturally reproducible; the graph *populated with this person's decisions and outcomes* is not. Moat score reflects where the data will be when it exists, not today's empty-graph state |
| Synthesis with graph context (G4) | 7 | 5 | 5 | **New** — the synthesis block that names "you have 4 structural matches in your history" requires the graph; requires the decisions; requires the outcomes. Currently fires for almost no user sessions because the graph is thin |
| Structural retrieval | 6 | 5 | 4 | Unchanged |
| Council / synthesis / personas | 6 | 1 | 0 | Unchanged — commodity |
| Decision Timeline + Continuity | 6 | 3 | 5 | **New** — sitting chains require real elapsed decisions; the continuity injection into Council is the only place in the product where the *history of one decision's arc* directly modifies analysis of its revisit |
| Council continuity on revisits | 7 | 4 | 6 | **New** — only possible if the user has actually revisited a prior decision; cannot be bootstrapped |
| Avoidance detection + structural echo | 5 | 4 | 5 | Unchanged |
| Founder-led Advisory tier | 6 | 8 | 2 | Unchanged — relationship moat, not data moat |
| Accumulated multi-year corpus | 10 | 9 | 10 | Unchanged — the actual prize, still thin |

---

## PART 6 — System of Record Audit

**Original verdict:** Not a system of record. Missing: volume, organizational layer, external surface, validated thresholds.

**Current verdict:** Still not a system of record. The same four gaps apply:

(1) **Volume** — unchanged in kind; the corpus remains roughly the scale of one moderately active week of a single ChatGPT power-user. The stage-gate the founder set ("at minimum one paying engagement and one returning ICP user from the true target audience") has not yet been met; the first real-money transaction has not yet been observed.

(2) **Organizational layer** — zero code, zero schema for teams, boards, or multi-principal visibility. The institutional-tier vision on the website has no corresponding implementation of any kind. This is the single largest gap between claim and code in the entire product.

(3) **External surface** — the record still only round-trips inside Quorum's own UI and a stateless PDF/GDPR export. Nothing external integrates with it.

(4) **Validated thresholds** — the admin tooling (R7/R8) exists, is well-built, and the company's own tech-debt note says not to trust the result before 100–250 sessions. The corpus is still well below that.

**One genuine advance:** the Decision Timeline on chain-root record pages means the full arc of a revisited decision (original analysis → interim reflections → outcome → revisit analysis) is now a persistent, structured document rather than just a sequence of individual session records. That is meaningfully closer to a "judgment record" than a flat session list, even if it is still far from an institutional system of record.

---

## PART 7 — Judgment Infrastructure Audit

Changes from the original report's table:

| Concept | Status | Change from original |
|---|---|---|
| Decision Objects | **Unchanged** — rich derived metadata, thin explicit schema for alternatives/stakeholders/final-choice | No change |
| Decision Graph | **Now fully implemented** — was "Missing, self-acknowledged" | Major change. See Part 1 capability table. The original correctly noted "no persisted directed graph." There is now one: 5 edge types, materialized from 3 existing engines, live-written for structural similarity, backfill-written for the others, UI in Mirror, synthesis integration in G4. |
| Decision Lineage | **Improved** — two mechanisms now exist: (a) `parent_session_id` chain (explicit human-declared revisit lineage); (b) graph edges (system-discovered structural/contradiction/bias lineage). Original report: "minimal, narrow, post-hoc." Now: broader, though still constrained by corpus depth. | Material improvement |
| Bias Trigger Models | **Substantially advanced** — original report: "fixed rule authored once by developer." Now: per-user discovery (which dimensions, flags, and categorical fields correlate with worse outcomes for a given bias, for a given user) is built and architecturally sound. Still awaiting outcome data at volume to fire meaningfully. | The original report's key Category C gap is closed at the architecture level |
| Dimensional Calibration | **New** — calibration is now per-ontology-dimension, not just a global average. "You over-weight confidence when stakes_magnitude is high and reversibility is low" is now a claim the system can make and evidence. | Significant addition |
| Outcome Engine | **Improved but still partial** — 7/14/30-day nudges, Monthly Judgment Review, per-decision CTAs in Mirror modules, decision-level outcome logging. Still: no 90/180/365-day automated revisit cadence, no AI-generated "what was learned" synthesis. | Better infrastructure, same ceiling |
| Council Continuity | **New** — revisited decisions get Council that explicitly acknowledges the prior sitting, examiner evidence, logged outcome, and commitment trigger. Synthesisdirective (Layer 5) is positioned last in the synthesis system prompt for maximum LLM adherence (KDD 198). | Genuinely new mechanism — the only place in the product where prior Council analysis directly modifies a new Council |
| Confidence Calibration | **Strengthened** — dimensional | As above |
| Principle Extraction | **Unchanged** — two mechanisms: raw C0 answers + LLM Pass-1 in contradiction detector | No change |
| Organizational Judgment Models | **Still missing entirely** | No change — zero code |

---

## PART 8 — Defensibility Against AGI (2030 Scenario)

**Original verdict stands with one update.**

**Unchanged:** instantly commoditized (Council, synthesis, voice, memory/recall, tagger as a standalone prompt); commoditized within ~3 years (rule engine thresholds, bias-classification logic once a focused team decides the niche is worth it); survives (multi-year per-user corpus if Quorum retains users long enough to build it; founder-led Advisory relationship layer); strengthens with time (verified calibration history, contradiction records).

**One genuine update:** The Decision Graph's synthesis integration (G4) adds a new mechanism to the "strengthens with time" category. The claim "this decision connects to a cluster of 4 past decisions where you were over-confident on the same dimension, and the outcomes were consistently lower-quality-than-expected" requires: (a) the graph, (b) the decisions, (c) the outcomes, (d) the calibration history, all for the same person. A frontier lab's memory feature — even a genuinely good one — cannot retroactively manufacture this for a user who switches platforms today, regardless of model capability. It specifically requires elapsed time and real decisions, which is the only moat property that is structurally immune to "can be built faster with better engineers and more funding." This does not change "instantly commoditized" for the Council layer, which is the most visible and most replicable part. It does mean that a user who has been in Quorum for two years with regular outcome logging carries more graph-compounding value than the original report's analysis captured.

---

## PART 9 — What Big AI Companies Are Unlikely to Want

**Original report stands.** The structural arguments — low engagement cadence, "refuses to help" refusal mechanic cuts against helpfulness-optimized consumer AI instincts, founder-administered Advisory is non-automatable, GTM motion is relationship-not-model — are all unchanged and still valid.

**One addition:** The Decision Graph's architecture (CBR case base + GraphRAG-style multi-hop, per-user, fed back into synthesis) is a pattern that is technically straightforward for a frontier lab to implement but requires committing to a *specific decision ontology* as the schema for graph nodes — a commitment that a general-purpose assistant cannot make without limiting its use cases. Quorum's 14-dimension schema is not proprietary; the *investment by the user* in logging decisions against that schema, over time, building up a personally-meaningful graph, is what creates switching cost. A frontier lab shipping a "Decision Mode" could implement the same schema in an afternoon and have zero node-populated graph to show a new user. That gap is narrow on day one; it widens with every outcome the user logs. This is a real strategic asset, and it is the correct thing to build toward — which is why the corpus-volume problem is the one thing this report has said in every section, and will say again in Part 11.

---

## PART 10 — Risks, Updated

**Risk 1 — Corpus volume (unchanged, still dominant):** The entire compounding architecture — dimensional calibration, per-user bias triggers, graph synthesis context, contradiction records — is gated behind thresholds that assume usage cadence the ICP doesn't have at current scale. A founder making 3–5 high-stakes decisions per quarter could take 18 months to single-handedly unlock the features that are supposed to be the product's reason for existing.

**Risk 2 — Corpus volume from the demand side (unchanged):** Every real-money transaction that does not happen is also a corpus-accumulation event that doesn't happen. Razorpay is code-complete and not yet live. Zero ICP users have ever paid for this product. The stage-gate ("first paying engagement + one returning ICP user") has not been met.

**Risk 3 — Institutional-tier narrative with zero institutional-tier code (unchanged, largest marketing-code gap):** "A PE firm with twelve portfolio founders... a family office licensing the Judgment OS for multiple principals... boards mandating structured decision infrastructure" — not one line of code supports any of this. It is the single largest gap between claim and implementation in the repository, and it is the same size it was at the original review.

**Risk 4 — AI platform dependency (permanent, slightly elevated):** The judgment layer still sits on two third-party APIs with zero proprietary weights. DeepSeek deprecation already forced one emergency model swap. Structural exposure is permanent. This risk has not materially changed; it is worth re-flagging because G4's synthesis integration adds a new LLM call (fetchGraphSynthesisContext) to the synthesis critical path — non-fatal (non-fatal empty-string fallback is wired), but the synthesis layer is now one more API call thicker than it was in the original review.

**Risk 5 — Codebase iteration fragility (reduced, not eliminated, by Track B):** The original diligence update named three incidents that only became visible through building: a patch tool misplacing a hunk into the wrong function, a client/server boundary violation crashing the Mirror page in production, two missing-field bugs in adjacent code from the same fallback-literal pattern. Track B (server-only guards, named type aliases, vitest scaffold) addressed two of these classes. The third — the `next build` route-file export restriction that `tsc --noEmit` does not catch — was discovered in this engagement through a real deploy failure (the council-context export from `persona/route.ts`). All three classes are now either guarded or documented. The residual risk is the same as any fast-moving solo-founder codebase: the guardrails are better, but every sprint that adds new context fields to the persona pipeline adds new places where a missed fallback literal can be introduced. The vitest scaffold (15 tests) now covers shape contracts explicitly.

**Risk 6 — Decision Graph: backfill-only for 3 of 4 edge types (operational, not architectural):** `structural_similarity` edges write live on every new scored session. `contradiction`, `shared_bias_trigger`, and `shared_decision_type` edges are written only via `POST /api/graph/backfill` (admin endpoint). Until a nightly cron is wired, the graph's contradiction and bias edges are stale by whatever time has elapsed since the last manual backfill. This does not break anything — G4 synthesis uses structural_similarity and shared_decision_type edges primarily, and the former is live. But it means the Mirror Graph's full richness degrades silently over time unless the backfill is run.

**Risk 7 — G4 synthesis race condition (design acknowledged, mitigation in place):** The structural-match route is called fire-and-forget from the client; graph edges for the current session may not exist when synthesis fires. `fetchGraphSynthesisContext` handles this with a single 800ms retry. Empirically, 800ms is usually sufficient — structural-match is fast. But under adverse conditions (cold Railway container, slow DB write), synthesis can fire before any edges exist, and `graphContext.synthesisBlock` returns empty string (non-fatal, pure no-op). This is the correct behavior; it is also a case where the graph never enriches synthesis even though it could have. The mitigations are: the retry, the non-fatal fallback, and the fact that over time a user's graph accumulates historical edges (not just current-session edges) which are always available regardless of the race condition.

---

## PART 11 — Final Verdict

The twelve original questions, updated:

**1. Is Quorum currently a chatbot?** No — unchanged. A deterministic, non-LLM gate sits in front of any advisor output and can refuse to produce one. The refusal mechanic now extends slightly further: the graph context can also surface a synthesis directive ("this decision connects to a cluster of 4 past decisions where you were over-confident") that a chatbot by definition cannot produce.

**2. Is Quorum currently an advisor system?** Yes — unchanged. Still also the single most commodity-replicable layer of the whole product.

**3. Is Quorum currently a memory system?** Partially — improved. Graph traversal adds multi-hop memory that flat-list recall cannot produce. Still thin by volume.

**4. Is Quorum currently a judgment system?** Yes, more completely than at original review. Dimensional calibration, per-user bias trigger discovery, and graph-context synthesis now constitute a judgment layer that operates on accumulated personal data in ways that are genuinely specific to that user's history and cannot be produced on day one. The architecture is now the correct architecture for what the product claims to be. The data behind it is still sparse.

**5. Is Quorum currently a system of record?** No — unchanged verdict. Volume, organizational layer, external surface, and validated thresholds are all still missing. The Decision Timeline is a genuine improvement in the direction of a personal judgment record; it does not close the gap with the institutional meaning of "system of record."

**6. What percentage of the product vision is implemented?** Individual-tier feature list: roughly 75–80% (up from 55–60% at original review — Mirror is now substantially complete, Decision Graph and continuity are new). Institutional-tier vision: still close to 0%. Council → Ledger → Mirror → Graph → Legacy: Council ✅, merged Ledger/Mirror ✅, Graph ✅, Legacy undefined.

**7. Strongest moat currently present?** Unchanged: the combination of a rule engine that can refuse to advise + a founder-administered non-automatable Advisory relationship. New addition: the Decision Graph's synthesis integration is the first mechanism in the product that makes the "compounding judgment record" claim specific and traceable at synthesis time — not just a longitudinal context injection, but a graph-topology-informed claim about this person's decision history that requires years of their own decisions to produce. This is now real, not aspirational. Its current weakness is that almost no user's graph has enough edges for it to fire meaningfully.

**8. Moat that's currently only narrative?** Unchanged: "the compounding proprietary judgment record." The architecture to exploit it is now more complete than it was. The data is not.

**9. What should be abandoned or paused?** The institutional/PE-firm narrative on public-facing copy until literal code exists for it. Tuning the 250-session 5-tier scoring system (unreachable at current corpus). Any feature sprint before the stage-gate is met.

**10. What should be doubled down on?** The refusal mechanic and its positioning. The Decision Graph's synthesis integration — specifically, finding the first 2–3 users whose graph is thick enough for G4 to produce real synthesis directives, capturing what those directives look like, and using them as product proof-points. And, more urgently than any feature: closing the corpus gap by getting real ICP users to log real decisions with real outcomes. Every other compounding claim in the product is a function of this single input.

**11. What should be built next?** On the code side: a nightly graph backfill cron (`app/api/cron/graph-refresh/`) following the existing `reanalyze-email` pattern — the one operational gap in the G1–G4 graph build. On the product side: nothing new until the stage-gate is met. Razorpay going live is not a feature sprint; it is the prerequisite to knowing whether the product can sell at all to the people it is designed for.

**12. What gives Quorum the highest probability of surviving future AGI-scale competition?** Unchanged from original report, with one structural addition. Original: (a) accumulate a multi-year, outcome-verified corpus per real ICP user before a frontier lab's memory feature gets there first; (b) the trust-and-distribution relationship with a narrow, skeptical, referral-driven buyer. Addition: (c) the Decision Graph, properly populated, makes switching cost non-zero in a way that the original flat-session architecture did not. A user whose graph contains 3 years of outcome-verified decisions, calibration history, contradiction records, and structural clusters that the system cites in synthesis has a graph that does not transfer to a competitor — not because of lock-in mechanics, but because the graph is specifically the product of Quorum's 14-dimension ontology applied to that user's decisions over time. That is the first genuinely architecture-based switching cost in the product, and it is the correct thing to have built at this stage. The question is whether the user will have been generating decisions against it for 3 years by the time the frontier labs get to this use case. That is a race, and it is won entirely by getting real paying ICP users logging real decisions now — not by building more features.

---

*Diligence Report v2 — June 24, 2026. Reviewed against `quorum_clean.zip` and `HANDOVER_DOC_v49.md`. Every claim checked against source code directly.*
