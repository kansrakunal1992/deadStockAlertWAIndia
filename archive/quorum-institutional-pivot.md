# Quorum: institution-first — website, product, data boundary, GTM

A working plan for shifting primary GTM from HNI/founder-direct to institutions (funds, family
offices, boards), without hollowing out the thing that makes the product worth buying: a record
that's actually honest because it's actually private.

---

## 1. Website copy — what needs to evolve

The current site already has the right bones — "Built for the individual. Designed to scale to
the institution," and an Institutional Access section naming the right buyers (PE/VC, family
offices, boards, advisory firms). The problem isn't the thesis. It's that institutional is a
single paragraph near the bottom of a page written, almost word for word, to address one founder.
If institutions are now primary, the copy needs to speak to **two different readers with two
different jobs**, not one reader with a secondary mention.

### Split the voice, not necessarily the site

- **Founder-facing copy** (most of the current page): stays as-is. This is what gets a founder to
  trust the product enough to bring a real decision. Don't dilute it chasing the buyer.
- **Buyer-facing copy** (new, needs real estate): a partner at a fund doesn't care about "the
  version of you that already knows the outcome, looking back." They care about portfolio risk,
  what they can point to in an LP update, and what it costs. This needs its own section or page —
  not three lines under a pricing card.

### Specific additions / changes

- **A dedicated institutional page or clearly demarcated section**, reached from primary nav, not
  buried after the individual pricing tiers. Headline should name the buyer's actual pain in their
  language — something closer to *"Twelve portfolio founders. Twelve judgment systems you can't
  see into."* than anything written for the founder's interiority.
- **Make the privacy boundary a selling point, not fine print.** Right now the trust architecture
  (institution never sees individual Mirror content) is an internal design decision. It should be
  a published, named commitment on the institutional page: *why* the fund gets a real signal and
  the founder still tells the truth. This is the single best answer to the buyer's unspoken
  objection — "if I make my founders use this, will it actually be honest, or will they perform
  for it?" — and it's currently invisible on the site.
- **Outcome-metric proof, not feature lists.** The buyer doesn't want "Bias Fingerprint, Confidence
  Calibration." They want "Decision Independence Score trending up across a cohort" and "the
  calibration gap narrowing on high-pressure capital decisions." Once you have pilot data, this
  becomes the headline asset on the institutional page — a chart, not a sentence.
- **A third CTA.** Currently: "Open Quorum" (free) and "Request advisory access" (founder-led).
  Add: "Request a portfolio pilot" / "Talk to us about institutional licensing" — distinct intake
  flow, distinct qualifying questions (fund size, portfolio count, board cadence — not "what
  decision are you facing").
- **A pricing card for the institutional tier**, even if it's "by application" like Advisory
  today. Right now an institutional buyer scanning pricing sees three individual SKUs and nothing
  that looks built for them.
- **Surface Security & Trust earlier and make it heavier.** It already exists in the footer.
  Institutional buyers will look for this before anyone signs anything — data residency, what's
  logged, what's deletable, what a DPA looks like. Right now it reads like a footnote; for this
  motion it needs to read like a page someone's legal team would accept.
- **A social-proof slot for the institutional motion specifically**, even anonymized at first (the
  Delhi NCR consulting-firm decision record format you already use for individuals is the right
  template — do the same thing for "a fund deployed this across N portfolio founders, here's the
  pattern it surfaced").

---

## 2. Product interventions needed to be org-sale-ready from day one

These are the things that need to exist *before* a fund signs, not things to patch after the
first complaint.

### Org/seat infrastructure
- `organizations` + seat model: an org has N seats, each seat maps to one individual user, billing
  is at the org level (annual portfolio license, not the current ₹3,999/mo individual Razorpay
  flow).
- Bulk seat provisioning / invite flow for onboarding a portfolio at once.
- Replace the `ADMIN_CODE` env-var hack with real roles: a distinct **org-admin** role, scoped
  only to the aggregate dashboard described below — never to individual Mirror content. This is
  not the same thing as your personal ops admin panel and shouldn't share a login mechanism with
  it.

### The aggregate dashboard (what the institution actually gets)
- Usage & cadence: who's active, who isn't, seats utilized — content-free.
- Anonymized cohort benchmark: extend the existing "Others in Similar Decisions" feature with an
  explicit minimum-cohort-size gate (no cut shown below N individuals) so it can never be reverse-
  engineered to a single founder.
- **Outcome trend, not raw scores**: Decision Independence Score trend and calibration-gap trend
  at the cohort level. This is the renewal metric — build it before the first renewal conversation
  needs it, not during.

### Hardening the one bridge that's allowed to exist
- The Decision Brief export/share flow (already implied by copy — "shareable with a board or
  co-founder") needs to be the explicit, well-built individual-to-institution bridge. Add an
  audit-log entry every time a brief is shared, visible to the *individual*, so they always know
  exactly what crossed the boundary and when. Trust requires this be legible to the person taking
  the risk, not just true in the backend.

### The ritual mechanism
- Add an event-relative nudge trigger alongside the existing inactivity-decay cron
  (`daily-nudge`, day 2/5/10/18): a `next_board_date` / `next_review_date` field per seat, firing
  5–7 days out — *"your board meets in 6 days."* Reuses the existing throttle and copy-bank
  infrastructure; the new part is the trigger condition.

### Data ownership and offboarding
- Decide and build, explicitly: if a fund cancels a seat or a founder leaves the portfolio
  relationship, the *individual* keeps their own record (full export, continued access on their
  own account) — separate from the org's billing relationship ending. This is what makes "it's
  your record, not the fund's" true in practice, not just in copy.

### Legal/compliance groundwork
- A DPA template and a written, public version of the privacy boundary — this needs to exist
  before the first institutional conversation reaches a term sheet, not be drafted reactively
  once asked for.

---

## 3. What stays gated where

| Stays at the individual level — institution never sees this | Lives at the org level — what the institution can actually access |
|---|---|
| Raw session content, decision text, full Council/Examiner/Synthesis transcripts | Seat administration: invite, remove, billing |
| Bias Fingerprint detail (specific triggers, sessions) | Aggregate usage & cadence (active/inactive, no content) |
| Contradiction Detector detail (the exact statements) | Anonymized cohort benchmark (gated by minimum cohort size) |
| Confidence Calibration detail, per-decision | Decision Independence Score **trend**, cohort-level only |
| Decision Independence Score, per-decision raw value | Org-level configuration: board/review cycle dates that drive nudges |
| Full decision-record timeline / history | Audit log of *which* briefs were shared, by whom, when (not their content unless opened) |
| — | Specific Decision Briefs the individual explicitly chose to export and share |

The rule underneath the table: **nothing crosses by default.** The only things on the right side
are either (a) aggregated past the point of re-identifying one person, or (b) explicitly,
individually opted into per artifact. There is no admin view that lets an org see one named
person's Mirror content, ever, regardless of role or contract tier.

---

## 4. GTM plan

### Phase 0 — Validate before building (2–4 weeks)
- 5–6 conversations with actual fund partners (the check-signer, not the founder). Test the real
  pain ("twelve judgment systems in the dark") and surface their actual objections — almost
  certainly: "will my founders actually use this honestly."
- Use this phase to pressure-test pricing instincts and find out what board/portfolio cadence
  actually looks like across different fund types — it varies, and the nudge mechanism needs to
  match reality, not assumption.

### Phase 1 — One design-partner fund (one quarter)
- Pick one fund, 6–10 portfolio companies. Portfolio-wide license, priced generously low in
  exchange for being the reference case.
- Wire the pilot to that fund's actual board cycle from day one — this is the proof of the ritual
  mechanism, not just the sale.
- Instrument everything: seats activated, decisions logged per seat per quarter, Independence
  Score trend, calibration-gap trend. This data is the entire Phase 2 sales asset.

### Phase 2 — Build the proof asset
- Turn the pilot into the anonymized case study that goes on the institutional page (Section 1).
  The output you want: "across N founders over Q quarters, the average Independence Score moved
  from X to Y, and the calibration gap on high-pressure decisions narrowed by Z" — exactly the
  outcome-metric proof the copy is currently missing.

### Phase 3 — Expand the portfolio-model motion
- Use the case study to approach 2–3 more funds/family offices. Formalize the institutional SKU,
  the DPA, and the dedicated landing page built in Section 1.
- Consider the advisory-firm channel in parallel — firms that already advise founders licensing
  Quorum into their own engagement model is a multiplier you don't have to sell directly, and your
  copy already names it as a target buyer.

### Phase 4 — Only then, consider single-org enterprise
- The CXO-direct, single-large-org sale is slower and lacks the natural board-cycle ritual. Treat
  it as a second motion to test once the portfolio model is proven and the aggregate
  dashboard/SKU/legal groundwork already exists — don't split focus building for both buyer types
  simultaneously from zero.

### Keep running in parallel, deliberately small
- The individual self-serve funnel stays alive as low-cost lead generation and credibility
  building — individuals who already trust Quorum on their own become the internal advocates
  inside the funds you're trying to sell into. Don't kill it to focus on institutional; just stop
  treating it as the primary growth lever.

### The one thing to track at every phase
Not "decisions logged." **Independence Score trend and calibration-gap trend, per cohort.** If the
sales and renewal story is ever built on raw volume instead, the incentive to log real, vulnerable
decisions quietly disappears — and so does the only thing that made the product worth buying.
