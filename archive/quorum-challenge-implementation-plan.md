# Challenge Discoverability — Implementation Plan
*Grounded in the live code in `PersonaPanel.tsx`, `SynthesisCard.tsx`, `SessionView.tsx`, and `WhatChangedDrawer.tsx`. Confirms the plan's own framing: most of this is already built. The gap is visibility and sequencing, not missing mechanics.*

---

## 0. What's already fully built (bigger than we assumed)

Before scoping changes, it's worth flagging: three of the things this redesign wants already exist in the codebase, functioning correctly — they're just quiet.

| Capability | Already built as | Where |
|---|---|---|
| Disagree with one advisor, get a real reply | `handlePushback` + reply textarea | `PersonaPanel.tsx`, lines 444–455, 868–892 |
| Update the whole Council with new context | "Share this context with all advisors" button | `PersonaPanel.tsx`, lines 804–844 |
| **Show that the verdict actually moved** (this is the "show the delta" idea) | `WhatChangedDrawer.tsx` — a fully working panel showing what changed, which advisors flipped position, weight shifts, and full verdict-version history | `SynthesisCard.tsx`, line 1118 |

That third one is the real surprise: the "show 2 of 6 advisors shifted" idea isn't new work — `WhatChangedDrawer` already computes and displays exactly that (see `diff.leanMoves`, "Advisor moves" section). It's just rendered as a small, low-contrast pill labeled **"Updated · v2"** that only appears after a second verdict already exists — so it's reactive, not a discoverability aid, and easy to miss for the same reason the Challenge button is.

**This changes the plan's shape:** this is mostly a *prominence and sequencing* pass, not new feature work. Confirmed real gaps below.

---

## 1. Pre vs. post — per screen

### Persona card (`PersonaPanel.tsx`)

| | Pre (today) | Post (proposed) |
|---|---|---|
| Where the disagree control sits | Top of card, in the header row, sharing space with a status badge and a mobile collapse chevron | Bottom of card, right after the analysis text — where a disagreement actually forms |
| Label | `"Challenge · add context"` | `"Disagree or ask a follow-up"` |
| Visual weight | Small gold pill, visually equal to two other small icons next to it | Full-width primary-style control, same visual weight as the page's main CTA |
| After you challenge one advisor | Nothing tells you the other five can be challenged too | A quiet, one-time line appears on the *other* cards: `"You can challenge this one too."` |

### Verdict / synthesis screen (`SynthesisCard.tsx`)

| | Pre (today) | Post (proposed) |
|---|---|---|
| Does the verdict say it's provisional? | No — nothing on the synthesis card signals this | Permanent footer line under the verdict: `"Disagree with something? Challenge any advisor above and the verdict updates."` |
| Delta visibility | `WhatChangedDrawer` already computes this correctly, but renders as a tiny, generic `"Updated · v2"` pill, and only exists after a second version | Same component, restyled to match the Challenge visual language (same accent color/icon family) and relabeled to name the outcome, e.g. `"Verdict updated · 2 advisors shifted"` when `diff.leanMoves.length > 0` |
| First-time explanation | A one-time, skippable onboarding tour tooltip (`SessionView.tsx`, line 71) that says this is "the most powerful feature on this page" | Same message, moved from a dismissible tooltip to the permanent footer above — always on screen, not a one-shot popup |

### `/record/[id]` — Reanalyze drawer

**No change.** Per your direction, "Reanalyze" naming and behavior (new, linked session) stays exactly as-is. Confirmed out of scope for this pass.

### Whole-synthesis-level push-back shortcut

**Deliberately not building this.** Per your direction, the intended path stays: challenge individual advisors → synthesis updates because it's assembled from their updated positions. No new "push back on the whole verdict at once" button. Flagged as a possible future exploration, not part of this plan.

---

## 2. Section-by-section change list

| # | File / location | Current | Change | Type |
|---|---|---|---|---|
| 1 | `PersonaPanel.tsx`, lines 587–615 (header button) | `"Challenge · add context"`, top of card, small pill among 3 header elements | Remove from header. Replace with a bottom-of-card control (see #2) | Move + restyle |
| 2 | `PersonaPanel.tsx`, new placement after line 688 (end of analysis body) | *(nothing here today)* | Add `"Disagree or ask a follow-up"` control here — same `showPushback` state and `handlePushback` logic, just relocated and restyled to primary-button weight | Copy + layout, reuses existing state |
| 3 | `PersonaPanel.tsx`, lines 804–844 ("Share this context with all advisors") | Blue/info color, network-icon, appears only after one exchange completes | Restyle to match the gold/checkmark visual language of the disagree control (same icon family, same accent) so the two read as one connected capability | Visual only — logic unchanged |
| 4 | `PersonaPanel.tsx` — new, per-card ambient hint | *(doesn't exist)* | After the user's first challenge on any card, show a small line on the *other* five cards: `"You can challenge this one too."` Dismisses per-session once used once on that card. | New, small — a boolean flag passed down from `SessionView` |
| 5 | `SynthesisCard.tsx`, after synthesis prose (~line 1105) | *(nothing here today)* | Add permanent footer line: `"Disagree with something? Challenge any advisor above and the verdict updates."` | New copy block |
| 6 | `SynthesisCard.tsx`, line 1118 (`WhatChangedDrawer`) | Collapsed pill, label `"Updated · v{N}"`, generic gray styling | Relabel to `"Verdict updated · N advisors shifted"` when applicable (data already computed via `diff.leanMoves`); restyle to the same accent used in #1–#3 | Copy + visual only — the underlying diff logic in `WhatChangedDrawer.tsx` needs no changes |
| 7 | `SessionView.tsx`, line 71 (onboarding tour copy) | One-time skippable tooltip explaining Share-to-all-advisors | Retire this specific tour step now that the explanation is permanent, on-screen text (item #5) — avoids saying the same thing twice in two different UI patterns | Removal, once #5 ships |
| 8 | `ReanalyzeDrawer.tsx` | `"Reanalyze"` label, new-session behavior | **No change** — confirmed correct as-is | N/A |

**Net new code:** items #4 (ambient hint) and #5 (footer line) are genuinely new, small pieces of UI. Everything else — #1, #2, #3, #6 — is repositioning, relabeling, or restyling controls and data that already exist and already work correctly.

---

## 3. Rollout phasing

| Phase | Scope | Why |
|---|---|---|
| **Phase 1 — Copy + restyle only** (items #3, #6) | Recolor "Share to all advisors" to match the disagree control; relabel the `WhatChangedDrawer` pill | Zero logic risk — pure visual/copy changes to existing, working components |
| **Phase 2 — Reposition the disagree control** (items #1, #2) | Move the button from card header to end of card body; relabel | Reuses the exact same `showPushback` / `handlePushback` state already in `PersonaPanel.tsx` — no new logic, just JSX placement |
| **Phase 3 — New nudges** (items #4, #5) | Ambient "you can challenge this one too" hint; permanent verdict footer | The only genuinely new UI in this plan — small, self-contained additions |
| **Phase 4 — Retire the old tour step** (item #7) | Remove the now-redundant onboarding tooltip | Do last, only once Phase 3's permanent footer has shipped and is confirmed live |

---

## 4. What this plan deliberately does not touch

- `ReanalyzeDrawer.tsx` — naming and new-session behavior confirmed correct, no changes.
- No whole-synthesis "push back on everything" button — the intended path stays advisor-by-advisor, synthesis updates as a downstream effect.
- `WhatChangedDrawer.tsx`'s underlying diff logic (`diffSynthesisVersions`, `buildLeanTrajectories`) — already correct, only its label and styling change.
- The per-advisor pushback mechanism itself (`handlePushback`, the reply textarea, the exchange rendering) — unchanged, only its position and label move.

---

## Sign-off checklist

- [ ] Approve relabeled/restyled "Share to all advisors" to match the disagree control (Phase 1)
- [ ] Approve relabeled `WhatChangedDrawer` pill copy: `"Verdict updated · N advisors shifted"` (Phase 1)
- [ ] Approve moving the disagree control from card header to end of card body (Phase 2)
- [ ] Approve new copy: `"Disagree or ask a follow-up"` (Phase 2)
- [ ] Approve new ambient hint: `"You can challenge this one too."` (Phase 3)
- [ ] Approve new permanent verdict footer: `"Disagree with something? Challenge any advisor above and the verdict updates."` (Phase 3)
- [ ] Confirm retiring the old onboarding tour step once Phase 3 is live (Phase 4)
- [ ] Confirm no changes wanted to Reanalyze or a whole-synthesis shortcut (both out of scope, as directed)
