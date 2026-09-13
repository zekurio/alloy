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
export type { AlloyTauriDesktop } from "@alloy/contracts/desktop-tauri"
export type AlloyDesktop = AlloyTauriDesktop

export function alloyDesktop(): AlloyTauriDesktop | null {
  return alloyTauriDesktop()
}

/**
 * Reads the exact bridge installed by the Tauri host. Retired Electron
 * globals do not grant native features to the browser build.
 */
export function alloyTauriDesktop(): AlloyTauriDesktop | null {
  // SAFETY: The optional host property is checked by the runtime contract ID
  // before it is returned to web code.
  const host = globalThis as { alloyTauriDesktop?: AlloyTauriDesktop }
  return host.alloyTauriDesktop?.bridgeContract ===
    TAURI_DESKTOP_BRIDGE_CONTRACT_1
    ? host.alloyTauriDesktop
    : null
}

/** Returns whether the page runs in Alloy Desktop. */
export function isNativeDesktop(): boolean {
  return alloyTauriDesktop() !== null
}

/**
 * Returns the native window controls only when a shell owns an overlay title
 * bar. Tauri currently uses native decorations, so it returns null there.
 */
export function alloyWindowChrome(): Pick<
  AlloyTauriDesktop,
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
