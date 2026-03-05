"use client";

import { useTheme } from "../theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button className="theme-toggle" onClick={toggleTheme} type="button">
      {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
    </button>
  );
}
