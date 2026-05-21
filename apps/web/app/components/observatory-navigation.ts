import { PRODUCT_SURFACES } from "@starlog/contracts";

export type SurfaceId = "assistant" | "library" | "planner" | "review";
export type ObservatorySurfaceId = "main-room" | "knowledge-base" | "srs-review" | "planner";

export type SurfaceNavigationItem = {
  id: SurfaceId;
  label: string;
  href: string;
  shortLabel: string;
  glyph: string;
  prefixes: string[];
};

export type SurfaceUtilityLink = {
  href: string;
  label: string;
};

export type ObservatorySurface = Omit<SurfaceNavigationItem, "id"> & {
  id: ObservatorySurfaceId;
  surfaceId: SurfaceId;
};

export type ObservatoryUtilityLink = SurfaceUtilityLink;

export const SURFACE_NAV_ITEMS: SurfaceNavigationItem[] = [
  {
    id: "assistant",
    label: PRODUCT_SURFACES.assistant.label,
    shortLabel: PRODUCT_SURFACES.assistant.shortLabel,
    href: "/assistant",
    prefixes: ["/", "/assistant", "/tasks", "/agent-tools", "/ai-jobs", "/mobile-share", "/share-target", "/runtime"],
    glyph: "A",
  },
  {
    id: "library",
    label: PRODUCT_SURFACES.library.label,
    shortLabel: PRODUCT_SURFACES.library.shortLabel,
    href: "/library",
    prefixes: ["/library", "/notes", "/artifacts", "/search", "/portability"],
    glyph: "L",
  },
  {
    id: "planner",
    label: PRODUCT_SURFACES.planner.label,
    shortLabel: PRODUCT_SURFACES.planner.shortLabel,
    href: "/planner",
    prefixes: ["/planner", "/calendar", "/integrations"],
    glyph: "P",
  },
  {
    id: "review",
    label: PRODUCT_SURFACES.review.label,
    shortLabel: PRODUCT_SURFACES.review.shortLabel,
    href: "/review",
    prefixes: ["/review", "/sync-center"],
    glyph: "R",
  },
];

export const SURFACE_CONTEXT_LINKS: Record<SurfaceId, SurfaceUtilityLink[]> = {
  assistant: [
    { href: "/assistant", label: PRODUCT_SURFACES.assistant.label },
    { href: "/library", label: PRODUCT_SURFACES.library.label },
    { href: "/planner", label: PRODUCT_SURFACES.planner.label },
    { href: "/runtime", label: "Settings" },
  ],
  library: [
    { href: "/library", label: PRODUCT_SURFACES.library.label },
    { href: "/notes", label: "Notes" },
    { href: "/artifacts", label: "Artifacts" },
    { href: "/search", label: "Search" },
  ],
  planner: [
    { href: "/planner", label: PRODUCT_SURFACES.planner.label },
    { href: "/calendar", label: "Calendar" },
    { href: "/integrations", label: "Integrations" },
  ],
  review: [
    { href: "/review", label: PRODUCT_SURFACES.review.label },
    { href: "/review/decks", label: "Decks" },
    { href: "/sync-center", label: "Sync" },
  ],
};

export function matchesSurfacePath(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix === "/") {
      return pathname === "/";
    }
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export function resolveSurface(pathname: string): SurfaceNavigationItem {
  return SURFACE_NAV_ITEMS.find((surface) => matchesSurfacePath(pathname, surface.prefixes)) ?? SURFACE_NAV_ITEMS[0];
}

const LEGACY_SURFACE_ID_BY_SURFACE_ID: Record<SurfaceId, ObservatorySurfaceId> = {
  assistant: "main-room",
  library: "knowledge-base",
  planner: "planner",
  review: "srs-review",
};

const SURFACE_ID_BY_LEGACY_SURFACE_ID: Record<ObservatorySurfaceId, SurfaceId> = {
  "main-room": "assistant",
  "knowledge-base": "library",
  planner: "planner",
  "srs-review": "review",
};

export const OBSERVATORY_SURFACES: ObservatorySurface[] = SURFACE_NAV_ITEMS.map((surface) => ({
  ...surface,
  id: LEGACY_SURFACE_ID_BY_SURFACE_ID[surface.id],
  surfaceId: surface.id,
}));

export const OBSERVATORY_CONTEXT_LINKS: Record<ObservatorySurfaceId, ObservatoryUtilityLink[]> = {
  "main-room": SURFACE_CONTEXT_LINKS.assistant,
  "knowledge-base": SURFACE_CONTEXT_LINKS.library,
  planner: SURFACE_CONTEXT_LINKS.planner,
  "srs-review": SURFACE_CONTEXT_LINKS.review,
};

export function matchesObservatoryPath(pathname: string, prefixes: string[]): boolean {
  return matchesSurfacePath(pathname, prefixes);
}

export function resolveObservatorySurface(pathname: string): ObservatorySurface {
  const surface = resolveSurface(pathname);
  return {
    ...surface,
    id: LEGACY_SURFACE_ID_BY_SURFACE_ID[surface.id],
    surfaceId: surface.id,
  };
}

export function legacySurfaceId(surfaceId: SurfaceId): ObservatorySurfaceId {
  return LEGACY_SURFACE_ID_BY_SURFACE_ID[surfaceId];
}

export function canonicalSurfaceId(surfaceId: ObservatorySurfaceId): SurfaceId {
  return SURFACE_ID_BY_LEGACY_SURFACE_ID[surfaceId];
}
