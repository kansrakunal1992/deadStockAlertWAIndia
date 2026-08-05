# QUORUM — TECH, INFRA & POSITIONING EXPLORATION PLAYBOOK

VERSION: V3
STATUS: Active, standalone track
RELATIONSHIP TO MAIN PLAYBOOK: This is a separate track from GTM Playbook V15. V15 remains the sole source of truth for the customer pipeline and the founding GTM partner search. This playbook governs model/infra strategy, positioning exploration, and legal/structural items that came out of the July 25, 2026 alumni call. Nothing in this playbook changes current ICP, positioning, or GTM motion unless and until an item is explicitly promoted into V15.

---

## CHANGELOG

V1 — July 25, 2026 — Initial creation. Source: call with an alumnus running an AI agents/tools startup serving clients across industries. Established track scope, locked decisions, key learnings, model/infra comparison, open questions, and immediate actions.

V2 — July 26, 2026 — Resolved the model/infra open question into a tiered architecture (Part 4, new). Locked TD-LD-5 (was open) and added TD-LD-7. Added TD-KL-5. Updated model comparison table with Qwen 3.6 vs 3.7 distinction and current-default Deepseek V4 Flash entry. Updated Open Questions and Pending Items accordingly.

V3 — July 26, 2026 — Ken approved the customer-facing packaging translation of the Part 4 tiers (new Part 5): Free Early Access, Quorum Core (₹1,999/mo), Quorum Elite (₹3,999/mo), Quorum Private (custom, ₹9,999+/user/mo). Added TD-LD-8, TD-LD-9, TD-KL-6. Resolved former Open Question 6 (buyer self-selection). Added new Open Question on per-plan unit economics and free-tier cost exposure. Renumbered Parts 5-7 to 6-8.

---

## SOURCE CONTEXT

Call with: alumnus, founder of an AI agents/tools startup, clients across industries
Date: July 25, 2026
Raw call notes captured by Ken, clarified into this playbook via follow-up Q&A.

---

## PART 1 — LOCKED DECISIONS (TD-LD)

Numbered independently from the main playbook's LD series to keep the tracks cleanly separable. No TD-LD is re-litigated without new information, same convention as V15.

TD-LD-1: This track is scoped separately from GTM Playbook V15. Current customer pipeline and GTM partner search are unaffected by anything below.

TD-LD-2: Corporate-only positioning — dropping personal decision-support framing and dropping Family Office as an ICP — is PARKED as an option, not adopted. Current ICP (senior professionals, tier-1 MBA background, ages 30-50, career crossroads) stays as-is.

TD-LD-3: Pursuing a domain expert (hire or partner company) is tied to TD-LD-2 and parked with it. Not actioned until TD-LD-2 is revisited.

TD-LD-4: LLP entity conversion and Startup India grant exploration is PARKED, not urgent. Pending confirmation of Quorum's current entity type before any further work.

TD-LD-5: The tiered model architecture in Part 4 is LOCKED: Tier 1 (self-hosted, buyer choice of T1a-Qwen or T1b-Mistral), Tier 2 (cloud Qwen, cheapest, China-connection accepted), Tier 3 (Mistral Small replacing deepseek v4 fast + Claude unchanged, China-connection not accepted). This replaces the prior "no default locked" status.

TD-LD-6: Three immediate actions are approved and active now, independent of how the model debate resolves: (a) market/gap research, (b) website copy rebuild, (c) third-party data privacy audit quote. See Part 6.

TD-LD-7: Within Tier 1, the China-origin trade-off is offered as an explicit buyer choice (T1a vs. T1b), not resolved silently by a default. T1b (Mistral, self-hosted) must be marketed with an explicit disclosure that performance is lower than T1a (Qwen, self-hosted) — this is the trade a zero-risk-tolerance buyer is making, and it should not be buried.

TD-LD-8: Customer-facing packaging is LOCKED (see Part 5 for full detail): Free Early Access (time-limited, ~first 100 users, full Elite stack, for testimonials/feedback/referrals), Quorum Core at ₹1,999/month (Tier 2 stack, positioned "Best Value"), Quorum Elite at ₹3,999/month, recommended (Tier 3 stack, positioned "Best Intelligence"), Quorum Private at custom pricing from ₹9,999+/user/month with minimum seats (Tier 1 stack, buyer choice of Option A-Qwen or Option B-Mistral, positioned "Best Privacy"). This resolves the former Open Question 6 (how buyers self-select a tier).

TD-LD-9: Default communications policy is LOCKED: never proactively disclose the underlying model stack for Core or Elite. Only explain what powers Quorum if a customer specifically asks. Quorum Private is the necessary exception — Option A vs. Option B is itself the purchase decision, so model identity is disclosed as part of that sales conversation, not hidden. This satisfies TD-LD-7's disclosure requirement for the Private tier specifically.

---

## PART 2 — KEY LEARNINGS (TD-KL)

TD-KL-1: Ground feedback flags Chinese-origin open-weight models (Deepseek, Qwen, Kimi) as a political-optics risk with some Indian buyer circles. This applies equally to GLM (Zhipu/Z.ai — also Chinese-origin), even though the original call notes listed GLM as a separate option alongside "avoid Kimi." Treat Kimi and GLM as the same risk category unless later ground feedback specifically contradicts this.

TD-KL-2: Indian buyers respond better to concrete, ROI-anchored, detail-heavy messaging than abstract or lengthy copy — this is based on WhatsApp cadence outperforming the website. Applies to product positioning generally and should also govern how any future on-prem/model claims get messaged.

TD-KL-3: On-prem deployment is more private than a cloud API call for any of the candidate models. This is a deployment-mode decision layered on top of, not a substitute for, the model-origin question in TD-KL-1.

TD-KL-4: "Build your own model" and "patent a process" are two different claims that the original notes conflated. Pretraining a frontier-scale model from scratch is not realistic pre-revenue for a solo founder. Fine-tuning an existing open-weight model on Quorum's own methodology data, and patenting that methodology, is the buildable version of both.

TD-KL-5: Self-hosting neutralizes the data-residency ("data leaves the building") concern but does NOT neutralize a model's country-of-origin as a separate buyer concern. These are two different axes. Tier 1 buyers are the most likely to be sophisticated enough to ask about origin specifically, which is why Tier 1 offers an explicit choice (TD-LD-7) rather than defaulting quietly to the cheaper/faster option.

TD-KL-6: Quorum's multi-agent architecture has named modules that run on the "top/complex reasoning" role — Council Synthesis, Mirror, Verdict. Use these names going forward instead of the generic "top role" when referencing what runs on Claude Sonnet (or its tier-specific replacement).

---

## PART 3 — MODEL & INFRA COMPARISON (as of July 2026 — RESOLVED into Part 4's tiered architecture)

| Model | Origin | License | On-prem viability | Political-optics fit (per TD-KL-1) | Notes |
|---|---|---|---|---|---|
| Kimi K2.6 | Moonshot AI, Beijing | Modified MIT (permissive) | Viable, heavy hardware (~600GB+ for full weights) | Fails — Chinese origin | K3 open weights expected ~ late July 2026, license terms not yet published |
| Qwen 3.6 (open-weight, e.g. 35B-A3B / 235B-A22B) | Alibaba, Beijing | Apache 2.0 | Viable, self-hostable at every size | Fails — Chinese origin | This is the actual self-hostable ceiling. Used in Tier 1 (T1a) and Tier 2 |
| Qwen 3.7 (Max / Plus) | Alibaba, Beijing | Proprietary, API-only | NOT self-hostable — no weights released since May 2026 | Fails — Chinese origin | Current true flagship, cloud-only. Do not confuse with Qwen 3.6 when scoping Tier 1 |
| Deepseek V4 Flash | DeepSeek, Beijing | MIT (open-weight) | Viable, self-hostable | Fails — Chinese origin | Quorum's CURRENT production default for the light/fast role. Being replaced by Mistral Small 4 in Tier 3 and folded into the Qwen tiers elsewhere |
| GLM (GLM-4.6 / GLM-5.x) | Zhipu / Z.ai, Beijing (Tsinghua spinout, HK-listed) | MIT | Viable, explicitly built for on-prem/air-gapped use | Fails — Chinese origin, same category as Kimi. Contradicts the notes' "or GLM" framing — US Entity List designee | 
| Mistral (Large 3 / Small 4) | Paris | Apache 2.0 (no usage restrictions) | Viable, built specifically for sovereign/on-prem deployment | Clean fit — positions itself as the alternative for buyers wary of both US and Chinese infra control | Current starting recommendation for the debate |
| Llama 4 (Scout / Maverick) | Meta, US | Llama 4 Community License, free to 700M MAU | Viable, self-hostable | Neutral / US-origin | Notes said "Llama 3" — that's a generation behind. Llama 4 is current; Meta has since shifted its own flagship frontier work to a closed model (Muse Spark), but Llama 4 remains open and downloadable |
| Build own model (pretrain from scratch) | N/A | N/A | N/A | N/A | Not realistic pre-revenue — see TD-KL-4. Reframe as fine-tuning Mistral or Llama 4 |
| SoC personal-assistant box (hardware) | N/A | N/A | N/A | N/A | A genuinely different product (hardware + edge inference), not a model choice. Needs its own go/no-go, not bundled in here |

---

## PART 4 — TIERED MODEL ARCHITECTURE (RESOLVED)

Three tiers, segmented by buyer privacy need and China-origin risk tolerance — not a single default model. Replaces the prior open question on Kimi vs. GLM vs. Mistral vs. Llama as "the" pick; different buyer personas get different stacks.

TIER 1 — FULL PRIVACY (SELF-HOSTED, ZERO EXTERNAL API CALLS)
Offered as an explicit buyer choice, not a single stack (TD-LD-7):
- T1a, Qwen path (moderate risk-tolerance persona): light role runs a smaller Qwen 3.6 open-weight variant (replacing deepseek v4 fast); top role runs the largest self-hostable Qwen 3.6 open-weight variant (replacing Claude). This is the self-hostable ceiling, not Qwen's actual flagship — Qwen 3.7-Max/Plus is API-only and cannot be self-hosted.
- T1b, Mistral path (zero risk-tolerance persona): light role runs Mistral Small 4 (self-hosted); top role runs Mistral Large 3 (self-hosted). Buyers choosing this path must be told explicitly that performance will be lower than the Qwen path — that gap is the trade being made for a fully non-China stack.
Claude is not used in Tier 1 under either path — an external API call would break the full-privacy premise.

TIER 2 — PARTIAL PRIVACY, LOWEST COST, CHINA CONNECTION ACCEPTED
Cloud Qwen end-to-end (both light and top roles), non-self-hosted. Lowest infra overhead, cheapest to run. Explicitly for buyers who've said a China-based cloud connection is fine.

TIER 3 — PARTIAL PRIVACY, FULL CLAUDE-LEVEL POWER, CHINA CONNECTION NOT ACCEPTED
Light role: Mistral Small 4 (cloud), replacing deepseek v4 fast — confirmed comparable cost ($0.10-0.15/M input, $0.30-0.60/M output vs. deepseek v4 flash's $0.14/$0.28) and EU-hosted under Apache 2.0. Top role: Claude, unchanged from current setup.

CURRENT STATE NOTE: Quorum's production default before this redesign runs deepseek v4 fast directly for the light role — itself Chinese-origin, the exact exposure TD-KL-1 flagged. This tiered architecture is what actually resolves that for Tier 2 and Tier 3 buyers. Tier 1 does not remove the origin question, only the data-leaves-the-building question — hence the explicit T1a/T1b choice rather than a silent default (see TD-KL-5).

---

## PART 5 — CUSTOMER-FACING PACKAGING (LOCKED, V3)

Translates the Part 4 technical tiers into what buyers actually see. Four plans, sold as trust profiles rather than model names (TD-LD-8, TD-LD-9).

| Plan | Price | Internal stack | Positioning | Target |
|---|---|---|---|---|
| Free Early Access | Free, 1 month, ~first 100 users | Full Tier 3 stack (Mistral Small + Claude Sonnet) | Testimonials, feedback, referrals | Anyone in the funnel during the window |
| Quorum Core | ₹1,999/month | Tier 2 — cloud Qwen end-to-end, all roles | "Best Value" | Professionals, founders, individuals |
| Quorum Elite (recommended) | ₹3,999/month | Tier 3 — Mistral Small (light role) + Claude Sonnet (Council Synthesis, Mirror, Verdict) | "Best Intelligence" | Career, investment, business, and life-changing decisions |
| Quorum Private | Custom, from ₹9,999+/user/month, minimum seats | Tier 1 — self-hosted, buyer picks Option A (Qwen, higher performance, China-origin) or Option B (Mistral, slightly lower reasoning quality, European, stronger compliance story) | "Best Privacy" | Startups, family offices, enterprises |

Disclosure policy (TD-LD-9): Core and Elite customers are never proactively told which model runs underneath — only if they ask. Private customers necessarily know, since picking Option A vs. B is the purchase decision itself, and TD-LD-7's disclosure requirement (Option B is explicitly lower-performance) is satisfied by that sales conversation.

CAUTION FLAGGED FOR DEBATE: the ₹9,999+ Private price floor is set ahead of confirmed self-hosting hardware costs (Open Question 1 is still open). Worth sanity-checking that floor once T1a/T1b hardware sizing comes back, rather than treating it as final. Similarly, Elite's margin depends on actual Claude Sonnet usage volume per session across Council Synthesis/Mirror/Verdict — not yet modeled (see new Open Question 6).

---

## PART 6 — IMMEDIATE ACTIONS (ACTIVE NOW)

1. Market/gap research — audit 3-5 adjacent products (executive coaching apps, decision-journaling tools, personal AI advisory plays) for how much product detail they surface. Cross-reference against what leads actually ask before converting, across the 11 sessions to date.

2. Website rebuild — pull 2-3 top-performing WhatsApp hooks, rebuild homepage headline/subhead around them. Add a concrete "how it actually works" section with mechanism-level detail. Cut page length elsewhere. ROI-driven means specific before/after, not adjectives.

3. Third-party data privacy audit — get 2-3 quotes. Decide scope first (see Open Question 5 below): lightweight data-flow/code audit vs. full SOC 2 or ISO 27001 readiness assessment. Cost and timeline differ significantly between these.

---

## PART 7 — OPEN QUESTIONS FOR NEXT SESSION (to actually debate, not yet decided)

1. Hardware sizing and cost estimate for self-hosting T1a (Qwen 3.6 top variant) vs. T1b (Mistral Large 3) — needed before Tier 1 can actually be quoted to a buyer.

2. Is "pivot into on-prem & secure" a messaging layer added to the current ICP, or does it imply an actual technical build timeline? If a build — what's the realistic MVP scope given solo-founder bandwidth?

3. Scope "patent the process" — multi-agent architecture, the calibration-tracking methodology, or both? This needs an actual IP lawyer conversation, not just internal debate.

4. SoC hardware box — genuine v2 product direction or distraction from the current motion? Needs its own go/no-go, separate from the model decision.

5. Data privacy audit scope — which type, and from which auditor? Get quotes before committing.

6. Per-plan unit economics — need token/session volume estimates for Council Synthesis, Mirror, and Verdict to check whether ₹1,999 (Core, Qwen) and ₹3,999 (Elite, Mistral Small + Claude Sonnet) actually hold margin. Also need a usage cap for the Free Early Access month so 100 free users on the full Elite stack doesn't become an open-ended Claude Sonnet bill.

RESOLVED (was Open Question 6, self-selection): buyers now self-select via the four named plans in Part 5 (Free / Core / Elite / Private), not a separate mechanism.

---

## PART 8 — PARKED (LOGGED, NOT ACTIVE)

1. Corporate-only positioning / drop personal decision-support / drop Family Office as ICP (TD-LD-2)
2. Domain expert hire or partnership (TD-LD-3)
3. LLP entity conversion + Startup India grants (TD-LD-4)

These stay logged here. Revisit only with new information — do not re-litigate without it, per the same discipline used in GTM Playbook V15.

---

## PENDING PLAYBOOK ITEMS LOG

- Confirm Quorum's current entity type before any LLP conversion discussion (blocks TD-LD-4).
- Get hardware sizing/cost numbers for T1a and T1b (Open Question 1) — needed to sanity-check the ₹9,999+ Quorum Private price floor in Part 5, which was set ahead of this data.
- Model per-plan unit economics (new Open Question 6) before Core/Elite pricing goes live anywhere public-facing.
- The four-plan packaging (TD-LD-8) is a pricing/positioning decision that touches customer-facing GTM — recommend cross-referencing or promoting it into GTM Playbook V15 the next time that playbook is version-bumped. Not touched here since V15 is out of scope for this track.
- If TD-LD-2 is ever revisited, cross-check against GTM Playbook V15's ICP section before any change is finalized there.
