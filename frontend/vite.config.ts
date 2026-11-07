import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// Older Android System WebViews and iOS 15 Safari ignore media queries in
// range syntax and unprefixed backdrop-filter, so pin explicit targets and
// let the build add prefixes and lower the syntax.
const targets = ["chrome107", "safari15", "edge107", "firefox110"];

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9246,
    strictPort: true,
  },
  build: {
    target: targets,
    cssTarget: targets,
  },
  plugins: [react(), wails("./bindings")],
});
