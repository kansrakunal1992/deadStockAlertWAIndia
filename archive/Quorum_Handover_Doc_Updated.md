# QUORUM — Living Handover Document
> **Last Updated:** April 30, 2026 **Active Sprint:** Sprint 5/6 validation hardening **Next:** Fix remaining Sprint 5 traceability  Sprint 6 identity continuity gaps, then proceed to Mirror

---

## 📌 HOW TO USE THIS DOC
Update the **Current State**, **Active Bugs**, and **Latest Prompt** sections after every session. All other sections are reference — update only when architecture or vision changes.

---

## 🧠 WHAT IS QUORUM

**Quorum** is a private AI-powered decision-making tool. It presents 6 AI "advisor" personas that analyse a user's high-stakes decision in parallel — each from a distinct psychological and strategic lens — then synthesises their views into a directional recommendation.

**Not an AI chatbot. Not a SaaS tool.**
It is a **Judgment Compounding System**: the quality of a user's decisions improves the more they use it, because the tool learns their decision patterns, biases, and mental models over time.

**Original inspiration:** *The Entire History of You* (Black Mirror)  *Devs* — the vision of an externalised, searchable, improvable memory of decisions.

---

## 🔭 3-YEAR PRODUCT / RESEARCH CONTEXT

Quorum's long-term architecture was derived through an iterative research loop combining real user testing, behavioral economics, cognitive psychology, AI prompt/system design, literature-style exploration, hypothesis generation, ruthless evaluation, deep-dive analysis, stress testing, and iteration.

The core research outcome was that Ledger is not "memory" in a generic sense. It is a structured decision-intelligence layer designed to solve a difficult problem: how to model a person's recurring decision patterns, biases, and reasoning style from sparse, delayed, and causally ambiguous decision data without hallucinating false patterns or merely reflecting the user's own self-narrative.

This led to a clear moat architecture:
- Decision Ontology Tagger
- Structural Retrieval / Relatedness Engine
- Examiner / Diagnostic Layer
- Adversarial Bias Library
- Consistency / Confidence Weighting
- Contradiction Detector
- Mirror Module for surfaced personal insight

The defensibility comes from architecture, not just prompts: Quorum retrieves prior decisions by structure rather than text similarity, combines passive and active diagnostic data collection, compounds reliability over time, and eventually surfaces contradiction and bias fingerprints that are unique to the user.

**Expanded long-term product arc:**
- **Council** → immediate multi-perspective decision analysis
- **Ledger** → structured decision memory, ontology, retrieval, and bias signal collection
- **Mirror** → surfaced personal insight, fingerprinting, contradiction, and decision independence
- **Graph** → connected network of decisions, stakeholders, influences, and outcomes
- **Legacy** → generational transfer / decision-philosophy continuity

---

## 🧪 RESEARCH METHOD USED

The Ledger / Mirror architecture was not derived from generic "memory app" thinking. It was developed through a research-lab-style loop:
1. Problem sharpening
2. Literature-style exploration of known approaches
3. Hypothesis generation
4. Ruthless elimination / survival testing
5. Deep dive on strongest ideas
6. Stress testing / counterexamples
7. Iteration and multi-agent-style debate

This method was used specifically to avoid building a superficial RAG layer and instead arrive at a genuinely defensible personalization architecture.

---

## 🧱 CONSTITUENTS OF THE RESEARCH

The research combined four layers:

**1. Real-world product learning**
- Live user sessions and session analysis
- UX feedback loops on readability, pushback behavior, synthesis, and decision logging
- Outcome tracking and session history learnings
- GTM feedback from validation users versus intended HNI/CXO audience

**2. Conceptual / literature review**
- Review of why standard approaches are insufficient for Quorum's constraints:
  - Bayesian updating
  - ML on behavioral logs
  - Generic LLM bias detection
  - LLM personality inference
  - Psychometric instruments
  - Naive RAG-over-history

**3. Hypothesis generation**
- Adversarial bias scoring
- Decision ontology retrieval
- Consistency / confidence weighting
- The Examiner (diagnostic questioning layer)
- Longitudinal contradiction detection

**4. Formalization into architecture**
- Ontology tagger
- Structural relatedness engine
- Persona weighting
- Examiner question selection
- Bias library
- Contradiction detector
- Mirror layer

---

## ✅ OUTCOME OF THE RESEARCH

The research produced four major conclusions:

**1. Ledger is a structured decision-intelligence layer, not generic memory.**  
It exists to make Quorum smarter about the person, not just to store prior sessions.

**2. The core unsolved problem is now clearly defined.**  
Quorum must infer recurring bias patterns, reasoning tendencies, and decision fingerprints from fewer than ~50 qualitative decisions per year, with delayed outcomes and weak causal ground truth.

**3. The winning architecture is structural, not merely semantic.**  
Naive vector retrieval is not enough. The system needs structured decision typing, structural retrieval, active elicitation, calibrated bias scoring, and longitudinal contradiction detection.

**4. Product sequencing became clear.**
- Council provides immediate value
- Ledger builds structure and signal
- Mirror surfaces reliable personal insight
- Graph and Legacy extend the product into networked and generational value

### ❗ THE ACTUAL UNSOLVED LEDGER PROBLEM
  
This is the deepest unresolved problem inside Quorum and the real source of moat if solved well:
  
**How do you model a person's recurring bias patterns, reasoning tendencies, and decision style from sparse, qualitative, delayed, and causally ambiguous decision data — without hallucinating false patterns, and without simply reflecting the user's own self-narrative back to them in more sophisticated language?**
  
Why this is hard:
- **Sparse data problem:** most users will log fewer than ~20–50 meaningful decisions per year, far below what standard ML-style personalization needs.
- **Delayed outcome problem:** outcomes often resolve months or years later, so supervised feedback loops are broken by design.
- **Causal attribution problem:** even when outcomes exist, it is unclear whether the decision, the market, execution quality, luck, or external conditions drove the result.
- **Reinforcement paradox:** if the system naively surfaces a bias profile too early, it may simply validate the user's existing self-story rather than help them see something true and useful.
- **Cold-start tension:** the product must be useful from session 1, yet genuinely personalized only after repeated use.
  
This is why Ledger is not a generic memory or retrieval problem. It is a **low-data personal decision-intelligence problem** with weak and delayed ground truth.

### 📚 WHAT WAS EXPLORED — AND WHY IT WAS NOT ENOUGH
  
Several obvious or adjacent approaches were explicitly considered and should not be reintroduced casually:
  
**1. Bayesian updating / formal belief-updating approaches**
- Strong where repeated probabilistic judgments exist.
- Fails here because Quorum decisions are sparse, heterogeneous, and narrative-form rather than repeated controlled trials.
  
**2. ML on behavioral logs**
- Works when there are hundreds or thousands of compact action traces per user.
- Fails here because Quorum has low-frequency, high-dimensional, natural-language decisions rather than dense clickstream-style data.
  
**3. Generic LLM bias detection**
- Good for one-off textual analysis.
- Fails as a moat because it is stateless and cannot distinguish situational bias from a recurring personal fingerprint.
  
**4. LLM personality inference from text**
- Relevant as adjacent evidence that language can reveal stable traits.
- Fails here because those methods usually rely on huge corpora of expressive text (social posts, forums), whereas Quorum sees sparse, strategic, task-oriented decision descriptions.
  
**5. Psychometric instruments / questionnaires**
- Useful for a baseline snapshot.
- Insufficient because they are static, self-reported, easy to game, and poor at context-specific bias activation.
  
**6. Naive RAG / vector retrieval over decision history**
- Easy to ship.
- Not a moat.
- Fails because semantic similarity is not the same as structural or psychological similarity. Two decisions can look different in text yet share the same bias architecture; equally, two textually similar decisions may be psychologically different.
  
Bottom line: **the winning direction is not “better retrieval” in the generic sense; it is structural decision typing  active elicitation  calibrated longitudinal patterning.**

### 🧪 RESEARCH LOOP OUTPUT — WHAT SURVIVED VS. WHAT WAS DEFERRED
  
The research process generated multiple candidate ideas. The following distinctions are important so future sessions do not reopen already-resolved debates:
  
**Near-term survivors (Ledger-relevant, feasible, and strategically differentiated):**
- **Decision Ontology / Structural Decision Typing** — core infrastructure; the load-bearing layer for retrieval, weighting, and longitudinal reasoning.
- **Structural Retrieval** — retrieve by decision structure, not surface wording.
- **The Examiner** — active elicitation layer that collects higher-signal data than passive text inference alone.
- **Contextual Bias Library** — bias detection should be context-conditional and narrative, not just scalar.
- **Consistency / Confidence Weighting** — reliability should compound only as similar signals recur.
  
**Useful principles absorbed into the architecture, but not necessarily standalone product layers yet:**
- **Adversarial calibration mindset** — bias detection prompts should lean prosecutorial / stress-testing rather than polite or balanced optimism.
- **Outcome-aware reinforcement** — outcomes matter, but should not be treated as clean supervised labels.
  
**Deferred to later-stage product (mainly Mirror / beyond):**
- **Contradiction Detector** — highly promising and likely emotionally powerful, but weakest at cold start and should not be surfaced until there is enough history to avoid false positives.
- **Full explicit bias fingerprinting to the user** — should only be shown once confidence has compounded sufficiently across sessions.
- **Graph-level relational intelligence** — belongs after Ledger signal quality is high enough.
  
Guiding rule: **do not surface psychologically strong claims until the evidence base is longitudinally earned.**


---

## 🛡️ WHY THIS CREATES A CLEAR MOAT

Quorum's moat is the architecture produced by the research:

**A. Decision Ontology**  
Creates a structured representation of each decision that powers retrieval, diagnostic questioning, weighting, and longitudinal analysis.

**B. Structural Retrieval**  
Retrieves past decisions by underlying structure rather than surface wording, allowing cross-domain pattern detection.

**C. Examiner Layer**  
Collects active diagnostic data rather than relying only on passive text inference.

**D. Adversarial Bias Library**  
Moves bias detection beyond naive one-pass scoring toward calibrated, context-sensitive patterning.
 ### 🔍 How Bias Accumulation and detection_count Work
 The bias scorer creates a new bias_library row for every completed session 
 after Examiner submission. Each session-level row always has detection_count = 1.

 The scorer then checks prior rows for the same user and bias_key. If this bias 
 appeared before, it increments the **historical accumulated row**:
 - detection_count: 1
 - confidence_weight: 0.3 (max 1.0)

 This means:
 - Session-level rows record that session’s biases.
 - Accumulated rows track longitudinal patterns across decisions.
 - Bias accumulation depends on **multiple sessions**, not on reuse of a single 
   session.

**E. Consistency / Confidence Weighting**  
Improves reliability as similar patterns recur over time.

**F. Contradiction Detection**  
Creates uniquely powerful signals when current decisions conflict with past principles or patterns.

**G. Mirror Layer**  
Turns the above into visible user value: bias fingerprint, decision patterns, contradictions, and eventually decision independence.

This moat is interdisciplinary. It sits at the intersection of behavioral economics, cognitive psychology, philosophy of action, AI prompt/system design, and product architecture. That combination is significantly harder to replicate than UI or prompt wording alone.

---

## 🏗️ LEDGER / LONG-TERM ARCHITECTURE OBTAINED FROM RESEARCH

**Ledger core components:**
1. **Decision Ontology Tagger** — tags each session across core structural dimensions
2. **Structural Retrieval Engine** — retrieves prior structurally similar decisions
3. **Persona Weighting Layer** — adjusts persona emphasis based on decision structure / register
4. **Examiner Layer** — asks the most useful missing questions and stores higher-signal answers
5. **Bias Library** — stores contextual / conditional bias patterns over time
6. **Consistency Weighting** — raises or lowers confidence in patterns as evidence accumulates
7. **Contradiction Detector** — compares current decisions to prior principles / tendencies
8. **Mirror Module** — surfaces longitudinal patterns back to the user

**Expanded long-term architecture:**
- Council
- Ledger
- Mirror
- Graph
- Legacy

---

## ⚙️ CRITICAL IMPLEMENTATION / DO-NOT-REDEBATE DECISIONS

These are implementation choices already learned the hard way and should not be casually undone:

**1. Bias scoring must remain server-side, triggered from `/api/examiner POST`, not client-side from synthesis.**  
Client-side firing failed when users delayed on Examiner, browser connections went stale, or Railway cold-started. Server-side execution works because all required session data is already in Supabase.

**2. Bias / retrieval jobs must read from DB, not from client-passed persona state.**  
The DB is the source of truth for decision text, persona outputs, synthesis, examiner responses, and follow-up exchanges.

**3. Never instantiate model SDKs directly inside background logic.**  
All streaming and non-streaming calls must go through `lib/ai-client.ts` abstraction so provider switching works consistently across UI, bias scoring, and structural retrieval.

**4. Structural retrieval is intentionally rule-based, not embedding-based.**  
The ontology already provides a structured semantic representation. Rule-based structural matching is more interpretable and more accurate for cross-domain analogues than naive vector similarity.

**5. After Examiner answers, only mapped personas should receive supplemental follow-up. Never re-run all 6 personas.**  
Selective re-run preserves quality, reduces cost/fatigue, and keeps updates targeted:
- stakeholder/family gaps → Stakeholder Mirror
- financial/execution/counterparty gaps → Risk Architect
- market/pattern gaps → Pattern Analyst

**6. Original persona analysis should remain immutable.**  
Examiner-based supplements and pushback replies append below the original analysis; they do not overwrite the initial response. Record integrity matters.

**7. Council Synthesis may recalibrate; original persona text should not.**  
Pushbacks, selective persona supplements, and new context should trigger synthesis refresh / recalibration, while preserving the original advisor output.

**8. Synthesis race-condition / stale-closure fixes are critical.**  
Synthesis previously got stuck at "Synthesising…" or accidentally re-triggered flows because of stale React closures / cleanup behavior. The implementation path must preserve proper cancellation / ref handling (e.g. AbortController-style logic) so synthesis only fires when intended.

**9. Saved-record / PDF integrity depends on DB persistence.**  
If synthesis, Decision Brief, user pushbacks, or assistant follow-up responses are not stored in DB, the record page and PDF export become incomplete or misleading.

**10. Raw bias scores should not be user-facing pre-Mirror.**  
Users should receive actionable narrative insight, not exposed scalar profiling. Trust requires that bias confidence compounds before surfacing.

---

## 🔐 SESSION HISTORY / OWNERSHIP / PRIVACY REALITY

**Pre-auth history model:**  
Before auth, session IDs are stored in localStorage and drive device-specific history.

**Post-auth history model:**  
After magic-link auth, session rows are linked to `user_id` / `user_email`, and history should merge:
- localStorage session IDs
- `user_id`-linked sessions

**Important constraint:**  
The magic link does **not** contain Quorum session IDs. Session IDs live in localStorage and are linked post-auth via callback flow.

**History principle:**  
Always merge localStorage and `user_id` history after auth. Do not choose one source and drop the other.

**Privacy posture:**  
Sessions are private by URL and not linked to identity until explicit auth. This is private enough for trusted early use, but not equivalent to end-to-end encryption or self-hosted inference. Long-term private infra / client-controlled memory is still the target for HNI-grade trust.

**Product philosophy:**  
Quorum should improve user judgment, not create dependency. Infrastructure should remain mostly invisible; only useful, context-rich insights should surface.

 ## 🧩 Correct Session Lifecycle (Clarification)
 A "session" represents a **single decision workflow**:
   Council → Examiner → (supplemental personas) → Synthesis → (optional Brief).

 New sessions should be created **only when the user submits a new decision**.
 "New Decision" simply resets UI and prepares for the next decision.

 Bias Library, Structural Retrieval, and Mirror all rely on the existence of 
 multiple sessions per user. Sessions are not meant to persist across decisions 
 or be re-used.

### 🗂️ LIGHTWEIGHT LEDGER PRECURSOR (ALREADY PULLED FORWARD)
  
Before full Ledger search / personalization is live, Quorum now effectively has a **lightweight pre-Ledger layer** whose purpose is retention and continuity rather than deep intelligence:
- device-local session history
- saved decision records
- outcome logging / outcome pending state
- ability to revisit prior sessions and reanalyze
  
This does **not** change the core product concept. It is still Council-first. It simply prevents returning users from feeling like each session starts from zero.
  
Important framing:
- This is **not** the full Ledger.
- This is the minimum continuity layer needed before deeper memory intelligence makes sense.
- Full Ledger still means structural retrieval, contextual patterning, and personalized signal compounding — not just a session list.
  
Known limitation:
- localStorage history is device-specific until auth / session linking is working correctly.
- For early use this is acceptable, but it must be clearly understood as a temporary limitation, not the end-state memory model.

### 🧾 PUSHBACK / CHALLENGE PERSISTENCE RULE
  
Pushback / challenge interactions are strategically important and must not be treated as disposable UI-only state.
  
Rules:
- User pushback text should be persisted to DB as a first-class message event, not only the assistant follow-up.
- Saved record views and PDF exports should preserve the integrity of the exchange, not just the post-pushback assistant reply.
- Council Synthesis should be allowed to recalibrate after pushback, but the original persona analysis should remain immutable.
- Pushback content is high-value future Ledger data because it reveals disagreement, clarification, and what the user felt was missing or wrong.
  
If pushback messages are not stored, later longitudinal reasoning loses one of the richest signals available in the Council stage.

### 🧾 DECISION BRIEF GATING / PREMIUM REALITY
  
Decision Brief is conceptually a premium artifact even if some implementations / test flows temporarily expose it more broadly.
  
Principles:
- The free product is the Council experience.
- The premium layer is the **formatted, board/co-founder-shareable Decision Brief**, ideally paired with a founder-led advisory run.
- Any temporary open access to Decision Brief in testing should be treated as staging behavior, not final product truth.
- Premium gating can begin simply (token / access code / invite-based access) before a fuller entitlement system exists.
  
The important product distinction is: **the software experience may be free to try; the executive-grade artifact and founder-led advisory format are what create the paid wedge.**


---

## 🗃️ OPERATIONAL / SCHEMA / MIGRATION NOTES

**Migration order should remain:**
1. `schema.sql`
2. `sprint1_ontology.sql`
3. `sprint2_add_register.sql`
4. `sprint3_examiner_phase1.sql`
5. `sprint4_bias_score.sql`
6. `sprint5_structural.sql`
7. `sprint6_auth.sql`

**Tables / objects that are operationally critical:**
- `sessions` — source session record; later enriched with `register_mode`, `user_email`, and linked `user_id`
- `messages` — source of persona outputs / synthesis / follow-ups used by bias scoring and saved record views
- `sessions_ontology` — ontology tagger output; drives examiner, retrieval, and bias weighting
- `examiner_responses` — stores three diagnostic answers used by selective re-run and bias scoring
- `bias_library` — contextual bias detections with `detection_count` and `confidence_weight`
- `structural_matches` and `structural_scores` — retrieval output and traceability for structural memory
- `session_outcomes` — required for outcome logging, pending-outcome nudges, and future contradiction / Mirror reliability
- `user_preferences`, `brief_access_tokens`, and `link_sessions_to_user` RPC — auth / premium gating / session-linking support added with Sprint 6
- `contradiction_log` (future) — should be planned as a first-class table once contradiction detection is implemented

**Environment variables that matter operationally:**
- `AI_PROVIDER` — single switch controlling provider routing; use env change, not code branching
- `DEEPSEEK_API_KEY` and `ANTHROPIC_API_KEY` — both supported behind `ai-client.ts`
- `BRIEF_ACCESS_TOKEN` — current premium brief gate
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client auth / data access config
- `SUPABASE_SERVICE_ROLE_KEY` — server-only key for privileged writes / linking flows
- `NEXT_PUBLIC_APP_URL` — explicit app URL for auth redirect fallback; set to Railway URL

**Operational dependencies future sessions should not miss:**
- Bias scoring depends on `messages`  `examiner_responses`  session metadata being present in DB
- Structural retrieval depends on complete ontology rows and the structural tables from Sprint 5
- History merge depends on both localStorage session IDs and Sprint 6 auth linkage working together
- Memory Engine / outcome UX depends on `session_outcomes` being written and read consistently

---

## 🎯 WHO IT'S FOR

| Audience | Why They Pay |
|---|---|
| HNIs (High Net Worth Individuals), Middle East initially | Better decisions = crore-level financial impact |
| Family office MDs, second-gen business owners | Need cognitive offload  privacy |
| CXOs, founders in high-stakes inflection points | Want thinking partner, not just information |

**Current users (test group):** XLRI Jamshedpur alumni WhatsApp group — upper-middle-class urban India, mostly career  personal finance decisions. Right audience for validation, wrong audience for ₹25K pricing.

---

## 🏗️ PRODUCT ARCHITECTURE (3-PHASE VISION)

```
Phase 1 — COUNCIL (built)
└── 6 advisors → Council Synthesis → Decision Brief

Phase 2 — LEDGER (in progress)
└── Ontology Tagger → Bias Library → Structural Retrieval → Examiner → Mirror Module

Phase 3 — MIRROR (future)
└── Bias Fingerprint → Decision Timeline → Contradiction Detector → Decision Independence Score
```

---

## 🧩 THE 6 ADVISORS (Core Product)

| Persona | Role | Lane (Does NOT overlap with) |
|---|---|---|
| The Contrarian | Challenges assumptions; strongest case against the decision | No pre-mortem, no risk categories |
| The Risk Architect | Categorises failure modes; hidden dependencies | No historical case studies (that's Pattern Analyst) |
| The Pattern Analyst | Historical precedents; base rates; analogies | No pre-mortem; no failure mechanics |
| The Stakeholder Mirror | Unstated stakeholders; hidden incentives | Prioritises partner/spouse in personal decisions |
| The Elder | Reversibility; long-term consequences; legacy | No emotional sentimentality — stays strategic |
| The Competitor | Adversarial framing; who gains from you deciding wrong | Adjusted: "what does this signal to yourself" for personal decisions |

** Synthesis Card (7th):** Fires after all 6 complete  Examiner answered. Identifies collective agreements, sharpest divergence, one pivotal question, directional lean. ≤200 words. Optionally closes with a 1-2 sentence pattern observation (seeds Mirror).

** Decision Brief:** Structured 350-word executive document (separate from synthesis). Shareable with board/co-founder. Used as the ₹25K paid output. Format: THE DECISION / COUNCIL POSITION / CRITICAL RISKS / PIVOTAL QUESTION / DIRECTIONAL RECOMMENDATION.

---

## 📊 CURRENT USER DATA

| Metric | Value |
|---|---|
| Total sessions | 29 (as of late April 2026) |
| Pushbacks | 0 (critical — dialogue is invisible to users) |
| Synthesis sessions | ~7/29 (recent builds only) |
| Persona word limit compliance | ~62% (300-word limit failing; move instruction to top of prompt) |
| Decision categories | Career (9/29), personal finance, parenting, founder ops |
| Examiner completions | 2 submitted, 2 skipped, rest pending |
| bias_library table | Populating and accumulating on newer email-linked sessions; pre-auth Session 1 rows remained on device_id and were not retro-linked post-auth

---

## 🖥️ TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway |
| AI Provider | DeepSeek (current) → Anthropic Claude (planned switch) |
| Auth | Supabase Magic Link |
| Repo | GitHub → deployed via Railway |

**Live URL:** `https://invigorating-manifestation-production-ecd2.up.railway.app`

**Railway env vars:**
```
AI_PROVIDER = deepseek (or anthropic)
ANTHROPIC_API_KEY = ***
DEEPSEEK_API_KEY = ***
BRIEF_ACCESS_TOKEN = ***
NEXT_PUBLIC_SUPABASE_URL = ***
NEXT_PUBLIC_SUPABASE_ANON_KEY = ***
SUPABASE_SERVICE_ROLE_KEY = ***
```

---

## 📁 KEY FILE MAP

```
app/
  page.tsx                    — Home page (input form, register mode, memory counter, auth)
  api/
    session/route.ts          — Creates session, triggers ontology tagger async
    persona/route.ts          — Streams persona responses; injects register_mode  structural context
    examiner/route.ts         — GET: generates 3 questions from ontology gaps | POST: saves answers  fires bias scorer
    bias-score/route.ts       — Reads messages  examiner Q&A from DB; adversarial scoring; upserts bias_library
    ontology/route.ts         — GET: returns full ontology tag for a session
    structural-match/route.ts — Scores current session against past sessions; returns context_block
    auth/route.ts             — Sends Supabase magic link via signInWithOtp
    auth/link-sessions/route.ts — Links localStorage session IDs to user_id post-auth
    history/route.ts          — Returns sessions by localStorage IDs  user_id (dual query)
  auth/callback/page.tsx      — Magic link landing; exchanges token; calls link-sessions; redirects home
  record/[id]/page.tsx        — Saved session view

components/
  PersonaPanel.tsx            — Streams single persona; handles pushback; fires supplemental on examiner context
  SessionView.tsx             — Orchestrates all panels; register mode; examiner gating; structural context
  SynthesisCard.tsx           — Fires after allDone  examinerReady; recalibrates on pushback version bump
  ExaminerPanel.tsx           — 3 diagnostic questions; gating synthesis; onComplete passes responses array
  RecordExport.tsx            — PDF export; Decision Brief first; Synthesis second; then 6 personas
  MemoryEngineStatus.tsx      — Home page counter: sessions toward 5-threshold for Pattern Memory
  AuthPanel.tsx               — Email input for magic link; identity pill when authenticated

lib/
  personas.ts                 — All 6 prompts  SYNTHESIS prompt  DECISION_BRIEF prompt
  types.ts                    — PersonaKey union (includes 'synthesis', 'decision_brief')
  ontology-tagger.ts          — Prompt-driven 9-dimension decision tagger (not rule-based)
  bias-scorer.ts              — 15-bias adversarial prosecutor/defense scoring; uses createCompletion
  structural-retrieval.ts     — 100-point rubric scoring; Haiku annotation; uses createCompletion
  ai-client.ts                — Provider abstraction: createStream, createCompletion, getProviderInfo
  storage.ts                  — localStorage helpers: session IDs, user email, device_id (getOrCreateDeviceId)
  auth.ts                     — Auth hook/utilities

supabase/
  schema.sql                  — Base schema
  sprint1_ontology.sql        — sessions_ontology table
  sprint2_add_register.sql    — register_mode column on sessions
  sprint3_examiner_phase1.sql — examiner_responses table (already exists from sprint1)
  sprint4_bias_score.sql      — bias_library table  indexes
  sprint5_structural.sql      — structural_matches  session_outcomes  structural_scores tables
  sprint6_auth.sql            — user_email on sessions, user_id on bias_library, user_preferences, brief_access_tokens, link_sessions_to_user RPC
```

---

## ✅ SPRINTS COMPLETED

### Sprint 1 — Ontology Tagger ✅
**What it does:** After every session is created, an async background job tags the decision across 9 dimensions. Stored in `sessions_ontology`. Powers everything downstream (Examiner questions, Structural Retrieval, Bias weighting).

**9 dimensions:**
1. `decision_type_primary` — allocation / commitment / transition / acquisition / renunciation / governance / delegation
2. `stakes_reversibility` — fully reversible / partial / irreversible
3. `stakes_bearer` — self / family / organisation / third parties
4. `stakes_timeline` — immediate / 1-3yr / 5yr / generational
5. `deadline_credibility` — high / medium / low / none (manufactured urgency detection)
6. `counterparty_alignment` — aligned / partial / misaligned / unknown
7. `instrumental_weight` vs `constitutive_weight` — financial vs identity/values split (0.0–1.0 each, sum to 1)
8. `dominant_emotion`  `examiner_gap_1/2/3` — 3 specific unknown-unknown gaps for Examiner
9. `hidden_stakeholder_probability` — low / medium / high

**Key design:** Prompt-driven reasoning (not rule-based). Only 2 hard rules: investor deadlines = low credibility, medical urgency = high. Everything else inferred.

**Test:** `SELECT * FROM sessions_ontology ORDER BY created_at DESC LIMIT 1;`

---

### Sprint 2 — Register Mode ✅
**What it does:** User chooses mode before submitting decision. Choice stored on session. Flows through to all 6 persona prompts as a context modifier.

| Mode | Effect |
|---|---|
| ⚔ Challenge my thinking | Default. Analytical lean. Contrarian  Risk Architect weighted heavier |
| 🪞 Help me understand what I want | Clarification lean. Elder  Stakeholder Mirror weighted heavier. Synthesis surfaces values tension first |

**Reanalyze drawer** also shows the mode selector — user can re-run with different mode.

---

### Sprint 3 — Examiner Phase 1 ✅
**What it does:** After all 6 personas complete, an Examiner panel appears (between personas and synthesis). Shows 3 targeted diagnostic questions generated from the ontology gaps. User answers inline. Synthesis is **gated** — only fires after Examiner answers submitted (or Skip clicked).

**Gap-to-persona mapping:** After examiner submission, 1-2 personas most relevant to the gaps receive supplemental API calls. Original analysis untouched; supplemental appears as a blue-bordered "Updated with your answers" section below.

- Stakeholder/family/spouse gaps → Stakeholder Mirror
- Financial/execution/counterparty/tax gaps → Risk Architect
- Market/competitive/pattern gaps → Pattern Analyst

**Key:** Examiner POST also triggers bias scoring fire-and-forget (server-side — not client-side).

---

### Sprint 4 / 4b — Bias Library  Anonymous Identity ✅ FIXED (April 29, 2026)
**What it does:** After Examiner POST, `/api/bias-score` fires as a background job. Reads decision text  persona responses (from `messages` table)  examiner Q&A (from `examiner_responses`) from DB. Runs adversarial prosecutor/defense scoring across 15 bias parameters. Upserts to `bias_library`.

**15 bias parameters:** fomo_urgency, overconfidence, attribution_asymmetry, social_proof, control_illusion, speed_bias, exit_optionality_mispricing, recency_bias, uniqueness_fallacy, deference_distortion, relationship_alignment_assumption, success_compression, loss_aversion_reversal, network_circularity, complexity_opacity

**Confidence weighting:** Starts at 0.3. Rises by 0.3 each time same bias appears in future session for same user (capped at 1.0). Never shown to user until Mirror module (Sprint 7).

**Accumulation fix (April 29):** Bias rows now correctly accumulate per user. session_ids[] appends, detection_count increments, confidence_weight rises. See Bug 4 fix notes above.

**Sprint 4b — Anonymous device identity (April 29):** Added `device_id` as a third-tier accumulation key for users who run sessions without entering an email. Generated silently on first visit via `crypto.randomUUID()`, stored in localStorage as `quorum_device_id`, passed to every session. Bias accumulation now works for all user types:
- `user_id` (post magic-link auth) — cross-device, permanent
- `user_email` (entered on home page) — cross-device, pre-auth
- `device_id` (anonymous) — device-local, ephemeral
- No identity — INSERT only, no accumulation

`MemoryEngineStatus` shows an email CTA instead of the progress bar for anonymous users — prevents misleading pattern-memory progress for data that lives only in localStorage.

 **Test 4 Validation (April 29):**
 - **4-a (Trigger):** Bias scorer reliably triggered after Examiner POST — logs confirmed `[BiasScore] Scoring session...` for each run.
 - **4-b (Write):** Rows inserted correctly into `bias_library`; detection_count initialized at 1 with confidence_weight = 0.30.
 - **4-c (Accumulation):** Repeated bias (e.g., `exit_optionality_mispricing`) across two sessions for the same identity correctly updated:
     - detection_count = 2  
     - confidence_weight = 0.60  
     - session_ids[] = [sessionA, sessionB]
 This confirms the post-fix accumulation logic works for both email and authenticated identities.

---

### Sprint 5 — Structural Retrieval 🔧 (Core retrieval validated April 30; structural_scores still failing)
**What it does:** Scores current session's ontology tag against all past sessions from same user. Retrieves top 1-2 structural matches (threshold: ≥45/100 points). Annotates why they match. Injects into Pattern Analyst, Risk Architect, and Elder persona context as "you faced this structure before."

**100-point scoring rubric:**
- Decision type match: 30 pts
- Register proximity (instrumental/constitutive): 25 pts
- Stakes architecture: 20 pts
- Counterparty alignment: 15 pts
- Time pressure: 10 pts

**Why not embeddings:** The 9-dimension ontology is already a structured semantic representation. Rule-based rubric is more interpretable and accurate for this use case. Cross-domain pattern detection is the killer feature (PE deal  career pivot are structurally identical — embeddings blur this).

**Prerequisite:** ≥5 sessions per user with `tagger_status = 'complete'` in DB.

 **Sprint 5 Bug Fix (April 29):** Structural Retrieval was never populating `structural_matches` or `structural_scores` tables due to three independent bugs:

 - **Race condition:** `structural-match` fired client-side immediately on session page load, before the ontology tagger finished for the current session. Route returned early (`"No complete ontology"`) with no retry.
 - **Missing identity:** SessionView's client-side fetch sent no `userEmail`/`userId`, so the past-sessions query guard fired and returned empty even when ontology was ready.
 - **structural_scores never written:** Route only wrote `structural_matches`, never `structural_scores`.

 **Fixes applied:**
 1. `app/api/structural-match/route.ts` — reads `user_email`/`user_id` from the `sessions` table (DB) rather than requiring client to pass them. Returns `ontology_ready: false` flag when current session not tagged yet. Adds pairwise inserts to `structural_scores`.
 2. `app/api/examiner/route.ts` — adds `triggerStructuralMatch(sessionId)` fire-and-forget after bias scoring. By examiner POST time, ontology is always complete. Also fixes `getBaseUrl()` to use `NEXT_PUBLIC_APP_URL` correctly.
 3. `components/SessionView.tsx` — adds retry logic (up to 4 attempts, 6s apart) when ontology not ready, so structural context can still inject into personas if tagger completes fast enough.
 
**April 30 validation status:**
- Structural retrieval now runs successfully against past sessions once ontology is complete and same-user history exists.
- Session 6 test successfully scored against 5 past sessions and returned 2 valid structural matches above threshold.
- structural_matches is being written correctly with context_block and matches_json.
- However, structural_scores remains empty even when logs confirm scoring occurred. This means the summary/match layer is working but the pairwise score traceability layer is still not writing and remains an open Sprint 5 issue.

 **Run `sprint5_structural.sql`** if `structural_matches` or `structural_scores` tables don't yet exist in your Supabase instance.

 **⚠️ `session_outcomes` table:** The Sprint 5 SQL incorrectly created a `session_outcomes` table. The app uses `outcomes` (created by the original schema). Run `DROP TABLE session_outcomes;` in Supabase and the one reference in `app/api/structural-match/route.ts` line 176 has been corrected to `.from('outcomes')`.



---

#### Sprint 6 — Auth 🔧 (Implemented; core session linking works, identity continuity still incomplete)
**What it does:** Email magic link via Supabase. Sessions linked to `user_id`. History and bias data become cross-device.

**Flow:**
1. User types email → `/api/auth` calls `supabase.auth.signInWithOtp()`
2. Supabase emails magic link → user clicks → lands on `/auth/callback`
3. Callback exchanges token → gets `user_id`  `user_email` → calls `/api/auth/link-sessions` with localStorage session IDs
4. `link_sessions_to_user` RPC writes `user_id`  `user_email` onto those session rows
5. `/api/history` now dual-queries: localStorage IDs  user_id (merged  deduplicated)

**Auth flow:** Magic link → Supabase verify → `/auth/callback?code=PKCE_CODE` → `exchangeCodeForSession(code)` → `getSession()` → `link-sessions` RPC → redirect home. Fixed and operational.

**April 30 validation status:**
- Anonymous Session 1 was successfully linked to authenticated identity after magic auth at the sessions table level.
- Newer post-auth sessions are currently storing user_email but not consistently stamping user_id.
- Bias scoring works on newer sessions under user_email, but pre-auth bias rows created under device_id are not being retro-linked / merged after auth.
- Result: session-linking works, but identity continuity across bias_library is still partially fragmented across device_id and user_email lanes.

**Magic Link Email Branding (April 29):**
 The Supabase Magic Link email template has been updated with Quorum branding without altering functional behavior. 
 Safe changes include updating:
 - Subject: **"Sign in to Quorum — continue across devices"**
 - Body: Quorum logo, branded heading, context on cross‑device continuity and memory-layer linkage, premium dark‑navy CTA button.
 
 **Email Template Snippet (HTML):**
 
 <p style="margin-bottom:16px;">
   https://invigorating-manifestation-production-ecd2.up.railway.app/quorum-logo.png" 
     alt="Quorum" 
     width="120" 
     style="display:block; border:0; outline:none; text-decoration:none;"
   />
 </p>

 <h2>Sign in to Quorum</h2>

 <p>Your private decision workspace is ready.</p>

 <p>
 Sign in to continue your decisions across devices, link your prior sessions,
 and keep your emerging memory layer and pattern history connected to you.
 </p>

 <p>
   {{ .ConfirmationURL }}
     Open Quorum
   </a>
 </p>

 <p style="margin-top:20px; color:#6b7280; font-size:14px;">
 This secure sign-in link is time-sensitive. If you didn’t request it, you can ignore this email.
 </p>

 <p style="margin-top:8px; color:#6b7280; font-size:14px;">
 Quorum is a private AI-powered decision tool that helps you think through high-stakes decisions with structured perspectives, diagnostic questioning, and synthesis.
 </p>

 **Notes:**
 - The `{{ .ConfirmationURL }}` must remain untouched for Supabase PKCE flow.
 - The logo is served from the Railway deployment via `/public` folder.
 - Sender identity remains Supabase Auth unless custom SMTP is configured.


---

 ## 🔐 Long-Lived Sessions on Same Device (Corrected Auth Behavior)
 Magic links expire quickly by design, but after a successful login the user 
 should remain authenticated on the same device for weeks. This is achieved via 
 Supabase’s long-lived session and refresh-token mechanism.

 Required configuration:
 - Supabase → Authentication → Settings
   - Enable Refresh Token Rotation: ON
   - JWT Expiry: 2,592,000 seconds (30 days)
 - Ensure the client hydrates the saved session using 
   `supabase.auth.getSession()` on app load.
 - Do not clear localStorage or auth state on page reload or navigation.

 Result: The user logs in once per device. Magic link is only required when 
 signing in from a new device.

### Memory Engine Counter ✅ (Component built, wired into page.tsx)
**What it does:** Appears on home page once user has ≥1 session. Shows progress toward 5-session threshold for Pattern Memory (Structural Retrieval). Shows pending outcomes count as nudge.

**States:**
- 1–4 sessions: amber blinking dot, "Pattern Memory: inactive · N of 5 sessions"
- 5–9 sessions: green, "Pattern Memory: active · Mirror unlocks at 10"
- 10: "Mirror Module ready"

---

## 🚨 ACTIVE BUGS (As of April 30, 2026)

#### [Resolved] New Decision → New Session Behavior

 New Decision intentionally begins a new advisory session, because the product 
 architecture defines **one session = one decision**. Creating a new session on 
 "New Decision" is correct behavior.

 The issue was not session creation on New Decision, but that the document 
 previously assumed bias accumulation required a single session to persist. Bias 
 accumulation is **cross-session**, and requires multiple completed decisions, 
 not a single long-lived session.

 No change is required here. Session creation is correct.
---

### Bug 2 — Magic Link OTP Expired / localhost Redirect ✅ FIXED
**Root causes found (two independent issues):**

**A — Supabase redirect URL not allowlisted (dashboard config):**
Supabase silently ignores `emailRedirectTo` if the URL isn't in the Redirect URLs allowlist. It falls back to the configured "Site URL" (localhost:3000), so the magic link email itself contained a localhost redirect — the token was dead before the user ever reached Railway.

**Fix applied (Supabase dashboard):**
- Authentication → URL Configuration → Site URL: set to `https://invigorating-manifestation-production-ecd2.up.railway.app`
- Authentication → URL Configuration → Redirect URLs: add `https://invigorating-manifestation-production-ecd2.up.railway.app/**`

**B — Callback page never exchanged the PKCE code (code fix):**
Supabase v2 uses PKCE by default. The magic link delivers `?code=PKCE_CODE` as a query param. `getSession()` returns null until that code is explicitly exchanged via `supabase.auth.exchangeCodeForSession(code)`. The original callback called `getSession()` directly, getting null every time.

**Fix applied:** `app/auth/callback/page.tsx` rewritten to:
1. Read `?code` from URL via `useSearchParams()`
2. Call `exchangeCodeForSession(code)` first
3. Then call `getSession()` — which now returns the valid session
4. Wrapped in `<Suspense>` (required by Next.js 15 for `useSearchParams()`)

**Railway env var added:** `NEXT_PUBLIC_APP_URL` = `https://invigorating-manifestation-production-ecd2.up.railway.app` (belt-and-suspenders fallback in `api/auth/route.ts`)

**What magic link does NOT contain:** The Quorum session ID (common misconception). Session IDs live in localStorage. Magic link only carries the Supabase auth token. After callback, `link-sessions` API joins them.

---

### Bug 3 — ExaminerPanel Skip not hiding panel ✅ FIXED
**Fix applied:** `handleSkip()` now calls `setSubmitStatus('done')` before `onComplete([])`. Files: `components/ExaminerPanel.tsx`.

---

### Bug 4 — `bias_library` accumulation broken ✅ FIXED (April 29, 2026)
**Root cause found (two independent issues):**

**A — user_id and user_email both null on sessions:**
`page.tsx` was not passing the locally-stored `quorum_user_email` to `/api/session` POST. Sessions were created with no user identity, so the bias scorer had no stable key to group rows by user.

**Fix applied:** `page.tsx` now includes `user_email` from localStorage in the session creation payload. `app/api/session/route.ts` accepts and stores it on the `sessions` row.

**B — Accumulation query matched ALL anonymous users (the core accumulation bug):**
In `app/api/bias-score/route.ts`, the lookup for an existing bias row used `.is('user_email', null)`, which matched every null-email row globally. Since PostgreSQL NULLs are not equal for unique constraints, multiple rows with the same `bias_parameter` and null email existed. `.maybeSingle()` returned `null` on multiple matches → always fell through to INSERT → detection_count never incremented beyond 1.

**Fix applied:** The accumulation lookup now correctly scopes to the current user:
- If `user_id` is present (post-auth): query by `user_id  bias_parameter`
- If `user_email` is present (pre-auth, entered on home page): query by `user_email  bias_parameter`
- If both are null (fully anonymous): INSERT only, no accumulation (correct behaviour — can't deduplicate without identity)
- `user_id` and `user_email` are now included in all INSERT statements so future lookups can find them.

**Test 4-c expected result post-fix:** Two sessions from the same user (email entered on home page or authenticated) with overlapping biases will show `detection_count = 2`, `confidence_weight = 0.6`, and both session IDs in `session_ids[]`.

#### Bug 5 — pre-auth bias rows not retro-linked after auth 🔧 OPEN

**Observed behavior (April 30):**
- Session 1 run anonymously/device-local was scored correctly into bias_library under device_id.
- After magic auth, the session row itself was linked successfully to user_id / user_email.
- However, the already-created bias_library rows for that session remained on device_id only and were not upgraded / merged into the authenticated identity lane.

**Why this matters:**
- This leaves bias history fragmented across device_id and email/auth identity lanes.
- It weakens the intended post-auth continuity model for longitudinal bias accumulation.

#### Bug 6 — new post-auth sessions not consistently stamping user_id 🔧 OPEN

**Observed behavior (April 30):**
- Newer authenticated sessions are storing user_email but user_id remains null on those newer session rows.
- Structural retrieval and bias scoring still function using user_email, so same-device testing can continue.
- However, the intended post-auth model is stronger authenticated continuity, not email-only continuity.

#### Bug 7 — structural_scores remains empty even when structural retrieval succeeds 🔧 OPEN

**Observed behavior (April 30):**
- Logs confirm structural retrieval scoring runs against past sessions.
- structural_matches is written successfully with threshold_met, matches_json, and context_block.
- structural_scores remains empty.

**Why this matters:**
- Sprint 5 is functionally working at the product layer, but the traceability layer is incomplete.
- The handover architecture expects both structural_matches and structural_scores to be written.
---

## 📋 SPRINTS REMAINING

| Sprint | Name | Status | Prerequisite |
|---|---|---|---|
| 4 | Bias Library | ✅ Fixed (April 29) | — |
| 5 | Structural Retrieval | 🔧 Core retrieval passing; structural_scores traceability still open | 5 sessions per user |
| 6 | Auth | ✅ Complete | — |
| 7 | Mirror Module | 🔲 Not started | Auth  10 sessions  bias data |
| 8 | Decision Brief PDF (paywall) | 🔲 Not started | Auth (brief_access_tokens table ready) |
| 9 | Contradiction Detector | 🔲 Not started | Mirror  structural_matches at scale |

### Sprint 7 — Mirror Module
Three views: Bias Fingerprint (conditional patterns — e.g. "FOMO activates when a trusted contact endorses a deal", not just scalar scores), Decision Timeline (visual, structural connections across sessions), Decision Independence Score (tracks if user incorporates Quorum's frameworks unprompted). **This is the paid tier.**

### Sprint 8 — Decision Brief PDF (Paywall)
The existing Decision Brief UI → export as premium PDF. `brief_access_tokens` table already in Supabase (from Sprint 6 SQL). One-time purchase or session-based gate. Target: ₹25K for live session  formatted PDF.

### Sprint 9 — Contradiction Detector
Weekly background job. Extracts stated principles from past decisions. Flags when current decision structurally violates them. Surfaces as: "Before you begin — something worth knowing about your last three decisions." Most emotionally resonant feature in the product. Requires structural_matches  session_outcomes at scale.


### 🚪 STAGE GATE TO MOVE FROM COUNCIL → LEDGER
  
Do **not** move fully into Ledger just because the memory idea is compelling. Council must clear specific validation gates first.
  
The practical stage gate is:
- **First paying engagement at any real price point** (proof that the decision quality / artifact is valuable enough to monetize).
- **At least one user who explicitly wants to return for a second real decision** (proof of repeat decision utility, not just curiosity).
- **Evidence that users are engaging with the product as a thinking partner, not only as a one-time report generator.**
  
Additional validation signals that strengthen the decision to move:
- pushback / challenge interactions are actually being used
- outcomes are being logged with some consistency
- at least a few real users from the true target audience (CXO / founder / family business / HNI-adjacent) have run meaningful decisions
  
Important strategic distinction:
- **Validation audience** and **paying audience** are not the same thing.
- XLRI / WhatsApp / upper-middle-class urban users are useful for product feedback and prompt refinement.
- They are not proof of willingness to pay ₹25K for a Brief.
- The true commercial proof point comes from a user whose decision stakes are high enough that a ₹25K artifact is obviously cheap relative to the downside of a bad call.
  
Rule of thumb:
- Council should prove **quality, repeatability, and commercial pull**
- Ledger should only begin once there is evidence that continuity across decisions will actually matter to real users
  
Otherwise the risk is building sophisticated memory before the live advisory core has proved itself.

---

## 💰 BUSINESS MODEL & GTM

**Pricing:**
- Free tier: Full council  synthesis (current)
- Paid: ₹25K for a live 45-min session run by founder  formatted Decision Brief PDF
- Eventually: ₹1L–₹10L/year per HNI user; ₹25L for family office setups

**Stage gate to Ledger:** First paying transaction at any price point  at least one user who comes back for a second session.

**Target paying user profile:** Someone whose decision involves ₹1 Cr of capital or a role that pays ₹1 Cr annually. At that scale, ₹25K = 0.025% of capital at stake.

**LinkedIn GTM sequence:**
1. Post PE deal showcase (done) — mine post engagements for warm leads
2. Comment on posts by family business operators, founders in fundraising, CXOs in transitions — genuine insight, not promotion
3. DM 15 people whose recent activity signals a live high-stakes decision
4. Pitch: "I run a 45-min private advisory session on your decision, you get a formatted Brief you can share with your board. Tell me what you're wrestling with."
5. Price comes only after they're interested: "₹25K for the Brief — live run  formatted output  follow-up if anything changes."

**WhatsApp nudge template (for pushback engagement):**
> "Hey everyone — quick tip: after each advisor responds, there's a gold 'Challenge this · add context' button at the bottom of their card. That's where it gets interesting. Push back, add something they missed, and the Council re-synthesises. That dialogue is the whole point. Worth trying on whichever advisor surprised you most."

---

## 🔬 RESEARCH FOUNDATION (for moat claims)

**Decision Ontology:** 8-dimensional structural tagging. Novel application — closest prior work is 1990s case-based reasoning. Ontology retrieval is more accurate than vector similarity for cross-domain pattern detection (PE deal  career pivot share identical bias structure; embeddings miss this).

**Bias Library:** Adversarial prosecutor/defense scoring. High asymmetry = strong bias signal. Confidence compounds over sessions. Design principle: never show a bias diagnosis from a single session.

**The Examiner:** Motivated interviewing applied to AI advisory. Questions are generated from ontology's unknown-unknowns, not generic. Answers stored tagged to bias parameters.

**Contradiction Detector (future):** Most emotionally resonant feature. "The moment you said X but did Y." Requires 30-50 sessions to be reliable — built for Mirror, not Ledger.

---

## 🧪 TESTING REFERENCE

### Sprint 4 Tests (Bias Library)
- **4-a:** Submit a decision → check Railway logs for `[BiasScore] Scoring session...` within 30s of Examiner submission
- **4-b:** Check Supabase `bias_library` for rows with matching `session_id` and correct `bias_key` values
- **4-c:** Run 2 sessions same user → same bias should appear twice with `detection_count = 2`, `confidence_weight = 0.6`
- **4-d:** Bad API key test → check `bias_library` row still created with `model_used = 'unknown'` or error logged cleanly

### Sprint 5 Tests (Structural Retrieval)
- Requires ≥5 sessions with same email, all `tagger_status = 'complete'`
- After 5th session, check Railway logs for `[StructuralRetrieval]` entries
- Check `structural_matches` table for new rows
- On 6th session, Pattern Analyst / Risk Architect / Elder responses should reference "you faced this structure before"

### Sprint 6 Tests (Auth)
- Enter email → receive magic link email (subject: "Your Magic Link" not "Confirm your signup")
- Click link → redirected to Railway URL `/auth/callback` (not localhost)
- After redirect: `sessions` table rows should have `user_id` populated
- On new device (clear localStorage): enter email → click link → full history appears

### Sprint 3 Tests (Examiner — already passing)
- All 6 personas complete → Examiner panel appears between synthesis and persona grid ✅
- Synthesis does NOT fire until Examiner submitted or skipped ✅
- After submit: 1-2 persona panels show blue-bordered "Updated with your answers" section ✅
- Skip → synthesis fires immediately, no persona updates ✅

---

## 📝 PROMPT IMPROVEMENTS LOG

| Area | Change | Reasoning |
|---|---|---|
| All 6 personas | Word limit instruction moved to TOP of each prompt (before identity) | Models ignore end-of-prompt instructions; top placement works |
| All 6 personas | Target 200-280 words (instruct "250 max" to get 300) | Models run 30-40% over stated limit |
| All 6 personas | Lane discipline: explicit NOT instructions | Prevents Risk Architect  Pattern Analyst overlap |
| All 6 personas | Optional opening question if critical info missing | Naturally creates pushback interaction |
| SYNTHESIS | ≤200 words hard cap | Senior partner debrief, not meeting minutes |
| SYNTHESIS | Optional 1-2 sentence pattern observation at close | Seeds Mirror without spoiling it; only fires when pattern is earned |
| Risk Architect | Personal finance delegation calibration added | Quantify transition tax first; fee creep second; lock-in third |
| Stakeholder Mirror | Partner/spouse elevated as primary unstated stakeholder in personal financial decisions | Best insight of test session — was buried without this instruction |

---

## 🔄 LATEST PROMPT (Start Here in Next Session)
**Context for next session:** 
Sprints 1–4 are functionally validated. Sprint 5 is now functionally validated at the structural_matches layer, but structural_scores is still empty and remains an open issue. Sprint 6 session-linking works at the sessions table level, but identity continuity is still incomplete because pre-auth bias_library rows are not retro-linked after auth and newer post-auth sessions are not consistently stamping user_id.

**Current validated state (April 30):**
- Bias scoring works.
- Bias accumulation works.
- Structural retrieval works and can find valid thresholded matches once 5 prior ontology-complete sessions exist.
- structural_matches is being written correctly.
- structural_scores is still empty.
- Anonymous Session 1 can be linked post-auth at the sessions table level.
- bias_library identity continuity remains partially fragmented across device_id and user_email lanes.

**Immediate action needed before Mirror:**
1. Fix structural_scores writes so Sprint 5 traceability matches the intended architecture.
2. Fix post-auth identity reconciliation for bias_library so pre-auth rows are merged/upgraded after auth.
3. Ensure new post-auth sessions stamp user_id consistently.
4. After the above, reset prototype test data and rerun a clean end-to-end validation flow.

**Only after the above is cleanly validated should Sprint 7 (Mirror Module) begin.**

---

## 📐 ARCHITECTURE DECISIONS (Do Not Re-debate)

| Decision | Rationale |
|---|---|
| Bias scoring triggered server-side from `/api/examiner` POST (not client-side) | Client-side fetch fails when user spends minutes on Examiner (stale connection / Railway cold start). Server already has all data in DB. |
| No embeddings for structural retrieval | Ontology tag is already structured semantic representation. Rule-based rubric is more interpretable, accurate, and requires zero infra. |
| Haiku for annotation, not full model | Annotation is language generation only; scoring is deterministic. Haiku adds ~100ms and pennies per session. |
| Bias diagnosis only shown at Mirror (Sprint 7) | Never show from single session — confidence must compound. Trust requires reliability. |
| Private infra preference (for HNI market) | Model layer in our cloud; personal memory graph in client VPC. Gives network effects on model  data sovereignty on memory. |
| Examiner questions from ontology gaps (not generic) | Generic diagnostic questions get ignored. Ontology-derived questions target the specific unknown-unknowns in this decision. |

---

 # 🚀 PRODUCT AMBITION — HOW QUORUM CAN DIE DOWN OR BECOME AMBANI‑LEVEL

 ## 1. THE DOWNSIDE — HOW QUORUM COULD DIE DOWN
 - No “holy‑shit” breakthrough moment for users
 - Staying in low-stakes segments (career guidance only)
 - Being perceived as another AI chatbot
 - Lack of founder-led demos and evangelism
 - Over-focus on infra or bugs at the cost of value delivery
 - Not using the product personally and publicly

 ## 2. THE UPSIDE — HOW IT REACHES AMBANI‑LEVEL USE
 - HNIs pay for clarity, not text; decisions have crores at stake
 - Architecture is deeply differentiated: ontology, examiner, synthesis,
   structural retrieval, bias accumulation, contradiction detection
 - Mirror module becomes category-defining
 - Privacy-first, structured, advisor-like design appeals to CXOs and family businesses

 ## 3. WHAT TO DO (PLAYBOOK FOR UPSIDE)
 - Ship Mirror module ASAP — this is the “holy shit” unlock
 - Build a premium, advisory-grade website (Apple × McKinsey energy)
 - Run founder-led demos with alumni, CXOs, family offices
 - Build flagship case studies (e.g., ₹1 Cr decision clarity)
 - Position Quorum as a private thinking partner, not a chatbot
 - Use yourself as the first HNI user — transparent, real decisions
 - Create scarcity: invite-only, founder-run sessions, early-access

 ## 4. WHAT NOT TO DO
 - Do NOT market it as a chatbot
 - Do NOT chase mass market early
 - Do NOT clutter UX — Council → Examiner → Synthesis must feel elite
 - Do NOT overshare internal mechanics (personas, scoring engine)
 - Do NOT use casual branding; tone must feel boardroom-ready

 ## 5. HOW TO PITCH QUORUM
 **One-liner:** “Bring one real decision — get six expert perspectives and a crisp synthesis in minutes.”
 Why it resonates:
 - immediate clarity
 - structured thinking
 - finds blindspots  hidden stakeholders
 - feels premium and private

 ## 6. WHY THE FOUNDER SHOULD BE EXCITED
 - You are building a new category: Personal Judgment Intelligence
 - Hard parts (ontology, personas, examiner, synthesis) are already built
 - Mirror will be a global-first capability
 - Every new session compounds the moat

*End of Quorum Handover Document — update after each session*