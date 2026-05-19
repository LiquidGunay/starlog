export type MobileTestAuthConfig = {
  apiBase: string;
  pwaBase?: string;
  token: string;
  tab?: string;
};

type TestAuthLinkGate = {
  dev: boolean;
  flag?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isMobileTestAuthLinkEnabled(gate: TestAuthLinkGate): boolean {
  return gate.dev || TRUE_VALUES.has((gate.flag ?? "").trim().toLowerCase());
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

function firstParam(params: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = params[name];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

export function parseMobileTestAuthLink(
  route: string,
  params: Record<string, string>,
  enabled: boolean,
): MobileTestAuthConfig | null {
  if (!enabled || route !== "test-auth") {
    return null;
  }

  const apiBase = normalizeOptionalHttpUrl(firstParam(params, ["api_base", "apiBase", "api"]));
  const token = normalizeBearerToken(firstParam(params, ["token", "access_token", "bearer_token"]));
  if (!apiBase || !token) {
    return null;
  }

  const pwaBase = normalizeOptionalHttpUrl(firstParam(params, ["pwa_base", "pwaBase", "web_origin", "webOrigin"]));
  const tab = (firstParam(params, ["tab", "surface"]) ?? "").trim().toLowerCase();
  return {
    apiBase,
    ...(pwaBase ? { pwaBase } : {}),
    token,
    ...(tab ? { tab } : {}),
  };
}
