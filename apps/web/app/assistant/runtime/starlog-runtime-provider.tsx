"use client";

import type { ReactNode } from "react";
import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  AssistantRuntimeProvider,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";

type StarlogAssistantRuntimeProviderProps = {
  messages: AssistantThreadMessage[];
  isRunning: boolean;
  onSendMessage: (content: string) => Promise<void> | void;
  children: ReactNode;
};

function normalizeRole(role: AssistantThreadMessage["role"]): "assistant" | "system" | "user" {
  return role === "tool" ? "assistant" : role;
}

function normalizeStatus(message: AssistantThreadMessage): ThreadMessageLike["status"] {
  const role = normalizeRole(message.role);
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

function convertMessage(message: AssistantThreadMessage): ThreadMessageLike {
  const text = message.parts
    .filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  return {
    id: message.id,
    role: normalizeRole(message.role),
    content: text ? [{ type: "text", text }] : [],
    createdAt: new Date(message.created_at),
    status: normalizeStatus(message),
  };
}

export function StarlogAssistantRuntimeProvider({
  messages,
  isRunning,
  onSendMessage,
  children,
}: StarlogAssistantRuntimeProviderProps) {
  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage,
    onNew: async (message: AppendMessage) => {
      const text = message.content.find(
        (item): item is Extract<AppendMessage["content"][number], { type: "text" }> => item.type === "text",
      );
      if (!text?.text.trim()) {
        return;
      }
      await onSendMessage(text.text);
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
