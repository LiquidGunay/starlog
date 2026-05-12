import {
  assistantBriefingPlaybackStatus,
  AssistantVoiceActionState,
  assistantPrimaryVoiceAction,
  deriveAssistantVoiceActionState,
  resolveCachedBriefingPlaybackMode,
  type CachedBriefingPlaybackMode,
} from "../src/assistant-mobile-voice";

declare const require: (moduleName: string) => { equal: (...args: unknown[]) => void; deepEqual: (...args: unknown[]) => void };

const assert = require("node:assert/strict");

const modeWithoutCachedBriefing: CachedBriefingPlaybackMode = "no_cached_briefing";
const modeWithCachedAudio: CachedBriefingPlaybackMode = "cached_audio";
const modeWithCachedTextOnly: CachedBriefingPlaybackMode = "cached_text_only";

assert.equal(
  resolveCachedBriefingPlaybackMode({
    cachedPath: null,
    hasCachedAudio: false,
  }),
  modeWithoutCachedBriefing,
);
assert.equal(
  resolveCachedBriefingPlaybackMode({
    cachedPath: "file:///tmp/briefing.json",
    hasCachedAudio: true,
  }),
  modeWithCachedAudio,
);
assert.equal(
  resolveCachedBriefingPlaybackMode({
    cachedPath: "file:///tmp/briefing.json",
    hasCachedAudio: false,
  }),
  modeWithCachedTextOnly,
);

assert.equal(
  assistantBriefingPlaybackStatus({
    mode: modeWithCachedAudio,
    briefingPlaybackPreference: "offline_first",
  }),
  "Briefing playback source: cached worker audio available (host render path, KittenTTS-compatible when configured).",
);
assert.equal(
  assistantBriefingPlaybackStatus({
    mode: modeWithCachedTextOnly,
    briefingPlaybackPreference: "refresh_then_cache",
  }),
  "Briefing playback source: cached text only; using expo-speech fallback on device.",
);

const assistantActionIdle = deriveAssistantVoiceActionState({
  localSttListening: false,
  isAssistantRecording: false,
  isAssistantClipReady: false,
});
const assistantActionReady = deriveAssistantVoiceActionState({
  localSttListening: false,
  isAssistantRecording: true,
  isAssistantClipReady: false,
});
const assistantActionRecording = deriveAssistantVoiceActionState({
  localSttListening: false,
  isAssistantRecording: false,
  isAssistantClipReady: true,
});
const assistantActionListening = deriveAssistantVoiceActionState({
  localSttListening: true,
  isAssistantRecording: true,
  isAssistantClipReady: true,
});

assert.equal(assistantActionIdle, "idle" as AssistantVoiceActionState);
assert.equal(assistantActionReady, "recording" as AssistantVoiceActionState);
assert.equal(assistantActionRecording, "ready" as AssistantVoiceActionState);
assert.equal(assistantActionListening, "listening" as AssistantVoiceActionState);

const offDevicePrimaryAction = assistantPrimaryVoiceAction({
  pendingConversationTurn: false,
  localSttListening: false,
  sttUsesOnDevice: false,
  localSttAvailable: true,
  hasToken: true,
  hasVoiceRecording: true,
  hasVoiceClip: true,
  voiceClipTarget: "assistant",
});
assert.equal(offDevicePrimaryAction.kind, "stop_recording");

const readyToSendPrimaryAction = assistantPrimaryVoiceAction({
  pendingConversationTurn: false,
  localSttListening: false,
  sttUsesOnDevice: false,
  localSttAvailable: true,
  hasToken: true,
  hasVoiceRecording: false,
  hasVoiceClip: true,
  voiceClipTarget: "assistant",
});
assert.equal(readyToSendPrimaryAction.kind, "send_clip");
