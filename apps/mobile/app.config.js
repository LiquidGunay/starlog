const variant = process.env.APP_VARIANT || "production";
const DEFAULT_VERSION_NAME =
  process.env.STARLOG_VERSION_NAME || process.env.STARLOG_ANDROID_VERSION_NAME || "0.1.0";
const DEFAULT_ANDROID_VERSION_CODE = parsePositiveInt(process.env.STARLOG_ANDROID_VERSION_CODE, 1);
const DEFAULT_IOS_BUILD_NUMBER = process.env.STARLOG_IOS_BUILD_NUMBER || String(DEFAULT_ANDROID_VERSION_CODE);

function parsePositiveInt(rawValue, fallbackValue) {
  if (!rawValue) {
    return fallbackValue;
  }
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }
  return parsedValue;
}

function variantName(currentVariant) {
  if (currentVariant === "development") {
    return "Starlog Dev";
  }
  if (currentVariant === "preview") {
    return "Starlog Preview";
  }
  return "Starlog";
}

function variantSuffix(currentVariant) {
  if (currentVariant === "development") {
    return ".dev";
  }
  if (currentVariant === "preview") {
    return ".preview";
  }
  return "";
}

const packageSuffix = variantSuffix(variant);
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID || "";

const extra = projectId
  ? {
      eas: {
        projectId,
      },
    }
  : {};

module.exports = {
  expo: {
    name: variantName(variant),
    slug: "starlog",
    scheme: "starlog",
    version: DEFAULT_VERSION_NAME,
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#0d1117",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      buildNumber: DEFAULT_IOS_BUILD_NUMBER,
      bundleIdentifier: `com.starlog.app${packageSuffix}`,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0d1117",
      },
      versionCode: DEFAULT_ANDROID_VERSION_CODE,
      package: `com.starlog.app${packageSuffix}`,
      intentFilters: [
        {
          action: "VIEW",
          data: [
            {
              scheme: "starlog",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [
      "expo-dev-client",
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#1f315d",
        },
      ],
      [
        "expo-share-intent",
        {
          disableIOS: false,
          iosActivationRules: {
            NSExtensionActivationSupportsText: true,
            NSExtensionActivationSupportsWebURLWithMaxCount: 1,
            NSExtensionActivationSupportsImageWithMaxCount: 8,
            NSExtensionActivationSupportsMovieWithMaxCount: 8,
            NSExtensionActivationSupportsFileWithMaxCount: 8,
          },
          androidIntentFilters: ["text/*", "image/*", "video/*", "*/*"],
          androidMultiIntentFilters: ["image/*", "audio/*", "video/*", "*/*"],
        },
      ],
    ],
    extra,
  },
};
