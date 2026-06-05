import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  outDir: "dist",
  clean: true,
  noExternal: ["@workspace/contracts", "@workspace/db", "@workspace/logging"],
})
