# Quorum — Diagnosis, Patch Plan & Testing Checklist
> Generated: April 30, 2026 | Covers Sprint 5 traceability + Sprint 6 identity continuity gaps

---

## 1. DIAGNOSIS

### What is working ✅
- Ontology tagging — runs async, completes, tagger_status = complete
- Examiner phase — questions generate, answers save, examiner POST fires
- Bias scoring — triggered server-side from /api/examiner POST
- Bias accumulation — detection_count and confidence_weight increment correctly across sessions keyed to same user_email
- Structural retrieval — scores past sessions against current, finds matches, context_block is rich and correct, structural_matches table is written
- Session linking at sessions table level — link_sessions_to_user RPC correctly stamps user_id + user_email on sessions after auth
- Auth flow — PKCE exchange, magic link, redirect, getSession all work

### What is partially working ⚠️
- **Identity continuity** — works for the email lane (sessions 2–6) but fails to carry user_id on new post-auth sessions. The session creation route accepts user_email and device_id from the client but never receives user_id, because page.tsx doesn't send it.
- **Bias retro-linking** — the link-sessions route correctly upgrades bias_library rows where user_email matches. But pre-auth device_id-only rows (like Session 1) are never touched because: (a) the auth callback doesn't pass device_id to the link-sessions API, and (b) the link-sessions route has no logic to upgrade device_id-keyed rows.

### What is broken ❌
- **structural_scores is always empty** — root cause is the `structural_scores` table likely does not have the required unique constraint `(session_id_a, session_id_b)` needed for the upsert conflict clause, OR the table doesn't exist yet (not included in the sprint SQL files in the deployed codebase). The upsert in the structural-match route silently eats the error with no logging — no `await supabase...upsert` error check — so it fails invisibly.

### Root Cause vs Symptom
| Symptom | Root Cause |
|---|---|
| structural_scores empty | Table missing or missing unique constraint; no error logging on upsert |
| user_id null on sessions 2–6 | Session creation body never includes user_id; page.tsx doesn't pass it |
| Session 1 bias rows not retro-linked | Auth callback never sends device_id to link-sessions; link-sessions never queries by device_id |
| New bias rows use email not user_id | Follows from user_id being null on sessions — bias scorer reads session.user_id which is null |

---

## 2. FIX REQUIREMENTS / PATCH PLAN

### Fix A — structural_scores: create table + add error logging
**File:** `supabase/sprint5b_structural_scores_fix.sql` (new, run once in Supabase SQL editor)
**File:** `app/api/structural-match/route.ts` (add error check on upsert)

The structural_scores upsert uses `onConflict: 'session_id_a,session_id_b'` — this requires a UNIQUE constraint on that composite key. The table either doesn't exist or was created without this constraint. The fix creates the table with the constraint and adds error logging.

### Fix B — user_id on new post-auth sessions
**File:** `app/page.tsx` — handleSubmit must read auth session and pass user_id
**File:** `app/api/session/route.ts` — must accept user_id from body and insert it

This is a two-line client change + one-line server change. The user is already authenticated at this point (supabase.auth.getSession() is already called in the history loader in the same component).

### Fix C — retro-link device_id bias rows after auth
**File:** `app/auth/callback/page.tsx` — pass device_id to link-sessions API call
**File:** `app/api/auth/link-sessions/route.ts` — add device_id retro-link query for bias_library

After auth, the link-sessions route already upgrades bias rows keyed to user_email. It must also upgrade rows keyed to device_id (where user_email IS NULL AND user_id IS NULL), promoting them to the user_id lane.

---

## 3. EXACT FILE PATCHES

### PATCH A1 — SQL migration for structural_scores
Run this in Supabase SQL Editor once:

```sql
-- supabase/sprint5b_structural_scores_fix.sql
-- Creates structural_scores table if missing, with correct unique constraint.
-- Safe to run even if table already exists (uses IF NOT EXISTS).

create table if not exists structural_scores (
  id                   uuid primary key default uuid_generate_v4(),
  session_id_a         uuid not null references sessions on delete cascade,
  session_id_b         uuid not null references sessions on delete cascade,
  total_score          int not null,
  decision_type_score  int,
  register_score       int,
  stakes_score         int,
  counterparty_score   int,
  time_pressure_score  int,
  threshold_met        boolean default false,
  computed_at          timestamptz default now(),

  constraint structural_scores_pair_unique unique (session_id_a, session_id_b)
);

create index if not exists idx_structural_scores_session_a on structural_scores(session_id_a);
create index if not exists idx_structural_scores_session_b on structural_scores(session_id_b);

alter table structural_scores enable row level security;
create policy "Structural scores accessible via service role"
  on structural_scores for all using (true);

-- Also ensure structural_matches has user_id column (may be missing if sprint6 ran after sprint5)
alter table structural_matches add column if not exists user_id uuid references auth.users on delete set null;
create index if not exists idx_structural_matches_user_id on structural_matches(user_id);
```

### PATCH A2 — structural-match route: add error logging
**File:** `app/api/structural-match/route.ts`

In Step 8, replace the silent upsert with an error-checked version:

```typescript
// ── 8. Write pairwise scores into structural_scores ─────────
if (pastSnapshots.length > 0) {
  const scoreRows = pastSnapshots.map(past => {
    const breakdown = scoreStructuralSimilarity(currentSnapshot, past)
    return {
      session_id_a:         sessionId,
      session_id_b:         past.session_id,
      total_score:          breakdown.total,
      decision_type_score:  breakdown.decision_type,
      register_score:       breakdown.register,
      stakes_score:         breakdown.stakes,
      counterparty_score:   breakdown.counterparty,
      time_pressure_score:  breakdown.time_pressure,
      threshold_met:        breakdown.total >= 45,
      computed_at:          new Date().toISOString(),
    }
  })

  for (let i = 0; i < scoreRows.length; i += 20) {
    const { error: scoresErr } = await supabase
      .from('structural_scores')
      .upsert(scoreRows.slice(i, i + 20), { onConflict: 'session_id_a,session_id_b' })

    if (scoresErr) {
      // Log clearly — this table likely doesn't exist or is missing its unique constraint
      console.error('[StructuralMatch] structural_scores upsert failed:', scoresErr.message, scoresErr.code)
    } else {
      console.log(`[StructuralMatch] Wrote ${scoreRows.slice(i, i + 20).length} score rows to structural_scores`)
    }
  }
}
```

### PATCH B1 — page.tsx: pass user_id when creating session
**File:** `app/page.tsx`

In `handleSubmit`, after `setLoading(true)`, add auth session read and include user_id in fetch body.

Replace the fetch call block in handleSubmit:

```typescript
// BEFORE (around line 121):
const res = await fetch('/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    decision_text: decision.trim(),
    context_text: context.trim() || null,
    register_mode: registerMode,
    user_email: userEmail ?? null,
    device_id: getOrCreateDeviceId()
  }),
})

// AFTER:
// Get auth user_id if available (may already be in cache from history load)
let resolvedUserId: string | null = null
try {
  const { createClient: getClient } = await import('@/lib/supabase')
  const sb = getClient()
  const { data: { session: authSession } } = await sb.auth.getSession()
  resolvedUserId = authSession?.user?.id ?? null
} catch { /* non-blocking */ }

const res = await fetch('/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    decision_text: decision.trim(),
    context_text: context.trim() || null,
    register_mode: registerMode,
    user_email: userEmail ?? null,
    device_id: getOrCreateDeviceId(),
    user_id: resolvedUserId,   // ← NEW: stamps user_id on session at creation
  }),
})
```

### PATCH B2 — session/route.ts: accept and insert user_id
**File:** `app/api/session/route.ts`

```typescript
// BEFORE:
const { decision_text, context_text, register_mode, user_email, device_id } = await req.json()

// AFTER:
const { decision_text, context_text, register_mode, user_email, device_id, user_id } = await req.json()

// And in the insert:
// BEFORE:
const { data, error } = await supabase
  .from('sessions')
  .insert({
    decision_text: decision_text.trim(),
    context_text: context_text?.trim() || null,
    register_mode: register_mode ?? 'analytical',
    status: 'active',
    user_email: user_email?.trim().toLowerCase() || null,
    device_id: device_id || null,
  })

// AFTER:
const { data, error } = await supabase
  .from('sessions')
  .insert({
    decision_text: decision_text.trim(),
    context_text: context_text?.trim() || null,
    register_mode: register_mode ?? 'analytical',
    status: 'active',
    user_email: user_email?.trim().toLowerCase() || null,
    device_id: device_id || null,
    user_id: user_id || null,   // ← NEW: inserted directly if passed
  })
```

### PATCH C1 — auth/callback: pass device_id to link-sessions
**File:** `app/auth/callback/page.tsx`

```typescript
// BEFORE (Step 3 in CallbackHandler):
const storedIds = getStoredSessionIds()
if (storedIds.length > 0) {
  await fetch('/api/auth/link-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionIds: storedIds,
      userId:     user.id,
      userEmail:  user.email,
    }),
  })
}

// AFTER:
import { getStoredSessionIds, storeUserEmail, getStoredDeviceId } from '@/lib/storage'
// (add getStoredDeviceId to the existing import)

const storedIds = getStoredSessionIds()
const deviceId  = getStoredDeviceId()   // ← NEW

// Always call link-sessions after auth (even if no localStorage session IDs)
// to ensure device_id bias rows are retro-linked
await fetch('/api/auth/link-sessions', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionIds: storedIds,
    userId:     user.id,
    userEmail:  user.email,
    deviceId:   deviceId,   // ← NEW
  }),
})
// (Remove the `if (storedIds.length > 0)` guard so the retro-link fires regardless)
```

### PATCH C2 — link-sessions/route.ts: retro-link device_id bias rows
**File:** `app/api/auth/link-sessions/route.ts`

```typescript
// BEFORE signature:
const { sessionIds, userId, userEmail } = await req.json() as {
  sessionIds?: string[]
  userId?: string
  userEmail?: string
}

// AFTER:
const { sessionIds, userId, userEmail, deviceId } = await req.json() as {
  sessionIds?: string[]
  userId?: string
  userEmail?: string
  deviceId?: string   // ← NEW
}

// BEFORE (the existing bias_library update for email rows):
if (userEmail) {
  await supabase
    .from('bias_library')
    .update({ user_id: userId })
    .eq('user_email', userEmail)
    .is('user_id', null)
}

// AFTER (keep the email update, ADD device_id retro-link below it):
if (userEmail) {
  const { error: emailBiasErr } = await supabase
    .from('bias_library')
    .update({ user_id: userId, user_email: userEmail })
    .eq('user_email', userEmail)
    .is('user_id', null)

  if (emailBiasErr) console.warn('[LinkSessions] Email bias retro-link failed:', emailBiasErr)
}

// NEW: Also upgrade device_id-keyed bias rows that have no email/user_id
// These are rows from anonymous sessions before the user ever entered their email.
if (deviceId && userId) {
  const { error: deviceBiasErr } = await supabase
    .from('bias_library')
    .update({
      user_id:    userId,
      user_email: userEmail ?? null,
    })
    .eq('device_id', deviceId)
    .is('user_email', null)
    .is('user_id', null)

  if (deviceBiasErr) {
    console.warn('[LinkSessions] Device bias retro-link failed:', deviceBiasErr)
  } else {
    console.log(`[LinkSessions] Retro-linked device_id bias rows for device ${deviceId} to user ${userId}`)
  }
}
```

---

## 4. ONE-TIME CLEAN-UP PLAN

### Tables to TRUNCATE (data only, keep schema)
Run in Supabase SQL Editor:

```sql
-- Clear all prototype test data. Schema and constraints remain intact.
-- Run in this exact order (FK dependencies).

truncate table structural_scores   restart identity cascade;
truncate table structural_matches  restart identity cascade;
truncate table bias_library        restart identity cascade;
truncate table examiner_responses  restart identity cascade;
truncate table sessions_ontology   restart identity cascade;
truncate table messages            restart identity cascade;
truncate table outcomes            restart identity cascade;
truncate table sessions            restart identity cascade;

-- Optionally clear user_preferences if created during testing:
truncate table user_preferences    restart identity cascade;

-- Do NOT touch auth.users — Supabase manages this separately.
-- The auth user (h16144@astra.xlri.ac.in) can stay; their sessions are cleared above.
```

### What to keep (do not touch)
- All table schemas and constraints
- All indexes
- The `link_sessions_to_user` RPC function
- All RLS policies
- Railway environment variables
- Supabase Auth configuration
- The authenticated user record in auth.users

### Before truncate: run the SQL migration
Run `sprint5b_structural_scores_fix.sql` BEFORE clearing data, so the correct table + constraint exists when you start fresh testing.

### WhatsApp message for testers
```
Hey — quick heads up. We upgraded the Quorum memory and identity engine today (bias tracking, structural memory, and cross-device linking all improved). As part of this, I cleared all prototype test data to start clean. Next time you run a decision, everything will work correctly from session 1. Thanks for testing — the real sessions from now on are what count. 🙏
```

---

## 5. POST-FIX END-TO-END TESTING CHECKLIST

Run this end-to-end after: (1) patches deployed, (2) SQL migration run, (3) data truncated.

### Phase 1 — Anonymous first session

**Action:** Open fresh incognito. Submit a decision. Complete all 6 personas. Submit Examiner answers.

| Check | Query / Log | Expected | Pass Criteria |
|---|---|---|---|
| Session created | `SELECT id, user_email, user_id, device_id FROM sessions ORDER BY created_at DESC LIMIT 1` | user_email=null, user_id=null, device_id=dev_xxx | ✅ |
| Ontology tagged | `SELECT tagger_status FROM sessions_ontology WHERE session_id='...'` | complete | ✅ |
| Bias scoring triggered | Railway logs: `[BiasScore] Scoring session ... (identity: device_id)` | identity=device_id | ✅ |
| Bias rows created | `SELECT user_email, user_id, device_id, detection_count FROM bias_library WHERE device_id='dev_xxx'` | email=null, user_id=null, device_id populated | ✅ |
| Structural scores | `SELECT COUNT(*) FROM structural_scores` | 0 (only 1 session, no past) | ✅ |

---

### Phase 2 — Auth linking (same incognito window)

**Action:** From home page, enter email → click magic link → authenticate.

| Check | Query / Log | Expected | Pass Criteria |
|---|---|---|---|
| Session linked | `SELECT user_id, user_email FROM sessions WHERE id='session_1_id'` | user_id populated, user_email populated | ✅ |
| Bias rows retro-linked | `SELECT user_id, user_email, device_id FROM bias_library WHERE device_id='dev_xxx'` | user_id now populated, user_email now populated | ✅ (this is the new behavior from Fix C) |
| Railway log | `[LinkSessions] Retro-linked device_id bias rows...` | appears in log | ✅ |

**Partial pass:** Session linked but bias rows not retro-linked → Fix C not deployed correctly. Re-check callback and link-sessions patches.

---

### Phase 3 — Post-auth sessions 2–4 (stamp user_id)

**Action:** Run 3 more decisions as authenticated user (no incognito).

| Check | Query / Log | Expected | Pass Criteria |
|---|---|---|---|
| user_id on new sessions | `SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 3` | user_id populated on all 3 | ✅ (new behavior from Fix B) |
| Bias rows use user_id | `SELECT user_id, user_email FROM bias_library ORDER BY updated_at DESC LIMIT 5` | user_id populated | ✅ |
| Accumulation works | Same bias appearing in 2+ sessions: `detection_count=2, confidence_weight=0.6` | correct | ✅ |

---

### Phase 4 — 5-session gate + structural retrieval

**Action:** Submit session 6 (the 6th ontology-complete session for this user).

| Check | Query / Log | Expected | Pass Criteria |
|---|---|---|---|
| Past session count | Railway log: `[StructuralMatch] Scoring session ... against 5 past sessions` | exactly 5 | ✅ |
| Matches found | `SELECT threshold_met, session_count_used FROM structural_matches ORDER BY computed_at DESC LIMIT 1` | session_count_used=5, threshold_met depends on structural similarity | ✅ if count is right |
| structural_scores written | `SELECT COUNT(*) FROM structural_scores WHERE session_id_a='session_6_id'` | 5 rows (one per past session) | ✅ (new behavior from Fix A) |
| structural_scores content | `SELECT session_id_b, total_score, threshold_met FROM structural_scores WHERE session_id_a='session_6_id'` | all 5 rows with scores, threshold_met correct | ✅ |
| Error log check | Railway logs: NO `[StructuralMatch] structural_scores upsert failed` message | clean | ✅ |

**Pass criteria for structural_scores:** 5 rows must exist. If 0 rows still exist, check Railway logs for the new error message — it will tell you exactly why (table doesn't exist, constraint missing, etc.).

---

### Phase 5 — Cross-device continuity

**Action:** Open new browser (or clear localStorage). Enter same email on home page. Run a new decision.

| Check | Query / Log | Expected | Pass Criteria |
|---|---|---|---|
| New session has user_email | `SELECT user_email, user_id FROM sessions ORDER BY created_at DESC LIMIT 1` | user_email populated | ✅ |
| History loads cross-device | Home page shows prior sessions from authenticated history | sessions appear | ✅ |
| Bias accumulation continues | `SELECT detection_count FROM bias_library WHERE user_email='...' ORDER BY detection_count DESC LIMIT 3` | counts increment from where they were | ✅ |

---

### Phase 6 — Full identity verification query

Run this in Supabase SQL Editor after the full test to confirm identity chain is clean:

```sql
-- Should show all sessions for the test user with correct identity stamps
SELECT
  id,
  created_at,
  user_id IS NOT NULL AS has_user_id,
  user_email IS NOT NULL AS has_email,
  device_id IS NOT NULL AS has_device
FROM sessions
ORDER BY created_at ASC;

-- Should show bias_library with user_id on all rows post-retro-link
SELECT
  bias_parameter,
  detection_count,
  confidence_weight,
  user_id IS NOT NULL AS has_user_id,
  user_email IS NOT NULL AS has_email,
  device_id
FROM bias_library
ORDER BY updated_at DESC;

-- Should show 5+ rows in structural_scores after session 6
SELECT
  session_id_a,
  session_id_b,
  total_score,
  threshold_met
FROM structural_scores
ORDER BY computed_at DESC
LIMIT 20;
```

### Overall pass/fail criteria
- **Full pass:** All Phase 1–5 checks pass. structural_scores has 5 rows. Bias rows all carry user_id post-auth. Sessions 2+ all have user_id.
- **Partial pass:** Structural_scores still empty → check Railway logs for new error message. Everything else passes.
- **Fail:** Bias rows still not retro-linked → Fix C not deployed. Sessions still missing user_id → Fix B not deployed.

**Only proceed to Sprint 7 (Mirror) after full pass.**
