# HANDOVER DOC v25 → v26: PATCH

## 1. Header line — replace
OLD: ### Date: May 2026 | Status: Sprint 23c complete (TTS Read Aloud — Synthesis card + all 6 persona cards · Chunked playback · Countdown timer · Pace control)
NEW: ### Date: May 2026 | Status: Sprint 26 complete (DeepSeek 503 retry · Persona header layer: Lens/Position/Real Cost · Pause TTS · Delete decision · Back to Council · Trade-off narrative in Synthesis)

---

## 2. SPRINT HISTORY TABLE — add rows after Sprint 20

| **23b** | **TTS Read Aloud — Synthesis card. REST not WebSocket. Chunked playback. Countdown timer. Pace control. — ✅ Deployed** |
| **23c** | **TTS Read Aloud — all 6 persona cards. Reuses 23b infrastructure. Bottom strip (accentColor). Singleton TTSProvider. — ✅ Deployed** |
| **24a** | **Dora session fixes: Delete decision (API + UI + localStorage). Sub-text formatting (italic, demoted). Back to Council (router.back() + BackButton component). — ✅ Deployed** |
| **24b** | **Back to Council no re-run: session/[id]/page.tsx fetches existing messages server-side; initialMessages prop threads to PersonaPanel; initialContent skips API call. TTS strip alignment: removed height:100% from .persona-card CSS. — ✅ Deployed** |
| **25** | **Pause/Resume TTS (useSonioxTTS + PersonaPanel + SynthesisCard). Persona header layer: <lens><position><realcost> tags in all 6 persona prompts; extractHeaderTags parser; body-top labeled display. Synthesis trade-off narrative block. — ✅ Deployed** |
| **26** | **DeepSeek 503 retry: withRetry() wrapper in ai-client.ts, 2 retries, 5s wait. Persona RESPONSE STRUCTURE reminder: all 6 personas reminded to output header tags before structure. — ✅ Deployed** |

---

## 3. NEW SPRINT ENTRIES — paste after Sprint 23c block, before ENVIRONMENT VARIABLES

---

# Sprint 24a · Status: ✅ Complete
Three UX fixes from Dora Suri session (May 23).

## Files modified
- `lib/storage.ts` — added `removeSessionId(id)` export. Symmetric with `pushSessionId`.
- `app/api/record/route.ts` — new `DELETE` handler. Accepts `{ sessionId }`, resolves caller from Bearer token, ownership check (user_id match or device-only), hard-deletes session row. messages/outcomes/examiner_responses cascade automatically via FK constraints.
- `app/page.tsx` — three changes: (1) `handleDeleteSession` function — optimistic UI removal + `removeSessionId` + `DELETE /api/record`; (2) `<IconTrash />` button on each session card (transparent → red on hover, stopPropagation); (3) "Six private advisors…" sub-text demoted to `fontSize:12, fontStyle:italic, color:var(--text-4)`.
- `components/BackButton.tsx` — NEW. `'use client'` component. `router.back()` on click. Used on record page to return to Council without re-navigation.
- `app/record/[id]/page.tsx` — header breadcrumb and bottom nav both use `<BackButton label="← Back to Council" />` instead of Link. Bottom nav: Back to Council | Reanalyze | New decision.

## Key decision
`router.back()` not `Link href="/session/${id}"` — back() triggers browser bfcache, restoring Council page with full React state. A forward Link href would remount and replay all useEffect hooks, re-running all 6 personas.

---

# Sprint 24b · Status: ✅ Complete
Back to Council was still re-running personas. TTS strip misaligned on equal-height grid rows.

## Back to Council no re-run
- `app/session/[id]/page.tsx` — fetches existing `messages` rows in parallel with session fetch. Builds `Record<personaKey, content>` map. Passes as `initialMessages` prop to `SessionView`.
- `components/SessionView.tsx` — `initialMessages` prop added. `completedResponses` state seeded from it (status bar + synthesis gate count correctly). Passes `initialContent={initialMessages[key]}` to each `PersonaPanel`.
- `components/PersonaPanel.tsx` — `initialContent` prop added. `response` state and `responseRef` seeded from it. `panelState` initialised as `'done'` when content present. Mount effect returns early — no API call fires. New decisions have empty `initialMessages` → all 6 personas fire fresh as normal.

## TTS strip alignment
- `app/globals.css` — removed `height: 100%` from `.persona-card`. Cards were stretching to equal row height; body hit `maxHeight: 380` cap; dead space opened between body and TTS strip. Natural card height removes the gap. `maxHeight: 380` and scroll window preserved.

---

# Sprint 25 · Status: ✅ Complete
Pause/Resume TTS. Persona header layer (Lens/Position/Real Cost). Synthesis trade-off narrative.

## Pause/Resume TTS
- `hooks/useSonioxTTS.ts` — `isPaused` state, `pause()` (`audioRef.current.pause()`), `resume()` (`audioRef.current.play()`), `stopInternal()` resets `isPaused`. All exposed in hook interface.
- `components/PersonaPanel.tsx` — TTS strip button becomes three-state: Read aloud → Pause (while playing) → Resume (while paused). Separate Stop button appears alongside while active.
- `components/SynthesisCard.tsx` — same Pause/Resume/Stop pattern applied to synthesis Read aloud button.

## Persona header layer
Three XML tags added to every persona prompt (via `WORD_LIMIT_PREFIX` constraint 0):
- `<lens>` — the specific angle this advisor is looking through. Plain English, max 8 words.
- `<position>` — advisor's verdict on this specific decision. Direct, no hedging.
- `<realcost>` — concrete real-world consequence the decision-maker will feel. Full sentence, personal to this decision. Not a category label.

`extractHeaderTags()` in `PersonaPanel` strips tags from streamed output, sets state, returns clean prose. Tags render at top of card body as labeled lines (Lens: / Position: / The real cost:), bold label + normal-weight value, consistent 12px, thin divider before prose. Sub-header band removed entirely.

Each persona's `RESPONSE STRUCTURE` block updated with: "Before this structure begins: output the mandatory <lens>, <position>, and <realcost> header tags as required by constraint 0 above."

`initialContent` hydration also routes through `extractHeaderTags` so Back to Council renders header correctly.

## Synthesis trade-off narrative
`SYNTHESIS` prompt gains `TRADE-OFF SUMMARY` block — always-present, always last, 60-word cap. Narrative prose covering 2–3 dimensions: what following the council's lean costs, what rejecting it preserves. Not a list, not category labels.

## Files modified
- `lib/personas.ts` — WORD_LIMIT_PREFIX constraint 0 (header block). All 6 persona RESPONSE STRUCTURE sections (header reminder). SYNTHESIS TRADE-OFF SUMMARY block.
- `components/PersonaPanel.tsx` — extractHeaderTags, lensText/positionText/realCostText state, body-top render, pause/resume TTS.
- `hooks/useSonioxTTS.ts` — isPaused, pause(), resume().
- `components/SynthesisCard.tsx` — pause/resume/stop TTS.

---

# Sprint 26 · Status: ✅ Complete
DeepSeek 503 resilience. Persona RESPONSE STRUCTURE tag compliance fix.

## DeepSeek 503 retry
- `lib/ai-client.ts` — `withRetry<T>(fn, label)` wrapper. Detects 503 via `status === 503 || code === 'service_unavailable_error'`. Retries up to `MAX_503_RETRIES = 2` times with `RETRY_WAIT_MS = 5000ms` wait. Both DeepSeek call sites wrapped: `streamDeepSeek` and `createCompletion`. Anthropic paths untouched. Logs warn on each retry attempt.

**Root cause diagnosed:** DeepSeek API returns 503 during peak hours (standard tier capacity). Previously caused permanent `tagger_status = failed` on ontology (no retry), all 6 personas to surface errors to user, structural context never loading for that session.

## Persona tag compliance fix
The Contrarian was skipping `<lens><position><realcost>` output because its `RESPONSE STRUCTURE` section says "Never deviate from it / Opening line: A single direct statement" — model treated this as line 1 and skipped tags. All 6 personas now have an explicit reminder inside RESPONSE STRUCTURE: output tags before the structure begins. Fixed in `lib/personas.ts` (6 targeted inserts, no other changes).

---

## 4. CODEBASE MAP — add/update entries

### lib/ section — add:
```
  ai-client.ts             — ✅ Sprint 26 — withRetry() wrapper for DeepSeek 503.
                             MAX_503_RETRIES=2, RETRY_WAIT_MS=5000. Both streamDeepSeek
                             and createCompletion wrapped. Anthropic paths unchanged.
  personas.ts              — ✅ Sprint 25/26 — WORD_LIMIT_PREFIX: constraint 0 (header block:
                             <lens><position><realcost> tags, plain-English instructions with
                             counter-examples). All 6 persona RESPONSE STRUCTURE sections:
                             header reminder added. SYNTHESIS: TRADE-OFF SUMMARY block added
                             (always-last, 60-word cap, narrative prose). Also Sprint 21/20 above.
  storage.ts               — ✅ Sprint 24a — removeSessionId(id) export added.
```

### app/api/ section — add:
```
  record/route.ts          — ✅ Sprint 24a — DELETE handler added. Ownership check
                             (user_id match or device-only). Cascade delete via FK.
  session/[id]/page.tsx    — ✅ Sprint 24b — fetches existing messages in parallel with
                             session fetch. Builds initialMessages Record<personaKey, content>.
                             Passed as prop to SessionView.
```

### components/ section — add:
```
  BackButton.tsx           — ✅ Sprint 24a NEW — 'use client'. router.back() on click.
                             Used on record/[id]/page to return to Council without remount.
  PersonaPanel.tsx         — ✅ Sprint 25/24b — extractHeaderTags(): strips <lens><position>
                             <realcost> from stream, sets state, returns clean prose.
                             Body-top render: labeled italic lines + divider.
                             initialContent prop: skips API call, seeds responseRef.
                             Pause/Resume/Stop TTS buttons in strip.
                             Also Sprint 24b: initialContent hydration.
  SynthesisCard.tsx        — ✅ Sprint 25 — Pause/Resume/Stop TTS. Same three-state
                             pattern as PersonaPanel. Also Sprint 19/22 above.
  SessionView.tsx          — ✅ Sprint 24b — initialMessages prop. completedResponses
                             seeded from it. initialContent passed to each PersonaPanel.
```

### app/ section — add:
```
  record/[id]/page.tsx     — ✅ Sprint 24a — BackButton replaces Link on header + bottom nav.
                             Bottom nav: ← Back to Council | Reanalyze | New decision.
  page.tsx                 — ✅ Sprint 24a — handleDeleteSession + IconTrash on session cards.
                             Sub-text formatting (italic, demoted, smaller).
                             removeSessionId imported from storage.
```

### globals.css — add:
```
  app/globals.css          — ✅ Sprint 24b — height:100% removed from .persona-card.
                             Fixes TTS strip floating mid-card on equal-height grid rows.
```

---

## 5. KEY DESIGN DECISIONS — add entries 55–62

55. **`router.back()` not `Link href` for Back to Council (Sprint 24a). A forward navigation remounts the page and replays all useEffect hooks, re-running 6 AI calls. router.back() triggers bfcache and restores full React state. BackButton must be a 'use client' component — record/[id]/page.tsx is a server component.**

56. **initialMessages seeds PersonaPanel from DB, not from re-running AI (Sprint 24b). session/[id]/page.tsx fetches existing messages at server render time. Empty object for new sessions → normal flow. Non-empty → all panels hydrate from DB, skip API call. This is the correct approach for Back to Council — not bfcache alone, because bfcache is not guaranteed across all browsers/deployments.**

57. **height:100% removed from .persona-card (Sprint 24b). Cards in a CSS grid row were stretching to equal height. Body maxHeight:380 cap then created dead space between body and TTS strip. Natural height cards fix alignment without removing the scroll window. maxHeight:380 is preserved.**

58. **Persona header tags are output before RESPONSE STRUCTURE (Sprint 25). Tags are in the prompt's HARD CONSTRAINTS (numbered 0, above all persona-specific instructions). Each persona's RESPONSE STRUCTURE block has an explicit reminder. The Contrarian's "Opening line" instruction was overriding the tags — fixed with the reminder. All 6 personas have it.**

59. **<realcost> not <tradeoff> (Sprint 25). The label "The real cost:" is more human and immediately tells the user what the line is for. "Trade-off flagged" felt passive and technical. Lens/Position/The real cost are three nouns in parallel, colon, sentence — consistent structure.**

60. **Header layer is in the card body, not a sub-header band (Sprint 25). The header's job is identity (persona name + tagline + buttons). The three analytical lines are content — they belong in the reading flow. A coloured sub-header band mixed chrome with content. Body-top placement with divider is cleaner.**

61. **withRetry wraps DeepSeek call creation only, not stream consumption (Sprint 26). The 503 fires at the API call stage before streaming begins. Once a stream is open, 503s don't apply. Wrapping createCompletion covers the background jobs (ontology, bias scorer). 2 retries × 5s = 10s max added latency — acceptable given DeepSeek 503s typically resolve within seconds.**

62. **Ontology tagger failure marks session as tagger_status=failed permanently without retry (pre-Sprint 26). The withRetry fix in ai-client.ts means the tagger now retries before failing. Sessions where the tagger failed before Sprint 26 will permanently lack structural context — this is acceptable (small number, old sessions).**

---

## 6. PENDING — replace section

- **Payment gateway (Razorpay webhook):** Wire `/api/payment/create-subscription` stub to actual Razorpay webhook. Replace `x-admin-key` guard with webhook signature verification.
- **R11 (Avoidance Detection):** Parked. Requires cron + `days_open` tracking.
- **Railway cron for 30-day outcome nudges:** Parked. `sessions_pending_outcomes` view exists.
- **⬅ PICK UP FIRST: Upstream framing / "Week ending" language** — flagged by Dora session. The input flow has an upstream dependency framing step where "Week ending" language is vague. Needs more session data (Viral, Puneet sessions minimum) before redesigning the flow. Do not touch until at least 2 more user sessions have hit this specific step and confirmed the friction point.
- **Persona role labels / advisor card tooltip** — Dora was initially confused about what each advisor does. Partial fix: Position line now surfaces the advisor's specific verdict. Remaining fix: one-line tooltip or description on the advisor card header. Park until post-Viral session read.
- **Shorter advisor output as default** — Dora and WhatsApp both pushed toward Flash mode. Decision: do not build Flash mode. Build shorter output first (target 150 words instead of 180–200). Watch for "too long to read" signal in Viral and Puneet sessions before acting.

---

## 7. RESOLVED/CLOSED — add entries

- **Back to Council re-running personas** → ✅ fixed Sprint 24b. initialMessages fetched server-side, passed to PersonaPanel as initialContent, API call skipped when content present.
- **TTS strip floating mid-card on equal-height grid** → ✅ fixed Sprint 24b. height:100% removed from .persona-card.
- **Delete decision — no way to remove Reanalyze duplicates** → ✅ fixed Sprint 24a. DELETE handler + trash icon on home page session cards.
- **"Six private advisors" sub-text reading as instruction** → ✅ fixed Sprint 24a. Italic, smaller, muted.
- **No back button after Save Record** → ✅ fixed Sprint 24a. BackButton (router.back()) on record page header and bottom nav.
- **Pause/Resume missing from TTS** → ✅ fixed Sprint 25. Three-state button on both PersonaPanel and SynthesisCard.
- **Persona cards giving no orientation before prose** → ✅ fixed Sprint 25. Lens/Position/The real cost labeled lines at top of body.
- **The Contrarian skipping header tags** → ✅ fixed Sprint 26. RESPONSE STRUCTURE reminder added to all 6 personas.
- **DeepSeek 503 causing permanent ontology failure and persona errors** → ✅ mitigated Sprint 26. withRetry wrapper in ai-client.ts.

---

## 8. SPRINT 24a/24b/25/26 TEST CHECKLIST — add

### Sprint 24a
| # | Test | Expected |
|---|---|---|
| D1 | Click trash icon on session card | Confirmation prompt → session removed from list immediately |
| D2 | Check Supabase after D1 | Session row deleted, messages/outcomes cascade deleted |
| D3 | Trash icon while logged in as different user | 403 Forbidden |
| D4 | "Six private advisors…" text on home | Italic, smaller, muted — reads as context not instruction |
| D5 | Click "Save to Record" on Council page | Lands on record/[id] page |
| D6 | Click "← Back to Council" (header) | Returns to Council page with full state — no re-run |
| D7 | Click "← Back to Council" (bottom nav) | Same |

### Sprint 24b
| # | Test | Expected |
|---|---|---|
| B1 | Navigate to existing session directly via URL | All 6 persona cards show content, no API calls fire |
| B2 | TTS strip on persona cards | Sits flush at card bottom — no gap between body and strip |
| B3 | New decision | All 6 personas stream fresh content |

### Sprint 25
| # | Test | Expected |
|---|---|---|
| P1 | Run new decision | Each persona card shows Lens/Position/The real cost at top of body |
| P2 | Lens/Position/Real cost text | Plain English, full sentences, no jargon |
| P3 | The Contrarian specifically | Lens/Position/The real cost present (was missing pre-Sprint 26) |
| P4 | Click Read aloud on persona | Button changes to Pause + Stop appears |
| P5 | Click Pause | Audio pauses; button shows Resume |
| P6 | Click Resume | Audio continues from paused position |
| P7 | Click Stop | Audio stops; buttons reset to Read aloud |
| P8 | Click Read aloud on Synthesis | Same Pause/Resume/Stop behaviour |
| P9 | Synthesis output | TRADE-OFF SUMMARY paragraph present at end — prose, 2-3 dimensions |

### Sprint 26
| # | Test | Expected |
|---|---|---|
| R1 | Railway logs during DeepSeek 503 | `[AIClient] 503 on streamDeepSeek — retrying in 5000ms` |
| R2 | After 2 retries fail | Error surfaces normally — no silent hang |
| R3 | All 6 personas output header tags | Lens/Position/Real cost visible on all cards including Contrarian |
