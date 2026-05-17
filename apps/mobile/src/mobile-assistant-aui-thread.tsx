import { useMemo, type ReactNode } from "react";
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

type MobileAssistantUiShellProps = MobileAssistantUiThreadProps & {
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
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

function formatMessageTime(value: Date | string | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AssistantUiMessage({
  palette,
  sourceMessagesById,
  renderCompatibilityForMessage,
}: {
  palette: Record<string, string>;
  sourceMessagesById: Map<string, AssistantThreadMessage>;
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
}) {
  const message = useAuiState((state) => state.message) as unknown as MobileAssistantUiThreadMessage;
  const role = message.role;
  const isUser = role === "user";
  const isSystem = role === "system";
  const richParts = message.metadata?.custom?.richParts ?? [];
  const dynamicBadges = richParts.map(dynamicUiBadgeText).filter((label): label is string => Boolean(label));
  const sourceMessage = sourceMessagesById.get(message.metadata.custom.starlogMessageId);
  const compatibilityContent = sourceMessage && renderCompatibilityForMessage ? renderCompatibilityForMessage(sourceMessage) : null;
  const isFallbackTranscript = message.metadata.custom.transcriptKind === "rich_fallback";
  const messageTime = formatMessageTime(message.createdAt);

  return (
    <MessagePrimitive.Root
      style={{
        alignSelf: "stretch",
        alignItems: isUser ? "flex-end" : "stretch",
        gap: 8,
      }}
    >
      <View
        style={{
          maxWidth: isUser ? "86%" : "100%",
          alignSelf: isUser ? "flex-end" : "stretch",
          flexDirection: isUser ? "row-reverse" : "row",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        {!isUser ? (
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 1,
              backgroundColor: isSystem ? "rgba(255,255,255,0.035)" : "rgba(243, 178, 66, 0.11)",
              borderWidth: 1,
              borderColor: isSystem ? "rgba(255,255,255,0.06)" : "rgba(243, 178, 66, 0.26)",
            }}
          >
            <Text maxFontSizeMultiplier={1} style={{ color: isSystem ? palette.muted : palette.accent, fontSize: 12, fontWeight: "900" }}>
              {isSystem ? "i" : "S"}
            </Text>
          </View>
        ) : null}

        <View style={{ flex: 1, minWidth: 0, gap: 7, alignItems: isUser ? "flex-end" : "stretch" }}>
          {!isUser ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Text maxFontSizeMultiplier={1} style={{ color: isSystem ? palette.muted : palette.accent, fontSize: 12, lineHeight: 16, fontWeight: "800" }}>
                {isSystem ? "System" : "Starlog"}
              </Text>
              {messageTime ? (
                <Text maxFontSizeMultiplier={1} style={{ color: palette.muted, fontSize: 11, lineHeight: 15, fontWeight: "700" }}>
                  {messageTime}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View
            style={{
              alignSelf: isUser ? "flex-end" : "stretch",
              borderRadius: isUser ? 22 : 18,
              borderBottomRightRadius: isUser ? 7 : 18,
              paddingHorizontal: isUser ? 15 : isFallbackTranscript ? 12 : 0,
              paddingVertical: isUser ? 11 : isFallbackTranscript ? 9 : 0,
              borderWidth: isUser || isFallbackTranscript ? 1 : 0,
              borderColor: isUser ? "rgba(255,255,255,0.055)" : "rgba(243, 178, 66, 0.16)",
              backgroundColor: isUser ? "rgba(255,255,255,0.06)" : isFallbackTranscript ? "rgba(243, 178, 66, 0.07)" : "transparent",
            }}
          >
            <MessagePrimitive.Content
              renderText={({ part }) => (
                <Text
                  maxFontSizeMultiplier={1.08}
                  style={{
                    color: palette.text,
                    fontSize: isUser ? 15.5 : isFallbackTranscript ? 14.5 : 17,
                    lineHeight: isUser ? 23 : isFallbackTranscript ? 20 : 28,
                    fontWeight: isFallbackTranscript ? "800" : "400",
                  }}
                >
                  {part.text}
                </Text>
              )}
            />
          </View>

          {dynamicBadges.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignSelf: isUser ? "flex-end" : "stretch" }}>
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

          {compatibilityContent ? (
            <View
              style={{
                alignSelf: "stretch",
                borderRadius: 18,
                paddingHorizontal: 10,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.055)",
                backgroundColor: "rgba(255,255,255,0.014)",
              }}
            >
              {compatibilityContent}
            </View>
          ) : null}
        </View>
      </View>
    </MessagePrimitive.Root>
  );
}

function AssistantUiRuntimeShell({
  initialMessages,
  sourceMessagesById,
  palette,
  renderCompatibilityForMessage,
}: {
  initialMessages: ThreadMessageLike[];
  sourceMessagesById: Map<string, AssistantThreadMessage>;
  palette: Record<string, string>;
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
}) {
  const runtime = useLocalRuntime(readOnlyAdapter, { initialMessages });
  const components = useMemo(
    () => ({
      Message: () => (
        <AssistantUiMessage
          palette={palette}
          sourceMessagesById={sourceMessagesById}
          renderCompatibilityForMessage={renderCompatibilityForMessage}
        />
      ),
    }),
    [palette, renderCompatibilityForMessage, sourceMessagesById],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root
        style={{
          borderRadius: 24,
          paddingHorizontal: 2,
          paddingVertical: 2,
          gap: 14,
        }}
      >
        <ThreadPrimitive.Messages
          components={components}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          contentContainerStyle={{ paddingBottom: 2 }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function MobileAssistantUiShell({ messages, palette, renderCompatibilityForMessage }: MobileAssistantUiShellProps) {
  const assistantUiMessages = useMemo(() => starlogMessagesToAssistantUiMessages(messages), [messages]);
  const fingerprint = useMemo(() => assistantUiThreadFingerprint(assistantUiMessages), [assistantUiMessages]);
  const sourceMessagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  if (assistantUiMessages.length === 0) {
    return null;
  }

  return (
    <AssistantUiRuntimeShell
      key={fingerprint}
      initialMessages={assistantUiMessages}
      sourceMessagesById={sourceMessagesById}
      palette={palette}
      renderCompatibilityForMessage={renderCompatibilityForMessage}
    />
  );
}

export function MobileAssistantUiThread({ messages, palette }: MobileAssistantUiThreadProps) {
  return <MobileAssistantUiShell messages={messages} palette={palette} />;
}
