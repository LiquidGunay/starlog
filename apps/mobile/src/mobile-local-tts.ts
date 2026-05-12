export type KittenTtsBundleState = "not_packaged" | "assets_packaged" | "native_runtime_ready";

export type MobileLocalTtsProvider = "expo_speech" | "kitten_tts_native";

export type MobileLocalTtsStatus = {
  provider: MobileLocalTtsProvider;
  providerLabel: string;
  kittenBundleState: KittenTtsBundleState;
  nativeRuntimeAvailable: boolean;
  policyReason: string;
};

export type MobileSpeechAdapter = {
  speak: (text: string) => void;
};

export type MobileLocalTtsPlayback = {
  provider: MobileLocalTtsProvider;
  providerLabel: string;
};

export const KITTEN_TTS_NATIVE_BUNDLE = {
  modelFamily: "kitten-tts-nano-0.8-int8",
  runtime: "onnxruntime-react-native or a custom native ONNX module",
  expectedAssets: ["model.onnx", "voices.npz"],
  outputSampleRateHz: 24000,
} as const;

export const MOBILE_BRIEFING_AUDIO_PROVIDER_HINT = "desktop_bridge_tts";

export function normalizeKittenTtsBundleState(value: string | undefined | null): KittenTtsBundleState {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "assets_packaged" || normalized === "native_runtime_ready") {
    return normalized;
  }
  return "not_packaged";
}

export function resolveMobileLocalTtsStatus(
  kittenBundleState: KittenTtsBundleState,
  nativeRuntimeAvailable = false,
): MobileLocalTtsStatus {
  if (kittenBundleState === "native_runtime_ready" && nativeRuntimeAvailable) {
    return {
      provider: "kitten_tts_native",
      providerLabel: "Kitten TTS",
      kittenBundleState,
      nativeRuntimeAvailable: true,
      policyReason: "Mobile speech playback stays on-device through the bundled Kitten TTS runtime.",
    };
  }

  const packagedNote =
    kittenBundleState === "native_runtime_ready"
      ? " Kitten native runtime is configured, but this build has not registered the native speech adapter yet."
      : kittenBundleState === "assets_packaged"
        ? " Kitten assets are packaged, but the native runtime is not enabled yet."
        : "";
  return {
    provider: "expo_speech",
    providerLabel: "OS speech",
    kittenBundleState,
    nativeRuntimeAvailable: false,
    policyReason: `Mobile speech playback stays on-device through the OS speech engine.${packagedNote}`,
  };
}

export function speakMobileLocalText(
  text: string,
  speech: MobileSpeechAdapter,
  status: MobileLocalTtsStatus,
): MobileLocalTtsPlayback {
  speech.speak(text);
  return {
    provider: status.provider,
    providerLabel: status.providerLabel,
  };
}
