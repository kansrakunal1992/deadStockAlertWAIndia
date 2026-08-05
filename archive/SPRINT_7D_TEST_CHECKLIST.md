# Sprint 7d — Test Checklist

## 1. Behavioral Alerts (home page)

**Setup required:** At least 1 confirmed bias in `bias_library` (`detection_count >= 2`) for an authenticated user. If you don't have one naturally, temporarily `UPDATE bias_library SET detection_count = 2 WHERE user_id = '<your-user-id>' LIMIT 1;`

### Tests

- [ ] **Not shown when logged out** — Sign out, load home page, type decision text. No alert should appear at any point.

- [ ] **No alert on short text** — Log in, type fewer than 15 characters. No alert appears.

- [ ] **800ms debounce fires** — Type a decision containing a keyword from an activation context (e.g. "deadline", "urgent", "financial stake", "family", "commitment"). Wait ~1 second. Alert card appears below context section.

- [ ] **Alert shows correct bias name** — Alert header shows the `biasLabel` matching the detected bias (e.g. "FOMO / Manufactured Urgency").

- [ ] **Alert shows correct detection count** — Body text reads "has been active in N of your past decisions".

- [ ] **Mirror CTA link works** — Click "See your full pattern profile in Mirror →". Navigates to `/mirror`.

- [ ] **Dismiss works** — Click ×. Alert disappears. Typing more text matching the SAME bias does NOT re-trigger it (dismissed per session).

- [ ] **Different bias can still fire after dismiss** — If there's a second confirmed bias with different keywords, typing text matching it DOES re-trigger a new alert.

- [ ] **No alert when no keyword match** — Type neutral decision text (e.g. "I need to choose a paint colour for the office"). No alert appears.

- [ ] **No API error in console** — `/api/mirror/alerts` returns 200 with `{ alerts: [] }` or `{ alerts: [...] }`. No 4xx or 5xx.

- [ ] **Silently fails on network error** — Disconnect network before load, then reconnect. No error shown to user; just no alert.

---

## 2. Decision Rules (Mirror page — Unlocked view)

**Setup required:** Authenticated, mirror_access row exists, session count varies per sub-test.

### Tests — Threshold gate

- [ ] **Gate shown when sessionCount < 8** — Log in with user that has 5–7 sessions + mirror_access. Open Mirror. In the Decision Rules section, shows "N more decisions to unlock" with a mini progress bar.

- [ ] **Progress bar is accurate** — With 6 sessions, 6 of 8 segments filled; 2 remaining are dimmed.

### Tests — Unlocked (≥ 8 sessions)

- [ ] **Skeleton shows during load** — Rules section shows 3 pulsing bar rows while the API call is in flight. (Test by throttling network to Slow 3G momentarily.)

- [ ] **Rules render correctly** — Each rule is on its own row with a left gold accent bar and no bullet point. Font is `var(--text-1)`, 13.5px.

- [ ] **Footer text is accurate** — Shows "Extracted from N decisions · based on your Examiner responses and challenges to the Council".

- [ ] **No error if user has no examiner data** — User with ≥8 sessions but no examiner_responses (all skipped). Component shows the `insufficient_examiner_data` message, not an error.

- [ ] **Section header present** — "DECISION RULES" header (uppercase, 13px) with "From N decisions" right-aligned, visible in the Mirror unlocked view.

- [ ] **Descriptive intro copy shown** — "The operating principles you implicitly follow…" paragraph is visible above the card.

- [ ] **Error boundary does not break page** — Simulate a 500 from `/api/mirror/rules` (add `return NextResponse.json({ error: 'test' }, { status: 500 })` temporarily). Decision Rules section shows error copy; Timeline, Fingerprint, and Independence Score remain visible and functional.

### API-level checks

- [ ] **401 if no auth token** — `curl /api/mirror/rules` without Authorization header returns `{ "error": "Unauthorized" }` with status 401.

- [ ] **403 if no mirror_access** — Authenticated user without mirror_access row gets `{ "error": "Mirror access required" }` with status 403.

- [ ] **`rules: null` if below threshold** — Authenticated user with mirror_access but < 8 sessions gets `{ "rules": null, "sessionCount": N, "threshold": 8 }` with status 200.

- [ ] **Rules array returned correctly** — User with ≥8 sessions + examiner data: response is `{ "rules": [...], "sessionCount": N, "basedOnDecisions": M }`.

---

## 3. Polish pass

- [ ] **Skeleton loaders all working** — All three Mirror async sections (Fingerprint, Independence Score, Rules) show skeleton state while loading. Verify on first load on slow connection.

- [ ] **Error boundary: Fingerprint failure does not break Timeline or Rules** — Confirm Independence Score and Rules still render even if Fingerprint fetch fails.

- [ ] **Mobile at 390px** — Open DevTools, set to iPhone 14 (390px). Check:
  - BehaviorAlerts card: text doesn't overflow; × button accessible
  - Mirror page: all section headers readable, cards don't clip
  - DecisionRules card: left accent bars visible, rule text wraps cleanly

- [ ] **Empty locked state copy in Paywall gate** — Load Mirror as paywall user. The locked Bias Fingerprint section and the ₹4,999 CTA card read cleanly. No reference to Decision Rules in paywall view (Rules is unlocked-only).

- [ ] **Mirror page subtitle correct** — For unlocked state: "Your behavioral patterns across all decisions." should still show.

---

## 4. Regression checks

- [ ] **Home page submit still works** — Type decision, convene council. No regressions from BehaviorAlerts addition.

- [ ] **Auth flow unchanged** — Magic link, callback, session — no regressions.

- [ ] **Bias Fingerprint still renders** — In unlocked Mirror view, Fingerprint section still loads and shows tiles.

- [ ] **Independence Score still renders** — Score card, delta, band label all present in unlocked view.

- [ ] **Decision Timeline still renders** — All sessions visible; cross-session stripe still appears on matching bias keys.
