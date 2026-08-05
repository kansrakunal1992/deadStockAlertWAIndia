# Tech Debt Tracker

Deliberate shortcuts taken during the Institutional Layer build-out, to be
swept during Sprint 6 (Hardening, Edge Cases, Rollout) — not before, not
forgotten after.

## Open

### 1. `app/api/institutions/consent/route.ts` — non-atomic consent write
**Added:** Institutional Sprint 2
**What:** `POST /api/institutions/consent` updates `institution_memberships`
and inserts into `consent_audit_log` as two separate Supabase calls, not one
DB transaction. If the audit insert fails right after the update succeeds,
the consent change still takes effect but goes unlogged (a server-side
`console.error` fires either way — the user-facing behavior is correct, only
the audit trail has a gap).
**Fix:** Wrap both writes in a single Postgres function and call it via
`supabase.rpc('toggle_consent', {...})` instead of two sequential
`.update()` / `.insert()` calls.
**Revisit:** Sprint 6, task 1 (full negative-path suite) — this is exactly
the kind of gap that suite should be fuzzing for. Close it there, or
earlier if an audit-log gap actually shows up in practice before then.

### 2. `app/api/institutions/[institutionId]/admin/roster/route.ts` — N+1 email lookups
**Added:** Institutional Sprint 3
**What:** supabase-js has no bulk "getUsersByIds" — the roster route resolves
one email per member via `auth.admin.getUserById()`, sequentially awaited
inside a `Promise.all` map. Fine for a skeleton-stage roster at small/mid
institution size; genuinely slow (and one API call per row) at the largest
institution tier the plan describes.
**Fix:** Replace with a Postgres function that joins `institution_memberships`
to `auth.users` directly and returns email in one round trip, called via
`supabase.rpc(...)` instead of N `getUserById` calls. `lib/cohort-insights.ts`
has the same pattern (once per cohort peer) and should move to the same fix.
**Revisit:** Before onboarding any institution near the top of the size
tiers in plan Section 1.1 — sooner than Sprint 6 if a real customer gets
there first.

---

## Resolved
*(move items here with the sprint/date they were closed, so this file stays
a log, not just an ever-growing backlog)*
