# QUORUM — Sprint 16b Test Log
### Fixes: R1 confidence guard · R1 override button · REDIRECT question display · Pushback detection prefix · Language register · Share context fan-out

---

## Fix 1 — Rule Engine: R1 confidence guard + user override

### A — Confidence guard: R1 does not fire on low-confidence score 5

**Setup:** Trigger a session where `upstream_dependency.score = 5` but `confidence < 0.55`.  
Best reproduced with a vague or multi-clause decision description where the tagger is uncertain whether a real upstream dependency exists.

| Test | What to check | Expected |
|---|---|---|
| 1A | Low-confidence score-5 session → ExaminerPanel: no REDIRECT banner appears | ✅ No block |
| 1B | Low-confidence score-5 session → SynthesisCard: no "Blocked — upstream decision unresolved" header | ✅ Normal synthesis card |
| 1C | Low-confidence score-5 session → Persona grid: full opacity, pointer-events normal | ✅ Grid interactive |
| 1D | Genuine score-5 with confidence ≥ 0.55 → R1 still fires REDIRECT as before | ✅ Block fires |
| 1E | R7 (Information-First) confidence guard: existing behaviour unchanged | ✅ Unaffected |

**How to induce low confidence:** Submit a decision like *"I need to decide whether to launch — but there's also the funding question"* — the tagger may score upstream_dependency: 5 with confidence 0.45. Check Railway logs for the ontology response JSON to see the exact confidence value.

---

### B — R1 REDIRECT question display in SynthesisCard

| Test | What to check | Expected |
|---|---|---|
| 1F | Genuine R1 REDIRECT fires → SynthesisCard body shows "Resolve this before returning" label | ✅ Label present |
| 1G | Question box is populated with the exact R1 question text from rule_engine_result | ✅ Specific question shown (not generic copy) |
| 1H | Question text matches what appeared in ExaminerPanel REDIRECT banner | ✅ Identical text |
| 1I | No redirectQuestion available (edge case: timing) → fallback generic copy renders, no crash | ✅ Graceful fallback |
| 1J | Override button "This doesn't apply — continue to Council" present in SynthesisCard REDIRECT body | ✅ Button visible |

---

### C — R1 user override button

| Test | What to check | Expected |
|---|---|---|
| 1K | Click "This doesn't apply — continue to Council" → SynthesisCard REDIRECT banner disappears | ✅ Replaced by synthesis card |
| 1L | After click → synthesis streams (Council must be done; examinerReady flips true) | ✅ Synthesis fires |
| 1M | After click → persona grid returns to full opacity, pointer-events restored | ✅ Grid interactive |
| 1N | After click → Railway logs / Supabase `sessions_ontology.raw_ontology_json` contains `"user_overrode_redirect": true` | ✅ Override logged |
| 1O | Override log also contains `"user_overrode_redirect_at"` ISO timestamp | ✅ Timestamp present |
| 1P | PATCH to `/api/ontology` fails silently — UI override still completes, no error shown | ✅ Non-blocking |
| 1Q | Reanalyze after override → new session starts clean, redirectBlocked = false, redirectQuestion = undefined | ✅ Clean reset |

---

## Fix 3 — Pushback protocol: detection at top of prompt

### D — Model behaviour: acknowledgment-first opening

**Setup:** Run a session to completion. Submit a pushback with clear new information (e.g. *"actually there's already a signed term sheet"*) to any persona.

| Test | What to check | Expected |
|---|---|---|
| 3A | Pushback response first sentence names what was introduced ("You've added that…" / "The term sheet you've mentioned…") | ✅ Acknowledgment first |
| 3B | Persona does NOT open with its own analytical position before acknowledging pushback | ✅ No position-first opening |
| 3C | Existing classification steps (WEAK / PARTIALLY VALID / etc.) still execute after acknowledgment | ✅ Protocol intact |
| 3D | Weak pushback (repetition, no new info) → still opens with what user introduced, then holds position | ✅ Acknowledgment + hold |
| 3E | Strong pushback with genuine new data → acknowledged, then MATERIALLY VALID update | ✅ Update visible |
| 3F | First response (no pushback) → PUSHBACK MODE prefix does not alter initial analysis | ✅ No interference |

### E — PersonaPanel status label during pushback

| Test | What to check | Expected |
|---|---|---|
| 3G | Click "Challenge · add context", submit pushback → header badge changes to pulsing "Reading your challenge…" | ✅ Label appears while streaming |
| 3H | Pushback response stream completes → badge changes to "Responded" (with reply-arrow icon, green) | ✅ Responded label |
| 3I | Second pushback submitted → badge returns to "Reading your challenge…" while streaming | ✅ Cycles correctly |
| 3J | No pushback yet → badge shows standard "✓" or "Reading" states as before | ✅ Existing states unaffected |

---

## Fix 4 — Share context with all advisors

### F — Button visibility and lifecycle

| Test | What to check | Expected |
|---|---|---|
| 4A | Complete a pushback on Persona A → "Share this context with all advisors" button appears below reply | ✅ Button visible |
| 4B | Button only appears after `isPushingBack === false` AND `panelState === 'done'` AND `exchanges.length > 0` | ✅ Conditions correct |
| 4C | Button is NOT shown during initial streaming (no exchanges yet) | ✅ Hidden initially |
| 4D | Click share button → button disappears immediately, does not reappear | ✅ One-shot |
| 4E | Second pushback on same persona → button appears again for the new exchange, can be shared again | ✅ Resets per exchange |

### G — Fan-out behaviour

**Setup:** Persona A (e.g. Contrarian) pushback contains *"there's a signed term sheet from investor X"*. Click "Share this context with all advisors".

| Test | What to check | Expected |
|---|---|---|
| 4F | Other 5 personas each show blue "Updated with new context" block below original response | ✅ All 5 update |
| 4G | Originating persona (Contrarian) does NOT receive the context again | ✅ Self-excluded |
| 4H | Update text in each card references the shared information | ✅ Context visible in updates |
| 4I | Original analyses in all cards are preserved above the update block | ✅ Not overwritten |
| 4J | Synthesis does NOT re-run automatically after share | ✅ No synthesis re-trigger |
| 4K | No new API routes fired — reuses existing `/api/persona` examinerContext mechanism | ✅ Existing route |
| 4L | Blue "Updated with new context" UI block matches the examiner-update styling exactly | ✅ Visual consistency |

### H — Edge cases

| Test | What to check | Expected |
|---|---|---|
| 4M | Share context while an examiner update is already streaming on another persona → both streams complete independently | ✅ No interference |
| 4N | Reanalyze after share → all shared context cleared with session reset | ✅ Clean state |

---

## Fix 5 — Language register

### I — Output quality: plain language without depth loss

**Setup:** Run 3 varied sessions — one operational/simple, one complex identity decision, one stakeholder-heavy. Review each persona output.

| Test | What to check | Expected |
|---|---|---|
| 5A | No nominalisations: "the identification of" / "the facilitation of" / "the implementation of" absent | ✅ Active gerunds used |
| 5B | No Latinate filler: "utilise" → "use", "facilitate" → "help", "demonstrate" → "show" | ✅ Plain words |
| 5C | Technical terms used once, in context, not repeated as decoration | ✅ Load-bearing only |
| 5D | Hard-hitting points land in short SVO sentences | ✅ Punchy core sentences |
| 5E | Contrarian tone still sharp — register change does not soften the blade | ✅ Tone intact |
| 5F | Elder tone still measured and considered — register change does not make it terse | ✅ Elder register intact |
| 5G | Analytical depth unchanged on complex decisions — no compression from register rule | ✅ Full depth |
| 5H | Operational/simple query still compresses correctly (calibration rule 5 unaffected) | ✅ Calibration works |
| 5I | Language register does not appear in Synthesis prompt (only in persona WORD_LIMIT_PREFIX) | ✅ Synthesis unaffected |

---

## Regression checks (all fixes)

| Test | What to check | Expected |
|---|---|---|
| R1 | R2–R12 rules fire and behave as before — no collateral changes | ✅ |
| R2 | ExaminerPanel GATE flow (R2/R3/R10) submits correctly, synthesis fires after | ✅ |
| R3 | Examiner supplemental update (blue block) still works for GATE sessions | ✅ |
| R4 | `onComplete` signature change in ExaminerPanel is backward-compatible (third arg optional) | ✅ |
| R5 | Structural context fan-out (Pattern Analyst, Risk Architect, Elder) unaffected | ✅ |
| R6 | Reanalyze clears: redirectBlocked, redirectQuestion, ruleMode, examinerContextByPersona, contextShared | ✅ |
| R7 | SYNTHESIS persona prompt assembly unchanged — PUSHBACK_DETECTION_PREFIX not prepended to synthesis | ✅ |
