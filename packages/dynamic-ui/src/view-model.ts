import type {
  AssistantCard,
  AssistantDynamicUiPlacement,
  AssistantEntityRef,
  AssistantInterrupt,
  AssistantToolResult,
} from "@starlog/contracts";
import {
  DEFAULT_DYNAMIC_UI_REGISTRY,
  FALLBACK_RENDERER_DEFINITION,
  resolveDynamicUiRenderer,
  type DynamicUiFallbackRendererDefinition,
  type DynamicUiRegistry,
  type DynamicUiRendererDefinition,
  type DynamicUiSource,
} from "./registry";

export type DynamicUiInputBySource = {
  interrupt: AssistantInterrupt;
  tool_result: AssistantToolResult;
  card: AssistantCard;
};

export type DynamicUiViewModel = {
  id: string | null;
  source: DynamicUiSource;
  rendererKey: string;
  requestedRendererKey: string | null;
  rendererVersion: number;
  requestedRendererVersion: number | null;
  supportedRendererVersion: number | null;
  placement: AssistantDynamicUiPlacement;
  title: string | null;
  body: string | null;
  status: string | null;
  entityRef: AssistantEntityRef | null;
  structuredContent: Record<string, unknown>;
  uiMeta: Record<string, unknown>;
  renderer: DynamicUiRendererDefinition | DynamicUiFallbackRendererDefinition;
  fallback: boolean;
  fallbackReason: DynamicUiFallbackReason | null;
};

export type DynamicUiFallbackReason = "unknown_renderer" | "unsupported_source" | "unsupported_renderer_version";

export type DynamicUiViewModelOptions = {
  preserveFallbackPlacement?: boolean;
};

export function createDynamicUiViewModel<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
  registry: DynamicUiRegistry = DEFAULT_DYNAMIC_UI_REGISTRY,
  options: DynamicUiViewModelOptions = {},
): DynamicUiViewModel {
  const requestedRendererKey = rendererKeyForSource(source, input);
  const resolved = resolveDynamicUiRenderer(requestedRendererKey, registry);
  const requestedRendererVersion = numberOrNull(input.renderer_version);
  const validation = validateResolvedRenderer(source, requestedRendererVersion, resolved);
  const rendererVersion = validation.definition.version;

  return {
    id: idForSource(source, input),
    source,
    rendererKey: validation.definition.key,
    requestedRendererKey: resolved.requestedKey,
    requestedRendererVersion,
    supportedRendererVersion: validation.supportedRendererVersion,
    rendererVersion,
    placement: placementForInput(input, validation.definition, validation.fallback, options),
    title: titleForSource(source, input),
    body: bodyForSource(source, input),
    status: statusForSource(source, input),
    entityRef: input.entity_ref ?? null,
    structuredContent: input.structured_content ?? structuredContentForSource(source, input),
    uiMeta: input.ui_meta ?? input.metadata ?? {},
    renderer: validation.definition,
    fallback: validation.fallback,
    fallbackReason: validation.fallbackReason,
  };
}

type DynamicUiRendererValidation = {
  definition: DynamicUiRendererDefinition | DynamicUiFallbackRendererDefinition;
  fallback: boolean;
  fallbackReason: DynamicUiFallbackReason | null;
  supportedRendererVersion: number | null;
};

function validateResolvedRenderer(
  source: DynamicUiSource,
  requestedRendererVersion: number | null,
  resolved: ReturnType<typeof resolveDynamicUiRenderer>,
): DynamicUiRendererValidation {
  if (resolved.fallback) {
    return {
      definition: resolved.definition,
      fallback: true,
      fallbackReason: "unknown_renderer",
      supportedRendererVersion: null,
    };
  }

  if (!resolved.definition.sources.includes(source)) {
    return {
      definition: FALLBACK_RENDERER_DEFINITION,
      fallback: true,
      fallbackReason: "unsupported_source",
      supportedRendererVersion: resolved.definition.version,
    };
  }

  if (requestedRendererVersion !== null && requestedRendererVersion !== resolved.definition.version) {
    return {
      definition: FALLBACK_RENDERER_DEFINITION,
      fallback: true,
      fallbackReason: "unsupported_renderer_version",
      supportedRendererVersion: resolved.definition.version,
    };
  }

  return {
    definition: resolved.definition,
    fallback: false,
    fallbackReason: null,
    supportedRendererVersion: resolved.definition.version,
  };
}

function placementForInput<Source extends DynamicUiSource>(
  input: DynamicUiInputBySource[Source],
  definition: DynamicUiRendererDefinition | DynamicUiFallbackRendererDefinition,
  fallback: boolean,
  options: DynamicUiViewModelOptions,
): AssistantDynamicUiPlacement {
  if (fallback && !options.preserveFallbackPlacement) {
    return definition.defaultPlacement;
  }

  return input.placement ?? definition.defaultPlacement;
}

function rendererKeyForSource<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
): string | null {
  if (input.renderer_key) {
    return input.renderer_key;
  }

  if (source === "interrupt") {
    return (input as AssistantInterrupt).tool_name;
  }

  if (source === "tool_result") {
    const result = input as AssistantToolResult;
    const metadataToolName = result.metadata.tool_name;
    return typeof metadataToolName === "string" ? metadataToolName : result.card?.renderer_key ?? null;
  }

  return (input as AssistantCard).kind;
}

function structuredContentForSource<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
): Record<string, unknown> {
  if (source === "interrupt") {
    const interrupt = input as AssistantInterrupt;
    return {
      fields: interrupt.fields,
      recommended_defaults: interrupt.recommended_defaults ?? null,
      tool_call_id: interrupt.tool_call_id ?? null,
    };
  }

  if (source === "tool_result") {
    return (input as AssistantToolResult).output;
  }

  const card = input as AssistantCard;
  return {
    kind: card.kind,
    version: card.version,
    actions: card.actions,
  };
}

function idForSource<Source extends DynamicUiSource>(source: Source, input: DynamicUiInputBySource[Source]): string | null {
  if (source === "card") {
    return null;
  }

  return (input as AssistantInterrupt | AssistantToolResult).id;
}

function titleForSource<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
): string | null {
  if (source === "tool_result") {
    const title = (input as AssistantToolResult).card?.title;
    return title ?? null;
  }

  return (input as AssistantInterrupt | AssistantCard).title ?? null;
}

function bodyForSource<Source extends DynamicUiSource>(source: Source, input: DynamicUiInputBySource[Source]): string | null {
  if (source === "tool_result") {
    const body = (input as AssistantToolResult).card?.body;
    return body ?? null;
  }

  return (input as AssistantInterrupt | AssistantCard).body ?? null;
}

function statusForSource<Source extends DynamicUiSource>(
  source: Source,
  input: DynamicUiInputBySource[Source],
): string | null {
  if (source === "card") {
    return null;
  }

  return (input as AssistantInterrupt | AssistantToolResult).status;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
