import {
  TAURI_DESKTOP_BRIDGE_CONTRACT_1,
  type AlloyTauriDesktop,
} from "@alloy/contracts/desktop-tauri"

// Native and recording-library types live in @alloy/contracts. Re-export them
// here so web consumers use one import path.
export type {
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
export type AlloyDesktop = AlloyTauriDesktop

/**
 * Reads the bridge the desktop host installs on `globalThis`. A bridge is
 * accepted only when its `bridgeContract` matches the exact contract ID this
 * build speaks; anything else (a missing, older, or newer bridge) reads as the
 * plain browser build and returns null.
 */
export function alloyDesktop(): AlloyDesktop | null {
  // SAFETY: The optional host property is checked by the runtime contract ID
  // before it is returned to web code.
  const host = globalThis as { alloyTauriDesktop?: AlloyDesktop }
  return host.alloyTauriDesktop?.bridgeContract ===
    TAURI_DESKTOP_BRIDGE_CONTRACT_1
    ? host.alloyTauriDesktop
    : null
}

/** Returns whether the page runs in Alloy Desktop. */
export function isNativeDesktop(): boolean {
  return alloyDesktop() !== null
}

/**
 * Returns the bridge's window controls only when the host asked the web app to
 * draw its own title bar (frameless window with `titlebarOverlay` set);
 * otherwise null, so callers fall back to the plain browser layout.
 */
export function alloyWindowChrome(): Pick<
  AlloyDesktop,
  "titlebarOverlay" | "minimizeWindow" | "toggleMaximizeWindow" | "closeWindow"
> | null {
  const desktop = alloyDesktop()
  if (desktop?.titlebarOverlay) return desktop

  return null
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
