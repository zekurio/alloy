import { builtinModules } from "node:module"

import { defineConfig } from "vite"

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`])

const runtimePackages = [
  "@hono/node-server",
  "@hono/zod-validator",
  "@simplewebauthn/server",
  "drizzle-orm",
  "hono",
  "openid-client",
  "pg",
  "zod",
]

const runtimeExternal = [...nodeBuiltins, ...runtimePackages]

function isRuntimeExternal(id: string): boolean {
  return runtimeExternal.some(
    (name) => id === name || id.startsWith(`${name}/`),
  )
}

const workspacePackages = ["alloy-contracts", "alloy-db", "alloy-logging"]

const ssrExternal = [...nodeBuiltins, ...runtimePackages]

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist",
    rollupOptions: {
      external: isRuntimeExternal,
      output: {
        entryFileNames: "index.js",
        format: "es",
      },
    },
    sourcemap: true,
    ssr: "src/index.ts",
    target: "node24",
  },
  ssr: {
    external: ssrExternal,
    noExternal: workspacePackages,
  },
})
