import { createDesktopRuntimeConfig, setRuntimeConfig } from "./lib/runtime-env"

const desktop = window.alloyDesktop

if (!desktop) {
  throw new Error("Alloy desktop native API is unavailable")
}

const serverUrl = await desktop.servers.getCurrentServer()

if (!serverUrl) {
  throw new Error("Alloy desktop has no selected server")
}

setRuntimeConfig(createDesktopRuntimeConfig(serverUrl))

// The main process loads this entry from alloy-app://app after selecting the
// server. In development it must also expose the Electron Vite renderer URL
// to this lockstep bridge. Keep the app import behind runtime configuration:
// api.ts and auth-client.ts create their clients while the shared app modules
// load.
await import("./main")
