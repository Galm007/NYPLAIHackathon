import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    // Mongo-backed suites spin up an in-memory mongod; the first run on a new
    // machine also downloads the binary. The default 5s timeout is not enough.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each file gets its own mongod / module registry — no shared global state.
    fileParallelism: true,
  },
});
