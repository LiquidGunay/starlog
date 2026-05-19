import {
  assertSafeMobileTestAuthBuildConfig,
  isMobileTestAuthConfigEnabled,
  parseMobileTestAuthConfig,
  redactedMobileTestAuthAck,
} from "../src/mobile-test-auth-config";

declare const require: (moduleName: string) => {
  equal: (actual: unknown, expected: unknown) => void;
  deepEqual: (actual: unknown, expected: unknown) => void;
  throws: (fn: () => void, expected?: RegExp) => void;
};

const assert = require("node:assert/strict");

assert.equal(isMobileTestAuthConfigEnabled({ dev: true, appVariant: "development", flag: "1" }), true);
assert.equal(isMobileTestAuthConfigEnabled({ dev: false, appVariant: "preview", flag: "true" }), true);
assert.equal(isMobileTestAuthConfigEnabled({ dev: true, appVariant: "development", flag: "false" }), false);
assert.equal(isMobileTestAuthConfigEnabled({ dev: false, appVariant: "production", flag: "1" }), false);

assertSafeMobileTestAuthBuildConfig({ dev: false, appVariant: "preview", flag: "1" });
assert.throws(
  () => assertSafeMobileTestAuthBuildConfig({ dev: false, appVariant: "production", flag: "1" }),
  /production builds/,
);

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
