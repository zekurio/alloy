import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    exclude: [
      "**/.devenv/**",
      "**/.direnv/**",
      "**/.repos/**",
      "**/build/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/out/**",
      "**/target/**",
    ],
    globals: true,
  },
})
