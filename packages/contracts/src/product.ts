import productCopyJson from "./product-copy.json";

type ProductSurfaceKey = "assistant" | "library" | "planner" | "review";

type ProductSurfaceCopy = {
  label: string;
  shortLabel: string;
  description: string;
  href: string;
};

type ProductCopy = {
  brand: {
    name: string;
    tagline: string;
  };
  surfaces: Record<ProductSurfaceKey, ProductSurfaceCopy>;
  cardLabels: Record<string, string>;
  assistant: {
    emptyTitle: string;
    emptyBody: string;
    inputPlaceholder: string;
  };
  auth: {
    readyStatus: string;
    signedInTitle: string;
    signedOutTitle: string;
    signedOutBody: string;
  };
  helper: {
    workspaceKicker: string;
    workspaceTitle: string;
    workspaceSubtitle: string;
    quickTitle: string;
    quickSubtitle: string;
  };
};

export const productCopy = productCopyJson as ProductCopy;

export const PRODUCT_SURFACES = productCopy.surfaces;

export function productCardLabel(kind: string, title?: string | null): string {
  if (title?.trim()) {
    return title.trim();
  }
  return productCopy.cardLabels[kind] ?? kind.replace(/_/g, " ");
}
