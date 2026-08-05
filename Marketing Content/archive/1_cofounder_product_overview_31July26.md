# Quorum — Product & Architecture Overview
*A plain-English walkthrough of what Quorum does, feature by feature, and how the backend is put together. No code, no formulas — written for a co-founder, not an engineer.*

---

## The one-line version

Quorum takes a real decision you're wrestling with, runs it past six differently-minded AI advisors plus a Socratic questioner, and gives you a synthesized verdict — then it remembers everything, so that over time it starts telling you things about *how you make decisions* that no single conversation ever could.

Think of the first session as a genuinely good conversation with six smart, opinionated friends. Think of the tenth session as something closer to a personal decision coach who's been quietly taking notes the whole time.

---

## The user journey, start to finish

1. **You type a decision.** "Should I take this job offer," "should I end this relationship" — anything. No signup required to start.
2. **Quorum quietly reads the decision's *shape*** before any advisor responds — how reversible is it, how much is riding on it, is there a real deadline or a manufactured one, is this really about you or about someone else's approval. This happens invisibly, in about a second.
3. **If the shape of the decision trips a red flag**, Quorum may interrupt *before* convening the advisors — for example, "this depends on a decision you haven't made yet" — and redirects you to resolve that first. Most of the time nothing fires and you go straight through.
4. **Six advisors respond, one after another**, each streaming in live as it's generated — so you're reading the first advisor's take while the next one is still being written, rather than waiting for all six to finish before seeing anything.
5. **If you push back on any one advisor, all six hear about it** — not just the one you challenged. Each reassesses independently and may hold, soften, or reverse its position.
6. **A built-in questioner asks two or three sharp follow-ups on every decision** — even a redirected one gets a question, just a sharper, narrower one aimed at resolving whatever tripped the flag. The standard version isn't generic journaling prompts; it's built around what's emotionally at stake, what's still ambiguous, and what your own history suggests you tend to skip over.
7. **A synthesis pulls it together** — a single headline verdict, a named central tension, and a short list of concrete next steps, visually distinct from the six individual takes.
8. **You rate your confidence, and later come back and log what actually happened.** This is the hinge the whole long-term product turns on — without it, Quorum is a smart chatbot. With it, Quorum starts learning your patterns.
9. **If new information shows up later, you can reopen the exact same decision** rather than starting a new one — the Council picks up the thread from where it left off instead of treating it as a stranger.
10. **Over many decisions**, Quorum builds a private profile of your blind spots, your calibration (are you usually too confident or too cautious?), which advisors tend to actually change your mind versus which ones you tend to overrule, contradictions between what you say and what you do, and a visual map connecting today's decision to past ones that rhyme with it.

---

## Feature by feature

### 1. The Council — six advisors, one decision

Six fixed personas, each with a genuinely different mandate so they don't converge into the same generic advice:

| Advisor | What they're for |
|---|---|
| The Contrarian | Argues against your stated leaning with real rigor — the strongest case against it you've likely under-weighted |
| Risk Architect | Maps the downside — what's the worst realistic case, and how bad is it really? |
| Pattern Analyst | Finds the shape this decision rhymes with — in your own past decisions, and in how situations built like this one usually play out |
| Stakeholder Mirror | Maps everyone this decision actually touches — their real interests, real fears, and whose reaction you've probably misjudged |
| The Elder | Long-game view — what does this look like in ten years, not ten days |
| The Competitor | Thinks like your smartest, most motivated adversary — who benefits if this goes wrong, and what's their next move? |

> Think of it like assembling a personal board of directors for one decision — except each board member has a fixed, non-negotiable job description, so you can't accidentally end up with six people all agreeing with each other (or with you).

### 2. Challenging any advisor — and why the whole Council hears about it

You can push back on any single advisor's take directly, in a couple of sentences, and get a short, direct reply back — held to a strict format so it either holds its ground with one genuinely new piece of reasoning, or plainly says its position changed, never just a longer restatement of what it already said. What's new: that challenge is no longer a private exchange with one advisor. It's automatically treated as new information for the *whole* Council — all six reassess it independently, through their own lens, and each may keep, strengthen, weaken, or reverse its position. Being told the same thing never means all six reach the same conclusion. The synthesis only re-runs once, after everyone's had the chance to weigh in — not once per challenge.

> Think of it like raising a point in a real boardroom, not a side conversation in the hallway — everyone at the table heard it, and everyone gets to update their own view, not just the person you were talking to.

### 3. Correcting your unexamined assumptions

Certain advisor arguments are specifically built to catch a mistaken assumption you're likely carrying without realizing it — the Risk Architect naming exactly what part of a decision actually can't be undone (people routinely assume more is reversible than really is), the Stakeholder Mirror naming the one person whose real buy-in the plan depends on and asking whether you actually have it or are just assuming it, the Pattern Analyst naming the specific condition that separated the times this kind of move worked from the times it didn't. When an advisor is making exactly this move, that specific sentence is visually highlighted inline in their response — not a separate callout box, just a quiet marker on the exact words doing the assumption-correcting, so it doesn't get lost in the surrounding paragraph.

### 4. The invisible triage step

Before any advisor sees your decision, Quorum scores it across 14 underlying dimensions — how reversible it is, how emotionally loaded, how much is genuinely unknown vs. knowable, whether it's really a solo call or needs someone else's buy-in, and more. None of this is shown to you in raw form — it's the scaffolding that makes everything downstream (which advisor leads, which questions get asked, which past decisions get pulled up) feel personalized instead of generic.

> Think of it like a triage nurse reading vitals before you see the doctor — you never see the chart, but every question the doctor asks next is shaped by it.

### 5. The red-flag system

Sitting on top of that scoring, a set of eleven rules fire on specific combinations — for example, "emotionally intense but no real deadline" (false urgency), or "this depends on some other decision you haven't made yet." Depending on what fires, Quorum lets the session proceed normally, quietly flags a caution to the advisors, holds the session for a clarifying question before the Council runs, or — in the most serious cases — stops and redirects you before convening anyone.

> Think of it like a smoke detector wired into the thermostat — usually silent, but a few specific patterns make it interrupt directly rather than just adding a note to the file.

One refinement worth knowing: for the specific rule that fires on "this needs information you don't have yet," Quorum now runs one extra, cheap check before fully redirecting — asking whether a genuinely useful, honest, provisional answer is possible today even with that gap named openly. Most of the time it is, so this softens what used to be a harder stop into the same clarifying-question path the other rules use, and only the rare, truly hinge-dependent cases still redirect outright.

### 6. The built-in Socratic coach

After the Council responds, a separate questioner asks two or three pointed follow-ups, built from three fixed roles: one aimed at the fear or identity question you haven't said out loud, one that either grounds a thin decision in more context or presses on whichever red flag fired, and one reflective closing question about what success actually looks like. This step runs on every single decision brought to Quorum — even a redirected one still gets a question, just a single sharper one aimed squarely at the flag that fired, rather than the usual three. Nothing here is canned — the questions are personalized against your own stated fears, your emotional state, and, once you've used the product a while, your confirmed long-run patterns.

### 7. The synthesis — a verdict, a named tension, and what to actually do

The final output isn't just "here's what six people think." It pulls out a single headline recommendation and names the one real tension the decision hinges on, both visually distinct from the six individual write-ups — so a user skimming gets the "so what" immediately, and can dig into the full six perspectives only if they want to. Every synthesis also names the single highest-value thing to learn next — not just "there's uncertainty here," but specifically which fact, if you learned it, would most change the recommendation — and closes with a short, mandatory list of concrete next steps: not "do more research," but named actions with a named object (who to call, what to write down, what deadline to set), ordered by how much they matter. When there's a genuine, distinct risk in *how* the plan gets carried out — separate from whether the plan itself is right — one more line names that too. It closes with two more things most AI outputs skip: a plain-language trade-off summary (what you're actually giving up either way, not just "here are some pros and cons"), and, when there's something genuinely worth naming, a single observation about the decision-maker themselves — not the decision — drawn from patterns in how they reasoned through it.

### 8. A sensitivity check on facts you've already told us

Distinct from the "worth confirming" line below (which is about what you *don't* know yet), this is about a fact you *did* already state — and how fragile the verdict actually is to it. When a genuine lever exists, the synthesis names one: "if your runway were 8 months instead of the 14 you described, the Council would lean toward waiting instead" — a concrete, specific alternate version of a fact you already gave it, and the exact way that would have flipped the recommendation. This only appears when there's a real one to name; Quorum doesn't manufacture a hypothetical just to have one.

### 9. Worth confirming — the one thing the verdict rests on

Every synthesis now also closes, when there's something specific worth flagging, with one quiet line naming the single least-certain thing the verdict actually depends on — not a generic hedge, a specific pointer to either an unresolved unknown or the one input the recommendation is most sensitive to. Nothing renders when there isn't a clear candidate; Quorum doesn't manufacture a caveat just to have one.

### 10. Structural memory — the decision that rhymes

Every decision is compared against your *own* past decisions on the same underlying dimensions used in triage — not keyword matching, actual structural similarity. When a strong match exists, five of the six advisors (every one except the Competitor, whose mandate is the external landscape, not your personal history) can close their response with a brief structural comparison — "this rhymes with a decision you made in March" — a per-advisor note, visibly marked, that only appears on a given card when that advisor's own analysis actually drew on it. This is the single mechanic that makes Quorum feel like it "knows you" rather than resetting to zero every session.

> Think of it like a doctor who remembers your whole chart, not just today's symptoms — except the pattern-matching is on the *shape* of the decision (how reversible, how identity-loaded, how urgent), not the topic.

### 11. Revisiting a decision — the Decision Arc

Sometimes a decision isn't a one-and-done conversation — new information turns up, or you just want to think it through again. Quorum now lets you reopen the exact same decision instead of starting a fresh one: the Council treats it explicitly as a continuation, referencing what it concluded last time, what your own answers and pushback established, and, if you logged one, the outcome from that earlier sitting — then says plainly whether any of that changes now or not. Every sitting on the same decision gets stitched into a free, always-visible timeline on that decision's page, showing the whole arc from first version to now, with outcomes attached. Mirror users additionally see how their confidence calibration shifted across the arc.

### 12. The "What Changed" view

Once a decision has been reanalyzed at least once, a single collapsible panel shows exactly how the Council's position moved between the two most recent versions — which advisors gained or lost weight, where their actual stance shifted, and whether the headline verdict itself flipped, held, or is now mixed. It's deliberately one unified view rather than several small ones, and it stays invisible entirely for a first-time, single-pass decision — it only earns its place once there's something to compare.

### 13. Council Weighting — shown, not hidden

Right after synthesis, users see a small visual ranking of which two or three advisors weighed most heavily on *this specific decision*. It's the one place where the invisible triage step deliberately surfaces itself to the user — not to explain the mechanics, but to build trust in *why* the verdict leans the way it does. A decision that's mostly about identity and long-term consequence will visibly lean on different advisors than one that's mostly about risk and timing, and the user gets to see that at a glance.

It's also gotten more personal, in three separate ways now: if you have a confirmed pattern of over- or under-confidence on a specific kind of decision, the advisors best suited to catch that blind spot lean in a little more; if a specific advisor has visibly changed your mind before, its voice carries a little more weight going forward; and if you have a habit of overruling a specific advisor's final call, that advisor gets a small counterweight boost too — not because it's "right" more often, but as a check against quietly tuning out a voice just because it's usually the one you go against.

### 14. What changes your mind, and who you tend to override

Two quiet, cross-session observations Quorum can only make once there's real history: which advisor's pushback most often actually moves where you land, and which advisor's final call you most often end up going against anyway. Neither is framed as a verdict on who's "right" — the first is a count of outcomes, not a claim about quality; the second is explicitly not a claim that you (or the advisor) are wrong. Both need a real pattern before they show up — one or two instances doesn't count, so most users won't see this early on, and that's the expected state, not a bug. Once a pattern is confirmed, it surfaces on the Mirror page, and — for returning users on their fifth session or later — a shorter, quieter version of the same observation can also appear live, mid-session, as a gentle "you've been here before" signal. Users with a handful of sessions but no Mirror subscription see a teaser instead: a bare count of patterns found, with an invitation to unlock what they are.

### 15. Bias scoring — 15 named biases, tracked two ways

Every session, Quorum checks for 15 well-known decision biases (things like sunk cost, anchoring, overconfidence, FOMO, social proof) in two layers:
- **Universal, rule-based flags** — the same objective triggers for everyone, computed instantly, no AI needed.
- **Personalized, AI-detected flags** — read from the actual conversation and accumulated into a running profile per user over time.

You can now also click through from a named bias or pattern in Mirror straight to the actual sessions it was drawn from — so "this fires when reversibility is low" isn't just an abstract label, you can see exactly which of your own decisions it's built on. Two more quiet observations have joined the same personal profile: roughly how long you tend to take before actually committing to a decision once you've brought it to Quorum, and how you tend to handle irreversible decisions specifically when an advisor has pushed back on them — someone who proceeds anyway most of the time reads differently than someone who tends to hold off.

### 16. The real differentiator — bias *triggers*, not just bias labels

This is the part that goes beyond "you have confirmation bias" (nearly useless on its own). Quorum cross-references your own logged outcomes to find the specific *condition* under which a bias actually costs you — e.g., "when this decision is high-reversibility AND this bias fires, you get a worse-than-expected outcome nearly half the time; when reversibility is low, you don't." That's a testable, personal insight — not a personality label.

> The difference between a horoscope and an actuarial table. Anyone can tell you "you're prone to overconfidence." Quorum tries to tell you *specifically when* it bites you.

### 17. Calibration tracking

By comparing your stated confidence at decision-time against what actually happened, Quorum classifies you — per decision dimension — as overconfident, underconfident, or well-calibrated: the same skill professional forecasters train explicitly. This is also what feeds the personalization in Council Weighting above — once a pattern is confirmed, it doesn't just sit in your Mirror, it quietly shapes which advisors get emphasized the next time a similar decision comes up.

### 18. The Session Reliability Index

Alongside the longer-run Mirror metrics, each individual session now gets its own composite trust score (0–100), blending four things: how strong the structural match to your history was, how clear the bias signal was, how confident the Council's own rule engine was, and, once you've logged one, your calibration on that decision. Mirror shows this per session, with your trend over the last several, and always includes one concrete, specific action aimed at whichever of the four components is dragging your average down — never a generic tip.

### 19. Contradiction detection

Looks across your full decision history for cases where you stated a principle in one decision and then did the opposite in another — a specific, hard-to-fake form of self-awareness no single conversation can surface, because no single conversation has access to your last twenty decisions.

### 20. Avoidance detection

Notices when a decision you brought to Quorum is still genuinely stuck — dependent on something unresolved, sitting open for a long stretch, never logged with an outcome — and surfaces it gently, often alongside the most relevant past decision you *did* see through to resolution, as a nudge rather than a judgment.

### 21. Independence Score

Reads your own answers to the follow-up questions — not for length alone, but for specific signs you're starting to reason the way the Council does: asking your own worst-case questions, naming stakeholders unprompted, questioning whether a deadline is actually real, separating what you value from what simply pays off, thinking a few years ahead instead of just next week, referencing your own past decisions unprompted. It's a proxy for whether you're internalizing the frameworks Quorum models, or just passively receiving advice.

### 22. The Decision Graph

A visual map connecting your decisions to each other — by structural similarity, shared bias, contradiction, or decision type. This is the most differentiated, hardest-to-copy asset in the product, because it only exists once someone has real history with Quorum. It's currently gated in three tiers — a locked "your first decision is mapped" state, a preview that shows *that* a connection exists without the *why*, and a full paid view — recently redesigned specifically so free users get a taste of it and paying users don't have to grind through a huge session count to see their own graph.

### 23. Watchlist

A much lower-friction capture tool for decisions that don't (yet) deserve a full Council session — one text box, an optional tag, and a one-click "Convene the Council" action when you're ready to escalate it. Deliberately not a second decision ritual — it's an inbox, not a form.

### 24. The Decision Brief

A polished, exportable PDF of the full session — every advisor's take, the follow-up Q&A, and an executive-style synthesis — available free to everyone. It works as both a personal artifact and a natural share/referral surface. A recent formatting fix cleaned up two rough edges that had crept into this specific document: stray garbled characters that could appear in the PDF version, and a redundant repeated title line — both fixed at the source so they can't recur in any of the three places this content gets rendered (the record page, the live session view, and the PDF itself).

### 25. Sharing a decision

A one-click, revocable public link for a single session — off by default, and only the owner can turn it on. What a stranger sees on the other end of the link is deliberately narrow: the decision itself, and the current verdict — no advisor debate, no bias or Mirror data, nothing else about you. It's built for the moment right after synthesis, when someone wants to send the verdict to a friend, a partner, or a group chat rather than the whole transcript: pre-built share text for WhatsApp, LinkedIn, and Reddit, plus a plain copy-link fallback, and a real link-preview card (title, verdict snippet) when it lands in someone's chat or feed. Turning sharing back off doesn't burn the link permanently — turning it back on later reuses the same URL rather than generating a new one, so a link already sent out doesn't quietly go dead.

### 26. Monthly Judgment Review ("Open Loop")

A rolling monthly snapshot inside Mirror: how many decisions you brought to Quorum, how many you actually closed the loop on by logging an outcome, how often you've applied a rule Quorum has already surfaced for you, and how many patterns are now confirmed. It also lists your open loops directly — decisions still sitting without a logged outcome — so the nudge to close them lives inside Mirror itself, not just in a background email. The "when should I revisit this" field that powers this list is now front and center right after you commit to a decision, rather than tucked behind an optional details toggle — it's the single biggest lever for whether this feature (and the reminder email behind it) ever has anything to work with.

### 27. Peer Benchmark

Mirror users can also see how their decisions compare structurally to the wider pool of Quorum users — not their specific choices, just where they sit on things like calibration accuracy for a given kind of decision. This only activates once there's a large enough anonymized pool behind a given comparison; until then Quorum says so plainly rather than showing a benchmark built on too few people.

### 28. Nudges & re-engagement

A quiet background system with a few distinct jobs: a rotating daily prompt for people who haven't logged a decision recently, an outcome-logging reminder that waits about a week before ever asking (so there's actually been time for something to happen) and stops asking after two months, a gentle post-session nudge toward the decision graph that's throttled so you're never prompted more than once every few days regardless of which trigger fired, and a short escalating sequence for genuinely lapsed users. The daily and outcome-logging nudges now also share one rolling cooldown clock, so the same person is never contacted by both back-to-back — whichever fires first for a given day wins. Nothing here stacks — a user never gets hit with two competing prompts for the same moment.

### 29. Access tiers & monetization

Three named plans now (the "Locked v1" pricing pass): **Free**, **Elite**, and **Private**. Free users get the full Council experience and the Decision Brief, no card required. Elite (₹2,999/mo or ₹29,999/yr) unlocks the longitudinal Mirror layer — Fingerprint, Calibration, Contradictions, Session Reliability Index, Monthly Judgment Review, Peer Benchmark, full Decision Graph — with a couple of the deeper features only unlocking once someone has enough session history. Elite runs end-to-end through Razorpay — checkout, recurring billing, and self-serve cancellation — with manual grants and one-off unlock codes still available alongside it for outreach and comps. **Private** is new: a self-hosted deployment (custom pricing, starting around ₹9,999/user/month) for buyers who want their data and the AI model itself kept off shared infrastructure — sold, not self-served, since it needs a minimum-seats conversation. Buyers choose between two model options at sale time, disclosed plainly rather than defaulted quietly: a stronger option and a lower-cost, lower-reasoning-quality option.

The old separate "Advisory" tier — the small, capped, founder-led cohort — has been retired as its own feature tier. Its five advantages over standard paid access (Peer Benchmark, the Mirror "what usually changes your mind" surface, full Contradiction detail, and the session-count bypass on Rules/Contradictions/Graph) are now just part of Elite, so an Advisory client sees exactly what any other Elite subscriber sees. "Advisory" survives only as an internal label for *how* an account was granted access (manually, by the founder, rather than through checkout) — it still comes with the same non-self-cancellable handling and the offline extras (a quarterly written judgment memo, a founder call) that made sense for a hand-picked cohort, but it's no longer a separate product a customer would be pitched.

Under the hood, which plan someone is on now also decides which AI model actually answers them, not just which features they can see: Free and most of Elite's day-to-day calls run on a lean, fast model, with Elite's advisor reasoning and synthesis stepped up to a premium model; Private routes to the buyer's own self-hosted infrastructure once that's provisioned. This routing layer is built and can be switched on account-by-account, but is currently off system-wide behind a single master switch — flipping it on is a deliberate, separate decision from this pricing plan simply existing.

### 30. Onboarding

Short, dismissible guided tours at the three moments that matter most — first landing on the input field, first time seeing a completed Council session, and first time on the record page — each with its own independent "seen it" state.

---

## How the backend actually works (conceptually)

Just the shape of it, in prose, not a blueprint:

Your decision gets scored on shape before anyone sees it, then checked against the red-flag rules. The six advisors respond one after another, streaming live. The built-in questioner runs afterward, on every decision. Synthesis produces the verdict and the weighting strip. From there, a handful of things — bias scoring, structural matching against your history, the independence score — happen quietly in the background, without making you wait for any of it. Whenever you log an outcome, that feeds back into the same background layer. Everything from that background layer is what eventually shows up in the Mirror: your fingerprint, your calibration, your contradictions, your decision graph.

A few design choices worth knowing as a co-founder, not as an engineer:

**Nothing after synthesis blocks the user.** All of the scoring and matching work happens while the user is already reading their result — the product never makes someone wait for its own bookkeeping.

**Cost is managed by routing, not by cutting corners.** Lower-stakes, higher-volume tasks run on a cheaper model; advisor reasoning and anything analytically sensitive steps up to a premium one for paying tiers. That's a unit-economics decision, not a quality one — and it's now tied to the pricing plan itself (see §29), with a single master switch to turn the whole tiered-routing behavior on or off without touching anything else.

**A user can start completely anonymously** and still accumulate history under a private identity — if they later give an email (a one-click magic link, no password) or sign up with Google, that history follows them forward, regardless of which device or browser they were using when they started. The product proves itself before it asks for anything.

**Reopening a decision reuses the same background layer.** The continuation context — what was concluded, what you said, what happened — is assembled once and handed to both the advisors and the synthesis step, so a revisit never has to re-derive what was already established.

**A challenge to one advisor is treated as new information for all six**, not a side conversation — each reassesses independently, and the synthesis waits until everyone's had the chance before re-running once.

**Every weighting boost Quorum applies — for calibration patterns, for advisors who've changed your mind, for advisors you tend to overrule — is logged quietly in the background**, separate from the boost actually being applied. Nothing reads that log yet; it exists so that once enough real outcomes accumulate, the actual size of each boost can be checked against results instead of staying an educated guess forever.

**Nothing you personally type is ever stored unencrypted.** Anything you write — your decision, your answers, your outcomes — is encrypted before it's saved.
