import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url))

export default defineConfig({
  cacheDir: "../../node_modules/.vite/desktop",
  clearScreen: false,
  publicDir: "../../public",
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  plugins: [tailwindcss(), viteReact()],
})
