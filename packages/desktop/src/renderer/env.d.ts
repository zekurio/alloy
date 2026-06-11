/// <reference types="vite/client" />

import type { AlloyNative } from "../shared/ipc"

declare global {
  interface Window {
    /** Privileged native bridge; present only in the overlay window. */
    alloyNative?: AlloyNative
  }
}
