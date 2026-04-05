export type MobileTab = "home" | "capture" | "alarms" | "review";

export const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "home-variant-outline" },
  { id: "capture", label: "Notes", icon: "notebook-outline" },
  { id: "alarms", label: "Calendar", icon: "calendar-clock-outline" },
  { id: "review", label: "Review", icon: "eye-outline" },
];

export function mobileTabFromParam(rawTab: string): MobileTab | null {
  const normalized = rawTab.trim().toLowerCase();
  if (normalized === "home") {
    return "home";
  }
  if (normalized === "capture" || normalized === "notes") {
    return "capture";
  }
  if (normalized === "alarms" || normalized === "calendar") {
    return "alarms";
  }
  if (normalized === "review") {
    return "review";
  }
  return null;
}
