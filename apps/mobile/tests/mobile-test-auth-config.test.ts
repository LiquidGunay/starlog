import {
  assertSafeMobileTestAuthBuildConfig,
  isMobileTestAuthConfigEnabled,
  parseMobileTestAuthConfig,
  redactedMobileTestAuthAck,
} from "../src/mobile-test-auth-config";

declare const require: any;
declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

const assert = require("node:assert/strict");

assert.equal(isMobileTestAuthConfigEnabled({ dev: true, appVariant: "development", flag: "1" }), true);
assert.equal(isMobileTestAuthConfigEnabled({ dev: false, appVariant: "preview", flag: "true" }), true);
assert.equal(isMobileTestAuthConfigEnabled({ dev: false, appVariant: "internal", flag: "1" }), true);
assert.equal(isMobileTestAuthConfigEnabled({ dev: true, appVariant: "development", flag: "false" }), false);
assert.equal(isMobileTestAuthConfigEnabled({ dev: false, appVariant: "production", flag: "1" }), false);

assertSafeMobileTestAuthBuildConfig({ dev: false, appVariant: "preview", flag: "1" });
assertSafeMobileTestAuthBuildConfig({ dev: false, appVariant: "internal", flag: "1" });
assert.throws(
  () => assertSafeMobileTestAuthBuildConfig({ dev: false, appVariant: "production", flag: "1" }),
  /production builds/,
);

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function runAppConfig(appVariant: string, enableTestAuthConfig: string): { status: number; output: string } {
  const cwd = process.cwd();
  const mobileRoot = cwd.endsWith("/apps/mobile") ? cwd : `${cwd}/apps/mobile`;
  const appConfigPath = `${mobileRoot}/app.config.js`;
  const previousAppVariant = process.env.APP_VARIANT;
  const previousTestAuthFlag = process.env.EXPO_PUBLIC_STARLOG_ENABLE_TEST_AUTH_CONFIG;
  const previousRuntimeVariant = process.env.EXPO_PUBLIC_STARLOG_APP_VARIANT;
  process.env.APP_VARIANT = appVariant;
  process.env.EXPO_PUBLIC_STARLOG_ENABLE_TEST_AUTH_CONFIG = enableTestAuthConfig;
  try {
    delete require.cache[require.resolve(appConfigPath)];
    const config = require(appConfigPath);
    const expo = config.expo;
    return {
      status: 0,
      output: JSON.stringify({
        appVariant: process.env.EXPO_PUBLIC_STARLOG_APP_VARIANT,
        androidPackage: expo.android.package,
        iosBundleIdentifier: expo.ios.bundleIdentifier,
      }),
    };
  } catch (error) {
    return { status: 1, output: error instanceof Error ? error.message : String(error) };
  } finally {
    delete require.cache[require.resolve(appConfigPath)];
    restoreEnv("APP_VARIANT", previousAppVariant);
    restoreEnv("EXPO_PUBLIC_STARLOG_ENABLE_TEST_AUTH_CONFIG", previousTestAuthFlag);
    restoreEnv("EXPO_PUBLIC_STARLOG_APP_VARIANT", previousRuntimeVariant);
  }
}

const internalAppConfig = runAppConfig("internal", "1");
assert.equal(internalAppConfig.status, 0, internalAppConfig.output);
assert.deepEqual(JSON.parse(internalAppConfig.output), {
  appVariant: "internal",
  androidPackage: "com.starlog.app.dev",
  iosBundleIdentifier: "com.starlog.app.dev",
});

const productionAppConfig = runAppConfig("production", "1");
assert.equal(productionAppConfig.status, 1);
assert.equal(productionAppConfig.output.includes("production package builds"), true);

const parsed = parseMobileTestAuthConfig(
  {
    apiBase: " https://starlog-api-production.up.railway.app/ ",
    pwaBase: "https://starlog-web-production.up.railway.app/",
    token: "Bearer hosted-secret-token",
    tab: "Review",
  },
  true,
);

assert.deepEqual(parsed, {
  apiBase: "https://starlog-api-production.up.railway.app",
  pwaBase: "https://starlog-web-production.up.railway.app",
  token: "hosted-secret-token",
  tab: "review",
});

assert.deepEqual(
  redactedMobileTestAuthAck(parsed!, "2026-05-19T15:30:00.000Z"),
  {
    status: "accepted",
    acceptedAt: "2026-05-19T15:30:00.000Z",
    apiBase: "https://starlog-api-production.up.railway.app",
    pwaBase: "https://starlog-web-production.up.railway.app",
    hasToken: true,
    tab: "review",
  },
);

assert.equal(
  parseMobileTestAuthConfig(
    {
      apiBase: "https://starlog-api-production.up.railway.app",
      token: "hosted-secret-token",
    },
    false,
  ),
  null,
);

assert.equal(
  parseMobileTestAuthConfig(
    {
      apiBase: "file:///tmp/starlog",
      token: "hosted-secret-token",
    },
    true,
  ),
  null,
);

assert.equal(
  parseMobileTestAuthConfig(
    {
      apiBase: "https://starlog-api-production.up.railway.app",
    },
    true,
  ),
  null,
);

console.log("mobile test auth config tests passed");
