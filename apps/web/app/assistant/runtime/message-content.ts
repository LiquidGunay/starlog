import type { ThreadMessageLike } from "@assistant-ui/react";
import type { AssistantThreadMessage } from "@starlog/contracts";

type RuntimeContentPart = Exclude<ThreadMessageLike["content"], string>[number];

function dataPart(name: string, data: unknown) {
  return {
    type: `data-${name}` as const,
    data,
  };
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
      content.push(dataPart("starlog-card", part.card));
      continue;
    }
    if (part.type === "ambient_update") {
      content.push(dataPart("starlog-ambient-update", part.update));
      continue;
    }
    if (part.type === "interrupt_request") {
      content.push(dataPart("starlog-interrupt-request", part.interrupt));
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
      content.push(dataPart("starlog-tool-result", part.tool_result));
    }
  }

  return {
    id: message.id,
    role: normalizeAssistantRole(message.role),
    content,
    createdAt: new Date(message.created_at),
    status: normalizeAssistantStatus(message),
    metadata: {
      custom: {
        ...message.metadata,
        run_id: message.run_id,
        starlog_parts: message.parts,
      },
    },
  };
}
