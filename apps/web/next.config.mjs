// Keep this config file under versioned watched paths so GitHub-based Railway
// deploys can be intentionally re-triggered without changing runtime behavior.
/** @type {import('next').NextConfig} */
const liveTsConfigPath = process.env.STARLOG_LIVE_FUNCTIONAL_TSCONFIG_PATH || undefined;

const nextConfig = {
  reactStrictMode: true,
  // Allow live functional runs to isolate build artifacts when the default
  // .next directory is not writable in the current sandbox context.
  distDir: process.env.STARLOG_LIVE_FUNCTIONAL_WEB_DIST_DIR || undefined,
  typescript: {
    ...(liveTsConfigPath ? { tsconfigPath: liveTsConfigPath } : {}),
  },
};

export default nextConfig;
