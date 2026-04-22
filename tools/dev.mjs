import { spawn } from "node:child_process";

const commands = [
  { name: "server", args: ["dev:server"] },
  { name: "web", args: ["dev:web"] },
];

const children = commands.map(({ name, args }) => {
  return spawn("pnpm", args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, FORCE_COLOR: "1" },
  }).on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
});

let closed = false;

function shutdown(code = 0) {
  if (closed) {
    return;
  }
  closed = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 50);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
