# Quorum Website — Content Plan
*What to build, based on the co-founder overview and the user-facing science/FAQ doc — and, just as important, what to deliberately leave out.*

---

## Purpose of this doc

A page-by-page plan for what the public website should say, pulling from the two docs above, plus explicit guardrails on what not to expose. The goal is a site that reads as credible and serious without either (a) overclaiming things we can't back up, or (b) exposing implementation details that are either gameable or genuinely our moat.

---

## Recommended page structure

1. **Home** — the pitch, in one scroll
2. **How It Works** — the Council walkthrough, simplified from Doc 1 to Doc 2's register
3. **The Science** — the research grounding from Doc 2, expanded slightly
4. **Privacy & Security** — short, concrete, not legalese-only
5. **Pricing** — tiers, plain
6. **FAQ** — pulled near-verbatim from Doc 2

Any institutional/enterprise page should stay off this site until that sequencing question is actually resolved separately — conflating consumer and institutional messaging before the strategy is settled will muddy both.

---

## Page-by-page content plan

### Home
- One-sentence positioning: a structured second opinion for real decisions, from six advisors built to disagree with each other, that remembers your patterns over time.
- Three-step visual: bring a decision → get a Council verdict → the app learns your patterns over time.
- One credibility line about the research grounding (one sentence, not a lecture — link to the Science page for depth).
- A single, honest differentiation line vs. "just asking an AI chatbot": structure, disagreement-by-design, and memory.
- **Video slot:** the intro/self-help video as the hero — see the companion video strategy doc.
- CTA: try it free, no signup.

### How It Works
- Walk through the six advisors by name and mandate (safe to publish — this is the product, not the plumbing).
- Mention the follow-up questions, the synthesis verdict, and the post-synthesis weighting visual.
- Mention that the product remembers your decisions and gets more useful over time — describe the *outcomes* (bias fingerprint, calibration, contradiction-catching, decision map) rather than the mechanics behind them.
- **Video slot:** the explainer video — see the companion video strategy doc.
- Do **not** publish: the underlying dimension-scoring list, rule-engine trigger conditions, exact bias-scoring formulas, exact similarity math, or exact session-count thresholds for unlocking features. These are implementation details, and several are also gameable if published (e.g., "N sessions unlocks X" invites padding sessions just to hit the number).

### The Science
- The four research-grounded ideas from Doc 2 (adversarial review, premortems, calibration training, pattern visibility) — genuinely differentiating and safe to publish, because it cites established external research (Kahneman/Tversky, Tetlock), not unverified claims about Quorum itself.
- One explicit, honest line: *"Quorum is built on established principles from decision science. It hasn't been independently, clinically studied as a product — and we'd rather tell you that than imply otherwise."* Voluntary honesty like this is itself a credibility signal, especially for a thoughtful audience.
- **Video slot:** the research-used video — see the companion video strategy doc.
- Do **not**: cite made-up studies, imply peer-reviewed validation of the product itself, or use clinical/therapeutic language ("proven to reduce anxiety," "clinically validated") anywhere on the site.

### Privacy & Security
- Plain-language version of Doc 2's privacy section: encrypted by default, anonymous start, exportable/deletable at any time.
- If any institutional/team features ever ship: state the individual-privacy guarantee clearly and prominently (no one — including an admin — ever sees another person's specific decisions). Strong trust signal worth its own paragraph once it's live.
- Do **not**: describe the actual encryption implementation, key management, or database architecture. "Your raw entries are encrypted before storage" is enough; algorithm names and schema details belong in a security whitepaper for enterprise buyers later, not the consumer site.

### Pricing
- Free tier: full Council + Decision Brief PDF.
- Paid tier: the Mirror layer (bias fingerprint, calibration, contradictions, decision map) — describe by *benefit*, not by which specific thresholds unlock what.
- The higher-touch Advisory tier reads as a manual, relationship-driven tier today — it likely belongs on a "Contact us" path rather than a self-serve pricing table, unless the intent is to make it publicly self-serve discoverable.

### FAQ
- Pull directly from Doc 2's FAQ, keep the tone identical (plain, honest, willing to say "we don't have that answer yet" rather than fudge it).
- Add a payments/cancellation FAQ entry once pricing copy is finalized (how to cancel, what happens to Mirror access at end of billing period — access continuing through the paid period even after cancellation is a genuinely good, user-friendly answer worth stating plainly).

---

## Where product-embedded content goes (not the marketing site)

A few things belong *inside the product*, not on the public website, because they only make sense with context a first-time visitor doesn't have yet:

- The three onboarding tours (home, council, record) — first-run only.
- The explainer video's longer cut, if one exists, as an optional "how does this work" link inside the session view itself.
- Any copy explaining the weighting strip, structural citations, or the Mirror tiers — these should be short in-context tooltips, not a page of explanation, since a first-time user doesn't have the vocabulary yet and a returning user doesn't need it repeated.

---

## General credibility guardrails for all pages

**Do:**
- Be specific about *what* the product does (six named advisors, a follow-up questioning step, a synthesis verdict) — specificity reads as credible.
- Be explicit about what Quorum is *not* (not therapy, not licensed advice) — stated limits build trust faster than vague reassurance.
- Cite real, established, external research by name (Kahneman, Tversky, Tetlock) rather than vague appeals to "the science."
- Show the actual verdict/synthesis format, or a sanitized example session, if possible — concrete examples outperform abstract claims.

**Don't:**
- Don't publish exact numeric thresholds, formulas, or scoring weights anywhere public — they're both gameable and part of the actual product moat.
- Don't claim clinical, therapeutic, or medical benefit language anywhere.
- Don't reference internal sprint names, engineering history, or roadmap specifics — obviously internal, but worth stating explicitly so nothing from the technical docs accidentally leaks into marketing copy.
- Don't publish specific competitor comparisons by name; differentiate on structure and memory, not by naming and critiquing other products.
- Don't promise "AI-verified accuracy" or similar language the product can't actually back up — the honest "built on established principles, not independently validated as a product" framing is more credible long-term than an inflated claim that erodes trust the first time someone checks.

---

## A few messaging pillars to reuse across pages

- **"A quorum, not a single vote."** — no one voice (yours or the AI's) decides alone.
- **"Built to disagree with itself."** — the Council's structural difference from a single chatbot opinion.
- **"Remembers, so you don't repeat yourself."** — the longitudinal memory as the actual moat, stated simply.
- **"Honest about its limits."** — a recurring thread (not therapy, not licensed advice, not clinically validated) that, counter-intuitively, builds more trust than avoiding the topic.
