import type { AssistantDynamicUiPlacement } from "@starlog/contracts";
import type { DynamicUiRendererContract, DynamicUiStructuredField } from "./renderer-contracts";
import { STARLOG_DYNAMIC_UI_RENDERER_CONTRACTS } from "./renderer-contracts";
import { FALLBACK_RENDERER_KEY, type StarlogKnownRendererKey, type StarlogRendererKey } from "./renderer-keys";

export type DynamicUiSource = "interrupt" | "tool_result" | "card";

export type DynamicUiRendererDefinition = {
  key: StarlogKnownRendererKey;
  version: number;
  sources: readonly DynamicUiSource[];
  defaultPlacement: AssistantDynamicUiPlacement;
  label: string;
  description?: string;
  structuredContent: readonly DynamicUiStructuredField[];
  uiMeta: readonly DynamicUiStructuredField[];
};

export type DynamicUiFallbackRendererDefinition = Omit<DynamicUiRendererDefinition, "key"> & {
  key: typeof FALLBACK_RENDERER_KEY;
};

export type ResolvedDynamicUiRenderer = {
  requestedKey: string | null;
  definition: DynamicUiRendererDefinition | DynamicUiFallbackRendererDefinition;
  fallback: boolean;
};

export type DynamicUiRegistry = ReadonlyMap<StarlogKnownRendererKey, DynamicUiRendererDefinition>;

export const FALLBACK_RENDERER_DEFINITION: DynamicUiFallbackRendererDefinition = {
  key: FALLBACK_RENDERER_KEY,
  version: 1,
  sources: ["interrupt", "tool_result", "card"],
  defaultPlacement: "thread",
  label: "Unsupported assistant UI",
  description: "Generic renderer for unknown or unavailable dynamic UI payloads.",
  structuredContent: [],
  uiMeta: [],
};

export function createDynamicUiRegistry(
  overrides: Partial<Record<StarlogKnownRendererKey, Partial<DynamicUiRendererDefinition>>> = {},
): DynamicUiRegistry {
  return new Map(
    STARLOG_DYNAMIC_UI_RENDERER_CONTRACTS.map((contract: DynamicUiRendererContract) => [
      contract.key,
      {
        ...contract,
        ...overrides[contract.key],
      },
    ]),
  );
}

export const DEFAULT_DYNAMIC_UI_REGISTRY = createDynamicUiRegistry();

export function resolveDynamicUiRenderer(
  rendererKey: StarlogRendererKey | string | null | undefined,
  registry: DynamicUiRegistry = DEFAULT_DYNAMIC_UI_REGISTRY,
): ResolvedDynamicUiRenderer {
  if (typeof rendererKey !== "string" || rendererKey.length === 0) {
    return {
      requestedKey: null,
      definition: FALLBACK_RENDERER_DEFINITION,
      fallback: true,
    };
  }

  const definition = registry.get(rendererKey as StarlogKnownRendererKey);
  if (!definition) {
    return {
      requestedKey: rendererKey,
      definition: FALLBACK_RENDERER_DEFINITION,
      fallback: true,
    };
  }

  return {
    requestedKey: rendererKey,
    definition,
    fallback: false,
  };
}
