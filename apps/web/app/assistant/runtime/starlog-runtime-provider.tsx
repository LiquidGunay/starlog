"use client";

import type { ReactNode } from "react";
import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  AssistantRuntimeProvider,
  type AppendMessage,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { convertAssistantMessage } from "./message-content";

type StarlogAssistantRuntimeProviderProps = {
  messages: AssistantThreadMessage[];
  isRunning: boolean;
  onSendMessage: (content: string) => Promise<void> | void;
  children: ReactNode;
};

export function StarlogAssistantRuntimeProvider({
  messages,
  isRunning,
  onSendMessage,
  children,
}: StarlogAssistantRuntimeProviderProps) {
  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage: convertAssistantMessage,
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
