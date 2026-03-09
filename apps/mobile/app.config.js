const variant = process.env.APP_VARIANT || "production";

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
    version: "0.1.0",
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
      bundleIdentifier: `com.starlog.app${packageSuffix}`,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0d1117",
      },
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
          androidIntentFilters: ["text/*", "image/*", "audio/*", "video/*", "*/*"],
          androidMultiIntentFilters: ["image/*", "audio/*", "video/*", "*/*"],
        },
      ],
    ],
    extra,
  },
};
