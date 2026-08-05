# Quorum — Mirror Sprint 7a: Test Checklist
> **Sprint:** 7a — Foundation (Schema + API + Mirror Page + Timeline)  
> **Run after:** SQL migration deployed, code deployed to Railway

---

## Pre-test: SQL Migration

Run `sprint7a_mirror_schema.sql` in Supabase SQL Editor, then verify:

```sql
-- Both should return 0 (empty new tables)
select count(*) from mirror_access;
select count(*) from independence_score_log;

-- Both tables should appear
select table_name from information_schema.tables
  where table_schema = 'public'
  and table_name in ('mirror_access', 'independence_score_log');
```

Expected: 2 rows returned. If either table is missing, re-run the migration.

---

## Pre-test: Setup

You'll need **two test scenarios** running simultaneously or sequentially:
- **User A:** Authenticated, ≥5 sessions logged (for paywall + timeline tests)
- **User B:** Authenticated, 1–4 sessions (for threshold gate test)

Plus test in anonymous / unauthenticated state.

---

## Phase 1 — Gate States

### 1.1 Anonymous (not signed in)

1. Open a private/incognito browser window
2. Navigate to `/mirror`
3. **Expected:** Auth gate renders
   - Mirror icon in circle
   - Heading: "Your behavioral mirror"
   - Email input field + "Send link →" button visible
   - No timeline, no tiles, no error
4. Enter an invalid email → click send
   - **Expected:** "Enter a valid email address." error shown
5. Enter a valid email → click send
   - **Expected:** Success state: "Check your email" with entered address shown

### 1.2 Authenticated — below threshold (User B, 1–4 sessions)

1. Sign in as User B
2. Navigate to `/mirror`
3. **Expected:** Threshold gate renders
   - Mirror icon with lock overlay
   - Heading: "Mirror activates at 5 decisions"
   - Correct session count shown (e.g., "3 more decisions to unlock…")
   - Segment bar showing N of 5 segments filled
   - "What Mirror reveals" bullet list present
   - "Run another decision →" button → navigates to `/`
4. Verify session count matches `select count(*) from sessions where user_id = '[User B UUID]'`

### 1.3 Authenticated — threshold met, no mirror_access (User A)

1. Sign in as User A (≥5 sessions, no row in mirror_access)
2. Navigate to `/mirror`
3. **Expected:** Paywall gate renders
   - Page header: "Your Decision Mirror" + subheading about bias fingerprint locked
   - **Decision Timeline visible and populated** (this is free tier content)
   - "Bias Fingerprint" section heading with "Locked" badge
   - Teaser tiles visible IF `bias_library` has rows for User A:
     - Each tile shows bias label (e.g., "FOMO / Manufactured Urgency") in uppercase
     - Content below label is blurred (filter: blur visible)
     - Lock icon in tile header
     - 3 confidence dots (first dot filled, others hollow)
   - If no bias rows yet: "Bias patterns are being compiled…" message shown (graceful)
   - "Unlock Decision Profile" CTA card at bottom
   - ₹4,999 price shown
   - 3 bullet points of what's included
   - Contact-to-unlock instruction visible

### 1.4 Authenticated — mirror_access exists (User A after manual grant)

1. Insert a mirror_access row for User A:
   ```sql
   insert into mirror_access (user_id, access_type)
   values ('[User A UUID]', 'granted');
   ```
2. Reload `/mirror`
3. **Expected:** Unlocked view renders
   - Page header: "Your Decision Mirror" + "Your behavioral patterns across all decisions."
   - Nav badge: "● Active" in green
   - Decision Timeline visible and populated
   - "Bias Fingerprint" section shows placeholder: "Analyzing your patterns…" (Sprint 7b populates this)
   - "Decision Independence" section shows placeholder text (Sprint 7c populates this)
   - No paywall CTA visible

---

## Phase 2 — Decision Timeline

Run with User A (≥5 sessions, paywall or unlocked state).

### 2.1 Timeline rendering

1. Navigate to `/mirror` as User A
2. **Expected:** Timeline renders with one row per session
   - Rows in reverse chronological order (newest at top)
   - Each row shows:
     - Relative date ("3d ago", "2w ago" etc.)
     - Decision text truncated to ~110 chars with ellipsis if longer
     - Decision type chip if ontology is complete (e.g., "COMMITMENT" in gold)
     - Register mode label if set ("CHALLENGE" or "CLARIFY")
   - Bottom row section shows:
     - Reversibility dot (red/amber/green) for sessions with ontology
     - Dominant emotion in italic if present
     - Outcome circle: hollow = pending, green filled + checkmark = logged
     - Right-pointing arrow

### 2.2 Pattern stripe

1. Ensure User A has ≥2 sessions with the same `decision_type_primary`
2. **Expected:** A 3px colored stripe appears on the left edge of those rows
   - Same color for same decision type (gold for commitment, blue for allocation, etc.)
   - Sessions with unique decision types have no stripe
   - Sessions without ontology have no stripe

3. **Expected:** Legend at bottom shows reversibility dot meanings
4. If repeated types exist: "Colored stripe = recurring decision type" note visible

### 2.3 Click navigation

1. Click any session row in the Timeline
2. **Expected:** Navigates to `/record/[session_id]`
3. Verify the correct session record loads

### 2.4 Hover state

1. Hover over any timeline row
2. **Expected:** Background darkens slightly (bg-card-alt), border lightens (border-hi)
3. Smooth transition (not a hard jump)

### 2.5 Sessions without ontology

1. If any sessions have `tagger_status != 'complete'` (e.g. tagger failed):
2. **Expected:** Row still renders — no decision type chip, no reversibility dot, no emotion
3. No JavaScript error in console

---

## Phase 3 — API Routes Direct

### 3.1 `/api/mirror/status`

```bash
# Unauthenticated
curl https://[railway-url]/api/mirror/status
# Expected: { authenticated: false, gateState: 'auth', sessionCount: 0, ... }

# Authenticated (get token from browser DevTools → Application → Local Storage → supabase token)
curl -H "Authorization: Bearer [token]" https://[railway-url]/api/mirror/status
# Expected: { authenticated: true, gateState: 'threshold'|'paywall'|'unlocked', sessionCount: N, ... }
```

### 3.2 `/api/mirror/timeline`

```bash
# Unauthenticated — must return 401
curl https://[railway-url]/api/mirror/timeline
# Expected: 401 { error: 'Unauthorized' }

# Authenticated
curl -H "Authorization: Bearer [token]" https://[railway-url]/api/mirror/timeline
# Expected: { sessions: [ { id, decision_text, created_at, decision_type_primary, ... } ] }
# Verify: only sessions for the authenticated user returned (no cross-user leak)
```

### 3.3 Cross-user isolation check

```sql
-- Get two different user IDs from sessions table
select distinct user_id from sessions limit 5;
```

1. Authenticate as User A
2. Call `/api/mirror/timeline` with User A's token
3. Verify ALL returned session IDs belong to User A:
   ```sql
   select user_id from sessions where id in ('[returned IDs]');
   -- All user_id values should match User A's UUID
   ```

---

## Phase 4 — MemoryEngineStatus (home page)

### 4.1 Mirror approach hint

1. Log in as a user with 4 sessions (one below threshold)
2. Go to home page `/`
3. **Expected:** MemoryEngineStatus shows "1 more session to activate Pattern Memory + Mirror" (or similar)
4. No duplicate `</span>` error in browser console

### 4.2 Mirror unlock link at 5+ sessions

1. With a user who has ≥5 sessions
2. **Expected:** "View Mirror →" link appears next to status text
3. Click it → navigates to `/mirror`
4. Verify the link is green (#4ade80) and readable

### 4.3 Anonymous user view

1. Clear localStorage, visit home
2. Run one session without entering email
3. **Expected:** MemoryEngineStatus shows anonymous CTA (email prompt), not progress bar

---

## Phase 5 — Edge Cases

### 5.1 Exactly 5 sessions

1. Test with a user who has exactly 5 sessions (threshold boundary)
2. **Expected:** NOT threshold gate — should be paywall state
3. Verify: session count ≥ 5 correctly triggers paywall (not "4 more decisions" etc.)

### 5.2 Expired mirror_access (trial)

```sql
insert into mirror_access (user_id, access_type, expires_at)
values ('[User UUID]', 'trial', now() - interval '1 day');
```

> Note: Sprint 7a status route does not yet check expires_at — this is a Sprint 7c concern.
> For now, any mirror_access row = unlocked. Document this for Sprint 7c.

### 5.3 Timeline with 100+ sessions

1. If a user has many sessions, verify:
   - Timeline renders without lag
   - No more than 100 sessions returned (limit is set server-side)

### 5.4 Mobile viewport (390px)

1. Open `/mirror` on mobile or DevTools 390px
2. **Expected:**
   - Auth gate: input + button usable, not clipped
   - Threshold gate: progress bar fits, text readable
   - Paywall: timeline rows single-column, teaser tile grid collapses
   - Unlocked: sections stack cleanly

---

## Phase 6 — Regression Check

Confirm nothing broken from pre-existing sprints:

```
□ Home page loads correctly
□ New decision submission creates session (POST /api/session)
□ Persona responses stream correctly
□ Examiner panel fires after submission
□ Synthesis renders after Examiner
□ /record/[id] page loads correctly
□ Magic link auth flow still works end-to-end
□ History (past sessions on home page) still loads
□ MemoryEngineStatus segment bar still animates on home page
```

---

## Pass Criteria

All of Phase 1–4 must pass before starting Sprint 7b.

Phase 5 edge cases: document any failures but don't block Sprint 7b unless they're crashes.

Phase 6 regression: must fully pass.

---

## Known Limitations (Sprint 7a — by design)

- `expires_at` on `mirror_access` not yet enforced (Sprint 7c)
- Bias Fingerprint section in unlocked view shows placeholder only (Sprint 7b)
- Independence Score section shows placeholder only (Sprint 7c)
- Behavioral alerts not yet implemented (Sprint 7d)
- Payment flow is manual (contact-to-unlock); Razorpay integration deferred
