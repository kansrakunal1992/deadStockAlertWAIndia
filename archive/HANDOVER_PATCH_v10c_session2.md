# HANDOVER DOC — Patch v10c (Session 2)
> Applied: May 7, 2026
> Covers all changes made post HANDOVER_DOC_v10_final.md

---

## FILES CHANGED — QUICK REFERENCE

| File | Change |
|---|---|
| `lib/personas.ts` | Word limit 220–280 → 140–170 |
| `components/PersonaPanel.tsx` | Challenge button moved to header |
| `components/RecordExport.tsx` | Brief = main body, council = Appendix (client-side PDF) |
| `components/SessionView.tsx` | "Save Record → PDF" renamed "Save to Record" (both instances) |
| `components/ReanalyzeDrawer.tsx` | **NEW** — client component with full drawer for record page |
| `app/record/[id]/page.tsx` | RecordExport removed; ReanalyzeDrawer added (2 placements); Reanalyze near OutcomeTracker |
| `app/api/record/[id]/brief/route.ts` | Full rewrite — dark theme, markdown renderer, forced page break, ALL CAPS headers, duplicate heading strip, auto-generate brief if missing |

---

## CHANGE 1 · Persona Word Limit

**File:** `lib/personas.ts` · `WORD_LIMIT_PREFIX` constraint #2

```
140–170 words (was 220–280)
+ "Every sentence must earn its place."
```

Models overshoot by 30–40%. 140–170 instruction → ~195–200 output.
Synthesis hard cap 180 words — unchanged.

---

## CHANGE 2 · Challenge Button → Header

**File:** `components/PersonaPanel.tsx`

- Moved from full-width footer button → compact gold pill in header row (top-right, beside ✓ badge)
- Only visible when `panelState === 'done'`
- Textarea/send still appears at card bottom when triggered
- Button auto-hides once `showPushback = true`
- Label: "Challenge · add context" (shortened to fit pill)

**DO NOT revert:** Cognitive friction moment happens during reading, not after scrolling.

---

## CHANGE 3 · PDF Structure (client-side RecordExport)

**File:** `components/RecordExport.tsx`

New order:
```
Cover
Section 1: DECISION BRIEF (main body)
Appendix divider page
  └─ Synthesis
  └─ 6 advisor personas
```

`hasAppendix` guard prevents dangling divider if no persona messages exist.

**The client-side RecordExport button is removed from the record page.**
Only `BriefCTA` ("Get Brief") is the export path now.

---

## CHANGE 4 · "Save to Record" Rename

**File:** `components/SessionView.tsx`

Both instances renamed:
- Top header: `"Save Record → PDF"` → `"Save to Record"`
- Bottom bar: `"Save Decision Record → Export PDF"` → `"Save to Record"`

Rationale: button saves session to DB + navigates to `/record/[id]`. Never generated a PDF — old label was wrong. Brief PDF is exclusively via "Get Brief" (paid).

---

## CHANGE 5 · ReanalyzeDrawer (NEW COMPONENT)

**File:** `components/ReanalyzeDrawer.tsx` ← NEW FILE

Client component (`'use client'`). Props: `sessionId`, `decisionText`, `contextText`.

Exact extraction of the drawer pattern from `SessionView.tsx`:
- Same bottom-slide drawer with editable decision textarea
- Same optional context textarea
- Same Challenge / Understand toggle
- On submit: `POST /api/session` → creates new session → `router.push('/session/[newId]')`

Used in record page at two placements:
1. Below `OutcomeTracker` (flush-right, small ghost button)
2. Bottom bar (alongside "New decision")

**DO NOT use `<Link href="/session/[id]">` for Reanalyze anywhere.** That re-opens the old session, not a new one. ReanalyzeDrawer always creates a new session with pre-filled text.

---

## CHANGE 6 · Record Page Cleanup

**File:** `app/record/[id]/page.tsx`

- Removed: `import RecordExport` + both `<RecordExport>` renders
- Added: `import ReanalyzeDrawer`
- Added: `<ReanalyzeDrawer>` near OutcomeTracker + bottom bar
- Existing: `<BriefCTA>` retained as the only PDF export
- `Link` import retained (used for "New decision" → `/`)

---

## CHANGE 7 · Brief Route — Full Rewrite (v3)

**File:** `app/api/record/[id]/brief/route.ts`

### 7a — Dark premium theme (replaces light theme)

```
pageBg:     [4, 6, 15]      — deep navy
briefBg:    [8, 18, 8]      — dark green for brief header band
synthBg:    [15, 22, 15]
gold:       [201, 168, 76]
bodyText:   [188, 200, 220]
mutedText:  [74, 85, 104]
```

Per-persona accent colours (match UI dark theme):
```
contrarian:         [60, 18, 18]
risk_architect:     [11, 22, 56]
pattern_analyst:    [11, 32, 22]
stakeholder_mirror: [28, 12, 46]
elder:              [38, 24, 8]
competitor:         [22, 16, 6]
```

### 7b — Critical bug fix: font before splitTextToSize

Every `splitTextToSize` call now has `setFont()` + `setFontSize()` immediately before it.

**Root cause of text clipping:** jsPDF uses the currently active font's metrics for wrapping. If a bold header was drawn immediately before, `splitTextToSize` calculated line breaks using bold metrics but text rendered in normal (narrower) — causing 3–4 chars to be silently cut per line.

### 7c — Markdown renderer (`renderMarkdown`)

For `decision_brief` messages only. Handles:

| Pattern | Rendering |
|---|---|
| `**bold**` inline | Helvetica Bold segment, inline x-tracking |
| `*italic*` inline | Helvetica Italic segment |
| `---` | Thin gold horizontal rule |
| `- item` / `• item` | Gold bullet dot + indented text |
| `1. item` | Gold numbered label + indented text |
| `**Heading**` (full line) | Larger bold, body colour |
| ALL CAPS line | Gold bold + short underline rule (e.g. KEY INSIGHTS, RISKS) |

Prose persona messages still use `bodyBlock` (no markdown).

### 7d — Forced page break for Decision Brief

```typescript
// Before (broken):
ensure(52)  // only breaks if <52pt remain — doesn't break on short decisions

// After (fixed):
doc.addPage()
fillPageDark()
page++
Y = ML
drawFooter()
```

Decision Brief always starts on its own page. Cover page = wordmark + decision only.

### 7e — Duplicate heading strip

AI `DECISION_BRIEF` prompt makes the model echo `DECISION BRIEF` / `THE DECISION BRIEF` as its first line. Since the header band already renders this, the echo was doubling up. Regex strips it:

```typescript
const cleaned = msg.content
  .replace(/^\s*\*{0,2}(THE\s+)?DECISION BRIEF\*{0,2}\s*\n?/i, '')
  .replace(/^\s*#{1,3}\s*(THE\s+)?DECISION BRIEF\s*\n?/i, '')
  .trimStart()
```

### 7f — Decision block: line-by-line (no pre-calc box)

Old: pre-calculated `decBoxH = lines.length * lineHeight + 22`, drew rect first, then text. If decision was long, box overflowed page.

New: renders line-by-line with per-line background rect + gold left accent bar drawn after all lines are placed.

### 7g — Auto-generate decision_brief if missing

In the GET handler, before `buildPdf`:

1. Check if any `decision_brief` assistant messages exist in DB
2. If not → collect all persona messages → call `createCompletion(DECISION_BRIEF prompt + council content)`
3. Save result to `messages` table → appears on record page too
4. If generation fails → PDF renders without brief section (graceful fallback)

### 7h — PDF structure

```
Page 1:  Cover (QUORUM wordmark + date + session + THE DECISION)
Page 2+: DECISION BRIEF (always new page, dark green header band)
Page N:  APPENDIX divider (centred, blank dark page)
Page N+: Council Synthesis
Pages:   6 advisor personas (one per page)
Final:   Closing disclaimer line
```

---

## PERSONA HEADER FIX

Persona header now guarded:
```typescript
if (Y + 120 > PH - BOTTOM_MARGIN) {
  doc.addPage(); fillPageDark(); page++; Y = ML; drawFooter()
}
```

Gold rule drawn **after** `Y += hH + 6` — never overlaps header band.

---

## DO NOT REDEBATE

| Decision | Reason |
|---|---|
| Challenge button in header | Cognitive moment is during reading, not after scrolling |
| Brief always on its own page | Visual weight of a premium artifact; matches target design |
| Dark theme for PDF | Matches UI; client explicitly confirmed this is the target |
| `ensure()` → `addPage()` for brief | `ensure(52)` was always wrong for a section that must be its own page |
| `splitTextToSize` after `setFont` | jsPDF uses active font metrics — this is load-bearing, don't remove |
| Reanalyze = new session always | `/session/[id]` re-opens OLD session; ReanalyzeDrawer creates NEW |
| RecordExport removed from record page | One export path only: "Get Brief" (paid) |

---

## SPRINT STATUS UPDATE

| Sprint | Status |
|---|---|
| Sprint 1–6 | ✅ Complete |
| Sprint 7 (Mirror) | ✅ Complete |
| Sprint 8 (Decision Brief PDF) | ✅ Complete — v3 (dark theme, markdown, forced page) |
| Sprint 9 (Contradiction Detector) | ✅ Complete |
| Sprint 10a (Website) | ✅ Complete |
| Sprint 10b (Session Requests) | ✅ Complete |
| Sprint 10c (GTM) | 🔄 In progress — playbook built, outreach starting |
| Sprint 11 (Outcome Nudge Cron) | ⏳ Pending stage gate: 1 paid session + 1 returning user |

---

## STAGE GATE (before Sprint 11)

- [ ] ≥1 live session at ₹25K completed and paid
- [ ] ≥1 user who has run ≥2 sessions

Both required before Sprint 11 begins.

---

## KEY OPERATIONAL REMINDERS

- `AI_PROVIDER` env var = single switch for DeepSeek ↔ Claude. Never branch in code.
- All model calls via `lib/ai-client.ts` — never instantiate SDKs directly
- Migration order: schema → sprint1 → sprint2 → sprint3 → sprint4 → sprint4b → sprint5 → sprint6 → sprint10b
- Supabase: Refresh Token Rotation ON, JWT 30 days, Site URL = Railway production URL
- `sprint10b_session_requests.sql` must be run before website session modal works
- `BRIEF_ACCESS_TOKEN` env var gates "Get Brief" on the record page
- Raw bias scores never user-facing pre-Mirror
- Pushback text persisted to DB as first-class message event
