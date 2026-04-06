"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  OBSERVATORY_CONTEXT_LINKS,
  OBSERVATORY_SURFACES,
  matchesObservatoryPath,
  resolveObservatorySurface,
} from "./observatory-navigation";
import { useSessionConfig } from "../session-provider";

export function TopNavigation() {
  const pathname = usePathname();
  const { isOnline, outbox } = useSessionConfig();
  const activeSurface = resolveObservatorySurface(pathname);
  const utilityLinks = OBSERVATORY_CONTEXT_LINKS[activeSurface.id];
  const hideForPrimaryObservatoryRoute = ["/assistant", "/notes", "/review", "/planner"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (hideForPrimaryObservatoryRoute) {
    return null;
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden="true" />
          <Link href="/" className="brand-link">
            The Observatory
          </Link>
          <span className="brand-version">Stellar tier</span>
        </div>
        <nav className="surface-nav" aria-label="Primary surfaces">
          {OBSERVATORY_SURFACES.map((surface) => {
            const active = matchesObservatoryPath(pathname, surface.prefixes);
            return (
              <Link key={surface.id} href={surface.href} className={active ? "surface-link active" : "surface-link"}>
                <span className="surface-link-glyph" aria-hidden="true">
                  {surface.glyph}
                </span>
                {surface.shortLabel}
              </Link>
            );
          })}
        </nav>
        <div className="system-chip-wrap">
          <span className="system-chip">
            <span className="system-dot" aria-hidden="true" />
            System optimal
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
            ◉
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
