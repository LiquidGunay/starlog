const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;

Module._load = function mockMobileSurfaceDependencies(request: string, parent: unknown, isMain: boolean) {
  if (request === "react") {
    return {
      useState: (initialValue: unknown) => [initialValue, () => undefined],
    };
  }
  if (request === "react/jsx-runtime") {
    return {
      Fragment: "Fragment",
      jsx: () => null,
      jsxs: () => null,
    };
  }
  if (request === "react-native") {
    return {
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      Text: "Text",
      TextInput: "TextInput",
      TouchableOpacity: "TouchableOpacity",
      View: "View",
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    };
  }
  if (request === "@expo/vector-icons") {
    return { MaterialCommunityIcons: "MaterialCommunityIcons" };
  }
  if (request === "@starlog/contracts") {
    return {
      productCopy: {
        assistant: {
          emptyBody: "",
          emptyTitle: "",
          inputPlaceholder: "Message Assistant",
        },
      },
    };
  }
  if (request === "./conversation-cards") {
    return { mobileConversationCardLabel: () => "" };
  }
  if (request === "./mobile-library-view-model") {
    return { deriveMobileLibraryViewModel: () => ({}) };
  }
  if (request === "./mobile-library-detail-view-model") {
    return {
      deriveMobileArtifactDetailViewModel: () => ({}),
      deriveMobileArtifactFallbackDetail: () => ({}),
    };
  }
  if (request === "./mobile-planner-view-model") {
    return { deriveMobilePlannerViewModel: () => ({}) };
  }
  if (request === "./mobile-review-view-model") {
    return { deriveMobileReviewViewModel: () => ({}) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const { mobileAssistantMicDisabled } = require("../src/mobile-assistant-rebuild");

  assert.equal(
    mobileAssistantMicDisabled({ pendingConversationTurn: true, voiceActionState: "listening" }),
    false,
  );
  assert.equal(
    mobileAssistantMicDisabled({ pendingConversationTurn: true, voiceActionState: "idle" }),
    true,
  );
  assert.equal(
    mobileAssistantMicDisabled({ pendingConversationTurn: false, voiceActionState: "listening" }),
    false,
  );
} finally {
  Module._load = originalLoad;
}
