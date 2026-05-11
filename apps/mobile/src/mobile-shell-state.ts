import type { MobileTab } from "./navigation";

export function isMobileAssistantMode(activeTab: MobileTab): boolean {
  return activeTab === "assistant";
}

export function shouldShowMobileTopBar(activeTab: MobileTab): boolean {
  return !isMobileAssistantMode(activeTab);
}

export function shouldCloseAssistantPanelOnTabChange(
  activeTab: MobileTab,
  assistantPanelOpen: boolean,
): boolean {
  return !isMobileAssistantMode(activeTab) && assistantPanelOpen;
}

export function shouldScrollShellToTopOnTabChange(activeTab: MobileTab): boolean {
  return !isMobileAssistantMode(activeTab);
}
