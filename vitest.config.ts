import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "services/orderflow-email-api/src/**/*.test.ts"],
    environment: "node",
  },
});
