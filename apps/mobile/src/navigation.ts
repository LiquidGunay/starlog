import { PRODUCT_SURFACES } from "@starlog/contracts";

export type MobileTab = "assistant" | "library" | "planner" | "review";

export const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: "assistant", label: PRODUCT_SURFACES.assistant.label, icon: "message-text-outline" },
  { id: "library", label: PRODUCT_SURFACES.library.label, icon: "notebook-outline" },
  { id: "planner", label: PRODUCT_SURFACES.planner.label, icon: "calendar-clock-outline" },
  { id: "review", label: PRODUCT_SURFACES.review.label, icon: "head-sync-outline" },
];

export function mobileTabLabel(tab: MobileTab): string {
  return MOBILE_TABS.find((item) => item.id === tab)?.label ?? tab;
}

export function mobileTabFromParam(rawTab: string): MobileTab | null {
  const normalized = rawTab.trim().toLowerCase();
  if (normalized === "assistant" || normalized === "home" || normalized === "chat") {
    return "assistant";
  }
  if (normalized === "capture" || normalized === "notes" || normalized === "library") {
    return "library";
  }
  if (normalized === "alarms" || normalized === "calendar" || normalized === "planner") {
    return "planner";
  }
  if (normalized === "review") {
    return "review";
  }
  return null;
}
