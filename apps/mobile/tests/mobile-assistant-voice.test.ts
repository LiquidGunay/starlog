import {
  assistantBriefingPlaybackStatus,
  AssistantVoiceActionState,
  assistantPrimaryVoiceAction,
  deriveAssistantVoiceActionState,
  resolveCachedBriefingPlaybackMode,
  type CachedBriefingPlaybackMode,
  runAssistantLocalSttFlow,
} from "../src/assistant-mobile-voice";
import { buildNativeAssistantThreadMessageRequest } from "../src/mobile-assistant-thread-api";

declare const require: (moduleName: string) => { equal: (...args: unknown[]) => void; deepEqual: (...args: unknown[]) => void };
declare const process: { exit: (code?: number) => never };

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

runNativeVoiceThreadPathProof().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function runNativeVoiceThreadPathProof() {
  const statuses: string[] = [];
  const listeningStates: boolean[] = [];
  const threadRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

  await runAssistantLocalSttFlow({
    prompt: "Speak your message for Assistant",
    listeningStatus: "Listening for an Assistant message...",
    requestPermission: async () => ({ granted: true }),
    recognizeSpeechOnce: async () => ({ transcript: "  Grade my Sliding Window recall as good.  " }),
    setListening: (value) => {
      listeningStates.push(value);
    },
    setStatus: (value) => {
      statuses.push(value);
    },
    onTranscript: async (transcript) => {
      const request = buildNativeAssistantThreadMessageRequest({
        apiBase: "https://api.starlog.test/",
        token: "mobile-token",
        content: transcript,
        sourceLabel: "voice",
      });
      threadRequests.push({ url: request.url, body: JSON.parse(request.init.body) as Record<string, unknown> });
    },
  });

  assert.deepEqual(listeningStates, [true, false]);
  assert.deepEqual(statuses, ["Listening for an Assistant message..."]);
  assert.equal(threadRequests.length, 1);
  assert.equal(threadRequests[0]?.url, "https://api.starlog.test/v1/assistant/threads/primary/messages");
  assert.equal(threadRequests[0]?.url.includes("/v1/agent/command"), false);
  assert.equal(threadRequests[0]?.body.content, "Grade my Sliding Window recall as good.");
  assert.equal(threadRequests[0]?.body.input_mode, "voice");
  assert.equal(threadRequests[0]?.body.device_target, "mobile-native");
  assert.deepEqual(threadRequests[0]?.body.metadata, {
    surface: "assistant_mobile",
    submitted_via: "voice",
  });
}
