import type { AlloyDesktop } from "@alloy/contracts"

// Native and recording-library types live in @alloy/contracts. Re-export them
// here so web consumers use one import path.
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
  // Browser builds ignore globals left behind by old Electron shells. The
  // desktop build and its preload ship the complete lockstep API together.
  if (import.meta.env.VITE_ALLOY_DESKTOP !== "true") return null

  // Injected by the desktop preload; unexpressible on `typeof globalThis`.
  // SAFETY: The lockstep preload is the only writer in the desktop build.
  const host = globalThis as { alloyDesktop?: AlloyDesktop }
  return host.alloyDesktop ?? null
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
