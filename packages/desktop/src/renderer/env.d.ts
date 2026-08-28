/// <reference types="vite/client" />

import type { AlloyNative } from "@/shared/ipc"

declare global {
  interface Window {
    /** Privileged native API present only in the overlay window. */
    alloyNative?: AlloyNative
  }
}
