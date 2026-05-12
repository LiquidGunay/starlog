import {
  MOBILE_BRIEFING_AUDIO_PROVIDER_HINT,
  MOBILE_BRIEFING_AUDIO_PROVIDER_LABEL,
  normalizeKittenTtsBundleState,
  resolveMobileLocalTtsStatus,
  speakMobileLocalText,
  type KittenTtsBundleState,
} from "../src/mobile-local-tts";

declare const require: (moduleName: string) => {
  equal: (actual: unknown, expected: unknown) => void;
  deepEqual: (actual: unknown, expected: unknown) => void;
};

const assert = require("node:assert/strict");

assert.equal(normalizeKittenTtsBundleState(undefined), "not_packaged");
assert.equal(normalizeKittenTtsBundleState(""), "not_packaged");
assert.equal(normalizeKittenTtsBundleState("unknown"), "not_packaged");
assert.equal(normalizeKittenTtsBundleState(" assets_packaged "), "assets_packaged");
assert.equal(normalizeKittenTtsBundleState("native_runtime_ready"), "native_runtime_ready");
assert.equal(MOBILE_BRIEFING_AUDIO_PROVIDER_HINT, "desktop_bridge_tts");
assert.equal(MOBILE_BRIEFING_AUDIO_PROVIDER_LABEL, "desktop bridge TTS");

const expectedProviders: Array<[KittenTtsBundleState, string, string]> = [
  ["not_packaged", "expo_speech", "OS speech"],
  ["assets_packaged", "expo_speech", "OS speech"],
  ["native_runtime_ready", "expo_speech", "OS speech"],
];

for (const [state, provider, providerLabel] of expectedProviders) {
  const status = resolveMobileLocalTtsStatus(state);
  assert.equal(status.provider, provider);
  assert.equal(status.providerLabel, providerLabel);
  assert.equal(status.kittenBundleState, state);
  assert.equal(status.nativeRuntimeAvailable, false);
}

const spoken: string[] = [];
const playback = speakMobileLocalText(
  "Morning briefing",
  {
    speak: (text) => {
      spoken.push(text);
    },
  },
  resolveMobileLocalTtsStatus("assets_packaged"),
);

assert.deepEqual(spoken, ["Morning briefing"]);
assert.equal(playback.provider, "expo_speech");
assert.equal(playback.providerLabel, "OS speech");
