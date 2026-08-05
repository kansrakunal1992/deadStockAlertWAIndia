# Quorum — Mirror Sprint 7b: Test Checklist
> **Sprint:** 7b — Bias Fingerprint + Unlock Code UI
> **Prerequisite:** Sprint 7a test checklist fully passed

---

## Pre-test: Env Var

Confirm `MIRROR_UNLOCK_TOKEN` is set in Railway. If not:
```bash
openssl rand -hex 32
# Copy output → Railway → Variables → MIRROR_UNLOCK_TOKEN
```

---

## Phase 1 — Unlock Code UI (PaywallGate)

### 1.1 Code entry appears on demand

1. Sign in as a user with ≥5 sessions, no `mirror_access` row
2. Navigate to `/mirror` → paywall state renders
3. **Expected:** "Have an unlock code? Enter it here →" button visible below CTA card
4. Click it → **Expected:** Input field + "Unlock →" button expand inline (no page reload)

### 1.2 Wrong code

1. Enter any random string (e.g. `wrongcode123`) → click "Unlock →"
2. **Expected:**
   - Button shows "Checking…" briefly
   - Error message: "That code isn't right. Check the message we sent you."
   - Input border turns red
   - User stays on paywall — no navigation

### 1.3 Correct code

1. Enter the actual `MIRROR_UNLOCK_TOKEN` value → click "Unlock →"
2. **Expected:**
   - Button shows "Checking…"
   - Page reloads status (loading spinner briefly)
   - Page transitions to **unlocked view** — no hard refresh, in-place state update
   - "● Active" badge appears in top nav
   - Bias Fingerprint section renders (not a placeholder)

### 1.4 Already unlocked (idempotent)

```sql
-- Manually insert a mirror_access row for a test user
insert into mirror_access (user_id, access_type)
values ('[Test User UUID]', 'granted');
```

1. Navigate to `/mirror` as that user
2. Enter the unlock code again
3. **Expected:** Success (no error) — idempotent; `mirror_access` still has one row

### 1.5 Code entry without auth

1. Open `/mirror` in incognito (no auth)
2. Auth gate renders — no unlock code input visible
3. **Expected:** No unlock UI at this state — correct, auth is required first

---

## Phase 2 — `/api/mirror/unlock` Route

```bash
# No auth → 401
curl -X POST https://[railway-url]/api/mirror/unlock \
  -H "Content-Type: application/json" \
  -d '{"code":"anycode"}'
# Expected: 401

# Wrong code with valid Bearer token
curl -X POST https://[railway-url]/api/mirror/unlock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [valid-token]" \
  -d '{"code":"wrongcode"}'
# Expected: 403 { "error": "Invalid unlock code" }

# Correct code
curl -X POST https://[railway-url]/api/mirror/unlock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [valid-token]" \
  -d '{"code":"[actual MIRROR_UNLOCK_TOKEN]"}'
# Expected: 200 { "status": "ok", "grantedAt": "...", "message": "Mirror unlocked" }

# Verify DB
select * from mirror_access where user_id = '[test user uuid]';
# Expected: 1 row, access_type = 'paid', payment_ref starts with 'code:'
```

---

## Phase 3 — Bias Fingerprint (Unlocked View)

Test requires: user with `mirror_access` AND rows in `bias_library` for that `user_id`.

```sql
-- Check if bias rows exist for your test user
select bias_parameter, detection_count, confidence_weight
from bias_library
where user_id = '[test user uuid]'
order by detection_count desc;
```

### 3.1 Loading skeleton

1. Navigate to `/mirror` as unlocked user
2. **Expected:** Skeleton pulse renders immediately in Bias Fingerprint section
   - Narrative skeleton: 4 faded bars
   - Tile skeletons: 3 cards with pulsing bars
   - Skeleton disappears once fetch completes (~3–6s)

### 3.2 No bias data

If `bias_library` has no rows for this user:
- **Expected:** "No patterns detected yet. Complete the Examiner phase…" copy shown
- No skeleton, no tiles, no error

### 3.3 Only forming patterns (detection_count = 1)

If user has only single-detection rows:
- **Expected:** Narrative = null → "Profile forming" placeholder shown
- Forming tiles render: label visible, bars blurred, "Pattern forming" footer text
- No confirmed tile grid shown

### 3.4 Confirmed patterns (detection_count ≥ 2)

If user has rows with detection_count ≥ 2:
- **Expected:**
  - Narrative block renders with italic quoted text (~100–140 words)
  - Confirmed tile grid renders (auto-fill, min 220px columns)
  - Each tile: bias label in uppercase, interpretation text, confidence dots filled
  - Footer: "N of your sessions"

### 3.5 Conditional pattern (detection_count ≥ 3)

If user has a row with detection_count ≥ 3:
- **Expected:** That tile shows a gold activation summary box
  - "Activates when: [condition] + [condition]"
  - Three confidence dots all filled (●●●)

### 3.6 Mixed confirmed + forming

If user has both:
- **Expected:**
  - Confirmed tiles render first in grid
  - "N patterns forming — one more session to confirm" italic text separator
  - Forming tiles render below in their own grid row

### 3.7 Narrative tone check

Read the generated narrative. It must:
- [ ] Be second person ("You…")
- [ ] Be 100–145 words (count manually if unsure)
- [ ] Not contain the words "bias", "cognitive bias", "AI", "Quorum", "algorithm"
- [ ] Contain at least one conditional: "particularly when…" or "especially when…"
- [ ] Final sentence creates forward tension (question or observation, not compliment)
- [ ] Feel specific to this user's actual decisions — not generic

If it reads like a generic personality profile, the prompt needs tuning.

### 3.8 Generation timestamp

- **Expected:** Bottom-right of fingerprint section: "Analysis from N sessions · [date]"
- Date format: "1 May" style (Indian locale)

### 3.9 Error state

1. Temporarily break the fingerprint route (e.g. add a `throw new Error()` at line 1, deploy, test, revert)
2. **Expected:** "Pattern analysis temporarily unavailable. Your data is intact — try refreshing in a moment."
3. Timeline section above must NOT be broken — error boundary is component-level

---

## Phase 4 — `/api/mirror/fingerprint` Route

```bash
# No auth → 401
curl https://[railway-url]/api/mirror/fingerprint
# Expected: 401

# Auth but no mirror_access → 403
curl -H "Authorization: Bearer [token-no-access]" \
  https://[railway-url]/api/mirror/fingerprint
# Expected: 403 { "error": "Mirror access required" }

# Auth + mirror_access → 200
curl -H "Authorization: Bearer [token-with-access]" \
  https://[railway-url]/api/mirror/fingerprint
# Expected: 200 {
#   narrative: "..." or null,
#   confirmedTiles: [...],
#   formingTiles: [...],
#   sessionCount: N,
#   generatedAt: "..."
# }
```

---

## Phase 5 — Tile component states

### 5.1 Forming tile visual

- Bias label: uppercase, muted (`var(--text-4)`)
- Lock icon: visible top-right
- Content: 3 blurred bars, `filter: blur(4px)`
- Confidence dots: 1 filled (●○○)
- Footer: "Pattern forming" italic

### 5.2 Confirmed tile (2 detections)

- Bias label: uppercase, brighter (`var(--text-3)`)
- No lock icon
- Interpretation: readable prose, 25–35 words
- Confidence dots: 2 filled (●●○)
- Footer: "2 of your sessions"
- No activation summary box (only at 3+)
- Hover: border lightens to `var(--border-hi)`

### 5.3 Confirmed tile (3+ detections)

- As above, plus:
- Gold activation summary box visible
- "Activates when: [condition] + [condition]"
- Confidence dots: 3 filled (●●●)

---

## Phase 6 — Paywall teaser tiles (no mirror_access)

Users in paywall state see teaser tiles from `teaserBiases` in status response.

- [ ] Teaser tiles render with correct bias labels (real detected labels, not placeholders)
- [ ] Content is blurred — cannot be read
- [ ] Lock icon visible on each tile
- [ ] Entering correct unlock code → tiles disappear, full fingerprint renders

---

## Phase 7 — Regression

```
□ Sprint 7a: All gate states still work correctly after 7b changes
□ Timeline renders in both paywall and unlocked views
□ Auth gate still works for unauthenticated users
□ Threshold gate still works for users with < 5 sessions
□ /api/mirror/status returns correct gateState
□ Home page unaffected
□ Council / Examiner / Synthesis flow unaffected
□ Record page unaffected
```

---

## Pass Criteria

- Phase 1 (unlock code UI): all 5 tests pass
- Phase 3 (fingerprint): narrative tone check passes + all visual states correct
- Phase 6 (paywall teasers): real bias labels shown
- Phase 7 (regression): fully clean

Failures in Phase 3.7 (narrative tone) do not block Sprint 7c — note them and tune the prompt in `lib/personas.ts` iteratively.
