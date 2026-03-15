"use client";

import { useEffect, useState } from "react";

import { readEntitySnapshot, writeEntitySnapshot } from "./entity-snapshot";

export function usePaneCollapsed(snapshotKey: string, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readEntitySnapshot(snapshotKey, defaultCollapsed));

  useEffect(() => {
    writeEntitySnapshot(snapshotKey, collapsed);
  }, [collapsed, snapshotKey]);

  return {
    collapsed,
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false),
    toggle: () => setCollapsed((previous) => !previous),
  };
}
