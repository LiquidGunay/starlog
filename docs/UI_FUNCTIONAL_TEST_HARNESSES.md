# UI Functional Test Harnesses

Starlog has repeatable Playwright smoke coverage for the new assistant-first UI concept through `playwright.ui-functional.config.ts`. The harness starts the Next dev server so it remains fast enough for feature-branch iteration; release packaging checks still use the existing PWA release-gate scripts.

## Commands

```bash
pnpm test:ui:pwa-functional
pnpm test:ui:mobile-functional
pnpm test:ui:functional
```

Use `corepack pnpm ...` on hosts where global `pnpm` is unavailable.

## Coverage

- `test:ui:pwa-functional` runs the desktop PWA assistant concept smoke against the real Next `/assistant` route with mocked AssistantThreadSnapshot and AssistantInterrupt API responses.
- `test:ui:mobile-functional` runs the same route under a Pixel 7 Playwright device profile to validate the mobile viewport assistant equivalent for inline dynamic-panel grammar.
- Both tests submit the dynamic panel to mocked assistant interrupt endpoints and assert the posted values plus the resolved UI state.

## Native Mobile Gap

This is not native Android/iOS automation. The current Expo mobile app cannot run as an Expo web harness without adding `react-native-web` and `@expo/metro-runtime`, and this workitem does not add a native automation stack such as Maestro or Detox. Native device coverage remains the next gap for the primary mobile app.
