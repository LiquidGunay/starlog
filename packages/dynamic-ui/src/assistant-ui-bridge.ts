import type { AssistantDynamicUiPlacement } from "@starlog/contracts";
import { FALLBACK_RENDERER_KEY } from "./renderer-keys";
import type { DynamicUiRegistry, DynamicUiSource } from "./registry";
import { DEFAULT_DYNAMIC_UI_REGISTRY } from "./registry";
import {
  createDynamicUiViewModel,
  type DynamicUiFallbackReason,
  type DynamicUiInputBySource,
  type DynamicUiViewModelOptions,
} from "./view-model";

export type DynamicUiAssistantUiDescriptor = {
  source: DynamicUiSource;
  id: string | null;
  tool_call_id: string | null;
  renderer_key: string | null;
  requested_renderer_key: string | null;
  resolved_renderer_key: string | null;
  fallback_renderer_key: typeof FALLBACK_RENDERER_KEY | null;
  renderer_version: number | null;
  requested_renderer_version: number | null;
  supported_renderer_version: number | null;
  placement: AssistantDynamicUiPlacement | null;
  structured_content: Record<string, unknown> | null;
  ui_meta: Record<string, unknown> | null;
  fallback: boolean;
  fallback_reason: DynamicUiFallbackReason | null;
};

export type DynamicUiAssistantUiMetadata = {
  custom: {
    starlog_dynamic_ui: DynamicUiAssistantUiDescriptor;
  };
};

export type DynamicUiAssistantUiMetadataOptions = DynamicUiViewModelOptions;

export function createDynamicUiAssistantUiMetadata<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
  registry: DynamicUiRegistry = DEFAULT_DYNAMIC_UI_REGISTRY,
  options: DynamicUiAssistantUiMetadataOptions = {},
): DynamicUiAssistantUiMetadata {
  const viewModel = createDynamicUiViewModel(source, input, registry, {
    preserveFallbackPlacement: true,
    ...options,
  });

  const requestedRendererKey = viewModel.requestedRendererKey;
  const resolvedRendererKey = viewModel.rendererKey;

  return {
    custom: {
      starlog_dynamic_ui: {
        source,
        id: viewModel.id,
        tool_call_id: toolCallIdForSource(source, input),
        renderer_key: requestedRendererKey,
        requested_renderer_key: requestedRendererKey,
        resolved_renderer_key: resolvedRendererKey,
        fallback_renderer_key: viewModel.fallback ? FALLBACK_RENDERER_KEY : null,
        renderer_version: viewModel.requestedRendererVersion,
        requested_renderer_version: viewModel.requestedRendererVersion,
        supported_renderer_version: viewModel.supportedRendererVersion,
        placement: viewModel.placement,
        structured_content: viewModel.structuredContent,
        ui_meta: viewModel.uiMeta,
        fallback: viewModel.fallback,
        fallback_reason: viewModel.fallbackReason,
      },
    },
  };
}

function toolCallIdForSource<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
): string | null {
  if (source === "card") {
    return null;
  }

  if (source === "interrupt") {
    return (input as DynamicUiInputBySource["interrupt"]).tool_call_id ?? null;
  }

  return (input as DynamicUiInputBySource["tool_result"]).tool_call_id ?? null;
}
