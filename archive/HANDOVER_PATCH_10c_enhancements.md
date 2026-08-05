# HANDOVER DOC PATCH — Sprint 10c Enhancements
> Applied: May 6, 2026
> Affects: `lib/personas.ts` · `components/PersonaPanel.tsx` · `components/RecordExport.tsx`

---

## Change 1 · Persona Word Limit — 220–280 → ~200 words

**File:** `lib/personas.ts`

**Line ~693 — `WORD_LIMIT_PREFIX`, constraint #2:**

```diff
- 2. LENGTH: Your response must be 220–280 words. Count before submitting.
-    If you exceed 280 words, delete the weakest paragraph. No exceptions.
+ 2. LENGTH: Your response must be 140–170 words. Count before submitting.
+    If you exceed 170 words, cut the weakest paragraph entirely. No exceptions.
+    Every sentence must earn its place.
```

**Rationale:** Models run 30–40% over stated limits. Instructing 140–170 yields ~195–200 in practice — the target. HNI/Founder reading context: these users are consuming 6 personas in one sitting. At 280 words per card that's 1,680+ words of analysis before synthesis. At 200 words it's under 1,200 — digestible in a single focused read. The literary register of the personas (especially Elder, Contrarian) is deliberately elevated; density matters more than volume.

**Note:** Synthesis hard cap remains 180 words (unchanged — it was already set correctly).

---

## Change 2 · Challenge Button — Footer → Header

**File:** `components/PersonaPanel.tsx`

**What changed:** The "Challenge this · add context" button moved from the card footer (full-width, bottom) to the card header (compact, top-right), appearing only when `panelState === 'done'`. The textarea/send flow still appears at the bottom when triggered.

**Before:** Full-width gold button at footer → required scrolling past the response to find it.

**After:** Compact pill button in the header row, right of the status badge (✓) → visible immediately when analysis completes, no scroll required. Button auto-hides once `showPushback` is true (textarea replaces it at bottom).

**Usability logic:** Users read top-to-bottom. The natural reaction to "I disagree with this" happens as they're reading, not after they've scrolled past everything. Header placement matches the cognitive moment of friction — the button is available the instant the analysis finishes.

**Label shortened:** "Challenge this · add context" → "Challenge · add context" (11px compact pill fits the header row cleanly).

---

## Change 3 · Decision Brief PDF Structure — Flat List → Brief + Appendix

**File:** `components/RecordExport.tsx`

**Before:** PDF exported all personas in a flat ordered sequence:
`Cover → Decision Brief → Synthesis → Contrarian → Risk Architect → Pattern Analyst → Stakeholder Mirror → Elder → Competitor`

**After:** PDF is structured as a proper deliverable:
```
Cover page
  └─ THE DECISION (text + context)
Section 1: DECISION BRIEF  (main document body)
  └─ decision_brief persona output — full premium header treatment
Section 2: APPENDIX divider page
  └─ "Full Council Analysis · Council Synthesis · Advisor Responses"
     ├─ Council Synthesis
     ├─ The Contrarian
     ├─ The Risk Architect
     ├─ The Pattern Analyst
     ├─ The Stakeholder Mirror
     ├─ The Elder
     └─ The Competitor
```

**Rationale:** "Generate Decision Brief" on the session page and the PDF "Decision Brief" button were producing different experiences — one was a focused structured output, the other was a full data dump with the brief buried at the front. The PDF should read like a McKinsey one-pager that happens to have full workings attached. The Brief IS the document. The council analysis is the supporting evidence. Now structurally aligned.

**Appendix divider page:** A centred "APPENDIX" label on a blank dark page with a subtitle line — signals the transition from deliverable to working documents. Visually clean, easy to print just page 1–N (brief only) or the full document.

**Appendix only rendered if content exists:** `hasAppendix` guard ensures the divider page doesn't appear for sessions where only the brief was generated (no persona messages in DB).

---

## Prompt Engineering Log — Update

Add to `lib/personas.ts` section of handover doc:

| Area | Rule |
|---|---|
| All personas | Word limit instruction: **140–170** (yields ~200 output). Previous: 220–280 (yielded ~280–300). |

---

## DO NOT REDEBATE additions

| Decision | Rationale |
|---|---|
| Challenge button in header, not footer | Cognitive friction moment happens during reading, not after scrolling. Header placement = zero scroll to access. |
| PDF: Brief as main body, council as Appendix | The Brief IS the deliverable. Council analysis = supporting evidence. Structurally correct for a ₹25K product artifact. |
| Word limits: instruct 140–170 to get ~200 | Models overshoot by 30–40%. 140–170 instruction → ~195–200 output. Tested pattern from prior persona calibration. |
