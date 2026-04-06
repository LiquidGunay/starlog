export type MobileTab = "home" | "notes" | "calendar" | "review";

export const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "home-variant-outline" },
  { id: "notes", label: "Notes", icon: "notebook-outline" },
  { id: "calendar", label: "Calendar", icon: "calendar-clock-outline" },
  { id: "review", label: "Review", icon: "eye-outline" },
];

export function mobileTabFromParam(rawTab: string): MobileTab | null {
  const normalized = rawTab.trim().toLowerCase();
  if (normalized === "home") {
    return "home";
  }
  if (normalized === "capture" || normalized === "notes") {
    return "notes";
  }
  if (normalized === "alarms" || normalized === "calendar") {
    return "calendar";
  }
  if (normalized === "review") {
    return "review";
  }
  return null;
}
