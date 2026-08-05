# Quorum — Updated Diligence Report

**Scope of this update:** everything built since the original diligence report — the Dimensional Calibration Engine, the Bias Trigger Engine (Phases 1, 2a, 2b), the Outcome Logging CTA layer, and the Mirror UI work tied to all three. This is not a re-run of the original 11-part audit; it's a targeted update to the findings that have materially changed, plus a new finding the build process itself surfaced. Where the original report's verdict still holds, it's noted briefly rather than re-litigated.

**Headline change since the original report:** the single biggest gap identified then — "the bias-trigger models are a fixed rule authored once by the developer, not discovered per-user" — is now substantially closed. That capability exists, is built to the same architectural discipline as the rest of the system, and is live in the codebase. The corpus-size caveat from the original report is unchanged and remains the dominant constraint on everything below: none of this compounds until outcomes get logged at volume.

---

## What's new since the original audit

| Capability | What it does | Maturity |
|---|---|---|
| **Dimensional Calibration Engine** (`lib/calibration-engine.ts`) | Extends the existing global calibration-delta average to a per-ontology-dimension breakdown — does this user's confidence reliability change specifically when stakes, irreversibility, etc. are elevated. Deterministic bucket-and-compare, same discipline as the rule engine: no LLM call, auditable, evidence-backed (real past sessions linked, not an asserted claim). | Functional |
| **Bias Trigger Engine — Phase 1** (`lib/bias-trigger-engine.ts`) | For each confirmed bias, finds which of the 14 ontology dimensions — when elevated — correlates with worse-than-expected outcomes specifically for that bias, for that user. This is the capability the original report flagged as missing. | Functional |
| **Bias Trigger Engine — Phase 2a** | Extends triggers to two boolean activation-context fields (urgency present, counterparty present). Deliberately Mirror-UI-only, not synthesis-eligible — a genuine race condition was found and respected rather than worked around: these fields are written by a fire-and-forget background call with no guaranteed ordering relative to synthesis for the same decision. | Functional |
| **Bias Trigger Engine — Phase 2b** | Extends triggers to two canonical categorical fields already on `sessions_ontology` (decision type, dominant emotion) — fields the system already computes reliably and early, so unlike Phase 2a these *do* feed the synthesis directive. A bias can now surface up to 4 independent trigger types simultaneously (dimension, flag, decision-type, emotion), each requiring its own evidence and its own statistical gate to qualify. | Functional |
| **Outcome Logging CTAs** | Calibration and Bias Fingerprint modules now show the user's own specific open decisions ("log outcome →") when they don't yet have enough data, rather than a generic "log outcomes somewhere" message. Directly targets the corpus-bootstrapping problem the original report identified as the central constraint. | Functional |

All of this was built under the same KDD discipline established in the original codebase: `lib/rule-engine.ts` and `classifyBiasSignal()` were never modified by any of this work — confirmed by direct inspection, not just asserted. The new capabilities are additive context layered on top of the existing deterministic gates, not a replacement of them.

---

## Updated Part 2 — Memory vs. Judgment Audit

The original report's Category D ("Potential moat") specifically called out *bias trigger models discovered per-user* as the theoretically correct target, currently unbuilt. That target is now built. Restating the original framing with the update:

**C → D transition, partially complete.** Bias-trigger discovery has moved from "a judgment capability authored once by the developer" (Category C, the original state) toward "a capability that specifically requires this person's own accumulated outcome history and cannot be faked or fast-forwarded" (Category D, the moat category). The mechanism is now genuinely personalized — `classifyBiasSignal()`'s universal rule is untouched and still runs for every user identically, but the new trigger layer sits alongside it and answers a different, person-specific question discovered from that person's own data.

**The catch is unchanged from the original report, and worth restating precisely because it's easy to lose track of after a sprint of feature work:** every one of these new mechanisms requires multiple outcome-logged sessions per bias, per trigger type, with the bucket split working in the system's favor. The original report's corpus estimate (~60 sessions, most without outcomes) has not materially changed — the engineering work expanded what the system can compute the moment real data exists, but it did not create that data. The Outcome Logging CTAs are the first piece of work in this engagement that's aimed directly at that gap rather than around it.

---

## Updated Part 7 — Judgment Infrastructure Audit

**Bias Trigger Models — status changed from "Partially implemented" to "Implemented, awaiting data volume."** The original report's example of the target state — *"FOMO activates when X + Y + Z occur, specifically for this person"* — is now a real, running mechanism, not a description of a goal. What remains true from the original finding: this has never yet fired for a real user in production, because no account has cleared the outcome-volume gates yet. The mechanism is sound and tested for logical correctness; it has not been tested against real signal because real signal doesn't exist yet at sufficient depth.

**Confidence Calibration — strengthened.** The original report rated this "Implemented." It now goes further than the original scope: calibration is no longer just a single aggregate number but a dimension-resolved profile, with the same evidence-backed discipline as the trigger engine.

---

## A finding the original report couldn't have made: process and architectural fragility under iteration

This wasn't visible in a point-in-time code review — it only surfaced through several rounds of building, deploying, and debugging. Three incidents from this engagement are worth recording as findings in their own right, because they say something about the codebase's resilience to change, not just its features:

**1. Patch tooling silently misplaced a hunk into the wrong function.** A patch correctly generated and verified (`git apply --check`) against the actual deployed tree was nonetheless found, post-deployment, to have inserted two parameters into `classifyBiasSignal()` — the one function under an explicit KDD never to be touched — instead of `fetchUserBiasContext()`, the intended target, despite both functions living in the same file with distinct signatures. `git apply` itself would have refused this outright; whatever tool was actually used to apply the patch evidently did not. This is a low-probability but non-zero-probability failure mode worth knowing about for any future patch-based workflow on this codebase: a clean `git apply --check` is necessary but was not, in this instance, sufficient proof of correct placement post-application. Verification needs to include confirming changed code landed in the *named function*, not just that the file's diff signature matches.

**2. A client/server boundary violation crashed the entire Mirror page in production.** Adding one display-copy constant as a value-import into a client component (`components/BiasFingerprint.tsx`) created a transitive import chain through three files, ending at `lib/ai-client.ts`'s module-scope Anthropic SDK instantiation — which throws by design when it executes in a browser. The page rendered a blank white screen with no useful error short of a raw console stack trace. This is a structural risk independent of this specific bug: nothing in the build currently prevents a server-only module (anything that imports `lib/ai-client.ts`, directly or transitively) from being value-imported into a `'use client'` file and silently bundled into the browser. The fix applied was correct and narrow (move the constant to the codebase's existing client-safe copy file), but the underlying risk — that this class of mistake is easy to make and has no compile-time guard — remains true for every future file that touches `lib/bias-scorer.ts` or `lib/ai-client.ts` from a client component. A `server-only` import guard on `lib/ai-client.ts` (a one-line addition, a real npm package built for exactly this purpose) would convert this entire class of failure from "blank page in production" to "build fails locally with a clear error," and is a higher-leverage fix than anything else suggested in this update.

**3. Two missing-field bugs in immediate succession, in adjacent code, from the same root pattern.** A function signature was extended with two new optional parameters in three separate places this engagement (a Promise-returning context fetcher, its retry wrapper, and a downstream consumer) — and on the first deploy, exactly one of several near-identical fallback object literals matching that same shape was missed, causing a TypeScript union-type build failure. This is a known-shape pattern risk: any time a return type used across several `Promise.resolve({...})` fallbacks gets a new field, every literal matching that shape needs the same field, and TypeScript's structural typing won't catch an *omitted* field on an object literal the way it would catch other classes of mismatch until the literal is actually used somewhere narrower. Not a defect in this specific code so much as a recurring shape in how this codebase handles fallback states — worth a lightweight convention (a named type alias for the shared shape, rather than several structurally-identical-but-independently-typed literals) if this pattern keeps recurring as more context fields get threaded through the persona pipeline.

None of these three findings change the verdict on whether the underlying feature work is sound — it is, and all three were caught and fixed before reaching a real user. They matter because they're evidence about how the codebase behaves *under iteration*, which a single point-in-time review (the original report's method) cannot surface. A codebase can have excellent architecture and still accumulate exactly this kind of fragility as feature surface area grows faster than the guardrails around it.

---

## Updated Part 10 — Risks, Restated

The original report's six risk categories are unchanged in substance — corpus volume is still the dominant constraint, the institutional-tier vision is still unbuilt, the platform-dependency risk on third-party model APIs is still permanent. One addition:

**New risk — class-of-bug exposure, not a single bug.** The three incidents above point at a shared root cause: as the synthesis/persona pipeline accumulates more threaded-through context (calibration zones, bias triggers, dimensional data, category data — four new data flows in this engagement alone), the number of places a new field needs to be consistently added grows, and the compile-time and runtime guardrails that would catch a missed spot are present in some places (TypeScript's structural typing, for the cases it does catch) and absent in others (no `server-only` boundary enforcement, no end-to-end test exercising the full council→synthesis call chain). This is normal for a fast-moving solo-founder codebase at this stage, and every instance found here was caught before a real user saw it — but it's worth flagging now, while the fix is still cheap, rather than after the pipeline has another two or three sprints of context-threading on top of it.

---

## Updated Part 11 — Final Verdict, Delta Only

**What's changed:** "Bias trigger models — partially implemented, the trigger logic is hardcoded once, not learned per user" is no longer accurate as a criticism. The mechanism for genuine per-user trigger discovery is built, evidenced, and architecturally sound. **What hasn't changed:** every word of the original report's framing about corpus volume, the gap between architecture and proof, and the moat being "a correctly designed intention, not yet a fact about the world" — that sentence is exactly as true today as when it was written. The engineering moved closer to the moat; nothing has yet moved the moat itself into existence, because that step still depends entirely on outcome data the system doesn't have yet.

**One new addition to the original "what should be built next" list:** a `server-only` guard on `lib/ai-client.ts`. It's small, it's cheap, and it directly prevents the one incident in this update that actually reached a deployed, user-facing failure rather than being caught in review.
