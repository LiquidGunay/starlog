import { ThemeToggle } from "./components/theme-toggle";
import { ApiConsole } from "./components/api-console";

const launchItems = [
  {
    title: "Clip Hub",
    body: "Capture from browser, desktop helper, or mobile share. Keep raw + normalized + extracted source layers.",
  },
  {
    title: "Knowledge Graph",
    body: "Link every artifact to summary versions, note blocks, cards, and suggested tasks with full provenance.",
  },
  {
    title: "Review Engine",
    body: "Run native SRS sessions with Q/A and cloze cards, then track retention over time.",
  },
  {
    title: "Rhythm Planner",
    body: "Time-block tasks into your calendar and generate an offline morning spoken briefing package.",
  },
];

const defaultActions = [
  "Summarize",
  "Create Cards",
  "Generate Tasks",
  "Append Note",
];

export default function HomePage() {
  return (
    <main className="shell">
      <div className="stars" aria-hidden="true" />
      <header className="hero glass">
        <div>
          <p className="eyebrow">Starlog v1</p>
          <h1>Clip-first personal system for knowledge and execution.</h1>
          <p className="subcopy">
            A modern, spacy workspace: capture anything, connect ideas, schedule what matters, and
            wake up to an offline-ready spoken brief.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="grid">
        {launchItems.map((item) => (
          <article key={item.title} className="panel glass">
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="workspace glass">
        <div>
          <p className="eyebrow">Artifact Quick Actions</p>
          <h2>Suggest-first automation</h2>
          <p>AI only runs when you choose. Every output is versioned and linked back to source.</p>
        </div>
        <div className="chips">
          {defaultActions.map((action) => (
            <span key={action} className="chip">
              {action}
            </span>
          ))}
        </div>
      </section>

      <ApiConsole />
    </main>
  );
}
