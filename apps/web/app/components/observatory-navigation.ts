export type ObservatorySurfaceId = "main-room" | "knowledge-base" | "srs-review" | "agenda";

export type ObservatorySurface = {
  id: ObservatorySurfaceId;
  label: string;
  href: string;
  shortLabel: string;
  glyph: string;
  prefixes: string[];
};

export type ObservatoryUtilityLink = {
  href: string;
  label: string;
};

export const OBSERVATORY_SURFACES: ObservatorySurface[] = [
  {
    id: "main-room",
    label: "Main Room",
    shortLabel: "Main Room",
    href: "/assistant",
    prefixes: ["/", "/assistant", "/tasks", "/agent-tools", "/ai-jobs", "/mobile-share", "/share-target", "/runtime"],
    glyph: "✦",
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    shortLabel: "Knowledge Base",
    href: "/notes",
    prefixes: ["/notes", "/artifacts", "/search", "/portability"],
    glyph: "◫",
  },
  {
    id: "srs-review",
    label: "SRS Review",
    shortLabel: "SRS Review",
    href: "/review",
    prefixes: ["/review", "/sync-center"],
    glyph: "◉",
  },
  {
    id: "agenda",
    label: "Agenda",
    shortLabel: "Agenda",
    href: "/planner",
    prefixes: ["/planner", "/calendar", "/integrations"],
    glyph: "☷",
  },
];

export const OBSERVATORY_CONTEXT_LINKS: Record<ObservatorySurfaceId, ObservatoryUtilityLink[]> = {
  "main-room": [
    { href: "/assistant", label: "Conversation" },
    { href: "/notes", label: "Notes" },
    { href: "/tasks", label: "Tasks" },
    { href: "/runtime", label: "Runtime" },
  ],
  "knowledge-base": [
    { href: "/notes", label: "Notes" },
    { href: "/artifacts", label: "Artifacts" },
    { href: "/search", label: "Search" },
  ],
  "srs-review": [
    { href: "/review", label: "Review" },
    { href: "/review/decks", label: "Decks" },
    { href: "/sync-center", label: "Sync" },
  ],
  "agenda": [
    { href: "/planner", label: "Agenda" },
    { href: "/calendar", label: "Calendar" },
    { href: "/integrations", label: "Integrations" },
  ],
};

export function matchesObservatoryPath(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix === "/") {
      return pathname === "/";
    }
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export function resolveObservatorySurface(pathname: string): ObservatorySurface {
  return OBSERVATORY_SURFACES.find((surface) => matchesObservatoryPath(pathname, surface.prefixes)) ?? OBSERVATORY_SURFACES[0];
}
