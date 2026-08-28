import type { AlloyDesktop } from "@alloy/contracts"

declare global {
  interface Window {
    alloyDesktop?: AlloyDesktop
  }
}
