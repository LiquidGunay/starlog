export type ArtifactAction = "summarize" | "cards" | "tasks" | "append_note";

export interface ArtifactCreateRequest {
  source_type: string;
  title?: string;
  raw_content?: string;
  normalized_content?: string;
  extracted_content?: string;
  metadata?: Record<string, unknown>;
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
}
