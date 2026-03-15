import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Railway may pass a literal leading "--" through pnpm script forwarding.
// Strip that sentinel so `next start` receives only real CLI flags.
const forwardedArgs = [...process.argv.slice(2)];
if (forwardedArgs[0] === "--") {
  forwardedArgs.shift();
}

const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "start", ...forwardedArgs],
  {
    stdio: "inherit",
    env: process.env,
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
