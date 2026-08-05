# QUORUM — Handover Document v29
### Date: May 30, 2026 | Status: Sprints 32–34 deployed (UI polish, hero card glass, persona panel redesign, synthesis output fixes)
### Date: May 30, 2026 | Status: Sprints 32–34 deployed + Website competitive leakage audit completed
### Stack: Next.js 15 · Supabase (PostgreSQL) · Railway · Anthropic / DeepSeek

---

## PRODUCT SUMMARY

Quorum is a private decision intelligence system for high-stakes decisions. A user describes a decision; six AI advisors (the Council) analyse it in parallel from distinct cognitive frames. Before synthesis fires, the Examiner surfaces unknown unknowns — and from Sprint 11a, runs a deterministic rule engine that can block or gate the Council based on the decision's structural profile. Over time, the Mirror layer accumulates patterns, calibration data, and contradiction signals across all of a user's decisions.

**Positioning:** Not a chatbot. Not a framework. A private judgment system that compounds with every session.
**Copy discipline (established May 2026):** Public-facing copy distinguishes three buckets — (1) what Quorum does [always publish], (2) what the system produces [abstract before publishing], (3) how Quorum does it [default remove]. Architecture, dimension counts, rule counts, operating mode names, and pipeline sequence are never published. See KDDs 88–96.

**Target user:** Founders, CXOs, Family Office MDs. Decisions where ₹25K is cheap relative to a bad call.

---

## SYSTEM ARCHITECTURE

```
User submits decision
        ↓
POST /api/session         → creates session row (sessions table)
        ↓ (async, background)
POST /api/ontology        → tagDecision (14-dim v2.0) → evaluateRules → DB upsert
POST /api/bias-score      → bias scorer → bias_library upsert
POST /api/structural-match → structural retrieval → structural_matches upsert
                            ↳ Sprint 17: also returns rule_engine_result + ontology_vector
                              for grid reorder signal — no new route, piggybacked on existing poll
POST /api/independence-score → independence scorer → independence_score_log upsert
        ↓ (UI, parallel)
6 × POST /api/persona     → streams persona responses → messages insert
                            ↳ Sprint 19a: buildCouncilContext() injected for all 6 initial personas
                              via fetchCouncilContextWithRetry() (race condition fix — Sprint 19)
        ↓ (after all 6 done — Sprint 17 addition)
Grid reorder animation    → fade out (350ms) → cards reorder to ontology-ranked positions
                            → fade in → "Ranked by relevance to your decision" label appears
        ↓ (also after all 6 done)
GET /api/examiner         → reads rule_engine_result (v2.0) or gaps (v1.0)
                            → personalises each rule question to decision_text (Sprint 12)
                            → returns questions + rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses (with rule_id) → fires /api/bias-score (non-blocking)
                            → fires /api/mirror/independence (non-blocking) ← ✅ Sprint 18a restored
                            → fires /api/mirror/contradictions (non-blocking) ← ✅ Sprint 18a restored
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → synthesis with buildCouncilContext injected into system prompt (Sprint 12)
        ↓ (post-synthesis — Sprint 31)
ContradictionBanner       → GET /api/mirror/contradictions — fires if violationSessionId === session.id
RecordReceipt             → shows real DB session count (totalSessionCount from server prop)
        ↓ (Mirror, separate routes)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts|calibration|patterns}
                            ↳ Sprint 19: all routes use getMirrorAccessState() helper
                            ↳ Sprint 20 NEW: /api/mirror/benchmark
                            ↳ Sprint 20 NEW: /api/mirror/sessions-lookup
                            ↳ Sprint 21 NEW: /api/mirror/preferences
```

---

## DATABASE SCHEMA (current as of Sprint 20)

### mirror_access ← updated Sprint 19 migration
```
id               uuid PK
user_id          uuid UNIQUE FK → auth.users
access_type      text CHECK ('annual','monthly','lifetime','advisory') DEFAULT 'monthly'
granted_at       timestamptz NOT NULL DEFAULT now()
started_at       timestamptz
expires_at       timestamptz   ← null = never expires (lifetime/advisory)
payment_ref      text
payment_id       text
subscription_id  text
```

**Access logic (getMirrorAccessState):**
- `lifetime` / `advisory` → always `unlocked`
- `annual` / `monthly` → `unlocked` if `expires_at > now()` or `expires_at IS NULL`; else fall through
- No valid row or expired → session count ≥ 3 → `teaser`; else `locked`

### sessions, sessions_ontology, outcomes, structural_scores, messages, contradictions, examiner_responses, session_requests, brief_access_tokens, structural_matches, sessions_pending_outcomes
All unchanged from Sprint 18b.

### user_preferences ← Sprint 21 update
`style_cue TEXT CHECK ('direct','challenge','pattern','risk','stakeholder','long')` column added.

### bias_library ← Sprint 20 update
`activation_contexts` JSONB column now stores `signal_type: 'distorting'|'neutral'|'adaptive'` per session key.

---

## CODEBASE MAP

```
lib/
  mirror-access.ts         — ✅ Sprint 19 NEW — getMirrorAccessState() helper.
  rule-engine.ts           — ✅ Sprint 27 — R7 identity gate tightened (>3→>2); question template fix.
                             also Sprint 19a: R2 ambiguity threshold corrected to ≥ 4
  types.ts                 — ✅ Sprint 30 — Session interface gains decision_type_primary +
                             stakes_reversibility. also Sprint 19/20/21: MirrorGateState, MirrorAccessState,
                             SubscriptionPlan, BiasSignalType, StyleCue, BenchmarkData, SessionPreview, RulePattern
  personas.ts              — ✅ Sprint 34 — SYNTHESIS prompt: PATTERN OBSERVATION section now
                             includes explicit "CRITICAL: Do NOT write 'PATTERN OBSERVATION:' as a
                             label or header — begin directly with the natural-language opener."
                             Prevents the AI from copying the internal section name into output.
                             Sprint 26 — RESPONSE STRUCTURE header tag reminder all 6 personas.
                             Sprint 25 — WORD_LIMIT_PREFIX constraint 0 (header tags). SYNTHESIS TRADE-OFF block.
                             Sprint 21 — USER_STYLE_BOOSTS constant. computePersonaOrder() userStyle param.
                             Sprint 20 — DECISION_BRIEF DECISION-MAKER OBSERVATION block.
  bias-scorer.ts           — ✅ Sprint 34 — directiveBody (synthesisBlock) updated:
                             (a) explicitly bans raw bias_key output (e.g. "loss_aversion_reversal")
                             — instructs plain-language translation instead;
                             (b) explicitly forbids "LONGITUDINAL BIAS ASSESSMENT:" or any section
                             header — weave into existing prose;
                             (c) all three tiers (distorting/forming/neutral) updated consistently.
                             Sprint 20 — classifyBiasSignal(), getPredominantSignal()
  mirror-fingerprint.ts    — ✅ Sprint 20 — signalType + sessionIds per tile
  ai-client.ts             — ✅ Sprint 26 — withRetry() wrapper for DeepSeek 503
  storage.ts               — ✅ Sprint 24a — removeSessionId(id) export added
  dates.ts                 — ✅ Sprint 30 NEW — formatDate() / formatDateTime() helpers, all IST (Asia/Kolkata)
  ontology-tagger.ts       — ✅ Sprint 27 — decision_discriminating_info rubric NOTE added
  voice-sessions.ts        — ✅ Sprint 23a NEW — module-level session Map (Railway persistent process)

app/api/
  mirror/status/route.ts    — ✅ Sprint 19 — 3-state gate via getMirrorAccessState()
  mirror/teaser/route.ts    — ✅ Sprint 19 NEW
  mirror/fingerprint/route.ts — ✅ Sprint 19 — getMirrorAccessState()
  mirror/contradictions/route.ts — ✅ Sprint 19 — getMirrorAccessState(); Sprint 18a: POST pipeline
  mirror/independence/route.ts   — ✅ Sprint 28 — examinerQuote query added
  mirror/patterns/route.ts       — ✅ Sprint 20 — session_ids tracked per rule
  mirror/rules/route.ts          — ✅ Sprint 19 — getMirrorAccessState()
  mirror/calibration/route.ts    — ✅ Sprint 19 — getMirrorAccessState()
  mirror/alerts/route.ts         — ✅ Sprint 19 — getMirrorAccessState()
  mirror/timeline/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
  mirror/outcomes/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
  mirror/unlock/route.ts         — ✅ Sprint 19 hotfix — three-token support (MONTHLY/ANNUAL/LIFETIME)
  mirror/benchmark/route.ts      — ✅ Sprint 20 NEW — cross-user cosine similarity peer cluster
  mirror/sessions-lookup/route.ts — ✅ Sprint 20 NEW — session preview for source drawers
  mirror/preferences/route.ts    — ✅ Sprint 21 NEW — GET/POST style_cue
  payment/create-subscription/route.ts — ✅ Sprint 19 NEW (stub)
  admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW
  persona/route.ts          — ✅ Sprint 19a — buildCouncilContext() to all 6 initial personas
                              Sprint 19 hotfix — fetchCouncilContextWithRetry() for initial personas
  examiner/route.ts         — ✅ Sprint 27 — redirectRule derived + returned; upstreamRationale R1-only
  bias-score/route.ts       — ✅ Sprint 20 — classifyBiasSignal() per bias; signal_type in JSONB
  record/route.ts           — ✅ Sprint 24a — DELETE handler + ownership check
  voice/stream/route.ts     — ✅ Sprint 31 — enable_endpoint_detection: false (manual stop only)
  voice/chunk/route.ts      — ✅ Sprint 23a NEW
  voice/cleanup/route.ts    — ✅ Sprint 23a NEW
  voice/tts/route.ts        — ✅ Sprint 23b NEW — Soniox TTS proxy, markdown strip, chunked audio

components/
  SessionView.tsx          — ✅ Sprint 31 — ContradictionBanner wire (post-synthesis fetch +
                             render gated on synthesisDone); sv-navbar background: var(--bg-card)
                             Sprint 30 — totalSessionCount prop, RecordReceipt render
                             Sprint 27 — R7/R1 redirectRule pass-through handling
                             Sprint 25/24b — initialMessages, extractHeaderTags, style cue
                             Sprint 22 — CouncilStatusBar wiring
  RecordReceipt.tsx        — ✅ Sprint 30 NEW — post-synthesis confirmation card
  PatternSurfaceCard.tsx   — ✅ Sprint 31 NEW — top pattern narrative, actual decision text,
                             show-more button, actionable line, click-outside collapse,
                             fire_count cap on fetched session IDs
  RecurringConditionCard.tsx — ✅ Sprint 31 NEW — top structural dimension observation,
                               plain-language descriptions, actionable line per dimension
  ContradictionBanner.tsx  — ✅ Sprint 31 NEW — post-synthesis; correct API field names
                             (principleText/violationText/principleDecision/violationDecision/
                             principleSessionId/violationSessionId/severity/category);
                             fires when violationSessionId === session.id; dismiss via DELETE
  MemoryEngineStatus.tsx   — ✅ Sprint 31 — mirrorUnlocked prop; "Mirror active" status label;
                             "View Mirror →" shown for both mirrorUnlocked AND mirrorTeaserReady states
                             Sprint 19 hotfix — TEASER_THRESHOLD=3, preview link at ≥3
  ExaminerPanel.tsx        — ✅ Sprint 31 — Council&apos;s → Council\u2019s (apostrophe render fix)
                             Sprint 27 — redirectRule state, R7 vs R1 copy distinction
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
  SynthesisCard.tsx        — ✅ Sprint 25 — Pause/Resume/Stop TTS. Sprint 22 — status bar callbacks
  PatternStore.tsx         — ✅ Sprint 20 — RuleSourceDrawer, fire count clickable
  PatternTile.tsx          — ✅ Sprint 28 — "Activates when:" label. Sprint 20 — SignalPill, SourceDrawer
  BiasFingerprint.tsx      — ✅ Sprint 20 — authToken passed to PatternTile
  IndependenceScore.tsx    — ✅ Sprint 28 — examinerQuote block, CoachingTip sub-component
  DecisionRules.tsx        — ✅ Sprint 28 — mobile classNames
  StyleCalibration.tsx     — ✅ Sprint 21 NEW — 3-question inline calibration, localStorage persistence
  CouncilStatusBar.tsx     — ✅ Sprint 22 NEW — phase state machine narrating back-end activity
  BackButton.tsx           — ✅ Sprint 24a NEW — router.back() client component
  VoiceInput.tsx           — ✅ Sprint 23a NEW — full voice widget, SSR disabled (dynamic import)

app/
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
  mirror/page.tsx          — ✅ Sprint 31 — sub-label "A private operating system for your judgment";
                             no lock icons on teaser tiles; "Activate Mirror" language throughout;
                             ₹9,999/year leading price; "building" lockedBadge; gold back button
                             Sprint 28 — mobile layout, section reorder (Fingerprint first), teaser polish
                             Sprint 20 — UnlockedView header renames, BenchmarkModule
                             Sprint 19 — LockedView, TeaserView, gate states
  session/[id]/page.tsx    — ✅ Sprint 30 — sequential query (session first), totalSessionCount
                             COUNT query, duplicate notFound removed
                             Sprint 24b — initialMessages server-side fetch
  record/[id]/page.tsx     — ✅ Sprint 27 — XML tag stripping, deduplication, QUORUM home link,
                             +New Decision button
                             Sprint 24a — BackButton, bottom nav
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
  layout.tsx               — ✅ Sprint 29 — DM Sans variable font replaces Inter

hooks/
  useSoniox.ts             — ✅ Sprint 31 — manual end detection (enable_endpoint_detection: false);
                             300ms finalize delay; 8s timeout guard for stuck finalizing state
                             Sprint 23a NEW — state machine idle→recording→finalizing→done|error
  useSonioxTTS.ts          — ✅ Sprint 25 — isPaused, pause(), resume()
                             Sprint 23b NEW — speak(), stop(), chunked playback, countdown, pace

context/
  TTSContext.tsx           — ✅ Sprint 23b NEW — singleton TTSProvider, useTTSContext()

Static:
  index.html (quorumvault.org) — ✅ Sprint 20 — 6 persona cards, correct module names
                                 Sprint 19 — billing toggle, Mirror pricing, subscription flow
                                 Sprint 31 — social proof section + full mobile overhaul deployed
                                 May 30, 2026 — competitive leakage audit (3 passes, 31 issues).
                                   Output: index_final.html (clean) + index_final.patch (2 LOW items).
                                   Audit doc: quorum_leakage_analysis.html.
                                   All HIGH/MEDIUM resolved. Two LOW residuals patched (see KDD 88–96).
```

---

## SPRINT HISTORY

| Sprint | What shipped |
|---|---|
| 1–10 | Core session flow, personas, examiner, Mirror, PDF, outcome tracker, bias scorer |
| 11a | 14-dim ontology tagger (v2.0), rule engine R1–R5, SQL migration |
| 11b | REDIRECT synthesis block, ExaminerPanel rule_mode pass-through, dim persona grid |
| 11c | Rule calibration: R1 threshold → 5, R4 suppresses R2, REDIRECT banner rationale |
| 12 | Contextual rule questions, Council context enrichment (buildCouncilContext), bias trigger fix |
| 13 | Mirror status fix, R6–R12 implementations, R2 threshold → 5, R12 range fix, SSL bias fix |
| 14 | Calibration loop: pre_decision_confidence slider, outcome_quality, retrospective_confidence, calibration_delta |
| **15a** | **Calibration Sparklines in Mirror — ✅ PASSED** |
| **15b** | **UX + Reasoning Quality: prompt architecture + home glow — ✅ PASSED** |
| **15c** | **Structural Retrieval upgrade to 14-dim weighted cosine vector — ✅ PASSED** |
| **15d** | **AuthPanel magic link UX + website decision examples + feature tiles — ✅ PASSED** |
| **15e** | **Council reasoning quality: Risk Architect structural alternative slot — ✅ PASSED** |
| **16b** | **R1 confidence guard + override button + pushback detection + share context fan-out + language register — ✅ Deployed** |
| **16c** | **Context show more toggle + anti-template-repetition + Examiner RULE_HINTS — ✅ Deployed** |
| **17** | **Dynamic persona grid reorder + Mirror Pattern Store route — ✅ Deployed** |
| **18a** | **Independence Score + Contradiction Detector triggers restored in examiner route — ✅ Deployed** |
| **18b** | **Mirror Pattern Store UI (PatternStore.tsx) — ✅ Deployed** |
| **19a** | **R2 ambiguity threshold fix (≥3→≥4) + buildCouncilContext() to all 6 initial personas — ✅ Deployed** |
| **19** | **Mirror subscription gate (locked/teaser/unlocked). getMirrorAccessState() helper. Teaser view. mirror_access schema migration. Pricing toggle on website. SynthesisCard Mirror nudge. Race condition fix (fetchCouncilContextWithRetry). Unlock route fix (lifetime + upsert). MemoryEngineStatus teaser threshold (3). — ✅ Deployed** |
| **20** | **Bias signal classification (distorting/neutral/adaptive). DECISION_BRIEF mirror closing line. Peer benchmark module. Source-decision drawer on Bias Fingerprint + What Keeps Coming Up. Website + Mirror copy synced. — ✅ Deployed** |
| **21** | **Style calibration (3-question flow). /api/mirror/preferences route. user_preferences.style_cue column. computePersonaOrder() style param. localStorage persistence. — ✅ Deployed** |
| **22** | **CouncilStatusBar — phase state machine narrating back-end activity in plain language. — ✅ Deployed** |
| **23a** | **Voice I/O — Soniox STT, SSE proxy, binary chunk forwarding, AI cleanup, particle animation. — ✅ Deployed** |
| **23b** | **TTS Read Aloud — Synthesis card. REST not WebSocket. Chunked playback. Countdown timer. Pace control. — ✅ Deployed** |
| **23c** | **TTS Read Aloud — all 6 persona cards. Singleton TTSProvider. Bottom strip layout. — ✅ Deployed** |
| **24a** | **Delete decision. Back to Council (router.back). Sub-text formatting. — ✅ Deployed** |
| **24b** | **Back to Council no re-run (initialMessages server-side). TTS strip alignment fix. — ✅ Deployed** |
| **25** | **Pause/Resume TTS. Persona header layer (Lens/Position/Real Cost). Synthesis trade-off narrative. — ✅ Deployed** |
| **26** | **DeepSeek 503 retry (withRetry). Persona RESPONSE STRUCTURE tag compliance fix (all 6). — ✅ Deployed** |
| **27** | **Persona header redistribution (lens→header sub-line, position→body-top, realcost→closing). R7 vs R1 REDIRECT distinction. R7 false positive fixes. Record page (XML strip, dedup, home link, +New Decision). — ✅ Deployed** |
| **28** | **Mirror UI revamp: confidence slider copy, mobile layout, "Activates when:", examiner quote + CoachingTip in Independence Score, section reorder (Fingerprint first, Timeline last), rules card mobile, teaser polish. — ✅ Deployed** |
| **29** | **Home page redesign: fixed navbar, persona pill strip, tips collapsible, history fade-in, .home-two-col. DM Sans variable font. — ✅ Deployed** |
| **30** | **Chunks 1–3: QUORUM flip-card, RecordReceipt, Mirror paywall copy. Bug fixes: localStorage auth key, IST timezone, sv-navbar bg-card, Mirror nav button. lib/types.ts Session additions. session/[id] totalSessionCount. — ✅ Deployed** |
| **31** | **Chunks 4–5: Onboarding 3-panel card, PatternSurfaceCard (decision text + show-more + actionable + click-outside), RecurringConditionCard (plain language + actionable), ContradictionBanner (correct field names, post-synthesis). VoiceInput manual end detection + timeout guard. ExaminerPanel \u2019 fix. Background #060c1a blue tint. Gold brightness #d4a843. Website social proof + mobile overhaul deployed. — ✅ Deployed** |
| **32** | **UI Polish: dark token refine (--bg-void #080f1c, --bg-card #101827, border/text nudges). Body radial gradient (fixed html[data-theme="dark"] selector — was broken). Hero card glass treatment + radial bloom. PersonaPanel header redesign (left rail, neutral bg). btn-primary gradient. Input focus ring. TTS strip theme-aware token system. Light mode warm vignette. — ✅ Deployed** |
| **33** | **Bug fixes: overflowX clip removed (card edge cut on mobile). Light mode bloom hidden. Card border 1.5px. TTS strip button colors readable in light mode via --tts-btn-* tokens. — ✅ Deployed** |
| **34** | **Bug fixes: card border → 2px. Examiner update (Share to All Advisors) strips lens/position/realcost tags (stripHeaderTags was missing from that code path). Synthesis output: PATTERN OBSERVATION no longer appears as a header label. LONGITUDINAL BIAS ASSESSMENT header and raw bias_key names (e.g. loss_aversion_reversal) eliminated from synthesis output. — ✅ Deployed** |
| **Website Audit** | **Competitive leakage analysis on index.html (3 passes). HIGH: dimension count (14), rule count (12), full pipeline sequence, Mirror module mechanism descriptions. MEDIUM: bias trigger format, Decision Independence Score mechanism, internal state labels (provisional/blocked/held), social proof FOMO metric, not-a-chatbot strip architecture, Mirror timeline internal labels. LOW: "12 months" advisory, teaser unlock threshold (3), "in parallel" Council execution, "Traces which structural factors". All resolved. Output: index_final.html + index_final.patch. — ✅ May 30, 2026** |

---

## CURRENT STATUS

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

### Website (quorumvault.org)
Social proof section and full mobile overhaul (480px + 980px breakpoints) deployed. Billing toggle: monthly ₹1,499 / annual ₹9,999. All module names canonical and consistent with app.
**Competitive leakage audit — ✅ complete (May 30, 2026).** 3-pass review of all public copy. 31 issues resolved across HIGH/MEDIUM/LOW severity. Clean file: `index_final.html`. Third-pass residual patch: `index_final.patch`. Governing principles logged as KDDs 88–96.

---

## RULE ENGINE (lib/rule-engine.ts)

| Rule | Type | Trigger | Status |
|---|---|---|---|
| R1 — Upstream Dependency Block | REDIRECT | `upstream_dependency ≥ 5` AND `confidence ≥ 0.55` | ✅ live |
| R2 — Identity-First Gate | GATE | `identity_alignment ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R3 — No-Information Mode | GATE | `decision_discriminating_info ≤ 1 AND outcome_uncertainty ≥ 4` | ✅ live |
| R4 — Regret Asymmetry Alert | FLAG | `regret_asymmetry ≥ 5` | ✅ live |
| R5 — False Urgency Detector | FLAG | `emotional_intensity ≥ 4 AND time_pressure ≤ 2` | ✅ live |
| R6 — Multi-Party Alignment | FLAG | `decision_unit ≥ 3 AND emotional_intensity ≥ 4` | ✅ live |
| R7 — Information-First | REDIRECT | `decision_discriminating_info ≥ 4 AND outcome_uncertainty ≥ 3 AND identity_alignment ≤ 2` | ✅ live (gate tightened Sprint 27) |
| R8 — Irreconcilable Values | FLAG | `value_conflict ≥ 5 AND identity_alignment ≥ 4` | ✅ live |
| R9 — Irreversibility Warning | FLAG | `reversibility ≥ 4 AND time_pressure ≤ 2 AND emotional_intensity ≥ 4` | ✅ live |
| R10 — Complexity Overload | GATE | `task_complexity ≥ 5 AND ambiguity ≥ 4` | ✅ live |
| R11 — Avoidance Detection | BACKGROUND | `upstream_dependency ≥ 4 AND days_open ≥ 45` | 🔲 deferred (needs cron) |
| R12 — Couple Misalignment | FLAG | `decision_unit 2–3 AND value_conflict ≥ 4` | ✅ live |

---

## KEY DESIGN DECISIONS (do not re-debate)

1–42: All carried from v21 unchanged.

43. **Mirror TEASER_THRESHOLD = 3.** Permanently 3 sessions. Do not raise.
44. **getMirrorAccessState() is the sole arbiter of Mirror access.** No route queries mirror_access directly.
45. **mirror_access writes are always upsert ON CONFLICT (user_id).**
46. **Unlock tokens map to plan type.** MIRROR_TOKEN_MONTHLY → 30d, MIRROR_TOKEN_ANNUAL → 365d, MIRROR_TOKEN_LIFETIME → no expiry.
47. **fetchCouncilContextWithRetry() for initial personas only.** Synthesis uses plain fetchCouncilContext().
48. **TeaserView PRICING_URL points to https://www.quorumvault.org/#pricing.** Not .xyz.
49. **signal_type is stored in activation_contexts JSONB, not a new column.**
50. **DECISION_BRIEF mirror line goes in DECISION_BRIEF only — not SYNTHESIS.**
51. **BenchmarkModule silently renders nothing when cluster < 5.** Do not lower MIN_CLUSTER_SIZE.
52. **Canonical module names:** Bias Fingerprint, Decision Independence Score, Your Implicit Rules, What Keeps Coming Up, Contradiction Detector, Confidence Calibration. Council personas: Contrarian, Risk Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor.
53. **USER_STYLE_BOOSTS is +1, rule boosts are up to +3.** Style nudge never overrides a fired rule.
54. **StyleCalibration persistence is localStorage-first, DB-second.** Key: `quorum_style_calibration_dismissed`.
55. **router.back() not Link href for Back to Council.** back() triggers bfcache, preserving full React state.
56. **initialMessages seeds PersonaPanel from DB, not from re-running AI.**
57. **height:100% removed from .persona-card.** Cards stretch to equal grid row height with dead space; natural height fixes alignment.
58. **Persona header tags output before RESPONSE STRUCTURE.**
59. **`<realcost>` not `<tradeoff>`** — "The real cost:" is more human.
60. **Header layer is in card body, not sub-header band.**
61. **withRetry wraps DeepSeek call creation only, not stream consumption.**
62. **Ontology tagger failure marks session tagger_status=failed permanently (pre-Sprint 26).** withRetry now prevents this.
63. **Confidence slider measures epistemic clarity, not outcome prediction.** "Foggy → Fully clear." Do not revert.
64. **Mirror section order: Bias Fingerprint first, Decision Timeline last.** TeaserView exempt.
65. **CoachingTip never exposes signal names.**
66. **examinerQuote selects longest response_text, not first.**
67. **Persona pill strip not 3×2 grid.**
68. **State-gated register + slider: zero logic change.** Controls reveal via CSS only.
69. **Tips section is localStorage-first, collapsed for returning users.** Key: `quorum_tips_open`.
70. **Quorum's category is "Judgment Infrastructure" / "Decision Operating System".**
71. **QUORUM flip-card uses opacity+scale crossfade, not CSS 3D backfaceVisibility.** CSS 3D unreliable with form elements inside.
72. **totalSessionCount is server-fetched, not localStorage.length.** localStorage is device-local. Always use DB count for user-visible numbers.
73. **Onboarding panels live inside the QUORUM back-face card, not as a separate overlay.** quorum_onboarded gate ensures returning users see QUORUM face directly (Panel 2) with zero regression.
74. **Voice end detection is manual-only.** `enable_endpoint_detection: false`. User taps Stop explicitly — HNI-grade thinking pauses must not trigger auto-cutoff.
75. **PatternSurfaceCard shows actual decision text (not UUID), caps fetched IDs to fire_count, shows first 2 decisions with "Show N more" expand.** Actionable line is always present per pattern narrative.
76. **ContradictionBanner fires only when violationSessionId === session.id — no fallback to most-recent contradiction.** Showing a contradiction where both sides are from past sessions reads as false context for the current decision.
77. **Flag as exception vs Update my rule are currently semantic only** — both call DELETE /api/mirror/contradictions. Distinction is a scaffold for future principle-rewrite flow. Do not wire to different backend logic until principle management is built.
78. **sv-navbar background is var(--bg-card), not var(--bg-deep).** bg-deep is identical to bg-void in dark mode — makes the nav strip invisible. bg-card is the elevated surface color, always visually distinct.
79. **Hero card background is theme-aware via CSS class, not inline style.** [data-theme="dark"] .hero-card = glass gradient; [data-theme="light"] .hero-card = var(--bg-card). Inline style must not set background — CSS class wins cleanly.
80. **Card bloom (.card-bloom) is hidden in light mode via CSS.** Warm cream bg needs no extra depth layer. Dark-only: radial-gradient(ellipse at 50% 48%, rgba(22,42,88,0.72)...).
81. **Bloom div uses top/left/right/bottom=0 (no negative horizontal inset).** inset: '-80px -100px' caused mobile centering shift by extending scrollable area. Kept vertical overflow only.
82. **overflowX: clip on flip-card wrapper was removed.** It clipped box-shadow at card edges. Centering issue was the bloom's negative inset — fixed at source, not with clip.
83. **PersonaPanel ACCENT_COLORS are now rail accent values, not background fill values.** Left-border 3px rails at partial saturation look premium; full-header blocks read as gaming dashboard. Do not revert to header blocks.
84. **TTS strip button colors use --tts-btn-color/border/bg/stop-color CSS tokens, not hardcoded rgba(255,255,255,*).** White hardcodes were invisible on light mode cream background. Token values: dark → white-ish rgba; light → var(--text-2)/var(--border-mid).
85. **Examiner update (Share to All Advisors) must call stripHeaderTags() before setExaminerUpdate() and before saving fullContent.** Initial response and pushback both stripped correctly; examiner update was the sole missing path. All three code paths now strip.
86. **Synthesis must never output "PATTERN OBSERVATION:" or "LONGITUDINAL BIAS ASSESSMENT:" as section headers.** Both are internal prompt section names, not output labels. PATTERN OBSERVATION instruction now includes explicit CRITICAL note. directiveBody in bias-scorer.ts now forbids both the header and raw bias_key names.
87. **Raw bias_key names (e.g. loss_aversion_reversal) must never appear in synthesis output.** directiveBody now instructs plain-language translation. Example canonical translation: "a tendency to weigh the regret of missing out more heavily than the risk of a concrete loss."
88. **Website copy — three-bucket rule.** Every sentence of public copy falls into one of three buckets: (1) "What Quorum does" — category claims, transformation narrative, product capabilities described at the outcome level → always publish; (2) "What the system produces" — outputs, findings, surfaced patterns → publish abstracted, no mechanism attached; (3) "How Quorum does it" — pipeline sequence, dimension counts, rule counts, mode names, scoring logic, trigger conditions, integration architecture → default remove. When in doubt, ask whether the sentence would help a competitor build. If yes, rewrite to outcome language or remove.
89. **Dimension count (14) and rule count (12) are never published.** They reveal ontology cardinality and rule engine size respectively. Replace with concept language: "structural dimensions," "structural read," "intervention logic." The concept stays public; the count does not. This applies to stats sections, step descriptions, pricing lists, and all other copy surfaces.
90. **Rule engine operating mode names never appear in public copy.** REDIRECT, GATE, FLAG are internal. "Synthesis is held / blocked / marked provisional" and "The Council's analysis is marked provisional" are internal state labels — banned from website, mocks, and social proof. Acceptable user-experience replacements: "The decision was held," "the analysis is held," "The analysis holds until then." The mode tag on the Examiner output card reads "Decision held," not "Synthesis held."
91. **Named ontology dimensions banned from pipeline descriptions.** "Reversibility. Identity stakes. Real vs. felt urgency. Prior unresolved dependencies." must not appear in a numbered process walkthrough — they read as a spec sheet. They may appear as experiential questions ("Is it reversible?") in standalone positioning copy where they describe the user's experience, not the system's taxonomy.
92. **Integration architecture is never confirmed in public copy.** The following phrases all confirm that the examiner or personas consume the ontology tagger's output and are banned: "Derived from the structural analysis," "reads the structural profile," "Each receives the structural profile of your decision," "Before synthesis fires, it reads," "Traces which structural factors shaped it," "Analysis shaped by what the decision structurally is." Replace with outcome language: "reads what the decision actually is," "every advisor already understands what they're dealing with," "you can see exactly what shaped it."
93. **Bias trigger format banned from public copy.** "X activates when [condition]" reveals conditional detection architecture (the system detects the trigger, not just the bias category). Replace with observation of when it occurred: "In the sessions where it appeared, [context]." The finding stays specific; the detection logic does not.
94. **"In parallel" for Council execution removed from public copy.** Reveals parallel execution architecture. Replace with non-architectural language: "Six advisors, each from a distinct cognitive frame, review the decision." In dec-examples copy, "run in parallel" → "each bring a distinct read."
95. **Canonical safe-to-publish copy (confirmed May 2026 audit).** These phrases are confirmed category-creation assets — philosophical positioning that cannot be reverse-engineered. Publish prominently and do not dilute: "AI has made analysis abundant and coherence scarce. Quorum is not another source of perspective — it is the system that integrates them." / "The first session is analysis. The tenth is a mirror. The fiftieth is infrastructure." / "The only system that will tell you a decision isn't ready." / "Every business process has been systematized. Judgment is the last one." / "Judgment Infrastructure" as category name. / "At the level where the cost of being wrong is measured in crores, the absence of a genuine feedback loop is its own risk factor."
96. **Website audit output files (May 30, 2026).** `quorum_leakage_analysis.html` — full audit document (31 issues, severity ratings, rewrites, safe/dangerous matrix, comparable company framing reference). `index_final.html` — production-ready revised website copy with all HIGH and MEDIUM issues resolved. `index_final.patch` — unified diff for two residual LOW items ("Builds after 3 logged outcomes" → "Builds as your decision record grows"; "in parallel" removed from three locations). Apply with: `patch index_final.html index_final.patch`.
---

## PENDING

**Sprint 32 — priority order:**

1. **IST migration** — `RecordExport.tsx` and `CalibrationSparkline.tsx` already have inline `timeZone: 'Asia/Kolkata'`. Migrate to `formatDate()` / `formatDateTime()` from `lib/dates.ts`. Audit all remaining `toLocaleDateString()` calls across codebase.

2. **ContradictionBanner — improve fire rate:** Current logic requires `violationSessionId === session.id`. The three known contradictions in the user's Mirror (autonomy×, urgency×, process×) may not map to recent session IDs. Consider: after synthesis, if no exact match exists, offer a "View your tensions →" micro-link to the Mirror Contradiction Detector section instead of showing nothing. Keep the banner itself strict (exact match only).

3. **Background visual identity** — ✅ RESOLVED Sprint 32. Implemented: navy radial gradient on body (dark mode), warm cream vignette (light mode), glass card treatment on hero card, dedicated .card-bloom radial behind card.

4. **Chunk 4b test coverage** — Run these decisions to generate new contradiction-eligible sessions:
   - "I want to move fast on this acquisition even though I haven't done proper due diligence — the opportunity feels too good to miss" (triggers autonomy tension)
   - Then POST /api/mirror/contradictions with `force: true` if banner still doesn't fire

5. **Product Chunks (deferred until stage gate):**
   - Chunk 1 Judgment Profile as primary object (home screen structural reframe beyond current strip)
   - Chunk 3 Mirror teaser reframe: profile-in-construction with "X of 5 decisions needed" progress
   - Chunk 2 RecordReceipt extension: structural dimension summary below count

**Parked items (do not build until stage gate met):**
- C0 context question in Examiner
- R11 (Avoidance Detection) — requires cron + days_open tracking
- Razorpay webhook wiring
- Contradiction log table (`contradiction_log` as first-class table) — after ~30–50 sessions
- Institutional pricing (annual license per principal)

**Stage gate to Sprint 32 full build:** First paying session at any price point + one returning user who explicitly returns for a second real decision.

---

## RESOLVED / CLOSED

*(All items from v27 carried forward unchanged)*

- **Sprint 31 items marked "pending" in v27** → ✅ All confirmed deployed in v28 QA pass (May 30, 2026):
  - Onboarding panels (isOnboarding, onboardPanel, quorum_onboarded)
  - PatternSurfaceCard.tsx — decision text, show-more, actionable, click-outside
  - RecurringConditionCard.tsx — plain language, actionable
  - ContradictionBanner.tsx + SessionView wiring — correct field names
  - ExaminerPanel.tsx — &apos; → \u2019
  - voice/stream/route.ts — enable_endpoint_detection: false
  - globals.css — --bg-void #060c1a, --gold #d4a843
  - useSoniox.ts — 300ms finalize delay, 8s timeout guard (from session fixes, now in codebase)
- **sv-navbar background still var(--bg-deep) in v27 zip** → ✅ Fixed in v28. Correct value var(--bg-card) confirmed.
- **RecordReceipt showing localStorage count (~21) instead of DB count** → ✅ Sprint 30.
- **Mirror MemoryEngineStatus showing "Mirror ready to activate" for paid subscriber** → ✅ Sprint 30 + 31. mirrorUnlocked prop + correct status label.
- **ExaminerPanel &apos; rendering as literal text** → ✅ Sprint 31. \u2019 Unicode right single quote.
- **Voice auto-terminating on silence** → ✅ Sprint 31. enable_endpoint_detection: false.

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
---

## KNOWN GAPS (logged, not prioritised)

- **Email auto-link on fresh magic-link login:** After Supabase magic link login, `loadHistory` reads authToken but does not read `session.user.email` → userEmail stays null → AuthPanel re-appears. Fix is 3 lines in loadHistory. Low impact at current scale.
- **Private benchmarking Phase 2** (outcome data, N≥50) — after corpus grows
- **Decision Graph** — requires ~20 sessions per user
- **Hybrid semantic + ontology structural retrieval**
- **TTS pace gap at 1.5×/2×:** Brief silence between chunks at elevated speeds. Fix: derive pre-fetch lead time from rate × chunkDuration. Currently mitigated by PREFETCH=1 + retry.

---

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_PROVIDER              (anthropic | deepseek)
AI_MODEL                 (claude-sonnet-4-20250514 | deepseek-chat)
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
MIRROR_TOKEN_MONTHLY     ← shared code for monthly access (30 days)
MIRROR_TOKEN_ANNUAL      ← shared code for annual access (365 days)
MIRROR_TOKEN_LIFETIME    ← shared code for lifetime access (no expiry)
MIRROR_UNLOCK_TOKEN      ← legacy fallback, treated as lifetime — keep until all old codes retired
SONIOX_API_KEY           ← Soniox STT + TTS shared key
```

---

## SPRINT 31 TEST LOG (use to validate current deployment)

| # | Test | Expected |
|---|---|---|
| O1 | New user (clear localStorage) | Panel 0 inside card: "01 · THE COUNCIL" + dots + "TAP TO CONTINUE →" |
| O2 | Tap card | Panel 1: "02 · YOUR MIRROR" |
| O3 | Tap card again | QUORUM face (Panel 2). Tap CTA → flip to form |
| O4 | Skip → | Jumps to QUORUM face directly |
| O5 | Returning user | Card shows QUORUM face directly (no panels) |
| P1 | Home page — Mirror user ≥5 sessions | PatternSurfaceCard appears above MemoryEngine |
| P2 | PatternSurfaceCard decision links | Shows actual decision text (not UUID) |
| P3 | PatternSurfaceCard > 2 decisions | "Show N more" button appears |
| P4 | PatternSurfaceCard | One actionable line ("What to do next time") present |
| P5 | Click outside PatternSurfaceCard | Expanded decisions list collapses |
| P6 | RecurringConditionCard | Appears if top dimension has high_count ≥ 3; plain-language description; actionable line |
| C1 | ContradictionBanner — session that is violation | Banner fires below RecordReceipt post-synthesis |
| C2 | "Flag as exception" | Banner disappears, does not refire |
| C3 | "Update my rule" | Same dismissal behaviour |
| V1 | Voice recording — pause 3+ seconds | Does NOT auto-stop |
| V2 | Voice — tap Stop | Finalising… → done, transcript populated |
| E1 | ExaminerPanel R7 redirect text | "the Council's read" renders with correct apostrophe, not &apos; |
| B1 | Dark mode background | Deep navy tint visible (#080f1c) — not pure black; radial gradient at top visible |
| G1 | Dark mode gold | Brighter (#d4a843) — clearly readable on dark background |
| M1 | MemoryEngineStatus — Mirror unlocked user | "Pattern Memory active · Mirror active" + "View Mirror →" |
| M2 | MemoryEngineStatus — teaser ready, not unlocked | "Mirror preview activates" + "View Mirror →" |
| N1 | Session page nav bar | Visually distinct from page background (bg-card) |

---

## SPRINT 30 TEST LOG

| # | Test | Expected |
|---|---|---|
| F1 | Land on home (new user) | QUORUM wordmark card, gold rules, "Add to your judgment record" CTA |
| F2 | Click card | Crossfade to decision form. Advisor line + personas fade in below |
| F3 | New user strip | "YOUR JUDGMENT RECORD · 0 decisions" + "Every decision builds…" second line |
| F4 | Returning user strip | Count correct, no second line |
| F5 | Mobile (375px) | Card height ~78% of viewport, not full-height |
| F6 | Gap card → MemoryEngine | Tighter (clamp 20–28px) |
| R1 | RecordReceipt — after synthesis | Card appears below SynthesisCard, shows real DB count |
| R2 | RecordReceipt — before synthesis | Does not appear |
| M1 | MemoryEngineStatus — Mirror unlocked | "Pattern Memory active · Mirror active" + "View Mirror →" |
| M3 | Mirror paywall state | No lock icons, "Activate Mirror" language, ₹9,999/year |
| M4 | Mirror unlocked state | Zero changes to any module in UnlockedView |
| A2 | Date on any decision in history | IST time, not device timezone |

---

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

## CONTACTS / ACCESS

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.org / invigorating-manifestation-production-ecd2.up.railway.app
- Website: www.quorumvault.org
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
