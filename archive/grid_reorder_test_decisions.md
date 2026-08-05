# Quorum — Grid Reorder Test Decisions (Sprint 17)
# Paste each DECISION block into the decision field. CONTEXT is optional but helps signal clarity.
# After all 6 personas complete, expect the labeled grid animation and "Ranked by relevance" label.
# Check Railway logs for: [Ontology] mode: ... rules: ... flags: ...
# Check browser console for: [SessionView] Structural match fetch — look for ontology_ready: true

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G1-A — targets R4 (Regret Asymmetry FLAG) → Risk Architect + Contrarian boosted
Expected first two: risk_architect, contrarian (ahead of their PERSONA_ORDER positions)
Targets: regret_asymmetry ≥ 4

DECISION:
I've been offered ₹3.2 crore for my 22% stake in the company I co-founded
eight years ago. The buyer is a secondary fund doing a clean-up round before
Series C. I need liquidity — my father's cancer treatment is expensive and
ongoing. The company is growing 35% YoY and I genuinely believe it could be
worth 10x this in five years. Once I sell, I cannot buy back in.

CONTEXT:
The offer expires in 10 days. My co-founders think I should hold. My father
has 12–18 months of aggressive treatment ahead.

Expected rule log: flags: R4 (possibly R9 suppressed by R4)
Expected grid: risk_architect position 1 or 2, contrarian nearby

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G1-B — targets R9 (Irreversibility WARNING) → Risk Architect + Contrarian
Avoids triggering R4 (keep regret_asymmetry below 5 by making it more ambiguous)
Targets: reversibility ≥ 4, time_pressure ≤ 2, emotional_intensity ≥ 4

DECISION:
We are 60 days from signing a 10-year lease on a 12,000 sq ft office in BKC.
The landlord will not negotiate the lock-in below 7 years. Our current team
is 18 people and we've been fully remote for 3 years — the team is split on
returning. If we sign and the team resists, we cannot exit without a ₹90L
penalty. I keep going back and forth and can't make a clean call.

CONTEXT:
The board wants us in an office. Two senior engineers have said privately
they may leave if we mandate return. No external deadline pressure — landlord
will hold the space for another 45 days.

Expected rule log: flags: R9 (irreversibility + high emotion + low time pressure)
Expected grid: risk_architect promoted, contrarian promoted

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G2 — targets R2 (Identity-First GATE) → Elder boosted to position 1
Targets: identity_alignment ≥ 5, ambiguity ≥ 4

DECISION:
I've been a cardiologist for 14 years. A healthcare VC approached me six months
ago to become the founding CEO of a diagnostics startup they're seeding. They'll
back me for 24 months with ₹4 crore. I would have to resign my hospital position.
I don't know if I still want to be a doctor. I don't know if I'm a founder.
I don't know which version of failure I could live with.

CONTEXT:
I'm 42. My identity has been medicine for my entire adult life. My father was
also a doctor. The VC deal is genuinely good — I've had a lawyer review it.
The uncertainty is entirely about who I am, not whether the deal works.

Expected rule log: mode: GATE, rules: R2
Expected grid: elder position 1 (R2 boost = +3, highest single boost in the system)
NOTE: if R1/R7 also fires, SynthesisCard will be blocked — check examiner flow instead

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G3 — targets R6 (Multi-Party FLAG) → Stakeholder Mirror position 1
Targets: decision_unit ≥ 3, emotional_intensity ≥ 4

DECISION:
My parents want to sell the family home in Pune where we grew up to fund their
retirement. The house has been in the family 35 years. My two siblings and I
need to decide whether to collectively buy them out, or let them sell on the
open market. My older brother is in a position to contribute, my younger
sister is not. I'm in the middle. All three of us have very different emotional
relationships with the house and very different financial situations.

CONTEXT:
My parents are 71 and 68. The sale would give them ₹1.8 crore. If we buy
them out collectively, we'd each need to take on debt. My sister has said
she can't participate financially but feels strongly we should keep the house.
There is no external deadline — my parents are not in a rush.

Expected rule log: flags: R6 (decision_unit ≥ 3, emotional_intensity ≥ 4)
Expected grid: stakeholder_mirror position 1 (R6 boost = +3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G4 — no elevated signals → grid must NOT reorder, label must NOT appear
Targets: all dim scores ≤ 3, no rules fire

DECISION:
Should I switch from Notion to Linear for tracking my team's quarterly goals?
We're a 4-person product team. Both tools do what we need. Linear has better
keyboard shortcuts. Notion has our existing docs. No strong preference either way.

CONTEXT:
We've used Notion for 2 years. The switch would take a weekend to migrate.
No budget constraint — both are affordable. No urgency.

Expected rule log: mode: OPEN, rules: none, flags: none
Expected grid: PERSONA_ORDER unchanged, no animation, no "Ranked by relevance" label
This is your control case — if animation fires here, there's a false-positive bug

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST G2-B — targets R8 (Irreconcilable Values FLAG) → Elder boosted
Targets: value_conflict ≥ 5, identity_alignment ≥ 4

DECISION:
My PE fund's largest portfolio company is asking us to lead a bridge round.
The business is financially viable. But in due diligence I've uncovered labour
practices in their Tier 2 supplier network that I find genuinely indefensible —
not illegal in the relevant jurisdiction, but things I would not want associated
with my name. My partners see no issue. Walking away means a certain write-down
on an existing position and significant tension in the partnership.

CONTEXT:
I'm the MD. This is my call but my partners will be affected. I have been
clear to my team for years about what kind of firm we are. I don't know if
I'm being principled or precious.

Expected rule log: flags: R8 (value_conflict ≥ 5, identity_alignment ≥ 4)
Expected grid: elder position 1 or 2 (R8 boost = +3, same as R2)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERIFICATION CHECKLIST (run for each test)
──────────────────────────────────────────
□ Railway log shows: [Ontology] mode: X | rules: Y | flags: Z
  → Confirms rule engine fired and was written to sessions_ontology

□ Railway log shows: [StructuralMatch] Scoring session X against N past sessions
  → Confirms structural-match ran and returned ontology_ready: true

□ Browser console shows no errors in the structural-match fetch
  → If you see 404 or 500, the route failed — check supabase connection

□ After all 6 persona cards show responses, wait 400ms then watch for:
  → Cards fade out (350ms)
  → Cards snap to new order while invisible
  → Cards fade back in
  → "Ranked by relevance to your decision" label appears below grid

□ For G4 (control): none of the above animation steps fire
  → Grid stays in PERSONA_ORDER
  → No label appears

SUPABASE QUICK-CHECK QUERY (run in Supabase SQL editor)
───────────────────────────────────────────────────────
SELECT
  s.decision_text,
  so.tagger_status,
  so.rule_engine_result->>'mode'                         AS mode,
  so.rule_engine_result->'triggered_rules'               AS triggered,
  so.rule_engine_result->'flag_rules'                    AS flags,
  so.ontology_vector->'regret_asymmetry'->>'score'       AS regret_score,
  so.ontology_vector->'identity_alignment'->>'score'     AS identity_score,
  so.ontology_vector->'reversibility'->>'score'          AS reversibility_score,
  so.ontology_vector->'decision_unit'->>'score'          AS decision_unit_score,
  so.ontology_vector->'value_conflict'->>'score'         AS value_conflict_score
FROM sessions s
JOIN sessions_ontology so ON so.session_id = s.id
WHERE s.created_at > NOW() - INTERVAL '2 hours'
ORDER BY s.created_at DESC
LIMIT 10;

Expected for G1-A: regret_score ≥ 4, flags contain R4
Expected for G2:   identity_score ≥ 5, triggered contains R2
Expected for G3:   decision_unit_score ≥ 3, flags contain R6
Expected for G4:   all scores ≤ 3, triggered and flags empty arrays
