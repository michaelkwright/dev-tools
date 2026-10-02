import { defineConfig } from "vitest/config";

// Only skill test harnesses (a <part>/test/ folder) run here. Other files under
// a skill's reference/ or templates/ are copied into other projects and run
// there, not in this repo.
export default defineConfig({
  test: {
    include: ["skills/*/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
