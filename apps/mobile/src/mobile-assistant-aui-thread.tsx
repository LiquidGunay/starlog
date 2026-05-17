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
  type MobileAssistantUiRichPart,
  type MobileAssistantUiThreadMessage,
  starlogMessagesToAssistantUiMessages,
} from "./mobile-assistant-aui-adapter";

type MobileAssistantUiThreadProps = {
  messages: AssistantThreadMessage[];
  palette: Record<string, string>;
};

const readOnlyAdapter: ChatModelAdapter = {
  async *run() {
    yield {
      content: "Starlog is syncing the native assistant thread.",
    };
  },
};

function dynamicUiBadgeText(part: MobileAssistantUiRichPart): string | null {
  if (!part.rendererLabel || part.fallback) {
    return null;
  }
  if (part.placementLabel) {
    return `${part.rendererLabel} · ${part.placementLabel}`;
  }
  return part.rendererLabel;
}

function AssistantUiMessage({ palette }: { palette: Record<string, string> }) {
  const message = useAuiState((state) => state.message) as unknown as MobileAssistantUiThreadMessage;
  const role = message.role;
  const isUser = role === "user";
  const richParts = message.metadata?.custom?.richParts ?? [];
  const dynamicBadges = richParts.map(dynamicUiBadgeText).filter((label): label is string => Boolean(label));

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
      {dynamicBadges.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: isUser ? 0 : 8 }}>
          {dynamicBadges.slice(0, 3).map((label) => (
            <View
              key={`${message.id}-${label}`}
              style={{
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(255,255,255,0.024)",
              }}
            >
              <Text
                maxFontSizeMultiplier={1}
                style={{ color: palette.muted, fontSize: 10, lineHeight: 13, fontWeight: "800" }}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
