# QUORUM — TECH, INFRA & POSITIONING EXPLORATION PLAYBOOK

VERSION: V9
STATUS: Active, standalone track — Open Question 7 resolved; Private tier fully self-hosted end-to-end, no Claude in that path at all
RELATIONSHIP TO MAIN PLAYBOOK: This is a separate track from GTM Playbook V15. V15 remains the sole source of truth for the customer pipeline and the founding GTM partner search. This playbook governs model/infra strategy, positioning exploration, and legal/structural items that came out of the July 25, 2026 alumni call and same-day follow-up debate sessions. Nothing in this playbook changes current ICP, positioning, or GTM motion unless and until an item is explicitly promoted into V15.

---

## CHANGELOG

V1 — July 25, 2026 — Initial creation. Source: call with an alumnus running an AI agents/tools startup serving clients across industries. Established track scope, locked decisions, key learnings, model/infra comparison, open questions, and immediate actions.

V2 — July 25, 2026 — Same-day follow-up debate session (Open Question 1 resolved). Locked: Mistral replaces DeepSeek at the low tier; a two-mode product architecture (Standard vs. Private Mode) adopted to resolve the Claude-cannot-be-self-hosted constraint; transparency requirement added for all customer-facing copy. New key learnings on cost, on the actual shape of the privacy objection, and on the strength of available evidence for privacy-as-differentiator.

V3 — July 25, 2026 — Third same-day session. Superseded the two-mode structure with a three-tier structure (Free / Elite / Private) and specific per-tier model assignments. Refined the transparency requirement (TD-LD-9) to specify *where* disclosure lives — FAQ, not pricing-page headline copy. Locked a new backend architecture requirement: tier and model-routing must be independently controllable per user via Supabase. Flagged (not locked): DeepSeek in Free and Qwen in Private both contradicted TD-KL-1.

V4 — July 25, 2026 — Fourth same-day session. Open Question 8 resolved: Quorum Free moves to Mistral Small end-to-end. Quorum Private keeps self-hosted Qwen as an option alongside self-hosted Mistral — the founder's explicit, informed decision made after the optics/regulatory flag was raised.

V5 — July 25, 2026 — Fifth same-day session. Open Question 5 resolved: data privacy audit scope. Reframed from a two-way "lightweight vs. SOC 2/ISO 27001" choice into three distinct tracks (architecture/data-flow credibility audit, DPDP legal compliance gap-check, and SOC 2/ISO 27001 enterprise-procurement certification), each with different urgency. Locked: a combined architecture-verification + DPDP gap-check engagement, target budget ₹50K-75K; SOC 2/ISO 27001 parked until a named Private-tier prospect asks for it by name. New key learnings on India's DPDP Act timeline/penalties, SOC 2/ISO 27001 cost reality for early-stage startups, and the specific ways a GDPR-aligned build doesn't automatically cover DPDP.

V6 — July 25, 2026 — Sixth same-day session. Open Question 6 (Quorum Private pricing) provisionally resolved. Surfaced and resolved a structural ambiguity first: Private is confirmed as true on-prem (customer's own cloud account bears the GPU/infra cost; Quorum's marginal cost is software/support only), not Quorum-hosted-but-isolated. Locked: V1 of Quorum Private ships individual-only (the existing Institution/ghost-mode multi-seat admin layer stays switched off for V1), at a ₹9,999/month provisional anchor price, shipped with a one-click deploy tool (Option 2) that provisions into the customer's own cloud account. New key learning: the ₹9,999 anchor is a software fee only — actual all-in customer cost is materially higher once separate infra billing is included, and testing the anchor without surfacing that risks a false-positive demand signal.

V7 — July 25, 2026 — Seventh same-day session. Open Question 4 (SoC personal-assistant hardware box) resolved: dropped, moved to Parked. Founder confirmed this is a someday-maybe idea with no anchored timeline ("very very very long term if at all"), not an active v2 direction. Research surfaced before the drop: the last wave of standalone AI hardware (Humane, Rabbit R1) destroyed billions in value chasing demo excitement rather than product-market fit, and even where edge inference hardware has genuinely matured by 2026, it still can't run cloud-scale reasoning models — a real SoC box would be a meaningful quality downgrade from what Quorum already promises in Elite, not an upgrade. Logged for the record, not acted on.

V8 — July 25, 2026 — Eighth same-day session. Detailed the practical *how* of the audit locked in V5: DIY self-assessment (free DPDP readiness checklists) plus a one-time remote engagement with an independent auditor/boutique firm, explicitly instead of a compliance-automation platform subscription (₹7-15L/year — a different stage's tool). New key learning: Quorum almost certainly isn't a "Significant Data Fiduciary" yet, so DPDP's mandatory-audit trigger doesn't legally apply yet — this audit remains proactive, not compelled. Added Part 7, a consolidated, standalone execution brief pulling every open build/action item into one handoff-ready checklist, and corrected a stale reference to the already-resolved pricing question in the old pending-items log.

V9 — July 25, 2026 — Ninth same-day session. Open Question 7 resolved: **Quorum Private fully replaces Claude end-to-end, with no Claude anywhere in that tier's pipeline.** The customer chooses one of two complete, self-hosted stacks at signup — Option A: Qwen Small (fast) + Qwen Large (premium reasoning), or Option B: Mistral Small (fast) + Mistral Large (premium reasoning) — never a mix of the two families. This confirms the larger, more expensive self-hosting scope from TD-KL-8 applies to Private (both a fast and a premium-tier model, not just one), which materially raises the infra cost floor and the one-click deploy tool's scope versus what was previously ambiguous.

---

## SOURCE CONTEXT

Call with: alumnus, founder of an AI agents/tools startup, clients across industries
Date: July 25, 2026
Raw call notes captured by Ken, clarified into V1 via follow-up Q&A. V2 built from a same-day structured debate on Open Question 1, including live research on model/vendor facts, India-specific regulatory context, local-inference tooling, Mistral's market positioning, and current API/GPU pricing.

---

## PART 1 — LOCKED DECISIONS (TD-LD)

Numbered independently from the main playbook's LD series to keep the tracks cleanly separable. No TD-LD is re-litigated without new information, same convention as V15.

TD-LD-1: This track is scoped separately from GTM Playbook V15. Current customer pipeline and GTM partner search are unaffected by anything below.

TD-LD-2: Corporate-only positioning — dropping personal decision-support framing and dropping Family Office as an ICP — is PARKED as an option, not adopted. Current ICP (senior professionals, tier-1 MBA background, ages 30-50, career crossroads) stays as-is.

TD-LD-3: Pursuing a domain expert (hire or partner company) is tied to TD-LD-2 and parked with it. Not actioned until TD-LD-2 is revisited.

TD-LD-4: LLP entity conversion and Startup India grant exploration is PARKED, not urgent. Pending confirmation of Quorum's current entity type before any further work.

TD-LD-5: CLOSED, superseded by TD-LD-7. Originally: "No default model or infra choice is locked." This held through V1; the debate in V2 resolved it.

TD-LD-6: Three immediate actions from V1 remain approved and active: (a) market/gap research, (b) website copy rebuild, (c) third-party data privacy audit quote. See Part 4 (updated).

TD-LD-7 (NEW): Open Question 1 is resolved. **Mistral replaces DeepSeek as the low-tier model**, effective across the product (Standard mode). Kimi and GLM remain ruled out per TD-KL-1. This closes TD-LD-5.

TD-LD-8 (SUPERSEDED IN V3 — see TD-LD-8a below): Originally: product ships as two modes (Standard / Private Mode). Replaced by a three-tier structure that separates the free entry tier from the paid individual tier.

TD-LD-8a (V4, resolved): **Product ships as three tiers**:
- **Quorum Free** — full Decision Council, free. Backend: **Mistral Small, end-to-end.** (Resolved in V4 — DeepSeek dropped, no longer contradicts TD-KL-1.)
- **Quorum Elite — ₹2,999/month**. Backend: Mistral Small for fast reasoning, Claude Sonnet for premium reasoning (Council Synthesis, Mirror, Verdict, deeper analysis). Data still passes through Anthropic's servers for the Claude-handled portion — this is a hard constraint per TD-KL-5, not a gap to close.
- **Quorum Private** — enterprise/self-hosted, entirely inside the customer's own infrastructure (true on-prem, per TD-LD-13). **Fully replaces Claude — no Claude anywhere in this tier's pipeline (Open Question 7, resolved in V9).** Customer picks one complete stack at signup, never a mix:
  - **Option A**: Qwen Small (fast reasoning) + Qwen Large (premium reasoning — Council Synthesis, Mirror, Verdict, deeper analysis).
  - **Option B**: Mistral Small (fast reasoning) + Mistral Large (premium reasoning, same feature set as above).
  Qwen's inclusion is confirmed as the founder's explicit decision, made with the TD-KL-1/TD-KL-10 optics flag already on the table — see TD-KL-10 for the reasoning and the residual asymmetry worth keeping in mind.
The full "we host it ourselves, no external AI company sees your data" claim applies specifically and only to Quorum Private (either option, now unambiguously — both the fast and premium reasoning steps are self-hosted, closing the gap that TD-KL-5 flagged for Elite). Elite should never be marketed with that claim, since Claude remaining in the loop makes it false for that tier.

TD-LD-9 (V3, refined): **All architecture and tier distinctions must be surfaced transparently, but not on the pricing page.** The pricing page stays entirely outcome-focused — no model names, customer-promise language only ("Experience Quorum" / "Quorum remembers, learns and grows with you" / "Your organization's decision intelligence platform"). Full disclosure — which models power which tier, and why — lives in the FAQ and in-app onboarding tour, available to anyone who asks, worded in terms of fitness-for-purpose (accessibility vs. reasoning quality vs. ownership/compliance) rather than cost. This refines V2's blanket transparency requirement: the commitment is to never hide the answer if asked, not to lead every surface with it.

TD-LD-10 (NEW): **Tier and model-routing must be independently controllable per user, via Supabase.** Minimum schema: a `tier` field (free / elite / private) controlling feature and product access, and separate `model_route_fast` / `model_route_premium` override fields controlling which literal model backend actually processes a given request. Backend logic checks the override field first; if none is set, it falls back to the default model mapping for that tier. This is a deliberate two-axis design, not a single combined field — it's what lets a test or admin account hold full tier access while forcing a specific (e.g. cheaper) model for testing, without that being a special-cased hack. Also log which model actually handled each request, tying into the eventual privacy audit's ability to verify what's claimed.

TD-LD-11 (NEW, V5): Confirmed for the founder/test-user workflow specifically: setting `tier = private` (or `elite`) on one's own Supabase row while separately setting `model_route_fast = deepseek_v4_fast` (or any other value) is a supported, intended use of the schema in TD-LD-10 — not a workaround. This should be built as a first-class capability, not patched in later.

TD-LD-12 (NEW, V5): **Open Question 5 (data privacy audit scope) is resolved.** "Audit" is not one decision but three, on different timelines:
- **Architecture/data-flow credibility audit** — verifies the "we host it ourselves, no external AI vendor sees your data" claim for Quorum Private. This is the one being commissioned now.
- **DPDP compliance gap-check** — not optional, not a credibility play; India's DPDP Act carries real penalty exposure (up to ₹250 crore per violation) with a live enforcement clock. Commission this now too, combined with the above rather than as a separate engagement.
- **SOC 2 / ISO 27001** — expensive (₹5L+ / $15K+, multiple months), and per research, premature for a pre-Series A company with no named enterprise prospect asking for it. **Parked** until a specific Private-tier prospect requests it by name.
Target budget for the combined architecture + DPDP engagement: ₹50K-75K. Sub-50K risks a report too thin to actually hand to a skeptical prospect, which would defeat the purpose.

TD-LD-13 (NEW, V6): **Quorum Private is confirmed as true on-prem, not Quorum-hosted-but-isolated.** The customer deploys into their own cloud/infrastructure account and bears the GPU/compute cost directly. Quorum's marginal cost per Private customer is software and support, not compute. This resolves the ambiguity between "Quorum hosts an isolated instance" (assumed in V2/V3's self-hosted proof-of-concept planning) and genuine on-prem deployment — it's the latter. TD-KL-8's infra cost estimates remain relevant as *the customer's* cost, not Quorum's, and should be communicated to prospects as such.

TD-LD-14 (NEW, V6): **V1 of Quorum Private ships individual-only.** The existing Institution/ghost-mode admin layer (aggregate insights roll-up, admin-managed user cohorts) already exists in the codebase but stays switched off for V1. Per-seat vs. per-organization pricing, and any seat-cap logic, is deferred until real institutional interest materializes — not decided now.

TD-LD-15 (NEW, V6): **Quorum Private's price is a ₹9,999/month provisional anchor, not a committed final price.** It is to be tested in real conversations as they occur (no paying users yet on any tier as of V6) and revisited once actual reactions exist — explicitly not locked as final. Revisit triggers: (a) real prospect reactions to the anchor once conversations happen, and (b) actual build/maintenance cost of the deploy tool (TD-LD-16) once scoped, if it materially changes the economics.

TD-LD-16 (NEW, V6): **V1 ships with a one-click deploy tool**, not a "bring your own cloud, DIY" guide. The tool provisions the self-hosted instance into the customer's own cloud account with minimal manual technical work — chosen deliberately to keep the true-on-prem claim intact (customer's account, customer's bill, Quorum never touches it) while lowering the technical bar enough for the actual ICP (senior professionals, not engineers) to realistically use it. This is scoped as its own build item (see Part 4, Action 7), not assumed to be trivial or bundled for free into the pricing decision.

---

## PART 2 — KEY LEARNINGS (TD-KL)

TD-KL-1: Ground feedback flags Chinese-origin open-weight models (Deepseek, Qwen, Kimi) as a political-optics risk with some Indian buyer circles. This applies equally to GLM (Zhipu/Z.ai — also Chinese-origin), even though the original call notes listed GLM as a separate option alongside "avoid Kimi." Treat Kimi and GLM as the same risk category unless later ground feedback specifically contradicts this. **Confirmed by research, not just alumni intuition**: Zhipu/Z.ai has been on the US Commerce Department's Entity List since January 2025 for allegedly advancing Chinese military modernization through AI; India's own CERT-In has separately opened a formal investigation into Chinese AI data practices, India's Finance Ministry has advised government staff off Chinese AI tools, and a PIL is pending before the Delhi High Court on the same issue. This is live regulatory territory in India specifically, not a fringe concern.

TD-KL-2: Indian buyers respond better to concrete, ROI-anchored, detail-heavy messaging than abstract or lengthy copy — this is based on WhatsApp cadence outperforming the website. Applies to product positioning generally and should also govern how any future on-prem/model claims get messaged.

TD-KL-3: On-prem deployment is more private than a cloud API call for any of the candidate models. This is a deployment-mode decision layered on top of, not a substitute for, the model-origin question in TD-KL-1.

TD-KL-4: "Build your own model" and "patent a process" are two different claims that the original notes conflated. Pretraining a frontier-scale model from scratch is not realistic pre-revenue for a solo founder. Fine-tuning an existing open-weight model on Quorum's own methodology data, and patenting that methodology, is the buildable version of both.

TD-KL-5 (NEW): **Claude cannot be self-hosted under any circumstance.** Anthropic (like OpenAI) does not release model weights — the only way to use Claude is via their hosted API. Only open-weight models (Mistral, Llama, DeepSeek's open releases, GLM, Kimi, Qwen) can run on Quorum's own infrastructure. This is the reason Quorum Private's "nobody but us sees it" claim can only ever cover the self-hosted path — it can never be made true for Quorum Elite, since Claude remains in that tier's pipeline touching real user decision data.

TD-KL-6 (NEW): **The privacy objection surfaced by ground feedback is structural, not nationality-based.** The specific feedback named Claude alongside DeepSeek as a concern — an American vendor alongside a Chinese one. This means the underlying worry is "any third party sees my data during inference," not "the model is Chinese." Positioning should lead with "we run the model ourselves — no external AI company, of any origin, ever sees your raw data" rather than leaning on model nationality as the primary trust signal.

TD-KL-7 (NEW): Cost delta from DeepSeek → Mistral at the fast/low tier is modest as of July 2026 — Mistral Small runs roughly comparable on input token price and about 2x on output token price versus DeepSeek's flash tier. Not a meaningful unit-economics risk for Quorum Elite (already on Mistral), and not a large one even if Free moves to Mistral too.

TD-KL-8 (NEW): Self-hosting Mistral for Quorum Private is real infrastructure cost, not free. Ballpark, using on-demand/serverless GPU billing (recommended over a dedicated always-on box while usage volume stays low — rule of thumb, serverless wins below roughly 30% utilization): a small self-hosted model runs low hundreds of dollars/month at low volume; a larger model (needed only if Quorum Private also replaces Claude's premium-tier reasoning, not just fast reasoning) runs materially more. Needs real quotes before the premium price over Elite is set.

TD-KL-9 (NEW): The strongest third-party evidence found for "privacy sells" sits at the enterprise-procurement level (e.g., EU enterprise IT-decision-maker surveys behind Mistral's own sovereignty pitch), not at the individual-consumer level that matches Quorum's actual ICP. Current individual-level evidence is thin (n=2 ground anecdotes: a cofounder candidate's objection, a friend-as-user needing DB screenshots before trusting the product). Privacy claims should be woven into ROI-anchored copy (per TD-KL-2) as a trust-removing proof point, not oversold as the sole headline message, until tested directly against the ICP.

TD-KL-10 (RESOLVED IN V4): The V3 tier draft reintroduced DeepSeek (Free) and Qwen (a Private self-hosting option) — both members of TD-KL-1's Chinese-origin risk group. **Resolved**: Free moves to Mistral Small end-to-end, closing that half cleanly. Qwen is confirmed as a Private self-hosting option — an explicit founder decision, made after the flag (Alibaba's June 2026 addition to the US DoD's "1260H list" of Chinese military companies) was raised, not an oversight. Worth keeping on record: DeepSeek's risk evidence is India-specific and regulatory (CERT-In investigation, Finance Ministry advisory, Delhi HC PIL — direct signals about how Quorum's actual Indian buyers and regulators are reacting), while Qwen's flag is a US-specific designation (evidence of Western government wariness, not direct evidence of Indian buyer or regulator reaction to Qwen itself). This asymmetry is a defensible basis for the differing treatment, but it means Qwen's risk to the Private tier isn't zero, just less directly evidenced than DeepSeek's was for Free. Recommended follow-up (logged in Pending Items, not blocking): prepare an internal talking point for the scenario where a Private-tier prospect's own diligence surfaces the Alibaba DoD listing.

TD-KL-11 (NEW — correction to V2's Pending Items Log): "Mirror" is a real Quorum product feature (alongside Council Synthesis and Verdict), not a typo for Mistral pricing as V2 speculatively assumed. That assumption is retracted.

TD-KL-12 (NEW, V5): **India's DPDP Act is real, in force, and separate from any security certification question.** The DPDP Rules were notified November 14, 2025; 2026 is a "soft enforcement" period of guidance and warnings, with May 13, 2027 as the hard enforcement deadline; penalties can reach ₹250 crore per violation with no signalled grace period after that. This covers consent, notice, breach reporting, and data-principal rights — a completely different compliance surface than SOC 2/ISO 27001's security-controls focus. Given Quorum handles real personal decision data, this applies regardless of what's decided on certification.

TD-KL-13 (NEW, V5): **A GDPR-aligned architecture is a strong head start on DPDP but not a safe substitute for it.** Specific divergences worth checking explicitly rather than assuming covered: DPDP's Consent Manager framework (a India-specific third-party consent-intermediary layer with no GDPR equivalent), the "Significant Data Fiduciary" designation that triggers extra obligations past certain thresholds, narrower deemed-consent categories than GDPR's broader legitimate-interest basis, and DPDP-specific breach-notification mechanics. These are mostly consent/process gaps, not infrastructure gaps, so they won't surface just because the data flows and encryption already look GDPR-shaped.

TD-KL-14 (NEW, V5): **SOC 2/ISO 27001 are real but premature at Quorum's current stage.** Industry guidance for a pre-Series A company under 20 employees is explicitly to wait — get certified once a customer asks for it by name, and in the meantime run a lightweight security assessment (~₹50K-1L). Full SOC 2 Type 1 runs $15K-40K in year one; India-specific quotes for SOC 2 alone run roughly ₹10L in year one. This is a different order of magnitude of spend and calendar time than the lightweight/DPDP-combined track, and isn't justified without a named prospect demanding it.

TD-KL-15 (NEW, V6): **The ₹9,999/month anchor is a software fee only — it is not the customer's all-in cost.** Since Private is true on-prem (TD-LD-13), the customer separately bears real GPU/infrastructure cost on top of that, plausibly ₹15K-40K+/month depending on model size and usage, per TD-KL-8's cost estimates. Testing willingness-to-pay against ₹9,999 alone, without surfacing the separate infra bill in the same conversation, risks a false-positive demand signal — a prospect might react well to ₹9,999 and much less well once the true all-in cost is clear. Any anchor-testing conversation should present both numbers together.

TD-KL-16 (NEW, V8): **The audit locked in TD-LD-12 doesn't require a compliance-automation platform subscription.** Indian DPDP-specific platforms (Sprinto, Scrut, Consentin, RuleExpert) exist and map controls directly to DPDP Rules 2025, but they're built for ongoing multi-framework compliance management and price accordingly (₹7-15L/year for entry tiers) — a different stage's tool. For a one-time credibility + gap-check engagement at Quorum's current scale, the practical path is DIY self-assessment (several of these platforms' free readiness checklists) plus a one-time, remote-only review from an independent auditor or boutique firm, which fits the ₹50K-75K target far better. Also relevant: DPDP's mandatory 12-month independent-audit requirement only applies once an entity is designated a "Significant Data Fiduciary" (a data-volume/sensitivity threshold) — Quorum almost certainly isn't there yet, so this audit remains a proactive credibility investment, not a current legal compulsion.

TD-KL-17 (NEW, V9): **Resolving Open Question 7 to full replacement raises Private's real infra cost floor.** TD-KL-8's higher cost estimate (materially more than the small-model-only scenario) now applies to Private by default, since both a fast and a premium-reasoning model must be self-hosted, not just one. This should factor directly into the ₹9,999/month anchor's honesty (TD-KL-15) — the gap between the software fee and the customer's real all-in cost is now larger than it would have been under a fast-tier-only Private scope, not smaller.

---

## PART 3 — MODEL & INFRA COMPARISON (as of July 2026)

| Model | Origin | License | On-prem viability | Political-optics fit (per TD-KL-1) | V2 status | Notes |
|---|---|---|---|---|---|---|
| Kimi K2.6 | Moonshot AI, Beijing | Modified MIT (permissive) | Viable, heavy hardware (~600GB+ for full weights) | Fails — Chinese origin | Ruled out | K3 open weights expected ~ late July 2026, license terms not yet published |
| GLM (GLM-4.6 / GLM-5.x) | Zhipu / Z.ai, Beijing (Tsinghua spinout, HK-listed) | MIT | Viable, explicitly built for on-prem/air-gapped use | Fails — Chinese origin, same category as Kimi — confirmed US Entity List designee since Jan 2025 | Ruled out | |
| Mistral (Small / Large) | Paris | Apache 2.0 (no usage restrictions) | Viable, built specifically for sovereign/on-prem deployment | Clean fit — positions itself as the alternative for buyers wary of both US and Chinese infra control | **SELECTED** — Elite's fast tier (Small); Private's Option B, full stack (Small + Large, end-to-end, replacing Claude entirely) | Actively and credibly marketed on sovereignty (Azure sovereign-cloud partnership expanded July 2026, manufacturing/enterprise on-prem playbooks exist). Large-model self-hosting is a materially bigger infra lift than Small alone (TD-KL-8) |
| Llama 4 (Scout / Maverick) | Meta, US | Llama 4 Community License, free to 700M MAU | Viable, self-hostable | Neutral / US-origin | Backup option if Mistral licensing/cost changes | Current generation; Meta has since shifted its own flagship frontier work to a closed model (Muse Spark), but Llama 4 remains open and downloadable |
| Claude | Anthropic, US | Closed — no released weights | **Not viable, ever** — no self-hosting exists for Claude at any price | N/A | Elite's premium tier only (Council Synthesis, Mirror, Verdict); **confirmed fully excluded from Private (Open Question 7, resolved V9)** | See TD-KL-5. This is a hard technical constraint, not a preference |
| DeepSeek (V4 family) | Hangzhou | Open weights (varies by model) | Viable | Fails — Chinese origin | **Retired entirely** — dropped from Free in V4, not used anywhere in the product | Cheapest frontier-adjacent pricing on the market; ruled out on optics per TD-KL-1, confirmed out of Free as of V4 |
| Qwen (Small / Large) | Alibaba, Hangzhou | Open weights | Viable, self-hostable, strong benchmark reasoning among open models | Fails — Chinese origin; parent Alibaba added to US DoD's Chinese-military-companies list June 2026 | **CONFIRMED** — Private's Option A, full stack (Small + Large, end-to-end, replacing Claude entirely). Founder's explicit call, made with the flag on the table — see TD-KL-10 | Kept despite the optics flag; asymmetry with DeepSeek's India-specific regulatory evidence is logged in TD-KL-10, not treated as equivalent risk |
| Build own model (pretrain from scratch) | N/A | N/A | N/A | N/A | Not pursued | Not realistic pre-revenue — see TD-KL-4. Reframed as fine-tuning Mistral |
| SoC personal-assistant box (hardware) | N/A | N/A | N/A | N/A | **Dropped, see Part 6 item 4** | Founder confirmed someday-maybe at most, no active consideration |

---

## PART 4 — IMMEDIATE ACTIONS (ACTIVE NOW)

1. Market/gap research — audit 3-5 adjacent products (executive coaching apps, decision-journaling tools, personal AI advisory plays) for how much product detail they surface. Cross-reference against what leads actually ask before converting, across the 11 sessions to date.

2. Website rebuild — pull 2-3 top-performing WhatsApp hooks, rebuild homepage headline/subhead around them. Add a concrete "how it actually works" section with mechanism-level detail. **Updated per TD-LD-9 (V3 refinement)**: the pricing page itself stays outcome-focused, no model names ("Experience Quorum" / "Quorum remembers, learns and grows with you" / "Your organization's decision intelligence platform") — full architecture explanation lives in the FAQ (Action 4), not the homepage. No silent architecture changes; no copy that implies Quorum Private's guarantees apply to Quorum Elite. Cut page length elsewhere. ROI-driven means specific before/after, not adjectives.

3. Data privacy audit — **RESOLVED, see TD-LD-12, detailed further in TD-KL-16.** Two-step, low-cost, fully remote approach: (a) DIY self-assessment using a free DPDP readiness checklist (several DPDP compliance platforms offer these free as lead-gen) to map data flows, consent mechanisms, and the Quorum Private architecture yourself; (b) a one-time, remote-only engagement with an independent freelance auditor or boutique firm — not a compliance-automation platform subscription — to review the self-prepared material and issue a short attestation. Target budget ₹50K-75K. This directly backs the Quorum Private privacy claim referenced in the FAQ — sequence it before or alongside Action 4.

4. FAQ + onboarding tour copy (NEW, updated for V3 tiers) — draft explicit, plain-language FAQ entries and an onboarding tour step covering: what each tier's backend is (Free / Elite / Private), framed as fitness-for-purpose (accessibility vs. reasoning quality vs. ownership/compliance) rather than cost, exactly which data Claude ever sees vs. never sees, and why Private carries a premium. Ties directly to TD-LD-9. **Unblocked as of V4** — model choices for all three tiers are now confirmed (Free: Mistral Small; Elite: Mistral Small + Claude Sonnet; Private: self-hosted Qwen or Mistral).

5. Self-hosted Mistral proof-of-concept (NEW) — stand up the small-model, fast-tier self-hosted path first (serverless/on-demand GPU billing, per TD-KL-8) as a cheap way to validate the architecture before committing to the larger build needed if Quorum Private later also replaces Claude's premium-tier reasoning.

6. Supabase tier/model-routing schema (NEW, per TD-LD-10/11) — build the `tier` + `model_route_fast` + `model_route_premium` fields and the backend routing logic that checks overrides before falling back to tier defaults. Include per-request model logging.

7. One-click deploy tool for Quorum Private (NEW, per TD-LD-16) — build the tooling that provisions the self-hosted instance into a customer's own cloud account with minimal manual steps. Scope this properly (it's a real build, not a script thrown together) before committing to a launch date for Private V1.

---

## PART 5 — OPEN QUESTIONS FOR NEXT SESSION (to actually debate, not yet decided)

~~1. Pick a default on-prem base model to prototype and message around.~~ **RESOLVED in V2 — see TD-LD-7.**

2. Is "pivot into on-prem & secure" a messaging layer added to the current ICP, or does it imply an actual technical build timeline? **Partially resolved** — it's now both, via the two-mode structure (TD-LD-8). Still open: concrete MVP engineering timeline and sprint scope for the self-hosted path, given solo-founder bandwidth (~1-2 hrs/day).

3. Scope "patent the process" — multi-agent architecture, the calibration-tracking methodology, or both? This needs an actual IP lawyer conversation, not just internal debate.

~~4. SoC hardware box — genuine v2 product direction or distraction from the current motion?~~ **RESOLVED in V7 — dropped. See Part 6, Parked item 4.**

~~5. Data privacy audit scope — which type, and from which auditor?~~ **RESOLVED in V5 — see TD-LD-12.** Combined architecture + DPDP engagement, ₹50K-75K target; SOC 2/ISO 27001 parked pending named prospect demand.

~~6. Quorum Private's premium price point~~ **PROVISIONALLY RESOLVED in V6 — see TD-LD-14/15/16.** ₹9,999/month anchor, individual-only V1, true on-prem with a one-click deploy tool. Not a final price — revisit once real prospect reactions exist (see TD-LD-15 on testing it honestly, alongside the separate infra cost).

~~7. Does Quorum Private replace Claude for high-tier reasoning too, or does it only cover part of the pipeline while some other path still touches Claude?~~ **RESOLVED in V9 — full replacement.** See TD-LD-8a: Private is Qwen Small+Large or Mistral Small+Large, customer's choice, no Claude anywhere in that tier.

~~8. DeepSeek in Quorum Free, and Qwen as a Quorum Private option — keep as drafted, or revert to Mistral-only?~~ **RESOLVED in V4 — see TD-LD-8a and TD-KL-10.** Free moved to Mistral Small; Qwen confirmed as a Private option alongside Mistral, founder's explicit call.

9. (NEW) MVP scope for TD-LD-10/11's Supabase tier/model-routing schema — straightforward to spec, but needs to be sequenced against the self-hosted proof-of-concept in Action 5.

---

## PART 6 — PARKED (LOGGED, NOT ACTIVE)

1. Corporate-only positioning / drop personal decision-support / drop Family Office as ICP (TD-LD-2)
2. Domain expert hire or partnership (TD-LD-3)
3. LLP entity conversion + Startup India grants (TD-LD-4)
4. SoC personal-assistant hardware box (NEW, V7) — dropped, no anchored timeline ("very very very long term if at all," founder's words). Not a v2 product direction under active consideration. For the record: the last wave of standalone AI hardware (Humane, Rabbit R1) destroyed billions in value chasing demo hype over product-market fit, and even 2026-era edge inference hardware can't run cloud-scale reasoning models — a real SoC box would be a quality downgrade from Quorum Elite's existing reasoning, not an upgrade. Revisit only if a concrete trigger emerges (e.g., a specific customer request, or a milestone the founder chooses to anchor it to) — no such trigger exists today.

These stay logged here. Revisit only with new information — do not re-litigate without it, per the same discipline used in GTM Playbook V15.

---

## PENDING PLAYBOOK ITEMS LOG

- Confirm Quorum's current entity type before any LLP conversion discussion (blocks TD-LD-4).
- **Resolved in V5, detailed in V8**: audit scope and approach decided — DIY self-assessment + one-time remote auditor review, combined architecture + DPDP gap-check, target ₹50K-75K.
- Per-seat / per-organization pricing and seat-cap logic for the existing Institution/ghost-mode layer remains deferred (TD-LD-14) until real institutional interest appears — revisit then, not before.
- If TD-LD-2 is ever revisited, cross-check against GTM Playbook V15's ICP section before any change is finalized there.
- **All concrete build/action items are consolidated in Part 7 below** — use that section, not this log, as the handoff reference for engineering/execution work.

---

## PART 7 — EXECUTION BRIEF (CONSOLIDATED, FOR HANDOFF)

This section exists to be handed to a different session (engineering-focused or otherwise) with minimal extra context. Each item states what to build/do, references the locked decision behind it for rationale, and notes any blocking dependency.

**Backend / architecture**
1. **Supabase tier + model-routing schema.** Fields: `tier` (free / elite / private) controls feature access; `model_route_fast` and `model_route_premium` are independent override fields controlling which literal model processes a request, defaulting to the tier's standard mapping if unset. Log which model actually handled each request. *Why: TD-LD-10/11. No blocking dependency — can start now.*
2. **Model integration per tier.** Free: Mistral Small, end-to-end. Elite: Mistral Small (fast) + Claude Sonnet (premium — Council Synthesis, Mirror, Verdict, deeper analysis). Private: customer picks one full stack at signup — Qwen Small + Qwen Large, OR Mistral Small + Mistral Large — never mixed, and **no Claude anywhere in the Private pipeline.** *Why: TD-LD-8a, resolved Open Question 7. No blocking dependency.*
3. **Self-hosted proof-of-concept.** Stand up a small self-hosted model (Mistral Small) using serverless/on-demand GPU billing (not a dedicated always-on box, given current low usage volume) to validate the self-hosting architecture before the larger Private build. *Why: TD-KL-8, TD-LD-13. No blocking dependency — do this before Item 4.*
4. **One-click deploy tool for Quorum Private.** Provisions the full chosen stack (both the Small and Large model of whichever family the customer picks) into the *customer's own* cloud account with minimal manual steps — this is what makes "true on-prem" (TD-LD-13) actually usable by a non-technical ICP user rather than only technical early adopters. Scope now includes the Large-model deployment path, not just Small — a bigger build than previously ambiguous. Needs proper scoping as its own project, not a quick script. *Why: TD-LD-16, TD-KL-17. Depends on Item 3 being validated first.*

**Resolved, no longer pending**
5. ~~Get in writing whether Quorum Private replaces Claude end-to-end~~ — **Resolved.** Full replacement confirmed: Qwen Small+Large or Mistral Small+Large, customer's choice, no Claude in that tier at all. Engineering should scope Items 2/4 against this now-settled requirement.

**Compliance / audit**
6. **Data privacy audit — DIY + remote engagement.** Do the architecture/data-flow mapping and a DPDP self-assessment yourself using a free readiness checklist; then commission a one-time remote review from an independent auditor or boutique firm (not a compliance-platform subscription) to validate it and issue a short report. Target ₹50K-75K. Specifically check the DPDP divergence points from a GDPR-aligned build: Consent Manager framework, Significant Data Fiduciary threshold, deemed-consent categories, breach-notification process. *Why: TD-LD-12, TD-KL-13, TD-KL-16. No blocking dependency — can start now, in parallel with engineering.*
7. **Prepare an internal talking point** for "Alibaba/Qwen's US DoD 1260H designation" in case a Private-tier prospect raises it during their own diligence. Not a public-facing document — internal sales/founder prep only. *Why: TD-KL-10. No blocking dependency.*

**Website / copy**
8. **Pricing page**: outcome-focused only, no model names — "Experience Quorum" / "Quorum remembers, learns and grows with you" / "Your organization's decision intelligence platform." *Why: TD-LD-9.*
9. **FAQ + onboarding tour**: full disclosure of what each tier's backend is, framed as fitness-for-purpose (accessibility vs. reasoning quality vs. ownership/compliance), not cost. Cannot be finalized until Item 6 (audit) has at least started, since the Private tier's credibility claim shouldn't be published unbacked. *Why: TD-LD-9, Action 4.*
10. **When testing the ₹9,999/month Private anchor** in any real conversation, always present the separate customer-borne infra cost (~₹15K-40K+/month) alongside it — never test the software fee in isolation. *Why: TD-KL-15.*

**Explicitly not in scope right now**
- SOC 2 / ISO 27001 — parked until a named Private-tier prospect asks for it (TD-LD-12).
- SoC hardware box — dropped, no active timeline (Part 6, item 4).
- Per-seat/per-organization pricing for Private, and the Institution/ghost-mode admin layer — deferred until real institutional interest exists (TD-LD-14).
- Patent scoping — needs an actual IP lawyer conversation, not further internal work (Open Question 3).
