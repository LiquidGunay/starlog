import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Railway may pass a literal leading "--" through pnpm script forwarding.
// Strip that sentinel so `next start` receives only real CLI flags.
const forwardedArgs = [...process.argv.slice(2)];
if (forwardedArgs[0] === "--") {
  forwardedArgs.shift();
}

const standaloneServerPath = path.resolve(process.cwd(), ".next/standalone/server.js");

function parseRuntimeArgs(args) {
  const env = { ...process.env };
  const passthrough = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--port" || arg === "-p") && next) {
      env.PORT = next;
      index += 1;
      continue;
    }
    if ((arg === "--hostname" || arg === "-H") && next) {
      env.HOSTNAME = next;
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  return { env, passthrough };
}

const { env, passthrough } = parseRuntimeArgs(forwardedArgs);
const commandArgs = existsSync(standaloneServerPath)
  ? [standaloneServerPath, ...passthrough]
  : [require.resolve("next/dist/bin/next"), "start", ...passthrough];

const child = spawn(
  process.execPath,
  commandArgs,
  {
    stdio: "inherit",
    env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
