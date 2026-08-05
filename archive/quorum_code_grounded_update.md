# Quorum — Code-Grounded Update

This revises the original teardown against the actual codebase (`quorum_clean.zip`: Next.js 15 + Supabase + Anthropic API, ~11,000 lines across the core engine files alone, 400+ commits). One finding changes the whole calculus, so it's worth stating before the section-by-section update:

**The product is far more advanced than the original prompt described — and it has already quietly diverged from the strategy it describes.**

Two things are true at once:

1. The "context graph" / long-term-judgment layer I recommended *building* in the original Phase 4/5 largely **already exists**: a 14-dimension decision ontology tagger, cosine-similarity structural retrieval across dimensions, a persisted graph (`graph_edges`) connecting decisions by structural similarity / contradiction / shared bias / shared type, a deterministic rule engine, a bias-trigger engine that finds *personal, conditional* bias patterns from outcome correlations, a calibration engine, an independence score, and an avoidance detector. This is genuinely well-built — careful defaults, noise floors on small samples, documented design tradeoffs (KDD notes) throughout.
2. Despite that, the product currently in the code is priced and positioned as a **mass-market personal-decision consumer app** (₹3,999/mo ≈ $48/mo self-serve, WhatsApp-thread context pasting, a rule literally named "Couple Misalignment," India-first payment rails via Razorpay) — not the $500–2,000/month executive judgment OS the strategy prompt describes. The team's own code comments confirm they already discovered the frequency problem in production: the daily re-engagement nudge was walked back specifically because, in their words, "decisions aren't a daily habit."

So the honest framing has shifted from *"delete 80% and rebuild the intelligence layer"* to: **the hard, differentiated backend already exists — the two real gaps are (a) how it's fed, and (b) which market and price point it's actually built for.** Everything below is grounded in specific files.

---

## Phase 1 — Product Autopsy (update)

The original autopsy inferred the frequency problem from first principles. The code confirms it empirically. `app/api/cron/daily-nudge/route.ts` was rewritten from a literal-daily cadence to a decaying, capped 4-touch sequence (day 2/5/10/18) — the comment block says the daily version "reads as nagging for a product where decisions aren't a daily habit." That's the team independently arriving at the same conclusion, from real usage data, that the original Phase 1 reached from theory.

New finding: the actual user base looks broader than "founders and CEOs." `lib/rule-engine.ts` has a rule called **R12 — Couple Misalignment**. The landing page onboarding copy references pasting "WhatsApp threads" as context. This isn't an enterprise tool people are testing — it's a personal/professional life-decisions app. That's not necessarily bad news: a broader "high-stakes life and career decisions" market has structurally *higher* natural frequency than "founder strategic decisions" alone (career moves, relationship decisions, major purchases, family/money decisions come up more often across a bigger population than board-level calls do for a narrow founder segment). But it is a different product than the one the strategy prompt describes, and the two markets want different pricing, different marketing, and arguably different UI.

---

## Phase 2 — Devil's Advocate (update)

The objections mostly hold, but one of them is already partially answered by the team itself: the Fortune 500 exec's "this will never get past procurement, my data is sensitive" objection is somewhat moot because the current product isn't selling to Fortune 500 procurement — it's a ₹3,999/mo self-serve consumer subscription with `lib/encryption.ts` encrypting decision text at rest. That's a reasonable trust posture for a consumer app; it's not enterprise-grade compliance, and it doesn't need to be for the market the code is actually built for.

The VC objection ("I already have Claude/ChatGPT") gets sharper, not softer, once you see the code: the six persona system prompts in `lib/personas.ts` (1,175 lines) are genuinely well-crafted — structured response architectures, explicit "what you are not" guardrails, calibrated register. That craft is a real asset. But it's still fundamentally a prompting technique, replicable by any team with the same discipline, and the moat question from Phase 7 stands: the defensibility isn't in the personas, it's in the accumulated structural/bias/contradiction graph behind them — which is exactly the part gated behind a $48/month paywall few of the target enterprise buyer persona would encounter.

---

## Phase 3 — Market Analysis (update)

Holds directionally. One correction: the team already intuited part of the "ambient, high-frequency" thesis from Phase 3/5 and partially built it — `app/api/cron/reanalyze-email/route.ts` sends unprompted check-ins at 7/14/30 days ("You were 7/10 confident. How's it sitting?"), and `lib/avoidance-detector.ts` runs daily to flag decisions the user is structurally avoiding (high dependency + 45+ days open + no outcome logged). These are real proactive-surfacing mechanisms, not just the session-based "come consult the council" flow the original teardown assumed. They're relatively narrow (time-based milestones, not live ambient context ingestion from calendar/email/Slack), but they're evidence the team already knows proactivity is the lever — they just haven't extended it past email/push nudges into genuine ambient ingestion.

---

## Phase 4 — First Principles (major update)

This is where the original teardown was most wrong about the *current* state, even though the underlying reasoning was right. I argued "Decision" is a weak atomic unit and recommended promoting a continuously-updating context graph (assumptions, commitments, relationships, open questions) above it. The code shows the team already built most of the graph:

- `sessions_ontology` — a 14-dimension structured vector per decision (decision type, stakes reversibility/bearer/timeline, deadline credibility, counterparty alignment, emotional signature, stakeholder complexity, instrumental vs. constitutive weighting).
- `lib/structural-retrieval.ts` — cosine similarity across that 14-dim vector, with 1.5× research-priority weighting on identity-alignment, regret-asymmetry, and upstream-dependency dimensions specifically because those are believed to be the highest-leverage cross-domain signal (a PE deal and a career pivot sharing the same structural shape).
- `lib/graph-engine.ts` + `graph_edges` table — a persisted, queryable graph connecting sessions by `structural_similarity`, `contradiction`, `shared_bias_trigger`, and `shared_decision_type`, with a `user_asserted` edge type reserved for future user-authored connections.
- `lib/bias-trigger-engine.ts` — finds *personal, conditional* bias patterns ("FOMO fires for you specifically under time pressure, not in general") from outcome correlations, not a static bias list.
- `lib/contradiction-detector.ts` — two-pass extraction that finds when a principle stated in one decision is violated by a later one.
- `lib/calibration-engine.ts` — per-dimension confidence reliability tracking (does this user's confidence hold up specifically on high-stakes vs. low-stakes calls).

**The atomic-unit critique still applies, but narrower than before.** The graph exists and is well-designed — it doesn't need to be built. What's still true is that every node in that graph is created by a **manually authored, ceremony-heavy session** ("Convene the Council"). There's no atomic-unit problem in the data model anymore; there's an *input* problem. The graph has no way to grow except through the highest-friction, lowest-frequency action in the product.

One concrete, easy-to-miss gap: `sessions.commitment_review_date` is captured at the end of a session (Sprint Chunk 1 — "what would change your course," "first move," a self-set review date) but nothing in the cron routes actually fires on it. `reanalyze-email` uses fixed 7/14/30-day milestones instead of the date the user themselves said mattered. That's a first-class object sitting half-built in the schema, not surfaced.

---

## Phase 5 — Reimagination (major update)

The original Phase 5 said "build an ambient chief-of-staff." Revised: **don't build a new system — build one new input surface for the system that already exists, and give the objects already in the schema (commitments, review dates) their own life instead of leaving them as session sub-fields.**

Concretely, what's already there and should not be touched:
- The 14-dim ontology tagger, structural retrieval, graph engine, bias/contradiction/calibration engines. This is the hard 20% that creates most of the durable value, and it's already built to a standard most teams don't reach (documented KDDs, noise floors, non-fatal error handling throughout).
- The persona prompt library — genuinely strong craft, keep it.

What's missing, and is the actual gap between the current product and the Phase 5 vision:
- **A low-friction capture path that isn't "convene the council."** Something closer to: forward an email, paste a WhatsApp thread, or leave a 15-second voice note that gets classified into the ontology as an *assumption* or *open question* rather than requiring a full six-persona session. This feeds the existing graph without the ceremony tax.
- **Wire `commitment_review_date` to actually fire a nudge on the date the user chose**, not a fixed milestone schedule. This is a small change (the field and the send infrastructure both already exist) with outsized leverage — it's the single cheapest way to make the product proactive on the user's own terms instead of an arbitrary clock.
- **Surface the graph earlier, not just inside a paywalled Mirror tab.** `DecisionGraph.tsx` and `/api/mirror/graph` are fully built and wired into `app/mirror/page.tsx` (confirmed live, not just backend) — but it only becomes visible after a session-count threshold and a subscription. The single most differentiated thing in the product (the graph) is currently the hardest thing for a prospective high-value buyer to ever see.

---

## Phase 6 — The $500/Month Test (update)

The current self-serve price is **₹3,999/month (~$48/month)**, not $500–2,000. There is a higher "advisory" tier (`lib/mirror-tier-config.ts`, `access_type === 'advisory'`) with a capped cohort, founder-led onboarding, and a quarterly judgment memo + call — structurally the closest thing to the $500–2,000/month vision — but it's **manually granted, not sold through the product** (`/api/admin/grant-mirror-access`, no price in code, no self-serve checkout path). So today, nobody can actually pay $500–2,000/month for Quorum even if they wanted to; the infrastructure for that tier is a bypass flag and some copy strings, not a monetized product.

This matters for the "minimum change" question below: reaching the $500–2,000/month test isn't primarily an engineering problem. The advisory tier's *feature gap* (benchmark data, full contradiction detail, prescriptive next-move) is already built. What's missing is a priced, self-serve (or sales-assisted) path to it, and — more importantly — proof that the mass-market ₹3,999/mo user base and the $500–2,000/mo enterprise buyer are even the same customer. Right now the code suggests they aren't.

---

## Phase 7 — Moat (update)

Unchanged in substance, sharpened by evidence: the durable asset is confirmed to be the graph and the personal bias/calibration history, not the reasoning layer — and that asset is real and already built, not hypothetical. What's newly clear is that the moat is currently **underexploited**: it's gated behind a low price and a session-count threshold (Rules unlock at 8 sessions, Contradiction Detector at 40 — `lib/mirror-tier-config.ts`), which means the users most likely to generate a rich graph (frequent, high-stakes decision-makers) are the ones most likely to be founders/executives — exactly the segment currently paying $48/month for something that, if the strategy prompt's aspiration is right, they'd pay 10–40x more for once it's positioned and packaged correctly.

---

## Phase 8 — Product Strategy (revised roadmap)

The original V1–V5 assumed the intelligence layer needed to be built. Revised given what exists:

- **V1 (small, days not months):** Wire `commitment_review_date` to actually trigger a nudge. Expose the Decision Graph earlier in the funnel (a teaser, not just post-threshold) as the core "why Quorum" demo. Split messaging/pricing: decide explicitly whether the ₹3,999 consumer tier and a real, self-serve advisory tier are the same product or two products with shared infrastructure.
- **V2:** Build the low-friction capture surface (forwarded email / pasted thread / voice note → classified as assumption/open-question, not forced through a full session). This is the one genuinely new engineering investment and it's additive to the existing ontology tagger, not a replacement for it.
- **V3:** Price and productize the advisory tier as a real self-serve or sales-assisted SKU, using the benchmark/contradiction-detail/prescriptive-next-move features that already exist behind the bypass flag.
- **V4:** If the executive/founder segment is the one being pursued for the premium tier, consider whether "Couple Misalignment"-style personal-life framing and the consumer-app WhatsApp-paste UX belong in the same product surface, or whether they need separate front doors on shared backend infrastructure.
- **V5:** Team/board layer — genuinely net-new, not present in the current schema (no multi-user session sharing, no shared graph across a team) — this is the one piece of the original V5 recommendation that still requires real new architecture.

---

## Phase 9 — Technical Review (now possible, high-level)

- **Data model:** solid. The migrations (`sprint1_add_ledger_tables.sql`, `sprint2_add_register_to_sessions.sql`) show a team adding structure incrementally without breaking what came before — ontology, examiner responses, bias library, and contradiction log are cleanly separated tables, not overloaded onto `sessions`. `graph_edges` with canonicalized pair ordering and a proper unique constraint is correct, careful design.
- **What should be rewritten:** very little at the engine level. The `commitment_*` fields living as `sessions` columns rather than their own table is the one modeling choice worth revisiting if commitments are going to become a first-class, independently-surfaced object (per Phase 5) rather than a session footnote.
- **What's architecturally missing, not wrong:** an ingestion layer. There is no code path for anything entering the system except a manually typed or pasted decision. Adding one doesn't require touching the ontology tagger, structural retrieval, or graph engine — they already accept `decisionText`/`contextText` and would work unchanged with a different origin for that text.
- **Agent/orchestration evolution:** `app/api/persona/route.ts` (686 lines) and `app/api/examiner/route.ts` (770 lines) currently orchestrate a synchronous, session-triggered flow. Event-triggered agents (react to a graph condition — staleness, contradiction, an overdue commitment — rather than only firing inside a user-initiated session) would layer on top of the existing rule engine (`lib/rule-engine.ts` already has a clean `REDIRECT > GATE > OPEN` mode hierarchy that a background trigger could reuse) rather than requiring a new agent framework.

---

## Phase 10 — Brutal Truth (revised)

**Revised verdict: (B) still holds, but the redesign required is smaller and different in kind than originally framed.** It is not "the current product is solving the wrong problem" — the ontology/graph/bias/calibration engine is a legitimate, well-executed answer to "how do you make judgment support compound over time," and it already exists. The redesign needed is: **(1) give the existing intelligence layer a lower-friction way to be fed, (2) decide deliberately whether Quorum is a mass-market personal-decisions app at ~$50/month or an executive tool at $500–2,000/month, because the current code has one foot in each and is fully monetizing neither, and (3) surface the graph — the actual differentiated asset — earlier and more prominently than a paywalled tab.**

---

## Minimum Path to the Recommended Direction

Framed as: what fraction of the current product needs to change, section by section, to get from here to the Phase 5/8 direction.

**Keep almost entirely as-is (~60–65% of the current engine code, no material change):**
- `lib/personas.ts`, ontology tagger, `lib/structural-retrieval.ts`, `lib/graph-engine.ts`, `lib/bias-scorer.ts`, `lib/bias-trigger-engine.ts`, `lib/contradiction-detector.ts`, `lib/calibration-engine.ts`, `lib/rule-engine.ts`, `lib/independence-score.ts`, encryption/auth/rate-limit infrastructure. This is the product's real asset — don't touch it to chase the reposition.

**Rewire, don't rebuild (~15–20% — high leverage, low new code):**
- Fire nudges off `commitment_review_date` instead of fixed milestones.
- Promote the Decision Graph out of the post-threshold Mirror paywall into an earlier, visible part of the funnel.
- Split (or explicitly unify, as a conscious choice) the consumer tier and the advisory tier's pricing and positioning — this is mostly a packaging/pricing decision, not an engineering one, since the advisory feature set already exists behind `ADVISORY_BYPASSES_THRESHOLDS`.

**Net new (~15–20% — the one real build):**
- A low-friction capture surface (forwarded content / voice note / quick log) that writes into the existing ontology pipeline without going through a full six-persona session. This is what actually closes the frequency gap; everything downstream of it already exists.
- If the team commits to the executive/team market: shared/team-level graph access (genuinely absent today — V5 from Phase 8).

**Actively reconsider (~5%, but decision-weighted, not code-weighted):**
- Whether "Couple Misalignment" / WhatsApp-paste / consumer-app framing and a $500–2,000/month executive OS are one product or two — this single decision determines which of the above changes matter and in what order, more than any line of code.

If a rough number is needed for planning: **this reads as closer to a 30–35% change, not 50%.** The backend intelligence layer — the part that would have been the expensive, risky rebuild — is already done and done well. The remaining work is concentrated in the input surface, the notification wiring, the paywall placement, and one unavoidable strategic decision about who the product is actually for.
