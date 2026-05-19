import type { ThreadMessageLike } from "@assistant-ui/react";
import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  createDynamicUiAssistantUiMetadata,
  createDynamicUiViewModel,
  isStarlogKnownRendererKey,
  type DynamicUiAssistantUiDescriptor,
} from "@starlog/dynamic-ui";

type RuntimeContentPart = Exclude<ThreadMessageLike["content"], string>[number];
type RuntimeMetadataCustom = NonNullable<ThreadMessageLike["metadata"]>["custom"];
type DynamicUiDescriptorSource = "card" | "interrupt" | "tool_result";
type DynamicUiDescriptorCandidate = {
  descriptor: DynamicUiAssistantUiDescriptor;
  index: number;
  priority: number;
};

function dataPart(name: string, data: unknown) {
  return {
    type: `data-${name}` as const,
    data,
  };
}

function dynamicUiPart<Source extends "card" | "interrupt" | "tool_result">(
  source: Source,
  input: Source extends "card"
    ? Extract<AssistantThreadMessage["parts"][number], { type: "card" }>["card"]
    : Source extends "interrupt"
      ? Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_request" }>["interrupt"]
      : Extract<AssistantThreadMessage["parts"][number], { type: "tool_result" }>["tool_result"],
) {
  const viewModel = createDynamicUiViewModel(source, input as never);
  if (!isStarlogKnownRendererKey(viewModel.rendererKey)) {
    return null;
  }
  if (!viewModel.rendererKey.startsWith("interview.")) {
    return null;
  }

  return dataPart(viewModel.rendererKey, { source, input });
}

function interruptAssistantUiMetadata(
  interrupt: Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_request" }>["interrupt"],
): DynamicUiAssistantUiDescriptor {
  const metadata = createDynamicUiAssistantUiMetadata("interrupt", interrupt).custom.starlog_dynamic_ui;
  return {
    ...metadata,
    tool_call_id: metadata.tool_call_id ?? interrupt.id,
  };
}

function dynamicUiAssistantUiMetadata(message: AssistantThreadMessage): DynamicUiAssistantUiDescriptor | null {
  const candidates: DynamicUiDescriptorCandidate[] = [];

  message.parts.forEach((part, index) => {
    let source: DynamicUiDescriptorSource | null = null;
    let descriptor: DynamicUiAssistantUiDescriptor | null = null;

    if (part.type === "card") {
      source = "card";
      descriptor = createDynamicUiAssistantUiMetadata("card", part.card).custom.starlog_dynamic_ui;
    }
    if (part.type === "interrupt_request") {
      source = "interrupt";
      descriptor = interruptAssistantUiMetadata(part.interrupt);
    }
    if (part.type === "tool_result") {
      source = "tool_result";
      descriptor = createDynamicUiAssistantUiMetadata("tool_result", part.tool_result).custom.starlog_dynamic_ui;
    }

    if (source && descriptor) {
      candidates.push({
        descriptor,
        index,
        priority: dynamicUiDescriptorPriority(source, descriptor),
      });
    }
  });

  candidates.sort((left, right) => left.priority - right.priority || left.index - right.index);
  return candidates[0]?.descriptor ?? null;
}

function dynamicUiDescriptorPriority(source: DynamicUiDescriptorSource, descriptor: DynamicUiAssistantUiDescriptor): number {
  // metadata.custom.starlog_dynamic_ui is singular, so preserve actionable result descriptors before request panels.
  if (source === "tool_result" && descriptor.resolved_renderer_key === "interview.review_grade") {
    return 0;
  }
  if (source === "tool_result" && !descriptor.fallback) {
    return 1;
  }
  if (source === "interrupt" && !descriptor.fallback) {
    return 2;
  }
  if (source === "card" && !descriptor.fallback) {
    return 3;
  }
  if (source === "tool_result") {
    return 4;
  }
  if (source === "interrupt") {
    return 5;
  }

  return 6;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeAssistantRole(role: AssistantThreadMessage["role"]): "assistant" | "system" | "user" {
  return role === "user" ? "user" : "assistant";
}

export function normalizeAssistantStatus(message: AssistantThreadMessage): ThreadMessageLike["status"] {
  const role = normalizeAssistantRole(message.role);
  if (role !== "assistant") {
    return undefined;
  }

  switch (message.status) {
    case "pending":
    case "running":
      return { type: "running" };
    case "requires_action":
      return { type: "requires-action", reason: "interrupt" };
    case "error":
      return { type: "incomplete", reason: "error" };
    case "complete":
    default:
      return { type: "complete", reason: "stop" };
  }
}

export function convertAssistantMessage(message: AssistantThreadMessage): ThreadMessageLike {
  const dynamicUiMetadata = dynamicUiAssistantUiMetadata(message);
  const metadataCustom: RuntimeMetadataCustom = {
    ...message.metadata,
    ...(dynamicUiMetadata ? { starlog_dynamic_ui: dynamicUiMetadata } : {}),
    run_id: message.run_id,
    starlog_parts: message.parts,
  };
  const toolResults = new Map(
    message.parts
      .filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "tool_result" }> => part.type === "tool_result")
      .map((part) => [part.tool_result.tool_call_id, part.tool_result] as const),
  );

  const content: RuntimeContentPart[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "tool_call") {
      const result = toolResults.get(part.tool_call.id);
      content.push({
        type: "tool-call",
        toolCallId: part.tool_call.id,
        toolName: part.tool_call.tool_name,
        args: jsonClone(part.tool_call.arguments || {}) as never,
        argsText: JSON.stringify(part.tool_call.arguments || {}, null, 2),
        result: result?.output,
        isError: result?.status === "error",
      });
      continue;
    }
    if (part.type === "attachment" && part.attachment.kind === "citation" && part.attachment.url) {
      content.push({
        type: "source",
        sourceType: "url",
        id: part.attachment.id,
        url: part.attachment.url,
        title: part.attachment.label,
      });
      continue;
    }
    if (part.type === "attachment" && part.attachment.kind === "image" && part.attachment.url) {
      content.push({
        type: "image",
        image: part.attachment.url,
        filename: part.attachment.label,
      });
      continue;
    }
    if (part.type === "card") {
      content.push(dynamicUiPart("card", part.card) || dataPart("starlog-card", part.card));
      continue;
    }
    if (part.type === "ambient_update") {
      content.push(dataPart("starlog-ambient-update", part.update));
      continue;
    }
    if (part.type === "interrupt_request") {
      content.push(dynamicUiPart("interrupt", part.interrupt) || dataPart("starlog-interrupt-request", part.interrupt));
      continue;
    }
    if (part.type === "interrupt_resolution") {
      content.push(dataPart("starlog-interrupt-resolution", part.resolution));
      continue;
    }
    if (part.type === "attachment") {
      content.push(dataPart("starlog-attachment", part.attachment));
      continue;
    }
    if (part.type === "status") {
      content.push(dataPart("starlog-status", { status: part.status, label: part.label }));
      continue;
    }
    if (part.type === "tool_result") {
      content.push(dynamicUiPart("tool_result", part.tool_result) || dataPart("starlog-tool-result", part.tool_result));
    }
  }

  return {
    id: message.id,
    role: normalizeAssistantRole(message.role),
    content,
    createdAt: new Date(message.created_at),
    status: normalizeAssistantStatus(message),
    metadata: {
      custom: metadataCustom,
    },
  };
}
