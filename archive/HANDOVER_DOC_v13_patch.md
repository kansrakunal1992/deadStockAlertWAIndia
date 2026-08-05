# HANDOVER_DOC v13 — Patch Diff (Sprint 14)
Apply these changes to HANDOVER_DOC_v12.md to produce v13.

---

## CHANGE 1 — Header line (line 2)

**Remove:**
```
### Date: May 2026 | Status: Sprint 13 complete (with patches)
```
**Replace with:**
```
### Date: May 2026 | Status: Sprint 14 complete (with UI patches)
```

---

## CHANGE 2 — DB schema block: mark calibration columns as live (lines 56, 129–131)

**Remove:**
```
pre_decision_confidence integer CHECK (1–10)   ← column exists, UI pending Sprint 13
```
**Replace with:**
```
pre_decision_confidence integer CHECK (1–10)   ← ✅ column + UI live (Sprint 14)
```

**Remove:**
```
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')  ← column exists, UI pending Sprint 13
retrospective_confidence integer CHECK (1–10)  ← column exists, UI pending Sprint 13
calibration_delta       numeric                ← column exists, compute on submit (pending Sprint 13)
```
**Replace with:**
```
outcome_quality         text CHECK ('better_than_expected','as_expected','worse_than_expected','too_early')  ← ✅ column + UI live (Sprint 14)
retrospective_confidence integer CHECK (1–10)  ← ✅ column + UI live (Sprint 14)
calibration_delta       numeric                ← ✅ auto-computed on outcome submit (Sprint 14)
```

---

## CHANGE 3 — Sprint table: add Sprint 14 row (after Sprint 13 row)

**Remove:**
```
| **13** | **Mirror status fix (bias_library user_email query), R6–R12 rule implementations,
           post-test patches: R2 threshold → 5, R12 range widened 2–3, SSL bias trigger fix
           — ✅ ALL TESTS PASSED** |
```
**Replace with:**
```
| **13** | **Mirror status fix (bias_library user_email query), R6–R12 rule implementations,
           post-test patches: R2 threshold → 5, R12 range widened 2–3, SSL bias trigger fix
           — ✅ ALL TESTS PASSED** |
| **14** | **Calibration loop: pre_decision_confidence slider on home page (with baseline
           explanation copy), outcome_quality selector + retrospective_confidence slider in
           OutcomeTracker, calibration_delta auto-computed (retro − pre) on outcome submit.
           UI patches: helped-badge text forced white for light-mode, hindsight confidence
           colour-coded in saved state (red/gold/green). — ✅ ALL TESTS PASSED** |
```

---

## CHANGE 4 — Current status header

**Remove:**
```
## CURRENT STATUS (as of Sprint 13)
```
**Replace with:**
```
## CURRENT STATUS (as of Sprint 14)
```

---

## CHANGE 5 — Add Sprint 14 delivery block under ✅ Live and working

Add the following block **after** the Sprint 13 patches block (after the line that reads
`(no known active bugs as of Sprint 13)`):

```
**Sprint 14 — Calibration Loop**

- `pre_decision_confidence` slider added to home page submission form (`app/page.tsx`).
  Default 5. Colour-coded label (red ≤3 / gold ≤6 / green >6). One-line explanation:
  "This is your baseline. After the decision plays out, we'll measure how your confidence
  shifted — and what that pattern reveals about your judgment over time."
  Value stored in `sessions.pre_decision_confidence` via `/api/session` POST.

- `OutcomeTracker.tsx` expanded with two optional fields:
  - `outcome_quality` — 4-option selector (better_than_expected / as_expected /
    worse_than_expected / too_early). Shown as badge in saved state with per-value colour.
  - `retrospective_confidence` — 1–10 slider, same colour logic as pre-decision slider.
    Shown in saved state in mono, colour-coded (not static text-4).

- `calibration_delta` auto-computed on every outcome save/edit:
  `retrospective_confidence − pre_decision_confidence`. Null when pre was not recorded
  (pre-Sprint 14 sessions). Written to `outcomes.calibration_delta` by `/api/outcome` POST.

- UI patches:
  - Helped-badge text forced to `#fff` — was `var(--text-2)` which renders near-black in
    light mode on a dark-coloured badge background.
  - Hindsight confidence in saved state now colour-coded dynamically; was static `var(--text-4)`.
```

---

## CHANGE 6 — Pending Sprint 14 → move calibration items to ✅, remove from pending

**Remove the entire block:**
```
### 🔄 Pending (Sprint 13)

### 🔄 Pending (Sprint 14)

- `pre_decision_confidence` UI (column in DB, no form element)
- `outcome_quality`  `retrospective_confidence` in OutcomeTracker (columns in DB, no UI)
- `calibration_delta` computed on outcome submit
- Structural retrieval upgrade from categorical to 14-dim vector scoring
- Railway cron for 30-day outcome nudges (infrastructure built, not wired)
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron  days_open tracking
```
**Replace with:**
```
### 🔄 Pending (Sprint 15)

- Structural retrieval upgrade from categorical to 14-dim vector scoring
- Railway cron for 30-day outcome nudges (infrastructure built, not wired)
- Mirror Pattern Store (rule firing frequency accumulation)
- Dynamic persona grid reorder by ontology signals
- R11 (Avoidance Detection) — requires cron + days_open tracking
- Calibration sparklines in Mirror (data now accumulating from Sprint 14)
```

---

## CHANGE 7 — Not started: remove calibration sparklines (now pending, not not-started)

**Remove:**
```
### ❌ Not started (Sprint 14)

- Calibration sparklines in Mirror
- Private benchmarking (aggregate anonymized dimension scores)
- Decision Graph (requires 20 sessions per user)
- Hybrid semantic  ontology structural retrieval
- Mirror Phase 4 (full pattern engine)
```
**Replace with:**
```
### ❌ Not started (Sprint 15)

- Private benchmarking (aggregate anonymized dimension scores)
- Decision Graph (requires 20 sessions per user)
- Hybrid semantic + ontology structural retrieval
- Mirror Phase 4 (full pattern engine)
```

---

## CHANGE 8 — Key files block: mark OutcomeTracker and outcome/route as updated

**Remove:**
```
  OutcomeTracker.tsx  — outcome_quality  retrospective_confidence fields pending Sprint 13
```
**Replace with:**
```
  OutcomeTracker.tsx  — ✅ outcome_quality, retrospective_confidence, calibration display live (Sprint 14)
```

**Remove:**
```
  outcome/route.ts          — saves outcomes (calibration fields in DB, UI pending Sprint 13)
```
**Replace with:**
```
  outcome/route.ts          — ✅ saves all calibration fields, computes calibration_delta (Sprint 14)
```

---

*End of patch. Save output as HANDOVER_DOC_v13.md.*
