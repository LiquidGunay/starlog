import {
  isMobileAssistantMode,
  shouldCloseAssistantPanelOnTabChange,
  shouldScrollShellToTopOnTabChange,
  shouldShowMobileTopBar,
} from "../src/mobile-shell-state";
import type { MobileTab } from "../src/navigation";

declare const require: (moduleName: string) => {
  equal: (actual: unknown, expected: unknown) => void;
};

const assert = require("node:assert/strict");

const tabs: MobileTab[] = ["assistant", "library", "planner", "review"];

assert.equal(isMobileAssistantMode("assistant"), true);
assert.equal(isMobileAssistantMode("library"), false);
assert.equal(isMobileAssistantMode("planner"), false);
assert.equal(isMobileAssistantMode("review"), false);

for (const tab of tabs) {
  const assistantMode = tab === "assistant";

  assert.equal(shouldShowMobileTopBar(tab), !assistantMode);
  assert.equal(shouldScrollShellToTopOnTabChange(tab), !assistantMode);

  assert.equal(shouldCloseAssistantPanelOnTabChange(tab, false), false);
  assert.equal(shouldCloseAssistantPanelOnTabChange(tab, true), !assistantMode);
}
