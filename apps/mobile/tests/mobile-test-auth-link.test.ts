import {
  isMobileTestAuthLinkEnabled,
  parseMobileTestAuthLink,
} from "../src/mobile-test-auth-link";

declare const require: (moduleName: string) => {
  equal: (actual: unknown, expected: unknown) => void;
  deepEqual: (actual: unknown, expected: unknown) => void;
};

const assert = require("node:assert/strict");

assert.equal(isMobileTestAuthLinkEnabled({ dev: true }), true);
assert.equal(isMobileTestAuthLinkEnabled({ dev: false, flag: "1" }), true);
assert.equal(isMobileTestAuthLinkEnabled({ dev: false, flag: "false" }), false);

assert.deepEqual(
  parseMobileTestAuthLink(
    "test-auth",
    {
      api_base: " https://starlog-api-production.up.railway.app/ ",
      pwa_base: "https://starlog-web-production.up.railway.app/",
      token: "Bearer hosted-secret-token",
      tab: "Review",
    },
    true,
  ),
  {
    apiBase: "https://starlog-api-production.up.railway.app",
    pwaBase: "https://starlog-web-production.up.railway.app",
    token: "hosted-secret-token",
    tab: "review",
  },
);

assert.equal(
  parseMobileTestAuthLink(
    "test-auth",
    {
      api_base: "https://starlog-api-production.up.railway.app",
      token: "hosted-secret-token",
    },
    false,
  ),
  null,
);

assert.equal(
  parseMobileTestAuthLink(
    "test-auth",
    {
      api_base: "file:///tmp/starlog",
      token: "hosted-secret-token",
    },
    true,
  ),
  null,
);

assert.equal(
  parseMobileTestAuthLink(
    "surface",
    {
      api_base: "https://starlog-api-production.up.railway.app",
      token: "hosted-secret-token",
    },
    true,
  ),
  null,
);

console.log("mobile test auth link tests passed");
