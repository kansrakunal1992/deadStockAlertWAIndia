# Sprint 8 — Test Checklist

## 0. Pre-deploy
- [ ] `npm install` — jsPDF is already in package.json (v2.5.2); confirm no new install needed
- [ ] `BRIEF_ACCESS_TOKEN` is set in Railway env vars

---

## 1. BehaviorAlerts — phrase library v4

**Quick validation script** — paste each into the decision textarea, wait 1s, check alert fires:

| Test decision | Expected bias |
|---|---|
| "I'll quit my job to explore options since I can always get a similar role later." | Exit Optionality |
| "I'll shut down this startup; I can restart it anytime if needed." | Exit Optionality |
| "I've accounted for all major costs, so this plan should work." | Complexity Opacity |
| "The visible risks seem manageable; I don't see major issues." | Complexity Opacity |
| "If I work harder, I can guarantee success in this market." | Control Illusion |
| "I can time the market accurately with my judgment." | Control Illusion |
| "They said they're committed, so alignment is strong." | Relationship Alignment |
| "We're on the same page based on discussions." | Relationship Alignment |
| "They won't back out since they agreed earlier." | Relationship Alignment |
| "Selling now would feel like failure, so I won't." | Loss Aversion |
| "I'll stick with this decision to avoid admitting it didn't work." | Loss Aversion |
| "Selling would confirm I made a mistake." | Loss Aversion |
| "My plan will work without needing validation." | Overconfidence |
| "I don't need to model failure scenarios here." | Overconfidence |
| "Others may fail, but this will work for me." | Overconfidence |
| "The risks are minimal given my plan." | Overconfidence |
| "I need to decide today or I'll miss this opportunity." | FOMO / Urgency |
| "Time is running out on this decision." | FOMO / Urgency |
| "I might regret missing this if I don't act now." | FOMO / Urgency |
| "Delaying could mean losing out." | FOMO / Urgency |
| "Recent trends suggest this will continue." | Recency Bias |
| "I'm basing this decision on recent performance." | Recency Bias |
| "The latest results outweigh older patterns." | Recency Bias |
| "Success was due to my skill; failure was bad luck." | Attribution Asymmetry |
| "Failures weren't my fault — circumstances were against me." | Attribution Asymmetry |
| "Bad results were unlucky; good ones showed my ability." | Attribution Asymmetry |

- [ ] All 26 test cases above fire the correct bias alert
- [ ] Dismissing first alert → second-highest match fires (not first one again)
- [ ] Dismissing all → no alert shown, even on continued typing
- [ ] Neutral text ("I need to choose a vendor for our office supplies") → no alert
- [ ] Text under 20 chars → no alert

---

## 2. Decision Brief — BriefCTA component

### Teaser state
- [ ] BriefCTA renders on record page below OutcomeTracker
- [ ] Shows "Decision Brief" label, description, and "Get Brief →" button
- [ ] Gold top accent line visible
- [ ] Clicking "Get Brief →" expands to token input

### Input state
- [ ] Input auto-focuses on expand
- [ ] Placeholder reads "Paste token here"
- [ ] Press Escape → collapses back to teaser
- [ ] "Cancel" button → collapses back to teaser, clears input
- [ ] Empty input → "Download PDF" button is visually disabled (opacity 0.6)

### Invalid token
- [ ] Enter wrong token → "Checking…" spinner shows → error state
- [ ] Error message: "That token doesn't match. Check the one shared with you."
- [ ] Input border turns red
- [ ] Typing in input after error → clears error state, border back to normal
- [ ] Can retry with correct token immediately

### Valid token
- [ ] Enter correct `BRIEF_ACCESS_TOKEN` value → "Checking…" → "Preparing your Brief — downloading now…"
- [ ] Browser triggers PDF download (file named `quorum-brief-XXXXXXXX.pdf`)
- [ ] Component resets to teaser state after ~4 seconds
- [ ] No page navigation occurs — download is inline

---

## 3. Decision Brief — PDF content

Open the downloaded PDF and verify:

### Header
- [ ] Black header bar with "QUORUM" wordmark in gold
- [ ] Tagline "Decision Intelligence · Private Record" in grey
- [ ] Date (e.g. "3 May 2026") and session ID (8 chars) on right
- [ ] Gold horizontal rule below header

### Decision block
- [ ] "THE DECISION" label (small caps, grey)
- [ ] Decision text in light grey box, readable
- [ ] Context text shown below (if present), labelled "Context:"

### Persona sections
- [ ] Synthesis section has dark green header bar with gold left accent
- [ ] All other persona sections have light grey header bar
- [ ] Each section shows the persona label (bold) and tagline
- [ ] Advisor analysis text is readable (10.5pt Helvetica)
- [ ] User pushback messages shown in indented grey box with "Your pushback:" label
- [ ] Divider lines between sections
- [ ] Personas in order: Synthesis, Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor

### Footer
- [ ] "Private · Quorum" on left of every page
- [ ] Page number on right of every page
- [ ] Footer rule above footer text

### Edge cases
- [ ] Long decision text wraps correctly within the box (no overflow)
- [ ] Long persona analysis auto-paginates — text continues on next page
- [ ] Session with no pushback messages — no pushback boxes shown
- [ ] Session with 2+ pushbacks per persona — all rendered in order

---

## 4. PDF route — API-level checks

- [ ] `GET /api/record/[id]/brief?token=CORRECT` → 200, Content-Type: application/pdf
- [ ] `GET /api/record/[id]/brief?token=WRONG` → 403 `{ "error": "Invalid token" }`
- [ ] `GET /api/record/[id]/brief?token=CORRECT` with invalid session ID → 404
- [ ] Response has `Content-Disposition: attachment; filename="quorum-brief-XXXXXXXX.pdf"`
- [ ] Response has `Cache-Control: no-store`
- [ ] If `BRIEF_ACCESS_TOKEN` is unset in env → all tokens accepted (dev mode — matches brief-access behaviour)

---

## 5. Regression checks

- [ ] Home page submit still works — no regressions from BehaviorAlerts v4
- [ ] Record page renders correctly without BriefCTA blocking layout
- [ ] OutcomeTracker still visible above BriefCTA
- [ ] All Mirror sections unaffected (Timeline, Fingerprint, Independence, Rules)
- [ ] Auth flow unchanged
