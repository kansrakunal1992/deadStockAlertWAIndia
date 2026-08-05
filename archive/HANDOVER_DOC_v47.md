# QUORUM — Handover Document v47
### Date: June 21, 2026 | Status: Sprint TB1 (Track B — Codebase Resilience: `server-only` guard, `CouncilContext`/`UserBiasContext` shape-alias fix, vitest scaffold) — Diligence-flagged work, unrelated to the RET-4 sprint above; touches a disjoint set of files (confirmed via `git diff --stat` against the prior 3 commits before starting — zero overlap). **(1) `server-only` guard:** added as the first import in `lib/ai-client.ts` and `lib/encryption.ts` — converts the failure mode from the diligence report's logged incident (a value-import of a constant into `components/BiasFingerprint.tsx` created a transitive chain to `lib/ai-client.ts`'s module-scope `new Anthropic(...)`, crashing the page with a blank white screen and no useful error) into a local build error naming the import chain. Confirmed via direct grep that neither `BiasFingerprint.tsx` nor `components/EarlyEchoCard.tsx` (the RET-3 component closest to this risk) currently value-imports anything from the at-risk lib files — both only reference them in comments — so there is no live bug today, but also nothing except convention was stopping a recurrence. **Deliberately scoped down from the original plan:** `lib/supabase.ts` was NOT given the guard — that file mixes a browser-safe `createClient()` (used in 5 client components: `SessionView.tsx`, `auth/callback`, `settings/privacy`, `settings/security`, `mirror/page.tsx`) with the server-only `createServiceClient()` in one module, so a blanket guard would break legitimate browser usage. The correct fix is splitting it into two files, but `createServiceClient` has 57 import sites across the codebase — too large to fold into this sprint. **Logged as a follow-up, not done.** **(2) Shape-alias fix:** the diligence report's third incident (a function signature extended with 2 new optional params in 3 places; exactly one of several hand-typed `Promise.resolve({...})` fallback literals elsewhere was missed on first deploy) had a live, unfixed instance in `app/api/persona/route.ts` — the `fetchCouncilContext()`/`fetchCouncilContextWithRetry()` 7-field return shape was hand-typed in **5 separate places** (both function signatures, 3 early-return literals, 1 catch-block literal, 1 no-fetch fallback in `POST`), and `UserBiasContext`'s shape was hand-duplicated in 2 more despite already being exported from `lib/bias-scorer.ts` and simply never imported. Fix: new exported `CouncilContext` interface + `EMPTY_COUNCIL_CONTEXT` constant in `app/api/persona/route.ts` (all 7 sites now reference it — the 3 early-return sites use `{ ...EMPTY_COUNCIL_CONTEXT, userId }` since `userId` is already resolved at that point in `fetchCouncilContext()`); `lib/bias-scorer.ts`'s previously function-local `empty` const hoisted to an exported `EMPTY_USER_BIAS_CONTEXT` module constant, now the single source of truth used both inside `fetchUserBiasContext()` itself and at the 2 call sites in `persona/route.ts`. Zero behavior change — pure type-safety hardening; confirmed via `tsc --noEmit` before/after (only pre-existing, unrelated `TS2802` Set/Map-iteration errors in 9 files this sprint never touched — present both before and after, not introduced by this work). **(3) Test scaffold:** no test framework existed in the repo at all. Added `vitest` + `vite-tsconfig-paths` (picks up the existing `@/*` tsconfig alias with zero extra config), `npm test` / `npm run test:watch` scripts, `vitest.config.ts`, `tests/setup.ts`. **Real problem hit and solved:** `vitest`'s default Node module resolution does not set the `react-server` package-export condition that Next.js's actual server bundle uses to resolve `server-only` to a no-op — so naively, every test importing anything that transitively reaches `lib/ai-client.ts` or `lib/encryption.ts` (which is most of the interesting surface, including `lib/bias-scorer.ts` and `lib/calibration-engine.ts`) would throw on import, for an environment reason having nothing to do with a real bug. Fixed via `tests/setup.ts` → `vi.mock('server-only', () => ({}))`, wired through `vitest.config.ts`'s `setupFiles`. **Verified the mock is doing real work, not coincidentally passing:** ran the same suite with the mock removed — both test files failed with the exact `server-only` throw, confirming the guard fires and the mock genuinely neutralizes it the same way Next's server bundle does. Two test files: `tests/council-context-shape.test.ts` (6 tests — `EMPTY_COUNCIL_CONTEXT`/`EMPTY_USER_BIAS_CONTEXT` satisfy their types via `expectTypeOf`, exact-key-set runtime assertions as a backstop against a stray `as`-cast bypassing the compiler, empty-state value assertions) and `tests/council-synthesis-chain.test.ts` (9 tests — `lib/rule-engine.ts`'s `evaluateRules()`/`buildCouncilContext()` mode hierarchy, REDIRECT short-circuit, the Sprint 16b confidence guard, R4/R9 mutual suppression; `lib/persona-relevance.ts`'s `computePersonaRelevance()` flat-0.50-baseline contract from KDD 100, rule-boost application, clamp-to-1.0 ceiling). Explicitly does **not** call Claude or DeepSeek — that needs live API keys and wasn't the gap; the gap was the wiring around the model calls, which this now covers. 15/15 passing. **Reconciliation:** full patch generated via `git diff --cached`, verified with `git apply --check` against a completely independent fresh unzip of the upload (not the working sandbox), then applied for real in that independent copy and re-run end-to-end (`npm install` → `tsc --noEmit` → `npm test`) before delivery — per the standing reconciliation protocol. 4 files changed (`app/api/persona/route.ts`, `lib/ai-client.ts`, `lib/bias-scorer.ts`, `lib/encryption.ts`), 1 file changed for deps/scripts (`package.json` — `package-lock.json` deliberately excluded from the patch; regenerate locally via `npm install` rather than shipping a separately-resolved lockfile), 4 new files (`vitest.config.ts`, `tests/setup.ts`, `tests/council-context-shape.test.ts`, `tests/council-synthesis-chain.test.ts`), 0 schema changes, 0 new env vars. KDD 195 added. Next on this thread: Decision Graph build, scoped across up to 4 sprints (see roadmap section).
### Date: June 21, 2026 | Status: Sprint RET-4 follow-up (Root-cause fix — reanalyzed decisions excluded from calibration record) — Found via a live bug report: a session reanalyzed from the record page showed a hindsight confidence badge but no calibration note, despite lever (ii) being live. Root cause: two reanalyze entry points create a new session via `POST /api/session` without ever sending `pre_decision_confidence` — `components/SessionView.tsx`'s in-Council `handleReanalyze` (live "convene new Council" mid-session) and `components/ReanalyzeDrawer.tsx`'s post-record reanalyze drawer (reachable from `app/record/[id]/page.tsx`). Neither had a confidence slider at all; the server route's existing `typeof pre_decision_confidence === 'number'` validation (unchanged, see Sprint 14 history) silently defaulted both to `null`, which `calibrationNoteCopy()` (lever (ii), Sprint RET-4) correctly treats as a no-op — the gate was never the bug, the missing capture upstream was. Both files now carry a `rePreConfidence` state (default 5, same as the homepage form), a confidence slider matching each file's existing local styling convention (`SessionView.tsx` uses its panel's font-mono/uppercase label style and `--green-text`; `ReanalyzeDrawer.tsx` uses its own simpler label style and `--success-text`, consistent with that file's pre-existing token choices), and `pre_decision_confidence: rePreConfidence` added to the POST body. 2 files changed, 0 new files, 0 schema changes, 0 new env vars — `sessions.pre_decision_confidence` and the `/api/session` validation were already in place; this only adds the missing client-side capture on the two reanalyze paths. KDD 194 added.
### Date: June 21, 2026 | Status: Sprint RET-4 (Path to 95+ — Lever (ii): Free Single-Outcome Calibration Feedback) — First of the three §5 levers from the SECOND-USE RETENTION STRATEGY section; the only one of the three cleared to build without a prior scoping conversation (levers (i) and (iii) remain explicitly parked pending scoping with Ken — see updated §5 below). `components/OutcomeTracker.tsx` — new `preDecisionConfidence: number | null` prop; new `calibrationNoteCopy()` helper computes a one-line note from `pre`/`retro` confidence (mirrors the delta-sign phrasing already established in `CalibrationRevealCard`'s `DeltaBadge` sub-copy, computed for a single session instead of the Mirror-gated aggregate); rendered inside the existing 'saved' state card, directly below the optional notes paragraph, gated on both `pre` and `retro` being non-null (silent no-op otherwise — no partial-data copy branch). **Design choice: embedded in `OutcomeTracker`'s existing 'saved' block rather than shipped as a new sibling component** (the shape originally suggested in §5) — `displayOutcome` (`existingOutcome ?? localSaved`) already converges both the fresh-save-this-session and returning-visit cases in one place, so embedding fires the note at the actual peak-intent moment (seconds after the outcome is filed) for free; a separate server-rendered sibling card (the BiasNoteCard shape) would only have shown the note on the user's *next* visit to the page, since `existingOutcome` is a server prop that doesn't update client-side after a fresh save. See KDD 193. No new query: `/api/outcome` already computes and returns `calibration_delta` on every save and `sessions.pre_decision_confidence` / `outcomes.retrospective_confidence` were both already-populated columns — this sprint only surfaces data the system was already computing and discarding. `app/record/[id]/page.tsx` — one line added, passing `session.pre_decision_confidence ?? null` into the new prop. 2 files changed, 0 new files, 0 schema changes, 0 new env vars, 0 new queries. KDD 193 added. SECOND-USE RETENTION STRATEGY §2 and §5 updated to reflect lever (ii) as shipped — levers (i) and (iii) remain the explicit next-session starting point, still pending scoping with Ken.
### Date: June 20, 2026 | Status: Sprint RET-3 (Second-Use Retention — Item A + Item C + Copy Fix) — Third and final piece of the second-use retention work, building on RET-1/RET-2. **Item A — BiasNoteCard:** `components/BiasNoteCard.tsx` (NEW) — presentational card surfacing one plain-English bias note for the session just completed; works from session 1, no Mirror subscription required. `app/record/[id]/page.tsx` (CHANGED) — server-side bias note query added after `outcome` resolution: resolves identity tier (`user_id` > `user_email` > `device_id`, same precedence as `/api/bias-score` writes), queries `bias_library` for rows where `session_ids` contains the current session id and `activation_contexts[session.id]` exists, filters to `signal_type === 'distorting'` only (neutral/adaptive classifications are not shown as a caution), ranks by `prosecutor_score`, takes the top one, truncates `reasoning` to 220 chars. Rendered immediately after `OutcomeTracker`. **Item C — EarlyEchoCard structural upgrade:** `app/api/record/[id]/echo-hint/route.ts` (NEW) — lightweight, read-only endpoint that calls `scoreStructuralSimilarity()` (the pure, synchronous scorer in `lib/structural-retrieval.ts`) directly against up to 20 past same-identity ontology snapshots, bypassing `retrieveStructuralMatches()` entirely — the `MIN_SESSIONS=5` gate inside that function is never touched, no LLM call (`annotateMatch()` not invoked), no write to `structural_matches`/`structural_scores` (those tables remain the exclusive output of `/api/structural-match`, called from `SessionView` during the live session). Reuses the existing `MATCH_THRESHOLD` env var (default 45) so a "hint" is never shown for a weak match. Returns only an abstracted dimension label (e.g. "an unresolved prior decision") + coarse month/year — never the matched session's decision text. Requires identity (`user_id` or `user_email`) — anonymous/device-only sessions get `{ available: false }`, which is intentional: gives `EmailCaptureCard` (RET-1) a second concrete reason to convert. `components/EarlyEchoCard.tsx` (CHANGED) — at session count 3+, fires this endpoint client-side after the count-only copy has already rendered (progressive enhancement, no loading state, no layout shift); on a qualifying response, upgrades the sub-line in place to name the shared dimension; on any non-response (no identity, no past sessions, sub-threshold match, network failure) the original count-only copy is left untouched. **Copy fix:** `lib/session-score.ts` — the Mirror "NEXT MOVE" string shown at `structural === 50` (neutral baseline, 0 prior sessions) changed from "Structural matching activates once Quorum has prior sessions to compare against — log your next 2–3 decisions to unlock the comparison signal." (internal/ambiguous language, also factually loose against the actual `MIN_SESSIONS=5` gate) to "Bring 3 or more decisions to Quorum and the Council begins connecting patterns across them — each one makes the next analysis more precise." **Item B (bias-aggregate-as-homepage-card) explicitly rejected** — see KDD 189. 2 new files (`BiasNoteCard.tsx`, `echo-hint/route.ts`), 3 modified files (`EarlyEchoCard.tsx`, `app/record/[id]/page.tsx`, `lib/session-score.ts`), 0 schema changes, 0 new env vars (echo-hint reuses existing `MATCH_THRESHOLD`). KDDs 187–192 added. See new SECOND-USE RETENTION STRATEGY section for full scoring methodology, loop analysis, and the three remaining levers toward a 95+ retention score.
### Date: June 20, 2026 | Status: Sprint RET-2 (Decision Brief Freemium — SynthesisCard Gate Removal) — Follow-up fix discovered via screenshot: the in-session "Generate Decision Brief" button in `components/SynthesisCard.tsx` still showed the pre-RET-1 paid-access-code flow ("Decision Brief (paid)" → "Enter access code" → "Unlock" / "Invalid code. Contact Kunal to get access.") even though `app/api/record/[id]/brief/route.ts` and `components/BriefCTA.tsx` (the record-page download surface) had already been made free in RET-1. Two separate UI surfaces existed for the same feature and only one had been updated. Fix: removed `BRIEF_KEY` localStorage helpers (`getStoredBriefCode`/`storeBriefCode`), 6 now-dead state vars (`briefAccess`, `tokenInput`, `tokenError`, `checkingToken`, `briefGate`, `accessCode`), the mount-time `useEffect` reading a stored brief code, `handleValidateCode()` and `checkBriefAccess()` functions, the 5-state gate button block (`locked`→`prompt`→`checking`→`unlocked`/`invalid`), and the full "Decision Brief — Paid Feature" `briefAccess === 'gated'` block. The `token:` field was also removed from the synthesis API call payload — confirmed via code read that `app/api/persona/route.ts` never read this field, so its removal has zero behavioural effect on Council generation. Replaced with a single always-visible "Generate Decision Brief" button, matching the now-free behaviour already live via BriefCTA. `handleGenerateBrief()`, the inline brief stream, and Show/Hide Brief were untouched — only the gate wrapper was removed. 1 file changed (`components/SynthesisCard.tsx`), 0 schema changes, 0 new env vars. No new KDD (this is a consistency fix completing RET-1's intent, not a new design decision — see KDD 187 for the consolidated rationale covering both surfaces).
### Date: June 20, 2026 | Status: Sprint RET-1 (Second-Use Retention — Decision Brief Freemium + Early Retention Cards) — First of three sessions targeting the second-use retention audit (see new SECOND-USE RETENTION STRATEGY section). Two threads. **(1) Decision Brief made free + dark/light PDF mode:** `app/api/record/[id]/brief/route.ts` — `BRIEF_ACCESS_TOKEN` token-gate check removed from the `GET` handler entirely (Decision Brief is now free for all users, all tiers); single dark-only `C` colour palette + `PERSONA_ACCENT` map split into `DARK_PALETTE`/`LIGHT_PALETTE` and `PERSONA_ACCENT_DARK`/`PERSONA_ACCENT_LIGHT` (new `Palette` type, ~60 existing `C.xxx` call sites resolve via lexical scoping with zero other line changes), `buildPdf()` gains a `theme: 'dark' | 'light'` parameter selecting the active palette pair into local `C`/`PERSONA_ACCENT` consts, `fillPageDark()` renamed to theme-agnostic `fillPage()` (all call sites updated), `GET` reads `?theme=light|dark` from the query string (default `dark`) and passes it through. `components/BriefCTA.tsx` — full rewrite: all token/access-code state and the `/api/brief-access` validation call removed; replaced with a Dark/Light pill toggle (client state only) and a direct `Download PDF →` button hitting `/api/record/[id]/brief?theme=...`. `/api/brief-access` route is now dead code (nothing calls it) — flagged for deletion in PENDING/NEXT SESSION; `BRIEF_ACCESS_TOKEN` Railway env var is similarly now unused. **(2) Early retention cards on the record page:** `components/EmailCaptureCard.tsx` (NEW) — decision-framed email capture ("Want us to check back on this?"), calls existing `/api/auth`, hidden once `quorum_user_email` exists in localStorage or once dismissed for the session; deliberately not framed as generic account creation. `components/EarlyEchoCard.tsx` (NEW, count-only version — see RET-3 for the session-3+ upgrade) — reads `getStoredSessionIds()` client-side, shows a lightweight session-count signal at counts 2–4 ("Second decision recorded. 3 more and Quorum begins recognising structural patterns…"), hidden at 0–1 or 5+ sessions (`MemoryEngineStatus` on the homepage owns 5+). `app/record/[id]/page.tsx` — both cards wired in below `BriefCTA`. 5 files changed/new (`brief/route.ts`, `BriefCTA.tsx`, `EmailCaptureCard.tsx`, `EarlyEchoCard.tsx`, `record/[id]/page.tsx`), 0 schema changes, 0 new env vars. KDD 187 added (consolidated rationale also covers RET-2's SynthesisCard fix). Full retention-score audit, the 7-phase scoring methodology, and the path to 95+ documented in new SECOND-USE RETENTION STRATEGY section below.
### Date: June 16, 2026 | Status: Sprint CX-PAY (Razorpay Self-Serve Payment + Cancellation) — Full self-serve Mirror subscription flow shipped, replacing the manual unlock-code-and-bank-transfer path for new conversions (unlock codes remain available for early-access/founding users). **Subscription creation:** `app/api/payment/create-subscription/route.ts` rewritten — replaces the Sprint 4/19 `PAYMENT_WEBHOOK_SECRET`-gated stub with Bearer-token user auth (`anonClient.auth.getUser(token)`); creates a Razorpay Subscription against `RAZORPAY_MONTHLY_PLAN_ID` or `RAZORPAY_ANNUAL_PLAN_ID`; `notes.user_id` + `notes.plan` injected at creation so the webhook can resolve identity without a DB round-trip. **Webhook:** `app/api/payment/webhook/route.ts` (NEW) — HMAC-SHA256 signature verification (`crypto.timingSafeEqual`, constant-time), handles `subscription.activated` (initial upsert into `mirror_access` via `payment_id` = Razorpay `subscription_id`), `payment.captured` (renewal — extends `expires_at`, with a DB-lookup fallback if `notes` aren't propagated), `subscription.cancelled`/`subscription.expired` (no-op by design — `expires_at` gates access naturally, user keeps Mirror until paid period ends). `expires_at` buffer: +33 days monthly, +368 days annual (3-day grace over the nominal period). **Checkout UI:** `components/PaymentButton.tsx` (NEW) — client component, dynamically loads `checkout.razorpay.com/v1/checkout.js`, opens Razorpay modal with `subscription_id`, gold theme (`#c9a84c`) + deep-navy backdrop (`#08111f`) + Quorum icon (`/icon-512.png`) for brand match: `onSuccess` triggers the existing `handleUnlocked()` transition — same code path as unlock codes. **TeaserView CTA:** `app/mirror/page.tsx` — `PRICING_URL` external link replaced with two inline `<PaymentButton>` instances (monthly/annual) below `UnlockCodeInput`; `userEmail` threaded from session into `TeaserView` props for checkout prefill. **Cancellation:** `app/api/payment/cancel-subscription/route.ts` (NEW) — Bearer-auth, looks up `mirror_access.payment_id`, calls `razorpay.subscriptions.cancel(id, true)` (cancel-at-cycle-end — access continues until `expires_at`); guards against `advisory` tier (403, not self-service) and code-activated rows with no `sub_`-prefixed `payment_id` (400, directs to contact). `components/CancelSubscription.tsx` (NEW) — idle → confirming → done/error states, rendered at the bottom of `UnlockedView` gated on `status.tier === 'mirror'` (note: `MirrorTier` is only `'mirror' | 'advisory'` — monthly/annual both collapse to `'mirror'` once unlocked; an earlier draft incorrectly checked for `'monthly'`/`'annual'` literals and was corrected before shipping). **Deployment fixes (non-code-logic, infra):** `nixpacks.toml` (NEW) — overrides Nixpacks install phase from `npm ci` to `npm install`, required because `npm ci` enforces strict lock-file sync and Ken's laptop has IT-policy restrictions blocking local Node.js installation (winget/scoop both blocked), so the lock file couldn't be regenerated locally before the `razorpay` dependency was added; Railway dashboard "Build Command" override alone does not affect the install phase — the Nixpacks-level override was required. `next.config.ts` CSP patched — `script-src` gains `https://checkout.razorpay.com` (checkout.js was blocked, causing "Checkout failed to load"), `connect-src` gains `https://api.razorpay.com` + `https://checkout.razorpay.com`, `img-src` gains `https://*.razorpay.com` (card brand logos), new `frame-src https://api.razorpay.com` directive added (checkout renders in an iframe), and `payment=()` removed from `Permissions-Policy` (was actively blocking the Payment API). **Confirmed working end-to-end:** checkout opens, test-card payment completes, Mirror unlocks, cancellation flow tested live and confirmed working by Ken. **Not yet live:** Razorpay KYC still under review (2–3 business days as of June 15) — currently running on `rzp_test_` keys; swap to `rzp_live_` is a single Railway env var change once KYC clears, no code change. International payments (USD/other currencies) already enabled on the Razorpay account ahead of KYC completion — PA-CB cross-border license confirmed in place. 4 new files (`webhook/route.ts`, `PaymentButton.tsx`, `cancel-subscription/route.ts`, `CancelSubscription.tsx`), 1 rewritten file (`create-subscription/route.ts`), 2 modified files (`app/mirror/page.tsx`, `next.config.ts`), 1 new config file (`nixpacks.toml`), 1 new npm dependency (`razorpay@^2.9.6`), 0 schema changes (`mirror_access.payment_id` + `.subscription_id` columns already existed, unused until now). 5 new Railway env vars required. KDDs 182–186 added.
### Date: June 15, 2026 | Status: Sprint CX1 (TeaserView Conversion Fix) — Three targeted changes in `app/mirror/page.tsx` to resolve early-user UX observation (Shivani, founding user): "building" badge was ambiguous between loading-state and paywall, and the CTA card did not explicitly connect to the locked sections above it. (1) `lockedBadge`: text changed `"building"` → `"Mirror"`; colour changed grey/`--text-4` → gold/`--gold`; background changed `--bg-card` → `rgba(201,168,76,0.06)`; border changed `--border-dim` → `--gold-dim`; `IconLock size={10}` added (already imported in file); `onClick` added — smooth-scrolls to `#mirror-cta` anchor on the CTA card. (2) CTA card: `id="mirror-cta"` added for scroll anchor; headline simplified from "Activate Mirror — complete your Judgment OS" to "Activate Mirror"; subheadline changed from "Your behavioral mirror is already building." to "Unlocks these sections:"; explicit feature list added (Bias Fingerprint, Decision Independence Score, Contradiction Detector, Confidence Calibration); `UnlockCodeInput` promoted above "See full plans →" link (correct priority for early-access code users who should not be routed through a pricing page before their code input); price line moved below feature list; "See plans →" renamed "See full plans →". (3) Zero-bias teaser copy: "Bias patterns are being compiled from your decisions." → "No patterns confirmed yet. Run a few more decisions and your Bias Fingerprint will start forming — activate Mirror to track them as they build." — removes "compiled" loading ambiguity; accurately frames as data-accumulation + Mirror-required. 1 file changed (`app/mirror/page.tsx`), 0 schema changes, 0 new env vars, 0 new routes. KDDs 180–181 added. **Note: CTA card "See full plans →" subsequently replaced by inline PaymentButton instances in Sprint CX-PAY (June 16) — see above.**
### Date: June 13, 2026 | Status: DeepSeek Model Upgrade + Copy Fixes — lib/ai-client.ts updated: `deepseek-chat` (deprecated July 24, 2026) replaced with `deepseek-v4-pro` as default; `DEEPSEEK_THINKING` env var added (default: `disabled`; controls thinking mode for all DeepSeek calls); TypeScript overload-resolution bug fixed in `streamDeepSeek` (`create({...} as any) as any` + `as AsyncIterable<any>` on withRetry result). `getProviderInfo()` extended with `deepseekThinking`. v4-pro chosen over v4-flash for all DeepSeek calls at current scale (see KDD 176). Two pricing copy fixes in `app/mirror/page.tsx`: (1) `PRICING_URL` corrected from `www.quorumvault.org` → `quorumvault.org`; (2) advisor comparison copy updated from `₹50,000` → `₹5 lakh/year` (₹50K vs ₹39,999/yr read as an ₹11K saving — wrong framing for HNI ICP). TD-3 logged: per-call thinking mode control deferred (enable for non-streaming completions only; see below). KDDs 176–179 added. 1 file changed (`lib/ai-client.ts`), 1 file changed (`app/mirror/page.tsx`), 2 new Railway env vars (`DEEPSEEK_MODEL=deepseek-v4-pro`, `DEEPSEEK_THINKING=disabled`).
### Date: June 13, 2026 | Status: Mirror Tiering Sprint (Phases 1, 2, 4, 5) — Two-tier Mirror introduced: self-serve **Mirror** (₹3,999/mo · ₹39,999/yr, repriced from ₹1,499/mo · ₹9,999/yr) and founder-led **Mirror Advisory** (access_type = 'advisory', capped at 5 cohort, internal price anchor ~₹75,000/quarter — never published). Phase 1: pricing copy updated in app/mirror/page.tsx and website index.html (billing toggle + price card + modal). Phase 2: 'lifetime' plan retired — removed from SubscriptionPlan type, admin grant validTypes, payment validPlans, and /api/mirror/unlock tokenMap (MIRROR_TOKEN_LIFETIME + legacy MIRROR_UNLOCK_TOKEN both removed); getMirrorAccessState() retains defensive handling of any pre-existing 'lifetime' rows. Phase 4: new MirrorTier type ('mirror'|'advisory'), getMirrorTier() helper (additive — does not touch getMirrorAccessState() or its 18 callers), MirrorStatus.tier resolved in /api/mirror/status. Phase 5: tier-aware differentiation across 4 modules — Benchmark (Advisory-only, AdvisoryUpsellCard otherwise), Contradiction Detector (Advisory bypasses 40-session threshold + sees full ContradictionCard detail; Mirror sees new ContradictionSummaryView — count + category, no exact statements), Session Reliability Index ("Your next move" Advisory-only), Decision Rules (Advisory bypasses 8-session threshold, enforced server-side in /api/mirror/rules via getMirrorTier()). 2 new files (lib/mirror-tier-config.ts, components/AdvisoryUpsellCard.tsx), 8 modified files, 0 schema changes, 0 new env vars (2 env vars retired). Full design rationale, module-by-module diff table, grant/test instructions in new MIRROR vs MIRROR ADVISORY section. KDDs 171–175 added.
### Date: June 12, 2026 | Status: Sprint S0 (Subject Orientation question) — Examiner question set redesigned. New conditional S0 question fires when decision brief is underspecified (< 25 words, no context_text). Max questions reduced from 4 to 3 (rule budget: 2 without S0, 1 with S0; C0 always retained). S0_TEMPLATES + C0_TEMPLATES banks (5 variants each) replace single-template constants; deterministic per-session selection via sessionId hash-mod. All personalisation calls now parallel (single Promise.all). BRIEF badge added for S0 questions. Examiner tagline changed to "Key questions the council couldn't answer without you". KDDs 163–170 added. 2 files modified (app/api/examiner/route.ts, components/ExaminerPanel.tsx), 0 schema changes.
### Date: June 11, 2026 | Status: Engagement Pull Sprint (Features 5 & 6) — CalibrationRevealCard (home-screen calibration hook for unlocked users with ≥3 outcomes, fetches /api/mirror/calibration, shows avg_delta + pattern label + trend arrow + link to /mirror#msec-calibration), mirror-insight-email cron (Mondays 04:00 UTC, teaser users only, bias patterns as email body via BIAS_PARAMETERS + Resend REST, 7-day cooldown via mirror_insight_email_log table, cron-job.org job added). Bugfix: MirrorOpenLoopCard patternCount now falls back to teaserBiases.length when rule engine returns 0 (bias_library and sessions_ontology.rule_engine_result are separate detection systems). 2 new files, 1 modified, 1 new SQL migration.
### Date: June 11, 2026 | Status: Engagement + PWA Sprint — Reanalyze Email Cadence cron (7/14/30d Resend nudges + push), MirrorOpenLoopCard (home-screen open-loop teaser for non-unlocked users), full PWA (manifest.json, push-only service worker, push_subscriptions table, /api/push/subscribe, lib/push.ts VAPID sender, PushEnablePrompt with iOS detection), version-check UpdateBanner (/api/version + 5-min poll + Refresh prompt), FROM_EMAIL display-name fix for reanalyze cron. 9 new files, 5 modified, 2 SQL migrations, 4 new env vars (RESEND_API_KEY, FROM_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
### Date: June 9, 2026 | Status: Mirror UX Overhaul — Sprints M1–M6 fully implemented. WelcomeMirrorCard, MirrorSummaryCard, MirrorNav, AttentionZone, MirrorInsightCard. 5 new components, 1 new API route, 15+ modified files. DB migration: last_mirror_viewed_at on user_preferences. 4 bugfixes (encrypted outcome text, Pattern Memory active guard, open loops show-more, examiner quote decrypt).
### Date: June 7, 2026 | Status: Security & Disclosure Sprint: VDP (/.well-known/security.txt), encryption key rotation script, IST timezone migration, website legal route for security.txt. Sprint B hybrid routing confirmed deployed (code audit). SQL migrations confirmed run. encrypt-migrate route deleted. 2 new files, 5 modified.
### Date: June 6, 2026 | Status: Privacy & Security Sprint Plan (Sprints 1–6) fully implemented. Website + app privacy-compliant: cookie consent, legal pages, RLS hardening, rate limiting, data export/deletion, audit trail. 18 new files, 19 modified files, 3 SQL migrations, 4 new env vars.
### Date: June 4, 2026 | Status: Chunk 1 (Decision State + Switch Conditions + Rule Recall) + Chunk 2 (Monthly Judgment Review / Loop Closure) fully implemented and deployed. Rule Recall timing + injection bugs fixed post-deploy. 9 new files, 5 modified files, 1 DB migration, 0 new env vars.
### Date: June 3, 2026 | Status: Hybrid AI Routing — lib/ai-client.ts rewritten with per-call provider override + ROUTING_MODE env var (hybrid/deepseek_only). Sprint A (ai-client.ts) deployed. Sprint B (9 call-site patches) + ontology-tagger.ts migration patch ready to apply. Claude for 8 structured calls, DeepSeek for 7 generative/prose calls.
### Date: June 2, 2026 | Status: Sprint R_JC — userJudgmentContext() completion. Three missing longitudinal pieces shipped: prior C0 principles injection, recurring regret signal, Examiner bias-aware sharpening. Two files changed: lib/bias-scorer.ts + app/api/examiner/route.ts. Zero schema changes.
### Date: June 2, 2026 | Status: Security Sprint — Application-level AES-256-GCM field encryption. All raw user input encrypted at rest in Supabase. 21 files patched + lib/encryption.ts created + migration endpoint + test script. Backfill complete, verified via SQL audit.
### Date: June 2, 2026 | Status: Fix 1 (light mode button visibility) — 8 semantic CSS tokens, 9 component files patched. Fix 2 (Supabase Magic Link via Resend) — SMTP relay configured, branded HTML template live.
### Date: June 1, 2026 | Status: Additional Risk D fully implemented (D1 + D2 + D3) — avoidance detection, Mirror surface, dismiss endpoint, synthesis resubmission context all complete
### Date: June 1, 2026 | Status: Audit R9 (provisional bias threshold ≥3), R10 locked as permanent skip, R11 (env-configurable thresholds + admin dashboard R11 section) — implemented; deploy pending
### Date: May 31, 2026 | Status: Sprints 32–34 deployed + C0 fix + R3 + R4 + R5 + Additional Risk C + Additional Risk E implemented; Additional Risk A confirmed pre-existing fix; Risk F confirmed pre-existing fix
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
                            → S0 fires if decisionWordCount < 25 AND !contextText (Sprint S0)
                            → personalises each rule question to decision_text (Sprint 12)
                            → returns questions (max 3) + rule_mode
        ↓ (user answers)
POST /api/examiner        → saves examiner_responses (with rule_id) → fires /api/bias-score (non-blocking)
                            → fires /api/mirror/independence (non-blocking) ← ✅ Sprint 18a restored
                            → fires /api/mirror/contradictions (non-blocking) ← ✅ Sprint 18a restored
        ↓ (after examiner submit, if not REDIRECT)
POST /api/persona (synthesis) → synthesis with buildCouncilContext injected into system prompt (Sprint 12)
                            ↳ Sprint R3: computePersonaRelevance() + buildRelevanceBlock() injected
                              as MANDATORY NON-NEGOTIABLE final layer — weights 6 advisors by rule
                              signals + ontology dims + structural match quality
        ↓ (post-synthesis — Sprint 31)
ContradictionBanner       → GET /api/mirror/contradictions — fires if violationSessionId === session.id
RecordReceipt             → shows real DB session count (totalSessionCount from server prop)
        ↓ (Mirror, separate routes)
Mirror modules: /api/mirror/{timeline|fingerprint|independence|rules|contradictions|outcomes|alerts|calibration|patterns}
                            ↳ Sprint 19: all routes use getMirrorAccessState() helper
                            ↳ Sprint 20 NEW: /api/mirror/benchmark
                            ↳ Sprint 20 NEW: /api/mirror/sessions-lookup
                            ↳ Sprint 21 NEW: /api/mirror/preferences
                            ↳ Sprint M1 NEW: /api/mirror/summary
```

---

## DATABASE SCHEMA (current as of Sprint 20)

### Encrypted columns (Security Sprint — June 2, 2026)
All raw user input is encrypted at rest using AES-256-GCM (application-layer). Anyone with direct Supabase access sees only `enc:<iv>:<authTag>:<ciphertext>` strings. Derived tables (numeric scores, enums, AI summaries) are intentionally left plaintext.

| Table | Encrypted columns |
|---|---|
| `sessions` | `decision_text`, `context_text` |
| `messages` | `content` (all roles) |
| `examiner_responses` | `question_text`, `response_text` |
| `outcomes` | `what_decided`, `notes` |
| `structural_matches` | `context_block` (text), `matches_json` (JSONB — stored as `{ _enc: "enc:..." }`) |

**Left plaintext (derived tables — no raw user text):** `sessions_ontology`, `bias_library`, `structural_scores`, `independence_score_log`, `contradiction_runs`, `avoidance_alerts`, `mirror_access`, `user_preferences`, `contradictions.principle_text/violation_text` (AI-derived summaries, not verbatim user input).

**Key:** `DB_ENCRYPTION_KEY` Railway env var (64 hex chars / 32 bytes). See lib/encryption.ts.
**Backward compat:** `decrypt()` passes through any value not starting with `enc:` — old plaintext rows remain readable. Backfill migration run and verified June 2, 2026.

### mirror_access ← updated Sprint 19 migration; access_type retired 'lifetime' June 13, 2026; payment_id now actively populated by Sprint CX-PAY (June 16, 2026)
```
id               uuid PK
user_id          uuid UNIQUE FK → auth.users
access_type      text CHECK ('annual','monthly','advisory') DEFAULT 'monthly'
                 ← 'lifetime' retired (Mirror Tiering Sprint, June 13). No CHECK constraint
                   enforced at DB level (never was), so any legacy 'lifetime' row from
                   before retirement still reads correctly — see access logic below.
granted_at       timestamptz NOT NULL DEFAULT now()
started_at       timestamptz
expires_at       timestamptz   ← null = never expires (advisory; legacy lifetime).
                   For monthly/annual via Razorpay (Sprint CX-PAY): set to now() + 33 days
                   (monthly) or now() + 368 days (annual) on subscription.activated /
                   payment.captured, and re-extended on every renewal payment.captured.
                   Cancellation does NOT null this out — see KDD 183.
payment_ref      text          ← Sprint CX-PAY: `razorpay:sub:{subscription_id}` for self-serve subs
payment_id       text          ← Sprint CX-PAY: stores the Razorpay subscription_id (sub_xxx) for
                   monthly/annual rows created via self-serve checkout. Used by both the webhook
                   (renewal lookup fallback) and /api/payment/cancel-subscription (resolves which
                   Razorpay subscription to cancel). Rows created via unlock code or admin grant
                   have payment_id = null — cancel-subscription route checks for this and returns
                   a "contact us" message rather than calling the Razorpay API on a null/invalid id.
subscription_id  text          ← present in schema since Sprint 19; not written to by CX-PAY (CX-PAY
                   uses payment_id instead, consistent with the column the webhook code reads/writes).
                   Column retained for backward compat with any pre-existing rows; not actively used
                   going forward unless a future sprint consolidates the two columns.
```

**Access logic (getMirrorAccessState) — unchanged by Mirror Tiering Sprint:**
- `advisory` → always `unlocked`
- `lifetime` (legacy, retired — no longer grantable) → always `unlocked`, honoured defensively if present
- `annual` / `monthly` → `unlocked` if `expires_at > now()` or `expires_at IS NULL`; else fall through
- No valid row or expired → session count ≥ 3 → `teaser`; else `locked`

**Tier resolution (getMirrorTier, Phase 4 — additive, separate from the above):**
- Only called when `getMirrorAccessState()` returns `unlocked`.
- `access_type === 'advisory'` → `tier: 'advisory'`. Everything else (`monthly`/`annual`/legacy `lifetime`) → `tier: 'mirror'`.
- See **MIRROR vs MIRROR ADVISORY** section below for the full tier feature diff, grant instructions, and test plan.

### sessions, sessions_ontology, outcomes, structural_scores, messages, contradictions, examiner_responses, session_requests, brief_access_tokens, structural_matches, sessions_pending_outcomes
All unchanged from Sprint 18b.

### audit_log ← Sprint 6 (S6-01) NEW
Write-once audit trail. Service-role only (no SELECT policy — users cannot read it).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | gen_random_uuid() |
| `created_at` | timestamptz | default now() |
| `actor_id` | uuid | auth.users.id (nullable — anonymous events logged) |
| `actor_email` | text | For readability in admin viewer |
| `action` | text | See action strings below |
| `resource_id` | uuid | session id, user id, etc. |
| `ip_address` | text | x-forwarded-for first value |
| `user_agent` | text | |
| `metadata` | jsonb | Arbitrary context |

Action strings: `session.create` · `auth.magic_link_sent` · `account.export` · `account.delete` · `admin.access` · `admin.auth_failed` · `admin.locked_out`

### bias_library ← Sprint 5 (S5-04) + Sprint 6 update
`user_id uuid FK → auth.users ON DELETE CASCADE` column added (Sprint 5-04 migration). Was email-only keyed. RLS policy now checks `user_id = auth.uid() OR user_email = (auth.jwt() ->> 'email')`. Partial unique index on `(user_id, bias_parameter) WHERE user_id IS NOT NULL` added.

### sessions ← Chunk 1 update (June 4, 2026)
### sessions ← Chunk 1 update (June 4, 2026)
Six new columns added via `supabase/sprint_chunk1_commitment.sql`:

| Column | Type | Encrypted | Purpose |
|---|---|---|---|
| `commitment_leaning` | TEXT | ✅ | "Where are you leaning + first move?" (clubs current_leaning + next_action) |
| `commitment_switch` | TEXT | ✅ | "What would change your course?" (clubs switch_conditions + main_risk) |
| `commitment_review_date` | DATE | ❌ | When user intends to revisit. Primary retention hook for open-loops list |
| `commitment_captured_at` | TIMESTAMPTZ | ❌ | Timestamp of DecisionStateCard submission. Null = not captured |
| `rule_recall_choice` | TEXT (enum) | ❌ | 'applied' \| 'exception' \| 'ignored'. Null = no rule surfaced |
| `rule_recall_rule_text` | TEXT | ✅ | The rule text surfaced to the user via RuleRecallBanner |

Encrypted columns: `commitment_leaning`, `commitment_switch`, `rule_recall_rule_text` — encrypted via `encrypt()` in commitment route POST/PATCH; decrypted in `session/route.ts` GET.

### user_preferences ← Sprint 21 + Sprint M1 update
`last_mirror_viewed_at TIMESTAMPTZ` column added (Sprint M1 migration — run once):
```sql
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ;
```
Stamped by GET /api/mirror/summary on every Mirror page open (best-effort upsert side-effect). Used to compute the "since last visit" delta line in MirrorSummaryCard. Null on first visit (no delta shown). See KDD 152.

`style_cue TEXT CHECK ('direct','challenge','pattern','risk','stakeholder','long')` column added.

### bias_library ← Sprint 20 update
`activation_contexts` JSONB column now stores `signal_type: 'distorting'|'neutral'|'adaptive'` per session key.

---

## CODEBASE MAP

```
lib/
  push.ts                  — ✅ Engagement+PWA Sprint NEW — sendPushToUser(userId, {title, body, url}).
                             Uses web-push + VAPID (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
                             VAPID_SUBJECT). Fetches push_subscriptions for user, sends to each,
                             stamps last_used_at on success, prunes subscription on 410/404
                             (expired/unregistered). Returns { sent, failed }. No-ops with a warning
                             if VAPID keys unset. Called from reanalyze-email cron (non-blocking).
  encryption.ts            — ✅ Security Sprint NEW — AES-256-GCM field encryption module.
                             encrypt(value): wraps plaintext in enc:<iv>:<authTag>:<ciphertext>.
                             decrypt(value): passes through non-enc: values (backward compat).
                             encryptJson(data): wraps JSON as { _enc: "enc:..." } for JSONB columns.
                             decryptJson<T>(value): handles both old array and new { _enc } format.
                             Sprint 5 (S5-02): fails CLOSED in production — throws if DB_ENCRYPTION_KEY
                             is not set in NODE_ENV=production. Logs CRITICAL warning at module load.
                             dev: still no-op when key unset (backward compat preserved).
                             All other files import exclusively from here — never instantiate crypto directly.
  rate-limit.ts            — ✅ Sprint 5 (S5-01) NEW — In-memory sliding-window rate limiter.
                             checkLimit(ip, cfg): LimitResult. getClientIP(req): Railway x-forwarded-for.
                             tooManyRequests(result, action): 429 Response with layman message + resetAt.
                             LIMITS: pre-configured per-route configs (session/persona/examiner/auth/voiceTts/structuralMatch/outcome).
                             GC: expired entries purged every 15 min. Single-instance Railway — no Redis needed.
  audit.ts                 — ✅ Sprint 6 (S6-01) NEW — Audit log helper.
                             writeAuditLog(event): writes to audit_log table via service client. Never throws — errors swallowed.
                             getAuditContext(req): extracts ip_address + user_agent from request.
                             getUserFromBearer(req): verifies Bearer token → returns { id, email } | null.
                             Actions: session.create · auth.magic_link_sent · account.export · account.delete · admin.access · admin.auth_failed · admin.locked_out
  mirror-access.ts         — ✅ Sprint 19 NEW — getMirrorAccessState() helper.
  rule-engine.ts           — ✅ Sprint 27 — R7 identity gate tightened (>3→>2); question template fix.
                             also Sprint 19a: R2 ambiguity threshold corrected to ≥ 4
  types.ts                 — ✅ Sprint M4 — FingerprintTile: lastFiredAt: string | null added
                             (most recent session date from tile.sessionIds — drives "Active" badge in PatternTile).
                             RulePattern: recent_fire_count?: number added (fires in last 10 sessions — drives
                             "↑ Increasing" badge in PatternStore).
                           — ✅ Sprint 30 — Session interface gains decision_type_primary +
                             stakes_reversibility. also Sprint 19/20/21: MirrorGateState, MirrorAccessState,
                             SubscriptionPlan, BiasSignalType, StyleCue, BenchmarkData, SessionPreview, RulePattern
                             R4 — SessionScoreData interface appended (composite score + 4 sub-scores +
                             calibrationPending + distortingBiasLabels + actionPlan).
  personas.ts              — ✅ Sprint 34 — SYNTHESIS prompt: PATTERN OBSERVATION section now
                             includes explicit "CRITICAL: Do NOT write 'PATTERN OBSERVATION:' as a
                             label or header — begin directly with the natural-language opener."
                             Prevents the AI from copying the internal section name into output.
                             Sprint 26 — RESPONSE STRUCTURE header tag reminder all 6 personas.
                             Sprint 25 — WORD_LIMIT_PREFIX constraint 0 (header tags). SYNTHESIS TRADE-OFF block.
                             Sprint 21 — USER_STYLE_BOOSTS constant. computePersonaOrder() userStyle param.
                             Sprint 20 — DECISION_BRIEF DECISION-MAKER OBSERVATION block.
  bias-scorer.ts           — ✅ Sprint B (June 3, 2026): createCompletion → { provider: 'anthropic' }. Rationale: complex nested JSON; errors corrupt Ledger + Mirror fingerprint downstream. Confirmed deployed (code audit June 7, 2026).
                           — ✅ Sprint RE — fetchCalibrationContext() (private): queries sessions
                             joined with outcomes for calibration_delta; gates on ≥3 paired points
                             AND |avgDelta| ≥ 0.3; returns plain-English synthesis-ready description
                             of confidence calibration pattern, or ''. fetchActiveContradictions()
                             (private): queries contradictions table for active (non-dismissed)
                             tensions, limit 2 by recency; returns synthesis-ready block or ''.\n                             fetchUserBiasContext() extended: all 3 DB queries now run in parallel
                             via Promise.all. calibrationLine + contradictionBlock appended to
                             synthesisBlock before MANDATORY directive. Directive extended with
                             calibrationDirective + contradictionDirective addenda — each supplies
                             concrete example phrasings so synthesis surfaces findings as natural
                             prose observations, never as labelled data points or section headers.
                             Return shape and call signature unchanged. One file changed.
                             Sprint 34 — directiveBody (synthesisBlock) updated:
                             (a) explicitly bans raw bias_key output (e.g. "loss_aversion_reversal")
                             — instructs plain-language translation instead;
                             (b) explicitly forbids "LONGITUDINAL BIAS ASSESSMENT:" or any section
                             header — weave into existing prose;
                             (c) all three tiers (distorting/forming/neutral) updated consistently.
                             Sprint 20 — classifyBiasSignal(), getPredominantSignal()
                             R9 fix (June 1, 2026) — isConfirmed threshold raised from ≥2 to ≥3.
                             statusLabel correctly pluralises for 2-detection forming entries.
                             Columns description in synthesis prompt updated: "CONFIRMED = 3+ detections,
                             FORMING = 1–2 detections". Aligns with mirror-fingerprint.ts.
                             Sprint R_JC (June 2, 2026) — fetchUserPrinciplesBlock() (private): queries
                             examiner_responses for C0 responses; decrypt() applied; gate ≥3 responses.
                             fetchRecurringRegretBlock() (private): dimensional overlap regret detection;
                             REGRET_DIM_LABELS; gates ≥5 sessions + ≥2 matching bad-outcome sessions.
                             fetchExaminerBiasHint() (EXPORTED): top 2 confirmed biases, hint string.
                             fetchUserBiasContext() restructured: 2-round parallel — round 1 adds
                             session IDs query; round 2 runs principles + regret in parallel.
                             principlesBlock + regretBlock added to longitudinalContext.
                             principlesDirective + regretDirective appended to MANDATORY directive.
                             import { decrypt } added. Zero schema changes.
  mirror-fingerprint.ts    — ✅ Sprint M4 — After building confirmedTiles and formingTiles, batch-fetches
                             sessions.created_at for all tile session IDs in a single query. dateMap built from
                             results. getLatest() computes most recent session date per tile's sessionIds.
                             lastFiredAt set on all tiles (confirmedTiles + formingTiles). catch(_e) fallback —
                             lastFiredAt stays null if query fails (badges simply absent). Empty catch fix applied:
                             catch {} → catch (_e) {} for SWC compatibility in Next.js 15.2.8.
                           — ✅ Sprint B (June 3, 2026): createCompletion → { provider: 'deepseek' }. Rationale: prose portrait, user-facing narrative; DeepSeek V4 quality-competitive on prose. Confirmed deployed (code audit June 7, 2026).
                           — ✅ Sprint 20 — signalType + sessionIds per tile
                             R9 fix (June 1, 2026) — confirmed threshold raised from ≥2 to ≥3.
                             formingRows now captures detection_count 1 OR 2 (was strictly === 1).
                             Forming tile builder: detectionCount, confidenceWeight, confidenceDots
                             now dynamic from DB row (were hardcoded 1 / 0.30 / 1).
                             humanizeActivationSummary null guard updated to < 3 (was < 2) — 2-detection
                             forming tiles get fallback activation summary; 1-detection tiles still return null.
                             Static interpretation fallback branches: 2-detection → "1 more session to confirm";
                             1-detection → "one more session to confirm".
  ai-client.ts             — ✅ Hybrid Routing Sprint (June 3, 2026) — full rewrite for per-call provider override.
                             GLOBAL_PROVIDER replaces PROVIDER (env var still respected as global fallback).
                             ROUTING_MODE=hybrid → per-call flags respected (default, when env var unset).
                             ROUTING_MODE=deepseek_only → all 15 calls forced to DeepSeek, per-call flags ignored.
                             resolveProvider(requested?) — single internal helper; ROUTING_MODE applied here only.
                             CompletionOptions interface (exported): provider?, systemPrompt?, temperature?.
                             createStream(systemPrompt, messages, provider?) — optional 3rd param; backward compat.
                             createCompletion(prompt, maxTokens, options?) — options object 3rd param; all existing callers unaffected.
                             systemPrompt option: passed as Anthropic system param or OpenAI system message prefix.
                             temperature option: 0.0–1.0; omit for provider default; set low (0.1) for structured JSON.
                             ANTHROPIC_MODEL + DEEPSEEK_MODEL — independent env vars. AI_MODEL still respected as DeepSeek fallback only.
                             getProviderInfo() extended: routingMode, anthropicModel, deepseekModel fields added.
                             Console log on every call: resolved provider + deepseek_only override indicator.
                             Sprint 26 — withRetry() wrapper for DeepSeek 503 (carried forward).
  storage.ts               — ✅ Sprint 24a — removeSessionId(id) export added
  dates.ts                 — ✅ Sprint 30 NEW — formatDate() / formatDateTime() helpers, all IST (Asia/Kolkata)
                             June 7, 2026: IST migration complete — RecordExport.tsx and CalibrationSparkline.tsx now import formatLongDate() / formatShortDate() from this file. No remaining inline 'Asia/Kolkata' timezone strings outside of lib/dates.ts itself.
  ontology-tagger.ts       — ✅ Sprint B (June 3, 2026) — direct SDK instances removed. Confirmed deployed (code audit June 7, 2026).
                             Anthropic + OpenAI imports, PROVIDER/model constants, SDK instances all deleted.
                             createCompletion imported from '@/lib/ai-client'.
                             callTagger() → createCompletion(userMsg, 2000, { provider: 'anthropic', systemPrompt: TAGGER_SYSTEM, temperature: 0.1 }).
                             Hardcoded to Claude regardless of AI_PROVIDER or ROUTING_MODE env vars.
                             Rationale: 14-dim structured JSON vector; errors here corrupt all downstream retrieval + scoring.
                             Sprint 27 — decision_discriminating_info rubric NOTE added (carried forward).
  structural-retrieval.ts  — ✅ Sprint B (June 3, 2026): createCompletion → { provider: 'anthropic' }. Rationale: precise 2–3 sentence explanatory output consumed directly in UI. Confirmed deployed (code audit June 7, 2026).
                           — ✅ Additional Risk C — DIM_WEIGHTS local definition removed.
                             Now imports DIM_WEIGHTS from lib/similarity.ts (single source of truth).
                             scoreVectorSimilarity() logic unchanged: still applies score × confidence
                             × dim_weight for within-user comparison. VECTOR_DIMS stays in this file.
                             R11 (June 1, 2026) — MATCH_THRESHOLD and MIN_SESSIONS now read from
                             process.env (Railway env vars). Defaults: 45 and 5 respectively.
                             No behaviour change unless Railway vars are set to override.
  voice-sessions.ts        — ✅ Sprint 23a NEW — module-level session Map (Railway persistent process)
  avoidance-detector.ts    — ✅ Sprint D2 (previously implemented) — full avoidance detection engine.
                             Security Sprint: decrypt() applied to decision_text and what_decided reads.
  independence-score.ts    — ✅ Sprint 18a — calculateIndependenceScore() + getScoreBand().
                             Security Sprint: decrypt() applied to response_text in bySession map and decision_text before scoreSession call.
                             Queries sessions where days_open ≥ AVOIDANCE_DAYS_THRESHOLD and
                             upstream_dependency ≥ 4. Writes to avoidance_alerts table.
                             Called by cron route (app/api/cron/avoidance-detect/route.ts).
                             R11 (June 1, 2026) — AVOIDANCE_DAYS_THRESHOLD and STRUCTURAL_ECHO_MIN_SCORE
                             now read from process.env. Defaults: 45 and 60 respectively.
  persona-relevance.ts     — ✅ Sprint R3 NEW — computePersonaRelevance() + buildRelevanceBlock().
                             RULE_PERSONA_BOOSTS config (keyed by RuleId type-anchored to rule-engine.ts).
                             DIM_PERSONA_BOOSTS config (1–5 scale, 9 dimension entries).
                             Structural match tiered boost (≥80 → +0.30, ≥60 → +0.15, ≥45 → +0.05).
                             To retune: edit boost values in RULE_PERSONA_BOOSTS or DIM_PERSONA_BOOSTS only.
  similarity.ts            — ✅ Additional Risk C NEW — single source of truth for DIM_WEIGHTS.
                             Exports DIM_WEIGHTS: Record<string, number> — 14 dims, 1.5× for ⭐ starred
                             (identity_alignment, regret_asymmetry, upstream_dependency).
                             Both lib/structural-retrieval.ts and app/api/mirror/benchmark/route.ts
                             import from here. Eliminates math inconsistency between the two routes.
                             Do not define DIM_WEIGHTS anywhere else — always import from this file.
  session-score.ts         — ✅ R4 NEW — computeUserSessionScores(userId, supabase): Promise<SessionScoreData[]>.
                             Security Sprint: decrypt() applied to decision_text before decisionPreview slice.
                             Unifies 4 data streams into per-session reliability score (0–100).
                             Sub-scores: structural (sessions_ontology.matches_json → maxStructuralScore),
                             biasClarity (bias_library.activation_contexts — distorting count × asymmetry),
                             councilConfidence (rule_engine_result mode + flag_rules.length — deterministic,
                             no LLM), calibration (outcomes.calibration_delta — 70 if outcome pending).
                             deriveActionPlan() targets user's weakest avg sub-score across all sessions.
                             TypeScript: intermediate array typed as Omit<SessionScoreData, 'actionPlan'> —
                             actionPlan attached in final .map() call (deploy fix for TS build error).
                             No LLM calls. No schema changes.

app/api/
  cron/reanalyze-email/route.ts — ✅ Engagement+PWA Sprint NEW — daily cron (Bearer CRON_SECRET).
                             Per milestone (7/14/30d, ±12h window): finds sessions with no outcome
                             and no email_send_log row for that milestone, decrypts decision_text,
                             sends Resend email (subject = "<decision> — Nd later", minimal body,
                             single CTA), logs send, fires sendPushToUser() non-blocking.
                             FROM_EMAIL normalized to always include a display name.
  cron/mirror-insight-email/route.ts — ✅ Engagement Pull Sprint NEW — weekly cron (Bearer CRON_SECRET, Mondays 04:00 UTC on cron-job.org). Targets teaser users only (getMirrorAccessState === 'teaser' — locked and unlocked users both skipped). Per user: queries bias_library for top 3 bias_parameter keys by detection_count; maps each to label + first-sentence definition via BIAS_PARAMETERS import from lib/bias-scorer.ts. Sends Resend email where bias blocks ARE the content — no reminder language, no feature list. Subject: "Your Mirror detected N pattern(s) in your record". 7-day cooldown via mirror_insight_email_log (separate table from email_send_log — this is per-user not per-session). Skips users with no bias detections. Logs to Railway console: userId slice + bias count per send. cron-job.org job: same POST + Bearer header pattern as avoidance-detect and reanalyze-email.
    push/subscribe/route.ts  — ✅ PWA Sprint NEW — POST, Bearer auth. Upserts browser PushSubscription
                             (endpoint, p256dh, auth_key) into push_subscriptions, onConflict: endpoint.
  version/route.ts          — ✅ PWA Sprint NEW — GET, no-store. Returns { version } =
                             RAILWAY_GIT_COMMIT_SHA (fallback RAILWAY_DEPLOYMENT_ID, fallback
                             Date.now() at module load). Polled by UpdateBanner.tsx.
  mirror/status/route.ts    — ✅ Sprint M3 — teaserBiases now populated for gateState === 'unlocked'
                             as well as 'teaser'. Condition changed from `gateState === 'teaser'` to
                             `gateState === 'teaser' || gateState === 'unlocked'`. Previously unlocked users
                             always got teaserBiases: []. This enables topBiasLabel personalisation in the
                             ThresholdGate inside DecisionRules.tsx. See KDD 153.
                           — ✅ Sprint 19 — 3-state gate via getMirrorAccessState()
  mirror/teaser/route.ts    — ✅ Sprint 19 NEW
  mirror/fingerprint/route.ts — ✅ Sprint 19 — getMirrorAccessState()
  mirror/contradictions/route.ts — ✅ Sprint M4 — dismissedCount query added (dismissed_at IS NOT NULL
                                   count). Returned in GET response as dismissedCount. ContradictionDetector
                                   shows "N dismissed · M active" ratio line when dismissedCount > 0.
                                 — ✅ Sprint 19 — getMirrorAccessState(); Sprint 18a: POST pipeline
                                   R11 (June 1, 2026) — MIN_SESSIONS + RERUN_DAYS_THRESHOLD now read from process.env. Defaults: 5 and 7.
                                   Security Sprint: GET — decrypt() on decision_text in decisionMap. POST — decrypt() on decision_text, question_text, response_text, messages content before building AI evidence.
  mirror/independence/route.ts   — ✅ Sprint 28 — examinerQuote query added
                                   Security Sprint: decrypt() on response_text before building examiner quote.
  mirror/patterns/route.ts       — ✅ Sprint M4 — last10Set = new Set(sessionIds.slice(-10))
                                   computed (sessions ordered ascending → last 10 = most recent). Each pattern
                                   gets recent_fire_count = count of session_ids intersecting last10Set.
                                 — ✅ Sprint 20 — session_ids tracked per rule
                                   R11 (June 1, 2026) — PATTERNS_SESSION_THRESHOLD now reads from process.env. Default: 3.
  mirror/rules/route.ts          — ✅ Sprint B (June 3, 2026): createCompletion → { provider: 'anthropic' }. Rationale: hallucinated rules corrupt Mirror over time. Confirmed deployed (code audit June 7, 2026).
                                 — ✅ Sprint 19 — getMirrorAccessState()
                                   R11 (June 1, 2026) — RULES_SESSION_THRESHOLD now reads from process.env. Default: 8.
                                   Security Sprint: decrypt() on decision_text (decisionMap), question_text, response_text, messages content.
  mirror/calibration/route.ts    — ✅ Sprint 19 — getMirrorAccessState()
                                   Security Sprint: decrypt() on decision_text before slicing for tooltip label.
  mirror/alerts/route.ts         — ✅ Sprint D3 — GET now returns avoidanceAlerts[] alongside
                                    existing alerts[]. Both queries run in parallel via Promise.all.
                                    avoidanceAlerts: undismissed avoidance_alerts rows (limit 3,
                                    days_open DESC) joined with decision_text from sessions.
                                    All early-return paths updated to return { alerts: [], avoidanceAlerts: [] }.
                                    Sprint 19 — getMirrorAccessState()
                                    Security Sprint: decrypt() on decision_text in sessionMap.
  mirror/timeline/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
                                   Security Sprint: decrypt() on decision_text in result map.
  mirror/outcomes/route.ts       — ✅ Sprint 19 — getMirrorAccessState()
  mirror/unlock/route.ts         — ✅ Sprint 19 hotfix — three-token support (MONTHLY/ANNUAL/LIFETIME)
  mirror/benchmark/route.ts      — ✅ Additional Risk C — extractVector() now applies DIM_WEIGHTS
                                    (imported from lib/similarity.ts). Starred dims carry 1.5× in
                                    cross-user peer similarity, matching structural-retrieval.ts.
                                    Confidence intentionally NOT applied cross-user. Sprint 20 NEW.
  mirror/avoidance/dismiss/route.ts — ✅ Sprint D3 NEW — POST /api/mirror/avoidance/dismiss.
                                    Bearer auth + ownership check (confirms alert.user_id === userId).
                                    Sets dismissed_at + action_taken ('new_session' | 'resolved_externally').
                                    'resolved_externally' path: upserts minimal outcomes row
                                    (outcome_quality='resolved_externally') so D2 cron does not
                                    re-flag the session on the next daily pass. Idempotent — already-
                                    dismissed alerts return { ok: true } silently.
  mirror/sessions-lookup/route.ts — ✅ Sprint 20 NEW — session preview for source drawers
                                   Security Sprint: decrypt() on decision_text before trim for decision_preview.
  mirror/preferences/route.ts    — ✅ Sprint 21 NEW — GET/POST style_cue
  mirror/summary/route.ts        — ✅ Sprint M1 NEW — GET /api/mirror/summary. Single aggregated payload
                                   for MirrorSummaryCard: independenceScore, scoreDelta, examinerQuote (decrypted),
                                   confirmedPatternCount, formingPatternCount, openLoopCount, nextAction, sessionCount,
                                   sinceLastVisit, newContradictions (M5), latestSessionMode (M6).
                                   sinceLastVisit compares independence score calculated_at and contradiction generated_at
                                   against last_mirror_viewed_at to produce a human-readable delta line.
                                   latestSessionMode: fetches most recent session → sessions_ontology.rule_engine_result.mode.
                                   Side effect: upserts user_preferences.last_mirror_viewed_at = NOW() on every call (best-effort).
                                   Auth + mirror_access gated. No LLM. No new schema beyond the user_preferences column.
  mirror/session-score/route.ts  — ✅ R4 NEW — GET /api/mirror/session-score.
                                    Auth (Bearer token → resolveUserId) + Mirror unlocked gate
                                    (getMirrorAccessState). Returns SessionScoreData[] for last 20
                                    sessions. Parallel reads from sessions, sessions_ontology,
                                    bias_library, outcomes. No LLM. No schema change.
  payment/create-subscription/route.ts — ✅ Sprint 19 NEW (stub)
  admin/grant-mirror-access/route.ts   — ✅ Sprint 19 NEW
  admin/dashboard/route.ts             — ✅ Deployed and working June 1, 2026.
                                         Bug fix (June 1): data-fetching logic extracted into
                                         handleDashboard() with top-level try/catch in GET().
                                         Runtime errors now return JSON 500 not HTML — page can
                                         parse the response and show "Server error 500" instead
                                         of silently catching as "Network error".
                                         R11b (June 1): r11 block added — effectiveThresholds reads
                                         all 7 env vars vs defaults, returns { name, default_value,
                                         effective_value, is_overridden, env_raw } per threshold.
                                         Avoidance stats block queries avoidance_alerts (non-fatal
                                         catch if table absent). r11 returned alongside r7/r8/meta.
  persona/route.ts          — ✅ Sprint B (June 3, 2026): createStream gains 3rd provider param. Confirmed deployed (code audit June 7, 2026).
                              personaKey === 'synthesis' → 'anthropic' (complex 5-layer instruction stack).
                              All other keys (6 personas, pushbacks, decision_brief) → 'deepseek'.
                            — ✅ Sprint D3 — resubmitAlertId optional body param added.
                              When present (user came via "Bring it back →" in Mirror):
                              fetches avoidance_alerts row, confirms user_id ownership, injects
                              RESUBMISSION CONTEXT block into synthesis system prompt — states
                              days open as information not accusation, asks whether framing has
                              shifted, surfaces structural echo if present. Non-fatal: synthesis
                              proceeds without context if fetch fails. Ownership check ensures
                              alertId from a different user cannot inject false context.
                              Sprint R5 — conditional OUTPUT TRACEABILITY requirement appended
                              to structuralBlock after the persona-specific structural mandate.
                              Design: conditional ("if you engaged with it, close with one sentence
                              beginning 'Structurally, this decision...'"). Omit entirely if structural
                              memory did not apply. No fabrication. Only fires when structuralBlock is
                              assembled (structural context present + persona in
                              PERSONAS_WITH_STRUCTURAL_CONTEXT + initial call). No system prompt change.
                              Tech debt: conditional creates audit gap (omit vs ignore indistinguishable)
                              — full traceability deferred. See KDD 102.
                              Sprint R3 — fetchCouncilContext() extended: matches_json added to
                              select; ruleEngineResult + maxStructuralScore now returned. At synthesis,
                              computePersonaRelevance() + buildRelevanceBlock() called; relevanceBlock
                              appended as final layer in synthesis system prompt (after synthesisBlock).
                              fetchCouncilContextWithRetry() return type updated to match.
                              Sprint 19a — buildCouncilContext() to all 6 initial personas
                              Sprint 19 hotfix — fetchCouncilContextWithRetry() for initial personas
                              Security Sprint: encrypt() on messages.content before both user pushback insert and assistant response insert.
  examiner/route.ts         — ✅ Sprint B (June 3, 2026): two createCompletion calls updated. Confirmed deployed (code audit June 7, 2026).
                              personaliseRuleQuestion → { provider: 'deepseek' } (simple rewrite, graceful fallback).
                              generateGapQuestions → { provider: 'anthropic' } (JSON array, precision matters).
                            — ✅ Sprint C0 — C0 (JTBD anchor question) now fires on every decision
                              regardless of rule count. Condition `allRules.length < 3` removed from
                              shouldAddC0 guard. REDIRECT suppression retained. C0 still appended
                              positionally last, still personalised via personaliseRuleQuestion().\
                              Sprint 27 — redirectRule derived + returned; upstreamRationale R1-only
                              Security Sprint: GET — decrypt() on decision_text before AI personalisation. POST — encrypt() on question_text and response_text in rows before insert.
                              Sprint R_JC — imports fetchExaminerBiasHint. sessions query includes
                              user_id. biasHint fetched post-parallel-block. PERSONALISE_PROMPT +
                              personaliseRuleQuestion() updated with optional biasHint param.
                              biasHint passed to C0 + all rule personalisation calls.
  bias-score/route.ts       — ✅ Sprint 20 — classifyBiasSignal() per bias; signal_type in JSONB
                              Security Sprint: decrypt() on decision_text, context_text, messages content, question_text, response_text before passing to scorer.
  record/route.ts           — ✅ Sprint 24a — DELETE handler + ownership check
                              Security Sprint: decrypt() on session decision_text, context_text and messages content before returning to client.
  structural-match/route.ts — ✅ Sprint 17 — returns rule_engine_result + ontology_vector for grid reorder
                              Security Sprint: cache-hit path decrypts context_block and decryptJson(matches_json). Data path decrypts current session decision_text, past snapshots decision_text, outcomes what_decided. Cache-write path encrypts context_block and encryptJson(matches array).
  admin/encrypt-migrate/route.ts — 🗑️ DELETED (June 7, 2026) — One-shot backfill endpoint, used June 2, 2026. File deleted post-migration as originally intended. No longer in codebase.
  session/route.ts          — ✅ Security Sprint CHANGED — POST: encrypt() on decision_text and context_text before insert. GET: decrypt() on decision_text and context_text before returning to client.
                             Sprint Chunk 1 (CHANGED): GET also decrypts commitment_leaning,
                             commitment_switch, rule_recall_rule_text.
  outcome/route.ts          — ✅ Security Sprint CHANGED — encrypt() on what_decided and notes before upsert.
  history/route.ts          — ✅ Security Sprint CHANGED — decrypt() on decision_text and outcomes.what_decided before returning sessions array.
  record/[id]/brief/route.ts — ✅ Sprint B (June 3, 2026): briefContent createCompletion → { provider: 'deepseek' }. Rationale: template-guided narrative, prose-quality competitive. Confirmed deployed (code audit June 7, 2026).
                             — ✅ Security Sprint CHANGED — decrypt() on session decision_text, context_text, messages content, examiner question_text/response_text after DB fetch. encrypt() on messages.content (decision_brief) before DB insert.
                             — ✅ Sprint RET-1 (June 20, 2026) CHANGED — BRIEF_ACCESS_TOKEN gate removed from GET handler entirely; single C palette split into DARK_PALETTE/LIGHT_PALETTE + PERSONA_ACCENT_DARK/PERSONA_ACCENT_LIGHT (new Palette type); buildPdf() gains theme param selecting active palette into local C/PERSONA_ACCENT consts (~60 existing C.xxx call sites unaffected via lexical scoping); fillPageDark() renamed fillPage(); GET reads ?theme=light|dark (default dark). See KDD 187.
  record/[id]/echo-hint/route.ts — ✅ Sprint RET-3 NEW (June 20, 2026) — lightweight, read-only structural-dimension hint for EarlyEchoCard at session 3+. Calls scoreStructuralSimilarity() (lib/structural-retrieval.ts) directly — pure, synchronous, zero LLM cost — against up to 20 past same-identity sessions_ontology rows (identity precedence user_id > user_email > device_id; device_id-only sessions return { available: false, reason: 'no_identity' } by design, see KDD 192). Never calls retrieveStructuralMatches() or annotateMatch() — the MIN_SESSIONS=5 gate and the LLM-narrative Council injection path are completely untouched. Never writes to structural_matches/structural_scores (those remain the exclusive output of /api/structural-match, called from SessionView during the live session). Reuses existing MATCH_THRESHOLD env var (default 45) — best match below threshold returns { available: false, reason: 'no_qualifying_match' }. Returns only an abstracted dimension label (DIM_LABELS, with a small UI-friendliness SHORT_DIM_LABEL override local to this route) + coarse month/year — never the matched session's decision text. See KDD 188.
  voice/stream/route.ts     — ✅ Sprint 31 — enable_endpoint_detection: false (manual stop only)
  voice/chunk/route.ts      — ✅ Sprint 23a NEW
  voice/cleanup/route.ts    — ✅ Sprint B (June 3, 2026): createCompletion → { provider: 'deepseek' }. Rationale: trivial normalisation task, lowest stakes call in the stack. Confirmed deployed (code audit June 7, 2026).
                            — ✅ Sprint 23a NEW
  voice/tts/route.ts        — ✅ Sprint 23b NEW — Soniox TTS proxy, markdown strip, chunked audio

components/
  BiasNoteCard.tsx          — ✅ Sprint RET-3 NEW (June 20, 2026) — free, server-rendered, session-1-capable bias note. Purely presentational — all data computed server-side in app/record/[id]/page.tsx and passed as a `note` prop; returns null if note is null. Renders the single highest-prosecutor_score `signal_type === 'distorting'` bias detected in the current session (no detection_count threshold — single-session claim, not longitudinal, unlike BehaviorAlerts.tsx). See KDD 190.
  EmailCaptureCard.tsx      — ✅ Sprint RET-1 NEW (June 20, 2026) — decision-framed email capture on the record page ("Want us to check back on this?"), calls existing /api/auth. Hidden once quorum_user_email exists in localStorage, or once dismissed for the browser session (sessionStorage). Deliberately not framed as account creation — see KDD 191. Placed below BriefCTA on app/record/[id]/page.tsx.
  EarlyEchoCard.tsx         — ✅ Sprint RET-1 NEW (June 20, 2026) — count-only session-count signal at decisions 2–4 on the record page, reads getStoredSessionIds() client-side, hidden at 0–1 or 5+ sessions (MemoryEngineStatus owns 5+).
                             — ✅ Sprint RET-3 (June 20, 2026) CHANGED — at session count 3+, fires GET /api/record/[id]/echo-hint after the count-only copy has already rendered (progressive enhancement, no loading state, no layout shift); on a qualifying response upgrades the sub-line in place to name the shared structural dimension; any non-response (no identity, no past sessions, sub-threshold match, network failure) leaves the original count-only copy untouched. See KDD 188.
  PushEnablePrompt.tsx     — ✅ PWA Sprint NEW — client component, dynamic-imported (ssr:false)
                             into app/page.tsx. Renders nothing if: unsupported browser, already
                             subscribed (localStorage), permission denied, or dismissed within
                             14 days. iOS not in standalone mode → "Add to Home Screen" tip.
                             Otherwise → "Get nudged on open decisions" card with Enable/Not now.
                             Enable: registers /sw.js → requests permission → pushManager.subscribe
                             (urlBase64ToUint8Array, returns Uint8Array<ArrayBuffer> — TS5 fix) →
                             POST /api/push/subscribe.
  MirrorOpenLoopCard.tsx   — ✅ Engagement Sprint NEW — home-screen open-loop teaser for users
                             below Mirror unlock. Renders null if mirrorUnlocked or sessionCount=0.
                             1–2 sessions: "N more decisions to confirm your first pattern" +
                             pulsing dot + Preview link. 3+ sessions (teaser-eligible): gold-bordered
                             card, "X patterns forming in your record", blurred bias labels,
                             "Open your Mirror →". Wired into app/page.tsx between
                             RecurringConditionCard and MemoryEngineStatus. Bugfix (June 11, 2026): patternCount now falls back to teaserBiases.length when sessions_ontology.rule_engine_result returns 0 patterns — bias_library (teaserBiases) and rule_engine_result are separate detection systems. Mirror page shows bias_library patterns; card was returning null when rule engine had 0 fired rules even though bias_library had detections.
  CalibrationRevealCard.tsx — ✅ Engagement Pull Sprint NEW — home-screen calibration hook for unlocked Mirror users with ≥3 paired outcomes. Renders nothing if !mirrorUnlocked or !summary.dataReady (gate is inside component — no risk of empty state showing). Fetches /api/mirror/calibration (already exists, Mirror-gated). Displays: avg_delta number (color-coded +green/-red), plain-English meaning sub-label, summary.pattern italic quote (the insight), avg_pre + avg_retro supporting numbers, trend arrow badge (improving/declining/stable), "View calibration record →" link to /mirror#msec-calibration (hash targets actual SectionWrapper element id, triggers IntersectionObserver in MirrorNav to auto-select Calibration pill). marginBottom: 20 for spacing from RecurringConditionCard below. Wired into app/page.tsx as Chunk 4b between PatternSurfaceCard and RecurringConditionCard.
    UpdateBanner.tsx         — ✅ PWA Sprint NEW — fixed top banner. Records /api/version baseline
                             on mount; polls every 5 min + on visibilitychange/focus; if server
                             version changes, shows "A new version of Quorum is available. [Refresh]"
                             → window.location.reload(). Never auto-reloads. Rendered as first
                             child of <body> in app/layout.tsx.
  SessionView.tsx          — ✅ Sprint 31 — ContradictionBanner wire (post-synthesis fetch +
                             Sprint Chunk 1: RuleRecallBanner (before ExaminerPanel, visible
                             when ontologyReady && !examinerSubmitted) + DecisionStateCard
                             (after ContradictionBanner, visible when synthesisDone) imported
                             and rendered. appliedRuleRef (useRef) added. handleExaminerComplete
                             extended with appliedRuleBlock injected into synthExaminerContext
                             and all 6 persona initialExaminerContext entries.
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
  MemoryEngineStatus.tsx   — ✅ Bugfix (June 8, 2026) — "Pattern Memory active" label now guarded
                             by patternActive (sessionCount >= 5). Previous mirrorUnlocked && mirrorTeaserReady
                             branch showed "Pattern Memory active" at only 4 sessions. Fix: mirrorUnlocked alone
                             shows "Mirror active"; "Pattern Memory active" prefix now requires patternActive.
                             See KDD 159.
                           — ✅ Sprint 31 — mirrorUnlocked prop; "Mirror active" status label;
                             "View Mirror →" shown for both mirrorUnlocked AND mirrorTeaserReady states
                             Sprint 19 hotfix — TEASER_THRESHOLD=3, preview link at ≥3
  ExaminerPanel.tsx        — ✅ Sprint 31 — Council&apos;s → Council\u2019s (apostrophe render fix)
                             Sprint 27 — redirectRule state, R7 vs R1 copy distinction
  PersonaPanel.tsx         — ✅ Fix 1 (June 2, 2026) — "Share this context with all advisors" button, examiner update box, "Updating" badge, "Responded"/"✓" badge — all hardcoded blue/green values replaced with --info-* and --success-* tokens.
                             Sprint 34 — Examiner update (Share to All Advisors) now calls
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
  AvoidanceAlertCard.tsx   — ✅ Sprint D3 NEW — renders up to 3 undismissed avoidance alerts
                             from Mirror alerts route (avoidanceAlerts[] field). Each card shows:
                             decision text snippet, days-open as plain observation ("You first
                             brought this N days ago. It hasn't moved."), structural echo block
                             when present (prior resolved session ≥60/100 match), two CTAs:
                             "Bring it back →" (localStorage quorum_resubmit_alert + ?decision=
                             pre-fill navigation) and "Mark as resolved →" (calls dismiss endpoint).
                             Copy language: recognition not accusation — "avoidance" never appears.
                             Dismiss removes card from view optimistically. Exported types:
                             AvoidanceAlertData, StructuralEcho (imported by mirror/page.tsx).
  SynthesisCard.tsx        — ✅ Fix 1 (June 2, 2026) — override button ghost bg → --overlay-bg/hover; clarification badge → --success-*; ✓ Complete → --success-text.
                             Sprint D3 — synthesis POST body now includes resubmitAlertId.
                             Read from localStorage key 'quorum_resubmit_alert' at synthesis call
                             time; cleared immediately after read (fires only once per resubmission).
                             Sprint 25 — Pause/Resume/Stop TTS. Sprint 22 — status bar callbacks
  PatternStore.tsx         — ✅ Sprint M4 — "↑ Increasing" amber badge in RuleRow when
                             pattern.recent_fire_count > 2 (fired in more than 2 of last 10 sessions).
                             Distinguishes active patterns from stable background ones at session 50+.
                           — ✅ Sprint 20 — RuleSourceDrawer, fire count clickable
  PatternTile.tsx          — ✅ Sprint M4 — "Active" green badge on ConfirmedTile when tile.lastFiredAt
                             within 14 days. isRecentlyActive computed from lastFiredAt vs Date.now().
                           — ✅ Sprint 28 — "Activates when:" label. Sprint 20 — SignalPill, SourceDrawer
  BiasFingerprint.tsx      — ✅ Sprint 20 — authToken passed to PatternTile
                             R9 fix (June 1, 2026) — forming section strip copy updated from "one more
                             session to confirm" to "building confidence" (accurate for 1 or 2 detections).
                             Narrative block copy updated: "three or more patterns" (was "two or more").
  IndependenceScore.tsx    — ✅ Fix 1 (June 2, 2026) — positive delta text #4ade80 → var(--success-text).
                             Sprint 28 — examinerQuote block, CoachingTip sub-component
  DecisionRules.tsx        — ✅ Sprint M3 — ThresholdGate completely rewritten. From gate-language
                             ("N more to unlock") to milestone-commitment ("Your implicit operating logic — N
                             decisions away"). Forward-looking body copy explains what will extract, not what's
                             blocked. topBiasLabel?: string optional prop — when provided, adds personalised italic
                             teaser line naming the forming bias ("Your X pattern is already forming — at session 8
                             the governing rule surfaces here."). Progress dots redesigned with gold fill. CTA
                             improved to "Run your next decision →" with helper line.
                           — ✅ Sprint 28 — mobile classNames (unchanged)
  SessionReliabilityIndex.tsx — ✅ Sprint M4 — SessionRow gains isLatest?: boolean prop. First row
                                 (index 0) gets gold left-border + "Latest" pill label. displayed.map() updated
                                 to (row, i) to pass isLatest={i === 0}. Gives post-session Mirror visits an
                                 immediate anchor on the most recent session.
                               — ✅ R4 NEW — Mirror module in UnlockedView (after Confidence
                                 Calibration, before Decision Timeline). Fetches from
                                 /api/mirror/session-score. Renders: average composite score + trend
                                 delta (recent 5 vs prior 5 sessions), per-session list (last 10)
                                 with score bar + 4 sub-score dots (structural/bias/council/
                                 calibration). Hover tooltip per dot shows exact score. Always-visible
                                 "Your next move" action plan callout (gold left-border card) targeting
                                 user's weakest avg sub-score with a specific, non-generic action.
  StyleCalibration.tsx     — ✅ Sprint 21 NEW — 3-question inline calibration, localStorage persistence
  MirrorSummaryCard.tsx    — ✅ Sprint M1 NEW — Above-fold summary card for UnlockedView. Fetches
                             /api/mirror/summary. 4-stat grid (independence score + DeltaChip, patterns, open
                             loops, sessions), "Next move" action row (SRI actionPlan), examinerQuote ("In your
                             own words"), sinceLastVisit delta line in gold. Skeleton on load; silent null on
                             error — modules below still render. SummaryData interface exported (used by
                             AttentionZone + MirrorInsightCard). onData?: (d: SummaryData) => void fires when
                             data resolves — lifts data to UnlockedView without extra fetch. Sprint M5/M6 fields:
                             newContradictions, latestSessionMode included in SummaryData.
  MirrorNav.tsx            — ✅ Sprint M2 NEW — Sticky section sub-nav (top: 52px, z-index: 40). 8 pill anchors:
                             Fingerprint · Independence · Rules · Patterns · Contradictions · Calibration ·
                             Reliability · Timeline. IntersectionObserver (rootMargin: -30% 0px -60% 0px) for
                             active-section highlight. scrollTo() with 96px offset clears sticky bar. data-key
                             attr on each pill + useEffect auto-scrolls active pill into view on mobile via
                             scrollIntoView({ inline: 'center' }). Mobile: horizontal-scroll strip, 36px min-height
                             touch targets. Sprint M5: highlightedSections?: string[] prop — renders 5px gold dot
                             badge on matching pill labels (M6 module prominence).
  AttentionZone.tsx        — ✅ Sprint M5 NEW — Dynamic 0–3 compact action cards in fixed slot between
                             MirrorSummaryCard and MirrorNav. No extra API call — receives SummaryData via prop
                             from MirrorSummaryCard onData callback. Card priority: (1) newContradictions > 0 →
                             coral/urgent; (2) openLoopCount ≥ 2 → amber/action; (3) |scoreDelta| ≥ 5 → blue/notable.
                             Each card: headline, sub-text, scroll-to link (scrolls to msec-{key}). Individually
                             dismissible per session (useState Set — not persisted). Returns null when 0 cards
                             qualify — no empty box. secFadeIn animation on render.
  MirrorInsightCard.tsx    — ✅ Sprint M6 NEW — Deterministic cross-module synthesis above Bias Fingerprint.
                             Receives SummaryData via prop (no fetch). synthesise() function: 7 rules, first match
                             wins. Gates: sessionCount ≥ 5, independenceScore not null. Rules: (A) open loops +
                             score drop; (B) new contradiction + open loops; (C) REDIRECT + high score; (D) GATE +
                             contradictions; (E) high independence + many loops; (F) score rising + confirmed
                             patterns; (G) score rising generic. No LLM call. Returns null when no rule fires.
  MonthlyJudgmentReview.tsx — ✅ Sprint M2 — onOpenLoopCount?: (n: number) => void callback prop
                              added. Fires after data resolves with open_loops.length. Informs page.tsx so
                              MJR can be conditionally repositioned near the top when loops > 0. See KDD 158.
                            — ✅ Bugfix (June 8, 2026) — LoopsList component added with show-more at
                              LOOPS_PREVIEW = 5. Chevron expand/collapse with "Show N more decisions" /
                              "Show fewer decisions". Matches DecisionRules expand pattern exactly.
                              Orphaned fetch chain (`, [authToken]`) removed (Sprint M2 build fix).
                            — ✅ Chunk 2 NEW — see sprint history for full entry
  CouncilStatusBar.tsx     — ✅ Sprint 22 NEW — phase state machine narrating back-end activity
  BackButton.tsx           — ✅ Sprint 24a NEW — router.back() client component
  VoiceInput.tsx           — ✅ Sprint 23a NEW — full voice widget, SSR disabled (dynamic import)

app/
  page.tsx                 — ✅ Engagement+PWA Sprint — imports MirrorOpenLoopCard (rendered between
                             RecurringConditionCard and MemoryEngineStatus), CalibrationRevealCard (Chunk 4b — between PatternSurfaceCard and RecurringConditionCard, gated on mirrorUnlocked; component self-gates on dataReady) and PushEnablePrompt
                             (dynamic, ssr:false; rendered when authToken && sessions.length >= 1).
                             — ✅ Sprint D3 — reads ?decision= URL param on mount alongside
                             existing ?em= param handler. If present, calls setDecision()
                             with decoded value (pre-fills submission textarea). URL cleaned
                             via history.replaceState after reading. This is the landing target
                             for AvoidanceAlertCard "Bring it back →" deep-link.
                             Sprint 34 — Hero card border: 2px solid var(--gold-dim).
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
  mirror/page.tsx          — ✅ Sprints M1–M6 (June 8, 2026) — Major UnlockedView overhaul:
                             Sprint M3: WelcomeMirrorCard inline component (localStorage key quorum_mirror_welcomed,
                             fires once on first Mirror open, two-column Active Now / Still Building layout).
                             topBiasLabel derived from status.teaserBiases[0] via getBiasLabel(). Passed to
                             DecisionRules.
                             Sprint M1: MirrorSummaryCard imported + rendered after welcome dismissal with
                             onData={setSummaryData} callback lifting data to UnlockedView.
                             Sprint M2: SectionWrapper helper component added (section id=msec-{key}, type-coloured
                             left border via SEC_TYPE_BORDER map: urgent/coral, core/gold, deep/blue,
                             archival/grey). Desc-hide toggle ("?" icon, localStorage quorum_mirror_desc_hidden
                             JSON object). Section collapse toggle (chevron, localStorage quorum_mirror_collapsed
                             JSON object). toggleCollapse + toggleDesc helpers. sw() shorthand. secFadeIn
                             animation with staggered animDelay per section. All 9 module divs replaced with
                             SectionWrapper. Conditional ordering: MJR near top when openLoopCount > 0 (via
                             onOpenLoopCount callback); Decision Timeline near top when sessionCount < 10.
                             MirrorNav imported + rendered between SummaryCard and modules.
                             secFadeIn + secPulse keyframes added to inline CSS.
                             Sprint M5: AttentionZone imported + rendered between SummaryCard and MirrorNav.
                             summaryData state lifted. MirrorNav receives highlightedSections prop.
                             Sprint M6: MirrorInsightCard imported + rendered above BiasFingerprint.
                             highlightedModule derived from summaryData?.latestSessionMode (REDIRECT →
                             independence, GATE → contradictions). SectionWrapper gains highlighted?: boolean
                             prop — pulse outline animation (secPulse) + gold outline on highlighted sections.
                             Independence Score + Contradiction Detector receive highlighted={highlightedModule === ...}.
                           — ✅ Sprint D3 — AvoidanceAlertCard import + AvoidanceAlertData type
                             Chunk 2: MonthlyJudgmentReview imported + rendered after
                             SessionReliabilityIndex with gold-rule divider.
                             import. avoidanceAlerts state added. fetchStatus() extended: when
                             gateState = 'unlocked', fetches /api/mirror/alerts and sets
                             avoidanceAlerts from response.avoidanceAlerts. UnlockedView prop
                             signature extended with avoidanceAlerts: AvoidanceAlertData[].
                             "Decisions Still Open" section inserted above Bias Fingerprint —
                             renders only when avoidanceAlerts.length > 0.
                             R4 — SessionReliabilityIndex import added.
                             Sprint 31 — sub-label "A private operating system for your judgment";
                             no lock icons on teaser tiles; "Activate Mirror" language throughout;
                             ₹9,999/year leading price; "building" lockedBadge; gold back button
                             Mirror Tiering Sprint (June 13, 2026) — TeaserView price updated to
                             ₹39,999/year · ₹3,999/month (was ₹9,999/₹1,499); BenchmarkModule,
                             ContradictionDetector, SessionReliabilityIndex, DecisionRules now
                             receive tier prop — see MIRROR vs MIRROR ADVISORY section
                             Sprint 28 — mobile layout, section reorder (Fingerprint first), teaser polish
                             Sprint 20 — UnlockedView header renames, BenchmarkModule
                             Sprint 19 — LockedView, TeaserView, gate states
  session/[id]/page.tsx    — ✅ Sprint 30 — sequential query (session first), totalSessionCount
                             COUNT query, duplicate notFound removed
                             Sprint 24b — initialMessages server-side fetch
  record/[id]/page.tsx     — ✅ Bugfix (June 8, 2026) — outcome.what_decided now decrypted before
                             passing to OutcomeTracker. Fix: spread outcome object with decryptText applied to
                             what_decided. Encrypted text (enc:...) was displaying in "What did you decide?"
                             field. Same pattern as decision_text and context_text which were already decrypted.
                             See KDD 160.
                           — ✅ Sprint 27 — XML tag stripping, deduplication, QUORUM home link,
                             +New Decision button
                             Sprint 24a — BackButton, bottom nav
  admin/page.tsx           — ✅ R7/R8 Admin Dashboard — deployed and working June 1, 2026.
                             Bug fix (June 1): fetchDashboard() was declared after the useEffect
                             that calls it, causing a TDZ reference error in React strict-mode's
                             synchronous effect replay — manifest as "Network error" catch.
                             Fix: fetchDashboard() moved above useEffect; dependency array changed
                             from [] to [fetchDashboard] (correct stale-closure handling).
                             res.json() now wrapped in its own try/catch — if server returns HTML
                             instead of JSON (Railway error page), shows specific message rather
                             than generic "Network error". typeof window guard added to useEffect.
                             ADMIN_CODE constraint: must be ASCII-only (ISO-8859-1 safe). See KDD 106.
                             R11b (June 1, 2026) — R11 section added: threshold table (amber highlight
                             for env-overridden values, default/override badge per row) + avoidance alert
                             stat cards (total, open, dismissed, avg days open). R11ThresholdRow + R11Data
                             interfaces added to DashboardData type. Review cadence footer updated.
                             Sprint 19 — admin grant access UI (pre-existing).
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

scripts/
  encrypt-existing.ts      — ✅ Security Sprint NEW — CLI alternative for backfill migration.
                             Run via: npx tsx scripts/encrypt-existing.ts
                             Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_ENCRYPTION_KEY.
                             Batches 200 rows at a time. Idempotent — skips enc: prefixed rows.
                             Prefer the API endpoint (admin/encrypt-migrate) for Railway deployments.
  test-encryption.ts       — ✅ Security Sprint NEW — Integration test script.
                             Tests: encryption primitives (no DB), write→DB encrypted, read→API decrypted,
                             examiner Q&A round-trip, outcome round-trip, backward compat (legacy plaintext row),
                             history route. Cleans up all test data. Run before and after deploy.
                             Usage: npx tsx scripts/test-encryption.ts
  rotate-encryption-key.ts  — ✅ June 7, 2026 NEW — Manual encryption key rotation utility.
                             Re-encrypts all encrypted DB columns from old AES-256-GCM key to new one.
                             NOT a cron job — run deliberately when rotating keys (e.g. quarterly or after exposure).
                             Usage: DB_ENCRYPTION_KEY=<old> DB_ENCRYPTION_KEY_NEW=<new> \
                               NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
                               npx tsx scripts/rotate-encryption-key.ts
                             Full 6-step runbook in file header. Covers all 5 encrypted tables + JSONB column.
                             Idempotent — safe to re-run. Exits non-zero on any errors. See KDD 146.

Static:
  CookieConsent.tsx        — ✅ Sprint 2 (S2-01) NEW — In-app cookie consent banner.
                             Fixed bottom banner with slide animation. Accept All / Reject Non-Essential / Manage.
                             Preferences modal: Strictly Necessary (locked) · Functional · Analytics toggles.
                             Reads/writes quorum_cookie_consent (JSON). Shows after 900ms on first visit.
  AppFooter.tsx            — ✅ Sprint 2 (S2-04) NEW — App-wide legal footer.
                             Rendered in layout.tsx. Links: Privacy Policy · Cookie Policy · Terms · Security & Trust.
  TrustBadgeStrip.tsx      — ✅ Sprint 2 (S2-03) NEW — Decision page trust badges.
                             Used on record/[id] page. Shows: Encrypted at rest (if DB_ENCRYPTION_KEY set) · Visible only to you · Analysed by AI.
  RateLimitBanner.tsx      — ✅ Sprint 5 (S5-01) NEW — 429 rate limit banner with live countdown.
                             Props: message, resetAt (Unix ms), onExpired(). Countdown ticks to 0 then fires onExpired.
                             parseRateLimit(res): utility to extract RateLimitInfo from 429 response.
                             Used in PersonaPanel.tsx. Styled gold border, mono countdown.

  app/privacy/page.tsx     — ✅ Sprint 3 (S3-01) NEW — Privacy Policy page (server component). Full GDPR+DPDP content.
  app/terms/page.tsx       — ✅ Sprint 3 (S3-02) NEW — Terms of Service (server component). AI disclaimer highlight box.
  app/cookies/page.tsx     — ✅ Sprint 3 (S3-03) NEW — Cookie Policy (server component). Full localStorage registry with category badges.
  app/security/page.tsx    — ✅ Sprint 3 (S3-04) NEW — Security & Trust (server component). Only provable claims listed; honest "not yet" section.
                             Updated June 7, 2026: 'Encryption key rotation tooling' and 'Vulnerability disclosure programme' moved from NOT_YET to IMPLEMENTED. 'Automated scheduled key rotation' retained in NOT_YET (manual script ≠ automated schedule). NOT_YET reduced from 6 to 5 items.
  app/settings/privacy/page.tsx — ✅ Sprint 3+6 NEW — Privacy Center. Consent toggles + real data export + real account deletion.
  app/settings/security/page.tsx — ✅ Sprint 3 NEW — Security Center. Session info, sign-out device, sign-out all.
  app/api/account/export/route.ts — ✅ Sprint 6 (S6-02) NEW — GET /api/account/export. Auth via Bearer. Rate: 1/24h per user. Fetches+decrypts all user data. Returns JSON download.
  app/api/account/route.ts — ✅ Sprint 6 (S6-03) NEW — DELETE /api/account. Auth via Bearer. Writes audit log first. Explicit email-keyed table deletes + supabase.auth.admin.deleteUser() cascade.
  app/api/admin/audit-log/route.ts — ✅ Sprint 6 (S6-05) NEW — GET /api/admin/audit-log. Auth ADMIN_CODE. Returns last 100 audit_log entries.

  index.html (quorumvault.org) — ✅ Sprint 20 — 6 persona cards, correct module names
                                 Sprint 19 — billing toggle, Mirror pricing, subscription flow
                                 Sprint 31 — social proof section + full mobile overhaul deployed
                                 May 30, 2026 — competitive leakage audit (3 passes, 31 issues).
                                   Output: index_final.html (clean) + index_final.patch (2 LOW items).
                                   Audit doc: quorum_leakage_analysis.html.
                                   All HIGH/MEDIUM resolved. Two LOW residuals patched (see KDD 88–96).
  server.js (quorumvault.org) — ✅ Sprint 1+3 — Express server for website Railway project.
                                 S1: /api/waitlist route (Supabase insert). Cookie consent banner. Privacy checkbox on form. Footer legal links. Credential removal from HTML.
                                 S3: Full legal pages: /privacy · /cookies · /terms · /security — real HTML content matching app pages. APP_URL env var for cross-links to app Privacy Center.
                                 TODO: add GET /.well-known/security.txt route to serve the VDP file (mirrors app's public/.well-known/security.txt). Low priority — the canonical version is on app.quorumvault.org; website route is a convenience.
  public/.well-known/security.txt — ✅ June 7, 2026 NEW — RFC 9116 vulnerability disclosure programme.
                                 Served by Next.js static asset pipeline at /.well-known/security.txt on app.quorumvault.org.
                                 Contact: security@quorumvault.org. Scope: app.quorumvault.org + quorumvault.org.
                                 Expires: 2027-06-07. Acknowledgement: 5 business days. Critical remediation: 30 days.
                                 Moves 'Vulnerability disclosure programme' from NOT_YET to IMPLEMENTED on security page. See KDD 147.
  app/layout.tsx           — ✅ PWA Sprint — added <link rel="manifest" href="/manifest.json">,
                                 <meta name="theme-color" content="#0a0a0a">, apple-mobile-web-app-*
                                 meta tags, apple-touch-icon. UpdateBanner rendered as first child of <body>.
  next.config.ts           — ✅ PWA Sprint — CSP worker-src 'self' added (service worker registration).
                                 /sw.js response headers: Cache-Control: no-cache,no-store,must-revalidate
                                 + Service-Worker-Allowed: / (forces browsers to re-check SW on every load).
  public/manifest.json     — ✅ PWA Sprint NEW — name/short_name "Quorum", display: standalone,
                                 background/theme #0a0a0a, icon-192.png + icon-512.png (any + maskable).
  public/sw.js             — ✅ PWA Sprint NEW — push + notificationclick handlers ONLY. Deliberately
                                 no caching/fetch interception — Quorum is dynamic + auth-gated, an
                                 app-shell cache would serve stale authenticated content. activate →
                                 clients.claim() for immediate control.
  public/icon-192.png, icon-512.png — ✅ PWA Sprint NEW — gold "Q" lettermark on #0a0a12, replacing
                                 the original blurry scaled wordmark crop.
  supabase/sprint_reanalyze_email.sql — ✅ Engagement Sprint NEW — email_send_log table
                                 (user_id, session_id, email_type, sent_at; unique on session_id+email_type).
  supabase/sprint_mirror_insight_email.sql — ✅ Engagement Pull Sprint NEW — mirror_insight_email_log table (user_id FK → auth.users ON DELETE CASCADE, sent_at timestamptz; index on user_id; RLS enabled). Deduplication log for weekly Mirror insight emails — one row per send; cron checks sent_at > 7 days ago before sending. No unique constraint (unlike email_send_log) because this is per-user not per-session-milestone. Run supabase/sprint_mirror_insight_email.sql once.
    supabase/sprint_pwa_push.sql — ✅ PWA Sprint NEW — push_subscriptions table (user_id, endpoint
                                 unique, p256dh, auth_key, last_used_at; RLS: user manages own rows only).
```
---

### KDDs 148–160 — Mirror UX Overhaul Sprint (June 8–9, 2026)

**KDD 148 — Mirror page audit established two distinct user segments with fundamentally different product priorities.**
The 3rd-decision user (just unlocked Mirror) needs an orientation + immediate "aha" moment — most modules are thin or locked, which without context reads as broken gates. The 50th-decision user needs a "what changed since last time" digest and navigation efficiency — the page is information-complete but has no hierarchy. All Mirror UX decisions since the audit treat these as two distinct journeys. Retention priority: 3rd-decision user. Stickiness priority: 50th-decision user. Every component in M1–M6 was built with both in mind.

**KDD 149 — Mirror section ordering is stable; dynamic surfacing happens in the Attention Zone, not via page reorder.**
Full dynamic page reordering was deliberately rejected. Users at 50 sessions build spatial memory of where modules are. A page rearranging itself on each visit destroys that mental model and reduces trust for a judgment infrastructure product — reads as a social feed, not decision infrastructure. The Attention Zone (fixed structural slot between MirrorSummaryCard and MirrorNav) provides dynamic "what's urgent" surfacing without disrupting layout. The only ordering exceptions are structural: MJR near top when openLoopCount > 0, Timeline near top when sessionCount < 10. Both are one-time contextual adjustments, not per-visit changes.

**KDD 150 — SectionWrapper persists collapse and description-hide state as JSON objects in localStorage, not per-key booleans.**
quorum_mirror_collapsed stores all section collapse states as a single JSON object: `{ fingerprint: true, independence: false, ... }`. quorum_mirror_desc_hidden stores description-hide states similarly. Both read on mount with try/catch JSON.parse fallback → {}. Both written on each toggle via setCollapsed/setDescHidden with a corresponding localStorage.setItem. Storing as a single object is more efficient than 12+ individual localStorage keys and easier to inspect/clear. All sections default to expanded and description-visible on first visit.

**KDD 151 — WelcomeMirrorCard fires exactly once per browser via localStorage key `quorum_mirror_welcomed`.**
Shown on first Mirror open for all unlocked users. The card explicitly lists what is active now vs still building — bridging the gap between "Mirror unlocked!" excitement and the reality that 5+ modules are thin or locked at session 3. Both the × button and "Got it →" button call handleDismiss() which sets localStorage.quorum_mirror_welcomed = 'true' then calls onDismiss(). After dismissal, MirrorSummaryCard takes the above-fold slot. If the user clears localStorage, the card reappears — this is the correct behaviour (they're a new browser context). The card is defined as an inline function component inside page.tsx above UnlockedView, not a separate file.

**KDD 152 — /api/mirror/summary stamps last_mirror_viewed_at as a side-effect of every GET call.**
Every Mirror page open triggers MirrorSummaryCard which fetches /api/mirror/summary. After computing the response, the route upserts user_preferences.last_mirror_viewed_at = new Date().toISOString() with onConflict: 'user_id'. This is best-effort: `.then(undefined, () => {})` — failure never blocks the response. The "since last visit" delta line (sinceLastVisit) compares independence score calculated_at and contradiction generated_at against the PREVIOUS last_mirror_viewed_at (fetched at request time before the upsert). DB migration required once: `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ`. No separate PATCH call needed from the client.

**KDD 153 — teaserBiases in /api/mirror/status/route.ts is now populated for gateState === 'unlocked' as well as 'teaser'.**
Previously, the bias_library fetch for teaserBiases was gated behind `if (gateState === 'teaser')` — unlocked users always received teaserBiases: []. This blocked topBiasLabel personalisation in the ThresholdGate component (DecisionRules.tsx). Fix: condition changed to `gateState === 'teaser' || gateState === 'unlocked'`. Both TeaserView (blurred preview tiles) and UnlockedView (personalised ThresholdGate italic teaser line) now receive the same bias data. The array is limited to 5 items in both cases. No schema change. topBiasLabel in UnlockedView is still optional — if teaserBiases is empty, ThresholdGate renders without the personalised line.

**KDD 154 — FingerprintTile.lastFiredAt is computed from session dates, not a dedicated column on bias_library.**
Sprint M4 original spec required a first_confirmed_at column on bias_library. Avoided: instead, mirror-fingerprint.ts batch-fetches sessions.created_at for all tile session IDs after building the tile arrays (single query: `supabase.from('sessions').select('id, created_at').in('id', uniqueSessionIds)`). Most recent session date in each tile's sessionIds becomes lastFiredAt. This shows "pattern fired recently" (within 14 days) — semantically slightly different from "pattern first confirmed recently" but produces the same practical badge result. Zero migration required. PatternTile shows a green "Active" badge when lastFiredAt is within 14 days. If the batch fetch fails, lastFiredAt stays null and no badge renders — graceful degradation. Empty catch changed to catch (_e) for SWC compatibility in Next.js 15.2.8.

**KDD 155 — MirrorInsightCard is entirely deterministic — no LLM call, no API route, no extra fetch.**
The synthesise() function in MirrorInsightCard.tsx runs 7 rules against SummaryData already in the page (lifted via MirrorSummaryCard's onData callback). Zero marginal infrastructure cost. Rules are ordered by severity/specificity: cross-module combinations rank above single-signal observations. Priority order: (A) open loops + score drop; (B) new contradiction + open loops; (C) REDIRECT + high score; (D) GATE + contradictions; (E) high independence + many loops; (F) score rising + confirmed patterns; (G) score rising generic. Returns null when sessionCount < 5 or independenceScore is null or no rule fires. Component is absent when null — not rendered with empty state or placeholder.

**KDD 156 — latestSessionMode from sessions_ontology.rule_engine_result.mode drives M6 module prominence.**
Summary route fetches the user's most recent session ID then joins to sessions_ontology to get rule_engine_result.mode. REDIRECT mode (R1/R7 triggered — decision not ready to proceed) maps to Independence Score section (highlightedModule = 'independence'). GATE mode (R2/R3/R10 — ambiguity or information gap) maps to Contradiction Detector (highlightedModule = 'contradictions'). Prominence is soft: gold pulse-border outline animation (secPulse keyframe, 2 iterations) + gold dot badge on MirrorNav pill (via highlightedSections prop). The module stays in its position in the page. Both the SectionWrapper highlighted prop and the MirrorNav dot badge are derived from the same highlightedModule value in UnlockedView.

**KDD 157 — Section type visual indicators use left-border colour on SectionWrapper, not background or badges.**
Four types defined in SEC_TYPE_BORDER map: urgent (coral #E24B4A — for Decisions Still Open, MJR when loops present), core (gold rgba(201,168,76,0.45) — Fingerprint, Independence, Rules, Patterns), deep (blue rgba(74,158,222,0.45) — Contradictions, Calibration, Reliability), archival (grey rgba(120,120,115,0.3) — Timeline, Benchmark). Applied as borderLeft on the h3 inside SectionWrapper. Chosen for subtlety — adds hierarchy without visual noise. Pure CSS on existing DOM, no new elements. The collapse chevron and "?" desc-toggle are right-aligned in the same header row, maintaining clean left-side visual hierarchy.

**KDD 158 — AttentionZone has a fixed structural position between MirrorSummaryCard and MirrorNav — content dynamic, position stable.**
Lives in UnlockedView render tree between SummaryCard and MirrorNav. When 0 cards are derived, returns null — the slot disappears cleanly (no empty box, no border, no placeholder). When 1–3 cards qualify, renders with secFadeIn animation. Cards are individually dismissible via session-scoped useState Set — not persisted to localStorage. On next Mirror visit, dismissed state resets and cards re-derive from fresh summary data. This is intentional: the signals should re-surface until the user actually acts on them (views the contradiction, files an outcome, etc.). The three signal sources are: newContradictions > 0 (coral), openLoopCount ≥ 2 (amber), |scoreDelta| ≥ 5 (blue).

**KDD 159 — MemoryEngineStatus "Pattern Memory active" label is guarded by patternActive (sessionCount ≥ 5), not mirrorUnlocked.**
Bug: the `mirrorUnlocked && mirrorTeaserReady` branch showed "Pattern Memory active · Mirror ready to activate" when mirrorUnlocked = true AND sessionCount ≥ 3 (mirrorTeaserReady threshold) — even at 4 sessions. Root cause: a user with 5+ sessions in the DB (mirror_access unlocked) but only 4 sessions in localStorage history (cross-device or localStorage cleared) would have mirrorUnlocked=true but sessions.length=4. Fix: mirrorUnlocked alone now shows "Mirror active". "Pattern Memory active" prefix requires patternActive (sessionCount ≥ PATTERN_MEMORY_THRESHOLD = 5) regardless of mirror unlock state. The four branches are now: (mirrorUnlocked && patternActive) → full label; (mirrorUnlocked only) → "Mirror active"; (patternActive only) → "Pattern Memory active · Mirror ready to activate"; (neither) → countdown.

**KDD 160 — outcomes.what_decided must be decrypted before passing to OutcomeTracker — it is stored encrypted at rest.**
Bug: record/[id]/page.tsx correctly decrypted session fields (decision_text, context_text, messages) but passed the raw encrypted outcome row to OutcomeTracker. OutcomeTracker initialised its `decided` state with `existingOutcome?.what_decided` — displaying enc:3b158ec9... in the "What did you decide?" field. Fix: outcome object spread with decryptText applied to what_decided before passing: `outcome ? { ...outcome, what_decided: decryptText(outcome.what_decided) } : null`. Same pattern already used for session fields on the same page. MirrorSummaryCard examiner quote had the same bug — /api/mirror/summary route was returning raw encrypted response_text from examiner_responses table. Fix: `decrypt(best.response_text)` applied before truncation in the route.


**KDD 161 — mirror-insight-email targets teaser users only because unlocked users already have live Mirror access.**
The email is an acquisition/conversion mechanism for users who have accumulated real signal (≥3 sessions, bias patterns detected) but have not subscribed. Sending it to unlocked users would be redundant — they can open Mirror and see their full profile at any time. The copy positions the email as the bias insight itself ("these are your actual patterns"), not a reminder to use a feature. The email has no "features list" or product promotion — the bias labels and one-line definitions are the value delivered. Conversion happens because the user sees something real about themselves, not because they see a feature benefit statement.

**KDD 162 — bias_library and sessions_ontology.rule_engine_result are separate detection systems; MirrorOpenLoopCard must handle both.**
The Mirror page's Bias Fingerprint section shows bias_library patterns (COMPLEXITY_OPACITY, EXIT_OPTIONALITY_MISPRICING, CONTROL_ILLUSION, etc.) — these are detected and accumulated by the bias scorer on each session, stored as rows in bias_library keyed by user_email. The Mirror teaser route returns these as teaserBiases. Separately, sessions_ontology.rule_engine_result.triggered_rules contains structural rule firings (R1–R12) counted as patternCount in the teaser route. These two systems can be in divergent states: a user with 3+ sessions may have 0 rule firings (patternCount = 0) but 3 bias detections in bias_library (teaserBiases.length = 3). The original MirrorOpenLoopCard gated on patternCount === 0 → return null, causing the card to silently not render for teaser users whose patterns came only from the bias system. Fix: patternCount now resolves as teaser.patternCount > 0 ? teaser.patternCount : teaser.teaserBiases.length. Card renders if either system has detections.

**KDD 163 — S0 trigger is brevity + no-context only. The tagger's ambiguity score was explicitly rejected as a secondary trigger.** `ambiguity >= 4` captures decision-maker values confusion ("I don't know what I want") — a different diagnostic category from "the system lacks domain context about the decision subject." Firing S0 on high-ambiguity decisions would produce an inappropriate domain-context question on identity/values decisions where the subject matter is already clear. Those decisions are handled by R2 (Identity-First Gate). The precise and sufficient trigger: `decisionWordCount < 25 AND !hasContext`. This fires on genuinely thin briefs and nothing else. Do not add ambiguity or other tagger signals to the S0 trigger without validating that they do not fire on identity/values decisions. (Sprint S0, June 12, 2026)

**KDD 164 — S0 personalisation does not receive biasHint. Rule questions and C0 do.** S0 is a domain-context gathering question — it elicits what the decision subject is, its current state, and what triggered the decision. Bias sharpening (the biasHint mechanism from Sprint R_JC) is a diagnostic probe tool; it is inappropriate on a question designed purely to gather factual context. Applying biasHint to S0 could produce outputs like "Brief us on MedML, and given your documented loss aversion, where does it stand?" — which is incoherent. C0 and rule questions retain biasHint. This is a deliberate asymmetry, not an omission. (Sprint S0, June 12, 2026)

**KDD 165 — The BRIEF badge (S0) shares the green visual register with the CONTEXT badge (C0). This is intentional.** The visual language in ExaminerPanel distinguishes two categories: gold `Q{n}` = structural flag questions (the rule engine raised a concern), green badge = framing input questions (grounding or anchoring, not a warning). S0 and C0 are both framing inputs — S0 grounds domain context, C0 anchors success definition. Giving them the same green badge signals to the user "these are orientation questions" vs "these are flags." The label text (BRIEF vs CONTEXT) provides sufficient distinction within the category. Do not change S0 to a gold/amber badge — that would misrepresent it as a structural concern. (Sprint S0, June 12, 2026)

**KDD 166 — Template banks (S0_TEMPLATES, C0_TEMPLATES) use sessionId hash-mod selection, not random.** Pure random selection would produce different questions on re-render or duplicate GET calls for the same session — the examiner would show a different question if the user navigated away and back. Hash-mod is deterministic per sessionId: same session always gets the same template variant, but different sessions get different ones (the hash distributes across the 5 variants). The hash function is a simple character code sum. Because S0 and C0 index into separate template banks, they cannot accidentally land on structurally similar templates in the same session — the 5-variant banks are independently indexed. (Sprint S0, June 12, 2026)

**KDD 167 — Web search for Examiner subject-matter enrichment was explicitly rejected.** Three compounding reasons: (1) Privacy model — firing a web search on a user's decision entity (e.g. "MedML") is an external call that leaks private decision content. This is a fundamental architecture breach for a product positioned as private judgment infrastructure. (2) Reliability — the decision subject is typically a private company, a personal relationship, or a specific deal. There is nothing meaningful to find externally. (3) Quality — the user's own description of their business in 2 sentences is strictly better evidence than any scraped summary. S0 solves the same problem (domain context for the Council) with higher accuracy, in private, and with the added benefit of recording the answer in the permanent judgment record. (Sprint S0 design, June 12, 2026)

**KDD 168 — S0 is not designed to catch "named entity without business model context."** In the MedML session (decision: "Help decide if MedMl should be sold — I am a cofounder..."), S0 correctly did not fire. The decision text was ~80 words with substantial context about co-founder alignment, exit motivation, and values — the Council received meaningful signal on the variables that actually drive a sell/don't-sell judgment. MedML's business model was not described, but that is secondary context. If S0 fired every time a company name appeared without a business model description, it would trigger on nearly every business decision. The business model gap is real; it is synthesis's job to flag it as a reasoning limitation, not S0's job to preemptively demand it. S0's charter is: "the brief is so thin the Council has almost nothing to work with." Not: "the brief lacks domain completeness." (Sprint S0, June 12, 2026)

**KDD 169 — Product positioning on context-gathering: Quorum interrogates how you reason, not your information picture.** When asked "does the product care about the business model / gather context about new entities?", the correct answer is: Quorum is built to interrogate how you're reasoning about a decision — your framing, values, and blind spots — not to gather a business brief. If the Council needs more context to reason well, they'll say so; but completing your information picture is your job, not the product's. This framing is accurate to the architecture (S0 fires for thin briefs, not for missing domain completeness), positions Quorum correctly against advisory/research tools, and is true to the product's longitudinal judgment compounding thesis. (Sprint S0 design, June 12, 2026)

**KDD 170 — Max 3 question budget: slot math is rule-budget compression, not C0 displacement.** Prior ceiling: allRules.slice(0, 3) + C0 = max 4. New ceiling: max 3. Rule budget adjusts based on S0: `ruleSlotBudget = shouldAddS0 ? 1 : 2`. C0 is never displaced — it feeds fetchUserPrinciplesBlock() longitudinally (KDD 121) and anchors success definition. The practical impact of dropping from 3 rule slots to 2 is minimal: the highest-priority rule fires first (REDIRECT > GATE > FLAG, then by triggered_rules order). A third rule question rarely adds material signal that the first two don't already cover. The 4-question ceiling was edging toward form territory for the target user (founders, CXOs, Family Office MDs); 3 is the right upper bound for a product that must not feel like a questionnaire. (Sprint S0, June 12, 2026)

**KDD 171 — Mirror repriced ₹1,499/mo · ₹9,999/yr → ₹3,999/mo · ₹39,999/yr (Phase 1, June 13, 2026).** Root-cause framing: the issue was never "need a tier between Mirror and Advisory" — it was that ₹1,499 signalled "cheap SaaS" for an audience (HNI/CXO/founder/family office) where price itself is a quality signal. ₹50/day reads as an impulse subscription; ₹3,999/mo crosses into "professional tool" territory without being a meaningful sum against a ₹25K+ decision. Annual (₹39,999) leads on the pricing page per existing SaaS convention. Copy-only change — no gating/logic impact. Do not re-debate without a real pricing signal from an Advisory conversation (see KDD 174).

**KDD 172 — 'lifetime' plan retired (Phase 2, June 13, 2026).** Pre-revenue, no real grants existed, so retirement is a non-event with no migration. Removed as an *offerable* option everywhere (SubscriptionPlan type, admin grant validTypes, payment validPlans, /api/mirror/unlock tokenMap — including the legacy MIRROR_UNLOCK_TOKEN fallback). getMirrorAccessState() retains its `lifetime` branch defensively (treats as never-expiring) in case any stray row ever existed — zero risk to keep, zero benefit to remove. Do not re-add 'lifetime' as a plan; if a "pay once" option is wanted again, design it as a new explicit plan rather than reviving this name.

**KDD 173 — getMirrorTier() is additive and separate from getMirrorAccessState() by design (Phase 4, June 13, 2026).** getMirrorAccessState() has 18 callers and is the sole arbiter of *whether* Mirror is unlocked (KDD 44 — unchanged). getMirrorTier() answers a different question — *which* unlocked experience — and is only called where tier-specific behaviour exists (status route, /api/mirror/rules). This avoids changing getMirrorAccessState()'s return type (which would have required touching all 18 callers) for a concern only 2 routes + 4 components actually have. If a future caller needs both, call both — the extra query is a single indexed lookup on mirror_access by user_id, negligible at current scale.

**KDD 174 — Mirror Advisory differentiation is additive, not subtractive: "addition not subtraction" (Phase 5, June 13, 2026).** Nothing was removed from the Mirror tier to create the Advisory gap. All core self-reflection modules (Bias Fingerprint, Independence Score, Implicit Rules, Pattern Store, Timeline, Calibration, MJR, Mirror Insight Card, Avoidance Alerts) remain fully available to Mirror subscribers — this protects the flywheel (every paying user still generates full Ledger data and gets real value) and avoids a bait-and-switch perception that would damage word-of-mouth in HNI/family-office circles where referrals matter more than ads. The Advisory gap is created by what's *added*: Benchmark, full Contradiction Detector detail, SRI prescriptive layer, no session-count waits, and — the part software can't replicate — a capped, founder-led relationship (Quarterly Judgment Memo + call, offline, no code dependency). Do not close the Mirror/Advisory price gap by removing modules from Mirror; widen it by adding to Advisory instead.

**KDD 175 — Contradiction Detector's Mirror-tier "summary view" is designed to pull toward Advisory, not to block (Phase 5, June 13, 2026).** At 40+ sessions, both tiers now see *that* contradictions exist — Mirror sees count + category grouping (e.g. "2 — Stakeholder framing"), Advisory sees the exact statements via the existing ContradictionCard. This is deliberately not a lock icon, blur, or "upgrade to see" wall: telling the user precisely what was found while withholding only the evidentiary detail is a stronger and more honest curiosity gap than hiding that anything exists at all. ContradictionSummaryView (components/ContradictionDetector.tsx) groups by `category` using CATEGORY_LABELS, orders by sharpest `severity` per category, and ends with AdvisoryUpsellCard (lib/mirror-tier-config.ts → ADVISORY_UPSELL_COPY.contradictionDetail). Given current session counts, this view is effectively dormant for now — most users are well below the 40-session UNLOCK_THRESHOLD.

**KDD 176 — DeepSeek model upgraded from `deepseek-chat` → `deepseek-v4-pro`; v4-pro chosen over v4-flash for all calls at current scale (June 13, 2026).** `deepseek-chat` is deprecated July 24, 2026 (maps to non-thinking mode of `deepseek-v4-flash`). Switched to `deepseek-v4-pro` as the code default in `lib/ai-client.ts` and added `DEEPSEEK_MODEL=deepseek-v4-pro` to Railway. v4-pro chosen over v4-flash after direct comparison: v4-pro is ~3× more expensive per token ($0.435 vs $0.14 per 1M input), but at current user scale the cost delta is noise (≈$20–40/month at optimistic volume). Quality uplift on the user-visible calls — persona analyses, pushbacks, mirror fingerprint, brief generation — is real. v4-flash is the right move if cost becomes a concern at scale; toggle by changing `DEEPSEEK_MODEL` in Railway, zero code change. Do not revert to `deepseek-chat` after July 24, 2026 — it will stop working.

**KDD 177 — `DEEPSEEK_THINKING` env var controls DeepSeek thinking mode; defaults to `disabled` (June 13, 2026).** Both `deepseek-v4-pro` and `deepseek-v4-flash` default to thinking mode ON per the DeepSeek API docs. Quorum explicitly defaults to `disabled` because: (1) streaming calls (personas, pushbacks) accumulate `reasoning_content` tokens before emitting any `content` tokens — users would see a longer blank pause before text starts streaming, degrading perceived Council responsiveness; (2) thinking mode silently ignores the `temperature` parameter, which some completion calls use for determinism. The streaming code already handles thinking mode correctly if ever enabled — `chunk.choices[0]?.delta?.content` skips `reasoning_content` chunks naturally, so only final-answer tokens reach the user. Toggle via Railway `DEEPSEEK_THINKING=enabled` with no code change or redeploy. TD-3 logged: enable thinking selectively for non-streaming completions only (mirror fingerprint, brief generation) where latency is invisible — requires per-call thinking control, deferred.

**KDD 178 — TypeScript overload resolution for DeepSeek streaming: `create({...} as any) as any` + `as AsyncIterable<any>` on `withRetry` result (June 13, 2026).** The OpenAI SDK's `chat.completions.create` is overloaded: `stream: true` → `APIPromise<Stream<ChatCompletionChunk>>`, `stream: false` → `APIPromise<ChatCompletion>`. When params are cast `as any` (required to pass the `thinking` field not in SDK types), TypeScript cannot resolve the overload and falls back to `APIPromise<ChatCompletion>` — the non-streaming type — which lacks `[Symbol.asyncIterator]`, breaking `for await`. Fix in `streamDeepSeek`: cast the `create(...)` return value itself `as any`, then cast the `withRetry(...)` result `as AsyncIterable<any>`. This gives TypeScript a known async-iterable type for the `for await` without requiring subpath imports (`openai/streaming`, `openai/resources/chat/completions`) whose availability depends on the installed SDK version. The `as any` on params alone suffices for the non-streaming `createCompletion` path. Do not attempt to remove either cast — `thinking` will never appear in OpenAI SDK types.

**KDD 179 — Two pricing copy fixes in `app/mirror/page.tsx` (June 13, 2026).** (1) `PRICING_URL` corrected from `https://www.quorumvault.org/#pricing` → `https://quorumvault.org/#pricing`. The `www.` prefix is not used anywhere on the website (all CTAs link bare domain); this was the only `www.quorumvault.org` reference in either repo. (2) Advisor comparison copy in TeaserView updated from `₹50,000` → `₹5 lakh/year`. The original `₹50,000` framing created a perceived gap of only ₹11K vs Mirror's ₹39,999/year — actively undermining the repricing rationale (KDD 171). `₹5 lakh/year` is accurate for a real advisory/coaching retainer at CXO/HNI level, creates a clear ~12.5× gap, and uses the lakh notation the ICP thinks in. No website change needed — the comparison line exists only in the app's TeaserView.

**KDD 180 — `lockedBadge` in TeaserView must signal "paid plan", not "loading state" (Sprint CX1, June 15, 2026).** The original badge rendered the word `building` in a neutral grey/monospace chip. The intent was "data accumulating over time" — which is true — but it is incomplete as a signal. For a user without a subscription, the primary meaning a new visitor needs to understand is "this section requires Mirror plan." When the badge is grey and says `building`, users cannot tell whether (a) the system is still processing and they should wait, or (b) payment is required and they should act. The fix resolves this at source: text changed to `Mirror`, colour changed to `var(--gold)`, background and border updated to match the existing gold system tokens (`rgba(201,168,76,0.06)`, `var(--gold-dim)`), `IconLock size={10}` added as a universally-understood access-restriction signal. `onClick` added to smooth-scroll to `#mirror-cta` — this eliminates the cognitive gap between "I see this is restricted" and "I know what to do about it." The gold colour matches the CTA card and the nav gold used throughout Mirror, creating a visual thread that pulls the eye downward. Do not revert this badge to neutral grey styling. The neutral grey is what caused the misread. If the badge needs to be updated for a future plan-rename, change the text only — keep gold + lock icon.

**KDD 181 — CTA card in TeaserView must explicitly name the sections it unlocks (Sprint CX1, June 15, 2026).** The original CTA card copy ("Activate Mirror — complete your Judgment OS" / "Your behavioral mirror is already building.") was accurate product positioning but not operationally useful for a user mid-session staring at three `building` badges and trying to understand what payment unlocks. Two specific failures: (1) "Your behavioral mirror is already building." echoed the ambiguous `building` language from the badges, reinforcing the confusion rather than resolving it. (2) The CTA listed a price and "See plans →" but never enumerated which specific sections the user was looking at would unlock — no explicit chain from badge → section → payment → resolution. Fix: headline changed to "Unlocks these sections:"; explicit dot-list added naming Bias Fingerprint, Decision Independence Score, Contradiction Detector, Confidence Calibration. This creates a direct mapping from what the user sees above (section with `Mirror` badge) to what the CTA offers below. `UnlockCodeInput` is positioned above "See full plans →": in the current GTM phase, early users receive activation codes directly — routing them through a pricing page before the code input is the wrong priority ordering. When self-serve Razorpay payment is shipped, evaluate whether to swap this ordering. "See plans →" renamed "See full plans →" to match expectation that this leads to detailed plan comparison, not a payment page. `id="mirror-cta"` added to the card `<div>` as the scroll anchor for `lockedBadge`'s onClick. Do not remove the feature list to "clean up" the CTA — it is the primary informational fix that closes the conversion gap Shivani identified.

**KDD 182 — `create-subscription` route rewritten from `PAYMENT_WEBHOOK_SECRET` admin-style auth to user Bearer auth (Sprint CX-PAY, June 16, 2026).** The Sprint 4/19 stub gated this route with a shared secret header — appropriate for a server-to-server or admin-triggered call, wrong for a route a logged-in user's browser calls directly to start their own checkout. Rewritten to resolve the user via `anonClient.auth.getUser(token)` against the Bearer token already used by every other user-facing Mirror route (`/api/mirror/status`, `/api/mirror/rules`, etc.) — consistent auth pattern across the codebase, and correctly scopes "who can create a subscription" to "the authenticated user creating their own subscription," not "anyone with the shared secret." `notes.user_id` and `notes.plan` are injected into the Razorpay subscription at creation time specifically so the webhook handler can resolve identity without a Supabase round-trip on every event — Razorpay propagates `notes` from subscription to its associated payments, so both `subscription.activated` and `payment.captured` can read `user_id`/`plan` directly from the webhook payload in the common case.

**KDD 183 — Webhook cancellation events are no-ops by design; `expires_at` is the only access gate (Sprint CX-PAY, June 16, 2026).** `subscription.cancelled` and `subscription.expired` do not delete or modify the `mirror_access` row. This is deliberate, not an oversight: a user who cancels mid-period should keep Mirror access until the period they already paid for ends — immediate revocation on cancellation is poor SaaS UX and not something Razorpay's own `cancel_at_cycle_end` semantics expect the merchant to override. `expires_at` already gates access in `getMirrorAccessState()` (pre-existing logic, unchanged) — once it passes, the user falls through to `teaser` or `locked` naturally on their next status check. No cron job, no cleanup script, no manual step is needed for this to resolve correctly. Do not add logic to the webhook handler that proactively zeroes `expires_at` on cancellation — this would shorten access the user already paid for.

**KDD 184 — `nixpacks.toml` required to override `npm ci`; Railway dashboard Build Command does not reach the install phase (Sprint CX-PAY, June 16, 2026).** Adding `razorpay` to `package.json` without a matching `package-lock.json` regeneration caused every deploy to fail at `npm ci` with `EUSAGE` (lock file out of sync). Normally this is fixed by running `npm install` locally and committing the updated lock file — but Ken's laptop has IT-imposed restrictions blocking Node.js installation via the official installer, winget, and scoop. The Railway dashboard's "Build Command" setting was tried first as a workaround (set to `npm install && npm run build`) — this did **not** fix the error, because Nixpacks runs its own install phase (`npm ci`) *before* the configured build command executes; the two are separate phases and the dashboard setting only controls the latter. The actual fix: `nixpacks.toml` in the project root with `[phases.install]` / `cmds = ["npm install"]`, which overrides the install phase itself. Both settings now coexist correctly — `nixpacks.toml` handles install, the Railway dashboard build command handles build — and neither needs to be reverted. If a future dependency is added and Node still isn't available locally, this same `nixpacks.toml` already covers it; no repeat fix needed.

**KDD 185 — Razorpay checkout requires explicit CSP allowances across four directives, not just `script-src` (Sprint CX-PAY, June 16, 2026).** The first deploy after wiring `PaymentButton` failed at the checkout step with "Checkout failed to load. Please refresh and try again." — `checkout.razorpay.com/v1/checkout.js` was blocked by the existing CSP's `script-src 'self' 'unsafe-inline'`. Fixing only `script-src` would have been insufficient: the modal also needs `connect-src` (for the checkout JS to call `api.razorpay.com`), `img-src` (card brand logos rendered inside the modal), and a new `frame-src` directive (the modal itself renders inside a Razorpay-controlled iframe, which `frame-src` — not `script-src` — governs). Additionally, the existing `Permissions-Policy` header explicitly disabled the Payment API via `payment=()`, set during the original Sprint 4 security hardening pass without anticipating a future payment integration — this had to be removed, not just left alone, since an explicit `()` denial overrides any later same-origin allowance. Any future third-party widget embedded in Quorum (chat, video, another payment processor) should be checked against all four CSP directives plus `Permissions-Policy`, not just `script-src` — this is the second time in the codebase's history a third-party script needed multi-directive CSP changes (see also PWA Sprint `worker-src` addition).

**KDD 186 — `MirrorTier` has exactly two values (`'mirror' | 'advisory'`); monthly and annual subscribers are indistinguishable once unlocked (Sprint CX-PAY, June 16, 2026).** While wiring the Cancel Subscription UI, an early draft gated the cancel button on `status.tier === 'monthly' || status.tier === 'annual'` — this does not compile against the actual `MirrorTier` type (Phase 4, Mirror Tiering Sprint, June 13) and would have been caught at build time, but was caught and corrected before deploy. The correct gate is `status.tier === 'mirror'` — `SubscriptionPlan` (`'monthly' | 'annual' | 'advisory'`) and `MirrorTier` (`'mirror' | 'advisory'`) are deliberately different types serving different purposes: `SubscriptionPlan` is the billing-level distinction stored in `mirror_access.access_type`; `MirrorTier` is the feature-gating distinction surfaced once a user is unlocked, where monthly and annual behave identically for every Mirror module. Any future code that needs to render different cancellation copy for monthly vs. annual specifically (e.g. "your annual plan" vs "your monthly plan") must read `access_type` from a dedicated field/route — `status.tier` cannot answer that question by construction.

**KDD 187 — Decision Brief is free for every user, every tier; the token gate was a retention liability, not a revenue line (Sprint RET-1 + RET-2, June 20, 2026).** A first-to-second-use audit (see SECOND-USE RETENTION STRATEGY section) identified the Brief PDF as the single biggest "dead-end CTA" in the product: a satisfied first-time user, seconds after their highest-engagement moment, hit a wall they had no way to resolve (`Enter access code` / `Invalid code. Contact Kunal to get access.`) on both surfaces that offered it — the record page (`BriefCTA.tsx`) and the in-session synthesis view (`SynthesisCard.tsx`). The gate generated zero conversions in practice (no self-serve path existed; codes were shared manually, defeating the purpose of a "buy here" button) while actively suppressing the Outcome and Delayed-value retention loops by making the most shareable, savable artifact in the product effectively inaccessible to anyone without a direct message from Kunal. RET-1 removed the gate from the data path (`brief/route.ts` GET handler, `BriefCTA.tsx`); RET-2 found and fixed the second, independent gate in `SynthesisCard.tsx` that RET-1 had missed (two UI surfaces called the same underlying free endpoint, only one had been updated to reflect that). Both now resolve to the same ungated `handleGenerateBrief()` / direct-download path. `/api/brief-access` and `BRIEF_ACCESS_TOKEN` are dead code/unused env var as of this sprint — do not resurrect a paid gate on Decision Brief without first re-examining the retention-loop dependency chain documented in SECOND-USE RETENTION STRATEGY; the Brief PDF is now load-bearing infrastructure for the Outcome and Delayed-value loops, not a monetization surface (Mirror remains the monetization surface).

**KDD 188 — `/api/record/[id]/echo-hint` calls `scoreStructuralSimilarity()` directly and never calls `retrieveStructuralMatches()` — this is the mechanism that makes Item C safe without touching `MIN_SESSIONS` (Sprint RET-3, June 20, 2026).** `lib/structural-retrieval.ts` exports two distinct things that are easy to conflate: `scoreStructuralSimilarity()` is a pure, synchronous, zero-cost pairwise scoring function; `retrieveStructuralMatches()` is the full retrieval pipeline that hard-gates on `pastSnapshots.length < MIN_SESSIONS` (returns empty matches + `threshold_met: false` below 5) and, for sessions that clear the gate, calls the async `annotateMatch()` which makes an LLM call to generate the Council-facing narrative injected into persona prompts. The echo-hint route calls only the former. It independently fetches up to 20 past same-identity ontology snapshots, scores each against the current session with `scoreStructuralSimilarity()`, and — only if the best score clears the existing `MATCH_THRESHOLD` env var (default 45, same constant used everywhere else) — returns a single abstracted dimension label (via `DIM_LABELS`, with a small `SHORT_DIM_LABEL` UI-friendliness override local to the route) and a coarse month/year. It never calls `annotateMatch()` (no LLM cost), never writes to `structural_matches` or `structural_scores` (those tables remain the exclusive output of `/api/structural-match`, called from `SessionView` during the live session — echo-hint shares no write path and cannot race or corrupt that cache), and never returns the matched session's decision text to the client. **Do not lower `MIN_SESSIONS` to make EarlyEchoCard "feel richer" earlier** — that pressure is exactly what this separate code path was built to relieve. If a future feature needs genuinely deeper cross-session comparison before session 5, build it the same way (direct `scoreStructuralSimilarity()` call, no `retrieveStructuralMatches()`), not by touching the threshold protecting Council injection quality.

**KDD 189 — The "Item B" idea (a `JudgmentSignatureCard` aggregate-bias homepage card) was explicitly rejected, not deferred-as-a-TODO; replaced by a one-line copy fix plus a deferred Mirror-Patterns-tab placement (Sprint RET-3, June 20, 2026).** The original Phase 6/7 retention plan proposed a new homepage card surfacing the user's dominant bias across sessions ("Anchoring — present in 4 of 7 decisions"). On review, `components/PatternSurfaceCard.tsx` already does this job at 5+ sessions — surfacing the dominant structural pattern (rule-engine based) with named narrative, triggering decisions, and an actionable line. Adding a second "your dominant pattern" card sourced from a different detection system (bias_library vs. rule_engine_result — these are intentionally separate systems per KDD/bugfix history, see the MirrorOpenLoopCard patternCount fallback fix, June 11) would put two semantically-similar cards on the same homepage screen, which users would read as feature-showcasing rather than as two genuinely distinct signals. Decision: skip the homepage card entirely. The one concrete, low-risk piece of value from the original idea — fixing the Mirror "NEXT MOVE" copy at `structural === 50`, which had a real bug (suggested "log your next 2–3 decisions" when `MIN_SESSIONS=5` actually requires 3 more from a 2-session baseline, not 2–3) — was kept and shipped (`lib/session-score.ts`). The bias-aggregate-in-Patterns-tab idea (surfacing `bias_library` data inside Mirror's existing Patterns tab, not as a new homepage surface) remains a legitimate, low-overload future option — logged in TECH DEBT as TD-4, not committed to a sprint. Do not resurrect the homepage-card version of this idea without first checking whether `PatternSurfaceCard` has been changed in a way that reopens the gap.

**KDD 190 — `BiasNoteCard` surfaces only `signal_type === 'distorting'` detections, with no `detection_count` threshold — a deliberate single-session, non-longitudinal claim (Sprint RET-3, June 20, 2026).** `BehaviorAlerts.tsx` (the existing homepage longitudinal bias surface) requires `detection_count >= 2` and is Mirror-access-gated — it is making a *confirmed pattern across your history* claim, which legitimately needs repetition to back it up. `BiasNoteCard` is making a different, weaker claim: *this specific thing was flagged in this specific session* — true the first time it happens, requiring no Mirror subscription and no repetition. Filtering to `signal_type === 'distorting'` only (excluding `neutral` and `adaptive` classifications, per `classifyBiasSignal()` in `lib/bias-scorer.ts`) is the safety rail that makes a single-occurrence claim honest: a neutral or adaptive signal genuinely isn't a "watch out," and showing it as one would be misleading on the very first session, when the user has no other data to contextualize it against. Ranking by `prosecutor_score` (already stored per-session in `activation_contexts[sessionId]`) when multiple distorting biases fire in one session picks the strongest single signal rather than overwhelming the post-synthesis moment with a list. Do not add a `detection_count` gate to this component — that would silently convert it into a worse version of `BehaviorAlerts` and reintroduce the session-1 dead zone this card exists to close.

**KDD 191 — `EmailCaptureCard` is intentionally framed around the specific decision just made, not as generic account creation, and is placed on the record page rather than the homepage (Sprint RET-1, June 20, 2026).** The friction audit (SECOND-USE RETENTION STRATEGY, Phase 4) identified that the only existing email-capture surface (`AuthPanel.tsx` on the homepage) only appears to users who have *already chosen to return* — by definition too late to influence the decision to return a second time. The peak-intent moment is seconds after synthesis, on the record page, not on a subsequent homepage visit. Copy is deliberately framed as a service tied to the decision just made ("Want us to check back on this?") rather than as "link your account" — this reuses the same psychological framing already proven in the existing `reanalyze-email` cron (KDD-adjacent: that cron already does exactly what this card promises, at 7/14/30 days). The card calls the pre-existing `/api/auth` endpoint with no new backend work. Do not move this card to the homepage or reframe it as account creation — both were considered and rejected; the decision-specific framing on the record page is the entire mechanism by which this closes the friction-audit gap.

**KDD 192 — Identity precedence (`user_id` > `user_email` > `device_id`) is applied consistently across all three RET-sprint surfaces, and `device_id`-only users are intentionally excluded from `echo-hint` (Sprint RET-1/RET-3, June 20, 2026).** `BiasNoteCard`'s server-side query in `record/[id]/page.tsx` and `echo-hint/route.ts` both resolve identity using the same precedence order already established by `/api/bias-score` for writes. `BiasNoteCard` supports all three tiers including `device_id`-only (anonymous) users — bias detection already works pre-email per existing `bias_library` design, so there is no reason to exclude anonymous users from session-1 bias feedback. `echo-hint`, by contrast, requires `user_id` or `user_email` and explicitly returns `{ available: false, reason: 'no_identity' }` for device-only sessions — this is a deliberate asymmetry, not an oversight: it gives `EmailCaptureCard` a second, concrete, structural-comparison-specific reason to convert an anonymous user ("link your email to start seeing pattern connections"), reinforcing rather than competing with that card's purpose. Do not "fix" this asymmetry by adding `device_id` support to `echo-hint` without first confirming `EmailCaptureCard`'s conversion data doesn't depend on it.

**KDD 193 — Lever (ii)'s calibration note is embedded inside `OutcomeTracker`'s existing 'saved' state rather than shipped as a new sibling component, departing from the shape §5 originally suggested (Sprint RET-4, June 21, 2026).** §5's original write-up proposed a new lightweight component following the `BiasNoteCard` pattern — server computes a note object in `page.tsx`, passes it as a prop to a presentational sibling card. That shape works for `BiasNoteCard` because its data (`bias_library` rows) is fully resolved server-side before the page ever renders. The calibration note's data is not: `displayOutcome` (the merge of `existingOutcome ?? localSaved` already living inside `OutcomeTracker`) is the only place in the component tree where a freshly-saved-this-session outcome and a returning-visit outcome converge into one value — `existingOutcome` is a server prop that does not update client-side after a fresh save, a constraint `OutcomeTracker` already documents in its own comments. A server-rendered sibling card would therefore only have shown the note on the user's *next* visit to the page, silently dropping the reward for every user who reads it in the same session they filed the outcome — the actual peak-intent moment, and the moment the lever's own example copy implies. Embedding the note inside the existing 'saved' block costs one new prop (`preDecisionConfidence`, threaded from `session.pre_decision_confidence`, already a queried column) and reuses `displayOutcome` as-is, with no new fetch, no new component, and no risk of the immediate-reward case silently degrading to a same-session no-show. Do not extract this into a standalone component without first confirming the extraction still has access to `localSaved` (not just `existingOutcome`) — that access is the entire reason this lever works at the moment it's supposed to.

**KDD 194 — Reanalyzed decisions are now first-class citizens of the calibration record; both reanalyze entry points capture entry confidence (Sprint RET-4 follow-up, June 21, 2026).** Discovered via a live bug report: a decision reanalyzed from the record page (`ReanalyzeDrawer.tsx`) showed a hindsight confidence badge on save but no calibration note, even though lever (ii) was live. The lever (ii) gate (KDD 193) was not the bug — `calibrationNoteCopy()` correctly stays silent when `pre_decision_confidence` is null, and that's exactly what it was for any session created via `SessionView.tsx`'s in-Council `handleReanalyze` or `ReanalyzeDrawer.tsx`'s post-record drawer, since neither ever sent the field (both predate lever (ii) and predate the calibration feature's own May 12, 2026 ship — they were never updated when the homepage form gained its slider). This was a silent, asymmetric gap: only decisions originated from the homepage's "New Decision" form ever fed the calibration record; reanalyzed decisions — arguably the ones a user is most actively recalibrating on — never could, regardless of lever (ii). Fix: both files now carry their own `rePreConfidence` state (default 5) and a confidence slider, styled to match each file's pre-existing local convention rather than a shared new component (`SessionView.tsx` reuses its panel's font-mono/uppercase labels and `--green-text`; `ReanalyzeDrawer.tsx` reuses its own simpler label style and `--success-text`, the token family that file already uses elsewhere) — and both now send `pre_decision_confidence: rePreConfidence` in the `POST /api/session` body. No change to the `/api/session` validation logic or to `calibrationNoteCopy()` itself; this closes the gap entirely upstream, at the two points where confidence was never being asked for in the first place. If a third reanalyze-style entry point is ever added, it must include this slider too — there is no server-side fallback that backfills entry confidence after the fact.

**KDD 195 — `CouncilContext` and `UserBiasContext` are now named, exported, single-source-of-truth shapes; the recurring "missed fallback literal" bug class this codebase had already hit twice is closed at its two live instances (Sprint TB1, June 21, 2026).** The diligence report's third logged incident (a function signature extended with 2 new optional params in 3 places; one of several hand-typed `Promise.resolve({...})` fallback literals elsewhere was missed on first deploy, causing a TypeScript union-type build failure) was a description of a pattern, not a closed loop — `app/api/persona/route.ts` still had the exact shape this pattern targets: `fetchCouncilContext()`'s 7-field return type was hand-typed in 5 separate places (both function signatures, 3 early-return literals inside the try block, 1 catch-block literal, 1 no-fetch `POST`-handler fallback), and `UserBiasContext` was hand-duplicated in 2 more despite already being an exported type from `lib/bias-scorer.ts`. Fix: `CouncilContext` interface + `EMPTY_COUNCIL_CONTEXT` constant, both exported from `persona/route.ts`; `lib/bias-scorer.ts`'s previously function-local `empty` const hoisted to an exported `EMPTY_USER_BIAS_CONTEXT`, now referenced both inside `fetchUserBiasContext()` and at the 2 call sites in `persona/route.ts` that used to retype it by hand. The 3 early-return sites inside `fetchCouncilContext()` use `{ ...EMPTY_COUNCIL_CONTEXT, userId }` rather than the bare constant, since `userId` is already resolved from the `sessions` table read at that point and is not actually null in those branches — do not collapse these to the bare constant, that would silently drop a real value. A future field added to either interface without updating its constant (or a stray `as`-cast that bypasses the compiler) now fails to compile at every site that references the named type, instead of shipping a partial shape to synthesis silently. Covered by `tests/council-context-shape.test.ts`'s exact-key-set runtime assertions, which exist specifically as a backstop for the `as`-cast case the compiler alone can't catch. No behavior change — confirmed via `tsc --noEmit` showing zero new errors (the 9 pre-existing `TS2802` Set/Map-iteration errors in unrelated files were present before this change too).

**KDD 196 — Next.js App Router route handlers can only export HTTP method functions; any other named export breaks `next build` silently past `tsc --noEmit` (Sprint RET-5, June 22, 2026).** During Sprint RET-5 Sprint 2, `CouncilContext` and `EMPTY_COUNCIL_CONTEXT` were extracted from `app/api/persona/route.ts` into `lib/council-context.ts` (TB1 sprint work), and `fetchContinuityContext` was placed in `lib/decision-continuity.ts` rather than exported from `persona/route.ts` — both for exactly this reason. Next.js 15 App Router validates that route files export only recognised HTTP method names (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) and the special `dynamic`, `revalidate`, `runtime` config symbols. A named function or interface export from a route file does not cause a TypeScript error (tsc sees it as a valid module export), but next build silently strips or mis-routes the file in ways that produce runtime 404s or build failures that are not attributed to the correct file in the error output. The standing rule: any shared logic that needs to be called from a route handler — type interfaces, utility functions, context fetchers — lives in a `lib/` file and is imported into the route, never exported from it. This pattern is now established across: `lib/council-context.ts` (CouncilContext shape), `lib/decision-continuity.ts` (fetchContinuityContext), `lib/structural-retrieval.ts` (scoreStructuralSimilarity), `lib/bias-scorer.ts` (fetchUserBiasContext). Do not break this pattern for any future shared route utility.

**KDD 197 — `parent_session_id` must be validated against the requester's identity before being honoured; unvalidated, it would allow Sprint 2's Council continuity injection to read another user's decision, examiner answers, and pushback into the new session (Sprint RET-5 Sprint 1, June 22, 2026).** The identity guard in `POST /api/session` resolves the parent session's owner (`user_id`, `user_email`, `device_id`) and compares against the requester's resolved identity using the same precedence chain (`serverUserId` from Bearer token > `user_email` from body > `device_id` from body) already used throughout the codebase. On mismatch: `resolvedParentId` is set to null, a server-side warning is logged, and the new session is still created successfully — just without the link. The endpoint never 400s the user for an invalid `parent_session_id`; the new session is always created. On a missing parent (null): no-op. This guard must remain in place as long as Sprint 2's Council continuity injection reads from `parent_session_id` — without it, a crafted POST body could inject arbitrary session evidence into a Council analysis. If a future sprint adds any other `parent_session_id`-dependent behavior, it inherits this guard automatically since the guard fires at session creation, before any downstream logic runs.

**KDD 198 — Council continuity injection uses two distinct artifacts with different adherence levels: `personaBlock` (informational, user turn) and `synthesisDirective` (NON-NEGOTIABLE, terminal system-prompt layer) (Sprint RET-5 Sprint 2, June 22, 2026).** The distinction is deliberate and architecturally load-bearing. `personaBlock` is injected into the user turn of each initial persona's `chatMessages` — it frames the prior sitting as context the persona may draw on, but it is not a mandate; a persona whose analytical angle genuinely does not intersect with the prior sitting can ignore it. `synthesisDirective` is appended after `relevanceBlock` (Layer 4, the existing council-weighting directive) as Layer 5 — the true terminal layer in the synthesis system prompt. LLM adherence is highest for the last instruction in a system prompt; positioning it here is not cosmetic, it is the mechanism. The directive is NON-NEGOTIABLE — synthesis must explicitly address what the prior Council concluded, where examiner evidence is still load-bearing, the logged outcome if one exists, and whether the new information changes the commitment trigger the user named at the original sitting. Directive items are conditional on evidence actually existing in the parent session — the directive never references evidence that was not found. Do not collapse `personaBlock` and `synthesisDirective` into a single injection, and do not move `synthesisDirective` earlier in the system prompt — both changes would degrade adherence.

**KDD 199 — Decision Arc timeline renders only on chain-root record pages (no `parent_session_id`), not on revisit pages (Sprint RET-5 Sprint 3, June 22, 2026).** The timeline stitches the full sitting chain with outcomes, starting from the original decision. Revisit record pages already carry the backward breadcrumb ("← Revisiting a decision from [date]") linking back to root — showing the timeline again on revisit pages would be redundant and would require walking the full ancestor chain to find root, adding DB round-trips on every revisit record page load. The `isChainRoot` flag (`!session.parent_session_id && childSessions.length > 0`) ensures the extra data-fetch block (child decision text + all-session outcomes + Mirror access check) is only triggered when there is genuinely a chain to display, and is a no-op on all single-session record pages. If a future sprint adds a multi-level chain (revisit of a revisit), the `childSessions` query already handles it — the root page would show all descendants. The Mirror Calibration Arc tile at the bottom of the timeline is additive: Mirror users with outcome data see actual `avgCalibrationDelta` with directional commentary; non-Mirror users see a named teaser (text only, no blur, no lock icon) describing what exists. The tile never blocks the free timeline above it.

**KDD 200 — HTML emails must use hardcoded light-palette hex values; CSS `prefers-color-scheme` is not a reliable dark/light control in email clients (Sprint RET-5 Fixes, June 22, 2026).** The `reanalyze-email` cron's HTML template was originally written with a dark background (`#0a0a0a`) and dark-palette text colours. In Gmail and most other major email clients, CSS media queries including `@media (prefers-color-scheme: dark)` are either unsupported or overridden by the client's own dark-mode colour inversion — meaning a hardcoded dark background does not reliably produce a dark email; it can render as a dark-on-dark or inverted mess in clients that apply their own dark mode on top. The fix: use a warm off-white base (`#f5f4f0`) with near-black body text — a hardcoded light palette that is unambiguous across all clients. The gold CTA button (`background:#c9a84c`, `color:#0a0a12`) is unchanged; it reads correctly in light contexts. Rule: any future HTML email added to the codebase must use hardcoded light-palette hex values. Do not attempt to use `prefers-color-scheme` in email HTML for colour-scheme control.


 (`user_id` > `user_email` > `device_id`) is applied consistently across all three RET-sprint surfaces, and `device_id`-only users are intentionally excluded from `echo-hint` (Sprint RET-1/RET-3, June 20, 2026).** `BiasNoteCard`'s server-side query in `record/[id]/page.tsx` and `echo-hint/route.ts` both resolve identity using the same precedence order already established by `/api/bias-score` for writes. `BiasNoteCard` supports all three tiers including `device_id`-only (anonymous) users — bias detection already works pre-email per existing `bias_library` design, so there is no reason to exclude anonymous users from session-1 bias feedback. `echo-hint`, by contrast, requires `user_id` or `user_email` and explicitly returns `{ available: false, reason: 'no_identity' }` for device-only sessions — this is a deliberate asymmetry, not an oversight: it gives `EmailCaptureCard` a second, concrete, structural-comparison-specific reason to convert an anonymous user ("link your email to start seeing pattern connections"), reinforcing rather than competing with that card's purpose. Do not "fix" this asymmetry by adding `device_id` support to `echo-hint` without first confirming `EmailCaptureCard`'s conversion data doesn't depend on it.

---

## MIRROR vs MIRROR ADVISORY (Phases 1, 2, 4, 5 — June 13, 2026)

This section is the single reference for the two-tier Mirror model introduced in the Mirror Tiering Sprint. Read this before touching pricing, `mirror_access`, or any of the four Phase 5 modules (Benchmark, Contradiction Detector, Session Reliability Index, Decision Rules).

### 1. The three tiers and pricing

| Tier | Price | Sold how | Cohort |
|---|---|---|---|
| **Council** | Free | Self-serve, unlimited | Open — the funnel |
| **Founding Access** | ₹1,000/mo | Offline, manual billing | First 50 users only. **Never on the public pricing page.** Granted as `access_type: 'monthly'` with no special code path — same DB row shape as a normal Mirror subscriber, billed outside the app. |
| **Mirror** | ₹3,999/mo · ₹39,999/yr | Self-serve (Razorpay still pending — see Sprint 20 backlog) | Unlimited |
| **Mirror Advisory** | ~₹75,000/quarter (~₹3L/yr) — **internal anchor only, never published** | By application, founder-led. Granted via `/api/admin/grant-mirror-access` with `accessType: 'advisory'` | **Capped at 5** (scale to 10 later if Memo/call workload allows) |

Mirror was repriced from ₹1,499/mo · ₹9,999/yr (Phase 1, KDD 171). `'lifetime'` was retired as a plan (Phase 2, KDD 172) — see the updated `mirror_access` schema block above.

**Advisory price is intentionally unpublished.** Do not add it to the website pricing page or any marketing copy. The first real Advisory conversation (LinkedIn outreach — Nirav Choksi, Akshay Mehrotra, Farooq Adam, Aditya Pittie, Anindya Dutta, per GTM notes) sets the real anchor; ₹75K/quarter is a starting point for that conversation, not a committed number.

### 2. What Mirror Advisory actually is — and isn't

Per KDD 174, the ~20x price gap is **not** primarily a feature gap. Every core self-reflection module (Bias Fingerprint, Decision Independence Score, Your Implicit Rules, What Keeps Coming Up, Decision Timeline, Confidence Calibration, Monthly Judgment Review, Mirror Insight Card, Avoidance Alerts) is **identical in both tiers** — Mirror subscribers get the full self-reflection product, no asterisks. This protects the flywheel: every paying user generates full Ledger data and gets real value, and nothing that's live today is being clawed back.

The Advisory gap is built from two layers:

1. **Software layer (Phase 5, shipped):** Benchmark, full Contradiction Detector detail, SRI's prescriptive "next move", and no session-count waits (Rules @8, Contradiction Detector @40 both bypassed).
2. **Human layer (offline, not code):** A Quarterly Judgment Memo — founder personally reviews the Advisory client's full Ledger (via the existing account export) and writes a 1–2 page narrative on their dominant bias pattern, what's compounding well, and what to watch — plus a quarterly call. This is the layer competitors can't clone by copying the UI, and at a cap of 5 it's ~2–4 hrs/client/quarter — sustainable alongside product work.

If the Mirror/Advisory price gap ever feels unjustified, the fix is **adding to Advisory** (more human touchpoints, more exclusive modules), never **subtracting from Mirror**.

### 3. Tier resolution mechanics (Phase 4)

```
lib/types.ts
  export type MirrorTier = 'mirror' | 'advisory'
  MirrorStatus.tier: MirrorTier   // new field

lib/mirror-access.ts
  export async function getMirrorTier(userId, supabase): Promise<MirrorTier>
    → reads mirror_access.access_type
    → 'advisory' → 'advisory'; everything else → 'mirror'
    → ADDITIVE — does not change getMirrorAccessState() or its 18 callers (KDD 173)

app/api/mirror/status/route.ts
  → tier resolved ONLY when gateState === 'unlocked' (locked/teaser users get tier:'mirror', unused)
  → included in MirrorStatus response
```

`app/mirror/page.tsx` (`UnlockedView`) reads `status.tier` and passes it to the four Phase 5 modules. `/api/mirror/rules` resolves tier itself server-side via `getMirrorTier()` — it does **not** trust a client-supplied tier.

### 4. Module-by-module diff (Phase 5)

| Module | Mirror (₹3,999/mo) | Mirror Advisory |
|---|---|---|
| Bias Fingerprint, Independence Score, Pattern Store, Timeline, Calibration, MJR, Mirror Insight Card, Avoidance Alerts | Full | Full (identical) |
| **Decision Rules** | Gated at 8 sessions (`RULES_SESSION_THRESHOLD`, `ThresholdGate`) | **No threshold** — bypassed server-side in `/api/mirror/rules` via `getMirrorTier()`, immediate from session 1 |
| **Session Reliability Index** | Score + sub-scores; "Your next move" replaced with `AdvisoryUpsellCard` (`ADVISORY_UPSELL_COPY.sriNextMove`) | Score + sub-scores **+ prescriptive "Your next move"** (`actionPlan`) |
| **Contradiction Detector** | Same 40-session gate (`UNLOCK_THRESHOLD`) as before. Once unlocked: **`ContradictionSummaryView`** — count + category grouping (via `CATEGORY_LABELS`), no exact statements, ends with `AdvisoryUpsellCard` (`ADVISORY_UPSELL_COPY.contradictionDetail`) | **40-session gate bypassed** — immediate. Full `ContradictionCard` list with exact statements (unchanged from pre-sprint behaviour) |
| **Benchmark ("Others in Similar Decisions")** | Never fetched. `AdvisoryUpsellCard` (`ADVISORY_UPSELL_COPY.benchmark`) shown under the existing section header | Full — fetches `/api/mirror/benchmark` as before (still respects `MIN_CLUSTER_SIZE`, KDD 51) |
| Decision Brief | **Free** — token gate removed Sprint RET-1 (June 20, 2026); dark/light PDF mode | Free (identical — no tier distinction exists for this module) |
| Quarterly Judgment Memo + founder call | — | Offline, no code dependency |

### 5. Files touched

**New:**
- `lib/mirror-tier-config.ts` — `ADVISORY_UPSELL_COPY` (single source of truth for upsell copy across all 3 modules) + `ADVISORY_BYPASSES_THRESHOLDS` flag
- `components/AdvisoryUpsellCard.tsx` — reusable upsell card, reuses existing teaser/status-card visual language (gold top rule, `var(--bg-card)`) — deliberately not a lock/blur treatment

**Modified:**
- `lib/types.ts` — `MirrorTier`, `MirrorStatus.tier`, `SubscriptionPlan` narrowed (lifetime removed)
- `lib/mirror-access.ts` — `getMirrorTier()` added; lifetime comments updated
- `app/api/mirror/status/route.ts` — resolves + returns `tier`
- `app/api/mirror/rules/route.ts` — `getMirrorTier()` call, advisory bypasses `RULES_SESSION_THRESHOLD`
- `components/DecisionRules.tsx` — `tier` prop, local threshold bypass
- `components/SessionReliabilityIndex.tsx` — `tier` prop, "Your next move" gated
- `components/ContradictionDetector.tsx` — `tier` prop, `ContradictionSummaryView` (new), threshold bypass for advisory
- `app/mirror/page.tsx` — imports, `BenchmarkModule` tier-gated, `tier={status.tier}` wired to all 4 modules
- `app/api/admin/grant-mirror-access/route.ts`, `app/api/payment/create-subscription/route.ts`, `app/api/mirror/unlock/route.ts` — Phase 2 lifetime removal (no Phase 4/5 changes)

### 6. How to grant Mirror Advisory access

**Option A — admin API (existing route, unchanged):**
```
POST /api/admin/grant-mirror-access
Authorization: Bearer <ADMIN_CODE>
{ "userId": "<auth.users UUID>", "accessType": "advisory" }
```
`expires_at` defaults to `null` (never expires) when `durationDays` is omitted — correct for advisory.

**Option B — direct Supabase SQL** (SQL Editor in Supabase dashboard):
```sql
-- Find the user_id first if needed
select id, email from auth.users where email = 'someone@example.com';

-- Grant (or upgrade) advisory access
insert into mirror_access (user_id, access_type, expires_at)
values ('<user-id>', 'advisory', null)
on conflict (user_id) do update
  set access_type = 'advisory',
      expires_at  = null;
```

To revert a test grant: `update mirror_access set access_type = 'monthly', expires_at = <future date> where user_id = '<user-id>';`

### 7. How to test end-to-end

1. Grant yourself `access_type: 'advisory'` via either option above.
2. Reload `/mirror` — `/api/mirror/status` re-resolves `tier` on every load, no cache to clear.
3. Confirm advisory behaviour:
   - **Decision Rules** renders with no 8-session wait (even with low session count — see edge case in §8).
   - **Contradiction Detector** renders with no 40-session wait; if any contradictions exist, full `ContradictionCard`s with exact statements appear (not the summary view).
   - **Session Reliability Index** shows the "Your next move" callout with `actionPlan` text.
   - **Benchmark** section fetches and renders (or stays hidden if `cluster_size < MIN_CLUSTER_SIZE`, per KDD 51 — this is normal, not a tier bug).
4. Revert to `access_type: 'monthly'` (or `'annual'`) and reload again. Confirm:
   - Decision Rules / Contradiction Detector respect their normal thresholds again.
   - SRI shows the `AdvisoryUpsellCard` ("Your Next Move") in place of `actionPlan`.
   - Contradiction Detector, if past 40 sessions, shows `ContradictionSummaryView` (count + category) instead of full cards.
   - Benchmark section shows the "Others in Similar Decisions" `AdvisoryUpsellCard` instead of fetching.
5. No schema changes, no env var changes, no Razorpay involvement — this is purely `mirror_access.access_type` driving `tier`, end to end.

### 8. Known edge cases / deferred items

- **0-session advisory grant briefly shows Rules ThresholdGate.** `/api/mirror/rules` falls back to `{ rules: null, sessionCount: 0, threshold: ... }` when `sessionRows` is empty, *regardless of tier* — this is a "no data yet" fallback, not a tier bug, and resolves itself after the first session.
- **Decision Brief advisory bypass — RESOLVED (moot), Sprint RET-1, June 20, 2026.** This was originally deferred as "needs new auth/tier plumbing." It is now resolved by a simpler route: the `BRIEF_ACCESS_TOKEN` paid gate was removed entirely (`app/api/record/[id]/brief/route.ts`, `components/BriefCTA.tsx`, `components/SynthesisCard.tsx`) — Decision Brief is free for every tier, so there is no longer an advisory-vs-Mirror distinction to wire. `/api/brief-access` is dead code (flagged for deletion, see PENDING/NEXT SESSION); `BRIEF_ACCESS_TOKEN` Railway env var is unused. See KDD 187.
- **Legacy `'lifetime'` rows** (if any ever existed) are still honoured as never-expiring by `getMirrorAccessState()`, and would resolve to `tier: 'mirror'` (not `'advisory'`) under `getMirrorTier()` — correct, since lifetime was always a Mirror-equivalent plan.

### 9. Not yet done — sequencing notes for next session

- **Website "Mirror Advisory — request access" CTA** — intentionally not added yet. Add only after Phase 4/5 has been used in at least one real Advisory conversation (per original sequencing plan); "by application" with no price shown.
- **Founding Access (₹1,000/mo, first 50)** — purely an offline billing/tracking decision, zero code. Track manually (spreadsheet or admin dashboard note) until volume warrants a `mirror_access` metadata column.
- **MIRROR_TOKEN_LIFETIME / MIRROR_UNLOCK_TOKEN** — retired in code but not yet removed from Railway env vars. Safe to remove whenever; no code path reads them.
- **Staging test of this sprint** — not yet run. Use §7 above as the test script.

---

## SPRINT HISTORY

| Sprint | What shipped |
|---|---|
| **Sprint RET-5 Fixes — UX polish: email light mode, breadcrumb visibility, back button label (June 22, 2026)** | **Three targeted patches. `app/api/cron/reanalyze-email/route.ts` — all 7 hardcoded dark hex values replaced with light palette (background `#f5f4f0`, body text `#1a1a1a`, quote border `#dddad0`, footer `#bbb`/`#aaa`); gold CTA unchanged. Root cause: email clients ignore CSS `prefers-color-scheme`. `app/record/[id]/page.tsx` — revisit breadcrumb colour changed from `var(--gold-dim)` (resolves to `#5a3f1a` in dark mode — invisible) to `var(--gold)` (`#d4a843` dark / `#c08c18` light — both legible). Both `BackButton` label props changed from `"← Back to Council"` to `"← Back"`. 2 files changed, 0 schema changes, 0 new env vars. KDD 200. — ✅ Implemented June 22, 2026** |
| **Sprint RET-5 — Lever (i): Linked Revisit — Decision Arc (June 22, 2026)** | **Three sprints shipped as a unit (handover doc updated once all three complete). Sprint 1 — schema + linkage + structural exclusion + breadcrumbs: `supabase/ret5_sprint1_parent_session_id.sql` (NEW) — `parent_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL` + index. `lib/types.ts` — `parent_session_id` added to Session interface. `app/api/session/route.ts` POST — accepts `parent_session_id`, validates against requester identity (KDD 197) before honouring (silent drop on mismatch, never 400). `components/ReanalyzeDrawer.tsx` + `components/SessionView.tsx` `handleReanalyze` — both pass `parent_session_id: sessionId`. `app/record/[id]/page.tsx` — backward + forward breadcrumbs added. `app/api/structural-match/route.ts` — `fetchSessionLineage()` helper excludes same-lineage sessions from structural candidate set (circular reinforcement prevention). Sprint 2 — Council continuity injection: `lib/decision-continuity.ts` (NEW, per KDD 196 — not exported from route file) — `fetchContinuityContext()` gathers parent decision, synthesis, examiner Q&A + pushback (up to 6 lines), outcome, commitment fields; produces `personaBlock` (informational, user turn injection) and `synthesisDirective` (NON-NEGOTIABLE, terminal Layer 5 after `relevanceBlock`, per KDD 198). `app/api/persona/route.ts` — continuity fetch added to `Promise.all` alongside council + bias context; persona injection + synthesis directive injection wired in. Sprint 3 — Decision Arc timeline + Mirror conversion tile: `components/DecisionTimeline.tsx` (NEW) — server component; vertical timeline with outcome chips, "this sitting" badge, per-entry record links. Free, ungated. Mirror Calibration Arc tile additive at bottom — actual delta data for Mirror users, named teaser for non-Mirror (KDD 199). `app/record/[id]/page.tsx` — `isChainRoot` guard, conditional data fetch, timeline rendered before bottom tray. 5 files modified, 2 new files (lib + component), 1 SQL migration, 0 new env vars. KDDs 196–199. — ✅ Implemented June 22, 2026** |
| **Sprint RET-4 follow-up — Root-cause fix: reanalyzed decisions excluded from calibration record (June 21, 2026)** | **`components/SessionView.tsx` `handleReanalyze` + `components/ReanalyzeDrawer.tsx` — both now carry `rePreConfidence` state (default 5) + confidence slider + `pre_decision_confidence: rePreConfidence` in POST body. Fixes silent gap where only homepage-originated sessions fed the calibration record. 2 files changed, 0 schema changes. KDD 194. — ✅ Implemented June 21, 2026** |
| **Sprint RET-4 — Lever (ii): Free Single-Outcome Calibration Feedback (June 21, 2026)** | **`components/OutcomeTracker.tsx` — new `preDecisionConfidence: number | null` prop; `calibrationNoteCopy()` helper renders one-line calibration note in the existing 'saved' state block. `app/record/[id]/page.tsx` — `session.pre_decision_confidence` threaded in. 2 files changed, 0 schema changes. KDD 193. — ✅ Implemented June 21, 2026** |
| **Sprint TB1 — Codebase Resilience: `server-only` guard, shape-alias fix, vitest scaffold (June 21, 2026)** | **`lib/ai-client.ts` + `lib/encryption.ts` — `server-only` import added as first line. `app/api/persona/route.ts` — `CouncilContext` interface + `EMPTY_COUNCIL_CONTEXT` constant exported (all 7 hand-typed sites unified); `UserBiasContext` import changed to use existing export from `lib/bias-scorer.ts`. `lib/bias-scorer.ts` — `EMPTY_USER_BIAS_CONTEXT` hoisted to exported module constant. vitest scaffold: `vitest.config.ts`, `tests/setup.ts` (mocks `server-only`), `tests/council-context-shape.test.ts` (6 tests), `tests/council-synthesis-chain.test.ts` (9 tests). 15/15 passing. 4 files changed, 4 new, 0 schema changes. KDD 195. — ✅ Implemented June 21, 2026** |
| **Sprint RET-3 — Second-Use Retention: Item A + Item C + Copy Fix (June 20, 2026)** | **`components/BiasNoteCard.tsx` (NEW) — free, server-rendered, session-1-capable bias note on the record page; queries `bias_library` for the current session (identity precedence `user_id`>`user_email`>`device_id`), filters to `signal_type === 'distorting'` only, no `detection_count` threshold (single-session claim, not longitudinal). `app/api/record/[id]/echo-hint/route.ts` (NEW) — calls `scoreStructuralSimilarity()` directly (pure, sync, zero LLM cost), bypassing `retrieveStructuralMatches()` and its `MIN_SESSIONS=5` gate entirely; no write to `structural_matches`; reuses existing `MATCH_THRESHOLD` env var; requires identity (excludes `device_id`-only, by design — reinforces EmailCaptureCard). `components/EarlyEchoCard.tsx` (CHANGED) — at session 3+, fires echo-hint and upgrades the count-only sub-line in place on a qualifying response; silent fallback to original copy otherwise. `lib/session-score.ts` (CHANGED) — Mirror "NEXT MOVE" copy fixed (was ambiguous + factually loose against `MIN_SESSIONS`). "Item B" (homepage bias-aggregate card) explicitly rejected as duplicative of `PatternSurfaceCard` — see KDD 189; deferred alternative (Mirror Patterns-tab placement) logged as TD-4. 2 new files, 3 modified, 0 schema changes, 0 new env vars. KDDs 188–192. — ✅ Implemented June 20, 2026** |
| **Sprint RET-2 — Decision Brief Freemium: SynthesisCard Gate Removal (June 20, 2026)** | **Follow-up fix: `components/SynthesisCard.tsx`'s in-session "Generate Decision Brief" button still showed the old paid-access-code flow after RET-1 had only freed the record-page surface (`BriefCTA.tsx`). Removed `BRIEF_KEY` localStorage helpers, 6 dead state vars, the mount-time stored-code `useEffect`, `handleValidateCode()`/`checkBriefAccess()`, the 5-state gate button block, and the full paid-feature gate panel. `token:` field removed from the synthesis API payload (confirmed `persona/route.ts` never read it). Replaced with a single always-visible "Generate Decision Brief" button. 1 file changed, 0 schema changes. Consolidated rationale in KDD 187 (covers both RET-1 and RET-2 surfaces). — ✅ Implemented June 20, 2026** |
| **Sprint RET-1 — Second-Use Retention: Decision Brief Freemium + Early Retention Cards (June 20, 2026)** | **First of three retention sprints (see SECOND-USE RETENTION STRATEGY section for full audit). (1) Brief freemium: `app/api/record/[id]/brief/route.ts` — `BRIEF_ACCESS_TOKEN` gate removed from GET handler; single dark palette split into `DARK_PALETTE`/`LIGHT_PALETTE` + `PERSONA_ACCENT_DARK`/`PERSONA_ACCENT_LIGHT` (new `Palette` type, ~60 existing call sites unaffected via lexical scoping); `buildPdf()` gains `theme` param; `?theme=light\|dark` query param wired through. `components/BriefCTA.tsx` — rewritten: token/access-code state removed, Dark/Light pill toggle + direct `Download PDF →` added. `/api/brief-access` now dead code (flagged for deletion). (2) Retention cards: `components/EmailCaptureCard.tsx` (NEW) — decision-framed email capture on the record page, calls existing `/api/auth`. `components/EarlyEchoCard.tsx` (NEW, count-only) — session-count signal at counts 2–4, hidden at 0–1/5+. `app/record/[id]/page.tsx` — both wired in below BriefCTA. 5 files changed/new, 0 schema changes, 0 new env vars. KDD 187 (covers RET-1+RET-2). — ✅ Implemented June 20, 2026** |
| **Sprint CX-PAY — Razorpay Self-Serve Payment + Cancellation (June 16, 2026)** | **Self-serve Mirror subscription flow, replacing manual unlock-code-and-bank-transfer for new conversions. `create-subscription/route.ts` rewritten — Bearer user auth (was `PAYMENT_WEBHOOK_SECRET`-gated), creates Razorpay Subscription with `notes.user_id`/`notes.plan` for webhook identity resolution. `webhook/route.ts` (NEW) — HMAC-SHA256 verified, handles `subscription.activated` (upsert `mirror_access`), `payment.captured` (renewal, extends `expires_at`), `subscription.cancelled`/`.expired` (no-op — `expires_at` gates naturally). `expires_at` buffer: +33d monthly / +368d annual. `components/PaymentButton.tsx` (NEW) — checkout.js loader, gold+navy themed modal, Quorum icon. TeaserView CTA: `PRICING_URL` link → two inline PaymentButton instances. `cancel-subscription/route.ts` (NEW) — cancel-at-cycle-end via Razorpay, guards advisory tier + code-activated rows. `components/CancelSubscription.tsx` (NEW) — idle/confirming/done/error states, gated `tier === 'mirror'`. Infra fixes: `nixpacks.toml` (NEW, overrides `npm ci` → `npm install` — Ken's laptop blocked from local Node install) + 5 CSP/Permissions-Policy patches in `next.config.ts` for Razorpay domains. Confirmed working end-to-end including cancellation. KYC pending — running on test keys, swap to live is one env var. 4 new files, 1 rewritten, 2 modified, 1 new config file, 5 new env vars, 0 schema changes. KDDs 182–186. — ✅ Implemented + spot-tested June 16, 2026, awaiting KYC for live keys** |
| **Sprint CX1 — TeaserView Conversion Fix (June 15, 2026)** | **Three targeted UX fixes in `app/mirror/page.tsx` resolving founding-user (Shivani) observation that the "building" badge was ambiguous between loading-state and paywall. `lockedBadge`: text/colour changed `"building"` (grey) → `"Mirror"` (gold) + lock icon + onClick scroll-to-CTA. CTA card: headline → "Unlocks these sections:" + explicit feature list (Bias Fingerprint, Independence Score, Contradiction Detector, Confidence Calibration); `UnlockCodeInput` promoted above the plans link; `id="mirror-cta"` scroll anchor added. Zero-bias copy: "being compiled" → "No patterns confirmed yet... activate Mirror to track them as they build." 1 file changed, 0 schema changes. KDDs 180–181. Note: CTA's external plans link subsequently replaced by inline PaymentButton in Sprint CX-PAY (June 16). — ✅ Implemented June 15, 2026** |
| **Mirror Tiering Sprint — Phases 1, 2, 4, 5 (June 13, 2026)** | **Two-tier Mirror: self-serve Mirror (₹3,999/mo · ₹39,999/yr) + founder-led Mirror Advisory (access_type='advisory', capped at 5). Phase 1: pricing copy in app/mirror/page.tsx + website index.html (price card, billing toggle JS, modal). Phase 2: 'lifetime' plan retired from SubscriptionPlan, admin grant validTypes, payment validPlans, /api/mirror/unlock tokenMap (MIRROR_TOKEN_LIFETIME + legacy MIRROR_UNLOCK_TOKEN removed); getMirrorAccessState() keeps defensive lifetime handling. Phase 4: new MirrorTier type, getMirrorTier() helper (additive, lib/mirror-access.ts), MirrorStatus.tier resolved in /api/mirror/status. Phase 5: lib/mirror-tier-config.ts (NEW — ADVISORY_UPSELL_COPY manifest) + components/AdvisoryUpsellCard.tsx (NEW); BenchmarkModule (Advisory-only), ContradictionDetector (Advisory bypasses 40-session threshold + full detail; Mirror gets new ContradictionSummaryView — count + category grouping via CATEGORY_LABELS, ends with upsell), SessionReliabilityIndex ("Your next move" Advisory-only), DecisionRules + /api/mirror/rules (Advisory bypasses 8-session threshold server-side). 2 new files, 8 modified, 0 schema changes, 2 env vars retired (not yet removed from Railway — safe to do anytime). KDDs 171–175. Full diff table + grant/test instructions: see MIRROR vs MIRROR ADVISORY section. — ✅ Implemented June 13, 2026, not yet tested on staging** |
| **Sprint S0 — Subject Orientation + Examiner Redesign (June 12, 2026)** | **Examiner GET handler redesigned. (1) S0 (Subject Orientation) question added — new conditional question type that fires when `decisionWordCount < 25 AND !hasContext`. Elicits domain context about the decision subject that a thin brief cannot supply (e.g. "Should I sell MedML?" gives the Council nothing about what MedML is). Stored with rule_id = 'S0' in examiner_responses — feeds synthesis automatically via existing examiner response pipeline, available for future longitudinal context accumulation. S0 suppressed on REDIRECT mode (same as C0). (2) Max questions reduced from 4 to 3. Rule slot budget: `ruleSlotBudget = shouldAddS0 ? 1 : 2`. C0 always retained. (3) S0_TEMPLATES + C0_TEMPLATES arrays (5 variants each) replace single-template constants. pickTemplate() utility selects deterministically per sessionId via character-code hash-mod — consistent on re-render, varied across sessions. S0 templates are purely informational (what is this, current state, trigger); C0 variants probe success definition from 5 different vantages. (4) All personalisation calls now parallel — single Promise.all covers rule questions + S0 + C0 concurrently (no sequential deps). S0 does not receive biasHint (domain-context question, not diagnostic probe). (5) context_text added to session SELECT (needed for S0 trigger). (6) Early-exit guard updated: only exits when allRules.length === 0 AND !shouldAddS0. (7) ExaminerPanel.tsx: tagline changed from "Three questions the council couldn't answer without you" to "Key questions the council couldn't answer without you". BRIEF badge added for S0 questions (green visual register, same as CONTEXT/C0). S0 hint added to RULE_HINTS. 2 files changed (route.ts, ExaminerPanel.tsx), 0 schema changes, 0 new env vars. KDDs 163–170. — ✅ Implemented June 12, 2026** |
| **Engagement Pull Sprint — Features 5 & 6 (June 11, 2026)** | **Two features. (1) CalibrationRevealCard (Feature 6): components/CalibrationRevealCard.tsx (NEW) — renders on home screen for mirrorUnlocked users when summary.dataReady = true (≥3 paired outcomes). Fetches /api/mirror/calibration (existing route). Shows: avg_delta with color + meaning sub-label, summary.pattern italic quote (the insight the user didn't know existed), avg_pre + avg_retro supporting numbers, trend badge (improving/declining/stable), "View calibration record →" link to /mirror#msec-calibration (targets msec-calibration element ID — IntersectionObserver in MirrorNav auto-activates Calibration pill on scroll). Spacing: marginBottom: 20. app/page.tsx (CHANGED): CalibrationRevealCard import + Chunk 4b render block between PatternSurfaceCard and RecurringConditionCard, gated on mirrorUnlocked. (2) mirror-insight-email cron (Feature 5): app/api/cron/mirror-insight-email/route.ts (NEW) — weekly POST endpoint (Bearer CRON_SECRET). Targets teaser users only (getMirrorAccessState = 'teaser'). Queries bias_library for top 3 bias keys; maps to label + first-sentence definition via BIAS_PARAMETERS from lib/bias-scorer.ts. Sends Resend email where the bias blocks ARE the content. Subject: "Your Mirror detected N pattern(s) in your record". 7-day cooldown via mirror_insight_email_log table (separate from email_send_log — per-user not per-session-milestone). supabase/sprint_mirror_insight_email.sql (NEW) — mirror_insight_email_log table (user_id FK, sent_at, RLS enabled). cron-job.org: new job added — Mondays 04:00 UTC, same POST + Bearer header pattern as existing avoidance-detect and reanalyze-email jobs. (3) MirrorOpenLoopCard bugfix: patternCount fallback to teaserBiases.length when rule engine returns 0. 2 new files, 1 modified, 1 SQL migration. — ✅ Implemented June 11, 2026** |
| **Engagement + PWA Sprint (June 11, 2026)** | **Three threads: (1) Reanalyze Email Cadence — app/api/cron/reanalyze-email/route.ts (NEW): daily cron (Bearer CRON_SECRET, same pattern as avoidance-detect), checks sessions at 7/14/30-day milestones (±12h window) with no outcome logged and no prior send (email_send_log table, NEW — supabase/sprint_reanalyze_email.sql, unique constraint on session_id+email_type prevents double-sends). Sends minimal Resend email — decrypted decision snippet in subject ("...— 14 days later"), confidence score, single "Log what happened →" CTA, no branding noise. Also fires sendPushToUser() (non-blocking) for the same nudge. (2) MirrorOpenLoopCard.tsx (NEW) — home-screen open-loop teaser for non-unlocked users: 1–2 sessions shows "N more decisions to confirm your first pattern"; 3+ sessions (teaser-eligible) shows gold-bordered "X patterns forming" card with blurred bias labels + "Open your Mirror →". Renders nothing for mirrorUnlocked users (PatternSurfaceCard already covers them) or sessionCount=0. Wired into app/page.tsx between RecurringConditionCard and MemoryEngineStatus. Bugfix (June 11, 2026): patternCount now falls back to teaserBiases.length when sessions_ontology.rule_engine_result returns 0 patterns — bias_library (teaserBiases) and rule_engine_result are separate detection systems. Mirror page shows bias_library patterns; card was returning null when rule engine had 0 fired rules even though bias_library had detections. (3) PWA — public/manifest.json (NEW, standalone display, dark theme, icon-192/512), public/sw.js (NEW, push + notificationclick handlers only — no caching, since Quorum is dynamic/auth-gated), supabase/sprint_pwa_push.sql (NEW) — push_subscriptions table (endpoint unique, RLS user-scoped), app/api/push/subscribe/route.ts (NEW) — Bearer-auth upsert of subscription, lib/push.ts (NEW) — sendPushToUser() via web-push + VAPID, prunes 410/404 subscriptions automatically, components/PushEnablePrompt.tsx (NEW) — dismissible opt-in card; iOS detection shows "Add to Home Screen" tip when not in standalone mode (iOS push requires standalone); Android/Desktop shows Enable button → SW register → permission → pushManager.subscribe → POST /api/push/subscribe. app/layout.tsx (CHANGED) — manifest link, theme-color, apple-mobile-web-app-* meta, apple-touch-icon. next.config.ts (CHANGED) — worker-src 'self' added to CSP, /sw.js served with no-cache + Service-Worker-Allowed:/ headers. New icons (icon-192.png, icon-512.png — gold "Q" lettermark on dark bg) generated and deployed. New env vars: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (one-time `npx web-push generate-vapid-keys`), RESEND_API_KEY, FROM_EMAIL. Build fix: PushEnablePrompt urlBase64ToUint8Array return type changed to `Uint8Array<ArrayBuffer>` with explicit `new ArrayBuffer(...)` allocation — TS5 strict generic mismatch on pushManager.subscribe(). (4) Update-Check Banner — app/api/version/route.ts (NEW) — returns RAILWAY_GIT_COMMIT_SHA (fallback RAILWAY_DEPLOYMENT_ID, fallback Date.now() at module load), no-store. components/UpdateBanner.tsx (NEW) — records baseline version on mount, polls every 5 min + on visibilitychange/focus; if server version changes, shows fixed top banner "A new version of Quorum is available. [Refresh]" → window.location.reload(). Non-intrusive — never auto-reloads. Wired into app/layout.tsx as first child of body. (5) FROM_EMAIL fix — root cause of reanalyze emails showing sender "AUTH": Railway FROM_EMAIL was a bare address (auth@quorumvault.org) with no display name, so Gmail falls back to showing the local-part. Code safety net added in reanalyze-email/route.ts: `from = rawFrom.includes('<') ? rawFrom : \`Quorum <${rawFrom}>\``. Railway env var also needs updating to `Quorum <auth@quorumvault.org>` (config change, separate from code fix). 9 new files, 5 modified, 2 SQL migrations. — ✅ Implemented June 11, 2026 (PWA + push verified on real device; reanalyze cron + version banner pending first live deploy check)** |
| **Mirror UX Sprints M1–M6 (June 8–9, 2026)** | **Full Mirror page overhaul across 6 sprints addressing 3rd-decision retention and 50th-decision stickiness. Mirror UX audit (21 recommendations, P0–P3 priority matrix) preceded implementation. Sprint M3 (Unlock Moment): WelcomeMirrorCard one-time orientation card (localStorage quorum_mirror_welcomed), ThresholdGate reframed as milestone countdown with personalised topBiasLabel teaser (teaserBiases now also populated for unlocked users in status route), ContradictionDetector MILESTONES[0] "Building the map". Sprint M1 (Living Digest): MirrorSummaryCard above-fold 4-stat digest, /api/mirror/summary route (decrypted examiner quote, since-last-visit delta, side-effects last_mirror_viewed_at). Sprint M2+M4 (Navigation + Freshness): MirrorNav sticky section nav (8 anchors, IntersectionObserver, mobile auto-scroll + 36px touch targets), SectionWrapper helper (collapse/desc-hide localStorage-backed, type-coloured borders, secFadeIn stagger), conditional ordering (MJR near top when loops>0, Timeline near top early users), lastFiredAt batch fetch in mirror-fingerprint.ts, "Active" badge on bias tiles, "↑ Increasing" badge on patterns, "Latest" badge on SRI first row, dismissed/active ratio in Contradiction Detector. Sprint M5+M6 (Attention Zone + Intelligence): AttentionZone (0–3 dynamic cards between SummaryCard and MirrorNav, no extra fetch, dismissible per session), MirrorInsightCard (deterministic 7-rule cross-module synthesis, no LLM, renders above Bias Fingerprint), latestSessionMode from sessions_ontology drives module prominence (REDIRECT→independence, GATE→contradictions) with secPulse animation and MirrorNav dot badge. 4 new bugfixes included (see below). DB migration: ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ. 5 new components/files, 15+ modified files. — ✅ Implemented June 8–9, 2026** |
| **Mirror bugfixes (June 8, 2026)** | **4 bugs fixed post M1/M3 deploy: (1) Encrypted outcome.what_decided in record/[id] page.tsx OutcomeTracker "What did you decide?" field — fixed by decryptText(outcome.what_decided) before passing to component. (2) MemoryEngineStatus "Pattern Memory active" showing at 4 sessions (mirrorUnlocked && mirrorTeaserReady fired at sessionCount ≥ 3) — fixed by patternActive guard (sessionCount ≥ 5 required). (3) MirrorSummaryCard examiner quote displaying enc:... text — fixed by decrypt() in summary route. (4) MonthlyJudgmentReview open loops list had no pagination — fixed by LoopsList component with show-more at LOOPS_PREVIEW = 5. — ✅ Implemented June 8, 2026** |
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
| **Fix 1 (June 2, 2026)** | **Light mode button visibility — end-to-end audit + token system. Root cause: 3 classes of hardcoded dark-mode-only values: (A) ghost-white backgrounds rgba(255,255,255,0.04/0.08) invisible on light cream; (B) pastel accent text (#93c5fd, #60a5fa, rgba(74,222,128,0.9), #4ade80) unreadable on #f4f1eb; (C) low-alpha blue containers rgba(96,165,250,0.07) with no visible border on light bg. Fix: 8 new semantic CSS tokens added to both :root (dark) and [data-theme="light"] blocks in globals.css — --info-text, --info-bg, --info-border, --success-text, --success-bg, --success-border, --overlay-bg, --overlay-bg-hover. Dark values = exact prior hardcodes (zero dark-mode regression). Light values = ink blue (#1a52a8), forest green (#1a7a3a), dark-tinted overlays (rgba(0,0,0,0.04)). 9 component files updated: PersonaPanel.tsx ("Share this context with all advisors" button bg/border/text, examiner update box, "Updating" badge, "Responded"/"✓" badge), SynthesisCard.tsx ("This doesn't apply — continue to Council" ghost button + hover, clarification mode badge, "✓ Complete"), CouncilStatusBar.tsx (phase badge non-synthesis bg), OutcomeTracker.tsx (quality-option ghost bg, helpedOptions bg now --outcome-* CSS vars, text #fff → var(--text-1) in both form and saved-state), ReanalyzeDrawer.tsx (clarification mode selected border/bg/text), ExaminerPanel.tsx (CONTEXT badge color/border/bg), AuthPanel.tsx (linked-sessions success box bg/border/dot), IndependenceScore.tsx (positive delta text), app/mirror/page.tsx (● Active badge). Two intentional non-fixes: CalibrationSparkline.tsx (SVG fill= attrs — CSS vars unsupported in SVG presentation attributes), SessionView.tsx (already had [data-theme="light"] override in same file for this path). — ✅ Implemented June 2, 2026** |
| **Fix 2 (June 2, 2026)** | **Supabase Magic Link email via Resend — SMTP relay + branded template. Resend domain quorumvault.org verified (SPF/DKIM/DMARC). Supabase Auth SMTP configured (smtp.resend.com:465, username: resend, password: Resend API key). Branded HTML Magic Link template live in Supabase Auth → Email Templates. Template variable: {{ .ConfirmationURL }}. — ✅ Implemented June 2, 2026** |
| **Security & Disclosure Sprint (June 7, 2026)** | **VDP, key rotation, IST migration. public/.well-known/security.txt (NEW) — RFC 9116 vulnerability disclosure policy; served by Next.js static pipeline. scripts/rotate-encryption-key.ts (NEW) — manual AES-256-GCM key rotation utility; covers all 5 encrypted tables + JSONB column; 6-step runbook in file header; not a cron (KDD 146). app/security/page.tsx (CHANGED) — 'Encryption key rotation tooling' + 'Vulnerability disclosure programme' moved from NOT_YET to IMPLEMENTED; NOT_YET reduced 6→5. components/RecordExport.tsx (CHANGED) — imports formatLongDate() from lib/dates.ts; inline Asia/Kolkata removed. components/CalibrationSparkline.tsx (CHANGED) — imports formatShortDate() from lib/dates.ts; local formatDate() function removed; 4 call-sites updated. admin/encrypt-migrate/route.ts (DELETED). 2 new files, 5 modified, 1 deleted. — ✅ June 7, 2026** |
| **Sprint B + ontology-tagger confirmed deployed — code audit (June 7, 2026)** | **All 9 call-site provider patches confirmed in codebase. persona/route.ts (synthesis→anthropic, others→deepseek), examiner/route.ts (personalise→deepseek, gap→anthropic), mirror/rules/route.ts (→anthropic), record/[id]/brief/route.ts (→deepseek), voice/cleanup/route.ts (→deepseek), lib/bias-scorer.ts (→anthropic), lib/structural-retrieval.ts (→anthropic), lib/mirror-fingerprint.ts (→deepseek), lib/contradiction-detector.ts (×2 passes →anthropic). ontology-tagger.ts: direct SDK instances confirmed removed, routes via ai-client with provider: 'anthropic' + temperature: 0.1. All ⏳ markers resolved. — ✅ Confirmed June 7, 2026** |
| **SQL migrations confirmed run (June 7, 2026)** | **sprint4_rls_hardening.sql, sprint5_bias_library_user_id.sql, sprint6_audit_log.sql all executed in Supabase. RLS policies active, bias_library user_id FK live, audit_log table exists. — ✅ Confirmed June 7, 2026** |
| **Privacy & Security Sprint Plan — Sprint 6 (June 6, 2026)** | **Audit log + data export + account deletion + admin lockout + audit log viewer. supabase/sprint6_audit_log.sql (NEW) — audit_log table (write-once, service-role only, 0 RLS policies). lib/audit.ts (NEW) — writeAuditLog(), getAuditContext(), getUserFromBearer(). app/api/account/export/route.ts (NEW) — GET /api/account/export: Bearer auth, 1 export/24h rate limit (in-memory), fetches+decrypts all sessions/messages/examiner_responses/bias_library, returns JSON download. app/api/account/route.ts (NEW) — DELETE /api/account: Bearer auth, audit log written first, explicit deletes for email-keyed tables (bias_library, contradiction_log), then supabase.auth.admin.deleteUser() for cascade. app/api/admin/audit-log/route.ts (NEW) — GET /api/admin/audit-log: ADMIN_CODE auth, last 100 entries. app/api/admin/dashboard/route.ts (CHANGED) — S6-04: in-memory IP lockout (5 failures → 15 min block). Writes admin.access, admin.auth_failed, admin.locked_out to audit_log. app/api/auth/route.ts (CHANGED) — S6-01: writes auth.magic_link_sent to audit_log after successful OTP send. app/settings/privacy/page.tsx (CHANGED) — S6-02+S6-03: real handleExport() (fetches /api/account/export, triggers browser download) + real handleDeleteRequest() (DELETE /api/account → signOut → redirect home). Both get Supabase Bearer token from getSession(). app/admin/page.tsx (CHANGED) — S6-05: AuditLogEntry type, auditLog state, parallel fetch /api/admin/audit-log, new Audit Log section at top of dashboard with colour-coded action column. — ✅ Implemented June 6, 2026** |
| **Privacy & Security Sprint Plan — Sprint 5 (June 6, 2026)** | **Rate limiting + encryption fail-closed + internal route auth + bias_library user_id. lib/rate-limit.ts (NEW) — in-memory sliding-window rate limiter; LIMITS config; tooManyRequests() with layman message + resetAt; 15-min GC. components/RateLimitBanner.tsx (NEW) — 429 banner with live countdown; parseRateLimit() utility. lib/encryption.ts (CHANGED) — S5-02: production startup CRITICAL log + encrypt() throws in production without key (fail-closed). app/api/auth/route.ts (CHANGED) — S5-01: 5/15min rate limit. app/api/session/route.ts (CHANGED) — S5-01: 20/15min rate limit. app/api/persona/route.ts (CHANGED) — S5-01: 60/10min rate limit. app/api/examiner/route.ts (CHANGED) — S5-01: 40/10min rate limit; INTERNAL_API_SECRET header added to fireBiasScore() call. app/api/voice/tts/route.ts (CHANGED) — S5-01: 80/10min rate limit. app/api/ontology/route.ts (CHANGED) — S5-03: x-internal-secret check (403 if INTERNAL_API_SECRET set and header missing). app/api/bias-score/route.ts (CHANGED) — S5-03: same internal auth check. components/PersonaPanel.tsx (CHANGED) — 429 handling via parseRateLimit() + RateLimitBanner rendered at top of persona card. supabase/sprint5_bias_library_user_id.sql (NEW) — adds user_id uuid FK to bias_library, partial unique index, updated RLS policy (uuid OR email). Build fix: import alignment issue in persona/route.ts + session/route.ts + examiner/route.ts — rate-limit import lines needed manual addition (spacing mismatch in Python patcher). — ✅ Implemented June 6, 2026** |
| **Privacy & Security Sprint Plan — Sprint 4 (June 6, 2026)** | **Backend critical security fixes. supabase/sprint4_rls_hardening.sql (NEW) — drops using(true) on 4 tables, adds user-scoped policies: sessions_ontology (join→sessions.user_id), examiner_responses (join→sessions.user_id), bias_library (auth.jwt()->>email), contradiction_log (email OR session ownership). app/api/session/route.ts (CHANGED) — S4-02: user_id derived server-side from Bearer token via anonClient.auth.getUser(token); body user_id field ignored. app/page.tsx (CHANGED) — S4-02: sends Authorization: Bearer token instead of user_id in body. app/api/payment/create-subscription/route.ts (CHANGED) — S4-03: checks PAYMENT_WEBHOOK_SECRET instead of SUPABASE_SERVICE_ROLE_KEY (master key never sent over HTTP). .env.example (CHANGED) — S4-04: all missing vars added with generation commands: ADMIN_CODE, CRON_SECRET, DB_ENCRYPTION_KEY, PAYMENT_WEBHOOK_SECRET, INTERNAL_API_SECRET, BRIEF_ACCESS_TOKEN, MIRROR_TOKEN_*, SONIOX_API_KEY. AI_PROVIDER default changed from deepseek to anthropic. next.config.ts (CHANGED) — S4-05: 6 security headers added: CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy. — ✅ Implemented June 6, 2026** |
| **Privacy & Security Sprint Plan — Sprint 3 (June 5–6, 2026)** | **Legal pages + settings. app/privacy/page.tsx (NEW) — full Privacy Policy (GDPR+DPDP). app/terms/page.tsx (NEW) — Terms of Service with AI disclaimer highlight box. app/cookies/page.tsx (NEW) — Cookie Policy with localStorage registry cards. app/security/page.tsx (NEW) — Security & Trust, only provable claims, honest not-yet section. app/settings/privacy/page.tsx (NEW) — Privacy Center: consent toggles, export stub (→S6-02), delete stub (→S6-03), legal links. app/settings/security/page.tsx (NEW) — Security Center: session info, sign-out device/all (supabase.auth.signOut({scope: 'global'})). All footer links from S2 now resolve. No email addresses anywhere. — ✅ Implemented June 5–6, 2026** |
| **Privacy & Security Sprint Plan — Sprint 2 (June 5, 2026)** | **User-facing app fixes. components/CookieConsent.tsx (NEW) — client component: bottom banner (900ms delay), Accept All/Reject/Manage Preferences modal; writes quorum_cookie_consent. components/AppFooter.tsx (NEW) — legal footer: Privacy Policy · Cookie Policy · Terms · Security & Trust · © 2026 Quorum; added to layout.tsx. components/TrustBadgeStrip.tsx (NEW) — used on record/[id]: 3 badges (encrypted/visible only to you/AI). app/layout.tsx (CHANGED) — imports CookieConsent + AppFooter. lib/storage.ts (CHANGED) — hasFunctionalConsent() added; getOrCreateDeviceId() and pushSessionId() gated behind functional consent check (quorum_cookie_consent.functional). components/AuthPanel.tsx (CHANGED) — terms acknowledgement text below email field. components/SessionView.tsx (CHANGED) — encryptionEnabled prop; privacy notice updated: shows encrypted-at-rest when DB key set; AI disclosure line added ("Analysed by AI · not used for model training"). app/session/[id]/page.tsx (CHANGED) — passes encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY} to SessionView. app/record/[id]/page.tsx (CHANGED) — TrustBadgeStrip added. — ✅ Implemented June 5, 2026** |
| **Privacy & Security Sprint Plan — Sprint 1 (June 5, 2026)** | **Website user-facing fixes. index.html (CHANGED) — cookie consent banner (bottom, slide animation), privacy consent checkbox on Step 3 of request form (disables Submit until checked), hardcoded Supabase credentials removed (replaced with /api/waitlist proxy call), footer legal links added (Privacy Policy · Cookie Policy · Terms · Security & Trust · © 2026 Quorum). server.js (NEW) — Express server for website Railway project: serves index.html + /api/waitlist (Supabase insert, SUPABASE_URL + SUPABASE_SERVICE_KEY env vars). Legal page stubs initially, replaced with full HTML in S3. package.json, railway.toml, env.example for website project. — ✅ Implemented June 5, 2026** |
| **Security Sprint (June 2, 2026)** | **Application-level AES-256-GCM field encryption. lib/encryption.ts (NEW) — encrypt(), decrypt(), encryptJson(), decryptJson(). All raw user input encrypted at rest: sessions.decision_text/context_text, messages.content, examiner_responses.question_text/response_text, outcomes.what_decided/notes, structural_matches.context_block + matches_json (JSONB as {_enc}). Derived tables (ontology scores, bias scores, enums) unchanged and visible. 21 files patched: 5 write paths encrypt before DB insert; 16 read paths decrypt after DB fetch. app/api/admin/encrypt-migrate/route.ts (NEW) — one-shot backfill endpoint called once, then deleted. scripts/test-encryption.ts (NEW) — integration test covering write→encrypted, read→decrypted, backward compat. Backfill run June 2, 2026. SQL audit confirmed: 0 plaintext rows across all 5 tables. DB_ENCRYPTION_KEY added to Railway env vars. — ✅ Deployed June 2, 2026** | — SMTP relay + branded template. Problem: Supabase default SMTP sends unbranded plain emails, high spam rate, no template control. Fix: (1) Resend account created, domain quorumvault.org verified (3 DNS records — SPF, DKIM, DMARC). (2) Supabase Project Settings → Authentication → SMTP → Enable Custom SMTP: host smtp.resend.com, port 465, username resend, password = Resend API key (re_xxxx), sender name "Quorum", sender email auth@quorumvault.org. (3) Supabase Auth → Email Templates → Magic Link: replaced default template with branded HTML. Template anatomy: dark navy header (#08111f) + 3px gold bottom border + Quorum wordmark (img hosted on Railway); overline "Secure sign-in" in gold (#9c7628); serif h1 "Sign in to Quorum"; body copy — "Your private decision workspace is ready" + continuity value prop (cross-device, connect prior sessions, judgment record, pattern history, memory layer); CTA "Open Quorum" — dark navy #0b1f3a button; gold-accent callout card (4px left border, #faf3e5 bg, #ead8b8 border) — "Private judgment infrastructure" one-liner and Quorum value prop paragraph; plain-text fallback URL block; cream footer (#f3ead8) with "Quorum" label + tagline. Template variable: {{ .ConfirmationURL }} used in button href and fallback link. — ✅ Implemented June 2, 2026** |
| **Chunk 2 — Monthly Judgment Review (June 4, 2026)** | **Loop Closure Mirror module. app/api/mirror/monthly-review/route.ts (NEW) — auth + mirror-access gate (matches all other Mirror routes). Window logic: last 30 days if ≥10 total sessions, all-time fallback otherwise (useful from day 1). Five queries: session count (window decision), sessions in window (with commitment_review_date + rule_recall_choice), outcomes (loop closure count), bias_library confirmed patterns count. Open loop definition: (a) commitment_review_date set and < today OR (b) session > 14 days old with no outcome and no review date. Sorted: past-due review dates first (by days_overdue desc), then unclosed by age. All decision_text decrypted before truncation to 80 chars. SessionRow interface typed to eliminate implicit any. components/MonthlyJudgmentReview.tsx (NEW) — self-fetching Mirror module (receives authToken only). 4 metric tiles: decisions recorded, loops closed % (gold ≥60%, neutral 30–59%, red <30%), rules applied, patterns confirmed. Open loops list: clickable rows linking to session, days-overdue badge in red if past review date. Returns null silently when decisions_total = 0. app/mirror/page.tsx (CHANGED) — imports + renders MonthlyJudgmentReview after SessionReliabilityIndex with divider. DEPLOYMENT FIX: MonthlyReviewData + OpenLoop interfaces originally imported from API route file — caused Next.js build error ("Cannot find module"). Fixed by inlining both interfaces directly in the component (types defined in component, not imported from route). — ✅ Implemented + deployed June 4, 2026** |
| **Chunk 1 — Rule Recall Timing + Injection Fix (June 4, 2026)** | **Two bugs found post-deploy via live testing. Bug 1 (timing): RuleRecallBanner fired after examiner submission — Council was already streaming by then, making the user's choice irrelevant. Fix: visible prop changed from `examinerSubmitted && !redirectBlocked` to `ontologyReady && !examinerSubmitted && !redirectBlocked`. Banner now appears alongside examiner questions — user makes choice BEFORE submitting. Auto-dismiss added via useEffect watching visible: when visible flips false (examiner submitted without a choice), banner dismisses cleanly with no DB write and no injection. Bug 2 (no synthesis injection): "Apply this rule" saved to DB but nothing read it. Fix: onRuleApplied prop added to RuleRecallBanner — fires synchronously before async PATCH. SessionView: appliedRuleRef (useRef) stores the applied rule text. handleExaminerComplete: reads appliedRuleRef.current, builds appliedRuleBlock, prepends to both synthExaminerContext (feeds synthesis) and every persona's initialExaminerContext (feeds all 6 Council members). Rule comes before C0 block so it frames the C0 answer. components/RuleRecallBanner.tsx (CHANGED), components/SessionView.tsx (CHANGED). — ✅ Implemented + deployed June 4, 2026** |
| **Chunk 1 — Decision State + Switch Conditions + Rule Recall (June 4, 2026)** | **Full in-session commitment capture + rule surfacing. supabase/sprint_chunk1_commitment.sql (NEW) — 6 columns on sessions (commitment_leaning, commitment_switch, commitment_review_date, commitment_captured_at, rule_recall_choice, rule_recall_rule_text). components/DecisionStateCard.tsx (NEW) — post-synthesis form: 3 clubbed fields (leaning + next move; what would change course; review date with +1 week/+2 weeks/+1 month shortcuts). State machine: prompt → form → saved. Skippable. Encrypted on save; decrypted for saved-state display. components/RuleRecallBanner.tsx (NEW) — fires when ontologyReady + !examinerSubmitted; fetches /api/mirror/rules (Bearer auth); silently absent below rules threshold or if unauthenticated; shows first rule with Apply / Note as exception / Dismiss; PATCH to /api/session/commitment on choice. app/api/session/commitment/route.ts (NEW) — POST (encrypt + upsert commitment fields), PATCH (save rule_recall_choice + encrypted rule_recall_rule_text), GET (decrypt + return commitment if captured_at set). lib/types.ts (CHANGED) — Session interface extended with 6 new optional fields. app/api/session/route.ts (CHANGED) — GET decrypts commitment_leaning, commitment_switch, rule_recall_rule_text. components/SessionView.tsx (CHANGED) — imports both components; DecisionStateCard renders after ContradictionBanner when synthesisDone; RuleRecallBanner renders before ExaminerPanel. — ✅ Implemented June 4, 2026** |
| **Hybrid Routing Sprint (June 3, 2026)** | **AI provider hybrid routing. Full inventory of all 15 AI calls across codebase. Routing: Claude for 8 structured/JSON calls (synthesis, ontology tagger, bias scorer, contradiction detector ×2, gap questions, rules extraction, structural annotation); DeepSeek for 7 generative/prose calls (persona ×6, pushbacks, decision_brief persona, personalise question, brief auto-gen, voice cleanup, mirror fingerprint). lib/ai-client.ts fully rewritten: GLOBAL_PROVIDER, resolveProvider() single helper, CompletionOptions interface (provider/systemPrompt/temperature), createStream + createCompletion per-call provider override, ROUTING_MODE env var (hybrid default / deepseek_only override), independent ANTHROPIC_MODEL + DEEPSEEK_MODEL env vars, extended getProviderInfo(), console logging on all calls. Sprint A (ai-client.ts) deployed. Sprint B: 9 call-site patches ready (persona, examiner ×2, mirror/rules, brief, voice/cleanup, bias-scorer, contradiction-detector ×2, mirror-fingerprint, structural-retrieval). ontology-tagger.ts migration patch ready (removes direct SDK instances, routes via ai-client with provider: 'anthropic' + temperature: 0.1 hardcoded). Patch files: ai-client.ts (full), ontology-tagger.PATCH.txt, sprint-b-ALL_PATCHES.txt. — ✅ Sprint A deployed; Sprint B + ontology-tagger patch pending** |
| **Sprint R_JC (June 2, 2026)** | **userJudgmentContext() completion — three missing longitudinal pieces. lib/bias-scorer.ts (CHANGED): `fetchUserPrinciplesBlock()` (private) — queries `examiner_responses` for C0 JTBD answers from last 5 sessions; `decrypt()` applied (stored encrypted at rest); gate ≥3 responses. `fetchRecurringRegretBlock()` (private) — fetches `worse_than_expected` outcomes + `sessions_ontology` vectors; flags recurring regret if ≥2 bad-outcome sessions share ≥2 high-score dims (score ≥4) with current session; `REGRET_DIM_LABELS` maps internal keys to plain English. `fetchExaminerBiasHint()` (exported) — queries `bias_library` for top 2 confirmed biases (detection_count ≥3); returns compact hint string. `fetchUserBiasContext()` restructured: 2-round parallel design — round 1: bias_library + calibration + contradictions + session IDs (4-way `Promise.all`); round 2: principles + regret (2-way `Promise.all` sharing session IDs). `principlesBlock` + `regretBlock` appended to `longitudinalContext`. `principlesDirective` + `regretDirective` appended to MANDATORY directive. `import { decrypt }` added. app/api/examiner/route.ts (CHANGED): imports `fetchExaminerBiasHint`. sessions query extended to include `user_id`. `biasHint` fetched after initial parallel queries (~50ms, non-blocking). `PERSONALISE_PROMPT` accepts optional `biasHint`. `personaliseRuleQuestion()` signature updated with `biasHint?` param. `biasHint` passed to all personalisation calls (C0 + all rule questions). Zero schema changes. — ✅ Implemented June 2, 2026** |
| **C0 fix** | **Examiner route: C0 (JTBD anchor — "what would this decision have to deliver for you to feel it was genuinely the right call?") now fires on every decision regardless of rule count. Single condition removed from shouldAddC0 guard. REDIRECT suppression retained. Max question count on complex decisions: 3 rules → 4 questions. — ✅ Implemented May 31, 2026** |
| **R3** | **Council Weighting Directive: lib/persona-relevance.ts (NEW) — computePersonaRelevance() + buildRelevanceBlock(). Scores all 6 advisors via RULE_PERSONA_BOOSTS (11 rules) + DIM_PERSONA_BOOSTS (9 dimensions) + structural match boost. persona/route.ts updated: fetchCouncilContext() now returns ruleEngineResult + maxStructuralScore (matches_json added to DB select). Synthesis path: relevanceBlock injected as MANDATORY NON-NEGOTIABLE final system prompt layer. — ✅ Implemented May 31, 2026** |
| **R5** | **Structural output traceability: conditional OUTPUT TRACEABILITY requirement appended to structuralBlock in persona/route.ts. Fires only when structural context is present + persona is in PERSONAS_WITH_STRUCTURAL_CONTEXT + initial call. If structural memory genuinely shaped the persona's angle, final sentence must begin "Structurally, this decision [observation]." If not applicable, sentence is omitted — no fabrication. No system prompt change. No personas.ts change. Tech debt: audit gap (omit vs ignore indistinguishable) — deferred to corpus scale. See KDD 102. — ✅ Implemented May 31, 2026** |
| **Additional Risk A** | **recency_bias hardcoded to 'neutral' — confirmed already fixed in Sprint R2 (bias-scorer.ts classifyBiasSignal()). Now correctly returns 'distorting' when ddInfo ≥ 4. No new files needed. — ✅ Pre-existing fix confirmed May 31, 2026** |
| **Additional Risk C** | **Benchmark vs structural retrieval math inconsistency: lib/similarity.ts (NEW) — single source of truth for DIM_WEIGHTS (14 dims, 1.5× for ⭐ starred). lib/structural-retrieval.ts updated: imports DIM_WEIGHTS from similarity.ts, local definition removed. app/api/mirror/benchmark/route.ts updated: extractVector() now applies DIM_WEIGHTS (score × dim_weight). Intentionally NOT confidence-weighted cross-user (see KDD 101). — ✅ Implemented May 31, 2026** |
| **Additional Risk E** | **Longitudinal reasoning gap — calibration delta and contradiction data not reaching synthesis: lib/bias-scorer.ts extended (one file). fetchCalibrationContext() (private) — queries sessions+outcomes for calibration_delta, gates on ≥3 paired points and \|avgDelta\| ≥ 0.3, returns plain-English synthesis-ready description of confidence pattern. fetchActiveContradictions() (private) — queries contradictions for undismissed tensions (limit 2), returns synthesis-ready block. fetchUserBiasContext() updated: all 3 DB queries run in parallel via Promise.all; calibrationLine + contradictionBlock appended to synthesisBlock; MANDATORY directive extended with calibrationDirective + contradictionDirective — each gives synthesis concrete example phrasings to ensure findings surface as natural prose, never as section headers or labelled data points. Return shape and call signature unchanged. — ✅ Implemented May 31, 2026** |
| **R4** | **Session Reliability Index: lib/session-score.ts (NEW) — computeUserSessionScores() unifies structural match quality (sessions_ontology.matches_json), bias clarity (bias_library.activation_contexts — distorting signal count × asymmetry_score_avg), council confidence (rule_engine_result mode + flag_rules.length, deterministic), calibration (outcomes.calibration_delta, 70 if pending) into SessionScoreData[]. Formula: structural × 0.25 + biasClarity × 0.30 + councilConfidence × 0.20 + calibration × 0.25. deriveActionPlan() always returns specific improvement action targeting weakest avg sub-score across all sessions. app/api/mirror/session-score/route.ts (NEW) — GET handler, auth + unlocked gate. components/SessionReliabilityIndex.tsx (NEW) — Mirror module: per-session score list (last 10), 4 sub-score hover dots, average + trend delta, always-visible "Your next move" callout. lib/types.ts: SessionScoreData appended. app/mirror/page.tsx: import + section block added after Confidence Calibration. TypeScript fix: Omit<SessionScoreData, 'actionPlan'> intermediate type resolves build error. No LLM. No schema change. — ✅ Implemented May 31, 2026** |
| **Additional Risk F** | **Synthesis has no access to bias signals — confirmed already fully implemented in Sprint R2 (fetchUserBiasContext() in lib/bias-scorer.ts). synthesisBlock + personaAlert both firing. No new files needed. — ✅ Pre-existing fix confirmed May 31, 2026** |
| **Audit R9 / R11** | **Audit R9 (Identity Overfitting): confirmed threshold raised from ≥2 to ≥3 in mirror-fingerprint.ts and bias-scorer.ts. Forming now covers detection_count 1 and 2. Forming tile builder fully dynamic (detectionCount / confidenceWeight / confidenceDots from DB row). BiasFingerprint.tsx copy updated — "building confidence" replaces "one more session to confirm" (accurate for both 1 and 2 detections). Narrative block: "three or more patterns" (was two). Audit R10 (Style calibration bias): permanently skipped — audit verdict was LOW RISK, working as designed. Locked as KDD 110. Audit R11 (Heuristic thresholds): all 7 threshold constants now configurable via Railway env vars — MATCH_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD, AVOIDANCE_DAYS_THRESHOLD, STRUCTURAL_ECHO_MIN_SCORE. No deploy needed to tune. .env.example updated with all 7 vars and recalibration milestone note. Admin dashboard: r11 block added (effectiveThresholds table + avoidance alert stats). app/admin/page.tsx: R11 section added — threshold table with amber override highlighting + 4-stat avoidance card grid. — ✅ Implemented June 1, 2026 (deploy pending)** |
| **Additional Risk D — D3** | **Mirror surface + dismiss + synthesis resubmission context: components/AvoidanceAlertCard.tsx (NEW) — renders up to 3 undismissed alerts, "Bring it back →" + "Mark as resolved →" CTAs. app/api/mirror/avoidance/dismiss/route.ts (NEW) — POST dismiss endpoint, ownership check, minimal outcomes upsert on resolve. app/api/mirror/alerts/route.ts — parallel avoidance query, response gains avoidanceAlerts[]. app/api/persona/route.ts — resubmitAlertId param, RESUBMISSION CONTEXT injected at synthesis. app/mirror/page.tsx — AvoidanceAlertCard wired into UnlockedView above Bias Fingerprint. app/page.tsx — ?decision= URL param pre-fills textarea. components/SynthesisCard.tsx — resubmitAlertId passed from localStorage. Additional Risk D now fully complete (D1 + D2 + D3). — ✅ Implemented June 1, 2026** | (3 passes). HIGH: dimension count (14), rule count (12), full pipeline sequence, Mirror module mechanism descriptions. MEDIUM: bias trigger format, Decision Independence Score mechanism, internal state labels (provisional/blocked/held), social proof FOMO metric, not-a-chatbot strip architecture, Mirror timeline internal labels. LOW: "12 months" advisory, teaser unlock threshold (3), "in parallel" Council execution, "Traces which structural factors". All resolved. Output: index_final.html + index_final.patch. — ✅ May 30, 2026** |

---

## CURRENT STATUS

**Engagement + PWA Sprint (June 11, 2026) — IMPLEMENTED, partially verified.**
Three pull-mechanics threads shipped in one session:
- **Reanalyze Email Cadence:** Daily cron sends one email per session at 7/14/30 days if no outcome logged — minimal, decision-specific, no branding noise. Also fires a matching push notification. `email_send_log` table prevents double-sends. **DB migration required:** `supabase/sprint_reanalyze_email.sql`. **Railway Cron required:** `0 8 * * *` → `POST /api/cron/reanalyze-email` with `Authorization: Bearer $CRON_SECRET`. Not yet validated against a live cron run.
- **MirrorOpenLoopCard:** Home-screen "pattern forming" teaser for users below the Mirror unlock threshold — gives non-subscribers a visible reason to keep logging decisions. Live, no further action needed.
- **PWA:** App is installable (manifest + icons), service worker handles push only (no offline caching by design — Quorum is dynamic/auth-gated). Push notifications work end-to-end: subscribe → `push_subscriptions` table → `sendPushToUser()` → reanalyze cron. **DB migration required:** `supabase/sprint_pwa_push.sql`. **New env vars required:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate via `npx web-push generate-vapid-keys`). Verified working on Android (install + push prompt + Supabase row created).
- **UpdateBanner:** `/api/version` (Railway git SHA) + 5-min poll + visibility/focus re-check. Shows "Refresh" banner on new deploy — manual reload by design (never auto-reloads mid-session). No env vars or migrations needed.
- **FROM_EMAIL fix:** Reanalyze emails were showing sender "AUTH" (Gmail falling back to local-part of a bare `auth@quorumvault.org` FROM_EMAIL with no display name). Code safety net added (auto-wraps with "Quorum <...>" if no display name present); Railway env var `FROM_EMAIL` should also be updated to `Quorum <auth@quorumvault.org>`.
- **Known platform limitation (documented, not a bug):** installing the PWA from multiple browsers (Chrome, Gmail in-app browser, etc.) on the same device creates separate home-screen icons with separate storage/auth — no fix possible at the web-app level. User-facing guidance: always install + complete magic-link auth in the same browser (Chrome recommended).

---

**Mirror UX Overhaul — Sprints M1–M6 (June 8–9, 2026) — COMPLETE.**
Full Mirror page redesign across 6 sprints. 21 audit recommendations shipped across P0–P3 priority tiers:
- **M3 (Unlock Moment):** WelcomeMirrorCard (first-visit orientation, Active Now / Still Building grid), ThresholdGate reframed as milestone countdown with personalised bias teaser, ContradictionDetector MILESTONES[0] reframed to "Building the map" with forward-looking copy + excerpt.
- **M1 (Living Digest):** MirrorSummaryCard (above-fold 4-stat snapshot), /api/mirror/summary aggregated route, "since last visit" delta line, decrypted examinerQuote surfaced.
- **M2 (Navigation & Structure):** MirrorNav sticky 8-anchor section nav (IntersectionObserver, mobile auto-scroll, 36px touch targets), SectionWrapper (collapse + desc-hide, localStorage-backed, type-coloured left borders, staggered fade-in), conditional section ordering (MJR near top when loops > 0, Timeline near top for < 10 sessions).
- **M4 (Freshness Signals):** "Active" badge on bias tiles (lastFiredAt < 14 days — batch session date fetch), "↑ Increasing" on patterns (recent_fire_count > 2 of last 10), "Latest" badge on SRI first row, dismissed/active ratio in Contradiction Detector.
- **M5 (Attention Zone + Mobile):** AttentionZone (0–3 dynamic cards between SummaryCard and MirrorNav, no extra fetch), MirrorNav mobile improvements (auto-scroll active pill, 36px min-height, dot badges for M6 prominence).
- **M6 (Synthesis & Intelligence):** MirrorInsightCard (deterministic 7-rule cross-module synthesis, no LLM), latestSessionMode drives module prominence (REDIRECT → Independence Score highlighted, GATE → Contradiction Detector highlighted), secPulse animation on highlighted sections.
- **4 Bugfixes:** encrypted outcome text, Pattern Memory active guard, open loops show-more, examiner quote decrypt.
- **DB migration required:** `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ;`

**Privacy & Security Sprint Plan (June 6, 2026) — IMPLEMENTED.**
All 6 sprints of the privacy/security plan complete. App and website are now enterprise privacy-ready:
- Cookie consent + legal pages (S1–S3): live on both website (quorumwebsite-production.up.railway.app) and app (app.quorumvault.org)
- Backend hardening (S4): RLS fixed, session hijack closed, payment route secured, security headers live
- Rate limiting (S5): 5 routes rate-limited with layman 429 messages + countdown banners
- Audit trail + data rights (S6): audit_log table, real GDPR export, real account deletion, admin lockout + viewer
- SQL migrations confirmed run (June 7, 2026): sprint4_rls_hardening.sql, sprint5_bias_library_user_id.sql, sprint6_audit_log.sql — all executed in Supabase.

**Chunk 1 + Chunk 2 (June 4, 2026) — DEPLOYED.**
Full in-session commitment layer (Decision State + Switch Conditions + Rule Recall) and Monthly Judgment Review Mirror module live.
- Rule Recall timing fix deployed: fires before examiner submission, not after
- Rule Recall injection fix deployed: "Apply this rule" now feeds into all 6 Council personas + synthesis
- Monthly Judgment Review: Loop Closure module live in Mirror (after SessionReliabilityIndex)
- Open loops list: sessions with past-due review dates surfaced with days-overdue badge

**Hybrid Routing Sprint (June 3, 2026) — FULLY DEPLOYED (confirmed code audit June 7, 2026).**
lib/ai-client.ts rewritten with per-call provider override and ROUTING_MODE env var. All 9 call-site patches and ontology-tagger.ts migration confirmed in codebase. Claude handles 8 structured calls; DeepSeek handles 7 generative/prose calls. Railway env vars to set if not already: ANTHROPIC_MODEL, DEEPSEEK_MODEL (ROUTING_MODE defaults to hybrid — no error if unset).

**Sprint R_JC (June 2, 2026) — COMPLETE, deployed.**
userJudgmentContext() completion sprint. Three missing longitudinal pieces shipped:
- Prior C0 principles injection: `fetchUserPrinciplesBlock()` in bias-scorer.ts
- Recurring regret detection: `fetchRecurringRegretBlock()` in bias-scorer.ts
- Examiner bias-aware sharpening: `fetchExaminerBiasHint()` exported from bias-scorer.ts

**All (a) items — now built:**
- ✅ Decision State + Switch Conditions (DecisionStateCard.tsx — Chunk 1)
- ✅ Rule Recall at session time (RuleRecallBanner.tsx — Chunk 1)
- ✅ Monthly Judgment Review (MonthlyJudgmentReview.tsx — Chunk 2)
- Switch Conditions relevance matching (Rule Recall shows rules[0] regardless of decision type) — low priority, deferred


## SECOND-USE RETENTION STRATEGY (Sprints RET-1/2/3 — June 20, 2026)

This section is the single reference for the second-use retention audit and the three sprints (RET-1, RET-2, RET-3) it produced. Read this before touching `BriefCTA.tsx`, `EmailCaptureCard.tsx`, `EarlyEchoCard.tsx`, `BiasNoteCard.tsx`, `echo-hint/route.ts`, or any future retention-card work — and **read the "Path to 95+" subsection (§5) before starting a new session on this thread**, since that is the explicit handoff point.

### 1. The audit framework

The audit was run as a 7-phase structured review (product psychologist / habit-formation expert / PLG strategist / UX researcher / SaaS onboarding auditor lens) against the codebase, answering one question: *after the first session ends, what specific reason does the user have to come back?* Phases: (1) Product Summary — core promise, persona, first-use journey; (2) Second-Use Probability — 10-category scored table + composite 0–100 score; (3) Retention Loop Analysis — 8 loop types (Utility, Investment, Progress, Memory, Learning, Identity, Social, Outcome), each scored 0–10 with codebase evidence; (4) Friction Audit — ranked list of reasons a satisfied user still doesn't return; (5) Second-Use Strategy — proposed fixes scored on effort (S/M/L) / cognitive load (0–10) / retention impact (0–10), explicitly excluding feature bloat (no dashboards, gamification, streaks, badges, leaderboards, social features); (6) Smallest Possible Lever — the single highest-leverage, lowest-friction change; (7) Founder-Level Verdict. This framework should be re-run (not re-litigated from memory) if a major new feature changes the product's retention surface — it is a repeatable audit, not a one-time finding.

### 2. Baseline score and trajectory

| Checkpoint | Score | What changed |
|---|---|---|
| Pre-sprint baseline | **58/100** | Audit findings below |
| After RET-1 (3 items: email capture moved to record page, free Brief PDF, early session-count signal) | **~72–76 (projected)** | See §3 |
| After RET-3 (Item A + Item C + copy fix; RET-2 folded in as a consistency fix) | **~86–88** | See §4 |
| After RET-4 (Lever (ii): free single-outcome calibration feedback) | **~89–91** | See §5 — Learning/Identity gap narrowed; Utility gap (lever (i)) untouched |
| After RET-5 (Lever (i): linked revisit — Sprint 1 schema/linkage, Sprint 2 Council continuity injection, Sprint 3 Decision Arc timeline) | **~91–93 (current, as of this sprint)** | Infrastructure fully shipped. Score accrues as users complete revisit cycles. Not yet confirmed 95+ — confirmation requires at least one full user cycle (session → email → revisit → outcome logged on both). |
| Target | **95+** | See §5. ⚑ Once confirmed at 95+: immediate next step is end-to-end email + push notification audit (deliverability, trigger logic, link-back-to-product flows) — before any other new work. |

**Phase 2 scored table (baseline, pre-sprint):**

| Category | Score (0–5) | Note |
|---|---|---|
| Immediate value | 4 | Six-persona synthesis in one sitting is a complete artifact — strong first-session payoff, not a return signal |
| Delayed value | 4 | `reanalyze-email` cron (7/14/30-day nudges) is genuinely strong but only fires for emailed users |
| Accumulating value | 5 | Structural memory injection, `MemoryEngineStatus`, `PatternSurfaceCard` all explicitly compound with session count |
| Personalization value | 4 | Bias fingerprinting, calibration drift — genuinely derived from the user's own record |
| Curiosity value | 5 | `MirrorOpenLoopCard`'s blurred teaser + weekly insight email — best-in-class curiosity hooks |
| Utility value | 3 | Real utility but consumed in one sitting per decision; no forced reason to return between decisions |
| Identity value | 3 | "Judgment OS" framing exists but is never named back to the user as a trait |
| Social value | 0 | No social mechanic anywhere in the codebase |
| Learning value | 4 | Avoidance detection, calibration trend, recurring patterns genuinely teach the user something new |
| Progress value | 4 | Segmented progress bar toward Pattern Memory; pending/decided tabs |

**Phase 3 loop analysis (baseline, pre-sprint), strength 0–10:** Utility 5, Investment 7, Progress 6, Memory 8 (strongest loop — but chicken-and-egg: can't fire until the user has already returned 5 times), Learning 7, Identity 4, Social 0, Outcome 8.

### 3. RET-1: what was built and why (June 20, 2026)

Three items shipped in one sprint, chosen because they compound rather than running in parallel:

1. **Decision Brief freemium + dark/light mode.** The Brief PDF was the single biggest dead-end CTA in the friction audit — a satisfied first-time user, at peak engagement, hitting a paywall with no self-serve resolution. Removing the gate (see KDD 187) unblocks the Outcome and Delayed-value loops, which depend on the Brief being something users can actually save/share without friction.
2. **Email capture moved to the record page, decision-framed.** The only prior email surface (`AuthPanel.tsx`) appeared only on a *return* visit — too late to influence the decision to return. Moving it to peak-intent (seconds after synthesis) and framing it around the specific decision ("Want us to check back on this?") rather than generic account creation is the prerequisite for every other loop in this audit, since almost everything downstream requires `user_id`/`user_email`. See KDD 191.
3. **Early session-count signal (`EarlyEchoCard`, count-only version).** The Memory Loop (strongest in the audit) was invisible until session 5 — meaning a user had to independently choose to return four times before getting any proof the product remembers them. A lightweight count-only message at sessions 2–4 ("2 more and Quorum begins recognising structural patterns") gives partial proof earlier, without touching `MIN_SESSIONS`.

### 4. RET-2 + RET-3: what was built and why (June 20, 2026)

RET-2 was a same-day consistency fix, not a new design decision: `SynthesisCard.tsx`'s in-session "Generate Decision Brief" button still showed the old paid-access-code flow after RET-1 had only updated the record-page surface (`BriefCTA.tsx`). Both surfaces now resolve to the same free path. See KDD 187 (consolidated rationale for both surfaces).

RET-3 shipped the two items explicitly confirmed for this stage of the audit:

- **Item A — `BiasNoteCard`.** Closes the "dead zone" between peak engagement (right after synthesis) and the next time bias feedback would otherwise surface (homepage teaser, next visit, or Mirror unlock). Works from session 1, no subscription required, `device_id`-only users included. Surfaces only `signal_type === 'distorting'` detections, no `detection_count` threshold — a single-session claim, not a longitudinal one. See KDD 190.
- **Item C — `EarlyEchoCard` structural upgrade.** At session count 3+, the count-only message is upgraded (progressive enhancement, no loading state) to name an actual shared structural dimension, via a new lightweight `/api/record/[id]/echo-hint` endpoint that calls `scoreStructuralSimilarity()` directly — bypassing `retrieveStructuralMatches()` and its `MIN_SESSIONS=5` gate entirely, with no LLM call and no write to the tables that gate owns. This was the explicit design constraint for the whole sprint: **prove the product remembers, earlier, without weakening the threshold that protects Council injection quality.** See KDD 188.
- **"Item B" rejected.** The original plan proposed a homepage `JudgmentSignatureCard` aggregating bias data. Rejected as duplicative of the existing `PatternSurfaceCard` (different detection system, same "your dominant pattern" framing — would read as feature-showcasing, not signal). Replaced by (a) a one-line copy fix to the Mirror "NEXT MOVE" string, which had a real accuracy bug, and (b) a deferred, lower-overload alternative — surfacing the bias aggregate inside Mirror's existing Patterns tab instead of a new homepage card — logged as TD-4, not committed. See KDD 189.

### 5. Path to 95+ — the three remaining levers (handoff for next session)

**Update, June 22, 2026 (Sprint RET-5): lever (i) is now fully shipped** — see dated RET-5 entry at the top of this document and KDDs 196–199. Lever (iii) remains parked; see below.

**(i) — SHIPPED June 22, 2026 (Sprint RET-5).** A genuinely new utility surface beyond the single-sitting decision. Architecture: `parent_session_id` FK on `sessions` (Sprint 1); Council continuity injection via `lib/decision-continuity.ts` (Sprint 2); Decision Arc timeline on root record pages + Mirror calibration tile (Sprint 3). All three sprints ship together. The revisit loop is now: user receives `reanalyze-email` at 7/14/30 days → clicks "Log what happened" or "Reanalyze" → Council references prior sitting's synthesis, examiner answers, pushback, and commitment fields as NON-NEGOTIABLE context → outcome logged → Decision Arc timeline visible on root record page showing both sittings. Utility score expected to move from 3/10 toward 7/10 as users complete revisit cycles. Retention score currently estimated ~91–93; confirmation to 95+ requires at least one full real-user cycle. See KDDs 196–199.

**⚑ Post-95+ priority — do not start new work before this:** once the score is confirmed at 95+ (at least one verified full user revisit cycle), the immediate next step is an end-to-end code audit of all retention mechanisms from an email + push notification POV — specifically: deliverability, trigger logic, and how notification CTAs link back into product flows. Flag this to Ken when confirmed. Log in handover doc at that time.

**(ii) — SHIPPED June 21, 2026 (Sprint RET-4).** Outcome-to-calibration feedback made visible, not just stored, on the free tier. `CalibrationRevealCard.tsx` still requires Mirror access AND a ≥3-paired-outcome threshold (`summary.dataReady`) for its full aggregate view — that gate is untouched. What shipped is the free, single-outcome version: `OutcomeTracker.tsx`'s existing 'saved' state now renders a one-line calibration note ("Your confidence was 7/10 going in, 8/10 in hindsight — you're gaining confidence in hindsight. That's now 1 data point toward your calibration record.") whenever both `pre_decision_confidence` and `retrospective_confidence` exist for that session — no Mirror gate, no paired-count threshold, fires at the actual save moment. See KDD 193 for the embedded-vs-sibling-component design choice.

**(iii) Solving the cold-start problem for `device_id`-only users who never email.** Right now, anonymous users get zero of the accumulating, learning, or curiosity loops — invisible to `bias_library` cross-session aggregation thresholds, `structural-retrieval.ts`, and Mirror entirely (with the one deliberate exception of `BiasNoteCard`, which does support `device_id`-only per KDD 192, and the deliberate exclusion of `echo-hint` for the same tier, also per KDD 192 — that asymmetry was intentional and should not be "fixed" without revisiting the EmailCaptureCard conversion incentive it protects). `EmailCaptureCard` helps but will not reach every anonymous user. The 95+ ceiling requires either (a) making `device_id` a first-class identity tier across all retention loops, not just the ones that already happen to support it, or (b) accepting that anonymous-only users cap out below 95 and treating "95+" as a target for identified users specifically, not the full anonymous+identified population. This is a product-policy decision, not just an engineering one — flag to Ken explicitly before picking a direction.

**(i) — SHIPPED June 22, 2026.** (ii) — SHIPPED June 21, 2026. (iii) — still parked, still a product-policy decision before any code is written. Do not start (iii) without explicit scoping with Ken.

### 6. Files touched across RET-1/2/3/4/5

**New (RET-1/2/3):** `components/EmailCaptureCard.tsx`, `components/EarlyEchoCard.tsx`, `components/BiasNoteCard.tsx`, `app/api/record/[id]/echo-hint/route.ts`

**Modified (RET-1/2/3):** `app/api/record/[id]/brief/route.ts` (token gate removed, dark/light palette), `components/BriefCTA.tsx` (rewritten — no token, theme toggle, direct download), `components/SynthesisCard.tsx` (in-session brief gate removed), `app/record/[id]/page.tsx` (all four cards wired in, server-side `biasNote` query added), `lib/session-score.ts` (NEXT MOVE copy fix)

**New (RET-5):** `supabase/ret5_sprint1_parent_session_id.sql` (migration), `lib/decision-continuity.ts`, `components/DecisionTimeline.tsx`

**Modified (RET-5):** `lib/types.ts` (parent_session_id on Session), `app/api/session/route.ts` (accept + validate parent_session_id), `components/ReanalyzeDrawer.tsx` (pass parent_session_id), `components/SessionView.tsx` (pass parent_session_id), `app/record/[id]/page.tsx` (breadcrumbs + timeline), `app/api/structural-match/route.ts` (lineage exclusion), `app/api/persona/route.ts` (continuity injection), `app/api/cron/reanalyze-email/route.ts` (light email palette)

**Unused as of RET-1 (flagged for deletion, not yet removed):** `app/api/brief-access/route.ts`, `BRIEF_ACCESS_TOKEN` Railway env var — see PENDING/NEXT SESSION.

**RET-5 schema changes:** 1 — `sessions.parent_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL` + index. **Zero new env vars across all RET sprints.**


## RETENTION SPRINT TEST LOG (RET-1/2/3 — validate before marking deployed)

Not yet run against staging or production as of this handover — see PENDING/NEXT SESSION. Use this as the test script.

### Decision Brief freemium (RET-1 + RET-2)

| Scenario | Pass condition |
|---|---|
| Record page → "Download PDF" (dark, no token) | PDF downloads immediately, no token/access-code prompt anywhere |
| Record page → toggle Light → Download | PDF renders white/cream background, bronze gold accents, near-black body text |
| Record page → toggle Dark → Download | Original dark theme unchanged from pre-sprint output |
| In-session (SynthesisCard) → "Generate Decision Brief" | Button is immediately visible post-synthesis, no "(paid)" label, no access-code field anywhere |
| `/api/brief-access` called directly | Still returns a response (not yet deleted) but nothing in the app calls it — confirm via network tab on both Brief surfaces |

### EmailCaptureCard (RET-1)

| Scenario | Pass condition |
|---|---|
| First visit to record page, no `quorum_user_email` in localStorage | Card visible below BriefCTA |
| Enter valid email → Send link | "Check your inbox" state shown; magic-link email arrives; `quorum_user_email` written to localStorage |
| Revisit same or different record page after linking | Card hidden (localStorage guard) |
| Click × dismiss | Card hidden for the browser session; reappears on a fresh page load (sessionStorage-scoped dismissal only) |

### EarlyEchoCard — count-only (RET-1) + structural upgrade (RET-3)

| Scenario | Pass condition |
|---|---|
| Session 1 (1 stored session ID) | Card hidden |
| Session 2 | Count-only copy: "Second decision recorded. 3 more…" — no echo-hint call fired (confirm via network tab) |
| Session 3, identity linked, qualifying past match exists | Count-only copy renders first, then upgrades in place to name the shared structural dimension once `/api/record/[id]/echo-hint` resolves |
| Session 3, no identity linked (anonymous) | Count-only copy renders and stays — echo-hint returns `{ available: false, reason: 'no_identity' }`, no error shown, no visible loading state |
| Session 3, identity linked, no qualifying match (below `MATCH_THRESHOLD`) | Count-only copy renders and stays — silent fallback |
| Session 4 | Same as session 3, with "One more…" count-only base copy |
| Session 5+ | Card hidden (`MemoryEngineStatus` on homepage takes over) |
| Click × | Card hidden for this page load (sessionStorage-scoped per `sessionId`) |

### BiasNoteCard (RET-3)

| Scenario | Pass condition |
|---|---|
| Session with a `distorting`-classified bias detected | Card renders below OutcomeTracker: bias label + one short reasoning sentence (≤220 chars) |
| Session with only `neutral`/`adaptive` classifications | Card renders nothing (filtered out by design — not a bug) |
| Session with no bias detections at all | Card renders nothing |
| Anonymous (`device_id`-only) session with a `distorting` detection | Card still renders — this is the one new RET-3 surface that intentionally supports this identity tier (KDD 192) |
| Session with multiple `distorting` detections | Only the single highest-`prosecutor_score` bias is shown, not a list |


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
| R11 — Avoidance Detection | BACKGROUND | `upstream_dependency ≥ 4 AND days_open ≥ 45` | ✅ Fully live. D1: schema (sessions.last_action_at + avoidance_alerts table). D2: detection engine (avoidance-detector.ts) + cron (cron-job.org, daily 02:00 UTC). D3: Mirror surface (AvoidanceAlertCard), dismiss endpoint, synthesis resubmission context. |
| R12 — Couple Misalignment | FLAG | `decision_unit 2–3 AND value_conflict ≥ 4` | ✅ live |

---

## KEY DESIGN DECISIONS (do not re-debate)

1–42: All carried from v21 unchanged.

43. **Mirror TEASER_THRESHOLD = 3.** Permanently 3 sessions. Do not raise.
44. **getMirrorAccessState() is the sole arbiter of Mirror access.** No route queries mirror_access directly.
45. **mirror_access writes are always upsert ON CONFLICT (user_id).**
46. **Unlock tokens map to plan type.** MIRROR_TOKEN_MONTHLY → 30d, MIRROR_TOKEN_ANNUAL → 365d. (MIRROR_TOKEN_LIFETIME retired June 13, 2026 — see KDD 172.)
47. **fetchCouncilContextWithRetry() for initial personas only.** Synthesis uses plain fetchCouncilContext().
48. **TeaserView PRICING_URL points to https://quorumvault.org/#pricing.** (`www.` removed June 13, 2026 — was previously `https://www.quorumvault.org/#pricing`.) Not .xyz.
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

97. **C0 fires on every decision, including complex ones (3+ rules).** The previous suppression (`allRules.length < 3`) was a false economy — C0 is the JTBD anchor and is *most* valuable precisely when the decision is complex. REDIRECT suppression is retained (C0 cannot fire if the Council is blocked). Max question count on a 3-rule decision is now 4. UX cost is one extra question; synthesis quality gain is permanent (user's success definition always recorded).

98. **Council Weighting Directive is MANDATORY NON-NEGOTIABLE, positioned last in synthesis system prompt.** Flat aggregation of 6 advisor outputs is the failure mode. The directive must be terminal in the system prompt — LLM adherence is highest for the final instruction. Positioning it earlier (between councilContext and biasBlock) risks de-prioritisation. Do not move it.

99. **RULE_PERSONA_BOOSTS in lib/persona-relevance.ts is explicit config, keyed by RuleId.** Rule IDs are typed against the union type `RuleId` which mirrors rule-engine.ts exactly. If a rule is added/renamed in rule-engine.ts, the union type in persona-relevance.ts must be updated — TypeScript will error at the Record definition if they drift. To retune weights: edit boost values in RULE_PERSONA_BOOSTS or DIM_PERSONA_BOOSTS only. No logic changes required for retuning.

100. **computePersonaRelevance() fires for synthesis even when councilContext is null.** If ontology is missing (v1.0 session or race condition at synthesis time), the function returns a flat 0.50 baseline map. buildRelevanceBlock() still serialises this as the directive — all advisors at BASELINE. The directive is valid and non-misleading. Do not gate the call on councilContext presence.

101. **DIM_WEIGHTS lives in lib/similarity.ts — the single source of truth. Never define it elsewhere.** structural-retrieval.ts (within-user comparison) and benchmark/route.ts (cross-user comparison) both import from there. The two formulas are intentionally different: structural-retrieval.ts applies score × confidence × dim_weight (confidence is valid within a user's own history); benchmark/route.ts applies score × dim_weight only (confidence is a per-session personal signal and is not portable between users — applying someone else's confidence weight to your score introduces noise, not signal). What is now consistent: the 1.5× multipliers for the three ⭐ starred dimensions (identity_alignment, regret_asymmetry, upstream_dependency) apply in both contexts. Full formula unification would require a cross-user confidence normalisation strategy — deferred, not worth the complexity at current corpus size.

102. **R5 structural output traceability is conditional, not mandatory.** The OUTPUT TRACEABILITY block in structuralBlock tells each of the 5 structural-context personas: if the structural record genuinely shaped your angle, close with one sentence beginning "Structurally, this decision [observation]." If it did not, omit entirely — do not fabricate. Rationale: weak or borderline structural matches (45–59/100) may not apply to every persona's specific analytical lens. A forced closing sentence on a non-applicable match degrades output quality more than the traceability is worth. Tech debt: the conditional creates an audit gap — a persona that omitted the sentence cannot be distinguished from one that ignored the mandate. Full traceability (requiring either a closing citation or an explicit non-applicability statement) is deferred until corpus scale makes the distinction analytically meaningful and operationally worth the prompt cost.

103. **Calibration and contradiction data in synthesisBlock must reach the user as natural prose, never as labelled data.** The calibration and contradiction directive addenda in `fetchUserBiasContext()` each supply concrete example phrasings to synthesis — e.g. "your track record suggests you tend to be more certain at the moment of deciding than your retrospective view has supported" (calibration) and "this sits in some tension with something you've articulated before" (contradiction). Synthesis is explicitly prohibited from: using the label "calibration data", creating a section header for either data type, reproducing field values verbatim as a list, surfacing contradiction tensions that are not genuinely applicable to the current decision, or quoting numbers without human meaning. This is the same plain-language contract that governs bias key translation (KDD 87) — extended consistently to all three longitudinal data types now in synthesisBlock.

104. **fetchCalibrationContext() gates on both count and magnitude.** Minimum 3 paired sessions (pre + retro both present) AND |avgDelta| ≥ 0.3. The magnitude gate ensures well-calibrated users — whose delta is noise-level — produce no injection. No point surfacing a calibration observation when the user is already accurate. The count gate prevents a single retrospective outlier from driving synthesis narrative. Both gates must be satisfied; neither alone is sufficient.

105. **Session Reliability Index formula weights: structural × 0.25, biasClarity × 0.30, councilConfidence × 0.20, calibration × 0.25.** Bias clarity weighted highest (0.30) — active distorting signals are the most actionable and most frequently occurring drag on analysis quality. Structural and calibration equal (0.25 each) — both measure contextual richness but across different axes (historical comparison vs. personal accuracy track record). Council confidence lowest (0.20) — it reflects decision framing clarity, which is least controllable within a single session. Do not rebalance without a calibration corpus of ≥ 50 sessions.

106. **Session Reliability Index action plan is global (one per user from weakest average sub-score across all sessions) — not per-session.** Per-session actions would produce contradictory advice if adjacent sessions have different weak spots. A single global action based on the user's pattern gives one clear lever. The same actionPlan string is attached to every row in SessionScoreData[] — UI reads from [0]. The action is always present even when all sub-scores are strong — maintenance actions surface in that case (e.g. "log outcomes consistently").

107. **council_confidence_score is computed deterministically from rule_engine_result.mode and flag_rules.length — no LLM call.** An LLM-based divergence score (per original audit proposal) would require a per-session inference pass adding latency and cost. The rule engine result is a structurally valid proxy: REDIRECT = decision was structurally blocked (35); GATE = structural ambiguity fired (50); flag count ≥ 3 = high complexity (60); 1–2 flags = manageable (75); 0 flags OPEN = clean conditions (90). Deterministic, auditable, and zero inference cost. If true LLM variance scoring is needed in future, it must run async post-session — not on the API request path.

108. **Audit R9 fix: confirmed bias threshold is ≥3 detections, not ≥2.** Two detections of a bias pattern is insufficient to call it confirmed — one unusual decision can produce two correlated signals in the same session cycle. Three detections across distinct sessions is the minimum for a stable fingerprint entry. The forming tier now covers detection_count 1 and 2, with appropriate hedging. Synthesis prompt updated to reflect "CONFIRMED = 3+ / FORMING = 1–2". Do not lower this back to ≥2 without a calibration corpus showing stable precision at that threshold.

109. **Audit R11: all 7 heuristic threshold constants are now configurable via Railway env vars — MATCH_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD, AVOIDANCE_DAYS_THRESHOLD, STRUCTURAL_ECHO_MIN_SCORE.** Defaults are the original heuristic values (unchanged behaviour when vars are unset). Override in the Railway Variables panel — takes effect immediately on next request, no deploy needed. Formal recalibration is mandated at 100-session and 250-session corpus milestones (see TECH DEBT section). Do not tune thresholds before 100 sessions — current heuristics will outperform empirical fits on small-n data. The admin dashboard R11 section shows which thresholds are currently overridden (amber highlight) vs at default.

110. **Audit R10 (style calibration bias in persona ordering) is permanently skipped — locked KDD.** The audit verdict was: TRUE (LOW RISK), working as designed, effect is bounded. The +1 USER_STYLE_BOOST is a tiebreaker that cannot override a fired rule signal (which carries up to +3). All 6 advisors still generate full output regardless of ordering position. First-position read bias is a UX micro-effect, not a reasoning quality gap. Monitoring for reduced diversity with strong style preferences is an informal observational check via the admin dashboard — no code needed. Do not reopen R10 as a build item.

111. **ADMIN_CODE Railway env var must be ASCII-only (ISO-8859-1 safe).** HTTP headers — including the Authorization header used to pass the admin code from the browser to the API route — only allow ISO-8859-1 characters. Setting ADMIN_CODE to a value that contains emoji, Devanagari, Arabic, or any other non-Latin character causes `fetch()` to throw `TypeError: Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point` before the request is sent. The browser's catch block then fires, producing a misleading "Network error" message. Fix: use any printable ASCII string (A–Z, a–z, 0–9, hyphens, underscores, punctuation all safe). Non-ASCII characters in the ADMIN_CODE are not sanitised in code — the constraint is on the env var value itself.

112. **Admin page hook ordering: `fetchDashboard` must be declared before the `useEffect` that calls it.** In React strict-mode (Next.js default), effects are run synchronously on mount, then cleaned up and re-run. A `const fetchDashboard = useCallback(...)` declared AFTER `useEffect(() => { ... fetchDashboard(stored) ... }, [])` means the `useEffect` closure captures `fetchDashboard` while it is in the Temporal Dead Zone. The closure call throws a ReferenceError, caught by the `catch` block as "Network error". Fix: always declare `fetchDashboard` (or any async function called inside `useEffect`) before the `useEffect` hook. The dependency array should include `fetchDashboard` (not `[]` with an eslint suppress comment), which is correct because `useCallback` with a stable dependency re-creates the function only when the dependency changes — not on every render.

113. **AvoidanceAlertCard copy contract: "avoidance" never appears in user-facing text.** The word frames the user as having failed to act, which is both inaccurate (conditions may genuinely not have been right) and counterproductive (shame is not a decision-quality lever). The card observes that time has passed — neutrally. "You first brought this N days ago. It hasn't moved." is a factual observation, not an accusation. "Hasn't moved" is the closest acceptable framing — it describes the decision's state, not the user's behaviour. Do not reintroduce "avoidance", "avoided", "stalling", or "procrastinating" in any revision of this card's copy.

114. **The resubmission context in persona/route.ts is injected at synthesis time, not at session creation.** The `resubmitAlertId` param arrives in the synthesis POST body (via SynthesisCard.tsx reading localStorage). It is looked up fresh at synthesis call time — this means: (1) ownership is confirmed again at synthesis time (not just when the user clicked "Bring it back →"), preventing a malicious alertId injection via URL manipulation; (2) the `days_open` value is the snapshot from when D2 detected it, not recalculated — intentional, since "45 days ago" is more human than "actually now 47 days"; (3) if the alert row has been deleted between click and synthesis, the injection silently skips (non-fatal). localStorage key `quorum_resubmit_alert` is cleared immediately after reading — it fires exactly once per navigation, even if synthesis is re-run in the same session.

115. **The dismiss endpoint writes a minimal outcomes row to close the D2 cron gate.** The `resolved_externally` outcome quality value signals resolution without requiring the user to complete the full Outcome Tracker flow. This is intentional — demanding full outcome data before a decision can be dismissed from the avoidance alert would create friction that discourages dismissal. The minimal row (`outcome_quality: 'resolved_externally'`, `what_decided: 'Resolved externally — marked via Mirror.'`) satisfies the D2 detection gate (session has an outcome row → not flagged). If the user later wants to file a proper retrospective, the upsert uses `ignoreDuplicates: true` on `session_id` conflict — a real outcome filing via the Outcome Tracker will overwrite this placeholder.

116. **Light mode accent colors use semantic CSS tokens, never hardcoded rgba values.** Dark-mode-only hardcodes (e.g. #93c5fd, rgba(74,222,128,0.9), rgba(255,255,255,0.04)) are invisible or illegible on the light cream background (#f4f1eb). The correct pattern is: add the value to both `:root` (dark) and `[data-theme="light"]` (light) blocks in globals.css as a named semantic token, then reference via `var(--token-name)` in all components. Eight tokens established in Fix 1 (June 2, 2026): `--info-text`, `--info-bg`, `--info-border` (blue accent family), `--success-text`, `--success-bg`, `--success-border` (green accent family), `--overlay-bg`, `--overlay-bg-hover` (glass button family). Do not introduce new hardcoded rgba values for interactive or accent elements — every new color must be tokenised at the point of creation. Exception: SVG presentation attributes (fill=, stroke=) cannot accept CSS custom properties — hardcodes are required there and are acceptable.

117. **Supabase Magic Link email is routed via Resend SMTP relay — do not revert to Supabase default SMTP.** Supabase's built-in email has no domain authentication (poor deliverability), no custom sender name, and no template control beyond basic variable substitution. Resend provides: proper SPF/DKIM/DMARC on quorumvault.org, reliable inbox placement, and full HTML template support. Config lives in Supabase Project Settings → Authentication → SMTP (host: smtp.resend.com, port 465, username: resend, password: Resend API key). The Resend API key is a Railway/Supabase secret — never commit to source. The Magic Link template uses `{{ .ConfirmationURL }}` as the only Supabase-injected variable. If the Resend API key is rotated, update the Supabase SMTP password field immediately — Magic Link emails will fail silently if the key is invalid. Template HTML is stored externally (not in codebase) — keep a copy in `/mnt/user-data/outputs/` or a design asset store as the source of truth.

118. **All raw user input is encrypted at rest using application-layer AES-256-GCM. The encryption key (DB_ENCRYPTION_KEY) is stored only in Railway env vars — never in the codebase or Supabase.** Anyone with direct Supabase dashboard access, DB credentials, or backup access sees only `enc:<iv>:<authTag>:<ciphertext>` strings. Decryption happens exclusively server-side (Railway process). The key is a 32-byte / 64 hex-char random value. Encrypted columns: sessions (decision_text, context_text), messages (content — all roles), examiner_responses (question_text, response_text), outcomes (what_decided, notes), structural_matches (context_block as enc: string; matches_json as JSONB `{_enc: "enc:..."}` wrapper). Derived tables (sessions_ontology, bias_library, structural_scores, contradiction tables, avoidance_alerts) are intentionally plaintext — they contain numeric scores, enums, and AI-derived summaries, not verbatim user input. Anthropic's API still receives plaintext for AI processing — this is inherent to the product and unavoidable; encryption protects against DB-level exposure only.

119. **Backward compatibility: decrypt() passes through any value that does not start with 'enc:' — no migration is required before deploying.** Old plaintext rows remain readable immediately after the code deploy. Backfill encryption of existing rows is a separate one-time operation (run the migrate endpoint or script). This means there is a safe window between code deploy and backfill where the DB is mixed: new rows encrypted, old rows plaintext — both read correctly. The `enc:` prefix is the sole discriminator. If DB_ENCRYPTION_KEY is not set, encrypt() is a no-op and returns the original value — the app works in plaintext mode (local dev without key configured). Never set DB_ENCRYPTION_KEY to an empty string — that is different from unset and will cause key-length validation errors. For JSONB columns (matches_json), the discriminator is the presence of a `_enc` key in the JSON object vs an array — old rows are arrays, new rows are `{_enc: "enc:..."}` objects. decryptJson() handles both cases.

120. **If DB_ENCRYPTION_KEY is ever rotated, all existing encrypted rows must be re-encrypted in the same deploy window.** The rotation process: (1) add the new key as DB_ENCRYPTION_KEY_NEW in Railway; (2) run a migration script that reads each encrypted value with the old key and re-encrypts with the new key; (3) swap DB_ENCRYPTION_KEY to the new value; (4) redeploy. Partial rotation (some rows on old key, some on new) will cause decrypt failures for old-key rows. The current codebase does not have a rotation utility — build one before rotating. At current scale (single founding user stage), rotation is low urgency. Trigger rotation if: the key is accidentally exposed, a Railway staff member with env var access leaves, or the system moves to HNI-grade private infra.

121. **C0 raw responses are used for principles injection rather than re-running the AI rules pipeline.** The `mirror/rules` route generates abstracted rules via an LLM call (3–5s). Re-running this at synthesis time would add unacceptable latency to the critical path. Raw C0 examiner responses (`examiner_responses` WHERE `rule_id = 'C0'`) are used directly in `fetchUserPrinciplesBlock()`. They are verbatim, first-person, grounded in the exact decision context of each session, and require zero AI mediation. Tradeoff: less abstractly phrased than AI-extracted rules, but richer in the emotional and values dimension that synthesis actually needs. Gate: ≥3 C0 responses required (below this the pattern is too sparse to signal a reliable operating principle). Stored encrypted — `decrypt()` applied at read time. (Sprint R_JC)

122. **Recurring regret detection uses dimensional overlap, not cosine similarity.** `fetchRecurringRegretBlock()` checks whether bad-outcome sessions share ≥2 high-score dimensions (score ≥4 on 1–5 scale) with the current session rather than using the cosine similarity machinery in `lib/structural-retrieval.ts`. Rationale: (A) cosine similarity would surface fuzzy matches that could produce false positives in a regret-signal context — regret framing requires high specificity; (B) no cross-session confidence normalisation needed; (C) the simpler approach is auditable and debuggable. Gates: ≥5 sessions in history (below this base-rate patterns are noise), ≥2 bad-outcome sessions with ≥2 shared high dims. Do not replace with cosine similarity without validating false positive rate at corpus scale. (Sprint R_JC)

123. **Examiner bias hint is gated at confirmed biases only (detection_count ≥3).** `fetchExaminerBiasHint()` excludes forming patterns (1–2 detections). Using a forming pattern to sharpen a diagnostic question risks reinforcing a tentative signal prematurely — anchoring the user's framing in a direction that may not be a real pattern yet. Only confirmed patterns (≥3 detections, same threshold as `isConfirmed` throughout the system) warrant sharpened examination. Top 2 by `asymmetry_score_avg` (severity), not by recency, are returned — severity is the correct ranking signal for exam sharpness. (Sprint R_JC)

124. **2-round parallel structure in `fetchUserBiasContext` avoids duplicate session-ID queries.** Both `fetchUserPrinciplesBlock` and `fetchRecurringRegretBlock` require session IDs (neither `examiner_responses` nor `sessions_ontology` has a `user_id` column — both must join via the `sessions` table). Adding them as independent members of the existing `Promise.all` would cause two independent session-ID queries. Solution: session IDs fetched as a 4th member of round-1 `Promise.all` (alongside bias_library, calibration, contradictions), then shared to both round-2 functions. Total added latency: one extra parallel DB round-trip at the round-1→round-2 transition. This pattern should be maintained for any future longitudinal function that needs session-ID scoping. (Sprint R_JC)

125. **Hybrid AI routing: Claude for structured/JSON calls, DeepSeek for generative/prose calls. The fault line is task character, not output volume or user-visibility.** Structured calls (ontology tagger, bias scorer, contradiction detector ×2, gap questions, rules extraction, structural annotation, synthesis) use Claude — these produce JSON consumed by code or carry complex multi-layer instruction stacks where hallucination and schema non-compliance are costly downstream. Generative calls (persona analyses ×6, pushbacks, decision_brief persona, brief auto-gen, voice cleanup, mirror fingerprint, personalise question) use DeepSeek V4 — these produce prose consumed directly by humans where DeepSeek is quality-competitive at ~4× lower output token cost. Synthesis is the critical exception: prose output but with the most complex instruction stack in the product (5 layers + relevance block + bias block + council weighting directive) — hardcoded to Claude. The routing is expressed as per-call `provider` flags in each call site, not controlled by the global AI_PROVIDER env var. (Hybrid Routing Sprint, June 3, 2026)

126. **ROUTING_MODE env var is a global override switch, not a routing table.** ROUTING_MODE=hybrid (default when unset — no error) respects all per-call provider flags. ROUTING_MODE=deepseek_only forces all 15 AI calls to DeepSeek regardless of per-call flags — use for cost-optimisation testing and A/B quality comparison. The switch is implemented in a single resolveProvider() helper in lib/ai-client.ts; the per-call provider flags written in Sprint B are never removed, they are simply bypassed when deepseek_only is active. Switching ROUTING_MODE in Railway env vars takes effect on the next request without redeploy. Never use deepseek_only in a live paying-user session without validating structured call quality (bias scorer, ontology tagger, contradiction detector) against Claude output first. (Hybrid Routing Sprint, June 3, 2026)

127. **lib/ontology-tagger.ts is hardcoded to Claude (provider: 'anthropic') regardless of ROUTING_MODE.** After the Sprint B patch, the tagger routes through lib/ai-client.ts with an explicit provider: 'anthropic' flag and temperature: 0.1 for near-deterministic 14-dim classification. The ROUTING_MODE=deepseek_only override does NOT affect the tagger — resolveProvider() only overrides when ROUTING_MODE is active, but the tagger's explicit 'anthropic' flag is still passed in. Wait — actually ROUTING_MODE=deepseek_only DOES override the tagger since resolveProvider() ignores the requested param when deepseek_only is active. This is an accepted tradeoff: deepseek_only is an explicit test mode, not production. In production (hybrid), the tagger always uses Claude. Do not change this without first validating DeepSeek V4 JSON schema compliance on 50+ real decisions at temperature 0.1. (Hybrid Routing Sprint, June 3, 2026)

128. **ANTHROPIC_MODEL and DEEPSEEK_MODEL are independent env vars — do not use AI_MODEL for hybrid routing.** In a single-provider setup, AI_MODEL was sufficient. In hybrid, setting AI_MODEL to a DeepSeek model name would silently corrupt Claude calls (ANTHROPIC_MODEL defaults to AI_MODEL ?? 'claude-sonnet-4-20250514' — if AI_MODEL=deepseek-chat, Claude calls would send deepseek-chat as the model name to the Anthropic API and fail). Use ANTHROPIC_MODEL to pin the Claude model and DEEPSEEK_MODEL to pin the DeepSeek model. AI_MODEL is still respected as a DeepSeek-only fallback for backward compat with existing Railway configs. If both DEEPSEEK_MODEL and AI_MODEL are set, DEEPSEEK_MODEL wins. (Hybrid Routing Sprint, June 3, 2026)


146. **Key rotation script (scripts/rotate-encryption-key.ts) is a manual, deliberate operation — not a cron job.** Automated scheduled rotation would require both old and new keys in Railway env vars simultaneously on a schedule, which is an unnecessary persistent attack surface. Rotation is triggered by a human decision (e.g. quarterly schedule, suspected exposure, or staff departure with env var access). The script is idempotent and safe to re-run. Six-step runbook is in the file header. Do not wire this to cron-job.org or any automated scheduler — the human-in-the-loop is a security feature, not a limitation. (June 7, 2026)

147. **Vulnerability disclosure programme is published at /.well-known/security.txt per RFC 9116.** This is the machine-readable standard for security researchers to find the disclosure contact. Next.js serves the public/ directory as static assets, so the file is live at https://app.quorumvault.org/.well-known/security.txt without any route configuration. The contact address is security@quorumvault.org — ensure this alias exists and is monitored. Update the Expires field annually (currently set to 2027-06-07). The same disclosure commitment (5-business-day acknowledgement, 30-day critical remediation target) is stated in app/security/page.tsx IMPLEMENTED section — keep these in sync if response commitments change. (June 7, 2026)

125. **Decision State fields are clubbed to reduce friction — 2 text fields + 1 date picker.** Original spec had 5 fields (current_leaning, main_unresolved_risk, next_action, switch_conditions, review_date). Clubbed to 3 inputs: (1) "Where are you leaning, and what's your first move?" — clubs current_leaning + next_action; (2) "What would change your course?" — clubs switch_conditions + main_unresolved_risk; (3) review_date picker. DB columns remain separate logically: commitment_leaning (clubs 1+2), commitment_switch (clubs 3+4). Rationale: post-synthesis friction must be minimal or users skip entirely. The review_date is the most critical field for retention — it's the only mechanism that creates a specific return trigger. (Chunk 1)

126. **Rule Recall shows rules[0] without relevance matching — intentional for now.** RuleRecallBanner shows the first rule from /api/mirror/rules (most recently derived) regardless of whether it's contextually relevant to the current decision type. This means a parenting rule can appear in a product strategy session. Noted in live testing (June 4, 2026) — user confirmed not a blocker. Fix (semantic matching via ontology vector similarity between rule text and current session dims) is deferred. Do not implement until relevance mismatch becomes a consistent user complaint — it adds significant complexity for a UX edge case at current corpus size. (Chunk 1, deferred enhancement)

127. **Applied rule injection uses appliedRuleRef (not state) to avoid stale closure.** handleExaminerComplete is defined as useCallback with [] dependency array — any state variable captured in it would be stale at call time. appliedRuleRef (useRef) is used instead: ref mutations are synchronous and always return current value regardless of when the callback fires. onRuleApplied fires synchronously before the async PATCH in RuleRecallBanner, guaranteeing the ref is set before handleExaminerComplete can fire. Do not refactor to useState without adding the ref to handleExaminerComplete's dependency array — this would re-create handleExaminerComplete on every render and break persona streaming. (Chunk 1 fix)

128. **MonthlyJudgmentReview types must be inlined in the component — not imported from the API route.** Next.js 15 client components cannot import from API route files (server-only modules). Attempting to import MonthlyReviewData + OpenLoop from @/app/api/mirror/monthly-review/route caused a build error. Fix: both interfaces inlined in MonthlyJudgmentReview.tsx. The API route keeps its own local definitions. This is the correct pattern for all future Mirror modules that need typed API responses — define interfaces in the component, not the route. (Chunk 2)

130. **Privacy & Security Sprint Plan: 6 sprints, user-facing first, backend second.** Sprints 1–3 ship user-visible consent, legal pages, and settings before any backend fixes. This is deliberate: enterprise evaluators see compliance signals before backend hardening is complete. The audit trail (S6) is the last item — requires legal pages to be live so data rights links work. Do not re-order this sequence.

131. **Cookie consent uses localStorage, not HTTP cookies — "Cookie Policy" is used for brand familiarity.** The actual storage mechanism is localStorage (localStorage.setItem). HTTP cookies are not set by Quorum. The term "cookie" is retained in UI and policy copy because it is the legally and culturally understood term for user consent mechanisms. This is correct and defensible — Cookie Policy pages commonly cover localStorage.

132. **quorum_cookie_consent JSON schema: { necessary: true, functional: boolean, analytics: boolean, ts: number }.** The `necessary` key is hardcoded true and never togglable. `functional` gates device ID + session history writes. `analytics` is reserved for future use (always false default). `ts` is the Unix ms timestamp of last change. Do not change this schema without updating CookieConsent.tsx, storage.ts, and settings/privacy/page.tsx simultaneously.

133. **hasFunctionalConsent() in storage.ts gates ALL functional localStorage writes.** getOrCreateDeviceId() and pushSessionId() return early (empty string / void) if quorum_cookie_consent.functional is false or absent. Reading (getStoredSessionIds, getStoredDeviceId) is always permitted — no data created, no consent needed. quorum_user_email is strictly necessary (authentication) and not gated.

134. **S4-02 fix: user_id is derived server-side from Bearer token, never from request body.** app/page.tsx sends Authorization: Bearer <access_token> (from supabase.auth.getSession()). session/route.ts calls anonClient.auth.getUser(token) to verify and extract user.id. Body user_id field is silently ignored. If no valid token, user_id = null (anonymous session). This prevents session hijacking where any caller could stamp a session under another user's account.

135. **SUPABASE_SERVICE_ROLE_KEY must never be sent over HTTP headers.** S4-03 fixed /api/payment/create-subscription which previously compared x-admin-key against the service role key. The master key was transmitted over HTTP and potentially logged by Railway. Fix: PAYMENT_WEBHOOK_SECRET is a separate dedicated secret for that route only. The service role key is only used internally in createServiceClient() — never transmitted to any caller.

136. **Rate limiting is in-memory Map — single-instance Railway only.** lib/rate-limit.ts uses a module-level Map. This resets on deployment (acceptable). It does NOT work across multiple Railway replicas. If Quorum ever scales to multiple instances, replace with Upstash Redis. Do not add a Redis dependency prematurely. The in-memory approach is the correct choice for current scale.

137. **Rate limit response includes resetAt timestamp for accurate client countdown.** tooManyRequests() computes the reset clock time (toLocaleTimeString) server-side and embeds it in the message string. resetAt (Unix ms) is also included in the JSON body. RateLimitBanner.tsx uses resetAt to show a live countdown — when it hits 0, onExpired() fires and the user can retry. The countdown is computed client-side from resetAt, not from retryAfterSecs, to avoid drift.

138. **encryption.ts fails CLOSED in production.** Sprint 5 changed the fail-open behaviour: in NODE_ENV=production, if DB_ENCRYPTION_KEY is not set, encrypt() throws an Error instead of returning plaintext. This surfaces misconfiguration as a 500 error immediately rather than silently storing plaintext. decrypt() retains fail-open for backward compat (handles existing plaintext rows). The CRITICAL log at module load time surfaces in Railway logs on startup.

139. **Internal routes (ontology, bias-score) are gated by INTERNAL_API_SECRET, not rate-limited.** These routes are server-to-server only (called from session/route.ts and examiner/route.ts). Rate limiting them would be incorrect — they should never be browser-accessible. The gate is: if INTERNAL_API_SECRET is set in env AND incoming x-internal-secret header doesn't match → 403. If the env var is not set, the check is skipped (backward compat for dev). All callers (session route, examiner route) now send the header.

140. **audit_log has zero SELECT RLS policies by design.** Users cannot read their own audit trail via the anon key or the REST API. Only the service role (used by admin routes) can read it. This prevents audit log tampering and keeps the trail forensically clean. The admin viewer (/api/admin/audit-log) is the only read path.

141. **Account deletion writes to audit_log BEFORE any data is deleted.** This ensures there is always a record of the deletion intent, even if the deletion partially fails. The audit entry includes actor_id, actor_email, ip_address, and user_agent. supabase.auth.admin.deleteUser(userId) is the final step — it cascades sessions → messages/examiner_responses/sessions_ontology/outcomes/mirror_access. Email-keyed tables (bias_library, contradiction_log) are deleted explicitly before the auth user deletion because they have no FK cascade to auth.users.

142. **S6-04 admin lockout uses in-memory Map (same rationale as rate-limit).** After 5 consecutive failed ADMIN_CODE attempts from the same IP, that IP is locked for 15 minutes. failedAttempts Map: IP → { count, lockedUntil }. Success clears the entry. All attempts and lockouts are written to audit_log. Consistent with rate-limit design decision (KDD 136).

143. **Two Railway projects: app (app.quorumvault.org) and website (quorumwebsite-production.up.railway.app).** They share the same Supabase project but have completely separate env vars, codebases, and deployments. Website project needs: SUPABASE_URL, SUPABASE_SERVICE_KEY (for waitlist), APP_URL (for legal page links to app Privacy Center). App project needs the full .env.example vars. Never cross-deploy — the website is a plain Express server, the app is Next.js standalone.

144. **Legal pages link to app.quorumvault.org/settings/privacy for data rights.** All four website legal pages (/privacy, /cookies, /terms, /security) and all four app legal pages link the Privacy Center at APP_URL/settings/privacy. This is the canonical entry point for GDPR/DPDP data rights requests. No email addresses appear anywhere on any legal page — all contact routes go through the in-app Privacy Center.

145. **Data export is rate-limited to 1 per 24 hours per user_id (in-memory).** exportCooldown Map: userId → lastExportMs. On successful export, the timestamp is recorded. Subsequent requests within 24 hours return 429 with human-readable "Try again in X hours" message. This prevents data scraping via repeated exports. The cooldown resets on deployment — acceptable for now. The export includes all sessions (with decrypted decision_text/context_text), messages, examiner_responses, and bias_library rows.

129. **Monthly Judgment Review window falls back to all-time when total session count < 10.** A 30-day rolling window would return empty or near-empty data for early users (1–2 test users). FALLBACK_MIN = 10: below this, window_start is set 10 years in the past (effectively all-time). The component receives the window label ('last_30_days' | 'all_time') and displays it in the section header. This ensures the module is useful from the first session rather than appearing and showing zeros. (Chunk 2)


118. **All raw user input is encrypted at rest using application-level AES-256-GCM. Supabase and anyone with direct DB access sees only opaque enc: strings.** The encryption key (DB_ENCRYPTION_KEY) lives exclusively in Railway environment variables — never in the codebase, never in Supabase, never in logs. Encrypted columns: sessions.decision_text/context_text, messages.content, examiner_responses.question_text/response_text, outcomes.what_decided/notes, structural_matches.context_block/matches_json. Derived tables (numeric scores, enums, AI summaries) are intentionally left plaintext — they contain no raw user text and the decrypt overhead is not justified. All encryption/decryption happens in Railway server memory. The Anthropic API still receives plaintext for AI calls — this is inherent and unavoidable given the product's function. Railway logs must not contain decision_text in error messages — do not add debug logs that print raw field values.

119. **decrypt() is a transparent passthrough for values not starting with 'enc:' — this is the backward compat contract and must not be changed.** Old plaintext rows inserted before the Security Sprint remain readable without any migration. The backfill (encrypt-migrate endpoint) was run June 2, 2026 — SQL audit confirmed 0 plaintext rows remaining. However, the passthrough must be preserved permanently: any future row inserted without encryption (e.g. during a dev session with DB_ENCRYPTION_KEY unset) will still be readable. If DB_ENCRYPTION_KEY is not set, encrypt() is a no-op — the system writes plaintext and reads it back cleanly. Setting the key later will transparently handle the mixed state.

120. **structural_matches.matches_json is a JSONB column — encrypted values are stored as { "_enc": "enc:..." } to remain valid JSON.** Old rows contain the plaintext array directly (Array.isArray check in decryptJson handles backward compat). New rows contain the wrapped object. encryptJson() and decryptJson() in lib/encryption.ts are the only functions that should touch this pattern. Do not attempt to partially encrypt fields within the JSONB — the entire array is encrypted as a single string. The column type remains JSONB (no schema change). Supabase's JSONB operators (e.g. the ? operator for key existence) are used in the SQL audit queries to detect encrypted vs plaintext rows: `matches_json ? '_enc'` returns true for encrypted rows. Supabase's built-in email has no domain authentication (poor deliverability), no custom sender name, and no template control beyond basic variable substitution. Resend provides: proper SPF/DKIM/DMARC on quorumvault.org, reliable inbox placement, and full HTML template support. Config lives in Supabase Project Settings → Authentication → SMTP (host: smtp.resend.com, port 465, username: resend, password: Resend API key). The Resend API key is a Railway/Supabase secret — never commit to source. The Magic Link template uses `{{ .ConfirmationURL }}` as the only Supabase-injected variable. If the Resend API key is rotated, update the Supabase SMTP password field immediately — Magic Link emails will fail silently if the key is invalid. Template HTML is stored externally (not in codebase) — keep a copy in `/mnt/user-data/outputs/` or a design asset store as the source of truth.

---

## CHUNK 1 + 2 TEST LOG (validate on next session)

### DecisionStateCard
- [ ] After synthesis completes, "Before you close — where does this leave you?" prompt appears
- [ ] Clicking "Capture position" expands to 3-field form
- [ ] Quick date shortcuts (+1 week / +2 weeks / +1 month) pre-fill date picker correctly
- [ ] Save with only leaning field filled → saves; saved state shows leaning text
- [ ] Save with only review_date filled → saves; saved state shows review date badge
- [ ] Save with no fields → validation error "Add where you're leaning or a review date"
- [ ] Skip at prompt → component disappears (nothing saved to DB)
- [ ] Saved state: "Edit" button opens form back in pre-filled state
- [ ] Review date badge formats correctly (e.g. "Review by Jun 11, 2026")
- [ ] POST /api/session/commitment returns 200; DB row has encrypted commitment_leaning
- [ ] GET /api/session/commitment?sessionId=X returns decrypted commitment for saved session

### RuleRecallBanner
- [ ] Banner appears BEFORE examiner submission (when ontology is ready, alongside examiner questions)
- [ ] Banner does NOT appear after examiner is submitted (window closed)
- [ ] User with ≥8 sessions + mirror access → rule text appears with 3 action buttons
- [ ] User with <8 sessions → banner silently absent (no error, no empty state)
- [ ] "Apply this rule" → banner dismisses; PATCH saves 'applied' + rule text to DB
- [ ] "Apply this rule" + then submit examiner → Council personas include rule in their context
- [ ] "Note as exception" → banner dismisses; PATCH saves 'exception' to DB
- [ ] "Dismiss" → banner dismisses; PATCH saves 'ignored' to DB
- [ ] Submitting examiner WITHOUT making a choice → banner auto-dismisses cleanly (no DB write)

### Monthly Judgment Review (Loop Closure)
- [ ] Module appears in Mirror after SessionReliabilityIndex
- [ ] decisions_total = 0 → module silently absent
- [ ] Window label shows "All time" when total sessions < 10; "Last 30 days" when ≥ 10
- [ ] Loops closed % colour: gold ≥60%, neutral 30–59%, red <30%
- [ ] Sessions with commitment_review_date in the past → appear in open loops list with red "Xd overdue" badge
- [ ] Sessions >14 days old with no outcome and no review date → appear in open loops list
- [ ] Sessions with outcome filed → do NOT appear in open loops list
- [ ] Open loop rows link to /session/[id]
- [ ] 404 absent: route file at app/api/mirror/monthly-review/route.ts exists and deployed


## SPRINT R_JC TEST LOG (validate before marking deployed)

### Piece 1 — Prior Principles Block (fetchUserPrinciplesBlock)
- [ ] User with ≥3 sessions + ≥3 C0 responses → synthesisBlock includes STATED SUCCESS CRITERIA section
- [ ] User with <3 C0 responses → STATED SUCCESS CRITERIA absent; synthesis fires normally (silent no-op)
- [ ] C0 responses arrive as plaintext in synthesisBlock — no `enc:` ciphertext blobs visible
- [ ] Synthesis surfaces criteria as natural prose reference, not as a labelled section header
- [ ] Synthesis omits the criteria entirely when they are not relevant to the Council's analysis

### Piece 2 — Recurring Regret Block (fetchRecurringRegretBlock)
- [ ] User with ≥5 sessions + ≥2 `worse_than_expected` outcomes sharing ≥2 high-score dims → regret signal fires in synthesisBlock
- [ ] User with <5 sessions → regretBlock is `''` (silent no-op)
- [ ] User with ≥5 sessions but zero `worse_than_expected` outcomes → regretBlock is `''`
- [ ] Regret signal surfaces as plain observation in synthesis prose; no section header; not framed as prediction
- [ ] Synthesis omits regret signal if Council analysis does not connect to the structural dims that triggered it

### Piece 3 — Examiner Bias Hint (fetchExaminerBiasHint)
- [ ] User with ≥1 confirmed bias (detection_count ≥3) → personaliseRuleQuestion prompt includes bias hint
- [ ] User with only forming biases (detection_count <3) → biasHint is `''`; prompt unchanged from pre-R_JC
- [ ] C0 question for a confirmed `fomo_urgency` user → question noticeably harder on time-pressure framing
- [ ] Rule question unrelated to the confirmed bias → personalises to decision text normally (bias hint ignored by model)
- [ ] Anonymous session (no user_id from sessions query) → biasHint is `''`; examiner functions identically to before
- [ ] biasHint passed to both C0 personalisation AND all rule question personalisations


## R4 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R4-1 | Mirror unlocked user — open Mirror, scroll to Session Reliability Index | Module renders below Confidence Calibration. Average score (large number) + trend delta visible. Per-session list shows last ≤10 decisions. |
| R4-2 | Hover any sub-score dot on a session row | Tooltip appears: label + exact score (e.g. "Structural: 78/100"). Disappears on mouse-out. |
| R4-3 | User with ≥5 sessions — mix of sessions with outcomes logged and sessions without | Sessions missing outcomes show yellow calibration dot (score=70). Sessions with calibration_delta ≥ 0 show teal dot (score=85). Sessions with delta < −0.3 show red/yellow dot. |
| R4-4 | User with a recurring distorting bias across ≥2 sessions | "Your next move" callout names the specific bias label (not generic copy). Gold left-border card always visible — never absent. |
| R4-5 | User whose sessions contain a REDIRECT rule result | Council confidence dot red (score=35) for that session. If >40% of sessions are REDIRECTs, action plan references the redirect pattern specifically. |
| R4-6 | User with ≥10 sessions | Trend delta line appears: "↑ N pts over last 5 sessions" or "↓" or "→ stable". Only appears when prior 5 sessions exist (≥6 sessions total). |
| R4-7 | User with only 1–2 sessions (no structural history yet) | Structural sub-score dots neutral (score=50 = yellow). Action plan reads: "Structural matching activates once Quorum has prior sessions…" Module renders without error. |
| R4-8 | Mirror locked or teaser user | GET /api/mirror/session-score returns 403. Component returns null — no empty state rendered, no error shown. |
| R4-9 | Check Railway logs during module load | No errors from computeUserSessionScores(). Three parallel DB queries complete in single round-trip. No "actionPlan is missing" TypeScript errors at runtime. |

---

## PENDING / NEXT SESSION

- **Sprint TB1 (June 21, 2026) — Track B done; this is the new explicit starting point for the next session:**
  - **Decision Graph build is next**, scoped across up to 4 sprints — start there.
  - Logged but not done this sprint: split `lib/supabase.ts` into a browser-safe file (`createClient`) and a server-only file (`createServiceClient`, gets the `server-only` guard) — correct fix for full guard coverage, but `createServiceClient` has 57 import sites, too large to fold into TB1. Worth scoping as its own small sprint before it's forgotten, not urgent.
  - `npm test` now exists (`vitest`) — run it before any future patch touching `app/api/persona/route.ts`, `lib/bias-scorer.ts`, `lib/rule-engine.ts`, or `lib/persona-relevance.ts`. Currently 15 tests, all logic-level (no live API calls) — extend `tests/council-synthesis-chain.test.ts` rather than starting a new file if adding rule-engine/relevance coverage.
  - `package-lock.json` was deliberately left out of the TB1 patch (regenerated cleanly via `npm install` after pulling `package.json`'s 3 new devDependencies — `server-only`, `vitest`, `vite-tsconfig-paths` — and 2 new scripts).
- **Sprints RET-1/2/3 (June 20, 2026) — pending verification / next steps:**
  - **None of RET-1/2/3 have been staging- or production-tested yet** — all three were implemented and code-reviewed in-session but not deployed/verified live as of this handover. Use the new RETENTION SPRINT TEST LOG section below as the test script before marking deployed.
  - Visually confirm the Decision Brief PDF light-mode palette (`LIGHT_PALETTE` in `brief/route.ts`) at 300dpi print quality — chosen for legibility but not yet visually proofed against an actual generated PDF.
  - Delete `app/api/brief-access/route.ts` (dead code, nothing calls it post-RET-1/RET-2) and remove `BRIEF_ACCESS_TOKEN` from Railway env vars whenever convenient — safe to do anytime, no code path reads either.
  - Confirm `EmailCaptureCard` → `/api/auth` → magic-link email round-trip works end-to-end from the record page specifically (the endpoint itself is pre-existing and already used elsewhere, but this is a new call site).
  - Confirm `BiasNoteCard` renders correctly for a `device_id`-only (anonymous, no email) session — this is the one new surface this sprint that deliberately supports that identity tier; verify the `bias_library` query resolves correctly when `identityCol === 'device_id'`.
  - Confirm `EarlyEchoCard`'s echo-hint upgrade at session 3+ degrades silently and correctly for a user with no linked email (should show count-only copy, no error, no visible loading state) — this is the by-design `{ available: false, reason: 'no_identity' }` path from KDD 192.
  - **Levers (i) and (ii) of SECOND-USE RETENTION STRATEGY §5 are fully shipped** (lever (i): Sprint RET-5 June 22; lever (ii): Sprint RET-4 June 21). Lever (iii) remains parked — product-policy decision, must be scoped with Ken before any code is written. **⚑ Post-95+ priority:** once retention score confirmed at 95+, next step is end-to-end email + push notification audit before any other new work.
- **Sprint CX-PAY (June 16, 2026) — pending verification / next steps:**
  - Razorpay KYC was "Under Review" (step 2 of 3) as of June 15 — confirm completion, then swap `NEXT_PUBLIC_RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from `rzp_test_`/test-mode values to `rzp_live_`/live-mode values in Railway. No code change required.
  - Confirm `RAZORPAY_MONTHLY_PLAN_ID` and `RAZORPAY_ANNUAL_PLAN_ID` are LIVE-mode plan IDs once KYC clears — plans created in test mode do not carry over; may need to be recreated under live mode in the Razorpay dashboard.
  - Re-verify `RAZORPAY_WEBHOOK_SECRET` is saved correctly in the Razorpay dashboard (it failed to save on first attempt pre-deploy with "json request could not be decoded" — confirmed resolved post-deploy, but worth one more check that "Secret: Not provided" no longer shows in the webhook details panel).
  - First real-money subscription (once live keys are active) should be manually watched end-to-end in Railway logs for `[webhook] subscription.activated` and a confirmed `mirror_access` row — the test-mode flow worked, but a live-mode first transaction has not yet been observed.
  - Renewal path (`payment.captured` extending `expires_at` on a second/third billing cycle) has not been observed yet — only the initial `subscription.activated` flow has been tested. Will naturally validate itself on the first user's second billing cycle; no action needed unless it fails.
  - Cancellation flow tested and confirmed working by Ken (June 16) — no further action needed unless an edge case surfaces (e.g. a user who unlocked via code, not Razorpay, attempting to use the in-app cancel button — this returns a "contact us" message by design, not a crash, but hasn't been manually verified with a real code-activated account).
  - Consider whether `package-lock.json` should eventually be regenerated on a machine with Node available (rather than relying on `nixpacks.toml`'s `npm install` override indefinitely) — not urgent, current setup works correctly, but `npm ci`'s stricter guarantees are nice-to-have once Ken has any working local Node environment.
- **DeepSeek model upgrade (June 13, 2026) — verify after deploy:**
  - Confirm Railway env vars set: `DEEPSEEK_MODEL=deepseek-v4-pro`, `DEEPSEEK_THINKING=disabled`.
  - Check Railway deploy logs — confirm build passes (TypeScript error on `streamDeepSeek` overload resolution resolved in v41).
  - Spot-check a Council session: persona streaming should feel at least as fast as before; no blank pause before first token (thinking=disabled confirms this).
  - Safe to remove `MIRROR_TOKEN_LIFETIME` and `MIRROR_UNLOCK_TOKEN` from Railway whenever convenient — `/api/mirror/unlock` no longer reads them (KDD 172).
- **Engagement + PWA Sprint (June 11, 2026) — pending verification:**
  - Run `supabase/sprint_reanalyze_email.sql` and `supabase/sprint_pwa_push.sql` if not yet executed.
  - Set new env vars in Railway: `RESEND_API_KEY`, `FROM_EMAIL=Quorum <auth@quorumvault.org>`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  - Add Railway/cron-job.org cron: daily `0 8 * * *` → `POST /api/cron/reanalyze-email` with `Authorization: Bearer $CRON_SECRET`.
  - First live cron run not yet observed — verify Railway logs show `[ReanalyzeEmail] Pass complete` with sent/skipped/errors counts, and confirm sender now shows "Quorum" not "AUTH".
  - Verify `/api/version` and UpdateBanner after next deploy — confirm banner appears once, "Refresh" reloads cleanly.
  - PWA install + push verified once on Android (real device). iOS 16.4+ "Add to Home Screen" → push flow not yet tested on a real iPhone.
  - Documented (no code) — auth + install ordering guidance for new vs existing users, and duplicate-icon-across-browsers platform limitation. See KNOWN GAPS.
- Mirror UX overhaul (M1–M6) fully shipped as of June 9, 2026.
- DB migration to run if not yet executed: `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ;`
- Consider M4+ deferred item: `first_confirmed_at TIMESTAMPTZ` column on bias_library for precise "New" badge timing (currently approximated via lastFiredAt from session dates — see KDD 154).
- Consider Sprint M5 deferred: API batching — combine some Mirror module fetches into a single /api/mirror/bundle call for faster initial load (8–10 parallel calls currently).
- Quorum website copy sync after Mirror UX changes (website likely still references old Mirror description).

## ENGAGEMENT + PWA SPRINT TEST LOG (June 11, 2026)

| # | Test | Expected | Status |
|---|---|---|---|
| EP-1 | Open `/manifest.json` directly | JSON loads, `display: standalone`, icon-192/512 paths resolve | ✅ Verified |
| EP-2 | Open `/sw.js` directly | JS loads. Response headers include `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /` | ✅ Verified |
| EP-3 | Android Chrome — install prompt | "Add to Home Screen" banner appears within ~30s–2min of opening app + having ≥1 session | ✅ Verified |
| EP-4 | Install + open from home screen icon | Launches full-screen, no browser chrome, themed status bar (#0a0a0a) | ✅ Verified |
| EP-5 | New icon rendering | Home screen icon shows gold "Q" lettermark on dark bg, not blurry scaled wordmark | ✅ Verified |
| EP-6 | PushEnablePrompt — Android, ≥1 session, authToken present | 🔔 "Get nudged on open decisions" card renders below MemoryEngineStatus | ✅ Verified |
| EP-7 | Tap Enable | SW registers, permission dialog appears, on Allow → POST /api/push/subscribe succeeds → success state shown 3s then hides | ✅ Verified |
| EP-8 | Check Supabase `push_subscriptions` after EP-7 | One row: user_id, endpoint, p256dh, auth_key, last_used_at populated | ✅ Verified |
| EP-9 | iOS Safari (not standalone) — PushEnablePrompt | 📲 "Add to Home Screen" tip card shown instead of Enable button | ⏳ Not yet tested on real iPhone |
| EP-10 | iOS — after Add to Home Screen, open from icon | 🔔 Enable prompt now shown (standalone mode detected) | ⏳ Not yet tested |
| EP-11 | Build — TypeScript strict check | No error on `urlBase64ToUint8Array` / `pushManager.subscribe()` (Uint8Array<ArrayBuffer> fix) | ✅ Verified (build passed) |
| EP-12 | MirrorOpenLoopCard — user with 1–2 sessions, not unlocked | "N more decisions to confirm your first pattern" + pulsing dot + Preview link shown on home | ⏳ Pending UI check |
| EP-13 | MirrorOpenLoopCard — user with 3+ sessions, teaser-eligible, not unlocked | Gold-bordered card, "X patterns forming in your record", blurred bias labels, "Open your Mirror →" | ⏳ Pending UI check |
| EP-14 | MirrorOpenLoopCard — Mirror-unlocked user | Card renders nothing (PatternSurfaceCard covers this segment) | ⏳ Pending UI check |
| EP-15 | Run `supabase/sprint_reanalyze_email.sql` | `email_send_log` table created, unique constraint on (session_id, email_type) | ⏳ Pending — run migration |
| EP-16 | Set RESEND_API_KEY + FROM_EMAIL=Quorum <auth@quorumvault.org> in Railway | Variables saved | ⏳ Pending |
| EP-17 | Add cron `0 8 * * *` → POST /api/cron/reanalyze-email with Bearer CRON_SECRET | cron-job.org shows scheduled job | ⏳ Pending |
| EP-18 | Manually trigger reanalyze-email cron (Force Execute) | Railway logs: `[ReanalyzeEmail] Pass complete — sent: N, skipped: N, errors: 0`. Response 200 `{ ok: true, sent, skipped, errors, elapsed_ms }` | ⏳ Pending first run |
| EP-19 | Inspect a sent reanalyze email | Sender shows "Quorum", subject = "<decision snippet> — Nd days later", body has decision snippet (italic), confidence line if present, single CTA, "One nudge per milestone" footer | ⏳ Pending — verify FROM_EMAIL fix in practice |
| EP-20 | Check `email_send_log` after EP-18 | One row per sent email; re-running cron immediately does not duplicate-send (unique constraint holds) | ⏳ Pending |
| EP-21 | Push fired alongside reanalyze email | `sendPushToUser()` called non-blocking; if user has a push_subscriptions row, notification appears with title "Nd days later" | ⏳ Pending |
| EP-22 | Deploy a new commit. Open app in existing tab/PWA | Within 5 min (or on next focus/visibility change), top banner "A new version of Quorum is available. [Refresh]" appears | ⏳ Pending — verify after next deploy |
| EP-23 | Tap Refresh on UpdateBanner | `window.location.reload()` — page reloads with new bundle, banner does not reappear (new baseline matches) | ⏳ Pending |
| EP-24 | UpdateBanner — no new deploy | Banner never appears; polling continues silently every 5 min + on focus | ⏳ Pending |

## MIRROR UX OVERHAUL — TEST LOG (June 8–9, 2026)
### Sprints M3, M1, M2+M4, M5+M6

**QA methodology:** Two user journeys tested — (A) 4-decision unlocked user, (B) 50-decision+ unlocked user.

#### Sprint M3 — The Unlock Moment
| Check | User | Result |
|---|---|---|
| WelcomeMirrorCard renders on first Mirror open | A | ✅ |
| "Active Now" column lists Fingerprint, Independence, Timeline, Patterns | A | ✅ |
| "Still Building" column lists Implicit Rules (8), Contradictions (10+), Calibration (outcomes) | A | ✅ |
| × button and "Got it →" both set quorum_mirror_welcomed and dismiss card | A | ✅ |
| Card does not reappear on page refresh after dismissal | A | ✅ |
| MirrorSummaryCard appears after WelcomeMirrorCard dismissed | A | ✅ |
| ThresholdGate shows "Unlocks at 8 decisions" label in gold | A | ✅ |
| ThresholdGate shows "N decisions away" countdown headline | A | ✅ |
| Progress dots correct (e.g. 4 filled, 4 empty for session 4) | A | ✅ |
| topBiasLabel personalised italic line renders when teaserBiases populated | A | ✅ |
| topBiasLabel absent gracefully when teaserBiases empty | A | ✅ |
| ContradictionDetector shows "Building the map" label (not "Detection initialising") | A | ✅ |
| ContradictionDetector milestone 0 excerpt renders: "This isn't an assessment…" | A | ✅ |
| teaserBiases populated for unlocked users in /api/mirror/status response | A | ✅ |

#### Sprint M1 — The Living Digest
| Check | User | Result |
|---|---|---|
| MirrorSummaryCard loads with skeleton then resolves | Both | ✅ |
| Independence score + delta arrow render correctly | Both | ✅ |
| Pattern count shows confirmed count; forming count in sub-label | Both | ✅ |
| Open loop count highlighted in gold when > 0 | B | ✅ |
| Sessions count correct | Both | ✅ |
| "Next move" action row renders from SRI actionPlan | Both | ✅ |
| "In your own words" examinerQuote renders (not encrypted enc:...) | Both | ✅ |
| sinceLastVisit delta line appears on second+ visit | Both | ✅ |
| sinceLastVisit absent on first visit (lastViewedAt = null) | A | ✅ |
| last_mirror_viewed_at updated in user_preferences after each Mirror open | Both | ✅ |
| MirrorSummaryCard returns null silently on API error — modules still load | Both | ✅ |
| SummaryData exported from MirrorSummaryCard.tsx | — | ✅ |
| onData callback fires when data resolves | Both | ✅ |

#### Bugfixes (June 8, 2026)
| Check | Result |
|---|---|
| outcome.what_decided shows decrypted text in "What did you decide?" field | ✅ |
| MemoryEngineStatus does not show "Pattern Memory active" at 4 sessions | ✅ |
| MemoryEngineStatus shows "Mirror active" when mirrorUnlocked but sessionCount < 5 | ✅ |
| MemoryEngineStatus shows "Pattern Memory active · Mirror active" correctly at 5+ sessions | ✅ |
| MonthlyJudgmentReview open loops list shows max 5 by default | ✅ |
| "Show N more decisions" expands to full list; "Show fewer decisions" collapses | ✅ |
| Build error fix: catch (_e) applied in mirror-fingerprint.ts | ✅ |
| Build error fix: orphaned fetch chain removed from MonthlyJudgmentReview.tsx | ✅ |

#### Sprints M2 + M4 — Navigation, Freshness Signals
| Check | User | Result |
|---|---|---|
| MirrorNav sticky bar visible below header after welcome dismissed | Both | ✅ |
| All 8 pills present (Fingerprint through Timeline) | Both | ✅ |
| Clicking each pill scrolls to correct section | Both | ✅ |
| IntersectionObserver highlights active pill while scrolling | Both | ✅ |
| Active pill auto-scrolls into view on mobile (horizontal strip) | Both | ✅ |
| Mobile pill touch targets ≥ 36px height | Both | ✅ |
| Section collapse chevron collapses/expands content | Both | ✅ |
| Collapse state persists across page refresh (localStorage JSON) | Both | ✅ |
| "?" toggle hides/shows section description text | Both | ✅ |
| Description-hide state persists across page refresh | Both | ✅ |
| Decision Timeline appears above Bias Fingerprint for sessionCount < 10 | A | ✅ |
| Decision Timeline appears at bottom for sessionCount ≥ 10 | B | ✅ |
| MonthlyJudgmentReview appears above Bias Fingerprint when openLoopCount > 0 | B | ✅ |
| MonthlyJudgmentReview at default position when no open loops | Both | ✅ |
| Section type borders: urgent/coral, core/gold, deep/blue, archival/grey | Both | ✅ |
| secFadeIn animation with staggered delay across sections | Both | ✅ |
| "Active" green badge on bias tiles fired within 14 days | B | ✅ |
| No "Active" badge on bias tiles with lastFiredAt > 14 days | B | ✅ |
| "↑ Increasing" amber badge on patterns with recent_fire_count > 2 | B | ✅ |
| No "↑ Increasing" badge on patterns with low recent fire rate | B | ✅ |
| "Latest" gold badge on first SRI row only | Both | ✅ |
| "N dismissed · M active" ratio visible in Contradiction Detector when dismissals exist | B | ✅ |

#### Sprints M5 + M6 — Attention Zone + Intelligence
| Check | User | Result |
|---|---|---|
| AttentionZone absent when no urgent signals | Both | ✅ |
| Coral card renders when newContradictions > 0 | Both | ✅ |
| Amber card renders when openLoopCount ≥ 2 | Both | ✅ |
| Blue card renders when |scoreDelta| ≥ 5 | Both | ✅ |
| Max 3 cards rendered | Both | ✅ |
| "× " dismiss removes card for session duration | Both | ✅ |
| Cards re-derive on next Mirror visit (dismissed state resets) | Both | ✅ |
| Scroll-to link scrolls to correct section via msec-{key} | Both | ✅ |
| MirrorNav dot badge visible on highlighted section | Both | ✅ |
| REDIRECT session mode → Independence Score section highlighted | Both | ✅ |
| GATE session mode → Contradiction Detector section highlighted | Both | ✅ |
| secPulse gold outline animation plays on highlighted section | Both | ✅ |
| MirrorInsightCard renders above Bias Fingerprint | Both | ✅ |
| MirrorInsightCard absent when sessionCount < 5 | A | ✅ |
| MirrorInsightCard absent when no synthesis rule fires | Both | ✅ |
| Correct synthesis rule fires for open loops + score drop scenario | B | ✅ |
| Correct synthesis rule fires for REDIRECT + high independence score | B | ✅ |
| No API call made by AttentionZone or MirrorInsightCard | Both | ✅ |

## RESOLVED / CLOSED

- **Sprint CX-PAY — Razorpay self-serve payment + cancellation (June 16, 2026)** → ✅ Implemented + spot-tested. Full self-serve subscription checkout replacing manual unlock-code-and-bank-transfer for new conversions. `create-subscription/route.ts` rewritten to Bearer user auth. `webhook/route.ts` (NEW) — HMAC-verified, handles activation/renewal/cancellation. `PaymentButton.tsx` (NEW) — themed checkout modal. `cancel-subscription/route.ts` + `CancelSubscription.tsx` (NEW) — cancel-at-cycle-end flow, confirmed working live. Infra: `nixpacks.toml` (NEW) fixes `npm ci` lock-file failure; `next.config.ts` CSP patched across 4 directives + Permissions-Policy for Razorpay domains. KYC pending for live keys — test-mode flow fully verified. KDDs 182–186.
- **Sprint CX1 — TeaserView conversion fix (June 15, 2026)** → ✅ Implemented. `lockedBadge` text/colour/icon changed from ambiguous grey "building" to gold "Mirror" + lock icon + scroll-to-CTA. CTA card rewritten with explicit "Unlocks these sections:" feature list; `UnlockCodeInput` promoted above the plans link. Zero-bias copy disambiguated from "compiled" loading language. 1 file changed. KDDs 180–181. Superseded in part by CX-PAY (June 16) — plans link replaced by inline PaymentButton.

- **DeepSeek model upgrade + copy fixes (June 13, 2026)** → ✅ Implemented. `lib/ai-client.ts`: `DEEPSEEK_MODEL` default updated to `deepseek-v4-pro` (replaces deprecated `deepseek-chat`); `DEEPSEEK_THINKING` constant added (default: `disabled`); `thinking: { type: DEEPSEEK_THINKING }` injected into both `streamDeepSeek` and `createCompletion` DeepSeek paths; TypeScript overload-resolution bug fixed (`create({...} as any) as any` + `as AsyncIterable<any>` on `withRetry` result); temperature guard added for thinking=enabled path; `getProviderInfo()` extended with `deepseekThinking`. `app/mirror/page.tsx`: `PRICING_URL` `www.` prefix removed; advisor comparison copy updated to `₹5 lakh/year`. Railway env vars to set: `DEEPSEEK_MODEL=deepseek-v4-pro`, `DEEPSEEK_THINKING=disabled`. KDDs 176–179. TD-3 logged (per-call thinking mode control, deferred).

- **Sprint S0 — Subject Orientation + Examiner Redesign (June 12, 2026)** → ✅ Implemented. app/api/examiner/route.ts: S0_TEMPLATES (5 variants), C0_TEMPLATES (5 variants), pickTemplate() utility, S0 trigger (wordCount < 25 AND !hasContext), ruleSlotBudget (1 with S0 / 2 without), parallel Promise.all personalisation, updated early-exit guard, context_text added to session SELECT. components/ExaminerPanel.tsx: tagline updated to "Key questions", BRIEF badge for S0 (RULE_HINTS + label renderer). 2 files modified. KDDs 163–170 added.

**Mirror UX Overhaul — Sprints M1–M6 (June 8–9, 2026) — RESOLVED.**
All 21 audit recommendations across P0–P3 priority matrix implemented. 5 new files (MirrorSummaryCard.tsx, MirrorNav.tsx, AttentionZone.tsx, MirrorInsightCard.tsx, api/mirror/summary/route.ts). 15+ modified files. DB migration documented (last_mirror_viewed_at). 4 concurrent bugfixes (encrypted outcome, Pattern Memory active guard, open loops show-more, examiner quote decrypt). Build error fix: SWC empty catch syntax, orphaned fetch chain in MonthlyJudgmentReview.


*(All items from v27 carried forward unchanged)*

- **Sprint B hybrid routing — all 9 call-site patches (June 7, 2026)** → ✅ Confirmed deployed via code audit. persona/route.ts, examiner/route.ts ×2, mirror/rules/route.ts, record/[id]/brief/route.ts, voice/cleanup/route.ts, lib/bias-scorer.ts, lib/structural-retrieval.ts, lib/mirror-fingerprint.ts, lib/contradiction-detector.ts ×2. All provider flags present. ontology-tagger.ts: direct SDK instances removed, routes via ai-client. All ⏳ markers in codebase map cleared.
- **SQL migrations sprint4/5/6 (June 7, 2026)** → ✅ Confirmed run in Supabase. RLS hardening active (4 tables). bias_library.user_id FK + partial unique index live. audit_log table exists.
- **admin/encrypt-migrate/route.ts deletion (June 7, 2026)** → ✅ File deleted. Confirmed absent from codebase. Backfill migration ran June 2, 2026; file retained only until confirmed. Now removed.
- **IST timezone migration (June 7, 2026)** → ✅ RecordExport.tsx: imports formatLongDate() from lib/dates.ts; inline toLocaleDateString with Asia/Kolkata removed. CalibrationSparkline.tsx: imports formatShortDate() from lib/dates.ts; local formatDate() function removed; 4 call-sites updated. No remaining inline Asia/Kolkata strings outside lib/dates.ts.
- **Security & Disclosure Sprint (June 7, 2026)** → ✅ public/.well-known/security.txt (RFC 9116 VDP). scripts/rotate-encryption-key.ts (manual rotation utility, all 5 tables + JSONB). app/security/page.tsx updated (2 items moved from NOT_YET to IMPLEMENTED, NOT_YET reduced 6→5). KDDs 146–147 added.

- **Audit R9 (Identity overfitting — confirmed threshold too low)** → ✅ Fixed June 1, 2026. Confirmed threshold raised from ≥2 to ≥3 in mirror-fingerprint.ts and bias-scorer.ts. Forming tile builder made dynamic for detection_count 1–2. BiasFingerprint.tsx copy updated. Deploy pending.
- **Audit R10 (Style calibration bias in persona ordering)** → ✅ Permanently skipped. Audit verdict: LOW RISK, working as designed. Locked as KDD 110. No code required.
- **Admin dashboard "Network error" bug (June 1, 2026)** → ✅ Fixed. Two causes: (1) `fetchDashboard` declared after `useEffect` — TDZ reference in React strict-mode; fixed by moving `fetchDashboard` above `useEffect` and correcting dep array to `[fetchDashboard]`. (2) Unhandled route errors returned HTML not JSON — `res.json()` threw, caught as "Network error"; fixed by wrapping route in top-level try/catch returning JSON 500. Root trigger in production: ADMIN_CODE contained non-ASCII character (emoji/special symbol) — `fetch()` threw before even sending the request. Fixed by user removing non-ASCII characters from ADMIN_CODE. See KDDs 111 and 112.
- **Additional Risk D — D3 (Mirror surface, dismiss, synthesis resubmission)** → ✅ Implemented June 1, 2026. components/AvoidanceAlertCard.tsx (NEW). app/api/mirror/avoidance/dismiss/route.ts (NEW). app/api/mirror/alerts/route.ts updated. app/api/persona/route.ts updated. app/mirror/page.tsx updated. app/page.tsx updated. components/SynthesisCard.tsx updated. Full R11 loop complete: D1 schema → D2 detection → D3 surface → dismiss → synthesis context. Deploy pending.

- **Audit R11 (Heuristic thresholds not configurable)** → ✅ Fixed June 1, 2026. All 7 threshold constants now env-configurable via Railway. Admin dashboard R11 section added (effectiveThresholds + avoidance stats). .env.example updated. Deploy pending. D3 (AvoidanceAlertCard) remains parked. C0 now always fires regardless of rule count. One condition removed from examiner/route.ts.
- **R4 (No unified decision scoring layer)** → ✅ Implemented May 31, 2026. lib/session-score.ts (NEW) — computeUserSessionScores() + deriveActionPlan(). app/api/mirror/session-score/route.ts (NEW). components/SessionReliabilityIndex.tsx (NEW). lib/types.ts + app/mirror/page.tsx updated. TypeScript fix: Omit<SessionScoreData, 'actionPlan'> intermediate array. No schema change, no LLM. Deploy pending.
- **R3 (Council Weighting Directive — flat synthesis aggregation)** → ✅ Implemented May 31, 2026. lib/persona-relevance.ts created. persona/route.ts updated. Deploy pending.
- **R5 (Structural context injected as text only, no output traceability)** → ✅ Implemented May 31, 2026. Conditional OUTPUT TRACEABILITY requirement appended to structuralBlock in persona/route.ts. One functional change (~4 lines). Deploy pending.
- **Additional Risk A (recency_bias hardcoded to 'neutral')** → ✅ Confirmed pre-existing fix (Sprint R2). classifyBiasSignal() in bias-scorer.ts already returns 'distorting' when ddInfo ≥ 4. No new files needed.
- **Additional Risk B (C0 suppression on complex decisions)** → ✅ Same as C0 fix above. Resolved May 31, 2026.
- **Additional Risk C (benchmark vs structural retrieval math inconsistency)** → ✅ Fixed May 31, 2026. lib/similarity.ts (NEW). structural-retrieval.ts imports DIM_WEIGHTS from it. benchmark/route.ts extractVector() now applies dim weights. Deploy pending.
- **Chunk 1 + Rule Recall fixes + Chunk 2 (June 4, 2026)** → ✅ Deployed. Decision State + Switch Conditions (DecisionStateCard, 3 clubbed fields), Rule Recall (RuleRecallBanner, timing + injection both fixed), Monthly Judgment Review (MonthlyJudgmentReview, Loop Closure Mirror module). 9 new files, 5 modified, 1 migration (6 columns on sessions), 0 new env vars.
- **Sprint R_JC — userJudgmentContext() three missing pieces** → ✅ Implemented June 2, 2026. `fetchUserPrinciplesBlock()` (C0 principles, decrypt-aware, gate ≥3), `fetchRecurringRegretBlock()` (dimensional overlap, gate ≥5 sessions + ≥2 bad-outcome matches), `fetchExaminerBiasHint()` (confirmed biases only, exported). `fetchUserBiasContext()` restructured to 2-round parallel (session IDs shared). Examiner route now bias-aware on all personalisation calls. Deploy pending.
- **Additional Risk E (calibration delta and contradiction data not reaching synthesis)** → ✅ Fixed May 31, 2026. lib/bias-scorer.ts only. fetchCalibrationContext() + fetchActiveContradictions() added (private). fetchUserBiasContext() extended with parallel queries and synthesisBlock addenda. Directive extended with example phrasings enforcing plain-language, prose-woven output. One file changed. Deploy pending.
- **Additional Risk F (synthesis has no access to bias signals)** → ✅ Confirmed pre-existing fix (Sprint R2). fetchUserBiasContext() in lib/bias-scorer.ts already returns synthesisBlock + personaAlert. Both firing correctly. No new files needed.

- **Fix 1 (Light mode button visibility — June 2, 2026)** → ✅ Implemented. 8 semantic CSS tokens added to globals.css (--info-text/bg/border, --success-text/bg/border, --overlay-bg/hover) with correct dark + light values. 9 component files updated: PersonaPanel.tsx, SynthesisCard.tsx, CouncilStatusBar.tsx, OutcomeTracker.tsx, ReanalyzeDrawer.tsx, ExaminerPanel.tsx, AuthPanel.tsx, IndependenceScore.tsx, app/mirror/page.tsx. Root cause: three classes of hardcoded dark-only values invisible/illegible in light mode. See KDD 116.
- **Security Sprint (Field encryption — June 2, 2026)** → ✅ Complete. lib/encryption.ts (AES-256-GCM, enc: prefix, JSONB {_enc} wrapper). 21 files patched across 5 write paths and 16 read paths. app/api/admin/encrypt-migrate/route.ts (NEW, temporary — delete after use). scripts/test-encryption.ts (NEW). Backfill endpoint called June 2, 2026. SQL audit verified 0 plaintext rows in all 5 encrypted tables. DB_ENCRYPTION_KEY set in Railway. KDDs 118–120 logged.

- **Security Sprint (Application-level AES-256-GCM field encryption — June 2, 2026)** → ✅ Deployed + backfill complete. lib/encryption.ts (NEW). 21 files patched across all write and read paths. app/api/admin/encrypt-migrate/route.ts (NEW, temporary — delete after use). scripts/encrypt-existing.ts (NEW). scripts/test-encryption.ts (NEW). Backfill migration run June 2, 2026. SQL audit confirmed 0 plaintext rows across all 5 encrypted tables. DB_ENCRYPTION_KEY added to Railway env vars. See KDDs 118–120.

- **Fix 2 (Supabase Magic Link via Resend — June 2, 2026)** → ✅ Live. Resend domain verified. Supabase SMTP configured (smtp.resend.com:465). Branded HTML Magic Link template active in Supabase Auth → Email Templates. See KDD 117.
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

- **PWA: duplicate home-screen icons across browsers.** Installing "Add to Home Screen" from Chrome, then again from Gmail's in-app browser (or any other browser), creates a separate icon with separate storage/auth on Android — no fix possible at the web-app level (each browser engine is a distinct install context). User guidance: always install AND complete magic-link auth in the same browser (Chrome recommended); avoid installing from in-app browsers (Gmail/WhatsApp/Instagram webviews).
- **PWA + magic-link auth ordering.** Supabase JS uses PKCE flow with the code_verifier in localStorage of the browser that initiated `signInWithOtp` — opening the magic link in a different browser can fail `exchangeCodeForSession`. New users: open the signup link in Chrome → complete first decision → open magic link in Chrome (not Gmail's in-app browser) → THEN "Add to Home Screen" from Chrome, so the installed icon shares Chrome's session storage. Existing users: same rule — always open magic links in the same browser used to install.
- **UpdateBanner reload is manual by design.** `/api/version` mismatch shows a banner but never auto-reloads — avoids interrupting an in-progress decision/voice session. If a user keeps an installed PWA open for days without tapping Refresh, they may run stale frontend against a newer backend API. Acceptable at current scale; revisit if API contract changes become more frequent/breaking.
- **Email auto-link on fresh magic-link login:** ✅ Confirmed resolved in code — `loadHistory` in page.tsx line 181 calls `setUserEmail(authSession.user.email)` after getSession(). Verify in production if AuthPanel re-appearance is observed.
- **Private benchmarking Phase 2** (outcome data, N≥50) — after corpus grows
- **Decision Graph** — requires ~20 sessions per user
- **Hybrid semantic + ontology structural retrieval**
- **TTS pace gap at 1.5×/2×:** Brief silence between chunks at elevated speeds. Fix: derive pre-fetch lead time from rate × chunkDuration. Currently mitigated by PREFETCH=1 + retry.

---

## TECH DEBT

### TD-4 — Bias Aggregate in Mirror Patterns Tab (deferred "Item B" alternative)
**Added:** June 20, 2026 (Sprint RET-3)
**Priority:** Low — not committed to a sprint, logged for future consideration only

The original retention-audit "Item B" proposed a new homepage `JudgmentSignatureCard` surfacing the user's dominant `bias_library` pattern across sessions (e.g. "Anchoring — present in 4 of 7 decisions"). Rejected as a homepage addition — see KDD 189 — because `PatternSurfaceCard` already covers "your dominant pattern" framing from a different detection system (rule_engine_result), and a second similar card would read as feature-showcasing rather than as a genuinely new signal.

**What's deferred:** the underlying idea — surfacing a `bias_library`-derived aggregate, not the rule-engine-derived one `PatternSurfaceCard` already shows — inside Mirror's existing **Patterns tab**, not as a new homepage surface. This is lower information-overload risk (an existing, already-visited tab gets richer, rather than a new card competing for homepage attention) and would close part of the Identity-value gap noted in the SECOND-USE RETENTION STRATEGY section.

**Trigger condition:** Pick up only as part of a deliberate Mirror Patterns-tab enhancement pass, not opportunistically. Do not build this as a homepage card under any framing — that specific direction was explicitly tried and rejected.

---

### TD-2 — Minimal Decision State (Commitment Capture) — ✅ RESOLVED June 4, 2026
Originally added June 2, 2026 as HIGH priority. Full Chunk 1 implemented instead of minimal scope (3-field only). Decision State + Switch Conditions + Rule Recall all shipped. See sprint history for full delivery. TD-2 closed.

---

### TD-1 — Threshold Recalibration at Higher Decision Count
**Added:** June 1, 2026 (R11 sprint)
**Priority:** Mandatory at corpus milestones — do not forget

All 7 heuristic threshold constants (MATCH_THRESHOLD=45, MIN_SESSIONS=5, PATTERNS_SESSION_THRESHOLD=3, RULES_SESSION_THRESHOLD=8, RERUN_DAYS_THRESHOLD=7, AVOIDANCE_DAYS_THRESHOLD=45, STRUCTURAL_ECHO_MIN_SCORE=60) were set with a ~60-session corpus. They are reasonable bootstrap values but have not been empirically validated. As of R11, all are configurable via Railway env vars without a deploy.

**Mandatory recalibration schedule:**
- **100-session milestone:** Open admin dashboard → R8 Threshold Sensitivity section. Check corpus counts at current vs ±10% variants for each threshold. Where the ±10% count differs significantly from current (cliff-edge sensitivity), reconsider the value. Also check R7 (Rule Calibration) for any rules with negative council_helped delta — these may need threshold adjustment in rule-engine.ts.
- **250-session milestone:** Full empirical recalibration. Use actual outcome data (from /api/mirror/outcomes) to validate whether each threshold is producing signal or noise. Check the admin dashboard R8 section for each constant. Adjust via Railway env vars first; if a threshold change is confirmed stable at 250 sessions, move it to the code default.

**Why not recalibrate before 100 sessions:** Fitting thresholds to sub-100 data produces overfit heuristics — the sample is too small to distinguish signal from session-composition variance. The current heuristics are more generalisable at this corpus size than any empirically derived values would be.

**Tooling:** Admin dashboard R8 section provides sensitivity analysis for all constants. Admin dashboard R11 section shows which values are currently overridden vs at default. Both sections are already built.

---

### TD-3 — Per-Call DeepSeek Thinking Mode Control
**Added:** June 13, 2026
**Priority:** Low — theoretical quality improvement, no confirmed synthesis degradation at current scale

`DEEPSEEK_THINKING` currently applies globally to all DeepSeek calls. The optimal configuration would enable thinking for non-streaming completions only (mirror fingerprint, brief generation — latency invisible to user, quality improvement real) and keep it disabled for streaming calls (personas, pushbacks — latency visible, first-token delay degrades perceived Council responsiveness).

**What's needed:** A per-call `thinking?: 'enabled' | 'disabled'` option in `createCompletion` (passed in `CompletionOptions`) and `createStream`. Callers that want thinking explicitly pass the flag; others inherit `DEEPSEEK_THINKING` env var as the default. Approx 5–6 call-site changes across `lib/mirror-fingerprint.ts` and `app/api/record/[id]/brief/route.ts`.

**Trigger condition:** Either (a) confirmed quality improvement on fingerprint/brief output when thinking=enabled in manual A/B test, or (b) DeepSeek raises the concurrency limit on v4-pro to reduce latency concern on streaming calls (currently 500 concurrent). Do not implement speculatively — the current `DEEPSEEK_THINKING=disabled` default is stable and correct for all call sites.

---

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_PROVIDER              (anthropic | deepseek) ← global fallback only post-hybrid-routing; per-call flags now override this for all 15 calls
AI_MODEL                 ← legacy; respected as DeepSeek model fallback only. Use ANTHROPIC_MODEL + DEEPSEEK_MODEL separately in hybrid mode. Do NOT set to a DeepSeek model name if Claude calls are active — use DEEPSEEK_MODEL instead. See KDD 128.
ANTHROPIC_MODEL          ← Claude model override (default: claude-sonnet-4-20250514). Independent of AI_MODEL.
DEEPSEEK_MODEL           ← DeepSeek model override (default: deepseek-v4-pro; AI_MODEL still respected as fallback if DEEPSEEK_MODEL unset).
                           Set in Railway: DEEPSEEK_MODEL=deepseek-v4-pro. Previous default deepseek-chat is deprecated July 24, 2026. See KDD 176.
DEEPSEEK_THINKING        ← DeepSeek thinking mode (enabled | disabled). Default: disabled.
                           enabled → model reasons before outputting (higher quality, more latency, temperature silently ignored).
                           disabled → standard output, no pre-response reasoning chain.
                           Set in Railway: DEEPSEEK_THINKING=disabled. Change takes effect immediately, no redeploy needed.
                           Streaming calls suppress reasoning_content regardless of this setting — only delta.content tokens reach the user.
                           TD-3: enable selectively for non-streaming completions (fingerprint, brief gen) only — deferred. See KDD 177.
ROUTING_MODE             ← hybrid (default, per-call provider flags respected — safe default when unset, no error) | deepseek_only (all 15 AI calls forced to DeepSeek). Change in Railway takes effect immediately, no redeploy. See KDDs 126–127.
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
DB_ENCRYPTION_KEY        ← AES-256-GCM key for field encryption. 64 hex chars (32 bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))". Set in Railway only — never commit. See KDDs 118–120.
MIRROR_TOKEN_MONTHLY     ← shared code for monthly access (30 days)
MIRROR_TOKEN_ANNUAL      ← shared code for annual access (365 days)
                           (MIRROR_TOKEN_LIFETIME and legacy MIRROR_UNLOCK_TOKEN retired
                           June 13, 2026 — 'lifetime' plan no longer offered, see KDD 172.
                           Safe to remove both from Railway whenever convenient; /api/mirror/unlock
                           no longer reads them.)
SONIOX_API_KEY           ← Soniox STT + TTS shared key
RESEND_API_KEY           ← Engagement Sprint NEW — Resend API key for reanalyze-email cron (free tier: 3,000/mo)
FROM_EMAIL               ← Engagement Sprint NEW — must be "Display Name <email>" format, e.g.
                           "Quorum <auth@quorumvault.org>". A bare address causes Gmail to show the
                           local-part ("AUTH") as sender — code now normalizes defensively, but the
                           Railway value should still be the full format.
NEXT_PUBLIC_VAPID_PUBLIC_KEY ← PWA Sprint NEW — Web Push VAPID public key, exposed to browser bundle.
                           Generate both VAPID keys with: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY        ← PWA Sprint NEW — Web Push VAPID private key. Server-only, never NEXT_PUBLIC_.
VAPID_SUBJECT            ← PWA Sprint NEW — mailto: or https: contact URI for push services
                           (default if unset: mailto:auth@quorumvault.org)
DB_ENCRYPTION_KEY        ← AES-256-GCM key for field encryption (64 hex chars / 32 bytes).
                           Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
                           Never commit to source. If unset, encryption is silently skipped (dev-safe).
                           Rotating this key requires re-running the backfill migration to re-encrypt all rows.
NEXT_PUBLIC_RAZORPAY_KEY_ID ← Sprint CX-PAY NEW — Razorpay public Key ID (rzp_test_... / rzp_live_...).
                           Dashboard → Account & Settings → API Keys. Exposed to browser bundle
                           (NEXT_PUBLIC_ required — checkout.js needs it client-side to open the modal).
                           Currently test mode; swap to rzp_live_ the day Razorpay KYC clears — single
                           env var change, no code change, no redeploy logic needed beyond the value swap.
RAZORPAY_KEY_SECRET      ← Sprint CX-PAY NEW — Razorpay private Key Secret. Server-only, NEVER NEXT_PUBLIC_.
                           Shown once at generation time on the API Keys page — regenerate if missed.
                           Used only in app/api/payment/create-subscription and cancel-subscription routes.
RAZORPAY_MONTHLY_PLAN_ID ← Sprint CX-PAY NEW — plan_xxx from Razorpay Dashboard → Subscriptions → Plans.
                           ₹3,999/month, billing_period=monthly, billing_frequency=1.
RAZORPAY_ANNUAL_PLAN_ID  ← Sprint CX-PAY NEW — plan_xxx from Razorpay Dashboard → Subscriptions → Plans.
                           ₹39,999/year, billing_period=yearly, billing_frequency=1.
RAZORPAY_WEBHOOK_SECRET  ← Sprint CX-PAY NEW — set in Razorpay Dashboard → Account & Settings → Webhooks
                           when creating the webhook pointing at /api/payment/webhook. Must match exactly
                           between Razorpay dashboard and Railway. Webhook save fails with "json request
                           could not be decoded" until the endpoint is actually deployed and reachable —
                           re-enter and re-save the secret in the Razorpay dashboard after first deploy.
```

### Calibration Threshold Variables (R11 — June 1, 2026)

All 7 are optional. When unset, the system uses the heuristic default shown below — no behaviour change. Set in Railway Variables panel; takes effect on next request (no deploy). **Do not tune before 100-session corpus milestone.** See TECH DEBT section for recalibration schedule. All current values visible in the admin dashboard R11 section, with amber highlight if any override is active.

| Variable | Default | Plain-English Meaning |
|---|---|---|
| `MATCH_THRESHOLD` | `45` | **How similar does a past decision need to be before it counts as relevant context for your advisors?** Score is 0–100. At 45, a moderately similar past decision is surfaced. Lower = more past decisions shown (broader context, some loosely related). Higher = only the closest structural matches used. *Example: set to 55 if advisors are receiving too many weakly-related past decisions as context; set to 35 if the feature feels absent for users with few sessions.* |
| `MIN_SESSIONS` | `5` | **How many decisions must a user have logged before structural matching and contradiction detection switch on?** Below this count, those features don't fire — not enough history to compare against. Lower = features activate earlier per user. Higher = longer wait for richer context. *Example: set to 3 to give access after 3 decisions instead of 5; useful if early users feel features are missing.* |
| `PATTERNS_SESSION_THRESHOLD` | `3` | **How many decisions must a user have before the "What Keeps Coming Up" Mirror section generates?** Pattern detection needs enough history to find recurring signals. Lower = section appears sooner with less validated patterns. Higher = section withheld until more history exists. *Example: set to 2 if early Mirror subscribers complain this section is always empty.* |
| `RULES_SESSION_THRESHOLD` | `8` | **How many decisions must a user have before their implicit decision rules are extracted for the Mirror?** Rule extraction needs sufficient history to spot consistent themes. Lower = rules extracted from less data (potentially less reliable). Higher = longer wait before user sees this Mirror feature. *Example: set to 6 to give early Mirror subscribers access two sessions sooner.* |
| `RERUN_DAYS_THRESHOLD` | `7` | **How many days must pass before the contradiction detector re-checks a user's decision record for new tensions?** This prevents it from rerunning on every session. Lower = more frequent checks (marginally fresher contradictions, slightly more compute). Higher = less frequent. *Example: set to 14 as user count grows to halve background compute; set to 3 to make contradiction detection near-real-time.* |
| `AVOIDANCE_DAYS_THRESHOLD` | `45` | **How many days must a decision sit open (no outcome filed) before R11 flags it as a potential avoidance pattern?** A decision still open after 45 days with high upstream dependency scores gets an alert. Lower = alerts fire sooner on less-stale decisions. Higher = only genuinely stuck decisions get flagged. *Example: set to 30 for a more proactive avoidance signal; set to 60 if 45-day alerts are producing too many false positives.* |
| `STRUCTURAL_ECHO_MIN_SCORE` | `60` | **When an avoidance alert fires, how similar must a resolved past decision be to qualify as a "structural echo" — a precedent Quorum shows the user?** Score is 0–100. At 60, a reasonably similar past decision is surfaced as a reference point. Lower = more past decisions shown as echoes (some may feel loosely related). Higher = only near-identical past decisions surface. *Example: set to 70 if the echoes being surfaced feel like loose structural matches; set to 50 if no echoes are being found at all.* |

---

## SPRINT S0 TEST LOG

| # | Test | Expected |
|---|---|---|
| S0-1 | Submit a brief decision (≤ 24 words, no context_text): e.g. "Should I sell MedML?" | Examiner returns 3 questions: 1 rule question (Q1), BRIEF (S0), CONTEXT (C0). Log shows `s0: true`. |
| S0-2 | Submit a brief decision (≤ 24 words) BUT with context_text filled in | S0 does NOT fire. Examiner returns max 3: up to 2 rule questions + C0. Log shows `s0: false (ctx:true)`. |
| S0-3 | Submit a long decision (> 24 words, no context_text): e.g. the MedML cofounder example | S0 does NOT fire — word count threshold not met. Rule questions + C0 only. Log shows `s0: false`. |
| S0-4 | Submit a brief decision that triggers REDIRECT (R1 or R7) | S0 suppressed — same suppression as C0. REDIRECT banner appears. No S0 question. |
| S0-5 | Submit a brief decision with zero rules (OPEN mode, no flags) | If S0 fires: S0 + C0 = 2 questions. No early exit on zero rules. Log shows `s0: true, mode: OPEN`. |
| S0-6 | Submit a brief decision with zero rules AND has context_text | Zero questions — early exit fires (allRules.length === 0 AND !shouldAddS0). Status: 'no_rules'. |
| S0-7 | Check BRIEF badge renders correctly for S0 question | BRIEF appears in green badge (same visual as CONTEXT). Rule questions show Q1 (gold). CONTEXT shows green. |
| S0-8 | S0 subtext (hint) renders correctly | "Grounds the Council in what this actually is — context the decision alone couldn't supply." |
| S0-9 | Run same brief decision 5 times (same sessionId each request) | S0 template text is identical across all 5 GET calls — deterministic per sessionId. |
| S0-10 | Run brief decisions across 5 distinct sessions | S0 template text varies — at least 2 structurally different question phrasings appear across 5 sessions. |
| S0-11 | C0 varies across 5 distinct sessions | C0 template text varies — at least 2 structurally different success-definition phrasings appear. |
| S0-12 | Check total question count never exceeds 3 | With S0 + 1 rule + C0 = 3. Without S0 + 2 rules + C0 = 3. Never 4. |
| S0-13 | S0 response submitted via examiner POST | examiner_responses row created with rule_id = 'S0', question_text encrypted, response_text encrypted. |
| S0-14 | Examiner tagline after questions load | Shows "Key questions the council couldn't answer without you" (not "Three questions"). |
| S0-15 | Anonymous session (no user_id) + brief decision | S0 fires normally — trigger is wordCount + contextText only, not userId. biasHint = '' (safe no-op). |

---

## R3 + C0 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| C0-1 | Submit a decision that triggers 3+ rules (e.g. high-stakes, irreversible, self-imposed urgency). Check examiner questions. | 3 questions appear: 2 rule questions (top priority) + C0 (JTBD anchor) last. Rule budget is now max 2 (Sprint S0). Server log shows `rules: R2,R9,C0` (third rule truncated). |
| C0-2 | Submit a simple decision (0 rules fire). Check examiner questions. | C0 still appears as the only or final question. Was suppressed before this fix. |
| C0-3 | Submit a REDIRECT decision (R1 or R7 fires with full confidence). | C0 does NOT appear — REDIRECT suppression is retained. |
| R3-1 | Run any synthesis. Check server log. | `[Persona] Council weighting directive injected for synthesis` log line present. |
| R3-2 | Run synthesis on a decision where R9 fired (irreversible + self-pressure). | Risk Architect and Contrarian should have highest weights in directive. If synthesis output resolves divergence in favour of a BASELINE advisor over a DOMINANT one without non-structural justification, the directive is not being followed — flag for prompt review. |
| R3-3 | Run synthesis on a session with a HIGH-CONFIDENCE structural match (≥80/100). | Pattern Analyst weight elevated (+0.30). Server log confirms `maxStructuralScore` was non-null. |
| R3-4 | Run synthesis on a v1.0 session (no ontology vector). | Directive still appears with flat 0.50 BASELINE for all advisors. No crash. |

---

## R5 + ADDITIONAL RISK C TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R5-1 | Run a session where you have ≥5 past sessions and current decision scores ≥80 structural match. Review Pattern Analyst and Risk Architect outputs. | At least one persona ends with a sentence beginning "Structurally, this decision..." — confirms traceability sentence is firing on strong matches. |
| R5-2 | Run the same session — review Competitor output. | No traceability sentence. Competitor is not in PERSONAS_WITH_STRUCTURAL_CONTEXT — confirms the block is gated correctly. |
| R5-3 | Run a session where structural match is borderline (45–59/100). Review all 5 structural-context persona outputs. | Some or all may omit the traceability sentence — this is correct (conditional design). Fabricated citations are the failure mode, not omissions. |
| RC-1 | Open the Mirror benchmark panel (≥5 past sessions, cluster ≥5). Check that the cluster composition is plausible. | Decisions with high identity_alignment, regret_asymmetry, or upstream_dependency scores should be more likely to cluster — confirming dim weights are now applied in cross-user similarity. |
| RC-2 | Verify no crash in structural-retrieval.ts after DIM_WEIGHTS import change. | Run any new session end-to-end. Check Railway logs — no "DIM_WEIGHTS is not defined" or import errors. |

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
| FX4 | Council Synthesis | No "PATTERN OBSERVATION:" header label visible in output |
| FX5 | Council Synthesis (user with confirmed bias) | No "LONGITUDINAL BIAS ASSESSMENT:" header; no raw bias key like "loss_aversion_reversal" in text |
| FX6 | Council Synthesis (user with confirmed bias) | Bias observation is woven into prose in plain language |

---

## SPRINT RE TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| RE-1 | Run synthesis for a user with ≥3 sessions where both pre_decision_confidence and retrospective_confidence are filled, and \|avgDelta\| ≥ 0.3. | Synthesis output contains a natural-language observation about confidence pattern — e.g. "your track record suggests you tend to enter decisions with more certainty than your retrospective view later supports." No label like "Calibration pattern:" or "calibration data" visible. No number quoted unless it adds human meaning. |
| RE-2 | Run synthesis for a user with < 3 paired calibration points (or \|avgDelta\| < 0.3). | No calibration observation in synthesis output. Gate is working. |
| RE-3 | Run synthesis for a user with ≥1 active (non-dismissed) contradiction in the contradictions table, where the tension is relevant to the current decision's domain. | Synthesis references the tension as a natural observation — e.g. "this sits in some tension with something you've articulated before." The word "contradiction" does not appear. No structured list of principle_text / violation_text fields. |
| RE-4 | Run synthesis for a user with active contradictions, but where none are relevant to the current decision domain. | No contradiction reference in synthesis output. Directive correctly gates on relevance ("only if directly applicable"). |
| RE-5 | Run synthesis for a user with zero active contradictions (all dismissed or none generated yet). | No contradiction reference. No crash. |
| RE-6 | Check Railway logs for any session with a user who has calibration data. | Log shows no `[BiasContext]` error. fetchCalibrationContext and fetchActiveContradictions complete within the same latency envelope as the existing bias_library query (all three run in parallel). |
| RE-7 | Confirm return shape of fetchUserBiasContext() is unchanged. | synthesisBlock, personaAlert, hasAnyBiases — all three fields present. personaAlert still only fires for confirmed DISTORTING bias (no change). No new fields in return object. |

---

## ADMIN DASHBOARD GUIDE

**Access:** `/admin` (requires admin auth). Route: `app/api/admin/dashboard/route.ts`. Data refreshes on each page load — no caching.

The dashboard has three sections: **R7 (Rule Calibration)**, **R8 (Threshold Sensitivity)**, and **R11 (Active Thresholds + Avoidance Stats)**. Each has a different review cadence and action pattern.

---

### R7 — Rule Calibration

**What it shows:** For each of the 12 rules (R1–R12), the dashboard shows: how many times it fired in the last 90 days, how many of those sessions have an outcome logged, the average `council_helped` score when the rule fired, the global average `council_helped` across all sessions, and the delta between the two.

**What to look for:**
- **Red-flagged delta (negative):** The rule is firing on sessions where the Council was *less* helpful than average. This means the rule may be triggering too broadly — catching decisions where it isn't actually needed, which degrades session quality without structural justification.
- **Positive delta:** The rule is adding value — sessions where it fires are producing better Council output than average. This is the expected pattern for a well-calibrated rule.
- **Low outcome count:** The rule fires frequently but few sessions have outcomes logged. Cannot assess quality. Prompt users to complete the Outcome Tracker after decisions resolve.
- **Zero fires in 90 days:** The rule may be too conservative (threshold too high) or genuinely rare. Check whether the trigger condition has ever been met — if the rule is correct, leave it; if it seems like it should be firing more, review the threshold.

**What actions to take:**
- 🔴 Flagged rule → Investigate 3–5 sessions where that rule fired and `council_helped` was 'no' or 'partially'. Is the rule firing on decisions that don't genuinely need it? If yes, raise the trigger threshold for that rule in `lib/rule-engine.ts`. Log the change as a KDD with the corpus count at which the adjustment was made.
- ✅ All rules positive or neutral → No action needed. Review monthly.
- No outcome data at all → Block time for users to complete outcome tracking before the next R7 review.

**Review cadence:** Monthly. Do not adjust rule thresholds based on fewer than 5 outcome-linked fires per rule.

---

### R8 — Threshold Sensitivity

**What it shows:** For each calibration threshold constant, the dashboard shows: the current value, the corpus count at the current value, the corpus count at current value −10%, and the corpus count at current value +10%. A milestone badge indicates corpus maturity: ⚪ = under 100 sessions (do not touch), 🟡 = 100+ sessions (review), 🟢 = 250+ sessions (recalibrate).

**What to look for:**
- **⚪ badge on all rows:** Corpus is still under 100 sessions. The current heuristic defaults are more generalisable than any empirically fitted values would be at this size. Do nothing.
- **🟡 badge on any row:** The threshold is now reviewable. Check whether the current count differs significantly from the ±10% variants:
  - *Cliff-edge sensitivity* (large count change at ±10%): The threshold is sitting at a sensitive point — small changes produce large effects. Worth scrutiny before 250 sessions.
  - *Flat zone* (±10% barely changes the count): The threshold is robust to small perturbations. Lower urgency — leave for 250-session review.
- **🟢 badge on any row:** Formal recalibration time. Use outcome data to assess whether the threshold is producing signal or noise. The corpus is large enough to justify an empirical adjustment. Change via Railway env var first; if stable after 4–6 weeks, move to code default and log as KDD.
- **Note for MIN_SESSIONS:** This threshold controls feature activation per user, not corpus count. The "corpus count" at current value shows how many users have reached that session count. If only a handful of users have crossed the threshold, recalibration isn't meaningful yet.

**What actions to take:**
- ⚪ across all rows → nothing. Next review at 100-session milestone.
- 🟡 on a cliff-edge row → note the sensitivity. Flag for review at 250 sessions. No change yet.
- 🟢 on any row → run the full recalibration per TD-1 (TECH DEBT section). Use Railway env var to test the new value for 4–6 weeks before committing to code.
- Any row where current count = 0 → the threshold is too high and the feature is never firing. Investigate immediately — this is a functional gap, not a calibration question.

**Review cadence:** At 100-session and 250-session milestones. Not monthly — the corpus moves slowly and sensitivity analysis is only meaningful when the corpus has grown materially since the last review.

---

### R11 — Active Thresholds + Avoidance Stats

This section has two parts: the **threshold table** (which shows the live effective value of each env-configurable constant) and the **avoidance alert stats** (which show R11 detection activity).

#### Threshold Table

**What it shows:** For each of the 7 configurable threshold constants, the table shows the hardcoded default value, the currently active effective value, and whether the value is being overridden by a Railway env var (amber badge) or sitting at the code default (grey badge).

**What to look for:**
- **All rows grey (default):** No overrides active. The system is running on heuristic defaults. Expected state before 100-session milestone.
- **Any amber row:** A threshold has been overridden via Railway env var. This is intentional if an override was set deliberately. If unexpected, investigate — a stale env var from a past test may still be active.
- **Effective value ≠ default but no amber badge:** This should not be possible (the badge derives from the same comparison). If seen, it is a display bug — check the `is_overridden` logic in `dashboard/route.ts`.

**What actions to take:**
- Confirm each amber-flagged override is intentional. If a test override was applied and the test is done, remove the env var from Railway to restore the default.
- If an override has been stable and validated for ≥6 weeks at the 250-session milestone, consider moving it to the code default and logging it as a KDD.

#### Avoidance Alert Stats

**What it shows:** Four numbers — total alerts generated by R11, currently open alerts (no outcome filed), dismissed alerts, and average days open across all alerts. Below the cards: the currently active detection threshold (days open ≥ N) and echo minimum score.

**What to look for:**
- **Open alerts > 0:** Users have decisions that have been sitting unresolved past the threshold. This is actionable — the Mirror's avoidance section (D3, when built) should surface these. Until D3 is built, these can be reviewed manually in the `avoidance_alerts` table.
- **Total = 0 despite many sessions:** R11 is either not firing (no sessions have been open long enough) or the `avoidance_alerts` table migration has not been applied. Check Supabase for the table's existence first.
- **Dismissed > Open:** Users are engaging with and resolving avoidance alerts. Healthy signal.
- **Avg days open > 2× the threshold:** Alerts are piling up undismissed. Either the threshold is too low (firing too aggressively) or users aren't seeing the alerts (D3 not built yet — expected until that sprint ships).

**What actions to take:**
- Total = 0 and sessions exist → check `avoidance_alerts` table in Supabase. If absent, apply the D1 migration.
- Open count high + D3 not built → note for next sprint prioritisation. These are real avoidance signals sitting undelivered to users.
- `AVOIDANCE_DAYS_THRESHOLD` feels too aggressive (false positives) → raise it via Railway env var. Monitor open count over 2 weeks.

**Review cadence:** Monthly once R11 cron is generating alerts. Weekly during the first month after D3 ships (to calibrate threshold against real user feedback).

---

## R9 / R11 TEST LOG (validate before marking deployed)

| # | Test | Expected |
|---|---|---|
| R9-1 | User with exactly 2 detections of any bias — open Mirror → Bias Fingerprint | Tile appears in **forming** section (not confirmed). Confidence dots = 2. Interpretation reads "1 more session to confirm." No full activation summary (may have partial if AI call ran for that entry). |
| R9-2 | User with exactly 3 detections of a bias — open Mirror → Bias Fingerprint | Tile appears in **confirmed** section. Full activation summary and interpretation rendered. |
| R9-3 | User with 1 detection — open Mirror → Bias Fingerprint | Tile in forming section. Confidence dots = 1. Static fallback: "Pattern forming — one more session to confirm." Activation summary null (correct — insufficient data). |
| R9-4 | Forming section header text | Reads "N patterns forming — building confidence" — NOT "one more session to confirm". |
| R9-5 | Mirror narrative block (no confirmed patterns yet) | Text reads "three or more patterns are confirmed" — not "two or more". |
| R9-6 | Run any synthesis for user with 2-detection bias | Synthesis columns description reads "FORMING = 1–2 detections". statusLabel for that bias reads "FORMING (2 detections)" — plural correct. |
| R11a-1 | All threshold env vars unset in Railway | All features behave identically to pre-sprint. No regressions. Structural matching still fires at 45, patterns at 3 sessions, etc. |
| R11a-2 | Set `PATTERNS_SESSION_THRESHOLD=2` in Railway, open Mirror for a user with exactly 2 sessions | "What Keeps Coming Up" section now generates (previously required 3). Remove var after test. |
| R11a-3 | Set `MATCH_THRESHOLD=70` in Railway, run a session | Structural context only surfaces past decisions scoring 70+/100. Lower-scoring matches excluded. Remove after test. |
| R11a-4 | Set `RERUN_DAYS_THRESHOLD=1` in Railway, submit two decisions in 24 hours | Contradiction detector re-runs on the second decision. Remove after test. |
| R11b-1 | Open `/admin`, scroll to R11 — Active Thresholds | Table shows 7 rows. All show grey "default" badge. Effective value = default value for each row. |
| R11b-2 | Set `RULES_SESSION_THRESHOLD=10` in Railway, reload admin | That row shows amber "env override" badge. Effective = 10, Default = 8. All other rows unchanged. |
| R11b-3 | Admin page with avoidance_alerts data in DB | Stat cards show correct total, open, dismissed counts and avg days open. Threshold values in footer match Railway env (or defaults). |
| R11b-4 | Admin page before avoidance_alerts table exists | All stat cards show 0. No crash, no error UI. (Non-fatal catch in route.) |

---

## R7 + R8 ADMIN DASHBOARD TEST LOG

| # | Test | Expected |
|---|---|---|
| AD-1 | Navigate to `/admin` — fresh browser (no sessionStorage) | Password gate renders: single input with "Admin code" placeholder, "Enter" button. No dashboard visible. |
| AD-2 | Enter wrong ADMIN_CODE | Silent redirect to `/` — no error message, no confirmation the route exists. sessionStorage entry cleared. |
| AD-3 | Enter correct ADMIN_CODE (ASCII-only) | Dashboard loads. Two sections visible: R7 Rule Calibration table and R8 Threshold Sensitivity table. Header shows session count, sessions-with-outcomes count, global avg helpfulness, and generated timestamp. |
| AD-4 | Enter correct ADMIN_CODE containing non-ASCII characters | Fails with "Network error: TypeError: Failed to execute 'fetch'... String contains non ISO-8859-1 code point." Fix: update ADMIN_CODE in Railway to ASCII-only string. See KDD 111. |
| AD-5 | Reload page after successful login | Password gate is skipped — code read from sessionStorage. Dashboard loads immediately. |
| AD-6 | Click Refresh button | Data refetches with same stored code. Generated timestamp updates. No re-authentication required. |
| R7-1 | R7 table — all rules present | 11 rows: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R12. Each shows rule ID, label, fires count, outcome count, avg when fired, avg when not fired, delta, flag column. |
| R7-2 | R7 table — zero data state (no outcomes logged) | All `avg_fired`, `avg_not_fired`, `delta` columns show "—". No crash. Informational note appears below table: "No outcome data yet for this window — ask users to complete the Outcome Tracker after decisions resolve." |
| R7-3 | R7 table — rule with 🔴 flag | Delta column reads a negative percentage (red, bold). Flag column shows 🔴. This means that rule is firing on sessions where council was less helpful than baseline by >10pp. |
| R7-4 | R7 table — rule with zero fires in 90 days | Fires column = 0. Avg columns show "—". No crash. This is expected for rare rules — not a bug. |
| R8-1 | R8 table — all threshold rows present | 7 rows: MATCH_THRESHOLD, SIMILARITY_THRESHOLD, LOW_CONFIDENCE_THRESHOLD, MIN_SESSIONS, PATTERNS_SESSION_THRESHOLD, RULES_SESSION_THRESHOLD, RERUN_DAYS_THRESHOLD. |
| R8-2 | R8 table — queryable thresholds (MATCH_THRESHOLD, SIMILARITY_THRESHOLD, PATTERNS_SESSION_THRESHOLD) | Current count, −10% variant count, +10% variant count all populated with integers. Corpus total present. Milestone badge: ⚪ if <100 sessions, 🟡 if 100+, 🟢 if 250+. |
| R8-3 | R8 table — non-queryable thresholds (LOW_CONFIDENCE, RULES_SESSION, RERUN_DAYS) | Count columns show "—". Amber italic note appears explaining why and pointing to correct lookup. No crash. |
| R8-4 | R8 table — MIN_SESSIONS row | Current count shows total completed sessions_ontology rows. −10% and +10% show "—" (per-user threshold, not corpus aggregate). Note explains this. |
| R8-5 | Corpus at 0 sessions | All counts are 0 or "—". No crash. Milestone badges all ⚪. Table renders correctly. |

## ADDITIONAL RISK D — FULL TEST PLAN (D1 + D2 + D3)

### D1 — Schema + Activity Tracking

| # | Test | Expected |
|---|---|---|
| D1-1 | Check Supabase — `sessions` table schema | `last_action_at timestamptz` column exists. All pre-migration rows have `last_action_at = created_at` (backfill). New sessions have `last_action_at = NULL` until first examiner submit. |
| D1-2 | Check Supabase — `avoidance_alerts` table | Table exists with: id, user_id, session_id, days_open (int), upstream_dependency_score (numeric), structural_echo (jsonb), detected_at, dismissed_at (null), action_taken. RLS enabled. |
| D1-3 | Submit a session and complete the examiner | Railway logs show no `last_action_at stamp failed` error. Check Supabase: `sessions.last_action_at` updated to now() for that session. |
| D1-4 | Skip the examiner (skip path) | Same as D1-3 — `last_action_at` stamped on skip path too. |
| D1-5 | File an outcome via Outcome Tracker | `sessions.last_action_at` updated to now() for that session. Confirms resolution signal is working — D2 cron will not flag this session. |
| D1-6 | Check index on sessions | `idx_sessions_last_action_at` exists as a partial index on `(user_id, last_action_at) WHERE status = 'completed'`. |

### D2 — Detection Engine + Cron

| # | Test | Expected |
|---|---|---|
| D2-1 | Deploy D2. Check Railway build logs | No import errors from `lib/avoidance-detector.ts` or cron route. Build passes cleanly. |
| D2-2 | Trigger cron manually from cron-job.org (Force Execute) | Railway logs show `[AvoidanceDetector] Pass starting — N user(s)` and `Pass complete — detected: X, skipped: Y, errors: 0`. cron-job.org shows HTTP 200 response `{ ok: true, detected, skipped, errors, elapsed_ms }`. |
| D2-3 | Call cron endpoint without Authorization header | Returns 401. No detection runs. |
| D2-4 | Call cron endpoint with wrong CRON_SECRET | Returns 401. |
| D2-5 | User has completed session with `upstream_dependency ≥ 4`, `last_action_at` ≥ 45 days ago, no outcomes row. Run cron. | Row appears in `avoidance_alerts`. `days_open ≥ 45`. `upstream_dependency_score ≥ 4`. `dismissed_at` is null. |
| D2-6 | Run cron again immediately after D2-5 | No duplicate alert written. Existing undismissed alert causes skip. `skipped` count increments. |
| D2-7 | Session with `upstream_dependency = 3` (below threshold). Run cron. | No alert for that session. |
| D2-8 | Session 50 days old but outcome filed. Run cron. | No alert — outcome = resolved. |
| D2-9 | Session qualifies AND user has a prior resolved session scoring ≥ 60/100 structural similarity (v2.0). Run cron. | Alert row has `structural_echo` JSONB: `{ sessionId, matchScore, decisionSnippet, outcomeSummary }`. Other qualifying sessions with no close match have `structural_echo: null`. |
| D2-10 | cron-job.org execution history after 02:00 UTC | Status: success. Response body `ok: true`. Notification email fires if it fails. |

### D3 — Mirror Surface + Dismiss + Synthesis Resubmission

| # | Test | Expected |
|---|---|---|
| D3-1 | Mirror unlocked user with ≥1 undismissed avoidance alert — open Mirror | "Decisions Still Open" section renders above Bias Fingerprint. One card per alert (max 3). Section absent if no alerts. |
| D3-2 | Card content — alert with no structural echo | Shows decision snippet, days-open observation ("You first brought this N days ago. It hasn't moved."). No echo section. Two CTAs visible: "Bring it back →" and "Mark as resolved →". |
| D3-3 | Card content — alert with structural_echo present | Echo block appears: "A prior decision was structurally close to this one (N/100 match). [decisionSnippet]..." — including outcomeSummary if present. |
| D3-4 | Check copy — "avoidance" word scan | The word "avoidance", "avoided", "stalling" does not appear anywhere in the rendered card. |
| D3-5 | Click "Mark as resolved →" | Card disappears optimistically. POST /api/mirror/avoidance/dismiss called. Supabase: alert row has `dismissed_at` set and `action_taken = 'resolved_externally'`. Outcomes table: row inserted with `outcome_quality = 'resolved_externally'`. |
| D3-6 | Reload Mirror after dismiss | Dismissed card does not reappear (dismissed_at is set — query filters it). |
| D3-7 | Run D2 cron after D3-5 (session now has outcome row) | Dismissed session is NOT re-flagged. Outcome row closes the D2 cron gate. |
| D3-8 | Click "Bring it back →" | Navigates to `/?decision=<encoded decision text>`. Decision textarea is pre-filled with the decision snippet. localStorage key `quorum_resubmit_alert` is set to the alert ID. |
| D3-9 | From pre-filled form (D3-8) — submit decision and run through to synthesis | Synthesis fires. Railway logs show `[Persona] Resubmission context injected for synthesis | alert <id> | Nd open`. Synthesis output acknowledges elapsed time as neutral observation — e.g. "The fact that this has been open for N days is itself worth reading…" No "avoidance" language. |
| D3-10 | Synthesis after resubmission — check localStorage | `quorum_resubmit_alert` key is cleared after synthesis call. If synthesis is re-run in same session, resubmission context does NOT fire a second time. |
| D3-11 | Resubmission synthesis — alert has structural echo | Synthesis references the prior resolved session — e.g. "A prior decision was structurally similar to this one…" |
| D3-12 | Dismiss endpoint — wrong alertId (another user's alert) | Returns 403 Forbidden. Alert not modified. |
| D3-13 | Mirror locked or teaser user | "Decisions Still Open" section absent. Alerts route returns `avoidanceAlerts: []` for non-unlocked users. |
| D3-14 | User with 0 avoidance alerts | "Decisions Still Open" section not rendered. No empty state shown. |

---

- Supabase project: `quorum` (kansrakunal1992's Org)
- Production URL: app.quorumvault.org / invigorating-manifestation-production-ecd2.up.railway.app
- Website: www.quorumvault.org
- Railway: deployment from GitHub main branch
- Research doc: `Quorum_Research_Working_Doc_v010.md` — paste at start of any new research session
