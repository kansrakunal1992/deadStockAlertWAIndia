continue from last point - also help check context from another session on rate limit issue for free mistral small end to end - help share a plan to fix for that as well (no coding yet) 



Important: Do any compute, analysis or work on rate limit in free tier issue ONLY after you have shared ready to deploy files; For now, after fixing Elite tier issue, in 1 line in the end, ask me if we should continue on rate limit issue now (so we can conserve your tokens on one task at a time)










































Kunal Kansra
Kunal Kansra
Copilot Chat (Basic)



GPT 5.6 Think

New design




log
logs.1785921522154
You said:




can you analyze logs & break down in layman terms what all happened end to end?
Copilot said:

Reasoning completed in 2 steps
I reviewed the full log chronologically. In simple terms, the application started successfully, processed a financial/allocation decision through multiple AI “advisers,” detected missing information and several potential biases, and then attempted to combine everything into a final answer. The main technical problem was that the user’s paid/free tier was not being passed correctly, which forced AI requests onto the free route and likely caused a rate-limit delay near the end.
sharepoint

Executive summary
What worked
The Next.js application/container started and became ready.
The user’s decision session was created and classified.
The system compared the decision with 24 historical sessions and found 2 meaningful matches.
It ran contradiction, independence, and bias checks.
Six AI personas were launched to examine the decision from different viewpoints.
The system reached the final synthesis stage.
What did not work cleanly
Product-tier information was missing repeatedly.

Requests eligible for paid/tiered routing fell back to the free tier.
This is the most important recurring issue.
The final synthesis request was rate-limited with HTTP 429.

The system initiated an automatic retry after 8 seconds.
This was probably aggravated by the free-tier fallback and multiple parallel AI calls.
Some AI responses failed internal quality checks.

Several personas did not explicitly reference the structural/historical matches supplied to them.
The synthesis omitted a required tension section/tag.
There were two startup/code warnings.

The deployment command does not match Next.js standalone mode.
The application uses the deprecated Node.js url.parse() API.
The provided log stops before the final result.

It ends during a small follow-up AI request intended, most likely, to repair or supplement the missing synthesis tag.
Therefore, the log does not prove whether the final answer was eventually delivered.
End-to-end breakdown
1. Application container started
At approximately 09:15:10 UTC, the container launched a Next.js 15.2.8 application on port 8080.

Starting...
Next.js 15.2.8
Local:   http://localhost:8080
Network: http://0.0.0.0:8080
Ready in 627ms
Layman’s explanation
The server switched on normally and was ready to receive requests in under a second. There is no startup crash in this log.
sharepoint

Warning raised during startup
"next start" does not work with "output: standalone"
Use "node .next/standalone/server.js" instead.
The app is configured as a standalone Next.js build, but it is being launched with the normal next start command. It still became ready, but the launch command is inconsistent with the build configuration and should be corrected.
sharepoint

2. An initial user/session request entered the system
At approximately 09:15:30 UTC, the application began making AI calls. It first invoked:

Mistral Small with a 2,000-token limit
Claude Sonnet with a 600-token limit
At the same time, a user-level graph was loaded containing:

25 nodes
299 edges
0 locked edges
Layman’s explanation
The system appears to maintain a decision/history graph for the user. When the request arrived, it loaded the user’s past context and started using AI models to interpret the new decision.
sharepoint

Secondary code warning
Node emitted a deprecation warning for:

url.parse()
This is old URL-handling code. It did not stop the request, but the application should move to the standard URL API to avoid future compatibility and security-related concerns.
sharepoint

3. A new decision session was being classified
The main session was:

0e9f9f96-8608-4e0b-9761-25aca2da77f1
Initially, the structural-matching process reported:

Ontology not complete ... client should retry
A few seconds later, the ontology/classification completed with:

Type: allocation
Initial mode: REDIRECT
Rule: R7
Identity score/value: 2
Regret: 4
Upstream: 1
Layman’s explanation
The system recognized the user’s question as an allocation decision, likely involving how money or assets should be distributed. It initially considered the case incomplete enough to redirect the user instead of answering directly.
sharepoint

The first structural check happened slightly too early, before classification had finished, so the client was told to retry. The classification then completed successfully roughly four seconds later. This looks like normal asynchronous timing rather than a permanent failure.
sharepoint

4. The system compared this decision with past decisions
The service:

Excluded 1 session from the same decision lineage
Compared the current decision against 24 past sessions
Wrote 24 structural score records
Created 24 graph connections
Found 2 matches that met the required similarity threshold
Layman’s explanation
The system checked whether this decision resembled previous decisions. It found two sufficiently similar past cases, which could then be used as historical context for the recommendation.
sharepoint

Why one session was excluded
A “same-lineage” session is probably a parent, child, retry, or previous version of the current decision. Excluding it prevents the system from claiming a strong historical match merely because it is comparing the decision with another version of itself.

Duplicate-looking activity
The structural-scoring sequence appears twice in quick succession. Both runs scored 24 sessions and found 2 matches.

This may be intentional because different endpoints or background jobs requested the same information. However, it may also indicate duplicate client retries or insufficient deduplication. It is not necessarily a defect, but it is worth checking because it adds database writes and AI calls.
sharepoint

5. The decision was downgraded from “redirect” to “gate”
The examiner changed the mode from:

REDIRECT -> GATE
The stated reason was that liquidity stress testing and regulatory information were missing, but those gaps were not expected to reverse the core asset-allocation decision. The system believed it could still offer provisional advice as long as uncertainty was clearly identified.
sharepoint

Layman’s explanation
Originally, the system thought:

“There is not enough information, so I should send the user elsewhere or stop.”

It then changed its position to:

“Some important information is missing, but I can still provide a cautious answer if I clearly flag the uncertainty.”

This appears to be intentional business logic, not an error.

Important functional concern
The examiner reported:

questions: E0,S0,C0
s0: true (14w)
profile: false
fears: false
The exact meanings of E0, S0, and C0 are not defined in the log. Broadly, this suggests no additional examiner questions were generated, one short answer or statement was present, and some optional profile/fear context was unavailable.
sharepoint

6. Contradiction and independence checks ran
At about 09:16:45 UTC, the examiner reported:

Contradictions triggered
It then calculated independence scores across prior sessions.

What “independence” appears to mean
This looks like a score measuring whether the user’s decision-making reflects original reasoning rather than just following suggestions, stakeholders, or previous recommendations.

Several historical sessions with no responses were excluded. Sessions containing answers received scores such as:

14
24
29
34
One response received additional credit for “stakeholder surfacing,” and another for “response depth.”

The final user-level independence score was:

baseline = 24
delta = 2
final = 26
Layman’s explanation
The system reviewed how independently the user had reasoned in previous sessions. The resulting score increased slightly from 24 to 26. That suggests a modest positive change, although the log does not provide a documented scoring scale, so it would be risky to label 26 as objectively “good” or “bad.”
sharepoint

Current-session limitation
The new session itself had no recorded examiner responses at this point:

0e9f9f96: no responses — excluded
So the current score was based mainly on historical behavior, not on detailed answers from this specific decision.
sharepoint

7. Bias analysis was launched
The bias-scoring process initially stated:

Scoring from decision_text only
no examiner or pushback data yet
It also recorded:

0 user pushback message(s)
Layman’s explanation
The system tried to detect decision-making biases from the original decision description. It had not yet collected enough follow-up answers or user objections, so the analysis was based on limited evidence.
sharepoint

Biases detected
The system evaluated 15 parameters and flagged 9:

FOMO urgency
Pressure to act quickly because the opportunity may disappear.

Overconfidence
Possibly assuming forecasts or judgments are more certain than they really are.

Social proof
Giving too much weight to what others are doing.

Control illusion
Overestimating how much control the decision-maker has over the outcome.

Exit optionality mispricing
Underestimating how difficult or costly it may be to reverse or exit the decision.

Deference distortion
Giving disproportionate weight to a senior, influential, or authoritative person.

Relationship-alignment assumption
Assuming another party’s incentives are aligned because of the relationship.

Network circularity
Information may be repeated within the same network and mistaken for independent validation.

Complexity opacity
Complexity may be hiding risks or weakening the decision-maker’s understanding.

Nine corresponding bias records were written to storage.
sharepoint

Important caveat
These are machine-detected risk indicators, not confirmed facts. Because the analysis was based primarily on decision text and had no user pushback data, the flags should be treated as prompts for review rather than final conclusions.

8. Six AI personas reviewed the decision in parallel
The system invoked six specialist perspectives:

pattern_analyst
elder
risk_architect
competitor
contrarian
stakeholder_mirror
Each persona received:

Continuity from the parent session
Council/shared context
A bias alert
A Mistral-specific prompt extension
A streaming generation request with up to 2,200 tokens
Layman’s explanation
Instead of asking one AI for one answer, the application asked six AI “advisers” to look at the same decision from different angles:

historical patterns,
experience,
risk,
competition,
opposing arguments,
and stakeholder interests.
This is effectively an AI review panel.
sharepoint

9. Structural quality audits found a weakness
The StructuralEchoAudit reported cited=false for at least these personas:

elder
pattern analyst
stakeholder mirror
risk architect
contrarian
The log does not show the equivalent result for the competitor persona before moving on.

Layman’s explanation
The personas were provided with historical/structural matches, but at least five of them apparently did not explicitly refer to that evidence in their answers.

This does not mean their responses failed to generate. Their stop reason was stop, which normally indicates natural completion. The issue was that the answers did not satisfy an internal traceability or grounding requirement.
sharepoint

Operational implication
The application seems to log this audit failure but still continues to synthesis. If historical grounding is mandatory, the system may need to:

retry the persona,
repair the response,
or reduce its weight in synthesis.
Simply logging the failure may not be enough.

10. Final synthesis began
The synthesis model received:

Long-term bias history
Six graph connections
Council weighting instructions
Parent-session continuity
Combined council context
It then started a Mistral streaming request with a 3,200-token maximum.

Layman’s explanation
The individual adviser responses were collected, and a final AI was asked to combine them into one consolidated recommendation.
sharepoint

11. The synthesis hit a rate limit
Approximately two seconds after synthesis began:

rate limited (429) on streamMistral
retrying in 8000ms (attempt 1/2)
Layman’s explanation
The AI service temporarily rejected the request because too many requests had been made, or because the applicable quota/capacity had been reached. The application did not give up immediately. It automatically waited eight seconds and retried.
sharepoint

The retry apparently obtained a response because a synthesis audit ran roughly 20 seconds later. Therefore, the 429 caused a delay rather than a confirmed terminal failure.

12. The synthesis response failed one formatting/content check
The final audit reported:

missing mandatory tag(s): tension
stop_reason=stop
Layman’s explanation
The final AI response completed normally, but it omitted a required section called tension. That section presumably needed to explain the key disagreement, trade-off, or unresolved conflict identified by the AI council.
sharepoint

Immediately afterward, the system launched a small 80-token completion. That was likely intended to generate or repair the missing section, although the log does not explicitly confirm the purpose.

13. The log ends before final delivery
The final visible line is:

createCompletion → mistral-cloud ... 80 max tokens
There is no later entry showing:

completion of the repair call,
a successful final audit,
database persistence of the synthesis,
an HTTP response being returned,
or the user receiving the result.
Bottom line
The system successfully progressed nearly to the end, but this log excerpt cannot confirm whether the final result reached the user.
sharepoint

Most likely cause-and-effect chain
Application starts successfully
        ↓
User initiates an allocation decision
        ↓
Classification is briefly incomplete, then finishes
        ↓
Decision is compared with 24 historical sessions
        ↓
Two relevant historical matches are found
        ↓
Missing financial/regulatory details are identified
        ↓
System allows cautious provisional guidance
        ↓
Contradiction, independence, and bias checks run
        ↓
Six AI advisers generate parallel opinions
        ↓
Several opinions fail historical-evidence citation checks
        ↓
Final synthesis begins
        ↓
Missing product-tier header routes calls to free tier
        ↓
Synthesis hits a 429 rate limit and retries
        ↓
Retry produces a synthesis
        ↓
Synthesis omits required "tension" section
        ↓
A small repair request starts
        ↓
Log ends, final delivery unknown
Issue assessment
High priority: Missing x-product-tier header
This message appears repeatedly:

no x-product-tier header on a tiered-routing-eligible request
falling back to free
Business impact
Paid users may receive free-tier service.
Lower-capacity models or quotas may be used.
Rate limits may be reached sooner.
Latency can increase.
Entitlement or billing behavior may be incorrect.
Where to investigate
The log explicitly recommends checking the separate Edge/middleware stream for:

[middleware] tier resolution failed
The investigation should follow the header across the complete path:

Authentication/entitlement lookup
→ Edge middleware
→ internal API
→ background/parallel persona calls
→ synthesis request
This is the strongest candidate for the main production issue.
sharepoint

Medium-high priority: 429 during synthesis
The system recovered far enough to receive a synthesis, but the delay was significant. Parallel persona calls combined with free-tier fallback likely increased the chance of throttling.

Recommended controls:

Use exponential backoff with jitter.
Limit per-session AI concurrency.
Reserve capacity for synthesis.
Ensure retries are idempotent.
Capture provider rate-limit headers.
Distinguish account quota, model quota, and request-frequency limits.
Medium priority: Quality checks do not appear to enforce repair consistently
Five personas failed structural citation audits, but synthesis proceeded.

Recommended behavior:

Retry responses that fail mandatory grounding.
Mark ungrounded responses with lower synthesis weight.
Pass explicit structured evidence IDs to personas.
Require machine-validated output fields rather than relying only on prompt instructions.
Medium priority: Missing mandatory tension tag
The synthesis had a format/content compliance issue. A repair seems to have started but its outcome is missing.

Recommended fix:

Use schema-constrained structured output.
Validate before streaming the response to the user.
Repair only missing fields rather than regenerating the entire synthesis.
Log repair_started, repair_completed, and final_audit_passed.
Low-medium priority: Duplicate structural scoring
The same session appears to have been scored twice against the same 24 historical sessions.

Recommended checks:

Determine whether GET polling and background processing both trigger scoring.
Introduce a session-level idempotency key.
Reuse completed structural scores.
Add a distributed lock if multiple workers can start the same job.
Low priority: Deployment and code warnings
Standalone Next.js command
Replace the current startup command with the standalone server command expected by the build:

node .next/standalone/server.js
The exact deployment path may need adjustment if static assets and public files are copied separately.

Deprecated URL parsing
Replace legacy calls such as:

url.parse(value)
with the WHATWG API:

new URL(value)
These warnings did not cause this request to fail, but clearing them will reduce future risk.

Final diagnosis
There is no evidence of a full application crash. The workflow largely functioned: classification, matching, scoring, multi-persona analysis, and synthesis all ran.

The main defect is an entitlement/routing problem: x-product-tier was not preserved or assigned, causing repeated fallback to the free tier. The most obvious downstream symptom was a 429 rate limit during final synthesis. The retry appears to have generated an answer, but that answer then failed a required-content audit because the tension section was missing. A repair call began, but the supplied log ends before success or user delivery can be verified.
sharepoint





log
Sources
You said:
check 2 code files - can you help confirm if code ever was able to reach Claude & why not if not?


// middleware.ts
// ── Product-tier resolution middleware ───────────────────────────────────────
//
// Runs before every matched request (see config.matcher below). Reads the
// user's Bearer token — the same auth scheme every route already uses — and
// resolves their product tier (free/elite/private), any TD-LD-11 per-user
// routing override, and their user id, via the same mirror_access table
// lib/product-tier.ts's getProductTier() reads. Stamps the result onto
// request headers (x-user-id, x-product-tier, x-private-model-family,
// x-model-route-fast, x-model-route-premium) and forwards the request
// unmodified otherwise.
//
// This is what lets lib/ai-client.ts's tiered routing (TIERED_ROUTING_ENABLED)
// work with ZERO changes to any of the 15 AI call sites or their route
// handlers — ai-client.ts reads these headers back via next/headers, however
// deeply the actual createCompletion/createStream call is nested.
//
// Does NOT enforce auth — each route already does its own 401 check. This
// middleware only adds tier information when a valid token is present; a
// missing/invalid token just means no tier header gets set, and
// ai-client.ts's resolveProvider() falls back to 'free'. Never blocks or
// redirects a request.
//
// Runtime: Edge (this project is on Next.js 15.2.8 — Node.js middleware
// runtime needs 15.5+). Supabase's JS client is fetch-based and Edge-safe;
// this is the standard supported pattern for Supabase auth in Next.js
// middleware, so no runtime constraint is actually hit here.
//
// Structural exception — cron/batch routes: daily-nudge and reanalyze-email
// are deliberately excluded from the matcher below. They're triggered by a
// scheduler (not a per-end-user request) and loop over many users
// internally — there is no single "the user" for this middleware to resolve
// a tier for. Those routes use lib/tier-context.ts's explicit per-iteration
// override instead (see that file's doc comment; not yet wired in — flagged
// as an open follow-up).
//
// Also excluded: /api/payment/webhook (Razorpay signature auth, no user
// Bearer token) and /api/admin/* (x-admin-key auth) — neither makes AI calls
// that need tiering, and neither carries a user Bearer token to resolve.
// ─────────────────────────────────────────────────────────────────────────────



import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase'
import { getProductTier } from '@/lib/product-tier'



export const config = {
  matcher: [
    '/api/persona/:path*',
    '/api/examiner/:path*',
    '/api/session/:path*',
    '/api/record/:path*',
    '/api/mirror/:path*',
    '/api/case-study/:path*',
    '/api/voice/:path*',
    '/api/structural-match/:path*',
    '/api/ontology/:path*',
    '/api/bias-score/:path*',
  ],
}



export async function middleware(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const requestHeaders = new Headers(req.headers)



  if (!authHeader?.startsWith('Bearer ')) {
    // No token — not this middleware's job to enforce auth. Forward as-is;
    // ai-client.ts falls back to 'free' when no tier header is present.
    return NextResponse.next({ request: { headers: requestHeaders } })
  }



  try {
    const token = authHeader.slice(7).trim()
    const anon  = createClient()
    const { data: { user } } = await anon.auth.getUser(token)



    if (user) {
      const tierInfo = await getProductTier(user.id)
      requestHeaders.set('x-user-id', user.id)
      requestHeaders.set('x-product-tier', tierInfo.tier)
      if (tierInfo.privateModelFamily) {
        requestHeaders.set('x-private-model-family', tierInfo.privateModelFamily)
      }
      // TD-LD-10/TD-LD-11 per-user routing override — see lib/product-tier.ts
      // and lib/ai-client.ts's resolveProvider() for how these are checked
      // before the tier's default model mapping.
      if (tierInfo.modelRouteFast) {
        requestHeaders.set('x-model-route-fast', tierInfo.modelRouteFast)
      }
      if (tierInfo.modelRoutePremium) {
        requestHeaders.set('x-model-route-premium', tierInfo.modelRoutePremium)
      }
      // Per-customer Private tier deployment (baseUrl/apiKey/models) — one
      // header, JSON-encoded, rather than four separate ones. This never
      // leaves the server: Next.js only forwards request headers set here to
      // the downstream route handler in the same process, never back to the
      // browser. See lib/product-tier.ts's PrivateEndpoint doc comment.
      if (tierInfo.privateEndpoint) {
        requestHeaders.set('x-private-endpoint', JSON.stringify(tierInfo.privateEndpoint))
      }
    }
  } catch (err) {
    // Never block a request over a tier-resolution hiccup — fall through to
    // 'free' (ai-client.ts's conservative default) rather than failing every
    // API call because of an auth/DB blip here.
    console.error('[middleware] tier resolution failed (non-fatal):', err)
  }



  return NextResponse.next({ request: { headers: requestHeaders } })
}


import 'server-only'
// ^ Build-time guard (Sprint TB1, June 2026). Throws if this module is ever
// reached by a client bundle — directly or transitively through any lib file
// that imports it (lib/bias-scorer.ts, lib/ontology-tagger.ts,
// lib/structural-retrieval.ts, lib/contradiction-detector.ts,
// lib/mirror-fingerprint.ts). Converts the failure mode from "blank white
// screen in production with no useful error" (see diligence finding #2,
// June 2026 update — components/BiasFingerprint.tsx crashed this way after a
// value-import of a constant created a transitive chain to the module-scope
// `new Anthropic(...)` below executing in-browser) into a local build error
// naming the exact import chain. Do not remove.

/**
 * AI provider abstraction.
 *
 * ── Legacy routing (unchanged — this is what runs when TIERED_ROUTING_ENABLED
 *    is false or unset, which is the default) ────────────────────────────────
 *
 * Global fallback (AI_PROVIDER env var):
 *   AI_PROVIDER=deepseek   → DeepSeek API (OpenAI-compatible)
 *   AI_PROVIDER=anthropic  → Claude API (default)
 *
 * Per-call override (Sprint 25 — hybrid routing):
 *   Pass `provider` to createStream, or `options.provider` to createCompletion,
 *   to pin a specific call to one model family regardless of AI_PROVIDER.
 *   All 15 AI calls carry an explicit provider flag — the env var is the
 *   fallback only for any call that omits the flag.
 *
 * Routing mode (ROUTING_MODE env var):
 *   ROUTING_MODE=hybrid        → per-call provider flags respected (default)
 *   ROUTING_MODE=deepseek_only → all 15 calls forced to DeepSeek regardless
 *                                 of per-call provider flags. Use for cost
 *                                 testing, A/B quality comparison, and as the
 *                                 tester path — see TIERED_ROUTING_ENABLED
 *                                 below for why this still works unchanged.
 *
 * Model selection:
 *   ANTHROPIC_MODEL  env var  → override Claude model   (default: claude-sonnet-4-20250514)
 *   DEEPSEEK_MODEL   env var  → override DeepSeek model (default: deepseek-v4-pro)
 *   Legacy AI_MODEL  env var  → still respected as fallback for DeepSeek only,
 *                               so existing Railway env var configs are not broken.
 *
 * DeepSeek thinking mode (DEEPSEEK_THINKING env var):
 *   DEEPSEEK_THINKING=disabled → thinking OFF for all DeepSeek calls (default)
 *   DEEPSEEK_THINKING=enabled  → thinking ON for all DeepSeek calls
 *   Note: thinking mode disables temperature sampling (silently ignored by API).
 *   Note: streaming calls suppress reasoning_content — only content tokens stream.
 *   TD logged: enable thinking selectively for non-streaming completions only
 *   (fingerprint, brief gen) once per-call thinking control is added.
 *
 * ── Tiered routing (new — Free/Elite/Private, gated by TIERED_ROUTING_ENABLED) ─
 *
 * TIERED_ROUTING_ENABLED env var (true/false, default false):
 *   false (default) → every line above applies exactly as written. Tiered
 *                      routing code below is never reached. This is the
 *                      master revert switch — flip to false to instantly
 *                      restore pre-tiered behavior, no other config needed.
 *   true             → resolveProvider() ignores ROUTING_MODE and the literal
 *                      meaning of each call's `provider` flag, and instead:
 *                        1. Reads the current request's tier — automatically,
 *                           with ZERO changes to any of the 15 call sites or
 *                           their route handlers. middleware.ts (project
 *                           root) resolves each user's tier once per request
 *                           and stamps it onto request headers
 *                           (x-product-tier / x-private-model-family); this
 *                           file reads them back via next/headers. The one
 *                           structural exception is cron/batch routes
 *                           (daily-nudge, reanalyze-email), which loop over
 *                           many users per request — middleware can't
 *                           resolve a single tier for those, so they use
 *                           lib/tier-context.ts's explicit AsyncLocalStorage
 *                           override instead, one call per loop iteration.
 *                           See that file's doc comment. Precedence: an
 *                           explicit tier-context override always wins over
 *                           headers, so a batch route's per-user wrap is
 *                           never shadowed by whatever tier its own trigger
 *                           request happens to carry.
 *                        2. Reinterprets the existing `provider` flag as a
 *                           ROLE rather than a literal provider:
 *                             'anthropic' → premium/complex-reasoning role
 *                             'deepseek'  → fast role
 *                           This is why zero call-site files needed to
 *                           change — the flag each of the 15 calls already
 *                           carries is exactly the fast/premium split the
 *                           tiered model needs, just under a different name.
 *                        3. Maps (tier, role) → an actual model per the table
 *                           below (TIER_ROLE_TABLE doc comment).
 *
 * Tester note: keep TIERED_ROUTING_ENABLED=false and ROUTING_MODE=deepseek_only
 * to force every call to DeepSeek — this path is untouched by anything in
 * this file's tiered-routing half, by construction (see the false-branch
 * above).
 *
 * Tier → role → model table:
 *   free                    fast → Mistral Small (cloud)
 *                           premium → Mistral Small (cloud) — same model,
 *                             Free is Mistral end-to-end per the Locked v1
 *                             pricing doc, so role is a no-op here.
 *   elite                   fast → Mistral Small (cloud)
 *                           premium → Claude Sonnet 4.6 (ELITE_PREMIUM_MODEL)
 *   private / Option A      fast → self-hosted Qwen (small)
 *   (qwen)                  premium → self-hosted Qwen (large)
 *   private / Option B      fast → self-hosted Mistral Small
 *   (mistral)                premium → self-hosted Mistral Large
 *
 * Private tier note: the self-hosted Qwen/Mistral endpoints this depends on
 * do not exist yet (separate infra track — GPU provisioning, deploy tooling).
 * The Private branch below is fully wired but fails loudly with a clear
 * error if its endpoint env vars are unset, rather than silently falling
 * back to a different tier's model. Do not treat a caught error from this
 * branch as "Private tier is broken" — it means the infra isn't live yet.
 *
 * Per-user routing override (TD-LD-10 / TD-LD-11): a single account can be
 * granted a model_route_fast / model_route_premium override via
 * /api/admin/grant-mirror-access — e.g. the founder's own account forced to
 * DeepSeek for testing while every other account routes normally by tier, at
 * the same time. Checked before the tier default in resolveProvider() below.
 * NULL (every row's default) means no override.
 *
 * Persisted audit log (TD-LD-10): every tiered-mode call writes a row to
 * ai_request_log — user, tier, role, resolved target/model, whether an
 * override was the reason — fire-and-forget, never blocking or failing the
 * actual call. Ties into the eventual privacy audit's ability to verify
 * what's claimed, rather than relying on ephemeral console logs. Writes
 * nothing when TIERED_ROUTING_ENABLED is false — matches the master
 * switch's "zero behavior change when off" guarantee.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'
import { headers } from 'next/headers'
import { getCurrentTier } from './tier-context'
import { createServiceClient } from './supabase'
import { FREE_TIER } from './product-tier'
import type { ProductTierInfo } from './product-tier'
import type { ProductTier, PrivateModelFamily, RouteOverride, PrivateEndpoint } from './types'

// ── Tier resolution precedence ────────────────────────────────────────────────
// 1. AsyncLocalStorage context (lib/tier-context.ts) — set explicitly, e.g. by
//    a cron/batch route wrapping one user's iteration. Checked first because
//    an explicit per-iteration override should always win over whatever
//    headers happen to be on the batch job's own trigger request.
// 2. Request headers (x-product-tier / x-private-model-family / x-user-id /
//    x-model-route-fast / x-model-route-premium) — set automatically by
//    middleware.ts for every normal per-user request. This is what makes
//    tiered routing work with ZERO changes to any of the 15 call sites or
//    their route handlers: middleware resolves tier (and any TD-LD-11
//    override) once per request before any route code runs, and
//    ai-client.ts reads it back here.
// 3. 'free' — no context set and no headers present (e.g. headers() thrown
//    outside a request scope, or middleware's matcher didn't cover this
//    route). Conservative default, same reasoning as tier-context.ts's doc
//    comment: under-serve rather than accidentally over-serve.
async function getTierFromHeaders(): Promise<ProductTierInfo | undefined> {
  try {
    const h = await headers()
    const tier = h.get('x-product-tier') as ProductTier | null
    if (!tier) {
      // Distinguish "genuinely no auth on this request" from "middleware
      // should have set this and didn't" — legitimate free-tier requests
      // still get an explicit x-product-tier: free header from middleware.ts,
      // so a totally MISSING header on a matched route (see middleware.ts's
      // config.matcher) means the per-request tier lookup itself failed or
      // was skipped. That failure is caught non-fatally inside middleware's
      // try/catch and logged there — but middleware runs on the Edge runtime
      // (see middleware.ts's doc comment), which on most hosts (Railway
      // included) logs to a SEPARATE stream from this one. Confirmed via
      // real logs (2026-08-05, session 9e1239d7): an Elite-tier synthesis
      // call silently routed to mistral-cloud instead of anthropic-elite —
      // exactly what this fallback produces — with nothing in the app-server
      // log explaining why. This line exists so that's visible from here too.
      console.warn(`[AIClient] no x-product-tier header on a tiered-routing-eligible request — falling back to free. If this account should be paid, check the Edge/middleware log stream (separate from this one) for '[middleware] tier resolution failed'.`)
      return undefined
    }
    const family = h.get('x-private-model-family') as PrivateModelFamily | null

    // JSON.parse can throw on malformed input — treat that as "no endpoint
    // available" (falls through to resolveTieredTarget's clear error) rather
    // than letting a header-parsing bug crash the whole request.
    let privateEndpoint: PrivateEndpoint | null = null
    const rawEndpoint = h.get('x-private-endpoint')
    if (rawEndpoint) {
      try { privateEndpoint = JSON.parse(rawEndpoint) as PrivateEndpoint } catch { privateEndpoint = null }
    }

    return {
      tier,
      privateModelFamily: tier === 'private' ? family : null,
      userId:             h.get('x-user-id'),
      modelRouteFast:     h.get('x-model-route-fast')    as RouteOverride | null,
      modelRoutePremium:  h.get('x-model-route-premium') as RouteOverride | null,
      privateEndpoint,
    }
  } catch {
    // headers() throws when called outside a request-scoped execution
    // context (e.g. a plain script, or certain non-request invocations).
    // Not an error condition for us — just means no header-based tier is
    // available; fall through to 'free'.
    return undefined
  }
}

const GLOBAL_PROVIDER    = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() as 'anthropic' | 'deepseek'
const ROUTING_MODE       = (process.env.ROUTING_MODE ?? 'hybrid') as 'hybrid' | 'deepseek_only'
const ANTHROPIC_MODEL    = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL     = process.env.DEEPSEEK_MODEL  ?? process.env.AI_MODEL ?? 'deepseek-v4-pro'
const DEEPSEEK_THINKING  = (process.env.DEEPSEEK_THINKING ?? 'disabled') as 'enabled' | 'disabled'

// ── Tiered routing config (only read/used when TIERED_ROUTING_ENABLED=true) ──
// Kept fully separate from the legacy vars above — e.g. ELITE_PREMIUM_MODEL
// is its own var, NOT a repurposed ANTHROPIC_MODEL, specifically so changing
// it can never affect legacy hybrid/deepseek_only behavior.
const TIERED_ROUTING_ENABLED = process.env.TIERED_ROUTING_ENABLED === 'true'

const MISTRAL_API_KEY    = process.env.MISTRAL_API_KEY ?? ''
const MISTRAL_MODEL      = process.env.MISTRAL_MODEL   ?? 'mistral-small-latest'
const ELITE_PREMIUM_MODEL = process.env.ELITE_PREMIUM_MODEL ?? 'claude-sonnet-4-6'

// Private tier — self-hosted, buyer's Option A (Qwen) or Option B (Mistral).
// Infra not live yet (see doc comment above); these are read lazily, only
// when a Private-tier call is actually made, so an unconfigured deployment
// doesn't block Free/Elite from working.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseURL: 'https://api.deepseek.com' })

// Mistral's chat completions API is OpenAI-compatible (same pattern as
// DeepSeek above) — base URL, key, and model name are the only differences.
// See https://docs.mistral.ai/api — /v1/chat/completions accepts the same
// request/response shape as OpenAI's SDK expects.
const mistral = new OpenAI({ apiKey: MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1' })

// Self-hosted Qwen/Mistral (Private tier) — NO global client here anymore.
// Each Private customer has their own cloud account, own URL, own key (see
// supabase/add_private_deployments.sql) — a module-level singleton would
// silently reuse the FIRST customer's connection for every other customer,
// which was a real bug in the original single-global-endpoint design.
// Instead, a fresh OpenAI-compatible client is constructed per call from
// ResolvedTarget.endpoint (set in resolveTieredTarget below, sourced from
// that customer's ProductTierInfo.privateEndpoint). This is cheap — it's
// just an object construction, not a network connection — so not caching it
// costs nothing measurable.
function getPrivateClient(endpoint: PrivateEndpoint): OpenAI {
  return new OpenAI({ apiKey: endpoint.apiKey, baseURL: endpoint.baseUrl })
}

// ── Transient-error retry helper ────────────────────────────────────────────
// DeepSeek returns 503 during peak load; a short wait and one retry recovers
// the majority of those. Originally this ONLY covered 503 — but a client-side
// investigation (PersonaPanel) into "some personas never fired at all" traced
// several first-failures back to errors that never reached this retry at all:
// 502/504 (upstream gateway hiccups), and connection-level failures (timeout,
// reset, DNS blip) that the OpenAI SDK surfaces with no `status` field, only
// a `code`/`name`/message. Every one of those used to throw straight through
// to route.ts's catch block on the FIRST attempt — no retry — which is a
// meaningfully likely trigger for the original bug, on top of the sequential-
// gate issue itself. Broadened to cover all of these; still bounded and still
// only for genuinely transient conditions. (429 rate limits were originally
// excluded here on the theory that they should surface to client-side
// rate-limit handling instead — see the Rate-limit section below for why
// that turned out not to hold up and got its own retry path.) Reused for
// every OpenAI-compatible provider (DeepSeek, Mistral, self-hosted
// Qwen/Mistral) — none of these failure modes are provider-specific.
const RETRY_WAIT_MS      = 5000
const MAX_TRANSIENT_RETRIES = 2

// ── Rate-limit (429) handling ────────────────────────────────────────────────
// Bug fix (Aug 2026): 429 was explicitly excluded from isTransientError below
// by design — the reasoning was that a real rate limit "should surface to the
// client's own rate-limit handling" rather than being silently absorbed here.
// In practice no such client-side handling exists: a 429 anywhere in the call
// chain throws straight out to route.ts's outer catch, which returns a bare
// "Internal server error" (500) with no indication it was a rate limit, and
// SynthesisCard.tsx has no special case for it — the user just sees a failed
// synthesis and has to reload. Confirmed via real Railway logs (2026-08-05,
// session 9e1239d7): all 6 persona calls + several scoring completions fired
// against mistral-cloud within ~15s, then the synthesis call (the single
// heaviest, 3200 tokens) hit the same provider's per-minute limit and threw
// a raw 429 with zero retry. Given a burst-triggered per-minute rate limit
// typically clears within seconds, retrying (honoring Retry-After when the
// provider sends one) is the right fix — kept as its own function, separate
// from isTransientError, since it's a distinct failure mode with its own
// backoff logic rather than a generic "service had a hiccup" case.
const RATE_LIMIT_WAIT_MS = 8000

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['status'] === 429
}

// Extracts a provider-supplied Retry-After (seconds, or an HTTP date) when
// present. Both the OpenAI SDK (Mistral/DeepSeek) and Anthropic SDK expose
// response headers on thrown errors, but not identically — OpenAI's tends to
// be a plain Record, Anthropic's a Headers-like object with .get() — so both
// shapes are checked. Returns null (caller falls back to RATE_LIMIT_WAIT_MS)
// if absent or unparsable, rather than guessing.
function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const headers = (err as Record<string, unknown>)['headers'] as
    | Record<string, string>
    | { get?: (k: string) => string | null }
    | undefined
  if (!headers) return null
  const raw = typeof (headers as { get?: (k: string) => string | null }).get === 'function'
    ? (headers as { get: (k: string) => string | null }).get('retry-after')
    : (headers as Record<string, string>)['retry-after'] ?? (headers as Record<string, string>)['Retry-After']
  if (!raw) return null
  const asSeconds = Number(raw)
  if (!Number.isNaN(asSeconds)) return Math.max(0, asSeconds * 1000)
  const asDate = Date.parse(raw)
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - Date.now())
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  if (e['status'] === 503 || e['status'] === 502 || e['status'] === 504) return true
  // Anthropic-specific: 529 is their dedicated "overloaded_error" status,
  // returned when the API is under heavy load — transient by definition,
  // distinct from the generic 502/503/504 set above (which is why it needs
  // its own check; a plain numeric-range test would miss it). This was
  // previously unhandled everywhere in this file, and streamAnthropic (the
  // synthesis call's provider) had no retry wrapper at all — so a 529 during
  // synthesis failed the whole request outright with no recovery attempt.
  if (e['status'] === 529) return true
  if (e['code'] === 'service_unavailable_error' || e['code'] === 'overloaded_error') return true
  // OpenAI SDK connection-level errors (no HTTP status at all — the request
  // never got a response): APIConnectionError / APIConnectionTimeoutError.
  const name = typeof e['name'] === 'string' ? e['name'] : ''
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true
  const code = typeof e['code'] === 'string' ? e['code'] : ''
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) return true
  const message = typeof e['message'] === 'string' ? e['message'] : ''
  if (/timeout|timed out|network|socket hang up|overloaded/i.test(message)) return true
  return false
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const rateLimited = isRateLimitError(err)
      if ((rateLimited || isTransientError(err)) && attempt < MAX_TRANSIENT_RETRIES) {
        const wait = rateLimited ? (getRetryAfterMs(err) ?? RATE_LIMIT_WAIT_MS) : RETRY_WAIT_MS
        console.warn(`[AIClient] ${rateLimited ? 'rate limited (429)' : 'transient error'} on ${label} — retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
        await new Promise(r => setTimeout(r, wait))
        lastErr = err
      } else {
        throw err
      }
    }
  }
  throw lastErr
}

// ── Tiered resolution ─────────────────────────────────────────────────────────

type Role = 'fast' | 'premium'

type ResolvedTarget =
  | { kind: 'anthropic-legacy' }
  | { kind: 'deepseek-legacy' }
  | { kind: 'mistral-cloud' }
  | { kind: 'anthropic-elite' }
  | { kind: 'qwen-selfhosted';    role: Role; endpoint: PrivateEndpoint }
  | { kind: 'mistral-selfhosted'; role: Role; endpoint: PrivateEndpoint }

// requestedRole is the literal value each call site passes today — kept as
// the same 'anthropic' | 'deepseek' union so no call site needs to change.
// Under tiered routing it's reinterpreted as premium/fast (see doc comment).
function roleFromRequested(requested?: 'anthropic' | 'deepseek'): Role {
  return requested === 'anthropic' ? 'premium' : 'fast'
}

function resolveTieredTarget(tierInfo: ProductTierInfo, role: Role): ResolvedTarget {
  switch (tierInfo.tier) {
    case 'elite':
      return role === 'premium' ? { kind: 'anthropic-elite' } : { kind: 'mistral-cloud' }
    case 'private': {
      // Conservative default if a Private row somehow has no family set —
      // Option B (Mistral) rather than silently picking the China-origin
      // path (TD-KL-1 / TD-LD-7 both treat that as a decision the buyer
      // makes explicitly, never a silent default).
      const family = tierInfo.privateModelFamily ?? 'mistral'

      if (!tierInfo.privateEndpoint) {
        // Granted Private but private_deployments has no row for them yet —
        // a real, expected state between granting access and finishing the
        // deploy (see infra/README.md), not a routing bug. Fails loudly
        // here rather than silently falling back to a different tier.
        throw new Error(
          `[AIClient] Private tier resolved for user ${tierInfo.userId ?? '(unknown)'} but no ` +
          `private_deployments row exists yet — their dedicated infra hasn't finished deploying. ` +
          `See supabase/add_private_deployments.sql and infra/README.md.`,
        )
      }

      return family === 'qwen'
        ? { kind: 'qwen-selfhosted', role, endpoint: tierInfo.privateEndpoint }
        : { kind: 'mistral-selfhosted', role, endpoint: tierInfo.privateEndpoint }
    }
    case 'free':
    default:
      return { kind: 'mistral-cloud' }
  }
}

// ── Per-user routing override (TD-LD-10 / TD-LD-11) ─────────────────────────
// Checked BEFORE resolveTieredTarget's tier default — see
// supabase/add_model_route_overrides_and_request_log.sql and
// lib/product-tier.ts. Same vocabulary as ResolvedTarget.kind, just
// underscore_case in the DB/headers (SQL/HTTP-header convention) vs
// kebab-case here (this file's existing convention) — translated 1:1, no
// semantic difference.
//
// qwen_selfhosted/mistral_selfhosted overrides need an endpoint the same way
// the tier default does — there's no "the" self-hosted endpoint anymore
// (per-customer, see PrivateEndpoint), so an override to self-hosted only
// makes sense on an account that itself has a private_deployments row (e.g.
// the founder's own personal test deployment). If it doesn't, this throws
// the same way resolveTieredTarget's Private branch does — an override
// that can't be satisfied should fail loudly, not silently fall through to
// the tier default as if no override had been set.
function resolveOverrideTarget(
  override:   RouteOverride | null | undefined,
  role:       Role,
  tierInfo:   ProductTierInfo,
): ResolvedTarget | undefined {
  switch (override) {
    case 'deepseek':        return { kind: 'deepseek-legacy' }
    case 'mistral_cloud':   return { kind: 'mistral-cloud' }
    case 'anthropic_elite': return { kind: 'anthropic-elite' }
    case 'qwen_selfhosted':
    case 'mistral_selfhosted': {
      if (!tierInfo.privateEndpoint) {
        throw new Error(
          `[AIClient] ${override} override set for user ${tierInfo.userId ?? '(unknown)'} but they have ` +
          `no private_deployments row — a self-hosted override needs that account's own deployment. ` +
          `See supabase/add_private_deployments.sql.`,
        )
      }
      return { kind: override === 'qwen_selfhosted' ? 'qwen-selfhosted' : 'mistral-selfhosted', role, endpoint: tierInfo.privateEndpoint }
    }
    default: return undefined
  }
}

interface ResolveResult {
  target:      ResolvedTarget
  tierInfo?:   ProductTierInfo   // undefined in legacy mode — no tier concept there
  role?:       Role              // undefined in legacy mode
  wasOverride: boolean
}

/**
 * resolveProvider — single choke point for both legacy and tiered routing.
 *
 * Legacy path (TIERED_ROUTING_ENABLED=false, default): unchanged from before
 * this file was touched — ROUTING_MODE=deepseek_only forces deepseek;
 * otherwise the per-call `requested` flag wins, falling back to
 * AI_PROVIDER/GLOBAL_PROVIDER when omitted.
 *
 * Tiered path (TIERED_ROUTING_ENABLED=true): reads tier-context, reinterprets
 * `requested` as a role, checks that account's per-user routing override
 * first (TD-LD-11), and falls back to (tier, role) → a concrete target when
 * there's no override. Falls back to 'free' if no tier-context was set (see
 * lib/tier-context.ts doc comment on why that's the safe default for an
 * un-wired call site).
 */
async function resolveProvider(requested?: 'anthropic' | 'deepseek'): Promise<ResolveResult> {
  if (!TIERED_ROUTING_ENABLED) {
    if (ROUTING_MODE === 'deepseek_only') return { target: { kind: 'deepseek-legacy' }, wasOverride: false }
    const p = requested ?? GLOBAL_PROVIDER
    return { target: p === 'deepseek' ? { kind: 'deepseek-legacy' } : { kind: 'anthropic-legacy' }, wasOverride: false }
  }

  // Precedence: explicit AsyncLocalStorage override (cron/batch routes) →
  // middleware-populated headers (every normal route, zero wiring needed) →
  // 'free' (see the doc comment above getTierFromHeaders for why).
  const tierInfo = getCurrentTier() ?? (await getTierFromHeaders()) ?? FREE_TIER
  const role     = roleFromRequested(requested)

  const overrideValue  = role === 'premium' ? tierInfo.modelRoutePremium : tierInfo.modelRouteFast
  const overrideTarget = resolveOverrideTarget(overrideValue, role, tierInfo)
  if (overrideTarget) return { target: overrideTarget, tierInfo, role, wasOverride: true }

  return { target: resolveTieredTarget(tierInfo, role), tierInfo, role, wasOverride: false }
}

// ── Model-family peek (for model-aware prompt extensions) ───────────────────
//
// Added alongside lib/personas.ts's MISTRAL_* prompt extensions. A caller
// that wants to append a model-specific instruction block (e.g. the
// Mistral-only evidence-discipline / synthesis-depth text in personas.ts)
// needs to know which model family a call will resolve to BEFORE it finishes
// assembling that call's systemPrompt — but resolveProvider() is only
// otherwise invoked from inside createStream/createCompletion, after the
// systemPrompt is already built.
//
// getModelFamily() re-runs the exact same resolution (same TIERED_ROUTING_ENABLED
// check, same header/override read, same `requested` flag) and returns only
// the resulting family. Call it with the SAME `requested` value you'll pass
// to createStream/createCompletion moments later — resolveProvider() is a
// pure function of (TIERED_ROUTING_ENABLED, request headers, tier-context
// override, requested) with no I/O and no randomness, so the peek and the
// real call can never disagree within one request.
//
// Cost: identical to one resolveProvider() call — header reads + a switch
// statement, no DB query, no network call. Safe to call once per AI call
// site, immediately before building that call's systemPrompt.
export type ModelFamily = 'anthropic' | 'deepseek' | 'mistral' | 'qwen'

export async function getModelFamily(requested?: 'anthropic' | 'deepseek'): Promise<ModelFamily> {
  const { target } = await resolveProvider(requested)
  switch (target.kind) {
    case 'anthropic-legacy':
    case 'anthropic-elite':
      return 'anthropic'
    case 'deepseek-legacy':
      return 'deepseek'
    case 'mistral-cloud':
    case 'mistral-selfhosted':
      return 'mistral'
    case 'qwen-selfhosted':
      return 'qwen'
  }
}

function describeTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return `anthropic (${ANTHROPIC_MODEL})`
    case 'deepseek-legacy':    return `deepseek (${DEEPSEEK_MODEL})`
    case 'mistral-cloud':      return `mistral-cloud (${MISTRAL_MODEL})`
    case 'anthropic-elite':    return `anthropic-elite (${ELITE_PREMIUM_MODEL})`
    case 'qwen-selfhosted':    return `qwen-selfhosted/${t.role} (${t.endpoint.baseUrl}, ${t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel})`
    case 'mistral-selfhosted': return `mistral-selfhosted/${t.role} (${t.endpoint.baseUrl}, ${t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel})`
  }
}

// literal model string for a target, for the persisted audit log — same
// data describeTarget() shows, just without the "kind (" wrapper text.
function modelForTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return ANTHROPIC_MODEL
    case 'deepseek-legacy':    return DEEPSEEK_MODEL
    case 'mistral-cloud':      return MISTRAL_MODEL
    case 'anthropic-elite':    return ELITE_PREMIUM_MODEL
    case 'qwen-selfhosted':    return t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel
    case 'mistral-selfhosted': return t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel
  }
}

/**
 * logResolvedRequest — persisted audit trail (TD-LD-10), fire-and-forget.
 *
 * Writes to ai_request_log so a future privacy audit can verify which model
 * actually handled a given request, rather than trusting console output.
 * Deliberately NOT awaited by callers — a DB write here should never add
 * latency to a user-facing AI call, and a failed write should never fail the
 * call itself. Only called when TIERED_ROUTING_ENABLED is true; the legacy
 * path writes nothing, matching the master switch's "zero behavior change
 * when off" guarantee (no new side effects, not just no new routing).
 */
function logResolvedRequest(result: ResolveResult, callLabel: string): void {
  if (!TIERED_ROUTING_ENABLED) return
  try {
    const supabase = createServiceClient()
    supabase.from('ai_request_log').insert({
      user_id:         result.tierInfo?.userId ?? null,
      tier:            result.tierInfo?.tier ?? 'free',
      role:            result.role ?? 'fast',
      resolved_target: result.target.kind,
      resolved_model:  modelForTarget(result.target),
      was_override:    result.wasOverride,
      call_label:      callLabel,
    }).then(({ error }: { error: unknown }) => {
      if (error) console.error('[AIClient] ai_request_log insert failed (non-fatal):', error)
    })
  } catch (err) {
    // Never let audit logging affect the actual AI call.
    console.error('[AIClient] ai_request_log logging threw (non-fatal):', err)
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface StreamResult {
  readable:   ReadableStream<Uint8Array>
  getContent: () => string
  // Diagnostic only (bug fix — see [SynthesisAudit] in app/api/persona/route.ts):
  // exposes why the underlying provider stream ended, so callers can tell a
  // model that stopped naturally (stop_reason 'end_turn' / finish_reason 'stop')
  // apart from one that got cut off mid-output ('max_tokens' / 'length').
  // Previously this information was discarded inside each stream* helper —
  // the only visible symptom of a truncated run was a mandatory tag silently
  // missing downstream, with no way to tell truncation apart from the model
  // just not following the tag instruction. Optional so existing callers that
  // don't need it (every call site before this fix) are unaffected.
  getStopReason?: () => string | null
}

/**
 * Options for createCompletion.
 * All fields are optional — omitting `provider` falls back to AI_PROVIDER env var
 * (legacy) or the 'fast' role (tiered).
 */
export interface CompletionOptions {
  /** Pin this call to a specific provider (legacy) / role (tiered). See file doc comment. */
  provider?: 'anthropic' | 'deepseek'
  /**
   * System prompt.
   * Passed as Anthropic `system` param or prepended as an OpenAI `system` message.
   * Use when the call requires a separate system + user message structure
   * (e.g. ontology tagger).
   */
  systemPrompt?: string
  /**
   * Sampling temperature (0.0–1.0).
   * Defaults to each provider's default when omitted.
   * Set low (0.0–0.2) for structured/JSON outputs that require determinism.
   * Silently ignored for DeepSeek calls when DEEPSEEK_THINKING=enabled.
   */
  temperature?: number
}

// ── Generic OpenAI-compatible streaming/completion helpers ─────────────────────
// Shared by DeepSeek, Mistral (cloud), and self-hosted Qwen/Mistral — all
// speak the same OpenAI-compatible /v1/chat/completions shape. Only Anthropic
// needs its own implementation (different SDK, different event shape).

async function streamOpenAICompatible(
  client:       OpenAI,
  model:        string,
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  maxTokens:    number,
  label:        string,
  thinking?:    'enabled' | 'disabled',
): Promise<StreamResult> {
  const stream = await withRetry(
    () => client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream:     true,
      messages:   [{ role: 'system', content: systemPrompt }, ...messages],
      ...(thinking ? { thinking: { type: thinking } } : {}),
    } as any) as any,
    label,
  ) as AsyncIterable<any>
  const encoder = new TextEncoder()
  let fullContent = ''
  let stopReason: string | null = null
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) { fullContent += text; controller.enqueue(encoder.encode(text)) }
          // finish_reason only appears on the final chunk for a given choice;
          // every other chunk carries null, so this naturally settles on the
          // last non-null value seen.
          const finishReason = chunk.choices[0]?.finish_reason
          if (finishReason) stopReason = finishReason
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent, getStopReason: () => stopReason }
}

async function completeOpenAICompatible(
  client:       OpenAI,
  model:        string,
  prompt:       string,
  maxTokens:    number,
  label:        string,
  systemPrompt?: string,
  temperature?:  number,
  thinking?:     'enabled' | 'disabled',
): Promise<string> {
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
  msgs.push({ role: 'user', content: prompt })

  const res = await withRetry(
    () => client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream:     false,
      ...(temperature !== undefined && thinking !== 'enabled' ? { temperature } : {}),
      messages:   msgs,
      ...(thinking ? { thinking: { type: thinking } } : {}),
    } as any),
    label,
  )
  return (res as any).choices[0]?.message?.content ?? ''
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/**
 * createStream — streaming AI call for user-facing Council output.
 *
 * See file doc comment for the full legacy vs tiered routing behavior.
 *
 * maxTokens (bug fix): every call used a hardcoded 1200, regardless of how
 * much output the prompt actually demands. That's enough for a single advisor
 * persona, but the SYNTHESIS prompt (lib/personas.ts) mandates a long list of
 * sections — verdict, conditions, 2–4 paragraphs of prose, optional SB-3
 * additions, then <action_plan> (3–4 items) and <confidence_to_act> LAST,
 * after everything else. A verbose-but-otherwise-normal synthesis routinely
 * runs past 1200 tokens (~900 words), and since the two action tags are
 * mandated to be the final thing the model writes, they are the first thing
 * to get cut off mid-tag when the limit hits — which is exactly what left
 * raw, unclosed <action_plan>/<confidence_to_act> markup visible on the
 * session page in hybrid mode (where synthesis runs on Claude specifically;
 * see resolveProvider above). Not a timeout — a token ceiling. Callers that
 * need more room now pass maxTokens explicitly; anything that doesn't is
 * unaffected (default matches the old hardcoded value exactly).
 */
export async function createStream(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  provider?:    'anthropic' | 'deepseek',
  maxTokens:    number = 1200,
): Promise<StreamResult> {
  const result = await resolveProvider(provider)
  const target = result.target
  console.log(`[AIClient] createStream → ${describeTarget(target)} (${maxTokens} max tokens)${TIERED_ROUTING_ENABLED ? (result.wasOverride ? ' [tiered, override]' : ' [tiered]') : ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  logResolvedRequest(result, 'createStream')

  switch (target.kind) {
    case 'anthropic-legacy':
      return streamAnthropic(systemPrompt, messages, maxTokens, ANTHROPIC_MODEL, 'streamAnthropic')
    case 'deepseek-legacy':
      return streamOpenAICompatible(deepseek, DEEPSEEK_MODEL, systemPrompt, messages, maxTokens, 'streamDeepSeek', DEEPSEEK_THINKING)
    case 'mistral-cloud':
      return streamOpenAICompatible(mistral, MISTRAL_MODEL, systemPrompt, messages, maxTokens, 'streamMistral')
    case 'anthropic-elite':
      return streamAnthropic(systemPrompt, messages, maxTokens, ELITE_PREMIUM_MODEL, 'streamAnthropic/elite')
    case 'qwen-selfhosted':
      return streamOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        systemPrompt, messages, maxTokens, 'streamQwenSelfHosted',
      )
    case 'mistral-selfhosted':
      return streamOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        systemPrompt, messages, maxTokens, 'streamMistralSelfHosted',
      )
  }
}

async function streamAnthropic(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  maxTokens:    number = 1200,
  model:        string = ANTHROPIC_MODEL,
  label:        string = 'streamAnthropic',
): Promise<StreamResult> {
  // Bug fix (Aug 2026): this call had no retry protection at all, unlike
  // streamOpenAICompatible below — every DeepSeek/Mistral call (the 6 initial
  // personas) transparently absorbs a transient 502/503/504/connection-reset
  // via withRetry. The Anthropic call (synthesis — also the single longest,
  // heaviest call in the app: 3200 max_tokens plus the deepest system prompt,
  // more exposed to hitting a transient condition purely by running longer)
  // had none, and simply wrapping the initial anthropic.messages.stream(...)
  // call in withRetry (as a first pass at this fix did) doesn't actually
  // help: .stream() returns a MessageStream synchronously and never throws
  // for request-level errors — those only surface later, when consuming it
  // as an async iterator (see MessageStream's _run(), which routes failures
  // through an 'error' event rather than rejecting the call that created
  // it). So the real point of failure is the `for await` below, and that's
  // where retry needs to live. Symptom before this fix: synthesis fails
  // with a clean 500 right as it fires (i.e. exactly when persona traffic —
  // and therefore load on both this server and Anthropic's API — is
  // highest), but a reload succeeds because it's a fresh, isolated attempt
  // made once the transient condition (e.g. a 529 overloaded_error spike)
  // has usually cleared.
  //
  // Retry is only safe/attempted while fullContent is still '' — i.e.
  // nothing has been enqueued to the client yet. Once real text has started
  // streaming, restarting with a brand-new .stream() call would duplicate
  // or garble what's already rendered client-side, so a failure past that
  // point still fails outright (same as before this fix).
  const encoder = new TextEncoder()
  let fullContent = ''
  let stopReason: string | null = null
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          const stream = anthropic.messages.stream({
            model,
            max_tokens: maxTokens,
            system:     systemPrompt,
            messages:   messages as Anthropic.MessageParam[],
          })
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullContent += event.delta.text
              controller.enqueue(encoder.encode(event.delta.text))
            }
            // 'max_tokens' here means the run was cut off mid-output — as opposed
            // to 'end_turn', which means the model stopped on its own. See the
            // getStopReason doc comment on StreamResult above for why this is
            // captured at all.
            if (event.type === 'message_delta' && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason
            }
          }
          controller.close()
          return
        } catch (err) {
          const rateLimited = isRateLimitError(err)
          const canRetry = fullContent === '' && (rateLimited || isTransientError(err)) && attempt < MAX_TRANSIENT_RETRIES
          if (canRetry) {
            const wait = rateLimited ? (getRetryAfterMs(err) ?? RATE_LIMIT_WAIT_MS) : RETRY_WAIT_MS
            console.warn(`[AIClient] ${rateLimited ? 'rate limited (429)' : 'transient error'} on ${label} (retrying in ${wait}ms, attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
            await new Promise(r => setTimeout(r, wait))
            continue
          }
          controller.error(err)
          return
        }
      }
    },
  })
  return { readable, getContent: () => fullContent, getStopReason: () => stopReason }
}

// ── Non-streaming completion ───────────────────────────────────────────────────

/**
 * createCompletion — non-streaming AI call for background/structured tasks.
 *
 * Backward compatible: callers that pass only (prompt, maxTokens) are unaffected.
 * See file doc comment for the full legacy vs tiered routing behavior.
 *
 * @example
 *   // Structured call — always Claude in legacy hybrid mode, always premium
 *   // role in tiered mode
 *   await createCompletion(prompt, 4000, { provider: 'anthropic' })
 *
 *   // Generative call — always DeepSeek in legacy hybrid mode, always fast
 *   // role in tiered mode
 *   await createCompletion(prompt, 1200, { provider: 'deepseek' })
 *
 *   // With separate system prompt + low temperature (e.g. ontology tagger)
 *   await createCompletion(userMsg, 2000, {
 *     provider:     'anthropic',
 *     systemPrompt: TAGGER_SYSTEM,
 *     temperature:  0.1,
 *   })
 */
export async function createCompletion(
  prompt:    string,
  maxTokens  = 4000,
  options:   CompletionOptions = {},
): Promise<string> {
  const { provider, systemPrompt, temperature } = options
  const result = await resolveProvider(provider)
  const target = result.target
  console.log(`[AIClient] createCompletion → ${describeTarget(target)} (${maxTokens} max tokens)${TIERED_ROUTING_ENABLED ? (result.wasOverride ? ' [tiered, override]' : ' [tiered]') : ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  logResolvedRequest(result, 'createCompletion')

  switch (target.kind) {
    case 'deepseek-legacy':
      return completeOpenAICompatible(deepseek, DEEPSEEK_MODEL, prompt, maxTokens, 'createCompletion/deepseek', systemPrompt, temperature, DEEPSEEK_THINKING)
    case 'mistral-cloud':
      return completeOpenAICompatible(mistral, MISTRAL_MODEL, prompt, maxTokens, 'createCompletion/mistral', systemPrompt, temperature)
    case 'qwen-selfhosted':
      return completeOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        prompt, maxTokens, 'createCompletion/qwen-selfhosted', systemPrompt, temperature,
      )
    case 'mistral-selfhosted':
      return completeOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        prompt, maxTokens, 'createCompletion/mistral-selfhosted', systemPrompt, temperature,
      )
    case 'anthropic-legacy':
    case 'anthropic-elite': {
      const model = target.kind === 'anthropic-elite' ? ELITE_PREMIUM_MODEL : ANTHROPIC_MODEL
      const res = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemPrompt  ? { system: systemPrompt }  : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
      return res.content[0].type === 'text' ? res.content[0].text : ''
    }
  }
}

// ── Provider info ──────────────────────────────────────────────────────────────

export function getProviderInfo() {
  return {
    provider:             GLOBAL_PROVIDER,
    routingMode:          ROUTING_MODE,
    tieredRoutingEnabled: TIERED_ROUTING_ENABLED,
    model:                GLOBAL_PROVIDER === 'deepseek' ? DEEPSEEK_MODEL : ANTHROPIC_MODEL,
    anthropicModel:       ANTHROPIC_MODEL,
    deepseekModel:        DEEPSEEK_MODEL,
    deepseekThinking:     DEEPSEEK_THINKING,
    mistralModel:         MISTRAL_MODEL,
    elitePremiumModel:    ELITE_PREMIUM_MODEL,
  }
}


Copilot said:

Reasoning completed in 1 step
Yes. Based on the logs and these two files, the application did reach the Claude routing path at least twice, and the later workflow switched to Mistral because the tier header disappeared or was never attached to those subsequent requests.

Bottom-line conclusion
Claude was selected twice
The logs contain these entries:

09:15:30.863
[AIClient] createCompletion → anthropic-elite
(claude-sonnet-4-6) (600 max tokens) [tiered]
and:

09:16:14.661
[AIClient] createCompletion → anthropic-elite
(claude-sonnet-4-6) (600 max tokens) [tiered]
That proves resolveProvider() successfully resolved those calls to:

{ kind: 'anthropic-elite' }
It then entered this branch:

case 'anthropic-legacy':
case 'anthropic-elite': {
  const model =
    target.kind === 'anthropic-elite'
      ? ELITE_PREMIUM_MODEL
      : ANTHROPIC_MODEL
 
  const res = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    ...
  })
}
So Claude was not globally unavailable or incorrectly configured at the routing level. The code selected the Anthropic SDK and attempted an actual anthropic.messages.create() request.
sharepoint

Did Claude actually return a response?
Very likely yes, but the logging does not prove it conclusively
The log statement occurs immediately before the network request:

console.log(
  `[AIClient] createCompletion → ${describeTarget(target)} ...`
)
Only after that does the code call:

await anthropic.messages.create(...)
Therefore, the log proves Claude was selected and invoked, but it does not directly prove Anthropic returned HTTP 200 because there is no success log after the await.

However, the workflow continued after both calls:

The first Claude call was followed by ontology and structural processing.
The second Claude call was followed by examiner POST processing, contradiction checks, independence scoring, and persona generation.
There is no Anthropic authentication, model-not-found, quota, or API error in the supplied log.
The second request began at approximately 09:16:14, and downstream examiner activity appeared at 09:16:45. That 31-second interval is consistent with an AI completion finishing and the user or client proceeding to the next stage. It is not absolute proof, but it strongly suggests the Claude call completed successfully.
sharepoint

Confidence assessment
Claude routing happened: confirmed
Anthropic SDK request was attempted: confirmed by the control flow
Claude returned successfully: highly likely
Exact Claude response or HTTP status: not provable from these logs
Why did the later calls not reach Claude?
The later requests repeatedly produced:

[AIClient] no x-product-tier header on a
tiered-routing-eligible request — falling back to free
Immediately around those warnings, the application selected:

mistral-cloud (mistral-small-latest) [tiered]
Under your routing code, this is expected behavior.

The exact fallback path
In resolveProvider():

const tierInfo =
  getCurrentTier() ??
  (await getTierFromHeaders()) ??
  FREE_TIER
When the header is missing:

const tier = h.get('x-product-tier')
 
if (!tier) {
  console.warn(...)
  return undefined
}
That leads to:

tierInfo = FREE_TIER
The free-tier routing branch always returns:

case 'free':
default:
  return { kind: 'mistral-cloud' }
This applies even if the call site requested Anthropic:

provider: 'anthropic'
because, under tiered routing, provider: 'anthropic' means only:

premium role
It does not force Anthropic.

For a free-tier request:

free + premium role = Mistral Small
free + fast role    = Mistral Small
So the observed Mistral calls are fully explained by the missing tier header.
sharepoint

Why was the tier header missing?
There are several possible paths in middleware.ts, but one is especially important.

1. The request had no Bearer token
Your middleware explicitly does this:

if (!authHeader?.startsWith('Bearer ')) {
  return NextResponse.next({
    request: { headers: requestHeaders }
  })
}
That means:

no Authorization header,
cookie-only authentication,
a server-to-server request that does not forward authorization,
a client fetch that omits the Bearer token,
all produce no x-product-tier header.

The middleware does not stamp:

x-product-tier: free
in this path. It simply forwards the request unchanged.

The AI client then sees no header, logs the warning, and falls back to FREE_TIER.

This conflicts with one of the comments
The getTierFromHeaders() comment says:

legitimate free-tier requests still get an explicit x-product-tier: free header from middleware.ts

That is not true for unauthenticated or Bearer-less requests.

Bearer-less requests get no tier header at all:

if (!authHeader?.startsWith('Bearer ')) {
  return NextResponse.next(...)
}
As a result, the AI client cannot distinguish:

an intentional unauthenticated/free request,
a client-side missing-token bug,
an unmatched middleware route,
a failed tier lookup,
execution outside request scope.
All five appear as the same warning.

2. The Bearer token existed, but getUser(token) returned no user
The middleware does this:

const { data: { user } } = await anon.auth.getUser(token)
 
if (user) {
  // set tier headers
}
If Supabase returns:

user = null
without throwing, the middleware:

sets no user ID,
sets no product tier,
logs no failed authentication message,
and forwards the request.
This can happen when the token is invalid, expired, malformed, or not valid for the Supabase project/environment.

This failure is currently silent because you discard the Supabase error:

const { data: { user } } = await anon.auth.getUser(token)
A more diagnostic version would capture it:

const {
  data: { user },
  error,
} = await anon.auth.getUser(token)
 
if (error || !user) {
  console.warn('[middleware] bearer token did not resolve to a user', {
    pathname: req.nextUrl.pathname,
    error: error?.message ?? null,
  })
}
Do not log the token itself.

3. The tier lookup threw an error
If this fails:

const tierInfo = await getProductTier(user.id)
the catch block forwards the request without tier headers:

catch (err) {
  console.error(
    '[middleware] tier resolution failed (non-fatal):',
    err
  )
}
The app-server log would then show only:

no x-product-tier header ... falling back to free
Your middleware failure could be in a separate runtime/log stream, exactly as the AI-client warning says.
sharepoint

Possible causes include:

Supabase service/configuration failure
missing environment variables in the middleware runtime
database lookup failure
Edge-runtime incompatibility in getProductTier() or its imports
network timeout
incorrect Supabase project credentials
The provided middleware file alone is not enough to validate getProductTier() and createClient() for Edge execution.

4. The request bypassed the middleware matcher
Your middleware runs only for:

'/api/persona/:path*',
'/api/examiner/:path*',
'/api/session/:path*',
'/api/record/:path*',
'/api/mirror/:path*',
'/api/case-study/:path*',
'/api/voice/:path*',
'/api/structural-match/:path*',
'/api/ontology/:path*',
'/api/bias-score/:path*',
If an AI call originates from any other route, for example:

/api/synthesis/*
/api/chat/*
/api/council/*
/api/generate/*
the middleware will never run.

The log names such as [Persona] and [Examiner] are component labels, not necessarily proof of the HTTP route pathname. You need route-level logging to confirm which actual endpoint initiated each call.

That said, if synthesis is inside /api/persona, it should match. In that case, missing Bearer authorization or silent user/tier resolution is more likely than an incomplete matcher.

5. An internal server request may not forward the original headers
If a route or server component makes an internal call such as:

await fetch('/api/persona', {
  method: 'POST',
  body: ...
})
the original incoming Bearer token is not automatically guaranteed to be forwarded.

The internal request may pass through middleware as a fresh request, but without:

Authorization: Bearer ...
This results in:

if (!authHeader?.startsWith('Bearer ')) {
  // forwarded without x-product-tier
}
This is a particularly plausible explanation if:

an early browser-originated request reached Claude,
then downstream server-to-server or asynchronously triggered calls routed to Mistral.
What the sequence suggests
The behavior was not “Claude never worked.” It was:

Request A
  Authorization token available
  → middleware resolves Elite
  → x-product-tier: elite
  → premium role
  → Claude Sonnet 4.6
 
Request B
  Tier header missing
  → AI client falls back to FREE_TIER
  → premium role still maps to Mistral
  → Mistral Small
 
Request C onwards
  Tier header continues to be missing
  → all roles route to Mistral
  → multiple parallel calls hit Mistral
  → synthesis receives 429
The logs show two Claude selections, followed by repeated missing-tier warnings and Mistral routing.
sharepoint

Most probable root cause
My ranking based on the code and observed mixed behavior is:

1. Bearer token was not present on later requests
This is the strongest code-level explanation because the middleware intentionally and silently forwards such requests without a tier header.

This can happen if later operations are:

server-to-server fetches,
async follow-up calls,
client fetches missing auth,
or requests using cookies instead of Bearer tokens.
2. Supabase getUser(token) returned null/error
The code does not log this condition, so it would look exactly like the observed failure.

3. getProductTier() failed in middleware
This should appear in the middleware/Edge log, but that log was not included.

4. Some AI-producing route is missing from config.matcher
Possible, but less likely if all these operations genuinely occur beneath /api/persona and /api/examiner.

5. headers() lost request scope
Possible for detached/background work, but given the many normal route operations, I would investigate authorization propagation first.

Recommended instrumentation
Add one diagnostic log in middleware without exposing sensitive values:

export async function middleware(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const requestHeaders = new Headers(req.headers)
 
  console.info('[middleware] tier resolution start', {
    pathname: req.nextUrl.pathname,
    hasBearer: authHeader?.startsWith('Bearer ') ?? false,
  })
 
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[middleware] no bearer token', {
      pathname: req.nextUrl.pathname,
    })
 
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }
 
  try {
    const token = authHeader.slice(7).trim()
    const anon = createClient()
 
    const {
      data: { user },
      error: authError,
    } = await anon.auth.getUser(token)
 
    if (authError || !user) {
      console.warn('[middleware] token did not resolve to user', {
        pathname: req.nextUrl.pathname,
        error: authError?.message ?? null,
      })
 
      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    }
 
    const tierInfo = await getProductTier(user.id)
 
    console.info('[middleware] tier resolved', {
      pathname: req.nextUrl.pathname,
      userIdSuffix: user.id.slice(-8),
      tier: tierInfo.tier,
      hasFastOverride: Boolean(tierInfo.modelRouteFast),
      hasPremiumOverride: Boolean(tierInfo.modelRoutePremium),
    })
 
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-product-tier', tierInfo.tier)
 
    // Remaining headers...
  } catch (err) {
    console.error('[middleware] tier resolution failed', {
      pathname: req.nextUrl.pathname,
      error: err instanceof Error ? err.message : String(err),
    })
  }
 
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}
Also expand the AI-client warning to record the observable context:

const authPresent = Boolean(h.get('authorization'))
 
console.warn('[AIClient] product tier missing', {
  authPresent,
  userIdPresent: Boolean(h.get('x-user-id')),
})
Avoid logging the full authorization header or token.

One concrete reliability improvement
Stamp an explicit reason header from middleware:

if (!authHeader?.startsWith('Bearer ')) {
  requestHeaders.set('x-tier-resolution', 'no-bearer')
 
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}
Other possible values:

resolved
invalid-token
no-user
tier-lookup-failed
Then the AI client can log:

const resolution = h.get('x-tier-resolution') ?? 'middleware-not-run'
This cleanly distinguishes:

middleware never ran,
token was missing,
token validation failed,
product-tier lookup failed,
tier resolved normally.
Final verdict
Claude was reached at the application routing and SDK invocation level twice. The absence of Anthropic errors and continuation of the workflow make successful Claude responses highly likely, although the current logging lacks a post-response success marker.

The later calls did not go to Claude because x-product-tier was missing. With tiered routing enabled, the code deliberately converts a missing tier into FREE_TIER, and all free-tier calls, including premium-role calls, route to Mistral Small.

The most likely reason is that the later requests did not carry the Bearer token into middleware, especially if they were internal, asynchronous, or server-to-server requests. The next most likely cause is that getUser(token) returned no user and the middleware silently forwarded the request. The current logging cannot distinguish these conditions, so targeted middleware instrumentation is the fastest way to confirm the exact branch.





log
Sources
You said:
let's forget elite case for now - any idea why this issue of rate limit would still happen on Mistral? all 6 persona mistral calls are working fine - also, if I refreshed (before applying rate limit fix of retry) earlier, the synthesis would perfectly load in free tier
Copilot said:

Reasoning completed in 1 step
Yes, this behavior is internally consistent. The six persona calls succeeding can actually be the reason the immediately following synthesis gets rate-limited. Refresh then works because the initial burst has ended, the provider’s rolling limit has partially reset, and the application likely does not repeat the exact same high-concurrency workload.

What happened in this run
The important sequence is:

09:16:45.430 - 09:16:45.443
Six Mistral persona streams launched almost simultaneously
 
09:16:47.274 - 09:16:48.489
Persona outputs began completing
 
09:16:59.157 - 09:17:00.234
Synthesis context assembled
 
09:17:00.234
Mistral synthesis stream launched, max_tokens=3200
 
09:17:02.164
Mistral returned HTTP 429
So the synthesis request reached Mistral roughly 12 to 15 seconds after the six persona calls, with multiple smaller Mistral completions also occurring earlier in the same minute.
sharepoint

That is a classic burst-limit pattern:

Many smaller calls succeed
        ↓
They collectively consume the short-window allowance
        ↓
The next, largest request arrives
        ↓
That request is rejected with 429
Why all six personas could succeed while synthesis fails
A rate limit is generally not a simple rule like:

“Only six simultaneous requests are allowed.”

Providers can enforce multiple limits concurrently:

Requests per minute
Tokens per minute
Concurrent active streams
Short-window burst limits
Account or workspace-level limits
Model-specific capacity limits
Dynamic service-capacity limits
The personas may have been accepted while capacity was available. Once accepted, their generation consumed tokens and occupied streaming capacity. The synthesis arrived afterward, when the short rolling window was already heavily used.

In other words:

The first six calls got through the door. The seventh, heavier call arrived after those six had consumed the available allowance.

The fact that the personas completed successfully only proves that Mistral accepted those requests. It does not mean there was enough remaining quota for another large request.

Why synthesis is more likely to be rejected
The persona calls each requested:

2200 max tokens
There were six of them:

6 × 2200 = 13,200 maximum output tokens
The synthesis then requested:

3200 max tokens
So the immediate theoretical output exposure was:

13,200 + 3,200 = 16,400 output tokens
This excludes:

Prompt/input tokens
Bias context
Council context
Parent-session continuity
Historical graph context
Structural-match context
Earlier scoring completions
Ontology and examiner calls
Not all providers charge the full max_tokens value against the rate limit upfront, and the log does not reveal Mistral’s exact accounting method. Still, the synthesis is clearly the heaviest single call, and it arrives after the burst rather than before it. That makes it the natural request to encounter the limit.

The log also shows several Mistral completion calls before and during the workflow, including requests with limits of 2,000, 200, 150, 80, and 4,000 tokens. Therefore, it was not merely “six persona calls plus synthesis.” There was broader Mistral activity during the same short period.
sharepoint

Why refresh worked before the retry fix
This is the strongest clue that the underlying problem is a temporary burst limit, not a permanently invalid request.

On refresh, one or more of the following likely changed.

1. The rate-limit window had time to clear
Even a short user delay can make a difference:

Initial run:
six personas + scoring + synthesis in a tight burst
→ 429
 
User notices failure
→ waits several seconds
→ refreshes
 
Refreshed run:
rolling usage window has partially cleared
→ synthesis accepted
That aligns with the current retry behavior. In the provided run, the system received a 429, waited eight seconds, retried, and progressed far enough to run the SynthesisAudit. The audit found a missing tension tag rather than another rate-limit failure, indicating that the retry likely obtained a synthesis response.
sharepoint

Your automated retry is effectively reproducing what the user previously did manually:

Old behavior:
429 → user waits → refresh → request succeeds
 
New behavior:
429 → application waits 8 seconds → retries → request succeeds
2. Refresh may only reload synthesis
If persona responses were already saved to the session, cached in state, or retrieved from the database, refresh might not launch all six personas again.

The refreshed workload may look like:

Load stored persona outputs
        ↓
Call synthesis once
        ↓
Success
Whereas the initial workload looks like:

Scoring completions
        +
six simultaneous persona streams
        +
bias processing
        +
synthesis
        ↓
429 on synthesis
This would explain why the exact same free-tier user can fail on the first run and succeed reliably on refresh.

Whether this is definitely happening depends on the persona route and frontend reload logic, which are not included in the two files. But it is highly plausible from the observed behavior.

3. The original persona streams were no longer active
Even if the generated token limit was not the bottleneck, the provider may limit active or recently active streams.

On the first run:

Six streams finish or are closing
        ↓
Synthesis starts almost immediately
On refresh:

Previous streams are fully closed
        ↓
Only synthesis is active
Your log records persona audits between 09:16:47 and 09:16:48, with synthesis starting at 09:17:00. That is a gap, but provider-side accounting may remain in a rolling window after streams complete.
sharepoint

The likely root cause
My best diagnosis is:

Mistral accepted the six parallel persona streams, but those streams, combined with the earlier scoring completions and their prompts/outputs, consumed the short-window request or token allowance. The 3,200-token synthesis request then arrived at the peak of that burst and received a 429. Refresh worked because the burst had subsided and probably only the synthesis needed to run again.

This does not indicate that any particular persona call was broken.

It also does not indicate that the synthesis prompt was invalid. If the prompt were invalid, waiting and refreshing would not normally make it work.

Is retry a valid fix?
Yes, for recovery
The retry is appropriate for this exact behavior:

const RATE_LIMIT_WAIT_MS = 8000
The log demonstrates the intended flow:

rate limited (429) on streamMistral
retrying in 8000ms
Afterward, the synthesis audit ran, so the workflow recovered past the initial 429.
sharepoint

But retry alone does not eliminate the burst
It prevents a user-visible failure, but the initial request still exceeds the provider’s immediate allowance.

A better overall strategy is:

Keep the retry.
Honor Retry-After, which your implementation already attempts.
Add jitter so simultaneous sessions do not all retry at the same moment.
Reduce the burst before synthesis.
Capture provider rate-limit response headers for diagnosis.
Best fixes in order
1. Keep the 429 retry
This is the immediate practical fix and closely matches the successful manual-refresh behavior.

Your current implementation is bounded at two retries, so it should not loop indefinitely.

2. Add a small synthesis buffer
After all persona calls have completed, wait briefly before launching synthesis, for example 2 to 5 seconds.

This is not as robust as a real rate limiter, but it can smooth a tight provider burst.

await Promise.all(personaCalls)
 
// Small provider cooldown before the heaviest request
await new Promise(resolve => setTimeout(resolve, 3000))
 
const synthesis = await createStream(...)
Since the retry already waits eight seconds after failure, a shorter proactive buffer may reduce total latency by avoiding the 429 altogether.

3. Limit persona concurrency
Instead of launching all six at the exact same millisecond, run them in groups:

Wave 1: 3 personas
Wave 2: 3 personas
Then synthesis
Or use a maximum concurrency of 2 or 3.

This increases persona-stage duration somewhat but substantially reduces burst pressure.

4. Reserve Mistral capacity for synthesis
Synthesis is the user-facing culmination of the workflow. It should not compete equally with optional or background scoring calls.

A useful internal policy would be:

High priority:
- synthesis
 
Medium priority:
- user-facing personas
 
Low priority:
- structural summaries
- short labels
- audits and background completions
The lower-priority Mistral calls can be queued or slightly delayed if six personas are active.

5. Avoid using unnecessarily high output limits
A persona limit of 2,200 tokens may be larger than required if typical responses are only a few hundred tokens long.

For example:

Six × 2,200 = 13,200 maximum persona output tokens
Six × 1,200 = 7,200 maximum persona output tokens
You should first measure actual output lengths before reducing them. If personas regularly finish naturally around 500 to 900 tokens, a 2,200 cap may be excess headroom.

Do not reduce synthesis blindly, because the code comments show that an earlier 1,200-token ceiling caused mandatory ending sections to be truncated.

6. Log returned rate-limit metadata
For each 429, log safe diagnostic headers such as:

retry-after
x-ratelimit-limit-requests
x-ratelimit-remaining-requests
x-ratelimit-reset-requests
x-ratelimit-limit-tokens
x-ratelimit-remaining-tokens
x-ratelimit-reset-tokens
Only log headers that Mistral actually returns. This will tell you whether the limit is:

requests,
tokens,
concurrency,
or provider capacity.
Right now, the code can extract Retry-After, but it does not log the wider header set. Without that telemetry, the burst diagnosis is strong but not mathematically conclusive.

One code nuance worth knowing
For Mistral streaming, withRetry() wraps this initial operation:

client.chat.completions.create({
  stream: true,
  ...
})
That handles a 429 occurring while the stream is being established, which is what the log appears to show.

However, if Mistral accepts the stream and then fails while this loop is consuming it:

for await (const chunk of stream) {
  ...
}
that error occurs inside ReadableStream.start() and is not retried by withRetry().

So the current retry fixes:

429 before output starts
but does not necessarily recover:

429 or network failure after stream creation
For the observed incident, that distinction likely does not matter because the 429 appeared two seconds after launch and no synthesis output or partial-audit activity appears before it. Still, it is a remaining resilience edge case.

Final assessment
The observed behavior is exactly what I would expect from a burst-sensitive free-tier Mistral allowance:

Six parallel persona calls were accepted.
Several other Mistral completions had already run.
The largest request, synthesis, came immediately afterward.
It received a temporary 429.
Waiting and retrying allowed it through.
Manual refresh previously achieved the same effect because it introduced a delay and likely avoided rerunning the full initial burst.
So yes, the retry fix is justified. I would retain it, then add rate-limit header telemetry and either a small pre-synthesis cooldown or a concurrency cap of three personas to prevent the 429 rather than merely recovering from it.





log
Sources



Message Copilot


AI-generated content may be incorrect