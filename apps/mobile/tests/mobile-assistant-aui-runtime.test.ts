const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;

declare const process: { exit: (code?: number) => never };

type RenderNode =
  | null
  | string
  | number
  | {
      type: unknown;
      props: Record<string, unknown>;
      children: RenderNode[];
    };

type CapturedLocalRuntime = {
  adapter: { run: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown> };
  options?: { initialMessages?: unknown[] };
};

let capturedLocalRuntime: CapturedLocalRuntime | null = null;

function createElement(type: unknown, props: Record<string, unknown> | null): RenderNode {
  return {
    type,
    props: props || {},
    children: normalizeChildren(props?.children),
  };
}

function normalizeChildren(children: unknown): RenderNode[] {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }
  if (Array.isArray(children)) {
    return children.flatMap(normalizeChildren);
  }
  return [children as RenderNode];
}

function nativeComponent(name: string) {
  return function NativeComponent(props: Record<string, unknown>) {
    return createElement(name, props);
  };
}

Module._load = function mockMobileAssistantRuntimeDependencies(request: string, parent: unknown, isMain: boolean) {
  if (request === "react") {
    return {
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
      useMemo: (factory: () => unknown) => factory(),
    };
  }
  if (request === "react/jsx-runtime") {
    return {
      jsx: createElement,
      jsxs: createElement,
    };
  }
  if (request === "react-native") {
    return {
      Text: nativeComponent("Text"),
      TextInput: nativeComponent("TextInput"),
      View: nativeComponent("View"),
    };
  }
  if (request === "@assistant-ui/react-native") {
    return {
      AssistantRuntimeProvider: (props: Record<string, unknown>) => createElement("AssistantRuntimeProvider", props),
      ComposerPrimitive: {
        Root: nativeComponent("ComposerPrimitive.Root"),
      },
      MessagePrimitive: {
        Root: nativeComponent("MessagePrimitive.Root"),
        Content: nativeComponent("MessagePrimitive.Content"),
      },
      ThreadPrimitive: {
        Root: nativeComponent("ThreadPrimitive.Root"),
        Messages: nativeComponent("ThreadPrimitive.Messages"),
      },
      useAui: () => ({
        composer: () => ({
          getState: () => ({ text: "" }),
          setText: () => undefined,
        }),
      }),
      useAuiState: (selector: (state: unknown) => unknown) =>
        selector({
          message: {
            id: "assistant-message",
            role: "assistant",
            content: [{ type: "text", text: "Server-owned message" }],
            createdAt: new Date("2026-05-19T00:00:00Z"),
            metadata: { custom: { starlogMessageId: "starlog-message" } },
          },
        }),
      useLocalRuntime: (adapter: CapturedLocalRuntime["adapter"], options?: CapturedLocalRuntime["options"]) => {
        capturedLocalRuntime = { adapter, options };
        return { runtime: "local" };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function runTests() {
  const {
    MOBILE_STARLOG_ASSISTANT_RUNTIME_MODE,
    MobileStarlogAssistantRuntime,
    createMobileStarlogAssistantProtocolAdapter,
    latestAssistantUiUserText,
  } = require("../src/mobile-assistant-aui-thread");

  assert.equal(MOBILE_STARLOG_ASSISTANT_RUNTIME_MODE, "server-owned-local-protocol-bridge");

  const sentMessages: string[] = [];
  const assistantUiMessages = [
    {
      id: "starlog-message",
      role: "assistant",
      content: "Persisted Starlog message",
      createdAt: new Date("2026-05-19T00:00:00Z"),
      metadata: { custom: { starlogMessageId: "starlog-message" } },
    },
  ];

  const tree = MobileStarlogAssistantRuntime({
    assistantUiMessages,
    onSendMessage: async (content: string) => {
      sentMessages.push(content);
    },
    children: "child",
  });

  assert.equal(typeof (tree as { type: unknown }).type, "function");
  assert.deepEqual((tree as { props: Record<string, unknown> }).props.runtime, { runtime: "local" });
  assert.deepEqual(capturedLocalRuntime?.options?.initialMessages, assistantUiMessages);

  const run = capturedLocalRuntime?.adapter.run({
    messages: [
      { role: "assistant", content: [{ type: "text", text: "Previous assistant reply." }] },
      { role: "user", content: [{ type: "text", text: "Please send this." }] },
    ],
  });
  if (!run) {
    throw new Error("Expected MobileStarlogAssistantRuntime to configure a LocalRuntime adapter.");
  }

  const first = await run.next();
  assert.deepEqual(sentMessages, ["Please send this."]);
  assert.deepEqual(first.value, {
    content: "Starlog is sending this through the native assistant thread.",
  });

  const second = await run.next();
  assert.equal(second.done, true);
  assert.equal(JSON.stringify(first.value).includes("Please send this."), false);

  assert.equal(
    latestAssistantUiUserText({
      messages: [
        { role: "user", content: "Earlier draft" },
        { role: "assistant", content: [{ type: "text", text: "Reply" }] },
        { role: "user", content: [{ type: "text", text: "Latest draft" }] },
      ],
    }),
    "Latest draft",
  );

  const disabledSentMessages: string[] = [];
  const disabledRun = createMobileStarlogAssistantProtocolAdapter({
    disabled: true,
    onSendMessage: async (content: string) => {
      disabledSentMessages.push(content);
    },
  }).run({ messages: [{ role: "user", content: [{ type: "text", text: "Wait should block this." }] }] });
  assert.deepEqual(await disabledRun.next(), {
    done: false,
    value: { content: "Starlog is waiting for the current Assistant reply to finish." },
  });
  assert.deepEqual(disabledSentMessages, []);
  assert.equal((await disabledRun.next()).done, true);

  const emptyRun = createMobileStarlogAssistantProtocolAdapter().run({ messages: [{ role: "assistant", content: "No user turn" }] });
  assert.deepEqual(await emptyRun.next(), {
    done: false,
    value: { content: "Enter an Assistant message first." },
  });
}

runTests()
  .then(() => {
    console.log("mobile assistant-ui runtime tests passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    Module._load = originalLoad;
  });
