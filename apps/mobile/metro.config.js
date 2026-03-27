const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
const mobileNodeModulesRoot = path.resolve(projectRoot, "node_modules");
const workspaceNodeModulesRoot = path.resolve(workspaceRoot, "node_modules");

function realpathIfPresent(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
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
config.resolver.extraNodeModules = {
  "@babel/runtime": realpathIfPresent(path.resolve(mobileNodeModulesRoot, "@babel/runtime")),
};

module.exports = config;
