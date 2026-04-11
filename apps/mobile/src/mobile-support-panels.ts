export const MOBILE_SUPPORT_PANEL_COPY = {
  assistant: {
    description: "Keep command, voice, and queue controls available without turning the mobile app into a second console.",
    queuePlanLabel: "Queue background plan",
    queueRunLabel: "Queue background run",
    openDesktopLabel: "Open desktop web",
    refreshThreadLabel: "Refresh thread",
    resetSessionLabel: "Reset session",
  },
  library: {
    kicker: "Advanced Tools",
    title: "Library advanced tools",
    description: "Keep the main Library surface focused on capture and review. Use this panel for queue control, routing, and artifact triage.",
  },
  review: {
    kicker: "Advanced Tools",
    title: "Review advanced tools",
    description: "Keep the flashcard deck primary. Use this panel for session controls and artifact context when you need it.",
  },
  planner: {
    kicker: "Advanced Tools",
    title: "Planner advanced tools",
    description: "Keep the Planner and briefing flow primary. Use this panel for setup, caching, and desktop fallback handoff.",
  },
  fallback: {
    title: "Desktop fallback",
    label: "Desktop web base",
    openLabel: "Open desktop web",
    helpText: "Share deep-link format for capture handoff.",
  },
  libraryDetail: {
    description: "Load recent captures, run manual follow-up actions, and jump into the desktop web detail only when you need it.",
    openLabel: "Open desktop web",
  },
} as const;
