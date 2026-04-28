export type MobileLibraryPendingCapture = {
  id: string;
  kind: "text" | "file" | "voice";
  title: string;
  sourceUrl: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  mimeType?: string;
  fileName?: string;
};

export type MobileLibraryArtifact = {
  id: string;
  source_type: string;
  title?: string;
  created_at: string;
};

export type MobileLibrarySegment = "Inbox" | "Artifacts" | "Notes" | "Sources";

export type MobileLibraryStatChip = {
  label: string;
  value: string;
};

export type MobileLibraryInboxRow = {
  id: string;
  title: string;
  sourceLabel: string;
  captureTypeLabel: string;
  timestampLabel: string;
  statusLabel: string;
  actionLabels: string[];
  overflowLabel: string;
  icon: "text" | "file" | "voice" | "artifact";
};

export type MobileLibraryViewModel = {
  statusLabel: string;
  segments: MobileLibrarySegment[];
  stats: MobileLibraryStatChip[];
  inboxRows: MobileLibraryInboxRow[];
  artifactRows: MobileLibraryInboxRow[];
};

export function formatMobileLibraryTimestamp(value: string, now = new Date()): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  const deltaMs = Math.max(0, now.getTime() - parsed.getTime());
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function deriveMobileLibraryViewModel(input: {
  pendingCaptures: MobileLibraryPendingCapture[];
  artifacts: MobileLibraryArtifact[];
  notesCount?: number;
  linkedProjectCount?: number;
  now?: Date;
}): MobileLibraryViewModel {
  const pendingRows = input.pendingCaptures.map((capture) => pendingCaptureRow(capture, input.now));
  const artifactRows = input.artifacts.slice(0, 6).map((artifact) => artifactRow(artifact, input.now));

  return {
    statusLabel: input.pendingCaptures.length > 0 ? `${input.pendingCaptures.length} awaiting processing` : "Queue clear",
    segments: ["Inbox", "Artifacts", "Notes", "Sources"],
    stats: [
      { label: "Unprocessed", value: String(input.pendingCaptures.length) },
      { label: "Artifacts", value: String(input.artifacts.length) },
      { label: "Notes & saved", value: String(input.notesCount ?? 0) },
      { label: "Linked projects", value: String(input.linkedProjectCount ?? 0) },
    ],
    inboxRows: pendingRows.length > 0 ? pendingRows : artifactRows.slice(0, 3),
    artifactRows,
  };
}

function pendingCaptureRow(capture: MobileLibraryPendingCapture, now?: Date): MobileLibraryInboxRow {
  return {
    id: capture.id,
    title: capture.title.trim() || fallbackCaptureTitle(capture.kind),
    sourceLabel: sourceLabel(capture.sourceUrl, capture.kind),
    captureTypeLabel: captureTypeLabel(capture),
    timestampLabel: formatMobileLibraryTimestamp(capture.createdAt, now),
    statusLabel: capture.lastError ? "Retry needed" : capture.attempts > 0 ? "Queued retry" : "Unprocessed",
    actionLabels: actionLabelsForCapture(capture.kind),
    overflowLabel: "More",
    icon: capture.kind,
  };
}

function artifactRow(artifact: MobileLibraryArtifact, now?: Date): MobileLibraryInboxRow {
  return {
    id: artifact.id,
    title: artifact.title?.trim() || "Untitled artifact",
    sourceLabel: normalizeSourceType(artifact.source_type),
    captureTypeLabel: "Artifact",
    timestampLabel: formatMobileLibraryTimestamp(artifact.created_at, now),
    statusLabel: "Processed",
    actionLabels: ["Open", "Review"],
    overflowLabel: "More",
    icon: "artifact",
  };
}

function fallbackCaptureTitle(kind: MobileLibraryPendingCapture["kind"]): string {
  if (kind === "voice") {
    return "Voice note";
  }
  if (kind === "file") {
    return "Shared file";
  }
  return "Text capture";
}

function sourceLabel(sourceUrl: string, kind: MobileLibraryPendingCapture["kind"]): string {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return kind === "voice" ? "Recorder" : "Mobile capture";
  }

  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.length > 34 ? `${trimmed.slice(0, 31)}...` : trimmed;
  }
}

function captureTypeLabel(capture: MobileLibraryPendingCapture): string {
  if (capture.kind === "voice") {
    return "Voice memo";
  }
  if (capture.kind === "file") {
    return capture.mimeType?.split("/")[0] || "File";
  }
  return "Text";
}

function actionLabelsForCapture(kind: MobileLibraryPendingCapture["kind"]): string[] {
  if (kind === "voice") {
    return ["Transcribe", "Summarize"];
  }
  if (kind === "file") {
    return ["Summarize", "Link"];
  }
  return ["Summarize", "Make cards"];
}

function normalizeSourceType(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  if (!normalized) {
    return "Artifact";
  }
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
