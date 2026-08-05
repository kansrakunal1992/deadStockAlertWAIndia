# Sprint 9 — Test Checklist
## Contradiction Detector

---

## 0. Pre-deploy

- [ ] Run `sprint9_contradictions.sql` in Supabase SQL editor (creates `contradictions` + `contradiction_runs` tables + RLS policies)
- [ ] Confirm both tables exist: `SELECT * FROM contradictions LIMIT 1;` and `SELECT * FROM contradiction_runs LIMIT 1;` — both return empty, no error
- [ ] No new npm installs required

---

## 1. Feature gate verification

### Not authenticated
- [ ] Open `/mirror` without auth → auth gate shows (existing behaviour, unchanged)

### Authenticated, mirror_access, any session count
- [ ] Open `/mirror` unlocked → "Contradiction Detector" section visible with header + intro copy
- [ ] Section always shows — the teaser/threshold experience is inside the component, not a page-level gate

---

## 2. Progressive teaser — milestone states

For each milestone, set session count in DB or use a test user at that count.

### 0–9 sessions
- [ ] Status card shows label: **"Detection initialising"**
- [ ] Body copy describes signal build-up (no excerpt in italics)
- [ ] Progress bar shows 4 segments — none filled
- [ ] Counter reads e.g. "7 decisions · 33 to unlock"
- [ ] Zero blurred tiles shown below card

### 10–19 sessions
- [ ] Label: **"First patterns detected"**
- [ ] Italic excerpt visible: "Something about how you handle urgency is starting to emerge."
- [ ] Progress bar: first segment filled (or partially)
- [ ] **1 blurred tile** shown below status card
- [ ] Tile content is blurred (filter: blur 4px) — lock icon centered on tile

### 20–29 sessions
- [ ] Label: **"Signal strengthening"**
- [ ] Excerpt mentions "commitments"
- [ ] Progress bar: first two segments at 100%
- [ ] **2 blurred tiles** shown

### 30–39 sessions
- [ ] Label: **"Contradiction forming"**
- [ ] Excerpt: "The gap between a stated standard and an actual framing is now clear enough to name. You're close."
- [ ] **3 blurred tiles** shown
- [ ] Blurred tiles have visible (blurred) structure: "What you said" / "then" / "What you did" layout

### Blurred tile visual checks (any milestone with tiles)
- [ ] Lock emoji visible and centered on each tile
- [ ] Text content behind blur is unreadable but layout is recognisable
- [ ] No actual contradiction data is in the blurred tiles — they are purely visual placeholders

---

## 3. Unlocked state (≥ 40 sessions)

### No contradictions found
- [ ] Empty state card shows: "No structural contradictions detected yet. This updates as you add more decisions…"
- [ ] If detection has never run: "Contradiction analysis runs after each session…"

### With contradictions
**Seed test data:**
```sql
INSERT INTO contradictions (user_id, principle_text, principle_session_id, violation_text, violation_session_id, severity, category)
VALUES (
  '<your-user-id>',
  'I never commit to a timeline without stress-testing the assumptions first.',
  '<session-id-A>',
  'Agreed to a 3-month launch deadline without modeling what happens if hiring takes 6 weeks.',
  '<session-id-B>',
  'sharp',
  'process'
);
```

- [ ] Contradiction card renders with **"Direct · process"** badge (gold/red per severity)
- [ ] "What you said" block shows principle in italics with session decision preview below
- [ ] "then" connector line visible between blocks
- [ ] "What you did" block shows violation text
- [ ] Footer shows "Last updated [date]"
- [ ] Footer attribution: "Extracted from your Examiner responses and pushbacks — your own words, not an assessment."

### Dismiss
- [ ] Click × on a card → card fades to 0.3 opacity immediately (optimistic)
- [ ] Card disappears from list
- [ ] Reload page → dismissed card does not reappear
- [ ] `SELECT dismissed_at FROM contradictions WHERE id = '<id>';` → shows timestamp

### Multiple contradictions
- [ ] Seed 2–3 rows. All render as separate cards stacked vertically
- [ ] Each has independent dismiss button

---

## 4. Background trigger from Examiner

- [ ] Complete a full session (submit decision → complete Examiner → submit answers)
- [ ] In Railway logs, confirm: `[Examiner] Contradiction detection trigger` log line appears (fire-and-forget, non-blocking)
- [ ] Check `contradiction_runs` table: `SELECT * FROM contradiction_runs WHERE user_id = '<your-id>';` → row exists with `ran_at` timestamp
- [ ] If ran within last 7 days: subsequent Examiner POST skips rerun → logs `skipped_recent_run`
- [ ] `force: true` in POST body to `/api/mirror/contradictions` bypasses the 7-day throttle (for testing)

---

## 5. API-level checks

- [ ] `GET /api/mirror/contradictions` without auth → 401
- [ ] `GET /api/mirror/contradictions` with auth, no mirror_access → 403
- [ ] `GET /api/mirror/contradictions` with auth + mirror_access → 200 with `{ contradictions, sessionCount, meetsThreshold, threshold: 40, lastRanAt }`
- [ ] `DELETE /api/mirror/contradictions?id=<valid-id>` → 200 `{ ok: true }`
- [ ] `DELETE /api/mirror/contradictions?id=<another-user-id>` → updates 0 rows (RLS protects cross-user)
- [ ] `POST /api/mirror/contradictions` with `{ sessionId: '<valid-id>' }` → resolves user_id from session, runs detection, returns `{ ok: true, found: N, inserted: M }`

---

## 6. Regression checks

- [ ] Mirror page loads without error for all gate states (auth / threshold / paywall / unlocked)
- [ ] Decision Timeline, Bias Fingerprint, Independence Score, Decision Rules all still render
- [ ] Examiner submit still completes normally — contradiction trigger is fire-and-forget (non-blocking)
- [ ] Home page, record page unaffected
