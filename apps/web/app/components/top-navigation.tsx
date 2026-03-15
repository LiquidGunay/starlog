"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Surface = {
  id: "command-center" | "artifact-nexus" | "neural-sync" | "chronos-matrix";
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
    id: "command-center",
    label: "Command Center",
    href: "/assistant",
    prefixes: ["/", "/notes", "/tasks", "/assistant", "/agent-tools", "/ai-jobs", "/mobile-share", "/share-target"],
    glyph: "◻",
  },
  {
    id: "artifact-nexus",
    label: "Artifact Nexus",
    href: "/artifacts",
    prefixes: ["/artifacts", "/search", "/portability"],
    glyph: "✦",
  },
  {
    id: "neural-sync",
    label: "Neural Sync",
    href: "/review",
    prefixes: ["/review", "/sync-center"],
    glyph: "◉",
  },
  {
    id: "chronos-matrix",
    label: "Chronos Matrix",
    href: "/planner",
    prefixes: ["/planner", "/calendar", "/integrations"],
    glyph: "▣",
  },
];

const CONTEXT_LINKS: Record<Surface["id"], UtilityLink[]> = {
  "command-center": [
    { href: "/assistant", label: "Command" },
    { href: "/notes", label: "Notes" },
    { href: "/tasks", label: "Tasks" },
    { href: "/agent-tools", label: "Agent Tools" },
    { href: "/ai-jobs", label: "AI Jobs" },
  ],
  "artifact-nexus": [
    { href: "/artifacts", label: "Inbox" },
    { href: "/search", label: "Search" },
    { href: "/portability", label: "Portability" },
  ],
  "neural-sync": [
    { href: "/review", label: "Review" },
    { href: "/sync-center", label: "Sync Center" },
  ],
  "chronos-matrix": [
    { href: "/planner", label: "Chronos Matrix" },
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
