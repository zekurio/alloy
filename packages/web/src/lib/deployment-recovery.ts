import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"

import { clientLogger } from "./client-log"
import { alloyDesktop, alloyTauriDesktop } from "./desktop"

const RELOADED_ASSET_SIGNATURE_KEY = "alloy.deployment-recovery-target"
const WEB_BUILD_TOAST_ID = "alloy-web-build-update"

/** How often a visible tab re-reads the app shell to spot a server redeploy. */
export const WEB_BUILD_CHECK_INTERVAL_MS = 15 * 60_000
/**
 * Minimum gap between checks triggered by the tab regaining focus or
 * visibility, so alt-tabbing does not hammer the server.
 */
export const WEB_BUILD_FOCUS_CHECK_MIN_GAP_MS = 5 * 60_000

/**
 * The web app is served by whichever Alloy server this tab is connected to,
 * so a server upgrade silently swaps the build under a running tab. This
 * module handles that in two ways:
 *
 * - Recovery: Vite emits `vite:preloadError` when a dynamic import or one of
 *   its preload dependencies fails, typically because the deploy removed the
 *   old hashed chunks. The tab is broken at that point, so it reloads once the
 *   server confirms a different app shell.
 * - Notice: while the tab is visible it periodically re-reads the app shell
 *   and, when the build changed, offers a reload instead of forcing one. A
 *   forced reload would interrupt an edit or an upload in progress.
 *
 * Both paths compare the hashed asset list of the loaded shell with the one
 * the server serves now, so a request that merely fails offline or a broken
 * chunk never triggers a reload. The recovery path also remembers the build
 * it reloaded for, so a bad deploy cannot create a reload loop.
 */
export function installDeploymentRecovery(): void {
  const loadedAssetSignature = appShellAssetSignature(
    document,
    window.location.href,
  )
  if (!loadedAssetSignature) return

  let checking = false
  const check = (mode: "recover" | "notify") => {
    if (checking) return
    checking = true
    void checkForDeployment(loadedAssetSignature, mode).finally(() => {
      checking = false
    })
  }

  window.addEventListener("vite:preloadError", () => check("recover"))
  installWebBuildWatcher(() => check("notify"))
}

/**
 * Schedules the notice checks: a fixed interval while the tab is visible, plus
 * a check when the tab comes back into view or regains focus after being away
 * for a while. Hidden tabs do not poll; they catch up when shown again.
 */
function installWebBuildWatcher(check: () => void): void {
  const scheduler = createWebBuildCheckScheduler(check)

  window.setInterval(() => {
    if (document.visibilityState === "visible") scheduler.tick()
  }, WEB_BUILD_CHECK_INTERVAL_MS)

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduler.resume()
  })
  window.addEventListener("focus", () => scheduler.resume())
}

/**
 * Decides which wake-ups actually run a check. Exposed for tests; the
 * browser wiring above only forwards events.
 */
export function createWebBuildCheckScheduler(
  check: () => void,
  now: () => number = Date.now,
  isOnline: () => boolean = () => navigator.onLine !== false,
): { tick(): void; resume(): void } {
  let lastCheckedAt = now()
  const run = () => {
    if (!isOnline()) return
    lastCheckedAt = now()
    check()
  }
  return {
    /** Interval tick: always checks. */
    tick: run,
    /** Focus or visibility: checks only after enough time went by. */
    resume() {
      if (now() - lastCheckedAt < WEB_BUILD_FOCUS_CHECK_MIN_GAP_MS) return
      run()
    },
  }
}

let notifiedAssetSignature: string | null = null

async function checkForDeployment(
  loadedAssetSignature: string,
  mode: "recover" | "notify",
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

  if (mode === "notify") {
    if (
      !shouldNotifyForDeployment(
        loadedAssetSignature,
        latestAssetSignature,
        notifiedAssetSignature,
      )
    ) {
      return
    }
    notifiedAssetSignature = latestAssetSignature
    showWebBuildUpdateNotice(latestAssetSignature)
    return
  }

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
  reloadApp()
}

function showWebBuildUpdateNotice(latestAssetSignature: string): void {
  toast.info(t("Alloy was updated"), {
    id: WEB_BUILD_TOAST_ID,
    description: t(
      "This server now runs a newer version of Alloy. Reload to use it.",
    ),
    duration: Infinity,
    action: {
      label: t("Reload"),
      onClick: () => {
        // A user-requested reload should always happen, so do not let a
        // remembered recovery target for the same build block it.
        rememberReloadedAssetSignature(latestAssetSignature)
        reloadApp()
      },
    },
  })
}

function reloadApp(): void {
  const desktop = alloyDesktop() ?? alloyTauriDesktop()
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

/**
 * A notice is shown once per new build. If the server rolls back to the build
 * this tab already runs, nothing is shown.
 */
export function shouldNotifyForDeployment(
  loadedAssetSignature: string | null,
  latestAssetSignature: string | null,
  notifiedAssetSignature: string | null,
): latestAssetSignature is string {
  return (
    loadedAssetSignature !== null &&
    latestAssetSignature !== null &&
    loadedAssetSignature !== latestAssetSignature &&
    latestAssetSignature !== notifiedAssetSignature
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
