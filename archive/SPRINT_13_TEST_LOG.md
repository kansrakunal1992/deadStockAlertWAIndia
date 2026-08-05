# QUORUM — Sprint 13 Test Log
**Items under test:** Mirror Status Fix (Item 1) · R6–R12 Rule Engine (Item 2) · R2 threshold patch

---

## ITEM 1 — Mirror Status Fix (`/api/mirror/status`)

**Bug being fixed:** `bias_library` was queried with `.eq('user_id', userId)`. The table has no `user_id` column — it keys on `user_email`. All authenticated paywall users saw the generic placeholder instead of their named biases.

### Prerequisites
- At least one authenticated user with ≥ 5 sessions and no `mirror_access` row (gateState = `paywall`).
- That user must have ≥ 1 row in `bias_library`. Verify with:
```sql
SELECT bias_parameter, detection_count
FROM bias_library
WHERE user_email = '<test_user_email>'
ORDER BY detection_count DESC;
```

### Test A — Paywall user sees named biases
1. Log in as the test user (magic link).
2. Navigate to `/mirror`.
3. Confirm gateState = `paywall` (blur overlay visible).
4. **Expected:** blurred tiles show actual bias names (e.g. "Sunk Cost Bias", "FOMO") — not "Pattern 1 / Pattern 2 / Pattern 3".
5. **Fail signal:** generic placeholder labels → fix not applied or `user_email` not resolving.

### Test B — Unlocked user unaffected
1. Log in as a user with a valid `mirror_access` row.
2. Navigate to `/mirror`.
3. **Expected:** Mirror loads normally, no regression.

### Test C — Email resolution failure degrades gracefully
1. Temporarily pass a valid `user_id` for a user whose email cannot be resolved (e.g. deleted account, bad token).
2. **Expected:** `teaserBiases: []` returned, generic placeholder shown — no 500 error.

### Supabase verification
```sql
-- After Test A: confirm the correct rows were queried
SELECT bias_parameter, detection_count, user_email
FROM bias_library
WHERE user_email = '<test_user_email>'
ORDER BY detection_count DESC
LIMIT 3;
```

---

## ITEM 2 — Rule Engine R6–R12 (`lib/rule-engine.ts`)

All tests are functional (submit a real decision, check `rule_engine_result` in DB).

**Verification query (after each test):**
```sql
SELECT rule_engine_result
FROM sessions_ontology
WHERE session_id = '<session_id>';
```

---

### R7 — Information-First Redirect [REDIRECT]
**Trigger:** `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 3`

**Decision to submit:**
> "I am deciding whether to acquire a competitor. I don't have their financials, their customer churn rate, or any sense of how their team culture compares to ours. The outcome could be transformative or catastrophic — I genuinely don't know which."

**Expected result:**
- `rule_engine_result.mode = "REDIRECT"`
- `triggered_rules[0].rule_id = "R7"`
- Examiner shows redirect banner with: *"There is specific information that would change this decision..."*
- Synthesis blocked.

**Fail signal:** mode = `OPEN` or `GATE` → `decision_discriminating_info` scoring too low, or `identity_alignment` scoring > 3.

---

### R6 — Multi-Party Alignment [FLAG]
**Trigger:** `decision_unit ≥ 3 AND emotional_intensity ≥ 4`

**Decision to submit:**
> "I need to decide whether to restructure my leadership team. This affects my CFO, two VPs, and several direct reports. I feel strongly that the current structure is holding us back but I'm anxious about how each person will react."

**Expected result:**
- `rule_engine_result.mode = "OPEN"` (or GATE if another rule fires)
- `flag_rules` contains `rule_id = "R6"`
- Council receives R6 question as enrichment signal.

---

### R8 — Irreconcilable Values [FLAG]
**Trigger:** `value_conflict ≥ 5 AND identity_alignment ≥ 4`

**Decision to submit:**
> "I have to choose between accepting a role that would make me financially secure for life but requires relocating my family away from everything we know, or staying in a city I love with work that is meaningful but financially precarious. Both matter to me deeply and I cannot see a version where I don't lose something fundamental."

**Expected result:**
- `flag_rules` contains `rule_id = "R8"`
- Council receives values-conflict signal.

**R12 suppression check:** If `decision_unit = 2` also scores ≥ 4, confirm R12 does **not** appear in `flag_rules` (R8 suppresses it).

---

### R9 — Irreversibility Warning [FLAG]
**Trigger:** `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4`

**Decision to submit:**
> "I'm thinking about selling my ancestral family property. No one is forcing me to sell — there's no financial pressure, no deadline. But I've been going back and forth emotionally for months. Once it's sold, that's it."

**Expected result:**
- `flag_rules` contains `rule_id = "R9"`

**R4 suppression check:** If `regret_asymmetry ≥ 4` also fires, confirm R9 does **not** appear in `flag_rules` (R4 suppresses it). Both address the irreversibility/regret axis — showing both is redundant.

---

### R10 — Complexity Overload [GATE]
**Trigger:** `task_complexity ≥ 5 AND ambiguity ≥ 4`

**Decision to submit:**
> "I am deciding whether to spin out a new business unit as an independent entity. This involves legal restructuring, tax implications across three jurisdictions, negotiating equity with five stakeholders, deciding which employees transfer, renegotiating vendor contracts, and handling customer communication — and I'm not clear on what the end state should even look like."

**Expected result:**
- `rule_engine_result.mode = "GATE"` (assuming no REDIRECT rule fires)
- `triggered_rules` contains `rule_id = "R10"`
- Examiner shows: *"If you could resolve only one question..."*
- Synthesis fires after Examiner submit.

---

### R12 — Couple Misalignment [FLAG]
**Trigger:** `decision_unit == 2 AND value_conflict ≥ 4`

**Decision to submit:**
> "My partner and I are deciding whether to have a second child. I want one; I sense she is uncertain but hasn't said it directly. We haven't had a real conversation about this yet."

**Expected result:**
- `flag_rules` contains `rule_id = "R12"`
- Council receives: *"What has the other person actually said they want..."*

**Confirm R8 suppression:** Submit a version where value conflict is maximum (≥ 5) AND identity stakes are high (≥ 4). R8 should appear and R12 should be absent from `flag_rules`.

---

## ITEM 2b — R2 Threshold Patch (identity_alignment ≥ 5)

**What changed:** R2 threshold raised from `≥ 4` to `≥ 5` to preserve discriminant validity.

### Test D — R2 fires only at maximum identity signal

**Should NOT fire R2 (identity_alignment = 4, below new threshold):**
> "I am deciding whether to leave my corporate job to start a company. I have financial savings for 18 months. It's meaningful work but I'm not sure the timing is right."

**Expected:** `triggered_rules` does not contain R2. Mode = `OPEN` (unless another rule fires).

**Should fire R2 (identity_alignment = 5):**
> "I built my entire identity around being a doctor. I am now deciding whether to leave medicine permanently to pursue a completely different path. I genuinely don't know who I am outside of this profession. Everything feels ambiguous — my relationships, my purpose, what I even want."

**Expected:** `triggered_rules` contains `rule_id = "R2"`. Mode = `GATE`.

---

## REGRESSION — R1 Still Fires Correctly

Confirm the R2 threshold change did not affect R1.

**Decision to submit:**
> "I need to decide my equity split with my co-founder. But we haven't yet agreed on who is CEO. That decision has to come first."

**Expected:**
- `rule_engine_result.mode = "REDIRECT"`
- `triggered_rules[0].rule_id = "R1"`
- R2 does not appear.

---

## SUMMARY CHECKLIST

| # | Test | Pass | Notes |
|---|---|---|---|
| A | Paywall user sees named biases (not generic placeholder) | | |
| B | Unlocked user Mirror loads normally | | |
| C | Email resolution failure → graceful degradation, no 500 | | |
| D | R7 fires → REDIRECT, synthesis blocked | | |
| E | R6 fires → FLAG in Council context | | |
| F | R8 fires → FLAG; R12 suppressed when R8 active | | |
| G | R9 fires → FLAG; R9 suppressed when R4 active | | |
| H | R10 fires → GATE, Examiner shown, synthesis after submit | | |
| I | R12 fires → FLAG in Council context | | |
| J | R2 does NOT fire at identity_alignment = 4 | | |
| K | R2 fires at identity_alignment = 5 | | |
| L | R1 unaffected — REDIRECT still fires correctly | | |
