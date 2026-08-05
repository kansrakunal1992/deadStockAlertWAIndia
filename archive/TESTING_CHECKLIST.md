# Quorum — Post-Fix End-to-End Testing Checklist
> Updated: April 30, 2026 | Use after deploying Bug B + Bug C patches + SessionView UI fixes
> Bug A (structural_scores) confirmed fixed by deployed structural-match route — no action needed

---

## Deploy checklist before testing

| Step | Action | Done? |
|---|---|---|
| 1 | Deploy `app/page.tsx` (user_id on session creation) | ☐ |
| 2 | Deploy `app/api/session/route.ts` (accepts user_id) | ☐ |
| 3 | Deploy `app/auth/callback/page.tsx` (passes device_id to link-sessions) | ☐ |
| 4 | Deploy `app/api/auth/link-sessions/route.ts` (retro-links device_id bias rows) | ☐ |
| 5 | Deploy `components/SessionView.tsx` (See More + conditional privacy notice) | ☐ |
| 6 | structural-match/route.ts — already deployed correctly, no action | ✅ |
| 7 | Truncate prototype data (SQL below) | ☐ |

### Truncate SQL (run in Supabase SQL Editor)
```sql
truncate table structural_scores   restart identity cascade;
truncate table structural_matches  restart identity cascade;
truncate table bias_library        restart identity cascade;
truncate table examiner_responses  restart identity cascade;
truncate table sessions_ontology   restart identity cascade;
truncate table messages            restart identity cascade;
truncate table outcomes            restart identity cascade;
truncate table sessions            restart identity cascade;
```

---

## Phase 1 — Anonymous first session

**Setup:** Fresh incognito. Submit a decision. Complete all 6 personas. Submit Examiner answers.

| Check | How to verify | Expected | Status |
|---|---|---|---|
| Session created anonymously | `SELECT user_email, user_id, device_id FROM sessions ORDER BY created_at DESC LIMIT 1` | email=null, user_id=null, device_id=dev_xxx | ☐ |
| Ontology tags | `SELECT tagger_status FROM sessions_ontology WHERE session_id='...'` | complete | ☐ |
| Bias scored by device_id | Railway: `[BiasScore] Scoring session ... (identity: device_id)` | identity=device_id | ☐ |
| Bias rows exist | `SELECT user_email, user_id, device_id FROM bias_library WHERE device_id='dev_xxx'` | email=null, user_id=null, device_id set | ☐ |
| UI: privacy notice | Check bottom of decision header | "Sessions are private by URL. No account or identity is linked to this decision." | ☐ |

---

## Phase 2 — Auth linking (same incognito window)

**Setup:** Enter email on home page → magic link → authenticate.

| Check | How to verify | Expected | Status |
|---|---|---|---|
| Session 1 linked | `SELECT user_id, user_email FROM sessions WHERE id='session_1_id'` | both populated | ☐ |
| **Bias rows retro-linked (device_id)** | `SELECT user_id, user_email FROM bias_library WHERE device_id='dev_xxx'` | user_id now populated — **this is the new fix** | ☐ |
| Railway log | `[LinkSessions] Retro-linked device_id=dev_xxx bias rows to user ...` | appears | ☐ |
| UI: privacy notice updated | Reload session page after auth | "This session is linked to your account and included in your decision memory." | ☐ |

**Partial pass:** Session linked but bias not retro-linked → Fix C not deployed.

---

## Phase 3 — Post-auth sessions 2–4 (user_id stamping)

**Setup:** Run 3 more decisions as authenticated user (no incognito).

| Check | How to verify | Expected | Status |
|---|---|---|---|
| **user_id on new sessions** | `SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 3` | user_id populated on all 3 — **new fix** | ☐ |
| Bias rows use user_id | `SELECT user_id, user_email FROM bias_library ORDER BY updated_at DESC LIMIT 5` | user_id populated | ☐ |
| Accumulation correct | Same bias in 2+ sessions: `detection_count=2, confidence_weight=0.6` | correct | ☐ |
| UI: See More button | Submit a long decision (>220 chars). Check decision header. | "↓ See more" button visible, expands on click | ☐ |

**Partial pass:** Sessions missing user_id → Fix B not deployed.

---

## Phase 4 — 5-session gate + structural retrieval

**Setup:** Submit session 6 (6th ontology-complete session for this user).

| Check | How to verify | Expected | Status |
|---|---|---|---|
| Past session count | Railway: `[StructuralMatch] Scoring session ... against 5 past sessions` | exactly 5 | ☐ |
| structural_matches written | `SELECT threshold_met, session_count_used FROM structural_matches ORDER BY computed_at DESC LIMIT 1` | session_count_used=5 | ☐ |
| **structural_scores written** | `SELECT COUNT(*) FROM structural_scores WHERE session_id_a='session_6_id'` | 5 rows | ☐ |
| structural_scores content | `SELECT session_id_b, total_score FROM structural_scores WHERE session_id_a='session_6_id'` | 5 rows, scores populated | ☐ |
| No error in logs | Railway logs: NO `structural_scores upsert FAILED` | clean | ☐ |
| Railway success log | `[StructuralMatch] Wrote 5 rows to structural_scores` | appears | ☐ |

---

## Phase 5 — Cross-device continuity

**Setup:** Open new browser / clear localStorage. Enter same email. Run new decision.

| Check | How to verify | Expected | Status |
|---|---|---|---|
| History loads | Home page shows prior sessions | sessions appear | ☐ |
| New session has user_email | `SELECT user_email, user_id FROM sessions ORDER BY created_at DESC LIMIT 1` | user_email populated | ☐ |
| Bias accumulation continues | `SELECT detection_count FROM bias_library WHERE user_email='...' ORDER BY detection_count DESC LIMIT 3` | counts increment from previous | ☐ |

---

## Phase 6 — Final SQL verification

Run in Supabase after full test:

```sql
-- Identity chain across all sessions
SELECT
  id,
  LEFT(created_at::text, 16) AS time,
  user_id IS NOT NULL AS has_user_id,
  user_email IS NOT NULL AS has_email,
  device_id IS NOT NULL AS has_device
FROM sessions ORDER BY created_at ASC;

-- Bias library identity check
SELECT
  bias_parameter,
  detection_count,
  confidence_weight,
  user_id IS NOT NULL AS has_user_id,
  user_email IS NOT NULL AS has_email
FROM bias_library ORDER BY detection_count DESC LIMIT 10;

-- structural_scores traceability
SELECT session_id_a, session_id_b, total_score
FROM structural_scores ORDER BY computed_at DESC LIMIT 20;
```

---

## Overall pass criteria

| Result | Meaning |
|---|---|
| **Full pass** | All Phase 1–5 checks pass. structural_scores has 5+ rows. All post-auth sessions have user_id. Device bias rows retro-linked after auth. |
| **Partial — structural_scores still empty** | structural-match route not deployed (was already correct) — force Railway redeploy |
| **Partial — user_id missing on new sessions** | Fix B not deployed |
| **Partial — bias rows not retro-linked** | Fix C not deployed |

**Only proceed to Sprint 7 (Mirror) after full pass.**

---

## WhatsApp message for testers
```
Hey — we upgraded the Quorum memory and identity engine today (bias tracking, 
structural memory, and cross-device linking all improved). Cleared all prototype 
test data for a clean start. Next decision you run will work correctly from 
session 1. Thanks for testing 🙏
```
