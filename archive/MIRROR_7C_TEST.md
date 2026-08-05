# Quorum — Mirror Sprint 7c: Test Checklist
> **Sprint:** 7c — Decision Independence Score
> **Prerequisite:** Sprint 7b test checklist passed; `independence_score_log` table exists

---

## Pre-test: Verify table exists

```sql
select count(*) from independence_score_log;
-- Expected: returns 0 (empty). If error: run sprint7a_mirror_schema.sql first.
```

---

## Phase 1 — Score Calculation (trigger + storage)

### 1.1 Score fires after Examiner POST

1. Run a full session as an authenticated user (user_id must be set)
2. Complete the Examiner phase — answer all 3 questions (don't skip)
3. Submit Examiner answers
4. Wait 5–10 seconds (fire-and-forget, runs in background)
5. Check Railway logs: look for `[Examiner] Independence scoring trigger`
6. Check DB:

```sql
select score, delta, calculated_at, signals
from independence_score_log
where user_id = '[your user uuid]'
order by calculated_at desc limit 5;
```

**Expected:**
- New row appears within ~10 seconds of Examiner submission
- `score` between 0 and 100
- `delta` is null if this is the first scored session
- `signals` jsonb contains `{ sessionCount, sessionScores, band }`

### 1.2 Score does not fire for unauthenticated sessions

1. Run a session without signing in (no user_id on session)
2. Submit Examiner answers
3. Check DB: no new row in `independence_score_log`
4. Railway logs: `[independence] no_user_id` — confirms graceful skip

### 1.3 Score does not fire when Examiner is skipped

1. Submit Examiner with `skipped: true` (click "Skip" in the UI)
2. Check DB: score may still fire (trigger fires regardless) but session scores 0
   - This is correct — skipped sessions anchor the baseline at low end
   - Score still updates, just with 0 for this session

### 1.4 Delta is correct

After 2+ scored sessions for the same user:

```sql
select score, delta, calculated_at
from independence_score_log
where user_id = '[uuid]'
order by calculated_at asc;
```

**Expected:**
- First row: delta = null
- Second row onwards: delta = current score − score from up to 5 sessions back
- Delta is positive if response quality improved; negative if declined

### 1.5 Idempotent upsert (re-trigger same session)

1. Manually call the independence route twice for the same session:

```bash
curl -X POST https://[railway-url]/api/mirror/independence \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"[session-uuid]"}'
```

**Expected:** DB still has only one row per session (upserts on `session_id`)

---

## Phase 2 — GET Route

### 2.1 Auth required

```bash
curl https://[railway-url]/api/mirror/independence
# Expected: 401
```

### 2.2 Mirror access required

```bash
# User with auth but no mirror_access row
curl -H "Authorization: Bearer [token-no-access]" \
  https://[railway-url]/api/mirror/independence
# Expected: 403 { "error": "Mirror access required" }
```

### 2.3 No sessions scored yet

```bash
# User with mirror_access but no independence_score_log rows
curl -H "Authorization: Bearer [token-with-access]" \
  https://[railway-url]/api/mirror/independence
# Expected: 200 { score: null, delta: null, band: null, ... }
```

### 2.4 Score exists

```bash
curl -H "Authorization: Bearer [token-with-scored-sessions]" \
  https://[railway-url]/api/mirror/independence
# Expected: 200 {
#   score: 47,
#   delta: 12,
#   band: "Frameworks starting to appear",
#   interpretation: "Some signals of structured thinking...",
#   sessionCount: 6,
#   calculatedAt: "2026-05-02T..."
# }
```

### 2.5 Cross-user isolation

- Authenticate as User A → verify score returned matches User A's sessions only
- Authenticate as User B → different score, different session count

---

## Phase 3 — IndependenceScore Component

### 3.1 Loading skeleton

1. Navigate to Mirror as unlocked user
2. **Expected:** Skeleton pulse renders in Decision Independence section
   - 3 rows of pulsing bars visible during ~1–2s fetch
   - Disappears cleanly once data loads

### 3.2 Empty state (no score yet)

1. Test with unlocked user who has never completed Examiner:
2. **Expected:**
   - Explanation copy: "Your independence score starts calculating once you've completed the Examiner phase..."
   - "Run a decision →" gold link visible
   - No score card rendered

### 3.3 Score renders

1. Test with user who has scored sessions:
2. **Expected:**
   - Large centered score number (e.g. "47") in gold
   - "/100" in smaller muted text beside it
   - Delta row: "↑ +12 from previous sessions" in green (if positive)
   - Band label in gold pill: e.g. "FRAMEWORKS STARTING TO APPEAR"
   - Interpretation sentence in italic
   - "Based on N sessions · [date]" footer
   - Explanation paragraph below the card

### 3.4 Delta states

Test across different scenarios:

| Delta | Expected display |
|---|---|
| null (first session) | "First session — baseline set" in muted italic |
| 0 | "→ No change from previous sessions" in muted |
| +12 | "↑ +12 from previous sessions" in green |
| -8 | "↓ -8 from previous sessions" in muted |

### 3.5 Score bands

Verify each band maps to correct copy:

| Score | Band label | First words of interpretation |
|---|---|---|
| 0–24 | Using Quorum as a report generator | "Your reasoning in the Examiner phase..." |
| 25–49 | Frameworks starting to appear | "Some signals of structured thinking..." |
| 50–74 | Reasoning visibly shifting | "Quorum's approach is starting to show up..." |
| 75–100 | Judgment compounding | "You're applying structured thinking..." |

### 3.6 Error state

1. Temporarily break the route (test locally or with a bad env var)
2. **Expected:** "Score temporarily unavailable. Your data is intact — try refreshing."
3. Timeline + Fingerprint above must be unaffected

### 3.7 Mobile layout

1. View at 390px viewport
2. **Expected:**
   - Score number centered, readable
   - Band pill not clipped
   - Explanation text readable (not overflowing)

---

## Phase 4 — Signal Quality Check

This is a qualitative test of whether the scoring logic is detecting the right things.

### 4.1 High-signal Examiner response

Run a session and give responses that include multiple signals:

> "My worst case here is that my co-founder walks away after 6 months — we've never had this conversation explicitly. That timeline feels arbitrary to me, actually — who decided March was the deadline? I want to separate what makes financial sense from what I actually want to build. If I look back in two years and this went wrong, it'll be because I never pushed back on the assumptions."

**Expected signals fired:**
- `worst_case_framing` ✅ ("worst case")
- `stakeholder_surfacing` ✅ ("my co-founder")
- `deadline_questioning` ✅ ("who decided March was the deadline")
- `values_outcome_separation` ✅ ("separate what makes financial sense from what I actually want")
- `premortem_thinking` ✅ ("if I look back in two years")
- `response_depth` ✅ (>80 words)

Score for this response: should be 60–75+ / 100

### 4.2 Low-signal Examiner response

Run a session and give minimal responses:

> "I'm not sure. Maybe the timing. I'll figure it out."

**Expected signals fired:**
- `answered_not_skipped` ✅ (barely)
- Everything else: ✗

Score for this response: should be 8–10 / 100

### 4.3 Score increases over sessions

After running 2–3 sessions with progressively better responses, confirm:
- `score` increases session over session
- `delta` is positive on the most recent entry

---

## Phase 5 — Regression

```
□ Examiner POST still saves responses correctly
□ Bias scoring still fires after Examiner (check bias_library rows)
□ Structural matching still fires (check structural_matches rows)
□ Mirror Timeline unaffected
□ Bias Fingerprint unaffected
□ Home page unaffected
□ Council / Synthesis flow unaffected
□ Record page loads correctly
```

---

## Pass Criteria

- Phase 1.1 (trigger + DB row): must pass before anything else
- Phase 2.4 (GET returns correct data): must pass
- Phase 3.3 (score renders): must pass
- Phase 3.5 (band copy correct): must pass
- Phase 4 (signal quality): qualitative — note results, doesn't block
- Phase 5 (regression): must fully pass

---

## Known Limitations (by design)

- Score only calculated for authenticated users (user_id required for cross-session accumulation)
- Sessions run before auth (email-only or anonymous) do not contribute to score
- Score recalculates from ALL sessions each time (not incremental) — acceptable at current session volumes; revisit at 50+ sessions per user
- Signal detection is keyword-based, not semantic — some genuine reasoning may not be detected; some surface-level use of trigger words may score higher than warranted. This is acceptable at MVP; refine with real usage data.
