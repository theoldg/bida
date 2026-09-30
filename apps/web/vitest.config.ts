import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same alias as next.config.mjs, so a file that imports the crop model resolves.
  resolve: {
    alias: {
      "scanic/ml": join(dirname(createRequire(import.meta.url).resolve("scanic")), "scanic-mlDetector.js"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
  },
});
