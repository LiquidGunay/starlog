const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
const mobileNodeModulesRoot = path.resolve(projectRoot, "node_modules");
const workspaceNodeModulesRoot = path.resolve(workspaceRoot, "node_modules");
const blockedReactPath = realpathIfPresent(
  path.resolve(workspaceNodeModulesRoot, ".pnpm/react@18.3.1/node_modules/react"),
);

function realpathIfPresent(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function metroExclusionList(additionalExclusions = []) {
  const defaults = [/\/__tests__\/.*/];
  const patterns = [...additionalExclusions, ...defaults].map((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.source.replace(/\/|\\\//g, `\\${path.sep}`);
    }
    return pattern
      .replace(/[\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
      .replaceAll("/", `\\${path.sep}`);
  });
  return new RegExp(`(${patterns.join("|")})$`);
}

const watchFolders = Array.from(
  new Set([
    workspaceRoot,
    realpathIfPresent(workspaceRoot),
    realpathIfPresent(projectRoot),
    realpathIfPresent(mobileNodeModulesRoot),
    realpathIfPresent(workspaceNodeModulesRoot),
  ]),
);

// Keep Metro aware of the monorepo root so workspace-linked dependencies
// resolve consistently when the app is launched from a linked worktree.
config.watchFolders = watchFolders;
config.resolver.nodeModulesPaths = [
  mobileNodeModulesRoot,
  workspaceNodeModulesRoot,
  realpathIfPresent(mobileNodeModulesRoot),
  realpathIfPresent(workspaceNodeModulesRoot),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.blockList = metroExclusionList([
  new RegExp(`^${blockedReactPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/.*)?$`),
]);
config.resolver.extraNodeModules = {
  react: realpathIfPresent(path.resolve(mobileNodeModulesRoot, "react")),
  "react/jsx-runtime": realpathIfPresent(path.resolve(mobileNodeModulesRoot, "react/jsx-runtime")),
  "react/jsx-dev-runtime": realpathIfPresent(path.resolve(mobileNodeModulesRoot, "react/jsx-dev-runtime")),
  "react-native": realpathIfPresent(path.resolve(mobileNodeModulesRoot, "react-native")),
  scheduler: realpathIfPresent(path.resolve(mobileNodeModulesRoot, "scheduler")),
  "@babel/runtime": realpathIfPresent(path.resolve(mobileNodeModulesRoot, "@babel/runtime")),
};

module.exports = config;
