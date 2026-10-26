import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * The connect screen's policy, set as a meta tag in builds only: the dev
 * server injects inline scripts for hot reloading.
 */
const CONNECT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ")

const connectCsp: Plugin = {
  name: "alloy:connect-csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CONNECT_CSP },
      injectTo: "head-prepend",
    },
  ],
}

export default defineConfig({
  main: {
    define: {
      // The updater's release key; empty, and updates off, unless a release
      // build sets it.
      __ALLOY_UPDATER_PUBLIC_KEY__: JSON.stringify(
        process.env.ALLOY_UPDATER_PUBLIC_KEY ?? "",
      ),
    },
    build: {
      // Everything is bundled: the packaged app ships no node_modules.
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: fromHere("src/main/index.ts") },
        // Chromium switches must be set before an asynchronous ES module
        // loader would run, so the main process stays CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must each be one CommonJS file: they can require
      // `electron` but not a sibling chunk.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          connect: fromHere("src/preload/connect.ts"),
          server: fromHere("src/preload/server.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: fromHere("src/connect"),
    publicDir: fromHere("../../public"),
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: 5174,
      strictPort: true,
      fs: { allow: [fromHere("../..")] },
    },
    build: {
      rolldownOptions: {
        input: { index: fromHere("src/connect/index.html") },
      },
    },
    plugins: [connectCsp, tailwindcss(), viteReact()],
  },
})
