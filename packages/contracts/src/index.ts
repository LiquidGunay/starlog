export type ArtifactAction = "summarize" | "cards" | "tasks" | "append_note";

export interface ArtifactCreateRequest {
  source_type: string;
  title?: string;
  raw_content?: string;
  normalized_content?: string;
  extracted_content?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactResponse extends ArtifactCreateRequest {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface CaptureLayer {
  text?: string;
  mime_type?: string;
  blob_ref?: string;
  checksum_sha256?: string;
}

export interface CaptureRequest {
  source_type: string;
  capture_source: string;
  title?: string;
  source_url?: string;
  raw?: CaptureLayer;
  normalized?: CaptureLayer;
  extracted?: CaptureLayer;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CaptureResponse {
  artifact: ArtifactResponse;
}

export interface ArtifactActionRequest {
  action: ArtifactAction;
}

export interface ArtifactActionResponse {
  artifact_id: string;
  action: ArtifactAction;
  status: "suggested" | "queued" | "completed" | "failed";
  output_ref?: string | null;
}

export interface ArtifactRelation {
  id: string;
  artifact_id: string;
  relation_type: string;
  target_type: string;
  target_id: string;
  created_at: string;
}

export interface SummaryVersion {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  provider: string;
  created_at: string;
}

export interface CardSetVersion {
  id: string;
  artifact_id: string;
  version: number;
  created_at: string;
}

export interface ArtifactActionRun {
  id: string;
  artifact_id: string;
  action: string;
  status: string;
  output_ref?: string | null;
  created_at: string;
}

export interface ArtifactVersionsResponse {
  artifact_id: string;
  summaries: SummaryVersion[];
  card_sets: CardSetVersion[];
  actions: ArtifactActionRun[];
}

export interface SyncMutation {
  id: string;
  entity: string;
  op: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface SyncPushRequest {
  client_id: string;
  mutations: SyncMutation[];
}

export interface AIRequest {
  capability: "llm_summary" | "llm_cards" | "llm_tasks" | "stt" | "tts" | "ocr";
  input: Record<string, unknown>;
  prefer_local: boolean;
}

export interface AIResponse {
  capability: AIRequest["capability"];
  provider_used: string;
  status: "ok" | "fallback" | "failed";
  output: Record<string, unknown>;
}

export interface GenerateBlocksRequest {
  date: string;
  day_start_hour?: number;
  day_end_hour?: number;
}

export interface TimeBlockResponse {
  id: string;
  task_id?: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  locked: boolean;
  created_at: string;
}

export interface DomainEventResponse {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface WebhookCreateRequest {
  url: string;
  event_type?: string;
}

export interface WebhookResponse {
  id: string;
  url: string;
  event_type: string;
  active: boolean;
  created_at: string;
}

export interface ProviderConfigRequest {
  enabled: boolean;
  mode: string;
  config: Record<string, unknown>;
}

export interface ProviderConfigResponse {
  provider_name: string;
  enabled: boolean;
  mode: string;
  config: Record<string, unknown>;
  updated_at: string;
}

export interface ProviderHealthResponse {
  provider_name: string;
  healthy: boolean;
  detail: string;
  checks: Record<string, boolean>;
  secure_storage: string;
  probe: Record<string, string>;
}

export interface GoogleOAuthStartResponse {
  auth_url: string;
  state: string;
}

export interface GoogleOAuthCallbackRequest {
  code: string;
  state: string;
}

export interface GoogleOAuthStatusResponse {
  connected: boolean;
  mode?: string | null;
  source?: string | null;
  expires_at?: string | null;
  has_refresh_token: boolean;
  detail: string;
}

export interface GoogleSyncRunResponse {
  run_id: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  last_synced_at: string;
}

export interface GoogleRemoteEventCreateRequest {
  remote_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}

export interface GoogleRemoteEventResponse extends GoogleRemoteEventCreateRequest {
  etag: string;
  updated_at: string;
}

export interface CalendarConflictResponse {
  id: string;
  local_event_id?: string | null;
  remote_id: string;
  strategy: string;
  detail: Record<string, unknown>;
  resolved: boolean;
  resolved_at?: string | null;
  resolution_strategy?: string | null;
  created_at: string;
}

export interface CalendarConflictResolveRequest {
  resolution_strategy: "local_wins" | "remote_wins" | "dismiss";
}

export interface CalendarConflictResolveResponse {
  conflict: CalendarConflictResponse;
}

export interface CalendarConflictReplayResponse {
  sync_run: GoogleSyncRunResponse;
  conflict?: CalendarConflictResponse | null;
}

export interface PluginRegisterRequest {
  name: string;
  version: string;
  capabilities: string[];
  manifest: Record<string, unknown>;
}

export interface PluginResponse {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  manifest: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarkdownImportRequest {
  title: string;
  markdown: string;
}

export interface MarkdownImportResponse {
  note_id: string;
  created_at: string;
}

export interface MetricsResponse {
  queue_depth_sync_events: number;
  cards_due: number;
  tasks_todo: number;
  alarms_scheduled: number;
  timestamp: string;
}

export interface BackupResponse {
  backup_path: string;
  exported_at: string;
  bytes_written: number;
}
