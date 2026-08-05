# HANDOVER_DOC — v28 → v29 Patch Diff
### Session: May 30, 2026 | Covers Sprints 32–34 (UI Polish + Bug Fixes)

Apply each block in order. `---` = remove / replace. `+++` = add / replacement.

---

## [1] HEADER

---
```
# QUORUM — Handover Document v28
### Date: May 2026 | Status: Sprint 31 fully deployed (all Sprint 31 items confirmed in latest code zip)
```

+++
```
# QUORUM — Handover Document v29
### Date: May 30, 2026 | Status: Sprints 32–34 deployed (UI polish, hero card glass, persona panel redesign, synthesis output fixes)
```

---

## [2] CODEBASE MAP — globals.css entry

---
```
  globals.css              — ✅ Sprint 31 — --bg-void: #060c1a (deep navy), --bg-deep: #0a1222;
                             --gold: #d4a843 (brighter dark mode); @keyframes spin + pulseGold
                             Sprint 29 — DM Sans token, .home-two-col, type refinements
```

+++
```
  globals.css              — ✅ Sprint 32 — Dark token refine: --bg-void #080f1c, --bg-card #101827,
                             --bg-card-alt #151e2f, --bg-deep #0b1220, --border-dim #202b40,
                             --border-mid #2b3a55, --text-3 #8d9aaf, --text-4 #66738a.
                             Dark mode body radial gradient (fixed selector: html[data-theme="dark"]).
                             .hero-card class (dark: glass gradient; light: var(--bg-card)).
                             .card-bloom class (hidden in light via [data-theme="light"] .card-bloom).
                             Light mode warm vignette gradient on html[data-theme="light"] body.
                             --accent-contrarian/risk/pattern/stakeholder/elder/competitor added.
                             --tts-btn-color/border/bg, --tts-stop-color tokens (dark + light values).
                             btn-primary: gradient + dark text (#101318) + box-shadow.
                             Input focus ring: rgba(122,162,216,0.14) (was greenish rgba(52,77,128,0.22)).
                             Sprint 31 — --bg-void: #060c1a, --gold: #d4a843; @keyframes spin + pulseGold
                             Sprint 29 — DM Sans token, .home-two-col, type refinements
```

---

## [3] CODEBASE MAP — page.tsx entry

---
```
  page.tsx                 — ✅ Sprint 31 — onboarding 3-panel card (isOnboarding, onboardPanel,
                             quorum_onboarded gate); PatternSurfaceCard + RecurringConditionCard
                             wired; mirrorUnlocked fetched; pattern dimensions fetched from
                             /api/mirror/patterns; spacing fixes; onboarding panel text sizes;
                             advisor caption updated
                             Sprint 30 — QUORUM flip-card, Judgment Record strip, mirrorUnlocked,
                             clamp heights, history show-more (HISTORY_PREVIEW=5), Open/Logged tabs
                             Sprint 29 — fixed navbar, persona pill strip, tips collapsible,
                             history fade-in. DM Sans.
```

+++
```
  page.tsx                 — ✅ Sprint 34 — Hero card border: 2px solid var(--gold-dim).
                             Sprint 33 — overflowX: 'clip' removed from flip-card wrapper (was
                             clipping card box-shadow on left/right edges on mobile).
                             Sprint 32 — Hero card: dark glass treatment (linear-gradient rgba +
                             backdropFilter blur(20px)), className="card-back-inner hero-card".
                             Radial bloom div (className="card-bloom") behind card; bloom suppressed
                             in light mode via CSS. Bloom uses top/left/right/bottom (no negative
                             horizontal inset — avoids mobile centering shift).
                             Sprint 31 — onboarding 3-panel card; PatternSurfaceCard +
                             RecurringConditionCard wired; mirrorUnlocked; pattern dimensions.
                             Sprint 30 — QUORUM flip-card, Judgment Record strip, clamp heights.
                             Sprint 29 — fixed navbar, persona pill strip, tips collapsible.
```

---

## [4] CODEBASE MAP — PersonaPanel.tsx entry

---
```
  PersonaPanel.tsx         — ✅ Sprint 27 — lens→header sub-line; position→unlabeled body-top;
                             realcost→italic closing. Sprint 25/24b/23c as noted
```

+++
```
  PersonaPanel.tsx         — ✅ Sprint 34 — Examiner update (Share to All Advisors) now calls
                             stripHeaderTags(acc) before setExaminerUpdate() and in fullContent
                             save. stripHeaderTags added to examiner useEffect dep array.
                             This was the only code path not stripping <lens>/<position>/<realcost>
                             tags — initial response and pushback replies were already clean.
                             Sprint 32 — ACCENT_COLORS values updated (more muted, readable as
                             left-rail accents). Header redesigned: full-color block → dark neutral
                             var(--bg-card-alt) + borderLeft: 3px solid accentColor on outer card.
                             Icon container uses accentColor at 13%/33% opacity (not white overlay).
                             TTS strip footer: full-color → var(--bg-card-alt). Button colors use
                             --tts-btn-color/border/bg/stop-color tokens (theme-aware).
                             Sprint 27 — lens→header sub-line; position→unlabeled body-top;
                             realcost→italic closing. Sprint 25/24b/23c as noted.
```

---

## [5] CODEBASE MAP — lib/personas.ts entry

---
```
  personas.ts              — ✅ Sprint 26 — RESPONSE STRUCTURE header tag reminder all 6 personas.
                             Sprint 25 — WORD_LIMIT_PREFIX constraint 0 (header tags). SYNTHESIS TRADE-OFF block.
                             Sprint 21 — USER_STYLE_BOOSTS constant. computePersonaOrder() userStyle param.
                             Sprint 20 — DECISION_BRIEF DECISION-MAKER OBSERVATION block.
```

+++
```
  personas.ts              — ✅ Sprint 34 — SYNTHESIS prompt: PATTERN OBSERVATION section now
                             includes explicit "CRITICAL: Do NOT write 'PATTERN OBSERVATION:' as a
                             label or header — begin directly with the natural-language opener."
                             Prevents the AI from copying the internal section name into output.
                             Sprint 26 — RESPONSE STRUCTURE header tag reminder all 6 personas.
                             Sprint 25 — WORD_LIMIT_PREFIX constraint 0 (header tags). SYNTHESIS TRADE-OFF block.
                             Sprint 21 — USER_STYLE_BOOSTS constant. computePersonaOrder() userStyle param.
                             Sprint 20 — DECISION_BRIEF DECISION-MAKER OBSERVATION block.
```

---

## [6] CODEBASE MAP — lib/bias-scorer.ts entry

---
```
  bias-scorer.ts           — ✅ Sprint 20 — classifyBiasSignal(), getPredominantSignal()
```

+++
```
  bias-scorer.ts           — ✅ Sprint 34 — directiveBody (synthesisBlock) updated:
                             (a) explicitly bans raw bias_key output (e.g. "loss_aversion_reversal")
                             — instructs plain-language translation instead;
                             (b) explicitly forbids "LONGITUDINAL BIAS ASSESSMENT:" or any section
                             header — weave into existing prose;
                             (c) all three tiers (distorting/forming/neutral) updated consistently.
                             Sprint 20 — classifyBiasSignal(), getPredominantSignal()
```

---

## [7] SPRINT HISTORY — add rows after Sprint 31 row

+++
```
| **32** | **UI Polish: dark token refine (--bg-void #080f1c, --bg-card #101827, border/text nudges). Body radial gradient (fixed html[data-theme="dark"] selector — was broken). Hero card glass treatment + radial bloom. PersonaPanel header redesign (left rail, neutral bg). btn-primary gradient. Input focus ring. TTS strip theme-aware token system. Light mode warm vignette. — ✅ Deployed** |
| **33** | **Bug fixes: overflowX clip removed (card edge cut on mobile). Light mode bloom hidden. Card border 1.5px. TTS strip button colors readable in light mode via --tts-btn-* tokens. — ✅ Deployed** |
| **34** | **Bug fixes: card border → 2px. Examiner update (Share to All Advisors) strips lens/position/realcost tags (stripHeaderTags was missing from that code path). Synthesis output: PATTERN OBSERVATION no longer appears as a header label. LONGITUDINAL BIAS ASSESSMENT header and raw bias_key names (e.g. loss_aversion_reversal) eliminated from synthesis output. — ✅ Deployed** |
```

---

## [8] CURRENT STATUS section — replace entirely

---
```
**Active Sprint:** Sprint 32 (not started)
**Last completed:** Sprint 31 — **fully deployed** (all items confirmed in code zip as of May 30, 2026)
**Stage gate:** First paying session + one returning user — not yet met

**What is confirmed deployed (v28 QA pass):**

| File | Status | Key change |
|---|---|---|
| `app/globals.css` | ✅ | `--bg-void: #060c1a`, `--bg-deep: #0a1222`, `--gold: #d4a843` |
| `app/page.tsx` | ✅ | Onboarding panels (isOnboarding, onboardPanel, quorum_onboarded); PatternSurfaceCard + RecurringConditionCard wired; mirrorUnlocked fetch; pattern dimensions; panel text sizes (clamp 28–38px); gold labels |
| `app/api/voice/stream/route.ts` | ✅ | `enable_endpoint_detection: false`; auto-close block removed |
| `components/MemoryEngineStatus.tsx` | ✅ | `mirrorUnlocked` prop; "Mirror active" label; View Mirror → for both states |
| `components/PatternSurfaceCard.tsx` | ✅ | Real decision text; show-more; actionable; click-outside collapse; fire_count cap |
| `components/RecurringConditionCard.tsx` | ✅ | Plain language; actionable per dimension |
| `components/ContradictionBanner.tsx` | ✅ | Correct field names from API |
| `components/SessionView.tsx` | ✅ | ContradictionBanner wired; totalSessionCount; RecordReceipt; sv-navbar: `var(--bg-card)` |
| `components/ExaminerPanel.tsx` | ✅ | `\u2019` apostrophe fix |
| `components/RecordReceipt.tsx` | ✅ | (unchanged from Sprint 30) |
| `app/mirror/page.tsx` | ✅ | Sub-label; no lock icons; "Activate Mirror"; gold back button |
| `app/session/[id]/page.tsx` | ✅ | totalSessionCount; no duplicate notFound |
| `lib/types.ts` | ✅ | `decision_type_primary`, `stakes_reversibility` on Session |

**One fix applied in v28 QA (not in previous zip):**
- `components/SessionView.tsx` — `.sv-navbar` background was still `var(--bg-deep)` in the uploaded zip despite being marked deployed in v27. Correct value `var(--bg-card)` is in the file provided above.
```

+++
```
**Active Sprint:** Sprint 35 (not started)
**Last completed:** Sprint 34 — **fully deployed** (May 30, 2026)
**Stage gate:** First paying session + one returning user — not yet met

**What is confirmed deployed (v29 — Sprints 32–34):**

| File | Status | Key change |
|---|---|---|
| `app/globals.css` | ✅ | Dark token refine; body radial gradient (fixed selector); .hero-card + .card-bloom classes; --tts-btn-* tokens; btn-primary gradient |
| `app/page.tsx` | ✅ | Hero card glass + bloom; 2px gold border; overflowX clip removed |
| `components/PersonaPanel.tsx` | ✅ | Header left-rail redesign; examiner update tag stripping fixed |
| `lib/personas.ts` | ✅ | PATTERN OBSERVATION label suppressed from synthesis output |
| `lib/bias-scorer.ts` | ✅ | Plain-language bias output; LONGITUDINAL BIAS ASSESSMENT header + raw bias_key names eliminated |

**Sprint 31 confirmed deployed (v28 QA — carried forward):**

| File | Status | Key change |
|---|---|---|
| `app/globals.css` | ✅ | `--bg-void: #060c1a` (now updated to #080f1c in Sprint 32), `--gold: #d4a843` |
| `app/page.tsx` | ✅ | Onboarding panels; PatternSurfaceCard + RecurringConditionCard; mirrorUnlocked; panel text sizes |
| `app/api/voice/stream/route.ts` | ✅ | `enable_endpoint_detection: false` |
| `components/MemoryEngineStatus.tsx` | ✅ | mirrorUnlocked prop; "Mirror active"; View Mirror → |
| `components/PatternSurfaceCard.tsx` | ✅ | Real decision text; show-more; actionable; click-outside |
| `components/RecurringConditionCard.tsx` | ✅ | Plain language; actionable per dimension |
| `components/ContradictionBanner.tsx` | ✅ | Correct API field names |
| `components/SessionView.tsx` | ✅ | ContradictionBanner wired; totalSessionCount; sv-navbar var(--bg-card) |
| `components/ExaminerPanel.tsx` | ✅ | \u2019 apostrophe fix |
| `app/mirror/page.tsx` | ✅ | Sub-label; no lock icons; "Activate Mirror"; gold back button |
| `app/session/[id]/page.tsx` | ✅ | totalSessionCount; no duplicate notFound |
| `lib/types.ts` | ✅ | decision_type_primary, stakes_reversibility on Session |
```

---

## [9] SPRINT 31 TEST LOG — update B1

---
```
| B1 | Dark mode background | Deep navy tint visible (#060c1a) — not pure black |
```

+++
```
| B1 | Dark mode background | Deep navy tint visible (#080f1c) — not pure black; radial gradient at top visible |
```

---
Add these rows to Sprint 31 Test Log table (or create a new Sprint 32–34 Test Log section):

+++
```
## SPRINT 32–34 TEST LOG

| # | Test | Expected |
|---|---|---|
| UI1 | Dark mode — hero card | Glass effect: translucent dark gradient, gold border 2px, soft top-edge highlight |
| UI2 | Dark mode — page background | Subtle radial navy bloom at top; not flat black |
| UI3 | Dark mode — persona cards | Dark neutral header (not saturated red/blue/green); 3px coloured left rail; muted icon |
| UI4 | Dark mode — CTA button | Warm gold gradient (#D2B66B → #B89445), dark text (#101318), visible box-shadow |
| UI5 | Light mode — hero card | Clean white card (var(--bg-card)), not dark glass |
| UI6 | Light mode — page background | Warm cream vignette; no dark blue bloom |
| UI7 | Light mode — TTS strip | "Read aloud", "Stop", "1.5×" text legible (dark text on cream bg) |
| UI8 | Mobile — hero card | Card centered correctly; no edge clipping; bloom present in dark, absent in light |
| FX1 | Share to All Advisors → Risk Architect | Response shows no raw <lens>, <position>, <realcost> tags |
| FX2 | Share to All Advisors → Elder | Same — no raw XML tags |
| FX3 | Share to All Advisors → Competitor | Same — no raw XML tags |
| FX4 | Council Synthesis | No "PATTERN OBSERVATION:" header label visible in output |
| FX5 | Council Synthesis (user with confirmed bias) | No "LONGITUDINAL BIAS ASSESSMENT:" header; no raw bias key like "loss_aversion_reversal" in text |
| FX6 | Council Synthesis (user with confirmed bias) | Bias observation is woven into prose in plain language |
```

---

## [10] PENDING section — close item 3

---
```
3. **Background visual identity** — User requested a background that signals "longitudinal judgment compounding over time" beyond a flat tint. Option shortlisted: warm radial vignette `radial-gradient(ellipse at 50% 20%, #120d08 0%, #070503 100%)` for warm-emergence feel, or SVG hexagonal tessellation (gold-tinted, very subtle) for structural depth. Neither implemented yet — decision pending from user.
```

+++
```
3. **Background visual identity** — ✅ RESOLVED Sprint 32. Implemented: navy radial gradient on body (dark mode), warm cream vignette (light mode), glass card treatment on hero card, dedicated .card-bloom radial behind card.
```

---

## [11] KEY DESIGN DECISIONS — add new entries after #78

+++
```
79. **Hero card background is theme-aware via CSS class, not inline style.** [data-theme="dark"] .hero-card = glass gradient; [data-theme="light"] .hero-card = var(--bg-card). Inline style must not set background — CSS class wins cleanly.
80. **Card bloom (.card-bloom) is hidden in light mode via CSS.** Warm cream bg needs no extra depth layer. Dark-only: radial-gradient(ellipse at 50% 48%, rgba(22,42,88,0.72)...).
81. **Bloom div uses top/left/right/bottom=0 (no negative horizontal inset).** inset: '-80px -100px' caused mobile centering shift by extending scrollable area. Kept vertical overflow only.
82. **overflowX: clip on flip-card wrapper was removed.** It clipped box-shadow at card edges. Centering issue was the bloom's negative inset — fixed at source, not with clip.
83. **PersonaPanel ACCENT_COLORS are now rail accent values, not background fill values.** Left-border 3px rails at partial saturation look premium; full-header blocks read as gaming dashboard. Do not revert to header blocks.
84. **TTS strip button colors use --tts-btn-color/border/bg/stop-color CSS tokens, not hardcoded rgba(255,255,255,*).** White hardcodes were invisible on light mode cream background. Token values: dark → white-ish rgba; light → var(--text-2)/var(--border-mid).
85. **Examiner update (Share to All Advisors) must call stripHeaderTags() before setExaminerUpdate() and before saving fullContent.** Initial response and pushback both stripped correctly; examiner update was the sole missing path. All three code paths now strip.
86. **Synthesis must never output "PATTERN OBSERVATION:" or "LONGITUDINAL BIAS ASSESSMENT:" as section headers.** Both are internal prompt section names, not output labels. PATTERN OBSERVATION instruction now includes explicit CRITICAL note. directiveBody in bias-scorer.ts now forbids both the header and raw bias_key names.
87. **Raw bias_key names (e.g. loss_aversion_reversal) must never appear in synthesis output.** directiveBody now instructs plain-language translation. Example canonical translation: "a tendency to weigh the regret of missing out more heavily than the risk of a concrete loss."
```

---

## [12] RESOLVED / CLOSED — add sprint 32–34 items

After the existing Sprint 31 resolved block, add:

+++
```
- **Sprint 32–34 items** → ✅ All deployed May 30, 2026:
  - Dark token values nudged (--bg-void #080f1c, surfaces #101827/#151e2f, borders #202b40/#2b3a55)
  - Body radial gradient — selector was broken ([data-theme="dark"] html never matched; fixed to html[data-theme="dark"])
  - Hero card glass treatment + .hero-card CSS class
  - .card-bloom radial div (dark only)
  - PersonaPanel header: full-color block → left rail + dark neutral bg
  - TTS strip: theme-aware button color tokens
  - btn-primary: warm gold gradient, dark text
  - Input focus ring: calibrated navy-blue
  - overflowX: clip removed from card wrapper (was cutting shadows on mobile)
  - Light mode: bloom hidden, warm cream vignette added
  - Card border: 2px solid var(--gold-dim)
  - Examiner update tag stripping: stripHeaderTags() added to examiner useEffect code path
  - Synthesis PATTERN OBSERVATION: no longer appears as a header label in output
  - Synthesis bias section: no LONGITUDINAL BIAS ASSESSMENT header; no raw bias_key names
```
