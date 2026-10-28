import { spawn } from "node:child_process";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 12000);
  Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  ).then(() => {
    clearTimeout(timer);
    process.exit(code);
  });
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop(0));
function run(args, env = process.env) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
run(["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]);
if (process.env.DISPATCH_WORKER_ENABLED !== "false")
  run(["--import", "tsx", "scripts/dispatch-worker.ts"], {
    ...process.env,
    DB_POOL_MAX: "2",
  });
