# Quorum for Institutions — Complete Reference

*Covers everything shipped across Sprints 1–6 of the institutional build-out. Written for institution admins, institution members, and internal reference — not a sales page.*

---

## 1. What this is, in one paragraph

Quorum's individual product is unchanged — every decision session, every piece of decision/context text, every Council response stays exactly as private as it's always been, visible only to the person who wrote it. The institutional layer adds an **optional**, **opt-in**, **anonymized** layer on top: if your employer or organization has a Quorum institution set up, you can choose to let your *patterns* (never your raw decisions) contribute to and benefit from group-level insight — how your calibration compares to your team's, whether a bias shows up more in your organization than average, small consensual peer groups sharing trend data with each other. Nothing about this is visible to anyone unless you turn it on, and several hard technical floors exist so no comparison can ever be small enough to identify a specific person.

If you're not part of an institution, or you are but haven't turned anything on, **the product is pixel-identical to the individual experience.** No new badges, no new screens, nothing to configure.

---

## 2. The two kinds of sharing — Cohorts vs. Aggregate Benchmarks

This is the single most important concept to understand, because the two work very differently.

| | **Cohorts** (small groups) | **Aggregate Benchmarks** (whole institution / platform) |
|---|---|---|
| What it is | A small, named group you're placed in (e.g. "Leadership", "Product Team") | A statistical comparison against your whole institution, or the whole platform if your institution is too small |
| What's shared | Session score trend, calibration delta, bias parameter labels — never raw decisions | Aggregate averages (e.g. "average calibration delta for high-stakes decisions") |
| Who sees what | Only mutually-consenting members of *that* cohort see each other's whitelisted stats | Nobody sees individual data, ever — only a floor-protected group average |
| Minimum group size | No enforced minimum (it's a small, named, consensual group by design) | **20 people minimum** (see K_FLOOR below), enforced automatically |
| Consent required | `consent_shared_cohort` toggle, per institution | `consent_aggregate` toggle, per institution (plus a separate toggle for including past decisions) |

These two systems are **deliberately kept separate** and can never leak into each other — a 3-person cohort can never become a visible "segment" in the aggregate benchmarks, no matter how the data lines up. This is tested explicitly (see §8).

---

## 3. The privacy floor — "K_FLOOR" explained simply

Every aggregate benchmark (calibration comparisons, bias-parameter comparisons) requires **at least 20 consenting people** in that specific comparison bucket before it will show anything at all. Below 20, the comparison **doesn't exist** — not "hidden," not "blurred," it simply isn't computed. This is enforced at the database level, not in app code, so there's no code path that could accidentally leak a smaller number.

**Why 20, not something smaller like 5?** Rich, multi-dimensional behavioral data (which is what Quorum captures) de-anonymizes much faster than simple demographic data — research on exactly this kind of data shows that even "anonymous" aggregate stats can become identifying at small group sizes. 20 is a deliberately conservative floor.

**What this means practically:**
- A new or small institution will mostly see "not enough participants yet" for a while. This is expected, not a bug.
- Once your institution doesn't have 20 people in some specific comparison, you automatically see the **platform-wide** number instead (still real, still floor-protected, just a bigger comparison group). This switch is automatic — nothing to configure.
- Institution admins can request a *higher* floor for their institution (e.g. a very risk-conscious customer), never a lower one.

---

## 4. What a regular member sees and can do

### If you're not in any institution
Nothing changes. No badges, no new settings sections, no different product experience.

### Once you've joined an institution (via an unlock code)
- **A small badge** appears in the top-right corner of every page: your institution's name, and a "Sharing: Off / Aggregate / Cohort / Both" pill. Clicking the pill takes you straight to your sharing settings.
- **If you're in more than one institution**, clicking your institution name lets you switch which one is "active" — this choice is saved and follows you across devices.
- **In Settings → Privacy**, a new "Institutional Sharing" card appears with two toggles, both **off by default**:
  - *"Include me in institution benchmarks"* — turning this on separately asks whether to also include your **past** decisions, or only future ones from now on. These are always two separate questions, never bundled.
  - *"Share insights with my cohort"* — only relevant if you've been placed in a cohort by your institution admin.
- **On your Mirror view**, if you're in a cohort with at least one other mutually-consenting member, a "Your Cohort" section appears showing their session score trend, calibration pattern, and bias parameter labels — never their raw decisions, and this section is completely absent (not empty) if you have no cohort or no consenting cohort-mates.
- **Next to your personal calibration and bias-pattern stats**, a small "vs [Institution/Platform] (n=X)" tag may appear once that specific comparison has cleared the 20-person floor. If it hasn't cleared yet, you'll instead see an honest progress count like "4 of 20 needed" — an exact number, by deliberate choice, rather than a vague "almost there."
- **The first time** a specific comparison unlocks for you, a one-time quiet notification appears — it never repeats for that same comparison again.
- **In Council synthesis**, if a relevant institutional comparison exists for the kind of decision you're making, it may quietly inform the synthesis as *additional context* — it never overrides your own evidence, and the synthesis output never mentions "institution," "benchmark," or any of this explicitly.

### What a member can never do, and what nobody (including institution admins) can ever see about you
- No one can ever see your raw decision text, context text, Council responses, or Watchlist entries — not your institution admin, not a fellow cohort member (unless they're specifically whitelisted stats you've consented to), not anyone.
- No institution admin can see whether you *personally* have consent turned on or off — they only ever see aggregate counts of how many people changed a setting, never who, and even that count is hidden for very small institutions.
- No one can ever delete your session data except you.

---

## 5. What an institution admin sees and can do

Reachable at **`/institution/admin`** once you're an admin of at least one institution (the first person to redeem an institution's unlock code automatically becomes its admin).

| Panel | What it shows | What it deliberately does NOT show |
|---|---|---|
| **Roster** | Email, role (admin/member), join date for every member | Anything about their individual consent status, their sessions, or their data |
| **Unlock Code** | Whether the admin seat has been claimed, any email-domain restriction, a "rotate code" button, and any child institutions | The original code (never retrievable after creation — only shown once) |
| **Consent Activity** | Aggregate counts of consent-toggle *changes* in the last 7 days, per field | Which member changed what |
| **Consent Rate** | What % of members have each type of consent on — **but only once total membership reaches 20 people.** Below that, just shows "not enough members yet" with no percentage, since a rate for a tiny group nearly reveals who specifically opted in |
| **Aggregate Dashboard** | Every dimension that has cleared the 20-person floor for your institution, with the aggregate calibration pattern | Dimensions that haven't cleared the floor — they're simply absent, not listed as "locked" |

**Role management:** an admin can promote/demote members between admin and member roles from the Roster panel. The system will not let you demote the last remaining admin (to avoid locking the institution out of its own admin tools).

**Conglomerate / parent-child institutions:** an admin of a parent institution can create child institutions (each gets its own independent unlock code) and see a rolled-up comparison across children — but only once **at least 2 children** each have their own floor-cleared data. The rollup is built *only* from each child's already-anonymized numbers, never from raw underlying data — a parent institution can never see into a child institution's individual members' data.

---

## 6. Individual vs. Institutional — side-by-side

| | Individual (default) | Institutional, not consenting | Institutional, consenting |
|---|---|---|---|
| Decision privacy | Fully private | Fully private, unchanged | Fully private, unchanged |
| Product UI | As today | As today — nothing new visible | Mode badge, sharing settings, possible cohort section, possible benchmark tags |
| Who can see your data | Only you | Only you | Only you, plus whitelisted aggregate stats where the floor is cleared — never raw content |
| Council synthesis | Personal context only | Personal context only | May include quiet, non-identifying institutional context if relevant |
| Cost to switch | — | — | Free to toggle on/off at any time, per institution |

---

## 7. How someone actually gets into an institution (current state)

There is currently **no self-serve "enter your code" button in the product UI** — this is a known, explicitly scoped gap, not an oversight. The current path is:

1. **Founder/superadmin** creates the institution and generates its unlock code — either via `/admin` (the "Institutions" panel) or, before that UI existed, via a direct API call.
2. That code is delivered to the institution's designated admin **out-of-band** (Slack, a call — never in a document that could be forwarded, since the code is a bearer credential until first redeemed).
3. The institution admin (or any first member) redeems the code via `POST /api/institutions/redeem` with their own login token. Whoever redeems first automatically becomes that institution's admin.
4. From there, the admin can view/rotate the code, and eventually needs to distribute it to their own members (also currently out-of-band — no invite-flow UI yet).

A proper in-product "enter your code" screen is the natural next piece of UI work if broader self-serve rollout is wanted.

---

## 8. The guarantees, and how they're actually enforced (not just promised)

These aren't policy statements — each one is enforced at a specific technical layer, and adversarially tested:

- **No role, including admin, can ever delete another user's session.** Enforced as a route-level rule with no override path, verified by an automated test that scans every institution/admin route for this exact violation.
- **No role can ever read another user's raw decision/context/response text or Watchlist entries.** Institution and admin routes are structurally limited to aggregate views and roster metadata — the raw tables are never joined into any multi-user route. Verified by an automated test that fuzzes every such route, including checking for accidental "select everything" queries.
- **The 20-person floor is enforced by the database itself**, not application code — a view either returns a row or it doesn't, with no code path that could show a smaller number.
- **A consensual cohort can never become a visible aggregate segment**, even if a cohort's exact membership happens to match what would otherwise be a sub-floor group elsewhere in the aggregate data — the aggregate views have no way to know a "cohort" concept even exists.
- **Turning the master feature flag off leaves zero trace** — no route, no UI element, nothing reachable, verified automatically rather than just by code review.
- **Every consent flag defaults to off**, is scoped to one specific institution membership (not global), and nothing about tiering or floors is a fixed config number — it's always computed live from how many people currently consent.

---

## 9. Known gaps and what's intentionally deferred

- No self-serve "enter your unlock code" UI for regular members yet (§7).
- No self-serve invite flow for an admin to distribute codes to their own members yet.
- Bias-parameter aggregate comparisons (Sprint 6) don't yet have the same "X of 20 needed" progress indicator that calibration-dimension comparisons do — that was a deliberate, explicit product decision for calibration data specifically, not automatically extended.
- Real design-partner rollup verification (parent/child with genuine data, not synthetic) is a launch-readiness task, not something completed in build-out.
- "What does healthy adoption look like" (consent opt-in rate, time-to-first-cleared-segment) is defined as a launch task, not yet instrumented as a live dashboard.

---

*This document reflects the state of the institutional layer as built through Sprint 6. It is not a public-facing marketing document — treat specific numbers (the 20-person floor, etc.) as internal/admin-facing detail unless a decision is made to publish them externally.*
