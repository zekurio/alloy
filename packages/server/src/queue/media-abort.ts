import { abortError } from "@alloy/server/runtime/error-message"

export function abortMediaProcessing(): Error {
  return abortError("Clip media processing cancelled")
}
