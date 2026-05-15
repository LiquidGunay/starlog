export type AssistantDynamicUiPlacement =
  | "thread"
  | "inline"
  | "composer"
  | "sidecar"
  | "bottom_sheet"
  | "support_panel"
  | "ambient"
  | (string & {});

export type AssistantDynamicUiPayload = {
  renderer_key?: string | null;
  renderer_version?: number | null;
  placement?: AssistantDynamicUiPlacement | null;
  structured_content?: Record<string, unknown> | null;
  ui_meta?: Record<string, unknown> | null;
};
