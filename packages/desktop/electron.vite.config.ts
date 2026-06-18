import { builtinModules } from "node:module"
import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

function fromHere(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url))
}

// electron-vite's `isolatedEntries` build reporter draws progress with
// `process.stdout.clearLine`/`cursorTo`/`moveCursor`, which only exist on a TTY.
// When stdout is piped — `devenv up` (process-compose) in dev, or CI — those
// calls throw and abort the preload build. Fall back to no-ops so the reporter
// degrades to plain logging instead of crashing the build.
const stdout = process.stdout
if (typeof stdout.clearLine !== "function") {
  stdout.clearLine = () => true
  stdout.cursorTo = () => true
  stdout.moveCursor = () => true
  stdout.columns ??= 80
}

// `electron` and node built-ins must stay external in the main/preload bundles:
// `electron` is provided by the runtime, and bundling its npm launcher stub
// makes it try to "download Electron" on startup. Everything else is bundled —
// notably the @workspace/* packages, which ship TypeScript source with no build
// step. We set this explicitly rather than via `externalizeDepsPlugin`, which
// derives externals from `dependencies` only and so drops the devDependency
// `electron`.
const nodeExternals = [
  "electron",
  /^electron\/.+/,
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: fromHere("src/main/index.ts"),
          "recording-library-scan-worker": fromHere(
            "src/main/recording-library-scan-worker.ts",
          ),
        },
        external: nodeExternals,
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must each be a single self-contained file: their
      // restricted `require` can only load `electron` and a few builtins, not
      // sibling chunk files. Both preloads import `shared/ipc`, which the
      // bundler would otherwise hoist into a shared chunk the preload tries to
      // `require("./chunks/…")` at runtime — throwing before the context bridge
      // runs, so the web app never sees the desktop marker. `isolatedEntries`
      // bundles each entry's dependencies inline instead of splitting them out.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          // `overlay`: privileged bridge for the connect screen.
          // `main`: desktop bridge injected into the remote web app.
          overlay: fromHere("src/preload/overlay.ts"),
          main: fromHere("src/preload/main.ts"),
        },
        external: nodeExternals,
        // Sandboxed preloads must be CommonJS; force the format + extension so
        // the path referenced from the main process stays stable.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: fromHere("src/renderer"),
    // Serve the shared repo assets (logo.png, etc.) the overlay reuses from
    // @alloy/ui, mirroring how packages/web mounts the same public dir.
    publicDir: fromHere("../../public"),
    plugins: [tailwindcss(), viteReact()],
    resolve: {
      tsconfigPaths: true,
    },
    // 5173 belongs to @alloy/web; keep the overlay dev server off it.
    server: { port: 5273, strictPort: true },
    build: {
      rollupOptions: {
        input: {
          overlay: fromHere("src/renderer/index.html"),
        },
      },
    },
  },
})
