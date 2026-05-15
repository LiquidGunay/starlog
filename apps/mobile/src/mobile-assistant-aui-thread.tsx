import { useMemo } from "react";
import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react-native";
import { Text, View } from "react-native";

import {
  assistantUiThreadFingerprint,
  starlogMessagesToAssistantUiMessages,
} from "./mobile-assistant-aui-adapter";

type MobileAssistantUiThreadProps = {
  messages: AssistantThreadMessage[];
  palette: Record<string, string>;
};

const readOnlyAdapter: ChatModelAdapter = {
  async *run() {
    yield {
      content: [{ type: "text", text: "Starlog is syncing the native assistant thread." }],
    };
  },
};

function AssistantUiMessage({ palette }: { palette: Record<string, string> }) {
  const role = useAuiState((state) => state.message.role);
  const isUser = role === "user";

  return (
    <MessagePrimitive.Root
      style={{
        alignSelf: isUser ? "flex-end" : "stretch",
        maxWidth: isUser ? "85%" : "100%",
        borderRadius: isUser ? 24 : 18,
        borderBottomRightRadius: isUser ? 8 : 18,
        paddingHorizontal: isUser ? 15 : 0,
        paddingVertical: isUser ? 11 : 0,
        borderWidth: isUser ? 1 : 0,
        borderColor: "rgba(255,255,255,0.05)",
        backgroundColor: isUser ? "rgba(255,255,255,0.055)" : "transparent",
      }}
    >
      <MessagePrimitive.Content
        renderText={({ part }) => (
          <Text
            maxFontSizeMultiplier={1.08}
            style={{
              color: palette.text,
              fontSize: isUser ? 15.5 : 18,
              lineHeight: isUser ? 23 : 31,
            }}
          >
            {part.text}
          </Text>
        )}
      />
    </MessagePrimitive.Root>
  );
}

function AssistantUiRuntimeThread({
  initialMessages,
  palette,
}: {
  initialMessages: ThreadMessageLike[];
  palette: Record<string, string>;
}) {
  const runtime = useLocalRuntime(readOnlyAdapter, { initialMessages });
  const components = useMemo(
    () => ({
      Message: () => <AssistantUiMessage palette={palette} />,
    }),
    [palette],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root style={{ gap: 14 }}>
        <ThreadPrimitive.Messages
          components={components}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function MobileAssistantUiThread({ messages, palette }: MobileAssistantUiThreadProps) {
  const assistantUiMessages = useMemo(() => starlogMessagesToAssistantUiMessages(messages), [messages]);
  const fingerprint = useMemo(() => assistantUiThreadFingerprint(assistantUiMessages), [assistantUiMessages]);

  if (assistantUiMessages.length === 0) {
    return null;
  }

  return <AssistantUiRuntimeThread key={fingerprint} initialMessages={assistantUiMessages} palette={palette} />;
}
