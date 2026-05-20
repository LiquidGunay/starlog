import { useCallback, useEffect, useMemo, type ComponentProps, type ReactNode } from "react";
import type { AssistantInterrupt, AssistantThreadMessage } from "@starlog/contracts";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react-native";
import { Text, TextInput as RNTextInput, View } from "react-native";

import {
  assistantUiThreadFingerprint,
  MOBILE_ASSISTANT_UI_TEST_MARKERS,
  mobileDynamicPanelInterruptsFromAssistantUiMessage,
  type MobileAssistantUiRichPart,
  type MobileAssistantUiThreadMessage,
  starlogMessagesToAssistantUiMessages,
} from "./mobile-assistant-aui-adapter";

type MobileAssistantUiThreadProps = {
  messages: AssistantThreadMessage[];
  liveInterrupts?: AssistantInterrupt[];
  palette: Record<string, string>;
  pendingConversationTurn?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
};

type MobileAssistantUiShellProps = MobileAssistantUiThreadProps & {
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
  renderDynamicPanelHostForMessage?: (interrupts: AssistantInterrupt[], message: MobileAssistantUiThreadMessage) => ReactNode;
};

type MobileAssistantUiComposerBridgeProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  placeholderTextColor: string;
  disabled: boolean;
  inputStyle: ComponentProps<typeof RNTextInput>["style"];
};

export const MOBILE_STARLOG_ASSISTANT_RUNTIME_MODE = "server-owned-local-protocol-bridge" as const;

type MobileStarlogAssistantProtocolAdapterOptions = {
  disabled?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
};

function textFromAssistantUiContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function latestAssistantUiUserText(runInput: unknown): string {
  const candidate = runInput as { messages?: unknown[] } | null;
  const messages = Array.isArray(candidate?.messages) ? candidate.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    if (record.role !== "user") {
      continue;
    }
    const text = textFromAssistantUiContent(record.content).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export function createMobileStarlogAssistantProtocolAdapter({
  disabled,
  onSendMessage,
}: MobileStarlogAssistantProtocolAdapterOptions = {}): ChatModelAdapter {
  return {
    async *run(runInput: unknown) {
      const content = latestAssistantUiUserText(runInput);
      if (!content) {
        yield {
          content: "Enter an Assistant message first.",
        };
        return;
      }
      if (disabled) {
        yield {
          content: "Starlog is waiting for the current Assistant reply to finish.",
        };
        return;
      }
      await onSendMessage?.(content);
      yield {
        content: "Starlog is sending this through the native assistant thread.",
      };
    },
  };
}

export const mobileStarlogAssistantReadOnlyAdapter: ChatModelAdapter = {
  async *run() {
    yield {
      content: "Starlog is syncing the native assistant thread.",
    };
  },
};

export type MobileStarlogAssistantRuntimeProps = {
  assistantUiMessages: ThreadMessageLike[];
  pendingConversationTurn?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
  children: ReactNode;
};

export function MobileStarlogAssistantRuntime({
  assistantUiMessages,
  pendingConversationTurn,
  onSendMessage,
  children,
}: MobileStarlogAssistantRuntimeProps) {
  const adapter = useMemo(
    () => createMobileStarlogAssistantProtocolAdapter({ disabled: pendingConversationTurn, onSendMessage }),
    [onSendMessage, pendingConversationTurn],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages: assistantUiMessages });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

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

function AssistantUiAccessibilityMarker({ label, testID }: { label: string; testID: string }) {
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      accessible
      pointerEvents="none"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0.01 }}
    />
  );
}

function AssistantUiMessage({
  palette,
  sourceMessagesById,
  renderCompatibilityForMessage,
  renderDynamicPanelHostForMessage,
  liveInterrupts,
}: {
  palette: Record<string, string>;
  sourceMessagesById: Map<string, AssistantThreadMessage>;
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
  renderDynamicPanelHostForMessage?: (interrupts: AssistantInterrupt[], message: MobileAssistantUiThreadMessage) => ReactNode;
  liveInterrupts?: AssistantInterrupt[];
}) {
  const message = useAuiState((state) => state.message) as unknown as MobileAssistantUiThreadMessage;
  const role = message.role;
  const isUser = role === "user";
  const isSystem = role === "system";
  const richParts = message.metadata?.custom?.richParts ?? [];
  const dynamicBadges = richParts
    .filter((part) => !part.diagnostic)
    .map(dynamicUiBadgeText)
    .filter((label): label is string => Boolean(label));
  const sourceMessage = sourceMessagesById.get(message.metadata.custom.starlogMessageId);
  const compatibilityContent = sourceMessage && renderCompatibilityForMessage ? renderCompatibilityForMessage(sourceMessage) : null;
  const dynamicPanelInterrupts = renderDynamicPanelHostForMessage
    ? mobileDynamicPanelInterruptsFromAssistantUiMessage(message, { liveInterrupts })
    : [];
  const dynamicPanelContent =
    dynamicPanelInterrupts.length > 0 && renderDynamicPanelHostForMessage
      ? renderDynamicPanelHostForMessage(dynamicPanelInterrupts, message)
      : null;
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
              renderText={({ part }: { part: { text: string } }) => (
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

          {dynamicPanelContent}

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
  assistantUiMessages,
  sourceMessagesById,
  palette,
  renderCompatibilityForMessage,
  renderDynamicPanelHostForMessage,
  liveInterrupts,
  pendingConversationTurn,
  onSendMessage,
}: {
  assistantUiMessages: ThreadMessageLike[];
  sourceMessagesById: Map<string, AssistantThreadMessage>;
  palette: Record<string, string>;
  renderCompatibilityForMessage?: (message: AssistantThreadMessage) => ReactNode;
  renderDynamicPanelHostForMessage?: (interrupts: AssistantInterrupt[], message: MobileAssistantUiThreadMessage) => ReactNode;
  liveInterrupts?: AssistantInterrupt[];
  pendingConversationTurn?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
}) {
  const components = useMemo(
    () => ({
      Message: () => (
        <AssistantUiMessage
          palette={palette}
          sourceMessagesById={sourceMessagesById}
          renderCompatibilityForMessage={renderCompatibilityForMessage}
          renderDynamicPanelHostForMessage={renderDynamicPanelHostForMessage}
          liveInterrupts={liveInterrupts}
        />
      ),
    }),
    [liveInterrupts, palette, renderCompatibilityForMessage, renderDynamicPanelHostForMessage, sourceMessagesById],
  );

  return (
    <MobileStarlogAssistantRuntime
      assistantUiMessages={assistantUiMessages}
      pendingConversationTurn={pendingConversationTurn}
      onSendMessage={onSendMessage}
    >
      <View
        testID="assistant-ui-shell"
        accessibilityRole="summary"
        accessibilityLabel={MOBILE_ASSISTANT_UI_TEST_MARKERS.shell}
        style={{ alignSelf: "stretch" }}
      >
        <AssistantUiAccessibilityMarker label={MOBILE_ASSISTANT_UI_TEST_MARKERS.shell} testID="assistant-ui-shell-marker" />
        <ThreadPrimitive.Root
          testID="assistant-ui-thread"
          accessibilityRole="list"
          accessibilityLabel={MOBILE_ASSISTANT_UI_TEST_MARKERS.thread}
          style={{
            borderRadius: 24,
            paddingHorizontal: 2,
            paddingVertical: 2,
            gap: 14,
          }}
        >
          <AssistantUiAccessibilityMarker label={MOBILE_ASSISTANT_UI_TEST_MARKERS.thread} testID="assistant-ui-thread-marker" />
          <ThreadPrimitive.Messages
            components={components}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
            contentContainerStyle={{ paddingBottom: 2 }}
          />
        </ThreadPrimitive.Root>
      </View>
    </MobileStarlogAssistantRuntime>
  );
}

function MobileAssistantUiComposerBridgeContent({
  draft,
  onDraftChange,
  onSubmit,
  placeholder,
  placeholderTextColor,
  disabled,
  inputStyle,
}: MobileAssistantUiComposerBridgeProps) {
  const aui = useAui();

  useEffect(() => {
    const composer = aui.composer();
    if (composer.getState().text !== draft) {
      composer.setText(draft);
    }
  }, [aui, draft]);

  const handleDraftChange = useCallback(
    (value: string) => {
      aui.composer().setText(value);
      onDraftChange(value);
    },
    [aui, onDraftChange],
  );

  const handleSubmit = useCallback(() => {
    aui.composer().setText(draft);
    onSubmit();
  }, [aui, draft, onSubmit]);

  return (
    <ComposerPrimitive.Root
      testID="assistant-ui-composer"
      accessibilityRole="summary"
      accessibilityLabel={MOBILE_ASSISTANT_UI_TEST_MARKERS.composer}
      style={{ flex: 1 }}
    >
      <AssistantUiAccessibilityMarker label={MOBILE_ASSISTANT_UI_TEST_MARKERS.composer} testID="assistant-ui-composer-marker" />
      {/*
        ComposerPrimitive.Input owns internal assistant-ui text without exposing
        the onChange bridge Starlog needs before runAssistantTurn reads the
        draft. Keep the backend draft authoritative for now while the visible
        composer is hosted under ComposerPrimitive.Root.
      */}
      <RNTextInput
        maxFontSizeMultiplier={1}
        value={draft}
        onChangeText={handleDraftChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        multiline
        returnKeyType="send"
        blurOnSubmit
        onSubmitEditing={handleSubmit}
        editable={!disabled}
        accessibilityLabel={MOBILE_ASSISTANT_UI_TEST_MARKERS.composerInput}
        testID="assistant-ui-composer-input"
        style={inputStyle}
      />
    </ComposerPrimitive.Root>
  );
}

export function MobileAssistantUiComposerBridge(props: MobileAssistantUiComposerBridgeProps) {
  return (
    <MobileStarlogAssistantRuntime assistantUiMessages={[]}>
      <MobileAssistantUiComposerBridgeContent {...props} />
    </MobileStarlogAssistantRuntime>
  );
}

export function MobileAssistantUiShell({
  messages,
  liveInterrupts,
  palette,
  pendingConversationTurn,
  onSendMessage,
  renderCompatibilityForMessage,
  renderDynamicPanelHostForMessage,
}: MobileAssistantUiShellProps) {
  const assistantUiMessages = useMemo(() => starlogMessagesToAssistantUiMessages(messages), [messages]);
  const fingerprint = useMemo(() => assistantUiThreadFingerprint(assistantUiMessages), [assistantUiMessages]);
  const sourceMessagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  if (assistantUiMessages.length === 0) {
    return null;
  }

  return (
    <AssistantUiRuntimeShell
      key={fingerprint}
      assistantUiMessages={assistantUiMessages}
      sourceMessagesById={sourceMessagesById}
      palette={palette}
      pendingConversationTurn={pendingConversationTurn}
      onSendMessage={onSendMessage}
      renderCompatibilityForMessage={renderCompatibilityForMessage}
      renderDynamicPanelHostForMessage={renderDynamicPanelHostForMessage}
      liveInterrupts={liveInterrupts}
    />
  );
}

export function MobileAssistantUiThread({
  messages,
  liveInterrupts,
  palette,
  pendingConversationTurn,
  onSendMessage,
}: MobileAssistantUiThreadProps) {
  return (
    <MobileAssistantUiShell
      messages={messages}
      liveInterrupts={liveInterrupts}
      palette={palette}
      pendingConversationTurn={pendingConversationTurn}
      onSendMessage={onSendMessage}
    />
  );
}
