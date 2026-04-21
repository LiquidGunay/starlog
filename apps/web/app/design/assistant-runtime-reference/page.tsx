const principles = [
  {
    title: "Thread-Native Control Plane",
    body:
      "The Assistant transcript is the operating surface. Runs, ambient updates, dynamic panels, and compact result cards should all feel attached to one continuous thread rather than scattered across standalone widgets.",
  },
  {
    title: "Structured Interrupts",
    body:
      "The assistant should ask only for the missing structure. Due dates, planner conflicts, capture triage, review grading, and morning-focus choices should resolve inside anchored panels rather than full-screen modal detours.",
  },
  {
    title: "Support Surface Feedback",
    body:
      "Library, Planner, Review, and the desktop helper should emit structured surface events. The thread should stay aware of user activity without forcing the user to narrate it back into chat.",
  },
];

const firstWave = [
  "request_due_date",
  "resolve_planner_conflict",
  "triage_capture",
  "grade_review_recall",
  "choose_morning_focus",
];

export default function AssistantRuntimeReferencePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(238, 186, 138, 0.15), transparent 32%), linear-gradient(180deg, #121210 0%, #0a0b0f 100%)",
        color: "#f5f2ea",
        padding: "48px 24px 72px",
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: 1100 }}>
        <section
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 32,
            padding: 32,
            background: "rgba(19, 20, 24, 0.8)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          }}
        >
          <p
            style={{
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              fontSize: 12,
              color: "rgba(245, 242, 234, 0.62)",
            }}
          >
            Active Reference
          </p>
          <h1
            style={{
              margin: "12px 0 16px",
              fontSize: "clamp(2.5rem, 5vw, 4.4rem)",
              lineHeight: 1.02,
              maxWidth: 780,
            }}
          >
            Starlog assistant reset: thread, runs, events, and structured follow-through.
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 760,
              fontSize: 18,
              lineHeight: 1.7,
              color: "rgba(245, 242, 234, 0.82)",
            }}
          >
            This reference exists to keep implementation work anchored to the new assistant-first
            architecture. It is not a reskin target for the old observatory shell. It is a compact
            reference for how Starlog should feel once the assistant runtime, ambient updates, and
            dynamic panels are real.
          </p>
        </section>

        <section
          style={{
            marginTop: 28,
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {principles.map((item) => (
            <article
              key={item.title}
              style={{
                borderRadius: 28,
                padding: 24,
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 24 }}>{item.title}</h2>
              <p style={{ margin: "12px 0 0", lineHeight: 1.7, color: "rgba(245, 242, 234, 0.78)" }}>
                {item.body}
              </p>
            </article>
          ))}
        </section>

        <section
          style={{
            marginTop: 28,
            borderRadius: 32,
            padding: 28,
            background: "rgba(9, 10, 13, 0.9)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <p
            style={{
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontSize: 12,
              color: "rgba(245, 242, 234, 0.58)",
            }}
          >
            First-Wave Tool UIs
          </p>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            {firstWave.map((name) => (
              <span
                key={name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  padding: "10px 16px",
                  border: "1px solid rgba(235, 184, 139, 0.24)",
                  background: "rgba(235, 184, 139, 0.08)",
                  color: "#f3dfca",
                  fontSize: 14,
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
