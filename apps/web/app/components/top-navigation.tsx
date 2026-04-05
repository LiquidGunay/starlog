"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSessionConfig } from "../session-provider";

type Surface = {
  id: "main-room" | "knowledge-base" | "srs-review" | "agenda";
  label: string;
  href: string;
  prefixes: string[];
  glyph: string;
};

type UtilityLink = {
  href: string;
  label: string;
};

const SURFACES: Surface[] = [
  {
    id: "main-room",
    label: "Main Room",
    href: "/assistant",
    prefixes: ["/", "/assistant", "/tasks", "/agent-tools", "/ai-jobs", "/mobile-share", "/share-target", "/runtime"],
    glyph: "◻",
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    href: "/notes",
    prefixes: ["/notes", "/artifacts", "/search", "/portability"],
    glyph: "✦",
  },
  {
    id: "srs-review",
    label: "SRS Review",
    href: "/review",
    prefixes: ["/review", "/sync-center"],
    glyph: "◉",
  },
  {
    id: "agenda",
    label: "Agenda",
    href: "/planner",
    prefixes: ["/planner", "/calendar", "/integrations"],
    glyph: "▣",
  },
];

const CONTEXT_LINKS: Record<Surface["id"], UtilityLink[]> = {
  "main-room": [
    { href: "/assistant", label: "Main Room" },
    { href: "/notes", label: "Notes" },
    { href: "/tasks", label: "Tasks" },
    { href: "/agent-tools", label: "Agent Tools" },
    { href: "/ai-jobs", label: "AI Jobs" },
  ],
  "knowledge-base": [
    { href: "/notes", label: "Notes" },
    { href: "/artifacts", label: "Artifacts" },
    { href: "/search", label: "Search" },
    { href: "/portability", label: "Portability" },
  ],
  "srs-review": [
    { href: "/review", label: "Review" },
    { href: "/review/decks", label: "Decks" },
    { href: "/sync-center", label: "Sync Center" },
  ],
  "agenda": [
    { href: "/planner", label: "Agenda" },
    { href: "/integrations", label: "Integrations" },
  ],
};

function matchesPath(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix === "/") {
      return pathname === "/";
    }
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export function TopNavigation() {
  const pathname = usePathname();
  const { isOnline, outbox } = useSessionConfig();
  const activeSurface = SURFACES.find((surface) => matchesPath(pathname, surface.prefixes)) ?? SURFACES[0];
  const utilityLinks = CONTEXT_LINKS[activeSurface.id];

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden="true" />
          <Link href="/" className="brand-link">
            Starlog
          </Link>
          <span className="brand-version">v1.0</span>
        </div>
        <nav className="surface-nav" aria-label="Primary surfaces">
          {SURFACES.map((surface) => {
            const active = matchesPath(pathname, surface.prefixes);
            return (
              <Link key={surface.id} href={surface.href} className={active ? "surface-link active" : "surface-link"}>
                <span className="surface-link-glyph" aria-hidden="true">
                  {surface.glyph}
                </span>
                {surface.label}
              </Link>
            );
          })}
        </nav>
        <div className="system-chip-wrap">
          <span className="system-chip">
            <span className="system-dot" aria-hidden="true" />
            SYS.READY
          </span>
          <Link href="/runtime" className={pathname === "/runtime" ? "runtime-chip active" : "runtime-chip"}>
            <span
              className={isOnline ? "runtime-chip-dot online" : "runtime-chip-dot offline"}
              aria-hidden="true"
            />
            Runtime
            <span className="runtime-chip-meta">{outbox.length} queued</span>
          </Link>
          <span className="avatar-chip" aria-hidden="true">
            ⦿
          </span>
        </div>
      </div>
      {utilityLinks.length > 0 ? (
        <nav className="utility-nav" aria-label="Workspace shortcuts">
          {utilityLinks.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={active ? "utility-link active" : "utility-link"}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
