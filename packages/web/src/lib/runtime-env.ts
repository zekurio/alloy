import { DESKTOP_APP_ORIGIN } from "@alloy/contracts"
import { normalizePublicServerUrl } from "@alloy/env"

/** Origin handled by the desktop main process' application protocol. */
export const DESKTOP_API_ORIGIN = DESKTOP_APP_ORIGIN

export interface RuntimeConfig {
  readonly mode: "desktop"
  /** The selected server used for public links and browser auth. */
  readonly serverUrl: string
  readonly apiOrigin: typeof DESKTOP_API_ORIGIN
  readonly publicOrigin: string
}

let runtimeConfig: RuntimeConfig | null = null

export function createDesktopRuntimeConfig(serverUrl: string): RuntimeConfig {
  const publicOrigin = normalizePublicServerUrl(serverUrl)
  return {
    mode: "desktop",
    serverUrl: publicOrigin,
    apiOrigin: DESKTOP_API_ORIGIN,
    publicOrigin,
  }
}

export function setRuntimeConfig(config: RuntimeConfig): void {
  runtimeConfig = config
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return runtimeConfig
}

export function resetRuntimeConfig(): void {
  runtimeConfig = null
}

export function isDesktopRuntime(): boolean {
  return runtimeConfig?.mode === "desktop"
}
