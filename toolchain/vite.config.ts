import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../apps/web");

export default defineConfig({
  root,
  base: "/",
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    // No inline data: URIs or inline module-preload scripts, so CSP 'self' holds.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        login: resolve(root, "login.html"),
        locked: resolve(root, "locked.html"),
      },
    },
  },
});
