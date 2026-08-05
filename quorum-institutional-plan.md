# Quorum — Institutional Layer: Execution Plan

**Purpose of this document:** this is the single source of truth for building the institutional layer across multiple future sessions. Each sprint below is written to be workable in its own context window — read "0. Current State" + "1. Concepts & Conclusions" once at the start of any sprint session, then read only that sprint's section in detail. Do not re-litigate the conceptual decisions in Section 1 mid-sprint; they are already decided. If new information genuinely invalidates one, note it in that sprint's "Deviations from plan" subsection rather than silently changing course.

Last updated: reflects planning as of the conversation that produced this doc. Treat all file/table names below as accurate as of that point — re-verify against the live repo at the start of each sprint, since prior sprints will have changed it.

---

## 0. Current State (as of plan creation, before any institutional work begins)

### Product summary
Quorum is a single-user decision-support product. An individual brings a real decision to an AI "Council" of six advisor personas, goes through an Examiner phase (diagnostic questions targeting specific unknowns/biases), receives a Synthesis, and — over time — builds a personal "Decision Graph" / "Mirror": calibration tracking, bias fingerprinting, contradiction detection, and structural pattern-matching **across that one person's own decision history only**. Nobody sees anyone else's decisions today. Privacy is a core, currently-earned trust position with the existing user base.

### Architecture facts that matter for this plan
- **Everything is single-user-keyed today.** `sessions.user_id → auth.users`, `bias_library`/`contradiction_log` keyed to `user_email` (pre-dates full auth), no `organization_id` or `team_id` anywhere in the schema.
- **RLS is real for raw content, but thin for service-role paths.** `sessions` and `messages` have genuine owner-only RLS (`auth.uid() = user_id`). The ledger tables added in Sprint 1 (`sessions_ontology`, `examiner_responses`, `bias_library`, `contradiction_log`) all use `using (true)` policies intended for service-role access — meaning isolation on those tables is enforced by application code choosing the right `user_id`/`user_email` filter, not by the database refusing to return other users' rows. **This plan does not touch or loosen the existing owner-only policies on `sessions`/`messages` at any point.**
- **Existing core tables (do not modify):**
  - `sessions` (id, user_id, created_at, decision_text, context_text, status)
  - `messages` (id, session_id, created_at, persona, role, content)
  - `sessions_ontology` (session_id, 14 structural dimensions — decision type, stakes, time pressure, information completeness, counterparty, emotional signature, stakeholder complexity, decision register weights, examiner gaps — plus `tagger_status: pending|complete|failed`, non-fatal by design)
  - `examiner_responses` (session_id, question_text, response_text, bias_parameter_probed, question_order)
  - `bias_library` (user_email, bias_parameter, detection_count, confidence_weight, asymmetry_score_avg, activation_contexts jsonb, outcome_confirmed_count/disconfirmed_count)
  - `contradiction_log` (user_email, session_id_principle, session_id_violation, principle_text, violation_description)
- **Key logic files (do not rearchitect, only extend):**
  - `lib/decision-continuity.ts` — links a user's own revisited decisions via `parent_session_id`.
  - `lib/structural-retrieval.ts` — defines `VECTOR_DIMS` / `DIM_LABELS`, the 14-dimension ontology vector.
  - `lib/calibration-engine.ts` — per-user, per-dimension bucketing (HIGH/LOW split on a 1–5 scale), `MIN_BUCKET_SIZE = 3`, `MIN_GAP = 0.4` noise floor, suppresses rather than fabricates a pattern when data is thin. **This is the direct template for the institutional aggregate engine in Sprint 4** — same discipline, run across users instead of within one user's sessions.
  - `lib/independence-score.ts` — Mirror module scoring unprompted use of Council frameworks.
  - `lib/persona-relevance.ts` — computes 0.0–1.0 relevance per persona from rule signals, ontology dimensions, structural match, and (Sprint CAL) personal calibration zones. Produces a "Council Weighting Directive" injected into the synthesis system prompt as an additive, non-mandatory block. **This is the exact hook point for institutional/cohort framing in Sprint 5** — same mechanism, one more optional injected block.
  - `lib/feature-flags.ts` — the existing flag pattern: single `NEXT_PUBLIC_`-prefixed Railway env var, checked identically client and server, default OFF when unset. Template for `NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED`.
- **Relevant Mirror/UI components (extend with optional props, do not rebuild):** `MirrorTimeline`, `MirrorInsightCard`, `MirrorOpenLoopCard`, `CalibrationSparkline`, `BiasFingerprint`, `PatternTile`, `PatternStore`, `RecurringConditionCard`, `ContradictionDetector`, `MonthlyJudgmentReview`, `DecisionGraph`, `MirrorNav`, `StyleCalibration`, `SessionReliabilityIndex`, `OntologyRevealCard`, `PatternSurfaceCard`, `EarlyEchoCard`, `TensionInterstitial`, `ExaminerPanel`.
- **Landing page** currently pitches a "PE firm sees judgment quality across its 12 portfolio founders" style institutional story that is **not supported by current research or architecture** at that population size (see Section 1). Do not build toward that literal claim; build toward the corrected version described below.

---

## 1. Concepts & Conclusions (why we're building it this way — decided, not open for re-debate)

### 1.1 The research constraint that shapes everything
K-anonymity (k≥5, no individual visible to any peer or admin) is the hard privacy constraint. Research reviewed (Sweeney's original k-anonymity work; Machanavajjhala et al. on homogeneity/background-knowledge attacks; de Montjoye et al. on behavioral-data uniqueness — 4 spatiotemporal points reidentify ~95% of individuals in mobility data, 4 points in credit card metadata; a June 2026 Frontiers in Digital Health paper on k-anonymity decay in multi-turn conversational disclosure, showing ~80% of simulated cases collapse below k=5 within a median 7 disclosure steps even with fully compliant per-turn de-identification) establishes two things:
1. **Small populations cannot support meaningful k≥5 aggregation.** At N=12 (a PE firm's portfolio founders), any real segmentation (by decision type, stakes, timing) almost always falls below 5 people. This is a structural math problem, not an engineering gap.
2. **Rich, free-text, multi-dimensional behavioral data (exactly what Quorum collects — decision text, context, 14 ontology dimensions, examiner responses) degrades k far faster than simple demographic data.** Quorum's own data shape is closer to the "worst case" in this research than to the cases where k-anonymity is usually applied successfully (e.g. census tables).

### 1.2 The resolving idea: two different sources of "unique to this company"
- **Source #1 — consensual sharing (works at any N, including 2).** A small, explicit, opted-in group (e.g. two co-founders, a leadership team) sees each other's **insight-level summaries only** (scores, deltas — never raw decision text), because they've explicitly agreed to it. No statistics, no anonymization needed — just consent.
- **Source #2 — real aggregate computation (only valid once N is large enough).** Same code for every institution, unique *output* because it runs on that institution's own consenting population. Requires an actual enforced floor (K_FLOOR, set meaningfully above bare k=5 — recommend 20–25 given how fast rich behavioral data degrades) computed at the database view level, not application code.

### 1.3 The fix for the flagship "PE firm" story
Don't aggregate 12 founders directly (fails the math). Instead: each portfolio company is its own child institution, computes its own already-k-safe aggregate internally (Source #2, valid once *that company's* population is large enough), and only that pre-aggregated, already-anonymous output rolls up to the parent (PE firm) institution. "12" becomes 12 *populations*, not 12 *people*. Requires `institutions.parent_institution_id` (self-referencing, nullable).

### 1.4 Company-size tiers are descriptive, not the gating mechanism
We discussed rough bands (1–2 founders; 50–100 employees; up to 5,000; 5,000+; conglomerates) as a way to reason about what's realistic at each size. **The product itself never gates features on headcount.** It gates on **live, measured, currently-consenting N per segment**, computed continuously. A 50-person company and a 5,000-person company run through identical logic — the larger one simply clears more segments naturally as real consenting participation grows. This is what "the product transforms itself based on seat size" actually means in implementation: auto-tiering by measured N, not a configured company-size flag.

### 1.5 Consent model (the "ideal approach" we converged on)
Two independent, per-institution-membership, default-OFF, revocable toggles:
- **`consent_aggregate`** — if off, this user is invisible to any aggregate computation and behaves exactly like today's individual product. If on, their ontology-tagged/outcome data (never raw text) becomes eligible to feed Source #2 aggregate views (institution-level and platform-wide).
- **`consent_shared_cohort`** — opts into a named small group (Source #1) where members who *all* consent see each other's insight summaries.
- **Retroactive/backfill consent is a separate, explicit second confirmation** at toggle time ("also include your existing history?") — not bundled into the main toggle, because agreeing to share future decisions and agreeing to share decisions already made under a different understanding are different consents.
- Consent is **per membership row**, so a user in multiple institutions can have different consent states in each.

### 1.6 RBAC — hard invariants, not permissions
- No role, including admin, can ever delete another user's session. This is enforced as a route-level invariant (`auth.uid() = owning_user_id`, full stop) with **no code path for override**, not a permission check that could be misconfigured.
- No role, including admin, can ever read raw `decision_text`, `context_text`, `response_text` (examiner), or watchlist entries belonging to another user. Admin/institution routes are structurally limited to querying aggregate views and membership/roster metadata — the raw tables are simply never joined into any multi-user-facing route.
- Existing owner-only RLS on `sessions`/`messages` is never modified, only ever added to (new tables, new views) — this is the literal, durable guarantee, not a policy statement.

### 1.7 Gating (3 independent layers, all required)
- **(a) Master kill switch:** `NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED`, Railway env var, default false, checked server-side in every institution route (not just client UI, since this gates real permission logic).
- **(b) Per-institution unlock code:** ops-generated for now (not self-serve), redeemed once per user to create a membership row. Sub-codes can be generated for child institutions/cohorts.
- **(c) Seamless UI blending:** a user/admin not in an institution, or in one but not consenting to anything, sees a product that is pixel-identical to today's. Institutional surfaces are additive only.

### 1.8 UI elements agreed on (persistent but quiet)
- A small mode badge in global nav, present on every screen: "Individual" or "[Institution Name] ▾" (the ▾ is the multi-institution switcher, since a user can belong to several institutions and only one should be the active viewing context at a time).
- Every benchmark-bearing number carries its own scope tag inline (not a separate legend): *"vs. Platform (n=143)"* / *"vs. Product @ Acme (n=34)"*. The aggregate API returns `benchmarkScope: {type, label, n}` alongside every computed value.
- A small, constant, non-alarmist sharing-status pill near the mode badge: *"Sharing: Off / Aggregate / Cohort / Both"*.
- An honest "not enough participants yet" state (with a count, e.g. "4 of 20 needed") instead of a blank space wherever a segment hasn't cleared K_FLOOR.
- A quiet, one-time notice when a new benchmark panel unlocks for the first time (not a recurring nag).

### 1.9 Council Synthesis / Mirror reframing
No new personas, no new synthesis mechanism, no new Mirror components. `lib/persona-relevance.ts` already builds an additive, non-mandatory context block for synthesis (the "Council Weighting Directive"). The institutional version is one more optional block in that same injection point — e.g. "this user is part of Product @ Acme" — and it is only ever injected when the relevant benchmark segment has cleared K_FLOOR. Existing Mirror components (`CalibrationSparkline`, `BiasFingerprint`, `PatternTile`) get one new optional prop (`benchmarkScope`) rather than being rebuilt.

### 1.10 Guardrail carried through every sprint (re-verify each time)
K_FLOOR must be enforced **uniformly by the aggregate view itself**, regardless of whether a given segment happens to coincide with a small consensual cohort. A 3-person cohort that also opts into institutional aggregates must not be able to be isolated as its own "segment" in the institution-level view just because it's a natural grouping — the view doesn't get to know or care what a "cohort" is; it only refuses to return rows under threshold. This is the single most important thing to test in Sprint 6, and worth a sanity check at the end of every earlier sprint too.

---

## 2. Global Non-Negotiables Checklist (copy into every sprint's Definition of Done)

- [ ] No existing table (`sessions`, `messages`, `sessions_ontology`, `examiner_responses`, `bias_library`, `contradiction_log`) has been altered or had its RLS loosened.
- [ ] No route, at any role, can select `decision_text`, `context_text`, `response_text`, or watchlist raw fields for any user other than the requester.
- [ ] No route, at any role, can delete another user's session — verified by an actual attempted-delete test, not just code review.
- [ ] `NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED=false` (or unset) results in zero UI residue and zero reachable institution routes.
- [ ] Every aggregate query path enforces `HAVING count(distinct user_id) >= K_FLOOR` at the view/query level, not in application code.
- [ ] Every consent flag defaults to OFF and is per-membership-row.
- [ ] Nothing in this sprint required a headcount-based config value — tiering is always computed from live consenting N.

---

## 3. Sprint 1 — Institution Schema, Hierarchy, Master Flag, Unlock Codes

**Goal:** stand up the institution/membership data model and the master gate, with zero effect on the live product.

**Context needed from this doc:** Section 0 (current schema facts), Section 1.3 (hierarchy), Section 1.7(a)/(b) (gating).

### Tasks
1. Create `institutions` table:
   - `id uuid primary key`
   - `name text not null`
   - `parent_institution_id uuid references institutions(id) null` — enables the conglomerate rollup from 1.3
   - `unlock_code_hash text not null`
   - `k_floor_override int null` — allows a per-institution override of the default K_FLOOR constant, null = use global default
   - `created_at timestamptz default now()`
2. Create `institution_memberships` table:
   - `id uuid primary key`
   - `institution_id uuid references institutions(id) on delete cascade`
   - `user_id uuid references auth.users(id) on delete cascade`
   - `role text check (role in ('admin','member')) default 'member'`
   - `consent_aggregate boolean default false`
   - `consent_aggregate_backfill boolean default false` — separate from above, see 1.5
   - `consent_shared_cohort boolean default false`
   - `cohort_id uuid null` — FK added in Sprint 3 once `cohorts` exists
   - `joined_at timestamptz default now()`
   - `unique (institution_id, user_id)` — one membership row per user per institution; a user can have many rows across *different* institutions (satisfies multi-institution requirement)
3. RLS on both new tables:
   - `institution_memberships`: a user can `select`/`update` only their own row (`auth.uid() = user_id`). No row grants any other user or role read access at this layer — admin reads happen only via aggregate views built in Sprint 4, never directly against this table's per-user columns beyond roster metadata (name/email/role/joined_at, explicitly not the consent booleans of other users beyond an aggregate count).
   - `institutions`: readable by any user with a membership row in that institution (for displaying the name/badge); writable only by service role.
4. `lib/feature-flags.ts`: add `isInstitutionalModeEnabled()` following the exact existing pattern. **Difference from the Watchlist precedent:** this must also be checked inside every institution-related API route handler server-side (not just relied on as a client-side UI gate), since it's gating permission logic, not just a UI surface.
5. Unlock-code redemption: one API route that takes a code, hashes and compares to `unlock_code_hash`, creates (or reuses) a membership row for the calling user. First redemption of a freshly-generated code is flagged `role = 'admin'` at code-generation time (ops-configured), not inferred at redemption time.
6. Ops tooling: a simple internal script (not a public UI) to generate an institution + hashed unlock code + optional `parent_institution_id` for design partners.

### Explicitly out of scope this sprint
Consent enforcement logic beyond storing the columns, cohorts, aggregate views, any UI, RBAC middleware beyond the redemption route itself.

### Definition of Done
- All items in Section 2's checklist, plus: a migration file reviewed against Section 0's "do not modify" list; a manual test of redeeming a code end-to-end with the master flag both on and off.

### Deviations from plan
*(fill in during the sprint if reality forces a change — do not silently diverge)*

---

## 4. Sprint 2 — Consent Model, Audit Log, Hard Privacy Rails

**Goal:** make consent real and provably safe before any aggregation logic exists to consume it.

**Context needed:** Section 1.5 (consent model), Section 1.6 (RBAC invariants), Section 0's ledger table list (what raw fields must never be exposed).

### Tasks
1. Settings UI: two toggles (`consent_aggregate`, `consent_shared_cohort`), both rendered default-off, with plain-language descriptions of what each does. Toggling `consent_aggregate` on triggers a **separate** modal/checkbox for `consent_aggregate_backfill` ("include your past decisions too?") — never bundled.
2. `consent_audit_log` table: `id, user_id, institution_id, field_changed, old_value, new_value, changed_at`. Every toggle write also writes an audit row. Read access: user can see their own log; institution admin can see aggregate counts of changes (e.g. "3 members changed consent this week") but never *whose* — that's still individual data.
3. RBAC middleware: a single shared guard function used by every institution/admin route, checking `role` from `institution_memberships`. Written once, applied everywhere, so there is exactly one place to audit rather than N scattered checks.
4. **The hard-invariant test suite (write this now, not later):**
   - Attempt to delete another user's session as an institution admin → must fail at the route level, not just RLS.
   - Attempt to `select` `decision_text`/`context_text`/`response_text`/watchlist fields from any institution-scoped route as any role → must be structurally impossible (the route's query should not even reference those columns; the test should assert this by inspecting the query, not just the response).
   - Toggling consent off must immediately stop that user's data from being eligible for aggregation (verify against a stub/mock aggregate query, since the real view doesn't exist until Sprint 4 — write the test now, wire it to the real view in Sprint 4).
5. Cohort-sharing mechanics (the actual peer-visibility logic, tables come in Sprint 3): define exactly which fields are "insight-level" and shareable under mutual `consent_shared_cohort` (session_score, calibration_delta, bias_parameter labels — not activation_contexts free text if it contains anything decision-specific; audit `bias_library.activation_contexts` jsonb contents for this before exposing it).

### Explicitly out of scope this sprint
Actual cohort tables (Sprint 3), aggregate views (Sprint 4), any UI beyond the settings toggles.

### Definition of Done
- Section 2 checklist, plus: the hard-invariant test suite passing and checked into CI, not just run manually once.

### Deviations from plan

---

## 5. Sprint 3 — Cohorts (Source #1) + Admin Portal Skeleton

**Goal:** ship the consensual small-group sharing mechanism, and the admin surface's scaffolding (no aggregate data yet).

**Context needed:** Section 1.2 (Source #1 vs #2 distinction — this sprint is pure Source #1), Section 1.6 (what admin can/cannot see).

### Tasks
1. `cohorts` table (`id, institution_id, name, created_at`), `cohort_memberships` (`cohort_id, user_id, joined_at`). Update `institution_memberships.cohort_id` FK now that `cohorts` exists (or keep membership many-to-many via `cohort_memberships` if a user might reasonably be in more than one cohort — recommend the latter for flexibility, e.g. someone on both a "Leadership" and a "Product" cohort).
2. Cohort insight-sharing query: for any two users in the same cohort where **both** have `consent_shared_cohort = true`, expose to each other only the fields whitelisted in Sprint 2 (session_score trend, calibration_delta, bias_parameter labels) — never raw text. Build as its own service function, not inline in a route, so Sprint 6's audit has one place to check.
3. Admin portal routes (`/institution/admin/*`), gated by the RBAC middleware from Sprint 2:
   - Roster view: name/email/role/joined_at only.
   - Code management: view/rotate/generate unlock codes, including sub-codes for child institutions.
   - RBAC assignment: change a member's role between `admin`/`member`.
   - Placeholder for the aggregate dashboard (built in Sprint 4/5) — ship as a "coming soon" or feature-flagged-off panel this sprint, not faked data.
4. UI: the "Cohort" section on a member's own Mirror view, populated only when they're in a cohort with at least one other mutually-consenting member. Empty/absent otherwise — no UI element implying a cohort exists if it doesn't.

### Explicitly out of scope this sprint
Any Source #2 aggregate computation, K_FLOOR logic, benchmark scope tags, mode badge/switcher (Sprint 5).

### Definition of Done
- Section 2 checklist, plus: a manual walkthrough with 2 test users mutually consenting into a cohort and confirming they see only whitelisted fields, and a third non-consenting user confirming they see nothing about the cohort.

### Deviations from plan

---

## 6. Sprint 4 — Aggregate Engine, Auto-Tiering, Cross-Institution Rollup

**Goal:** build Source #2 — the real, floor-protected aggregate computation — and the auto-tiering logic that makes the product "change behavior with seat size" without ever consulting a headcount config.

**Context needed:** Section 1.1 (why K_FLOOR must be ~20-25, not the bare k=5), Section 1.3 (conglomerate rollup), Section 1.4 (tiering is measured, not configured), Section 1.10 (the cohort-overlap guardrail — read this again now, it's most relevant here).

### Tasks
1. Define `K_FLOOR` as a global constant (recommend 20–25, overridable per-institution via `institutions.k_floor_override` for cases with strong justification — document why, don't leave it silent).
2. Build the platform-wide benchmark view: aggregates `sessions_ontology` + outcome/calibration data across **all** users platform-wide where `consent_aggregate = true`, bucketed the same way `lib/calibration-engine.ts` already buckets per-user (HIGH/LOW split, `MIN_GAP` noise floor) — same discipline, wider pool. Enforce `HAVING count(distinct user_id) >= K_FLOOR` in the view definition itself.
3. Build the institution-scoped benchmark view: identical logic, `WHERE institution_id = X`, same `HAVING` floor. This is what lets institutions large enough to clear it (Section 1's "up to 5,000" / "5,000+" bands) see their *own* population's patterns rather than falling back to platform-wide.
4. Auto-tiering function: for a given user + segment, check whether the institution-scoped view returns a row (i.e. cleared K_FLOOR) — if yes, show institution-level benchmark; if no, fall back to the platform-wide view; if platform-wide also hasn't cleared it for that segment, show the "not enough participants yet" state from Section 1.8. This single fallback chain **is** the auto-tiering mechanism — there is no separate "if headcount > N" branch anywhere.
5. Cross-institution rollup for conglomerates: a parent institution's dashboard reads only from its children's **already-aggregated, already-floor-cleared** outputs — never queries child institutions' raw or per-user data directly. Verify this by construction (the parent-facing query literally has no join path to any table finer-grained than a child institution's own aggregate view).
6. Re-run the cohort-overlap guardrail check from Section 1.10 against this real view now that it exists (Sprint 2/3 tested this against a stub).
7. Restrict DB credentials: the aggregate-serving path should use a distinct, more limited DB role/credential than the general service-role key used for per-user operations, so a bug in one doesn't grant blanket access to the other.

### Explicitly out of scope this sprint
UI rendering of any of this (Sprint 5), synthesis/Council integration (Sprint 5).

### Definition of Done
- Section 2 checklist, plus: a test creating a synthetic institution with <K_FLOOR consenting users confirming zero institutional rows return and platform fallback engages; a second test with a synthetic population >K_FLOOR confirming real rows return; a parent/child rollup test with two synthetic child institutions.

### Deviations from plan

---

## 7. Sprint 5 — UI Integration + Council/Mirror Reframing

**Goal:** surface everything built in Sprints 1–4 through the UI elements agreed in Section 1.8/1.9, blended seamlessly into the existing product.

**Context needed:** Section 1.8 (all UI element specs), Section 1.9 (synthesis/Mirror reframing mechanism), Section 0's component list.

### Tasks
1. Global nav mode badge + institution switcher (for multi-institution users) — new lightweight component, mounted in root layout so it's visible on every screen, not just Mirror routes.
2. Sharing-status pill (Off/Aggregate/Cohort/Both) next to the badge, reading live from the current user's active-institution membership row.
3. `benchmarkScope` prop added to `CalibrationSparkline`, `BiasFingerprint`, `PatternTile` (and any other Mirror component the aggregate views now feed) — renders the inline "vs. Platform (n=X)" / "vs. [Cohort/Institution] (n=X)" tag next to each stat, sourced from the aggregate API responses built in Sprint 4.
4. "Not enough participants yet" state component, used wherever a benchmark hasn't cleared K_FLOOR — show the actual count vs. threshold, not a generic message.
5. One-time unlock notice (toast or similar) the first time a new benchmark panel becomes available for a given user/segment — needs a small `seen_unlock_notices` tracking table or column so it only fires once.
6. Council synthesis: extend `lib/persona-relevance.ts`'s existing Weighting Directive injection with one additional optional block carrying institutional/cohort context (e.g. "part of Product @ Acme"), populated only when Sprint 4's auto-tiering says the relevant segment has cleared K_FLOOR for this user. No changes to persona mechanics, rule engine, or synthesis flow beyond this additive block.
7. Admin portal v1 goes fully live behind the flag: roster, consent-rate dashboard (aggregate participation stats only), the real aggregate dashboard (now backed by Sprint 4's views instead of Sprint 3's placeholder), code management, RBAC assignment.

### Explicitly out of scope this sprint
New personas, new synthesis logic beyond the additive context block, redesigning any existing Mirror component's core layout.

### Definition of Done
- Section 2 checklist, plus: side-by-side screenshot/walkthrough comparing a non-institutional user's product to an institutional-but-non-consenting user's product, confirming they are visually identical; confirmation that the synthesis prompt only ever contains the institutional context block when K_FLOOR is actually cleared.

### Deviations from plan

---

## 8. Sprint 6 — Hardening, Edge Cases, Rollout

**Goal:** adversarial testing of every guarantee made in Section 1, then a controlled launch.

**Context needed:** Section 1.6 (RBAC invariants), Section 1.10 (cohort/aggregate overlap), Section 2 (the full checklist, now run end-to-end rather than per-sprint).

### Tasks
1. Full negative-path suite:
   - Multi-institution scope bleed: a user in Institution A and Institution B, confirm switching active context never leaks A's benchmark scope into a B-context view or vice versa.
   - Cohort/aggregate overlap: construct a synthetic case where a consensual cohort's membership exactly matches an aggregate segment below K_FLOOR elsewhere in the org; confirm the aggregate view still refuses to return it even though the *cohort* mechanism (Source #1) would show those same people their own mutual insights (this is expected and fine — Source #1 and Source #2 have different rules by design; the test is that Source #2 never uses cohort-sized groupings to sneak under the floor).
   - Delete-override attempts from every role, including admin and cross-institution admin.
   - Raw-text leak attempts: fuzz every institution/admin route with attempts to request `decision_text`/`context_text`/`response_text`/watchlist fields.
   - Flag-off residue: confirm `NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED=false` leaves literally no institution-related UI element, badge, or reachable route.
2. Parent/child conglomerate rollup re-verified with real (not just synthetic) design-partner data if available by this point.
3. Seed real unlock codes for actual design-partner institutions (and child institutions, if a conglomerate partner exists at launch).
4. Keep the master flag off in production until the full suite is green; flip per-environment (staging first, then production) once confirmed.
5. Post-launch: define what "healthy" looks like for the first design partners — e.g. consent opt-in rate, time-to-first-cleared-segment — so there's a concrete signal for whether Section 1.4's auto-tiering is actually producing value at real-world N, versus everyone permanently seeing the platform-wide fallback.

### Definition of Done
- Section 2 checklist passing in full, adversarial suite checked into CI, at least one real design-partner institution live behind its own unlock code.

### Deviations from plan

---

## Appendix: Glossary (for quick reference in any future session)

- **Institution** — a company/org/group entity; can have a parent (conglomerate structure) and multiple members.
- **Membership** — a (user, institution) pair with its own role and consent flags; a user can have many.
- **Cohort** — a small, named, consensual sub-group within an institution (Source #1: peer insight-sharing, no statistics involved).
- **K_FLOOR** — the minimum number of distinct consenting contributors required before any aggregate value is computed/returned (Source #2); recommended 20–25, enforced at the database view level.
- **Source #1 vs Source #2** — consensual small-group sharing (any N) vs. real statistical aggregation (only valid above K_FLOOR).
- **Auto-tiering** — the live, measured (not configured) logic that decides whether a user sees institution-level, platform-wide, or "not enough data yet" benchmarks, per segment, based on current consenting N.
- **Benchmark scope** — the `{type, label, n}` metadata attached to every aggregate number shown in the UI, so the user always knows what population a comparison is against.
