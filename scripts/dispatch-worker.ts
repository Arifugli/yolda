import { dispatchTick } from "../lib/orders/worker";
import { pool } from "../lib/db";
let running = true;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    running = false;
  });
while (running) {
  try {
    const result = await dispatchTick();
    if (result.failures)
      console.error("dispatch_tick_partial_failure", result.failures);
  } catch {
    console.error("dispatch_tick_failed");
  }
  if (running) await new Promise((resolve) => setTimeout(resolve, 3000));
}
await pool.end();
