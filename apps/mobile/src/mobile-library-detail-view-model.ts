export type MobileArtifactDetailLayerKind = "raw" | "normalized" | "extracted";

export type MobileArtifactDetailActionKind = "summarize" | "cards" | "tasks" | "append_note" | "archive" | "link";

export type MobileArtifactDetail = {
  artifact: {
    id: string;
    source_type: string;
    title?: string | null;
    created_at: string;
    updated_at: string;
  };
  capture: {
    source_app?: string | null;
    source_type: string;
    source_url?: string | null;
    source_file?: string | null;
    capture_method?: string | null;
    captured_at: string;
    tags: string[];
  };
  source_layers: Array<{
    layer: MobileArtifactDetailLayerKind;
    present: boolean;
    preview?: string | null;
    character_count?: number | null;
    mime_type?: string | null;
    checksum_sha256?: string | null;
    source_filename?: string | null;
  }>;
  connections: {
    summary_version_count: number;
    latest_summary?: {
      id: string;
      version: number;
      provider: string;
      created_at: string;
      preview: string;
      character_count: number;
    } | null;
    card_count: number;
    card_set_version_count: number;
    task_count: number;
    note_count: number;
    notes: Array<{ id: string; title: string; version: number }>;
    relation_count: number;
    relations: Array<{
      id: string;
      artifact_id: string;
      relation_type: string;
      target_type: string;
      target_id: string;
      created_at: string;
    }>;
    action_run_count: number;
  };
  timeline: Array<{
    kind: string;
    label: string;
    occurred_at: string;
    entity_type: string;
    entity_id: string;
    status?: string | null;
  }>;
  suggested_actions: Array<{
    action: MobileArtifactDetailActionKind;
    label: string;
    enabled: boolean;
    method?: string | null;
    endpoint?: string | null;
    disabled_reason?: string | null;
  }>;
};

export type MobileArtifactLayerRow = {
  key: MobileArtifactDetailLayerKind;
  label: string;
  stateLabel: string;
  present: boolean;
  preview: string | null;
  meta: string[];
};

export type MobileArtifactActionRow = {
  action: MobileArtifactDetailActionKind;
  label: string;
  enabled: boolean;
  statusLabel: string;
  disabledReason: string | null;
  executableRequest: MobileArtifactActionExecution | null;
};

export type MobileArtifactTimelineRow = {
  key: string;
  label: string;
  occurredLabel: string;
  metaLabel: string;
};

export type MobileArtifactDetailViewModel = {
  title: string;
  subtitle: string;
  captureLabels: Array<{ label: string; value: string }>;
  sourcePreview: string | null;
  sourceLayers: MobileArtifactLayerRow[];
  provenanceRows: Array<{ label: string; value: string }>;
  conversionRows: Array<{ label: string; value: string }>;
  actions: MobileArtifactActionRow[];
  timelineRows: MobileArtifactTimelineRow[];
};

export type MobileArtifactExecutableActionKind = "summarize" | "cards" | "tasks" | "append_note";

export type MobileArtifactActionExecution = {
  artifactId: string;
  action: MobileArtifactExecutableActionKind;
  method: "POST";
  endpoint: string;
};

export type MobileArtifactDetailRequestToken = {
  artifactId: string;
  requestId: number;
};

const LAYER_LABELS: Record<MobileArtifactDetailLayerKind, string> = {
  raw: "Raw",
  normalized: "Normalized",
  extracted: "Extracted",
};

export function deriveMobileArtifactDetailViewModel(
  detail: MobileArtifactDetail,
): MobileArtifactDetailViewModel {
  const title = detail.artifact.title?.trim() || detail.artifact.id;
  const sourceType = formatMachineLabel(detail.artifact.source_type);
  const capturedLabel = formatTimestamp(detail.capture.captured_at);
  const sourcePreview = detail.source_layers.find((layer) => layer.present && layer.preview?.trim())?.preview?.trim() ?? null;

  return {
    title,
    subtitle: `${sourceType} · captured ${capturedLabel}`,
    captureLabels: captureLabels(detail),
    sourcePreview,
    sourceLayers: detail.source_layers.map(layerRow),
    provenanceRows: provenanceRows(detail),
    conversionRows: conversionRows(detail),
    actions: detail.suggested_actions.map(actionRow),
    timelineRows: detail.timeline.map(timelineRow),
  };
}

function captureLabels(detail: MobileArtifactDetail): Array<{ label: string; value: string }> {
  const labels: Array<{ label: string; value: string }> = [
    { label: "Source type", value: formatMachineLabel(detail.capture.source_type) },
    { label: "Captured", value: formatTimestamp(detail.capture.captured_at) },
  ];
  appendIfPresent(labels, "Source app", detail.capture.source_app);
  appendIfPresent(labels, "Capture method", detail.capture.capture_method);
  appendIfPresent(labels, "Source URL", detail.capture.source_url);
  appendIfPresent(labels, "Source file", detail.capture.source_file);
  if (detail.capture.tags.length > 0) {
    labels.push({ label: "Tags", value: detail.capture.tags.join(", ") });
  }
  return labels;
}

function provenanceRows(detail: MobileArtifactDetail): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Summary versions", value: String(detail.connections.summary_version_count) },
    { label: "Card sets", value: String(detail.connections.card_set_version_count) },
    { label: "Cards", value: String(detail.connections.card_count) },
    { label: "Tasks", value: String(detail.connections.task_count) },
    { label: "Notes", value: String(detail.connections.note_count) },
    { label: "Relations", value: String(detail.connections.relation_count) },
    { label: "Action runs", value: String(detail.connections.action_run_count) },
  ];
  if (detail.connections.latest_summary) {
    rows.push({
      label: "Latest summary",
      value: `v${detail.connections.latest_summary.version} · ${detail.connections.latest_summary.preview}`,
    });
  }
  for (const note of detail.connections.notes) {
    rows.push({ label: "Linked note", value: `v${note.version} · ${note.title}` });
  }
  for (const relation of detail.connections.relations) {
    rows.push({
      label: "Relation",
      value: `${formatMachineLabel(relation.relation_type)} -> ${formatMachineLabel(relation.target_type)} ${relation.target_id}`,
    });
  }
  return rows;
}

function conversionRows(detail: MobileArtifactDetail): Array<{ label: string; value: string }> {
  const latestSummary = detail.connections.latest_summary;
  const rows = [
    {
      label: "Summary",
      value: latestSummary ? `v${latestSummary.version} · ${latestSummary.character_count} chars` : "No summary versions",
    },
    {
      label: "Cards",
      value: detail.connections.card_count > 0
        ? `${detail.connections.card_count} cards across ${detail.connections.card_set_version_count} set version(s)`
        : "No card conversions",
    },
    {
      label: "Tasks",
      value: detail.connections.task_count > 0 ? `${detail.connections.task_count} linked task(s)` : "No task conversions",
    },
    {
      label: "Notes",
      value: detail.connections.note_count > 0 ? `${detail.connections.note_count} linked note(s)` : "No linked notes",
    },
  ];
  return rows;
}

function layerRow(layer: MobileArtifactDetail["source_layers"][number]): MobileArtifactLayerRow {
  const meta: string[] = [];
  if (typeof layer.character_count === "number") {
    meta.push(`${layer.character_count} chars`);
  }
  appendString(meta, layer.mime_type);
  appendString(meta, layer.source_filename);
  if (layer.checksum_sha256) {
    meta.push(`sha256 ${shortChecksum(layer.checksum_sha256)}`);
  }
  return {
    key: layer.layer,
    label: LAYER_LABELS[layer.layer],
    stateLabel: layer.present ? "Present" : "Missing",
    present: layer.present,
    preview: layer.preview?.trim() || null,
    meta,
  };
}

function actionRow(action: MobileArtifactDetail["suggested_actions"][number]): MobileArtifactActionRow {
  const endpoint = action.endpoint?.trim() || "";
  const executableAction = isExecutableActionKind(action.action) ? action.action : null;
  const endpointArtifactId = actionArtifactId(endpoint);
  const canCallEndpoint = action.enabled
    && action.method === "POST"
    && Boolean(endpoint)
    && Boolean(endpointArtifactId)
    && Boolean(executableAction);
  const executableRequest = canCallEndpoint && executableAction
    ? {
      artifactId: endpointArtifactId,
      action: executableAction,
      method: "POST" as const,
      endpoint,
    }
    : null;
  return {
    action: action.action,
    label: action.label,
    enabled: canCallEndpoint,
    statusLabel: canCallEndpoint ? "Action" : "Status only",
    disabledReason: canCallEndpoint ? null : action.disabled_reason || disabledActionReason(action),
    executableRequest,
  };
}

export function shouldCommitArtifactDetailResponse(input: {
  requested: MobileArtifactDetailRequestToken;
  current: MobileArtifactDetailRequestToken;
  responseArtifactId: string;
}): boolean {
  return input.requested.requestId === input.current.requestId
    && input.requested.artifactId === input.current.artifactId
    && input.responseArtifactId === input.current.artifactId;
}

export function findMobileArtifactActionExecution(
  detail: MobileArtifactDetail,
  action: MobileArtifactExecutableActionKind,
): MobileArtifactActionExecution | null {
  return deriveMobileArtifactDetailViewModel(detail).actions.find((row) => row.action === action)?.executableRequest ?? null;
}

function timelineRow(event: MobileArtifactDetail["timeline"][number]): MobileArtifactTimelineRow {
  const meta = [formatMachineLabel(event.kind), formatMachineLabel(event.entity_type), event.status?.trim()]
    .filter((value): value is string => Boolean(value));
  return {
    key: `${event.kind}:${event.entity_id}:${event.occurred_at}`,
    label: event.label,
    occurredLabel: formatTimestamp(event.occurred_at),
    metaLabel: meta.join(" · "),
  };
}

function appendIfPresent(rows: Array<{ label: string; value: string }>, label: string, value?: string | null) {
  const trimmed = value?.trim();
  if (trimmed) {
    rows.push({ label, value: trimmed });
  }
}

function appendString(values: string[], value?: string | null) {
  const trimmed = value?.trim();
  if (trimmed) {
    values.push(trimmed);
  }
}

function formatMachineLabel(value: string): string {
  const normalized = value.trim().replace(/[._-]+/g, " ");
  if (!normalized) {
    return "Unknown";
  }
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || "Unknown time";
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function shortChecksum(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function isExecutableActionKind(action: MobileArtifactDetailActionKind): action is MobileArtifactExecutableActionKind {
  return action === "summarize" || action === "cards" || action === "tasks" || action === "append_note";
}

function actionArtifactId(endpoint: string): string {
  const match = endpoint.match(/\/v1\/artifacts\/([^/]+)\/actions(?:$|[?#])/);
  return match ? decodeURIComponent(match[1]) : "";
}

function disabledActionReason(action: MobileArtifactDetail["suggested_actions"][number]): string {
  if (!action.enabled) {
    return "No executable endpoint is available.";
  }
  if (!action.endpoint?.trim()) {
    return "No executable endpoint is available.";
  }
  if (action.method !== "POST") {
    return "Only POST artifact action endpoints can run from mobile.";
  }
  return "This action is not supported by the mobile artifact action request yet.";
}
