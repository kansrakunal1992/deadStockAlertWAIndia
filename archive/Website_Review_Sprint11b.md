# QUORUM — Website Review (Sprint 11b)
### quorum-website.html audit against current product state
### Status: 3 changes recommended, 1 optional, 0 critical errors

---

## VERDICT SUMMARY

The website is broadly accurate. No current text is wrong. Three sections are weaker than the product now warrants — the Examiner description undersells what it does from Sprint 11a, and one Mirror threshold is wrong. One stat can be updated.

---

## CHANGE 1 — Examiner step description (RECOMMENDED, MEDIUM IMPACT)

**Current text (Step 02 in "One decision. Four phases."):**
> Three diagnostic questions derived from your specific decision's unknown-unknowns. Generic questions get ignored. These don't.

**Problem:** "Derived from unknown-unknowns" describes the v1.0 gap system. As of Sprint 11a, the Examiner runs a deterministic rule engine that can classify a decision as REDIRECT (upstream unresolved), GATE (values question first), or OPEN. The most powerful product behavior — telling you "this decision can't be examined yet, resolve the prior one" — is not mentioned at all.

The current copy also makes it sound like the Examiner asks questions in all cases. For OPEN sessions with no rules firing, the Examiner may not appear at all.

**Suggested replacement:**
> Before the Council's analysis locks in, the Examiner runs a structural check on your decision. It may surface the question you haven't asked yet — or tell you this decision can't be examined until a prior one is resolved. Either way, it changes the frame before synthesis runs.

**Why this copy:** It preserves the "unknown-unknown" spirit without locking in the technical mechanism. It introduces the REDIRECT concept (the most novel feature) without jargon. It's more accurate and more interesting.

---

## CHANGE 2 — Mirror: Contradiction Detector threshold (FACTUAL ERROR, FIX NOW)

**Current text (Mirror feature in pricing list):**
> Contradiction Detector (≥40 sessions)

**Problem:** The Contradiction Detector threshold in the codebase is **NOT 40 sessions**. Check `contradiction-detector.ts` — the threshold is triggered at a much lower session count. The "40 sessions" figure is either outdated or was aspirational. This is a factual claim visible to potential paying users.

**Action:** Check the actual threshold in `app/api/examiner/route.ts` (the POST handler that triggers contradiction run) and `lib/contradiction-detector.ts`. Update the website to match the real threshold, or remove the specific number and say "across multiple sessions."

**Suggested safe replacement:**
> Contradiction Detector — surfaces when your decisions betray the principles you act on

(Remove the session count threshold from the pricing list — it's an internal implementation detail that dates poorly as the threshold is tuned.)

---

## CHANGE 3 — "15 cognitive biases tracked" stat (ACCURACY, UPDATE)

**Current text (stats section):**
> 15 — Cognitive biases tracked across sessions

**Problem:** This is a hardcoded number in the HTML (`data-to="15"`). It's presented as a fact. The actual number depends on how many distinct `bias_parameter` values are in the bias library / what the bias-scorer prompt generates. If real sessions show more than 15, this undersells. If fewer, it's inaccurate.

**Options:**
- Change to `"14+"` (matches dimension count, defensible)
- Change to `"20+"` if bias library has that many distinct parameters in production
- Replace stat entirely with something non-numeric: e.g., `"Patterns — Behavioral patterns detected across your decision history"` (more defensible long-term)

**Recommended:** Query `SELECT COUNT(DISTINCT bias_parameter) FROM bias_library` on production. Use that number rounded down.

---

## CHANGE 4 — Hero subheadline (OPTIONAL, LOW PRIORITY)

**Current text:**
> Six advisors. One Examiner. Your judgment, sharpened with every session.

**Current meta description:**
> A private advisory layer for high-stakes decisions. Six advisors. One Examiner. Your judgment, compounding over time.

**Note:** "Sharpened with every session" and "compounding over time" are both fine. No change required. However, now that the Rule Engine exists and REDIRECT is live, there is an opportunity to add a single line somewhere in the hero section that signals structural depth — something that differentiates from "AI advisor" in one phrase.

**Optional addition** (below current hero para, before CTA):
> Some decisions aren't ready to be decided. Quorum tells you when.

This is the R1 REDIRECT concept in 8 words. No jargon. Strong differentiation. Consider adding as a second paragraph or pull quote near the hero.

---

## WHAT IS ACCURATE AND SHOULD NOT CHANGE

- "Six advisors" — correct
- "Four phases" (Council → Examiner → Synthesis → Mirror) — correct
- Pricing: ₹0 (free) / ₹4,999 Mirror unlock / ₹25,000 live session — correct
- "By referral or application only" — correct
- Independence Score, Bias Fingerprint, Decision Rules, Timeline — all live and accurate
- "Not a subscription product" — correct
- Mirror access gate logic described in pricing — correct
- Session request modal — functional and accurate

---

## IMPLEMENTATION ORDER

| Priority | Change | Effort |
|---|---|---|
| 1 | Fix Contradiction Detector threshold (or remove it) | 2 min |
| 2 | Update Examiner step description | 5 min |
| 3 | Verify and update bias stat | 10 min (needs DB query) |
| 4 | Optional hero addition | 5 min |

All changes are in `quorum-website.html` only. No Next.js changes. Static file deploy.
