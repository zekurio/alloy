import { readFileSync } from "node:fs"
import { builtinModules } from "node:module"

import { defineConfig } from "vite"

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`])

// Node resolves and links every file of an external package at startup, and
// re-reads the package's package.json for each one. drizzle-orm alone is ~100
// files under a 179 kB package.json, and TypeBox ~700 files: loading them from
// node_modules took most of a second and peaked near 400 MB. So the bundle
// inlines every pure-JS dependency, and only the packages in `dependencies`
// (sharp's native addon) load from node_modules. The Nix package ships exactly
// those, see scripts/prune-server-node-modules.mjs.
const packageJson: { dependencies: Record<string, string> } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
)
const runtimePackages = Object.keys(packageJson.dependencies).filter(
  (name) => !name.startsWith("@alloy/"),
)

// pg requires these only for its native and Cloudflare backends, lazily.
const optionalPackages = ["pg-native", "pg-cloudflare"]

const runtimeExternal = [
  ...nodeBuiltins,
  ...runtimePackages,
  ...optionalPackages,
]

function isRuntimeExternal(id: string): boolean {
  return runtimeExternal.some(
    (name) => id === name || id.startsWith(`${name}/`),
  )
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: "dist",
    rollupOptions: {
      external: isRuntimeExternal,
      output: {
        entryFileNames: "index.js",
        format: "es",
        // Unmangled and line-broken, so logged stack traces keep function
        // and class names, and an uncaught error's source excerpt is one
        // statement rather than a whole chunk.
        minify: {
          compress: true,
          mangle: false,
          codegen: { removeWhitespace: false },
        },
      },
    },
    sourcemap: true,
    ssr: "src/index.ts",
    target: "node24",
  },
  ssr: {
    external: runtimePackages,
    noExternal: true,
  },
})
