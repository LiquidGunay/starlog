export type AssistantVoiceActionState = "idle" | "listening" | "recording" | "ready";
export type AssistantVoiceTarget = "assistant" | "capture" | null;
export type AssistantVoiceUsage = "stt" | "message" | "command";
export type AssistantVoicePrimaryAction =
  | { kind: "listen" }
  | { kind: "start_recording" }
  | { kind: "stop_recording" }
  | { kind: "send_clip" }
  | { kind: "blocked"; message: string };

type AssistantSpeechTranscript = {
  transcript: string;
};

type AssistantLocalSttFlowOptions = {
  prompt: string;
  listeningStatus: string;
  requestPermission: () => Promise<{ granted: boolean }>;
  recognizeSpeechOnce: (options: { prompt: string }) => Promise<AssistantSpeechTranscript>;
  setListening: (value: boolean) => void;
  setStatus: (value: string) => void;
  onTranscript: (transcript: string) => Promise<void>;
};

export function deriveAssistantVoiceActionState(options: {
  localSttListening: boolean;
  voiceRecording: boolean;
  voiceClipReady: boolean;
  voiceClipTarget: AssistantVoiceTarget;
}): AssistantVoiceActionState {
  if (options.localSttListening) {
    return "listening";
  }
  if (options.voiceRecording && options.voiceClipTarget === "assistant") {
    return "recording";
  }
  if (options.voiceClipReady && options.voiceClipTarget === "assistant") {
    return "ready";
  }
  return "idle";
}

export function assistantVoiceActionHint(state: AssistantVoiceActionState): string | null {
  if (state === "listening") {
    return "Listening for an on-device message...";
  }
  if (state === "recording") {
    return "Recording voice input. Tap the mic again to stop.";
  }
  if (state === "ready") {
    return "Voice clip ready. Tap the mic to send it into the Assistant thread, or clear it.";
  }
  return null;
}

export function assistantVoiceClipConflictMessage(options: {
  usage: AssistantVoiceUsage;
  voiceClipTarget: AssistantVoiceTarget;
}): string | null {
  if (options.voiceClipTarget === "capture") {
    if (options.usage === "stt") {
      return "A Library voice note is ready. Upload it in Library or clear it before starting Assistant STT.";
    }
    if (options.usage === "command") {
      return "A Library voice note is ready. Upload it in Library or clear it before sending an Assistant voice command.";
    }
    return "A Library voice note is ready. Upload it in Library or clear it before using Assistant voice.";
  }
  if (options.voiceClipTarget === "assistant" && options.usage === "stt") {
    return "An Assistant voice clip is ready. Send it or clear it before starting on-device STT.";
  }
  return null;
}

export function assistantVoicePanelStatus(options: {
  sttUsesOnDevice: boolean;
  voiceRecording: boolean;
  voiceClipTarget: AssistantVoiceTarget;
  voiceClipReady: boolean;
  voiceClipDurationMs: number;
}): string {
  if (options.sttUsesOnDevice) {
    return "Voice commands now use Android speech recognition on the phone, then send the transcript through the normal assistant command endpoint.";
  }
  if (options.voiceRecording && options.voiceClipTarget === "assistant") {
    return "Voice clip for commands: recording...";
  }
  if (options.voiceClipReady && options.voiceClipTarget === "assistant") {
    return `Voice clip for commands: ${Math.round(options.voiceClipDurationMs / 1000)}s ready`;
  }
  return "Voice clip for commands: none";
}

export function assistantLocalSttBlockedReason(options: {
  usage: "message" | "command";
  localSttListening: boolean;
  hasToken: boolean;
  localSttAvailable: boolean;
  sttUsesOnDevice: boolean;
  hasVoiceRecording: boolean;
  hasVoiceClip: boolean;
  voiceClipTarget: AssistantVoiceTarget;
}): string | null {
  if (options.localSttListening) {
    return "On-device STT is already listening";
  }
  if (!options.hasToken) {
    return "Add API token first";
  }
  if (!options.localSttAvailable || !options.sttUsesOnDevice) {
    return options.usage === "command"
      ? "On-device STT is unavailable; use the queued Whisper voice path instead."
      : "On-device STT is unavailable; use the recording fallback.";
  }
  if (options.hasVoiceRecording) {
    return "Stop the current voice recording before starting on-device STT";
  }
  if (options.hasVoiceClip) {
    return assistantVoiceClipConflictMessage({ usage: "stt", voiceClipTarget: options.voiceClipTarget }) || "Voice clip ready";
  }
  return null;
}

export function assistantRecordedVoiceBlockedReason(options: {
  usage: "message" | "command";
  hasVoiceClip: boolean;
  voiceClipTarget: AssistantVoiceTarget;
  hasToken: boolean;
}): string | null {
  if (!options.hasVoiceClip) {
    return "Record a voice clip first";
  }
  if (options.voiceClipTarget === "capture") {
    return assistantVoiceClipConflictMessage({
      usage: options.usage,
      voiceClipTarget: options.voiceClipTarget,
    }) || "Voice clip ready";
  }
  if (!options.hasToken) {
    return "Add API token first";
  }
  return null;
}

export function assistantPrimaryVoiceAction(options: {
  pendingConversationTurn: boolean;
  localSttListening: boolean;
  sttUsesOnDevice: boolean;
  localSttAvailable: boolean;
  hasToken: boolean;
  hasVoiceRecording: boolean;
  hasVoiceClip: boolean;
  voiceClipTarget: AssistantVoiceTarget;
}): AssistantVoicePrimaryAction {
  if (options.pendingConversationTurn) {
    return { kind: "blocked", message: "Wait for the current Assistant reply to finish" };
  }
  if (options.sttUsesOnDevice) {
    const blockedReason = assistantLocalSttBlockedReason({
      usage: "message",
      localSttListening: options.localSttListening,
      hasToken: options.hasToken,
      localSttAvailable: options.localSttAvailable,
      sttUsesOnDevice: options.sttUsesOnDevice,
      hasVoiceRecording: options.hasVoiceRecording,
      hasVoiceClip: options.hasVoiceClip,
      voiceClipTarget: options.voiceClipTarget,
    });
    if (blockedReason) {
      return { kind: "blocked", message: blockedReason };
    }
    return { kind: "listen" };
  }
  if (options.hasVoiceRecording) {
    if (options.voiceClipTarget !== "assistant") {
      return { kind: "blocked", message: "A Library voice note is recording. Finish it in Library before recording for Assistant." };
    }
    return { kind: "stop_recording" };
  }
  if (options.hasVoiceClip) {
    if (options.voiceClipTarget !== "assistant") {
      return {
        kind: "blocked",
        message:
          assistantVoiceClipConflictMessage({ usage: "message", voiceClipTarget: options.voiceClipTarget }) || "Voice clip ready",
      };
    }
    return { kind: "send_clip" };
  }
  return { kind: "start_recording" };
}

export async function runAssistantLocalSttFlow(options: AssistantLocalSttFlowOptions): Promise<void> {
  try {
    const permission = await options.requestPermission();
    if (!permission.granted) {
      options.setStatus("Microphone permission denied");
      return;
    }

    options.setListening(true);
    options.setStatus(options.listeningStatus);
    const transcriptPayload = await options.recognizeSpeechOnce({ prompt: options.prompt });
    const transcript = transcriptPayload.transcript.trim();
    if (!transcript) {
      throw new Error("On-device STT returned no transcript");
    }
    await options.onTranscript(transcript);
  } catch (error) {
    options.setStatus(error instanceof Error ? error.message : "On-device STT failed");
  } finally {
    options.setListening(false);
  }
}
