// Keep this config file under versioned watched paths so GitHub-based Railway
// deploys can be intentionally re-triggered without changing runtime behavior.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
