import { apiRequest } from "../lib/starlog-client";

export type ArtifactActionKind = "summarize" | "cards" | "tasks" | "append_note";

export type ArtifactActionResponse = {
  artifact_id: string;
  action: ArtifactActionKind;
  status: string;
  output_ref?: string | null;
};

type AssistantSurfaceEventKind = "artifact.summarized" | "capture.enriched" | "task.created";

type LibraryArtifactEventTarget = {
  id: string;
  title: string;
  href: string;
};

function artifactActionEventKind(action: ArtifactActionKind, result: ArtifactActionResponse | undefined): AssistantSurfaceEventKind {
  if (action === "tasks" && result?.status === "completed") {
    return "task.created";
  }
  if (action === "append_note") {
    return "capture.enriched";
  }
  return "artifact.summarized";
}

function artifactActionEventBody(action: ArtifactActionKind, target: Pick<LibraryArtifactEventTarget, "title">, result: ArtifactActionResponse | undefined): string {
  const title = target.title.trim() || "Artifact";
  const status = result?.status || "completed";
  if (action === "summarize") {
    return `${title} was summarized from Library.`;
  }
  if (action === "cards") {
    return `${title} produced review-card output from Library.`;
  }
  if (action === "tasks" && result?.status === "completed") {
    return `${title} produced task output from Library.`;
  }
  if (action === "append_note") {
    return `${title} updated note context from Library.`;
  }
  return `${title} completed a Library ${action.replace("_", " ")} action with status ${status}.`;
}

function artifactActionEventMetadata(action: ArtifactActionKind, kind: AssistantSurfaceEventKind, result: ArtifactActionResponse | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ambient_only: true,
  };
  if (action === "cards") {
    metadata.event_kind_policy = "No supported review-card-created event kind exists; Library uses artifact.summarized for card generation.";
  }
  if (action === "tasks" && kind !== "task.created") {
    metadata.event_kind_policy = "Task action did not return completed task output; Library uses artifact.summarized conservatively.";
  }
  if (result?.output_ref) {
    metadata.output_ref = result.output_ref;
  }
  return metadata;
}

export async function emitLibraryArtifactAssistantEvent(
  apiBase: string,
  token: string,
  target: LibraryArtifactEventTarget,
  action: ArtifactActionKind,
  result: ArtifactActionResponse | undefined,
): Promise<void> {
  const kind = artifactActionEventKind(action, result);
  const status = result?.status || "completed";
  await apiRequest(apiBase, token, "/v1/assistant/threads/primary/events", {
    method: "POST",
    body: JSON.stringify({
      source_surface: "library",
      kind,
      entity_ref: {
        entity_type: "artifact",
        entity_id: result?.artifact_id || target.id,
        href: target.href,
        title: target.title,
      },
      payload: {
        artifact_id: result?.artifact_id || target.id,
        artifact_title: target.title,
        action,
        result_status: status,
        status,
        output_ref: result?.output_ref ?? null,
        body: artifactActionEventBody(action, target, result),
        metadata: artifactActionEventMetadata(action, kind, result),
      },
      visibility: "ambient",
    }),
  });
}
