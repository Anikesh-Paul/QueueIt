import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { stampServiceWorker } from "./scripts/stamp-sw.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Stamp dist/sw.js with this build's id and app-shell asset list so every
 * deploy ships a new worker (see public/sw.js and scripts/stamp-sw.mjs).
 */
function queueitServiceWorker() {
  let outDir = "dist";
  let assets = [];
  return {
    name: "queueit-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle);
    },
    closeBundle() {
      stampServiceWorker({ outDir, assets });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), queueitServiceWorker()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
