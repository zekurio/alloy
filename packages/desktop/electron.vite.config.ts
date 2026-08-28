import { builtinModules } from "node:module"
import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

function fromHere(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url))
}

const workspaceRoot = fromHere("../../")
const webSource = fromHere("../web/src")

// electron-vite's `isolatedEntries` build reporter draws progress with
// `process.stdout.clearLine`/`cursorTo`/`moveCursor`, which only exist on a TTY.
// When stdout is piped — `devenv up` (process-compose) in dev, or CI — those
// calls throw and abort the preload build. Fall back to no-ops so the reporter
// degrades to plain logging instead of crashing the build.
const stdout = process.stdout
if (!stdout.clearLine) {
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

const desktopDevCsp = {
  name: "alloy:desktop-dev-csp",
  apply: "serve",
  transformIndexHtml(html: string, context: { filename: string }) {
    if (!context.filename.endsWith("desktop.html")) return html
    return html.replace(
      "connect-src 'self'",
      "connect-src 'self' ws://localhost:5273",
    )
  },
} as const

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
          // `overlay`: startup/connect API.
          // `main`: native API for the bundled application.
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
    // Browser bundles must ignore globals from retired remote-renderer shells.
    // Only this installer-owned build enables the lockstep native API.
    define: {
      "import.meta.env.VITE_ALLOY_DESKTOP": JSON.stringify("true"),
    },
    // Serve the shared repo assets (logo.png, etc.) the overlay reuses from
    // @alloy/ui, mirroring how packages/web mounts the same public dir.
    publicDir: fromHere("../../public"),
    server: {
      // The app entry imports the web source from a sibling package. Allow it
      // through Vite's dev server so Electron gets normal HMR instead of a
      // second web server or a copied renderer tree.
      fs: { allow: [workspaceRoot] },
      // 5173 belongs to @alloy/web; keep the overlay dev server off it.
      port: 5273,
      strictPort: true,
    },
    plugins: [
      desktopDevCsp,
      tailwindcss(),
      tanstackRouter({
        autoCodeSplitting: true,
        routesDirectory: fromHere("../web/src/routes"),
        generatedRouteTree: fromHere("../web/src/routeTree.gen.ts"),
      }),
      viteReact(),
    ],
    resolve: {
      alias: [
        // The overlay is still rooted in packages/desktop. Match its only
        // `@/` import before mapping the web app's `@/` imports.
        { find: "@/shared", replacement: fromHere("src/shared") },
        {
          find: "@alloy/web-desktop-entry",
          replacement: fromHere("../web/src/desktop.tsx"),
        },
        { find: "@", replacement: webSource },
      ],
      tsconfigPaths: true,
    },
    build: {
      rollupOptions: {
        // `desktop.html` is the bundled main window. The main process loads it
        // through alloy-app://app after the custom protocol is registered.
        input: {
          overlay: fromHere("src/renderer/index.html"),
          desktop: fromHere("src/renderer/desktop.html"),
        },
      },
    },
  },
})
