export type MobileTestAuthConfig = {
  apiBase: string;
  pwaBase?: string;
  token: string;
  tab?: string;
};

type TestAuthConfigGate = {
  appVariant?: string;
  dev: boolean;
  flag?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const INTERNAL_VARIANTS = new Set(["development", "preview", "internal", "dev"]);

export const MOBILE_TEST_AUTH_CONFIG_FILE = "starlog-test-auth-config.json";
export const MOBILE_TEST_AUTH_ACK_FILE = "starlog-test-auth-ack.json";

export function isMobileTestAuthConfigEnabled(gate: TestAuthConfigGate): boolean {
  const variant = (gate.appVariant ?? "").trim().toLowerCase();
  const explicitlyEnabled = TRUE_VALUES.has((gate.flag ?? "").trim().toLowerCase());
  return explicitlyEnabled && (gate.dev || INTERNAL_VARIANTS.has(variant));
}

export function assertSafeMobileTestAuthBuildConfig(gate: TestAuthConfigGate): void {
  const variant = (gate.appVariant ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has((gate.flag ?? "").trim().toLowerCase()) && variant === "production") {
    throw new Error("Mobile test auth config must not be enabled for production builds.");
  }
}

function stringValue(payload: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function normalizeOptionalHttpUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed || !/^https?:\/\/[^/\s?#]+/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeBearerToken(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^Bearer\s+/i, "").trim();
}

export function parseMobileTestAuthConfig(
  rawPayload: unknown,
  enabled: boolean,
): MobileTestAuthConfig | null {
  if (!enabled || !rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const payload = rawPayload as Record<string, unknown>;
  const apiBase = normalizeOptionalHttpUrl(stringValue(payload, ["apiBase", "api_base", "api"]));
  const token = normalizeBearerToken(stringValue(payload, ["token", "accessToken", "access_token", "bearerToken"]));
  if (!apiBase || !token) {
    return null;
  }

  const pwaBase = normalizeOptionalHttpUrl(stringValue(payload, ["pwaBase", "pwa_base", "webOrigin", "web_origin"]));
  const tab = (stringValue(payload, ["tab", "surface"]) ?? "").trim().toLowerCase();
  return {
    apiBase,
    ...(pwaBase ? { pwaBase } : {}),
    token,
    ...(tab ? { tab } : {}),
  };
}

export function redactedMobileTestAuthAck(config: MobileTestAuthConfig, acceptedAt: string): Record<string, unknown> {
  return {
    status: "accepted",
    acceptedAt,
    apiBase: config.apiBase,
    ...(config.pwaBase ? { pwaBase: config.pwaBase } : {}),
    hasToken: Boolean(config.token),
    ...(config.tab ? { tab: config.tab } : {}),
  };
}
