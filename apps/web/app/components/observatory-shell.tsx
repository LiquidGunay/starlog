import type { ReactNode } from "react";

type ObservatoryStat = {
  label: string;
  value: string;
};

type ObservatoryPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  stats?: ObservatoryStat[];
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

type ObservatoryPanelProps = {
  kicker: string;
  title: string;
  meta?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function ObservatoryPageShell({
  eyebrow,
  title,
  description,
  stats = [],
  actions,
  children,
  className,
}: ObservatoryPageShellProps) {
  return (
    <main className={joinClasses("shell observatory-page", className)}>
      <section className="observatory-hero glass">
        <div className="observatory-hero-head">
          <div className="observatory-hero-copy">
            <p className="observatory-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {actions ? <div className="observatory-hero-actions">{actions}</div> : null}
        </div>
        {stats.length > 0 ? (
          <div className="observatory-stat-row">
            {stats.map((stat) => (
              <article key={`${stat.label}-${stat.value}`} className="observatory-stat-pill">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <div className="observatory-page-body">
        {children}
      </div>
    </main>
  );
}

export function ObservatoryPanel({
  kicker,
  title,
  meta,
  actions,
  children,
  className,
}: ObservatoryPanelProps) {
  return (
    <section className={joinClasses("observatory-panel glass", className)}>
      <div className="observatory-panel-head">
        <div>
          <p className="observatory-eyebrow">{kicker}</p>
          <h2 className="observatory-panel-title">{title}</h2>
          {meta ? <p className="observatory-panel-meta">{meta}</p> : null}
        </div>
        {actions ? <div className="observatory-panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
