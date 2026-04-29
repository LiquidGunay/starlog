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
  supportingLabel: string;
  icon: "inbox" | "artifact" | "note" | "project";
};

export type MobileLibraryInboxRow = {
  id: string;
  title: string;
  sourceLabel: string;
  captureTypeLabel: string;
  timestampLabel: string;
  statusLabel: string;
  statusTone: "queued" | "retry" | "processed";
  actionLabels: string[];
  primaryActionLabel: string;
  secondaryActionLabel: string | null;
  overflowActionCount: number;
  overflowLabel: string;
  icon: "text" | "file" | "voice" | "artifact";
  layout: {
    titleNumberOfLines: number;
    metadataNumberOfLines: number;
    stackActions: boolean;
  };
};

export type MobileLibraryCompactRow = {
  id: string;
  title: string;
  metaLabel: string;
  tagLabel: string;
  timestampLabel: string;
};

export type MobileLibraryAggregateState = {
  label: string;
  value: string;
  emptyLabel: string;
};

export type MobileLibrarySourceRow = {
  id: string;
  label: string;
  count: number;
};

export type MobileLibrarySuggestionRow = {
  id: string;
  label: string;
  actionLabel: string;
};

export type MobileLibraryViewModel = {
  statusLabel: string;
  segments: MobileLibrarySegment[];
  stats: MobileLibraryStatChip[];
  inboxRows: MobileLibraryInboxRow[];
  artifactRows: MobileLibraryInboxRow[];
  recentArtifacts: MobileLibraryCompactRow[];
  noteRows: MobileLibraryCompactRow[];
  notesAggregate: MobileLibraryAggregateState;
  projectsAggregate: MobileLibraryAggregateState;
  sourceRows: MobileLibrarySourceRow[];
  suggestions: MobileLibrarySuggestionRow[];
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
  const notesCount = input.notesCount ?? 0;
  const linkedProjectCount = input.linkedProjectCount ?? 0;

  return {
    statusLabel: input.pendingCaptures.length > 0 ? `${input.pendingCaptures.length} awaiting processing` : "Queue clear",
    segments: ["Inbox", "Artifacts", "Notes", "Sources"],
    stats: [
      {
        label: "Unprocessed captures",
        value: String(input.pendingCaptures.length),
        supportingLabel: input.pendingCaptures.length === 1 ? "1 needs attention" : `${input.pendingCaptures.length} need attention`,
        icon: "inbox",
      },
      {
        label: "Recent artifacts",
        value: String(input.artifacts.length),
        supportingLabel: input.artifacts.length === 1 ? "1 ready to use" : `${input.artifacts.length} ready to use`,
        icon: "artifact",
      },
      {
        label: "Notes & saved items",
        value: String(notesCount),
        supportingLabel: notesCount > 0 ? "Details not loaded" : "No note rows loaded",
        icon: "note",
      },
      {
        label: "Linked to projects",
        value: String(linkedProjectCount),
        supportingLabel: linkedProjectCount > 0 ? "Details not loaded" : "No project rows loaded",
        icon: "project",
      },
    ],
    inboxRows: pendingRows.length > 0 ? pendingRows : artifactRows.slice(0, 3),
    artifactRows,
    recentArtifacts: input.artifacts.slice(0, 8).map((artifact) => ({
      id: artifact.id,
      title: artifact.title?.trim() || "Untitled artifact",
      metaLabel: normalizeSourceType(artifact.source_type),
      tagLabel: "Artifact",
      timestampLabel: formatMobileLibraryTimestamp(artifact.created_at, input.now),
    })),
    noteRows: [],
    notesAggregate: {
      label: "Notes & saved items",
      value: String(notesCount),
      emptyLabel: notesCount > 0
        ? `${notesCount} note${notesCount === 1 ? "" : "s"} reported. Note row details are not loaded on mobile yet.`
        : "No note rows are loaded.",
    },
    projectsAggregate: {
      label: "Linked projects",
      value: String(linkedProjectCount),
      emptyLabel: linkedProjectCount > 0
        ? `${linkedProjectCount} linked project${linkedProjectCount === 1 ? "" : "s"} reported. Project row details are not loaded on mobile yet.`
        : "No project rows are loaded.",
    },
    sourceRows: buildSourceRows(input.pendingCaptures, input.artifacts),
    suggestions: buildSuggestions(input.pendingCaptures.length, input.artifacts.length),
  };
}

function pendingCaptureRow(capture: MobileLibraryPendingCapture, now?: Date): MobileLibraryInboxRow {
  const title = capture.title.trim() || fallbackCaptureTitle(capture.kind);
  const source = sourceLabel(capture.sourceUrl, capture.kind);
  const captureType = captureTypeLabel(capture);
  const actions = actionLabelsForCapture(capture.kind);
  return {
    id: capture.id,
    title,
    sourceLabel: source,
    captureTypeLabel: captureType,
    timestampLabel: formatMobileLibraryTimestamp(capture.createdAt, now),
    statusLabel: capture.lastError ? "Retry needed" : capture.attempts > 0 ? "Queued retry" : "Unprocessed",
    statusTone: capture.lastError ? "retry" : "queued",
    actionLabels: actions,
    primaryActionLabel: actions[0] ?? "Process",
    secondaryActionLabel: actions[1] ?? null,
    overflowActionCount: 3,
    overflowLabel: "More",
    icon: capture.kind,
    layout: rowLayoutDecision(title, `${source} · ${captureType}`),
  };
}

function artifactRow(artifact: MobileLibraryArtifact, now?: Date): MobileLibraryInboxRow {
  const title = artifact.title?.trim() || "Untitled artifact";
  const source = normalizeSourceType(artifact.source_type);
  const actions = ["Open", "Review"];
  return {
    id: artifact.id,
    title,
    sourceLabel: source,
    captureTypeLabel: "Artifact",
    timestampLabel: formatMobileLibraryTimestamp(artifact.created_at, now),
    statusLabel: "Processed",
    statusTone: "processed",
    actionLabels: actions,
    primaryActionLabel: actions[0],
    secondaryActionLabel: actions[1],
    overflowActionCount: 2,
    overflowLabel: "More",
    icon: "artifact",
    layout: rowLayoutDecision(title, `${source} · Artifact`),
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
    return truncateMiddle(trimmed, 42);
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

function rowLayoutDecision(title: string, metadata: string): MobileLibraryInboxRow["layout"] {
  return {
    titleNumberOfLines: title.length > 56 ? 2 : 1,
    metadataNumberOfLines: metadata.length > 46 ? 2 : 1,
    stackActions: title.length > 72 || metadata.length > 58,
  };
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const headLength = Math.max(8, Math.floor((maxLength - 3) * 0.62));
  const tailLength = Math.max(6, maxLength - headLength - 3);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function buildSourceRows(
  captures: MobileLibraryPendingCapture[],
  artifacts: MobileLibraryArtifact[],
): MobileLibrarySourceRow[] {
  const counts = new Map<string, number>();
  for (const capture of captures) {
    const label = sourceLabel(capture.sourceUrl, capture.kind);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  for (const artifact of artifacts) {
    const label = normalizeSourceType(artifact.source_type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "source", label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function buildSuggestions(
  pendingCount: number,
  artifactCount: number,
): MobileLibrarySuggestionRow[] {
  const suggestions: MobileLibrarySuggestionRow[] = [];
  if (pendingCount > 0) {
    suggestions.push({
      id: "process-captures",
      label: `Process ${pendingCount} unprocessed capture${pendingCount === 1 ? "" : "s"}`,
      actionLabel: "Queued",
    });
  }
  if (artifactCount > 0) {
    suggestions.push({
      id: "review-artifacts",
      label: `Review ${artifactCount} artifact${artifactCount === 1 ? "" : "s"} already in Library`,
      actionLabel: "Available",
    });
  }
  return suggestions;
}
