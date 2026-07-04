import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["frontend/src/**/*.test.{ts,tsx}", "src/shared/**/*.test.ts"],
    setupFiles: ["./frontend/test/setup.ts"],
  },
});
