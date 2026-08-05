import { useState } from "react";

const sections = [
  {
    id: "session",
    label: "Session read",
    color: "#6366f1",
    bg: "#eef2ff",
    border: "#c7d2fe",
  },
  {
    id: "product",
    label: "Product feedback",
    color: "#0891b2",
    bg: "#ecfeff",
    border: "#a5f3fc",
  },
  {
    id: "flash",
    label: "Flash mode question",
    color: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
  },
  {
    id: "bugs",
    label: "Bugs / UX fixes",
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
  },
  {
    id: "next",
    label: "Next steps",
    color: "#16a34a",
    bg: "#f0fdf4",
    border: "#bbf7d0",
  },
];

const data = {
  session: {
    title: "How the session went",
    summary:
      "A genuinely good first live session. She engaged with the product properly — ran the council herself, pushed back, had a real moment with Risk Advisor, and then started thinking like a product advisor without being asked. That's the signal.",
    items: [
      {
        type: "win",
        label: "Real moment landed",
        text: "Risk Advisor clicked — she said aloud that the council was right to lean against raising salaries. That's the product doing its job. She felt it.",
      },
      {
        type: "win",
        label: "Unprompted product thinking",
        text: "She immediately thought of a CEO client who makes high-frequency high-stakes decisions and named the problem herself. You didn't prompt it. That's strong product-market signal — not just feedback.",
      },
      {
        type: "win",
        label: "Trade-off framing insight",
        text: "\"Each option comes with trade-offs — reputation, people, financial — and if Quorum shows those rather than picking a winner, the user stays in the driver's seat.\" This is a sharp insight. Worth sitting with seriously.",
      },
      {
        type: "watch",
        label: "Decision framing needed more scaffolding",
        text: "Her initial framing (\"is my business seasonal?\") was upstream of the actual decision. You caught it and reframed — but the product should probably flag this before council runs, not after. The override you had to do is a product gap.",
      },
      {
        type: "watch",
        label: "Mirror answer didn't land fully",
        text: "She asked how Mirror works if she hasn't shared outcomes yet. Your answer (outcome is one input, not the only one) is correct — but she wasn't convinced. This framing needs a cleaner one-liner.",
      },
      {
        type: "watch",
        label: "Referral ask — did it happen?",
        text: "Notes don't mention it. If you didn't get to it, that's okay given it was a live session with product onboarding running simultaneously. But worth noting for Viral and Puneet — don't let the onboarding crowd it out.",
      },
    ],
  },
  product: {
    title: "Product feedback — what to action vs park",
    summary:
      "She gave you five distinct pieces of feedback. Three are sharp. Two are directional but need interpretation before acting.",
    items: [
      {
        type: "action",
        label: "Trade-offs per option — ACTION",
        text: "\"Each option comes with reputation, people, financial trade-offs — show those, don't just pick a winner.\" This is the strongest feedback. Consider adding a Trade-off layer to Synthesis or per-advisor output. Keeps user in control. Doesn't fight Quorum's lean — just makes the lean more legible.",
      },
      {
        type: "action",
        label: "Delete decision button — ACTION",
        text: "Reanalyze creates duplicates. Users should be able to delete the copies and track outcomes only on the original. Straightforward UX fix. Low effort, meaningful for mirror profiling clarity.",
      },
      {
        type: "action",
        label: "Sub-text formatting — ACTION (quick)",
        text: "\"Six private advisors...\" reads as an instruction, not context. Italicise or visually demote it. 30-minute fix.",
      },
      {
        type: "park",
        label: "Persona role labels — PARK for now",
        text: "She got confused about what each advisor does until you clarified. The fix isn't new labels — it's either a tooltip or a one-line framing on the advisor card. Don't rebuild the framework. Add a line.",
      },
      {
        type: "park",
        label: "Back button after Save Record — PARK",
        text: "Valid UX point. Low priority unless users are hitting it repeatedly. Flag for next sprint.",
      },
      {
        type: "park",
        label: "Upstream dependency framing — PARK",
        text: "\"Week ending\" language is vague. The upstream block needing an override is a product gap but needs more data before redesigning the flow. Watch for it in Viral and Puneet sessions.",
      },
    ],
  },
  flash: {
    title: "Flash mode — the real question",
    summary:
      "This is the most important thing to think through before you build anything. Dora and the WhatsApp both push toward it. But your instinct (\"conflicted if it makes the product something it shouldn't be\") is the right instinct.",
    items: [
      {
        type: "think",
        label: "What she's actually describing",
        text: "A CEO making 10 high-stakes decisions a day doesn't need Quorum — they need a decision triage tool. That's a different product with a different posture. Quorum's value is depth, not speed. Flash mode might be the thing that dilutes exactly what makes Quorum worth ₹25,000.",
      },
      {
        type: "think",
        label: "What's worth preserving from her feedback",
        text: "The real signal isn't \"make it faster\" — it's \"the text is too long to read in a high-pressure moment.\" That's solvable without a mode change: shorter advisor outputs, TTS, a summary card at the top. Speed of reading ≠ speed of thinking.",
      },
      {
        type: "think",
        label: "The modes framing (easy / moderate / fast)",
        text: "\"Like a game\" is her framing. That tells you something important — she's thinking about it as a product feature, not a core behaviour. Quorum is not a game. Modes risk making it feel like one. Your discomfort (\"want to keep it serious\") is signal, not resistance.",
      },
      {
        type: "decision",
        label: "Recommended position",
        text: "Don't build Flash mode yet. Build shorter advisor output as a default first. See if that solves the \"too long to read\" complaint without creating a mode. Revisit Flash after 3–4 more sessions give you data on whether speed is really the issue or readability is.",
      },
    ],
  },
  bugs: {
    title: "Bugs & UX — log before you forget",
    summary: "Three concrete items from this session to track.",
    items: [
      {
        type: "bug",
        label: "Magic link not working for email linking",
        text: "Happened during session. You said it's sorted — confirm in next session that it works end-to-end for a new user.",
      },
      {
        type: "bug",
        label: "Reanalyze creates duplicate decisions on home page",
        text: "Dora flagged multiple copies of same decision. Her fix request (delete button) is right. Also clarify in UX copy that Reanalyze = new version, not same decision.",
      },
      {
        type: "bug",
        label: "No back button after Save Record on Council page",
        text: "User lands in a dead end — Reanalyze or New Decision only. Add a back button or breadcrumb. Low effort.",
      },
    ],
  },
  next: {
    title: "What to do before you sleep tonight",
    summary:
      "Three things. Not more. You have Viral tomorrow at 5:30pm and Dezerv at 12pm.",
    items: [
      {
        type: "next",
        label: "Log the product feedback while it's fresh",
        text: "You've done it here — but make sure the trade-offs insight and the delete decision button are in your product backlog. These are real. Don't lose them to the next session.",
      },
      {
        type: "next",
        label: "Make a decision on Flash mode — and park it",
        text: "You're conflicted. That conflict is productive but only if you close it. Decision: don't build it yet. Build shorter outputs first. Move on.",
      },
      {
        type: "next",
        label: "Reconnect with Dora in 2 weeks as agreed",
        text: "She said she'll run 5+ decisions and then you reconnect. Calendar that now — Saturday June 7 or 8. Don't leave it floating. And when you reconnect, that's when the gatekeeper conversation becomes natural.",
      },
    ],
  },
};

const typeStyles = {
  win: { dot: "#16a34a", label: "✓ Worked" },
  watch: { dot: "#d97706", label: "⚠ Watch" },
  action: { dot: "#6366f1", label: "→ Action" },
  park: { dot: "#94a3b8", label: "○ Park" },
  think: { dot: "#0891b2", label: "↗ Think" },
  decision: { dot: "#dc2626", label: "! Decision" },
  bug: { dot: "#dc2626", label: "Bug" },
  next: { dot: "#16a34a", label: "Do tonight" },
};

export default function App() {
  const [active, setActive] = useState("session");
  const sec = sections.find((s) => s.id === active);
  const content = data[active];

  return (
    <div
      style={{
        fontFamily:
          "'Georgia', 'Times New Roman', serif",
        maxWidth: 680,
        margin: "0 auto",
        padding: "20px 16px 40px",
        background: "#fafaf9",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#94a3b8",
            fontFamily: "system-ui, sans-serif",
            marginBottom: 4,
          }}
        >
          Session debrief · Dora Suri · May 23
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#1e293b",
            lineHeight: 1.25,
          }}
        >
          StorySideUp — Scale or Stay Solo
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: `1.5px solid ${active === s.id ? s.color : "#e2e8f0"}`,
              background: active === s.id ? s.bg : "white",
              color: active === s.id ? s.color : "#64748b",
              fontSize: 12,
              fontWeight: active === s.id ? 600 : 400,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
              transition: "all 0.15s",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Summary card */}
      <div
        style={{
          background: sec.bg,
          border: `1px solid ${sec.border}`,
          borderRadius: 10,
          padding: "14px 18px",
          marginBottom: 16,
          fontFamily: "system-ui, sans-serif",
          fontSize: 13.5,
          color: sec.color,
          lineHeight: 1.65,
        }}
      >
        <span style={{ fontWeight: 600 }}>{content.title}: </span>
        {content.summary}
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {content.items.map((item, i) => {
          const t = typeStyles[item.type] || typeStyles.next;
          return (
            <div
              key={i}
              style={{
                background: "white",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "14px 18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: t.dot,
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: t.dot,
                  }}
                >
                  {t.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1e293b",
                    marginLeft: 2,
                  }}
                >
                  {item.label}
                </span>
              </div>
              <p
                style={{
                  fontSize: 13.5,
                  color: "#475569",
                  lineHeight: 1.7,
                  margin: 0,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {item.text}
              </p>
            </div>
          );
        })}
      </div>

      {/* Footer note for flash mode tab */}
      {active === "flash" && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "#1e293b",
            borderRadius: 10,
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            color: "#94a3b8",
            lineHeight: 1.65,
          }}
        >
          <span style={{ color: "#f8fafc", fontWeight: 600 }}>
            WhatsApp read:{" "}
          </span>
          Dora said "like a game — easy paced, fast action, moderate." You said
          "sochta hu, want to keep it serious." Your instinct is right. A game
          mode and a serious product are not the same thing. You don't have to
          resolve this tonight.
        </div>
      )}
    </div>
  );
}
