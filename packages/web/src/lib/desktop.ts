import {
  desktopBridgeSupports,
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
  const host = globalThis as { alloyDesktop?: AlloyDesktop }
  return host.alloyDesktop ?? null
}

/**
 * Whether the hosting desktop shell implements the bridge member at `path`.
 * Always false in a plain browser. This is the only sanctioned capability
 * gate: at bridge v1 every member is required, so it is equivalent to an
 * `alloyDesktop()` null check, but it becomes load-bearing for members added
 * in bridge v2+.
 */
export function desktopSupports(path: DesktopBridgePath): boolean {
  return desktopBridgeSupports(alloyDesktop()?.bridge.version ?? 0, path)
}

/**
 * In-renderer signal that capture metadata changed outside the library page
 * (e.g. an upload finalized and linked a capture to its server clip), so
 * snapshot consumers re-scan without waiting for a recorder event.
 */
const LIBRARY_CAPTURES_CHANGED_EVENT = "alloy:library-captures-changed"

export function notifyLibraryCapturesChanged(): void {
  window.dispatchEvent(new Event(LIBRARY_CAPTURES_CHANGED_EVENT))
}

export function onLibraryCapturesChanged(listener: () => void): () => void {
  window.addEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, listener)
  return () =>
    window.removeEventListener(LIBRARY_CAPTURES_CHANGED_EVENT, listener)
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
