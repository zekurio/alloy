import { clientLogger } from "./client-log"
import { alloyDesktop } from "./desktop"

const RELOADED_ASSET_SIGNATURE_KEY = "alloy.deployment-recovery-target"

/**
 * Vite emits `vite:preloadError` when a dynamic import or one of its preload
 * dependencies fails. A common cause is a deploy removing the old hashed
 * chunks while this tab still runs the previous build.
 *
 * Do not reload for every preload failure: offline requests and broken chunks
 * produce the same event. Confirm that the server now advertises a different
 * app shell, and remember that target build before reloading so a bad deploy
 * cannot create a reload loop.
 */
export function installDeploymentRecovery(): void {
  const loadedAssetSignature = appShellAssetSignature(
    document,
    window.location.href,
  )
  if (!loadedAssetSignature) return

  let checking = false
  window.addEventListener("vite:preloadError", () => {
    if (checking) return
    checking = true
    void recoverFromDeployment(loadedAssetSignature).finally(() => {
      checking = false
    })
  })
}

async function recoverFromDeployment(
  loadedAssetSignature: string,
): Promise<void> {
  const latestAssetSignature = await fetchLatestAssetSignature().catch(
    (cause: unknown) => {
      clientLogger.warn(
        "Could not check for an updated Alloy web build:",
        cause,
      )
      return null
    },
  )
  if (
    !shouldReloadForDeployment(
      loadedAssetSignature,
      latestAssetSignature,
      readReloadedAssetSignature(),
    )
  ) {
    return
  }
  if (!rememberReloadedAssetSignature(latestAssetSignature)) return

  const desktop = alloyDesktop()
  if (desktop) {
    void desktop.reloadApp().catch(() => window.location.reload())
    return
  }
  window.location.reload()
}

async function fetchLatestAssetSignature(): Promise<string | null> {
  const response = await fetch(window.location.href, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  })
  if (!response.ok) return null

  return appShellAssetSignature(
    new DOMParser().parseFromString(await response.text(), "text/html"),
    response.url,
  )
}

function appShellAssetSignature(
  document: Document,
  baseUrl: string,
): string | null {
  const assets = Array.from(
    document.querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
      'script[type="module"][src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
    ),
    (element) => {
      const path = element.getAttribute(
        element.tagName === "SCRIPT" ? "src" : "href",
      )
      return path ? new URL(path, baseUrl).href : ""
    },
  ).filter(Boolean)

  return assets.length > 0 ? JSON.stringify(assets.toSorted()) : null
}

export function shouldReloadForDeployment(
  loadedAssetSignature: string | null,
  latestAssetSignature: string | null,
  reloadedAssetSignature: string | null,
): latestAssetSignature is string {
  return (
    loadedAssetSignature !== null &&
    latestAssetSignature !== null &&
    loadedAssetSignature !== latestAssetSignature &&
    latestAssetSignature !== reloadedAssetSignature
  )
}

function readReloadedAssetSignature(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_ASSET_SIGNATURE_KEY)
  } catch {
    return null
  }
}

function rememberReloadedAssetSignature(signature: string): boolean {
  try {
    sessionStorage.setItem(RELOADED_ASSET_SIGNATURE_KEY, signature)
    return true
  } catch {
    // Without durable per-tab state, reloading could loop on a broken deploy.
    return false
  }
}
