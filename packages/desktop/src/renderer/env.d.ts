/// <reference types="vite/client" />

import type { AlloyNative, AlloyRecordingHud } from "../shared/ipc"

declare global {
  interface Window {
    /** Privileged native bridge; present only in the overlay window. */
    alloyNative: AlloyNative
    /** Recording HUD bridge; present only in the save-clip HUD window. */
    alloyRecordingHud: AlloyRecordingHud
  }
}
