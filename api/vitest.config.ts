import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    // Test files share one database; running them one at a time keeps them independent.
    fileParallelism: false,
    // argon2 is deliberately slow; give hashing-heavy tests room.
    testTimeout: 15_000,
  },
});
