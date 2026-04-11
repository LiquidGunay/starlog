import { PRODUCT_SURFACES } from "@starlog/contracts";

export type ObservatorySurfaceId = "main-room" | "knowledge-base" | "srs-review" | "planner";

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
    label: PRODUCT_SURFACES.assistant.label,
    shortLabel: PRODUCT_SURFACES.assistant.shortLabel,
    href: "/assistant",
    prefixes: ["/", "/assistant", "/tasks", "/agent-tools", "/ai-jobs", "/mobile-share", "/share-target", "/runtime"],
    glyph: "✦",
  },
  {
    id: "knowledge-base",
    label: PRODUCT_SURFACES.library.label,
    shortLabel: PRODUCT_SURFACES.library.shortLabel,
    href: "/notes",
    prefixes: ["/notes", "/artifacts", "/search", "/portability"],
    glyph: "◫",
  },
  {
    id: "srs-review",
    label: PRODUCT_SURFACES.review.label,
    shortLabel: PRODUCT_SURFACES.review.shortLabel,
    href: "/review",
    prefixes: ["/review", "/sync-center"],
    glyph: "◉",
  },
  {
    id: "planner",
    label: PRODUCT_SURFACES.planner.label,
    shortLabel: PRODUCT_SURFACES.planner.shortLabel,
    href: "/planner",
    prefixes: ["/planner", "/calendar", "/integrations"],
    glyph: "☷",
  },
];

export const OBSERVATORY_CONTEXT_LINKS: Record<ObservatorySurfaceId, ObservatoryUtilityLink[]> = {
  "main-room": [
    { href: "/assistant", label: PRODUCT_SURFACES.assistant.label },
    { href: "/notes", label: PRODUCT_SURFACES.library.label },
    { href: "/planner", label: PRODUCT_SURFACES.planner.label },
    { href: "/runtime", label: "Settings" },
  ],
  "knowledge-base": [
    { href: "/notes", label: PRODUCT_SURFACES.library.label },
    { href: "/artifacts", label: "Artifacts" },
    { href: "/search", label: "Search" },
  ],
  "srs-review": [
    { href: "/review", label: PRODUCT_SURFACES.review.label },
    { href: "/review/decks", label: "Decks" },
    { href: "/sync-center", label: "Sync" },
  ],
  planner: [
    { href: "/planner", label: PRODUCT_SURFACES.planner.label },
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
