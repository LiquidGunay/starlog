export type MobileAssistantApiPostRequest = {
  url: string;
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  };
};

export type NativeAssistantThreadMessageRequestOptions = {
  apiBase: string;
  token: string;
  content: string;
  sourceLabel?: string;
  deviceTarget?: string;
  surface?: string;
};

export type NativeAssistantInterruptSubmitRequestOptions = {
  apiBase: string;
  token: string;
  interruptId: string;
  values: Record<string, unknown>;
};

export function normalizeMobileAssistantApiBase(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function buildNativeAssistantThreadMessageRequest({
  apiBase,
  token,
  content,
  sourceLabel = "typed composer",
  deviceTarget = "mobile-native",
  surface = "assistant_mobile",
}: NativeAssistantThreadMessageRequestOptions): MobileAssistantApiPostRequest {
  return {
    url: `${normalizeMobileAssistantApiBase(apiBase)}/v1/assistant/threads/primary/messages`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        input_mode: sourceLabel === "voice" ? "voice" : "text",
        device_target: deviceTarget,
        metadata: {
          surface,
          submitted_via: sourceLabel,
        },
      }),
    },
  };
}

export function buildNativeAssistantInterruptSubmitRequest({
  apiBase,
  token,
  interruptId,
  values,
}: NativeAssistantInterruptSubmitRequestOptions): MobileAssistantApiPostRequest {
  return {
    url: `${normalizeMobileAssistantApiBase(apiBase)}/v1/assistant/interrupts/${encodeURIComponent(interruptId)}/submit`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ values }),
    },
  };
}
