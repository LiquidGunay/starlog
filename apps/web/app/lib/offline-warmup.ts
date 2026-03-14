import { writeEntitySnapshot } from "./entity-snapshot";
import { apiRequest } from "./starlog-client";

type ArtifactSummary = {
  id: string;
};

type CalendarEvent = {
  starts_at: string;
};

type WarmupStepStatus = "ok" | "failed";

export type OfflineWarmupStep = {
  id: string;
  label: string;
  status: WarmupStepStatus;
  warmed_snapshots: number;
  detail?: string;
};

export type OfflineWarmupResult = {
  started_at: string;
  finished_at: string;
  warmed_snapshots: number;
  steps: OfflineWarmupStep[];
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function stepFailure(error: unknown): string {
  return error instanceof Error ? error.message : "Warmup step failed";
}

function artifactGraphCacheKey(artifactId: string): string {
  return `artifacts.graph:${artifactId}`;
}

function artifactVersionsCacheKey(artifactId: string): string {
  return `artifacts.versions:${artifactId}`;
}

export async function runOfflineWarmup(apiBase: string, token: string): Promise<OfflineWarmupResult> {
  const startedAt = new Date().toISOString();
  const steps: OfflineWarmupStep[] = [];
  let warmedSnapshots = 0;

  async function runStep(
    id: string,
    label: string,
    warm: () => Promise<number>,
  ): Promise<void> {
    try {
      const warmed = await warm();
      warmedSnapshots += warmed;
      steps.push({
        id,
        label,
        status: "ok",
        warmed_snapshots: warmed,
      });
    } catch (error) {
      steps.push({
        id,
        label,
        status: "failed",
        warmed_snapshots: 0,
        detail: stepFailure(error),
      });
    }
  }

  await runStep("artifacts", "Artifacts list + selected context", async () => {
    let warmed = 0;
    const artifacts = await apiRequest<ArtifactSummary[]>(apiBase, token, "/v1/artifacts?limit=40");
    writeEntitySnapshot("artifacts.items", artifacts);
    warmed += 1;

    if (artifacts.length > 0) {
      const selectedArtifactId = artifacts[0].id;
      writeEntitySnapshot("artifacts.selected", selectedArtifactId);
      warmed += 1;

      const [graphPayload, versionPayload] = await Promise.all([
        apiRequest(apiBase, token, `/v1/artifacts/${selectedArtifactId}/graph`),
        apiRequest(apiBase, token, `/v1/artifacts/${selectedArtifactId}/versions`),
      ]);

      writeEntitySnapshot("artifacts.graph", graphPayload);
      writeEntitySnapshot("artifacts.versions", versionPayload);
      writeEntitySnapshot(artifactGraphCacheKey(selectedArtifactId), graphPayload, { persistBootstrap: false });
      writeEntitySnapshot(artifactVersionsCacheKey(selectedArtifactId), versionPayload, { persistBootstrap: false });
      warmed += 4;
    }

    return warmed;
  });

  await runStep("notes", "Notes list", async () => {
    const notes = await apiRequest(apiBase, token, "/v1/notes");
    writeEntitySnapshot("notes.items", notes);
    return 1;
  });

  await runStep("tasks", "Tasks list", async () => {
    let warmed = 0;
    const tasks = await apiRequest<Array<{ id: string }>>(apiBase, token, "/v1/tasks");
    writeEntitySnapshot("tasks.items", tasks);
    warmed += 1;
    if (tasks.length > 0) {
      writeEntitySnapshot("tasks.selected", tasks[0].id);
      warmed += 1;
    }
    return warmed;
  });

  await runStep("calendar", "Calendar events + conflicts", async () => {
    let warmed = 0;
    const [events, conflicts] = await Promise.all([
      apiRequest<CalendarEvent[]>(apiBase, token, "/v1/calendar/events?limit=60"),
      apiRequest(apiBase, token, "/v1/calendar/sync/google/conflicts"),
    ]);
    writeEntitySnapshot("calendar.events", events);
    writeEntitySnapshot("calendar.conflicts", conflicts);
    writeEntitySnapshot("calendar.selected_day", events[0]?.starts_at?.slice(0, 10) || todayIsoDate());
    warmed += 3;
    return warmed;
  });

  await runStep("assistant", "Assistant intents + queued jobs", async () => {
    const [intents, voiceJobs, assistJobs] = await Promise.all([
      apiRequest(apiBase, token, "/v1/agent/intents"),
      apiRequest(apiBase, token, "/v1/ai/jobs?limit=12&action=assistant_command"),
      apiRequest(apiBase, token, "/v1/ai/jobs?limit=12&action=assistant_command_ai"),
    ]);
    writeEntitySnapshot("assistant.intents", intents);
    writeEntitySnapshot("assistant.voice_jobs", voiceJobs);
    writeEntitySnapshot("assistant.ai_jobs", assistJobs);
    return 3;
  });

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    warmed_snapshots: warmedSnapshots,
    steps,
  };
}
