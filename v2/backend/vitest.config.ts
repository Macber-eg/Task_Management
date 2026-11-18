import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC emits the decorator metadata Nest's dependency injection reads;
// esbuild (Vitest's default transform) does not.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    setupFiles: ["test/support/unit-setup.ts"],
  },
});
