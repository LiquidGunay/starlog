import type { ComponentPropsWithoutRef, ReactNode } from "react";

import Link from "next/link";
import { PRODUCT_SURFACES, productCopy } from "@starlog/contracts";

import { OBSERVATORY_SURFACES, type ObservatorySurfaceId } from "./observatory-navigation";

type AprilWorkspaceShellProps = {
  activeSurface: ObservatorySurfaceId;
  statusLabel: string;
  variant?: "default" | "assistant";
  queueLabel?: string;
  brandMeta?: string;
  ctaLabel?: string;
  searchLabel?: string;
  searchAriaLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  profileTitle?: string;
  railSlot?: ReactNode;
  children: ReactNode;
  className?: string;
};

type AprilPanelProps = ComponentPropsWithoutRef<"section">;

function shellClassName(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function AprilPanel({ className, children, ...rest }: AprilPanelProps) {
  return (
    <section className={shellClassName(["april-panel", className])} {...rest}>
      {children}
    </section>
  );
}

export function AprilWorkspaceShell({
  activeSurface,
  statusLabel,
  variant = "default",
  queueLabel,
  brandMeta = "Persistent thread system",
  ctaLabel,
  searchLabel = "Library search",
  searchAriaLabel = "Search archive",
  searchPlaceholder = "Search Library...",
  searchValue,
  onSearchChange,
  profileTitle = "Single-user thread",
  railSlot,
  children,
  className,
}: AprilWorkspaceShellProps) {
  const resolvedCtaLabel = ctaLabel || (activeSurface === "main-room" ? "Quick capture" : "New item");

  return (
    <div className={shellClassName(["april-shell", "observatory-shell", variant === "assistant" && "assistant-shell", className])}>
      <aside className="april-rail">
        <div className="april-rail-brand">
          <span className="april-rail-brand-mark">{productCopy.brand.name}</span>
          <span className="april-rail-brand-meta">{brandMeta}</span>
        </div>
        <nav className="april-rail-nav" aria-label="Primary surfaces">
          {OBSERVATORY_SURFACES.map((surface) => (
            <Link
              key={surface.id}
              href={surface.href}
              className={shellClassName([
                "april-rail-link",
                surface.id === activeSurface && "active",
              ])}
            >
              <span className="april-rail-link-glyph" aria-hidden="true">
                {surface.glyph}
              </span>
              <span>{surface.label}</span>
            </Link>
          ))}
        </nav>
        <button className="april-rail-cta" type="button">
          {resolvedCtaLabel}
        </button>
        {railSlot ? <div className="april-rail-slot">{railSlot}</div> : null}
        <div className="april-rail-footer">
          <Link className="april-rail-footer-link" href="/library">
            {PRODUCT_SURFACES.library.label}
          </Link>
          <Link className="april-rail-footer-link" href="/runtime">
            Settings
          </Link>
          <div className="april-rail-profile">
            <div className="april-rail-profile-avatar" aria-hidden="true">
              ◉
            </div>
            <div className="april-rail-profile-copy">
              <strong>{profileTitle}</strong>
              <span>{queueLabel || "Live context"}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="april-shell-column">
        <header className="april-topbar">
          <div className="april-topbar-status">
            <span className="april-topbar-status-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
          <label className="april-topbar-search">
            <span className="april-topbar-search-label">{searchLabel}</span>
            <input
              aria-label={searchAriaLabel}
              className="april-topbar-search-input"
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange?.(event.target.value)}
              readOnly={!onSearchChange}
            />
          </label>
          <div className="april-topbar-actions">
            <Link className="april-topbar-icon" href="/assistant" aria-label="Open assistant thread">
              ✦
            </Link>
            <Link className="april-topbar-icon" href="/runtime" aria-label="Open runtime">
              ⌘
            </Link>
          </div>
        </header>
        <main className="april-shell-content">{children}</main>
      </div>
    </div>
  );
}

export type WorkspaceShellProps = AprilWorkspaceShellProps;
export type WorkspacePanelProps = AprilPanelProps;
export const WorkspaceShell = AprilWorkspaceShell;
export const WorkspacePanel = AprilPanel;
