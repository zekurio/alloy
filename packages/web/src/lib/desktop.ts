import {
  desktopBridgeSupports,
  DESKTOP_BRIDGE_VERSION,
  isCurrentDesktopBridge,
  type AlloyDesktop,
  type DesktopBridgePath,
} from "@alloy/contracts"

// Bridge and recording-library contract types live in @alloy/contracts (single
// source of truth shared with the desktop shell); re-exported here so existing
// consumer imports keep working.
export type {
  AlloyDesktop,
  AlloyDesktopRecordingApi,
  DesktopSavedServer,
  RecordingCaptureMention,
  RecordingLibraryDownload,
  RecordingLibraryGroup,
  RecordingLibraryItem,
  RecordingLibraryMetaPatch,
  RecordingLibrarySnapshot,
  RecordingLibraryStagedImport,
} from "@alloy/contracts"

export function alloyDesktop(): AlloyDesktop | null {
  // Injected by the desktop preload; unexpressible on `typeof globalThis`.
  // SAFETY: The preload is the only writer of this optional global and uses
  // the shared AlloyDesktop bridge contract.
  const host = globalThis as { alloyDesktop?: AlloyDesktop }
  return host.alloyDesktop ?? null
}

/** Whether the active desktop shell implements one bridge member. */
export function desktopSupports(path: DesktopBridgePath): boolean {
  const desktop = alloyDesktop()
  return Boolean(desktop && desktopBridgeSupports(desktop.bridge.version, path))
}

export function desktopBridgeMismatch(): {
  actual: number
  expected: number
} | null {
  const desktop = alloyDesktop()
  if (!desktop || isCurrentDesktopBridge(desktop.bridge.version)) return null
  return {
    actual: desktop.bridge.version,
    expected: DESKTOP_BRIDGE_VERSION,
  }
}

/**
 * In-renderer signal that capture metadata changed outside the library page
 * (e.g. an upload finalized and linked a capture to its server clip), so
 * snapshot consumers re-scan without waiting for a recorder event.
 */
const LIBRARY_CAPTURES_CHANGED_EVENT = "alloy:library-captures-changed"

interface LibraryCapturesChangedDetail {
  deletedCaptureId?: string
}

export function notifyLibraryCapturesChanged(deletedCaptureId?: string): void {
  window.dispatchEvent(
    new CustomEvent<LibraryCapturesChangedDetail>(
      LIBRARY_CAPTURES_CHANGED_EVENT,
      { detail: { deletedCaptureId } },
    ),
  )
}

export function onLibraryCapturesChanged(
  listener: (detail: LibraryCapturesChangedDetail) => void,
): () => void {
  const handle = (event: Event) => {
    // SAFETY: This listener only handles the named CustomEvent created above,
    // whose detail is LibraryCapturesChangedDetail.
    listener(
      event instanceof CustomEvent
        ? (event.detail as LibraryCapturesChangedDetail)
        : {},
    )
  }
  window.addEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, handle)
  return () =>
    window.removeEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, handle)
}

/**
 * Routes a remote image URL through the desktop shell's persistent asset
 * cache (`alloy-asset://`) when running inside Alloy Desktop, so game icons
 * and similar assets load from disk and survive offline servers. Outside the
 * desktop app — or for non-http(s)/already-proxied URLs — the URL is returned
 * unchanged.
 */
export function desktopCachedAssetUrl(url: string | null): string | null {
  if (!url || !alloyDesktop()) return url
  if (!/^https?:\/\//i.test(url)) return url
  const bytes = new TextEncoder().encode(url)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `alloy-asset://remote/${encoded}`
}
