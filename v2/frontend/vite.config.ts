import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageJson from "./package.json";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  base: "/",
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      // Keep co-located route tests out of the generated route tree.
      routeFileIgnorePattern: "\\.test\\.tsx?$",
    }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    host: true,
    hmr: true,
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@i18n": path.resolve(import.meta.dirname, "./i18n"),
    },
  },
  build: {
    sourcemap: false,
    target: "esnext",
  },
});
