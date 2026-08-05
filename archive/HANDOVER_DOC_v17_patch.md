# Handover Doc Patch — apply to HANDOVER_DOC_v17.md
# Three targeted edits. No other sections change.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 1 — Header status line
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND:
### Date: May 2026 | Status: Sprint 16c complete (context show more · anti-template-repetition prompt · persona progressive disclosure · examiner question subtext)

REPLACE WITH:
### Date: May 2026 | Status: Sprint 16c complete (context show more · anti-template-repetition prompt · examiner question subtext · Fix 2 progressive disclosure reverted)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 2 — Codebase map: PersonaPanel.tsx entry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND:
  PersonaPanel.tsx         — ✅ Sprint 16c — responseExpanded state + PREVIEW_LENGTH=200; shows first 200 chars on done with "Read full analysis →" expand button; also Sprint 16b: onShareContext, contextShared, StatusBadge pushback states

REPLACE WITH:
  PersonaPanel.tsx         — ✅ Sprint 16b — onShareContext, contextShared, StatusBadge pushback states ("Reading your challenge…" / "Responded"). Fix 2 progressive disclosure was implemented then reverted (Sprint 16c) — full response renders always; natural scroll is the right UX at 140–170 word constraint.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 3 — Sprint history: 16c row
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND:
| **16c** | **Context show more toggle. Anti-template-repetition instruction in personas. Fix 2: persona card progressive disclosure (200-char preview). Fix 6 (revised): examiner question subtext with RULE_HINTS map. — Testing in progress** |

REPLACE WITH:
| **16c** | **Context show more toggle. Anti-template-repetition instruction in personas. Examiner question subtext with RULE_HINTS map. Fix 2 progressive disclosure implemented and reverted — full text always shown. — ✅ Deployed** |


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 4 — Current status: remove Fix 2 block entirely
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND AND DELETE this entire block (heading + 3 paragraphs):

#### Fix 2 — Persona card progressive disclosure (PersonaPanel.tsx)

**Problem:** Full persona responses (140–170 words per design) rendered immediately on done state, creating a wall of text in the six-card grid. Users scanned rather than read, and perceived density before engagement.

**What changed:** New `responseExpanded` boolean state and `PREVIEW_LENGTH = 200` constant. During streaming, the full accumulating response renders as before — no truncation in-flight. On `panelState === 'done'`, if response exceeds 200 chars, the card shows the first 200 chars trimmed at word boundary with `…`, plus a gold "Read full analysis →" button below. Clicking sets `responseExpanded = true`, showing full text and flipping the button to "↑ Collapse". Exchanges (pushback replies) and examiner update blocks are not affected by this state. **Edge case:** the 200-char cut is character-based not word-based — if mid-word truncation appears in testing, change `.trimEnd() + '…'` to `.replace(/\s+\S*$/, '') + '…'` for a word-boundary cut.

REPLACE WITH:

#### Fix 2 — Persona card progressive disclosure (reverted)

Implemented (200-char preview + "Read full analysis →" expand) and reverted in the same sprint. Decision: the 140–170 word prompt constraint already caps card height to ~8–10 lines — not a wall. Truncation introduced a mandatory click at the highest-value moment (reading a new insight) on every card, every session. The right long-term solution to perceived grid density is ontology-driven card reordering (backlog), not content hiding. Full response renders always; natural page scroll handles the grid.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 5 — Design decisions: remove #31 (progressive disclosure), renumber
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND AND DELETE this entry entirely:
31. **Persona progressive disclosure (Sprint 16c): PREVIEW_LENGTH = 200 chars is a character cut, not word-boundary. If mid-word truncation appears in testing, change to `.replace(/\s+\S*$/, '')` cut. The constant is defined inside the component — do not move to a shared config.**

Then renumber the remaining entries that follow (32→31, 33→32, 34→33):

OLD 32 → NEW 31:
**Examiner RULE_HINTS (Sprint 16c): defined at module level in ExaminerPanel.tsx. Gap questions use `q.gap` text directly (already descriptive from the tagger). Rule questions use the RULE_HINTS map. R11 is intentionally absent (not live). Fallback string is "Your answer helps the Council refine its assessment." — do not remove the fallback.**

OLD 33 → NEW 32:
**Context "show more" threshold (Sprint 16c): 120 chars, lower than Decision's 220, because context is rendered at font-size 12 in a single-line container. Do not align both thresholds — they serve different container sizes.**

OLD 34 → NEW 33:
**R7 fires correctly on information-driven decisions with DDI ≥ 4 and outcome_uncertainty ≥ 4 even when upstream dependency is ambiguous. This is by design — if specific missing information would change the decision, synthesis before gathering it is misleading. Do not lower the R7 DDI threshold.**


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 6 — Pending section: remove Fix 6 original + Fix 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND AND DELETE these two lines from the PENDING section:
- **Fix 6 original:** Confidence slider — one line of context copy below slider; outcome nudge in Memory Engine section after 3+ sessions with no logged outcomes
- **Share context Tier 2:** Standalone "Add context for all advisors" input field (not tied to a pushback exchange)

NOTE on Fix 6: confidence slider already has sufficient context copy on the home page ("This is your baseline. After the decision plays out, we'll measure how your confidence shifted — and what that pattern reveals about your judgment over time."). No further work needed. Closing permanently.

REPLACE WITH just:
- **Share context Tier 2:** Standalone "Add context for all advisors" input field (not tied to a pushback exchange)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH 7 — Sprint 16c test log: remove Fix 2 (P1–P6) test cases
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIND AND DELETE these six rows from the Sprint 16c test log table:
| P1 | Persona card on done: first 200 chars shown, text ends with "…" | 🔲 |
| P2 | "Read full analysis →" button present when response > 200 chars | 🔲 |
| P3 | Click expand → full response visible, button reads "↑ Collapse" | 🔲 |
| P4 | During streaming → full response renders (no truncation in-flight) | 🔲 |
| P5 | Pushback reply and examiner update blocks not affected by expand state | 🔲 |
| P6 | Response exactly ≤ 200 chars → no expand button shown | 🔲 |
