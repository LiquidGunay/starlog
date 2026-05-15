declare module "@assistant-ui/react-native" {
  import type { ComponentType, ReactNode } from "react";

  export type ThreadMessageLike = {
    id?: string;
    role?: "system" | "user" | "assistant";
    content: string;
    createdAt?: Date;
    metadata?: Record<string, unknown>;
  };

  export type ChatModelAdapter = {
    run: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>;
  };

  export function useLocalRuntime(
    adapter: ChatModelAdapter,
    options?: { initialMessages?: ThreadMessageLike[] },
  ): unknown;

  export function useAuiState<T>(
    selector: (state: { message: { role: "system" | "user" | "assistant" } }) => T,
  ): T;

  export function AssistantRuntimeProvider(props: { runtime: unknown; children?: ReactNode }): ReactNode;

  export const MessagePrimitive: {
    Root: ComponentType<Record<string, unknown>>;
    Content: ComponentType<{
      renderText: (options: { part: { text: string } }) => ReactNode;
    }>;
  };

  export const ThreadPrimitive: {
    Root: ComponentType<Record<string, unknown>>;
    Messages: ComponentType<Record<string, unknown>>;
  };
}
