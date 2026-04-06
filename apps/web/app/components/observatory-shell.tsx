import Link from "next/link";
import type { ReactNode } from "react";

import {
  OBSERVATORY_CONTEXT_LINKS,
  OBSERVATORY_SURFACES,
  matchesObservatoryPath,
  type ObservatorySurfaceId,
} from "./observatory-navigation";

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

type ObservatorySideNote = {
  title: string;
  body: string;
  meta?: string;
};

type ObservatoryOrbitCard = {
  kicker: string;
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
};

type ObservatoryWorkspaceShellProps = {
  pathname: string;
  surface: ObservatorySurfaceId;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel?: string;
  stats?: ObservatoryStat[];
  actions?: ReactNode;
  sideNote?: ObservatorySideNote;
  orbitCards?: ObservatoryOrbitCard[];
  footer?: ReactNode;
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

export function ObservatoryActionChip({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={joinClasses("observatory-action-chip", active && "active")}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ObservatoryWaveform({
  label,
  detail,
  active = false,
}: {
  label: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div className={joinClasses("observatory-waveform", active && "active")}>
      <div className="observatory-waveform-orb" aria-hidden="true" />
      <div className="observatory-waveform-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="observatory-waveform-copy">
        <span className="observatory-eyebrow">{label}</span>
        <strong>{detail}</strong>
      </div>
    </div>
  );
}

export function ObservatoryFloatingAction({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className="observatory-fab" type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{detail}</strong>
    </button>
  );
}

export function ObservatoryWorkspaceShell({
  pathname,
  surface,
  eyebrow,
  title,
  description,
  statusLabel,
  stats = [],
  actions,
  sideNote,
  orbitCards = [],
  footer,
  children,
  className,
}: ObservatoryWorkspaceShellProps) {
  const utilityLinks = OBSERVATORY_CONTEXT_LINKS[surface];

  return (
    <main className={joinClasses("observatory-workspace", className)}>
      <aside className="observatory-side-rail glass">
        <div className="observatory-side-brand">
          <span className="observatory-eyebrow">The Observatory</span>
          <h2>Stellar Tier</h2>
        </div>
        <nav className="observatory-side-nav" aria-label="Observatory surfaces">
          {OBSERVATORY_SURFACES.map((item) => {
            const active = item.id === surface || matchesObservatoryPath(pathname, item.prefixes);
            return (
              <Link key={item.id} href={item.href} className={joinClasses("observatory-side-link", active && "active")}>
                <span className="observatory-side-link-glyph" aria-hidden="true">{item.glyph}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {sideNote ? (
          <article className="observatory-side-note">
            <h3>{sideNote.title}</h3>
            <p>{sideNote.body}</p>
            {sideNote.meta ? <span className="observatory-panel-meta">{sideNote.meta}</span> : null}
          </article>
        ) : null}
        <div className="observatory-side-footer">
          {utilityLinks.map((item) => (
            <Link key={item.href} href={item.href} className="observatory-context-link">
              {item.label}
            </Link>
          ))}
        </div>
      </aside>

      <section className="observatory-center-column">
        <section className="observatory-hero glass observatory-hero-shell">
          <div className="observatory-hero-head">
            <div className="observatory-hero-copy">
              <p className="observatory-eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            <div className="observatory-hero-status">
              {statusLabel ? <span className="observatory-status-badge">{statusLabel}</span> : null}
              {actions ? <div className="observatory-hero-actions">{actions}</div> : null}
            </div>
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

        <div className="observatory-main-stack">
          {children}
          {footer ? <div className="observatory-footer-slot">{footer}</div> : null}
        </div>
      </section>

      <aside className="observatory-orbit-rail glass">
        <div className="observatory-orbit-head">
          <span className="observatory-eyebrow">Operational context</span>
        </div>
        <div className="observatory-orbit-stack">
          {orbitCards.map((card) => (
            <article key={`${card.kicker}-${card.title}`} className="observatory-orbit-card">
              <span className="observatory-eyebrow">{card.kicker}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              {card.href ? (
                <Link href={card.href} className="observatory-orbit-link">
                  {card.actionLabel || "Open"}
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </aside>
    </main>
  );
}
