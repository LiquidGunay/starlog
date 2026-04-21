import type { Metadata } from "next";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Chat Moodboard | Starlog",
  description: "Historical reference from the pre-reset Starlog Assistant redesign.",
};

const palette = [
  { name: "Obsidian Ink", hex: "#08070c" },
  { name: "Graphite Plum", hex: "#17131f" },
  { name: "Violet Haze", hex: "#2a2135" },
  { name: "Rose Signal", hex: "#f29bb8" },
  { name: "Ember Copper", hex: "#b86c4f" },
  { name: "Electric Ice", hex: "#8dd8ff" },
];

const principles = [
  "Treat the thread as the hero surface.",
  "Dock tools and composer into the conversation plane.",
  "Use cards only for intentional artifact payloads.",
  "Communicate state through motion, glow, blur, and rhythm before adding borders.",
];

const motionNotes = [
  "Thread hydration arrives as a staggered upward settle.",
  "Composer shifts shape and light when listening, drafting, or sending.",
  "Attachments peel from assistant turns instead of appearing as isolated modules.",
];

const anatomyLabels = [
  "assistant slab",
  "embedded artifact",
  "user reply",
  "latent state rail",
  "docked composer",
];

export default function ChatMoodboardPage() {
  return (
    <main className={styles.page}>
      <div className={styles.noise} />
      <section className={styles.hero}>
        <p className={styles.kicker}>Starlog chat overhaul</p>
        <h1>Build the thread like a nocturnal instrument panel, not a pastel concept mock.</h1>
        <p className={styles.lede}>
          This moodboard is historical-only. The active assistant reset reference now lives at
          `/design/assistant-runtime-reference`.
        </p>
      </section>

      <section className={styles.board}>
        <article className={`${styles.panel} ${styles.statement}`}>
          <span className={styles.panelLabel}>Visual thesis</span>
          <p>
            Cinematic, tactile, low-glare conversation UI with editorial restraint, warm signal light,
            and enough motion to feel alive without drifting into sci-fi ornament.
          </p>
        </article>

        <article className={`${styles.panel} ${styles.materials}`}>
          <span className={styles.panelLabel}>Palette + materials</span>
          <div className={styles.swatches}>
            {palette.map((swatch) => (
              <div key={swatch.name} className={styles.swatch}>
                <span className={styles.swatchChip} style={{ backgroundColor: swatch.hex }} />
                <div>
                  <strong>{swatch.name}</strong>
                  <span>{swatch.hex}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.materialCopy}>
            <p>Smoked glass, alloy edges, hairline dividers, and deep tonal separation replace generic cards.</p>
            <p>Accent color is a signal, not a wallpaper.</p>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.typePanel}`}>
          <span className={styles.panelLabel}>Typography</span>
          <div className={styles.typeSpecimen}>
            <p className={styles.displayLine}>Starlog</p>
            <p className={styles.editorialLine}>Presence over chrome. Rhythm over decoration.</p>
            <p className={styles.bodyLine}>
              Use an editorial display voice for identity moments and a disciplined sans for working text,
              metadata, and controls.
            </p>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.anatomy}`}>
          <span className={styles.panelLabel}>Conversation anatomy</span>
          <div className={styles.threadStudy}>
            <div className={styles.assistantSlab}>
              <span>assistant slab</span>
              <p>Response bodies read as anchored content planes rather than casual bubbles.</p>
            </div>
            <div className={styles.artifactModule}>
              <span>embedded artifact</span>
              <p>Artifact payloads inherit the turn rhythm and edge geometry instead of floating as unrelated cards.</p>
            </div>
            <div className={styles.userReply}>
              <span>user reply</span>
              <p>Replies are tighter, directional, and more contrast-led.</p>
            </div>
            <div className={styles.stateRail}>
              <span>latent state rail</span>
            </div>
            <div className={styles.composerDock}>
              <span>docked composer</span>
            </div>
          </div>
          <div className={styles.anatomyTags}>
            {anatomyLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </article>

        <article className={`${styles.panel} ${styles.principles}`}>
          <span className={styles.panelLabel}>Build principles</span>
          <ul>
            {principles.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className={`${styles.panel} ${styles.motion}`}>
          <span className={styles.panelLabel}>Interaction thesis</span>
          <ul>
            {motionNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className={styles.motionBands} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className={`${styles.panel} ${styles.reject}`}>
          <span className={styles.panelLabel}>Reject</span>
          <p>
            Pastel-purple concept styling, wrapper cards around every region, messaging-app bubble tropes,
            decorative gradients as the main idea, and diagnostics that compete with the thread.
          </p>
        </article>
      </section>
    </main>
  );
}
