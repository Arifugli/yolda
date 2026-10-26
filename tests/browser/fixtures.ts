import { test as base } from "@playwright/test";
import { pool } from "../../lib/db";
export { expect } from "@playwright/test";
// A Playwright worker can run several files. Close the shared pool once, after all of them.
export const test = base.extend<{}, { database: typeof pool }>({
  database: [
    async ({}, use) => {
      await use(pool);
      await pool.end();
    },
    { scope: "worker", auto: true },
  ],
});
